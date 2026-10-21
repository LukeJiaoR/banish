// Independent ray-cast oracle, authored during candidate review.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=require('node:path').resolve(__dirname,'..'),c={console,document:{},addEventListener(){},setTimeout(){},clearTimeout(){}};c.window=c;vm.createContext(c);for(const f of ['core','defs','map','sim','sprites'])vm.runInContext(fs.readFileSync(root+'/js/'+f+'.js','utf8'),c);vm.runInContext(fs.readFileSync(root+'/js/render.js','utf8'),c);const G=c.G,N=16,w=G.world={N,mountain:new Uint8Array(N*N),water:new Uint8Array(N*N),bgrid:new Int32Array(N*N).fill(-1),bmap:{}};G.cam={x:0,y:0,z:1};G.game=G.newGameState();
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0)/2;
const boundary=(px,py,p)=>p.some((a,i)=>{const b=p[(i+1)%p.length],cross=(b[0]-a[0])*(py-a[1])-(b[1]-a[1])*(px-a[0]);return Math.abs(cross)<1e-7&&px>=Math.min(a[0],b[0])-1e-7&&px<=Math.max(a[0],b[0])+1e-7&&py>=Math.min(a[1],b[1])-1e-7&&py<=Math.max(a[1],b[1])+1e-7;});
const inside=(px,py,p)=>{let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if(((a[1]>py)!=(b[1]>py))&&(px<(b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0]))hit=!hit;}return hit;};
let faces=0,picks=0,minGroundArea=Infinity,removed=0;
for(const [ox,oy] of [[0,0],[5,5],[13,13]])for(let mask=1;mask<512;mask++){
 w.mountain.fill(0);G.mountainHeights.delete(w);const cells=[];for(let b=0;b<9;b++)if(mask&(1<<b)){const x=ox+b%3,y=oy+Math.floor(b/3);w.mountain[y*N+x]=1;cells.push({x,y,d:x+y+1});}
 cells.sort((a,b)=>a.d-b.d||a.y-b.y||a.x-b.x);for(const t of cells){t.faces=G.mountainPolygons(w,t.x,t.y);removed+=G.makeMountainPolygons(w,t.x,t.y).length-t.faces.length;
  const verts=G.mountainContourVertices(w),ground=[[t.x,t.y],[t.x+1,t.y],[t.x+1,t.y+1],[t.x,t.y+1]].map(p=>verts.get(p.join(','))||p);minGroundArea=Math.min(minGroundArea,area(ground));assert(inside(t.x+.5,t.y+.5,ground),JSON.stringify({mask,t,ground}));assert(area(ground)>0);
  for(const f of t.faces){faces++;assert(Math.abs(area(f.points))>1e-7);for(let i=0;i<f.points.length;i++){const a=f.points[i],b=f.points[(i+1)%f.points.length],d=f.points[(i+2)%f.points.length];const cross=(b[0]-a[0])*(d[1]-b[1])-(b[1]-a[1])*(d[0]-b[0]);assert(Math.sign(cross)===Math.sign(area(f.points))||Math.abs(cross)<1e-7);}}
 }
 for(const t of cells)for(const f of t.faces){const avg=f.points.reduce((s,p)=>[s[0]+p[0]/f.points.length,s[1]+p[1]/f.points.length],[0,0]);const points=[avg,...f.points.map(p=>[p[0]*.99+avg[0]*.01,p[1]*.99+avg[1]*.01])];for(const p of points){const expected=cells.findLast(c=>c.faces.some(f=>inside(...p,f.points)));if(!expected||cells.some(c=>c.faces.some(f=>boundary(...p,f.points))))continue;const hit=G.screenToMapTile(...p);assert.equal(Math.floor(hit.tx),expected.x,JSON.stringify({mask,p,expected,hit}));assert.equal(Math.floor(hit.ty),expected.y,JSON.stringify({mask,p,expected,hit}));picks++;}}
}
const result={masks:1533,faces,ownershipSamples:picks,removedDegenerateSides:removed,minGroundCellArea:minGroundArea};console.log(result);
