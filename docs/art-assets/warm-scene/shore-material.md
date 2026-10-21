# #87 shore material variation candidate

Baseline main `cc9638a` (#122). This is a modest material-layout improvement after the coast and mountain geometry slices, not a claim of full A-reference equivalence or completion of #87.

## Scope

The fixed-width golden bank and continuous warm highlight read as an outline around every water body. The candidate keeps the exact existing shoreline/water masks and replaces only the land-side material bands with world-anchored variable-width mixtures of the original meadow and seasonal sand/pebble image. Source PNGs, buildings, trees, people, road/resource protection, water/ice projection, collision, placement and simulation are unchanged. No image generation or new asset/model service was used.

The sampler follows the existing quadratic coast path. A deterministic smooth world-position field varies material width from 1.5 to 10.5 screen-world pixels before the narrower sand layer is applied. It never moves the coastline itself or restarts phase per tile. Samples are weakly cached by immutable route object in compact Float64Array storage (five numeric fields per sample), reused across seasons and dirty cache repairs. Direct indexed path iteration avoids per-point/reversed-array allocation during repairs. Both side loops of a closed bank are closed separately with opposite winding, preventing a seam at an arbitrary route start. No gameplay random source is consumed.

The land clip still restores opaque meadow first; partial-alpha original sand is composited afterward. Winter uses its original snowy bank material with a restrained frost line. Water-side shallow bands remain unchanged. This intentionally does not introduce reeds, vegetation sprites, new hit targets or a new terrain system.

## Validation

- Seven dedicated groups check deterministic cache reuse, bounded world anchoring, unchanged shared routes/world state, tiny/diagonal/open/closed cases, closed-loop winding, native cyclic-start pixel identity, and native road/resource protection in all four seasons.
- Existing native contour 11, winter 7, mountain 10 and ground-cache budget pass. In particular, repeated dirty repairs remain byte-stable and full/dirty mean error stays below 0.08/255; season round trips restore the prior cache.
- Reproduce the 56-render comparison matrix with `node tools/render-scene-contours.cjs OUTPUT_DIR cc9638a` using the optional native Canvas dependency. It includes village scenes, real seed-zero ridges and authored legal dock/completed-bridge fixtures across seasons and canvas scales.
- Representative actual pixels and exact source manifest are in `shore-material-evidence/`. These are isolated production Canvas renders, not browser/physical-PC/mobile screenshots or sustained-play validation.

## Remaining limits

The improvement is subtle: grass reaches closer to some water edges and exposed sand forms uneven patches rather than a uniform gold rope. The water material/shallow band and some repeated original texture detail remain visible. This slice does not redesign buildings or assert that the entire scene matches the chosen A aesthetic. Full #87 status should be assessed against the original brief and actual user review rather than inventing additional polish tasks indefinitely.

Full ground rebuild cost and independent review results are recorded with final evidence. Warm frames reuse the existing ground cache; no new per-frame bank drawing is added. No production deployment is included.

Exact renderer SHA-256: `7bf4f67e20b995fdf23cec9f745a7d19c84554bd8d7b4c443f4b5ba67a824dae`. Compact storage preserves the reviewed six-sample path exactly; all 20 nonwinter candidate images match the prior object-cache variant byte-for-byte. Independent memory measurement includes ArrayBuffers: approximately 0.20 MiB at N128 and 1.51–1.57 MiB at N384, with negligible additional retained object heap. The earlier object-cache prototype cost about 8 MiB at N384 and was rejected as disproportionate to this modest visual gain.

## Final isolated cost diagnostic

At N384, warm full-cache rebuild medians were 2.960→2.821 seconds in summer and 3.187→3.177 seconds in winter; dirty repair medians were 111.9→105.7 ms and 107.0→113.0 ms respectively. These noisy native measurements do not establish a speedup. The single first-build observations were 3.056→3.213 seconds in summer and 3.051→3.346 seconds in winter, so a cold initialization cost remains disclosed. Full trial values and retained-memory counters (including ArrayBuffers, not merely JS heap) are in `performance.json`. The compact cache addresses the earlier object-heavy prototype's disproportionate retained memory and observed warm-rebuild penalty. No steady-frame/device performance claim is made.
