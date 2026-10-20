'use strict';
// Real input, placement and frame contracts with offline DOM/canvas stubs.
// These checks do not claim visual browser acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fixture} = require('./helpers/field-ui');
const {loadGame} = require('./helpers/playability');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function bindInput(type = 'house') {
  const f = fixture(), G = f.G, canvas = f.mount('game');
  G.ui.initToolbar(); G.setTool(type);
  canvas.style = {}; canvas.getContext = () => ({});
  canvas.getBoundingClientRect = () => ({left:17,top:29});
  G.ui.init = () => {}; G.feedback = {init(){}};
  G.tryReplayLoad = () => true; G.probeServerSaves = () => {}; G.init();
  function point(x,y) {
    const [sx,sy] = G.T2S(x+.25,y+.25);
    return {clientX:17+sx*G.cam.z+G.cam.x,clientY:29+sy*G.cam.z+G.cam.y,target:canvas,button:0};
  }
  function mouse(event,x=10,y=10,props={}) {
    const e = {...point(x,y),...props};
    return event === 'mousedown' ? canvas.emit(event,e) : f.windowEvent(event,e);
  }
  function touch(event,x=10,y=10,props={}) {
    const p = point(x,y);
    return canvas.emit(event,{touches:event==='touchend'?[]:[p],changedTouches:[p],...props});
  }
  return Object.assign(f,{canvas,mouse,touch,point});
}
const snapshot = G => JSON.stringify(G.serializeGame());

for (const input of ['mouse','touch','api']) test(input + ' stages read-only, confirms one site and rejects repeats', () => {
  const f = bindInput(), G = f.G, before = snapshot(G), uid = G._peekUid();
  if (input === 'mouse') { f.mouse('mousedown'); f.mouse('mouseup'); }
  else if (input === 'touch') {
    assert(f.touch('touchstart').defaultPrevented);
    assert(f.touch('touchend').defaultPrevented);
  } else assert(G.stageBuildingPlacement(10,10).ok);
  const pending = G.currentBuildingPlacement();
  assert(pending); assert.equal(pending.type,'house');
  assert.equal(pending.tx,10); assert.equal(pending.ty,10);
  assert.equal(snapshot(G),before); assert.equal(G._peekUid(),uid);
  const wood = G.game.res.wood, result = G.confirmBuildingPlacement(pending);
  assert(result.ok,result.reason); assert.equal(G.world.buildings.length,1);
  assert.equal(result.b.x,pending.ox); assert.equal(result.b.y,pending.oy);
  assert.equal(result.b.state,'site');
  assert.equal(result.b.construction.required.wood,G.BDEF.house.cost.wood);
  assert.equal(G.game.res.wood,wood);
  assert.equal(G.pendingBuildingPlacement,null);
  assert.equal(G.confirmBuildingPlacement(pending).ok,false);
  assert.equal(G.confirmBuildingPlacement().ok,false);
  assert.equal(G.world.buildings.length,1);
});

test('new position replaces the preview and rejects the old button intent', () => {
  const {G} = bindInput();
  G.stageBuildingPlacement(10,10); const old = G.pendingBuildingPlacement;
  G.stageBuildingPlacement(20,20); const current = G.pendingBuildingPlacement;
  assert.notEqual(old,current);
  assert.equal(G.confirmBuildingPlacement(old).ok,false);
  assert.equal(G.world.buildings.length,0);
  const result = G.confirmBuildingPlacement(current);
  assert(result.ok); assert.equal(result.b.x,current.ox); assert.equal(result.b.y,current.oy);
});

test('invalid coordinates never commit and non-finite input leaves the last preview alone', () => {
  const {G} = bindInput();
  assert.equal(G.confirmBuildingPlacement().ok,false);
  assert.equal(G.stageBuildingPlacement(-10,-10).ok,false);
  const invalid = G.pendingBuildingPlacement;
  assert.equal(G.confirmBuildingPlacement(invalid).ok,false);
  assert.equal(G.stageBuildingPlacement(NaN,10).ok,false);
  assert.equal(G.pendingBuildingPlacement,invalid);
  assert.equal(G.world.buildings.length,0);
});

