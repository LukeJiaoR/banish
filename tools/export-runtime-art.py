"""Deterministic PNG export. Usage: python tools/export-runtime-art.py SOURCE_ROOT OUTPUT_ROOT.
Keep high-resolution source PNGs outside the runtime checkout. Requires Pillow 12.3.0.
Workshop: 1056x704 covers 932px maximum at zoom 2.6 / Canvas DPR 2.
Portrait: 288x288 covers 64 CSS px at DPR 4 with sampling headroom.
"""
from pathlib import Path
import sys
import hashlib
from PIL import Image
SOURCE_SHA256 = {'assets/a-style/woodcutter-a-processing-v2.png': '998ba4e86af84e15d1227a6a16a3dfa8c2109eec34935f5d2d3b03faa33204c7', 'assets/a-style/woodcutter-a-idle.png': 'd2527af4159fef0bc373c7eb2bf49bb6908eae58c8afb9ea03e64cbddb6ec86d', 'assets/portraits/adult-man-01.png': 'c0ef309491dd5e79e3e42d303d5d7689330a5a577c808b5f7bdb3b82fe3977d3', 'assets/portraits/adult-man-02.png': '2ec528e5a7bcf1012c2c1ee60127dd2daec1bc4d36a50d7aa38afc2f96a4fb31', 'assets/portraits/adult-woman-01.png': '523d45a5c0887eab6a815b3a5969eac7b8ef5eca5908c2efe103cb59a44eac28', 'assets/portraits/adult-woman-02.png': '921612d9814c652a777b50f25bb6e73c5311f9fc26153c98c5cd5d66582b9b43', 'assets/portraits/child-boy-01.png': '61cfa7719ef7dfa32456c0fbdaf7a1dbb22f049805c62148b82f1e7f4b899f04', 'assets/portraits/child-girl-01.png': '7027a0dee5bdfed9c17f35e6cc459786f1c3aa7ad8f5c5a56442a6cc68035f0a', 'assets/portraits/elder-man-01.png': '5cc84ff460f718e75a81a7d2eb5b25b56beb1a2c16ae2d437a754e1ebf985aed', 'assets/portraits/elder-woman-01.png': '72aa16b800a473803a3413d6dc73d07e7e3b2f234cd80fe61e5a2888ee09b2e2'}
source, output = map(Path, sys.argv[1:])
workshop = ['woodcutter-a-idle', 'woodcutter-a-processing-v2']
portraits = ['adult-man-01', 'adult-man-02', 'adult-woman-01', 'adult-woman-02',
             'child-boy-01', 'child-girl-01', 'elder-man-01', 'elder-woman-01']
for folder, names, size in [('a-style', workshop, (1056, 704)), ('portraits', portraits, (288, 288))]:
    for name in names:
        rel = Path('assets') / folder / (name + '.png')
        src, dst = source / rel, output / rel
        if src.resolve() == dst.resolve():
            raise ValueError('Source assets must remain unchanged; choose a separate output root')
        if hashlib.sha256(src.read_bytes()).hexdigest() != SOURCE_SHA256[str(rel)]:
            raise ValueError('Unexpected source asset: ' + str(src))
        im = Image.open(src).convert('RGBA')
        if im.width * size[1] != im.height * size[0]:
            raise ValueError('Export would change aspect ratio')
        im = im.resize(size, Image.Resampling.LANCZOS)
        # Pillow RGBA resize uses premultiplied alpha. Remove only invisible RGB.
        pixels = list(im.getdata())
        im.putdata([(0, 0, 0, 0) if p[3] == 0 else p for p in pixels])
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, optimize=True)
