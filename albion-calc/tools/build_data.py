#!/usr/bin/env python3
"""Builds web/data/*.js from the Albion Online data dump.

Inputs (same folder): items.txt, items.json, craftingmodifiers.json, world.txt
Usage:  python3 build_data.py
Re-run it after a game update with fresh dumps from github.com/ao-data/ao-bin-dumps
"""
import json, re, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'web', 'data')
os.makedirs(OUT, exist_ok=True)

# ---------- names / valid ids (items.txt = what AODP knows) ----------
names = {}
for line in open(os.path.join(HERE, 'items.txt'), encoding='utf8'):
    m = re.match(r'\s*\d+:\s*(\S+)\s*:\s*(.*)$', line.rstrip('\n'))
    if m:
        names[m.group(1)] = m.group(2).strip()
valid = set(names)

def aodp(i):
    """dump id -> id AODP uses (adds @n when items.txt lists it that way)."""
    if i in valid:
        return i
    m = re.search(r'_LEVEL(\d)$', i)
    if m and (i + '@' + m.group(1)) in valid:
        return i + '@' + m.group(1)
    return i

# ---------- items.json ----------
raw = json.load(open(os.path.join(HERE, 'items.json'), encoding='utf8'))['items']
items = {}
kind_of = {}
for k, v in raw.items():
    if isinstance(v, list):
        for it in v:
            items[it['@uniquename']] = it
            kind_of[it['@uniquename']] = k

def L(x):
    if x is None: return []
    return x if isinstance(x, list) else [x]

value_cache = {}
def value(i, depth=0):
    """item value used for station usage fee."""
    if i in value_cache: return value_cache[i]
    it = items.get(i)
    v = None
    if it is not None:
        if '@itemvalue' in it:
            v = float(it['@itemvalue'])
        elif depth < 6 and it.get('craftingrequirements') is not None:
            c = L(it['craftingrequirements'])[0]
            tot = 0.0
            ok = True
            for r in L(c.get('craftresource')):
                rv = value(r['@uniquename'], depth + 1)
                if rv is None: ok = False; break
                tot += rv * float(r['@count'])
            if ok: v = tot
    value_cache[i] = v
    return v

# enchanted variants: base id for LEVELn resources have their own @itemvalue in dump
def rec_from(cr, out_id, it, enchant, alt, kind):
    r = []
    for x in L(cr.get('craftresource')):
        rid = x['@uniquename']
        nr = 1 if x.get('@maxreturnamount') == '0' else 0
        r.append([aodp(rid), int(float(x['@count'])), nr])
    if not r:
        return None
    # value of whole craft (fee base)
    own = items.get(out_id.split('@')[0]) if '@' not in out_id else None
    rv = 0.0; missing = False
    for x in L(cr.get('craftresource')):
        v = value(x['@uniquename'])
        if v is None: missing = True; continue
        rv += v * float(x['@count'])
    amount = int(float(cr.get('@amountcrafted', 1)))
    # refined resources: value is the item's own value times amount
    base_id = re.sub(r'@\d$', '', out_id)
    if base_id in items and '@itemvalue' in items[base_id] and kind == 'refine':
        rv = float(items[base_id]['@itemvalue']) * amount
    return {
        'id': out_id, 'a': alt, 'n': amount,
        'f': int(float(cr.get('@craftingfocus', 0))),
        'si': int(float(cr.get('@silver', 0))),
        'r': r, 'v': round(rv, 2),
    }

recipes = []
upgrades = {}      # aodp id -> [resId, count] cost to reach this enchant from previous
meta = {}          # per output id: tier, enchant, craftingcategory, group, sub, weight

def classify(it, kname):
    cc = it.get('@craftingcategory')
    sc = it.get('@shopcategory')
    s1 = it.get('@shopsubcategory1')
    if kname == 'simpleitem' and s1 == 'refinedresources' and cc in ('wood', 'ore', 'hide', 'fiber', 'rock'):
        return 'refine'
    if kname == 'consumableitem' and cc == 'food':
        return 'food'
    if kname == 'consumableitem' and cc == 'potion':
        return 'potion'
    if kname in ('equipmentitem', 'weapon', 'transformationweapon', 'mount') and sc in (
            'weapons', 'armors', 'head', 'shoes', 'offhands', 'capes', 'bags', 'gathering', 'mounts'):
        return 'craft'
    return None

for uid, it in items.items():
    kname = kind_of[uid]
    kd = classify(it, kname)
    if not kd: continue
    tier = int(it.get('@tier', 0) or 0)
    if tier < 2: continue
    if not re.match(r'^T\d_', uid): continue          # skip UNIQUE_ / vanity / event items
    if kd == 'craft' and tier < 3: continue
    entries = [(0, it)]
    ench = it.get('enchantments')
    if isinstance(ench, dict):
        for e in L(ench.get('enchantment')):
            entries.append((int(e['@enchantmentlevel']), e))
    for lvl, node in entries:
        crs = node.get('craftingrequirements')
        eff_lvl = lvl
        if lvl == 0:
            out_id = aodp(uid)
            mm = re.search(r'_LEVEL(\d)$', uid)
            if mm: eff_lvl = int(mm.group(1))
        else:
            # refined/consumable enchant ids look like T5_PLANKS_LEVEL1@1 or T4_POTION_X@1
            out_id = (uid + f'_LEVEL{lvl}@{lvl}') if kd == 'refine' else (uid + f'@{lvl}')
            if out_id not in valid:
                alt_id = uid + f'@{lvl}'
                out_id = alt_id if alt_id in valid else out_id
        if crs is None:
            continue
        for ai, cr in enumerate(L(crs)):
            rc = rec_from(cr, out_id, it, eff_lvl, ai, kd)
            if rc is None: continue
            rc.update({'t': tier, 'e': eff_lvl, 'k': kd,
                       'cc': it.get('@craftingcategory', ''),
                       'g': it.get('@shopcategory', ''),
                       's': it.get('@shopsubcategory1', ''),
                       'w': float(it.get('@weight', 0) or 0)})
            recipes.append(rc)
        if lvl > 0 and node.get('upgraderequirements'):
            ur = L(node['upgraderequirements'].get('upgraderesource'))
            if ur:
                upgrades[out_id] = [aodp(ur[0]['@uniquename']), int(float(ur[0]['@count']))]

