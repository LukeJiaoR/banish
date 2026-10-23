/* Independent regression for continuous animal feet, stable slots and gait states.
 * Node contracts, not a substitute for actual Canvas temporal evidence.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadGame}=require('./helpers/playability'),root=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'..');
const G=loadGame(root);assert(G.newGame(731).ok);
vm.runInNewContext(fs.readFileSync(path.join(root,'js/render.js'),'utf8'),{G,document:{},console});
const plain=x=>JSON.parse(JSON.stringify(x));let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('ok '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
function near(a,b,label='value'){assert(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);}
function time(s){G.game.day=Math.floor(s*G.HOURS_PER_SEC/G.DAY_H);G.game.h=s*G.HOURS_PER_SEC%G.DAY_H;}
function deer(id=1){return {id,x:10,y:10,route:[],progress:0,returnDay:null};}
function exact(d){const p=G.deerDisplayPoint(d),q=G.deerPosition(d);near(p.x,q.x,'foot x');near(p.y,q.y,'foot y');return p;}
function pen(w,h,type,count){return {id:42,x:5,y:5,w,h,type:'pasture',state:'ok',animalType:type,animals:count,pastureSize:[w,h]};}
function points(b){return G.pastureAnimalSpots(b).map((p,i)=>G.pastureAnimalPoint(b,p,i));}

test('deer first route, final node and restart never add a cosmetic position offset',()=>{
 for(let id=1;id<=24;id++){const d=deer(id);for(let s=0;s<12;s+=.23){time(s);exact(d);d.route=[{x:11,y:10}];d.progress=0;exact(d);d.progress=.999999;const before=exact(d);d.x=11;d.route=[];d.progress=0;const after=exact(d);assert(Math.hypot(after.x-before.x,after.y-before.y)<.000002);d.x=10;}}
});
test('gait starts only from actual displacement, stops on blocked route, restarts and retains facing',()=>{
 const d=deer();d.route=[{x:11,y:10}];time(40);assert.equal(exact(d).pose.moving,false);time(40.1);d.progress=.14;let p=exact(d);assert.equal(p.pose.moving,true);assert.equal(p.pose.flip,true);const face=p.pose.flip;
 time(40.2);p=exact(d);assert.equal(p.pose.moving,false);assert.equal(p.pose.frame,0);assert.equal(p.pose.flip,face);
 time(40.3);d.progress=.28;p=exact(d);assert.equal(p.pose.moving,true);assert.equal(p.pose.flip,face);
});
test('four route directions follow projected horizontal direction, not x+y',()=>{
 for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]]){const d=deer();d.route=[{x:10+dx,y:10+dy}];time(50);exact(d);time(50.1);d.progress=.2;const p=exact(d);assert.equal(p.pose.flip,dx-dy>0);}
});
test('same-clock repeated draw/pause and camera scale do not mutate pose or footpoint',()=>{
 const d=deer();d.route=[{x:11,y:10}];time(60);exact(d);time(60.1);d.progress=.2;const p=plain(exact(d));G.game.paused=true;
 for(const z of [.75,1,2]){G.cam.z=z;for(let i=0;i<10;i++)assert.deepEqual(plain(exact(d)),p);}
 G.game.paused=false;time(60.2);d.progress=.4;assert.equal(exact(d).pose.moving,true);
});
test('render frame partition has the same feet and distance phase on a straight route',()=>{
 const a=deer(1),b=deer(2);a.route=b.route=[{x:11,y:10}];time(70);exact(a);exact(b);
 for(let i=1;i<=9;i++){time(70+i*.01);a.progress=i*.071;exact(a);}b.progress=.639;const pa=exact(a),pb=exact(b);near(pa.x,pb.x);near(pa.y,pb.y);assert.equal(pa.pose.frame,pb.pose.frame);assert.equal(pa.pose.flip,pb.pose.flip);
});
test('real legal deer movement is time bounded across speeds, frame durations and edge completion',()=>{
 const original={world:G.world,game:G.game,habitat:G.deerHabitat,candidates:G.deerCandidates,edge:G.walkEdgeAllowed};
 try{for(const speed of [1,2,5])for(const dt of [1/60,1/30,.1]){
  const d=deer();d.route=Array.from({length:40},(_,i)=>({x:11+i,y:10}));d.herdId=1;d.moveDay=100;
  G.world={deer:[d],citizens:[],trees:[],wildlife:{v:2,lastTime:0,nextBirthDay:100,herds:[{id:1,x:10,y:10,nextMoveDay:100}]}};
  G.game={day:0,h:0,speed};G.deerCandidates=()=>[];G.walkEdgeAllowed=()=>true;G.deerHabitat=()=>true;
  let previous=exact(d);for(let i=0;i<100;i++){const seconds=(i+1)*dt*speed;time(seconds);G.advanceDeer();const current=exact(d),distance=Math.hypot(current.x-previous.x,current.y-previous.y);assert(distance<=dt*speed*G.HOURS_PER_SEC*.7+1e-8);previous=current;}
 }}finally{Object.assign(G,{world:original.world,game:original.game,deerHabitat:original.habitat,deerCandidates:original.candidates,walkEdgeAllowed:original.edge});}
});
test('area pen birth/removal preserves every surviving index and every species capacity',()=>{
 time(80);for(const [w,h]of [[7,7],[7,20],[20,7],[20,20]])for(const type of ['sheep','cattle','chicken']){
  const b=pen(w,h,type,0),capacity=G.pastureCapacity(b);let previous=[];
  for(let n=1;n<=capacity;n++){b.animals=n;const current=plain(points(b));assert.equal(current.length,n);assert.deepEqual(current.slice(0,n-1),previous);previous=current;}
  b.animals=Math.floor(capacity/2);assert.deepEqual(plain(points(b)),previous.slice(0,b.animals));
 }
});
test('all pen clocks retain fence and shelter bounds and include genuine rest plus multiple gait frames',()=>{
 for(const type of ['sheep','cattle','chicken']){const b=pen(7,20,type,4),frames=new Set();let resting=false,moving=false;
  for(let s=0;s<=24;s+=.04){time(s);for(const p of points(b)){assert(p.x>=b.x+.55&&p.x<=b.x+b.w-.55);assert(p.y>=b.y+.55&&p.y<=b.y+b.h-.55);assert(!(p.x<b.x+3.4&&p.y<b.y+3.4));if(p.pose.moving){moving=true;frames.add(p.pose.frame);}else resting=true;}}
  assert(moving&&resting);assert(frames.size>=3);
 }
});
test('offscreen re-entry, midnight and save reload preserve authoritative deer feet',()=>{
 const d=deer();d.route=[{x:11,y:10}];time(11.999);exact(d);time(12.001);d.progress=.0028;exact(d);
 time(19);d.x=15;d.route=[{x:16,y:10}];d.progress=.7;const p=exact(d);const reloaded=plain(d);const q=exact(reloaded);near(p.x,q.x);near(p.y,q.y);
 assert(G.newGame(731).ok);const before=plain({deer:G.world.deer,wildlife:G.world.wildlife,res:G.game.res});const saved=plain(G.serializeGame());G.applySaveData(saved);assert.deepEqual(plain({deer:G.world.deer,wildlife:G.world.wildlife,res:G.game.res}),before);
 for(const animal of G.world.deer)exact(animal);
});
test('render poses and reduced motion consume no RNG and change no serialized ecology/economy',()=>{
 const before=plain(G.serializeGame()),rng=G.rng,reduced=G.buildingReducedMotion;G.rng=()=>{throw Error('render consumed RNG');};
 try{for(let i=0;i<10;i++){for(const d of G.world.deer)exact(d);for(const type of ['sheep','cattle','chicken'])points(pen(7,7,type,3));}assert.deepEqual(plain(G.serializeGame()),before);
  G.buildingReducedMotion=()=>true;for(const d of G.world.deer){const p=exact(d);assert.equal(p.pose.moving,false);assert.equal(p.pose.frame,0);assert.equal(p.pose.bob,0);}
 }finally{G.rng=rng;G.buildingReducedMotion=reduced;}
});

test('turn presentation lasts across frames, holds on pause and exits after its duration',()=>{
 const d=deer();d.route=[{x:11,y:10}];time(90);exact(d);time(90.1);d.progress=.2;exact(d);
 time(90.2);d.progress=.1;let p=exact(d);assert.equal(p.pose.turning,true);assert.equal(p.pose.flip,false);
 G.game.paused=true;for(let i=0;i<10;i++)assert.deepEqual(plain(exact(d)),plain(p));G.game.paused=false;
 time(90.3);d.progress=.05;assert.equal(exact(d).pose.turning,true);time(90.5);assert.equal(exact(d).pose.turning,false);
});
test('reborn wildlife slot does not replay the previous generation movement',()=>{
 const d=deer();d.generation=0;time(100);exact(d);time(100.1);d.x+=.2;exact(d);
 d.generation++;d.x=40;d.y=40;time(120);const p=exact(d);assert.equal(p.pose.moving,false);assert.equal(p.pose.frame,0);
});
test('complete animation families switch atomically and missing downloads retain original fallback',()=>{
 const original={sprDraw:G.sprDraw,SPR:G.SPR},map=new Map(),calls=[];
 try{G.SPR={get:name=>map.get(name)};G.sprDraw=(_ctx,name,x,y,opt)=>{calls.push({name,x,y,opt});return [opt.w,opt.w];};
 for(const species of ['sheep','cattle','chicken','deer']){
  const suffixes=['_idle','_graze','_turn','_walk_0','_walk_1','_walk_2','_walk_3'];
  const draw=pose=>{G.drawAnimatedAnimal({},species,123,456,pose,26);const last=calls.at(-1);assert.equal(last.x,123);near(last.y,last.name===species?456:456+26*2/128,'shared feet anchor');assert.equal(last.opt.w,26);return last.name;};
  for(const suffix of suffixes){assert.equal(draw({moving:true,frame:2}),species);map.set(species+suffix,{width:128});}
  for(let i=0;i<4;i++)assert.equal(draw({moving:true,frame:i}),species+'_walk_'+i);
  assert.equal(draw({moving:false,idleFrame:0}),species+'_idle');assert.equal(draw({moving:false,idleFrame:1}),species+'_graze');assert.equal(draw({moving:true,frame:3,turning:true}),species+'_turn');
  map.delete(species+'_walk_2');for(let i=0;i<4;i++)assert.equal(draw({moving:true,frame:i}),species);
 }
 }finally{G.sprDraw=original.sprDraw;G.SPR=original.SPR;}
});
test('actual sprite loader registers all 28 frames and only exposes successful downloads',()=>{
 const loaded={},requests=[];class Image{set src(value){this.path=value;requests.push(this);}}
 vm.runInNewContext(fs.readFileSync(path.join(root,'js/sprites.js'),'utf8'),{G:loaded,Image,console});
 const animalRequests=requests.filter(im=>/assets\/props\/(deer|sheep|cattle|chicken)_(idle|graze|turn|walk_[0-3])\.png$/.test(im.path));assert.equal(animalRequests.length,28);
 for(const im of animalRequests){assert(fs.existsSync(path.join(root,im.path)));const name=path.basename(im.path,'.png');assert(!loaded.SPR.get(name));im.width=128;im.height=128;im.onload();assert.equal(loaded.SPR.get(name),im);}
 const failed=requests.find(im=>im.path==='assets/props/deer.png');failed.onerror();assert(!loaded.SPR.get('deer'));assert(loaded.SPR.failed.includes('deer'));
});
(async()=>{
 const {createCanvas,loadImage}=require('@napi-rs/canvas');
 for(const species of ['sheep','cattle','chicken','deer']){
  try{
   const names=['idle','graze','turn','walk_0','walk_1','walk_2','walk_3'];
   const images=await Promise.all(names.map(n=>loadImage(path.join(root,'assets/props',species+'_'+n+'.png'))));
   const width=images[0].width,height=images[0].height,canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
   assert(width>0&&height>0);const pixels=images.map(im=>{assert.equal(im.width,width);assert.equal(im.height,height);ctx.clearRect(0,0,width,height);ctx.drawImage(im,0,0);return ctx.getImageData(0,0,width,height).data;});
   const hash=buffer=>require('node:crypto').createHash('sha256').update(buffer).digest('hex');assert.equal(new Set(pixels.map(hash)).size,7,'all seven poses must contain distinct pixels');
   for(let a=3;a<7;a++)for(let b=a+1;b<7;b++){
    let legChanges=0;for(let y=Math.floor(height*.62);y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if((pixels[a][i+3]||pixels[b][i+3])&&pixels[a].slice(i,i+4).some((v,k)=>v!==pixels[b][i+k]))legChanges++;}
    assert(legChanges>4,`${species} gait ${a-3}/${b-3} needs distinct visible lower-limb pixels`);
   }
   passed++;console.log('ok '+species+' seven same-size PNG poses and lower-limb gait differences');
  }catch(e){failed++;console.error('FAIL '+species+' actual animation assets\n'+e.stack);}
 }
 console.log(`Animal animation: ${passed} passed, ${failed} failed.`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
