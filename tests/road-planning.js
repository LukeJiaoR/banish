'use strict';
const assert=require('node:assert/strict');global.window=global;require('../js/core');require('../js/defs');require('../js/map');
let passed=0;function world(N=24){return {N,water:new Uint8Array(N*N),rock:new Uint8Array(N*N),road:new Uint8Array(N*N),bgrid:new Int32Array(N*N).fill(-1),treeIdx:new Int32Array(N*N).fill(-1)}}
function test(name,fn){fn();passed++;console.log('ok '+name)}
function check(w,r){assert(r.ok,r.reason);assert(r.path.length);for(let i=1;i<r.path.length;i++)assert.equal(Math.abs(r.path[i].x-r.path[i-1].x)+Math.abs(r.path[i].y-r.path[i-1].y),1);for(const p of r.path){let i=p.y*w.N+p.x;assert.notEqual(w.water[i],1);assert.equal(w.rock[i],0);assert.equal(w.bgrid[i],-1)}assert(r.steps<=r.maxSteps);return r}
test('straight route has no corners and planning is read-only',()=>{const w=world(),before=JSON.stringify(w),r=check(w,G.planRoad(w,{x:2,y:4},{x:15,y:4}));assert.equal(r.steps,13);assert.equal(r.turns,0);assert.equal(r.newTiles,14);assert.equal(JSON.stringify(w),before)});
test('open diagonal endpoint uses one clean corner',()=>{const w=world(),r=check(w,G.planRoad(w,{x:2,y:2},{x:13,y:10}));assert.equal(r.steps,19);assert.equal(r.turns,1)});
test('lake wall is routed around with connected road, not skipped tiles',()=>{const w=world();for(let y=0;y<12;y++)w.water[y*w.N+9]=1;const r=check(w,G.planRoad(w,{x:4,y:5},{x:14,y:5}));assert(r.path.some(p=>p.y>=12));assert(r.steps>10)});
test('buildings and minerals are blockers; existing roads can be reused',()=>{const w=world();for(let x=2;x<=15;x++)w.road[4*w.N+x]=1;w.bgrid[3*w.N+8]=20;w.rock[5*w.N+8]=2;const r=check(w,G.planRoad(w,{x:2,y:4},{x:15,y:4}));assert.equal(r.newTiles,0);assert.equal(r.reusedTiles,14)});
test('trees are explicit clearance requirements and never removed by preview',()=>{const w=world();w.treeIdx[4*w.N+8]=7;const r=check(w,G.planRoad(w,{x:2,y:4},{x:15,y:4}));assert.equal(r.clearTrees.length,1);assert.deepEqual(r.clearTrees[0],{x:8,y:4});assert.equal(w.treeIdx[4*w.N+8],7)});
test('unreachable and blocked endpoints return clear failure',()=>{const w=world();for(let y=0;y<w.N;y++)w.water[y*w.N+9]=1;assert.equal(G.planRoad(w,{x:4,y:5},{x:14,y:5}).ok,false);assert.match(G.planRoad(w,{x:9,y:5},{x:14,y:5}).reason,/起点/);assert.match(G.planRoad(w,{x:-1,y:5},{x:14,y:5}).reason,/地图/)});
test('same endpoint creates one preview tile and zero steps',()=>{const w=world(),r=check(w,G.planRoad(w,{x:3,y:3},{x:3,y:3}));assert.equal(r.path.length,1);assert.equal(r.steps,0)});
test('search limits report budget exhaustion rather than freezing input',()=>{const w=world();const r=G.planRoad(w,{x:1,y:1},{x:20,y:20},{maxExpanded:2});assert.equal(r.ok,false);assert.equal(r.budgetExceeded,true);assert(r.expanded<=2)});
test('fixed random obstacle grids agree with shortest-path reachability within the detour limit',()=>{
  let rng=19;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296};
  for(let seed=0;seed<60;seed++){
    const w=world(20),a={x:1,y:1},b={x:18,y:18};for(let i=0;i<w.water.length;i++)if(random()<.23)w.water[i]=1;
    w.water[21]=0;w.water[18*20+18]=0;
    const queue=[21],dist=new Map([[21,0]]);for(let k=0;k<queue.length;k++){const i=queue[k],x=i%20,y=Math.floor(i/20);for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,n=yy*20+xx;if(xx<0||yy<0||xx>=20||yy>=20||w.water[n]||dist.has(n))continue;dist.set(n,dist.get(i)+1);queue.push(n)}}
    const shortest=dist.get(378),r=G.planRoad(w,a,b);if(shortest!=null&&shortest<=Math.ceil(34*1.75)+16)check(w,r);else assert.equal(r.ok,false);
  }
});
test('one unrelated existing road tile does not exhaust a long open-map plan',()=>{const w=world(128);w.road[0]=1;const r=check(w,G.planRoad(w,{x:4,y:4},{x:123,y:123}));assert.equal(r.turns,1);assert(r.expanded<2000)});
console.log(`Road planning: ${passed} passed`);
