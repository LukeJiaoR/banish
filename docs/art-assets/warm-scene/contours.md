# #87 scene contours candidate (2026-10-21)

## Scope and art direction

Based on merged main `5710d96` (#119 UI included). This is a scene-rendering candidate, not a completed scene-wide art replacement. The selected A reference was inspected as actual pixels: its river edge is organic, buildings retain crisp layered painted materials, and land/water meet in a narrow natural transition. We preserve the original house/storage/tree/person PNGs and their sizes rather than repainting those good assets to imitate A. The historical warm-scene brief and all original generation provenance remain applicable.

The first local experiment only narrowed sand and dephased mountain textures. Actual pixel inspection rejected that as too small an improvement. This revision changes the visible coastline and shared mountain relief, without changing the map, building/road rules, resource yields, pathfinding, saved terrain, camera, or #119 DOM/CSS/interaction work.

## Coast

- Boundary tracing and one bounded smoothing pass are adapted from the repository's existing `tools/riverbay-lab/terrain.js`. None of the lab's generated low-frequency material, new water candidate, clutter, profiler, UI or optional effect toggles are imported. No third-party art, generation service or paid model was used.
- Shared water and land clips use identical curves. Raw corner coordinates move by at most 0.25 tile per axis in the smoothing pass; subsequent quadratic joins round their corners. All logical tile centers remain on the same side, including diagonal contacts, a single-cell pond and a one-cell channel. This does not assert that every sub-tile point is on the original side: the small curved visual margin differs from square ownership. Placement previews still show the authoritative whole tile.
- The original meadow and blue open-water PNGs retain world-anchored sampling. Original seasonal sand brush/stone detail is painted within the narrow bank band, with restrained wet/shallow accents. Roads and rocks are excluded from this overlay. Buildings paint afterward; occupancy is deliberately not a ground-cache dependency, so placing/removing a building cannot leave an old footprint cutout. The curves do not create new legal building land or remove water collisions.
- Winter retains the original tile ice and its existing shoreline. Its alpha-cut image is not substituted into an opaque continuous-water fill. Rebuilding for summer/winter transitions does not retain the other season's coast. A dedicated continuous winter ice asset remains future work.
- Missing/unready material or unavailable Canvas patterns retain original rendering. The topology is cached per world object; runtime water topology is immutable after map creation/load. Replacing a loaded image invalidates its context-local material pattern.
- One existing ground canvas is used. Warm frames do not draw a second overlay. With active contours, dirty repairs clear and redraw separate bounded integer screen-pixel rectangles, merging only intersecting repairs, then reapply contours; this avoids repeated translucent edge buildup and prevents far-apart edits from creating a map-wide repair rectangle. Winter, missing textures and all-land/all-water maps retain the old five-tile repair fast path. No claim is made about physical-device GPU performance.

## Mountain

- Original summer/winter material PNG bytes remain unchanged. A continuous, slowly varying world-space UV field removes the exact four-cell phase recurrence without per-tile random stamps, flips, blurring or bitmap recoloring. Shared triangle vertices use identical UV coordinates.
- The shared height envelope has a stronger deterministic, nonuniform ridge modulation. It retains the exact 3px outer rim, the existing maximum 88px rise and the binary collision footprint. Draw and pointer hit testing still consume the same raised polygons in both seasons. No height is saved or consumed by simulation.
- The rectangular 9×6 authored ridge is deliberately retained in the scene comparison; it still looks artificial compared with a naturally generated ridge. A second seed-zero real-map comparison is provided to avoid relying on a flattering handmade fixture. Broad tan material repetition and the tile-aligned mountain footprint are reduced/retained respectively, not claimed eliminated.

## Reproduction and validation

Run `node tools/render-scene-contours.cjs OUTPUT_DIR` with the optional `@napi-rs/canvas` dependency available. It compares the pinned main renderer from `git show 5710d96:js/render.js` with the candidate, using identical runtime assets, scene, cameras, season and scale. The report records the candidate renderer SHA-256. Keep that baseline commit in the local Git history.

56 offline production Canvas cases:
- 48 authored village cases: four seasons × desktop/narrow Canvas × zoom 0.75/1/2 × baseline/candidate; 12 buildings, 20 people, 60 trees, 54 mountain cells.
- Four legal dock and completed bridge cases: summer/winter × baseline/candidate. Bridge completion state is authored for visual inspection and asserted complete; construction delivery/work is not represented as simulated.
- Four real seed-zero generated mountain-map cases: summer/winter × baseline/candidate, identical focused camera.
- All draws assert unchanged gameplay state, excluding existing display-only object caches.

`node tests/scene-contours.js --pixels` passes 11 groups and additionally checks actual native Canvas water-mask center ownership, corner topology, island/point-contact/pond/channel cases, UV orientation and shared affine coordinates, occupancy-invariant coast pixels on building placement/removal, separate far-apart repair budgets (288 tiles for two N384 edits instead of 147,456), overlapping-region/insertion-order stability, three repeated dirty repairs with byte-identical output, byte-identical pixels outside repair rectangles, full-versus-dirty error bounds and repeated seasonal rebuilds. The observed full/dirty maximum channel difference was 20/255 from native rasterization; every case's mean was below 0.08/255. This is not claimed as exact full-versus-partial byte identity.

Existing mountain render/hit (10 suites), terrain presentation (8 groups), ground-cache budget, manifest/asset checks, warm-scene asset checks, jade layout (31), desktop workspace (5), warmth (31) and smoke (226) are targeted regression checks. They are not a full-game test pass.

## Offline performance evidence

On the actual seed-zero N128 mountain map at ground scale 0.5, the final comparison run measured three summer full-cache rebuilds at 95.6–103.7ms for pinned main and 157.3–167.6ms for the candidate. Winter was 101.7–106.5ms versus 106.5–108.7ms. An independent run measured summer 90–113ms versus 165–202ms. Full summer rebuilds therefore still cost roughly 1.6–2× baseline on this native CPU renderer; this is a known tradeoff, not a performance improvement claim. Rebuilds occur on initialization/season/resolution changes, not each warm frame.

The rejected per-diamond ribbon clip took about 2.2 seconds on that same complex map. Tracing and caching its exact union boundary removed that avoidable cost without adding a bitmap layer. Independent N384 half-water measurement of two distant edits dropped from about 987ms for the rejected map-wide dirty rectangle to about 2ms for separate regions. These timings are diagnostic and environment-dependent, not browser, GPU, battery or phone guarantees.

Representative same-scale output and the full hash-stamped 56-case manifest are in `contour-evidence/`. Reproduce remaining images with the renderer command above. Current renderer SHA-256: `a95f37cfdb9582cceffeb14f811e0a4f0b5e437f507df70ef5c2b8828f50d0f4`.

## Review limits

These images come from the real production Canvas functions running offline, not screenshots of a browser, a played town, UI layout, touch or a physical phone. The narrow Canvas is not mobile acceptance. No sandbox workaround, browser security change, production deployment, credential access or publication is part of this candidate.

The smoothed shoreline is a substantive visible improvement over the old repeating zigzag. Mountains retain detailed materials and more varied facets, but still fall short of the rich organic scenery of A. Winter shoreline, real browser hit behavior, device performance, sustained play and final subjective A-style acceptance remain open. #87 must remain open; this slice should only be considered for a normal PR after independent code and pixel review.
