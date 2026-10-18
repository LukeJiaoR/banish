'use strict';
/* Optional native Canvas evidence, explicitly NOT a Chromium/mobile-device test.
 * node tools/riverbay-lab/render.cjs --out /tmp/riverbay-evidence */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createCanvas,loadImage,Path2D}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'../..'),out=process.argv[process.argv.indexOf('--out')+1];
if(!process.argv.includes('--out')||!out)throw new Error('Explicit --out directory required');fs.mkdirSync(out,{recursive:true});
const context={console,performance,setTimeout(){},clearTimeout(){},addEventListener(){},document:{createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
for(const name of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context,{filename:name+'.js'});
const G=context.G;G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
const displayCacheFields=['_chimney','_psx','_fx'];
function stateSnapshot(includeDisplayCache){return JSON.stringify({world:G.world,game:G.game},(key,value)=>{
 if(!includeDisplayCache&&displayCacheFields.includes(key))return undefined; // Original renderer: chimney anchor, previous screen x, sprite facing.
 if(ArrayBuffer.isView(value))return Array.from(value);
 if(Object.prototype.toString.call(value)==='[object Set]')return Array.from(value);
 if(Object.prototype.toString.call(value)==='[object Map]')return Array.from(value.entries());
 return value;
});}
function hashState(includeDisplayCache){return crypto.createHash('sha256').update(stateSnapshot(includeDisplayCache)).digest('hex');}
(async()=>{
 for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(x=>x.endsWith('.png')))G.SPR.map.set(file.slice(0,-4),await loadImage(path.join(folder,file)));}
 const {createScene,pose}=require('./scene'),scene=createScene(G);if(scene.failures.length)throw new Error(JSON.stringify(scene.failures));pose(scene,6.5);
 const terrainModule=require('./terrain');const oldDoc=global.document,oldPath=global.Path2D;global.document=context.document;global.Path2D=Path2D;
 const terrain=terrainModule.install(G,{waterImage:await loadImage(path.join(__dirname,'water-open-candidate-v2.png'))});
 const presets={original:{waterV2:false,shore:false,lowFrequency:false,clutter:false,shoreVariation:false},water:{waterV2:true,shore:false,lowFrequency:false,clutter:false,shoreVariation:false},shore:{waterV2:true,shore:true,lowFrequency:false,clutter:false,shoreVariation:false},study:{waterV2:true,shore:true,lowFrequency:true,clutter:true,shoreVariation:false},variation:{waterV2:true,shore:true,lowFrequency:true,clutter:true,shoreVariation:true}};
 const profile=require('./app.js').install(G,{engine:'@napi-rs/canvas (native Canvas; Node.js '+process.version+')'});
 const fileHash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const report={schemaVersion:2,engine:'@napi-rs/canvas; offline production Canvas functions, not browser/layout/device validation',base:'421793ac1a6bd073b19e0df1b46e557efb0b43a1',source:{baseMeaning:'Unmodified production code baseline, not the candidate revision under test',candidateParent:'00eddef5ef500384f1997cb296c8383b917a31a6',terrainSha256:fileHash(require.resolve('./terrain')),controllerAndProfilerSha256:fileHash(require.resolve('./app.js')),sceneSha256:fileHash(require.resolve('./scene')),runnerSha256:fileHash(__filename),productionRendererSha256:fileHash(path.join(root,'js/render.js'))},browserAcceptance:{historicalOriginal:{revision:'07607c6d647ed391b22945ce3cf2c3fd8b3af342',evidence:'docs/art-assets/riverbay-lab/browser/browser-acceptance.md',preserved:true},historicalStructuralFix:{revision:'2857b9438a89a87dccb1bf2a2b9b7a904f42f407',evidence:'docs/art-assets/riverbay-lab/browser-fixed/browser-acceptance-fixed.md',status:'Structural browser retest passed; art not approved; physical device not validated',preserved:true},shoreVariation:{browserTested:false,artApproved:false,previousCandidate:{revision:'a881872e56f2d5424dc09485c0bd1e19e5be6e35',evidence:'docs/art-assets/riverbay-lab/browser-variation/browser-acceptance-variation.md',status:'Browser structural checks passed; art failed'},note:'This readable-band/path-cache revision needs new browser acceptance; prior B results do not transfer.'}},comparison:{controlPreset:'study',candidatePreset:'variation',changedOption:'shoreVariation',expectedCases:20},scene:{kind:scene.kind,seed:scene.seed,size:32,buildings:G.world.buildings.length,citizens:G.world.citizens.length,trees:G.world.trees.length},results:[]};
 const initial=hashState(true),initialGameplay=hashState(false),displayRecords=[...G.world.buildings.map(b=>({kind:'building',object:b})),...G.world.citizens.map(c=>({kind:'citizen',object:c}))],initialDisplay=new Map(displayRecords.map(({object})=>[object,displayCacheFields.map(k=>JSON.stringify(object[k]))]));
 for(const [device,width,height]of [['desktop',1227,763],['phone',390,620]])for(const zoom of [.75,1,2])for(const [name,options]of Object.entries(presets)){
  if(['water','shore'].includes(name)&&(device!=='desktop'||zoom!==1))continue;
  G.cv=createCanvas(width,height);G.cv.clientWidth=width;G.cv.clientHeight=height;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=zoom;const [x,y]=G.T2S(16,16);G.cam.x=width*.5-x*zoom;G.cam.y=height*.53-y*zoom;G.groundScale=.68;terrain.setOptions(options);G.needGround=true;
  const coldStart=performance.now();G.frame(0);const coldFrameMs=performance.now()-coldStart;
  const firstFrame={...profile.latestFrame(),frameCallMs:coldFrameMs};
  const coldMs=terrain.metrics.lastBuildMs,canvas=G._gcv,warm=[],warmSamples=[],builds=terrain.metrics.fullBuilds+terrain.metrics.partialBuilds;
  for(let n=0;n<30;n++){const start=performance.now();G.frame(0);const frameCallMs=performance.now()-start;warm.push(frameCallMs);warmSamples.push({...profile.latestFrame(),frameCallMs});}warm.sort((a,b)=>a-b);
  if([firstFrame,...warmSamples].some(frame=>!frame.completed||!frame.timingValid||frame.groundDrawCalls!==1||!Number.isFinite(frame.frameCallMs)))throw new Error('Invalid or incomplete native frame profile');
  const filename=`${device}-z${zoom}-${name}.png`;fs.writeFileSync(path.join(out,filename),G.cv.toBuffer('image/png'));
  const row={device,width,height,zoom,preset:name,options:{...options},filename,groundWidth:canvas.width,groundHeight:canvas.height,coldBuildMs:+coldMs.toFixed(3),coldFrameMs:+coldFrameMs.toFixed(3),firstFrame,warmSamples,warmP50Ms:+warm[15].toFixed(3),warmP95Ms:+warm[28].toFixed(3),warmRebuilds:terrain.metrics.fullBuilds+terrain.metrics.partialBuilds-builds};report.results.push(row);
 }
 const profileReport=profile.report();
 report.profiling={schemaVersion:profileReport.schemaVersion,engine:profileReport.engine,timingScope:profileReport.timingScope,instrumentationCurrent:profileReport.instrumentationCurrent,frameCount:profileReport.frameCount,firstFrameMeaning:'Forced ground rebuild for each case, not a fresh process/JIT/image-decode cache. Warm samples retain the same scene and ground cache.',coldBuildMsMeaning:'Legacy terrain buildGround timer only; coldFrameMs covers the complete synchronous G.frame call. firstFrame and warmSamples split build submission, ground drawImage call and remaining G.frame time.',uiLayout:{measured:false,reason:'Native Canvas has no browser DOM, controls, layout, compositor or device validation.'}};
 if(!report.profiling.instrumentationCurrent)throw new Error('Native profiler was replaced');
 report.sceneStateUnchanged=initial===hashState(true);report.gameplayStateUnchanged=initialGameplay===hashState(false);
 report.displayCacheChanges=displayRecords.flatMap(({kind,object})=>displayCacheFields.flatMap((field,i)=>initialDisplay.get(object)[i]!==JSON.stringify(object[field])?[{kind,id:object.id,field}]:[]));
 report.displayCacheNote='Original renderer writes chimney anchor, previous screen x and sprite-facing caches. Full scene state therefore changes; only these three audited presentation fields are excluded from gameplay comparison.';
 report.gameplaySnapshotExcludes=displayCacheFields;report.materialCanvasPixels=256*256;report.modelCallsByThisRunner=0;
 if(!report.gameplayStateUnchanged)throw new Error('Rendering changed gameplay state; refusing successful evidence report');
 fs.writeFileSync(path.join(out,'native-canvas-report.json'),JSON.stringify(report,null,2)+'\n');global.document=oldDoc;if(oldPath===undefined)delete global.Path2D;else global.Path2D=oldPath;console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
