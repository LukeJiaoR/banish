import { VIEW,SOURCE_FILES,OMISSIONS,immutableCopy,canonical,sha256,buildCommands,splitGround,cameraAt,countVisible,stats } from './scene.mjs';
import { CanvasRenderer } from './canvas-renderer.mjs';
import { PixiRenderer } from './pixi-renderer.mjs';
import { ProductionReference } from './production-reference.mjs';
const $=id=>document.getElementById(id),root=new URL('./',import.meta.url);
let fixture=null,pixi=null,canvas=null,production=null,busy=false,stop=false,lock=null,lastReport=null;
const status=text=>{$('status').textContent=text;};
const loadScript=(src,integrity)=>new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=src;
  if(integrity){script.integrity=integrity;script.crossOrigin='anonymous';}
  script.onload=resolve;script.onerror=()=>reject(Error('脚本未能加载：'+src));document.head.append(script);
});
function setBusy(value,measuring=false) {
  busy=value;
  for(const id of ['seed','size','season','camera','step','rebuild','benchmark'])$(id).disabled=value||((!pixi||!window.renderCompare.ready)&&id==='benchmark');
  $('cancel').disabled=!measuring;$('download').disabled=value||!lastReport;
}
function currentCam() {return cameraAt(fixture.world,$('camera').value,Number($('step').value)/100);}
function reference(cam) { production.render(cam); }

