'use strict';
// Real input handlers with DOM fixtures. Browser gesture arbitration is checked separately.
const assert = require('node:assert/strict');
const {fixture} = require('./helpers/field-ui');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function bindInput(type = null) {
  const f = fixture(), G = f.G, canvas = f.mount('game'), handlers = {};
  canvas.style = {}; canvas.clientWidth = 1200; canvas.clientHeight = 800;
  canvas.getContext = () => ({});
  canvas.getBoundingClientRect = () => ({left:17,top:29,width:1200,height:800});
  // Model capture order and stopImmediatePropagation, which the shared layout
  // fixture does not need. Camera gestures must preempt every tool listener.
  canvas.addEventListener = (name, fn, options = {}) => (handlers[name] ||= []).push({fn,capture:!!options.capture});
  function touch(name, points, changed = points) {
    const convert = ([x,y]) => ({clientX:17+x,clientY:29+y});
    const e = {type:name,target:canvas,touches:points.map(convert),targetTouches:points.map(convert),
      changedTouches:changed.map(convert),defaultPrevented:false,stopped:false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; }};
    for (const capture of [true,false]) for (const handler of handlers[name] || []) {
      if (e.stopped) return e;
      if (handler.capture === capture) handler.fn(e);
    }
    return e;
  }
  G.ui.init = () => {}; G.feedback = {init(){}};
  G.tryReplayLoad = () => true; G.probeServerSaves = () => {};
  G.init(); G.setTool(type); G.cam = {x:600,y:200,z:1};
  function begin(a = [100,200], b = [200,200]) {
    touch('touchstart',[a]);
    assert(touch('touchstart',[a,b]).defaultPrevented);
  }
  function end() { return touch('touchend',[],[[120,230],[220,230]]); }
  function tapTile(x = 10, y = 10) {
    const [sx,sy] = G.T2S(x+.25,y+.25), p = [sx*G.cam.z+G.cam.x,sy*G.cam.z+G.cam.y];
    touch('touchstart',[p]); touch('touchend',[],[p]);
  }
  return Object.assign(f,{canvas,touch,begin,end,tapTile});
}
const snapshot = G => JSON.stringify(G.serializeGame());
const near = (actual, expected) => assert(Math.abs(actual-expected) < 1e-8, `${actual} != ${expected}`);

for (const type of [null,'house','farm','pasture','orchard','cemetery','road','stoneroad','bridge','tunnel','fell','quarry','gatherall','collectstone','collectiron','cancelremoval','demolish']) {
  test('two fingers pan with ' + (type || 'no tool') + ' without issuing work', () => {
    const f = bindInput(type), {G} = f, tool = G.tool, before = snapshot(G);
    f.begin();
    assert(f.touch('touchmove',[[120,230],[220,230]]).defaultPrevented);
    near(G.cam.x,620); near(G.cam.y,230); near(G.cam.z,1);
    assert(f.touch('touchend',[[120,230]],[[220,230]]).defaultPrevented);
    f.touch('touchmove',[[140,250]]);
    assert(f.end().defaultPrevented);
    assert.equal(G.tool,tool); assert.equal(snapshot(G),before);
    assert.equal(G.pendingBuildingPlacement,null); assert.equal(G.roadPlan,null); assert.equal(G.harvestPlan,null);
  });
}

test('pinch keeps the map beneath the moving midpoint and shares wheel limits', () => {
  const f = bindInput('house'), {G} = f;
  f.begin([350,300],[450,300]);
  f.touch('touchmove',[[330,320],[530,320]]);
  near(G.cam.z,2); near(G.cam.x,830); near(G.cam.y,120);
  f.touch('touchmove',[[30,320],[830,320]]); near(G.cam.z,2.6);
  f.touch('touchmove',[[429,320],[431,320]]); near(G.cam.z,0.55);
  f.end();
});

test('two-finger pan stays within the existing map bounds', () => {
  const f = bindInput(), {G} = f, half = G.world.N*32;
  f.begin(); f.touch('touchmove',[[20100,20200],[20200,20200]]);
  near(G.cam.x,1200-60+half); near(G.cam.y,800-60);
  f.touch('touchmove',[[-20100,-20200],[-20000,-20200]]);
  near(G.cam.x,60-half); near(G.cam.y,60-half); f.end();
});

