/* Wildlife v2: real clock/path movement, pursuit, annual recovery and save safety.
 * Node simulation contracts, not browser/visual acceptance.
 * Run: node tests/deer-herds.js [optional-7f95f98-baseline-checkout]
 */
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {loadGame}=require('./helpers/playability');
const root=path.resolve(__dirname,'..');
const baseline=process.argv[2]&&path.resolve(process.argv[2]);
const plain=x=>JSON.parse(JSON.stringify(x));
const snap=G=>plain(G.serializeGame());
let passed=0,failed=0;
function test(name,fn){
  try{fn();passed++;console.log('ok '+name);}
  catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}
}
function near(actual,expected,label='number'){assert(Math.abs(actual-expected)<1e-9,`${label}: ${actual} != ${expected}`);}
function setTime(G,day,h=12){G.game.day=day;G.game.h=h;G.game.season=G.seasonOf(day);G.game.year=Math.floor(day/G.YEAR_DAYS)+1;}
function advance(G,hours){const h=G.game.h+hours;setTime(G,G.game.day+Math.floor(h/G.DAY_H),h%G.DAY_H);G.advanceDeer();}
function fresh(){
  const G=loadGame(root);assert(G.newGame(1).ok);const w=G.world;
  for(const key of ['water','rock','road'])w[key].fill(0);if(w.mountain)w.mountain.fill(0);
  w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();G.bumpNavigation(w);
  setTime(G,0);G.rng=()=>.5;assert(G.addBuilding('storage',2,2,{instant:true,free:true}).ok);
  for(const key of G.RES_KEYS)G.game.res[key]=0;G.game.res.tools=20;
  for(let y=10;y<=30;y+=2)for(let x=14;x<=66;x+=2)G.addTree(w,x,y,-90);
  G.initializeDeer();for(const d of w.deer){d.returnDay=G.YEAR_DAYS;d.route=[];d.progress=0;}
  // Classic maps regenerate on load; preserve the deliberately flat test terrain.
  const original=G.genWorld;G.genWorld=(seed,opt)=>{const next=original(seed,opt);for(const key of ['water','rock','mountain'])if(next[key]&&w[key])next[key].set(w[key]);return next;};
  return G;
}
function live(G,id=1,x=16,y=13){
  const d=G.world.deer.find(q=>q.id===id);assert(d);
  Object.assign(d,{x,y,homeX:x,homeY:y,returnDay:null,moveDay:G.game.day+1,route:[],progress:0});return d;
}
function east(d,length=4){d.route=Array.from({length},(_,i)=>({x:d.x+i+1,y:d.y}));d.progress=0;}
function cabin(G,x=10,y=10){const result=G.addBuilding('hunting',x,y,{instant:true,free:true});assert(result.ok);return result.b;}
function hunter(G,b,x=7,y=10){const c=G.spawnCitizen({x,y,age:30,sex:'f'});c.job=b.id;b.workers.push(c.id);return c;}
function start(G,c){G.requestTask(c);assert.equal(c.task?.kind,'hunt');return c.task;}
function until(G,c,condition,limit=5000){for(let i=0;i<limit&&!condition();i++)G.stepCitizen(c,.05);assert(condition(),'expected real walking/work/delivery did not finish');}
function total(G,type){return G.game.res[type]+G.game.huntingLost[type]+G.world.citizens.reduce((n,c)=>n+(c.carry?.type===type?c.carry.qty:0)+(c.carry?.extra?.[type]||0),0);}
function activeCounts(G){return [1,2,3].map(id=>G.world.deer.filter(d=>d.herdId===id&&d.returnDay===null).length);}
function ecology(G){return plain({deer:G.world.deer,wildlife:G.world.wildlife});}
function validateRoute(G,d){let previous=d;for(const p of d.route){assert(G.walkEdgeAllowed(G.world,previous.x,previous.y,p.x,p.y),`illegal edge ${previous.x},${previous.y} -> ${p.x},${p.y}`);previous=p;}}

