'use strict';
(function(root){
 function create(G){
  G.world=G.emptyWorld(230527,0,32);G.game=G.newGameState();G.game.season=1;G.game.day=12;G.game.h=10;G.game.paused=true;G.game.speed=0;G.rng=G.makeRng(230527);G.setUid(1);
  const w=G.world;w.start={x:12,y:14};w.deer=[];w.supplyCaches=[];
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(x>19+1.3*Math.sin(y*.29))w.water[y*32+x]=1;
  for(let y=1;y<31;y++)for(let x=1;x<31;x++)if(!w.water[y*32+x]&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>w.water[(y+dy)*32+x+dx]===1))w.water[y*32+x]=2;
  for(const [type,x,y]of [['house',10,10],['storage',14,13],['house',8,16]]){const r=G.addBuilding(type,x,y,{instant:true,free:true});if(!r.ok)throw Error(type+': '+r.reason);}
  for(let x=7;x<=19;x++)if(w.bgrid[15*32+x]<0&&!w.water[15*32+x])G.setRoad(w,x,15,1);
  for(let y=9;y<=20;y++)if(w.bgrid[y*32+13]<0&&!w.water[y*32+13])G.setRoad(w,13,y,1);
  const clusters=[[8,8],[16,8],[6,16],[16,21],[18,17],[11,22]];
  for(let y=4;y<27;y++)for(let x=4;x<23;x++){const i=y*32+x;if(w.water[i]||w.bgrid[i]>=0||w.road[i])continue;const d=Math.min(...clusters.map(p=>Math.hypot(x-p[0],y-p[1])));if(d<2.7&&G.h2(w.seed,x,y)>(.42+d*.1))G.addTree(w,x,y,-300);}
  for(const [x,y]of [[12,15],[15,15],[13,18]]){const c=G.spawnCitizen({x,y,age:25,sex:'f'});c.state='idle';c.camped=true;}
  G.sel=null;G.tool=null;G.hover={tx:-1,ty:-1};G.keys={};G.smoke=[];G.flakes=null;G.groundDirty.clear();G.needGround=true;
  return {kind:'authored render-only fixture, not a played save',seed:w.seed,buildings:w.buildings.length,trees:w.trees.length};
 }
 function camera(G,width,height,zoom){G.cam.z=zoom;const p=G.T2S(14.4,14.5);G.cam.x=width/2-p[0]*zoom;G.cam.y=height*.57-p[1]*zoom;G.groundScale=1;G.needGround=true;}
 const api={create,camera};if(typeof module!=='undefined')module.exports=api;root.VillageScene=api;
})(globalThis);
