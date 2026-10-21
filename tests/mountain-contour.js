'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={console};c.window=c;vm.createContext(c);
for(const n of ['core','defs','map','sim','render'])vm.runInContext(fs.readFileSync(__dirname+'/../js/'+n+'.js','utf8'),c);
const G=c.G;let passed=0;function test(name,fn){fn();console.log('PASS '+name);passed++;}
function world(cells){const w=G.emptyWorld(0,0,12);for(const[x,y]of cells)w.mountain[y*w.N+x]=1;return w;}
const masks=[];for(let bits=1;bits<16;bits++){const cells=[];for(let i=0;i<4;i++)if(bits&(1<<i))cells.push([5+i%2,5+(i>>1)]);masks.push(cells);}
masks.push([[4,4],[5,5],[6,6],[7,7]],[[3,3],[3,4],[3,5],[4,5],[5,5]],[[0,0],[1,0],[0,1],[11,11]]);
test('all 2x2 configurations, diagonal chains and map edges preserve tile centers and bounded vertices',()=>{
 for(const cells of masks){const w=world(cells),before=JSON.stringify(w);G.mountainPolygons(w,...cells[0]);const v=G.mountainContourVertices(w);
  for(const[key,p]of v){const q=key.split(',').map(Number);assert(Math.abs(p[0]-q[0])<=.25);assert(Math.abs(p[1]-q[1])<=.25);}
  for(const[x,y]of cells){const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(p=>v.get(p.join(','))||p);
   assert(G.pointInMountainPolygon(x+.5,y+.5,corners));
   for(let yy=0;yy<w.N;yy++)for(let xx=0;xx<w.N;xx++)if(!G.isMountain(w,xx,yy))assert(!G.pointInMountainPolygon(xx+.5,yy+.5,corners));
  }assert.equal(JSON.stringify(w),before);
 }
});
test('point-touching components remain separate and no shared vertex moves into a diagonal gap',()=>{
 const w=world([[5,5],[6,6]]);G.mountainPolygons(w,5,5);assert(!G.mountainContourVertices(w).has('6,6'));
});
test('cached shared facets have nonzero area and reset with world/height invalidation',()=>{
 const w=world([[5,5],[6,5],[5,6]]),a=G.mountainPolygons(w,5,5);assert.equal(G.mountainPolygons(w,5,5),a);
 for(const f of a){const area=f.points.reduce((s,p,i)=>{const q=f.points[(i+1)%f.points.length];return s+p[0]*q[1]-q[0]*p[1];},0);assert(Math.abs(area)>1e-7);}
 G.mountainHeights.delete(w);assert.notEqual(G.mountainPolygons(w,5,5),a);assert.notEqual(G.mountainPolygons(world([[5,5]]),5,5),a);
});
test('visible retained rock toe owns receded blocked corners at desktop and zoom-out scales',()=>{
 G.world=world([[5,5]]);G.game=G.newGameState();const faces=G.mountainPolygons(G.world,5,5),toe=faces.find(f=>f.kind==='toe');assert(toe);
 const [sx,sy]=G.T2S(5,5);for(const z of [.45,.75,1,2]){G.cam={x:170,y:55,z};
  for(const p of [[sx,sy+30],[sx+29,sy+16],[sx-29,sy+16]]){const hit=G.screenToMapTile(p[0]*z+170,p[1]*z+55);assert.equal(Math.floor(hit.tx),5);assert.equal(Math.floor(hit.ty),5);assert(hit.mountain);}
 }
 const check=G.canPlace(G.world,'house',5,5);assert.equal(check.ok,false);assert(G.tileBlocked(G.world,5,5));
});
test('default toe fallback is visible without assets and hover exposes original blocked diamond',()=>{
 G.world=world([[5,5]]);G.game=G.newGameState();G.cam={z:1};G.SPR={get:()=>null};const calls=[];
 const ctx=new Proxy({},{get:(o,k)=>o[k]||((...a)=>calls.push([k,...a])),set:(o,k,v)=>(calls.push(['set',k,v]),o[k]=v,true)});
 G.drawMountain(ctx,G.world,5,5);assert(calls.some(v=>v[0]==='set'&&v[1]==='globalAlpha'&&v[2]===.48));assert(calls.some(v=>v[0]==='fillRect'));
 G.tool={kind:'build',type:'house'};assert(G.drawMountainHover(ctx,G.world,5,5));assert(calls.some(v=>v[0]==='stroke'));
});
console.log(`Mountain contour: ${passed} groups passed`);
