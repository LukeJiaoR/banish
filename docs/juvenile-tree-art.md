# A-style juvenile tree families

Baseline: main `1b60fd180edfcb7d26923c9a8c0554fbce1c5af0`.

Eight original transparent painted sprites complete broadleaf / willow × sapling / young × summer / winter. They are independently drawn juvenile structures, not reduced copies of mature trees. Summer seedlings have sparse leaves on light stems; young trees have slender branching crowns. Winter uses leafless twigs with narrow snow ridges. Rejected winter outputs with translucent leaf-shaped sheets were replaced before acceptance.

## Rendering contract

- The existing coordinate-seeded species choice persists through every age and season; no RNG calls or save fields are added.
- Every source is 1254×1254 RGBA; runtime exports are 384×384 PNGs retaining alpha and aspect ratio. Eight runtime files together are about 0.81 MiB; decoded RGBA adds 4.5 MiB.
- Each image has an individually inspected root-tip anchor and tip-to-foot height in `docs/art-assets/juvenile-trees.json`. Source coordinates scale by 384/1254 in `G.A_ART`. The anchor always maps to `T2S(x,y)+(0,16)` on the existing 64×32 dimetric ground grid.
- Juvenile display heights are 22 and 46 game pixels; mature art remains 88/92. This presentation-only change avoids the abrupt 26-to-88 jump of the first calibration pass. It does not change age thresholds, yields, collision, navigation, or selection.
- Seasonal images share the same display height and world root contact; their individual artwork extents need separate calibration. Winter fine twig outlines are deliberately visible rather than tinted summer foliage.
- Missing or malformed A art still falls back to the existing stage/season sprite, then the existing procedural tree.

## Reproduce and verify

Originals remain in the accompanying original-art package. The manifest records prompts and source/runtime SHA-256 values. With `@napi-rs/canvas`, run:

    node tools/export-juvenile-trees.cjs ORIGINALS_DIR OUTPUT_DIR
    node tests/juvenile-tree-art.js
    node tests/a-style-art.js
    node tests/art-combination.js
    node tools/render-juvenile-trees.cjs OUTPUT_DIR

The comparison renderer uses production `G.drawTree`, real age thresholds and both 1×/2× scales. It is offline Canvas evidence, not a browser, mobile-device, or full daily-cycle acceptance claim. No production deployment is included.