test('new wildlife has deterministic 24 slots in three herds and read-only queries consume no RNG',()=>{
  const A=loadGame(root),B=loadGame(root);assert(A.newGame(731).ok);assert(B.newGame(731).ok);
  assert.equal(A.world.wildlife.v,2);assert.equal(A.world.deer.length,24);assert.equal(A.world.wildlife.herds.length,3);
  assert.deepEqual(ecology(A),ecology(B));
  for(let id=1;id<=3;id++)assert.equal(A.world.deer.filter(d=>d.herdId===id).length,8);
  for(const d of A.world.deer){assert.equal(d.herdId,Math.floor((d.id-1)/8)+1);assert.equal(d.progress,0);assert.deepEqual(plain(d.route),[]);if(d.returnDay===null)assert(A.deerHabitat(A.world,d.x,d.y));}
  const before=snap(A),nextId=A._peekUid();let calls=0;A.rng=()=>{calls++;return .5;};
  for(let i=0;i<8;i++){A.huntingSummary({type:'hunting',state:'ok',x:A.world.start.x+5,y:A.world.start.y+5});for(const d of A.world.deer)A.deerPosition(d);}
  assert.equal(calls,0);assert.equal(A._peekUid(),nextId);assert.deepEqual(snap(A),before);
});

test('movement is .7 tile/hour, commits only whole nodes, and same-clock calls are idempotent',()=>{
  const G=fresh(),d=live(G);east(d);
  advance(G,.25);assert.deepEqual([d.x,d.y],[16,13]);near(d.progress,.175,'first fraction');near(G.deerPosition(d).x,16.175,'physical position');
  const paused=ecology(G);for(let i=0;i<50;i++)G.advanceDeer();assert.deepEqual(ecology(G),paused);
  advance(G,1.25);assert.deepEqual([d.x,d.y],[17,13]);near(d.progress,.05,'fraction after node commit');near(G.deerPosition(d).x,17.05);
  assert.equal(d.route[0].x,18);assert(Number.isInteger(d.x)&&Number.isInteger(d.y));assert(d.progress>=0&&d.progress<1);
  near(G.world.wildlife.lastTime,G.game.day+G.game.h/24,'ecology clock');
});

test('split time steps and a single elapsed step traverse the same fractional path',()=>{
  const A=fresh(),B=fresh(),a=live(A),b=live(B);east(a);east(b);
  advance(A,2);for(let i=0;i<40;i++)advance(B,.05);
  assert.deepEqual([a.x,a.y],[b.x,b.y]);assert.deepEqual(plain(a.route),plain(b.route));near(a.progress,b.progress);near(A.deerPosition(a).x,B.deerPosition(b).x);
  const before=ecology(A);A.advanceSim(0);assert.deepEqual(ecology(A),before);
});

test('real route planning cannot cross a closed river and uses the actual land opening',()=>{
  const G=fresh(),w=G.world,d=live(G);
  for(let y=0;y<w.N;y++)w.water[y*w.N+20]=1;G.bumpNavigation(w);
  assert.equal(G.deerRoute(w,d,[{x:24,y:13}]),false);assert.deepEqual(plain(d.route),[]);
  w.water[18*w.N+20]=0;G.bumpNavigation(w);assert(G.deerRoute(w,d,[{x:24,y:13}]));validateRoute(G,d);
  assert(d.route.some(p=>p.x===20&&p.y===18));assert(d.route.every(p=>p.x!==20||p.y===18));
  const route=plain(d.route),length=route.reduce((n,p,i)=>n+Math.hypot(p.x-(i?route[i-1].x:16),p.y-(i?route[i-1].y:13)),0);
  advance(G,length/.7+.001);assert.deepEqual([d.x,d.y],[24,13]);assert.equal(d.progress,0);assert.equal(d.route.length,0);
});

test('paths route around building footprints and do not cut blocked diagonal corners',()=>{
  const G=fresh(),w=G.world,d=live(G,1,16,13);
  for(let y=12;y<14;y++)for(let x=18;x<20;x++)G.removeTree(w,x,y);
  const house=G.addBuilding('house',18,12,{instant:true,free:true});assert(house.ok,house.reason);G.bumpNavigation(w);
  assert(G.deerRoute(w,d,[{x:23,y:13}]));validateRoute(G,d);assert(d.route.every(p=>w.bgrid[p.y*w.N+p.x]<0));
  d.route=[];w.water[13*w.N+17]=1;w.water[14*w.N+16]=1;G.bumpNavigation(w);
  assert(G.deerRoute(w,d,[{x:17,y:14}]));validateRoute(G,d);assert.notDeepEqual(plain(d.route[0]),{x:17,y:14});
});

