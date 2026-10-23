'use strict';
// Combined production UI/simulation and asset-loader contract. Not browser QA.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(__dirname,'household-supply-ui.js'),'utf8'),context={require,console,Blob,__dirname,module:{exports:{}}};
vm.runInNewContext(source.slice(0,source.indexOf('let passed'))+'\nmodule.exports=fixture;',context);
const f=context.module.exports(),G=f.G;
const requested=[];
class ImageProbe {set src(value){this.url=value;requested.push(this);}}
f.ctx.Image=ImageProbe;
vm.runInContext(fs.readFileSync(path.join(root,'js/sprites.js'),'utf8'),f.ctx);
assert.equal(requested.filter(i=>i.url.includes('/portraits/')).length,0,'portraits must not preload');
assert.equal(requested.filter(i=>i.url.includes('/woodcutter-a-')).length,0);
let bytes=0,decodedBytes=0;
for(const im of requested){const file=path.join(root,im.url);assert(fs.existsSync(file),im.url);const data=fs.readFileSync(file);bytes+=data.length;im.width=data.readUInt32BE(16);im.height=data.readUInt32BE(20);decodedBytes+=im.width*im.height*4;if(im.url.includes('/woodcutter-a-processing-v2'))im.onerror();else im.onload();}
assert(G.SPR.ready);
const initialRequests=requested.length;
for(let i=0;i<100;i++)assert.equal(G.SPR.get('woodcutter-a-processing-v2'),null);
assert.equal(requested.length,initialRequests+1);assert(G.SPR.lazyPending.has('woodcutter-a-processing-v2'));
requested.at(-1).onerror();assert(G.SPR.failed.includes('woodcutter-a-processing-v2'));
assert(!G.SPR.lazyPending.has('woodcutter-a-processing-v2'));
for(let i=0;i<100;i++)assert.equal(G.SPR.get('woodcutter-a-processing-v2'),null);
assert.equal(requested.length,initialRequests+1,'failure must not retry each frame');
assert.equal(G.SPR.get('woodcutter-a-idle'),null);
const idle=requested.at(-1),idleData=fs.readFileSync(path.join(root,idle.url));idle.width=idleData.readUInt32BE(16);idle.height=idleData.readUInt32BE(20);idle.onload();
assert(G.SPR.get('woodcutter-a-idle'));assert(G.SPR.ready);
assert.equal(G.drawCalibratedArt({},'woodcutter-a-processing-v2',0,0,128),null);
assert(G.drawCalibratedArt({drawImage(){}},'woodcutter-a-idle',0,0,128));
const storage=f.building('storage',{x:2,y:2}),b=f.building('woodcutter',{x:12,y:10});
Object.assign(G.game.res,{wood:200,food:1000,tools:20,firewood:0});
const c=G.spawnCitizen({x:8,y:10,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];
G.sel={kind:'c',id:c.id};G.ui.showInfo();
const key=G.ui.citizenPortraitKey(c),portrait=f.info.querySelector('[data-citizen-portrait]'),initialWrites=portrait.htmlWrites;
assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');G.requestTask(c);assert.equal(c.task.phase,'fetch');
let steps=0;while(!(c.task?.phase==='process'&&c.state==='work')&&steps++<3000){G.stepCitizen(c,.05);const before=JSON.stringify(G.serializeGame());G.ui.renderInfo();assert.equal(JSON.stringify(G.serializeGame()),before);assert.equal(G.ui.citizenPortraitKey(c),key);}
assert(steps<3000);assert.equal(G.woodcutterArtName(b),'woodcutter-a-processing-v2');assert(c.x+c.y>b.x+b.y+b.w+b.h-2-.5);assert.equal(portrait.htmlWrites,initialWrites);
const physicalProcessingPoint={x:c.x,y:c.y};
const before=JSON.stringify(G.serializeGame());for(let i=0;i<100;i++){G.ui.renderInfo();G.woodcutterArtName(b);}assert.equal(JSON.stringify(G.serializeGame()),before);
// Validate all eight identities through actual UI selection; no fabricated image preload.
const seen=new Set();let portraitBytes=0,portraitDecodedBytes=0;
for(const age of [8,30,70])for(const sex of ['m','f'])for(let id=1;id<=30;id++){
 const person={...c,id,age,sex};const pkey=G.ui.citizenPortraitKey(person);const markup=G.ui.citizenPortraitMarkup(person);assert(markup.includes('assets/portraits/'+pkey+'.png'));assert(markup.includes('decoding="async"'));assert(markup.includes('loading="eager"'));assert(G.ui.citizenPortraitMarkup(person,true).includes('loading="lazy"'));
 if(!seen.has(pkey)){seen.add(pkey);const data=fs.readFileSync(path.join(root,'assets/portraits',pkey+'.png'));portraitBytes+=data.length;portraitDecodedBytes+=data.readUInt32BE(16)*data.readUInt32BE(20)*4;}
}
assert.equal(seen.size,8);
// Error handler actually removes the failed img, and stable refresh never retries it in a loop.
const img=portrait.querySelector('img');new Function(img.getAttribute('onerror')).call(img);assert(!portrait.querySelector('img'));for(let i=0;i<100;i++)G.ui.renderInfo();assert(!portrait.querySelector('img'));assert.equal(portrait.htmlWrites,initialWrites);
G.setWorkerLimit(b,0);steps=0;while(c.carry||c.task){G.stepCitizen(c,.05);G.ui.renderInfo();assert.equal(G.ui.citizenPortraitKey(c),key);assert(++steps<10000);}
assert.equal(G.game.res.firewood,6);assert.equal(G.game.res.wood,198);assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
console.log(JSON.stringify({passed:true,preload:{count:initialRequests,bytes,decodedRgbaBytes:decodedBytes,portraitRequests:0},portraits:{count:seen.size,bytes:portraitBytes,decodedRgbaBytes:portraitDecodedBytes},physicalProcessingPoint,cycleOutput:6,stableUiNoRemount:true,errorNoRetryLoop:true,browserVerified:false},null,2));
