/* Save transaction and keyboard regressions. DOM stubs, not visual/browser acceptance.
 * Run: node tests/save-input-regressions.js [checkout]
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

function eventTarget(extra = {}) {
  const handlers = {};
  return Object.assign({
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    emit(type, values = {}) {
      const event = Object.assign({ key: '', target: this, preventDefault() { this.defaultPrevented = true; } }, values);
      for (const fn of handlers[type] || []) fn(event);
      return event;
    },
  }, extra);
}
function element(tag = 'DIV') {
  const classes = new Set(['hidden']);
  return eventTarget({ tagName: tag, style: {}, isContentEditable: false,
    classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); }, toggle(v, force) { const on = force === undefined ? !classes.has(v) : force; if (on) classes.add(v); else classes.delete(v); } },
    querySelectorAll() { return []; }, querySelector() { return null; }, focus() {}, getBoundingClientRect() { return { left: 0, top: 0 }; }, getContext() { return {}; },
    closest() { return null; },
  });
}
function fixture(options = {}) {
  const store = new Map();
  const els = new Map();
  const doc = eventTarget({ visibilityState: 'visible', activeElement: null, getElementById(id) { if (!els.has(id)) { const el = element(id === 'game' ? 'CANVAS' : 'DIV'); el.id = id; el.focus = () => { doc.activeElement = el; }; els.set(id, el); } return els.get(id); } });
  const ctx = eventTarget({ console, document: doc, innerWidth: 1000, innerHeight: 700,
    localStorage: { getItem(key) { return store.get(key) || null; }, removeItem(key) { store.delete(key); }, setItem(key, value) { store.set(key, String(value)); } },
    performance: { now() { return 0; } }, setInterval() {}, setTimeout() {},
    requestAnimationFrame(fn) { ctx.nextFrame = fn; }, location: { protocol: 'file:' },
  });
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'ui', 'main']) vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G;
  Object.assign(G.ui, { init() {}, toast() {}, refreshHUD() {}, hideInfo() { G.sel = null; }, setToolActive() {}, tickInfo() {}, renderSaves() {} });
  G.ui.el = { help: doc.getElementById('help'), info: doc.getElementById('info') };
  G.feedback = { init() {}, close() { doc.getElementById('fb').classList.add('hidden'); } };
  G.T2S = () => [0, 0]; G.cam = { x: 500, y: 350, z: 1 }; G.groundDirty = new Set(); G.markGroundDirty = () => {};
  if (!options.realAutosave) G.autosave = () => {};
  G.frame = () => {}; G.screenToTile = (x, y) => ({ tx: x, ty: y });
  if (!options.skipNewGame) G.newGame(731);
  return { G, ctx, doc, els, store };
}
function snapshot(G) { return JSON.parse(JSON.stringify(G.serializeGame())); }
function roadCoords(w) { return Array.from(w.road).flatMap((road, i) => road ? [[i % w.N, Math.floor(i / w.N)]] : []); }
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

test('roads survive save and load at the same tile coordinates', () => {
  const { G } = fixture();
  G.world.road[5 * G.world.N + 7] = 1; G.world.road[6 * G.world.N + 7] = 1;
  const saved = snapshot(G); G.applySaveData(saved);
  assert.deepEqual(roadCoords(G.world), [[7, 5], [7, 6]]);
});
test('road and mark indices remap across sizes without wrapping outside rows', () => {
  const { G } = fixture(); const d = snapshot(G);
  d.N = 256; d.roads = [5 * 256 + 7, 5 * 256 + 129, 150 * 256 + 7];
  d.marked = [4 * 256 + 8, 4 * 256 + 129]; d.rockCleared = [3 * 256 + 9, 3 * 256 + 129];
  G.applySaveData(d);
  assert.deepEqual(roadCoords(G.world), [[7, 5]]);
  assert.deepEqual(Array.from(G.world.marked), [4 * G.world.N + 8]);
  assert.deepEqual(Array.from(G.world.rockCleared), [3 * G.world.N + 9]);
});
test('76-tile saves expand to the current map without shifting roads', () => {
  const { G } = fixture(); const d = snapshot(G); d.N = 76;
  d.trees = d.trees.filter(row => row[1] < 76 && row[2] < 76);
  d.roads = [2 * 76 + 3, 75 * 76 + 75]; d.marked = [5 * 76 + 4];
  G.applySaveData(d); assert.deepEqual(roadCoords(G.world), [[3, 2], [75, 75]]);
  assert.ok(G.world.marked.has(5 * G.world.N + 4));
});
test('legacy saves with no road field load as an empty road network', () => {
  const { G } = fixture(); const d = snapshot(G); delete d.roads;
  G.world.road[5] = 1; G.applySaveData(d); assert.deepEqual(roadCoords(G.world), []);
});
for (const [name, damage] of [
  ['unknown building', d => { d.buildings[0].type = 'not-a-building'; }],
  ['out-of-map building', d => { d.buildings[0].x = -1; }],
  ['duplicate building ID', d => { d.buildings.push({ ...d.buildings[0], x: d.buildings[0].x + 4 }); }],
  ['truncated farm', d => { d.buildings.push({ id: 999, type: 'farm', x: 10, y: 10, state: 'ok', workers: [], farm: [[1, 0]] }); }],
  ['late corrupt farm cell', d => { const farm = Array.from({ length: 64 }, () => [1, 0]); farm[63] = null; d.buildings.push({ id: 999, type: 'farm', x: 10, y: 10, state: 'ok', workers: [], farm }); }],
  ['invalid parent record', d => { d.citizens[0].parentIds = 'not IDs'; }],
  ['invalid resource', d => { d.game.res.food = 'not food'; }],
  ['invalid date', d => { d.game.day = -10; }],
  ['invalid road index', d => { d.roads = [Infinity]; }],
  ['missing citizens', d => { delete d.citizens; }],
]) test('rejected ' + name + ' leaves the live game untouched', () => {
  const { G } = fixture(); const d = snapshot(G);
  G.game.paused = true; G.game.speed = 5; G.game.h = 18;
  const world = G.world, game = G.game, res = game.res, rng = G.rng, uid = G._peekUid();
  const before = snapshot(G); const sel = G.sel = { kind: 'b', id: world.buildings[0].id }; G.tool = { kind: 'road' };
  damage(d);
  assert.throws(() => G.applySaveData(d));
  assert.ok(G.world === world, 'live world reference changed'); assert.ok(G.game === game, 'live game reference changed'); assert.ok(G.game.res === res, 'resource reference changed'); assert.ok(G.rng === rng, 'RNG changed');
  assert.equal(G._peekUid(), uid); assert.equal(G.game.paused, true); assert.equal(G.game.speed, 5); assert.equal(G.game.h, 18);
  assert.equal(G.sel, sel); assert.equal(G.tool.kind, 'road'); assert.deepEqual(snapshot(G), before);
});
test('successful load owns its arrays and respects an open pause dialog', () => {
  const { G, doc } = fixture(); const d = snapshot(G);
  G.game.paused = true; doc.getElementById('saves').classList.remove('hidden');
  G.applySaveData(d); assert.equal(G.game.paused, true);
  d.game.res.food = -100; d.families[0].members.length = 0; d.buildings[0].workers.push(999);
  assert.ok(G.game.res.food >= 0); assert.ok(G.world.families[0].members.length); assert.ok(!G.world.buildings[0].workers.includes(999));
});

test('new family identities, construction payment and work state round trip', () => {
  const { G } = fixture(); const before = snapshot(G); const b = G.world.buildings[0];
  b.paidCost = { wood: 12 }; b.constructionStarted = true;
  G.applySaveData(snapshot(G));
  assert.equal(G.world.buildings[0].paidCost.wood, 12); assert.equal(G.world.buildings[0].constructionStarted, true);
  for (const citizen of before.citizens) {
    const loaded = G.world.cmap[citizen.id];
    for (const field of ['partnerId', 'birthFamilyId']) assert.equal(loaded[field], citizen[field]);
    for (const field of ['parentIds', 'grandparentIds', 'ancestorIds']) assert.deepEqual(Array.from(loaded[field]), citizen[field]);
  }
});
for (const backupFails of [false, true]) test('corrupt startup autosave opens a protected town' + (backupFails ? ' even if backup is blocked' : ''), () => {
  const { G, ctx, store } = fixture({ skipNewGame: true, realAutosave: true });
  const broken = '{"game": { "res": "broken" }}'; store.set(G.AUTOSAVE_KEY, broken);
  if (backupFails) { const set = ctx.localStorage.setItem; ctx.localStorage.setItem = (key, value) => { if (key.startsWith(G.RECOVERY_SAVE_KEY)) throw new Error('quota'); set(key, value); }; }
  let deletes = 0, mirrors = 0; G.deleteServerSaveQuiet = () => { deletes++; }; G.saveToServer = () => { mirrors++; return Promise.resolve(); };
  G.init(); assert.ok(G.world && G.world.buildings.length); assert.equal(G.autosaveBlocked, true);
  assert.equal(store.get(G.AUTOSAVE_KEY), broken); assert.equal(deletes, 0);
  if (!backupFails) assert.equal(store.get(G.RECOVERY_SAVE_KEY), broken);
  G.autosave(); G.saveGame(G.AUTOSAVE_KEY, true); assert.equal(store.get(G.AUTOSAVE_KEY), broken); assert.equal(mirrors, 0);
  G.saveGame(); assert.ok(store.has(G.SAVE_KEY), 'manual save remains usable');
  G.applySaveData(snapshot(G)); assert.equal(G.autosaveBlocked, backupFails, 'failed backup never enables destructive autosave');
  G.newGame(731); assert.equal(G.autosaveBlocked, false); assert.equal(deletes, 1);
});

const input = fixture(); input.G.init();
const { G, ctx, doc } = input;
function resetInput() { for (const id of ['help', 'fb', 'saves', 'errs', 'over']) doc.getElementById(id).classList.add('hidden'); G.keys = {}; G.game.paused = true; G.game.speed = 1; doc.activeElement = null; }
for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'CONTENTEDITABLE']) test(tag + ' typing never controls speed, pause, help or camera', () => {
  resetInput(); const target = element(tag === 'CONTENTEDITABLE' ? 'SPAN' : tag); target.isContentEditable = tag === 'CONTENTEDITABLE'; doc.activeElement = target;
  for (const key of ['w', 'a', 's', 'd', 'ArrowUp', ' ', '1', '2', '3', '?']) ctx.emit('keydown', { key, target });
  assert.equal(G.game.paused, true); assert.equal(G.game.speed, 1); assert.ok(!Object.values(G.keys).some(Boolean));
  assert.ok(doc.getElementById('help').classList.contains('hidden'));
});
test('modal keys cannot move the camera or resume the game; Escape closes help first', () => {
  resetInput(); G.tool = { kind: 'road' }; G.ui.toggleHelp(true);
  for (const key of ['w', 'ArrowUp', ' ', '3']) ctx.emit('keydown', { key });
  assert.equal(G.game.paused, true); assert.equal(G.game.speed, 1); assert.ok(!Object.values(G.keys).some(Boolean));
  ctx.emit('keydown', { key: 'Escape' }); assert.ok(doc.getElementById('help').classList.contains('hidden')); assert.equal(G.tool.kind, 'road');
});
test('holding Space toggles pause once, and modifier shortcuts do not control the game', () => {
  resetInput(); ctx.emit('keydown', { key: ' ' }); assert.equal(G.game.paused, false);
  ctx.emit('keydown', { key: ' ', repeat: true }); assert.equal(G.game.paused, false);
  ctx.emit('keydown', { key: '3', ctrlKey: true }); assert.equal(G.game.speed, 1);
});
test('blur, hidden document and focus changes clear held movement', () => {
  resetInput(); ctx.emit('keydown', { key: 'w' }); assert.equal(G.keys.w, true);
  ctx.emit('blur'); assert.ok(!G.keys.w);
  ctx.emit('keydown', { key: 'd' }); doc.visibilityState = 'hidden'; doc.emit('visibilitychange'); assert.ok(!G.keys.d); doc.visibilityState = 'visible';
  ctx.emit('keydown', { key: 'a' }); const target = element('INPUT'); doc.emit('focusin', { target }); assert.ok(!G.keys.a);
});
test('Tab and Shift+Tab stay inside the topmost dialog', () => {
  resetInput(); const modal = doc.getElementById('fb'); modal.classList.remove('hidden');
  const first = element('TEXTAREA'), last = element('BUTTON');
  first.focus = () => { doc.activeElement = first; }; last.focus = () => { doc.activeElement = last; };
  modal.querySelectorAll = () => [first, last];
  let event = ctx.emit('keydown', { key: 'Tab' }); assert.equal(doc.activeElement, first); assert.equal(event.defaultPrevented, true);
  event = ctx.emit('keydown', { key: 'Tab', shiftKey: true }); assert.equal(doc.activeElement, last); assert.equal(event.defaultPrevented, true);
  event = ctx.emit('keydown', { key: 'Tab' }); assert.equal(doc.activeElement, first); assert.equal(event.defaultPrevented, true);
  event = ctx.emit('keydown', { key: 'Enter', target: first }); assert.ok(!event.defaultPrevented, 'form Enter keeps its native behavior');
});
test('help pauses reading and repeated open/close preserves the prior pause', () => {
  resetInput(); G.game.paused = false; G.ui.toggleHelp(true); assert.equal(G.game.paused, true);
  G.ui.toggleHelp(true); G.ui.toggleHelp(false); assert.equal(G.game.paused, false);
  G.game.paused = true; G.ui.toggleHelp(true); G.ui.toggleHelp(false); assert.equal(G.game.paused, true);
  G.game.paused = false; G.ui.toggleHelp(false); assert.equal(G.game.paused, false);
});
test('Escape cancels a tool when a toolbar button keeps keyboard focus', () => {
  resetInput(); const button = element('BUTTON'); doc.activeElement = button;
  G.tool = { kind: 'build', type: 'farm' }; const event = ctx.emit('keydown', { key: 'Escape', target: button });
  assert.equal(G.tool, null); assert.equal(event.defaultPrevented, true);
  G.sel = { kind: 'b', id: 1 }; ctx.emit('keydown', { key: 'Escape', target: button }); assert.equal(G.sel, null);
});
console.log(`Save/input regressions: ${passed} passed, ${failed} failed (DOM stubs only).`);
process.exitCode = failed ? 1 : 0;
