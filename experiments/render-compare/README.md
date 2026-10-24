# Canvas / Pixi incremental comparison experiment

Status (2026-10-21): source reviewed, unit-tested, and bounded offline Canvas reference-tested. **Browser/WebGL rendering and performance are not verified.** This is an isolated draft experiment; it is not enabled by `index.html`, merged, or deployed.

## Purpose and boundary

Evaluate a small renderer migration without replacing simulation or pretending that a renderer improves map generation.

- All implementation lives in `experiments/render-compare/`.
- Read the existing nine scripts (`core`, `defs`, `map`, `sim`, `fire`, `supply`, `sprites`, `render`, `main`) and the existing PNG files. None were edited. `source-manifest.json` fingerprints all those scripts and all source assets.
- Generate the supported mountain new-town fixture, with explicit seed, 128/192 size, summer/winter and paused daytime state. This is independent of the unsupported offline valley `mapVersion: -1` experiment.
- Freeze a copied world and game state, retaining shared object identity. Both measured adapters consume one immutable ordered draw list and the same camera and texture resources.
- The Canvas adapter is a **new shared-command comparison baseline**, not production `G.frame`. A separate production-reference pane calls the unchanged `G.frame` on a mutable presentation-only clone; it has a no-op lab UI adapter, fixed logical viewport, and no game initialization.
- The page dynamically loads production scripts after `DOMContentLoaded`, so `G.init` never executes. There is no simulation loop, save read/write, autosave, live game input, or feedback submission.

## Meaningful native rendering slice

1. Build the existing production ground/shore/mineral cache once per fixture. Request scale 0.5, allowing the existing 16-million-pixel budget to cap it for larger maps. The report records the actual scale.
2. Split that static cache into 512-pixel chunks with two-pixel sampling gutters. Each becomes a static Pixi texture/sprite. Ground generation, chunking, and its RGBA size are reported separately.
3. Render mountain faces as native `MeshGeometry` / `Mesh` objects with the existing contour vertices, world-anchored material UVs, backing and shade polygons.
4. Render trees, the starter cart, idle citizens, and deer as native sprites. Preserve scene depth order and shared world-space bounding-box culling.
5. Per frame, change camera transform and object visibility, then render. There is no per-frame Canvas drawing/upload to Pixi and no `source.update()` call in its frame path.

The ground cache is deliberately still Canvas-generated. This experiment evaluates the above-ground native slice and retained static chunks, not a fully GPU-generated terrain system.

## Dependency and primary sources

PixiJS **8.22.0**, explicitly **WebGL**, fixed 960×600 backing pixels, resolution 1. No package installation or production dependency was added.

- Official latest release verified on 2026-10-21: https://github.com/pixijs/pixijs/releases/tag/v8.22.0 (released 2026-10-01)
- Official API reference: https://pixijs.download/v8.22.0/docs/index.html
- Official application options: https://pixijs.com/8.x/guides/components/application
- Versioned MIT license: https://raw.githubusercontent.com/pixijs/pixijs/v8.22.0/LICENSE
- Release-linked CDN: https://cdn.jsdelivr.net/npm/pixi.js@8.22.0/dist/pixi.min.js

`pixi.lock.json` records the exact version, CDN URL, SHA256, SHA384 SRI, byte count, license and references. The page loads only that version and checks `PIXI.VERSION`. An unavailable or integrity-mismatched bundle fails visibly. No `latest` import, fallback renderer, security bypass, or dependency installation is used.

## Run locally

From the repository root:

```sh
python3 dev-server.py 8688
# Open http://127.0.0.1:8688/experiments/render-compare/
```

The static server must serve the repository root. The page needs access to the locked official CDN on first load. This module-based lab is not a `file://` page.

Use the same seed/season/map and switch camera presets. The shared Canvas and Pixi panes have identical physical viewport dimensions. The production-reference pane is visual context only. Its citizen rim/shadows remain present; snow particles are suppressed for the static reference.

## Test and evidence

No tool installs are needed. Unit tests use Node's standard library:

```sh
node experiments/render-compare/test.mjs
```

All **10 unit groups passed**:

