# Confirmed harvest ranges

Felling and surface-mineral tools now preview inclusive rectangular ranges rather than painting marks along the pointer's path. Drag with the mouse and release to freeze a proposal. On touch screens, tap two corners; one cell can also be confirmed after the first tap. A third tap starts a new proposal. Confirmation is separate from selecting or cancelling the preview.

The panel counts resource targets (trees, stone deposits, iron deposits), existing marks and new marks. These are not inventory or projected yield. Gold ground highlights are new targets; blue highlights are already marked targets. Food-forest boundaries and the warning about tree removal reducing food supply remain visible. Buildings may naturally occlude ground highlights; the counts remain available.

Confirmation calls the ordinary marking functions. Workers still claim, travel, cut/mine and haul with unchanged yields. Preview/cancel never changes stocks, trees, mineral deposits, jobs or cargo. The existing cancel-all-mark buttons are separate and retain their active/paused/cargo semantics. Manual marks remain independent of automatic production targets.

The original tree objects and mineral types are captured. Removed or replaced trees, changed mineral types and newly appearing resources are not silently added. Mineral deposits do not currently regenerate at the same tile; no persistent mineral identity system is introduced. A changed target list or a replaced preview during a button press requires a fresh confirmation. The live queue cap is checked before the whole batch: each class may contain at most 300 marks, with no partial truncation.

The rectangle outline is constant-size geometry while dragging. Targets are enumerated once when a range freezes. At most 601 target descriptors are retained; ranges exceeding 600 matching targets are rejected and must be narrowed, rather than retaining a whole-world object list. Preview status is refreshed at most four times per second between changes, while explicit actions revalidate immediately. Highlight drawing skips offscreen targets. No path search is added to rendering or selection; preview does not guarantee that every target is reachable, and existing dispatch feedback reports unreachable work.

Modal, panel, keyboard focus, tool/world changes, backgrounding and touch cancellation guard against stale actions. Persistent native buttons have at least 44px height. Real browser/phone usability, touch target layout, performance and battery remain unverified; DOM/event tests and Node Canvas images are not device acceptance. General mobile camera gestures are unchanged.

## Regression coverage

- `tests/harvest-range.js`: reverse/bounded/mixed/empty selection, identity changes, all-or-nothing queue caps, existing jobs/cargo, stale intent/world/modal, bounded retained targets and one-cell/two-corner flow.
- `tests/harvest-range-ui.js`: real registered input handlers, explicit confirmation, interrupted drags/touches, stale generations, modal/Escape/cancel, press races, held Enter, persistent focus and target size.
- `tests/harvest-cancel-ui.js`: previous cancellation and real mineral mining/hauling conservation retained, with the intentional new confirmation step added to input expectations.
- `tests/harvest-range-render.js`: inclusive diamond bounds, selected/existing colours, offscreen highlight culling, immutable render state and no render-time search/enumeration.
