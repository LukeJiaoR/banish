/* Controlled field capacity and weather performance; not a labour/survival benchmark. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {performance}=require('node:perf_hooks'),{loadGame}=require('./helpers/playability');
const G=loadGame(path.resolve(__dirname,'..'));let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name);}
function field(id,crop='wheat',size=64){return {id,type:'farm',state:'ok',cropType:crop,cropChoice:crop,workers:[],farm:Array.from({length:size},(_,i)=>({x:i%8,y:Math.floor(i/8),sown:false,harvested:false})),growth:0,sownAll:false,harvestDone:false};}
function setup(seed,type,N=128,fields=[field(1)]){G.world={seed,N,buildings:fields,bmap:Object.fromEntries(fields.map(b=>[b.id,b])),citizens:[]};G.game=G.newGameState({v:1,preset:'classic',seed,climate:type});for(const crop of Object.keys(G.CROPS))G.game.unlocks[crop]=true;G.markGroundDirty=()=>{};G.ui.toast=()=>{};G.rng=()=>{throw Error('climate must not draw simulation RNG');};}
function model(seed,type,crop,early=false,years=5){
 const b=field(1,crop,64);setup(seed,type,128,[b]);const ledger=JSON.stringify([G.game.townLedger,G.game.industryLedger]);let potential=0,lost=0,earlyYears=0,firstReady=[];
 for(let day=0;day<years*48;day++){
  G.game.day=day;G.game.season=G.seasonOf(day);G.game.year=Math.floor(day/48)+1;const d=day%48;
  if(d===0)G.resetFarm(b,true);
  if(d===4){b.farm.forEach(f=>f.sown=true);b.sownAll=true;b.sowingCommitted=true;}
  G.expireWinterFarms();G.advanceCropClimate();
  if(early&&d>=24&&!b.earlyHarvestYield&&!b.harvestDone&&b.sownAll&&[1,2].some(o=>G.temperatureFor(seed,day+o,type)<G.CROP_TEMPERATURES[crop].frostBelow)){
   const quote=G.earlyHarvestQuote(b);if(quote.ok){assert(G.beginEarlyHarvest(b,quote.key).ok);earlyYears++;}
  }
  if(G.farmHarvestReady(b)){potential+=b.farm.filter(f=>f.sown&&!f.harvested).length*G.farmHarvestBase(b);b.farm.forEach(f=>{if(f.sown)f.harvested=true;});b.harvestDone=true;firstReady.push(d);}
  if(d===47)lost+=b.farm.filter(f=>f.frostLost).length;
 }
 assert.equal(G.game.res.food,500);assert.equal(G.game.res.meat,0);assert.equal(G.game.res.grain,500);assert.equal(JSON.stringify([G.game.townLedger,G.game.industryLedger]),ledger);
 return {potential,lost,earlyYears,firstReady};
}
const samples=[];
test('3 climates ×16 seeds ×4 crops ×5 years repeat deterministic field capacity with no stock or RNG effects',()=>{
 for(const type of Object.keys(G.CLIMATES))for(let seed=0;seed<16;seed++)for(const crop of Object.keys(G.CROPS)){
  const a=model(seed,type,crop),b=model(seed,type,crop);assert.deepEqual(a,b);assert(a.potential>=0&&a.potential<=64*G.CROPS[crop].perTile*5);samples.push({type,seed,crop,...a});
 }
});
const summary=[];
test('multi-season choices expose earlier beans, squash frost resistance and early-harvest tradeoffs',()=>{
 for(const type of Object.keys(G.CLIMATES))for(const crop of Object.keys(G.CROPS)){
  const rows=samples.filter(x=>x.type===type&&x.crop===crop);summary.push({type,crop,meanPotentialPerSeason:Math.round(rows.reduce((n,r)=>n+r.potential,0)/rows.length/5),meanFrostLostPerSeason:+(rows.reduce((n,r)=>n+r.lost,0)/rows.length/5).toFixed(2),earliest:Math.min(...rows.flatMap(x=>x.firstReady)),latest:Math.max(...rows.flatMap(x=>x.firstReady))});
 }
 const avg=(type,crop)=>summary.find(x=>x.type===type&&x.crop===crop).meanPotentialPerSeason;
 assert(avg('mild','wheat')>=avg('fair','wheat'));assert(avg('fair','wheat')>avg('harsh','wheat'));assert(avg('harsh','beans')>avg('harsh','wheat'));assert(avg('harsh','squash')>avg('harsh','wheat'));
 assert(samples.filter(r=>r.crop==='beans').every(r=>r.firstReady.every(d=>d<24)));
 let early=0,normal=0;for(let seed=0;seed<16;seed++){early+=model(seed,'harsh','wheat',true).potential;normal+=model(seed,'harsh','wheat').potential;}assert(early>normal);summary.push({type:'harsh',crop:'wheat',earlyHarvestMeanPotentialPerSeason:Math.round(early/80),naturalMeanPotentialPerSeason:Math.round(normal/80)});
});
const timings=[];
test('daily climate work stays bounded on 128/192 worlds with 20064-tile fields and zero per-citizen weather work',()=>{
 for(const N of [128,192]){const fields=Array.from({length:200},(_,i)=>field(i+1));setup(17,'harsh',N,fields);const start=performance.now();
  for(let day=1;day<=480;day++){G.game.day=day;G.game.season=G.seasonOf(day);if(day%48===4)for(const b of fields){G.resetFarm(b);b.farm.forEach(f=>f.sown=true);b.sownAll=true;b.sowingCommitted=true;}G.advanceCropClimate();G.expireWinterFarms();}
  const ms=performance.now()-start;timings.push({N,fields:200,tiles:12800,days:480,totalMs:+ms.toFixed(1),meanDayMs:+(ms/480).toFixed(3)});assert(ms<5000,'daily field benchmark should fit a generous5s local ceiling');
 }
});
console.log(JSON.stringify({passed,model:'Day4 full sow and instant harvest capacity; excludes labour, hauling, food demand and survival',summary,timings},null,2));
