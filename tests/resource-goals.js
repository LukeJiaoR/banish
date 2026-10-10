'use strict';
const assert=require('node:assert/strict');
const {loadGame}=require('./helpers/playability');
const G=loadGame(require('node:path').resolve(__dirname,'..')); G.newGame(11);
assert.equal(typeof G.setProductionGoal,'function','town-wide goal setter exists');
assert.equal(G.productionGoalOf('wood'),null);
const stock=JSON.stringify(G.game.res);
assert.equal(G.setProductionGoal('wood',20),true);
assert.equal(G.goalPaused('wood'),true);
assert.equal(JSON.stringify(G.game.res),stock,'setting target does not clip inventory');
G.game.res.wood=19; G.updateProductionGoals(); assert.equal(G.goalPaused('wood'),true);
G.game.res.wood=18; G.updateProductionGoals(); assert.equal(G.goalPaused('wood'),false);
G.game.res.wood=19; G.updateProductionGoals(); assert.equal(G.goalPaused('wood'),false);
G.game.res.wood=20; G.updateProductionGoals(); assert.equal(G.goalPaused('wood'),true);
G.setProductionGoal('wood',0); G.game.res.wood=0; G.updateProductionGoals(); assert.equal(G.goalPaused('wood'),true);
for(const value of [-1,NaN,Infinity,'10',1000001]) assert.equal(G.setProductionGoal('wood',value),false);
G.setProductionGoal('wood',null); assert.equal(G.productionGoalOf('wood'),null);
assert.equal(G.goalPaused('wood'),false);
console.log('Resource goals: core thresholds passed');

