'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={console};c.window=c;vm.createContext(c);for(const n of ['core','defs','map','sim','render'])vm.runInContext(fs.readFileSync(__dirname+'/../js/'+n+'.js','utf8'),c);
const G=c.G;let count=0;function test(n,f){f();count++;console.log('PASS '+n);}
function unpack(a){return Array.from({length:a.length/5},(_,i)=>({p:[a[i*5],a[i*5+1]],normal:[a[i*5+2],a[i*5+3]],width:a[i*5+4]}));}
function w(){const w=G.emptyWorld(0,0,16);for(let y=0;y<16;y++)for(let x=8;x<16;x++)w.water[y*16+x]=1;return w;}
test('bank samples are cached, deterministic and never rewrite the shared coast',()=>{
 const world=w(),state=JSON.stringify(world),top=G.coastPresentation.topology(world),shape=JSON.stringify(top),r=top.shore[0];
 const a=G.coastPresentation.bankSamples(r,16);assert.equal(a.byteLength,a.length*8);assert.equal(a.length%5,0);assert(a.length<=(r.points.length*6+4)*5);assert.equal(a,G.coastPresentation.bankSamples(r,16));assert.equal(JSON.stringify(top),shape);assert.equal(JSON.stringify(world),state);
 const other=G.coastPresentation.topology(w()).shore[0];assert.equal(JSON.stringify(a),JSON.stringify(G.coastPresentation.bankSamples(other,16)));
});
test('width field is bounded, varied and world-anchored rather than restarted at tile edges',()=>{
 const route={points:[[8,0],[8,4],[8,8],[8,12],[8,16]],closed:false};
 const samples=unpack(G.coastPresentation.bankSamples(route,16)),widths=samples.map(s=>s.width);assert(Math.min(...widths)>=1.5);assert(Math.max(...widths)<=10.5);assert(Math.max(...widths)-Math.min(...widths)>5);
 for(const s of samples){assert(s.p.every(Number.isFinite));assert(s.normal.every(Number.isFinite));const v=.5+.5*Math.sin(s.p[0]*.031+s.p[1]*.017+1.2*Math.sin(s.p[1]*.043-s.p[0]*.012));assert.equal(s.width,1.5+9*v*v);}
});
test('closed islands, single ponds, diagonal contacts and map exits produce finite cached bands',()=>{
 for(const cells of [[[5,5]],[[5,5],[6,6]],[[0,0],[1,0]],[[4,4],[5,4],[4,5],[5,5]]]){
  const world=G.emptyWorld(0,0,12);for(const[x,y]of cells)world.water[y*12+x]=1;
  for(const r of G.coastPresentation.topology(world).shore){const a=G.coastPresentation.bankSamples(r,12);assert(a.length>1);for(const s of unpack(a))assert([...s.p,...s.normal,s.width].every(Number.isFinite));}
 }
});
test('closed banks cover the closing span with oppositely wound loops',()=>{
 const world=G.emptyWorld(0,0,12);world.water[5*12+5]=1;const routes=G.coastPresentation.topology(world).shore;
 const loops=[];let active=null;const ctx={beginPath(){},moveTo(x,y){active=[[x,y]];loops.push(active);},lineTo(x,y){active.push([x,y]);},closePath(){active.closed=true;}};
 G.coastPresentation.bankPath(ctx,routes,12,1);assert.equal(loops.length,2);assert(loops.every(p=>p.closed));assert.equal(loops[0].length,loops[1].length);
 const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0);
 assert(area(loops[0])*area(loops[1])<0);
});
test('bank sampling never consumes gameplay randomness',()=>{
 vm.runInContext('Math.random=()=>{throw Error("unexpected random stream");}',c);
 for(const r of G.coastPresentation.topology(w()).shore)G.coastPresentation.bankSamples(r,16);
});
async function nativePixels(){
 const {createCanvas,loadImage}=require('@napi-rs/canvas');
 G.SPR={images:new Map(),get(n){return this.images.get(n);}};
 for(const season of G.TEX_SEASON)for(const [prefix,dir]of [['meadow_','terrain-v2'],['sand_','tiles']])G.SPR.images.set(prefix+season,await loadImage(__dirname+'/../assets/'+dir+'/'+prefix+season+'.png'));
 G.SPR.images.set('water_open',await loadImage(__dirname+'/../assets/terrain-v2/water_open.png'));
 G.SPR.images.set('water_winter',await loadImage(__dirname+'/../assets/tiles/water_winter.png'));
 c.document={createElement:()=>createCanvas(1,1)};
 test('native closed-bank pixels do not depend on arbitrary route start vertex',()=>{
  const world=G.emptyWorld(0,0,12);world.water[1*12+1]=1;const route=G.coastPresentation.topology(world).shore[0];
  function pixels(r){const ctx=createCanvas(256,192).getContext('2d');ctx.translate(128,0);ctx.scale(1.5,1.5);G.coastPresentation.bankPath(ctx,[r],12,1);ctx.fillStyle='#ffffff';ctx.fill();return Buffer.from(ctx.getImageData(0,0,256,192).data);}
  const original=pixels(route);assert(original.some(v=>v));
  for(let i=1;i<route.points.length;i++)assert.equal(Buffer.compare(original,pixels({...route,points:[...route.points.slice(i),...route.points.slice(0,i)]})),0);
 });
 test('native road and resource diamonds remain protected in every season',()=>{
  for(const season of [0,1,2,3]){
   const world=w();world.road[5*16+7]=1;world.rock[9*16+7]=2;G.game={season};
   const ctx=createCanvas(1100,600).getContext('2d');ctx.fillStyle='#4b1267';ctx.fillRect(0,0,1100,600);ctx.translate(550,20);
   G.coastPresentation.draw(ctx,world,{x0:0,y0:0,x1:15,y1:15});
   for(const y of [5,9])for(const dx of [.1,.3,.5,.7,.9])for(const dy of [.1,.3,.5,.7,.9]){
    const [x0,y0]=G.T2S(7+dx,y+dy);assert.deepEqual(Array.from(ctx.getImageData(Math.round(x0+550),Math.round(y0+20),1,1).data),[75,18,103,255]);
   }
  }
 });
}
(async()=>{if(process.argv.includes('--pixels'))await nativePixels();console.log(`Shore material: ${count} groups passed`);})().catch(e=>{console.error(e);process.exitCode=1;});
