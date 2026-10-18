'use strict';
/* Serial native Canvas comparison, never a browser/FPS or GPU measurement.
 * node tools/riverbay-lab/benchmark.cjs --out /tmp/shore-benchmark.json
 * Add --compare-fallback to isolate Path2D vs identical cached triangle commands.
 * Optional --baseline-root /absolute/path/to/previous/checkout compares revisions.
 * No screenshots/readbacks occur inside timed frame calls. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createCanvas,loadImage,Path2D}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'../..');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const out=arg('--out');if(!out)throw new Error('Explicit --out required');
const baseline=arg('--baseline-root');
const profile=require('./app.js');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function fixture(folder,label,usePath=true){
 const context={console,performance,Path2D:usePath?Path2D:undefined,setTimeout(){},clearTimeout(){},addEventListener(){},document:{createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
 for(const name of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(folder,'js',name+'.js'),'utf8'),context,{filename:name+'.js'});
 const G=context.G;G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
 for(const dir of fs.readdirSync(path.join(folder,'assets'))){const at=path.join(folder,'assets',dir);if(!fs.statSync(at).isDirectory())continue;for(const name of fs.readdirSync(at).filter(n=>n.endsWith('.png')))G.SPR.map.set(name.slice(0,-4),await loadImage(path.join(at,name)));}
 for(const name of ['scene','terrain'])vm.runInContext(fs.readFileSync(path.join(folder,'tools/riverbay-lab',name+'.js'),'utf8'),context,{filename:name+'.js'});
 const scene=context.RiverbayScene.createScene(G);if(scene.failures.length)throw new Error(JSON.stringify(scene.failures));context.RiverbayScene.pose(scene,6.5);
 const terrain=context.RiverbayTerrain.install(G,{waterImage:await loadImage(path.join(folder,'tools/riverbay-lab/water-open-candidate-v2.png'))});
 G.cv=createCanvas(1200,521);G.cv.clientWidth=1200;G.cv.clientHeight=521;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=1;const [x,y]=G.T2S(16,16);G.cam.x=600-x;G.cam.y=521*.53-y;G.groundScale=.68;
 const profiler=profile.install(G,{engine:'@napi-rs/canvas; synchronous native call time'});
 terrain.setOptions({waterV2:true,shore:true,lowFrequency:true,clutter:true,shoreVariation:false});
 return {G,terrain,profiler,label,pathMode:usePath?'Path2D if supported by revision':'cached commands',terrainSha256:digest(path.join(folder,'tools/riverbay-lab/terrain.js'))};
}
function frame(f,variation,fresh){
 f.terrain.setOptions({shoreVariation:variation});if(fresh)f.terrain.invalidateTopology();
 const before={...f.terrain.metrics},start=performance.now();f.G.frame(0);const totalSyncMs=performance.now()-start,record=f.profiler.latestFrame();
 if(!record.completed||!record.timingValid||record.groundDrawCalls!==1||![totalSyncMs,record.frameSyncMs,record.buildGroundSubmitMs,record.firstGroundDrawImageCallMs,record.remainingFrameSyncMs].every(Number.isFinite))throw new Error('Invalid native frame profile');
 const delta=key=>Number.isFinite(before[key])&&Number.isFinite(f.terrain.metrics[key])?f.terrain.metrics[key]-before[key]:null;
 return {variant:variation?'B':'A',totalSyncMs,...record,geometryBuilds:delta('variationGeometryBuilds'),pathBuilds:delta('variationPathBuilds'),combinedPathBuilds:delta('variationCombinedPathBuilds')};
}
const quantile=(xs,p)=>{xs=[...xs].sort((a,b)=>a-b);return xs[Math.ceil(xs.length*p)-1];};
function summarize(samples){return Object.fromEntries(['A','B'].map(variant=>{const rows=samples.filter(r=>r.variant===variant);return [variant,Object.fromEntries(['totalSyncMs','buildGroundSubmitMs','firstGroundDrawImageCallMs','remainingFrameSyncMs'].map(key=>[key,{p50:quantile(rows.map(r=>r[key]),.5),p95:quantile(rows.map(r=>r[key]),.95),max:Math.max(...rows.map(r=>r[key]))}]))];}));}
(async()=>{
 const fixtures=[];if(baseline)fixtures.push(await fixture(path.resolve(baseline),'previous-B'));if(process.argv.includes('--compare-fallback'))fixtures.push(await fixture(root,'candidate-command-fallback',false));fixtures.push(await fixture(root,'candidate-B'));
 const report={engine:'@napi-rs/canvas; NOT browser/device/FPS',counterMeaning:'Null means instrumentation unavailable in that revision; zero means measured no new builds.',timingScope:profile.timingScope,viewport:{width:1200,height:521,dpr:1,zoom:1},method:'Serial alternating revision order and A/B order across 12 pairs per phase, after 3 discarded A/B pairs. Fresh phase invalidates topology before every sample; cached phase reuses geometry but toggles options and rebuilds ground. Assets/JIT are not process-cold. 40 warm frames per variant. No screenshot/readback inside timing.',results:fixtures.map(f=>({label:f.label,pathMode:f.pathMode,terrainSha256:f.terrainSha256,phases:{}}))};
 for(const f of fixtures)for(let i=0;i<3;i++){frame(f,false,true);frame(f,true,true);}
 for(const phase of ['fresh-topology','cached-geometry']){
  const buckets=fixtures.map(()=>[]);
  // Start cached phase with B geometry present for every fixture.
  if(phase==='cached-geometry')for(const f of fixtures){frame(f,true,true);frame(f,false,false);}
  for(let round=0;round<12;round++){
   for(const index of round%2?[...fixtures.keys()].reverse():[...fixtures.keys()]){
    const f=fixtures[index],order=round%2?[true,false]:[false,true];
    // Force the opposite starting state so every reported sample is a rebuild.
    frame(f,!order[0],false);
    for(const variation of order){const sample=frame(f,variation,phase==='fresh-topology');if(sample.groundBuildCalls!==1)throw new Error('Reported switch must rebuild ground once');buckets[index].push({round,...sample});}
   }
  }
  buckets.forEach((samples,index)=>report.results[index].phases[phase]={summary:summarize(samples),samples});
 }
 for(let i=0;i<fixtures.length;i++){
  const f=fixtures[i],warm=[];for(const variation of [false,true]){frame(f,variation,false);for(let n=0;n<40;n++)warm.push(frame(f,variation,false));}
  if(warm.some(r=>r.groundBuildCalls))throw new Error('Warm frame unexpectedly rebuilt ground');
  report.results[i].warm={summary:summarize(warm),samples:warm};
 }
 fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,results:report.results.map(r=>({...r,phases:Object.fromEntries(Object.entries(r.phases).map(([k,v])=>[k,v.summary])),warm:r.warm.summary}))},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