let pass=0, fail=0;
function test(name, fn){try{fn();pass++;console.log('ok '+name);}catch(e){fail++;console.error('FAIL '+name+'\n'+e.stack);}}
function fixture(){
  const G=loadGame(require('node:path').resolve(__dirname,'..')), N=64;
  G.world={seed:11,N,water:new Uint8Array(N*N),rock:new Uint8Array(N*N),road:new Uint8Array(N*N),bgrid:new Int32Array(N*N).fill(-1),treeIdx:new Int32Array(N*N).fill(-1),trees:[],rockCleared:[],marked:new Set(),markedRocks:new Set(),buildings:[],bmap:{},citizens:[],cmap:{},families:[],start:{x:1,y:1}};
  G.game=G.newGameState(); G.rng=G.makeRng(991); G.setUid(1);
  function building(type,opts={}){const d=G.BDEF[type], n=G.world.buildings.length; const b=Object.assign({id:G.nextId(),type,x:2+n%6*9,y:2+Math.floor(n/6)*10,w:d.w,h:d.h,state:'ok',workers:[],family:null,progress:1,workLeft:0,totalWork:d.buildWork||1,noWork:false,warnText:''},opts);
    if(type==='farm'){b.farm=Array.from({length:b.w*b.h},(_,i)=>({x:b.x+i%b.w,y:b.y+Math.floor(i/b.w),sown:false,harvested:false}));b.sownAll=false;b.growth=0;b.harvestDone=false;}
    G.world.buildings.push(b);G.world.bmap[b.id]=b;for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)G.world.bgrid[y*N+x]=b.id;return b;}
  function citizen(b){const c=G.spawnCitizen({x:1,y:1,age:30,sex:'m',name:'测试'});if(b){c.job=b.id;b.workers.push(c.id);}return c;}
  function trees(b,n=40){let count=0;for(let y=Math.max(0,b.y-5);y<b.y+8&&count<n;y++)for(let x=Math.max(0,b.x-5);x<b.x+8&&count<n;x++)if(G.addTree(G.world,x,y,-200))count++;}
  return {G,building,citizen,trees};
}
const snap=G=>JSON.parse(JSON.stringify(G.serializeGame()));
test('repeated application retains hysteresis in the middle band',()=>{const {G}=fixture();G.game.res.wood=100;G.setProductionGoal('wood',100);G.game.res.wood=95;G.updateProductionGoals();G.setProductionGoal('wood',100);assert.equal(G.goalPaused('wood'),true);});
test('two local cutoffs remain distinct under global min and unset restores old behavior',()=>{
 const {G,building}=fixture(),a=building('woodcutter',{fuelLimit:40}),b=building('woodcutter',{fuelLimit:150});G.game.res.firewood=50;G.setProductionGoal('firewood',100);
 assert.equal(G.effectiveProductionGoal('firewood',a),40);assert.equal(G.effectiveProductionGoal('firewood',b),100);assert.equal(G.fuelLimited(a),true);assert.equal(G.fuelLimited(b),false);
 G.game.res.firewood=39;G.updateProductionGoals();assert.equal(G.fuelLimited(a),true);G.game.res.firewood=36;G.updateProductionGoals();assert.equal(G.fuelLimited(a),false);
 G.setProductionGoal('firewood',null);assert.deepEqual([a.fuelLimit,b.fuelLimit],[40,150]);G.game.res.firewood=39;assert.equal(G.fuelLimited(a),false);
});
test('food pause blocks all continuous producers and urgent recruiting',()=>{
 const {G,building,citizen,trees}=fixture();for(const type of ['gatherer','hunting','dock']){const b=building(type);trees(b);citizen();}
 G.game.res.food=0;G.setProductionGoal('food',0);for(let i=0;i<5;i++)G.scheduleJobs();assert.ok(G.world.buildings.every(b=>b.workers.length===0));
 for(const b of G.world.buildings){assert.equal(G.jobCanProduce(b),false);assert.equal(G.makeTask(b,G.world.citizens[0]),null);}
});
test('wood goal leaves planting on and disables automatic felling',()=>{
 const {G,building,citizen,trees}=fixture(),b=building('forester',{doCut:true,doPlant:true}),c=citizen(b);trees(b,70);G.setProductionGoal('wood',0);
 assert.equal(G.makeTask(b,c).kind,'plant');assert.equal(G.jobCanProduce(b),true);b.doPlant=false;assert.equal(G.makeTask(b,c),null);assert.equal(G.jobCanProduce(b),false);
});
test('mine goals independently switch output without blocking construction',()=>{
 const {G,building,citizen}=fixture(),b=building('mine'),c=citizen(b);G.setProductionGoal('stone',0);G.setProductionGoal('iron',50);G.game.res.iron=0;G.updateProductionGoals();
 for(let i=0;i<8;i++)assert.equal(G.makeTask(b,c).yield.type,'iron');G.setProductionGoal('stone',100);G.setProductionGoal('iron',0);for(let i=0;i<8;i++)assert.equal(G.makeTask(b,c).yield.type,'stone');
 G.setProductionGoal('stone',0);assert.equal(G.makeTask(b,c),null);assert.equal(G.jobCanProduce(b),false);b.state='site';b.workLeft=50;assert.equal(G.productionLimited(b),false);G.requestTask(c);assert.equal(c.task.kind,'build');
});
test('0 food stops unstarted field but not an active or paused first sow task',()=>{
 for(const paused of [false,true]){const {G,building,citizen}=fixture(),b=building('farm'),c=citizen(b);const task=G.makeTask(b,c);assert.equal(task.kind,'sow');c[paused?'pausedTask':'task']=task;
 G.setProductionGoal('food',0);assert.equal(b.sowingCommitted,true);c.task=null;c.pausedTask=null;assert.equal(G.makeTask(b,c).kind,'sow');assert.equal(G.farmHasWork(b),true);
 G.resetFarm(b);assert.equal(G.farmSeasonCommitted(b),false);assert.equal(G.makeTask(b,c),null);assert.equal(G.farmHasWork(b),false);}
});
test('one legacy sown tile commits whole field without inventing growth or harvest',()=>{
 const {G,building,citizen}=fixture(),b=building('farm'),c=citizen(b);b.farm[0].sown=true;G.setProductionGoal('food',0);assert.equal(G.makeTask(b,c).kind,'sow');assert.equal(b.growth,0);assert.equal(b.sownAll,false);
 for(const f of b.farm)f.sown=true;b.sownAll=true;b.growth=1;G.game.season=2;assert.equal(G.makeTask(b,c).kind,'harvest');assert.equal(G.farmHasWork(b),true);
 G.game.day=47;G.game.season=3;G.endDay();assert.equal(G.farmSeasonCommitted(b),false);assert.equal(G.makeTask(b,c),null);
});
test('lower goal preserves active, paused and carry work through scheduler and daily cleanup',()=>{
 for(const mode of ['task','pausedTask','carry']){const {G,building,citizen}=fixture(),b=building('blacksmith',{toolLimit:30}),c=citizen(b);G.game.res.iron=10;
 if(mode==='carry'){c.carry={type:'tools',qty:2};c.state='haul';}else{c[mode]=G.makeTask(b,c);c.state=mode==='task'?'work':'rest';}
 const commitment=c[mode],stocks=JSON.stringify(G.game.res);G.setProductionGoal('tools',0);assert.equal(c[mode],commitment);assert.equal(JSON.stringify(G.game.res),stocks);
 b.noWork=true;G.scheduleJobs();assert.equal(c[mode],commitment);assert.equal(c.job,b.id);b.noWork=true;G.endDay();assert.equal(c[mode],commitment);assert.equal(c.job,b.id);
 }
});
test('accepted smith batch completes after pause then releases normally and can return',()=>{
 const {G,building,citizen}=fixture(),b=building('blacksmith',{toolLimit:30}),c=citizen(b);G.game.res.iron=10;G.game.res.food=1000;c.task=G.makeTask(b,c);c.state='work';const old={...G.game.res};G.setProductionGoal('tools',0);G.completeTask(c);
 assert.equal(G.game.res.tools,old.tools+2);assert.equal(G.game.res.iron,old.iron-1);assert.equal(G.game.res.wood,old.wood-2);G.scheduleJobs();assert.equal(c.job,null);
 G.setProductionGoal('tools',50);G.scheduleJobs();assert.equal(c.job,b.id);assert.ok(c.task);
});
test('configured workers with carried goods cannot become marked-work donors',()=>{
 const {G,building,citizen}=fixture(),b=building('woodcutter',{fuelLimit:100}),c=citizen(b);G.setProductionGoal('firewood',0);c.carry={type:'firewood',qty:3};c.state='haul';
 assert.equal(G.pickMarkDonor(G.world,false,['gatherer','dock','hunting'],0),null);assert.equal(c.carry.qty,3);
});
test('manual tree and stone marks continue while resource goals are zero',()=>{
 for(const type of ['wood','stone','iron']){const {G,citizen}=fixture(),c=citizen();for(const k of G.RES_KEYS)G.setProductionGoal(k,0);
 if(type==='wood'){G.addTree(G.world,3,3,-200);G.world.marked.add(3*64+3);}else{G.world.rock[3*64+3]=type==='iron'?2:1;G.world.markedRocks.add(3*64+3);}
 G.requestTask(c);assert.equal(c.task.kind,type==='wood'?'chop':'clearrock');}
});
test('farm seasonal commitment and global/local middle-band pauses survive owned save roundtrip',()=>{
 const {G,building}=fixture();const cutter=building('woodcutter',{fuelLimit:40}),other=building('woodcutter',{fuelLimit:150}),farm=building('farm');
 G.game.res.firewood=100;G.setProductionGoal('firewood',100);G.game.res.firewood=95;G.updateProductionGoals();G.setProductionGoal('food',200);farm.sowingCommitted=true;
 const d=snap(G),text=JSON.stringify(d);G.applySaveData(d);assert.equal(JSON.stringify(d),text);assert.equal(G.goalPaused('firewood'),true);assert.equal(G.fuelLimited(G.world.bmap[cutter.id]),true);assert.equal(G.fuelLimited(G.world.bmap[other.id]),true);assert.equal(G.world.bmap[farm.id].sowingCommitted,true);
 assert.deepEqual(JSON.parse(JSON.stringify(G.game.productionGoals)),d.game.productionGoals);assert.deepEqual(Array.from(G.world.buildings.filter(b=>b.type==='woodcutter'),b=>b.fuelLimit),[40,150]);
});
test('legacy missing maps and varying building cutoffs are unchanged and input immutable',()=>{
 const {G,building}=fixture();building('woodcutter',{fuelLimit:40});building('woodcutter',{fuelLimit:175});building('blacksmith',{toolLimit:70});const d=snap(G),text=JSON.stringify(d);G.applySaveData(d);assert.equal(JSON.stringify(d),text);assert.equal(G.game.productionGoals,undefined);assert.equal(G.game.productionPaused,undefined);assert.equal(G.world.buildings[0].fuelLimit,40);assert.equal(G.world.buildings[1].fuelLimit,175);assert.equal(G.world.buildings[2].toolLimit,70);
});
test('save validation rejects malformed target maps atomically',()=>{
 const {G}=fixture();for(const goals of [{wood:-1},{wood:NaN},{wood:Infinity},{wood:'50'},{wood:1.5},{wood:1000001},{surprise:2},[]]){const d=snap(G);d.game.productionGoals=goals;const prior=G.game;assert.throws(()=>G.applySaveData(d));assert.equal(G.game,prior);}
 const d=snap(G);d.game.productionGoals={food:100};d.game.productionPaused={food:'yes'};assert.throws(()=>G.applySaveData(d));
});
test('goal beyond storage is not hard capacity; lowering goal never clips cargo or stock',()=>{
 const {G,citizen}=fixture(),c=citizen();G.setProductionGoal('stone',G.storageCap()+100);G.game.res.stone=G.storageCap()-37;c.carry={type:'stone',qty:40};const before=JSON.stringify([G.game.res,c.carry]);G.setProductionGoal('stone',0);assert.equal(JSON.stringify([G.game.res,c.carry]),before);
 assert.equal(G.deposit('stone',40),37);assert.equal(G.game.res.stone,G.storageCap(),'existing hard-cap overflow loss remains separate, not fixed here');
});
test('accepted cutter fetch and processing both continue after zero target',()=>{
 const {G,building,citizen}=fixture(),b=building('woodcutter',{fuelLimit:100}),c=citizen(b);G.game.res.wood=40;G.game.res.firewood=0;const task=G.makeTask(b,c);task.phase='fetch';c.task=task;G.setProductionGoal('firewood',0);G.completeTask(c);assert.equal(c.task,task);assert.equal(task.phase,'work');assert.equal(G.game.res.wood,40);G.completeTask(c);assert.equal(G.game.res.wood,38);assert.equal(G.game.res.firewood,6);G.scheduleJobs();assert.equal(c.job,null);
});
test('resumed target does not create a new teacher or essential-food donor path',()=>{
 const {G,building,citizen,trees}=fixture(),school=building('school'),teacher=citizen(school),food=building('gatherer'),worker=citizen(food),smith=building('blacksmith',{toolLimit:30});trees(food);worker.task=G.makeTask(food,worker);worker.state='work';const task=worker.task;G.game.res.food=0;G.game.res.iron=10;G.setProductionGoal('tools',0);G.setProductionGoal('tools',40);G.scheduleJobs();assert.equal(teacher.job,school.id);assert.equal(worker.job,food.id);assert.equal(worker.task,task);assert.equal(smith.workers.length,0);
});
test('newly rebuilt farm has no old seasonal commitment',()=>{
 const {G,building}=fixture(),old=building('farm');old.sowingCommitted=true;G.setProductionGoal('food',0);G.removeBuilding(old);const next=G.addBuilding('farm',2,2,{free:true,instant:true});assert.equal(next.ok,true);assert.equal(G.farmSeasonCommitted(next.b),false);assert.equal(G.farmHasWork(next.b),false);
});
test('save maps own their objects and missing pause is deterministically derived',()=>{
 const {G}=fixture();G.setProductionGoal('wood',50);const d=G.serializeGame();d.game.productionGoals.wood=99;assert.equal(G.productionGoalOf('wood'),50);const input=snap(G);delete input.game.productionPaused;const text=JSON.stringify(input);G.applySaveData(input);assert.equal(G.goalPaused('wood'),true);assert.equal(JSON.stringify(input),text);
});
test('a missing local pause in a between-band save cannot bypass town pause',()=>{
 const {G,building}=fixture(),b=building('woodcutter',{fuelLimit:100});G.game.res.firewood=100;G.setProductionGoal('firewood',100);G.game.res.firewood=95;G.updateProductionGoals();const d=snap(G);delete d.buildings[0].productionPaused;G.applySaveData(d);assert.equal(G.fuelLimited(G.world.bmap[b.id]),true);G.world.bmap[b.id].productionPaused=false;assert.equal(G.fuelLimited(G.world.bmap[b.id]),true);
});
test('all six lower targets conserve stock and carried quantities before hard-cap deposit',()=>{
 for(const type of ['wood','stone','iron','tools','food','firewood']){const {G,citizen}=fixture(),c=citizen();G.game.res[type]=G.storageCap()-37;c.carry={type,qty:40};const before=JSON.stringify([G.game.res,c.carry]);G.setProductionGoal(type,0);assert.equal(JSON.stringify([G.game.res,c.carry]),before,type);assert.equal(G.deposit(type,40),type==='tools'?40:37,type+' retains existing storage semantics');}
});
test('zero wood and fuel goals do not stop actual construction-site tree clearing',()=>{
 const {G,building,citizen}=fixture();G.addTree(G.world,3,3,-200);const b=building('woodcutter',{state:'site',workLeft:50,fuelLimit:100}),c=citizen(b);G.setProductionGoal('wood',0);G.setProductionGoal('firewood',0);G.requestTask(c);assert.equal(c.task.kind,'clearSite');const stock=G.game.res.wood;G.completeTask(c);assert.equal(G.game.res.wood,stock+2);assert.equal(c.task.kind,'build');
});
test('new seasonal reset expires a paused old sow without deleting already-carried food',()=>{
 const {G,building,citizen}=fixture(),b=building('farm'),c=citizen(b);c.pausedTask=G.makeTask(b,c);G.setProductionGoal('food',0);c.carry={type:'food',qty:14};G.resetFarm(b);assert.equal(G.resumeTask(c),false,'old sow cannot bypass the next season goal');assert.equal(c.pausedTask,null);assert.equal(c.carry.qty,14);assert.equal(G.makeTask(b,c),null);
});
test('paused stone output does not protect new iron batches from urgent food reassignment',()=>{
 const {G,building,citizen,trees}=fixture(),mine=building('mine'),food=building('gatherer');trees(food,50);G.game.res.food=0;G.game.res.stone=100;G.game.res.iron=0;
 for(let i=0;i<4;i++){const c=citizen(mine);G.requestTask(c);}G.setProductionGoal('stone',0);
 for(let step=0;step<24*8*2&&!G.game.over;step++)G.advanceSim(.5);
 assert.equal(G.game.stats.died,0);assert(food.workers.length>0);assert(G.game.res.food>0);
});
test('commitment belongs to actual paused output, not another mine output or planting',()=>{
 const {G,building,citizen}=fixture(),mine=building('mine'),c=citizen(mine);G.setProductionGoal('stone',0);
 c.task={b:mine,kind:'work',yield:{type:'stone',qty:3}};assert.equal(G.goalCommitment(c),true);
 c.task.yield.type='iron';assert.equal(G.goalCommitment(c),false);
 c.carry={type:'stone',qty:3};assert.equal(G.goalCommitment(c),true);c.carry={type:'iron',qty:3};assert.equal(G.goalCommitment(c),false);
 c.task.b=building('mine');c.task.yield.type='stone';assert.equal(G.goalCommitment(c),false);
 const forest=building('forester',{doPlant:true,doCut:true});G.releaseWorker(c);G.assignWorker(forest,c);c.carry=null;G.setProductionGoal('wood',0);c.task={b:forest,kind:'plant'};assert.equal(G.goalCommitment(c),false);c.task.kind='chop';assert.equal(G.goalCommitment(c),true);
});
test('wood pause does not lock repeated planting ahead of emergency food jobs',()=>{
 const {G,building,citizen,trees}=fixture(),forest=building('forester',{doCut:false,doPlant:true}),food=building('gatherer');trees(food,50);G.game.res.food=0;
 for(let i=0;i<4;i++){const c=citizen(forest);G.requestTask(c);}G.setProductionGoal('wood',0);
 for(let step=0;step<24*8*2&&!G.game.over;step++)G.advanceSim(.5);
 assert.equal(G.game.stats.died,0);assert(food.workers.length>0);assert(G.game.res.food>0);
});
test('changing town target preserves local hysteresis when effective cutoff is unchanged',()=>{
 for(const[type,kind,key]of[['firewood','woodcutter','fuelLimit'],['tools','blacksmith','toolLimit']]){
 const{G,building}=fixture(),b=building(kind,{[key]:40});G.game.res[type]=40;G.setProductionGoal(type,100);assert.equal(G.goalPaused(type,b),true);G.game.res[type]=39;G.updateProductionGoals();G.setProductionGoal(type,200);assert.equal(G.effectiveProductionGoal(type,b),40);assert.equal(G.goalPaused(type,b),true);G.game.res[type]=36;G.updateProductionGoals();assert.equal(G.goalPaused(type,b),false);}
});
test('mark donor skips a protected paused building and finds later available workers',()=>{
 const{G,building,citizen}=fixture(),smith=building('blacksmith'),forest=building('forester',{doCut:false,doPlant:true}),c=citizen(smith);c.task={b:smith,kind:'work',yield:{type:'tools',qty:2}};G.setProductionGoal('tools',0);const a=citizen(forest),b=citizen(forest);const donor=G.pickMarkDonor(G.world,false,['gatherer','dock','hunting'],0);assert([a,b].includes(donor));assert.equal(G.goalCommitment(c),true);
});
console.log(`Resource goals: ${pass} passed, ${fail} failed (simulation contracts, not browser tests).`);if(fail)process.exitCode=1;
