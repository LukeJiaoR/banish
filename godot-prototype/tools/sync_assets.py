#!/usr/bin/env python3
"""Copy the explicitly selected original art without altering source pixels."""
from pathlib import Path
import hashlib, json, shutil
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'assets'
FILES = [f'a-style/{s}.png' for s in ['house-a-v2-square-empty', 'storage-a-v2', 'tree-a-v1-broadleaf', 'tree-a-v1-willow', 'woodcutter-a-idle', 'tree-a-v2-broadleaf-young', 'bank-sedge-a-v1']]
FILES += ['props/orchard_leafy.png', 'citizens/adult_idle.png']
FILES += ['terrain-v2/meadow_summer.png', 'terrain-v2/water_open.png']
FILES += [f'props/{s}_{p}.png' for s in ['deer', 'sheep', 'cattle', 'chicken'] for p in ['idle', 'graze', 'turn', 'walk_0', 'walk_1', 'walk_2', 'walk_3']]
manifest = {'source_commit': 'ab0902720f1c6f76f7a37ffb016e61242317c206', 'note': 'Byte-identical copies of project-owned art. No new generation, no source overwrite.', 'files': []}
for relative in FILES:
    source, target = SOURCE / relative, ROOT / 'assets' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    manifest['files'].append({'path': relative, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes': target.stat().st_size})
(ROOT / 'assets' / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Copied {len(FILES)} original PNGs, {sum(f["bytes"] for f in manifest["files"]):,} bytes')
