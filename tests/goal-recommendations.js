'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),{loadGame}=require('./helpers/playability'),G=loadGame(root);
G.newGame(21);vm.runInNewContext(fs.readFileSync(path.join(root,'js/goal-presets.js'),'utf8'),{G});
const context=(extra={})=>Object.assign({population:15,season:0,day:0,occupiedHomes:5,fullWinter:150,capacities:Object.fromEntries(G.RES_KEYS.map(k=>[k,G.isTool(k)?Infinity:10000])),localLimits:[],specificGoals:{}},extra);
let pass=0,fail=0;function test(name,fn){try{fn();pass++;console.log('ok '+name)}catch(e){fail++;console.error('FAIL '+name+'\n'+e.stack)}}
test('all suggestions are pure reads and unknown modes have no fallback',()=>{
 const before=JSON.stringify(G.serializeGame());for(let i=0;i<30;i++)for(const mode of ['balanced','winter','stockpile'])G.recommendProductionGoals(mode);assert.equal(JSON.stringify(G.serializeGame()),before);assert.equal(G.recommendProductionGoals('survive'),null);
});
test('balanced food uses current population and 12 days plus disclosed 15 percent',()=>{
 const c=context(),r=G.recommendProductionGoals('balanced',c);assert.equal(r.values.food,Math.ceil(15*G.LIFE.eatPerDay*12*1.15));assert.equal(r.foodDays,12);assert.equal(r.values.firewood,165);assert.equal(r.values.tools,8);assert.ok(r.notes.some(x=>x.includes('15%')));assert.ok(r.notes.some(x=>x.includes('1.1')));
});
test('winter food horizon includes remaining autumn, winter and two days',()=>{
 assert.equal(G.recommendProductionGoals('winter',context({season:2,day:24})).foodDays,26);
 assert.equal(G.recommendProductionGoals('winter',context({season:2,day:35})).foodDays,15);
 assert.equal(G.recommendProductionGoals('winter',context({season:3,day:36})).foodDays,13);
 const last=G.recommendProductionGoals('winter',context({season:3,day:47}));assert.equal(last.foodDays,12);assert.equal(last.futureWinterDays,0);
 const next=G.recommendProductionGoals('winter',context({season:0,day:48}));assert.equal(next.foodDays,14);assert.equal(next.futureWinterDays,12);
});
test('food stockpile is a distinct two-season food-only suggestion',()=>{
 const r=G.recommendProductionGoals('stockpile',context());assert.equal(r.label,'储粮');assert.equal(r.foodDays,24);assert.deepEqual(Object.keys(r.values),['food']);assert.ok(r.values.food>G.recommendProductionGoals('balanced',context()).values.food);assert.ok(r.notes.some(x=>x.includes('其他资源草稿保留')));
});
test('all resource recommendations respect 85 percent public capacities and global maximum',()=>{
 for(const pop of [1,15,1000,10000000])for(const mode of ['balanced','winter','stockpile']){
  const c=context({population:pop,capacities:Object.fromEntries(G.RES_KEYS.map(k=>[k,G.isTool(k)?Infinity:k==='wood'?725:500]))}),r=G.recommendProductionGoals(mode,c);
  for(const[k,v]of Object.entries(r.values)){assert.ok(Number.isSafeInteger(v)&&v>0&&v<=G.PRODUCTION_GOAL_MAX);if(!G.isTool(k))assert.ok(v<=Math.floor(c.capacities[k]*.85));}
  if(r.limited.length){assert.ok(r.warnings.some(x=>x.includes('未覆盖原估算需求')));assert.ok(r.warnings.some(x=>x.includes('估算')&&x.includes('→')));}
 }
});
test('zero or tiny capacities do not silently set stop-production targets',()=>{
 const capacities=Object.fromEntries(G.RES_KEYS.map(k=>[k,0]));const r=G.recommendProductionGoals('stockpile',context({capacities}));assert.equal(Object.keys(r.values).length,0);assert.equal(r.limited[0],'food');assert.ok(r.warnings.some(x=>x.includes('未填写')));
});
test('empty population emits no zero shutdowns; absent housing leaves fuel alone',()=>{
 const zero=G.recommendProductionGoals('winter',context({population:0}));assert.equal(Object.keys(zero.values).length,0);assert.match(zero.warnings.join(''),/没有在世居民/);
 const unhoused=G.recommendProductionGoals('winter',context({occupiedHomes:0,fullWinter:0}));assert.equal(unhoused.values.firewood,undefined);assert.match(unhoused.warnings.join(''),/不能解决露宿/);
});
test('legacy mixed occupied homes use exact 30/20/75 heating, excluding empty sites and fire',()=>{
 G.game.heatRules=null; // Preserve this fixed-budget recommendation contract as v5.
 // Historical fixture arithmetic was stale: stone homes use 20, so 30+20+75=125.
 const w=G.world;w.buildings=[{id:1,type:'house',state:'ok',family:1},{id:2,type:'stonehouse',state:'ok',family:2},{id:3,type:'boarding',state:'ok',family:null},{id:4,type:'house',state:'ok',family:null},{id:5,type:'house',state:'site',family:3},{id:6,type:'house',state:'ok',family:4,houseFire:true}];w.families=[{id:1,houseId:1},{id:2,houseId:2},{id:3,houseId:3}];
 const before=JSON.stringify(w),c=G.goalRecommendationContext();assert.equal(c.occupiedHomes,3);assert.equal(c.fullWinter,125);assert.equal(G.recommendProductionGoals('winter',c).values.firewood,157);assert.equal(JSON.stringify(w),before);
});
test('local limits and exact individual food drafts warn without being overwritten',()=>{
 const c=context({localLimits:[{type:'firewood',limit:0},{type:'tools',limit:3}],specificGoals:{meat:0,grain:100}}),before=JSON.stringify(c),r=G.recommendProductionGoals('winter',c);
 assert.match(r.warnings.join(''),/2座工坊/);assert.match(r.warnings.join(''),/肉类 0.*主食 100/);assert.equal(r.values.meat,undefined);assert.equal(r.values.grain,undefined);assert.equal(JSON.stringify(c),before);
});
test('capacity context follows built storage and accepted stockpile resource types',()=>{
 G.world.buildings=[{id:10,type:'storage',state:'ok'},{id:11,type:'storage',state:'ok'},{id:12,type:'stockpile',state:'ok'},{id:13,type:'storage',state:'site'}];G.world.families=[];
 const c=G.goalRecommendationContext();assert.equal(c.capacities.food,1000);assert.equal(c.capacities.wood,1000+G.STOCKPILE_CAP);assert.equal(c.capacities.clothes,1000);assert.equal(c.capacities.tools,Infinity);
});
console.log(`Goal recommendation boundaries: ${pass} passed, ${fail} failed.`);if(fail)process.exitCode=1;
