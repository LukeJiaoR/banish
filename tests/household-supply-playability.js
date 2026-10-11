'use strict';
// Real first-winter comparison. Normal player-like building decisions, no free
// structures/resources; opt-in allocation is deducted from existing stock.
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame,sustainable}=require('./helpers/playability');
function run(mode){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);let bootstrap=null;
 if(mode==='unseeded-prototype')G.enablePhysicalSupplyPrototype();
 else if(mode==='confirmed'){const q=G.supplyModeQuote();bootstrap=q.cost;assert(G.enableHouseholdSupply(q.key));}
 const strategy=sustainable(G,'normal');let hungerCitizenDays=0,unheatedHomeDays=0,lastDay=0,saveChecks=0,errandHours=0;
 while(G.game.day<48&&!G.game.over){
  if(Math.abs(G.game.h%12)<1e-6)strategy.tick();
  for(const c of G.world.citizens)if(G.supplyTaskOf(c))errandHours+=.25;
  G.advanceSim(.25);
  if(G.game.day!==lastDay){lastDay=G.game.day;hungerCitizenDays+=G.world.citizens.filter(c=>c.hunger>0).length;unheatedHomeDays+=G.world.buildings.filter(b=>b.unheated).length;G.prepareSaveData(G.serializeGame());saveChecks++;}
 }
 const result={mode,day:G.game.day,population:G.world.citizens.length,deaths:G.game.stats.deadReasons,hungerCitizenDays,unheatedHomeDays,saveChecks,errandHours,bootstrap,food:G.game.res.food,availableFood:G.supplyEconomyStock('food'),firewood:G.game.res.firewood,buildLog:strategy.buildLog};
 assert.equal(result.day,48);assert.equal(G.game.stats.died,0);assert.equal(unheatedHomeDays,0);assert.equal(saveChecks,48);return result;
}
const results=['automatic','unseeded-prototype','confirmed'].map(run);console.log(JSON.stringify({sourceHash:loadGame(path.resolve(__dirname,'..')).testSourceHash,results},null,2));
