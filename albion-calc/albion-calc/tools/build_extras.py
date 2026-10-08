#!/usr/bin/env python3
"""Writes web/data/extras.js: fish sauce, chopped fish, animal remains / arcane extract recipes (from tools/items.json)."""
import json, os, re
here = os.path.dirname(os.path.abspath(__file__))
raw = json.load(open(os.path.join(here, 'items.json'), encoding='utf8'))['items']
al = lambda x: [] if x is None else (x if isinstance(x, list) else [x])
idx = {}
for k, v in raw.items():
    if isinstance(v, list):
        for x in v: idx[x['@uniquename']] = x

def first(uid):
    return al(idx[uid]['craftingrequirements'])

sauce = {}
for n in (1, 2, 3):
    r = first(f'T1_FISHSAUCE_LEVEL{n}')[0]
    d = {x['@uniquename']: int(x['@count']) for x in al(r['craftresource'])}
    sauce[n] = {'id': f'T1_FISHSAUCE_LEVEL{n}@{n}' if False else f'T1_FISHSAUCE_LEVEL{n}', 'chops': d['T1_FISHCHOPS'], 'weed': d['T1_SEAWEED']}

chops = []        # [fishId, chops per fish]
for r in first('T1_FISHCHOPS'):
    x = al(r['craftresource'])[0]
    chops.append([x['@uniquename'], int(r['@amountcrafted'])])

remains = []      # [artifactId, remains per artifact]
for r in first('T1_ALCHEMY_COMMON'):
    x = al(r['craftresource'])[0]
    remains.append([x['@uniquename'], int(r['@amountcrafted'])])

extract = {}
for n in (1, 2, 3):
    r = first(f'T1_ALCHEMY_EXTRACT_LEVEL{n}')[0]
    extract[n] = {'id': f'T1_ALCHEMY_EXTRACT_LEVEL{n}', 'remains': int(al(r['craftresource'])[0]['@count'])}

out = {'sauce': sauce, 'chops': chops, 'remains': remains, 'extract': extract}
open(os.path.join(here, '..', 'web', 'data', 'extras.js'), 'w').write('window.AO=window.AO||{};AO.extras=' + json.dumps(out, separators=(',', ':')) + ';\n')
print(out['sauce'], out['extract'], len(chops), 'fish', len(remains), 'artifact recipes')