function renderAll() {
  if(!fixture)return;const cam=currentCam();canvas.render(cam);if(pixi)pixi.render(cam);
  if($('production-detail').open)reference(cam);
  const count=countVisible(fixture.items,cam);
  $('counts').textContent=`${fixture.world.N}×${fixture.world.N} · 相同 960×600 / DPR 1 · 可见 ${count.commands} 条绘制命令 / ${count.triangles} 三角形 · 世界 ${fixture.worldHash.slice(0,12)} · 场景 ${fixture.sceneHash.slice(0,12)}`;
}
async function makeFixture() {
  if(busy)return;lastReport=null;window.renderCompare.ready=false;$('report').textContent='正在构建新场景；旧测量已清除。';setBusy(true);status('构建固定世界、一次性地面缓存和原生场景…');
  try {
    window.renderCompare.error=null;const G=window.G,t=performance.now(),seed=Number($('seed').value),size=Number($('size').value),season=Number($('season').value);
    if(!Number.isInteger(seed)||seed< -2147483648||seed>4294967295)throw Error('种子须为 -2147483648 至 4294967295 的整数');
    const candidate=G.prepareNewGame({preset:'classic',terrain:'mountain',mapSize:size,seed});
    candidate.game.paused=true;candidate.game.h=10;candidate.game.season=season;
    G.world=immutableCopy(candidate.world);G.game=immutableCopy(candidate.game);G.tool=null;G.hover={tx:-1,ty:-1};G.sel=null;G.smoke=[];G.flakes=[];
    const setup={worldGenerationMs:performance.now()-t};
    const worldJSON=JSON.stringify(canonical({world:G.world,game:G.game})),worldHash=await sha256(worldJSON);
    let start=performance.now();G.groundScale=.5;G.needGround=true;G.groundDirty.clear();G.buildGround();setup.groundBuildMs=performance.now()-start;
    start=performance.now();const ground=splitGround(G);setup.groundChunkMs=performance.now()-start;
    start=performance.now();const commands=buildCommands(G);setup.commandBuildMs=performance.now()-start;
    const items=Object.freeze([...ground.items,...commands.items]),assets=new Map(ground.assets);
    for(const item of items)if(item.asset&&!assets.has(item.asset))assets.set(item.asset,G.SPR.get(item.asset));
    const sceneHash=await sha256(JSON.stringify(items));
    if(pixi){pixi.destroy();pixi=null;}canvas?.destroy();
    // Replace the old WebGL canvas so a new fixture owns a fresh context.
    const old=$('pixi'),fresh=old.cloneNode(false);old.replaceWith(fresh);
    start=performance.now();canvas=new CanvasRenderer($('canvas'),items,assets);setup.canvasSetupMs=performance.now()-start;
    fixture={world:G.world,game:G.game,worldJSON,worldHash,sceneHash,items,assets,counts:commands.counts,groups:commands.groups,setup,groundChunks:ground.items.length,groundPixels:ground.pixels,groundScale:G.groundScale};
    production=new ProductionReference(G,G.world,G.game,$('production'));
    start=performance.now();pixi=await PixiRenderer.create(window.PIXI,$('pixi'),items,assets);setup.pixiSetupMs=performance.now()-start;
    const cam=currentCam();start=performance.now();canvas.render(cam);setup.canvasFirstSubmitMs=performance.now()-start;
    start=performance.now();pixi.render(cam);setup.pixiFirstSubmitMs=performance.now()-start;
    window.renderCompare.ready=true;$('report').textContent=JSON.stringify(metadata(),null,2);renderAll();
    status('固定场景已就绪。可切换相机对照，或运行单独、交替顺序的浏览器测量。');
  } catch(e){status(e.message);console.error(e);window.renderCompare.error=e.message;}
  finally {setBusy(false);}
}
function metadata() {
  return {schema:1,scope:'Paused mountain new-town rendering experiment; not gameplay performance',version:lock.version,backend:'WebGL',view:VIEW,seed:fixture.world.seed,mapSize:fixture.world.N,mapVersion:fixture.world.mapVersion,season:fixture.game.season,worldSha256:fixture.worldHash,sceneSha256:fixture.sceneHash,counts:fixture.counts,sceneGroups:fixture.groups,drawCommands:fixture.items.length,triangles:fixture.items.reduce((s,i)=>s+i.triangles,0),groundChunks:fixture.groundChunks,groundCacheScale:fixture.groundScale,groundRGBABytes:fixture.groundPixels*4,textureRGBABytesEstimate:[...fixture.assets.values()].reduce((s,a)=>s+a.width*a.height*4,0),setup:fixture.setup,pixi:pixi?.capabilities(),browser:{userAgent:navigator.userAgent,devicePixelRatio:devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,visibility:document.visibilityState},omissions:OMISSIONS,measurementLimits:['CPU submission time does not wait for GPU completion.','rAF intervals include scheduling/compositing and harness counting; headless software rendering is not a device FPS result.','Texture byte estimates exclude the retained full ground cache, all decoded SPR images, mesh buffers and driver overhead.', 'Shared Canvas adapter is not the production G.frame; production view is visual reference only.','No image decode/network, simulation, ground rebuilding, scene construction, memory/energy or live mutation costs are in steady-state timing.']};
}
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function benchmark({samples=120,warmup=30,repeats=3,scenarios=['village','ridge','pan-zoom']}={}) {
  if(busy||!pixi)throw Error('Scene unavailable or busy');
  if(!Number.isInteger(samples)||samples<10||samples>600||!Number.isInteger(warmup)||warmup<1||warmup>300||!Number.isInteger(repeats)||repeats<1||repeats>5)throw Error('Invalid benchmark budget');
  if(!Array.isArray(scenarios)||scenarios.some(s=>!['village','ridge','overview','pan-zoom'].includes(s)))throw Error('Invalid scenario');
  setBusy(true,true);stop=false;document.body.classList.add('measuring');const referenceOpen=$('production-detail').open;$('production-detail').open=false;
  const results={...metadata(),startedAt:new Date().toISOString(),complete:false,protocol:{samples,warmup,repeats,scenarios,order:'Alternating Canvas/Pixi then Pixi/Canvas each repeat',timeline:'Deterministic camera path by sample index, never wall time; warm-up traverses the same path'},trials:[]};
  try {
    for(const scenario of scenarios)for(let repeat=0;repeat<repeats;repeat++)for(const engine of repeat%2?['pixi','canvas']:['canvas','pixi']) {
      $('canvas-pane').hidden=engine!=='canvas';$('pixi-pane').hidden=engine!=='pixi';
      status(`测量 ${scenario} / ${engine} / 第 ${repeat+1} 轮。请保持此页在前台。`);
      const renderer=engine==='pixi'?pixi:canvas,submit=[],intervals=[],work=[],cameras=[];let previous=null;
      for(let i=-warmup;i<samples;i++) {
        const timestamp=await frame();if(stop)throw Error('用户停止测量');if(document.visibilityState!=='visible')throw Error('页面已进入后台，此次测量无效');
        const phase=i<0?(i+warmup)/Math.max(1,warmup-1):i/Math.max(1,samples-1);
        const cam=cameraAt(fixture.world,scenario,phase);
        const start=performance.now();renderer.render(cam);const elapsed=performance.now()-start;
        if(i>=0){submit.push(elapsed);if(previous!==null)intervals.push(timestamp-previous);work.push(countVisible(fixture.items,cam));cameras.push(cam);}
        previous=timestamp;
      }
      results.trials.push({scenario,repeat,engine,cpuSubmitMs:stats(submit),rafIntervalMs:stats(intervals),over20ms:intervals.filter(x=>x>20).length,coverageSha256:await sha256(JSON.stringify({work,cameras})),visibleCommands:stats(work.map(x=>x.commands)),visibleTriangles:stats(work.map(x=>x.triangles)),raw:{cpuSubmitMs:submit,rafIntervalMs:intervals}});
    }
    results.worldUnchanged=JSON.stringify(canonical({world:window.G.world,game:window.G.game}))===fixture.worldJSON;
    if(!results.worldUnchanged)throw Error('Frozen fixture was modified');
    for(const a of results.trials.filter(t=>t.engine==='canvas')){
      const b=results.trials.find(b=>b.engine==='pixi'&&b.repeat===a.repeat&&b.scenario===a.scenario);
      if(!b||a.coverageSha256!==b.coverageSha256)throw Error('Renderer workload or camera coverage mismatch');
    }
    results.sameCoverage=true;results.complete=true;status('浏览器测量完成。结果只适用于以下环境和限定场景；可导出完整原始数据。');
  } catch(e){results.error=e.message;status(e.message+'；保留部分数据，不能作为完整比较。');}
  finally {
    results.finishedAt=new Date().toISOString();lastReport=results;
    $('canvas-pane').hidden=false;$('pixi-pane').hidden=false;document.body.classList.remove('measuring');$('production-detail').open=referenceOpen;
    setBusy(false);renderAll();$('report').textContent=JSON.stringify({...results,trials:results.trials.map(({raw,...t})=>t)},null,2);
  }
  return results;
}
function download() {if(!lastReport)return;const blob=new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`render-compare-${fixture.world.seed}-${fixture.world.N}-${fixture.game.season}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
window.renderCompare={ready:false,error:null,benchmark,get metadata(){return fixture?metadata():null;},get report(){return lastReport;},get worldJSON(){return fixture?.worldJSON;},get sceneItems(){return fixture?.items;},render:renderAll,camera:(scenario,step=0)=>{$('camera').value=scenario;$('step').value=step*100;renderAll();},rebuild:makeFixture};
$('rebuild').addEventListener('click',makeFixture);$('camera').addEventListener('change',renderAll);$('step').addEventListener('input',renderAll);$('production-detail').addEventListener('toggle',()=>{if(!busy)renderAll();});$('benchmark').addEventListener('click',()=>benchmark().catch(e=>status(e.message)));$('cancel').addEventListener('click',()=>{stop=true;});$('download').addEventListener('click',download);
for(const omission of OMISSIONS){const li=document.createElement('li');li.textContent=omission;$('omissions').append(li);}
try {
  // Load main.js after DOMContentLoaded: its production init listener never runs.
  // Therefore no input/simulation loop, save read, autosave or telemetry is started.
  if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  lock=await (await fetch(new URL('pixi.lock.json',root))).json();
  for(const name of SOURCE_FILES)await loadScript(new URL('../../js/'+name+'.js',root).href);
  await loadScript(lock.url,lock.integrity);
  if(window.PIXI.VERSION!==lock.version)throw Error('Pixi version differs from lock');
  const started=performance.now();while(!window.G.SPR.ready){if(performance.now()-started>30000)throw Error('Asset loading timed out');await new Promise(r=>setTimeout(r,20));}
  if(window.G.SPR.failed.length)throw Error('Asset loading failed: '+window.G.SPR.failed.join(', '));
  await makeFixture();window.renderCompare.ready=!!pixi;
} catch(e) {window.renderCompare.error=e.message;status(e.message+'。请检查本地静态服务及固定 CDN 是否可达。');console.error(e);}
