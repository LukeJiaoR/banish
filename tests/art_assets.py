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

health_sizes = {'buildings/herbalist': (320, 256), 'buildings/hospital': (448, 320),
                'icons/res_herbs': (128, 128), 'icons/tool_herbalist': (128, 128), 'icons/tool_hospital': (128, 128)}
for file, size in health_sizes.items():
    im = Image.open(ROOT / 'assets' / (file + '.png'))
    assert im.mode == 'RGBA' and im.size == size, file
    a = im.getchannel('A')
    assert a.getextrema() == (0, 255), file
    assert all(a.getpixel(p) == 0 for p in [(0, 0), (im.width-1, 0), (0, im.height-1), (im.width-1, im.height-1)]), file
    if file.startswith('buildings/'):
        foot = [x for x in range(im.width) if a.getpixel((x, im.height-1)) > 32]
        assert foot and abs((min(foot)+max(foot))/2 - im.width/2) <= 2, file
    print(file, size, 'health sprite alpha, size and anchor: OK')
