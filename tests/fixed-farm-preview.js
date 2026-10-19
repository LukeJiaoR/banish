'use strict';
// Real frame ghost geometry; offline instrumentation, not a visual screenshot.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),{loadGame}=require('./helpers/playability'),G=loadGame(root);
G.newGame(65);const w=G.world;
for(const k of ['water','rock','road'])w[k].fill(0);
w.treeIdx.fill(-1);w.trees=[];w.citizens=[];w.cmap={};w.families=[];w.buildings=[];w.bmap={};w.bgrid.fill(-1);G.bumpNavigation(w);
vm.runInNewContext(fs.readFileSync(root+'/js/render.js','utf8'),{G,performance,document:{},setTimeout(){},clearTimeout(){}});
G.cv={clientWidth:800,clientHeight:600};G.ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});G.dpr=1;G.cam={z:1.5,x:256,y:-1654};G.needGround=false;G.groundDirty=new Set();G._gcv={width:1,height:1};G.groundScale=1;G._groundWorld=w;G._groundScale=1;G.updateParticles=()=>{};G.ui.refreshPlacement=()=>{};G.game.h=12;G.game.season=1;G.sprDraw=()=>false;G.fillTexDiamond=()=>true;
const check=G.canPlace,calls=[];G.canPlace=(...args)=>{calls.push(args);return check(...args);};
G.setTool('farm');G.hover={tx:43,ty:43};G.frame(0);
const preview=calls.find(a=>a[1]==='farm');assert(preview);assert.equal(preview[2],40);assert.equal(preview[3],40);assert.deepEqual(Array.from(preview[4]),[8,8]);assert.equal(G._ghost.ox,40);assert.equal(G._ghost.oy,40);assert.equal(w.buildings.length,0);
G.tryPlace(43,43);const b=w.buildings[0];assert.equal(b.x,G._ghost.ox);assert.equal(b.y,G._ghost.oy);assert.equal(b.w,8);assert.equal(b.h,8);assert.deepEqual(Array.from(b.farmSize),[8,8]);
G.setTool(null);G.frame(0);assert.equal(G._ghost,null);
console.log('Fixed farm preview: matching 8x8 ghost and placement, read-only preview and cancelled ghost passed.');
