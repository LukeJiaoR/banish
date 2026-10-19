# Mobile preview and HUD lanes

Presentation-only follow-up based on main `493694386339a63cc7a1236500c7cb6919c601a7`.

- At width ≤760px or height ≤500px, the building cost row is a single-line native disclosure, with actual shortages shown beside required quantities. Horizontally overflowing costs can be scrolled. Opening “详情” preserves the complete existing placement text, terrain validity, production warnings, and mineral risk. Updates preserve the disclosure and focused summary; a different tool resets it.
- At landscape width ≥761px and height ≤500px, survival guidance uses a 260px left lane; the build panel and placement preview start at x=282px. Build choices scroll vertically inside their right lane. The selected tool keeps a compact bottom panel.
- Compact-screen toasts use the bottom-left lane, up to 60px high and 10px above the bottom. The build toolbar ends 80px above the bottom; 140px of width is reserved for the single build-mode return button. In exploration, toasts instead sit 90px above the bottom, above both dock buttons; placement/road legacy selectors are explicitly overridden. This includes the “归园 · 经典开局” toast.
- Wide, tall desktop screens retain the full placement text. Simulation, costs, saves, icons, warm surfaces, and input/gesture rules are unchanged.

## Validation boundary

`node tests/mobile-occlusion.js` covers content, shortage arithmetic, stable disclosure/summary nodes, open-state preservation, tool-switch reset, and desktop open default. Existing targeted UI/placement tests are also run.

No browser geometry, screenshots, device touch, DPR, or real-phone acceptance is claimed for this slice. Chromium could not start in the current execution sandbox (socket permission), and the supported escalation failed during environment initialization. The dot cloud browser could not reach the local test server. These are infrastructure limitations, not passing visual checks.

The original resize/touch/44px fixes are now preserved from PR #113 (merge fc04040c7482b3d5c1e17d1550b382b85934855a). Its reported Chrome touch-emulation evidence is not a new browser run of this follow-up. A media-query change listener restores desktop disclosure visibility even while paused; it does not rely on `::details-content` browser support. Browser checks still needed: 390×844 and 844×390, DPR 2, opening/closing cost details, enough/missing materials, expand/collapse guide, repeated tool changes, toast presence, rotation, and desktop 1440×900.
