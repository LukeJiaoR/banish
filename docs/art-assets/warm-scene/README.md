# Warm hand-painted scene brief and minimum adoption

## Decision, 2026-10-19

Adopt the existing #98 v2 summer meadow and open-water PNGs, byte-for-byte, at their existing runtime paths. This is a small reduction of yellow grass specks and sharp white water fragments, not a scene-wide art remake. The original early house/storage, trees, people, and already adopted summer/winter mountain art remain unchanged. No generation API was called or asset repainted for this adoption.

Two independent pixel inspections of the new offline scene favor both v2 files together: the foreground houses read more clearly, water is quieter, and fine detail remains. Main's geometry, collision, pointer mapping, simulation, manifests, asset names, and cache architecture are unchanged. The existing image-load invalidation and seasonal routing apply automatically. Winter uses the unchanged winter meadow and ice, not open water.

## Reusable production brief

- Quality anchor: `assets/buildings/house.png` and `storage.png`; retain their warm terracotta roofs, readable timber/stone planes, crisp silhouette and layered hand-painted detail. Preserve good original assets instead of redrawing them merely for uniformity. Original source sheets and historical prompts remain in `art/` and `docs/art-assets.md`.
- World camera: production 64×32, 2:1 dimetric cells. Texture generators must output flat top-down materials without baked perspective; runtime owns projection. Building width follows its footprint, bottom-center foot anchor; adult height 17 px, child 12.5 px, mature tree 38 px. Do not inflate props to improve a contact sheet.
- Light: broad upper-left illumination, darker right-facing planes; no photographic specular glitter, independently baked cast shadows, vignettes or directional studio light. The engine owns cast shadows and time-of-day modulation.
- Palette: muted warm olive meadow supporting terracotta/timber buildings, warm gray/tan mountain planes, subdued blue-teal unfrozen water. Preserve existing season routing and `G.PAL`; no global filter over original buildings. Snow stays pale/cool and preserves the mountain face structure.
- Detail hierarchy: large clear silhouette, medium material planes, restrained fine brush detail. Avoid photo-like scratchy microtexture, uniform grain, dense yellow tufts, bright white ripple fragments, or blur that erases the house's material hierarchy. Ground is lower contrast than buildings and people.
- Formats: terrain 512×512 opaque tileable PNG, mountain material 256×256 opaque PNG; objects have real alpha and stable foot anchors. Grass/water repeat every eight cells, mountain every four. Inspect seams and broad repetition in actual runtime-scale views; a low edge metric alone is not acceptance.
- Mountain contract: reuse production shared raised polygons and their pointer hit ownership; summer and winter use the same geometry. Material work must not change collision masks, bounding ownership, saved terrain, height or camera inverse. See `../mountains.md`.
- Scope: never replace a usable material set with a generated panoramic illustration. Do not redraw all buildings/characters, expand rendering architecture, or alter gameplay to make an art sample attractive.

## Reproduction and evidence

`node tools/render-warm-scene.cjs /tmp/banish-warm-scene` requires the optional `@napi-rs/canvas` package. It uses the unmodified production `G.frame` and terrain/mountain/sprite functions, not the riverbay experimental terrain overlay. The authored fixture has 12 buildings, 20 original residents, 60 original trees, and 54 unoccupied mountain cells alongside grass and water. It is not a played late-game save or the user's town.

36 cases: summer/winter × 1227×763/390×620 Canvas × zoom 0.75/1/2 × original/water-only/both-v2. Each group has identical camera and world state. Comparison images are three native-scale canvases placed side by side. The script asserts unchanged gameplay data for every draw; normal render-only display caches are excluded. `report.json` records all cases.

Committed representative pixels:
- `desktop-s1-z1-compare.png`: left original, middle water only, right both v2; complete grass/house/tree/person/mountain/water composition.
- `narrow-s1-z1-compare.png`: native narrow-Canvas composition at the same camera scale, not phone DOM or touch validation.
- `desktop-s3-z0.75-both.png`: unchanged winter materials and raised snowy ridge coexist with the preserved original buildings.

All other cases can be reproduced with the command above. Both original runtime baseline files are preserved under `../candidates/issue-87/`; candidate generation prompts, references, edge-crossfade/grass derivation history, and earlier Chromium evidence remain there. No new processing of either v2 PNG occurred in this change.

## Current verification and remaining scope

Current checks: 159 manifest PNG paths and building/carry coverage; terrain seasonal routing, pattern reuse/replacement/fallback and world coordinates; 10 mountain geometry/render/hit suites; exact-byte adoption and preserved mountain signatures; 36 offline production-render cases with unchanged gameplay state. Older browser results are historical evidence only.

#87 remains open. Obvious stepped sand banks and broad mountain repetition still exist, and no claim of fully unified scenery is made. This batch intentionally does not modify shoreline geometry, mountain assets or the riverbay experiment. Actual browser/mobile layout, touch behavior, device performance, sustained play and a truly dense late-game save are unverified. A 390px Canvas is not a physical-phone acceptance test. Future work should address these specific visible defects rather than restarting good buildings or adding noisy new material sets.
