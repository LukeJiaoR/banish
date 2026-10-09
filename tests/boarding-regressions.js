'use strict';
// Housing logic and save-codec fixtures; no economy tuning or browser acceptance.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
global.window = global;
global.addEventListener = () => {};
global.document = { getElementById() { return null; } };
for (const file of ['core', 'defs', 'map', 'sim', 'main']) require(path.join(root, 'js', file + '.js'));
let passed = 0, failed = 0;
function fresh() {
  const N = 50;
  G.world = { seed: 1, N, water: new Uint8Array(N*N), rock: new Uint8Array(N*N), road: new Uint8Array(N*N), bgrid: new Int32Array(N*N).fill(-1), treeIdx: new Int32Array(N*N).fill(-1), trees: [], rockCleared: [], marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 25, y: 25 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  G.ui = { toast() {}, refreshHUD() {}, hideInfo() {} };
}
function test(name, fn) {
  fresh();
  try { fn(); assertLodging(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function building(type, x=2, y=2, state='ok') {
  const def = G.BDEF[type];
  const b = { id: G.nextId(), type, x, y, w: def.w, h: def.h, state, workers: [], family: null };
  G.world.buildings.push(b); G.world.bmap[b.id] = b;
  for (let yy=y; yy<y+b.h; yy++) for (let xx=x; xx<x+b.w; xx++) G.world.bgrid[yy*G.world.N+xx] = b.id;
  return b;
}
function citizen(age=30, sex='m') { return G.spawnCitizen({ sex, age, x: 20, y: 20 }); }
function family(members, home=null) {
  const f = { id: G.nextId(), members: members.map(c => c.id), houseId: home ? home.id : null, coupleIds: [] };
  G.world.families.push(f);
  for (const c of members) c.familyId = f.id;
  if (home && home.type !== 'boarding') home.family = f.id;
  return f;
}
function assertLodging() {
  const w = G.world, members = w.families.flatMap(f => f.members);
  assert.equal(new Set(members).size, members.length, 'no duplicate family membership');
  for (const f of w.families) {
    const homes = w.buildings.filter(b => b.type === 'boarding' ? G.boardingFamilies(w, b).includes(f) : b.family === f.id);
    assert.equal(homes.length, f.houseId == null ? 0 : 1, 'one lodging per housed family');
    for (const id of f.members) {
      assert.equal(w.cmap[id].familyId, f.id);
      assert.equal(G.homeOf(w.cmap[id]), w.bmap[f.houseId] || null);
    }
  }
  for (const b of w.buildings.filter(b => b.type === 'boarding')) {
    assert.equal(b.family, null, 'boarding occupancy uses family houseId, not detached ownership');
    assert.ok(G.boardingFamilies(w, b).length <= G.LIFE.boardingCap);
  }
}

test('solo adult and two-person household both enter an empty boardinghouse', () => {
  const b = building('boarding'), solo = family([citizen()]), couple = family([citizen(), citizen(29, 'f')]);
  G.assignHousing();
  assert.equal(solo.houseId, b.id); assert.equal(couple.houseId, b.id);
  G.assignHousing();
  assert.equal(G.boardingFamilies(G.world, b).length, 2);
});
test('a child orphaned by both parents dying can enter a boardinghouse', () => {
  const b = building('boarding'), father = citizen(), mother = citizen(29, 'f'), child = citizen(7);
  child.parentIds = [father.id, mother.id];
  const f = family([father, mother, child]); child.birthFamilyId = f.id;
  G.killCitizen(father, '测试'); G.killCitizen(mother, '测试'); G.formFamilies(); G.assignHousing();
  assert.deepEqual(f.members, [child.id]); assert.equal(f.houseId, b.id);
  assert.equal(child.partnerId, null); assert.deepEqual(child.parentIds, [father.id, mother.id]);
});
test('a widowed single-person household can enter a boardinghouse', () => {
  const b = building('boarding'), husband = citizen(61), widow = citizen(59, 'f'), f = family([husband, widow]);
  f.coupleIds = [husband.id, widow.id]; husband.partnerId = widow.id; widow.partnerId = husband.id;
  G.killCitizen(husband, '测试'); G.formFamilies(); G.assignHousing();
  assert.deepEqual(f.members, [widow.id]); assert.equal(widow.partnerId, null); assert.equal(f.houseId, b.id);
});
test('capacity remains five families, with existing multi-person priority and no overflow', () => {
  const b = building('boarding'), solos = [family([citizen()]), family([citizen()])];
  const couples = Array.from({ length: 4 }, () => family([citizen(), citizen(29, 'f')]));
  assert.equal(G.LIFE.boardingCap, 5);
  G.assignHousing(); G.assignHousing();
  assert.ok(couples.every(f => f.houseId === b.id)); assert.equal(solos[0].houseId, b.id); assert.equal(solos[1].houseId, null);
  assert.equal(G.boardingFamilies(G.world, b).length, 5);
  const next = building('boarding', 10, 2); G.assignHousing(); G.assignHousing();
  assert.equal(solos[1].houseId, next.id); assert.equal(G.boardingFamilies(G.world, b).length, 5);
  assert.equal(G.boardingFamilies(G.world, next).length, 1);
});
test('new multi-person households cannot displace existing solo boarding residents', () => {
  const b = building('boarding'), residents = Array.from({ length: 5 }, () => family([citizen()], b));
  const newcomers = family([citizen(), citizen(29, 'f')]); G.assignHousing(); G.assignHousing();
  assert.ok(residents.every(f => f.houseId === b.id)); assert.equal(newcomers.houseId, null);
  assert.equal(G.boardingFamilies(G.world, b).length, 5);
});
for (const type of ['house', 'stonehouse']) test('solo household prefers a free ' + type + ' over boarding', () => {
  const b = building('boarding'), home = building(type, 10, 2), solo = family([citizen()]);
  G.assignHousing(); G.assignHousing();
  assert.equal(solo.houseId, home.id); assert.equal(home.family, solo.id); assert.equal(G.boardingFamilies(G.world, b).length, 0);
});
test('homeless households keep detached-house priority over boarding residents', () => {
  const b = building('boarding'), resident = family([citizen()], b), solo = family([citizen()]);
  const couple = family([citizen(), citizen(29, 'f')]), first = building('house', 10, 2);
  G.assignHousing();
  assert.equal(couple.houseId, first.id); assert.equal(solo.houseId, b.id); assert.equal(resident.houseId, b.id);
  const second = building('stonehouse', 14, 2); G.assignHousing();
  assert.equal(resident.houseId, second.id); assert.equal(solo.houseId, b.id);
});
test('solo boarding resident migrates to a detached home and returns after demolition', () => {
  const b = building('boarding'), solo = family([citizen()], b), home = building('house', 10, 2);
  G.assignHousing(); G.assignHousing();
  assert.equal(solo.houseId, home.id); assert.equal(G.boardingFamilies(G.world, b).length, 0); assertLodging();
  G.removeBuilding(home); assert.equal(solo.houseId, null); G.assignHousing(); G.assignHousing();
  assert.equal(solo.houseId, b.id); assert.equal(G.boardingFamilies(G.world, b).length, 1);
});
test('unfinished boarding, empty families and citizens without a family stay ineligible', () => {
  const b = building('boarding', 2, 2, 'site'), solo = family([citizen()]), empty = family([]), unassigned = citizen();
  G.assignHousing(); assert.equal(solo.houseId, null);
  b.state = 'ok'; G.assignHousing();
  assert.equal(solo.houseId, b.id); assert.equal(empty.houseId, null); assert.equal(unassigned.familyId, null); assert.equal(G.homeOf(unassigned), null);
  assert.equal(G.world.families.length, 2);
});
test('solo lodging survives the save codec and repeated assignment without using another slot', () => {
  const b = building('boarding'), solos = Array.from({ length: 6 }, () => family([citizen()]));
  G.assignHousing();
  const candidate = G.prepareSaveData(JSON.parse(JSON.stringify(G.serializeGame())));
  G.world = candidate.world; G.game = candidate.game; G.setUid(candidate.nextUid);
  G.assignHousing(); G.assignHousing();
  assert.equal(G.boardingFamilies(G.world, G.world.bmap[b.id]).length, 5);
  for (const f of solos.slice(0, 5)) assert.equal(G.world.families.find(loaded => loaded.id === f.id).houseId, b.id);
  assert.equal(G.world.families.find(f => f.id === solos[5].id).houseId, null);
});
console.log(`${passed} boarding scenarios passed; ${failed} failed`);
if (failed) process.exitCode = 1;
