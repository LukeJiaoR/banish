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
  for (const kind of ['fell', 'quarry', 'demolish', 'farm', 'road', 'stoneroad', 'bridge']) {
    const btn = toolbar.appendChild(element('tool-' + kind, 'BUTTON')); btn.dataset.tool = kind;
    btn.addEventListener('click', () => { if (!G.hasOpenModal()) G.setTool(kind); });
  }
  doc.getElementById('game').parentNode = doc;
  G.ui.el = { toolbar, placement, harvestCancel: controls, cancelTrees: trees, cancelRocks: rocks, cancelStatus: status,
    help: doc.getElementById('help'), info: doc.getElementById('info') };
  // This fixture checks preview/input controls; road-work-ui.js exercises full project details.
  Object.assign(G.ui, { init() { this.initHarvestControls(); this.initRoadControls(); }, toast() {}, refreshHUD() {}, showInfo() { this.el.info.classList.remove('hidden'); }, hideInfo() { G.sel = null; }, tickInfo() {} });
  G.feedback = { init() {}, close() { doc.getElementById('fb').classList.add('hidden'); } };
  G.T2S = () => [0, 0]; G.cam = { x: 0, y: 0, z: 1 }; G.groundDirty = new Set(); G.markGroundDirty = () => {};
  G.autosave = () => {}; G.frame = () => {}; G.screenToTile = G.screenToMapTile = (x, y) => ({ tx: x, ty: y }); // Same flat-map fixture for the terrain-aware input mapper.
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
const projects = G => G.world.buildings.filter(b => b.type === 'roadwork');
function assertQueuedAt(G, x, y, surface = 'dirt') {
  assert.equal(G.world.road[y*G.world.N+x], 0);
  const b = G.roadWorkAt(G.world,x,y); assert(b, 'confirmed cell belongs to an actual road project');
  assert.equal(b.type, 'roadwork'); assert.equal(b.state, 'site'); assert.equal(b.roadWork.surface, surface);
  assert.equal(G.world.bgrid[y*G.world.N+x], -1);
  return b;
}
let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name)}
test('mouse endpoints preview only; confirm queues construction and cannot click through',()=>{
  const f=roadFixture(),{G,doc}=f;f.tap(3,3);assert.equal(G.roadPlan.end,null);f.tap(8,3);assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);
  G.ui.refreshRoadControls();const button=doc.getElementById('road-confirm');assert.equal(button.disabled,false);f.click(button);assertQueuedAt(G,5,3);assert.equal(G.roadPlan,null);
});
test('mouse drag previews actual tiles once per crossed tile and releases one project',()=>{
 const f=roadFixture(),{G,doc}=f,cv=doc.getElementById('game');let calls=0;const plan=G.planRoad;
 G.planRoad=(...a)=>{calls++;assert.equal(a[3].maxExpanded,2000);return plan(...a);};
 cv.emit('mousedown',{clientX:3,clientY:3});
 for(let x=8;x<=20;x++)cv.emit('mousemove',{clientX:x,clientY:3});
 assert.equal(calls,13);assert(G.roadDrag.live);assert.equal(G.roadPlan.end.x,20);
 const shown=JSON.stringify(G.roadPlan.result.path);
 for(let i=0;i<10;i++)cv.emit('mousemove',{clientX:20.1,clientY:3});assert.equal(calls,13);
 assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);
 G.ui.refreshRoadControls();assert.equal(doc.getElementById('road-confirm').disabled,true);
 const status=doc.getElementById('road-plan-status'),writes=status.textWrites;for(let i=0;i<10;i++)G.ui.refreshRoadControls();assert.equal(status.textWrites,writes);
 cv.emit('mouseup',{clientX:20,clientY:3});assert.equal(G.roadDrag,null);assert.equal(calls,13);assert.equal(G.roadPlan,null);
 assertQueuedAt(G,12,3);assert.equal(JSON.stringify(projects(G)[0].roadWork.cells.map(({x,y})=>({x,y}))),shown);
 assert.equal(G.tool.kind,'road');cv.emit('mouseup',{clientX:20,clientY:3});assert.equal(projects(G).length,1);
 cv.emit('mousedown',{clientX:20,clientY:3});cv.emit('mousemove',{clientX:20,clientY:12});cv.emit('mouseup',{clientX:20,clientY:12});
 assert.equal(projects(G).length,2);assertQueuedAt(G,20,8);
});
test('native one-finger touch endpoints preview without hover or synthetic mouse',()=>{
  const{G,doc}=roadFixture(),cv=doc.getElementById('game');for(const x of [3,8]){const t={clientX:x,clientY:3};const e=cv.emit('touchstart',{touches:[t]});assert.equal(e.defaultPrevented,true);cv.emit('touchend',{changedTouches:[t]});}assert.equal(G.roadPlan.result.steps,5);assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);
});
test('touch movement and cancellation do not lay road',()=>{
  const{G,doc}=roadFixture(),cv=doc.getElementById('game');cv.emit('touchstart',{touches:[{clientX:3,clientY:3}]});cv.emit('touchmove',{touches:[{clientX:30,clientY:3}]});cv.emit('touchend',{changedTouches:[{clientX:30,clientY:3}]});assert.equal(G.roadPlan,null);cv.emit('touchcancel');assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);
});
test('tool changes and Escape discard only unconfirmed plan',()=>{
  const f=roadFixture();f.tap(3,3);f.tap(8,3);f.G.setTool('fell');assert.equal(f.G.roadPlan,null);f.G.setTool('road');f.tap(3,3);f.ctx.emit('keydown',{key:'Escape'});assert.equal(f.G.roadPlan,null);assert.equal(f.G.tool,null);
});
test('modal guard blocks confirm and endpoint taps; UI control identity survives updates',()=>{
  const f=roadFixture(),button=f.doc.getElementById('road-confirm');f.tap(3,3);f.tap(8,3);button.focus();f.G.ui.refreshRoadControls();assert.equal(f.doc.activeElement,button);f.doc.getElementById('help').classList.remove('hidden');f.click(button);assert.equal(f.G.world.road.some(Boolean),false);assert.equal(projects(f.G).length,0);f.tap(10,3);assert.equal(f.G.roadPlan.end.x,8);
});
test('backgrounding clears preview and pending touch; resource-goal modal also blocks paving',()=>{
 const f=roadFixture(),{G,doc}=f,cv=doc.getElementById('game');f.tap(3,3);f.tap(8,3);doc.getElementById('production-goals').classList.remove('hidden');f.click(doc.getElementById('road-confirm'));assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);doc.getElementById('production-goals').classList.add('hidden');cv.emit('touchstart',{touches:[{clientX:9,clientY:3}]});doc.visibilityState='hidden';doc.emit('visibilitychange');assert.equal(G.roadPlan,null);doc.visibilityState='visible';cv.emit('touchend',{changedTouches:[{clientX:9,clientY:3}]});assert.equal(G.roadPlan,null);
});
test('compact road controls keep native touch targets and suppress competing guide',()=>{assert.match(css,/#road-controls button[^}]*min-height: 44px/);assert.match(css,/#hud:has\(#road-controls:not\(\.hidden\)\) #survival-guide\s*\{ display: none/);for(const id of ['road-confirm','road-cancel'])assert.match(html,new RegExp('<button type="button" id="'+id+'"'));assert.doesNotMatch(fs.readFileSync(path.join(root,'js/render.js'),'utf8'),/G\.planRoad\(/)});
test('pressed clear confirmation cannot become paving when the last tree disappears',()=>{
 const f=roadFixture(),{G,doc}=f,i=3*G.world.N+5;G.world.treeIdx[i]=7;f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();const b=doc.getElementById('road-confirm');b.emit('mousedown');b.focus();G.world.treeIdx[i]=-1;G.ui.refreshRoadControls();b.emit('mouseup');b.emit('click');assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);assert(G.roadPlan);f.click(b);assertQueuedAt(G,5,3);
});
test('pressed paving confirmation cannot silently become a new tree marking action',()=>{
 const f=roadFixture(),{G,doc}=f,i=3*G.world.N+5;f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();const b=doc.getElementById('road-confirm');b.emit('mousedown');b.focus();G.world.treeIdx[i]=7;G.ui.refreshRoadControls();b.emit('mouseup');b.emit('click');assert.equal(G.world.marked.size,0);assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);f.click(b);assert.equal(G.world.marked.has(i),true);
});
test('held Enter repeats cannot duplicate the queued clearing order',()=>{
 const f=roadFixture(),{G,doc}=f,i=3*G.world.N+5;G.world.treeIdx[i]=7;f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();const b=doc.getElementById('road-confirm');b.focus();b.emit('keydown',{key:'Enter',repeat:false});b.emit('click');assert(G.world.marked.has(i));assert.equal(projects(G).length,1);G.world.treeIdx[i]=-1;G.ui.refreshRoadControls();b.emit('keydown',{key:'Enter',repeat:true});b.emit('click');assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,1);assert.equal(G.roadPlan,null);
});
test('late touchend from a previous tool generation cannot create a new road start',()=>{
 const{G,doc}=roadFixture(),cv=doc.getElementById('game'),t={clientX:3,clientY:3};cv.emit('touchstart',{touches:[t]});G.setTool('fell');G.setTool('road');cv.emit('touchend',{changedTouches:[t]});assert.equal(G.roadPlan,null);
});
test('native pointerdown captures the same confirmation intent as legacy mouse input',()=>{
 const f=roadFixture(true),{G,doc}=f,i=3*G.world.N+5;G.world.treeIdx[i]=7;f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();const b=doc.getElementById('road-confirm');b.emit('pointerdown',{pointerType:'touch'});G.world.treeIdx[i]=-1;G.ui.refreshRoadControls();b.emit('pointerup',{pointerType:'touch'});b.emit('click');assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);
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
 assertQueuedAt(G,5,3);
});
test('drag interruption, stale tool generation and world changes cannot complete a route',()=>{
 for(const interrupt of ['blur','tool','world','panel','pointercancel']){
  const f=roadFixture(),{G,doc,ctx,panel}=f,cv=doc.getElementById('game');
  cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});assert(G.roadDrag);
  if(interrupt==='blur')ctx.emit('blur');
  if(interrupt==='pointercancel')cv.emit('pointercancel');
  if(interrupt==='tool'){G.setTool('fell');G.setTool('road');}
  if(interrupt==='world')G.newGame(1);
  if(interrupt==='panel')ctx.emit('mousemove',{clientX:12,clientY:3,target:panel});
  cv.emit('mouseup',{clientX:15,clientY:3});assert.equal(G.roadPlan,null,interrupt);assert.equal(G.roadDrag,null,interrupt);
 }
});
test('middle button pans camera without road planning; invalid drag start stays an error',()=>{
 const{G,doc}=roadFixture(),cv=doc.getElementById('game'),x=G.cam.x;
 cv.emit('mousedown',{button:1,clientX:3,clientY:3});cv.emit('mousemove',{clientX:20,clientY:3});cv.emit('mouseup',{button:1,clientX:20,clientY:3});assert.equal(G.cam.x,x+17);assert.equal(G.roadPlan,null);
 G.world.water[3*G.world.N+3]=1;cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:20,clientY:3});cv.emit('mouseup',{clientX:20,clientY:3});assert.equal(G.roadPlan.start,null);assert.equal(G.roadPlanStatus().ok,false);assert.equal(G.world.road.some(Boolean),false);assert.equal(projects(G).length,0);
});
test('stone road UI previews upgrade cost, preserves focus and guards stale mode confirmation',()=>{
 const f=roadFixture(),{G,doc}=f;G.setTool('stoneroad');assert.equal(doc.getElementById('tool-stoneroad').getAttribute('aria-pressed'),'true');f.tap(3,3);f.tap(8,3);G.ui.refreshRoadControls();assert.match(doc.getElementById('road-plan-status').textContent,/合计 6 石/);const button=doc.getElementById('road-confirm');button.focus();const stone=G.game.res.stone;f.click(button);assert.equal(G.game.res.stone,stone);assertQueuedAt(G,5,3,'stone');assert.equal(projects(G)[0].construction.required.stone,6);assert.equal(doc.activeElement,button);
 f.tap(3,4);f.tap(8,4);G.ui.refreshRoadControls();button.emit('mousedown');G.setTool('road');f.tap(3,5);f.tap(8,5);G.ui.refreshRoadControls();button.emit('click');assert.equal(G.world.road[5*G.world.N+5],0);assert.equal(G.roadWorkAt(G.world,5,5),null);assert.equal(projects(G).length,1);
});
test('bridge UI reports snapped banks and construction cost before committing real blocked worksite',()=>{
 const f=roadFixture(),{G,doc}=f,w=G.world;w.buildings=[];w.bmap={};w.citizens.forEach(c=>{c.x=8;c.y=10;c.job=null;c.task=null;c.pausedTask=null});for(let y=0;y<w.N;y++)for(let x=10;x<=12;x++)w.water[y*w.N+x]=1;G.setTool('bridge');f.tap(9,10);f.tap(13,11);G.ui.refreshRoadControls();assert.equal(G.roadPlan.end.y,10);assert.match(doc.getElementById('road-plan-status').textContent,/木材 20 \/ 石头 5/);const button=doc.getElementById('road-confirm');assert.equal(button.textContent,'确认建桥');f.click(button);const b=w.buildings.find(b=>b.type==='bridge');assert(b);assert.equal(b.state,'site');assert.equal(G.tileBlocked(w,11,10),true);assert.equal(G.roadPlan,null);
});
test('changed release endpoint is preview-only until a fresh explicit confirmation',()=>{
 const f=roadFixture(),{G,doc}=f,cv=doc.getElementById('game');
 cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});cv.emit('mouseup',{clientX:15,clientY:3});
 assert.equal(projects(G).length,0);assert.equal(G.roadPlan.end.x,15);assert.match(G.roadPlan.message,/终点已更新/);
 f.click(doc.getElementById('road-confirm'));assertQueuedAt(G,15,3);
});
test('drag queues clearing and construction together but rejects changed tree intent',()=>{
 for(const change of ['none','removed','added']){
  const f=roadFixture(),{G,doc}=f,cv=doc.getElementById('game'),i=3*G.world.N+5;
  if(change!=='added')G.world.treeIdx[i]=7;
  cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});
  if(change==='removed')G.world.treeIdx[i]=-1;if(change==='added')G.world.treeIdx[i]=7;
  cv.emit('mouseup',{clientX:12,clientY:3});assert.equal(projects(G).length,change==='none'?1:0);
  assert.equal(G.world.marked.has(i),change==='none');assert.equal(G.world.road.some(Boolean),false);
  if(change==='none'){assert.equal(G.roadPlan,null);assertQueuedAt(G,5,3);assert.match(doc.getElementById('road-plan-status').textContent,/自动施工/);}else assert(G.roadPlan);
 }
});
test('mouse mineral drag confirms exactly the shown mineral types on release',()=>{
 for(const changed of [false,true]){
  const {G,doc}=roadFixture(),cv=doc.getElementById('game'),w=G.world;
  w.rock[3*w.N+5]=1;w.rock[3*w.N+8]=2;
  cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});
  assert.equal(G.roadPlan.result.clearRocks.length,2);assert.equal(w.markedRocks.size,0);
  if(changed)w.rock[3*w.N+5]=2;
  cv.emit('mouseup',{clientX:12,clientY:3});assert.equal(projects(G).length,changed?0:1);
  assert.equal(w.markedRocks.size,changed?0:2);assert.equal(w.road.some(Boolean),false);
 }
});
test('new obstacles reject the displayed route rather than silently rerouting',()=>{
 const {G,doc}=roadFixture(),cv=doc.getElementById('game');
 cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});const shown=JSON.stringify(G.roadPlan.result.path);
 G.world.water[3*G.world.N+6]=1;cv.emit('mouseup',{clientX:12,clientY:3});
 assert.equal(projects(G).length,0);assert.equal(JSON.stringify(G.roadPlan.result.path),shown);assert.equal(G.roadPlanStatus().ok,false);
});
test('right click, modal, off-canvas release and replaced game cancel live drag',()=>{
 for(const mode of ['right','modal','outside','game']){
  const {G,doc,ctx}=roadFixture(),cv=doc.getElementById('game');cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});
  if(mode==='right')cv.emit('mousedown',{button:2,clientX:12,clientY:3});
  if(mode==='modal')doc.getElementById('help').classList.remove('hidden');
  if(mode==='game')G.game={...G.game};
  (mode==='outside'?ctx:cv).emit('mouseup',{clientX:12,clientY:3});
  assert.equal(projects(G).length,0,mode);assert.equal(G.roadPlan,null,mode);assert.equal(G.roadDrag,null,mode);
 }
});
test('stone drag queues real material demand without spending inventory',()=>{
 const {G,doc}=roadFixture(),cv=doc.getElementById('game');G.setTool('stoneroad');const stone=G.game.res.stone;
 cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});cv.emit('mouseup',{clientX:12,clientY:3});
 assertQueuedAt(G,5,3,'stone');assert.equal(G.game.res.stone,stone);assert.equal(projects(G)[0].construction.required.stone,10);
});
test('budget failures remain uncommitted errors',()=>{
 const {G,doc}=roadFixture(),cv=doc.getElementById('game');G.planRoad=()=>({ok:false,reason:'路线计算达到预算',budgetExceeded:true});
 cv.emit('mousedown',{clientX:3,clientY:3});cv.emit('mousemove',{clientX:12,clientY:3});cv.emit('mouseup',{clientX:12,clientY:3});
 assert.equal(projects(G).length,0);assert.equal(G.roadPlan.result.budgetExceeded,true);assert.equal(doc.getElementById('road-confirm').disabled,true);
});
test('bridge drag keeps endpoint guide and requires separate confirmation',()=>{
 const {G,doc}=roadFixture(),cv=doc.getElementById('game'),w=G.world;
 for(let y=0;y<w.N;y++)for(let x=10;x<=15;x++)w.water[y*w.N+x]=1;
 G.setTool('bridge');cv.emit('mousedown',{clientX:9,clientY:10});cv.emit('mousemove',{clientX:16,clientY:10});assert(!G.roadDrag.live);assert.equal(G.roadPlan,null);
 cv.emit('mouseup',{clientX:16,clientY:10});assert(G.roadPlan);assert.equal(w.buildings.filter(b=>b.type==='bridge').length,0);
});
console.log(`Road plan UI: ${passed} passed (DOM/event fixtures, not real browser/mobile acceptance)`);
