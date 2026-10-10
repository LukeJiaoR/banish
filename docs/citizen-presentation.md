# Citizen presentation regression (2026-10-10)

## Verified causes

- The existing adult, child and carrying PNGs face screen-right. The renderer previously mirrored them when the citizen moved right, reversing movement-facing.
- `adult_carry_walk_0..3` and `adult_carry_idle` were registered but never selected. Cargo was always anchored on the right, even when the body faced left.
- `adult_work_0` depicts tool work and `adult_work_1` depicts a basket pose. Alternating them as a single animation changes the whole pose. They now serve different task kinds, with a small work motion instead.
- `idle` is also used for ordinary task retry, missing inputs, production limits and unassigned labor. It is not, by itself, evidence of a deadlock. Citizen information now distinguishes these states using existing read-only checks. Carrying with no route remains visible as waiting for a reachable warehouse.

## Rendering contract

Facing follows the current path segment in projected screen space, including the first render and paused frames. Work faces the tree, field tile or building being worked on. Same-tile resource work is drawn four pixels beside the target; this is a presentation offset and does not change collision, routing, resource claims or production.

A resting citizen is rendered as inside only when all of these are true: the simulation explicitly set `camped === false`, the route has ended, their assigned home still exists and is complete, and their position is within its adjacent tile ring. The same pure helper excludes that invisible body from citizen hit-testing. Rendering and hit-testing each build at most one temporary family-to-home index, making each resident check O(1); the render index is only needed when an on-screen resident is resting. Off-screen citizens receive no rendering updates. Homeless people, distant campers, incomplete routes, demolished homes and old records without the flag remain visible. Idle or working people beside a home are never hidden. Actual home arrival still uses the simulation's nearest walkable perimeter tile, not the illustrated door; no new indoor path or door routing is claimed.

Missing carrying poses fall back to ordinary walking/idle sprites. Individual missing cargo or body images retain procedural fallbacks. Cargo anchors and images mirror with the person.

The current art is a right-facing view with horizontal mirroring, not eight-direction art. The existing walking frames also have small costume/body differences. Those asset improvements remain separate from this correctness fix.

## Verification

- `node tests/citizen-presentation.js`: 21 focused cases covering screen directions, path turns, pause, all carry resources/frames, sprite failures, work targets, indoor/outdoor distinctions, boarding, removed housing, dawn/night transitions, hit-testing and read-only status/render behavior.
- Existing README regressions remain applicable. No economic constants, simulation functions or save format changed.
- Offline before/after inspection used the actual `drawCitizen`, actual PNGs and Canvas 2D at 3× magnification. The fixture board is a rendering test, not a live browser screenshot or full visual-playtest claim.

## Known existing sprite fragments (outside this patch)

The full-scene offline render at seed 65 shows two pre-existing atlas-crop fragments. Direct inspection of each original PNG confirms that they are baked into the assets, not created by the citizen renderer:

- `assets/buildings/storage.png`: a detached blue roof triangle occupies its lower-right corner. At the normal warehouse scale it appears beside the warehouse's right/front edge.
- `assets/props/tree_mature.png`: detached leaf/ground fragments touch both upper corners of the image. They appear above mature trees, especially when enlarged.

The checked full-scene evidence is `/workspace/shared/banish-citizen-results/citizen-world-after.png`; the 3× character/resource fixture also shows the mature-tree fragments in its two tree-work panels: `/workspace/shared/banish-citizen-results/citizens-after.png`. These are offline Canvas outputs, not browser screenshots. Reproduce the defects by loading the named original PNGs at their existing `G.sprDraw` sizes, or running `G.frame` on a new seed-65 village. Asset cleanup is intentionally left for a separate change; neither PNG was modified here.
