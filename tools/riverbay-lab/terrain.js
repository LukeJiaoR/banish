'use strict';
/* Candidate-only renderer. Loaded by riverbay-lab.html, never by index.html.
 * The low-frequency field is a code colour study, NOT newly painted grass art. */
(function (root) {
  const defaults = Object.freeze({waterV2:false, shore:false, lowFrequency:false, clutter:false});
  const key = p => p[0]+','+p[1];
  function boundaryPaths(w, includeMapBoundary) {
    const edges=[], outgoing=new Map(), incoming=new Map(), N=w.N;
    const water=(x,y)=>x>=0&&y>=0&&x<N&&y<N&&w.water[y*N+x]===1;
    function edge(a,b,dir) {const e={a,b,dir,used:false};edges.push(e);const k=key(a);if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(e);incoming.set(key(b),(incoming.get(key(b))||0)+1);}
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(water(x,y)){
      if((includeMapBoundary||y>0)&&!water(x,y-1))edge([x,y],[x+1,y],0);
      if((includeMapBoundary||x<N-1)&&!water(x+1,y))edge([x+1,y],[x+1,y+1],1);
      if((includeMapBoundary||y<N-1)&&!water(x,y+1))edge([x+1,y+1],[x,y+1],2);
      if((includeMapBoundary||x>0)&&!water(x-1,y))edge([x,y+1],[x,y],3);
    }
    const paths=[];
    // Open coasts first. At a diagonal point-contact, turn right to keep the
    // same water component on our right rather than bridging separate ponds.
    const starts=[...edges.filter(e=>!incoming.get(key(e.a))),...edges];
    for(const start of starts){if(start.used)continue;const points=[start.a];let e=start;
      while(e&&!e.used){e.used=true;points.push(e.b);if(key(e.b)===key(points[0]))break;
        const choices=(outgoing.get(key(e.b))||[]).filter(n=>!n.used);
        choices.sort((a,b)=>[1,0,3,2].indexOf((a.dir-e.dir+4)%4)-[1,0,3,2].indexOf((b.dir-e.dir+4)%4));e=choices[0];}
      const closed=key(points[0])===key(points[points.length-1]);if(closed)points.pop();
      paths.push({points,closed,bounds:{x0:Math.min(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),x1:Math.max(...points.map(p=>p[0])),y1:Math.max(...points.map(p=>p[1]))}});
    }
    return paths;
  }
  const coastlines=w=>boundaryPaths(w,false);
  const waterPolygons=w=>boundaryPaths(w,true);
  function smoothRoute(route,N){
    let points=route.points.map(p=>p.slice());
    // Keep map exits exact. Shared shore/mask vertices use identical smoothing;
    // no collision or water array is changed by this presentation geometry.
    // One bounded pass plus the quadratic joins keeps cell centers and narrow
    // channels on their original side. Repeated smoothing erodes small ponds.
    for(let pass=0;pass<1;pass++)points=points.map((p,i)=>{
      if(p[0]===0||p[1]===0||p[0]===N||p[1]===N||!route.closed&&(i===0||i===points.length-1))return p;
      const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];
      return [(a[0]+2*p[0]+b[0])/4,(a[1]+2*p[1]+b[1])/4];
    });
    return {...route,points};
  }
  function install(G, assets={}) {
    if(G._riverbayTerrain)throw new Error('Riverbay renderer already installed');
    let options={...defaults}, topologyWorld=null, paths=[], shorePaths=[], polygons=[], material=null, materialSeed=null;
    const originalTile=G.drawGroundTile, originalBuild=G.buildGround;
    const patterns=new WeakMap();
    const metrics={fullBuilds:0,partialBuilds:0,tileDraws:0,lastTileDraws:0,lastBuildMs:0,topologyBuilds:0,materialBuilds:0};
    function topology(){if(topologyWorld!==G.world){paths=coastlines(G.world);shorePaths=paths.map(p=>smoothRoute(p,G.world.N));polygons=waterPolygons(G.world).map(p=>smoothRoute(p,G.world.N));topologyWorld=G.world;metrics.topologyBuilds++;}return paths;}
    function noiseField(seed,period){
      // Hash only the 4x4 / 8x8 lattice, rather than eight hashes per pixel.
      const grid=Array.from({length:period*period},(_,i)=>G.h2(seed,i%period,Math.floor(i/period)));
      const h=(a,b)=>grid[((b%period)+period)%period*period+((a%period)+period)%period];
      return (x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),a=h(ix,iy),b=h(ix+1,iy),c=h(ix,iy+1),d=h(ix+1,iy+1),top=a+(b-a)*sx,bottom=c+(d-c)*sx;return top+(bottom-top)*sy;};
    }
    function materialCanvas(){const seed=G.world.seed;if(material&&materialSeed===seed)return material;
      material=document.createElement('canvas');material.width=material.height=256;materialSeed=seed;
      const c=material.getContext('2d'),im=c.createImageData(256,256),broadNoise=noiseField(seed+13,4),patchNoise=noiseField(seed+71,8);
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){const broad=broadNoise(x/64,y/64)-.5,patch=patchNoise(x/32,y/32)-.5;
        const v=broad*24+patch*10,i=(y*256+x)*4;im.data[i]=100+v;im.data[i+1]=121+v*.9;im.data[i+2]=53+v*.65;im.data[i+3]=255;}
      c.putImageData(im,0,0);metrics.materialBuilds++;return material;
    }
    function fillLow(c,bounds){const im=materialCanvas();let p=patterns.get(c);if(!p||p.im!==im){p={im,pattern:c.createPattern(im,'repeat')};patterns.set(c,p);}
      // A single translucent overlay preserves at least 74% of original meadow
      // detail. Do not repeat this high-scale pattern once per ground tile.
      c.save();c.globalAlpha=.26;c.transform(8,4,-8,4,0,0);c.fillStyle=p.pattern;c.fillRect(bounds.x0*4-.1,bounds.y0*4-.1,(bounds.x1-bounds.x0+1)*4+.2,(bounds.y1-bounds.y0+1)*4+.2);c.restore();}
    function worldOutline(c){const N=G.world.N;for(const [i,p]of [[0,[0,0]],[1,[N,0]],[2,[N,N]],[3,[0,N]]]){const q=G.T2S(...p);if(i)c.lineTo(...q);else c.moveTo(...q);}c.closePath();}
    function appendDiamond(c,x,y){const [sx,sy]=G.T2S(x,y);c.moveTo(sx,sy);c.lineTo(sx+32,sy+16);c.lineTo(sx,sy+32);c.lineTo(sx-32,sy+16);c.closePath();}
    function grassOverlay(c,bounds){if(!options.lowFrequency||G.game.season!==1)return;const w=G.world;
      c.save();c.beginPath();for(let y=bounds.y0;y<=bounds.y1;y++)for(let x=bounds.x0;x<=bounds.x1;x++){const i=y*w.N+x;if(!w.water[i]&&!w.road[i]&&!w.rock[i])appendDiamond(c,x,y);}c.clip();fillLow(c,bounds);c.restore();}
    function clutter(c,w,x,y){const i=y*w.N+x;if(w.water[i]||w.road[i]||w.rock[i]||w.bgrid[i]>=0||w.treeIdx[i]>=0)return;
      // Keep decorative marks away from useful objects/roads and shore edges.
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w.N||yy>=w.N)continue;const j=yy*w.N+xx;if(w.water[j]||w.road[j]||w.bgrid[j]>=0||w.rock[j])return;}
      const h=G.h2(w.seed+503,x,y);if(h>.075)return;const [sx,sy]=G.T2S(x+.35+G.h2(w.seed+504,x,y)*.3,y+.35+G.h2(w.seed+505,x,y)*.3);
      c.save();c.globalAlpha=.29;c.fillStyle='#686744';c.beginPath();c.ellipse(sx,sy,3.1,1.2,-.25,0,Math.PI*2);c.fill();
      c.strokeStyle='#77764f';c.lineWidth=.8;c.beginPath();c.moveTo(sx-3,sy+.5);c.lineTo(sx+2,sy-1);c.moveTo(sx+.2,sy-.3);c.lineTo(sx+1,sy-1.8);c.stroke();c.restore();}
    G.drawGroundTile=function(c,w,pal,x,y){metrics.tileDraws++;const i=y*w.N+x;
      const map=G.SPR.map,old=map.get('water_open');
      if(options.waterV2&&assets.waterImage)map.set('water_open',assets.waterImage);
      try{originalTile(c,w,options.shore&&G.game.season!==3?{...pal,shore:'rgba(0,0,0,0)'}:pal,x,y);}finally{if(options.waterV2&&assets.waterImage){if(old)map.set('water_open',old);else map.delete('water_open');}}
    };
    function curve(c,route){const p=route.points.map(v=>G.T2S(v[0],v[1])),n=p.length;if(n<2)return;
      const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
      function corner(i,q){const v=route.points[i],N=G.world.N;if(v[0]===0||v[1]===0||v[0]===N||v[1]===N){c.lineTo(...p[i]);c.lineTo(...q);}else c.quadraticCurveTo(...p[i],...q);}
      if(route.closed){const s=mid(p[n-1],p[0]);c.moveTo(...s);for(let i=0;i<n;i++)corner(i,mid(p[i],p[(i+1)%n]));c.closePath();}
      else{c.moveTo(...p[0]);c.lineTo(...mid(p[0],p[1]));for(let i=1;i<n-1;i++)corner(i,mid(p[i],p[i+1]));c.lineTo(...p[n-1]);}}
    function continuousMask(c,water){topology();c.beginPath();if(!water)worldOutline(c);for(const p of polygons)curve(c,p);c.clip('evenodd');}
    function protectObjects(c,bounds){const w=G.world;c.beginPath();worldOutline(c);for(let y=bounds.y0;y<=bounds.y1;y++)for(let x=bounds.x0;x<=bounds.x1;x++){const i=y*w.N+x;if(w.road[i]||w.rock[i])appendDiamond(c,x,y);}c.clip('evenodd');}
    function ribbonMask(c,routes){
      // Union of overlapping segment polygons and round joins. This bounds the
      // coast restoration without reverting to per-tile shoreline clipping.
      const radius=68;c.beginPath();for(const route of routes){const p=route.points.map(v=>G.T2S(...v)),n=p.length;
        for(let i=0;i<(route.closed?n:n-1);i++){const a=p[i],b=p[(i+1)%n],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;const nx=-dy/len*radius,ny=dx/len*radius;c.moveTo(a[0]+nx,a[1]+ny);c.lineTo(a[0]-nx,a[1]-ny);c.lineTo(b[0]-nx,b[1]-ny);c.lineTo(b[0]+nx,b[1]+ny);c.closePath();}
        for(const [x,y]of p){c.moveTo(x+radius,y);c.arc(x,y,radius,0,Math.PI*2);c.closePath();}
      }c.clip();
    }
    function surface(c,name,bounds,fallback,image){const im=image||G.SPR.get(name);
      if(!im){c.fillStyle=fallback;c.fillRect(-G.groundOX,-G.groundOY,G.world.N*64+80,G.world.N*32+80);return;}
      let entries=G.terrainPatterns.get(c);if(!entries){entries=new Map();G.terrainPatterns.set(c,entries);}let p=entries.get(name);if(!p||p.image!==im){p={image:im,pattern:c.createPattern(im,'repeat')};entries.set(name,p);}
      c.save();c.transform(.5,.25,-.5,.25,0,0);c.fillStyle=p.pattern;c.fillRect(bounds.x0*64-1,bounds.y0*64-1,(bounds.x1-bounds.x0+1)*64+2,(bounds.y1-bounds.y0+1)*64+2);c.restore();
    }
    function shore(c,bounds){if(!options.shore||G.game.season===3)return;topology();const routes=shorePaths.filter(p=>p.bounds.x1>=bounds.x0-3&&p.bounds.y1>=bounds.y0-3&&p.bounds.x0<=bounds.x1+4&&p.bounds.y0<=bounds.y1+4);if(!routes.length)return;
      function stroke(color,width,dash){c.beginPath();for(const p of routes)curve(c,p);c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.setLineDash(dash||[]);c.stroke();}
      const pal=G.PAL[G.game.season];c.save();protectObjects(c,bounds);ribbonMask(c,routes);
      c.save();continuousMask(c,false);surface(c,'meadow_'+G.TEX_SEASON[G.game.season],bounds,pal.grass);if(options.lowFrequency&&G.game.season===1)fillLow(c,bounds);stroke('rgba(151,140,100,.65)',25);stroke('rgba(169,155,110,.35)',10);c.restore();
      c.save();continuousMask(c,true);surface(c,options.waterV2?'_riverbay_water_v2':'water_open',bounds,pal.water,options.waterV2?assets.waterImage:null);stroke('rgba(108,156,153,.52)',24);stroke('rgba(148,176,158,.28)',10);c.restore();
      stroke('rgba(211,211,174,.37)',.85,[3,19,1.4,29]);c.restore();
    }
    function overlays(c,bounds){grassOverlay(c,bounds);shore(c,bounds);if(options.clutter&&G.game.season===1)for(let y=bounds.y0;y<=bounds.y1;y++)for(let x=bounds.x0;x<=bounds.x1;x++)clutter(c,G.world,x,y);}
    function partialRect(){const w=G.world,s=G.groundScale;let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for(const idx of G.groundDirty){const [x,y]=G.T2S(idx%w.N,Math.floor(idx/w.N));x0=Math.min(x0,x-80);x1=Math.max(x1,x+80);y0=Math.min(y0,y-48);y1=Math.max(y1,y+80);}
      return {x0:Math.max(0,Math.floor((x0+G.groundOX)*s)),y0:Math.max(0,Math.floor((y0+G.groundOY)*s)),x1:Math.min(G._gcv.width,Math.ceil((x1+G.groundOX)*s)),y1:Math.min(G._gcv.height,Math.ceil((y1+G.groundOY)*s))};}
    function rectTiles(r){const s=G.groundScale,N=G.world.N;const corners=[[r.x0,r.y0],[r.x1,r.y0],[r.x0,r.y1],[r.x1,r.y1]].map(([x,y])=>{x=x/s-G.groundOX;y=y/s-G.groundOY;return [x/64+y/32,y/32-x/64];});return {x0:Math.max(0,Math.floor(Math.min(...corners.map(p=>p[0])))-2),y0:Math.max(0,Math.floor(Math.min(...corners.map(p=>p[1])))-2),x1:Math.min(N-1,Math.ceil(Math.max(...corners.map(p=>p[0])))+2),y1:Math.min(N-1,Math.ceil(Math.max(...corners.map(p=>p[1])))+2)};}
    G.buildGround=function(){const start=performance.now(),before=metrics.tileDraws,w=G.world,size=G.groundCacheSize(G.groundScale);
      const partial=!G.needGround&&G._gcv&&G._gcv.width===size.width&&G._gcv.height===size.height&&G._groundWorld===w&&G._groundScale===size.scale&&G.groundDirty.size>0;
      if(partial&&Object.values(options).some(Boolean)){
        const c=G._gcv.getContext('2d'),r=partialRect(),b=rectTiles(r),s=G.groundScale,pal=G.PAL[G.game.season];
        c.save();c.setTransform(1,0,0,1,0,0);c.beginPath();c.rect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0);c.clip();c.clearRect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0);c.fillStyle=pal.bg;c.fillRect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0);c.setTransform(s,0,0,s,G.groundOX*s,G.groundOY*s);
        for(const water of [false,true])for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)if((w.water[y*w.N+x]===1)===water)G.drawGroundTile(c,w,pal,x,y);
        overlays(c,b);c.restore();G.groundDirty.clear();metrics.partialBuilds++;
      }else{originalBuild();const c=G._gcv.getContext('2d');overlays(c,{x0:0,y0:0,x1:w.N-1,y1:w.N-1});if(partial)metrics.partialBuilds++;else metrics.fullBuilds++;}
      metrics.lastTileDraws=metrics.tileDraws-before;metrics.lastBuildMs=performance.now()-start;
    };
    const api={metrics,getOptions:()=>({...options}),setOptions(next){for(const k of Object.keys(next))if(!(k in defaults)||typeof next[k]!=='boolean')throw new Error('Invalid riverbay option: '+k);const changed=Object.keys(next).some(k=>options[k]!==next[k]);options={...options,...next};if(changed)G.needGround=true;return {...options};},invalidateTopology(){topologyWorld=null;G.needGround=true;},getCoastlines:()=>topology().map(p=>({points:p.points.map(v=>v.slice()),closed:p.closed,bounds:{...p.bounds}}))};
    G._riverbayTerrain=api;return api;
  }
  const api={install,coastlines,waterPolygons,defaults};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.RiverbayTerrain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
