'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadGame}=require('./helpers/playability'),root=path.resolve(__dirname,'..'),G=loadGame(root);
const env={G,console,document:{},performance:{now:()=>1000},setTimeout(){},clearTimeout(){},matchMedia:()=>({matches:false})};
for(const n of ['sprites','render'])vm.runInNewContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),env);
G.newGame(17);const b=G.world.buildings.find(b=>b.type==='storage');assert(b);assert.equal(b.w,3);assert.equal(b.h,3);
const name='storage-a-v2',spec=G.A_ART[name],bytes=fs.readFileSync(path.join(root,'assets/a-style',name+'.png'));assert.equal(bytes.readUInt32BE(16),768);assert.equal(bytes.readUInt32BE(20),768);
const art={width:768,height:768},legacy={width:298,height:251},site={width:200,height:150};G.SPR.map.set(name,art);G.SPR.map.set('storage',legacy);G.SPR.map.set('site_3x3',site);
let calls=[];const ctx=new Proxy({globalAlpha:1,drawImage(...args){calls.push({args,alpha:this.globalAlpha});},save(){this.savedAlpha=this.globalAlpha},restore(){this.globalAlpha=this.savedAlpha}},{get(t,k){return k in t?t[k]:()=>{};}});
const before=JSON.stringify(G.serializeGame());
for(const season of [1,3]){
 G.game.season=season;calls=[];G.drawBuilding(ctx,b,0);assert.equal(calls.length,1);const completed=calls[0];assert.equal(completed.args[0],art);
 calls=[];G.drawPendingBuildingPreview(ctx,{type:'storage',ox:b.x,oy:b.y});assert.equal(calls.length,1);assert.deepEqual(calls[0].args,completed.args);assert.equal(calls[0].alpha,.65);assert.equal(ctx.globalAlpha,1);
 const a=completed.args,k=((b.w+b.h)*32*G.BUILD_SPR_W.storage)/spec.span,[x,y]=G.T2S(b.x+b.w,b.y+b.h);assert(Math.abs(a[1]+spec.anchor[0]*k-x)<1e-9);assert(Math.abs(a[2]+spec.anchor[1]*k-y)<1e-9);assert.equal(a[3]/a[4],1,'uniform scale');
}
for(const missing of [null,{width:1,height:1}]){if(missing)G.SPR.map.set(name,missing);else G.SPR.map.delete(name);for(const mode of ['completed','preview']){calls=[];if(mode==='completed')G.drawBuilding(ctx,b,0);else G.drawPendingBuildingPreview(ctx,{type:'storage',ox:b.x,oy:b.y});assert.equal(calls[0].args[0],legacy);}}
G.SPR.map.set(name,art);calls=[];G.drawBuilding(ctx,{...b,state:'site',progress:.5},0);assert.equal(calls[0].args[0],site,'construction art unchanged');
// Draw calls above must not affect gameplay; compare with only the explicitly varied season normalized.
const after=JSON.parse(JSON.stringify(G.serializeGame())),old=JSON.parse(before);function normalize(v){if(v&&typeof v==='object')for(const k of Object.keys(v))if(k==='season')v[k]=0;else normalize(v[k]);}normalize(old);normalize(after);assert.deepEqual(after,old);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'assets/buildings/storage.png'))).digest('hex'),'a2a6ecd2dbe7930ab4100aba9d54faf07b9fef8a63c8be18be5a2608db924f07','legacy fallback preserved');
console.log('Warehouse art passed: 3x3, shared completed/preview transform, footpoint, uniform scale, two seasons, missing/malformed fallback, site art, save invariance, legacy hash.');
