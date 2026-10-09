# Playability art completion (2026-10-09)

## Audit and delivered assets

The previous manifest contained no `blacksmith` or `hunting` building sprite. These buildings always fell back to plain geometric blocks. Iron and tools had no carrying sprites; iron used ordinary rock imagery with colored dots. Five building menu entries had only emoji. Existing seasons already include terrain, snow-covered vegetation/rocks and snowfall; a full seasonal building redraw is outside this targeted gap closure.

New original AI-generated art, made specifically for this project with OpenAI's built-in image generator:

| Runtime file | Size | Purpose |
|---|---:|---|
| assets/buildings/blacksmith.png | 512 × 469 | Distinct charcoal-roof forge, anvil and furnace |
| assets/buildings/hunting.png | 512 × 396 | Log lodge, antlers, bow and hide rack |
| assets/icons/res_iron.png | bounded 96 × 96 | Rust-veined ore; HUD and map rock |
| assets/icons/res_tools.png | bounded 96 × 96 | Crossed hammer and pickaxe |
| assets/citizens/carry_iron.png | bounded 64 × 64 | Carried ore |
| assets/citizens/carry_tools.png | bounded 64 × 64 | Carried tools |
| assets/icons/tool_{blacksmith,hunting,stonehouse,boarding,mine}.png | bounded 96 × 96 | Building menu thumbnails |

Menu thumbnails for existing stonehouse, boarding and mine derive from the repository's existing sprites; their source provenance is unchanged. Isolated sheet fragments in existing house and gatherer sprites were removed using the same connected-component principle as the repository's slicer. Their menu thumbnails were refreshed. Runtime art is committed under assets, with no dependency on transient generation paths or paid stock services.

Source/licensing: the four new subjects were generated originally for this project, not downloaded from stock libraries. No third-party stock license or attribution obligation was introduced. Existing project art was used as a style reference; this note does not claim exclusive copyright or alter the licensing of pre-existing assets.

## Integration

sprites.js registers every new asset and iron arrival invalidates the ground cache. render.js uses building sprites at footprint-relative widths, adds distinct iron ore and winter snowcap, and draws code-native cold/hunger badges. Cold/hunger citizen badges begin at half the respective lethal threshold; cold takes priority if both are active. Unheated winter homes show a snowflake. These are presentation only; no simulation or economic rules changed. Missing images still use the existing geometric fallbacks.

The integration owner adds ui.js menu mappings for the five new tool icons and may use res_iron/res_tools in the HUD. This art commit deliberately does not edit ui.js to avoid conflicting ownership.

## Generation prompts

Built-in image generation, transparent_background=true. Reference for both buildings: existing assets/buildings/gatherer.png, inspected before generation. No external style/art source.

- Blacksmith: single compact medieval timber/rough-stone workshop, charcoal tiled roof, large stone chimney, open orange forge, anvil and hammer. Match reference's warm painterly isometric two-sided view, upper-left lighting and diamond footprint; readable at 190px wide. Genuine transparent background; no labels, borders, people or smoke; fully in frame.
- Hunter lodge: single compact brown log cabin, reddish-brown wood shingle roof, antlers above entrance, bow/quiver at doorway, tan hide drying rack. Same warm painterly isometric reference style, 2:1 ground diamond and upper-left lighting; readable at 180px. No obstructing trees, people, animal bodies, labels or smoke; genuine transparency.
- Tools: tied bundle of one wooden-handled iron hammer and one iron pickaxe crossed. Dark steel-blue heads, strong highlights, brown handles, warm hand-painted medieval style. Compact readable silhouette at 24px; isolated genuine transparency, no text, ground or frame.
- Iron: three chunky unrefined iron ore pieces, dark blue-gray angular rocks with rusty mineral veins and silver highlights, distinguishable from beige stone. Warm hand-painted medieval isometric style, upper-left lighting. Compact readable 24px shape; transparent, no text, ground or frame.

Post-processing only crops transparent margins and resamples generated images for runtime; no programmatically drawn raster substitutes. A second hunter background-extraction attempt was inspected but not used: initial output already had zero alpha outside its silhouette (some viewers display RGB values hidden beneath alpha).

## Verification

- `node tests/art_assets.js`: 93 manifest PNGs exist, correct PNG signatures; all drawable toolbar buildings and all resource-carry sprites covered; load completion and iron cache invalidation; font-independent badge drawing.
- `node tests/smoke.js`: 224 passed on the art branch.
- `node --check js/render.js` and `node --check js/sprites.js`: passed.
- `python3 tests/art_assets.py`: dimensions, transparent perimeter, nonempty alpha and maximum runtime sizes for new assets.
- `building-scale-qa.png`: offline alpha-composited comparison at representative game display scale. Checked roof angle, warm palette, coherent silhouette and distinct forge/lodge identity. This is an asset contact sheet, not a live game screenshot or playtest.
- Browser integration and gameplay verification belong to the combined playability branch; not claimed by this art-only report.
