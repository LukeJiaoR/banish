'use strict';
// Isolated component experiment; writes only the explicit --out destination.
// Fixed staff/free construction/large reserves isolate throughput, not town survival.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const args=process.argv.slice(2),arg=(n,d)=>args.includes(n)?args[args.indexOf(n)+1]:d;
const {loadGame}=require('./helpers/playability');
const roots={baseline:path.resolve(arg('--baseline',path.join(__dirname,'..'))),current:path.resolve(arg('--candidate',path.join(__dirname,'..')))};
const manifest={sources:Object.fromEntries(Object.entries(roots).map(([key,root])=>[key,{sourceHash:loadGame(root).testSourceHash}]))};
const variants=args.includes('--food3')?['baseline','current','food3']:['baseline','current'],types=['gatherer','hunting','dock','mine','woodcutter','blacksmith'];
const layouts=new Map(),foodTypes=['gatherer','hunting','dock'];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const round=x=>+x.toFixed(6),add=(a,k,v)=>a[k]=(a[k]||0)+v;
const diff=(a,b)=>Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b)])].map(k=>[k,round((a[k]||0)-(b[k]||0))]));
const clone=x=>JSON.parse(JSON.stringify(x)),sum=a=>Object.values(a).reduce((a,b)=>a+b,0);
function init(variant,seed){const key=variant==='baseline'?'baseline':'current';const G=loadGame(roots[key]);assert.equal(G.testSourceHash,manifest.sources[key].sourceHash);if(variant==='food3'){G.PROD.gatherer.yield.qty=15;G.PROD.hunting.yield=15;G.PROD.dock.yield.qty=12;}G.world=G.genWorld(seed);G.game=G.newGameState();G.rng=G.makeRng((seed^0x51f15e)>>>0);return G;}
function fixture(G,type,x,y){const d=G.BDEF[type];for(let yy=y;yy<y+d.h;yy++)for(let xx=x;xx<x+d.w;xx++)G.removeTree(G.world,xx,yy);const result=G.addBuilding(type,x,y,{instant:true,free:true});assert(result.ok,JSON.stringify({type,x,y,result}));return result.b;}
function choose(G,seed,type,distance,quality){
 const key=[seed,type,distance,quality==='low'?'low':'rich'].join(':'),w=G.world,s=w.start,d=G.BDEF[type];if(layouts.has(key))return clone(layouts.get(key));
 const scan=quality==='low'?w.N:25,opts=[];
 for(let y=Math.max(2,s.y-scan);y<Math.min(w.N-d.h-2,s.y+scan);y++)for(let x=Math.max(2,s.x-scan);x<Math.min(w.N-d.w-2,s.x+scan);x++){
  if(!G.canPlace(w,type,x,y).ok)continue;
  const trees=['gatherer','hunting'].includes(type)?G.treesInRadius(w,x,y,G.PROD[type].radius,true).length:0;
  const water=type==='dock'?G.countWaterInRadius(w,x,y,G.PROD.dock.waterR):null;
  const score=type==='dock'?(quality==='low'?-water-G.dist(x,y,s.x,s.y)*.0001:Math.min(water,60)*2-G.dist(x,y,s.x,s.y)*2):Math.min(trees,type==='gatherer'?35:30)-G.dist(x,y,s.x,s.y)*2;
  opts.push({x,y,trees,water,score});
 }
 opts.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);
 for(const p of opts.slice(0,100)){
  const origin=G.nearestWalkable(w,p.x-1,p.y-1,4),stores=[];if(!origin)continue;
  for(let y=Math.max(1,p.y-25);y<Math.min(w.N-4,p.y+25);y++)for(let x=Math.max(1,p.x-25);x<Math.min(w.N-4,p.x+25);x++){
   const r=G.dist(p.x,p.y,x,y);if(distance==='near'?(r<4||r>8):(r<18||r>23))continue;
   if(x+4>=p.x&&x<=p.x+d.w+1&&y+4>=p.y&&y<=p.y+d.h+1)continue;
   if(G.canPlace(w,'storage',x,y).ok)stores.push({x,y,r});
  }
  stores.sort((a,b)=>distance==='near'?a.r-b.r:Math.abs(a.r-20)-Math.abs(b.r-20));
  for(const st of stores.slice(0,30)){const sp=G.nearestWalkable(w,st.x-1,st.y-1,4),route=sp&&G.findPath(w,origin.x,origin.y,sp.x,sp.y);if(!route)continue;const picked={...p,storage:st,preBuildRouteSteps:route.length};layouts.set(key,picked);return clone(picked);}
 }
 throw Error('no fixture layout '+key);
}
function observe(G){
 const production={},delivered={},waste={},input={},consumption={},hours={},counts={},distance={},failures={};let active=false;
 const complete=G.completeTask;G.completeTask=function(c){const t=c.task,type=t?.yield?.type;const stock={...G.game.res},before=type?(stock[type]||0)+(c.carry?.type===type?c.carry.qty:0):0;complete(c);if(!active)return;if(type){const qty=(G.game.res[type]||0)+(c.carry?.type===type?c.carry.qty:0)-before;if(qty>0){add(production,type,qty);add(counts,type,1);}}
 for(const k of ['wood','iron']){const used=(stock[k]||0)-(G.game.res[k]||0);if(used>0)add(input,k,used);}
 };
 const deposit=G.deposit;G.deposit=function(type,qty){const before=G.game.res[type],got=deposit(type,qty);if(active){const n=G.game.res[type]-before;add(delivered,type,n);add(waste,type,qty-n);}return got;};
 const endDay=G.endDay;G.endDay=function(){const before={...G.game.res};endDay();if(active)for(const k of ['food','tools','firewood']){const used=before[k]-G.game.res[k];if(used>0)add(consumption,k,used);}};
 const make=G.makeTask;G.makeTask=function(b,c){const t=make(b,c);c.probeWait=t?null:b.warnText||'no available task';if(active&&!t)add(failures,c.probeWait,1);return t;};
 function state(c){if(c.state==='haul')return 'haulOutput';if(c.state==='walk')return c.walkKind==='home'?'walkHome':c.walkKind==='task'?(c.task?.kind==='firewood'&&c.task.phase==='fetch'?'walkFetch':'walkToWork'):'wander';if(c.state==='work')return c.task?.kind==='firewood'&&c.task.phase==='fetch'?'fetchTransition':'process';if(c.state==='idle')return c.probeWait?'waiting':'idle';return c.state;}
 const step=G.stepCitizen;G.stepCitizen=function(c,dt){const st=state(c),x=c.x,y=c.y;if(active)add(hours,st,dt);step(c,dt);if(active)add(distance,st,Math.hypot(c.x-x,c.y-y));};
 return {production,delivered,waste,input,consumption,hours,counts,distance,failures,start(){active=true;},snapshot(){return clone({production,delivered,waste,input,consumption,hours,counts,distance,failures});}};
}
function run(conf){
 const {variant,seed,type,distance='near',quality='rich',tools=true,emptyInputs=false,dt=.5,years=5}=conf;
 const G=init(variant,seed),w=G.world,g=G.game,jobs=G.BDEF[type].jobs,p=choose(G,seed,type,distance,quality),b=fixture(G,type,p.x,p.y),st=fixture(G,'storage',p.storage.x,p.storage.y);
 if(quality==='sparse'&&['gatherer','hunting'].includes(type)){
  const trees=G.treesInRadius(w,b.x,b.y,G.PROD[type].radius,false).sort((a,z)=>G.d2(a.x,a.y,b.x,b.y)-G.d2(z.x,z.y,b.x,b.y)||a.i-z.i);
  const keep=G.PROD[type].needTrees;for(const t of trees.slice(keep))G.removeTree(w,t.x,t.y);
 }
 const origin=G.nearestWalkable(w,st.x-1,st.y-1,5),spot=G.workSpot(w,b,origin.x,origin.y),route=spot&&G.findPath(w,origin.x,origin.y,spot.x,spot.y);assert(route,'fixture route disconnected');
 p.postBuildWorkshopRouteSteps=route.length;p.postBuildWorkshopRouteTiles=route.reduce((v,t,i)=>v+G.dist(t.x,t.y,i?route[i-1].x:origin.x,i?route[i-1].y:origin.y),0);
 const forest=()=>['gatherer','hunting'].includes(type)?{trees:G.treesInRadius(w,b.x,b.y,G.PROD[type].radius,false).length,mature:G.treesInRadius(w,b.x,b.y,G.PROD[type].radius,true).length}:null;
 p.initialForest=forest();
 // Explicit isolation only: no cold/families/construction/storage caps or staffing competition.
 // Normal walk/path, winter movement, output hauling, eating, rest, tool wear, tree growth remain.
 G.STORAGE_CAP=1e9;Object.assign(g.res,{food:100000,tools:tools?10000:0,wood:emptyInputs?0:100000,iron:emptyInputs?0:100000,stone:0,firewood:0});
 if(type==='woodcutter'){G.PROD.woodcutter.fuelMax=1e9;b.fuelLimit=1e9;}if(type==='blacksmith'){G.PROD.blacksmith.toolMax=1e9;b.toolLimit=1e9;}
 G.LIFE.coldOutdoor=0;G.LIFE.coldIndoors=0;G.LIFE.warmRecover=0;G.formFamilies=()=>{};
 for(let n=0;n<jobs;n++){const c=G.spawnCitizen({...origin,age:25,sex:'m'});c.educated=false;}
 G.scheduleJobs=()=>{b.noWork=false;for(const c of w.citizens){if(c.job!==b.id){c.job=b.id;if(!b.workers.includes(c.id))b.workers.push(c.id);}}};G.scheduleJobs();
 const obs=observe(G),resStart={...g.res};obs.start();const annual=[];let last=obs.snapshot();
 const yearSteps=G.YEAR_DAYS*G.DAY_H/dt;assert(Number.isInteger(yearSteps));
 for(let step=1;step<=years*yearSteps&&!g.over;step++){G.advanceSim(dt);if(step%yearSteps===0){const now=obs.snapshot();annual.push({year:step/yearSteps,day:g.day,hour:g.h,production:diff(now.production,last.production),delivered:diff(now.delivered,last.delivered),input:diff(now.input,last.input),consumption:diff(now.consumption,last.consumption),hours:diff(now.hours,last.hours),distance:diff(now.distance,last.distance),counts:diff(now.counts,last.counts),stock:{...g.res},cargo:w.citizens.filter(c=>c.carry).map(c=>clone(c.carry)),forest:forest()});last=now;}}
 assert.equal(annual.length,years);assert.equal(w.citizens.length,jobs);assert.equal(g.stats.died,0);
 const totals=obs.snapshot(),steady=annual.slice(1),metric=key=>{const out={};for(const yr of steady)for(const[k,v]of Object.entries(yr[key]))add(out,k,v/steady.length);return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,round(v)]));};
 const perBuildingYear=metric('production'),perWorkerYear=Object.fromEntries(Object.entries(perBuildingYear).map(([k,v])=>[k,round(v/jobs)])),hours=metric('hours'),hTotal=sum(hours),activeHours=hTotal-(hours.rest||0);
 const shares=Object.fromEntries(Object.entries(hours).map(([k,v])=>[k,round(v/hTotal)]));
 const cargo={};for(const c of w.citizens)if(c.carry)add(cargo,c.carry.type,c.carry.qty);
 const conservation={};for(const key of Object.keys(g.res)){const expected=resStart[key]+(totals.production[key]||0)-(totals.input[key]||0)-(totals.consumption[key]||0)-(totals.waste[key]||0),actual=g.res[key]+(cargo[key]||0),err=expected-actual;conservation[key]={expected:round(expected),actual:round(actual),error:round(err)};assert(Math.abs(err)<.0001,JSON.stringify({conf,key,err,totals}));}
 const r={...conf,jobs,root:variant==='baseline'?'baseline':'current',sourceHash:G.testSourceHash,externalOverrides:variant==='food3'?{gathererYield:15,huntingYield:15,dockYield:12}:null,parameters:{jobs,prod:clone(G.PROD[type]),noToolMult:G.NO_TOOL_MULT},layout:p,perBuildingYear,perWorkerYear,deliveredPerYear:metric('delivered'),inputsPerYear:metric('input'),consumptionPerYear:metric('consumption'),hoursPerYear:hours,timeShares:shares,activeTimeShares:{process:round((hours.process||0)/activeHours),transport:round(((hours.haulOutput||0)+(hours.walkFetch||0)+(hours.walkToWork||0))/activeHours)},distancePerYear:metric('distance'),annual,totals,resStart,resEnd:{...g.res},cargo,conservation,endForest:forest(),day:g.day};
 return r;
}
function matrix(mode){const cases=[];const push=c=>{for(const variant of foodTypes.includes(c.type)?variants:variants.slice(0,2))cases.push({...c,variant});};
 if(mode==='rich'||mode==='all')for(const seed of [1,2,41])for(const type of types)for(const distance of ['near','far'])push({seed,type,distance,quality:'rich'});
 if(mode==='scarce'||mode==='all')for(const seed of [1,2,41])for(const type of foodTypes)for(const distance of ['near','far'])push({seed,type,distance,quality:type==='dock'?'low':'sparse'});
 if(mode==='notools'||mode==='all')for(const seed of [1])for(const type of types)for(const distance of ['near','far'])push({seed,type,distance,quality:'rich',tools:false});
 if(mode==='empty'||mode==='all')for(const type of ['woodcutter','blacksmith'])for(const distance of ['near','far'])push({seed:1,type,distance,quality:'rich',emptyInputs:true});
 if(mode==='resolution')for(const type of types)for(const distance of ['near','far'])for(const variant of ['baseline','current'])cases.push({seed:1,type,distance,quality:'rich',variant,dt:.25});
 if(mode==='smoke')for(const type of types)push({seed:1,type,distance:'near',quality:'rich'});
 return cases;
}
if(require.main===module){const mode=args[0]||'smoke',cases=matrix(mode);assert(cases.length,mode);const records=[],file=arg('--out',null);assert(file,'Provide --out /path/results.json');const log=file+'.jsonl';fs.writeFileSync(log,'');
 for(const conf of cases){const r=run(conf);records.push(r);fs.appendFileSync(log,JSON.stringify(r)+'\n');console.log(JSON.stringify({n:records.length,total:cases.length,case:conf,yield:r.perBuildingYear,input:r.inputsPerYear,activeShare:r.activeTimeShares,forest:r.endForest,water:r.layout.water}));}
 fs.writeFileSync(file,JSON.stringify({created:new Date().toISOString(),probeHash:hash(fs.readFileSync(__filename)),manifest,mode,records},null,2));
}
module.exports={init,run,matrix};
