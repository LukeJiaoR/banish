import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {SOURCE_FILES,immutableCopy,canonical,buildCommands,splitGround,cameraAt} from './scene.mjs';
import {CanvasRenderer} from './canvas-renderer.mjs';import {ProductionReference} from './production-reference.mjs';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
function loadGame(document){const c={console,performance,setTimeout(){return 1;},clearTimeout(){},addEventListener(){},document,localStorage:{getItem(){throw Error('Unexpected save read');}},matchMedia:()=>({matches:true})};c.window=c;vm.createContext(c);for(const name of SOURCE_FILES)vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),c);return c.G;}
process.env.OFFLINE_RENDER_OUT ||= '/tmp/banish-pixi-offline';
// Optional actual OFFLINE Canvas evidence. A small presentation fixture bounds
// native memory. It does not prove full-map/browser/Pixi GPU behavior.
if(process.env.OFFLINE_RENDER_OUT){
  const {createCanvas,loadImage}=require('@napi-rs/canvas'),out=path.resolve(process.env.OFFLINE_RENDER_OUT);fs.mkdirSync(out,{recursive:true});
  const G=loadGame({createElement:()=>createCanvas(1,1)});
  for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(f=>f.endsWith('.png')))G.SPR.map.set(file.slice(0,-4),await loadImage(path.join(folder,file)));}
  for(const season of [1,3]) {
    const w=G.emptyWorld(0,2,24);G.world=w;G.game=G.newGameState();G.game.paused=true;G.game.h=10;G.game.season=season;G.rng=G.makeRng(0);G.setUid(1);
    for(let y=1;y<10;y++)for(let x=1;x<13;x++)if(x+y<17)w.mountain[y*w.N+x]=1;
    for(let y=15;y<22;y++)for(let x=3;x<9;x++)w.water[y*w.N+x]=1;
    for(let y=9;y<20;y++)for(let x=10;x<22;x++)if(G.h2(42,x,y)>.64&&!G.isMountain(w,x,y)&&!(x>=11&&x<=13&&y>=11&&y<=13))G.addTree(w,x,y,-180);
    w.start={x:13,y:13};const building=G.addBuilding('storage',11,11,{instant:true,free:true});assert.equal(building.ok,true);G.spawnCitizen({x:14,y:13,sex:'m',age:30});G.spawnCitizen({x:14,y:14,sex:'f',age:7});w.deer=[{id:25,x:18,y:16,returnDay:null}];
    G.world=immutableCopy(G.world);G.game=immutableCopy(G.game);G.tool=null;G.sel=null;G.hover={tx:-1,ty:-1};G.smoke=[];G.flakes=[];
    const before=JSON.stringify(canonical({world:G.world,game:G.game}));G.groundScale=.5;G.needGround=true;G.buildGround();const ground=splitGround(G,()=>createCanvas(1,1)),scene=buildCommands(G),items=[...ground.items,...scene.items],assets=new Map(ground.assets);for(const i of items)if(i.asset&&!assets.has(i.asset))assets.set(i.asset,G.SPR.get(i.asset));
    const canvas=createCanvas(960,600),renderer=new CanvasRenderer(canvas,items,assets);G.cam=cameraAt(G.world,'village');renderer.render(G.cam);const label=`microfixture24-s${season}`;fs.writeFileSync(path.join(out,label+'-shared.png'),canvas.toBuffer('image/png'));
    const referenceCanvas=createCanvas(960,600),reference=new ProductionReference(G,G.world,G.game,referenceCanvas);reference.render(G.cam);reference.render(G.cam);fs.writeFileSync(path.join(out,label+'-production.png'),referenceCanvas.toBuffer('image/png'));
    assert(reference.world.citizens.some(c=>c._psx!==undefined));assert.equal(before,JSON.stringify(canonical({world:G.world,game:G.game})));assert.equal(G.world.citizens.some(c=>c._psx!==undefined),false);
    console.log('PASS offline actual G.frame twice, isolated presentation fields, season',season);
  }
}
