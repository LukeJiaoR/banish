#!/usr/bin/env node
'use strict';
// Isolated, explicitly provisioned winter fixture, NOT a from-scratch survival claim.
// Both revisions use the same seed, layout, stocks and fuel target. Heating, log
// pickup, processing and warehouse delivery use unmodified running game code.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {loadGame}=require('./helpers/playability');
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const root=path.resolve(arg('--root',path.join(__dirname,'..')));
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture({type='stonehouse',fuel=50,cutter=true,physical=false}={}){
 const G=loadGame(root);G.newGame(5);
 // This historical 30/20/75 budget benchmark explicitly retains legacy v4 heating.
 G.game.climate=null;G.game.heatRules=null;delete G.game.startConfig.climate;const w=G.world;
 for(const key of ['water','rock','road'])w[key].fill(0);
 w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();G.bumpNavigation(w);
 G.addBuilding('storage',10,10,{instant:true,free:true});
 Object.assign(G.game.res,{wood:100,stone:0,iron:0,grain:1000,food:1000,tools:100,firewood:fuel,coal:0});
 const homes=[];
 for(let i=0;i<5;i++){
  const b=G.addBuilding(type,6+i*3,16,{instant:true,free:true}).b;
  assert(b);const c=G.spawnCitizen({x:b.x,y:b.y-1,age:40,sex:'m'});
  const f={id:G.nextId(),members:[c.id],houseId:b.id,coupleIds:[]};c.familyId=f.id;b.family=f.id;w.families.push(f);homes.push(b);
 }
 let shop=null;if(cutter){shop=G.addBuilding('woodcutter',15,10,{instant:true,free:true}).b;shop.fuelLimit=50;}
 if(physical){G.enablePhysicalSupplyPrototype();for(const b of homes){b.supplyStock=G.emptySupplyStock();b.supplyStock.firewood=fuel/5;b.supplyStock.grain=100;}G.game.res.firewood=0;}
 G.game.day=35;G.game.season=2;G.game.h=23.5;
 // Fixture map remains identical on round-trip; normal save validation still runs.
 const gen=G.genWorld;G.genWorld=(seed,opt)=>{const nw=gen(seed,opt);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};
 return {G,homes,shop};
}
function run(options){
 const {G,homes}=fixture(options),g=G.game,w=G.world;
 const result={options,sourceHash:G.testSourceHash,perHomeWinter:G.BDEF[options.type||'stonehouse'].warmWoodPerYear,receivedFuel:0,withdrawnLogs:0,cuttingHours:0,deliveries:0,coldHomeDays:0,deaths:[],daily:[]};
 const deposit=G.deposit;G.deposit=(type,qty,...rest)=>{const got=deposit(type,qty,...rest);if(type==='firewood'){result.receivedFuel+=got;result.deliveries++;}return got;};
 const withdraw=G.withdrawResource;G.withdrawResource=(type,qty)=>{const got=withdraw(type,qty);if(type==='wood')result.withdrawnLogs+=got;return got;};
 const step=G.stepCitizen;G.stepCitizen=(c,dt)=>{const t=c.task,before=t?.workLeft;step(c,dt);if(t?.kind==='fuel'&&t.phase==='process'&&Number.isFinite(before))result.cuttingHours+=Math.max(0,before-Math.max(0,t.workLeft));};
 const kill=G.killCitizen;G.killCitizen=(c,reason)=>{result.deaths.push({day:g.day,reason});return kill(c,reason);};
 let day=35;
 while(g.day<48&&!g.over){G.advanceSim(.1);if(g.day!==day){day=g.day;if(g.season===3){const bills=homes.map(b=>({...b.lastHeating,unheated:b.unheated}));result.coldHomeDays+=bills.filter(b=>b.unheated).length;result.daily.push({day,firewood:g.res.firewood,wood:g.res.wood,bills});}}}
 result.final={day:g.day,population:w.citizens.length,firewood:g.res.firewood,wood:g.res.wood};
 result.burnedFuel=result.daily.reduce((n,d)=>n+d.bills.reduce((n,b)=>n+b.wood,0),0);
 near((options.fuel??50)+result.receivedFuel-result.burnedFuel,result.final.firewood);
 assert.equal(result.daily.length,12);
 return result;
}
const results=[run({type:'stonehouse',fuel:50,cutter:true}),run({type:'house',fuel:50,cutter:true}),run({type:'stonehouse',fuel:75,cutter:false})];
for(const r of results)console.log(JSON.stringify({...r,daily:undefined}));
if(args.includes('--assert')){
 assert.equal(results[0].perHomeWinter,20);near(results[0].burnedFuel,100);assert.equal(results[0].coldHomeDays,0);assert(results[0].receivedFuel>0);assert(results[0].withdrawnLogs>0);assert(results[0].cuttingHours>0);
 near(results[1].burnedFuel,150);assert.equal(results[2].coldHomeDays,15);near(results[2].burnedFuel,75);
 // A legacy stone-house bill remains historical, including its warmth flag and
 // exact stock. New-day demand changes without retroactive billing on load.
 for(const physical of [false,true])for(const warm of [true,false])for(const explicit of [true,false]){
  const {G,homes}=fixture({fuel:100,cutter:false,physical});G.advanceSim(.5);
  const d=JSON.parse(JSON.stringify(G.serializeGame()));
  for(const b of d.buildings.filter(b=>b.type==='stonehouse')){b.lastHeating={day:36,wood:warm?15/12:.5,coal:0,need:15/12};if(explicit)b.unheated=!warm;else delete b.unheated;}
  G.applySaveData(d);assert.deepEqual(JSON.parse(JSON.stringify(G.game.res)),d.game.res);
  const inventories=()=>JSON.stringify(G.world.buildings.map(b=>[b.id,b.supplyStock]));
  assert.equal(inventories(),JSON.stringify(d.buildings.map(b=>[b.id,b.supplyStock])));
  const used=JSON.stringify(G.game.supplyUsed);assert.equal(used,JSON.stringify(d.game.supplyUsed||G.emptySupplyStock()));
  const inventory=inventories(),stock=JSON.stringify(G.game.res),first=JSON.stringify(G.world.bmap[homes[0].id].lastHeating);
  assert.equal(G.world.bmap[homes[0].id].lastHeating.need,15/12);assert.equal(G.world.bmap[homes[0].id].unheated,!warm);
  G.applySaveData(JSON.parse(JSON.stringify(G.serializeGame())));assert.equal(JSON.stringify(G.game.res),stock);assert.equal(inventories(),inventory);assert.equal(JSON.stringify(G.game.supplyUsed),used);assert.equal(G.world.bmap[homes[0].id].unheated,!warm);assert.equal(JSON.stringify(G.world.bmap[homes[0].id].lastHeating),first);
  G.advanceSim(24);assert.equal(G.world.bmap[homes[0].id].lastHeating.need,20/12);
  const bad=JSON.parse(JSON.stringify(G.serializeGame()));bad.buildings.find(b=>b.type==='stonehouse').lastHeating.need=16/12;
  assert.throws(()=>G.applySaveData(bad));
 }
 console.log('Stone heat balance: actual winter consumption, production labour, insufficient fuel, and automatic/physical legacy receipt checks passed');
}
const output=arg('--json',null);if(output)fs.writeFileSync(output,JSON.stringify({fixture:'seed5 five occupied homes; provisioned stocks; ordinary fuel target50',results},null,2)+'\n');
