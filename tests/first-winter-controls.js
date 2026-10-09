#!/usr/bin/env node
// Portable version of the frozen external investigation; not the script hash recorded in the main report.
// Example: node tests/first-winter-controls.js --root . --years 1 --scenarios baseline,house16 --json /tmp/first-winter.json
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
// Read-only game probe. All interventions below are ordinary UI-reachable player actions.
// No economy, map, citizen, worker assignment, or scheduler values are overridden.
const args = process.argv.slice(2);
const allowedArgs = new Set(['--root', '--years', '--seeds', '--scenarios', '--json']);
for (let i = 0; i < args.length; i += 2) {
  if (!allowedArgs.has(args[i]) || args[i + 1] == null) throw new Error('Expected --root, --years, --seeds, --scenarios, or --json followed by a value');
}
function arg(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const root = path.resolve(arg('--root', path.join(__dirname, '..')));
const output = arg('--json', null);
const probeHash=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const {loadGame,sustainable}=require(root+'/tests/helpers/playability');
const seeds = arg('--seeds', '5,21,40,41,49,54,55').split(',').map(Number);
const scenarios = arg('--scenarios', 'baseline,house16,fuel50-until-housed,fuel0-first-year,cancel-for-stone').split(',');
const years = Number(arg('--years', 1));
const allowedScenarios = new Set(['baseline', 'house16', 'fuel50-until-housed', 'fuel0-first-year', 'cancel-for-stone', 'early-housing', 'fuel50', 'reserve-housing-fuel']);
if (!Number.isInteger(years) || years < 1 || years > 40 || seeds.some(s => !Number.isInteger(s) || s < 1) || scenarios.some(s => !allowedScenarios.has(s))) throw new Error('Invalid years, seeds, or scenario');
function replaceOnce(text, before, after) {
  const pieces = text.split(before);
  if (pieces.length !== 2) throw new Error('Expected exactly one strategy fragment: ' + before);
  return pieces[0] + after + pieces[1];
}
const source=fs.readFileSync(root+'/tests/helpers/playability.js','utf8');
function makeStrategy(G,scenario) {
 if (source.split('function sustainable(').length !== 2 || source.split('\nfunction run(').length !== 2) throw new Error('Ordinary policy boundaries changed');
 let s=source.slice(source.indexOf('function sustainable('), source.indexOf('\nfunction run('));
 if(scenario==='early-housing') s=replaceOnce(s,"if (count('gatherer') < 2 || (count('gatherer') < 3 && foodDays < 8))", "if (count('gatherer') < 2 || (count('house') >= 3 && count('gatherer') < 3 && foodDays < 8))");
 if(scenario==='fuel0-first-year') s=replaceOnce(s,"Math.min(G.PROD.woodcutter.fuelMax, Math.max(variant === 'fuel200' ? 200 : 100, Math.ceil(warmNeed / 50) * 50))","g.day < 48 ? 0 : Math.min(G.PROD.woodcutter.fuelMax, Math.max(100, Math.ceil(warmNeed / 50) * 50))");
 if(scenario==='house16') s=replaceOnce(s,"count('house') < 3 && r.wood >= 22","count('house') < 3 && r.wood >= 16");
 if(scenario==='fuel50-until-housed') s=replaceOnce(s,"Math.min(G.PROD.woodcutter.fuelMax, Math.max(variant === 'fuel200' ? 200 : 100, Math.ceil(warmNeed / 50) * 50))","g.day < 36 && count('house') < 3 ? 50 : Math.min(G.PROD.woodcutter.fuelMax, Math.max(100, Math.ceil(warmNeed / 50) * 50))");
 if(scenario==='fuel50') s=replaceOnce(s,"variant === 'fuel200' ? 200 : 100", "g.day < 36 && count('house') < 3 ? 50 : 100");
 if(scenario==='reserve-housing-fuel') s=replaceOnce(s,"variant === 'fuel200' ? 200 : 100", "g.day < 36 && count('house') < 3 && r.firewood >= 75 ? 50 : 100");
 const strategy=vm.runInNewContext('('+s+')')(G,'adaptive-mining');
 strategy.policyHash=crypto.createHash('sha256').update(s).update('variant=adaptive-mining').digest('hex');
 return strategy;
}
function snap(G){const w=G.world,g=G.game;return {day:g.day,hour:g.h,pop:w.citizens.length,adults:w.citizens.filter(c=>c.adult).length,res:Object.fromEntries(G.RES_KEYS.map(k=>[k,+g.res[k].toFixed(1)])),foodDays:+(g.res.food/(w.citizens.length*G.LIFE.eatPerDay)).toFixed(2),foodNet:+g.foodNet.toFixed(2),homeless:w.families.filter(f=>f.members.length&&f.houseId==null).length,unhousedChildren:w.citizens.filter(c=>!c.adult&&!G.homeOf(c)).length,unheated:w.buildings.filter(b=>G.isOccupiedHome(w,b)&&b.unheated).length,warmNeed:w.buildings.reduce((n,b)=>n+(G.isOccupiedHome(w,b)?G.BDEF[b.type].warmWoodPerYear:0),0),marks:[w.marked.size,w.markedRocks.size],buildings:w.buildings.map(b=>({id:b.id,type:b.type,state:b.state,workers:b.workers.length,target:b.type==='woodcutter'?G.fuelLimitOf(b):null,progress:b.progress})),jobs:w.citizens.reduce((a,c)=>{const job=w.bmap[c.job]?.type||'laborer';if(c.adult)a[job]=(a[job]||0)+1;return a},{})};}
function run(seed,scenario){const G=loadGame(root);G.newGame(seed);const w=G.world,g=G.game,strat=makeStrategy(G,scenario),days=[],actions=[],deaths=[],completed=[],shortages={hungryCitizenDays:0,toolDays:0,coldHouseDays:0};let prev=-1, cancelled=false;
 const add=G.addBuilding;G.addBuilding=(...args)=>{const before=snap(G),r=add(...args);if(r.ok)actions.push({action:'build',type:args[0],x:args[1],y:args[2],before});return r;};
 const finish=G.finishBuilding;G.finishBuilding=b=>{completed.push({day:g.day,h:g.h,type:b.type,id:b.id});return finish(b);};
 const kill=G.killCitizen;G.killCitizen=(c,reason)=>{deaths.push({day:g.day,h:g.h,reason,age:c.age,home:G.homeOf(c)?.type,cold:c.cold,before:snap(G)});return kill(c,reason);};
 for(let step=0;step<years*48*24/0.5 && !g.over;step++){G.advanceSim(0.5);if(step%24===0){
   const before=snap(G);strat.tick();
   for(const b of w.buildings.filter(b=>b.type==='woodcutter')) {const old=before.buildings.find(x=>x.id===b.id)?.target;if(old!==undefined && old!==G.fuelLimitOf(b)) actions.push({action:'fuel target',from:old,to:G.fuelLimitOf(b),before,after:snap(G)});}
   if(scenario==='cancel-for-stone'&&!cancelled&&g.day>=12&&g.day<36&&w.citizens.some(c=>!c.adult&&!G.homeOf(c))&&g.res.stone<8&&g.res.wood>=16&&w.marked.size){
     const before=snap(G),origin=G.nearestWalkable(w,w.start.x,w.start.y,8),rocks=[];
     for(let i=0;i<w.rock.length;i++)if(w.rock[i]===1){const x=i%w.N,y=Math.floor(i/w.N);rocks.push({x,y,d:G.d2(x,y,w.start.x,w.start.y)});}
     rocks.sort((a,b)=>a.d-b.d);const chosen=rocks.filter(r=>G.findPath(w,origin.x,origin.y,r.x,r.y)).slice(0,2);
     if(chosen.length){const result=G.cancelResourceMarks('trees');for(const r of chosen)G.markRockAt(w,r.x,r.y);cancelled=true;actions.push({action:'cancel tree orders and mark stone',result,chosen,before,after:snap(G)});}
   }
 }if(prev!==g.day){prev=g.day;days.push(snap(G));shortages.hungryCitizenDays+=w.citizens.filter(c=>c.hunger>0).length;shortages.toolDays+=g.res.tools<=0?1:0;shortages.coldHouseDays+=w.buildings.filter(b=>G.isOccupiedHome(w,b)&&b.unheated).length;}}
 const out={seed,scenario,sourceHash:G.testSourceHash,policyHash:strat.policyHash,years,final:snap(G),deaths,shortages,actions,completed,days};console.log(JSON.stringify({seed,scenario,years,pop:w.citizens.length,deaths:deaths.map(d=>({day:d.day,cause:d.reason})),shortages,res:out.final.res,houses:completed.filter(b=>b.type==='house').map(b=>b.day),builds:strat.buildLog}));return out;}
const results = [];
for (const scenario of scenarios) for (const seed of seeds) results.push(run(seed, scenario));
const report = { root, years, seeds, scenarios, referenceTree: 'e3d171e80ca1b823d17c55e14ccb825ae861f272',
  scriptHash: probeHash, ordinaryPolicySourceHash: crypto.createHash('sha256').update(source).digest('hex'), results };
if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');

