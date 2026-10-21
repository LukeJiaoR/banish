// Offline cold-cache / warm-lookup / pointer cost diagnostic.
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),{performance}=require('perf_hooks'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),out=process.argv[2];if(!out)throw Error('output directory required');fs.mkdirSync(out,{recursive:true});
const sources={baseline:require('node:child_process').execFileSync('git',['show','97bb129:js/render.js'],{cwd:root,encoding:'utf8'}),reviewed:fs.readFileSync(path.join(root,'js/render.js'),'utf8')};
function load(name){const c={console,document:{},addEventListener(){},setTimeout(){},clearTimeout(){}};c.window=c;vm.createContext(c);for(const f of ['core','defs','map','sim','sprites'])vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),c);vm.runInContext(sources[name],c);return c.G;}
const med=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
function timed(fn){const t=performance.now();fn();return performance.now()-t;}
const results={node:process.version,candidateSha256:crypto.createHash('sha256').update(sources.reviewed).digest('hex'),baseline:'97bb129',warmGeometryCallsPerTrial:0,pickCallsPerTrial:20000,trials:7,cases:[]};
for(const seed of [0,1,42]){
 const levels={};
 for(const name of ['baseline','reviewed']){
  const G=load(name),w=G.world=G.genWorld(seed,{terrain:'mountain'});G.game=G.newGameState();G.cam={x:217,y:31,z:.75};const tiles=[],boundary=[];
  for(let y=0;y<w.N;y++)for(let x=0;x<w.N;x++)if(G.isMountain(w,x,y)){tiles.push([x,y]);if([[0,1],[1,0],[-1,0],[0,-1]].some(([dx,dy])=>!G.isMountain(w,x+dx,y+dy)))boundary.push([x,y]);}
  const cold=[];for(let i=0;i<7;i++){G.mountainHeights.delete(w);cold.push(timed(()=>{for(const [x,y]of tiles)G.mountainPolygons(w,x,y);}));}
  const geom=[];for(let i=0;i<7;i++)geom.push(timed(()=>{for(let k=0;k<10;k++)for(const [x,y]of tiles)G.mountainPolygons(w,x,y);}));
  const points=[];for(let i=0;i<results.pickCallsPerTrial;i++){const list=i%2?tiles:boundary;const [x,y]=list[(i*7919)%list.length];const [px,py]=G.T2S(x+((i*17)%101)/100,y+((i*31)%101)/100);points.push([px*.75+217,(py-((i*29)%89))*.75+31]);}
  let sink=0;for(const p of points.slice(0,2000))sink+=G.screenToMapTile(...p).tx;
  const pick=[];for(let i=0;i<7;i++)pick.push(timed(()=>{for(const p of points)sink+=G.screenToMapTile(...p).tx;}));
  const faces=tiles.reduce((s,[x,y])=>s+G.mountainPolygons(w,x,y).length,0);
  levels[name]={tiles:tiles.length,boundaryTiles:boundary.length,faces,geometryCalls:tiles.length*10,coldAllTilesMs:med(cold),warmGeometryMs:med(geom),pick20000Ms:med(pick),pickMicroseconds:med(pick)*1000/points.length,sink};
 }
 results.cases.push({seed,...levels});console.log(JSON.stringify(results.cases.at(-1)));
}
fs.writeFileSync(path.join(out,'benchmark.json'),JSON.stringify(results,null,2));
