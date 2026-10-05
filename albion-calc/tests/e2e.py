"""End-to-end smoke test: loads the web app in headless Chromium with a mocked AODP API."""
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

def prices(route, req):
    u = urllib.parse.urlparse(req.url)
    ids = urllib.parse.unquote(u.path.split('/prices/')[1].replace('.json', '')).split(',')
    q = urllib.parse.parse_qs(u.query)
    locs = q.get('locations', [''])[0].split(','); quals = [int(x) for x in q.get('qualities', ['1'])[0].split(',')]
    rows = []
    for i in ids:
        for c in locs:
            for ql in quals:
                if h(i + c + str(ql) + 'x') < 0.1: continue
                bp = base_price(i)
                if c == 'Black Market':
                    sell, buy = 0, int(bp * (1.05 + 0.5 * h(i + 'bm')))
                else:
                    sell = int(bp * (0.8 + 0.5 * h(i + c))); buy = int(sell * 0.8)
                rows.append({'item_id': i, 'city': c, 'quality': ql, 'sell_price_min': sell, 'sell_price_min_date': '2026-10-05T06:00:00',
                             'sell_price_max': sell, 'sell_price_max_date': '2026-10-05T06:00:00',
                             'buy_price_min': buy, 'buy_price_min_date': '2026-10-05T06:00:00', 'buy_price_max': buy, 'buy_price_max_date': '2026-10-05T06:00:00'})
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

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 1000})
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

    # ---- planner
    inp = page.locator('#view-planner .picker-in')
    inp.fill('master fire staff'); page.wait_for_timeout(300)
    print('planner results:', page.locator('#view-planner .prow').count())
    page.locator('#view-planner .prow').first.click(); page.wait_for_timeout(200)
    inp.fill('pork pie'); page.wait_for_timeout(300); page.locator('#view-planner .prow').first.click(); page.wait_for_timeout(200)
    page.click('#view-planner .fetchbar .btn.primary'); page.wait_for_timeout(2500)
    shot('planner')
    print('planner items:', page.locator('#view-planner .icard').count(), 'mat rows:', page.locator('#view-planner .mrow').count())
    print('planner totals:', page.locator("#view-planner .totals").inner_text().replace('\n', ' | '))

    # ---- refining
    tab('refining'); page.click('#view-refining .fetchbar .btn.primary'); page.wait_for_timeout(3500); shot('refining')
    print('refining rows:', page.locator('#view-refining .gr').count())
    # ---- cooking
    tab('cooking'); page.click('#view-cooking .fetchbar .btn.primary'); page.wait_for_timeout(3500); shot('cooking')
    print('cooking rows:', page.locator('#view-cooking .results .gr').count())
    # ---- alchemy
    tab('alchemy'); page.click('#view-alchemy .fetchbar .btn.primary'); page.wait_for_timeout(3500); shot('alchemy')
    print('alchemy rows:', page.locator('#view-alchemy .results .gr').count())
    # ---- flipper
    tab('flipper'); page.click('#view-flipper .fetchbar .btn.primary'); page.wait_for_selector('#view-flipper .results .gr', timeout=120000); page.wait_for_timeout(500); shot('flipper')
    print('flipper rows:', page.locator('#view-flipper .results .gr').count(), '|', page.locator('#view-flipper .toolbar .seen').inner_text())
    # ---- mobile
    page.set_viewport_size({'width': 390, 'height': 800})
    for k in ('flipper', 'planner', 'refining'):
        tab(k); shot('m-' + k, full=False)
    b.close()
print('ERRORS:', json.dumps(errors, indent=1) if errors else 'none')
