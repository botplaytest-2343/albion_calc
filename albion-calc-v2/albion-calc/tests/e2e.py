"""End-to-end test: loads the web app in headless Chromium with a mocked AODP API and checks every tool,
including the numbers (expected values are recomputed here from the same mock prices)."""
import json, re, sys, os, hashlib, urllib.parse
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'web'))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
os.makedirs(SHOTS, exist_ok=True)
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082')

def h(s):  # stable pseudo-random 0..1
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xffffffff

def base_price(item):
    m = re.match(r'T(\d)', item); t = int(m.group(1)) if m else 4
    e = int(item.split('@')[1]) if '@' in item else 0
    return int(300 * (2.4 ** (t - 3)) * (1.7 ** e) * (0.8 + 0.4 * h(item)))

def sell_price(item, city):
    return int(base_price(item) * (0.8 + 0.5 * h(item + city)))

def has_row(item, city, ql=1):
    return h(item + city + str(ql) + 'x') >= 0.1

def prices(route, req):
    u = urllib.parse.urlparse(req.url)
    ids = urllib.parse.unquote(u.path.split('/prices/')[1].replace('.json', '')).split(',')
    q = urllib.parse.parse_qs(u.query)
    locs = q.get('locations', [''])[0].split(','); quals = [int(x) for x in q.get('qualities', ['1'])[0].split(',')]
    rows = []
    for i in ids:
        for c in locs:
            for ql in quals:
                if not has_row(i, c, ql): continue
                bp = base_price(i)
                if c == 'Black Market':
                    sell, buy = 0, int(bp * (1.05 + 0.5 * h(i + 'bm')))
                else:
                    sell = sell_price(i, c); buy = int(sell * 0.8)
                rows.append({'item_id': i, 'city': c, 'quality': ql, 'sell_price_min': sell, 'sell_price_min_date': '2026-10-07T06:00:00',
                             'sell_price_max': sell, 'sell_price_max_date': '2026-10-07T06:00:00',
                             'buy_price_min': buy, 'buy_price_min_date': '2026-10-07T06:00:00', 'buy_price_max': buy, 'buy_price_max_date': '2026-10-07T06:00:00'})
    route.fulfill(status=200, headers={'access-control-allow-origin': '*'}, content_type='application/json', body=json.dumps(rows))

def history(route, req):
    u = urllib.parse.urlparse(req.url)
    ids = urllib.parse.unquote(u.path.split('/history/')[1].replace('.json', '')).split(',')
    q = urllib.parse.parse_qs(u.query)
    locs = q.get('locations', [''])[0].split(','); quals = [int(x) for x in q.get('qualities', ['1'])[0].split(',')]
    rows = []
    for i in ids:
        for c in locs:
            for ql in quals:
                rows.append({'location': c, 'item_id': i, 'quality': ql, 'data': [{'item_count': 50 + d, 'avg_price': base_price(i) + d, 'timestamp': f'2026-10-0{d+1}T00:00:00'} for d in range(5)]})
    route.fulfill(status=200, headers={'access-control-allow-origin': '*'}, content_type='application/json', body=json.dumps(rows))

errors, fails = [], []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' – ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

