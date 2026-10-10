'use strict';
// The tiny fake ground image is deliberately warm; cache allocation is tested separately.
// Real render-frame ordering with instrumented drawing. Pixel comparisons are
// separately produced using native Canvas; this test needs no runtime dependency.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const {loadGame}=require('./helpers/playability');
function fixture(){
 const G=loadGame(root);G.newGame(65);const w=G.world;
 w.water.fill(0);w.rock.fill(0);w.treeIdx.fill(-1);w.trees=[];w.citizens=[];w.cmap={};w.families=[];w.buildings=[];w.bmap={};w.bgrid.fill(-1);
 for(const[type,x,y]of[['house',40,40],['house',42,40],['house',44,40],['farm',40,32]]){const r=G.addBuilding(type,x,y);assert(r.ok,r.reason);G.finishBuilding(r.b)}
 const context={G,performance,document:{},setTimeout(){},clearTimeout(){}};vm.createContext(context);vm.runInContext(fs.readFileSync(root+'/js/render.js','utf8'),context);
 G.cv={clientWidth:800,clientHeight:600};G.ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});G.dpr=1;G.cam={z:1.5,x:256,y:-1654};G.hover={tx:-1,ty:-1};G.needGround=false;G.groundDirty=new Set();G._gcv={width:1,height:1};G.groundScale=1;G._groundWorld=G.world;G._groundScale=G.groundScale;G.updateParticles=()=>{};G.ui.refreshPlacement=()=>{};G.game.h=12;G.game.season=1;
 const calls=[];G.fillTexDiamond=(ctx,name)=>{calls.push(name);return true};G.sprDraw=(ctx,name)=>{calls.push(name);return[100,100]};
 return{G,w,calls,farm:w.buildings.find(b=>b.type==='farm')};
}
let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name)}
test('all farm ground draws before any house, including legal adjacent large field',()=>{const{G,calls}=fixture();G.frame(0);assert(calls.includes('house'));assert.equal(calls.filter(n=>n==='farm_soil').length,64);assert(calls.lastIndexOf('farm_soil')<calls.indexOf('house'))});
test('four seasons keep soil in ground pass, winter selects snow soil',()=>{for(let season=0;season<4;season++){const{G,calls}=fixture();G.game.season=season;G.frame(0);const soil=season===3?'farm_soil_snow':'farm_soil';assert(calls.includes(soil));assert(calls.lastIndexOf(soil)<calls.indexOf('house'))}});
test('crops draw once per unharvested planted cell, never redraw soil among buildings',()=>{const{G,farm,calls}=fixture();farm.growth=1;for(const f of farm.farm)f.sown=true;farm.farm[0].harvested=true;G.frame(0);assert.equal(calls.filter(n=>n==='crop_ripe').length,63);assert(calls.lastIndexOf('farm_soil')<calls.findIndex(n=>n==='house'||n==='crop_ripe'))});
test('offscreen field does not draw soil or crops',()=>{const{G,farm,calls}=fixture();for(const f of farm.farm)f.sown=true;G.cam.x=100000;G.frame(0);assert.equal(calls.filter(n=>n.startsWith('farm_soil')||n.startsWith('crop_')).length,0)});
test('rendering does not alter farm growth, crop flags, stocks or building progress',()=>{const{G,w,farm}=fixture();farm.growth=.4;for(const f of farm.farm)f.sown=true;const state=()=>JSON.stringify({res:G.game.res,farm:farm.farm,growth:farm.growth,progress:w.buildings.map(b=>b.progress)});const before=state();G.frame(0);assert.equal(state(),before)});
test('back and front crop cells sort independently around neighbouring houses',()=>{const{G,farm}=fixture(),order=[];for(const f of farm.farm)f.sown=true;const crop=G.drawFarmCrop,building=G.drawBuilding;G.drawFarmCrop=(ctx,b,f)=>{order.push(`crop:${f.x},${f.y}`);crop(ctx,b,f)};G.drawBuilding=(ctx,b,t)=>{order.push(`building:${b.x},${b.y}`);building(ctx,b,t)};G.frame(0);assert(order.indexOf('crop:40,32')<order.indexOf('building:40,40'));assert(order.indexOf('crop:47,39')>order.indexOf('building:40,40'))});
test('farm no-work warning remains visible without painting the field twice',()=>{const{G,farm,calls}=fixture();farm.noWork=true;G.frame(0);assert.equal(calls.filter(n=>n==='alert').length,1);assert.equal(calls.filter(n=>n==='farm_soil').length,64)});
test('unfinished farm retains original ground-only presentation, not a new building scaffold',()=>{const{G,farm,calls}=fixture();farm.state='site';farm.noWork=true;G.frame(0);assert.equal(calls.filter(n=>n==='farm_soil').length,64);assert(!calls.some(n=>n==='site_2x2'||n==='site_3x3'||n==='alert'))});
console.log(`Farm occlusion: ${passed} passed (render trace, not browser acceptance)`);
