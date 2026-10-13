# Issue #87: summer meadow and open-water candidates

Status: **unaccepted candidates preserved in a candidate-only Draft PR; not connected to the game manifest and not ready for merge**.

Baseline: LukeJiaoR/banish main `f4fffa72c95d0cb844bc988a57a3778e6648a661` (v0.3.79), retrieved through the GitHub connector on 2026-10-13. Original assets remain unchanged under `assets/terrain-v2/`. 

## Files and provenance

- Built-in image-generation source outputs were 1254×1254 opaque PNGs; the two 512×512 candidates below preserve the complete generated image content at the existing material size. Source outputs are retained in the task workspace.
- `meadow-summer-candidate.png`, `water-open-candidate.png`: whole-image resized 512×512 copies using ImageMagick, matching the existing material dimensions. No recoloring, blur, masks or procedural painting were applied.
- `checks.json`: dimensions, opacity and simple edge-difference diagnostics from `check-candidates.cjs`. These numbers are not a naturalness or seamlessness acceptance score.

Input references were visually inspected: current summer meadow, current open water and original house. The house was a style reference only. House/tree/citizen assets and adopted warm/winter mountain assets are not modified.

## Review findings

The summer candidate is somewhat quieter in fine grain but retains yellow grass tufts and broad mottling. It does not yet establish that the user's unnatural-grass concern is solved. The water candidate reduces dense sharp crests and reads calmer at source scale. Both require repeat/seam inspection and actual native-scale game rendering before adoption. Grass horizontal/vertical edge differences exceed internal adjacent-pixel differences; seamless tiling must not be assumed from the generation prompt.

## Blocking verification

The actual game rendering code was obtained, including `G.fillTerrainSurface`, its world-anchored eight-tile pattern and half-resolution ground cache. A real Chromium launch with Playwright failed before any page rendered:

`FATAL:chrome/browser/process_singleton_posix.cc:297 Check failed: . socket() failed: Operation not permitted (1)`

No security settings were changed, and no browser/socket workaround was attempted. There are **no real-browser before/after screenshots, no native camera/scale acceptance result, no gameplay tests and no merge** from this candidate pass. Offline Canvas or source previews must not be presented as successful browser A/B verification.

## Required next acceptance step

Use an authorized environment where the real game can run. Materialize the full frozen baseline, load its PNGs and freeze one saved seed, game time, season, camera position, zoom, viewport and ground-cache scale. Capture the unchanged scene first; swap only the candidate summer texture and capture at identical state. Restore baseline and independently compare the candidate water with the same conditions. Include buildings, trees, citizens, water/shore and mountain context; inspect repeat seams and both near and distant views. Keep the original files unless the reviewed game-scale result clearly improves the concern. Retain winter ice and other seasons' routing. Run repository asset/terrain/cache tests after any selected replacement. Open a Draft PR only for a verified minimal change, and require independent review before ordinary merge.

## Generation prompts

Summer: Square opaque seamlessly tileable summer meadow for the existing small-scale isometric settlement game. Current meadow is the edit target; original house is style-only. Preserve muted warm olive-green summer palette and softly hand-painted finish. Reduce dense repeated bright yellow upright tufts and high-frequency scratchiness; use subtle irregular fine blades and gently varied flat greens. Low contrast, quiet at distant scale. Flat top-down material, uniform lighting. No baked perspective, isometric diamond, buildings, paths, trees, flowers, rocks, water, large bare earth patches, dramatic clumps, stripes, grid, border, vignette, shadows or text. Seamless in both axes; no identifiable motif.

Water: Square opaque seamlessly tileable calm inland-water material. Current water is the edit target; original house is style-only. Preserve muted mid blue-teal and compatible luminance. Reduce sharp white crisscross crests; gentle small soft ripples, sparse subtle broken reflections, low contrast and softly painted surface. Flat top-down, uniform diffuse daylight, consistent detail scale. No coastline, sand, plants, boats, buildings, islands, rocks, foam, deep swells, pool caustics, directional streaks, white glints, borders, vignette or text. Seamless both axes.