test('a deer may cross a finished bridge and save while physically over the river',()=>{
  const G=fresh(),w=G.world,d=live(G,1,16,13);
  for(let y=0;y<w.N;y++){G.removeTree(w,20,y);w.water[y*w.N+20]=1;}G.bumpNavigation(w);
  G.game.res.wood=100;G.game.res.stone=100;
  const worker=G.spawnCitizen({x:18,y:13,age:30,sex:'m'}),result=G.addBridge({x:19,y:13},{x:21,y:13});assert(result.ok,result.reason);
  G.scheduleJobs();until(G,worker,()=>result.b.state==='ok',20000);G.releaseWorker(worker);
  assert(G.deerRoute(w,d,[{x:24,y:13}]));validateRoute(G,d);advance(G,4.2/.7);
  assert.equal(d.x,20);assert(d.progress>0);assert.equal(w.water[d.y*w.N+d.x],1);assert.equal(G.tileBlocked(w,d.x,d.y),false);assert.equal(G.bridgeRemovalStatus(w,result.b).ok,false,'occupied bridge must not be removable');
  const saved=snap(G),exact=ecology(G);G.applySaveData(saved);assert.deepEqual(ecology(G),exact);
});

test('placement protects a living source tile and the destination of its in-flight segment',()=>{
  const G=fresh(),w=G.world,d=live(G);east(d,3);
  for(let y=12;y<=13;y++)for(let x=15;x<=19;x++)G.removeTree(w,x,y);
  assert.equal(G.canPlace(w,'house',15,12).ok,false,'placement covered a living deer source');
  assert.equal(G.canPlace(w,'house',17,12).ok,true,'an unstarted future edge should not reserve land');
  advance(G,.5);assert(d.progress>0);
  assert.equal(G.canPlace(w,'house',15,12).ok,false,'source must remain protected during movement');
  assert.equal(G.canPlace(w,'house',17,12).ok,false,'placement covered the occupied in-flight edge');
  assert.equal(G.canPlace(w,'house',18,12).ok,true,'future path planning must not reserve the whole route');
});

test('placement cannot clip a diagonal in-flight side cell and rejection leaves the save valid',()=>{
  const G=fresh(),w=G.world,d=live(G);d.route=[{x:17,y:14}];
  for(let y=12;y<=13;y++)for(let x=17;x<=18;x++)G.removeTree(w,x,y);
  advance(G,.5);assert(d.progress>0&&d.progress<1);
  // The 2x2 house covers (17,13), but neither source (16,13) nor target (17,14).
  const before=snap(G),wild=ecology(G);assert.equal(G.canPlace(w,'house',17,12).ok,false);
  assert.equal(G.addBuilding('house',17,12,{instant:true,free:true}).ok,false);assert.deepEqual(snap(G),before);
  G.applySaveData(before);assert.deepEqual(ecology(G),wild);
});

test('a newly blocked segment retains physical progress and never teleports to an endpoint',()=>{
  const G=fresh(),w=G.world,d=live(G);east(d,2);advance(G,.5);const at=plain(G.deerPosition(d)),before=plain(d);
  w.water[13*w.N+17]=1;G.bumpNavigation(w);advance(G,1);
  assert.deepEqual(plain(G.deerPosition(d)),at);assert.deepEqual([d.x,d.y,d.progress],[before.x,before.y,before.progress]);
  w.water[13*w.N+17]=0;G.bumpNavigation(w);advance(G,.5);near(G.deerPosition(d).x,16.7);assert.equal(d.x,16);
});

