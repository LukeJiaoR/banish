# Reachable household meals (#96)

## Pre-implementation contract

Only physical household provisioning changes. Automatic supply retains its daily public-food contract and the existing three nutrition groups and ration quantity.

A physical resident consumes at most one ration per calendar day, after reaching a current family home's valid entrance (or current family camp) and spending 0.25 simulated hours eating. This duration is a game adaptation. The same route planner chooses the fastest reachable entrance; movement uses the existing citizen movement loop and current cargo/winter speed. No distance cutoff rejects necessary meal journeys. No food is reserved or removed in transit: household and stock are rechecked at consumption.

Children and students walk but receive no production/hauling job. Studied hours remain untouched. Prefer idle/task boundaries; hungry workers may suspend normal work, including blocked delivery, using the existing pausedTask slot. Cargo stays on the same resident and resumes its existing destination contract after eating. Medical care, clinic service, immigration and firefighting are not preempted. No generic task stack is introduced. Current task replay is still not serialized; existing validated cargo reconstruction applies after load.

At midnight, strict physical residents are charged hunger only if the outgoing day had no meal. Meals reset hunger and update the existing nutrition fields when actually consumed. A persisted lastMealDay prevents double consumption across midnight and reload. Turning on physical supply starts strict rules and preserves the current automatic day's already-accounted ration.

Legacy physical saves without mealRuleVersion receive version 1, first-load day and fixed deadline first-load+8. Loading pauses, a persistent HUD notice explains the temporary old daily consumption and deadline. During those eight days old remote consumption still debits real household stock (never gifts food), while real meal journeys run. Duplicate same-day meals are forbidden. After the deadline there is no remote fallback; reloading cannot extend it. Automatic legacy saves are unchanged. Invalid version/deadline/day fields reject the whole load atomically.

Target loss, relocation, fire and topology changes replan to the resident's current legal home/camp, never an unrelated household. Failure releases the meal journey without touching cargo or suspended work and permits adult provisioning/retry. UI distinguishes no food, blocked route, travel, eating and completed daily ration; transition notice remains visible until expiry.

## Verification plan

Production-function regression: separated water/mountain wall cannot feed; restored access requires real movement. Cover children/student, boarding/camp, food conservation/three groups, sub-ration stores, midnight/reload, family relocation/fire, route invalidation, carried raw materials/produce/full-store delivery, emergency task protection, and fixed legacy transition. Run affected household, school, route, construction/cargo, save and DOM tests. Independent frozen-diff review before PR merge; disclose unavailable browser/CI separately.
