'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),queued=[];
const context={console,document:{},addEventListener(){},Image:class{set src(value){this.srcPath=value;queued.push(this);}}};context.window=context;vm.createContext(context);
for(const n of ['core','defs','map','sim','sprites','render'])vm.runInContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),context);
const G=context.G;
for(const [name,dir,size] of [['chicken','props',64],['res_eggs','icons',128]]){const asset=queued.find(x=>x.srcPath===`assets/${dir}/${name}.png`);assert(asset);const bytes=fs.readFileSync(path.join(root,asset.srcPath));assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);assert.equal(bytes[25],6);assert(bytes.length<20000);asset.onload();assert(G.SPR.get(name));}
assert.equal(G.SPR.get('carry_eggs'),G.SPR.get('res_eggs'));
const b={id:1,type:'pasture',state:'ok',x:10,y:10,w:6,h:6,animalType:'chicken',animals:24},parts=[];G.addEconomyFieldParts(parts,b);const hens=parts.filter(p=>p.kind==='chicken');assert.equal(hens.length,24);assert.equal(new Set(hens.map(p=>p.x+','+p.y)).size,24);assert(hens.every(p=>p.x>b.x&&p.x<b.x+b.w&&p.y>b.y&&p.y<b.y+b.h));assert(!parts.some(p=>['sheep','cattle'].includes(p.kind)));
const calls=[];G.sprDraw=(_,name,x,y,options)=>{calls.push({name,x,y,...options});return[16,16];};for(const p of hens)G.drawEconomyFieldPart({},p);assert.equal(calls.length,24);assert(calls.every(c=>c.name==='chicken'&&c.w===16));b.animalType='sheep';b.animals=12;const sheep=[];G.addEconomyFieldParts(sheep,b);assert.equal(sheep.filter(p=>p.kind==='sheep').length,12);
console.log('Chicken render: PNG/manifest, shared cargo icon, 24 distinct in-pen footpoints and 16px scale passed (offline, not browser acceptance).');