test('camera gesture invalidates a staged building and the old confirm intent', () => {
  const f = bindInput('house'), {G} = f;
  assert(G.stageBuildingPlacement(10,10).ok); const pending = G.pendingBuildingPlacement;
  f.begin(); f.end();
  assert.equal(G.pendingBuildingPlacement,null); assert.equal(G.confirmBuildingPlacement(pending).ok,false);
  assert.equal(G.world.buildings.length,0);
  f.tapTile(); assert(G.currentBuildingPlacement());
});

test('camera gesture discards road endpoints and never queues construction', () => {
  const f = bindInput('road'), {G} = f;
  G.selectRoadEndpoint(3,3); G.selectRoadEndpoint(8,3); assert(G.roadPlan.end);
  const before = snapshot(G); f.begin(); f.end();
  assert.equal(G.roadPlan,null); assert.equal(G.confirmRoadPlan().ok,false); assert.equal(snapshot(G),before);
  f.tapTile(3,3); assert(G.roadPlan.start); assert.equal(G.roadPlan.end,null);
});

test('camera gesture discards the harvest first corner without marking resources', () => {
  const f = bindInput('quarry'), {G} = f;
  G.world.rock[3*G.world.N+3] = 1;
  G.selectHarvestCorner(3,3); assert(G.harvestPlan.awaitingSecond);
  f.begin(); f.touch('touchmove',[[120,230],[220,230]]); f.end();
  assert.equal(G.harvestPlan,null); assert.equal(G.world.markedRocks.size,0);
  f.tapTile(3,3); assert(G.harvestPlan.awaitingSecond); assert.equal(G.world.markedRocks.size,0);
});

test('camera gesture clears an unconfirmed cemetery area', () => {
  const f = bindInput('cemetery'), {G} = f;
  G.selectCemeteryCorner(3,3); assert(G.cemeteryPlan);
  f.begin(); f.end(); assert.equal(G.cemeteryPlan,null); assert.equal(G.world.buildings.length,0);
});

for (const initial of [true,false]) test('a modal blocks the camera for the remaining gesture, initial=' + initial, () => {
  const f = bindInput('house'), {G} = f, before = {...G.cam};
  let modal = initial; G.hasOpenModal = () => modal;
  f.begin(); modal = true;
  f.touch('touchmove',[[120,230],[220,230]]); modal = false;
  f.touch('touchmove',[[140,250],[240,250]]); f.end();
  assert.deepEqual(G.cam,before); assert.equal(G.pendingBuildingPlacement,null);
  f.begin(); f.touch('touchmove',[[120,230],[220,230]]); f.end(); near(G.cam.x,before.x+20);
});

for (const interrupt of ['touchcancel','blur','hidden','world','game']) test(interrupt + ' stops the gesture and a fresh touch still works', () => {
  const f = bindInput('house'), {G} = f, before = {...G.cam}; f.begin();
  if (interrupt === 'touchcancel') f.touch('touchcancel',[],[[100,200],[200,200]]);
  if (interrupt === 'blur') f.windowEvent('blur');
  if (interrupt === 'hidden') { f.doc.visibilityState = 'hidden'; f.documentEvent('visibilitychange'); }
  if (interrupt === 'world') G.world = {...G.world};
  if (interrupt === 'game') G.game = {...G.game};
  f.touch('touchmove',[[120,230],[220,230]]); f.end();
  assert.deepEqual(G.cam,before); assert.equal(G.pendingBuildingPlacement,null);
  f.doc.visibilityState = 'visible'; f.tapTile(); assert(G.currentBuildingPlacement());
});

test('single-finger exploration still pans and stops when a modal opens', () => {
  const f = bindInput(), {G} = f;
  f.touch('touchstart',[[100,200]]); f.touch('touchmove',[[120,230]]);
  near(G.cam.x,620); near(G.cam.y,230);
  G.hasOpenModal = () => true;
  f.touch('touchmove',[[140,250]]); f.end();
  near(G.cam.x,620); near(G.cam.y,230);
});

console.log(`Mobile map input: ${passed} passed (DOM/event fixtures, not real phone validation)`);
