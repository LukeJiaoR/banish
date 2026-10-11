"""Focused slicer regression. Synthetic pixels only; never re-slice project assets."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('slicer', root / 'tools/slice_assets.py')
slicer = importlib.util.module_from_spec(spec); spec.loader.exec_module(slicer)
a = np.zeros((24, 24, 4), dtype=np.uint8)
# C-shaped main object: its bbox also contains an unrelated detached object.
a[3:20, 3:6] = [98, 65, 42, 255]
a[3:6, 3:20] = a[17:20, 3:20] = [98, 65, 42, 255]
a[3:20, 2] = [98, 65, 42, 8]  # preserve this low-alpha body fringe
b = slicer.cut_component(a, (0, 0, 24, 24))
a[9:12, 11:15] = [40, 80, 180, 255]
a[13:15, 14:17] = [90, 90, 90, 100]
c = slicer.cut_component(a, (0, 0, 24, 24))
assert b.shape == c.shape == (19, 19, 4)
assert np.array_equal(b[..., 3], c[..., 3]), 'unselected objects must not leak into bbox'
keep = b[..., 3] > 0
assert np.array_equal(b[keep], c[keep]), 'selected body and antialias RGB/alpha stay exact'
assert slicer.cut_component(np.zeros_like(a), (0, 0, 24, 24)) is None
assert slicer.cut_component(a, (0, 0, 24, 24), min_px=1000) is None
with TemporaryDirectory() as tmp:
    slicer.OUT = tmp
    for name in slicer.PRESERVED_EDITS:
        p = Path(tmp, name); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b'reviewed-fixture')
        assert slicer.save(a, name) is False and p.read_bytes() == b'reviewed-fixture'
        p.unlink()
        try: slicer.save(a, name)
        except FileNotFoundError: pass
        else: raise AssertionError('missing reviewed art must fail, not restore contaminated source')
    assert slicer.save(c, 'test.png')
    assert np.array_equal(np.array(Image.open(Path(tmp, 'test.png'))), c)
print('Sprite slicing: selected component, antialias fringe, blank/tiny input, protected edits passed')

for name, size, blank_regions in [
    ('storage', (298, 254), [(276, 222, 298, 254)]),
    ('site_3x3', (433, 255), [(0, 0, 75, 26), (278, 0, 380, 26)])]:
    im = Image.open(root / 'assets/buildings' / (name + '.png'))
    assert im.mode == 'RGBA' and im.size == size
    alpha = np.array(im)[..., 3]
    assert alpha.min() == 0 and alpha.max() >= 240
    for x0, y0, x1, y1 in blank_regions:
        assert alpha[y0:y1, x0:x1].max() <= 1, name + ': removed area must be visually transparent (at most 1/255 antialias)'
    x0, y0, x1, y1 = im.getchannel('A').getbbox()
    assert x0 <= 3 and y0 <= 3 and x1 >= size[0]-3 and y1 >= size[1]-3
    print(name, size, 'original canvas/foot anchor envelope, RGBA and removed-fragment regions passed')
