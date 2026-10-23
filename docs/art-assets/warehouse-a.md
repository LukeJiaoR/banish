# A-style warehouse

The original painted Chinese timber/plaster warehouse has a straw hip roof, clear double loading door and grain sacks inside. Runtime PNG is 768×768, uniformly exported from a 1254×1254 original. The existing `assets/buildings/storage.png` stays intact as missing/malformed-image fallback. Construction scaffolding remains unchanged.

The source stone-front footpoint (654,1154) maps exactly to the existing 3×3 bottom vertex. Visible roof span 1232 maps to the established 197.76-game-pixel warehouse width. Runtime coordinates scale by 768/1254. Both completed buildings and pending placement previews use the same `G.sprDraw` storage path; preview opacity remains 0.65. No independent preview offset or image deformation is used.

The stone walls are intentionally inset from the logical collision footprint. Artwork is an approximate dimetric painting, not a mathematical collision template: measured source base slopes about +0.529/-0.572 are retained honestly. Full-footprint masonry scaling was rejected because it enlarged the roof and building unnecessarily. The final silhouette is about 164 game pixels tall, similar to the legacy warehouse, with unchanged broad roof-width budget. Doorway remains unobstructed by outside props; existing depth sorting handles people and neighboring trees.

No building definition, cost, capacity, footprint, pathfinding, interaction perimeter, simulation, RNG or save format changes. Grain painted inside the door is decorative and does not assert a live stock amount.

Verification:

- `node tests/warehouse-art.js`: actual completed/preview transform, exact anchor, uniform scale, summer/winter, absent/malformed fallback, construction and save invariance.
- `node tests/a-style-art.js`, `node tests/art-combination.js`, `node tests/juvenile-tree-art.js`, `node tests/woodcutter-art.js`, `node tests/save-input-regressions.js`.
- `node tools/render-warehouse-art.cjs OUTPUT`: production G.frame old/new, completed/preview, 1×/2× with four-side citizens and optional footprint overlay. Pending-placement eligibility is a fixture, not an interaction test.
- `node tools/render-juvenile-trees.cjs OUTPUT`: mixed warehouse/house/juvenile-tree scenes in summer/winter, 1×/2×.

Source SHA-256: `48a9ff2b3f4166478aa2d410633898fda55b4935c955496d845aaf183977bb4e`.
Runtime SHA-256: `884dbb15957cbbf9bac4dacf26a4e439ca396a650e7d80f550656fd6cf44b13e`.
Generator: OpenAI built-in imagegen. Source and initial rejected candidates are preserved separately; no external paid API. `tools/export-warehouse-art.cjs SOURCE OUTPUT` reproduces the uniform runtime export. Offline Canvas validation is the scope of this change; no deployment is included.
