# Preserve carried stone and iron at full storage

## Reproduced loss and bounded correction

On the 0.3.16 baseline, 499 stored stone plus a worker carrying 10 became 500 stored and no carry: nine units disappeared. The same occurred for walking deliveries and finite surface deposits. The baseline fails the first new regression assertion.

Stone and iron now use one mineral delivery path at zero distance, ordinary arrival and the existing legacy no-warehouse compatibility fallback. Only the accepted amount is deducted from the original worker's existing carry. The worker holds at most that ordinary batch, takes no new task while carrying it, and retries after two game hours. A full warehouse requires no route search during retries. Unreachable storage keeps cargo and retries at the same bounded cadence. Removing a destination revalidates another completed warehouse before delivery. Actual walking is still required when a warehouse route exists.

Full mineral types keep their surface marks and deposits but do not start new extraction or reserve workers away from food. The other mineral type remains available. Review found and fixed a blocked-carrier scheduling edge: a miner holding full-storage cargo cannot satisfy the free-labour reservation for another mineral, count as a donor, or keep an empty productive job slot occupied. Releasing that blocked job preserves cargo; ordinary in-flight minerals keep their previous scheduling behavior. Already started extraction may finish and keep its one batch. Consumption or completion of another warehouse releases room. No warehouse capacity, stock, mineral yield, production multiplier or invisible stockpile is added. Existing above-cap stock is not clipped.

Cancellation, job changes, night/rest and save/load preserve the same carry. Runtime waiting state is rebuilt from the already-persisted carry; the save format does not change. Death deliberately retains the existing consequence: the citizen and their carried goods are lost, rather than remotely depositing cargo.

Citizen/harvest feedback and resource/production-target text distinguish waiting for capacity from ordinary idle/unreachable work, and explain using stock or building storage. A production target remains different from hard warehouse capacity.

## Scope and remaining limitation

This slice covers carried stone and iron, including mine output and surface deposits. Food, logs and firewood remain on the original overflow-delivery path and can still lose rejected excess. Tools remain uncapped. The previous all-resource backpressure candidate changed food delivery, population/random trajectories and failed normal survival cases; it is not included. Its pending broader correction must be separately tested rather than described as already solved.

## Validation

`tests/mineral-cargo.js` covers adjacent/walking/legacy partial delivery, finite extraction, capacity races, warehouse filling in transit, consumption/new-storage recovery, bounded/no-path retry, unreachable/reopened routes, removed warehouses, other-mineral availability, food-worker protection, cancellation/job/night/death boundaries and current/old saves. Existing farm tail, food/fuel delivery and production-goal regression suites remain required.

UI tests are DOM/read-only feedback contracts, not browser or real-phone acceptance. No deployment is part of this patch.
