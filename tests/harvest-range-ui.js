/* Harvest range UI and real input-handler contracts.
 * Run: node tests/harvest-range-ui.js [checkout]
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
function fixture(pointerEvents = false) {
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
  ctx.window = ctx; if (pointerEvents) ctx.PointerEvent = function () {}; doc.parentNode = ctx;
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
  Object.assign(G.ui, { init() { this.initHarvestControls(); this.initRoadControls(); this.initHarvestRangeControls(); }, toast() {}, refreshHUD() {}, hideInfo() { G.sel = null; }, tickInfo() {} });
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

function harvestFixture(pointerEvents=false) {
 const f=fixture(pointerEvents),{G,doc,panel}=f,w=G.world;
 w.water.fill(0);w.rock.fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.road.fill(0);
 const controls=doc.getElementById('harvest-range-controls');panel.appendChild(controls);
 for(const id of ['harvest-confirm','harvest-preview-cancel','harvest-range-status'])controls.appendChild(doc.getElementById(id));
 G.setTool('quarry');f.confirm=doc.getElementById('harvest-confirm');
 f.drag=(a,b)=>{G.cv.emit('mousedown',{clientX:a[0],clientY:a[1]});G.cv.emit('mousemove',{clientX:b[0],clientY:b[1]});G.cv.emit('mouseup',{clientX:b[0],clientY:b[1]});G.ui.refreshHarvestRangeControls();};
 f.touch=(x,y)=>{G.cv.emit('touchstart',{touches:[{clientX:x,clientY:y}]});G.cv.emit('touchend',{changedTouches:[{clientX:x,clientY:y}]});G.ui.refreshHarvestRangeControls();};
 return f;
}
let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name)}
test('mouse drag previews a full rectangle and explicit button confirms, not the travelled line',()=>{
 const f=harvestFixture(),{G}=f,w=G.world;w.rock[3*w.N+3]=1;w.rock[4*w.N+3]=2;w.rock[3*w.N+5]=1;
 f.drag([5,4],[3,3]);assert.equal(w.markedRocks.size,0);assert.equal(G.harvestRangeStatus().added.length,3);f.click(f.confirm);assert.equal(w.markedRocks.size,3);assert.equal(G.harvestPlan,null);
});
test('single-finger two-corner taps and one-cell confirmation need no hover',()=>{
 const f=harvestFixture(),{G}=f,w=G.world;w.rock[3*w.N+3]=1;w.rock[4*w.N+4]=2;f.touch(3,3);assert.equal(G.harvestPlan.awaitingSecond,true);f.touch(4,4);assert.equal(G.harvestRangeStatus().added.length,2);assert.equal(w.markedRocks.size,0);f.click(f.confirm);assert.equal(w.markedRocks.size,2);
 w.rock[7*w.N+7]=1;f.touch(7,7);f.click(f.confirm);assert(w.markedRocks.has(7*w.N+7));
});
test('dragging across controls cancels unfinished preview without markings or later mouseup revival',()=>{
 const f=harvestFixture(),{G}=f;G.world.rock[3*G.world.N+3]=1;G.cv.emit('mousedown',{clientX:3,clientY:3});f.panel.emit('mousemove',{clientX:5,clientY:5});G.cv.emit('mouseup',{clientX:5,clientY:5});assert.equal(G.harvestPlan,null);assert.equal(G.world.markedRocks.size,0);
});
test('touch movement, multitouch and cancellation do not confirm or retain stale corners',()=>{
 const f=harvestFixture(),{G}=f;G.cv.emit('touchstart',{touches:[{clientX:3,clientY:3}]});G.cv.emit('touchmove',{touches:[{clientX:30,clientY:3}]});G.cv.emit('touchend',{changedTouches:[{clientX:30,clientY:3}]});assert.equal(G.harvestPlan,null);
 f.touch(3,3);G.cv.emit('touchcancel');assert.equal(G.harvestPlan,null);G.cv.emit('touchstart',{touches:[{},{}]});G.cv.emit('touchend',{changedTouches:[{clientX:3,clientY:3}]});assert.equal(G.harvestPlan,null);
});
test('tool generation, background and world replacement reject late touch completion',()=>{
 const f=harvestFixture(),{G}=f;G.cv.emit('touchstart',{touches:[{clientX:3,clientY:3}]});G.setTool('fell');G.setTool('quarry');G.cv.emit('touchend',{changedTouches:[{clientX:3,clientY:3}]});assert.equal(G.harvestPlan,null);
 f.touch(3,3);f.doc.visibilityState='hidden';f.doc.emit('visibilitychange');assert.equal(G.harvestPlan,null);f.doc.visibilityState='visible';f.touch(3,3);G.newGame(1);assert.equal(G.harvestPlan,null);
});
test('modal and Escape guards preserve world; preview cancel does not cancel previously issued jobs',()=>{
 const f=harvestFixture(),{G,doc}=f,w=G.world;w.rock[3*w.N+3]=1;f.drag([3,3],[3,3]);doc.getElementById('production-goals').classList.remove('hidden');f.click(f.confirm);assert.equal(w.markedRocks.size,0);doc.getElementById('production-goals').classList.add('hidden');f.click(f.confirm);assert.equal(w.markedRocks.size,1);
 f.drag([3,3],[3,3]);f.click(doc.getElementById('harvest-preview-cancel'));assert.equal(G.harvestPlan,null);assert.equal(w.markedRocks.size,1);f.confirm.focus();f.ctx.emit('keydown',{key:'Escape',target:f.confirm});assert.equal(G.tool,null);assert.equal(f.doc.activeElement,f.toolbar.querySelector('[data-tool="quarry"]'));assert.equal(w.markedRocks.size,1);
});
test('pressed confirmation cannot adopt a different range or silently accept changed target count',()=>{
 const f=harvestFixture(),{G}=f,w=G.world;w.rock[3*w.N+3]=1;w.rock[3*w.N+4]=2;f.drag([3,3],[4,3]);f.confirm.emit('mousedown');w.rock[3*w.N+4]=0;G.ui.refreshHarvestRangeControls();f.confirm.emit('click');assert.equal(w.markedRocks.size,0);f.click(f.confirm);assert.equal(w.markedRocks.size,1);
});
test('held Enter does not confirm a later range and fresh activation works',()=>{
 const f=harvestFixture(),{G}=f,w=G.world;w.rock[3*w.N+3]=1;w.rock[4*w.N+4]=2;f.drag([3,3],[3,3]);f.confirm.emit('keydown',{key:'Enter'});f.confirm.emit('click');assert.equal(w.markedRocks.size,1);
 G.beginHarvestRange(4,4);G.finishHarvestRange(4,4);G.ui.refreshHarvestRangeControls();f.confirm.emit('keydown',{key:'Enter',repeat:true});f.confirm.emit('click');assert.equal(w.markedRocks.size,1);f.confirm.emit('keyup',{key:'Enter'});f.confirm.emit('keydown',{key:'Enter'});f.confirm.emit('click');assert.equal(w.markedRocks.size,2);
});
test('native pointer capture, persistent focus and 44px controls retain boundaries',()=>{
 const f=harvestFixture(true),{G}=f,w=G.world;w.rock[3*w.N+3]=1;f.drag([3,3],[3,3]);f.confirm.focus();f.confirm.emit('pointerdown');G.ui.refreshHarvestRangeControls();assert.equal(f.doc.activeElement,f.confirm);f.confirm.emit('click');assert.equal(w.markedRocks.size,1);assert.match(css,/#harvest-range-controls button[^}]*min-height: 44px/);
});
console.log(`Harvest range UI: ${passed} passed (DOM/event fixtures, not real phone validation)`);
