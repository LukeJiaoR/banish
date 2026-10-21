# Direct resource designation

## Reference and scope

Interaction reference: the official [Banished mod kit](https://shiningrocksoftware.com/game/mods/) and its [1.0.7 toolkit download](https://shiningrocksoftware.com/download/BanishedKit_1.0.7.170910.zip), in-game help for Remove Resources and Cancel Removal. The help distinguishes all resources, trees, stone and iron, red selection cells and orange X designations. Cancel Removal is a separate area operation; right mouse cancels the current operation. No original game assets are included in this patch.

The selected A image remains the visual reference for the existing ivory/jade UI. It is not an interaction specification. Direct release submission, continuous use of the selected tool and Esc are implemented for this game's requested workflow, not asserted as independently verified original-game details. Touch two-corner entry is this game's mobile adaptation.

## User flow

- Five separate tools: collect all resources, fell trees, collect stone, collect iron, cancel resource collection.
- Selecting a tool hides the construction workspace completely. Only a small instruction and Exit remain. There is no detail page, second confirmation, or cancel-all button.
- Eligible visible map cells have a light green cue immediately after tool selection. The current rectangle uses red cells. Releasing the left mouse button on the canvas applies the rectangle once. Repeated rectangles remain available in the same tool.
- Touch: first tap chooses a corner; second tap applies the inclusive rectangle. Two taps on the same cell select one resource. This is an adaptation, not a claim about original Banished mobile controls.
- Queued resources use original code-drawn orange Xs. Exit, right-click and Esc discard the current selection without withdrawing already-issued orders.
- Cancel collection withdraws only resource marks inside the selected rectangle. Unlike original Cancel Removal's broader scope, it does not cancel building or road demolition; that is intentionally outside this patch.

## Safety and simulation

All-resource selections validate both independent 300-order queues before changing either, so capacity failure never partially issues a rectangle. Stone and iron share the existing mineral queue. Empty/invalid rectangles clear their transient selection and report a short message.

Mouse cancellation, release over UI, mismatched buttons, middle-button interruption, tool/world/game replacement, blur, hidden page, Escape, touch movement, multitouch and touch release outside the canvas/over an overlay cannot apply a stale gesture.

Area cancellation uses the existing task cancellation semantics, restricted to selected indices: independent forester/construction-owned work and out-of-range tasks remain; active and paused free-labor resource claims in range are cancelled; delivered and carried goods, remaining raw resources and spent labor are not refunded or deleted. Save formats and production parameters do not change.

The visible catalogue changes from 34 to 37 tools: the combined mineral entry is replaced by all resources, stone, iron and cancel collection; trees remains. Legacy internal quarry API support is retained but is not a visible catalogue entry.

## Verification

Focused DOM/input/state/render-trace tests cover direct release, two taps, resource filtering, atomic queue limits, selected-area cancellation, no detail/confirmation UI, Exit/focus, all 37 tool routes and orange-X geometry. Existing task cancellation, placement, roads and smoke tests are also run. These checks are not live-browser layout or real PC/mobile gameplay acceptance; record actual run results separately.
