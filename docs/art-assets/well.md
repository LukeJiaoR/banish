# Compact well sprite

The old well artwork used a broad, shallow stone basin and nearly frontal red-tile canopy. In the village it read as a covered pool rather than a compact well. The replacement has a narrower circular stone shaft, visible rope and bucket, taller timber posts, and a roof closer to the neighboring buildings' isometric perspective.

Only `assets/buildings/well.png` changes at runtime. The transparent 320 × 256 canvas, bottom-center anchor, two-pixel lower margin, 160px rendering width, 2 × 2 footprint and all firefighting behavior remain unchanged. The visible silhouette is 180px wide in the source (90px on screen), rather than approximately 245px (122.5px on screen).

Source: original artwork generated using the built-in image tool, with the existing well as the edit target and the user's village screenshot as visual style reference. No screenshot pixels are included in the sprite. The output was cropped to the well silhouette and proportionally resized/padded for the existing runtime interface. No third-party stock artwork or additional runtime dependencies were introduced.

Prompt: compact deep circular medieval stone well, two timber posts, wooden winch, rope and bucket, modest red terracotta gabled roof aligned to the village's 2:1 isometric perspective; warm muted painterly pixel-game texture, upper-left light, transparent background; no terrain, people, snow, UI or text.

Verification: `python3 tests/well-art.py`; `node tests/housing-fire-render.js`; `node tests/housing-fire.js` (17); `node tests/housing-fire-ui.js` (32). The render regression executes the actual building renderer and checks the unchanged sprite routing, width and ground anchor. Offline old/new asset comparison was inspected at game scale alongside a house and an adult. This is not a browser screenshot or a full-game/mobile acceptance claim.
