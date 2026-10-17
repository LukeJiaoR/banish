'use strict';
/* Shared lab-only synchronous profiler. Requiring this file exports the profiler
 * without starting the browser controller, loading assets, or touching saves.
 * These call timings can include deferred Canvas work executed synchronously by
 * the engine. They do not measure raster/GPU completion or identify its cause. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RiverbayProfile = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const installed = new WeakMap();
  const timingScope = 'Synchronous elapsed call time, including instrumentation overhead. No GPU/raster completion, asynchronous paint, compositor, or input-to-present measurement. DOM timings include only work performed synchronously in the labelled call. viewportReadSyncMs covers controller reads on resize; renderer dimension reads remain in remainingFrameSyncMs. DOM write timings do not imply all subsequent layout work has completed.';
  function install(G, { engine, now = () => performance.now(), limit = 120 } = {}) {
    if (typeof engine !== 'string' || !engine.trim()) throw new Error('Profiler requires an explicit engine label');
    if (installed.has(G)) {
      const previous = installed.get(G);
      if (previous.engine !== engine) throw new Error('Profiler is already installed with a different engine');
      return previous;
    }
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Profiler limit must be a positive integer');
    if (typeof now !== 'function' || typeof G.frame !== 'function' || typeof G.buildGround !== 'function') throw new Error('Profiler requires a clock, G.frame and G.buildGround');
    const frames = [], operations = [], contexts = new WeakMap();
    const originalFrame = G.frame, originalBuild = G.buildGround;
    let currentFrame = null, currentOperation = null, frameCount = 0, operationCount = 0;
    const copy = value => JSON.parse(JSON.stringify(value));
    function retain(list, value) { list.push(value); if (list.length > limit) list.shift(); }
    function elapsed(start, record) {
      const end = now();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) { record.timingValid = false; return null; }
      return end - start;
    }
    function add(record, key, value) {
      record[key] = record[key] === null || value === null ? null : (record[key] || 0) + value;
    }
    function remainder(total, parts, record) {
      if (total === null || parts.some(value => value === null)) return null;
      const remaining = total - parts.reduce((sum, value) => sum + value, 0);
      if (remaining < -0.001) { record.timingValid = false; return null; }
      return Math.max(0, remaining);
    }
    function instrumentContext(ctx) {
      if (!ctx || typeof ctx.drawImage !== 'function') throw new Error('Profiler requires Canvas drawImage');
      if (contexts.has(ctx)) {
        if (ctx.drawImage !== contexts.get(ctx)) throw new Error('Profiled drawImage was replaced');
        return;
      }
      const original = ctx.drawImage;
      const wrapped = function (...args) {
        const frame = currentFrame;
        if (!frame || this !== G.ctx || args[0] !== G._gcv) return original.apply(this, args);
        const first = frame.groundDrawCalls++ === 0, start = now();
        if (first) {
          frame.firstGroundDrawStartOffsetMs = start - frame.startedAt;
          if (!Number.isFinite(frame.firstGroundDrawStartOffsetMs) || frame.firstGroundDrawStartOffsetMs < 0) { frame.firstGroundDrawStartOffsetMs = null; frame.timingValid = false; }
        }
        try { return original.apply(this, args); }
        finally {
          const duration = elapsed(start, frame);
          add(frame, 'groundDrawImageCallsMs', duration);
          if (first) frame.firstGroundDrawImageCallMs = duration;
        }
      };
      ctx.drawImage = wrapped;
      if (ctx.drawImage !== wrapped) throw new Error('Unable to instrument Canvas drawImage');
      contexts.set(ctx, wrapped);
    }
    const wrappedBuild = function (...args) {
      const frame = currentFrame;
      if (!frame) return originalBuild.apply(this, args);
      frame.groundBuildCalls++;
      const start = now();
      try { return originalBuild.apply(this, args); }
      finally { add(frame, 'buildGroundSubmitMs', elapsed(start, frame)); }
    };
    const wrappedFrame = function (...args) {
      if (currentFrame) throw new Error('Reentrant G.frame cannot be profiled accurately');
      const frame = { sequence: ++frameCount, firstFrameForProfiler: frameCount === 1, timingValid: true, completed: false, groundBuildCalls: 0, buildGroundSubmitMs: 0, groundDrawCalls: 0, firstGroundDrawStartOffsetMs: null, firstGroundDrawImageCallMs: null, groundDrawImageCallsMs: 0, startedAt: now() };
      currentFrame = frame;
      try {
        if (G.buildGround !== wrappedBuild) throw new Error('Profiled buildGround was replaced');
        instrumentContext(G.ctx);
        const result = originalFrame.apply(this, args);
        frame.completed = true;
        return result;
      } finally {
        frame.frameSyncMs = elapsed(frame.startedAt, frame);
        frame.remainingFrameSyncMs = remainder(frame.frameSyncMs, [frame.buildGroundSubmitMs, frame.groundDrawImageCallsMs], frame);
        frame.cacheState = frame.groundBuildCalls ? 'ground-rebuild' : 'no-ground-build';
        delete frame.startedAt;
        currentFrame = null;
        retain(frames, frame);
        if (currentOperation) {
          currentOperation.frameSequences.push(frame.sequence);
          add(currentOperation, 'frameSyncMs', frame.frameSyncMs);
          if (!frame.timingValid) currentOperation.timingValid = false;
        }
      }
    };
    G.buildGround = wrappedBuild;
    G.frame = wrappedFrame;
    const api = {
      engine,
      // A nested render belongs to its enclosing setOptions/resize operation.
      operation(label, run) {
        if (currentOperation) return run();
        const record = { sequence: ++operationCount, label, completed: false, timingValid: true, frameSequences: [], frameSyncMs: 0, sections: {} }, start = now();
        currentOperation = record;
        try { const result = run(); record.completed = true; return result; }
        finally {
          record.totalSyncMs = elapsed(start, record);
          record.otherSyncMs = remainder(record.totalSyncMs, [record.frameSyncMs, ...Object.values(record.sections)], record);
          currentOperation = null;
          retain(operations, record);
        }
      },
      section(label, run) {
        if (!currentOperation) return run();
        const record = currentOperation, start = now();
        try { return run(); }
        finally { add(record.sections, label, elapsed(start, record)); }
      },
      latestFrame: () => frames.length ? copy(frames[frames.length - 1]) : null,
      report: () => ({ schemaVersion: 1, engine, timingScope, retainedLimit: limit, frameCount, operationCount, instrumentationCurrent: G.frame === wrappedFrame && G.buildGround === wrappedBuild && (!contexts.has(G.ctx) || G.ctx.drawImage === contexts.get(G.ctx)), frames: copy(frames), operations: copy(operations) }),
    };
    installed.set(G, api);
    return api;
  }
  return { install, timingScope };
});

// The CommonJS export above is also used by render.cjs and deterministic tests.
if (typeof module !== 'object' || !module.exports) (async function () {
 const cv=document.getElementById('lab'),stats=document.getElementById('stats');
 // The normal init/feedback/storage paths are deliberately never started.
 G.ui={toast(){},refreshHUD(){},hideInfo(){},setToolActive(){},refreshPlacement(){},refreshHarvest(){}};G.autosave=()=>{};
 const water=new Image();water.src='tools/riverbay-lab/water-open-candidate-v2.png';await water.decode();
 await new Promise((resolve,reject)=>{const start=performance.now();function ready(){if(G.SPR.ready){if(G.SPR.failed.length)return reject(new Error('原素材加载失败: '+G.SPR.failed.join(', ')));return resolve();}if(performance.now()-start>15000)return reject(new Error('原素材加载超时'));setTimeout(ready,30);}ready();});
 const scene=RiverbayScene.createScene(G);if(scene.failures.length)throw new Error(JSON.stringify(scene.failures));
 const terrain=RiverbayTerrain.install(G,{waterImage:water});G.cv=cv;G.ctx=cv.getContext('2d');G.groundScale=.68;G.dpr=Math.min(2,devicePixelRatio||1);
 const profile=RiverbayProfile.install(G,{engine:'browser Canvas 2D'});
 const optionInputs=Object.fromEntries(Object.keys(terrain.getOptions()).map(k=>[k,document.getElementById(k)]));
 const presetButtons=[...document.querySelectorAll('[data-preset]')];
 let animate=false,animationFrame=null,drag=null,time=0,last=performance.now(),frames=0,viewport={width:0,height:0};const frameTimes=[];
 function center(){const [x,y]=G.T2S(16,16);G.cam.x=viewport.width*.50-x*G.cam.z;G.cam.y=viewport.height*.53-y*G.cam.z;}
 function resize(){return profile.operation('resize',()=>{
  profile.section('viewportReadSyncMs',()=>{viewport={width:cv.clientWidth,height:cv.clientHeight};});
  profile.section('backingStoreResizeSyncMs',()=>{G.dpr=Math.min(2,devicePixelRatio||1);cv.width=Math.round(viewport.width*G.dpr);cv.height=Math.round(viewport.height*G.dpr);});
  center();render();
 });}
 function render(){return profile.operation('render',()=>{
  G.frame(0);const frame=profile.latestFrame();frameTimes.push(frame.frameSyncMs);if(frameTimes.length>120)frameTimes.shift();frames++;
  profile.section('statsUpdateSyncMs',()=>{const m=terrain.metrics,ms=value=>value===null?'未测得':value.toFixed(1);stats.textContent=`${viewport.width}×${viewport.height} · DPR ${G.dpr} · 缓存 ${G._gcv.width}×${G._gcv.height} · 最近重绘 ${m.lastTileDraws}格 · 同步帧 ${ms(frame.frameSyncMs)}ms（构建 ${ms(frame.buildGroundSubmitMs)} / 首次地面 drawImage ${ms(frame.firstGroundDrawImageCallMs)} / 其余 ${ms(frame.remainingFrameSyncMs)}）`;});
 });}
 function controls(options){for(const [key,input]of Object.entries(optionInputs))if(input.checked!==options[key])input.checked=options[key];
  for(const button of presetButtons){const pressed=String(Object.keys(options).every(key=>presets[button.dataset.preset][key]===options[key]));if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);}
 }
 const presets={original:{waterV2:false,shore:false,lowFrequency:false,clutter:false,shoreVariation:false},water:{waterV2:true,shore:false,lowFrequency:false,clutter:false,shoreVariation:false},shore:{waterV2:true,shore:true,lowFrequency:false,clutter:false,shoreVariation:false},study:{waterV2:true,shore:true,lowFrequency:true,clutter:true,shoreVariation:false},variation:{waterV2:true,shore:true,lowFrequency:true,clutter:true,shoreVariation:true}};
 function setOptions(value){return profile.operation('setOptions',()=>{
  profile.section('optionsMutationSyncMs',()=>terrain.setOptions(value));
  profile.section('controlsUpdateSyncMs',()=>controls(terrain.getOptions()));render();
 });}
 for(const button of presetButtons)button.addEventListener('click',()=>setOptions(presets[button.dataset.preset]));
 for(const [key,input]of Object.entries(optionInputs))input.addEventListener('change',e=>setOptions({[key]:e.target.checked}));
 document.getElementById('zoom').addEventListener('change',e=>{G.cam.z=Number(e.target.value);center();render();});document.getElementById('center').onclick=()=>{center();render();};
 document.getElementById('motion').onchange=e=>{animate=e.target.checked;last=performance.now();if(animationFrame!==null)cancelAnimationFrame(animationFrame);animationFrame=animate?requestAnimationFrame(tick):null;};
 function tick(now){animationFrame=null;if(!animate)return;time+=Math.min(.05,(now-last)/1000);last=now;RiverbayScene.pose(scene,time);render();animationFrame=requestAnimationFrame(tick);}
 cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);});cv.addEventListener('pointermove',e=>{if(!drag)return;G.cam.x+=e.clientX-drag.x;G.cam.y+=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};render();});for(const name of ['pointerup','pointercancel'])cv.addEventListener(name,()=>drag=null);
 document.getElementById('export').onclick=()=>{const a=document.createElement('a');a.download='riverbay-candidate.png';a.href=cv.toDataURL('image/png');a.click();};
 window.addEventListener('resize',resize);resize();
 window.riverbayLab={G,scene,terrain,setOptions,render,center,resize,metrics:()=>({frames,frameTimes:[...frameTimes],profile:profile.report(),userAgent:typeof navigator==='undefined'?null:navigator.userAgent,terrain:{...terrain.metrics},errors:[...window.__errs],kind:scene.kind})};window.__riverbayReady=true;
})();
