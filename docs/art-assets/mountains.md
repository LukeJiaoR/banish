# Warm hand-painted mountain materials (0.3.75)

Scope: only the two new mountain material files and their shared ridge renderer. Original good buildings, trees, villagers, meadow, water, and shoreline are unchanged. Full warm-art standardization remains tracked in [#87](https://github.com/LukeJiaoR/banish/issues/87); this limited adoption does not claim that all materials or the generalized prompt family are stable.

## Reference and provenance

The user chose warm hand-painted art and the early house/storage batch as the quality benchmark. The original art documents were read and the actual `assets/buildings/house.png`, `storage.png`, `props/tree_mature.png`, `tree_mature_snow.png`, `props/rock_a.png`/`rock_b.png`, and `citizens/adult_idle.png` were inspected. The initial more photographic mountain candidates were rejected before publication.

Selected assets were generated with the built-in image generator, without a paid external service or borrowed game screenshot. Summer rock is the warm sample v0.1.0; winter rock is the sparse-snow sample v0.3.0. The latter uses the summer material as a reference rather than an exact pixel-preserving seasonal edit, so some stone arrangements differ. No claim of exclusive copyright is made.

| Runtime file | Format | SHA-256 |
|---|---|---|
| `assets/tiles/mountain_rock.png` | opaque RGB, 256×256 | `89c9eb686d133893107e6759b0f1d1b8ec3259009b8bb7e74fe785620ebe366e` |
| `assets/tiles/mountain_rock_snow.png` | opaque RGB, 256×256 | `aca76cb93616e3034458fb5d86734056bcd313aa45259d139b6bffd3fa94c718` |

- Summer generation ID: `exec-ee189966-8074-4c1b-957c-334976210ce9`.
- Winter generation ID: `exec-e816673b-ae74-434b-b21d-4c84fcfc5def`.
- Exact used prompts are [summer](prompts/mountain-warm-v1.txt) and [winter](prompts/mountain-winter-v3.txt). The separately drafted generalized mother prompt was not used verbatim by these calls and is not represented as tested here.
- Winter call image1: original house, SHA256 `41caf239c8d525b519397695f596e2536cb91526c53e9d201a2b56c0534583a6`; image2: selected summer runtime material, SHA256 `89c9eb686d133893107e6759b0f1d1b8ec3259009b8bb7e74fe785620ebe366e`. Summer used the previously inspected original references as visual context, not a supplied edit target.
- Each original output was1254×1254; one ImageMagick Lanczos resize and RGB export produced the runtime PNG. No procedural repainting, blur, recoloring, edge blending or whole-scene image replacement.

## Geometry and visible ownership

Material files are opaque flat top-down square surfaces. The renderer owns64×32,2:1 dimetric projection. Shared deterministic Float32 corner heights rise from3px at the outer footprint toward a bounded88px inner ridge. Height is visual only: the authoritative binary collision mask and saved terrain do not change. Continuous world-space material coordinates repeat every4 world cells.

The same top/side polygons drive drawing and pointer hit testing. There is no outward stroke expansion. A single exact top-polygon backing precedes the separate texture-triangle clips to prevent winter ground showing through their antialiased shared diagonal. Ordinary camera/culling transforms retain their flat inverse; pointer actions use the raised geometry inverse.

## Verification and limits

- Actual seed0/hard generated map, nearest ridge at camera scale1, and same-size summer/winter art fixtures were rendered with production Canvas functions. Original good sprites and all ground/water pixels were unchanged in final adoption views.
- Render/hit tests include shared vertices, exact blocked ownership, classic-map inverse, camera zooms, no mutation, low outer rim, exact backing polygon and exhaustive painter-order samples on a real map. New-game/save/build tests separately cover the gameplay contract.
- Texture edge mean RGB differences (0–255) are5.236/6.154 for summer and4.839/7.628 for winter. Relative to ordinary interior differences these are0.97/0.90 and0.86/1.03. Diagnostics support inspection, not a mathematical guarantee of seamlessness.
- Repetition can still be recognized over broad bare mountains; tile-aligned footprints remain intentional gameplay ownership. The scene is not represented as fully unified art. Unready grass/water variants stay out of this change, and old sprite cutout artifacts remain separately tracked under#87.
- Offline Canvas/DOM/simulation validation is not a browser, mobile, or production-deployment claim.
