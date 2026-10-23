#!/usr/bin/env python3
"""Package only this independent project, not the original game or user data."""
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build/banish-godot-prototype-source.zip'
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(ROOT.rglob('*')):
        relative = path.relative_to(ROOT)
        if not path.is_file() or any(p in {'.godot', 'build', '__pycache__'} for p in relative.parts):
            continue
        if path.resolve() == out.resolve():
            continue
        archive.write(path, Path('godot-prototype') / relative)
print(f'{out}: {out.stat().st_size:,} bytes')
