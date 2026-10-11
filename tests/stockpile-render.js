'use strict';const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const ctx={console,document:{},addEventListener(){}};ctx.window=ctx;vm.createContext(ctx);for(const n of ['core','defs','map','sim','sprites','render'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',n+'.js'),'utf8'),ctx);const G=ctx.G;
const png=fs.readFileSync(path.join(__dirname,'../assets/buildings/stockpile.png'));assert.equal(png.readUInt32BE(16),320);assert.equal(png.readUInt32BE(20),224);assert.equal(png[25],6);
const calls=[];G.sprDraw=(...args)=>{calls.push(args);return [160,112];};const b={type:'stockpile',state:'ok',x:2,y:3,w:2,h:2,progress:.4};G.drawBuilding({},b,0);assert.equal(calls[0][1],'stockpile');assert.equal(calls[0][4].w,160);const foot=G.T2S(4,5);assert.equal(calls[0][2],foot[0]);assert.equal(calls[0][3],foot[1]);b.state='site';G.drawBuilding({fillRect(){}},b,0);assert.equal(calls[1][1],'site_2x2');
b.state='ok';G.sprDraw=()=>null;G.drawBuilding({beginPath(){},moveTo(){},lineTo(){},stroke(){}},b,0);
console.log('Stockpile render: RGBA 320x224 at 50%, logical bottom corner, existing site and low-rack fallback passed.');
