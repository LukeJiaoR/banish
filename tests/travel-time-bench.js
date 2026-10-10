#!/usr/bin/env node
'use strict';
// Read-only paired microbenchmark. Run alone; this is dot VM data, not phone FPS.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {performance}=require('node:perf_hooks');
const {loadGame}=require('./helpers/playability');
const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
if(!args.includes('--baseline'))throw Error('Required: --baseline /path/to/baseline [--candidate .] [--out report.json]');
const roots={baseline:path.resolve(arg('--baseline','.')),candidate:path.resolve(arg('--candidate',path.join(__dirname,'..')))};
const fixtures=[];
for(const seed of [1,5,41])for(const roads of [false,true]){
 const games={};for(const [name,root] of Object.entries(roots)){
  const G=loadGame(root);G.newGame(seed);const w=G.world,s=w.start;
  if(roads)for(let y=s.y-16;y<=s.y+16;y++)for(let x=s.x-16;x<=s.x+16;x++){
   if((x-s.x)%4!==0&&(y-s.y)%4!==0)continue;
   if(G.canPlaceRoad(w,x,y)&&w.treeIdx[y*w.N+x]<0){if(G.setRoad)G.setRoad(w,x,y,true);else w.road[y*w.N+x]=1;}
  }
  games[name]=G;
 }
 const signatures=Object.values(games).map(G=>crypto.createHash('sha256').update(G.world.water).update(G.world.road).update(Buffer.from(G.world.bgrid.buffer)).digest('hex'));
 if(signatures[0]!==signatures[1])throw Error('Fixture maps differ');
 const G=games.baseline,w=G.world,rng=G.makeRng(seed^8191),queries=[];
 for(const range of [3,6,12,24,36,48])for(let n=0;n<4;n++){
  const a=G.nearestWalkable(w,w.start.x+Math.floor(rng()*7)-3,w.start.y+Math.floor(rng()*7)-3,8);
  const b=G.nearestWalkable(w,Math.max(1,Math.min(w.N-2,w.start.x+Math.round((rng()*2-1)*range))),Math.max(1,Math.min(w.N-2,w.start.y+Math.round((rng()*2-1)*range))),8);
  if(a&&b)queries.push([a.x,a.y,b.x,b.y]);
 }
 fixtures.push({seed,roads,games,queries,signature:signatures[0],roadTiles:w.road.reduce((a,b)=>a+b,0)});
}
const run=(name,f,q)=>f.games[name].findPath(f.games[name].world,...q);
for(let warm=0;warm<3;warm++)for(const f of fixtures)for(const q of f.queries)for(const name of Object.keys(roots))run(name,f,q);
const records=[];
for(let batch=0;batch<7;batch++){
 const samples={baseline:[],candidate:[]},failures={baseline:0,candidate:0},steps={baseline:0,candidate:0};
 for(let repeat=0;repeat<5;repeat++)for(const f of fixtures)for(const q of f.queries){
  const order=(batch+repeat)%2?['candidate','baseline']:['baseline','candidate'];
  for(const name of order){const start=performance.now(),result=run(name,f,q),ms=performance.now()-start;samples[name].push(ms);if(!result)failures[name]++;else steps[name]+=result.length;}
 }
 const summarize=xs=>{xs.sort((a,b)=>a-b);const p=q=>xs[Math.min(xs.length-1,Math.floor(xs.length*q))];return{samples:xs.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),meanMs:xs.reduce((a,b)=>a+b,0)/xs.length,totalMs:xs.reduce((a,b)=>a+b,0)};};
 records.push({batch,baseline:{...summarize(samples.baseline),failed:failures.baseline,steps:steps.baseline},candidate:{...summarize(samples.candidate),failed:failures.candidate,steps:steps.candidate}});
 console.log(JSON.stringify(records.at(-1)));
}
const report={note:'Same-process warmed AB/BA fixed-query batches. Shared-VM noise remains; not mobile performance or whole-application timing.',date:new Date().toISOString(),node:process.version,platform:process.platform,cpuCount:os.cpus().length,roots,sourceHashes:Object.fromEntries(Object.keys(roots).map(k=>[k,fixtures[0].games[k].testSourceHash])),fixtures:fixtures.map(({games,...f})=>f),records};
if(arg('--out',null))fs.writeFileSync(arg('--out'),JSON.stringify(report,null,2)+'\n');