def digits(s): return int(re.sub(r'[^\d-]', '', s.replace('−', '-')) or 0)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 1000})
    # simulate leftovers from a previous session: they must NOT be restored
    ctx.add_init_script("try{localStorage.setItem('albion-calc.v1',JSON.stringify({settings:{server:'west',premium:true},book:{buy:{T4_PLANKS:999},sell:{},meta:{}},planner:{items:[{id:'T6_MAIN_FIRESTAFF',qty:5}]}}))}catch(e){}")
    page = ctx.new_page()
    page.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type in ('error',) else None)
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.route('**/api/v2/stats/prices/**', prices)
    page.route('**/api/v2/stats/history/**', history)
    page.route('https://render.albiononline.com/**', lambda r, q: r.fulfill(status=200, content_type='image/png', body=PNG))
    page.goto('file://' + ROOT + '/index.html#planner')
    page.wait_for_selector('.tab.active')

    def shot(name, full=True): page.screenshot(path=f'{SHOTS}/{name}.png', full_page=full)
    def tab(k): page.click(f'.tab[data-k="{k}"]'); page.wait_for_timeout(250)
    def fld(v, label): return page.locator(f'#view-{v} .fld:has(> .fl:text-matches("^{label}"))').first
    def sel(v, label, opt): fld(v, label).locator('select').select_option(label=opt)
    def tog(v, label): fld(v, label).locator('.tog').click()
    def fetch(v, which=0):
        page.locator(f'#view-{v} .fetchbar .btn').nth(which).click(); page.wait_for_timeout(2500)
    def toast(): return page.locator('.toast').inner_text()

    # ------------------------------------------------------------ clean start
    st = page.evaluate("({server: AOC.S.server, premium: AOC.S.premium, sell: AOC.S.sellTaxes, buy: AOC.S.buyTaxes, book: Object.keys(AOC.book.buy).length, plan: Object.keys(window.Tools).length})")
    check('nothing restored from a previous session', st['server'] == '' and st['premium'] is False and st['book'] == 0, st)
    check('server dropdown starts empty', page.evaluate("document.getElementById('server').value") == '')
    check('planner starts with no recipes', page.locator('#view-planner .icard').count() == 0)
    check('location starts empty', page.evaluate("document.querySelector('#view-planner .fld select').value") == '')
    tab('refining'); check('refining starts with no resource chosen', 'Choose a resource' in page.locator('#view-refining .results').inner_text())
    tab('cooking'); check('cooking starts with no recipe', 'Search for a recipe' in page.locator('#view-cooking').inner_text())
    tab('flipper'); check('flipper chips start unselected', page.locator('#view-flipper .chip.on').count() == 0)
    page.locator('#view-flipper .fetchbar .btn.primary').click(); page.wait_for_timeout(300)
    check('flipper asks for a scan type first', 'scan type' in toast(), toast())

    page.select_option('#server', 'europe')

    # ------------------------------------------------------------ planner
    tab('planner')
    inp = page.locator('#view-planner .picker-in')
    inp.fill('adept mistpiercer'); page.wait_for_timeout(300)
    if page.locator('#view-planner .prow').count() == 0: inp.fill('master fire staff'); page.wait_for_timeout(300)
    page.locator('#view-planner .prow').first.click(); page.wait_for_timeout(300)
    check('planner quantity box is empty (placeholder 1)', page.locator('#view-planner .stepper input').first.input_value() == '')
    sel('planner', 'Location', 'Fort Sterling'); sel('planner', 'Buy materials from', 'Fort Sterling'); sel('planner', 'Sell crafted items to', 'Black Market'); sel('planner', 'Product quality', 'Normal')
    fetch('planner')
    check('planner fetched prices', 'Updated' in toast() or page.locator('#view-planner .mrow').count() > 0, toast())
    shot('planner')
    # narrow phone, portrait: names must not wrap letter by letter
    page.set_viewport_size({'width': 390, 'height': 800}); page.wait_for_timeout(300)
    m = page.evaluate("""() => { const e = document.querySelector('#view-planner .drow .iname'); const r = e.getBoundingClientRect(); return {w: r.width, hgt: r.height, fs: getComputedStyle(document.body).fontSize}; }""")
    check('planner item name stays readable on a 390px phone', m['w'] > 100 and m['hgt'] < 70, m)
    shot('m-planner', full=False)
    portrait_fs = m['fs']
    page.set_viewport_size({'width': 800, 'height': 390}); page.wait_for_timeout(300)
    m2 = page.evaluate("""() => { const e = document.querySelector('#view-planner .drow .iname'); const r = e.getBoundingClientRect(); return {w: r.width, hgt: r.height, fs: getComputedStyle(document.body).fontSize}; }""")
    check('planner name readable in landscape', m2['w'] > 100 and m2['hgt'] < 70, m2)
    page.set_viewport_size({'width': 1400, 'height': 1000}); page.wait_for_timeout(300)
    wide_fs = page.evaluate("getComputedStyle(document.body).fontSize")
    check('font size changes with screen size / orientation', len({portrait_fs, m2['fs'], wide_fs}) >= 2, [portrait_fs, m2['fs'], wide_fs])

    # ------------------------------------------------------------ refining: chain from a chosen tier
    tab('refining')
    page.locator('#view-refining .btn.primary').first.click(); page.wait_for_timeout(300)
    check('refining fetch asks for a resource / cities first', len(toast()) > 0, toast())
    sel('refining', 'Resource', 'Planks \\(wood\\)') if False else page.locator('#view-refining .fld:has(> .fl:text-matches("^Resource")) select').select_option(label='Planks (wood)')
    sel('refining', 'Location', 'Fort Sterling'); tog('refining', 'Production bonus')
    for lab in ('Sell product to', 'Buy raw from', 'Buy refined from', 'Buy hearts from'): sel('refining', lab, 'Fort Sterling')
    tog('refining', 'Craft previous tiers yourself')
    page.wait_for_timeout(200)
    check('chain asks for a start tier', 'start crafting from' in page.locator('#view-refining .results').inner_text().lower())
    page.locator('#view-refining .fld:has(> .fl:text-matches("^Start crafting")) select').select_option(label='T2')
    # hide enchanted rows to compare plain planks only
    fetch('refining'); page.wait_for_timeout(1500)
    rrr = 1 - 1 / (1 + 0.18 + 0.40)
    city = 'Fort Sterling'
    def raw_price(i): return sell_price(i, city) if has_row(i, city) else None
    exp = {}
    u2 = raw_price('T2_WOOD') and raw_price('T2_WOOD') * (1 - rrr)
    exp[2] = u2
    for t in (3, 4, 5):
        w, prev = raw_price(f'T{t}_WOOD'), exp[t - 1]
        cnt = {3: 2, 4: 2, 5: 3}[t]
        exp[t] = (w * cnt + prev) * (1 - rrr) if (w and prev) else None
    rows = page.locator('#view-refining .results .gr')
    got = {}
    for i in range(rows.count()):
        txt = rows.nth(i).inner_text()
        for t in (2, 3, 4, 5):
            if re.search(rf'Planks\s*T{t}\s*\n', txt) and 'Enchantment' not in txt and f'T{t}.' not in txt.split('\n')[0]:
                mm = re.search(r'([\d,]+)\s*silver\s*\n?incl|([\d,]+) silver', txt)
        # cost cell is the 5th cell
    page.locator('#view-refining .fld:has(> .fl:text-matches("^Hide enchantments")) .chip', has_text='All').click(); page.wait_for_timeout(300)
    for t in (2, 3, 4, 5):
        pass
    cells = page.evaluate("""() => [...document.querySelectorAll('#view-refining .results .gr')].map(r => ({name: r.querySelector('.iname')?.innerText, cost: r.children[4]?.innerText}))""")
    print('  refining rows (enchants hidden):', len(cells))
    # with all enchantments hidden every row is hidden – show only .0 by hiding .1-.4
    page.locator('#view-refining .fld:has(> .fl:text-matches("^Hide enchantments")) .chip', has_text='None').click()
    for e in ('.1', '.2', '.3', '.4'):
        page.locator('#view-refining .fld:has(> .fl:text-matches("^Hide enchantments")) .chip', has_text=re.compile('^' + re.escape(e) + '$')).click()
    page.wait_for_timeout(300)
    cells = page.evaluate("""() => [...document.querySelectorAll('#view-refining .results .gr')].map(r => ({name: r.querySelector('.iname')?.innerText.replace(/\\s+/g,' '), cost: r.children[4]?.innerText.replace(/\\s+/g,' ')}))""")
    byT = {}
    for c in cells:
        mm = re.search(r'T(\d)\s*$', c['name'] or '')
        if mm: byT[int(mm.group(1))] = c['cost']
    print('  costs shown:', byT)
    for t in (2, 3, 4, 5):
        if exp.get(t) is None: continue
        shown = digits(byT.get(t, '0').split('silver')[0])
        check(f'chain cost of T{t} planks (start T2) matches the hand calculation', abs(shown - exp[t]) <= 1.01, (shown, round(exp[t], 2)))
    page.locator('#view-refining .results .btn', has_text='Cost breakdown').first.click(); page.wait_for_timeout(300)
    nst = page.locator('#view-refining .brk .gr').count()
    check('cost breakdown lists every stage from T2 up', nst >= 2, nst)
    shot('refining-chain')
    # same item without the chain is more expensive/cheaper but different; turning chain off removes breakdown buttons
    tog('refining', 'Craft previous tiers yourself'); page.wait_for_timeout(300)
    check('breakdown button disappears when chain is off', page.locator('#view-refining .results .btn', has_text='Cost breakdown').count() == 0)

    # ------------------------------------------------------------ refining: stone block enchanted-rock recipes
    page.locator('#view-refining .fld:has(> .fl:text-matches("^Resource")) select').select_option(label='Stone blocks (rock)')
    page.locator('#view-refining .fld:has(> .fl:text-matches("^Hide tiers")) .chip', has_text='None').click()
    page.wait_for_timeout(300)
    labels = page.evaluate("""() => { const r = [...document.querySelectorAll('#view-refining .results .gr')].find(x => /T5\\s*$/.test(x.querySelector('.iname').innerText.trim())); return r ? [...r.querySelectorAll('.seg button')].map(b => b.innerText) : null; }""")
    check('stone block row offers the enchanted-rock recipes', labels and any('.1 rock' in l for l in labels) and any('.3 rock → 8' in l for l in labels), labels)
    shot('refining-stone')

    # ------------------------------------------------------------ cooking: fish sauce made by you
    tab('cooking')
    pk = page.locator('#view-cooking .picker-in'); pk.fill('pork pie'); page.wait_for_timeout(300); page.locator('#view-cooking .prow').first.click(); page.wait_for_timeout(300)
    sel('cooking', 'Location', 'Martlock'); sel('cooking', 'Sell food to', 'Martlock'); sel('cooking', 'Default buy city', 'Martlock')
    tog('cooking', 'Enchanted recipes')
    check('cooking quantity empty (shows single craft)', page.locator('#view-cooking .fld:has(> .fl:text-matches("^Quantity")) input').input_value() == '')
    fish_ct = page.locator('#view-cooking .card:has(> h3:text("Fish sauce crafting"))')
    fish_ct.locator('.fld:has(> .fl:text-matches("^Make fish sauce")) .tog').click(); page.wait_for_timeout(200)
    fish_ct.locator('.seg button', has_text='Chop fish myself').click(); page.wait_for_timeout(200)
    fish_ct.locator('select').first.select_option(label=re.sub(r'\s+', ' ', 'Fish') if False else None) if False else None
    opts = fish_ct.locator('select option').all_inner_texts()
    pick = next(o for o in opts if '(T4)' in o and '4 chops' in o)
    fish_ct.locator('select').first.select_option(label=pick); page.wait_for_timeout(200)
    fetch('cooking'); page.wait_for_timeout(1500)
    txt = fish_ct.inner_text()
    fish_id = None
    ids = page.evaluate("AO.extras.chops.map(x=>x[0])")
    fid = next(i for i in ids if i.startswith('T4_FISH_FRESHWATER_ALL') or i.startswith('T4_FISH_SALTWATER_ALL'))
    names = {i: page.evaluate(f"AOC.name('{i}')") for i in ids if i.startswith('T4_')}
    # find the chosen id from the select value
    fid = page.evaluate("document.querySelector('#view-cooking .card:nth-of-type(4) select, #view-cooking select option:checked')?.value") if False else fish_ct.locator('select').first.input_value()
    chops = 4
    cu = sell_price(fid, 'Martlock') / chops if has_row(fid, 'Martlock') else None
    weed = sell_price('T1_SEAWEED', 'Martlock') if has_row('T1_SEAWEED', 'Martlock') else None
    if cu is not None and weed is not None:
        want = 15 * cu + 1 * weed
        got = digits(fish_ct.locator('.orow').nth(0).inner_text().split('silver')[0].split('\n')[-1])
        check('self-made fish sauce L1 cost matches (15 chops + 1 seaweed)', abs(got - want) <= 1.01, (got, round(want, 2)))
    else:
        print('  (mock had no price for fish/seaweed, skipping numeric check)')
    ing = page.locator('#view-cooking .card:has(h3:text("Ingredients"))').inner_text()
    check('enchanted-sauce ingredients are marked as made by you', 'made by you' in ing)
    shot('cooking')

    # ------------------------------------------------------------ alchemy: arcane extract from broken artifacts
    tab('alchemy')
    pk = page.locator('#view-alchemy .picker-in'); pk.fill('poison'); page.wait_for_timeout(300); page.locator('#view-alchemy .prow').first.click(); page.wait_for_timeout(300)
    sel('alchemy', 'Location', 'Martlock'); sel('alchemy', 'Sell potion to', 'Martlock'); sel('alchemy', 'Default buy city', 'Martlock')
    tog('alchemy', 'Enchanted recipes')
    al = page.locator('#view-alchemy .card:has(> h3:text("Arcane extract crafting"))')
    al.locator('.fld:has(> .fl:text-matches("^Make arcane")) .tog').click(); page.wait_for_timeout(200)
    al.locator('.seg button', has_text='Break artifacts myself').click(); page.wait_for_timeout(200)
    al.locator('.fld:has(> .fl:text-matches("^Artifact$")) select').select_option(label='Any animal (cheapest)'); page.wait_for_timeout(200)
    fetch('alchemy'); page.wait_for_timeout(1500)
    remains = page.evaluate("AO.extras.remains")
    cprs = [(sell_price(i, 'Martlock') / per, i) for i, per in remains if has_row(i, 'Martlock')]
    best = min(cprs)
    nbest = al.locator('.srow.best').count()
    check('exactly one cheapest artifact is highlighted', nbest == 1, nbest)
    if nbest == 1:
        bn = al.locator('.srow.best .iname').inner_text()
        check('highlighted artifact is the cheapest per remains', page.evaluate(f"AOC.name('{best[1]}')") in bn, (bn, best[1]))
        l1 = digits(al.locator('.orow').nth(0).inner_text().split('silver')[0].split('\n')[-1])
        check('arcane extract L1 cost = 1 remains', abs(l1 - best[0]) <= 1.01, (l1, round(best[0], 2)))
        l3 = digits(al.locator('.orow').nth(2).inner_text().split('silver')[0].split('\n')[-1])
        check('arcane extract L3 cost = 9 remains', abs(l3 - 9 * best[0]) <= 1.5, (l3, round(9 * best[0], 2)))
    # step-down route: buy T7, break to T5, then T3, then remains
    animals = page.evaluate("[...new Set(AO.extras.remains.map(x => x[0].replace(/^T\\d_ALCHEMY_RARE_/, '')))]")
    an = next((x for x in animals if has_row(f'T7_ALCHEMY_RARE_{x}', 'Martlock')), None)
    if an:
        lbl = page.evaluate(f"AOC.name('T7_ALCHEMY_RARE_{an}').replace(/^\\S+\\s/, '')")
        al.locator('.fld:has(> .fl:text-matches("^Artifact$")) select').select_option(label=lbl); page.wait_for_timeout(200)
        al.locator('.fld:has(> .fl:text-matches("^Artifact tier")) .seg button', has_text='T7').click(); page.wait_for_timeout(200)
        fetch('alchemy'); page.wait_for_timeout(1500)
        p7 = sell_price(f'T7_ALCHEMY_RARE_{an}', 'Martlock')
        l1d = digits(al.locator('.orow').nth(0).inner_text().split('silver')[0].split('\n')[-1])
        check('T7 artifact broken straight: L1 extract = price/25', abs(l1d - p7 / 25) <= 1.01, (l1d, round(p7 / 25, 2)))
        al.locator('.fld:has(> .fl:text-matches("^Break it down")) .seg button', has_text='T3').click(); page.wait_for_timeout(200)
        l1s = digits(al.locator('.orow').nth(0).inner_text().split('silver')[0].split('\n')[-1])
        check('T7 stepped down to T3 (4 x T3 = 20 remains): L1 extract = price/20', abs(l1s - p7 / 20) <= 1.01, (l1s, round(p7 / 20, 2)))
        rt = al.locator('.brk, .sub:has(h4:text("Break-down routes"))').first.inner_text()
        check('route table spells out T7 -> 2 x T5 -> 4 x T3 -> 20 remains', '1 × T7 → 2 × T5 → 4 × T3 → 20 remains' in rt, rt[:200])
    shot('alchemy')

    # ------------------------------------------------------------ flipper
    tab('flipper')
    def chips_all(label): page.locator(f'#view-flipper .fld:has(> .fl:text-matches("^{label}")) .chip', has_text='All').click()
    for lab in ('Buy locations', 'Qualities', 'Tier', 'Enchantment', 'Categories'): chips_all(lab)
    tiers = page.locator('#view-flipper .fld:has(> .fl:text-matches("^Tier")) .chip').all_inner_texts()
    check('flipper offers tier 3', 'T3' in tiers, tiers)
    for lab in ('Direct', 'Upgrade', 'Craft'):
        page.locator('#view-flipper .tog', has_text=lab).first.click()
    sel('flipper', 'Upgrade materials from', 'Fort Sterling')
    check('craft settings appear when Craft is on', page.locator('#view-flipper .craftbox').is_visible())
    page.locator('#view-flipper .craftbox .fld:has(> .fl:text-matches("^Location")) select').select_option(label='Fort Sterling')
    page.locator('#view-flipper .fetchbar .btn.primary').click()
    page.wait_for_selector('#view-flipper .results .gr', timeout=240000); page.wait_for_timeout(600)
    stat = page.locator('#view-flipper .toolbar .seen').inner_text()
    print('  ', stat)
    nrows = page.locator('#view-flipper .results .gr').count()
    check('first tab shows 50 rows', nrows == 50, nrows)
    check('pager is shown under the list', page.locator('#view-flipper .pager .pg').count() >= 3)
    def profits(): return [digits(t.split('silver')[0]) for t in page.evaluate("[...document.querySelectorAll('#view-flipper .results .gr')].map(r => r.children[5].innerText)")]
    p1 = profits()
    check('default order is most → least profitable', all(p1[i] >= p1[i + 1] for i in range(len(p1) - 1)), p1[:6])
    first1 = page.locator('#view-flipper .results .gr .iname').first.inner_text()
    page.locator('#view-flipper .pager .pg', has_text=re.compile('^2$')).first.click(); page.wait_for_timeout(400)
    first2 = page.locator('#view-flipper .results .gr .iname').first.inner_text()
    p2 = profits()
    check('tab 2 continues the list', max(p2) <= min(p1) and page.locator('#view-flipper .results .gr').count() == 50, (max(p2), min(p1)))
    sel('flipper', 'Items per tab', '100'); page.wait_for_timeout(400)
    check('100 items per tab', page.locator('#view-flipper .results .gr').count() == 100)
    page.locator('#view-flipper .fld:has(> .fl:text-matches("^Order")) .seg button', has_text=re.compile('^Least')).click(); page.wait_for_timeout(400)
    p3 = profits()
    check('order can be flipped to least → most profitable', all(p3[i] <= p3[i + 1] for i in range(len(p3) - 1)), p3[:6])
    page.locator('#view-flipper .fld:has(> .fl:text-matches("^Order")) .seg button', has_text=re.compile('^Most')).click()
    sel('flipper', 'Flip type', 'Craft'); page.wait_for_timeout(500)
    ncraft = page.locator('#view-flipper .results .gr').count()
    check('craft flips are found and listed', ncraft > 0, ncraft)
    if ncraft:
        r0 = page.locator('#view-flipper .results .gr').first
        print('  craft row:', r0.inner_text().replace('\n', ' | ')[:240])
        check('craft row shows return rate and materials', 'RRR' in r0.inner_text() and r0.locator('.mat').count() > 0)
    sel('flipper', 'Flip type', 'All')
    shot('flipper', full=False)
    page.set_viewport_size({'width': 390, 'height': 800})
    for k in ('flipper', 'planner', 'refining', 'cooking', 'alchemy'):
        tab(k); shot('m-' + k, full=False)
    b.close()

print('JS ERRORS:', json.dumps(errors, indent=1) if errors else 'none')
print('FAILED:', fails if fails else 'none')
sys.exit(1 if fails or errors else 0)