for (const changed of ['stock','terrain','occupied']) test('confirmation rechecks changed ' + changed, () => {
  const {G} = bindInput();
  G.stageBuildingPlacement(10,10); const pending = G.pendingBuildingPlacement;
  if (changed === 'stock') G.game.res.wood = 0;
  if (changed === 'terrain') G.world.water[pending.oy*G.world.N+pending.ox] = 1;
  if (changed === 'occupied') assert(G.addBuilding('house',pending.ox,pending.oy).ok);
  const before = snapshot(G), uid = G._peekUid();
  assert.equal(G.buildingPlacementStatus().ok,false);
  assert.equal(G.confirmBuildingPlacement(pending).ok,false);
  assert.equal(snapshot(G),before); assert.equal(G._peekUid(),uid);
  assert.equal(G.pendingBuildingPlacement,pending);
  if (changed === 'stock') {
    G.game.res.wood = G.BDEF.house.cost.wood;
    assert(G.confirmBuildingPlacement(pending).ok);
  }
});

test('the authoritative placement failure retains a retryable preview', () => {
  const {G} = bindInput();
  G.stageBuildingPlacement(10,10); const pending = G.pendingBuildingPlacement;
  const addBuilding = G.addBuilding;
  G.addBuilding = () => ({ok:false,reason:'占地内居民没有可达出口'});
  assert.equal(G.confirmBuildingPlacement(pending).ok,false);
  assert.equal(G.pendingBuildingPlacement,pending);
  G.addBuilding = addBuilding;
  assert(G.confirmBuildingPlacement(pending).ok);
});

test('reentrant HUD confirmation cannot create a duplicate', () => {
  const {G} = bindInput();
  G.stageBuildingPlacement(10,10); const pending = G.pendingBuildingPlacement;
  G.ui.refreshHUD = () => assert.equal(G.confirmBuildingPlacement(pending).ok,false);
  assert(G.confirmBuildingPlacement(pending).ok);
  assert.equal(G.world.buildings.length,1);
});

for (const changed of ['world','game','tool']) test('stale ' + changed + ' identity cannot confirm', () => {
  const {G} = bindInput();
  G.stageBuildingPlacement(10,10); const pending = G.pendingBuildingPlacement;
  G[changed] = {...G[changed]};
  assert.equal(G.currentBuildingPlacement(),null);
  assert.equal(G.confirmBuildingPlacement(pending).ok,false);
  assert.equal(G.world.buildings.length,0);
});

for (const cancel of ['cancel','sameTool','otherTool','escape','rightClick','blur','hidden']) test(cancel + ' clears the staged position', () => {
  const f = bindInput(), G = f.G;
  G.stageBuildingPlacement(10,10); const pending = G.pendingBuildingPlacement;
  if (cancel === 'cancel') G.cancelBuildingPlacement();
  if (cancel === 'sameTool') G.setTool('house');
  if (cancel === 'otherTool') G.setTool('well');
  if (cancel === 'escape') f.windowEvent('keydown',{key:'Escape',target:f.canvas});
  if (cancel === 'rightClick') f.mouse('mousedown',10,10,{button:2});
  if (cancel === 'blur') f.windowEvent('blur');
  if (cancel === 'hidden') { f.doc.visibilityState = 'hidden'; f.documentEvent('visibilitychange'); }
  assert.equal(G.pendingBuildingPlacement,null);
  assert.equal(G.confirmBuildingPlacement(pending).ok,false);
  assert.equal(G.world.buildings.length,0);
});

