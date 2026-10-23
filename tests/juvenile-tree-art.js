'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadGame}=require('./helpers/playability');const root=path.resolve(__dirname,'..'),G=loadGame(root);
const c={G,console,document:{},performance:{now:()=>1000},setTimeout(){},clearTimeout(){},matchMedia:()=>({matches:false})};
for(const n of ['sprites','render'])vm.runInNewContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),c);
G.newGame(17);let checks=0;const originalDraw=G.drawCalibratedArt,originalSpr=G.sprDraw;const calls=[];
G.drawCalibratedArt=(ctx,name,x,y,h)=>{calls.push({name,x,y,h});return [1,1];};
for(const variant of [false,true])for(const season of [1,3])for(const stage of [0,1,2]){
 G.game.season=season;const t={x:10,y:12,b:G.game.day-[0,G.TREE_YOUNG,G.TREE_MATURE][stage]},before=JSON.stringify(G.serializeGame());
 G.drawTree({},t,{variant,scale:1.04});const got=calls.at(-1),family=variant?'willow':'broadleaf';
 assert.equal(got.name,(stage===2?'tree-a-v1-'+family:'tree-a-v2-'+family+'-'+['sapling','young'][stage])+(season===3?'-winter':''));
 const [x,y]=G.T2S(t.x,t.y);assert.equal(got.x,x);assert.equal(got.y,y+16);assert.equal(got.h,G.A_ART[got.name].displayHeight*1.04);
 assert.equal(JSON.stringify(G.serializeGame()),before);checks++;
}
for(const season of [1,3])for(const stage of [0,1,2]){
 G.game.season=season;G.drawCalibratedArt=()=>null;let fallback;G.sprDraw=(ctx,name)=>{fallback=name;return [1,1];};
 G.drawTree({}, {x:2,y:4,b:G.game.day-[0,G.TREE_YOUNG,G.TREE_MATURE][stage]}, {variant:true,scale:1});
 assert.equal(fallback,'tree_'+['sapling','young','mature'][stage]+(season===3?'_snow':''));checks++;
}
G.drawCalibratedArt=originalDraw;G.sprDraw=originalSpr;
for(const [name,spec] of Object.entries(G.A_ART).filter(([n])=>n.startsWith('tree-a-v2'))){
 const bytes=fs.readFileSync(path.join(root,'assets/a-style',name+'.png'));assert.equal(bytes.readUInt32BE(16),384);assert.equal(bytes.readUInt32BE(20),384);
 assert.equal(spec.source[0],384);assert.equal(spec.source[1],384);assert(spec.anchor.every(x=>x>0&&x<384));assert(spec.height>0);
 G.SPR.map.set(name,{width:384,height:384});let a;G.drawCalibratedArt({drawImage(...args){a=args;}},name,60,90,spec.displayHeight);
 const k=spec.displayHeight/spec.height;assert(Math.abs(a[1]+spec.anchor[0]*k-60)<1e-9);assert(Math.abs(a[2]+spec.anchor[1]*k-90)<1e-9);
 G.SPR.map.set(name,{width:1,height:1});assert.equal(G.drawCalibratedArt({},name,60,90,spec.displayHeight),null);checks++;
}
const t={x:11,y:17,b:G.game.day},v=JSON.stringify(G.treeVariation(t));for(const age of [G.TREE_YOUNG,G.TREE_MATURE])assert.equal(JSON.stringify(G.treeVariation({...t,b:t.b-age})),v);
assert.equal(G.A_ART['tree-a-v2-broadleaf-young'].displayHeight,G.A_ART['tree-a-v2-broadleaf-young-winter'].displayHeight);
assert.equal(G.A_ART['tree-a-v2-willow-young'].displayHeight,G.A_ART['tree-a-v2-willow-young-winter'].displayHeight);
console.log('Juvenile tree art: '+checks+' selection/fallback/calibration cases passed; deterministic species and save unchanged');
