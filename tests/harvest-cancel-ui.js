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
  const panel = hud.appendChild(element('placement-panel'));
  const controls = panel.appendChild(element('harvest-cancel'));
  const trees = controls.appendChild(element('cancel-tree-marks', 'BUTTON'));
  const rocks = controls.appendChild(element('cancel-rock-marks', 'BUTTON'));
  const status = controls.appendChild(element('harvest-cancel-status'));
  const placement = panel.appendChild(element('placement-info'));
  const toolbar = hud.appendChild(element('toolbar'));
  for (const kind of ['fell', 'quarry', 'demolish', 'farm', 'road']) {
    const btn = toolbar.appendChild(element('tool-' + kind, 'BUTTON')); btn.dataset.tool = kind;
    btn.addEventListener('click', () => { if (!G.hasOpenModal()) G.setTool(kind); });
  }
  doc.getElementById('game').parentNode = doc;
  G.ui.el = { toolbar, placement, harvestCancel: controls, cancelTrees: trees, cancelRocks: rocks, cancelStatus: status,
    help: doc.getElementById('help'), info: doc.getElementById('info') };
  Object.assign(G.ui, { init() { this.initHarvestControls(); }, toast() {}, refreshHUD() {}, hideInfo() { G.sel = null; }, tickInfo() {} });
  G.feedback = { init() {}, close() { doc.getElementById('fb').classList.add('hidden'); } };
  G.T2S = () => [0, 0]; G.cam = { x: 0, y: 0, z: 1 }; G.groundDirty = new Set(); G.markGroundDirty = () => {};
  G.autosave = () => {}; G.frame = () => {}; G.screenToTile = (x, y) => ({ tx: x, ty: y });
  G._hasShownHelp = true; G.newGame(44); G.init();
  G.world.marked.clear(); G.world.markedRocks.clear();
  G.game.paused = true; G.game.speed = 2;
  const cancel = G.cancelResourceMarks; const calls = [];
  G.cancelResourceMarks = kind => { calls.push(kind); return cancel(kind); };
  function markTrees(count = 2) { for (const t of G.world.trees.slice(0, count)) G.world.marked.add(t.i); }
  function markRock() { const i = G.world.rock.findIndex(x => x > 0); G.world.markedRocks.add(i); return i; }
  function click(btn) { btn.emit('mousedown'); btn.focus(); btn.emit('mouseup'); return btn.emit('click'); }
  return { G, ctx, doc, toolbar, panel, controls, placement, trees, rocks, status, calls, click, markTrees, markRock };
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