test('an open modal blocks staging and confirmation without mutating the town', () => {
  const {G} = bindInput();
  G.stageBuildingPlacement(10,10); const pending = G.pendingBuildingPlacement;
  G.hasOpenModal = () => true;
  assert.equal(G.stageBuildingPlacement(20,20).ok,false);
  assert.equal(G.confirmBuildingPlacement(pending).ok,false);
  assert.equal(G.pendingBuildingPlacement,pending);
  assert.equal(G.world.buildings.length,0);
});

for (const input of ['mouse','touch']) {
  for (const interrupt of ['move','world','game','tool','cancel','blur','hidden','focus','escape','modal','pointercancel','outside','multi']) {
    if (input==='mouse' && interrupt==='multi' || input==='touch' && interrupt==='outside') continue;
    test(input + ' interrupted by ' + interrupt + ' cannot stage or place', () => {
      const f = bindInput(), G = f.G;
      if (input==='mouse') f.mouse('mousedown'); else f.touch('touchstart');
      if (interrupt==='move') {
        if (input==='mouse') f.mouse('mousemove',20,20); else f.touch('touchmove',20,20);
      }
      if (interrupt==='world') G.world = {...G.world};
      if (interrupt==='game') G.game = {...G.game};
      if (interrupt==='tool') { G.setTool('well'); G.setTool('house'); }
      if (interrupt==='cancel') G.cancelBuildingPlacement();
      if (interrupt==='blur') f.windowEvent('blur');
      if (interrupt==='hidden') { f.doc.visibilityState='hidden'; f.documentEvent('visibilitychange'); }
      if (interrupt==='focus') f.documentEvent('focusin',{target:{tagName:'INPUT'}});
      if (interrupt==='escape') f.windowEvent('keydown',{key:'Escape',target:f.canvas});
      if (interrupt==='modal') G.hasOpenModal=()=>true;
      if (interrupt==='pointercancel') f.canvas.emit(input==='mouse'?'pointercancel':'touchcancel');
      if (interrupt==='multi') f.touch('touchstart',10,10,{touches:[f.point(10,10),f.point(12,12)]});
      if (input==='mouse') f.mouse('mouseup',10,10,interrupt==='outside'?{target:f.toolbar}:{});
      else f.touch('touchend');
      assert.equal(G.pendingBuildingPlacement,null);
      assert.equal(G.world.buildings.length,0);
    });
  }
}

test('fixed fields, cemetery and road plans are outside ordinary building staging', () => {
  const {G} = bindInput();
  for (const type of ['farm','pasture','orchard','cemetery','road','bridge','tunnel','fell']) {
    G.setTool(type); assert.equal(G.isBuildingPlacementPlanning(),false);
    assert.equal(G.stageBuildingPlacement(10,10).ok,false);
    assert.equal(G.pendingBuildingPlacement,null);
  }
  G.setTool('farm'); G.tryPlace(10,10);
  assert.equal(G.world.buildings.length,1); assert.equal(G.world.buildings[0].w,8);
  G.setTool('cemetery'); G.selectCemeteryCorner(20,20);
  assert(G.cemeteryPlan); assert.equal(G.pendingBuildingPlacement,null);
});

test('save/load and new game discard transient staged coordinates', () => {
  const G = loadGame(root); G.newGame(65); G.setTool('house');
  G.stageBuildingPlacement(40,40);
  const save = G.serializeGame();
  assert.equal(JSON.stringify(save).includes('pendingBuildingPlacement'),false);
  G.applySaveData(save); assert.equal(G.pendingBuildingPlacement,null);
  G.setTool('house'); G.stageBuildingPlacement(40,40); G.newGame(66);
  assert.equal(G.pendingBuildingPlacement,null);
});

