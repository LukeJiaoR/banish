"""Read-only archive identity/status regression; no runtime UI claim."""
from pathlib import Path
import hashlib,json
from PIL import Image
root=Path(__file__).resolve().parents[1]
m=json.loads((root/'docs/style-archive/manifest.json').read_text())
assert m['schemaVersion']==1 and len(m['entries'])==4
assert len({e['id'] for e in m['entries']})==4
for e in m['entries']:
 p=root/e['path']; assert p.is_file()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==e['sha256']
 assert p.stat().st_size==e['sizeBytes']
 assert list(Image.open(p).size)==e['dimensions']
 assert e['approvedScope'] and e['limitations'] and e['source']
 assert e['issue']=='https://github.com/LukeJiaoR/banish/issues/87'
byid={e['id']:e for e in m['entries']}
a=byid['banish-ui-a-visual-baseline']
assert a['decisionStatus']=='adopted' and a['path']=='docs/ui-reference/selected-a.png'
assert a['sha256']=='cad13e5d332baa8358faf837e8160ffd6aafb9dfdebc321d506f8c696702cb97'
for n in ['page1','page2']:
 assert byid['banish-ui-a-suite-v1-'+n]['decisionStatus']=='proposed'
assert byid['banish-ui-a-bitmap-surface-trial']['decisionStatus']=='reference'
p=json.loads((root/'docs/style-archive/proposed/ui-v1/generation-prompts.json').read_text())
assert all(p[n]['prompt'] and p[n]['references'] for n in ['page1','page2'])
assert p['status_note']
print('Four style records: identity, original A, proposed/reference separation and prompt provenance passed')
