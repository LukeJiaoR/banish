/* Citizen presentation contracts with real sim/render/UI/input functions.
 * Run: node tests/citizen-presentation.js [checkout]
 * Canvas calls are inspected, not a browser-layout or eight-direction art test.
 */
'use strict';
// The tiny fake ground image is deliberately warm; cache allocation is tested separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const context = { console, performance: { now: () => 0 }, setTimeout() {}, clearTimeout() {},
  addEventListener() {}, localStorage: { getItem() {}, setItem() {}, removeItem() {} },
  document: { getElementById: () => ({ classList: { add() {}, remove() {}, contains() { return true; } }, addEventListener() {}, querySelectorAll: () => [] }) } };
context.window = context; vm.createContext(context);
for (const name of ['core', 'defs', 'map', 'sim', 'sprites', 'render', 'ui', 'main'])
  vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), context, { filename: name + '.js' });
const G = context.G;
const realSprDraw = G.sprDraw;
let passed = 0;
function fresh() {
  const N = 30;
  G.world = { seed: 17, N, water: new Uint8Array(N*N), rock: new Uint8Array(N*N), road: new Uint8Array(N*N),
    bgrid: new Int32Array(N*N).fill(-1), treeIdx: new Int32Array(N*N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 15, y: 15 } };
  G.game = G.newGameState(); G.game.h = 12; G.rng = G.makeRng(17); G.setUid(1); G.sel = null;
  G.ui.toast = () => {}; G.ui.hideInfo = () => { G.sel = null; }; G.ui.showInfo = () => {};
  G.cam = { x: 0, y: 0, z: 1 }; G.sprDraw = realSprDraw;
}
function citizen(extra = {}) { return Object.assign(G.spawnCitizen({ x: 9, y: 10, age: 30, sex: 'm' }), { animT: 0 }, extra); }
function building(type = 'house', extra = {}) {
  const d = G.BDEF[type];
  const b = Object.assign({ id: G.nextId(), type, x: 10, y: 10, w: d.w, h: d.h, state: 'ok',
    workers: [], family: null, noWork: false, warnText: '' }, extra);
  G.world.buildings.push(b); G.world.bmap[b.id] = b;
  for (let y=b.y; y<b.y+b.h; y++) for (let x=b.x; x<b.x+b.w; x++) G.world.bgrid[y*G.world.N+x]=b.id;
  return b;
}
function housed(c, b) {
  const f = { id: G.nextId(), members: [c.id], houseId: b.id, coupleIds: [] };
  G.world.families.push(f); c.familyId=f.id; return f;
}
function draw(c, missing = []) {
  const sprites = [], calls = [];
  G.sprDraw = (_, name, x, y, options) => { sprites.push({ name, x, y, options }); return missing.includes(name) ? null : [10, 17]; };
  const ctx = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]), set: (_, key, value) => { calls.push(['set', key, value]); return true; } });
  G.drawCitizen(ctx, c, 0); G.sprDraw = realSprDraw;
  return { sprites, calls };
}
function test(name, run) { fresh(); run(); passed++; console.log('ok ' + name); }

for (const [dx,dy,flip] of [[1,0,false],[-1,0,true],[0,1,true],[0,-1,false],[1,-1,false],[-1,1,true]])
  test(`first rendered walking step (${dx}, ${dy}) faces projected movement`, () => {
    const c=citizen({ state:'walk', path:[{x:9+dx,y:10+dy}], pi:0 });
    assert.equal(draw(c).sprites[0].options.flip,flip);
    G.game.paused=true;
    assert.equal(draw(c).sprites[0].options.flip,flip,'pausing must not reverse the pose');
  });
