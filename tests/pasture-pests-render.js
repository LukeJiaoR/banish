/* Native pasture disease seals: actual canvas-call contracts, offline only. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const context = { console, document: {}, performance: { now: () => 0 }, addEventListener() {}, setTimeout() {}, clearTimeout() {} };
context.window = context; vm.createContext(context);
for (const name of ['core', 'defs', 'map', 'sim', 'sprites', 'render'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), context, { filename: name + '.js' });
const G = context.G;
function canvas() {
  const calls = [], stack = [], state = { fillStyle: 'original-fill', strokeStyle: 'original-stroke', lineWidth: 7 };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'save') return () => { calls.push(['save']); stack.push({ ...target }); };
      if (key === 'restore') return () => { calls.push(['restore']); Object.assign(target, stack.pop()); };
      return (...args) => calls.push([key, ...args, { ...target }]);
    },
  });
  return { ctx, calls, state, stack };
}
function fixture(type = 'chicken', count = 8) {
  const N = 24;
  G.game = G.newGameState(); G.game.h = 12;
  G.world = { N, buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], trees: [], treeIdx: new Int32Array(N * N).fill(-1),
    water: new Uint8Array(N * N), rock: new Uint8Array(N * N), bgrid: new Int32Array(N * N).fill(-1), marked: new Set(), markedRocks: new Set() };
  const b = { id: 1, type: 'pasture', state: 'ok', x: 2, y: 2, w: 6, h: 6, animalType: type, animals: count, workers: [], noWork: false };
  G.ensureEconomyBuilding(b); G.world.buildings = [b]; G.world.bmap[1] = b;
  return b;
}
function infect(b, warning = true) {
  G.game.pasturePests = { enabled: true, graceUntil: 0, lastDay: -1 };
  b.pastureInfestation = { animalType: b.animalType, startedDay: 0, lost: 0 }; G.game.day = warning ? 0 : 2;
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const sealCount = calls => calls.filter(c => c[0] === 'arc' && c[1] === 0 && c[2] === 0 && c[3] === 12).length;

test('off, uninfected, empty, unfinished and non-pasture buildings paint no disease seal', () => {
  for (const mode of ['off', 'clear', 'empty', 'site', 'orchard', 'null']) {
    const b = fixture(); infect(b);
    if (mode === 'off') G.game.pasturePests.enabled = false;
    if (mode === 'clear') delete b.pastureInfestation;
    if (mode === 'empty') b.animals = 0;
    if (mode === 'site') b.state = 'site';
    if (mode === 'orchard') b.type = 'orchard';
    const c = canvas(); G.drawPasturePestBadge(c.ctx, mode === 'null' ? null : b);
    assert.equal(c.calls.length, 0, mode);
  }
});

test('warning and mortality reuse farm earth-tone seals with a native warning mark and balanced canvas state', () => {
  for (const warning of [true, false]) {
    const b = fixture(); infect(b, warning); const c = canvas(), before = { ...c.state };
    G.drawPasturePestBadge(c.ctx, b);
    assert.equal(sealCount(c.calls), 1);
    const fill = c.calls.find(call => call[0] === 'fill');
    assert.equal(fill.at(-1).fillStyle, warning ? '#c0a369' : '#ad7553');
    const translate = c.calls.find(call => call[0] === 'translate'), point = G.T2S(b.x + b.w / 2, b.y + b.h);
    assert.deepEqual(translate.slice(1, 3), [point[0], point[1] + 12]);
    assert(c.calls.some(call => call[0] === 'closePath')); assert(c.calls.some(call => call[0] === 'lineTo' && call[1] === 0 && call[2] === 1));
    assert.equal(c.stack.length, 0); assert.deepEqual(c.state, before);
    assert(!c.calls.some(call => call[0] === 'drawImage' || call[0] === 'fillText'));
  }
});

test('badge consumes the pure summary and never probes the infection record or advances randomness', () => {
  const b = fixture(), summary = G.pasturePestSummary, chance = G.chance;
  Object.defineProperty(b, 'pastureInfestation', { get() { throw Error('badge read raw infestation'); }, configurable: true });
  G.chance = () => { throw Error('badge consumed RNG'); };
  let calls = 0; G.pasturePestSummary = target => { calls++; assert.equal(target, b); return Object.freeze({ enabled: true, active: true, warningLeft: 2 }); };
  try { const c = canvas(); G.drawPasturePestBadge(c.ctx, b); assert.equal(calls, 1); assert.equal(sealCount(c.calls), 1); }
  finally { G.pasturePestSummary = summary; G.chance = chance; }
});

test('actual repeated rendering leaves game, herd, events, existing products and cargo unchanged', () => {
  const b = fixture(); infect(b); b.eggProgress = .5; b.pastureProducts.eggs = 9;
  G.world.citizens.push({ id: 4, carry: { type: 'eggs', qty: 3, pastureId: b.id } });
  const before = JSON.stringify([G.game, b, G.world.citizens]);
  Object.freeze(b.pastureInfestation); Object.freeze(G.game.pasturePests);
  for (let i = 0; i < 3; i++) G.drawPasturePestBadge(canvas().ctx, b);
  assert.equal(JSON.stringify([G.game, b, G.world.citizens]), before);
});

test('native seal leaves sheep, cattle and 24-chicken placement and sprite scale unchanged', () => {
  for (const [type, count, size] of [['sheep', 12, 24], ['cattle', 10, 32], ['chicken', 24, 16]]) {
    const b = fixture(type, count), original = [], infected = [];
    G.addEconomyFieldParts(original, b); infect(b); G.addEconomyFieldParts(infected, b);
    const projected = parts => parts.map(p => [p.kind, p.x, p.y, p.n]);
    assert.deepEqual(projected(infected), projected(original));
    const animals = infected.filter(p => p.kind === type); assert.equal(animals.length, count);
    assert.equal(new Set(animals.map(p => p.x + ',' + p.y)).size, count);
    const draw = G.sprDraw, sprites = [];
    G.sprDraw = (_, name, x, y, options) => { sprites.push({ name, x, y, options }); return [size, size]; };
    try { for (const p of animals) G.drawEconomyFieldPart(canvas().ctx, p); }
    finally { G.sprDraw = draw; }
    assert(sprites.every(p => p.name === type && p.options.w === size));
  }
});

test('direct building rendering paints one seal after existing field parts', () => {
  const b = fixture(); infect(b); const c = canvas(), ground = G.drawEconomyFieldGround, part = G.drawEconomyFieldPart;
  const ordering = [];
  G.drawEconomyFieldGround = () => ordering.push('ground');
  G.drawEconomyFieldPart = () => ordering.push('part');
  const badge = G.drawPasturePestBadge;
  G.drawPasturePestBadge = (...args) => { ordering.push('badge'); return badge(...args); };
  try { G.drawBuilding(c.ctx, b, 0); }
  finally { G.drawEconomyFieldGround = ground; G.drawEconomyFieldPart = part; G.drawPasturePestBadge = badge; }
  assert.equal(sealCount(c.calls), 1); assert.equal(ordering[0], 'ground'); assert.equal(ordering.at(-1), 'badge'); assert(ordering.includes('part'));
});

test('real frame calls the pasture badge exactly once and removes it when epidemic clears', () => {
  const b = fixture(); infect(b); const c = canvas();
  G.cv = { clientWidth: 800, clientHeight: 600 }; G.ctx = c.ctx; G.dpr = 1;
  G.cam = { x: 0, y: 0, z: 1 }; G.groundScale = 1; G.needGround = false; G.groundDirty.clear();
  G._groundWorld = G.world; G._groundScale = 1; G._gcv = { width: 1600, height: 800 };
  G.ui = { refreshPlacement() {}, refreshHarvest() {} }; G.tool = G.sel = null; G.hover = { tx: -1, ty: -1 };
  const update = G.updateParticles, screen = G.screenToTile, spr = G.sprDraw;
  G.updateParticles = () => {}; G.screenToTile = (x, y) => ({ tx: x ? 23 : 0, ty: y ? 23 : 0 }); G.sprDraw = () => [16, 16];
  try {
    G.frame(0); assert.equal(sealCount(c.calls), 1);
    delete b.pastureInfestation; c.calls.length = 0; G.frame(0); assert.equal(sealCount(c.calls), 0);
    infect(b); G.game.pasturePests.enabled = false; c.calls.length = 0; G.frame(0); assert.equal(sealCount(c.calls), 0);
  } finally { G.updateParticles = update; G.screenToTile = screen; G.sprDraw = spr; }
});

console.log(`Pasture pests render: ${passed} native drawing/live-summary suites passed (offline, not browser/mobile acceptance).`);
