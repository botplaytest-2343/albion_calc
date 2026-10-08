#!/usr/bin/env python3
"""Writes web/data/journals.js (journal capacity + which crafted items fill which journal) from tools/items.json."""
import json, re, os
here = os.path.dirname(os.path.abspath(__file__))
raw = json.load(open(os.path.join(here, 'items.json'), encoding='utf8'))['items']
al = lambda x: [] if x is None else (x if isinstance(x, list) else [x])
mx, of = {}, {}
for j in raw.get('journalitem', []):
    m = re.match(r'^T(\d)_JOURNAL_(WARRIOR|HUNTER|MAGE|TOOLMAKER)$', j['@uniquename'])
    if not m: continue
    mx.setdefault(m.group(2), {})[int(m.group(1))] = int(float(j.get('@maxfame', 0)))
    for cf in al((j.get('famefillingmissions') or {}).get('craftitemfame')):
        for vi in al(cf.get('validitem')):
            of[vi['@id']] = [m.group(2), int(float(cf['@value']))]
out = os.path.join(here, '..', 'web', 'data', 'journals.js')
open(out, 'w').write('window.AO=window.AO||{};AO.journals=' + json.dumps({'max': mx, 'of': of}, separators=(',', ':')) + ';\n')
print(len(of), 'items map to journals;', {k: v for k, v in mx.items()})
