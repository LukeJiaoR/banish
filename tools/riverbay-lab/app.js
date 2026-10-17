'use strict';
(async function(){
 const cv=document.getElementById('lab'),stats=document.getElementById('stats');
 // The normal init/feedback/storage paths are deliberately never started.
 G.ui={toast(){},refreshHUD(){},hideInfo(){},setToolActive(){},refreshPlacement(){},refreshHarvest(){}};G.autosave=()=>{};
 const water=new Image();water.src='tools/riverbay-lab/water-open-candidate-v2.png';await water.decode();
 await new Promise((resolve,reject)=>{const start=performance.now();function ready(){if(G.SPR.ready){if(G.SPR.failed.length)return reject(new Error('原素材加载失败: '+G.SPR.failed.join(', ')));return resolve();}if(performance.now()-start>15000)return reject(new Error('原素材加载超时'));setTimeout(ready,30);}ready();});
 const scene=RiverbayScene.createScene(G);if(scene.failures.length)throw new Error(JSON.stringify(scene.failures));
 const terrain=RiverbayTerrain.install(G,{waterImage:water});G.cv=cv;G.ctx=cv.getContext('2d');G.groundScale=.68;G.dpr=Math.min(2,devicePixelRatio||1);
 let animate=false,animationFrame=null,drag=null,time=0,last=performance.now(),frames=0;const frameTimes=[];
 function center(){const [x,y]=G.T2S(16,16);G.cam.x=cv.clientWidth*.50-x*G.cam.z;G.cam.y=cv.clientHeight*.53-y*G.cam.z;}
 function resize(){G.dpr=Math.min(2,devicePixelRatio||1);cv.width=Math.round(cv.clientWidth*G.dpr);cv.height=Math.round(cv.clientHeight*G.dpr);center();render();}
 function render(){const t=performance.now();G.frame(0);frameTimes.push(performance.now()-t);if(frameTimes.length>120)frameTimes.shift();frames++;const m=terrain.metrics;stats.textContent=`${cv.clientWidth}×${cv.clientHeight} · DPR ${G.dpr} · 缓存 ${G._gcv.width}×${G._gcv.height} · 最近重绘 ${m.lastTileDraws}格 / ${m.lastBuildMs.toFixed(1)}ms · 帧 ${frameTimes.at(-1).toFixed(1)}ms`;}
 function controls(){for(const k of Object.keys(terrain.getOptions()))document.getElementById(k).checked=terrain.getOptions()[k];}
 const presets={original:{waterV2:false,shore:false,lowFrequency:false,clutter:false},water:{waterV2:true,shore:false,lowFrequency:false,clutter:false},shore:{waterV2:true,shore:true,lowFrequency:false,clutter:false},study:{waterV2:true,shore:true,lowFrequency:true,clutter:true}};
 function setOptions(v){terrain.setOptions(v);controls();for(const b of document.querySelectorAll('[data-preset]'))b.setAttribute('aria-pressed',String(JSON.stringify(presets[b.dataset.preset])===JSON.stringify(terrain.getOptions())));render();}
 for(const b of document.querySelectorAll('[data-preset]'))b.addEventListener('click',()=>setOptions(presets[b.dataset.preset]));
 for(const k of Object.keys(terrain.getOptions()))document.getElementById(k).addEventListener('change',e=>setOptions({[k]:e.target.checked}));
 document.getElementById('zoom').addEventListener('change',e=>{G.cam.z=Number(e.target.value);center();render();});document.getElementById('center').onclick=()=>{center();render();};
 document.getElementById('motion').onchange=e=>{animate=e.target.checked;last=performance.now();if(animationFrame!==null)cancelAnimationFrame(animationFrame);animationFrame=animate?requestAnimationFrame(tick):null;};
 function tick(now){animationFrame=null;if(!animate)return;time+=Math.min(.05,(now-last)/1000);last=now;RiverbayScene.pose(scene,time);render();animationFrame=requestAnimationFrame(tick);}
 cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);});cv.addEventListener('pointermove',e=>{if(!drag)return;G.cam.x+=e.clientX-drag.x;G.cam.y+=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};render();});for(const name of ['pointerup','pointercancel'])cv.addEventListener(name,()=>drag=null);
 document.getElementById('export').onclick=()=>{const a=document.createElement('a');a.download='riverbay-candidate.png';a.href=cv.toDataURL('image/png');a.click();};
 window.addEventListener('resize',resize);resize();
 window.riverbayLab={G,scene,terrain,setOptions,render,center,resize,metrics:()=>({frames,frameTimes:[...frameTimes],terrain:{...terrain.metrics},errors:[...window.__errs],kind:scene.kind})};window.__riverbayReady=true;
})();
