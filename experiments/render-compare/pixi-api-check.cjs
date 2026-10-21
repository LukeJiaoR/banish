'use strict';
// Validates locked Pixi object APIs with a stub Application, NOT WebGL rendering.
// Supply a downloaded copy of the exact locked official CDN file. No downloads here.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{createCanvas,Canvas,Image}=require('@napi-rs/canvas');
(async()=>{
 const file=process.argv[2];if(!file)throw Error('Path to exact official Pixi bundle required');
 const bytes=fs.readFileSync(file),lock=JSON.parse(fs.readFileSync(path.join(__dirname,'pixi.lock.json')));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),lock.sha256);
 const context={console,setTimeout,clearTimeout,performance,navigator:{userAgent:'offline-api-check'},HTMLCanvasElement:Canvas,HTMLImageElement:Image,document:{createElement:()=>createCanvas(1,1)}};vm.createContext(context);vm.runInContext(bytes.toString('utf8'),context);const real=context.PIXI;assert.equal(real.VERSION,lock.version);
 let lastApp,failInit=false;
 class Application {
  constructor(){this.stage=new real.Container();this.destroyed=false;this.renderCalls=0;lastApp=this;}
  async init(options){this.options=options;if(failInit)throw Error('deliberate init failure');this.renderer={gl:{}};}
  render(){this.renderCalls++;}
  destroy(){this.destroyed=true;this.stage.destroy({children:true});}
 }
 const PIXI={...real,Application},module=await import(pathToFileURL(path.join(__dirname,'pixi-renderer.mjs')));
 const image=createCanvas(16,16),assets=new Map([['ground:0',image],['tree',image],['mountain_rock',image]]);
 const items=[{kind:'sprite',asset:'ground:0',x:0,y:0,width:100,height:80,crop:[2,2,12,12],bounds:{x0:0,y0:0,x1:100,y1:80}},{kind:'sprite',asset:'tree',x:10,y:20,width:15,height:20,flip:true,bounds:{x0:10,y0:20,x1:25,y1:40}},{kind:'polygon',asset:'mountain_rock',points:[[30,30],[60,30],[60,60]],uv:[[0,0],[64,0],[64,64]],bounds:{x0:30,y0:30,x1:60,y1:60}}];
 const renderer=await module.PixiRenderer.create(PIXI,createCanvas(960,600),items,assets);
 assert.equal(lastApp.options.preference,'webgl');assert.equal(lastApp.options.autoStart,false);assert.equal(renderer.nodes.length,3);assert(renderer.nodes[1].scale.x<0);assert.equal(renderer.geometry[0].indices.length,3);
 const sources=[...new Set([...renderer.textures.values()].map(t=>t.source))];let uploads=0;for(const s of sources){const update=s.update;s.update=function(...args){uploads++;return update.apply(this,args);};}
 for(let i=0;i<10;i++)renderer.render({x:i,y:i,z:1});assert.equal(uploads,0);assert.equal(lastApp.renderCalls,10);
 const geometry=renderer.geometry[0];renderer.destroy();renderer.destroy();assert(lastApp.destroyed);assert.equal(geometry.buffers,null);assert(sources.every(s=>s.destroyed));
 const Broken={...PIXI,Mesh:class{constructor(){throw Error('deliberate mesh failure');}}};await assert.rejects(()=>module.PixiRenderer.create(Broken,createCanvas(960,600),items,assets),/deliberate mesh failure/);assert(lastApp.destroyed);
 failInit=true;await assert.rejects(()=>module.PixiRenderer.create(PIXI,createCanvas(960,600),items,assets),/deliberate init failure/);assert(lastApp.stage.destroyed);
 console.log('PASS locked Pixi8.22 native texture/sprite/mesh APIs, zero per-render source.update calls, repeat disposal and partial-init cleanup. Application stub: no WebGL/browser/performance claim.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
