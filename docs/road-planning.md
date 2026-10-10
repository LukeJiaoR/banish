# Two-endpoint road planning

Select the road tool, choose a start and end with clicks or single-finger taps, then confirm the preview. Pointer movement does not paint roads. The planner prefers short, straight, few-turn routes and reuse of existing roads. Water, buildings (including fields) and mineral deposits block the route. It returns one connected four-neighbour route, not a Bresenham line with silently skipped blocked cells.

Routes are bounded to `ceil(Manhattan distance * 1.75) + 16` steps and 12,000 expanded search states (20,000 maximum for explicit test options). Positive length, turning, new-road and tree-clearance costs are used, with a shortest-path fallback sharing the same budget. This is a bounded practical route proposal, not a guarantee of globally optimal routing under all constraints. If the budget or detour limit prevents a route, the UI asks for closer segments; it does not clear obstacles automatically. Search only runs when an endpoint is selected, never on pointer movement or animation frames.

Current dirt roads have zero material cost, shown explicitly. The full preview is revalidated before confirmation, so a newly placed building/mineral obstruction rejects the whole route with no partial paving. Trees require a separate explicit confirmation that only creates ordinary felling marks. Workers cut and haul normal logs; once the tree cells are clear, the player confirms paving. Wood still has to arrive in storage before it counts as inventory. Cancelling a preview never retracts already-confirmed tree work. The existing harvest cancellation controls remain available for that purpose.

Each confirmation is bound to the route, action type and tree list visible when the pointer/key was pressed. If clearing needs change during the press, the UI requires another confirmation; holding Enter cannot silently advance from clearing to paving.

The panel uses persistent buttons with at least 44px target height. Modal, placement-panel and keyboard guards prevent map click-through. Tool changes, Escape/right-click, world replacement, blur and touch cancellation discard the transient preview. No road plans are saved. Existing direct `paintRoad` remains a legacy programmatic helper; the interactive road tool no longer uses its instant tree removal.

## Validation and limits

- `tests/road-planning.js`: connected routes, straight/few-turn layouts, existing roads, obstacles, clearance reporting, bounds, node budget and 60 fixed random grids compared with shortest-path reachability.
- `tests/road-plan-actions.js`: preview/cancel conservation, all-or-nothing obstacle validation, explicit clearance marks, mark queue cap, real chopping/hauling yield and stale-world/modal protection.
- `tests/road-plan-ui.js`: mouse and one-finger endpoints, drag cancellation, touch cancellation, persistent controls, modal/Escape/tool-change safety.
- VM synthetic 128/192/256 maps are profiling fixtures only. They do not enlarge actual maps or demonstrate phone FPS/battery usage. Route overlay drawing skips offscreen cells. Native touch event fixtures do not substitute for real phone testing.

Harvest rectangle/range selection is a following independent slice; this road change does not pretend to implement it. General mobile camera gestures are also outside this slice; current road taps do not add pinch-to-zoom or pan gestures.
