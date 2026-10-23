'use strict';
// Production Canvas frames from explicit occupancy fixtures; no full daily-cycle/browser claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require('@napi-rs/canvas'),root=path.resolve(__dirname,'..'),out=process.argv[2];if(!out)throw Error('Output directory required');fs.mkdirSync(out,{recursive:true});
const context={console,performance,setTimeout(){},clearTimeout(){},addEventListener(){},document:{getElementById:()=>({classList:{add(){}}}),createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
for(const name of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context,{filename:name+'.js'});
const G=context.G;G.autosave=()=>{};G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
(async()=>{
 for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(x=>x.endsWith('.png')))G.SPR.map.set(file.slice(0,-4),await loadImage(path.join(folder,file)));}
 assert(G.newGame(17,{climate:'fair',preserveSaves:true}).ok);const w=G.world;
 const report=[];
 for(const winter of [false,true])for(const zoom of [1,2]){
  const cv=createCanvas(1100,620),ctx=cv.getContext('2d');ctx.fillStyle=winter?'#e5e9e2':'#a8b77b';ctx.fillRect(0,0,1100,620);G.game.season=winter?3:1;
  ctx.fillStyle='#253f36';ctx.font='20px sans-serif';ctx.fillText('Production drawTree | '+(winter?'WINTER':'SUMMER')+' | zoom '+zoom,24,32);
  ctx.save();ctx.translate(20,80);ctx.scale(zoom,zoom);
  for(let family=0;family<2;family++)for(let stage=0;stage<3;stage++){
   const t={x:0,y:0,b:G.game.day-[0,G.TREE_YOUNG,G.TREE_MATURE][stage]},x=70+stage*(220/zoom),y=110+family*(230/zoom);
   ctx.save();ctx.translate(x,y-16);G.drawTree(ctx,t,{variant:!!family,scale:1});ctx.restore();
   ctx.strokeStyle='#385f50';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(x-32,y);ctx.lineTo(x,y-16);ctx.lineTo(x+32,y);ctx.lineTo(x,y+16);ctx.closePath();ctx.stroke();
   ctx.fillStyle='#253f36';ctx.font=(12/zoom)+'px sans-serif';ctx.fillText((family?'willow':'broadleaf')+' '+['sapling','young','mature'][stage],x-24,y+25);
  }
  ctx.restore();fs.writeFileSync(path.join(out,(winter?'winter':'summer')+'-z'+zoom+'.png'),cv.toBuffer('image/png'));
 }
 // Mixed real-frame fixture: retain generated terrain, households and citizens.
 let b=w.buildings.find(b=>b.type==='house');const center=w.buildings[0];
 for(let radius=2;radius<16&&!b;radius++)for(let dx=-radius;dx<=radius&&!b;dx++)for(let dy=-radius;dy<=radius&&!b;dy++){const r=G.addBuilding('house',center.x+dx,center.y+dy,{instant:true,free:true});if(r.ok)b=r.b;}assert(b,'valid house site required');
 for(let i=0;i<w.trees.length;i++)w.trees[i].b=G.game.day-[0,G.TREE_YOUNG,G.TREE_MATURE][i%3];
 // Place a few actual juvenile trees around the existing settlement where legal.
 for(let dx=-5;dx<=5;dx++)for(let dy=-5;dy<=5;dy++)if((dx+dy)%3===0)G.addTree(w,b.x+dx,b.y+dy,G.game.day-((dx-dy)%2?G.TREE_YOUNG:0));
 for(const season of [1,3])for(const z of [1,2]){
  G.game.season=season;const width=1100,height=720;G.cv=createCanvas(width,height);G.cv.clientWidth=width;G.cv.clientHeight=height;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=z;const [x,y]=G.T2S(b.x+1,b.y+1);G.cam.x=width/2-x*z;G.cam.y=height/2+60-y*z;G.groundScale=.5;G.needGround=true;
  const before=JSON.stringify(G.serializeGame());G.frame(0);assert.equal(JSON.stringify(G.serializeGame()),before);
  const file='scene-'+(season===3?'winter':'summer')+'-z'+z+'.png';fs.writeFileSync(path.join(out,file),G.cv.toBuffer('image/png'));report.push({file,saveUnchanged:true,renderer:'production G.frame',browserVerified:false});
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log('4 production drawTree comparison frames and 4 mixed production G.frame scenes; serialized state unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
