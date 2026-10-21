# #87 mountain contour candidate

Baseline main `97bb129` (winter #121). This bounded rendering change reduces generated mountain footprint teeth without changing the authoritative mountain mask, collision, available building cells, pathfinding, generation or save data. It does not complete the overall warm hand-painted art issue.

## Contract and design choice

An initial convex-top bevel retained an opaque full-diamond rock toe. Real seed-zero comparisons showed no material silhouette gain despite 27% more faces, so that experiment was rejected and never published.

This candidate traces connected mountain boundaries using the existing boundary tracer, then relaxes each shared boundary vertex once by at most one-quarter world cell per axis. Map edges and vertices shared by diagonal point-touching components stay pinned. Existing tile-owned top triangles and visible front side faces use these shared positions; painter ordering remains per tile, not per whole component. All logical tile centers stay on their original side.

The original blocked ground diamonds remain visible as 48%-opacity original rock texture beneath the ridge. Receded corners therefore look rocky rather than plain meadow. That full toe is part of the same face list used for picking and hover. Missing-image fallback also paints a visible rocky toe. Existing invalid-placement fills and the mountain hover outline expose the true blocked footprint when planning construction; no new broad UI mode was added.

Visible raised-face picking changes locally with the new outline. It intentionally does not retain invisible old raised polygons. The low toe continues to own the original blocked corner wedges. Top, toe, front faces and hover share geometry; zero-area faces are excluded because relaxed boundary edges can align with their vertical extrusion. Tunnel portal geometry and its painter order remain unchanged.

Geometry and boundary vertices are cached by world and height-cache identity. Saved data gains no fields; loading another world rebuilds the cache. Mountain masks are immutable after generation/load, as in the existing height cache. Tests that author a different mask explicitly invalidate the height cache too.

## Verification

- New mountain-contour tests: five groups covering all 15 nonempty 2×2 masks, diagonal chains, islands/map edges, quarter-cell bounds, every logical cell center, diagonal separation, cache reuse/invalidation, nonzero-area facets, rocky-toe hits at zoom 0.45/0.75/1/2, unchanged rejected placement and missing-image visibility.
- Independent `mountain-contour-oracle.js` checks all 511 nonempty 3×3 masks at interior and both map-edge offsets with a separate ray-cast ownership oracle.
- Existing mountain-render ten groups updated for the additional toe face; exhaustive actual seed-zero painter-order ownership remains tested. Tunnel six suites pass unchanged.
- Native coast eleven groups, winter seven groups and ground-cache budget pass. Simulation, UI and terrain regression suites remain applicable.
- `tools/render-mountain-contour.cjs OUTPUT_DIR` produces 24 renders (12 baseline/candidate pairs) across real generated seed-zero terrain, explicit isolated/diagonal/hole stress terrain and completed tunnel fixtures, summer/winter and desktop/narrow canvases, plus an actual rejected-building preview. These are offline production Canvas fixtures, not browser/device screenshots or construction gameplay claims.

## Cost and limits

Reproduce with `node tools/benchmark-mountain-contour.cjs OUTPUT_DIR`. Independent seven-trial Node benchmark medians over seeds 0/1/42 found warmed polygon lookups 65–68% faster and 20,000 mixed boundary/interior picks 12–15% faster (42–44μs/pick versus 47–50μs). Cold all-map geometry costs 102–138 ms versus 80–116 ms, a one-time increase of 18–33 ms over 3,318–4,672 mountain cells. These are VM measurements, not physical-device or full-frame/GPU claims. Cached facet objects increase retained memory; the cache is per world and weakly keyed.

The low transition can still reveal the logical grid, especially isolated rocks and thin diagonal chains. This is deliberate rather than hiding unbuildable land. Mountain material detail, ridge structure, uniformly banded riverbanks and actual PC/mobile visual acceptance remain open under #87. No production deployment accompanies this candidate.

## Exact local evidence

Renderer SHA-256: `2d716bacb061f75ab07606481190955352e1ad8d1a45b833f2061879866d5260`. The committed-scope `mountain-contour-evidence/` contains real-map summer desktop and winter minimum zoom 0.55 comparisons, a rejected-building preview, the 24-render manifest, independent benchmark results and test output. Independent review found no blocker for this exact source. The extended ray-cast oracle passed 1,533 mask cases, 28,644 faces and 118,632 non-edge ownership samples; 364 zero-area side faces were excluded. These counts describe exhaustive small-layout validation, not gameplay duration.
