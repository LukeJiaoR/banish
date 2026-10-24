# River-valley map experiment

This is an **offline, opt-in developer prototype**, not a selectable new-game mode.
Nothing in `index.html`, `G.genWorld`, start configuration, simulation, saved terrain or
versions 0/1/2/3 is changed. The experimental world uses unsupported mapVersion -1
and must not be serialized as a playable save. Run the commands below explicitly.

## What changes

A continuous meandering main river and one joining tributary establish the valley
first. Foothill masks depend on distance from that river and coarse ridge fields;
forest density follows moisture and foothills with broad clearings. Mineral patches
are sparse rather than filling every eligible cell. This is a river-first composition
algorithm, **not erosion, a physically downhill drainage solver, or a reconstruction
of the original Banished generator**. The diagnostic elevation array informs the
mountain mask; the production renderer still owns its existing raised-mountain faces.

The start is selected on an already dry natural bank. No 41×37 terrain clearing or
fixed rectangular pond is used. Water/mountain arrays are unchanged during start
preparation. Only trees/rocks within the proposed 3×3 warehouse footprint are removed.
A separate land flood excludes that solid footprint, mountains and water while allowing walkable sand. At most
three new stone deposits, three iron deposits and 32 mature trees are added to real
reachable cells when the local natural supply is insufficient; no inventory is given.
All repairs are reported. These amounts are a bounded prototype availability floor,
**not the first-winter material budget, preserved gatherer-grove proof, dock suitability,
five-house footprint proof or completed survival acceptance**. Do not expose this
mode to normal new-game selection until those contracts are integrated and tested.

## Reproduce

From the repository root:

```
node experiments/valley/test.cjs /tmp/valley-tests.json
node experiments/valley/render.cjs /tmp/valley-renders
```

Rendering requires the optional `@napi-rs/canvas` dependency already used by the
repository's offline drawing tools. Neither command contacts a server, starts the
browser, invokes an image service, installs a package or writes a game save.

The generator accepts 128, 192 and diagnostic 384 maps. 384 is not added as a normal
new-game option. Fixed and boundary seeds are exercised at all three sizes. Tests
repeat complete worlds, independently flood the water cells, check terrain/resource
exclusivity and validate the reported mineral targets using the real game pathfinder
with a real solid storage object and occupied nine-cell footprint. An exact water-adjacent shoreline target is independently checked with real walking edges. Both old genWorld
options and mountain v2 remain registered exactly as before; the experiment is not.

## Visual evidence

`evidence/overview.png` shows six fixed seeds. For each seed, the top pair is the
current mountain generator (left) and this prototype (right), at identical overview
scale; red boxes mark starts. This is a labeled schematic map, not game artwork.
Below is a production Canvas view of the prototype using existing runtime PNGs,
without invented buildings or a played settlement. Its aspect ratio is preserved.
`evidence/render-report.json` binds the generator hash and world diagnostics.

Pixel inspection rejected the first version's dense mineral carpets; the current
version thins them while retaining clusters. The continuous river/valley composition
and removal of the rectangular start are visible. Existing repeated mountain/water
materials, low-detail distant trees, sparse town context and dominant long river
orientation remain visible. The one-tributary topology is still deliberately narrow;
All six examples retain a similar sinusoidal-river/broad-mountain topology; regular forest spacing and repeated mountain textures remain obvious. This is not complete valley geomorphology or final playable visual quality. More terrain families are future work, not claimed completed here. No original-game
art is copied and no whole-scene/A-reference equivalence is claimed.

These are offline production-renderer images, not screenshots of browser interaction,
a played save, real PC/mobile acceptance or physical-device performance. Current UI
artwork, right-side building workflow and direct map resource selection are untouched.

## Cost and remaining gates

`evidence/tests.json` contains single-run Node timings alongside the 24 fixed cases.
They are diagnostics, not an engine comparison or FPS guarantee. They are not a
performance pass/fail threshold. The algorithm uses O(N²) arrays, a flood and sorted
start/resource candidates; browser main-thread startup should be profiled before
runtime adoption. Current Canvas full-ground-cache and material limits still apply.

Before runtime adoption: multiple-seed playable economy/resource budgets and natural
buildable footprints; shoreline/dock/bridge contracts; robust new-version save/load;
actual browser and mobile input/performance; fresh same-state reference comparisons.
A separate Pixi renderer trial must use the same world/camera/assets and measure
cost independently. This experiment itself neither installs nor migrates an engine.
