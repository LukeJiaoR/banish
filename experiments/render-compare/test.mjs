import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SOURCE_FILES,immutableCopy,canonical,buildCommands,splitGround,cameraAt,countVisible,visible,stats } from './scene.mjs';
import { CanvasRenderer,affine } from './canvas-renderer.mjs';
import { ProductionReference } from './production-reference.mjs';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url)),here=path.dirname(fileURLToPath(import.meta.url));
let passed=0;function test(name,fn){fn();passed++;console.log('PASS',name);}
function loadGame(document={}) {
  const c={console,performance,setTimeout(){return 1;},clearTimeout(){},addEventListener(){},document,localStorage:{getItem(){throw Error('Unexpected saved-game read');}},matchMedia:()=>({matches:true})};c.window=c;vm.createContext(c);
  for(const name of SOURCE_FILES)vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),c);
  return c.G;
}
const manifest=JSON.parse(fs.readFileSync(path.join(here,'source-manifest.json')));
test('production source and assets stay at the recorded hashes',()=>{
  for(const [name,digest]of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),digest,name);
});
test('immutable snapshot preserves shared identity and rejects array, object and set mutation',()=>{
  const a={value:1},source={array:new Uint8Array([1,2]),a,b:a,set:new Set([3,4])},copy=immutableCopy(source);
  assert.equal(copy.a,copy.b);assert.notEqual(copy.a,source.a);assert.throws(()=>copy.array[0]=8);assert.throws(()=>copy.a.value=8);assert.throws(()=>copy.set.add(5));assert.equal(copy.set.has(3),true);assert.deepEqual(canonical(copy.set),[3,4]);
});
test('camera path is deterministic, pure and common to both renderers',()=>{
  const w=Object.freeze({N:128,start:Object.freeze({x:32,y:64})});
  for(const scenario of ['village','ridge','overview','pan-zoom'])for(const step of [0,.25,.5,.75,1])assert.deepEqual(cameraAt(w,scenario,step),cameraAt(w,scenario,step));
  assert.deepEqual(cameraAt(w,'pan-zoom',0),cameraAt(w,'pan-zoom',1));
  const c=cameraAt(w,'village');assert.equal((32-64)*32*c.z+c.x,480);assert.equal((32+64)*16*c.z+c.y,300);
});
test('identical culling and stats preserve frame order and sample values',()=>{
  const item={kind:'sprite',groupKind:'tree',triangles:2,bounds:{x0:0,x1:10,y0:0,y1:20}},cam={x:0,y:0,z:1};assert.equal(visible(item,cam),true);assert.equal(visible(item,{x:1000,y:0,z:1}),false);assert.equal(countVisible([item],cam).triangles,2);const a=[4,1,3,2];assert.equal(stats(a).median,2);assert.deepEqual(a,[4,1,3,2]);
});
test('textured triangle affine maps all UV endpoints exactly',()=>{
  const points=[[0,0],[24,9],[-3,50]],uv=[[20,90],[80,78],[43,163]],m=affine(points,uv);
  for(let i=0;i<3;i++){const [u,v]=uv[i];assert(Math.abs(u*m[0]+v*m[2]+m[4]-points[i][0])<1e-9);assert(Math.abs(u*m[1]+v*m[3]+m[5]-points[i][1])<1e-9);}
  assert.throws(()=>affine(points,[[0,0],[0,0],[0,0]]));
});
const G=loadGame();
// Read only PNG IHDR dimensions; command-generation tests have no graphics runtime.
for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(f=>f.endsWith('.png'))){const b=fs.readFileSync(path.join(folder,file));G.SPR.map.set(file.slice(0,-4),{width:b.readUInt32BE(16),height:b.readUInt32BE(20)});}}
for(const [seed,size,season]of [[0,128,1],[42,128,3],[0,192,1],[42,192,3]])test(`seed ${seed}, ${size}, season ${season}: commands are complete, immutable and stable`,()=>{
  const p=G.prepareNewGame({preset:'classic',terrain:'mountain',mapSize:size,seed});p.game.paused=true;p.game.season=season;p.game.h=10;G.world=immutableCopy(p.world);G.game=immutableCopy(p.game);
  const before=JSON.stringify(canonical({world:G.world,game:G.game})),a=buildCommands(G),b=buildCommands(G);assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(before,JSON.stringify(canonical({world:G.world,game:G.game})));
  assert.equal(a.counts.mountain,G.world.mountain.reduce((n,x)=>n+x,0));assert.equal(a.counts.tree,G.world.treeIdx.filter(x=>x>=0).length);assert.equal(a.counts.citizen,G.world.citizens.length);assert.equal(a.counts.deer,G.world.deer.filter(x=>x.returnDay===null).length);assert.equal(a.counts.building,1);assert(a.items.length>5000);
  for(const item of a.items){assert(Object.isFrozen(item));assert(Object.values(item.bounds).every(Number.isFinite));if(item.kind==='polygon'){assert.equal(item.triangles,item.points.length-2);assert(item.points.length>=3);if(item.asset)assert.equal(item.uv.length,item.points.length);}else assert(item.width>0&&item.height>0);}
  for(let i=1;i<a.items.length;i++)assert(a.items[i].depth>=a.items[i-1].depth);
  const missing=G.SPR.map.get('tree_mature');G.SPR.map.delete('tree_mature');if(season===1)assert.throws(()=>buildCommands(G),/Required scene asset missing/);G.SPR.map.set('tree_mature',missing);
});
test('ground chunks cover cache once, use gutters, and have no oversize backing',()=>{
  const G={_gcv:{width:4136,height:2088},groundScale:.5,groundOX:4136,groundOY:40};
  const create=()=>({width:0,height:0,getContext(){return {drawImage(){}};}}),g=splitGround(G,create);assert.equal(g.items.length,45);
  assert.equal(g.items.reduce((n,i)=>n+i.crop[2]*i.crop[3],0),G._gcv.width*G._gcv.height);
  for(const i of g.items){assert(i.crop[2]<=512&&i.crop[3]<=512);assert.equal(g.assets.get(i.asset).width,i.crop[2]+4);assert.equal(i.width,i.crop[2]/.5);}
});
console.log(`${passed} unit groups passed. Browser/WebGL/benchmark not covered by these tests.`);
