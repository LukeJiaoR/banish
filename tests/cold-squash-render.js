'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict'),{loadGame}=require('./helpers/playability');
const root=path.resolve(__dirname,'..'),G=loadGame(root);G.newGame(1);
vm.runInNewContext(fs.readFileSync(root+'/js/render.js','utf8'),{G,console});
vm.runInNewContext(fs.readFileSync(root+'/js/sprites.js','utf8'),{G,console});
const keys=[],ctx={};G.sprDraw=(ctx,key,x,y)=>{keys.push({key,x,y});return true;};
const b={cropType:'squash',growth:0,farm:[{x:0,y:0,sown:true,harvested:false}]};
G.game.day=36;G.game.season=3;
for(const growth of [.1,.4,.75,1]){b.growth=growth;const before=JSON.stringify(b);G.drawFarmCrop(ctx,b,b.farm[0]);assert.equal(JSON.stringify(b),before);}
assert.equal(keys.map(x=>x.key).join(','),'squash_stage0,squash_stage1,squash_stage2,squash_ripe');
for(const {key,x,y} of keys){assert.equal(G.SPRITE_SIZES[key].w,64);assert.equal(x,0);assert.equal(y,26);const png=fs.readFileSync(root+'/assets/props/'+key+'.png');assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),128);assert.equal(png.readUInt32BE(20),96);assert.equal(png[25],6);}
b.farm[0].harvested=true;G.drawFarmCrop(ctx,b,b.farm[0]);assert.equal(keys.length,4);
b.farm[0].harvested=false;b.farm[0].sown=false;G.game.day=38;G.drawFarmCrop(ctx,b,b.farm[0]);assert.equal(keys.length,4);
b.farm[0].sown=true;G.game.season=2;
for(const [crop,key] of [['wheat','crop_ripe'],['cabbage','cabbage_ripe'],['beans','bean_ripe']]){b.cropType=crop;G.drawFarmCrop(ctx,b,b.farm[0]);assert.equal(keys.at(-1).key,key);}
console.log('Cold squash render: 4 stages,128×96 RGBA at64px,live winter draw,cutoff/harvest hide,old crops,read-only passed');