test('distant and paused claimants reserve prey without freezing its movement',()=>{
  for(const paused of [false,true]){
    const G=fresh(),b=cabin(G),c=hunter(G,b),d=live(G);const t=start(G,c);east(d,3);
    if(paused){G.goHome(c);assert.equal(c.pausedTask,t);assert.notEqual(c.task,t);}
    assert(G.huntingClaims().deer.has(d.id));advance(G,.5);near(G.deerPosition(d).x,16.35,paused?'paused claimant':'distant claimant');
    assert.equal(d.returnDay,null);assert.equal(total(G,'meat'),0);assert.equal(total(G,'leather'),0);
  }
});

test('only an onsite working hunter holds stationary prey during real processing',()=>{
  const G=fresh(),b=cabin(G),d=live(G),c=hunter(G,b,d.x,d.y),t=start(G,c);assert.equal(c.state,'work');east(d,3);
  advance(G,.25);assert.deepEqual(plain(G.deerPosition(d)),{x:16,y:13});assert.equal(d.route.length,0);
  G.stepCitizen(c,.25);near(t.workLeft,t.work-.25);assert.equal(c.carry,null);assert.equal(d.returnDay,null);
  until(G,c,()=>!!c.carry);assert.equal(c.carry.qty,160);assert.equal(c.carry.extra.leather,4);assert.equal(d.returnDay,G.world.wildlife.nextBirthDay);
  assert.equal(G.game.res.meat,0);assert.equal(total(G,'meat'),160);assert.equal(total(G,'leather'),4);
});

test('pursuit follows a committed moving target and never completes at the obsolete or fractional location',()=>{
  const G=fresh(),b=cabin(G),d=live(G),c=hunter(G,b),t=start(G,c);east(d,3);
  advance(G,2);assert.equal(d.x,17);near(d.progress,.4);G.stepCitizen(c,.05);
  assert.equal(t.tx,17);assert.equal(t.ty,13);near(t.workLeft,t.work);assert.equal(c.carry,null);
  c.x=t.tx;c.y=t.ty;c.state='work';c.path=null;const work=t.workLeft;G.stepCitizen(c,.25);near(t.workLeft,work);assert.equal(c.carry,null);
  t.workLeft=0;c.x=16;c.y=13;assert.equal(G.completeHuntingTask(c,t),false);assert.equal(d.returnDay,null);assert.equal(total(G,'meat'),0);
  const next=start(G,c);c.x=next.tx;c.y=next.ty;next.workLeft=0;assert.equal(G.completeHuntingTask(c,next),false);assert.equal(d.returnDay,null);assert.equal(total(G,'leather'),0);
});

test('a moving prey can be tracked, processed onsite, and physically delivered exactly once',()=>{
  const G=fresh();setTime(G,0,8);G.world.wildlife.lastTime=G.huntingNow();
  const b=cabin(G),d=live(G),c=hunter(G,b,14,13);start(G,c);east(d,2);d.moveDay=G.huntingNow()+.125;
  let completed=null;
  for(let i=0;i<450&&!c.carry;i++){
    advance(G,.025);const accepted=c.task;G.stepCitizen(c,.025);
    if(d.progress>0){assert.equal(c.carry,null);assert.equal(d.returnDay,null);}
    if(c.carry){completed=accepted;assert.equal(c.x,d.x);assert.equal(c.y,d.y);}
  }
  assert(completed,'hunter never completed the moving encounter: '+JSON.stringify({time:G.huntingNow(),deer:G.deerPosition(d),herd:G.world.wildlife.herds[0],hunter:{x:c.x,y:c.y,state:c.state,task:c.task?.kind,work:c.task?.workLeft}}));assert(completed.done);
  assert.equal(total(G,'meat'),160);assert.equal(total(G,'leather'),4);assert.equal(G.game.res.meat,0);
  G.completeHuntingTask(c,completed);assert.equal(total(G,'meat'),160);
  const second=live(G,2,20,17),other=hunter(G,b,20,17);
  for(let i=0;i<1200&&c.carry;i++){
    advance(G,.025);G.stepCitizen(c,.025);G.stepCitizen(other,.025);
    assert.equal(second.returnDay,null,'shared cooldown allowed a second kill');
    assert.equal(total(G,'meat'),160);assert.equal(total(G,'leather'),4);
  }
  assert.equal(c.carry,null,'moving-clock physical delivery did not finish');assert(G.huntingSummary(b).cooldownDays>0);assert.equal(G.makeTask(b,other),null);
  assert.equal(G.game.res.meat,160);assert.equal(G.game.res.leather,4);assert.equal(total(G,'meat'),160);assert.equal(total(G,'leather'),4);
});

