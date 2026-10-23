'use strict';
// An authored playable starter save, built with the game's placement and save
// APIs. Rendering never invents inhabitants, production or walk routes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
global.window = global;
global.addEventListener = () => {};
global.document = { getElementById: () => null };
for (const name of ['core', 'defs', 'map', 'sim', 'fire', 'supply', 'main']) require(path.join(root, 'js', name + '.js'));
G.ui = { toast() {}, refreshHUD() {} };
const scene = process.argv[2] || 'river';
assert(['river', 'courtyard'].includes(scene), 'Usage: node tools/build-pixi-village.cjs [river|courtyard]');
const planName = scene === 'courtyard' ? 'courtyard-plan' : 'village-plan';
const plan = JSON.parse(fs.readFileSync(path.join(root, 'assets/pixi', planName + '.json')));
const config = { v: 1, preset: 'classic', seed: plan.seed };
const candidate = G.prepareNewGame(config);
G.game = candidate.game; G.rng = candidate.rng; G.setUid(candidate.nextUid);
G.world = G.emptyWorld(plan.seed, 3);
const w = G.world, [ox, oy] = plan.origin;
w.start = { x: ox + plan.focus[0], y: oy + plan.focus[1] };
w.citizens = candidate.world.citizens; w.cmap = candidate.world.cmap; w.families = candidate.world.families;
G.game.day = 14; G.game.season = 1; G.game.h = 10;
Object.assign(G.game.res, plan.stocks); G.reconcileFood(G.game);
G.game.townLedger = G.newTownLedger(G.game);
G.game.industryLedger = G.newIndustryLedger(G.game);

// The authored river crosses the complete map; its binary cells are serialized
// as authoritative terrain using the existing save format.
for (let y = 0; y < w.N; y++) for (let x = 0; x < w.N; x++) {
  const bank = oy + plan.river.y + plan.river.bend * Math.sin((x - ox) * .24);
  if (Math.abs(y - bank) < plan.river.width / 2) w.water[y * w.N + x] = 1;
}
for (let y = 1; y < w.N - 1; y++) for (let x = 1; x < w.N - 1; x++) {
  const i = y * w.N + x;
  if (w.water[i]) continue;
  if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.water[(y + dy) * w.N + x + dx] === 1)) {
    w.water[i] = 2; continue;
  }
  // Optional overlapping ellipses keep a compact clearing's edges irregular;
  // old plans retain their original forest layout byte for byte.
  const village = plan.villageBounds
    ? plan.villageBounds.some(([cx, cy, rx, ry]) => ((x - ox - cx) / rx) ** 2 + ((y - oy - cy) / ry) ** 2 <= 1)
    : x >= ox + 6 && x <= ox + 28 && y >= oy + 7 && y <= oy + 23;
  const grove = .11 + .10 * Math.sin(x * .31) * Math.cos(y * .27);
  if (!village && G.h2(w.seed + 89, x, y) < grove) G.addTree(w, x, y, -200);
  if (!village && w.treeIdx[i] < 0 && G.h2(w.seed + 91, x, y) > .994) w.rock[i] = G.h2(w.seed + 93, x, y) > .7 ? 2 : 1;
}
// Clear only the authored footprints/lanes, leaving the surrounding forest as
// genuine harvestable trees. No editor-only collision or scenery buildings.
function clear(x, y, width, height) {
  for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) {
    G.removeTree(w, xx, yy); w.rock[yy * w.N + xx] = 0;
  }
}
for (const [type, dx, dy, fw, fh] of plan.buildings) {
  const def = G.BDEF[type], x = ox + dx, y = oy + dy;
  clear(x, y, fw || def.w, fh || def.h);
  const result = G.addBuilding(type, x, y, { instant: true, free: true, ...(type === 'farm' ? { farmSize: [fw, fh] } : {}) });
  assert(result.ok, type + ': ' + result.reason);
  if (type === 'farm') {
    result.b.farm.forEach(f => { f.sown = true; });
    result.b.sownAll = true; result.b.growth = .62;
  }
}
for (const [a, b] of plan.roads) {
  const length = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  for (let n = 0; n <= length; n++) {
    const x = ox + a[0] + Math.sign(b[0] - a[0]) * n, y = oy + a[1] + Math.sign(b[1] - a[1]) * n;
    if (w.water[y * w.N + x] === 1 || w.bgrid[y * w.N + x] >= 0) continue;
    clear(x, y, 1, 1); G.setRoad(w, x, y, 1);
  }
}
for (const [dx, dy, age] of plan.gardenTrees) {
  const x = ox + dx, y = oy + dy, i = y * w.N + x;
  if (w.water[i] || w.road[i] || w.bgrid[i] >= 0) continue;
  if (w.treeIdx[i] < 0) G.addTree(w, x, y, age === undefined ? -200 : G.game.day - age);
  if (age !== undefined && w.treeIdx[i] >= 0) w.trees[w.treeIdx[i]].b = G.game.day - age;
}
assert.equal(plan.residentStarts.length, w.citizens.length);
for (let n = 0; n < w.citizens.length; n++) {
  const c = w.citizens[n], [dx, dy] = plan.residentStarts[n]; c.x = ox + dx; c.y = oy + dy;
  c.job = null; c.task = null; c.path = null; c.carry = null; c.state = 'idle'; c.camped = false;
}
// Five real starting families are assigned to five real houses.
G.assignHousing(); G.initializeDeer(w, G.game); G.scheduleJobs();
const save = JSON.parse(JSON.stringify(G.serializeGame()));
const loaded = G.prepareSaveData(save);
assert.equal(loaded.world.citizens.length, 15);
assert.equal(loaded.world.buildings.length, plan.buildings.length);
assert.equal(loaded.world.families.length, 5);
assert(loaded.world.families.every(f => loaded.world.bmap[f.houseId]?.type === 'house'));
for (const c of loaded.world.citizens) {
  const i = c.y * loaded.world.N + c.x;
  assert(G.surfaceAccess(loaded.world, c.x, c.y) && loaded.world.bgrid[i] < 0 && !loaded.world.rock[i] && loaded.world.treeIdx[i] < 0,
    'blocked resident start: ' + c.id);
  const house = loaded.world.bmap[loaded.world.families.find(f => f.id === c.familyId)?.houseId];
  assert(house && G.workSpot(loaded.world, house, c.x, c.y), 'resident cannot reach home: ' + c.id);
}
for (const b of loaded.world.buildings) {
  const c = loaded.world.citizens[0];
  assert(G.workSpot(loaded.world, b, c.x, c.y), 'unreachable building: ' + b.type);
}
const file = path.join(root, 'assets/pixi', scene + '-village.json');
fs.writeFileSync(file, JSON.stringify(save) + '\n');
console.log('Built playable village:', w.buildings.length, 'buildings,', w.citizens.length, 'people; save validation and paths passed.');
