'use strict';
// The tiny fake ground image is deliberately warm; cache allocation is tested separately.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const {loadGame}=require('./helpers/playability');
function fixture(){
 const G=loadGame(root);G.newGame(65);const w=G.world;
 w.water.fill(0);w.rock.fill(0);w.treeIdx.fill(-1);w.trees=[];w.citizens=[];w.cmap={};w.families=[];w.buildings=[];w.bmap={};w.bgrid.fill(-1);w.markedRocks.clear();
 const context={G,performance,document:{},setTimeout(){},clearTimeout(){}};vm.createContext(context);vm.runInContext(fs.readFileSync(root+'/js/render.js','utf8'),context);
 const fills=[],outline=[],props={};let points=[];
 G.ctx=new Proxy({}, {get:(_,k)=>k==='beginPath'?()=>{points=[]}:k==='moveTo'||k==='lineTo'?(x,y)=>points.push([x,y]):k==='fill'?()=>fills.push(props.fillStyle):k==='stroke'?()=>{if(props.strokeStyle==='#d54130' && props.lineWidth===2)outline.push(points.slice())}:()=>{},set:(_,k,v)=>{props[k]=v;return true}});
 G.cv={clientWidth:800,clientHeight:600};G.dpr=1;G.cam={z:1,x:400,y:-100};G.hover={tx:-1,ty:-1};G.needGround=false;G.groundDirty=new Set();G._gcv={width:1,height:1};G.groundScale=1;G._groundWorld=G.world;G._groundScale=G.groundScale;G.updateParticles=()=>{};G.ui.refreshHarvest=()=>{};G.foodForestBounds=()=>[];G.game.h=12;G.game.season=1;
 G.tool={kind:'quarry'};w.rock[10*w.N+10]=1;w.rock[11*w.N+11]=2;G.beginHarvestRange(10,10);G.finishHarvestRange(11,11);G.finishHarvestRange=()=>{throw Error('render must not enumerate range')};G.findPath=()=>{throw Error('render must not pathfind')};return{G,w,fills,outline};
}
let passed=0;function test(n,f){f();passed++;console.log('ok '+n)}
test('outline encloses complete inclusive diamond rectangle and each visible captured mineral highlights once',()=>{
 const{G,fills,outline}=fixture();G.frame(0);assert.equal(fills.filter(c=>c==='rgba(213,65,48,.48)').length,2);assert.deepEqual(outline[0],[[0,320],[64,352],[0,384],[-64,352]]);
});
test('offscreen targets do not draw; drawing retains constant-size outline only',()=>{const{G,fills,outline}=fixture();G.cam.x=100000;G.frame(0);assert.equal(fills.filter(c=>c==='rgba(213,65,48,.48)').length,0);assert.equal(outline[0].length,4)});
test('queued targets remain red in selection and drawing never changes resource, mark or snapshot state',()=>{
 const{G,w,fills}=fixture();w.markedRocks.add(10*w.N+10);const before=JSON.stringify({res:G.game.res,rock:[...w.rock],marks:[...w.markedRocks],targets:G.harvestPlan.targets});G.frame(0);assert.equal(fills.filter(c=>c==='rgba(213,65,48,.48)').length,2);assert.equal(JSON.stringify({res:G.game.res,rock:[...w.rock],marks:[...w.markedRocks],targets:G.harvestPlan.targets}),before);
});
test('eligible highlights appear before selection and filter stone versus iron',()=>{
 const{G,w,fills}=fixture();G.cancelHarvestPlan();G.tool={kind:'collectstone'};G.frame(0);assert.equal(fills.filter(c=>c==='rgba(69,151,116,.16)').length,1);
 fills.length=0;G.tool={kind:'collectiron'};G.frame(0);assert.equal(fills.filter(c=>c==='rgba(69,151,116,.16)').length,1);
 fills.length=0;G.tool={kind:'fell'};G.frame(0);assert.equal(fills.filter(c=>c==='rgba(69,151,116,.16)').length,0);
});
test('cancel highlights only marked resources and orange designation is a crossed pair',()=>{
 const{G,w,fills}=fixture();G.cancelHarvestPlan();w.markedRocks.add(10*w.N+10);G.tool={kind:'cancelremoval'};G.frame(0);assert.equal(fills.filter(c=>c==='rgba(69,151,116,.16)').length,1);
 const points=[],props={};G.drawResourceDesignation({save(){},restore(){},beginPath(){},moveTo(x,y){points.push([x,y])},lineTo(x,y){points.push([x,y])},stroke(){},set strokeStyle(v){props.color=v},set lineWidth(v){props.width=v}},10,20);assert.deepEqual(points,[[3,17],[17,23],[17,17],[3,23]]);assert.equal(props.color,'#efa447');
});
console.log(`Harvest range render: ${passed} passed (trace, not browser acceptance)`);
