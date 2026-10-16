"""python3 tests/well-art.py: compact well silhouette and stable render interface."""
from pathlib import Path
from PIL import Image

image = Image.open(Path(__file__).resolve().parents[1] / 'assets/buildings/well.png')
assert image.mode == 'RGBA' and image.size == (320, 256)
alpha = image.getchannel('A')
assert alpha.getextrema() == (0, 255)
assert all(alpha.getpixel(point) == 0 for point in [(0, 0), (319, 0), (0, 255), (319, 255)])
# Ignore near-transparent antialiasing when measuring the actual structure.
left, top, right, bottom = alpha.point(lambda value: 255 if value > 32 else 0).getbbox()
assert 170 <= right - left <= 190, 'Do not regress to the oversized 245px-wide basin'
assert 185 <= bottom - top <= 205, 'Keep the upright, compact well silhouette'
assert abs((left + right) / 2 - 160) <= 2, 'Keep the bottom-center sprite anchor'
assert 252 <= bottom <= 254, 'Retain the two-pixel lower margin used by render.js'
# At the unchanged 160px draw width, the visible well is about 90px wide.
assert (right - left) * 0.5 <= 95
print('Well art: RGBA, compact silhouette, 320x256 canvas and ground anchor passed')
