'use strict';
/* Authored 32x32 visual fixture, not a saved/played village or economy test. */
(function(root){
function createScene(G){
 G.world=G.emptyWorld(2685766889,0,32);G.game=G.newGameState();G.game.season=1;G.game.day=12;G.game.h=10;G.game.paused=true;G.game.speed=0;G.rng=G.makeRng(G.world.seed);G.setUid(1);
 const w=G.world;w.start={x:12,y:16};w.deer=[];w.supplyCaches=[];
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const bank=18.4+2.5*Math.sin(y*.24)+1.1*Math.cos(y*.53);
  if(x>bank&&Math.hypot((x-23)*1.1,y-24)>3.5)w.water[y*32+x]=1;
 }
 // A narrow beach is existing sand material; the candidate only changes its edge.
 for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(!w.water[y*32+x]&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>x+dx>=0&&y+dy>=0&&x+dx<32&&y+dy<32&&w.water[(y+dy)*32+x+dx]===1))w.water[y*32+x]=2;
 const plan=[['storage',10,13],['house',5,10],['house',8,8],['house',11,8],['house',5,17],['stonehouse',9,18],['house',13,18],['well',3,13],['blacksmith',13,11],['woodcutter',5,22],['gatherer',3,5],['farm',10,23]];
 const failures=[];
 for(const [type,x,y]of plan){const r=G.addBuilding(type,x,y,{instant:true,free:true,...(type==='farm'?{farmSize:[5,4]}:{})});if(!r.ok){failures.push({type,x,y,reason:r.reason});continue;}if(type==='farm'){for(const f of r.b.farmTiles||[]){f.sown=true;f.growth=.7;}r.b.growth=.7;}}
 for(let x=3;x<=16;x++)if(w.bgrid[16*32+x]<0&&!w.water[16*32+x])G.setRoad(w,x,16,1);
 for(let y=8;y<=25;y++)if(w.bgrid[y*32+7]<0&&!w.water[y*32+7])G.setRoad(w,7,y,1);
 for(let y=1;y<31;y++)for(let x=1;x<31;x++){const i=y*32+x;if(w.water[i]||w.bgrid[i]>=0||w.road[i])continue;
  const nearTown=x>=4&&x<=17&&y>=8&&y<=27;
  if(G.h2(w.seed+89,x,y)<(nearTown?.035:.29))G.addTree(w,x,y,-300);
 }
 for(const [x,y]of [[2,18],[3,19],[3,21],[16,4],[17,5]]){const i=y*32+x;if(!w.water[i]&&w.bgrid[i]<0&&w.treeIdx[i]<0)w.rock[i]=1;}
 // Real route queries determine the demonstration walk. No simulation tick,
 // new inventory, collision change, or claimed work/production is involved.
 const routes=[];
 for(let n=0;n<20;n++){const from={x:3+(n%3),y:16},to={x:15,y:16};const path=G.findPath(w,from.x,from.y,to.x,to.y);if(!path)continue;
  const c=G.spawnCitizen({x:from.x,y:from.y,age:n%7===0?7:24+n%12,sex:n%2?'f':'m'});c.state='walk';c.walkKind='wander';c.animT=n*.47;c.camped=true;
  if(n%4===0)c.carry={type:'wood',qty:1};routes.push({c,points:[from,...path],phase:n/20});
 }
 G.sel=null;G.tool=null;G.hover={tx:-1,ty:-1};G.keys={};G.smoke=[];G.flakes=null;G.groundDirty.clear();G.needGround=true;G._buildingActivityFrame=null;
 return {world:w,failures,routes,kind:'authored visual fixture',size:32,seed:w.seed};
}
function pose(scene,time){for(const r of scene.routes){const p=r.points;if(p.length<2)continue;const u=(time*.45+r.phase*(p.length-1)*2)%((p.length-1)*2),v=u<=p.length-1?u:(p.length-1)*2-u,idx=Math.min(p.length-2,Math.floor(v)),f=v-idx;r.c.x=p[idx].x*(1-f)+p[idx+1].x*f;r.c.y=p[idx].y*(1-f)+p[idx+1].y*f;r.c.path=[p[u<=p.length-1?idx+1:idx]];r.c.animT=time*4+r.phase*5;}}
const api={createScene,pose};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.RiverbayScene=api;
})(typeof globalThis!=='undefined'?globalThis:this);
