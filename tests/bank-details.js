'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={console};c.window=c;vm.createContext(c);for(const n of ['core','defs','map','sim','render'])vm.runInContext(fs.readFileSync(__dirname+'/../js/'+n+'.js','utf8'),c);const G=c.G;
function world(){const w=G.emptyWorld(31,0,32);for(let y=0;y<32;y++){w.water[y*32+15]=2;for(let x=16;x<32;x++)w.water[y*32+x]=1;}return w;}
function draw(w,b={x0:0,y0:0,x1:31,y1:31}){const ops=[],ctx=new Proxy({},{get:(_,k)=>(...a)=>ops.push([k,...a]),set:(_,k,v)=>{ops.push([k,v]);return true;}});G.coastPresentation.bankDetails(ctx,w,b);return ops;}
G.SPR={get:()=>({width:256,height:208})};
const w=world(),before=JSON.stringify(w);G.game={season:1};const a=draw(w);assert(a.length>0);assert.deepEqual(draw(w),a);assert.equal(JSON.stringify(w),before);
vm.runInContext('Math.random=()=>{throw Error("No randomness allowed")}',c);G.rng=()=>{throw Error('No simulation RNG')};assert.deepEqual(draw(w),a);
G.game.season=3;const winter=draw(w);assert.notDeepEqual(winter,a);assert.equal(winter.length,0);G.game.season=1;assert.deepEqual(draw(w),a);
for(let y=0;y<32;y++)w.road[y*32+15]=1;assert.equal(draw(w).length,0);w.road.fill(0);for(let y=0;y<32;y++)w.rock[y*32+15]=1;assert.equal(draw(w).length,0);w.rock.fill(0);
assert.equal(draw(w,{x0:0,y0:0,x1:4,y1:4}).length,0);assert.equal(draw(w,{x0:25,y0:0,x1:31,y1:31}).length,0);
const partial=draw(w,{x0:13,y0:8,x1:18,y1:12});assert(partial.length>0);for(const op of partial.filter(v=>v[0]==='drawImage'))assert(a.some(x=>JSON.stringify(x)===JSON.stringify(op)));
for(const op of a)for(const v of op.slice(1))if(typeof v==='number')assert(Number.isFinite(v));
console.log('Bank details: deterministic location, no state/RNG mutation, seasonal identity, road/resource exclusions, bounded repair and finite geometry passed.');
