/* Offline geometry/state contracts, not browser acceptance. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),context={console,document:{},addEventListener(){},setTimeout(){},clearTimeout(){}};context.window=context;vm.createContext(context);
for(const n of ['core','defs','map','sim','sprites','render'])vm.runInContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),context);
const G=context.G;let passed=0;function test(n,f){f();passed++;console.log('ok '+n);}
const make=(route,step=0,phase='ingress')=>({route,step,phase}),world=boats=>({N:16,tradeVoyages:{boats}}),canvas=()=>{const calls=[];return {calls,ctx:new Proxy({},{get:(o,k)=>o[k]||((...a)=>calls.push([k,...a])),set:(o,k,v)=>(o[k]=v,true)})};};
test('all four cardinal directions follow canonical next edge and final incoming edge',()=>{
 for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const route=[85,85+dx+16*dy],w=world([]);for(const step of [0,1]){const p=G.tradeVesselPose(w,make(route,step,step?'docked':'ingress'));assert.equal(p.dx,dx);assert.equal(p.dy,dy);assert.equal(p.x,route[step]%16);assert.equal(p.y,Math.floor(route[step]/16));}}
});
test('legacy worlds, malformed cells and nonadjacent edge produce no visible phantom',()=>{assert.equal(G.tradeVesselPose({N:16},make([85])),null);for(const b of [make([999]),make([85],2),make([85,90]),make([85],0,'invalid')])assert.equal(G.tradeVesselPose(world([]),b),null);const c=canvas();G.drawTradeVessels(c.ctx,{N:16});assert.equal(c.calls.length,0);});
test('all phases draw actual geometry, only travelling phases emit a wake',()=>{const lengths=[];for(const phase of ['ingress','docked','egress']){const c=canvas();G.drawTradeVessels(c.ctx,world([make([85,86],0,phase)]));assert(c.calls.some(x=>x[0]==='fill'));assert(c.calls.some(x=>x[0]==='restore'));lengths.push(c.calls.length);}assert(lengths[0]>lengths[1]);assert.equal(lengths[0],lengths[2]);});
test('culling and drawing never advance routes, phases, clock or inventory',()=>{const w=world([make([85,86]),make([250,251])]),before=JSON.stringify(w),seen=[],old=G.drawTradeVessel;G.drawTradeVessel=(_,p)=>seen.push(p);G.drawTradeVessels(canvas().ctx,w,{tx0:0,ty0:0,tx1:8,ty1:8});assert.equal(seen.length,1);assert.equal(seen[0].x,5);G.drawTradeVessel=old;for(let i=0;i<20;i++)G.drawTradeVessels(canvas().ctx,w);assert.equal(JSON.stringify(w),before);});
test('all directions retain a raised curved roof and tapered hull structure',()=>{
 for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
  const c=canvas();G.drawTradeVessel(c.ctx,{x:5,y:5,dx,dy,phase:'docked'});
  const points=c.calls.filter(v=>v[0]==='moveTo'||v[0]==='lineTo').map(v=>v.slice(1));
  for(const [u,v,h] of [[-.36,0,13],[-.36,-.17,8.5],[-.5*.93,-.19*.78,0],[-.5,-.19,5]]){
   const [x,y]=G.T2S(5.5+dx*u-dy*v,5.5+dy*u+dx*v);assert(points.some(p=>Math.abs(p[0]-x)<1e-8&&Math.abs(p[1]-(y-h))<1e-8));
  }
 }
});
test('water layer is before bridges and bank-object sorting; no picking or transaction hooks',()=>{const s=fs.readFileSync(path.join(root,'js/render.js'),'utf8'),frame=s.slice(s.indexOf('G.frame ='));assert(frame.indexOf('G.drawTradeVessels(ctx,w')<frame.indexOf('G.drawBridge(ctx,b)'));assert(frame.indexOf('G.drawBridge(ctx,b)')<frame.indexOf('items.sort'));const code=s.slice(s.indexOf('G.tradeVesselPose='),s.indexOf('G.frame ='));assert(!/arriveMerchant|executeTrade|advanceTradeVoyages|game\.h\s*=/.test(code));});
console.log(`Trade vessel render: ${passed} offline suites passed`);
