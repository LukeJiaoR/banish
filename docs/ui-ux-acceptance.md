# UI/UX batch: implementation and acceptance boundary

Base: `main` at `421793ac1a6bd073b19e0df1b46e557efb0b43a1`. Independent of art candidates #98/#109 and regression-maintenance #108. No simulation-engine, scheduling, world-art, storage, construction-payment, or save-format changes.

## Changes

1. New-village dialog: fixed heading and action footer; independently scrolling settings; optional explanations folded. The second step always shows the unsaved-progress/automatic-save warning. Revision/world-bound intent, repeat-click protection, Escape, focus restoration/trap and manual-save preservation remain.
2. Building cards: readable material names and amounts, single-ink icons, and a live “缺料 · 可选址” badge. Opening a tool is free and possible without materials. `setTool → tryPlace → addBuilding` still requires sufficient **public stock** at the final location; creating the construction site neither debits nor reserves it. Workers subsequently fetch and deliver materials. Area/route plans continue to quote their actual variable cost.
3. HUD: fixed food/wood/stone/iron/iron-tools/firewood slots, including zero; More has a stable secondary order, scroll limit and warning count. Iron tools remain separate from steel tools. Public stock, mixed delivery transit, distributed supplies and equipped tools retain their separate meanings.
4. Survival checklist: red urgent, amber recommendation, gray state; at most three rows until expanded. Autosave protection has its own status line. Tool placement hides the checklist to avoid overlapping the preview.
5. Building inspector: consistent management titles, live phase/activity chips, folded legend/coordinates, fixed close/tab/action controls and scrolling content. Very short windows use a focused inspector sheet and temporarily hide surrounding HUD controls until closing.
6. Citizens: top survival summary and live health/diet/equipment information; present household stock first and remaining zero entries folded. Refresh preserves focus, drafts, disclosure state and body scroll.
7. Resource targets: all **20** registry entries in stock/target/gap columns. Edits and inheritance are drafts; applying validates every row before any target changes. Blank inherits; `0` stops new production. Total/specific food limits, the lower of workshop/town limits, hysteresis and accepted tasks are unchanged.
8. Separate read-only planning helper offers balanced/winter/food-stockpile drafts based on population, season, occupied housing and public capacity. Food-stockpile only changes the total-food draft. Existing individual food and workshop caps are explicitly retained. Capacity clipping, lower draft replacements and assumptions are disclosed; applying is explicit and does not promise winter survival.
9. Original single-ink SVG UI icons; visible text material costs; body text at least 12px and secondary labels at least 11px. Existing world artwork is unchanged.
10. Neutral clock replaces a rest-schedule-dependent sun/moon indicator. Work/rest timing is unchanged.

## Automated verification

See [verification results](ui-ux/verification.md). Tests are DOM/simulation/static-contract checks unless explicitly marked otherwise. They do not establish screenshot, touch, browser zoom, or physical-device acceptance.

The recommendation diagnostic uses two seeds, three modes and one 48-day year. Merely previewing suggestions each day produces the identical full-year outcome as the baseline. Six explicitly applied seasonal strategies preserve inventory and per-building limits; all reached day48 with zero deaths, hunger-days and unheated-home-days in this small controlled setup. These are observations, not a general guarantee. [Full diagnostics](ui-ux/recommendation-simulation.json).

## Real browser acceptance is blocked, not passed

The current VM can serve the repository with HTTP200 within the same process. Chromium exits before creating a page because its process-singleton socket is denied (`Operation not permitted`). The supported elevated launch fails during environment initialization. The existing cloud browser cannot reach this execution context's localhost (`ERR_CONNECTION_REFUSED`). No security restriction was bypassed, tunnel opened, production deployment made, or user computer used.

Consequently this batch must remain a **Draft PR** until the following browser checks run and any findings are fixed. There are no current-batch browser screenshots or visual acceptance claims.

## Reproducible browser runner

Requires installed Playwright and a launchable Chromium in the same environment as this checkout:

```sh
node tests/ui-ux-browser.cjs --list
node tests/ui-ux-browser.cjs --out /tmp/banish-ui-browser
```

The runner starts a local static server, uses isolated browser contexts, does not submit feedback, and writes screenshots plus `results.json`. `CHROMIUM_PATH` and `BANISH_QA_PORT` may select the installed executable and a free local port. Its syntax and 15-case matrix enumeration were checked; the browser scenario itself has **not run** here.

Dimensions: 1440×900, 1024×640, 1280×600, 390×844 and 844×390. Each has 100%, 125% and 150% equivalent reflow cases (CSS viewport divided by zoom; matching DPR). This checks layout reflow, not the browser's native zoom controls. Separately repeat 125% and150% with actual browser zoom and record the resulting viewport.

For each size inspect the captured pixels as well as geometry assertions:

- New village: edit seed/preset/terrain/map, scroll both ways, expand details, review, return, cancel and reopen. Warning, final action and cancel remain reachable. Repeated confirm creates one village. Escape/Tab/Shift+Tab remain inside or restore focus correctly; refresh does not reset text selection or scroll.
- HUD: all six core resources remain at zero; More is scrollable, stable and keyboard reachable. Collapsing restores focus and leaves a meaningful warning count. Check automatic and physical supply, iron/steel, full warehouses and exhausted clothes.
- Checklist: urgency order and maximum3; All/Collapse preserves focus. Autosave warning is separate. Build/road/harvest preview does not overlap toolbar/checklist.
- Build: pick an unaffordable house, inspect its cost and preview; insufficient public materials prevent final placement. Sufficient public stock creates exactly one site without pre-debit; site workers still haul the materials.
- Targets: twenty resources, public/distributed detail, invalid draft rejects whole batch, blank versus zero, all three presets remain drafts, explicit apply, cancel/close, repeat clicks and keyboard traversal through native details summaries.
- Building and citizen inspectors: long content scrolls while close/actions stay reachable. Switch tabs, pause/resume, complete/cancel a site, and change selected entities. Live status, health/diet and inventory agree without replacing focused inputs or closing disclosures.
- Phone portrait/landscape: test touch scrolling/selection and no horizontal page overflow. Check long resource values and labels. Confirm short-window sheet hides surrounding controls and restores them on close.

Any failed assertion, clipped control, contradictory live fact or keyboard trap blocks acceptance. Rerun the affected cases after changes; then independent review and final regression must pass before marking ready/merging. No deployment is included.
