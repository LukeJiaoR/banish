# Desktop build workspace: implementation and outstanding acceptance

## Scope

Resume of the preserved desktop candidate, rebased onto main `6f2611d58e9d6f617e272bfdd8bdeb55e914b068` (#118). The warming implementation in `js/main.js`, `js/sim.js` and `js/supply.js` is unchanged.

- Keep categories, selected building, status and confirmation in one 340px right workspace on desktop, with a scrollable complete catalog and visible tool names.
- Preserve compact top resource strip, guide chip, existing artwork and mobile bottom tray. No new art or simulation balancing.
- Distinguish all four road surfaces when switching/cancelling tools.
- Show variable cemetery planning rather than legacy fixed dimensions/cost.
- Keep short-height planning controls scrollable. Independent review found expanded mobile details were clipped by the scrolling tray; the panel is now explicitly in normal flow.

## Reference and visual limits

The unmodified [selected A image and itemized comparison checklist](ui-reference/README.md) are now versioned with this repository. The checklist separates UI acceptance, deliberate layout adaptations, and scene-art work.

The actual user-selected A image was inspected on 2026-10-21. Its landscape composition has a compact top strip, small guide chip, selected-building card on the right and quick choices at bottom left. This candidate intentionally consolidates the build catalog and next action on the right to address the user's cross-side workflow complaint. It is not an exact reproduction of A, and no fresh visual similarity pass is claimed.

Preserved screenshots and the prior 34-tool browser report predate the #118 rebase and the mobile fix. They are historical evidence only, not acceptance of this candidate.

## Checks on 2026-10-21

All following focused checks passed:

| Command (`node tests/<name>.js`) | Result |
| --- | --- |
| jade-layout-ui | 24 behavioral groups |
| desktop-workspace-ui | 5 structural groups |
| toolbar-inventory-ui | 6 groups; 34 tools and all 16 road pairs |
| building-placement-confirm | 48 groups |
| road-plan-ui | 26 |
| road-plan-actions | 7 |
| cemetery-area-ui | 21 |
| cemetery-area | 16 |
| navigation-ui | 10 |
| need-based-warmth | 31 |
| smoke | 226 |

`git diff --check` passed. Independent code review rechecked the mobile fix and found no remaining concrete blocker in the changed code. These are focused offline/DOM/structural checks, not the entire game suite and not browser geometry or hit-testing.

## Outstanding acceptance (not a merge blocker)

Fresh PC browser acceptance is **BLOCKED / NOT PASSED**. Opening the candidate's development server at `http://127.0.0.1:8641/` in the cloud browser returned `net::ERR_CONNECTION_REFUSED`. A separate executor call also could not reach the listening session's localhost. A local-file browser fallback was explicitly blocked by URL security policy; it was not bypassed.

The owner clarified on 2026-10-21 that PC/visual acceptance does not block ordinary merge. [PR #119](https://github.com/LukeJiaoR/banish/pull/119) was merged at `5710d96a93aa159e9ae67b799761f5924adb7962`; its final head was `67137be9e4f647afc466d7ae2b31d1ba51ef2b15`. The earlier draft-only merge gate is superseded. Fresh acceptance is still outstanding and requires a permitted reachable preview for PC checks: category browsing and all 34 tools, same-side selection/confirmation, valid and invalid placement, cancellation and repeated input, road surface switching, cemetery planning, management/resource access, and short-height scroll/hit-testing. Recheck mobile expanded details in that browser as a regression check. Save new screenshots and served-source hashes against the exact revision being tested; do not reuse historical screenshots as current evidence. Art issue #87 remains open; this work does not complete the full game or its art target.

## Final merged-head follow-up

The initial table above is the earlier candidate record. The merged head also contains the keyboard interruption regression fix (Jade coverage increased to 31 groups) and a statically checked browser acceptance harness. All 11 focused suites were rerun for the keyboard fix; harness checks included syntax, 15 enumerated viewport/reflow cases, selectors and focused directory/layout tests. The browser scenarios were not run. See #119 for the full final-head record. Reference archival changes only documentation and the original concept PNG; they do not establish new game/browser acceptance or deploy the game.
