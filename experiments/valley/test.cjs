'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {loadGame}=require('../../tests/helpers/playability'),generate=require('./generator.cjs');const root=path.resolve(__dirname,'../..'),G=loadGame(root);
const digest=w=>crypto.createHash('sha256').update(JSON.stringify(w)).digest('hex');const times=[];let cases=0;
G.rng=()=>{throw Error('Used running-game RNG');};
for(const seed of [0,1,7,42,999,-1,-2147483648,4294967295])for(const N of [128,192,384]){
 const start=performance.now(),a=generate(G,seed,N);times.push({seed,N,ms:performance.now()-start});const b=generate(G,seed,N);assert.equal(digest(a.world),digest(b.world));assert.deepEqual(a.proof,b.proof);
 const w=a.world;assert.equal(w.mapVersion,-1);assert.equal(a.proof.terrainEdits,0);assert(a.proof.stone>=3&&a.proof.iron>=3&&a.proof.matureTrees>=32);assert(a.proof.removedTrees<=9&&a.proof.removedRocks<=9);assert(a.proof.additions.length<=38);assert(a.proof.shoreApproaches>0);
 for(let i=0;i<N*N;i++){if(w.water[i]||w.mountain[i])assert(!w.rock[i]&&w.treeIdx[i]<0);if(w.treeIdx[i]>=0){const t=w.trees[w.treeIdx[i]];assert.equal(t.x+t.y*N,i);assert(!w.rock[i]);}}
 // Independent cardinal flood validates one continuous river, touching opposite map edges.
 const wet=[];for(let i=0;i<N*N;i++)if(w.water[i]===1)wet.push(i);const seen=new Set([wet[0]]),q=[wet[0]];
 for(let at=0;at<q.length;at++){const i=q[at],x=i%N,y=Math.floor(i/N);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*N+xx;if(xx>=0&&yy>=0&&xx<N&&yy<N&&w.water[j]===1&&!seen.has(j)){seen.add(j);q.push(j);}}}assert.equal(seen.size,wet.length);assert(wet.some(i=>i<N)&&wet.some(i=>i>=N*(N-1)));
 // Real game pathfinder with cart occupancy: no optimistic radius-only resource proof.
 const cart={id:1,type:'storage',state:'ok',x:w.start.x-1,y:w.start.y-1,w:3,h:3};
 const shadow={...w,bgrid:w.bgrid.slice(),bmap:{1:cart},buildings:[cart]};for(const i of a.proof.cartCells)shadow.bgrid[i]=1;
 for(const i of a.proof.cartCells)assert(G.tileBlocked(shadow,i%N,Math.floor(i/N)),'cart must be solid');
 const origin={x:w.start.x,y:w.start.y+2};for(const targets of Object.values(a.proof.resourceTargets))for(const i of targets){
   const p=G.findPath(shadow,origin.x,origin.y,i%N,Math.floor(i/N));assert(p);assert(p.length<=25);assert(p.every(t=>!a.proof.cartCells.includes(t.y*N+t.x)));
 }

 const si=a.proof.shoreTarget,sx=si%N,sy=Math.floor(si/N),shorePath=G.findPath(shadow,origin.x,origin.y,sx,sy);assert(shorePath&&shorePath.length<=25);
 assert([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>sx+dx>=0&&sy+dy>=0&&sx+dx<N&&sy+dy<N&&w.water[(sy+dy)*N+sx+dx]===1));
 for(let k=1;k<shorePath.length;k++)assert(G.walkEdgeAllowed(shadow,shorePath[k-1].x,shorePath[k-1].y,shorePath[k].x,shorePath[k].y));
 assert.equal(w.buildings.length,0);assert.equal(w.citizens.length,0);cases++;
}
for(const args of [[NaN,128],[1,64],[1.2,128],[Infinity,128]])assert.throws(()=>generate(G,...args));
// Experiment does not register a new runtime option or alter legacy generators.
assert.throws(()=>G.genWorld(1,{terrain:'valley'}));assert.throws(()=>G.genWorld(1,{mapVersion:-1}));
for(const version of [0,1])assert.equal(G.genWorld(1,{mapVersion:version}).mapVersion,version);assert.equal(G.genMountainWorld(1).mapVersion,2);
const output={cases,repeatability:true,realPathfinder:true,riverConnected:true,times,limits:'Single-run Node timings; not browser/GPU/device benchmarks. First-winter economy and building-layout acceptance not claimed.'};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
