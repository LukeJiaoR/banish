/* Guided road UI and real input-handler contracts.
 * Run: node tests/road-plan-ui.js [checkout]
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
  Object.assign(G.ui, { init() { this.initHarvestControls(); this.initRoadControls(); }, toast() {}, refreshHUD() {}, hideInfo() { G.sel = null; }, tickInfo() {} });
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

function roadFixture(pointerEvents = false) {
  const f=fixture(pointerEvents),{G,doc,panel}=f,w=G.world;
  w.water.fill(0);w.rock.fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.road.fill(0);
  const controls=doc.getElementById('road-controls');panel.appendChild(controls);
  for(const id of ['road-confirm','road-cancel','road-plan-status'])controls.appendChild(doc.getElementById(id));
  G.setTool('road');
  f.tap=(x,y)=>{doc.getElementById('game').emit('mousedown',{clientX:x,clientY:y});doc.getElementById('game').emit('mouseup',{clientX:x,clientY:y});};
  return f;
}
let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name)}
test('mouse endpoints preview only; confirm button paves and cannot click through',()=>{
  const f=roadFixture(),{G,doc}=f;f.tap(3,3);assert.equal(G.roadPlan.end,null);f.tap(8,3);assert.equal(G.world.road.some(Boolean),false);
  G.ui.refreshRoadControls();const button=doc.getElementById('road-confirm');assert.equal(button.disabled,false);f.click(button);assert.equal(G.world.road[3*G.world.N+5],1);assert.equal(G.roadPlan,null);
});
test('mouse drag previews endpoints cheaply then computes a route on release without paving',()=>{
 const f=roadFixture(),{G,doc}=f,cv=doc.getElementById('game');let calls=0;const plan=G.planRoad;G.planRoad=(...a)=>{calls++;return plan(...a);};
 cv.emit('mousedown',{clientX:3,clientY:3});
 for(let x=4;x<=20;x++)cv.emit('mousemove',{clientX:x,clientY:3});
 assert.equal(calls,0);assert(G.roadDrag);assert.equal(G.roadPlan,null);assert.equal(G.world.road.some(Boolean),false);
 G.ui.refreshRoadControls();assert.equal(doc.getElementById('road-confirm').disabled,true);
 cv.emit('mouseup',{clientX:20,clientY:3});assert.equal(G.roadDrag,null);assert.equal(calls,2);assert.equal(G.roadPlan.end.x,20);assert.equal(G.world.road.some(Boolean),false);
 G.ui.refreshRoadControls();f.click(doc.getElementById('road-confirm'));assert.equal(G.world.road[3*G.world.N+12],1);
});
test('native one-finger touch endpoints preview without hover or synthetic mouse',()=>{
  const{G,doc}=roadFixture(),cv=doc.getElementById('game');for(const x of [3,8]){const t={clientX:x,clientY:3};const e=cv.emit('touchstart',{touches:[t]});assert.equal(e.defaultPrevented,true);cv.emit('touchend',{changedTouches:[t]});}assert.equal(G.roadPlan.result.steps,5);assert.equal(G.world.road.some(Boolean),false);
});
test('touch movement and cancellation do not lay road',()=>{
  const{G,doc}=roadFixture(),cv=doc.getElementById('game');cv.emit('touchstart',{touches:[{clientX:3,clientY:3}]});cv.emit('touchmove',{touches:[{clientX:30,clientY:3}]});cv.emit('touchend',{changedTouches:[{clientX:30,clientY:3}]});assert.equal(G.roadPlan,null);cv.emit('touchcancel');assert.equal(G.world.road.some(Boolean),false);
});
test('tool changes and Escape discard only unconfirmed plan',()=>{
  const f=roadFixture();f.tap(3,3);f.tap(8,3);f.G.setTool('fell');assert.equal(f.G.roadPlan,null);f.G.setTool('road');f.tap(3,3);f.ctx.emit('keydown',{key:'Escape'});assert.equal(f.G.roadPlan,null);assert.equal(f.G.tool,null);
});
test('modal guard blocks confirm and endpoint taps; UI control identity survives updates',()=>{
  const f=roadFixture(),button=f.doc.getElementById('road-confirm');f.tap(3,3);f.tap(8,3);button.focus();f.G.ui.refreshRoadControls();assert.equal(f.doc.activeElement,button);f.doc.getElementById('help').classList.remove('hidden');f.click(button);assert.equal(f.G.world.road.some(Boolean),false);f.tap(10,3);assert.equal(f.G.roadPlan.end.x,8);
});
test('backgrounding clears preview and pending touch; resource-goal modal also blocks paving',()=>{
 const f=roadFixture(),{G,doc}=f,cv=doc.getElementById('game');f.tap(3,3);f.tap(8,3);doc.getElementById('production-goals').classList.remove('hidden');f.click(doc.getElementById('road-confirm'));assert.equal(G.world.road.some(Boolean),false);doc.getElementById('production-goals').classList.add('hidden');cv.emit('touchstart',{touches:[{clientX:9,clientY:3}]});doc.visibilityState='hidden';doc.emit('visibilitychange');assert.equal(G.roadPlan,null);doc.visibilityState='visible';cv.emit('touchend',{changedTouches:[{clientX:9,clientY:3}]});assert.equal(G.roadPlan,null);
});
test('compact road controls keep native touch targets and suppress competing guide',()=>{assert.match(css,/#road-controls button[^}]*min-height: 44px/);assert.match(css,/#hud:has\(#road-controls:not\(\.hidden\)\) #survival-guide\s*\{ display: none/);for(const id of ['road-confirm','road-cancel'])assert.match(html,new RegExp('<button type="button" id="'+id+'"'));assert.doesNotMatch(fs.readFileSync(path.join(root,'js/render.js'),'utf8'),/G\.planRoad\(/)});
test('pressed clear confirmation cannot become paving when the last tree disappears',()=>{
 const f=roadFixture(),{G,doc}=f,i=3*G.world.N+5;G.world.treeIdx[i]=7;f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();const b=doc.getElementById('road-confirm');b.emit('mousedown');b.focus();G.world.treeIdx[i]=-1;G.ui.refreshRoadControls();b.emit('mouseup');b.emit('click');assert.equal(G.world.road.some(Boolean),false);assert(G.roadPlan);f.click(b);assert.equal(G.world.road[i],1);
});
test('pressed paving confirmation cannot silently become a new tree marking action',()=>{
 const f=roadFixture(),{G,doc}=f,i=3*G.world.N+5;f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();const b=doc.getElementById('road-confirm');b.emit('mousedown');b.focus();G.world.treeIdx[i]=7;G.ui.refreshRoadControls();b.emit('mouseup');b.emit('click');assert.equal(G.world.marked.size,0);assert.equal(G.world.road.some(Boolean),false);f.click(b);assert.equal(G.world.marked.has(i),true);
});
test('held Enter repeats cannot upgrade cleared-tree intent into paving without a fresh key press',()=>{
 const f=roadFixture(),{G,doc}=f,i=3*G.world.N+5;G.world.treeIdx[i]=7;f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();const b=doc.getElementById('road-confirm');b.focus();b.emit('keydown',{key:'Enter',repeat:false});b.emit('click');assert.equal(G.world.marked.has(i),true);G.world.treeIdx[i]=-1;G.ui.refreshRoadControls();b.emit('keydown',{key:'Enter',repeat:true});b.emit('click');assert.equal(G.world.road.some(Boolean),false);b.emit('keyup',{key:'Enter'});b.emit('keydown',{key:'Enter',repeat:false});b.emit('click');assert.equal(G.world.road[i],1);
});
test('late touchend from a previous tool generation cannot create a new road start',()=>{
 const{G,doc}=roadFixture(),cv=doc.getElementById('game'),t={clientX:3,clientY:3};cv.emit('touchstart',{touches:[t]});G.setTool('fell');G.setTool('road');cv.emit('touchend',{changedTouches:[t]});assert.equal(G.roadPlan,null);
});
test('native pointerdown captures the same confirmation intent as legacy mouse input',()=>{
 const f=roadFixture(true),{G,doc}=f,i=3*G.world.N+5;G.world.treeIdx[i]=7;f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();const b=doc.getElementById('road-confirm');b.emit('pointerdown',{pointerType:'touch'});G.world.treeIdx[i]=-1;G.ui.refreshRoadControls();b.emit('pointerup',{pointerType:'touch'});b.emit('click');assert.equal(G.world.road.some(Boolean),false);
});
test('small repeated pointer jitter still selects road endpoints',()=>{
 const f=roadFixture(),{G,doc}=f,cv=doc.getElementById('game');
 cv.emit('mousedown',{clientX:3,clientY:3});
 for(let i=0;i<8;i++) cv.emit('mousemove',{clientX:3.5,clientY:3});
 cv.emit('mouseup',{clientX:3.5,clientY:3});
 assert(G.roadPlan && G.roadPlan.start, 'subpixel jitter must not discard a click');
 cv.emit('mousedown',{clientX:8,clientY:3});
 for(let i=0;i<12;i++) cv.emit('mousemove',{clientX:8.5,clientY:3});
 cv.emit('mouseup',{clientX:8.5,clientY:3});
 assert(G.roadPlan.end, 'repeated small move events must not discard endpoint');
 G.ui.refreshRoadControls();f.click(doc.getElementById('road-confirm'));
 assert.equal(G.world.road[3*G.world.N+5],1);
});
test('drag interruption, stale tool generation and world changes cannot complete a route',()=>{
 for(const interrupt of ['blur','tool','world','panel']){
  const f=roadFixture(),{G,doc,ctx,panel}=f,cv=doc.getElementById('game');
  cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});assert(G.roadDrag);
  if(interrupt==='blur')ctx.emit('blur');
  if(interrupt==='tool'){G.setTool('fell');G.setTool('road');}
  if(interrupt==='world')G.newGame(1);
  if(interrupt==='panel')ctx.emit('mousemove',{clientX:12,clientY:3,target:panel});
  cv.emit('mouseup',{clientX:15,clientY:3});assert.equal(G.roadPlan,null,interrupt);assert.equal(G.roadDrag,null,interrupt);
 }
});
test('middle button pans camera without road planning; invalid drag start stays an error',()=>{
 const{G,doc}=roadFixture(),cv=doc.getElementById('game'),x=G.cam.x;
 cv.emit('mousedown',{button:1,clientX:3,clientY:3});cv.emit('mousemove',{clientX:20,clientY:3});cv.emit('mouseup',{button:1,clientX:20,clientY:3});assert.equal(G.cam.x,x+17);assert.equal(G.roadPlan,null);
 G.world.water[3*G.world.N+3]=1;cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:20,clientY:3});cv.emit('mouseup',{clientX:20,clientY:3});assert.equal(G.roadPlan.start,null);assert.equal(G.roadPlanStatus().ok,false);assert.equal(G.world.road.some(Boolean),false);
});
console.log(`Road plan UI: ${passed} passed (DOM/event fixtures, not real browser/mobile acceptance)`);
