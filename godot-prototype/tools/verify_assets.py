#!/usr/bin/env python3
"""Dependency-free provenance check; works in the standalone project ZIP too."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'assets/manifest.json').read_text())
assert len(manifest['files']) == 39
compared = 0
for row in manifest['files']:
    data = (ROOT / 'assets' / row['path']).read_bytes()
    assert len(data) == row['bytes'], row['path']
    assert hashlib.sha256(data).hexdigest() == row['sha256'], row['path']
    original = ROOT.parent / 'assets' / row['path']
    if original.exists():
        assert original.read_bytes() == data, row['path']
        compared += 1
    if any(row['path'].startswith('props/' + species + '_') for species in ['deer', 'sheep', 'cattle', 'chicken']):
        assert int.from_bytes(data[16:20], 'big') == 128
        assert int.from_bytes(data[20:24], 'big') == 128
assert 'res://assets/' in (ROOT / 'scripts/animal.gd').read_text()
print(json.dumps({'manifest_assets': len(manifest['files']), 'byte_identical_originals': compared,
                  'source_commit': manifest['source_commit'], 'status': 'pass'}))