test('migration changes herd destinations every four days without teleporting members',()=>{
  const G=fresh(),d=live(G),herd=G.world.wildlife.herds[0];east(d,2);const due=herd.nextMoveDay;
  setTime(G,Math.floor(due),(due%1)*G.DAY_H);G.world.wildlife.lastTime=due-1/24;const before=plain(G.deerPosition(d));G.advanceDeer();
  near(herd.nextMoveDay,due+4);const after=G.deerPosition(d);assert(Math.hypot(after.x-before.x,after.y-before.y)<=.7+1e-9,'migration teleported an animal');
  const destination=[herd.x,herd.y],next=herd.nextMoveDay;advance(G,.25);assert.deepEqual([herd.x,herd.y],destination);assert.equal(herd.nextMoveDay,next);
});

test('missing slots wait for annual recovery, bounded to max(5, alive*2) and eight per herd',()=>{
  const G=fresh(),w=G.world,centers=[{x:20,y:20},{x:40,y:20},{x:60,y:20}];
  for(const [index,herd]of w.wildlife.herds.entries())Object.assign(herd,centers[index]);
  for(const d of w.deer){d.returnDay=8.5;const p=centers[d.herdId-1];d.homeX=d.x=p.x;d.homeY=d.y=p.y;}
  for(let i=0;i<2;i++)live(G,9+i,38+i*2,18);for(let i=0;i<7;i++)live(G,17+i,56+(i%4)*2,18+Math.floor(i/4)*2);
  assert.deepEqual(activeCounts(G),[0,2,7]);setTime(G,9);G.advanceDeer();assert.deepEqual(activeCounts(G),[0,2,7],'eight days must not replenish killed slots');
  setTime(G,G.YEAR_DAYS-1,23.99);G.advanceDeer();assert.deepEqual(activeCounts(G),[0,2,7]);
  setTime(G,G.YEAR_DAYS,0);G.advanceDeer();assert.deepEqual(activeCounts(G),[5,5,8]);assert.equal(w.deer.length,24);assert.equal(w.wildlife.nextBirthDay,G.YEAR_DAYS*2);
  const born=ecology(G);G.advanceDeer();assert.deepEqual(ecology(G),born);
  setTime(G,G.YEAR_DAYS*2,0);G.advanceDeer();assert.deepEqual(activeCounts(G),[8,8,8]);assert.equal(new Set(w.deer.map(d=>d.id)).size,24);
  assert.equal(new Set(w.deer.filter(d=>d.returnDay===null).map(d=>`${d.x},${d.y}`)).size,24,'annual recovery overlapped living animals');
  assert.equal(total(G,'meat'),0);assert.equal(total(G,'leather'),0);
});

test('an empty habitat does not synthesize births; replanting recovers only on a future annual event',()=>{
  const G=fresh(),w=G.world;for(const tree of [...w.trees])G.removeTree(w,tree.x,tree.y);
  setTime(G,G.YEAR_DAYS,0);G.advanceDeer();assert.deepEqual(activeCounts(G),[0,0,0]);
  for(let y=10;y<=30;y+=2)for(let x=14;x<=66;x+=2)G.addTree(w,x,y,-90);
  advance(G,.1);assert.deepEqual(activeCounts(G),[0,0,0]);
  setTime(G,G.YEAR_DAYS*2,0);G.advanceDeer();assert.deepEqual(activeCounts(G),[5,5,5]);assert.equal(w.deer.length,24);
});