1. Recorded production source and asset hashes unchanged
2. Immutable arrays, objects and Sets; preserved shared identity
3. Deterministic shared camera and closed pan/zoom path
4. Shared culling/counts and nonmutating statistics
5. Mountain UV affine endpoint interpolation
6. Seed 0, 128, summer: complete, stable immutable scene
7. Seed 42, 128, winter: complete, stable immutable scene
8. Seed 0, 192, summer: complete, stable immutable scene
9. Seed 42, 192, winter: complete, stable immutable scene
10. Ground-chunk coverage, gutters and allocation dimensions

The existing `@napi-rs/canvas` package can run a separate bounded reference check:

```sh
OFFLINE_RENDER_OUT=/tmp/banish-pixi-offline node experiments/render-compare/offline-check.mjs
```

Passed: a **synthetic 24×24 presentation microfixture**, summer and winter; actual production `G.frame` called twice in each case. Citizen `_psx` fields changed only on its presentation clone, while the shared frozen world/game remained unchanged. Four PNGs were produced: `microfixture24-s{1,3}-{shared,production}.png`. This synthetic size is a test-only fixture, not a supported new-game size or save format. The images are offline Canvas images, **not Pixi screenshots**.

Optional API compatibility check with a previously downloaded exact official bundle:

```sh
node experiments/render-compare/pixi-api-check.cjs /path/to/pixi-8.22.0.min.js
```

Passed against the locked bundle: actual Pixi texture/sprite/mesh construction, crop/flip handling, unchanged texture sources across frame calls, repeated disposal, and failed-initialization cleanup. The `Application` is stubbed. This **does not initialize WebGL or prove GPU output**.

A reproducible installed-Chromium harness is supplied:

```sh
node experiments/render-compare/browser-check.cjs /tmp/banish-pixi-browser
RUN_BENCHMARK=1 node experiments/render-compare/browser-check.cjs /tmp/banish-pixi-browser
```

Use `CHROMIUM_PATH` if necessary. An optional `PIXI_VERIFIED_CACHE` path supplies the exact official bundle to the test's CDN route only after its locked SHA256 is verified; browser SRI stays enabled. The page itself continues using the official pinned URL. The harness checks rendering, production reference, reconstruction 128→192→128, deterministic hashes, cancellation, and absence of storage access. It never installs a browser.

### Verified limits in this environment

- The Chromium binary is present, but the attempted launch stopped at a sandbox socket restriction before the page loaded.
- The sanctioned elevated execution route also failed before execution because its sandbox wrapper could not create a required file on a read-only restricted path. No security settings, wrappers or access restrictions were changed; no alternate bypass was attempted.
- A first full-map offline native Canvas run, following the large unit fixtures in the same process, was terminated with exit 137 before producing an image. The precise kill cause was not established; peak memory was not measured. It is not a full-map rendering pass. A separate small synthetic process then passed.
- Full 128/192 browser rendering, GPU memory, WebGL antialiasing/fidelity, texture limits, live mutation, context restoration, device performance, energy usage and mobile behavior remain unverified.
- There are **no benchmark results or speed-up claims** in this deliverable.

## Benchmark protocol, when a real browser can run it

The page runs one adapter at a time; the other pane and production reference are not rendered during its trial. Engine order alternates across repetitions. Each adapter receives exactly the same sample-index-based camera path. Warm-up traverses the same camera path and is excluded. The export includes raw JS submission times, rAF intervals, median/p95, visible command/triangle counts, coverage/camera hashes, world/scene hashes, actual renderer identity, setup/first-submit costs and texture byte estimates. Hidden-tab, cancellation and fixture failures invalidate the run. A rebuild clears old results before starting.

Interpretation:

- JS submission time does not wait for GPU completion.
- Texture byte estimates are input RGBA sizes only. They exclude the retained full ground cache, all decoded production images, mesh buffers and driver overhead.
- rAF intervals include browser scheduling, compositing and harness counting overhead; a headless software adapter is not representative device FPS.
- Scene construction, image decode/network, ground rebuilding and simulation are outside steady-state timing.
- The adapters intentionally omit citizen four-pass screen-space rims and ground ellipses. They support only a new paused town, not active farms, bridges/tunnels, effects, placements or arbitrary saved towns. Those omissions apply equally to both measured paths and are shown in the page/export.
- A positive result would justify a next integration experiment, not a wholesale renderer switch. Actual full-map browser fidelity and memory checks come first.
