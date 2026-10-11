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
  Object.assign(G.ui, { init() { this.initHarvestControls(); this.initRoadControls(); this.initFarmPlanControls(); }, toast() {}, refreshHUD() {}, hideInfo() { G.sel = null; }, tickInfo() {} });
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

function farmFixture(pointer=false){const f=fixture(pointer),{G,doc,panel}=f,w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];G.bumpNavigation(w);G.addBuilding('storage',2,2,{instant:true,free:true});const controls=doc.getElementById('farm-plan-controls');panel.appendChild(controls);for(const id of ['farm-plan-confirm','farm-plan-cancel','farm-plan-status'])controls.appendChild(doc.getElementById(id));G.setTool('farm');f.tap=(x,y)=>{doc.getElementById('game').emit('mousedown',{clientX:x,clientY:y});doc.getElementById('game').emit('mouseup',{clientX:x,clientY:y});};f.plan=()=>{f.tap(10,10);f.tap(13,16);G.ui.refreshFarmPlanControls();};return f;}
let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
const fields=G=>G.world.buildings.filter(b=>b.type==='farm');
test('mouse two-corner preview confirms once without click-through and shows actual dimensions and non-guaranteed labour/yield',()=>{const f=farmFixture(),{G,doc}=f;f.tap(10,10);assert.equal(G.farmPlan.end,null);assert.equal(fields(G).length,0);f.tap(13,16);G.ui.refreshFarmPlanControls();const text=doc.getElementById('farm-plan-status').textContent;assert.match(text,/4×7.*28格/);assert.match(text,/上限 1 人.*不保证/);assert.match(text,/392.*不是保证入库/);assert.equal(fields(G).length,0);const button=doc.getElementById('farm-plan-confirm');assert.equal(button.disabled,false);f.click(button);assert.equal(fields(G).length,1);assert.equal(fields(G)[0].farm.length,28);assert.equal(G.farmPlan,null);f.click(button);assert.equal(fields(G).length,1);});
test('mouse drag only draws pending rectangle; release freezes and explicit confirm creates site',()=>{const f=farmFixture(),{G,doc}=f,cv=doc.getElementById('game');cv.emit('mousedown',{clientX:10,clientY:10});for(let x=11;x<=24;x++)cv.emit('mousemove',{clientX:x,clientY:24});assert(G.farmDrag);assert.equal(fields(G).length,0);G.ui.refreshFarmPlanControls();assert(doc.getElementById('farm-plan-confirm').disabled);cv.emit('mouseup',{clientX:24,clientY:24});assert.equal(G.farmDrag,null);assert.equal(G.farmPlanStatus().area,225);G.ui.refreshFarmPlanControls();f.click(doc.getElementById('farm-plan-confirm'));assert.equal(fields(G)[0].w,15);assert.equal(fields(G)[0].h,15);});
test('touch corners work without hover, while swipes multitouch and cancellation do not create plots',()=>{const f=farmFixture(),{G,doc}=f,cv=doc.getElementById('game');for(const [x,y]of [[10,10],[13,13]]){const t={clientX:x,clientY:y};assert(cv.emit('touchstart',{touches:[t]}).defaultPrevented);cv.emit('touchend',{changedTouches:[t]});}assert.equal(G.farmPlanStatus().area,16);assert.equal(fields(G).length,0);cv.emit('touchcancel');assert.equal(G.farmPlan,null);cv.emit('touchstart',{touches:[{clientX:10,clientY:10}]});cv.emit('touchmove',{touches:[{clientX:30,clientY:30}]});cv.emit('touchend',{changedTouches:[{clientX:30,clientY:30}]});assert.equal(G.farmPlan,null);cv.emit('touchstart',{touches:[{},{}]});cv.emit('touchend',{changedTouches:[{clientX:13,clientY:13}]});assert.equal(G.farmPlan,null);});
test('invalid size or blocked ground disables confirmation with rejection reason, not silent clipping',()=>{const f=farmFixture(),{G,doc}=f;f.tap(10,10);f.tap(25,13);G.ui.refreshFarmPlanControls();assert(doc.getElementById('farm-plan-confirm').disabled);assert.match(doc.getElementById('farm-plan-status').textContent,/4至15.*16×4/);f.tap(10,10);f.tap(13,13);G.world.water[11*G.world.N+11]=1;G.ui.refreshFarmPlanControls();assert.match(doc.getElementById('farm-plan-status').textContent,/水上/);f.click(doc.getElementById('farm-plan-confirm'));assert.equal(fields(G).length,0);});
test('cancel or Escape clears only preview and world/tool ABA cannot complete an old mouse gesture',()=>{const f=farmFixture(),{G,doc,ctx}=f;f.plan();const stock=JSON.stringify(G.game.res);f.click(doc.getElementById('farm-plan-cancel'));assert.equal(G.farmPlan,null);assert.equal(JSON.stringify(G.game.res),stock);assert.equal(fields(G).length,0);f.plan();ctx.emit('keydown',{key:'Escape'});assert.equal(G.tool,null);assert.equal(G.farmPlan,null);G.setTool('farm');const cv=doc.getElementById('game');cv.emit('mousedown',{clientX:10,clientY:10});G.setTool('road');G.setTool('farm');cv.emit('mouseup',{clientX:13,clientY:13});assert.equal(G.farmPlan,null);});
test('pressed old confirmation cannot accept changed trees, replacement plan or world after readonly refresh',()=>{for(const mutation of [(G)=>G.addTree(G.world,11,11,-100),(G)=>{G.cancelFarmPlan();G.selectFarmCorner(20,20);G.selectFarmCorner(23,23);},(G)=>G.world={...G.world}]){const f=farmFixture(),{G,doc}=f;f.plan();const button=doc.getElementById('farm-plan-confirm');button.emit('mousedown');mutation(G);G.ui.refreshFarmPlanControls();button.emit('mouseup');button.emit('click');assert.equal(fields(G).length,0);}});
test('keyboard-repeat intent cannot create a newer plan; modal prevents confirmation and refresh is read-only',()=>{const f=farmFixture(true),{G,doc}=f;f.plan();const button=doc.getElementById('farm-plan-confirm'),text=doc.getElementById('farm-plan-status');button.focus();const before=JSON.stringify(G.serializeGame()),writes=text.textWrites;for(let i=0;i<20;i++)G.ui.refreshFarmPlanControls();assert.equal(doc.activeElement,button);assert.equal(text.textWrites,writes);assert.equal(JSON.stringify(G.serializeGame()),before);doc.getElementById('help').classList.remove('hidden');button.emit('click');assert.equal(fields(G).length,0);doc.getElementById('help').classList.add('hidden');button.emit('keydown',{key:'Enter'});button.emit('click');assert.equal(fields(G).length,1);G.selectFarmCorner(20,20);G.selectFarmCorner(23,23);G.ui.refreshFarmPlanControls();button.emit('keydown',{key:'Enter',repeat:true});button.emit('click');assert.equal(fields(G).length,1);button.emit('keyup',{key:'Enter'});button.emit('keydown',{key:'Enter'});button.emit('click');assert.equal(fields(G).length,2);});
test('HTML and CSS keep preview in placement panel with touch-sized controls and no extra permanent map grid',()=>{assert.match(html,/id="farm-plan-controls"/);assert.match(css,/#farm-plan-controls button[^}]*min-height:44px/);assert.match(css,/#farm-plan-status[^}]*white-space:pre-line/);const f=farmFixture();f.plan();f.G.setTool(null);f.G.ui.refreshFarmPlanControls();assert(f.doc.getElementById('farm-plan-controls').classList.contains('hidden'));});
console.log('Farm planning UI: '+passed+' passed (DOM/input/CSS, not browser acceptance)');
