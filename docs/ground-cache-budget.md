# Bounded ground-cache allocation

The ground surface now obeys its existing 16,000,000-pixel budget at cold creation, zoom rebuild and world replacement. Sizing checks actual ceil-rounded integer width × height, rather than only floating-point area. Canvas resize first reduces width before changing height, so an intermediate new-width × old-height allocation cannot exceed the budget. This bounds one ground backing surface (about 61.04 MiB at four bytes/pixel), not total browser, texture, GPU, temporary-allocation or process memory.

Current maps remain 128 × 128. Their initial scale .5 surface remains exactly 4,136 × 2,088 = 8,635,968 pixels, about 32.94 MiB RGBA. There is no large initial-memory reduction for the current real map. Its old maximum-zoom ceil-rounded allocation was 16,006,090 pixels, only 6,090 above the intended cap; this slice fixes that small overshoot and lifecycle correctness rather than claiming a large phone performance improvement.

192/256 dimensions are synthetic future-map fixtures only. Their previous scale .5 cold surfaces used 19,244,608 / 34,047,552 pixels (about 73.41 / 129.88 MiB RGBA). They now use at most the existing 16-million-pixel budget. The patch does not enlarge actual maps, add resources or change save schema. Tests exercise the existing cross-size save migration path by overriding the map constant in fixtures.

A dirty-tile update is valid only for the same world, scale and canvas dimensions. Changes trigger a full repaint; unchanged warm frames allocate/repaint nothing, and one normal interior dirty tile repaints itself plus four neighbours. The zoom debounce stays 250 ms and uses the current world/zoom when it fires. Display DPR does not multiply the entire ground cache. Existing world-space terrain materials, seasonal water/ice, farm layers, people and selection overlays are retained.

## Verification and limits

- `tests/ground-cache-budget.js`: 3 map dimensions × 5 zooms × 3 DPRs, every intermediate width/height assignment, all integer map sizes 1–4096 for rounded sizing/idempotence, dirty/full repaint separation, same-size new worlds, scale-only changes, seasons, debounce/world replacement and save migration.
- Farm, citizen and harvest-overlay frame fixtures explicitly identify their intentionally mocked warm ground image; separate allocation tests validate real cache lifecycle expectations.
- Current Node Canvas terrain/pattern and pixel comparisons are offline rendering evidence. No browser/phone FPS, battery, device memory or real touch usability claim is made. Cold terrain rebuild still visits the map's tiles; this is not a chunked-renderer or asymptotic CPU optimization.
