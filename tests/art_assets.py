"""python3 tests/art_assets.py (Pillow): new sprite alpha and sizing checks."""
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
files = ['buildings/blacksmith', 'buildings/hunting', 'icons/res_iron', 'icons/res_tools',
         'citizens/carry_iron', 'citizens/carry_tools']
files += ['icons/tool_' + x for x in ['blacksmith', 'hunting', 'stonehouse', 'boarding', 'mine']]
for file in files:
    im = Image.open(ROOT / 'assets' / (file + '.png'))
    assert im.mode == 'RGBA', file
    a = im.getchannel('A')
    assert a.getextrema()[0] == 0 and a.getextrema()[1] >= 240, file
    assert a.getbbox(), file
    # Bounding-box crop can touch edges, but must not have an opaque rectangular backdrop.
    corners = [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]
    assert all(a.getpixel(p) <= 12 for p in corners), file
    assert max(im.size) <= (512 if file.startswith('buildings/') else 96), file
    print(file, im.size, 'RGBA, transparent corners: OK')
