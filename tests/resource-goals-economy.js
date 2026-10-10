'use strict';
// Real-map multi-winter goals; no resource grants or economy changes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {run}=require('./helpers/playability');
const root=path.resolve(__dirname,'..'),seeds=(process.env.GOAL_SEEDS||'1,2,3,4,5,6,7,8,11,17,29').split(',').map(Number),years=5;
const modes=(process.env.GOAL_MODES||'fixed,zero-food,zero-fuel,overexpand').split(',');
const results=[];
const foodGoal=Number(process.env.GOAL_FOOD||400);
assert.ok(Number.isInteger(foodGoal)&&foodGoal>=0);
for(const mode of modes)for(const seed of seeds){let configured=false,events=0,previous={};
 const r=run(root,seed,mode==='overexpand'?'overexpand':'normal',years,G=>{
  if(!configured){const values=mode==='zero-food'?{food:0}:mode==='zero-fuel'?{firewood:0}:{food:foodGoal,wood:100,stone:60,iron:20,tools:25,firewood:150};for(const [k,v]of Object.entries(values))G.setProductionGoal(k,v);configured=true;}
  for(const k of G.RES_KEYS){const p=G.goalPaused(k);if(previous[k]!==undefined&&previous[k]!==p)events++;previous[k]=p;}
  for(const b of G.world.buildings){if(!['woodcutter','blacksmith'].includes(b.type))continue;const k='building'+b.id,p=b.productionPaused===true;if(previous[k]!==undefined&&previous[k]!==p)events++;previous[k]=p;}
 });r.mode=mode;r.goalTransitions=events;results.push(r);console.log(`${mode} seed=${seed} day=${r.day} pop=${r.population} died=${r.died} causes=${JSON.stringify(r.causes)} food=${r.resources.food} fuel=${r.resources.firewood} tools=${r.resources.tools} transitions=${events}`);
}
const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
for(const r of results){if(r.mode==='fixed'){check(`fixed ${r.seed} survived five winters`,r.day===years*48&&r.population>=15);check(`fixed ${r.seed} no starvation`,!(r.causes['饿死']>0));check(`fixed ${r.seed} no first-winter deaths`,!r.deaths.some(d=>d.day<=48));check(`fixed ${r.seed} still has tools`,r.resources.tools>0)}
 if(r.mode==='zero-food')check(`zero-food ${r.seed} deliberate shutdown has starvation cost`,r.population===0&&r.causes['饿死']>0);
 if(r.mode==='zero-fuel')check(`zero-fuel ${r.seed} deliberate shutdown has cold cost`,r.causes['冻死']>0);
}
const pairs=results.filter(r=>r.mode==='overexpand').map(r=>[r,results.find(s=>s.mode==='fixed'&&s.seed===r.seed)]).filter(x=>x[1]);if(pairs.length)check('overexpansion remains costly in majority',pairs.filter(([r,s])=>r.died>s.died).length>pairs.length/2);
const report={root,years,seeds,modes,foodGoal,checks,results};const out=process.argv.slice(2).find(v=>!v.startsWith('--'));if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(`Survival screening: ${checks.filter(c=>c.pass).length}/${checks.length} checks passed (${process.argv.includes('--assert')?'strict assertion':'report-only; fixed goals are not a survival guarantee'})`);for(const c of checks.filter(c=>!c.pass))console.error('FAIL '+c.name);if(process.argv.includes('--assert')&&checks.some(c=>!c.pass))process.exitCode=1;
