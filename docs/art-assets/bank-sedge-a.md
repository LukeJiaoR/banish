# A-style low riverbank sedge and pebbles

Scope: #87 small complete 32×32 scene. Adds one original transparent vegetation/stone cluster; does not redraw buildings, trees, coast geometry or mountain materials. The first procedural tiny-line experiment was rejected as visually negligible and is not shipped.

- Generated original: 1394×1128 RGBA; SHA-256 `f9867b9381943455482b6a940339bc9f3bbdaeb10169f27d08a5ee9fba3fceae`.
- Runtime: `assets/a-style/bank-sedge-a-v1.png`, 256×208, uniform scaling with original transparent margins retained; SHA-256 `618993c727283700aebbe6e22915e5c80d6fcadf330b672c320a982e1955f1c0`.
- Export: `node tools/export-bank-art.cjs SOURCE_PNG assets/a-style/bank-sedge-a-v1.png`. Original is preserved outside the runtime tree.
- Visible cluster is about 36×23 world pixels; foot-contact anchor calibrated from source (710,936). Sparse coordinate-hash placement only on shore cells adjacent to water; roads/resources excluded. Land/ribbon clipping protects terrain. No collision, resources, save state or simulation RNG change.
- Winter hides this low vegetation under snow. Image load invalidates the ground cache, including late loads. Existing seasonal invalidation handles spring return.

## Evidence

`node tools/render-current-scene.cjs OUTPUT_DIR` renders the production renderer at 1× with the existing authored 32×32 fixture (12 buildings, 20 citizens, 60 trees, 54 mountain cells), in summer and winter. Summer at native scale now has readable low shore vegetation instead of a continuous bare bank. Winter retains its prior presentation. This is offline Canvas evidence, not browser/device testing.

Passed: bank-details deterministic/state/RNG/season/road/resource/bounds tests; shore-material 7 and scene-contours 11 groups with the **actual new PNG loaded** (native pixel protection and partial rebuilds); winter-shore 7; ground-cache-budget; smoke 226. No building/experimental renderer changes.
