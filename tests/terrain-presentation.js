'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global; require('../js/core'); require('../js/defs'); require('../js/sprites'); require('../js/render');
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name)}
function context(){const calls=[];return new Proxy({calls,createPattern(im,repeat){calls.push(['pattern',im,repeat]);return {im};}}, {get(o,k){return k in o?o[k]:(...args)=>o.calls.push([k,...args]);},set(o,k,v){o[k]=v;return true}})}
const image={width:512,height:512};
test('five original terrain assets are 512-square PNGs',()=>{for(const name of ['meadow_spring','meadow_summer','meadow_autumn','meadow_winter','water_open']){let b=fs.readFileSync(path.join(__dirname,'../assets/terrain-v2',name+'.png'));assert.equal(b.readUInt32BE(16),512);assert.equal(b.readUInt32BE(20),512);}});
test('texture repeats in world coordinates and caches one pattern per context',()=>{G.SPR.map.set('meadow_summer',image);const c=context();assert(G.fillTerrainSurface(c,'meadow_summer',2,3));assert(G.fillTerrainSurface(c,'meadow_summer',3,3));assert.equal(c.calls.filter(x=>x[0]==='pattern').length,1);assert.deepStrictEqual(c.calls.filter(x=>x[0]==='fillRect').map(x=>x.slice(1)),[[127.5,191.5,65,65],[191.5,191.5,65,65]]);assert.deepStrictEqual(c.calls.find(x=>x[0]==='transform').slice(1),[.5,.25,-.5,.25,0,0]);const other=context();G.fillTerrainSurface(other,'meadow_summer',0,0);assert.equal(other.calls.filter(x=>x[0]==='pattern').length,1);});
test('replaced image invalidates pattern without leaking old context',()=>{const c=context();G.fillTerrainSurface(c,'meadow_summer',0,0);G.SPR.map.set('meadow_summer',{width:512});G.fillTerrainSurface(c,'meadow_summer',0,0);assert.equal(c.calls.filter(x=>x[0]==='pattern').length,2);});
test('missing asset or unavailable pattern uses existing fallback',()=>{assert.equal(G.fillTerrainSurface(context(),'missing',0,0),false);assert.equal(G.fillTerrainSurface({createPattern:null},'meadow_summer',0,0),false);const c=context();c.createPattern=()=>null;assert.equal(G.fillTerrainSurface(c,'meadow_summer',0,0),false);});
const originalSurface=G.fillTerrainSurface,originalDiamond=G.fillTexDiamond;
function tile(season,water,road,surfaceWorks=true){G.game={season};const calls=[];G.fillTerrainSurface=(c,n)=>{calls.push(['surface',n]);return surfaceWorks};G.fillTexDiamond=(c,n)=>{calls.push(['diamond',n]);return true};const w={N:1,seed:65,water:[water],road:[road],rock:[0]};G.drawGroundTile(context(),w,G.PAL[season],0,0);return calls}
test('all four seasons select their meadow',()=>{for(let s=0;s<4;s++)assert.equal(tile(s,0,0)[0][1],'meadow_'+G.TEX_SEASON[s]);});
test('autumn open water is blue material, never golden seasonal asset',()=>{for(let s=0;s<3;s++)assert.deepStrictEqual(tile(s,1,0),[['surface','water_open']]);assert.deepStrictEqual(tile(2,1,0,false),[['surface','water_open'],['diamond','water_spring']]);});
test('winter preserves ice; roads and shore preserve specialized materials',()=>{assert.deepStrictEqual(tile(3,1,0),[['diamond','water_winter']]);assert.equal(tile(1,2,0)[0][1],'sand_summer');assert.equal(tile(1,0,1)[0][1],'road_summer');});
G.fillTerrainSurface=originalSurface;G.fillTexDiamond=originalDiamond;
test('terrain rendering never consumes simulation randomness',()=>{const saved=G.rng;G.rng=()=>{throw Error('simulation RNG must not be called')};G.game={season:1};G.fillTerrainSurface(context(),'meadow_summer',100,100);G.rng=saved;});
console.log(`Terrain presentation: ${passed}/${passed} groups passed`);
