"""Verify bounded atlas-neighbor removal, preserving original subject pixels/anchors."""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image
from scipy import ndimage

root = Path(__file__).resolve().parents[1]
records = json.loads((root / 'docs/art-assets/crop-cleanup-20261021.json').read_text())
assert len(records) == 5
for record in records:
    assert hashlib.sha256((root / record['sourceAtlas']).read_bytes()).hexdigest() == record['sourceAtlasSha256'], 'Atlas provenance changed: re-review the crop'
    im = Image.open(root / record['file'])
    assert im.mode == 'RGBA' and list(im.size) == record['size'], record['file']
    a = np.array(im)
    assert hashlib.sha256(a[:, :, :3].tobytes()).hexdigest() == record['rgbSha256'], 'Original RGB must remain byte-exact, including hidden pixels'
    labels, _ = ndimage.label(a[:, :, 3] > 12)
    counts = np.bincount(labels.ravel()); counts[0] = 0
    body = labels == counts.argmax()
    guard = ndimage.binary_dilation(body, structure=np.ones((3, 3)))
    assert hashlib.sha256(a[guard].tobytes()).hexdigest() == record['guardRgbaSha256'], 'Original subject and one-pixel antialias guard must remain byte-exact'
    zone = np.zeros(body.shape, dtype=bool)
    for x0, y0, x1, y1 in record['clearRegions']:
        zone[y0:y1, x0:x1] = True
    assert not a[:, :, 3][zone & ~guard].any(), 'Neighbor fragments must be transparent'
    print(record['file'], 'canvas, original RGB, original subject RGBA and clean neighbor zones passed')
