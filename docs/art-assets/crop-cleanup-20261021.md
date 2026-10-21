# Existing atlas crop cleanup, 2026-10-21

Baseline: `d2df5900d85bc2d8bd646de6a7aaad7c4305c433`.

Inspected all 159 shipped PNGs: 29 buildings, 44 icons, 35 props, 23 citizens, 21 tiles, 5 continuous terrain textures and 2 bridges. This was an offline pixel/contact-sheet inspection plus source/renderer review, not a live browser or production deployment test. New UI artwork is outside this change.

## Confirmed neighboring sprites

- `buildings/school.png`: above the school, the crop includes the storage barn's barrels/foundation and the gatherer hut's lower corner. Source: `art/sheet-1-main.png`, window (404,530)-(712,840).
- `buildings/boarding.png`: lower-right pine fragment and tiny lower-center fragment belong to separate trees below the boarding house. Source: `art/sheet-2-missing.png`, window (662,0)-(1458,724).
- `buildings/mine.png`: lower-left fragments belong to the separate mature tree to its left. Source: `art/sheet-2-missing.png`, window (1450,0)-(2171,600).
- `icons/tool_boarding.png` and `icons/tool_mine.png` inherited those same tree fragments. `tool_school.png` is a separate book image and is unaffected.

## Bounded correction

Retain the original canvas, all RGB bytes, and the largest alpha>12 subject component plus its one-pixel 8-neighbor antialias guard. Only zero alpha outside that guard inside the explicitly reviewed neighbor rectangles in `crop-cleanup-20261021.json`. Do not crop, resize, redraw, recolor or move the subject. The manifest records baseline file hashes, atlas hashes, source windows, unchanged RGB/subject hashes, rectangles and exact changed-alpha counts (6989, 10719, 2372, 184, 53 respectively).

The main component is used to protect the subject, not to indiscriminately delete all other components. The limited rectangles protect unrelated intentional details elsewhere. Existing building scale, smoke/effect anchors and bottom-center footpoints are unchanged. Protect all five reviewed files in `PRESERVED_EDITS` so a future whole-atlas export cannot replace the reviewed pixels.

## Validation and remaining scope

- `python3 tests/sprite-crop-cleanup.py`: original RGB and subject RGBA hashes, exact dimensions, atlas provenance, cleared neighbor regions.
- `python3 tests/sprite-slicing.py`: component-selection and protected-export regressions.
- `node tests/art_assets.js`: 159 loaded paths, sprite fallback, actual production drawBuilding/drawImage rectangles and uniform scale.
- `python3 tests/art_assets.py`: existing alpha, size and resource checks.

No additional high-confidence neighboring-sprite contamination was identified in the other 154 PNGs at contact-sheet review scale. Edge contact alone is not treated as a bug: bridge endpoints are intended to connect, and grave padding aligns its footpoint. Reviewed nine toolbar SVG crop rectangles against actual PNG dimensions; no size mismatch was found. Full-resolution rendered-world/animation review remains separate; this inspection does not claim every texture seam, scaling artifact or animation frame transition is certified.
