# Verification record

Scope: local DOM, static contracts and real simulation. Browser/zoom/touch acceptance is blocked and must be completed before merge.

## Independent review

Four identified issues were corrected and regression-tested: public herbs under physical supply, Tab traversal through goal summaries, live citizen health/diet disclosure, and paused-construction overview phase. Final reviewed js/ui.js SHA-256: `666f382b8a312be98eec60b59988844e7fb8e029b3220dea430216f95a16346a`. No remaining code-level finding; this is not visual acceptance.

## Primary suites

- New-village UI:59 suites; core:17; save/input:28
- HUD/checklist:16; detail readability:11; resource target UI:19
- Recommendation boundaries:10;6 explicitly applied one-year diagnostic runs; one full-year preview/baseline equivalence comparison
- Build affordability/icons/font contracts:15 groups; category cards:6
- Smoke:226; hauling:19; construction delivery:24; staffing:10; blacksmith input:13; personal tools:14
- New browser runner: syntax plus15-case matrix enumeration only

## Existing failures kept visible

These were not rewritten into passes or hidden by this batch. #108 separately maintains old fixtures; no commits from it were cherry-picked.

- `building-completion.js`: Timed out after150 seconds on both the batch and pristine main; no pass claimed.
- `farm-planning-ui.js`: Both fail: fixture lacks G.screenToMapTile.
- `harvest-range-ui.js`: Both fail: fixture lacks G.screenToMapTile.
- `harvest-cancel-ui.js`: Both report17 pass/8 failures: pre-existing DOM/input fixture drift.
- `fishing-water-ui.js`: Isolated batch and pristine main both fail the legacy placement-text regex after construction-delivery wording. Initial concurrent batch run was killed; isolated rerun reached the matching baseline assertion.
- `merchant-orders-ui.js`: Both fail the old three-food payment wording assertion; current six item wording is unchanged.
- `mineral-reserves-ui.js`: Both fail the legacy1080 stock expectation (actual1000).
- `orchard-renewal-ui.js`: Both fail old 未采果实17 wording against current 本季未采果实合计17.
- `resource-goals.js`: Both report26 pass/2 construction fixture failures missing required delivery state; engine source unchanged.
- `stockpile-ui.js`: Both fail the pre-existing missing stockpile detail after reload fixture assertion.
- `focused-building-state.js`: Still fails old50% construction-progress expectation against actual waiting-for-materials state. Only DOM API and renamed-action expectations adapted here; new focused-site regressions pass.

Initial broad run and pristine-main comparisons are in [verification.json](verification.json). The final frozen-code sweep ran65 selected scripts with65 passing; known failures above were excluded from that rerun and remain nonpassing. This is not a declaration that every repository test or remote CI is green.

## Final frozen-code rerun

65/65 selected scripts passed. This includes every passing baseline-selection script plus the updated icon fixtures and new detail/recommendation suites. The complete per-script result is in verification.json.

