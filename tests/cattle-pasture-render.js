/* Render-state routing only; pixel evidence is generated separately with real Canvas. */
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const ctx={console,document:{},addEventListener(){}};ctx.window=ctx;vm.createContext(ctx);
for(const name of ['core','defs','map','sim','sprites','render'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',name+'.js'),'utf8'),ctx);
const G=ctx.G;G.game=G.newGameState();
for(const [type,count,width]of [['sheep',12,24],['cattle',10,32]]){
  const b={type:'pasture',animalType:type,animals:count,x:0,y:0,w:6,h:6,state:'ok'},parts=[];
  G.addEconomyFieldParts(parts,b);const animals=parts.filter(p=>['sheep','cattle'].includes(p.kind));
  assert.equal(animals.length,count);assert(animals.every(p=>p.kind===type));
  const calls=[];G.sprDraw=(...args)=>calls.push(args);for(const p of animals)G.drawEconomyFieldPart({},p);
  assert.equal(calls.length,count);assert(calls.every(args=>args[1]===type&&args[4].w===width));
  b.animals=0;const empty=[];G.addEconomyFieldParts(empty,b);assert(!empty.some(p=>['sheep','cattle'].includes(p.kind)));
}
const legacy=[];G.addEconomyFieldParts(legacy,{type:'pasture',animals:3,x:0,y:0,w:6,h:6,state:'ok'});assert.equal(legacy.filter(p=>p.kind==='sheep').length,3);
console.log('Pasture render: species counts, sprite width, empty pens and legacy sheep passed.');
