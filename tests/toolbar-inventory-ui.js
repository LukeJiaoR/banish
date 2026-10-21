'use strict';
/* Complete menu inventory and real toolbar -> main.js routing contracts.
 * The shared DOM fixture runs the real game APIs. This is not browser/CSS
 * visibility, pointer hit-testing or desktop visual acceptance. */
const assert = require('node:assert/strict');
const {fixture} = require('./helpers/field-ui');

const roadSurfaces = {road: 'dirt', stoneroad: 'stone', bridge: 'bridge', tunnel: 'tunnel'};
const actions = ['gatherall', 'fell', 'collectstone', 'collectiron', 'cancelremoval', 'demolish'];
function setup() {
  const f = fixture();
  f.G.ui.initToolbar();
  f.G.ui.refreshToolbarNavigation();
  f.tool = type => f.toolbar.querySelector(`[data-tool="${type}"]`);
  f.category = id => f.toolbar.querySelector(`[data-category="${id}"]`);
  return f;
}
function expectedTool(type) {
  return Object.hasOwn(roadSurfaces, type) ? {kind: 'road', surface: roadSurfaces[type]}
    : actions.includes(type) ? {kind: type} : {kind: 'build', type};
}
function selected(f, type) {
  assert.deepEqual(JSON.parse(JSON.stringify(f.G.tool)), expectedTool(type));
  for (const button of f.toolbar.querySelectorAll('[data-tool]')) {
    assert.equal(button.classList.contains('active'), button.dataset.tool === type);
    assert.equal(button.getAttribute('aria-pressed'), String(button.dataset.tool === type));
  }
}
let passed = 0;
function test(name, fn) { fn(setup()); passed++; console.log('ok', name); }

test('all 31 buildable definitions and six actions appear exactly once in five categories', f => {
  const {G, toolbar} = f, buttons = toolbar.querySelectorAll('[data-tool]');
  const buildable = Object.keys(G.BDEF).filter(type => !G.BDEF[type].unbuildable);
  const tools = buttons.map(button => button.dataset.tool);
  assert.equal(buildable.length, 31);
  assert.equal(buttons.length, 37);
  assert.equal(new Set(tools).size, tools.length);
  assert.deepEqual([...tools].sort(), [...buildable, ...actions].sort());
  assert.deepEqual(Array.from(G.ui.toolGroups, group => [group.id, group.tools.length]),
    [['homes', 3], ['food', 6], ['industry', 7], ['services', 11], ['land', 10]]);
  for (const type of ['burntruins', 'mineralpit', 'graveremnant', 'roadwork', 'quarry']) assert(!f.tool(type));
  for (const button of buttons) {
    const name = G.BDEF[button.dataset.tool]?.name || {gatherall: '采集所有资源', fell: '砍伐', collectstone: '采集石头', collectiron: '采集铁矿', cancelremoval: '取消采集', demolish: '拆除'}[button.dataset.tool];
    assert(button.textContent.includes(name));
    assert(button.getAttribute('title'));
    assert.equal(button.disabled, false);
  }
});

test('every actual tool selects its own mode and a second click cancels only that tool', f => {
  const {G, toolbar} = f, original = toolbar.querySelectorAll('[data-tool]');
  for (const group of G.ui.toolGroups) {
    f.category(group.id).click();
    for (const type of group.tools) {
      f.tool(type).click(); selected(f, type);
      assert.equal(G.ui.menuCategory, group.id);
      f.tool(type).click();
      assert.equal(G.tool, null, `${type} must toggle off`);
      assert.equal(G.ui.menuCategory, group.id);
      assert(toolbar.querySelectorAll('[data-tool]').every(button => button.getAttribute('aria-pressed') === 'false'));
    }
    f.doc.getElementById('toolbar-back').click();
    assert.equal(G.ui.menuCategory, null);
    assert.equal(f.doc.activeElement, f.category(group.id));
  }
  assert.deepEqual(toolbar.querySelectorAll('[data-tool]'), original);
});

test('all 16 road-to-road clicks distinguish each surface and discard only unconfirmed previews', f => {
  const {G} = f;
  G.world.marked.add(7); G.world.markedRocks.add(11);
  const resources = JSON.stringify(G.game.res), buildings = G.world.buildings.length;
  for (const from of Object.keys(roadSurfaces)) for (const to of Object.keys(roadSurfaces)) {
    G.setTool(null); f.tool(from).click(); selected(f, from);
    G.roadPlan = {surface: roadSurfaces[from], start: {x: 1, y: 1}};
    G.roadDrag = {x: 1, y: 1};
    const generation = G.roadGestureVersion;
    f.tool(to).click();
    if (from === to) assert.equal(G.tool, null, `${from} toggles off`);
    else selected(f, to);
    assert.equal(G.roadPlan, null);
    assert.equal(G.roadDrag, null);
    assert.equal(G.roadGestureVersion, generation + 1);
    assert.deepEqual([...G.world.marked], [7]);
    assert.deepEqual([...G.world.markedRocks], [11]);
    assert.equal(JSON.stringify(G.game.res), resources);
    assert.equal(G.world.buildings.length, buildings);
  }
});

test('every road variant switches to building and harvest modes without stale pressed buttons', f => {
  const {G} = f;
  for (const road of Object.keys(roadSurfaces)) for (const other of ['house', ...actions]) {
    G.setTool(null); f.tool(road).click(); f.tool(other).click(); selected(f, other);
    f.tool(road).click(); selected(f, road);
    G.pendingBuildingPlacement = {type: 'house'};
    f.doc.getElementById('toolbar-cancel').click();
    assert.equal(G.tool, null);
    assert.equal(G.pendingBuildingPlacement, null);
    assert.equal(G.ui.menuCategory, 'land');
    assert.equal(f.doc.activeElement, f.tool(road));
  }
});

test('no material or seed prerequisite hides or disables any build menu entry', f => {
  const {G} = f;
  for (const key of G.RES_KEYS) G.game.res[key] = 0;
  G.game.unlocks = {};
  G.ui.refreshToolAffordability();
  for (const group of G.ui.toolGroups) {
    f.category(group.id).click();
    assert(!f.doc.getElementById('toolbar-group-' + group.id).classList.contains('hidden'));
    for (const type of group.tools) {
      assert.equal(f.tool(type).disabled, false);
      f.tool(type).click(); selected(f, type);
      f.tool(type).click(); assert.equal(G.tool, null);
    }
  }
  assert.match(G.ui.toolMaterialShortage('house'), /木材缺16、石头缺8/);
  assert.equal(G.world.buildings.length, 0);
});

test('modal guards keep the active road, category and pending preview unchanged', f => {
  const {G} = f;
  f.tool('bridge').click();
  const active = G.tool, pending = G.roadPlan = {surface: 'bridge', start: {x: 1, y: 1}};
  const generation = G.roadGestureVersion;
  G.hasOpenModal = () => true;
  for (const button of f.toolbar.querySelectorAll('button')) button.click();
  assert.equal(G.tool, active);
  assert.equal(G.roadPlan, pending);
  assert.equal(G.roadGestureVersion, generation);
  assert.equal(G.ui.menuCategory, 'land');
  selected(f, 'bridge');
});

console.log(`Toolbar inventory/routing: ${passed} contract groups passed (37 tools and all 16 road pairs; no browser geometry claim).`);
