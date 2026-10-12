/* Offline production drawing contracts; not browser/mobile acceptance. */
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),context={console,document:{},addEventListener(){},setTimeout(){},clearTimeout(){}};context.window=context;vm.createContext(context);
for(const n of ['core','defs','map','sim','sprites','render'])vm.runInContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),context);
const G=context.G;G.game=G.newGameState();G.cam={z:1};let passed=0;const test=(n,f)=>{f();passed++;console.log('ok '+n);};
const field=(w=7,h=7,legacy=false)=>{const b={id:1,type:'cemetery',state:'ok',x:3,y:4,w,h,workers:[],...(legacy?{}:{cemeterySize:[w,h]})};b.graves=Array.from({length:G.cemeteryCapacity(b)},(_,slot)=>({slot,name:'村民',deathDay:0,expiresDay:192}));return b;};
const parts=(b,bounds)=>{const p=[];G.addEconomyFieldParts(p,b,bounds);return p;};
const canvas=()=>{const calls=[];return {calls,ctx:new Proxy({},{get:(o,k)=>o[k]||((...a)=>calls.push([k,...a])),set:(o,k,v)=>(o[k]=v,true)})};};
test('all196 cemetery shapes draw exactly their real slot counts and unique owned cells',()=>{
 for(let w=7;w<=20;w++)for(let h=7;h<=20;h++){const b=field(w,h),a=parts(b).filter(p=>p.kind==='grave');assert.equal(a.length,(w-4)*Math.floor((h-1)/2));assert.equal(new Set(a.map(p=>Math.floor(p.x)+','+Math.floor(p.y))).size,a.length);for(const [i,p]of a.entries()){const q=G.cemeteryGravePoint(b,i);assert.equal(p.x,q.x);assert.equal(p.y,q.y);assert(p.x>b.x&&p.x<b.x+w);assert(p.y>b.y&&p.y<b.y+h);assert.equal(p.d,p.x+p.y+.01);}}
});
test('orientation changes capacity while old8 display feet remain unchanged',()=>{
 assert.equal(parts(field(7,8)).filter(p=>p.kind==='grave').length,9);assert.equal(parts(field(8,7)).filter(p=>p.kind==='grave').length,12);
 const b=field(4,4,true),a=parts(b).filter(p=>p.kind==='grave');assert.equal(a.length,8);for(const [i,p]of a.entries()){assert.equal(p.x,b.x+.85+(i%2)*1.7);assert.equal(p.y,b.y+.5+Math.floor(i/2)*.85);}
});
test('remnants retain original feet and draw only one16px grave without any fence or whole-yard ground',()=>{
 for(const legacy of [true,false]){const source=field(legacy?4:7,legacy?4:7,legacy),point=G.cemeteryGravePoint(source,0),b={id:10,type:'graveremnant',state:'ok',x:Math.floor(point.x),y:Math.floor(point.y),w:1,h:1,grave:{...source.graves[0]},graveSource:{id:source.id,x:source.x,y:source.y,w:source.w,h:source.h,...(source.cemeterySize?{cemeterySize:source.cemeterySize}:{})}};
  const a=parts(b);assert.equal(a.length,1);assert.equal(a[0].kind,'grave');assert.equal(a[0].x,point.x);assert.equal(a[0].y,point.y);const calls=[],draw=G.sprDraw;G.sprDraw=(...x)=>{calls.push(x);return true;};const before=JSON.stringify(b);G.drawBuilding(canvas().ctx,b,0);G.sprDraw=draw;assert.equal(calls.length,1);assert.equal(calls[0][1],'grave');assert.equal(calls[0][4].w,16);assert.equal(JSON.stringify(b),before);
  G.game.day=192;assert.equal(parts(b).length,0);G.game.day=0;
 }
});
test('preview marks actual slots; bad sizes outline only, all drawing read-only',()=>{
 const N=48;G.world={N,buildings:[],water:new Uint8Array(N*N),rock:new Uint8Array(N*N),bgrid:new Int32Array(N*N).fill(-1)};G.isCemeteryPlanning=()=>true;G.farmBounds=p=>({x:Math.min(p.start.x,p.end.x),y:Math.min(p.start.y,p.end.y),w:Math.abs(p.start.x-p.end.x)+1,h:Math.abs(p.start.y-p.end.y)+1});G.game.res.stone=1000;
 for(const [w,h]of [[7,7],[7,8],[8,7],[20,20],[6,7],[7,21]]){G.cemeteryPlan={world:G.world,start:{x:3,y:3},end:{x:3+w-1,y:3+h-1}};const before=JSON.stringify([G.game,G.world]),c=canvas();G.drawCemeteryPlan(c.ctx);const valid=w>=7&&w<=20&&h>=7&&h<=20,count=valid?(w-4)*Math.floor((h-1)/2):0;assert.equal(c.calls.filter(x=>x[0]==='ellipse').length,count);assert.equal(c.calls.filter(x=>x[0]==='fill').length,valid?w*h+count:1);assert.equal(JSON.stringify([G.game,G.world]),before);}
});
test('original grave PNG stays byte-identical and32x34 at16px runtime width',()=>{
 const p='assets/props/grave.png',bytes=fs.readFileSync(path.join(root,p));
 assert.equal(crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'),'47309b83ab66bee28bf6990b14165424d866ec78');assert.equal(bytes.readUInt32BE(16),32);assert.equal(bytes.readUInt32BE(20),34);assert.equal(G.SPRITE_SIZES.grave.w,16);
});
console.log(`Cemetery area render: ${passed} offline suites passed.`);
