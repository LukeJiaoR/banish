/* Harvest cancellation UI and real input-handler contracts.
 * Run: node tests/harvest-cancel-ui.js [checkout]
 * DOM/event fixtures and static CSS checks only, not browser or visual acceptance.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function eventTarget(extra = {}) {
  const handlers = {};
  return Object.assign({
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    emit(type, values = {}) {
      const event = Object.assign({ type, key: '', button: 0, clientX: 0, clientY: 0, target: this,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, values);
      for (let el = this; el; el = event.stopped ? null : el.parentNode) {
        for (const fn of (el._handlers || {})[type] || []) fn(event);
      }
      return event;
    },
    _handlers: handlers,
  }, extra);
}
function fixture() {
  const elements = new Map();
  let doc;
  function element(id, tag = 'DIV') {
    const classes = new Set(['hidden']), attrs = {};
    let text = '';
    const el = eventTarget({ id, tagName: tag, dataset: {}, style: {}, children: [], textWrites: 0, attrWrites: 0,
      classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); },
        toggle(v, force) { const on = force === undefined ? !classes.has(v) : force; if (on) classes.add(v); else classes.delete(v); } },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      contains(child) { for (; child; child = child.parentNode) if (child === this) return true; return false; },
      getAttribute(k) { return attrs[k] ?? null; },
      setAttribute(k, v) { this.attrWrites++; attrs[k] = String(v); },
      querySelectorAll(selector) { return selector === 'button' ? this.children.filter(c => c.tagName === 'BUTTON') : []; },
      querySelector(selector) { const match = selector.match(/^\[data-tool="(.*)"\]$/); return match ? this.children.find(c => c.dataset.tool === match[1]) || null : null; },
      closest(selector) { for (let el = this; el; el = el.parentNode) if (selector === '#' + el.id) return el; return null; },
      focus() { if (doc.activeElement !== this) { doc.activeElement = this; doc.emit('focusin', { target: this }); } },
      getBoundingClientRect() { return { left: 0, top: 0 }; }, getContext() { return {}; },
    });
    Object.defineProperty(el, 'textContent', { get() { return text; }, set(v) { text = String(v); el.textWrites++; el.children = []; } });
    Object.defineProperty(el, 'innerHTML', { set() { throw new Error('persistent harvest controls must not use innerHTML'); } });
    elements.set(id, el); return el;
  }
  doc = eventTarget({ visibilityState: 'visible', activeElement: null,
    getElementById(id) { return elements.get(id) || element(id, id === 'game' ? 'CANVAS' : 'DIV'); } });
  const ctx = eventTarget({ console, document: doc, innerWidth: 1000, innerHeight: 700, __errs: [],
    localStorage: { getItem() { return null; }, removeItem() {}, setItem() {} },
    performance: { now() { return 0; } }, setInterval() {}, setTimeout() {},
    requestAnimationFrame(fn) { ctx.nextFrame = fn; }, location: { protocol: 'file:' },
  });
  ctx.window = ctx; doc.parentNode = ctx;
  vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'ui', 'main'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G;
  const hud = element('hud'); hud.parentNode = doc;
  const strip=hud.appendChild(element('harvest-map-controls'));
  strip.appendChild(element('harvest-map-title'));strip.appendChild(element('harvest-map-status'));
  const exit=strip.appendChild(element('harvest-exit','BUTTON'));
  const panel = hud.appendChild(element('placement-panel'));
  const controls = panel.appendChild(element('harvest-cancel'));
  const trees = controls.appendChild(element('cancel-tree-marks', 'BUTTON'));
  const rocks = controls.appendChild(element('cancel-rock-marks', 'BUTTON'));
  const status = controls.appendChild(element('harvest-cancel-status'));
  const placement = panel.appendChild(element('placement-info'));
  const toolbar = hud.appendChild(element('toolbar'));
  for (const kind of ['gatherall','fell','collectstone','collectiron','cancelremoval','quarry', 'demolish', 'farm', 'road']) {
    const btn = toolbar.appendChild(element('tool-' + kind, 'BUTTON')); btn.dataset.tool = kind;
    btn.addEventListener('click', () => { if (!G.hasOpenModal()) G.setTool(kind); });
  }
  doc.getElementById('game').parentNode = doc;
  G.ui.el = { toolbar, placement, harvestCancel: controls, cancelTrees: trees, cancelRocks: rocks, cancelStatus: status,
    help: doc.getElementById('help'), info: doc.getElementById('info') };
  Object.assign(G.ui, { init() { this.initHarvestControls(); this.initHarvestRangeControls(); }, toast() {}, refreshHUD() {}, hideInfo() { G.sel = null; }, tickInfo() {} });
  G.feedback = { init() {}, close() { doc.getElementById('fb').classList.add('hidden'); } };
  G.T2S = () => [0, 0]; G.cam = { x: 0, y: 0, z: 1 }; G.groundDirty = new Set(); G.markGroundDirty = () => {};
  G.autosave = () => {}; G.frame = () => {}; G.screenToTile = G.screenToMapTile = (x, y) => ({ tx: x, ty: y });
  G._hasShownHelp = true; G.newGame(44); G.init();
  G.world.marked.clear(); G.world.markedRocks.clear();
  G.game.paused = true; G.game.speed = 2;
  const cancel = G.cancelResourceMarks; const calls = [];
  G.cancelResourceMarks = kind => { calls.push(kind); return cancel(kind); };
  function markTrees(count = 2) { for (const t of G.world.trees.slice(0, count)) G.world.marked.add(t.i); }
  function markRock() { const i = G.world.rock.findIndex(x => x > 0); G.world.markedRocks.add(i); return i; }
  function click(btn) { btn.emit('mousedown'); btn.focus(); btn.emit('mouseup'); return btn.emit('click'); }
  return { G, ctx, doc, toolbar, panel, strip, exit, controls, placement, trees, rocks, status, calls, click, markTrees, markRock };
}
function state(G) {
  return JSON.stringify({ world: G.world, game: G.game, cam: G.cam, keys: G.keys, tool: G.tool, sel: G.sel,
    marked: Array.from(G.world.marked), markedRocks: Array.from(G.world.markedRocks) });
}
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

test('legacy cancel-all controls stay hidden, inert and cannot mutate from scripted activation',()=>{
  for(const tool of ['gatherall','fell','collectstone','collectiron','cancelremoval','quarry']) {
    const f=fixture();f.markTrees();f.markRock();f.G.setTool(tool);
    assert(f.controls.classList.contains('hidden'));assert.equal(f.controls.inert,true);
    const before=state(f.G);for(const button of [f.trees,f.rocks])for(let n=0;n<3;n++)f.click(button);
    assert.equal(state(f.G),before);assert.equal(f.calls.length,0);
  }
});
test('map strip is outside the legacy page and has only an exit action',()=>{
  assert(html.indexOf('id="harvest-map-controls"')<html.indexOf('id="placement-panel"'));
  const markup=html.match(/<section id="harvest-map-controls"[\s\S]*?<\/section>/)[0];
  assert.equal((markup.match(/<button/g)||[]).length,1);assert.match(markup,/id="harvest-exit"/);
  const css=fs.readFileSync(path.join(root,'styles/harvest-map.css'),'utf8');
  assert.match(css,/#hud\.is-harvesting #toolbar/);assert.match(css,/#harvest-cancel[^}]*display:none !important/);
});
test('exit preserves current work, overnight claims, cargo, stock and time controls',()=>{
  const f=fixture(),{G}=f;f.markTrees();f.markRock();
  const [a,b,c]=G.world.citizens;const t=G.world.trees[0];
  a.task={kind:'chop',tree:t,tx:t.x,ty:t.y,b:null,workLeft:2};
  b.pausedTask={kind:'clearrock',tx:20,ty:20,b:null,workLeft:3};
  c.carry={type:'wood',qty:3};G.setTool('fell');
  const before=JSON.stringify({world:G.world,game:G.game,trees:[...G.world.marked],rocks:[...G.world.markedRocks]});
  f.click(f.exit);assert.equal(G.tool,null);assert(f.strip.classList.contains('hidden'));
  assert.equal(JSON.stringify({world:G.world,game:G.game,trees:[...G.world.marked],rocks:[...G.world.markedRocks]}),before);
  assert.equal(f.doc.activeElement,f.toolbar.querySelector('[data-tool="fell"]'));
});
test('all overlays guard Exit without altering tool or simulation',()=>{
  const f=fixture();f.markTrees();f.G.setTool('fell');
  for(const id of ['help','saves','errs','over','fb','production-goals']) {
    f.doc.getElementById(id).classList.remove('hidden');const before=state(f.G);
    f.click(f.exit);assert.equal(state(f.G),before,id);
    f.doc.getElementById(id).classList.add('hidden');
  }
});
test('frame refresh keeps only direct map instruction and does not recreate controls',()=>{
  const f=fixture();f.G.setTool('collectiron');const exit=f.exit;
  f.exit.focus();for(let n=0;n<120;n++)f.G.ui.refreshHarvest();
  assert.equal(f.doc.getElementById('harvest-exit'),exit);assert.equal(f.doc.activeElement,exit);
  assert(f.placement.classList.contains('hidden'));assert(f.controls.classList.contains('hidden'));
  assert.match(f.doc.getElementById('harvest-map-title').textContent,/铁矿/);
  assert.match(f.doc.getElementById('harvest-map-status').textContent,/松开/);
  assert.doesNotMatch(f.doc.getElementById('harvest-map-status').textContent,/确认/);
});
test('Escape exits from strip and preserves designations',()=>{
  const f=fixture();f.markTrees();f.G.setTool('fell');f.exit.focus();
  f.ctx.emit('keydown',{key:'Escape',target:f.exit});
  assert.equal(f.G.tool,null);assert.equal(f.G.world.marked.size,2);assert(f.strip.classList.contains('hidden'));
});
test('tool switches and new games leave legacy controls inert and hidden',()=>{
  const f=fixture();f.markTrees();f.G.setTool('fell');
  for(const tool of ['collectstone','collectiron','cancelremoval','farm',null]) {
    f.G.setTool(tool);assert(f.controls.classList.contains('hidden'));assert.equal(f.controls.inert,true);
  }
  f.G.newGame(45);const before=state(f.G);f.click(f.trees);f.click(f.rocks);assert.equal(state(f.G),before);
});

// Real input-handler boundaries for the dedicated surface-mineral tool.
function emptyTile(G, x, y) {
  const w = G.world, i = y * w.N + x;
  if (w.treeIdx[i] >= 0) G.removeTree(w, x, y);
  w.water[i] = 0; w.rock[i] = 0; w.road[i] = 0;
  assert.ok(w.bgrid[i] < 0, 'fixture must not replace a real building');
  return i;
}
function canvasClick(G, x, y) {
  G.cv.emit('mousedown', { clientX: x, clientY: y });
  G.cv.emit('mouseup', { clientX: x, clientY: y });
}
test('dedicated mineral clicks distinguish stone and iron and only mark, never grant resources', () => {
  const f = fixture(), { G } = f, w = G.world;
  const a = emptyTile(G, 20, 20), b = emptyTile(G, 21, 20); w.rock[a] = 1; w.rock[b] = 2;
  const before = JSON.stringify(G.game.res); G.setTool('quarry');
  for (const x of [20, 21, 20]) { canvasClick(G, x, 20); assert.equal(G.harvestPlan,null); }
  assert.equal(G.tool.kind, 'quarry'); assert.equal(w.markedRocks.size, 2);
  assert.equal(w.rock[a], 1); assert.equal(w.rock[b], 2); assert.equal(JSON.stringify(G.game.res), before);
  G.hover = { tx: 20, ty: 20 }; G.ui.refreshHarvest(); assert(f.placement.classList.contains('hidden'));
  G.hover = { tx: 21, ty: 20 }; G.ui.refreshHarvest(); assert(f.placement.classList.contains('hidden'));
  G.hover = { tx: -1, ty: -1 }; G.ui.refreshHarvest(); assert(f.placement.classList.contains('hidden'));
});
test('mineral input marks run through real mining and hauling to exactly one deposit per type', () => {
  const { G } = fixture(), w = G.world, c = w.citizens.find(c => c.adult);
  G.game.paused = false; // Real simulation now honors the fixture's paused state.
  G.setTool('quarry'); const before = { stone: G.game.res.stone, iron: G.game.res.iron };
  for (const value of [1, 2]) {
    const candidates = [];
    for (let i = 0; i < w.rock.length; i++) if (w.rock[i] === value) candidates.push(i);
    candidates.sort((a, b) => G.d2(a % w.N, Math.floor(a / w.N), c.x, c.y) - G.d2(b % w.N, Math.floor(b / w.N), c.x, c.y));
    const i = candidates.find(i => G.findPath(w, Math.round(c.x), Math.round(c.y), i % w.N, Math.floor(i / w.N)));
    assert.notEqual(i, undefined); canvasClick(G, i % w.N, Math.floor(i / w.N));
  }
  assert.equal(w.markedRocks.size, 2);
  let steps = 0;
  while ((w.markedRocks.size || w.citizens.some(c => c.carry)) && steps++ < 2400) G.advanceSim(0.05);
  assert.equal(w.markedRocks.size, 0); assert.equal(G.game.res.stone, before.stone + 10); assert.equal(G.game.res.iron, before.iron + 10);
  assert.equal(w.citizens.filter(c => c.carry).length, 0);
});
test('direct mineral range marks both minerals and preserves trees and roads', () => {
  const { G } = fixture(), w = G.world;
  for (let x = 20; x <= 24; x++) emptyTile(G, x, 20);
  w.rock[20 * w.N + 20] = 1; w.rock[20 * w.N + 24] = 2;
  G.addTree(w, 21, 20, -200); w.road[20 * w.N + 22] = 1;
  G.setTool('quarry'); G.cv.emit('mousedown', { clientX: 20, clientY: 20 });
  G.cv.emit('mousemove', { clientX: 24, clientY: 20 }); G.cv.emit('mouseup', { clientX: 24, clientY: 20 });
  assert.equal(G.harvestPlan,null);
  assert.equal(w.markedRocks.size, 2); assert.ok(w.treeIdx[20 * w.N + 21] >= 0);
  assert.equal(w.road[20 * w.N + 22], 1); assert.equal(w.marked.size, 0);
});
test('mineral click on a building never selects or demolishes it', () => {
  const { G } = fixture(), w = G.world, store = w.buildings[0]; let dangerous = 0;
  G.demolishAt = G.selectAt = () => dangerous++;
  G.setTool('quarry'); canvasClick(G, store.x, store.y);
  assert.equal(dangerous, 0); assert.equal(w.markedRocks.size, 0); assert.equal(w.bmap[store.id], store);
});
test('demolition ignores natural trees and minerals but still removes roads', () => {
  const { G } = fixture(), w = G.world;
  const stone = emptyTile(G, 20, 20), iron = emptyTile(G, 21, 20), road = emptyTile(G, 22, 20); emptyTile(G, 23, 20);
  w.rock[stone] = 1; w.rock[iron] = 2; w.road[road] = 1; G.addTree(w, 23, 20, -200);
  G.setTool('demolish'); for (let x = 20; x <= 23; x++) canvasClick(G, x, 20);
  assert.equal(w.rock[stone], 1); assert.equal(w.rock[iron], 2); assert.equal(w.markedRocks.size, 0);
  assert.ok(w.treeIdx[20 * w.N + 23] >= 0); assert.equal(w.road[road], 0);
});
test('demolition retains real building removal and material refund', () => {
  const { G } = fixture(), w = G.world;
  for (let y = 20; y < 22; y++) for (let x = 20; x < 22; x++) emptyTile(G, x, y);
  const placed = G.addBuilding('house', 20, 20, { instant: true }); assert.equal(placed.ok, true);
  const before = G.game.res.stone, b = w.buildings.find(b => b.x === 20 && b.y === 20);
  G.setTool('demolish'); canvasClick(G, 20, 20);
  assert.equal(w.bmap[b.id], undefined); assert.equal(w.bgrid[20 * w.N + 20], -1); assert.equal(G.game.res.stone, before + 4);
});
test('mineral marking is blocked by dialogs and toolbar interruption ends the old gesture', () => {
  const f = fixture(), { G } = f, w = G.world, i = emptyTile(G, 20, 20); w.rock[i] = 1;
  G.setTool('quarry'); f.doc.getElementById('help').classList.remove('hidden'); canvasClick(G, 20, 20);
  assert.equal(w.markedRocks.size, 0); f.doc.getElementById('help').classList.add('hidden');
  G.cv.emit('mousedown', { clientX: 20, clientY: 20 });
  f.toolbar.querySelector('[data-tool="demolish"]').focus(); G.setTool('demolish');
  const store = w.buildings[0]; let deleted = 0; G.demolishAt = () => deleted++;
  G.cv.emit('mouseup', { clientX: store.x, clientY: store.y }); assert.equal(deleted, 0);
  assert.equal(w.markedRocks.size, 0); assert.equal(w.rock[i], 1); assert.equal(G.harvestPlan, null);
});

console.log(`Harvest cancellation UI: ${passed} passed, ${failed} failed (DOM/event fixtures and static CSS only).`);
process.exitCode = failed ? 1 : 0;