test('screen-vertical steps retain the prior facing and path turns update immediately', () => {
  const c=citizen({ state:'walk', _fx:-1, path:[{x:10,y:11},{x:11,y:10}], pi:0 });
  assert.equal(draw(c).sprites[0].options.flip,true);
  c.pi=1; assert.equal(draw(c).sprites[0].options.flip,false);
  c.state='idle'; c.path=null; assert.equal(draw(c).sprites[0].options.flip,false);
});
test('movement fallback and child walking use the same right-facing asset convention', () => {
  const c=citizen({ age:8, state:'walk', path:null, _psx:G.T2S(10,10)[0] });
  const a=draw(c).sprites[0]; assert.equal(a.name,'child_walk_0'); assert.equal(a.options.flip,true);
  c.x=11; assert.equal(draw(c).sprites[0].options.flip,false);
});
for (const direction of [-1,1]) test(`carried cargo follows ${direction < 0 ? 'left' : 'right'} hands for all resources`, () => {
  const c=citizen({ state:'haul', path:[{x:9+direction,y:10}], pi:0 });
  for (const type of G.RES_KEYS) {
    c.carry={type,qty:2};
    const result=draw(c).sprites;
    assert.equal(result[0].name,'adult_carry_walk_0');
    assert.equal(result[0].options.flip,direction<0);
    assert.equal(result[1].name,'carry_'+type);
    assert.equal(Math.sign(result[1].x-result[0].x),direction);
    assert.equal(result[1].options.flip,direction<0);
  }
  for (let frame=0;frame<4;frame++) { c.animT=frame*1.5; assert.equal(draw(c).sprites[0].name,'adult_carry_walk_'+frame); }
  c.state='idle'; c.path=null;
  assert.equal(draw(c).sprites[0].name,'adult_carry_idle');
});
test('missing carry pose falls back to walk, then procedural body and mirrored cargo', () => {
  const c=citizen({ state:'haul', path:[{x:8,y:10}], pi:0, carry:{type:'wood',qty:2} });
  let result=draw(c,['adult_carry_walk_0']);
  assert.equal(result.sprites[1].name,'adult_walk_0'); assert.equal(result.sprites[1].options.flip,true);
  result=draw(c,['adult_carry_walk_0','adult_walk_0','carry_wood']);
  assert.equal(result.calls.filter(x=>x[0]==='fillRect').length,2);
  assert.ok(result.calls.find(x=>x[0]==='arc'),'procedural head remains visible');
  assert.ok(result.calls.filter(x=>x[0]==='fillRect')[1][1]<G.T2S(c.x,c.y)[0],'fallback cargo is on the left');
});
test('work faces the actual tree or building rather than the last walking direction', () => {
  const c=citizen({ state:'work', _fx:-1, task:{ kind:'chop', tree:{x:10,y:10}, tx:9,ty:10 } });
  assert.equal(draw(c).sprites[0].options.flip,false);
  const b=building('blacksmith',{x:5}); c.task={kind:'work',b,tx:c.x,ty:c.y};
  assert.equal(draw(c).sprites[0].options.flip,true);
});
test('same-tile work stands beside the resource and does not alternate tool/basket outfits', () => {
  const c=citizen({ state:'work', _fx:1, task:{kind:'chop',tree:{x:9,y:10},tx:9,ty:10} });
  const first=draw(c).sprites[0]; assert.equal(first.name,'adult_work_0'); assert.ok(first.x<G.T2S(c.x,c.y)[0]);
  c.animT=2; const next=draw(c).sprites[0]; assert.equal(next.name,first.name);
  c.task={kind:'harvest',tx:9,ty:10}; assert.equal(draw(c).sprites[0].name,'adult_work_1');
});
test('only arrived rest with an explicit non-camping flag enters a finished home', () => {
  const b=building(),c=citizen({state:'rest',camped:false}); housed(c,b);
  const before=JSON.stringify(c); assert.equal(G.citizenIndoorHome(c),b); assert.equal(JSON.stringify(c),before,'indoor helper is read-only');
  assert.equal(draw(c).sprites.length,0);
  for(const patch of [{camped:true},{camped:undefined},{state:'idle'},{state:'work',task:{kind:'build',b}},
    {state:'haul',carry:{type:'wood',qty:2}},{path:[{x:9,y:10}]},{x:2},{y:2}]) {
    const copy=Object.assign({},c,patch);
    assert.equal(G.citizenIndoorHome(copy),null,JSON.stringify(patch));
    assert.ok(draw(copy).sprites.length,'outdoor citizen must remain drawn');
  }
  b.state='site'; assert.equal(G.citizenIndoorHome(c),null); b.state='ok';
  delete G.world.bmap[b.id]; assert.equal(G.citizenIndoorHome(c),null);
});
test('one frame/click home index resolves residents in O(1) without repeated family scans', () => {
  const b=building(),c=citizen({state:'rest',camped:false}); housed(c,b);
  const homes=G.citizenHomeLookup(G.world),readHome=G.homeOf;
  G.homeOf=()=>{throw Error('indexed rendering must not scan families');};
  assert.equal(G.citizenIndoorHome(c,homes),b);
  const ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});
  G.drawCitizen(ctx,c,0,homes);
  const [x,y]=G.T2S(c.x,c.y);G.selectAt(c.x,c.y,{x,y:y+16});assert.equal(G.sel,null);
  G.homeOf=readHome;
});
test('main frame builds at most one home index and never updates off-screen people', () => {
  const b=building(),a=citizen({state:'rest',camped:false}),z=citizen({state:'rest',camped:false});housed(a,b);housed(z,b);
  const offscreen=citizen({x:29,y:29,state:'walk',path:[{x:28,y:29}],pi:0});
  G.cv={clientWidth:640,clientHeight:480}; G.ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});
  const [sx,sy]=G.T2S(a.x,a.y);G.cam={x:320-sx,y:240-sy,z:1};G.dpr=1;
  G._gcv={width:1,height:1};G.groundScale=1;G._groundWorld=G.world;G._groundScale=G.groundScale;G.needGround=false;G.groundDirty.clear();G.hover={tx:-1,ty:-1};G.tool=null;
  const lookup=G.citizenHomeLookup,readHome=G.homeOf,refresh=G.ui.refreshPlacement;let indexes=0;
  G.citizenHomeLookup=w=>{indexes++;return lookup(w);};G.homeOf=()=>{throw Error('frame must use one index');};G.ui.refreshPlacement=()=>{};
  const before=JSON.stringify(offscreen);G.frame(0);
  assert.equal(indexes,1);assert.equal(JSON.stringify(offscreen),before);
  a.state=z.state='idle';indexes=0;G.frame(0);assert.equal(indexes,0,'awake frames need no home index');
  G.citizenHomeLookup=lookup;G.homeOf=readHome;G.ui.refreshPlacement=refresh;
});
test('boarding house residents can enter, but a storage assignment is not a home', () => {
  const b=building('boarding'),c=citizen({state:'rest',camped:false}); housed(c,b);
  assert.equal(G.citizenIndoorHome(c),b);
  b.type='storage'; assert.equal(G.citizenIndoorHome(c),null);
});
test('night arrival, dawn, repeated day-night switches and distant camping reflect real sim state', () => {
  const b=building(),c=citizen({x:7,y:10}); housed(c,b); G.game.h=22;
  G.goHome(c); assert.equal(c.state,'walk'); assert.equal(G.citizenIndoorHome(c),null);
  while(c.state==='walk') G.stepCitizen(c,0.5);
  assert.equal(c.state,'rest'); assert.equal(G.citizenIndoorHome(c),b);
  for(let i=0;i<3;i++) {
    G.game.h=6; G.stepCitizen(c,0.01); assert.equal(c.state,'idle'); assert.equal(G.citizenIndoorHome(c),null);
    G.game.h=22; G.goHome(c); assert.equal(G.citizenIndoorHome(c),b);
  }
  c.x=29;c.y=29;G.goHome(c);assert.equal(c.camped,true);assert.equal(G.citizenIndoorHome(c),null);assert.ok(draw(c).sprites.length);
});
test('homeless camping remains opaque and selectable; indoor people have no invisible hit target', () => {
  const c=citizen({state:'rest',camped:true});
  let result=draw(c); assert.ok(result.sprites.length); assert.ok(!result.calls.some(x=>x[0]==='set'&&x[1]==='globalAlpha'));
  const [x,y]=G.T2S(c.x,c.y); G.selectAt(c.x,c.y,{x,y:y+16}); assert.equal(G.sel.id,c.id);
  const b=building();housed(c,b);c.camped=false;
  G.selectAt(c.x,c.y,{x,y:y+16});assert.equal(G.sel,null);
  const outside=citizen({state:'idle',carry:{type:'food',qty:2}});
  G.selectAt(outside.x,outside.y,{x,y:y+16});assert.equal(G.sel.id,outside.id);
});
test('status separates ordinary waiting, input shortages, limits, travel and indoor/outdoor rest', () => {
  const c=citizen();assert.equal(G.ui.citizenStatus(c),'散工待命');
  c.age=8;assert.equal(G.ui.citizenStatus(c),'玩耍休息');c.age=30;
  let b=building('woodcutter');c.job=b.id;G.game.res.wood=0;G.game.res.firewood=0;
  assert.equal(G.ui.citizenStatus(c),'等待原木');
  G.game.res.wood=10;assert.equal(G.ui.citizenStatus(c),'等待下一项任务');
  G.game.res.firewood=G.fuelLimitOf(b);assert.match(G.ui.citizenStatus(c),/已达目标/);
  b=building('blacksmith',{x:15});c.job=b.id;G.game.res.tools=0;G.game.res.iron=0;assert.equal(G.ui.citizenStatus(c),'等待铁或原木');
  c.carry={type:'wood',qty:2};assert.match(G.ui.citizenStatus(c),/等待送仓/);
  c.carry=null;c.state='walk';c.walkKind='home';assert.equal(G.ui.citizenStatus(c),'回家途中');
  c.walkKind='wander';assert.equal(G.ui.citizenStatus(c),'闲逛');
  c.walkKind='task';c.task={kind:'firewood',phase:'fetch'};assert.equal(G.ui.citizenStatus(c),'前往仓库取原木');
  c.state='rest';c.camped=true;assert.equal(G.ui.citizenStatus(c),'露宿（无住房）');
  b=building();housed(c,b);assert.equal(G.ui.citizenStatus(c),'户外休息（未入屋）');
  c.camped=false;assert.equal(G.ui.citizenStatus(c),'屋内休息');
});
test('render/status queries do not change jobs, resource stocks, task progress or RNG', () => {
  const b=building('woodcutter'),c=citizen({state:'work',job:b.id,task:{kind:'firewood',b,tx:9,ty:10,workLeft:3}});
  const pick=()=>JSON.stringify({res:G.game.res,job:c.job,task:c.task,state:c.state,x:c.x,y:c.y,path:c.path,carry:c.carry,animT:c.animT});
  const rng=G.rng; let randomCalls=0; G.rng=()=>{randomCalls++;return rng();};
  const before=pick();for(let i=0;i<10;i++){draw(c);G.ui.citizenStatus(c);}
  assert.equal(pick(),before); assert.equal(randomCalls,0); G.rng=rng;
});
console.log(`Citizen presentation: ${passed} cases passed.`);
