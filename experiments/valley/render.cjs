'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas'),generate=require('./generator.cjs');
const root=path.resolve(__dirname,'../..'),out=process.argv[2];if(!out)throw Error('Output directory required');fs.mkdirSync(out,{recursive:true});
const context={console,performance,setTimeout(){},clearTimeout(){},addEventListener(){},document:{createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
for(const name of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context,{filename:name+'.js'});
const G=context.G;G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
(async()=>{
for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(x=>x.endsWith('.png')))G.SPR.map.set(file.slice(0,-4),await loadImage(path.join(folder,file)));}
const report={kind:'Offline generated terrain; not browser, playable new-game, or device acceptance',generator:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'generator.cjs'))).digest('hex'),runtimeSources:Object.fromEntries(['core','defs','map','sim','fire','supply','sprites','render','main'].map(n=>['js/'+n+'.js',crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'js',n+'.js'))).digest('hex')])),assetManifest:crypto.createHash('sha256').update(fs.readdirSync(path.join(root,'assets')).sort().flatMap(d=>{const dir=path.join(root,'assets',d);return fs.statSync(dir).isDirectory()?fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort().map(f=>d+'/'+f+':'+crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,f))).digest('hex')):[];}).join('\n')).digest('hex'),cases:[]};
const sheet=createCanvas(1536,1320),sc=sheet.getContext('2d');sc.fillStyle='#f4efdf';sc.fillRect(0,0,sheet.width,sheet.height);
for(const [number,seed]of [0,1,7,42,999,-1].entries()){
const result=generate(G,seed,128),w=result.world;
const old=G.genMountainWorld(seed,128);
for(const [j,map]of [old,w].entries()){
const x0=(number%3)*512+j*256,y0=Math.floor(number/3)*660;sc.fillStyle='#193d3e';sc.font='15px sans-serif';sc.fillText(`${j?'valley prototype':'current mountain'} seed ${seed}`,x0+8,y0+22);
for(let y=0;y<128;y++)for(let x=0;x<128;x++){const i=y*128+x;sc.fillStyle=map.water[i]===1?'#468b9b':map.water[i]===2?'#b7af79':map.mountain[i]?'#797b6e':map.rock[i]===2?'#a56742':map.rock[i]===1?'#a7a394':map.treeIdx[i]>=0?'#355e43':'#a3af76';sc.fillRect(x0+x*2,y0+30+y*2,2,2);}sc.strokeStyle='#ee5445';sc.lineWidth=2;sc.strokeRect(x0+map.start.x*2-5,y0+30+map.start.y*2-5,10,10);
}
G.world=w;G.game=G.newGameState({v:2,preset:'hard',seed,terrain:'mountain'});G.game.season=1;G.game.h=12;
const cv=createCanvas(1000,700);cv.clientWidth=1000;cv.clientHeight=700;G.cv=cv;G.ctx=cv.getContext('2d');G.dpr=1;G.cam.z=.5;const [sx,sy]=G.T2S(w.start.x,w.start.y);G.cam.x=500-sx*.5;G.cam.y=350-sy*.5;G.needGround=true;G.groundScale=.5;G.frame(0);
fs.writeFileSync(path.join(out,`seed-${seed}-production.png`),cv.toBuffer('image/png'));sc.drawImage(cv,number%3*512,Math.floor(number/3)*660+294,512,358.4);
report.cases.push({seed,size:128,start:w.start,proof:result.proof,water:w.water.reduce((a,b)=>a+(b===1),0),mountain:w.mountain.reduce((a,b)=>a+b,0),trees:w.trees.length});
}
fs.writeFileSync(path.join(out,'overview.png'),sheet.toBuffer('image/png'));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Rendered six real generator seeds; overview and production Canvas views.');
})().catch(e=>{console.error(e);process.exitCode=1;});
