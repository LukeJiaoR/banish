# Issue #87: summer meadow and open-water candidates

Status: **unaccepted candidates preserved in a candidate-only Draft PR; not connected to the game manifest and not ready for merge**.

Baseline: LukeJiaoR/banish main `f4fffa72c95d0cb844bc988a57a3778e6648a661` (v0.3.79) for v1. v2 was prepared against the same runtime assets on 2026-10-17; no runtime, manifest, rendering, gameplay or CI change is included. Original assets remain unchanged under `assets/terrain-v2/`.

## Files and provenance

- v1 `meadow-summer-candidate.png`, `water-open-candidate.png`: built-in image-generation outputs (1254×1254 opaque), whole-image resized to 512×512 with ImageMagick. No recoloring, blur, masks or procedural painting.
- v2 `meadow-summer-candidate-v2.png`: **offline derivative of the current `assets/terrain-v2/meadow_summer.png`**, not a new generation. Warm/yellow tuft pixels were pulled toward the local green, the 55 px low-pass component was kept at 42 % while detail was kept at 95 %, an 80 px edge cross-fade made the tile periodic, and 0.8 RGB grain was added. 512×512, opaque.
- v2 `water-open-candidate-v2.png`: **offline derivative of v1 water**. An 80 px edge cross-fade makes the tile periodic; the original mean is preserved and no color grade was applied. 512×512, opaque.
- `checks.json`: dimensions, opacity, adjacent-pixel and edge diagnostics for all four PNGs, plus the fixed-view in-game RGB standard deviations. None of these numbers is a naturalness or seamlessness acceptance score.
- `in-game-*.png`: native 1:1 game-canvas captures and side-by-side comparisons. See the method below.

Input references were visually inspected: current summer meadow, current open water and original house. The house was a style reference only. House/tree/citizen assets and adopted warm/winter mountain assets are not modified.

## Review findings

v1 grass was rejected: still mottled and tuft-heavy. v1 water was calmer at source scale but its left/right edge jump (6.19) was more than twice its internal adjacent-pixel mean (2.61), so seamless tiling could not be assumed.

v2 grass, measured in the same in-game view on a pure-grass patch, drops RGB standard deviation from 10.09/7.49/3.61 to 7.27/7.04/4.50 (about 28 % lower overall) and visibly reduces warm-yellow specks. Its edge jump is 7.25/7.21 versus an internal adjacent mean of 6.57/6.32, so the tile is close to periodic. It deliberately keeps the baseline's large-scale variation; the difference is measurable but subtle, and a reviewer may still call it "close to baseline".

v2 water now measures 2.52 versus 2.44 internally on X and 6.57 versus 6.50 on Y. In the fixed water view its RGB standard deviation falls from 11.42/11.03/11.48 to 7.01/7.24/7.78: calmer, fewer sharp crests. Dense directional ripples and an eight-tile repeat remain.

## In-game A/B method

A real Chromium session was available on 2026-10-17 (ego-browser, 1227×763 CSS px, devicePixelRatio 1), running main `986d13b` (v0.3.79 through #103). The earlier `socket() failed` block applied to the 2026-10-13 VM and is not repeated here.

- One saved v3 village (seed `2685766889`, day 140) was applied through `G.applySaveData` in every copy. Game state was then frozen at summer (`season=1`), day 12, 10:00, `paused=true`, `speed=0`, zoom 1.
- Four static copies were served side by side: baseline, grass-only, water-only, both. Only the single PNG differs between copies. The camera was centered on the storage building for the grass view and on the local water centroid for the water view; `G.needGround` was raised and the ground cache rebuilt at scale 0.68.
- Captures were exported from the game canvas (`G.cv.toDataURL`) rather than a page screenshot, so no DOM panel or toast covers the terrain.
- Files: `in-game-summer-grass-baseline.png`, `in-game-summer-grass-v2.png`, `in-game-summer-grass-compare.png`, `in-game-water-baseline.png`, `in-game-water-v2.png`, `in-game-water-compare.png`.

This establishes that both v2 files render in the actual Canvas pipeline at native scale without an exception, and gives a same-state comparison. It does **not** establish a full-town look, mobile/DPI behavior, or long-play acceptance.

## Remaining limitations

- The captured village has five citizens and five buildings; it is a real saved town but not a dense late-game scene. A dense-town capture at zoom 0.75/1/2 and a phone-sized viewport are still required before adoption.
- The grass candidate is derived from the current texture, so it inherits the baseline's composition. It is quieter, not a new art direction.
- The water candidate is still a single static pattern; repetition every eight tiles remains visible in long views.
- No independent reviewer has accepted v2 yet. `checks.json` numbers are risk signals, not an acceptance verdict.

## Recommendation

Keep this PR Draft. Do not merge or enable either texture until an independent review and a denser in-game capture establish a clear improvement. If the team wants to continue, water v2 is the stronger of the two; grass v2 is a measurable but subtle reduction of the reported tuft/mottle problem.

## Generation prompts (v1, retained for provenance)

Summer: Square opaque seamlessly tileable summer meadow for the existing small-scale isometric settlement game. Current meadow is the edit target; original house is style-only. Preserve muted warm olive-green summer palette and softly hand-painted finish. Reduce dense repeated bright yellow upright tufts and high-frequency scratchiness; use subtle irregular fine blades and gently varied flat greens. Low contrast, quiet at distant scale. Flat top-down material, uniform lighting. No baked perspective, isometric diamond, buildings, paths, trees, flowers, rocks, water, large bare earth patches, dramatic clumps, stripes, grid, border, vignette, shadows or text. Seamless in both axes; no identifiable motif.

Water: Square opaque seamlessly tileable calm inland-water material. Current water is the edit target; original house is style-only. Preserve muted mid blue-teal and compatible luminance. Reduce sharp white crisscross crests; gentle small soft ripples, sparse subtle broken reflections, low contrast and softly painted surface. Flat top-down, uniform diffuse daylight, consistent detail scale. No coastline, sand, plants, boats, buildings, islands, rocks, foam, deep swells, pool caustics, directional streaks, white glints, borders, vignette or text. Seamless both axes.
