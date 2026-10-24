'use strict';
(async function(){
 while(!G.SPR.ready)await new Promise(r=>setTimeout(r,30));
 if(G.SPR.failed.length)throw Error('素材未完整加载: '+G.SPR.failed.join(', '));
 G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
 const fixture=VillageScene.create(G),effects=VillageEffects.install(G),canvas=document.querySelector('#scene');G.cv=canvas;G.ctx=canvas.getContext('2d');
 let zoom=1.6,drag=null;const boxes=[...document.querySelectorAll('#effects input')];
 function draw(){G.frame(0);const s=effects.stats();document.querySelector('#status').textContent=`浏览器实际 Canvas · ${fixture.buildings} 建筑 / ${fixture.trees} 树 · 镜头 ${zoom}× · 地面缓存 ${G._gcv.width}×${G._gcv.height} · 投影缓存 ${(s.shadowCacheBytes/1048576).toFixed(2)} MiB`;}
 function resize(){G.dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(canvas.clientWidth*G.dpr);canvas.height=Math.round(canvas.clientHeight*G.dpr);VillageScene.camera(G,canvas.clientWidth,canvas.clientHeight,zoom);draw();}
 function set(opts){effects.set(opts);for(const b of boxes)b.checked=!!opts[b.name];document.querySelector('#baseline').setAttribute('aria-pressed',String(boxes.every(b=>!b.checked)));document.querySelector('#combined').setAttribute('aria-pressed',String(boxes.every(b=>b.checked)));draw();}
 document.querySelector('#baseline').onclick=()=>set({});document.querySelector('#combined').onclick=()=>set(Object.fromEntries(boxes.map(b=>[b.name,true])));for(const b of boxes)b.onchange=()=>set(Object.fromEntries(boxes.map(b=>[b.name,b.checked])));
 document.querySelector('#zoom').onchange=e=>{zoom=Number(e.target.value);resize();};document.querySelector('#reset').onclick=resize;
 canvas.onpointerdown=e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY,cx:G.cam.x,cy:G.cam.y};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;G.cam.x=drag.cx+e.clientX-drag.x;G.cam.y=drag.cy+e.clientY-drag.y;draw();};const stop=()=>{drag=null;};canvas.onpointerup=stop;canvas.onpointercancel=stop;canvas.onlostpointercapture=stop;
 addEventListener('resize',resize);window.villageLab={fixture,effects,draw,set,resize,ready:true};resize();
})();
