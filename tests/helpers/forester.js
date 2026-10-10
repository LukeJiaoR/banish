'use strict';
const assert = require('node:assert/strict');
const { loadGame } = require('./playability');

// Frozen real-map reproduction, found by the specialist probe's thin-forest
// layout search. Terrain, tree ages and the two legal footprints are unchanged.
function forestFixture(root, { seed = 2, x = 66, y = 57, sx = 61, sy = 54, jobs = 4 } = {}) {
  const G = loadGame(root);
  G.world = G.genWorld(seed); G.game = G.newGameState();
  G.rng = G.makeRng((seed ^ 0x51f15e) >>> 0);
  const w = G.world;
  function place(type, x, y) {
    const d = G.BDEF[type];
    for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) G.removeTree(w, xx, yy);
    const result = G.addBuilding(type, x, y, { instant: true, free: true });
    assert.ok(result.ok, result.reason);
    return result.b;
  }
  const b = place('forester', x, y), storage = place('storage', sx, sy);
  const origin = G.nearestWalkable(w, storage.x - 1, storage.y - 1, 5);
  const citizens = [];
  for (let n = 0; n < jobs; n++) {
    const c = G.spawnCitizen({ ...origin, age: 25, sex: 'm' });
    c.job = b.id; b.workers.push(c.id); citizens.push(c);
  }
  return { G, b, storage, citizens, origin };
}

function thinForest(root, jobs = 4) { return forestFixture(root, { jobs }); }
module.exports = { thinForest, forestFixture };
