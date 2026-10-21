'use strict';
/* Experiment-only adapter. No runtime files, source artwork, collision or saves change.
 * All ground effects are baked before depth-sorted buildings/trees by G.frame.
 * Shadows are deliberately cheap projected alpha silhouettes, not physical lighting.
 */
(function(root){
 function install(G){
  const options={ground:false,shadows:false,contact:false,shore:false,foliage:false};
  const originalBuild=G.buildGround,originalTree=G.drawTree,originalTile=G.drawGroundTile,cache=new Map();
  let cachePixels=0;
  function silhouette(name){const source=G.SPR.get(name);if(!source)return null;let result=cache.get(name);if(result&&result.source===source)return result.canvas;
   const pixels=source.width*source.height,nextPixels=cachePixels-(result?result.canvas.width*result.canvas.height:0)+pixels;if(nextPixels>1000000)throw Error('Shadow atlas budget exceeded');const c=document.createElement('canvas');c.width=source.width;c.height=source.height;const x=c.getContext('2d');x.drawImage(source,0,0);x.globalCompositeOperation='source-in';x.fillStyle='#28372b';x.fillRect(0,0,c.width,c.height);cachePixels=nextPixels;cache.set(name,{source,canvas:c});return c;
  }
  function ellipse(c,x,y,rx,ry,color){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();}
  function shadow(c,name,x,y,width){const im=silhouette(name);if(!im)return;c.save();c.translate(x,y);c.transform(.82,0,-.52,.18,0,0);c.globalAlpha=.17;c.drawImage(im,-width/2,-width*im.height/im.width,width,width*im.height/im.width);c.restore();}
  function treeSpec(t){const r=G.h2(G.world.seed+71,t.x,t.y),name=options.foliage&&r>.64?(r>.86?'orchard_pear_leafy':'orchard_leafy'):'tree_mature';const im=G.SPR.get(name);const height=options.foliage?36+26*r:38*G.treeVariation(t).scale;return {name,width:height*(im?im.width/im.height:1),height};}
  G.drawGroundTile=function(c,w,pal,x,y){originalTile(c,w,pal,x,y);if(options.ground&&w.road[y*w.N+x]===1&&!w.water[y*w.N+x])G.fillTerrainSurface(c,'meadow_'+G.TEX_SEASON[G.game.season],x,y);};
  function ground(c,w){
   const sand=c.createPattern(G.SPR.get('sand_summer'),'repeat'),grass=c.createPattern(G.SPR.get('meadow_summer'),'repeat');
   // Original dirt texture on irregular narrow ribbons; original meadow breaks edges.
   for(let y=1;y<w.N-1;y++)for(let x=1;x<w.N-1;x++){const i=y*w.N+x;if(w.road[i]!==1||w.water[i])continue;const p=G.T2S(x+.5,y+.5);
    for(const [dx,dy]of [[1,0],[0,1]]){if(w.road[(y+dy)*w.N+x+dx]!==1||w.water[(y+dy)*w.N+x+dx])continue;const q=G.T2S(x+.5+dx,y+.5+dy),vx=q[0]-p[0],vy=q[1]-p[1],length=Math.hypot(vx,vy),nx=-vy/length,ny=vx/length,edges=[[],[]];
     for(let j=0;j<=12;j++){const t=j/12,px=p[0]+vx*t,py=p[1]+vy*t;for(let side=0;side<2;side++){const noise=G.h2(w.seed+side+32,Math.round(px),Math.round(py)),width=6+noise*3;edges[side].push([px+nx*width*(side?1:-1),py+ny*width*(side?1:-1)]);}}
     c.beginPath();[...edges[0],...edges[1].reverse()].forEach((v,j)=>j?c.lineTo(...v):c.moveTo(...v));c.closePath();c.fillStyle=sand;c.fill();c.fillStyle='rgba(112,94,62,.22)';c.fill();
     c.fillStyle=grass;for(let j=1;j<12;j++){const t=j/12,px=p[0]+vx*t,py=p[1]+vy*t;for(const side of [-1,1]){const v=G.h2(w.seed+9,Math.round(px),Math.round(py+side));if(v<.3)continue;c.beginPath();c.ellipse(px+nx*(7+v)*side,py+ny*(7+v)*side,1+v*2.7,.6+v*1.2,0,0,Math.PI*2);c.fill();}}
    }
   }
  }
  function shore(c,w){const topology=G.coastPresentation.topology(w);c.save();c.beginPath();for(const r of topology.water)G.coastPresentation.curve(c,r,w.N);c.clip('evenodd');
   for(const r of topology.shore){const s=G.coastPresentation.bankSamples(r,w.N);for(let i=5;i<s.length-5;i+=15){const x=s[i],y=s[i+1],v=G.h2(w.seed+3,Math.round(x),Math.round(y));ellipse(c,x,y,7+v*12,2+v*3,'rgba(166,184,144,.16)');}}
   c.restore();
   // Separated irregular rock patches, with long open bank stretches.
   for(const r of topology.shore){const s=G.coastPresentation.bankSamples(r,w.N);for(let i=10;i<s.length-5;i+=15){const x=s[i],y=s[i+1],v=G.h2(w.seed+19,Math.round(x),Math.round(y));if(Math.cos((x+50)*.045)<.72||v<.42)continue;
    for(let k=0;k<(v>.75?3:1);k++){const u=G.h2(w.seed+41+k,Math.round(x),Math.round(y)),px=x+(u-.5)*19,py=y+(G.h2(w.seed+k,x|0,y|0)-.5)*11;G.sprDraw(c,u>.5?'rock_a':'rock_b',px,py+2,{w:5+u*11});}
   }}
  }
  G.buildGround=function(){G.needGround=true;originalBuild();const c=G._gcv.getContext('2d'),s=G.groundScale,w=G.world;c.save();c.setTransform(s,0,0,s,G.groundOX*s,G.groundOY*s);
   if(options.ground)ground(c,w);if(options.shore)shore(c,w);
   if(options.shadows){for(const b of w.buildings){const p=G.T2S(b.x+b.w,b.y+b.h);shadow(c,b.type,p[0],p[1],(b.w+b.h)*32*(G.BUILD_SPR_W[b.type]||1.08));}for(const t of w.trees){const p=G.T2S(t.x,t.y),spec=treeSpec(t);shadow(c,spec.name,p[0],p[1]+16,spec.width);}}
   if(options.contact){for(const b of w.buildings){const p=G.T2S(b.x+b.w/2,b.y+b.h/2);ellipse(c,p[0],p[1]+12,(b.w+b.h)*13,13,'rgba(39,49,30,.14)');}for(const t of w.trees){const p=G.T2S(t.x,t.y);ellipse(c,p[0],p[1]+15,9,3.4,'rgba(35,47,28,.2)');}}
   c.restore();
  };
  G.drawTree=function(c,t,v){if(!options.foliage)return originalTree(c,t,v);const p=G.T2S(t.x,t.y),spec=treeSpec(t);G.sprDraw(c,spec.name,p[0],p[1]+16,{w:spec.width});};
  return {options,set(next){Object.assign(options,{ground:false,shadows:false,contact:false,shore:false,foliage:false},next);G.needGround=true;G.groundDirty.clear();},stats(){return {shadowCachePixels:cachePixels,shadowCacheBytes:cachePixels*4,maxShadowPixels:1000000};},treeSpec};
 }
 const api={install};if(typeof module!=='undefined')module.exports=api;root.VillageEffects=api;
})(globalThis);