# ---------- ids actually referenced ----------
used = set()
for r in recipes:
    used.add(r['id'])
    for x in r['r']: used.add(x[0])
for u in upgrades.values(): used.add(u[0])

# values & weights for referenced ids (keyed by aodp id)
vals, wts = {}, {}
for i in used:
    base = re.sub(r'@\d$', '', i)
    cand = [base] + ([re.sub(r'_LEVEL\d$', '', base)] if re.search(r'_LEVEL\d$', base) else [])
    for c in cand:
        if c in items:
            v = value(c)
            if v is not None: vals[i] = v
            w = items[c].get('@weight')
            if w is not None: wts[i] = float(w)
            break

# ---------- flipper item list (T4-T8 sellable gear/mounts/consumables) ----------
FLIPCAT = {'weapons': 'w', 'armors': 'a', 'head': 'a', 'shoes': 'a', 'offhands': 'o',
           'capes': 'x', 'bags': 'x', 'mounts': 'm', 'consumables': 'f'}
flip = []
for uid, it in items.items():
    kname = kind_of[uid]
    if kname not in ('equipmentitem', 'weapon', 'transformationweapon', 'mount', 'consumableitem'):
        continue
    sc = it.get('@shopcategory')
    if sc not in FLIPCAT: continue
    tier = int(it.get('@tier', 0) or 0)
    if tier < 4 or tier > 8: continue
    if uid not in valid: continue
    cat = FLIPCAT[sc]
    lv = [(0, uid)]
    ench = it.get('enchantments')
    if isinstance(ench, dict):
        for e in L(ench.get('enchantment')):
            n = int(e['@enchantmentlevel'])
            i2 = uid + f'@{n}'
            if i2 in valid: lv.append((n, i2))
    for n, i2 in lv:
        flip.append([i2, tier, n, cat])
flip_ids_set = {f[0] for f in flip}
for f in flip:
    used.add(f[0])
for f in flip:
    if f[0] in upgrades:
        pass

# ---------- locations (craftingmodifiers.json) ----------
cm = json.load(open(os.path.join(HERE, 'craftingmodifiers.json'), encoding='utf8'))['craftingmodifiers']
cid_name = {}
for line in open(os.path.join(HERE, 'world.txt'), encoding='utf8'):
    m = re.match(r'\s*(\S+)\s*:\s*(.+)', line.rstrip('\n'))
    if m: cid_name[m.group(1).strip()] = m.group(2).strip()
CITIES = {'Thetford','Lymhurst','Bridgewatch','Martlock','Fort Sterling','Caerleon','Brecilien',"Arthur's Rest","Merlyn's Rest","Morgana's Rest"}
locs = {}
for loc in L(cm.get('craftinglocation')):
    cid = loc.get('@clusterid')
    nm = cid_name.get(cid)
    if nm not in CITIES: continue
    mods = {}
    for m in L(loc.get('craftingmodifier')):
        mods[m['@name']] = float(m['@value'])
    rb = float(loc.get('refiningbonus', {}).get('@value', 0))
    cb = float(loc.get('craftingbonus', {}).get('@value', 0))
    locs[nm] = {'rb': rb, 'cb': cb, 'm': mods}
print('locations:', {k: (v['rb'], v['cb'], len(v['m'])) for k, v in locs.items()})

# ---------- names needed ----------
need_names = set(used) | flip_ids_set
for r in recipes: need_names.add(r['id'])
nm_out = {i: names[i] for i in need_names if i in names}
# base-name fallback for enchanted ids
for i in need_names:
    if i not in nm_out:
        b = re.sub(r'@\d$', '', i)
        if b in names: nm_out[i] = names[b]

def dump(fn, var, data):
    p = os.path.join(OUT, fn)
    with open(p, 'w', encoding='utf8') as f:
        f.write('window.AO=window.AO||{};AO.%s=' % var)
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
        f.write(';\n')
    print(fn, os.path.getsize(p) // 1024, 'KB')

dump('names.js', 'names', nm_out)
dump('recipes.js', 'recipes', recipes)
dump('meta.js', 'meta', {'val': vals, 'wt': wts, 'up': upgrades, 'loc': locs})
dump('flip.js', 'flip', flip)

cnt = collections.Counter(r['k'] for r in recipes)
print('recipes by kind:', dict(cnt), 'total', len(recipes))
print('flip items:', len(flip), 'upgrades:', len(upgrades))
miss = [r['id'] for r in recipes if r['v'] == 0][:10]
print('recipes with zero value (sample):', miss)
