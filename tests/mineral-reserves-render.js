'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),context={console,addEventListener(){},document:{}};context.window=context;vm.createContext(context);
for(const n of ['core','defs','map','sim','sprites','render'])vm.runInContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),context);
const G=context.G,b={type:'mineralpit',x:10,y:10,w:3,h:3,state:'ok'},png=fs.readFileSync(path.join(root,'assets/buildings/mineralpit.png'));
assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),448);assert.equal(png.readUInt32BE(20),320);assert.equal(png[25],6);
assert(fs.readFileSync(path.join(root,'js/sprites.js'),'utf8').includes("'mineralpit'"));
let draw;G.sprDraw=(ctx,key,x,y,opt)=>(draw={key,x,y,opt},[opt.w,160]);G.world={};G.drawBuilding({},b,0);const B=G.T2S(13,13);assert.equal(draw.key,'mineralpit');assert.equal(draw.x,B[0]);assert.equal(draw.y,B[1]+2);assert.equal(draw.opt.w,224);assert.equal(b._chimney,undefined);
const fills=[],ctx={beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){fills.push(this.fillStyle)}};G.sprDraw=()=>null;G.drawBuilding(ctx,b,0);assert.equal(fills.length,4);assert.equal(b._chimney,undefined);console.log('Mineral pit render: RGBA 448x320, actual half-size anchored sprite and hollow fallback passed');
