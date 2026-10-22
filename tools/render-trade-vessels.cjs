'use strict';
// Actual production Canvas pixels from a real daily lifecycle; no browser claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require('@napi-rs/canvas'),root=path.resolve(__dirname,'..'),out=process.argv[2];if(!out)throw Error('Output directory required');fs.mkdirSync(out,{recursive:true});
const context={console,performance,setTimeout(){},clearTimeout(){},addEventListener(){},document:{getElementById:()=>({classList:{add(){}}}),createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
for(const name of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context,{filename:name+'.js'});
const G=context.G;G.autosave=()=>{};G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
(async()=>{
 for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(x=>x.endsWith('.png')))G.SPR.map.set(file.slice(0,-4),await loadImage(path.join(folder,file)));}
 assert(G.newGame(17,{climate:'fair',preserveSaves:true}).ok);const w=G.world;let b;
 for(let x=30;x<w.N-5&&!b;x++)for(let y=1;y<w.N-5&&!b;y++){const c={x,y,w:4,h:4};c.tradeBerth=G.chooseTradeBerth(w,c);if(!G.tradeWaterAccess(w,c).ok)continue;const r=G.addBuilding('tradingpost',x,y,{instant:true,free:true});if(r.ok)b=r.b;}
 assert(b);G.setWorkerLimit(b,0);const cases=[];let id;
 for(const phase of ['ingress','docked','egress']){
  let boat;for(let n=0;n<60;n++){boat=w.tradeVoyages.boats.find(x=>x.phase===phase&&(!id||x.id===id));if(boat)break;G.game.h=0;G.endDay();}assert(boat);id=boat.id;
  for(const zoom of [1,2]){const p=G.tradeVesselPose(w,boat),width=900,height=550;G.cv=createCanvas(width,height);G.cv.clientWidth=width;G.cv.clientHeight=height;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=zoom;const [x,y]=G.T2S(p.x+.5,p.y+.5);G.cam.x=width/2-x*zoom;G.cam.y=height/2-y*zoom;G.groundScale=.5;G.needGround=true;const before=JSON.stringify(G.serializeGame());G.frame(0);assert.equal(JSON.stringify(G.serializeGame()),before);const filename=phase+'-z'+zoom+'.png';fs.writeFileSync(path.join(out,filename),G.cv.toBuffer('image/png'));cases.push({phase,zoom,filename,day:G.game.day,pose:p,saveUnchanged:true});}
 }
 const cv=createCanvas(800,440),ctx=cv.getContext('2d');ctx.fillStyle='#f4efdd';ctx.fillRect(0,0,800,440);ctx.font='15px sans-serif';
 for(let i=0;i<8;i++){const col=i%4,row=Math.floor(i/4),[dx,dy]=[[1,0],[0,1],[-1,0],[0,-1]][col];ctx.save();ctx.translate(100+col*200,100+row*220);ctx.scale(2,2);G.diamondPath(ctx,0,0);ctx.fillStyle='#709e95';ctx.fill();G.drawTradeVessel(ctx,{x:0,y:0,dx,dy,phase:row?'docked':'ingress'});if(row)G.drawBridge(ctx,{x:0,y:0,w:1,h:1,bridgeAxis:'x',state:'ok'});ctx.restore();ctx.fillStyle='#244b44';ctx.fillText((row?'below bridge ':'direction ')+col,35+col*200,190+row*220);}
 fs.writeFileSync(path.join(out,'directions-bridge.png'),cv.toBuffer('image/png'));fs.writeFileSync(path.join(out,'render-report.json'),JSON.stringify({kind:'offline Canvas pixels; no browser/mobile acceptance',cases},null,2)+'\n');console.log(cases.length+' real-state render captures, save unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