test('cabin cooldown is still eight exact days while education yields remain 160/4 or 200/6',()=>{
  for(const educated of [false,true]){
    const G=fresh(),b=cabin(G),c=hunter(G,b),d=live(G);c.educated=educated;const task=start(G,c);until(G,c,()=>!!c.carry);
    assert.equal(total(G,'meat'),educated?200:160);assert.equal(total(G,'leather'),educated?6:4);assert.equal(b.huntingReadyDay,8.5);assert.equal(d.returnDay,G.YEAR_DAYS);
    until(G,c,()=>!c.carry);setTime(G,8,11.99);G.advanceDeer();assert(G.huntingSummary(b).cooldownDays>0);assert.equal(G.makeTask(b,c),null);
    setTime(G,8,12);G.advanceDeer();assert.equal(G.huntingSummary(b).cooldownDays,0);assert.equal(d.returnDay,G.YEAR_DAYS);assert.equal(G.makeTask(b,c),null,'cooldown expiry cannot create a new deer');
    const count=total(G,'meat');const copy={...task,done:false,workLeft:0};c.task=copy;c.x=copy.tx;c.y=copy.ty;assert.equal(G.completeHuntingTask(c,copy),false);assert.equal(total(G,'meat'),count);
  }
});

test('fractional route and ecology clock restore exactly and continue from the same physical point',()=>{
  const G=fresh(),d=live(G);east(d,5);advance(G,2.125);const saved=snap(G),before=ecology(G),at=plain(G.deerPosition(d));
  assert(d.progress>0&&d.progress<1);G.applySaveData(saved);assert.deepEqual(ecology(G),before);assert.deepEqual(plain(G.deerPosition(G.world.deer[0])),at);
  const H=fresh();H.applySaveData(saved);advance(G,.125);advance(H,.125);assert.deepEqual(ecology(G),ecology(H));near(G.deerPosition(G.world.deer[0]).x,at.x+.0875);
  const repeated=ecology(G);G.advanceDeer();assert.deepEqual(ecology(G),repeated);
});

test('malformed herd clocks, ownership, routes and fractions reject atomically without losing resources',()=>{
  const G=fresh(),d=live(G);east(d,3);advance(G,.5);const current=G.world,state=snap(G),game=G.game,nextId=G._peekUid(),rng=G.rng;
  const edits=[
    ['missing ecology',s=>delete s.wildlife],['missing deer',s=>delete s.deer],['version',s=>s.wildlife.v=3],['ecology extra field',s=>s.wildlife.unused=true],
    ['future clock',s=>s.wildlife.lastTime=G.huntingNow()+1],['negative clock',s=>s.wildlife.lastTime=-1],['clock string',s=>s.wildlife.lastTime='0.5'],
    ['past birth',s=>s.wildlife.nextBirthDay=0],['distant birth',s=>s.wildlife.nextBirthDay=G.huntingNow()+G.YEAR_DAYS+1],['herd count',s=>s.wildlife.herds.pop()],
    ['duplicate herd',s=>s.wildlife.herds[1].id=1],['herd out of bounds',s=>s.wildlife.herds[0].x=-1],['distant migration',s=>s.wildlife.herds[0].nextMoveDay=G.huntingNow()+5],
    ['wrong ownership',s=>s.deer[0].herdId=2],['duplicate deer',s=>s.deer[1].id=1],['slot count',s=>s.deer.pop()],
    ['fraction negative',s=>s.deer[0].progress=-.1],['fraction endpoint',s=>s.deer[0].progress=1],['fraction string',s=>s.deer[0].progress='.2'],
    ['fraction without path',s=>s.deer[0].route=[]],['dead moving slot',s=>s.deer[0].returnDay=G.YEAR_DAYS],
    ['noninteger committed node',s=>s.deer[0].x=16.25],['route teleport',s=>s.deer[0].route[0].x=20],['route repeat',s=>s.deer[0].route[0]={x:16,y:13}],
    ['route out of bounds',s=>s.deer[0].route[0].y=-1],['route extra field',s=>s.deer[0].route[0].unused=true],['negative loss',s=>s.game.huntingLost.meat=-1],
  ];
  for(const [label,edit]of edits){const broken=plain(state);edit(broken);assert.throws(()=>G.applySaveData(broken),undefined,label);assert.equal(G.world,current,label);assert.equal(G.game,game,label);assert.equal(G._peekUid(),nextId,label);assert.equal(G.rng,rng,label);assert.deepEqual(snap(G),state,label);}
});

