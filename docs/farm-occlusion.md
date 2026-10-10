# Farm ground occlusion (0.3.13)

A user screenshot showed a large soil rectangle cutting across red house roofs. The original renderer passed an entire 8×8 farm through building depth sorting using its far corner. A legal field north of several houses could therefore paint all its ground after the houses.

The frame now draws visible farm soil directly after terrain and before upright objects. Each planted, unharvested crop cell enters the ordinary depth list individually. Farm cells outside the view bounds are skipped. The direct `drawFarm` helper remains available; the main frame no longer treats the entire field as one tall building. No new textures, offscreen buffers, simulation rules or save fields are introduced.

## Verification

`node tests/farm-occlusion.js` checks soil before all houses, seasonal snow selection, one crop draw per eligible cell, per-cell back/front ordering, offscreen culling and unchanged economic/farm state.

A native Node Canvas comparison used legally placeable, paid houses at (40,40), (42,40), (44,40) and a farm at (40,32) on a cleared visual fixture. Before: the field covers two roofs, matching the reported symptom. After: the roofs and chimneys remain visible; mature crops sort behind/around the houses. Bare soil, growing/ripe crops and zoom 0.55/1.5/2.6 were visually inspected, with all four soil seasons covered by render traces. Winter ripe crops are a rendering stress fixture, not a claim about normal seasonal farming.

This is code, render-trace and native Canvas validation, not real browser or phone acceptance. Per-visible-cell sorting adds one depth entry per standing crop instead of one per field; crop/soil draw counts remain at most one each per visible cell. No claim of measured phone FPS is made. Existing crop artwork scale and coast-edge appearance are unchanged.