- `auto-trade-ui.js`: Automatic purchase UI: 16 DOM/live-simulation suites passed (not browser/mobile acceptance).
- `blacksmith-arrival.js`: Blacksmith arrival: 5 passed
- `blacksmith-input-ui.js`: Blacksmith input UI: 3 passed (DOM, not browser acceptance)
- `blacksmith-input.js`: Blacksmith input: 13 passed
- `boarding-regressions.js`: 11 boarding scenarios passed; 0 failed
- `build-affordance-ui.js`: Build affordability, mono resource icons and typography: 15 contract groups passed.
- `building-activity-ui.js`: Building activity UI: 9 DOM suites passed (not browser/mobile acceptance).
- `building-detail-navigation-ui.js`: Building detail navigation: 9 DOM/live-simulation suites passed (not browser/mobile).
- `category-cards-ui.js`: Category cards: 6 DOM/CSS suites passed (not browser layout or mobile acceptance).
- `cattle-pasture-ui.js`: Cattle pasture UI: 10 DOM/live-simulation suites passed (not browser/mobile).
- `cemetery-area-ui.js`: Cemetery area UI: 21 DOM/input suites passed; not browser/mobile acceptance.
- `cemetery-ui.js`: Cemetery UI: 7 passed (DOM only)
- `chapel-ui.js`: Chapel UI: 13 DOM suites passed (browser visual acceptance not performed).
- `chickens-ui.js`: Chicken UI: 20 DOM/live-simulation suites passed (not browser/mobile).
- `citizen-presentation.js`: Citizen presentation: 22 cases passed.
- `coal-heating-ui.js`: Coal heating UI: 7 passed (DOM only)
- `cold-squash-ui.js`: Cold squash UI: 8 DOM/live-state suites passed (not browser/mobile acceptance).
- `construction-delivery-ui.js`: Construction UI: 8 DOM/live-game suites passed (not browser/mobile acceptance).
- `construction-delivery.js`: Construction delivery: 24 passed
- `construction-priority-ui.js`: Construction priority UI: 4 passed (DOM only)
- `construction-staffing.js`: Construction staffing: 10 passed
- `crop-seeds-ui.js`: Crop seeds UI: 17 DOM and live-simulation suites passed (browser visual acceptance not performed).
- `deer-hunting-ui.js`: Deer UI: 8 DOM/live-game suites passed (not browser acceptance).
- `details-readability-ui.js`: Detail readability: 11 DOM/CSS suites passed (not browser/zoom acceptance).
- `early-beans-ui.js`: Early beans UI: 14 DOM and live-simulation suites passed (not browser/mobile visual acceptance).
- `early-harvest-ui.js`: Early harvest UI: 6 passed (DOM only)
- `family-clearing-regressions.js`: 24 family and clearing scenarios passed; 0 failed
- `farm-pests-ui.js`: Farm pests UI: 13 DOM and live-simulation suites passed (browser visual acceptance not performed).
- `fruit-brewing-ui.js`: 17 fruit/brewing UI contracts passed (DOM/live APIs; not browser or mobile visual acceptance).
- `fuel-input-ui.js`: Fuel input UI: 3 passed (DOM only)
- `goal-recommendations.js`: Goal recommendation boundaries: 10 passed, 0 failed.
- `hauling.js`: 19 economy regression scenarios passed
- `house-upgrade-ui.js`: House upgrade UI: 20 DOM/live-simulation suites passed (not browser/mobile acceptance).
- `household-supply-ui.js`: Household supply UI: 49 suites passed (headless DOM with real migration/save APIs; browser/mobile visual acceptance not performed).
- `housing-fire-ui.js`: Housing fire UI: 32 DOM/live-simulation suites passed (not browser/mobile acceptance).
- `hud-guidance-ui.js`: HUD and survival guidance: 16 passed (DOM/static only; browser acceptance separate)
- `map-size.js`: }
- `marked-reachability.js`: 6 marked reachability scenarios passed
- `mineral-resource-ui.js`: Mineral resource UI: 27 registry/markup contracts passed (headless only).
- `mountain-start.js`: Mountain starts: 23 passed (headless focused contracts; no browser or full-suite claim).
- `orchard-area-ui.js`: Orchard area UI: 53 DOM/live-simulation suites passed (not browser acceptance).
- `pasture-area-ui.js`: 56 pasture area UI contracts passed (DOM/live simulation, not browser visual acceptance)
- `pasture-pests-ui.js`: Pasture pests UI: 23 DOM/live-simulation suites passed (not browser/mobile).
- `pasture-split-ui.js`: Pasture split UI: 6 passed (DOM only)
- `personal-tools.js`: Personal tools: 14 passed
- `placement-ux.js`: Paused free placement invalidates the preview text cache.
- `reachable-meals.js`: 26 reachable meal checks passed
- `resource-chain-ui.js`: Resource chain UI: 7 interaction suites passed (DOM fixture; no browser visual acceptance).
- `resource-goals-ui.js`: Resource goal UI: 19 passed, 0 failed (DOM only).
- `road-plan-ui.js`: Road plan UI: 18 passed (DOM/event fixtures, not real browser/mobile acceptance)
- `road-work-ui.js`: Road-work UI: 37 DOM/input suites passed (not browser/mobile acceptance).
- `save-input-regressions.js`: Save/input regressions: 28 passed, 0 failed (DOM stubs only).
- `school-attendance-ui.js`: School attendance UI: 17 DOM and real-simulation suites passed (not browser/mobile acceptance).
- `smoke.js`: 全部通过: 226 passed, 0 failed
- `start-settings-ui.js`: Start settings UI: 59 DOM/live-simulation suites passed (not browser acceptance).
- `start-settings.js`: Start settings: 17 passed
- `tavern-ui.js`: Tavern UI: 11 DOM and live-simulation suites passed (browser visual acceptance not performed).
- `terrain-presentation.js`: Terrain presentation: 8/8 groups passed
- `town-hall-ui.js`: Town hall UI: 13 interaction suites passed (DOM fixture; browser visual acceptance not performed).
- `town-ledger-ui.js`: Town flow ledger UI: 9 suites passed (DOM fixture, actual summary/save APIs; browser visual acceptance not performed).
- `tunnel-ui.js`: Tunnel UI: 36 DOM/input suites passed (not browser/mobile acceptance).
- `ui_economy.js`: Wood exploration and autumn fuel warnings persist in the guide.
- `warm-coats-ui.js`: Warm coats UI: 22 DOM and live-simulation suites passed (browser visual acceptance not performed).
- `workforce-controls-ui.js`: Workforce UI: 14 DOM/live-simulation suites passed (not browser/mobile).
- `workforce-controls.js`: Workforce controls: 20 passed