test('real frame keeps a read-only staged sprite in scene depth order when hover moves away', () => {
  const G = loadGame(root); G.newGame(65); const w = G.world;
  for (const k of ['water','rock','road']) w[k].fill(0);
  w.treeIdx.fill(-1); w.trees=[]; w.citizens=[]; w.cmap={}; w.families=[];
  w.buildings=[]; w.bmap={}; w.bgrid.fill(-1); G.bumpNavigation(w);
  vm.runInNewContext(fs.readFileSync(root+'/js/render.js','utf8'),{G,performance,document:{},setTimeout(){},clearTimeout(){}});
  G.cv={clientWidth:800,clientHeight:600};
  const alphaStack=[];
  G.ctx=new Proxy({
    globalAlpha:1,
    save(){alphaStack.push(this.globalAlpha);},
    restore(){this.globalAlpha=alphaStack.pop();}
  },{get:(target,key)=>key in target?target[key]:()=>{},set:(target,key,value)=>{target[key]=value;return true;}});
  G.dpr=1; G.cam={z:1.5,x:256,y:-1654}; G.needGround=false; G.groundDirty=new Set();
  G._gcv={width:1,height:1}; G.groundScale=1; G._groundWorld=w; G._groundScale=1;
  G.updateParticles=()=>{}; G.game.h=12; G.game.season=1;
  const sprites=[],order=[];
  G.sprDraw=(ctx,name,x,y,options)=>{sprites.push({name,x,y,options,alpha:ctx.globalAlpha});order.push(name);return [100,100];};
  G.fillTexDiamond=()=>true;
  const previews=[]; G.ui.refreshPlacement=(...args)=>previews.push(args);
  G.setTool('house'); G.stageBuildingPlacement(43,43);
  const pending=G.pendingBuildingPlacement, before=snapshot(G);
  const depth=pending.ox+pending.oy+G.BDEF.house.w+G.BDEF.house.h-2-.5;
  G.addDeerDrawItems=items=>items.push({d:depth+1,k:7,deer:'front'},{d:depth-1,k:7,deer:'behind'});
  G.drawDeer=(ctx,name)=>order.push(name);
  G.hover={tx:55,ty:55}; G.frame(0);
  assert.equal(G._ghost.ox,pending.ox); assert.equal(G._ghost.oy,pending.oy);
  assert.deepEqual(previews.at(-1),['house',pending.ox,pending.oy]);
  assert.deepEqual(order,['behind','house','front']);
  assert.equal(sprites[0].alpha,.65);assert.equal(sprites[0].options.omitSmokeAir,true);
  assert.equal(G.ctx.globalAlpha,1);
  assert.equal(G._visibleActivityBuildings.length,0);
  G.hover={tx:-1,ty:-1}; G.frame(0);
  assert.equal(G._ghost.ox,pending.ox); assert.equal(G._ghost.oy,pending.oy);
  assert.equal(sprites.length,2);
  assert.equal(snapshot(G),before);
  const stock=G.game.res.wood;G.game.res.wood=0;G.frame(0);
  assert.equal(sprites.length,2,'shortage keeps the error grid without showing a valid-building sprite');
  G.game.res.wood=stock;w.water[pending.oy*w.N+pending.ox]=1;G.frame(0);
  assert.equal(sprites.length,2,'blocked terrain does not show a valid-building sprite');
  G.setTool(null); G.frame(0); assert.equal(G._ghost,null);
  assert.equal(sprites.length,2,'cancel removes the sprite as well as the grid');
  // Preview alignment uses the actual art and geometry, without going through
  // drawBuilding or producing its activity/smoke markers.
  let activityCalls=0;G.drawBuildingActivity=()=>activityCalls++;
  for(const type of ['house','well','chapel','market','tradingpost','dock']){
    const def=G.BDEF[type],p={type,ox:10,oy:10};
    G.drawPendingBuildingPreview(G.ctx,p);const ghost=sprites.at(-1);
    assert.equal(activityCalls,0);
    G.drawBuilding(G.ctx,{type,x:10,y:10,w:def.w,h:def.h,state:'ok'},0);
    const built=sprites.at(-1);
    assert.deepEqual([ghost.name,ghost.x,ghost.y,ghost.options.w],[built.name,built.x,built.y,built.options.w]);
    activityCalls=0;
  }
});

console.log(`Building placement confirmation: ${passed} contract groups passed (offline, no browser claim).`);