test('saving a partly delivered hunt retains all meat, leather, provenance and exact wildlife',()=>{
  const G=fresh(),b=cabin(G),c=hunter(G,b);live(G);start(G,c);until(G,c,()=>!!c.carry);
  G.game.res.food=G.game.res.grain=G.storageCap()-7;G.game.res.leather=G.storageCap();until(G,c,()=>c.state==='waitStorage');
  assert.equal(c.carry.qty,153);assert.equal(c.carry.extra.leather,4);assert.equal(total(G,'meat'),160);const saved=snap(G),wild=ecology(G),leather=total(G,'leather');
  G.applySaveData(saved);assert.deepEqual(ecology(G),wild);const loaded=G.world.cmap[c.id];assert.equal(loaded.carry.huntingId,b.id);assert.equal(loaded.carry.qty,153);assert.equal(total(G,'meat'),160);assert.equal(total(G,'leather'),leather);
  G.killCitizen(loaded,'test');assert.equal(total(G,'meat'),160);assert.equal(total(G,'leather'),leather);assert.deepEqual(plain(G.game.huntingLost),{meat:153,leather:4});
});

if(baseline)test('actual 7f95f98 save upgrades without moving/refilling deer or changing cooldown, cargo and stocks',()=>{
  const O=loadGame(baseline);assert(O.newGame(731).ok);assert.equal(O.world.wildlife,undefined,'baseline must predate wildlife v2');
  const w=O.world,d=w.deer.find(q=>q.returnDay===null);assert(d);d.returnDay=O.huntingNow()+8;d.generation++;
  let b;for(let y=8;y<w.N-8&&!b;y++)for(let x=8;x<w.N-8&&!b;x++)if(O.canPlace(w,'hunting',x,y).ok){for(let yy=y;yy<y+2;yy++)for(let xx=x;xx<x+2;xx++)O.removeTree(w,xx,yy);b=O.addBuilding('hunting',x,y,{instant:true,free:true}).b;}
  assert(b);for(const c of w.citizens)O.releaseWorker(c);const c=w.citizens.find(c=>c.adult);c.job=b.id;b.workers=[c.id];b.workerLimit=1;b.huntingReadyDay=O.huntingNow()+7.25;
  c.carry={type:'meat',qty:153,extra:{leather:4},staffingReturn:true,huntingId:b.id};O.game.res.food=O.game.res.grain=O.storageCap();O.game.res.leather=O.storageCap();
  const old=snap(O);assert.equal(old.wildlife,undefined);assert(old.deer.some(q=>q.returnDay!==null));const G=loadGame(root);assert(G.newGame(1).ok);G.applySaveData(old);
  const migrated=snap(G),legacyKeys=['id','x','y','homeX','homeY','returnDay','moveDay','generation'];
  assert.deepEqual(migrated.deer.map(q=>Object.fromEntries(legacyKeys.map(k=>[k,q[k]]))),old.deer);assert.equal(migrated.wildlife.v,2);assert.equal(migrated.wildlife.lastTime,O.huntingNow());
  assert(migrated.deer.every(q=>q.route.length===0&&q.progress===0));assert.deepEqual(migrated.game.res,old.game.res);assert.deepEqual(migrated.game.huntingLost,old.game.huntingLost);
  assert.equal(G.world.bmap[b.id].huntingReadyDay,b.huntingReadyDay);assert.equal(G.world.bmap[b.id].workerLimit,1);assert.deepEqual(plain(G.world.bmap[b.id].workers),[c.id]);assert.deepEqual(plain(G.world.cmap[c.id].carry),old.citizens.find(q=>q.id===c.id).carry);
  const exact=ecology(G);G.advanceDeer();assert.deepEqual(ecology(G),exact);G.applySaveData(migrated);assert.deepEqual(ecology(G),exact);assert.equal(total(G,'meat'),153);assert.equal(total(G,'leather'),old.game.res.leather+4);
});

console.log(`Deer herds: ${passed} passed, ${failed} failed${baseline?' (with real legacy checkout)':''}`);
if(failed)process.exitCode=1;
