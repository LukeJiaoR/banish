# Warm village UI skin

Presentation-only update on 96495b0. Simulation, save data, world artwork, input handlers, focus management and navigation state remain unchanged.

## Visual system

- Opaque tea-brown panels with a quiet painted-light gradient, restrained edge highlight and soft external shadow. No busy wood grain or texture downloads.
- Cream parchment construction cards, original full-colour icons in larger inset medallions, readable material labels and a terracotta shortage badge. Shortage never disables selection.
- Gold primary build action; raised secondary controls; inset pressed feedback without translating controls. Selected and pressed states have explicit cascade precedence.
- Solid inset inventory slots; warning/urgent surfaces remain distinct. Inspector headings, tabs, facts and footers use different surface levels.
- Phone construction categories use one horizontally scrollable row; detail tools remain scrollable. Short-height cards shrink to 76px. The existing explore/build/detail visibility model is unchanged.
- Shared tokens in `#hud` allow onboarding and other components to use the same surfaces. Skin is deliberately the last visual stylesheet; no `!important`, image filters or remote assets were added.

## Reference basis

Revisited the developer's actual portrait HUD image in [Pocket City 2's official November 2021 update](https://blog.pocketcitygame.com/pocket-city-2-progress-update/): map-first screen, a visually dominant Build action and labelled secondary destinations. The source explicitly marks this as work-in-progress, so it is a historical layout reference, not a current product claim. Colours and artwork are Banish's own treatment.

The [official Townsmen Mobile page](https://www.thqnordicmobile.com/en/games/townsmen-mobile/) was also checked; its inspected screenshot had no HUD and therefore was not used as evidence for interface structure.

## Checks performed in this batch

- `node tests/navigation-ui.js`: 10 transition groups passed (minimal DOM).
- `node tests/building-detail-navigation-ui.js`: 9 live-simulation/DOM suites passed.
- `node tests/placement-ux.js`: passed, including poor-stock preview and paused placement invalidation.
- `node tests/warm-skin.js`: static stylesheet/loading/contrast contracts passed. Five text/background pairs measured 4.88:1–7.74:1.
- tinycss2 parsed all 87 top-level rules and nested media blocks without syntax errors.
- `python tests/server_security.py` and `python tests/server_deployment.py`: passed, including HTTP 200 for the newly linked `styles/warm-skin.css`. Existing server allowlist already permits `styles/`; no permission expansion was needed.

## Verification boundary

The real-browser runner was attempted once in the current workspace. Chromium exited before page creation with `process_singleton_posix.cc: socket() failed: Operation not permitted`. No real game screenshots, physical-device/touch acceptance or rendered geometry claims are made. An optional self-contained static component preview is separate from the implementation and is not a game screenshot. No deployment or CI gate is part of this update.
