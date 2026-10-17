'use strict';
/* Candidate-only renderer. Loaded by riverbay-lab.html, never by index.html.
 * The low-frequency field is a code colour study, NOT newly painted grass art. */
(function (root) {
  const defaults = Object.freeze({waterV2:false, shore:false, lowFrequency:false, clutter:false});
  const key = p => p[0]+','+p[1];
  function coastlines(w) {
    const edges=[], outgoing=new Map(), incoming=new Map(), N=w.N;
    const water=(x,y)=>x>=0&&y>=0&&x<N&&y<N&&w.water[y*N+x]===1;
    function edge(a,b,dir) {const e={a,b,dir,used:false};edges.push(e);const k=key(a);if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(e);incoming.set(key(b),(incoming.get(key(b))||0)+1);}
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(water(x,y)){
      if(y>0&&!water(x,y-1))edge([x,y],[x+1,y],0);
      if(x<N-1&&!water(x+1,y))edge([x+1,y],[x+1,y+1],1);
      if(y<N-1&&!water(x,y+1))edge([x+1,y+1],[x,y+1],2);
      if(x>0&&!water(x-1,y))edge([x,y+1],[x,y],3);
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
  function install(G, assets={}) {
    if(G._riverbayTerrain)throw new Error('Riverbay renderer already installed');
    let options={...defaults}, topologyWorld=null, paths=[], material=null, materialSeed=null;
    const originalTile=G.drawGroundTile, originalBuild=G.buildGround;
    const patterns=new WeakMap();
    const metrics={fullBuilds:0,partialBuilds:0,tileDraws:0,lastTileDraws:0,lastBuildMs:0,topologyBuilds:0,materialBuilds:0};
    function topology(){if(topologyWorld!==G.world){paths=coastlines(G.world);topologyWorld=G.world;metrics.topologyBuilds++;}return paths;}
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
        const v=broad*17+patch*8,i=(y*256+x)*4;im.data[i]=112+v;im.data[i+1]=126+v*.9;im.data[i+2]=75+v*.65;im.data[i+3]=255;}
      c.putImageData(im,0,0);metrics.materialBuilds++;return material;
    }
    function fillLow(c,x,y){const im=materialCanvas();let p=patterns.get(c);if(!p||p.im!==im){p={im,pattern:c.createPattern(im,'repeat')};patterns.set(c,p);}
      c.save();c.transform(8,4,-8,4,0,0);c.fillStyle=p.pattern;c.fillRect(x*4-.03125,y*4-.03125,4.0625,4.0625);c.restore();}
    function clutter(c,w,x,y){const i=y*w.N+x;if(w.water[i]||w.road[i]||w.rock[i]||w.bgrid[i]>=0||w.treeIdx[i]>=0)return;
      // Keep decorative marks away from useful objects/roads and shore edges.
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w.N||yy>=w.N)continue;const j=yy*w.N+xx;if(w.water[j]||w.road[j]||w.bgrid[j]>=0||w.rock[j])return;}
      const h=G.h2(w.seed+503,x,y);if(h>.075)return;const [sx,sy]=G.T2S(x+.35+G.h2(w.seed+504,x,y)*.3,y+.35+G.h2(w.seed+505,x,y)*.3);
      c.save();c.globalAlpha=.29;c.fillStyle='#686744';c.beginPath();c.ellipse(sx,sy,3.1,1.2,-.25,0,Math.PI*2);c.fill();
      c.strokeStyle='#77764f';c.lineWidth=.8;c.beginPath();c.moveTo(sx-3,sy+.5);c.lineTo(sx+2,sy-1);c.moveTo(sx+.2,sy-.3);c.lineTo(sx+1,sy-1.8);c.stroke();c.restore();}
    G.drawGroundTile=function(c,w,pal,x,y){metrics.tileDraws++;const i=y*w.N+x;
      const useLow=options.lowFrequency&&G.game.season===1&&!w.water[i]&&!w.road[i]&&!w.rock[i];
      if(useLow)fillLow(c,x,y);else{
        const map=G.SPR.map,old=map.get('water_open');
        if(options.waterV2&&assets.waterImage)map.set('water_open',assets.waterImage);
        try{originalTile(c,w,options.shore&&G.game.season!==3?{...pal,shore:'rgba(0,0,0,0)'}:pal,x,y);}finally{if(options.waterV2&&assets.waterImage){if(old)map.set('water_open',old);else map.delete('water_open');}}
      }
      if(options.clutter&&G.game.season===1)clutter(c,w,x,y);
    };
    function curve(c,route){const p=route.points.map(v=>G.T2S(v[0],v[1])),n=p.length;if(n<2)return;
      const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
      if(route.closed){const s=mid(p[n-1],p[0]);c.moveTo(...s);for(let i=0;i<n;i++){const q=mid(p[i],p[(i+1)%n]);c.quadraticCurveTo(...p[i],...q);}c.closePath();}
      else{c.moveTo(...p[0]);for(let i=1;i<n-1;i++){const q=mid(p[i],p[i+1]);c.quadraticCurveTo(...p[i],...q);}c.lineTo(...p[n-1]);}}
    function tileMask(c,water,bounds){const w=G.world;c.beginPath();for(let y=bounds.y0;y<=bounds.y1;y++)for(let x=bounds.x0;x<=bounds.x1;x++)if((w.water[y*w.N+x]===1)===water){const [sx,sy]=G.T2S(x,y);c.moveTo(sx,sy);c.lineTo(sx+32,sy+16);c.lineTo(sx,sy+32);c.lineTo(sx-32,sy+16);c.closePath();}c.clip();}
    function shore(c,bounds){if(!options.shore||G.game.season===3)return;const routes=topology().filter(p=>p.bounds.x1>=bounds.x0-1&&p.bounds.y1>=bounds.y0-1&&p.bounds.x0<=bounds.x1+2&&p.bounds.y0<=bounds.y1+2);
      function stroke(color,width,dash){c.beginPath();for(const p of routes)curve(c,p);c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.setLineDash(dash||[]);c.stroke();}
      c.save();tileMask(c,false,bounds);stroke('rgba(151,140,100,.58)',18);stroke('rgba(169,155,110,.28)',8);c.restore();
      c.save();tileMask(c,true,bounds);stroke('rgba(108,156,153,.52)',20);stroke('rgba(148,176,158,.28)',9);c.restore();
      c.save();stroke('rgba(211,211,174,.37)',.85,[3,19,1.4,29]);c.restore();
    }
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
        shore(c,b);c.restore();G.groundDirty.clear();metrics.partialBuilds++;
      }else{originalBuild();const c=G._gcv.getContext('2d');shore(c,{x0:0,y0:0,x1:w.N-1,y1:w.N-1});if(partial)metrics.partialBuilds++;else metrics.fullBuilds++;}
      metrics.lastTileDraws=metrics.tileDraws-before;metrics.lastBuildMs=performance.now()-start;
    };
    const api={metrics,getOptions:()=>({...options}),setOptions(next){for(const k of Object.keys(next))if(!(k in defaults)||typeof next[k]!=='boolean')throw new Error('Invalid riverbay option: '+k);const changed=Object.keys(next).some(k=>options[k]!==next[k]);options={...options,...next};if(changed)G.needGround=true;return {...options};},invalidateTopology(){topologyWorld=null;G.needGround=true;},getCoastlines:()=>topology().map(p=>({points:p.points.map(v=>v.slice()),closed:p.closed,bounds:{...p.bounds}}))};
    G._riverbayTerrain=api;return api;
  }
  const api={install,coastlines,defaults};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.RiverbayTerrain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
