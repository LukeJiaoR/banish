/* Harvest feedback logic and renderer contracts. Not browser/visual acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const G = loadGame(path.resolve(__dirname, '..'));
global.window = global; global.G = G;
require('../js/ui.js');
const guide = G.ui.refreshGuide, refreshHarvest = G.ui.refreshHarvest, refreshPlacement = G.ui.refreshPlacement;
const renderInfo = G.ui.renderInfo, escHtml = G.ui.escHtml;
const heatDemand = G.ui.heatDemand, citizenStatus = G.ui.citizenStatus;
G.ui = { heatDemand, citizenStatus, toast() {}, refreshHUD() {}, hideInfo() {}, setToolActive() {} };
let passed = 0;
function fresh() {
  G.newGame(44);
  const w = G.world;
  // Synthetic visibility fixture; this does not claim an economic survival run.
  w.marked.clear(); w.markedRocks.clear();
  w.citizens = []; w.cmap = {}; w.families = [];
  w.buildings = []; w.bmap = {};
  G.game.h = 12; G.game.res.wood = 0; G.tool = { kind: 'fell' };
  G.ui.el = { guide: { textContent: '' }, placement: { textContent: '', dataset: {}, classList: { remove() {}, add() {} } } };
  return w;
}
function adult(w, options = {}) {
  const c = { id: w.citizens.length + 1, adult: true, job: null, task: null, pausedTask: null, carry: null, state: 'idle', ...options };
  w.citizens.push(c); w.cmap[c.id] = c; return c;
}
function tree(w, n = 0) { const t = w.trees[n]; w.marked.add(t.i); return t; }
function chop(t, b = null) { return { kind: 'chop', tx: t.x, ty: t.y, tree: t, b }; }
function test(name, fn) { const w = fresh(); fn(w); passed++; console.log('ok ' + name); }

test('queued, active and overnight claims partition valid marked targets', w => {
  const a = tree(w, 0), b = tree(w, 1); tree(w, 2);
  adult(w, { state: 'walk', task: chop(a) });
  adult(w, { state: 'rest', pausedTask: chop(b) });
  // Stale imported coordinates without a tree do not become real work.
  const empty = w.treeIdx.findIndex(i => i < 0); w.marked.add(empty);
  const h = G.harvestFeedback();
  assert.equal(h.trees, 3); assert.equal(h.queued, 1); assert.equal(h.active, 1); assert.equal(h.paused, 1);
});
test('a forester already cutting a marked tree is executing it, not extra queued work', w => {
  const t = tree(w); adult(w, { job: 7, state: 'work', task: chop(t, { id: 7, type: 'forester' }) });
  const h = G.harvestFeedback(); assert.equal(h.active, 1); assert.equal(h.queued, 0);
});
test('duplicate active and paused claims never double count a target', w => {
  const t = tree(w), task = chop(t); adult(w, { task, pausedTask: task }); adult(w, { task });
  const h = G.harvestFeedback(); assert.equal(h.active, 1); assert.equal(h.paused, 0); assert.equal(h.queued, 0);
});
test('rock targets and stale rock marks are counted independently', w => {
  const i = w.rock.findIndex(v => v > 0), empty = w.rock.findIndex(v => v === 0);
  w.markedRocks.add(i); w.markedRocks.add(empty);
  adult(w, { task: { kind: 'clearrock', tx: i % w.N, ty: Math.floor(i / w.N), b: null } });
  const h = G.harvestFeedback(); assert.equal(h.rocks, 1); assert.equal(h.active, 1); assert.equal(h.queued, 0);
});
test('inventory and every carried resource remain separate and unchanged', w => {
  adult(w, { state: 'haul', carry: { type: 'wood', qty: 2 } });
  adult(w, { state: 'idle', carry: { type: 'wood', qty: 3 } });
  adult(w, { state: 'work', carry: { type: 'food', qty: 14 } });
  adult(w, { dead: true, carry: { type: 'wood', qty: 80 } });
  const before = JSON.stringify({ res: G.game.res, citizens: w.citizens });
  const h = G.harvestFeedback(); assert.equal(h.carry.wood, 5); assert.equal(h.carry.food, 14);
  assert.equal(h.haulers, 1); assert.equal(h.waitingCarriers, 2); assert.equal(G.game.res.wood, 0);
  assert.equal(JSON.stringify({ res: G.game.res, citizens: w.citizens }), before);
  guide.call(G.ui); assert.match(G.ui.el.guide.textContent, /另有 5 随身待入库/);
  assert.doesNotMatch(G.ui.el.guide.textContent, /更远可达森林/);
});
test('zero wood with pending work gives progress rather than prompting more marks', w => {
  tree(w); adult(w); guide.call(G.ui);
  assert.match(G.ui.el.guide.textContent, /1 棵已标记/);
  assert.match(G.ui.el.guide.textContent, /待领 1/);
  assert.doesNotMatch(G.ui.el.guide.textContent, /更远可达森林/);
});
test('zero wood with no marks or cargo still advises expansion', w => {
  adult(w); guide.call(G.ui); assert.match(G.ui.el.guide.textContent, /更远可达森林/);
});
test('no-labor explanation reports observed job allocation and food urgency', w => {
  tree(w); w.bmap = { 7: { state: 'site', type: 'house' }, 8: { state: 'ok', type: 'gatherer' } };
  adult(w, { job: 7 }); adult(w, { job: 8 }); G.game.foodUrgent = true;
  const h = G.harvestFeedback(); assert.equal(h.laborers, 0);
  assert.match(h.reason, /工地 1 人.*食物岗 1 人/); assert.match(h.reason, /粮食偏紧/);
});
test('night-time feedback does not diagnose pending marks as unreachable', w => {
  tree(w); adult(w); G.game.h = 23;
  assert.match(G.harvestFeedback().reason, /夜间休息/);
  assert.doesNotMatch(G.harvestFeedback().reason, /不可达/);
});
test('render feedback never pathfinds and dates reachability as a previous check', w => {
  tree(w); adult(w); w.markReachability = { day: 0, h: 10, total: 1, count: 0, unreachable: 1 };
  const findPath = G.findPath; G.findPath = () => { throw Error('UI must not pathfind'); };
  try { refreshHarvest.call(G.ui); } finally { G.findPath = findPath; }
  const text = G.ui.el.placement.textContent;
  assert.match(text, /框选预览并确认/); assert.match(text, /最近派工检查/); assert.match(text, /第 1 天 10 时/);
  assert.match(text, /变化后待复查/); assert.match(text, /已画下的标记仍会执行/);
});
test('switching build to harvest and back rebuilds placement feedback at the same tile', () => {
  const placementInfo = G.placementInfo; let calls = 0;
  G.placementInfo = () => ({ ok: true, text: 'build preview ' + ++calls });
  try {
    refreshPlacement.call(G.ui, 'farm', 10, 10); assert.equal(calls, 1);
    refreshHarvest.call(G.ui); assert.match(G.ui.el.placement.textContent, /框选预览并确认/);
    refreshPlacement.call(G.ui, 'farm', 10, 10); assert.equal(calls, 2);
    assert.equal(G.ui.el.placement.textContent, 'build preview 2');
  } finally { G.placementInfo = placementInfo; }
});
test('an idle carrier is shown as waiting to deliver with the exact cargo quantity', w => {
  const c = adult(w, { name: '搬工', sex: 'm', age: 30, hunger: 0, cold: 0, familyId: null, carry: { type: 'wood', qty: 2 } });
  G.sel = { kind: 'c', id: c.id };
  G.ui.el.info = { innerHTML: '', querySelectorAll() { return []; } }; G.ui.escHtml = escHtml;
  const document = global.document;
  global.document = { getElementById() { return { addEventListener() {} }; } };
  try { renderInfo.call(G.ui); } finally { global.document = document; }
  assert.match(G.ui.el.info.innerHTML, /等待送仓/); assert.match(G.ui.el.info.innerHTML, /木材 2（未入库）/);
  assert.doesNotMatch(G.ui.el.info.innerHTML, /闲逛/);
});
test('food forest overlay uses exact square production bounds and clips the map', w => {
  w.buildings = [{ type: 'gatherer', state: 'ok', x: 1, y: 1 }, { type: 'hunting', state: 'ok', x: 30, y: 40 }, { type: 'gatherer', state: 'site', x: 10, y: 10 }, { type: 'forester', state: 'ok', x: 20, y: 20 }];
  const r = G.PROD.gatherer.radius, hr = G.PROD.hunting.radius;
  assert.deepEqual(G.foodForestBounds(w), [[0, 0, r + 2, r + 2], [30 - hr, 40 - hr, 31 + hr, 41 + hr]]);
  require('../js/render.js');
  const vertices = [], ctx = { save() {}, beginPath() {}, moveTo(x,y) { vertices.push([x,y]); }, lineTo(x,y) { vertices.push([x,y]); }, closePath() {}, fill() {}, setLineDash() {}, stroke() {}, restore() {} };
  G.drawFoodForestBounds(ctx);
  assert.equal(vertices.length, 8); assert.deepEqual(vertices[0], G.T2S(0, 0)); assert.deepEqual(vertices[2], G.T2S(r + 2, r + 2));
});
test('help describes the implemented rectangle preview and explicit confirmation', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /鼠标拖出矩形或手机点两个角预览，再确认标记树木/); assert.doesNotMatch(html, /拖拽沿线标记树木/);
});
test('full mineral cargo is explained without pathfinding or changing inventory', w => {
  G.tool = {kind:'quarry'}; G.game.res.stone=500;
  const c=adult(w,{carry:{type:'stone',qty:9},state:'waitStorage',haulPending:true,haulWait:'space'});
  const old=G.findPath;G.findPath=()=>{throw Error('feedback must not pathfind')};
  try {const before=JSON.stringify({res:G.game.res,c});const h=G.harvestFeedback();assert.equal(h.blockedMineralCarriers,1);assert.equal(h.carry.stone,9);assert.match(citizenStatus(c),/仓满.*等待空间/);refreshHarvest.call(G.ui);assert.match(G.ui.el.placement.textContent,/使用石铁库存或建成新仓库/);assert.equal(JSON.stringify({res:G.game.res,c}),before);}finally{G.findPath=old}
});
test('full mineral marks report storage cause rather than idle/path failure', w => {
  G.tool={kind:'quarry'};G.game.res.iron=500;const i=w.rock.findIndex(v=>v===2);assert(i>=0);w.markedRocks.add(i);adult(w);
  const h=G.harvestFeedback();assert.equal(h.blockedMineralMarks,1);assert.match(h.reason,/仓位已满/);refreshHarvest.call(G.ui);assert.match(G.ui.el.placement.textContent,/另一未满矿种仍可采/);
});
console.log(`Harvest feedback: ${passed} checks passed (headless fixtures and renderer contracts only).`);
