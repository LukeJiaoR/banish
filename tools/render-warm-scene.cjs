'use strict';
// Offline production Canvas comparison. No browser, UI layout or device claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out)throw Error('Output directory required');fs.mkdirSync(out,{recursive:true});
const context={console,performance,setTimeout(){},clearTimeout(){},addEventListener(){},document:{createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
for(const name of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context,{filename:name+'.js'});
const G=context.G;G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
(async()=>{
for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(x=>x.endsWith('.png')))G.SPR.map.set(file.slice(0,-4),await loadImage(path.join(folder,file)));}
const {createScene,pose}=require('./riverbay-lab/scene');const scene=createScene(G);if(scene.failures.length)throw Error(JSON.stringify(scene.failures));pose(scene,6.5);
// Add a legal, unoccupied northern ridge to the authored fixture, not a played save.
for(let y=1;y<=6;y++)for(let x=8;x<=16;x++){const i=y*32+x;if(G.world.bgrid[i]>=0||G.world.water[i])throw Error('Occupied ridge');G.world.mountain[i]=1;}
G.world.trees=G.world.trees.filter(t=>!G.isMountain(G.world,t.x,t.y));G.world.treeIdx.fill(-1);G.world.trees.forEach((t,i)=>G.world.treeIdx[t.y*32+t.x]=i);
const original={meadow_summer:await loadImage(path.join(root,'docs/art-assets/candidates/issue-87/meadow-summer-baseline.png')),water_open:await loadImage(path.join(root,'docs/art-assets/candidates/issue-87/water-open-baseline.png'))};
const candidate={meadow_summer:await loadImage(path.join(root,'docs/art-assets/candidates/issue-87/meadow-summer-candidate-v2.png')),water_open:await loadImage(path.join(root,'docs/art-assets/candidates/issue-87/water-open-candidate-v2.png'))};
const report={engine:'@napi-rs/canvas, offline production renderer; not browser or physical phone validation',scene:{kind:scene.kind,buildings:G.world.buildings.length,citizens:G.world.citizens.length,trees:G.world.trees.length,mountainTiles:G.world.mountain.reduce((a,b)=>a+b,0)},cases:[]};
const gameState=()=>JSON.stringify([G.world,G.game],(k,v)=>['_chimney','_psx','_fx'].includes(k)?undefined:v);
for(const season of [1,3])for(const [viewport,width,height]of [['desktop',1227,763],['narrow',390,620]])for(const zoom of [.75,1,2]){
const canvases=[];
for(const choice of ['original','water','both']){
for(const name of Object.keys(original))G.SPR.map.set(name,(choice==='both'||choice==='water'&&name==='water_open')?candidate[name]:original[name]);
G.game.season=season;G.cv=createCanvas(width,height);G.cv.clientWidth=width;G.cv.clientHeight=height;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=zoom;const [x,y]=G.T2S(14,14);G.cam.x=width*.5-x*zoom;G.cam.y=height*.48-y*zoom;G.groundScale=.68;G.needGround=true;
const before=gameState();G.frame(0);if(before!==gameState())throw Error('Renderer changed gameplay state');
const filename=`${viewport}-s${season}-z${zoom}-${choice}.png`;fs.writeFileSync(path.join(out,filename),G.cv.toBuffer('image/png'));canvases.push(G.cv);report.cases.push({season,viewport,width,height,zoom,choice,filename,gameplayUnchanged:true});
}
const pair=createCanvas(width*3,height+26),ctx=pair.getContext('2d');ctx.fillStyle='#20231f';ctx.fillRect(0,0,pair.width,pair.height);ctx.fillStyle='#fff';ctx.font='14px sans-serif';canvases.forEach((cv,i)=>{ctx.fillText(['original','water v2 only','grass + water v2'][i],i*width+10,18);ctx.drawImage(cv,i*width,26);});fs.writeFileSync(path.join(out,`${viewport}-s${season}-z${zoom}-compare.png`),pair.toBuffer('image/png'));
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.scene));console.log(`${report.cases.length} offline render cases passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
