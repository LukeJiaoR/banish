/* Offline real renderer + simulation-clock contracts. No gameplay animal motion. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadGame}=require('./helpers/playability'),root=path.resolve(__dirname,'..');
const G=loadGame(root);G.newGame(1);
vm.runInNewContext(fs.readFileSync(path.join(root,'js/render.js'),'utf8'),{G,document:{},console});
const plain=x=>JSON.parse(JSON.stringify(x));let passed=0;
function test(n,f){f();passed++;console.log('ok '+n);}
function pen(w=6,h=6,animalType='sheep',area=false){return {id:42,type:'pasture',state:'ok',x:10,y:12,w,h,animalType,animals:area?G.pastureCapacity({w,h,pastureSize:[w,h],animalType}):G.LIVESTOCK[animalType].cap,...(area?{pastureSize:[w,h]}:{})};}
function animals(b){const a=[];G.addEconomyFieldParts(a,b);return a.filter(p=>p.kind===b.animalType);}
test('every livestock species visibly moves and uses animated depth and sprite pose',()=>{
 for(const type of ['sheep','cattle','chicken']){const b=pen(6,6,type);G.game.h=6;const a=animals(b);G.game.h=8;const z=animals(b);assert.equal(a.length,b.animals);assert(a.every((p,i)=>p.x!==z[i].x||p.y!==z[i].y));for(const p of z)assert.equal(p.d,p.x+p.y+.01);
 const calls=[];G.sprDraw=(_,name,x,y,opt)=>calls.push({name,x,y,opt});G.T2S=(x,y)=>[x*20,y*10];G.drawEconomyFieldPart({},z[0]);assert.equal(calls[0].y,z[0].y*10-z[0].pose.bob);assert.equal(calls[0].opt.flip,z[0].pose.flip);}
});
test('all supported pen shapes and phases retain count, fence padding and area shelter clearance',()=>{
 for(const [w,h,area]of [[6,6,false],[7,7,true],[7,20,true],[20,7,true],[20,20,true]])for(const type of ['sheep','cattle','chicken'])for(let hour=0;hour<80;hour+=.7){G.game.h=hour;const b=pen(w,h,type,area),a=animals(b);assert.equal(a.length,b.animals);for(const p of a){assert(p.x>=b.x+.55&&p.x<=b.x+w-.55);assert(p.y>=b.y+.55&&p.y<=b.y+h-.55);if(area)assert(!(p.x<b.x+3.4&&p.y<b.y+3.4));}}
});
test('deer move only within their actual habitat cell; depth matches visual footpoint; dead deer are absent',()=>{
 const d=G.world.deer.find(d=>d.returnDay===null),before=plain(d),points=[];for(let h=0;h<48;h+=.17){G.game.h=h;const p=G.deerDisplayPoint(d),a=[];points.push(p);assert(p.x>=d.x&&p.x<d.x+1&&p.y>=d.y&&p.y<d.y+1);G.addDeerDrawItems(a,{deer:[d]});assert.equal(a[0].d,p.x+p.y+.015);}assert.notDeepEqual(points[0],points[10]);assert.deepEqual(plain(d),before);const a=[];G.addDeerDrawItems(a,{deer:[{...d,returnDay:8}]});assert.equal(a.length,0);
});
test('paused clock holds pose; resume and speed follow simulation time independent of render calls',()=>{
 G.game.h=6;G.game.day=0;G.game.paused=true;const a=plain(G.animalPose(4));for(let i=0;i<100;i++)assert.deepEqual(plain(G.animalPose(4)),a);G.game.paused=false;G.game.h+=G.HOURS_PER_SEC;assert.notDeepEqual(plain(G.animalPose(4)),a);const b=plain(G.animalPose(4));G.game.h=6;for(let i=0;i<60;i++)G.game.h+=G.HOURS_PER_SEC/60;const c=G.animalPose(4);for(const k of ['dx','dy','bob'])assert(Math.abs(c[k]-b[k])<1e-10);G.game.h=6+G.HOURS_PER_SEC*5;assert.notDeepEqual(plain(G.animalPose(4)),b);
});
test('midnight is continuous; save/load restores exactly the same poses without save schema or RNG changes',()=>{
 G.game.h=23.999999;G.game.day=0;const a=G.animalPose(4);G.game.h=0;G.game.day=1;const b=G.animalPose(4);assert(Math.abs(a.dx-b.dx)<1e-5);G.game.day=0;G.game.h=13;const state=plain(G.serializeGame()),pose=plain(G.animalPose(8));G.applySaveData(state);assert.deepEqual(plain(G.animalPose(8)),pose);const before=plain(G.serializeGame());G.rng=()=>{throw Error('render consumed simulation RNG');};for(let i=0;i<100;i++){animals(pen());G.deerDisplayPoint(G.world.deer[0]);}assert.deepEqual(plain(G.serializeGame()),before);
});
test('actual simulation updates and three stocked pasture saves retain motion phase, headcount and products',()=>{
 assert(G.newGame(731).ok);const pens=[];
 for(const type of ['sheep','cattle','chicken']){
  let result;for(let y=2;y<G.world.N-8&&!result;y++)for(let x=2;x<G.world.N-8&&!result;x++)if(G.canPlace(G.world,'pasture',x,y).ok){for(let yy=y;yy<y+6;yy++)for(let xx=x;xx<x+6;xx++)G.removeTree(G.world,xx,yy);result=G.addBuilding('pasture',x,y,{instant:true,free:true});}
  assert(result?.ok,JSON.stringify(result));const b=result.b;assert(G.setPastureType(b,type));G.game.livestock[type]=4;assert(G.stockPasture(b,4,type));pens.push(b);
 }
 const first=plain(pens.map(animals));G.advanceSim(.2);assert.notDeepEqual(plain(pens.map(animals)),first);
 const poses=bs=>bs.map(b=>animals(b).map(({x,y,d,pose,kind})=>({x,y,d,pose,kind})));
 const expected=plain(poses(pens)),stocks=plain(pens.map(b=>[b.animals,b.pastureProducts])),save=plain(G.serializeGame());G.applySaveData(save);
 const loaded=pens.map(b=>G.world.bmap[b.id]);assert.deepEqual(plain(poses(loaded)),expected);assert.deepEqual(plain(loaded.map(b=>[b.animals,b.pastureProducts])),stocks);
 G.advanceSim(.2);assert.notDeepEqual(plain(poses(loaded)),expected);assert.deepEqual(plain(loaded.map(b=>[b.animals,b.pastureProducts])),stocks);
});
test('reduced motion has stable original positions and no bob at every clock value',()=>{
 G.buildingReducedMotion=()=>true;const b=pen(),d=G.world.deer[0];G.game.h=1;const a=plain(animals(b));G.game.h=17;assert.deepEqual(plain(animals(b)),a);assert(a.every(p=>p.pose.bob===0));assert.equal(G.deerDisplayPoint(d).x,d.x);assert.equal(G.deerDisplayPoint(d).y,d.y);
});
console.log(`Animal motion: ${passed} suites passed.`);
