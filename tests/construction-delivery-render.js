/* Existing sprite dispatch/scale contracts; not visual browser acceptance. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),ctx={console,document:{},addEventListener(){},setTimeout(){},clearTimeout(){}};ctx.window=ctx;vm.createContext(ctx);
for(const name of ['core','defs','map','sim','sprites','render'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),ctx);
const G=ctx.G;G.game=G.newGameState();G.cam={z:1};G.world={N:32,bgrid:new Int32Array(1024).fill(-1),bmap:{},buildings:[],families:[],cmap:{},citizens:[]};
G.citizenIndoorHome=()=>null;G.inMedicalCare=G.inSchool=G.inChapel=()=>false;let passed=0;
const canvas=new Proxy({},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
function draw(state,task,carry){const calls=[],c={id:1,x:10,y:10,age:30,animT:0,state,task,carry,job:null,familyId:null,pi:0,path:[{x:11,y:10}]};G.sprDraw=(_,name,x,y,opt)=>{calls.push({name,x,y,opt});return true;};G.drawCitizen(canvas,c,0,[]);return calls;}
function test(name,fn){fn();passed++;console.log('ok '+name);}
test('fetching uses existing idle pose rather than hammer work',()=>{const calls=draw('work',{kind:'constructionMaterial',phase:'fetch'},null);assert.equal(calls[0].name,'adult_idle');});
test('real wood stone and iron deliveries retain original carry frames and relative scale',()=>{for(const type of ['wood','stone','iron']){const cargo={type,qty:20,constructionId:3,staffingReturn:true};for(const state of ['walk','work']){const calls=draw(state,{kind:'constructionMaterial',phase:'deliver'},cargo);assert.equal(calls[0].name,state==='walk'?'adult_carry_walk_0':'adult_carry_idle');assert.equal(calls[1].name,'carry_'+type);assert.equal(calls[1].opt.w,10);assert.equal(calls[1].opt.flip,calls[0].opt.flip);assert.equal(G.SPRITE_SIZES[calls[0].name].h,17);}}});
test('returning cargo keeps carry pose and actual builders retain their original tool pose',()=>{assert.equal(draw('haul',null,{type:'wood',qty:8,constructionId:3,constructionReturn:true,staffingReturn:true})[0].name,'adult_carry_walk_0');assert.equal(draw('work',{kind:'build'},null)[0].name,'adult_work_0');});
console.log(`Construction render: ${passed} offline sprite-dispatch contracts passed.`);
