# #87 winter shoreline continuity candidate (2026-10-21)

## Bounded change after #120

Baseline: merged main `75f0a4c`. #120 smoothed the nonwinter coastline but deliberately left the original ice path unchanged. This follow-on makes winter use the same visual contour and logical-center guarantees. It does not complete overall #87 art coherence or change the recently merged UI, mountain polygons, collision, simulation, saves or original asset files.

The actual `assets/tiles/water_winter.png` was inspected as pixels: it is an 86×83 square painted ice material with partially transparent rounded edges, not an opaque continuous surface. Its SHA-256 remains `a732499384e56964404c751d3ae349902344a66a10c6cc134132e27413c78466`. Its 7,138 pixels include 5,925 fully opaque and 27 fully transparent pixels. No new art, image-generation service or paid service is used. A tiny runtime atlas only composites the existing sprite draws.

## Rendering contract

- Both winter water tiles and the curved coastal water margin use the exact same original ice image and world-anchored phase. A cached 64×32 screen-space atlas (8 KiB of RGBA pixels, plus context patterns) preserves the existing clipped 65×33 sprite projection and repeat lattice. Mapping the entire alpha-edged square to a world diamond was rejected because it introduced a diagonal grid. This avoids a differently oriented texture strip along the shore.
- An opaque `G.PAL[3].water` backing is filled into the atlas before the original alpha sprite stamps. Fully transparent image pixels therefore reveal winter water color, never stale summer pixels, land or gaps. The original PNG is not flattened or modified.
- Original winter meadow and sand still define the snowy bank; only the small existing shore-band colors select a winter palette. Original buildings, trees, people, roads and mountain assets are unchanged.
- Missing ice or unavailable patterns retain the established fallback. Winter does not silently select the open-water image. Replacing a loaded ice object or its backing color invalidates the tiny atlas and context-local patterns.
- Logical water, tile centers, placement ownership and all shared contour geometry remain exactly those of #120. This does not turn rounded water margins into buildable land. Roads and rocks remain protected; building occupancy is not a ground-cache dependency.
- The same one-canvas cache and clustered dirty repair path now also apply in winter. The real `G.onSeasonChange` callback still invalidates the full cache and clears pending dirty tiles; no simulation source is changed.

## Verification and evidence

Run:

- `node tests/winter-shore.js --pixels` with optional `@napi-rs/canvas`: seven groups check original asset bytes, opaque-before-alpha order, original projection and repeat seam bounds, missing-ice/pattern fallback, entirely transparent ice, the real season-change callback across summer→winter→summer, repeated winter dirty repairs and image-replacement invalidation.
- `node tests/scene-contours.js --pixels`: the existing 11 contour groups remain applicable, including logical centers, narrow channels and diagonal contacts, occupancy invariance, distant/overlapping repairs and cache bounds.
- `node tools/render-scene-contours.cjs OUTPUT_DIR 75f0a4c`: same 56-case production Canvas fixture matrix as #120, pinned to the merged baseline. An explicit optional baseline SHA was added to the tool; its historical default remains `5710d96`.

All 18 spring/summer/autumn village comparisons (three seasons × two canvas sizes × three zooms) are byte-identical baseline/candidate PNGs. Winter comparisons show the curved snow/ice boundary. The original legally placed dock and completed bridge remain visible; completion is authored visual fixture state, not a claim of construction gameplay validation.

Representative winter desktop and dock/bridge comparisons, the exact 56-case report and seven-group test output are in `winter-evidence/`. Full/dirty winter mean pixel difference stays below 0.08/255, repeated repairs are byte-stable, and a winter round trip restores the original summer cache byte-for-byte. Renderer SHA-256 for this evidence: `afff96383d4d7ea928d3c0f8bded2ba389558ae1a63faa96ef2998765902d7db`.

## Performance and limits

The final native N128 seed-zero run recorded winter full rebuilds at 110–117ms for baseline and 184–209ms for the candidate. Timings are environment-dependent and include native CPU/cache effects. No physical-device/browser/GPU performance claim is made. Full winter rebuild now includes contour work and ice compositing; warm frames reuse the existing ground cache. The extra runtime atlas is only 64×32, not a second full-map layer.

A native repeat-seam test compares the atlas with original direct ice stamps over the same backing: mean RGB difference is 3.59/255 overall and 3.80/255 at repeat boundaries. This bounded resampling difference is not a pixel-identical winter claim. Nonwinter output remains byte-identical.

These are isolated offline production Canvas renders, not browser or phone screenshots. No UI, touch, sustained-play or production-deployment acceptance occurred. The old ice material still has conspicuous repeated crack detail; improving that material and mountain footprint coherence remains separate #87 work. This slice fixes the seasonal shoreline inconsistency, not the entire art issue.
