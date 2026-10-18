'use strict';
/* Actual economy runs, without resource grants or altered rates. Survival
 * outcomes are observations, not safety assertions about these suggestions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {run}=require('./helpers/playability'),root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/goal-presets.js'),'utf8'),install=G=>{if(!G.recommendProductionGoals)vm.runInNewContext(source,{G});};
const baseline=run(root,1,'normal',1),readOnly=run(root,1,'normal',1,G=>{
 install(G);const before=JSON.stringify(G.serializeGame());
 for(const mode of ['balanced','winter','stockpile'])G.recommendProductionGoals(mode);
 assert.equal(JSON.stringify(G.serializeGame()),before,'opening suggestion planning must not mutate the village');
});
assert.equal(JSON.stringify(readOnly),JSON.stringify(baseline),'daily preview produces the identical full-year outcome (normalize VM object prototypes)');
console.log('ok daily suggestion preview matches the untouched full-year simulation exactly');
const results=[];
for(const mode of ['balanced','winter','stockpile'])for(const seed of [1,17]){
 let lastSeason='',applications=0,capacityWarnings=0;
 const result=run(root,seed,'normal',1,G=>{
  install(G);const season=G.game.year+':'+G.game.season;if(season===lastSeason)return;lastSeason=season;
  const before=JSON.stringify(G.serializeGame()),plan=G.recommendProductionGoals(mode);
  assert.equal(JSON.stringify(G.serializeGame()),before);
  const stock=JSON.stringify(G.game.res),locals=JSON.stringify(G.world.buildings.map(b=>[b.id,b.fuelLimit,b.toolLimit]));
  // This explicit test strategy applies at season boundaries, exactly through
  // the existing engine setter. The shipped UI requires the player's Apply.
  for(const[k,v]of Object.entries(plan.values)){
   assert.ok(Number.isInteger(v)&&v>0&&v<=G.PRODUCTION_GOAL_MAX);
   if(!G.isTool(k))assert.ok(v<=Math.floor(G.storageCap(k)*.85));
   assert.equal(G.setProductionGoal(k,v),true);assert.equal(G.productionGoalOf(k),v);
  }
  assert.equal(JSON.stringify(G.game.res),stock,'applying cannot grant or discard inventory');
  assert.equal(JSON.stringify(G.world.buildings.map(b=>[b.id,b.fuelLimit,b.toolLimit])),locals,'local cutoffs remain untouched');
  applications++;capacityWarnings+=plan.limited.length;
 });
 assert.ok(applications>=1);assert.ok(Object.values(result.resources).every(Number.isFinite));
 results.push({mode,seed,applications,capacityWarnings,...result});
 console.log(`${mode} seed=${seed}: day=${result.day}, people=${result.population}, deaths=${result.died}, hunger-days=${result.shortages.hungryCitizenDays}, unheated-home-days=${result.shortages.unheatedHomeDays}, food=${result.resources.food}, fuel=${result.resources.firewood}`);
}
const report={years:1,seeds:[1,17],notes:'Two-seed diagnostics, not a survival guarantee. No resources, staffing, housing, or per-building cutoffs granted by recommendations.',baseline,results};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log('Goal recommendation simulation: preview equivalence and 6 applied-run invariants passed; survival outcomes above remain visible.');
