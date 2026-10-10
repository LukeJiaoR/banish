# Continuous meadow and season-correct water

This visual-only patch responds to the actual supplied grass and autumn-water screenshots. The old grass restarted a bright decorative image on every tile; the autumn water PNG itself was golden. No map generation, resource yield, movement, temperature or economy changes are made here.

## Rendering

Five original image-generated 512×512 opaque PNGs provide spring/summer/autumn/winter meadow and unfrozen blue water. Each texture spans eight tiles per axis, anchored in world coordinates rather than starting over at each tile. A cached CanvasPattern is created once per image/context and used only when the existing ground cache is rebuilt or dirty tiles are repaired. There is no per-frame noise generation, new animation or simulation RNG consumption. Replaced loaded images invalidate the pattern. Missing images/context support preserve the previous fallback path; open-water fallback deliberately uses blue spring water even in autumn. Winter preserves the existing ice asset. Roads and sand remain distinct materials.

## Provenance and budget

Original prompts requested flat, seamless, low-contrast hand-painted meadow, fine muted grass, no flowers/objects/border/grid or baked perspective. Seasonal variants use the generated summer reference: greener spring, muted ochre autumn, pale snow winter. Water prompt requested calm blue-green painted ripples with no gold, objects or pool caustics. No Banished commercial artwork was used. Generated originals were mechanically resized to 512×512; no project runtime image-generation dependency was added.

Five decoded RGBA surfaces total about 5 MiB, compressed files about 3 MiB. They reuse the existing terrain cache rather than adding another full-map layer. This is not a measured mobile GPU budget: the old whole-map ground canvas remains a substantial memory cost. Map expansion and initial cache sizing need their own profiling/fix before choosing a larger size.

## Verification and remaining visual issues

- `node tests/terrain-presentation.js`: PNG dimensions; context-local pattern reuse; world coordinates; replacement/missing-image fallback; seasonal meadow; blue autumn water; ice/road/shore distinctions; no simulation RNG.
- `node tests/art_assets.js`: all 98 declared PNGs exist and load through the manifest.
- Actual game Canvas renderer plus PNGs was rendered offline for the same seed/camera, four seasons, five legal-footprint houses and two docks. This is a synthetic developed scene, not the user's save or a browser screenshot. Both the supplied screenshots and generated comparisons were inspected as pixels.
- The grass has fewer bright repeated marks and grid lines; autumn water stays visibly blue. Stepped sand banks and repeated shoreline tiles are still visible. This patch does not claim that all terrain now looks natural.
- True browser/touch controls, phone frame rate, power use and subjective playability remain unverified. Existing environment restrictions were not bypassed.