test('persistent native buttons are siblings of the frame-replaced text and have safe accessible defaults', () => {
  assert.match(html, /id="placement-panel"[\s\S]*?id="harvest-cancel"[\s\S]*?id="placement-info"/);
  for (const id of ['cancel-tree-marks', 'cancel-rock-marks'])
    assert.match(html, new RegExp('<button type="button" id="' + id + '" aria-disabled="true">'));
  assert.match(html, /id="harvest-cancel-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /护林和工地清场继续/); assert.match(html, /已耗工时不返还/); assert.match(html, /退出工具不撤销标记/);
  const { controls, placement } = fixture(); assert.equal(placement.contains(controls), false);
});

test('zero marks have a visible disabled state and repeated activation has no effect', () => {
  const f = fixture(), { G, trees, rocks, calls, click } = f;
  G.setTool('fell');
  for (const btn of [trees, rocks]) { assert.equal(btn.getAttribute('aria-disabled'), 'true'); assert.match(btn.textContent, /（0）/); }
  const before = state(G); for (let n = 0; n < 4; n++) { click(trees); click(rocks); }
  assert.equal(calls.length, 0); assert.equal(state(G), before);
});

test('tree cancellation is one-shot, immediately refreshes its count, and leaves ore and time controls unchanged', () => {
  const f = fixture(), { G, trees, rocks, calls, click, status } = f;
  f.markTrees(); f.markRock(); G.setTool('fell');
  assert.match(trees.textContent, /（2）/); assert.match(rocks.textContent, /（1）/);
  const pause = G.game.paused, speed = G.game.speed; click(trees); click(trees);
  assert.deepEqual(calls, ['trees']); assert.equal(G.world.marked.size, 0); assert.equal(G.world.markedRocks.size, 1);
  assert.equal(trees.getAttribute('aria-disabled'), 'true'); assert.equal(rocks.getAttribute('aria-disabled'), 'false');
  assert.equal(G.game.paused, pause); assert.equal(G.game.speed, speed); assert.equal(G.tool.kind, 'fell');
  assert.match(status.textContent, /已取消 2 处树标记/); assert.match(status.textContent, /已采货物仍送仓/);
});

test('ore cancellation works from either harvest tool and never cancels tree marks', () => {
  for (const tool of ['fell', 'quarry']) {
    const f = fixture(); f.markTrees(); f.markRock(); f.G.setTool(tool); f.click(f.rocks);
    assert.deepEqual(f.calls, ['rocks']); assert.equal(f.G.world.marked.size, 2); assert.equal(f.G.world.markedRocks.size, 0);
    assert.match(f.status.textContent, /1 处矿标记/);
  }
});

test('real active and overnight tasks report separately while harvested cargo and independent work remain', () => {
  const f = fixture(), { G } = f; f.markTrees(3);
  const [a, b, c, independent] = G.world.citizens;
  const [t1, t2, t3] = G.world.trees;
  const claim = t => ({ kind: 'chop', tx: t.x, ty: t.y, tree: t, b: null, workLeft: 2 });
  a.task = claim(t1); a.state = 'work'; a.job = null;
  b.pausedTask = claim(t2); b.task = null; b.state = 'rest'; b.job = null;
  c.carry = { type: 'wood', qty: 3 }; c.state = 'haul'; c.task = null;
  independent.task = { ...claim(t3), b: { id: 991, type: 'forester' } };
  const cargo = c.carry, ownTask = independent.task, resources = JSON.stringify(G.game.res);
  G.setTool('fell'); f.click(f.trees);
  assert.match(f.status.textContent, /停止执行 1 项、夜间保留 1 项/);
  assert.equal(a.task, null); assert.equal(b.pausedTask, null); assert.equal(b.state, 'rest');
  assert.equal(c.carry, cargo); assert.equal(c.state, 'haul'); assert.equal(independent.task, ownTask);
  assert.equal(JSON.stringify(G.game.res), resources);
});

test('live mark counts defeat both stale enabled and stale disabled button states', () => {
  const f = fixture(); f.markTrees(); f.G.setTool('fell'); f.G.world.marked.clear();
  f.click(f.trees); assert.equal(f.calls.length, 0); assert.equal(f.trees.getAttribute('aria-disabled'), 'true');
  f.markTrees(1); f.click(f.trees); assert.deepEqual(f.calls, ['trees']);
});

test('raw stale marker entries remain visible and cancellable', () => {
  const f = fixture(); const i = f.G.world.treeIdx.findIndex(v => v < 0);
  f.G.world.marked.add(i); f.G.setTool('fell'); assert.match(f.trees.textContent, /（1）/);
  f.click(f.trees); assert.equal(f.G.world.marked.size, 0); assert.match(f.status.textContent, /1 处树标记/);
});

test('switching harvest tools and exiting preserve marks; hidden controls cannot cancel', () => {
  const f = fixture(); f.markTrees(); f.markRock(); f.G.setTool('fell');
  f.G.setTool('quarry'); assert.equal(f.controls.classList.contains('hidden'), false);
  const before = [Array.from(f.G.world.marked), Array.from(f.G.world.markedRocks)];
  for (const tool of ['farm', 'road', 'demolish', null]) {
    f.G.setTool(tool); assert.equal(f.controls.classList.contains('hidden'), true);
    f.click(f.trees); f.click(f.rocks); assert.equal(f.calls.length, 0);
  }
  assert.deepEqual([Array.from(f.G.world.marked), Array.from(f.G.world.markedRocks)], before);
});

test('focus and button identity survive frame refreshes and cancellation to zero', () => {
  const f = fixture(); f.markTrees(); f.G.setTool('fell'); f.trees.focus();
  const buttons = [f.trees, f.rocks], writes = buttons.map(b => [b.textWrites, b.attrWrites]);
  const before = state(f.G);
  for (let n = 0; n < 120; n++) f.G.ui.refreshHarvest();
  assert.equal(state(f.G), before); assert.equal(f.doc.activeElement, f.trees);
  assert.deepEqual(buttons.map(b => [b.textWrites, b.attrWrites]), writes);
  assert.equal(f.controls.children[0], buttons[0]); assert.equal(f.controls.children[1], buttons[1]);
  f.click(f.trees); for (let n = 0; n < 120; n++) f.G.ui.refreshHarvest();
  assert.equal(f.doc.activeElement, f.trees); assert.equal(f.trees.getAttribute('aria-disabled'), 'true');
});

test('Escape from a cancel button exits without clearing marks and restores visible toolbar focus', () => {
  const f = fixture(); f.markTrees(); f.G.setTool('fell'); f.trees.focus();
  const event = f.trees.emit('keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, true); assert.equal(f.G.tool, null); assert.equal(f.G.world.marked.size, 2);
  assert.equal(f.doc.activeElement, f.toolbar.querySelector('[data-tool="fell"]')); assert.equal(f.calls.length, 0);
});

test('a tool switch restores focus to its toolbar control without touching game state', () => {
  const f = fixture(); f.markTrees(); f.G.setTool('fell'); f.trees.focus();
  f.G.setTool('farm'); assert.equal(f.doc.activeElement, f.toolbar.querySelector('[data-tool="farm"]'));
  assert.equal(f.G.world.marked.size, 2); assert.equal(f.G.game.paused, true); assert.equal(f.G.game.speed, 2);
});

test('all overlays guard cancellation even before the disabled appearance is refreshed', () => {
  for (const id of ['help', 'saves', 'errs', 'fb', 'over']) {
    const f = fixture(); f.markTrees(); f.markRock(); f.G.setTool('fell');
    f.doc.getElementById(id).classList.remove('hidden'); const before = state(f.G);
    f.click(f.trees); f.click(f.rocks); assert.equal(f.calls.length, 0); assert.equal(state(f.G), before);
    f.G.ui.refreshHarvest(); assert.equal(f.trees.getAttribute('aria-disabled'), 'true'); assert.equal(f.rocks.getAttribute('aria-disabled'), 'true');
    f.doc.getElementById(id).classList.add('hidden'); f.G.ui.refreshHarvest();
    assert.equal(f.trees.getAttribute('aria-disabled'), 'false'); f.click(f.trees); assert.deepEqual(f.calls, ['trees']);
  }
});

test('native button key events preserve Enter/Space activation without triggering game hotkeys', () => {
  for (const key of ['Enter', ' ']) {
    const f = fixture(); f.markTrees(); f.G.setTool('fell'); f.trees.focus();
    for (const hotkey of ['w', 'a', 's', 'd', 'ArrowUp', '1', '2', '3', '?']) f.trees.emit('keydown', { key: hotkey });
    const down = f.trees.emit('keydown', { key }); f.trees.emit('keyup', { key });
    assert.equal(!!down.defaultPrevented, false, 'browser retains native button activation');
    // Browser-generated activation itself is represented explicitly in this DOM fixture.
    f.trees.emit('click', { detail: 0 });
    assert.deepEqual(f.calls, ['trees']); assert.equal(f.G.game.paused, true); assert.equal(f.G.game.speed, 2);
    assert.ok(!Object.values(f.G.keys).some(Boolean)); assert.equal(f.G.hasOpenModal(), false);
  }
});

test('cancel pointer events cannot place, demolish, select, or mark a map tile', () => {
  const f = fixture(); f.markTrees(); f.markRock(); f.G.setTool('quarry');
  const unexpected = [];
  for (const key of ['tryPlace', 'demolishAt', 'selectAt', 'markFellAt', 'markRockAt', 'paintRoad']) f.G[key] = () => unexpected.push(key);
  f.click(f.trees); f.click(f.rocks); assert.deepEqual(unexpected, []); assert.deepEqual(f.calls, ['trees', 'rocks']);
});

test('canvas drags stop on the harvest panel and never resume when the pointer returns', () => {
  for (const [tool, button] of [['fell', 0], ['quarry', 0], [null, 2]]) for (const target of ['panel', 'placement', 'trees']) {
    const f = fixture(), { G } = f; G.setTool(tool);
    const actions = [];
    for (const key of ['markFellAt', 'markRockAt', 'paintFell', 'paintRockLine', 'demolishAt', 'selectAt'])
      G[key] = () => actions.push(key);
    G.cv.emit('mousedown', { button, clientX: 12, clientY: 12 });
    const initial = actions.slice(), camera = JSON.stringify(G.cam);
    f[target].emit('mousemove', { button, clientX: 16, clientY: 16 });
    f.trees.emit('mouseup', { button, clientX: 16, clientY: 16 });
    G.cv.emit('mousemove', { button, clientX: 20, clientY: 20 });
    G.cv.emit('mouseup', { button, clientX: 20, clientY: 20 });
    assert.deepEqual(actions, initial, `${tool || 'pan'} continued beneath/after the panel`);
    assert.equal(JSON.stringify(G.cam), camera);
    // A new intentional canvas gesture must still work after the interrupted one.
    G.cv.emit('mousedown', { button, clientX: 12, clientY: 12 });
    G.cv.emit('mousemove', { button, clientX: 20, clientY: 20 });
    G.cv.emit('mouseup', { button, clientX: 20, clientY: 20 });
    if (tool) assert.ok(actions.length > initial.length);
    else assert.notEqual(JSON.stringify(G.cam), camera);
  }
});

test('a demolish gesture released over a cancel control cannot delete even without an intervening move event', () => {
  const f = fixture(), { G } = f; G.setTool('demolish');
  let deletes = 0; G.demolishAt = () => deletes++;
  G.cv.emit('mousedown', { clientX: 12, clientY: 12 });
  f.trees.emit('mouseup', { clientX: 12, clientY: 12 });
  G.cv.emit('mouseup', { clientX: 12, clientY: 12 });
  assert.equal(deletes, 0);
});

test('new worlds clear old cancellation status and refresh their own counts', () => {
  const f = fixture(); f.markTrees(); f.G.setTool('fell'); f.click(f.trees); assert.ok(f.status.textContent);
  f.G.newGame(45); f.G.setTool('fell'); assert.equal(f.status.textContent, ''); assert.match(f.trees.textContent, /（0）/);
});

test('static compact-layout contracts keep controls above feedback in one bounded scroll area', () => {
  const panel = css.match(/#placement-panel\s*\{([^}]+)\}/)[1];
  assert.match(panel, /max-height:\s*calc\(100vh - 214px\)/); assert.match(panel, /overflow-y:\s*auto/); assert.match(panel, /pointer-events:\s*auto/);
  assert.match(css, /@media \(max-width: 600px\)[^\n]*#placement-panel\s*\{\s*max-height:\s*calc\(100vh - 260px\)/);
  assert.match(css, /@media \(max-height: 620px\).*#survival-guide.*display:\s*none/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/); assert.match(css, /button:focus-visible/);
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
  canvasClick(G, 20, 20); canvasClick(G, 21, 20); canvasClick(G, 20, 20);
  assert.equal(G.tool.kind, 'quarry'); assert.equal(w.markedRocks.size, 2);
  assert.equal(w.rock[a], 1); assert.equal(w.rock[b], 2); assert.equal(JSON.stringify(G.game.res), before);
  G.hover = { tx: 20, ty: 20 }; G.ui.refreshHarvest(); assert.match(f.placement.textContent, /岩石 → 石头/);
  G.hover = { tx: 21, ty: 20 }; G.ui.refreshHarvest(); assert.match(f.placement.textContent, /铁矿 → 铁/);
  G.hover = { tx: -1, ty: -1 }; G.ui.refreshHarvest(); assert.match(f.placement.textContent, /没有可采矿石/);
});
test('mineral input marks run through real mining and hauling to exactly one deposit per type', () => {
  const { G } = fixture(), w = G.world, c = w.citizens.find(c => c.adult);
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
test('mineral drag marks both minerals and preserves trees and roads along the line', () => {
  const { G } = fixture(), w = G.world;
  for (let x = 20; x <= 24; x++) emptyTile(G, x, 20);
  w.rock[20 * w.N + 20] = 1; w.rock[20 * w.N + 24] = 2;
  G.addTree(w, 21, 20, -200); w.road[20 * w.N + 22] = 1;
  G.setTool('quarry'); G.cv.emit('mousedown', { clientX: 20, clientY: 20 });
  G.cv.emit('mousemove', { clientX: 24, clientY: 20 }); G.cv.emit('mouseup', { clientX: 24, clientY: 20 });
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
  assert.equal(w.markedRocks.size, 1); assert.equal(w.rock[i], 1);
});

console.log(`Harvest cancellation UI: ${passed} passed, ${failed} failed (DOM/event fixtures and static CSS only).`);
process.exitCode = failed ? 1 : 0;
