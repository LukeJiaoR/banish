# Animal gait assets — 2026-10-23

User request: “小动物的动画也要补上 现在是一个贴图到处闪现”. These are original generated animation frames, not translations of the old flat texture. Existing `assets/props/{deer,sheep,cattle,chicken}.png` remain untouched.

## Frames and anchors

Each species has four articulated walk phases (`*_walk_0..3`), a standing `*_idle`, grazing / chicken peck `*_graze`, and front-three-quarter turning `*_turn`. Every exported PNG is 128×128 with shared source foot anchor `(64,126)`. Runtime nominal widths stay deer 26 px, sheep 24 px, cattle 32 px, chicken 16 px. Use the new idle with the new walk series; the old single sprite is a loading fallback, not the interleaved idle frame.

`export.py` only crops the generated atlases, performs uniform per-species resampling, and places the result on a common transparent canvas. It does not repaint pixels, segment limbs, replace colors, or change anatomy. Imagegen supplied the actual leg articulation. The original generated atlases retain their own alpha, including invisible RGB outside silhouettes; the alpha-composited contact sheet is the appropriate visible-art evidence.

## Generation provenance

Tool: available `image_gen.imagegen`, 2026-10-23. Walk inputs were the four existing species PNGs; idle and turn inputs were the generated walk atlas. Requests emphasized exact animal identity/colors, left-facing three-quarter orientation, unchanged torso size, actual alternate bent knees/hooves/toes, natural species anatomy, painterly game style, true transparency, no ground/shadow/text.

- `generated-walk-atlas.png`: 4×4 layout, rows deer / sheep / cow / hen, columns extended / passing / opposite extended / opposite passing phases. Original tool output `exec-1a9e6977-7933-4cd0-9375-b7f3e6a540f5.png`.
- `generated-idle-atlas.png`: 2×4 layout, standing and grazing/pecking, same identities and torso scale. Original output `exec-9def109a-4c89-445d-b55c-4235e03b32b7.png`.
- `generated-turn-atlas.png`: 2×2 layout, deer / sheep / cow / hen facing near camera. Original output `exec-8f02188b-e823-4a47-ba9e-fe7f825dc4eb.png`.

A transparency-only retry of the idle atlas was generated after its hidden background RGB appeared in the tool viewer; numerical inspection established that the first idle atlas already had correct zero-alpha background. That retry is not used or required for reproduction. Original generation receipts remain in the task workspace; no API credential or separate paid model endpoint was used.

## Art checks

`native-contact-sheet.png` shows actual nominal sprite dimensions on the small top line of each species and enlarged diagnostic poses beneath. These are asset checks, not browser or full-scene animation proof. Native review confirms recognizable species and genuine changing feet/leg silhouettes, rather than shifting one unchanged bitmap. `asset-check.json` confirms four unique RGBA walk images and four unique lower-leg regions for every species, with transparent and opaque pixels in every frame. This numerical check is supplementary, not a substitute for visual judgment.

`export-report.json` records every exported frame's source scale, source anchor, common canvas/foot anchor, and SHA-256. The supplied idle/graze/turn images are separately generated poses: do not claim untouched torso pixels or exact identity lock. Common-scale placement is calibrated for small runtime sizes; the original asset series remains available as fallback.

Runtime movement continuity, frame-time invariance, pause/restart, turn transitions, save/RNG purity, ecology/hunting preservation and actual production temporal rendering are tested by the implementation slice separately. Art delivery alone does not establish those results or close #87.

### Common-scale registration check

All four walk frames within a species use the **same** uniform scale; they are not individually tight-fit rescaled. With alpha > 32, the deepest visible foot edge varies across the four phases by deer 0.406, sheep 0, cattle 0.5 and hen 0.25 pixels at nominal native width. The alpha-weighted x centroid in the fixed torso inspection band (export rows 45–89) spans 0.394 / 0.112 / 0.370 / 0.146 native pixels respectively. See `anchor-check.json`. This is a limited registration diagnostic, not a proof of unchanged torso artwork. Natural leg extension changes the total silhouette width; that must not be compensated with per-frame stretching.

## Runtime fix and verification (2026-10-23 15:18 UTC)

Baseline main `7ea3dad4f5b90ef13eec9845b8522df51a6ba2e0`; local render/sprites/sim/main files compared byte-for-byte to that revision before editing.

- Root causes: idle-only deer offsets were added/removed at route boundaries (sample 13.72 native pixels); projected facing used x+y instead of x−y; area-pen grid resampling depended on current headcount (10→11 in a 20×20 pen could move an old slot ~575 pixels). These are presentation faults, not a missing fixed-tick interpolation layer: main advances simulation on each animation frame before drawing.
- Deer feet now always equal `deerPosition`, including stops, blocked routes and restarts. Actual displacement selects walking frames; facing persists at stops with a brief real turn frame at reversal. WeakMap presentation history is updated offscreen and reset on a slot generation change. Reload resets only unsaved animation phase, not any world footpoint or gameplay field.
- Pen slots derive from fixed capacity, not current count. Birth/removal preserves all retained indices. Sheep/cattle walk and rest; chickens have a faster gait and peck pose. Reversals use a turn pose; no whole-image bob substitutes for leg articulation.
- A species switches to its new frame family only when all seven images are loaded. Any missing member retains the original image consistently; original PNGs stay unchanged.
- Simulation/ecology, hunting, economy and save-schema source files are unchanged. Rendering does not consume simulation RNG or alter serialized state.

Reproduce: `node tests/animal-animation.js` (18 independent groups), `node tests/animal-motion.js` (7), `node tests/deer-hunting-render.js` (5), `node tests/smoke.js` (226 assertions), `node tests/art_assets.js` (207 runtime PNG paths), and `node tools/render-animal-animation.cjs <output-directory>` with `@napi-rs/canvas` available.

[12-second production Canvas clip](animation.mp4) and [machine-readable temporal report](canvas-report.json): 240 frames at 50 ms, 120 exported frames, actual `G.frame` plus `G.advanceDeer`, a pause/resume interval, stable-index animal addition, and 0.75×/1×/2× camera zoom. The scene is a controlled test town with fixed daylight, not a user-save session. Paused Canvas output was pixel-identical; every production render preserved serialized state. Native scene: [PNG](scene-native.png).

Local Chromium verification was attempted but could not start: sandbox denied its local socket; the one approved escalation attempt failed during sandbox initialization. **No browser or mobile acceptance is claimed, and neither is a development/ordinary-merge gate.** `tools/verify-animal-animation-browser.cjs` is retained for a compatible local environment.

Known pre-existing test-fixture failures are reported rather than hidden: deer-herds runs 16/20, with four flattened-map saves rejected because they retain a non-water main-river navigation path; deer-hunting reaches eight groups before the same invalid-fixture rejection. These reproduce on the unchanged baseline. Additional pasture fixture results are recorded in the PR; no gameplay validator is weakened to make tests pass. #87 remains open; this slice does not declare the entire A-style project accepted.
