'use strict';
/* Lifecycle regression tests use the real citizen path/work loop. Fixtures may
 * seed a private store only by moving the same quantities out of public stock.
 * No completed-task callback is used to stand in for a delivery or fire rescue. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const root = path.resolve(__dirname, '..');
const results = [];
const near = (actual, expected, label = '') => assert(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`);

function fresh() {
  const G = loadGame(root); G.newGame(1);
  const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1);
  for (const k of ['trees', 'citizens', 'buildings', 'families']) w[k] = [];
  w.bmap = {}; w.cmap = {}; w.supplyCaches = [];
  w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  G.rng = () => .5; G.game.h = 8;
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  Object.assign(G.game.res, { wood: 300, stone: 300, iron: 100, tools: 30,
    grain: 150, vegetables: 150, meat: 150, food: 450, firewood: 100, coal: 80 });
  build(G, 'storage', 2, 10);
  // Save reconstruction derives terrain from seed; retain this suite's flat fixture.
  const generate = G.genWorld, water = new Uint8Array(w.water), rock = new Uint8Array(w.rock);
  G.genWorld = (seed, options) => { const next = generate(seed, options); next.water.set(water); next.rock.set(rock); return next; };
  return G;
}
function build(G, type, x, y) {
  const result = G.addBuilding(type, x, y, { instant: true, free: true });
  assert(result.ok, `${type}@${x},${y}: ${result.reason}`); return result.b;
}
function family(G, home, ages = [30], x = home ? home.x - 1 : 20, y = home ? home.y : 20) {
  const f = { id: G.nextId(), members: [], coupleIds: [], houseId: home?.id ?? null };
  G.world.families.push(f); if (home && home.type !== 'boarding') home.family = f.id;
  const people = ages.map((age, i) => {
    const c = G.spawnCitizen({ x, y: y + i, age, sex: 'm', familyId: f.id });
    f.members.push(c.id); return c;
  });
  return { f, people, c: people[0], home };
}
function seedStore(G, b, items) {
  const stock = G.supplyStock(b);
  for (const [k, q] of Object.entries(items)) {
    near(G.withdrawResource(k, q), q, `seed ${k}`); stock[k] = (stock[k] || 0) + q;
  }
}
function inventory(G) {
  const out = Object.fromEntries(G.SUPPLY.types.map(k => [k, G.game.res[k] || 0]));
  const add = stock => { for (const k of G.SUPPLY.types) out[k] += stock?.[k] || 0; };
  G.world.buildings.forEach(b => add(b.supplyStock));
  (G.world.supplyCaches || []).forEach(b => add(b.supplyStock));
  G.world.families.forEach(f => add(f.supplyCamp?.supplyStock));
  G.world.citizens.forEach(c => { if (c.carry) add({ [c.carry.type]: c.carry.qty, ...c.carry.extra }); });
  add(G.game.supplyUsed); add(G.game.supplyLost);
  return out;
}
function conserved(G, initial, label) {
  const actual = inventory(G);
  for (const k of G.SUPPLY.types) near(actual[k], initial[k], `${label} conservation ${k}`);
  near(G.game.res.food, G.FOOD_KEYS.reduce((n, k) => n + G.game.res[k], 0), `${label} public food aggregate`);
  for (const b of [...G.world.buildings, ...(G.world.supplyCaches || []), ...G.world.families.map(f => f.supplyCamp).filter(Boolean)]) {
    for (const [k, q] of Object.entries(b.supplyStock || {})) assert(Number.isFinite(q) && q >= -1e-8, `${label} negative/nonfinite ${b.type}.${k}`);
  }
}
function test(name, fn) { fn(); results.push(name);console.log('ok '+name); }
function setup(type='house',ages=[30],x=30,y=5){const G=fresh(),home=build(G,type,4,4),f=family(G,home,ages,x,y);G.enablePhysicalSupplyPrototype();seedStore(G,home,{grain:40,vegetables:40,meat:40});for(const c of f.people)c.lastMealDay=null;return {G,...f};}
function runMeal(G,c,max=2000){const initial=inventory(G);for(let i=0;i<max&&c.lastMealDay!==G.game.day;i++){const x=c.x,y=c.y,speed=G.moveSpeed(c);G.stepCitizen(c,.1);assert(Math.hypot(c.x-x,c.y-y)<=speed*.1+1e-7,'teleport');conserved(G,initial,'meal');}assert.equal(c.lastMealDay,G.game.day,'must finish real meal');}
function wall(G){for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+15]=1;G.bumpNavigation(G.world);}
function snapshot(G){return JSON.parse(JSON.stringify(G.serializeGame()));}
test('strict water barrier cannot consume household food at midnight',()=>{const {G,c,home}=setup();wall(G);c.hunger=1;const food=G.supplyFood(home.supplyStock);G.endDay();near(G.supplyFood(home.supplyStock),food);assert.equal(c.hunger,2);assert.equal(c.lastMealDay,null);assert.equal(G.tryMealJourney(c,true),false);assert.match(c.mealWaitReason,/断路/);});
test('restored route requires physical movement and a short meal; only one ration',()=>{const {G,c,home}=setup();wall(G);assert(!G.tryMealJourney(c,true));G.world.water.fill(0);G.bumpNavigation(G.world);c.mealRetryH=0;const food=G.supplyFood(home.supplyStock);assert(G.tryMealJourney(c,true));assert(c.path.length>0);near(G.supplyFood(home.supplyStock),food);runMeal(G,c);assert(G.atMealTarget(c,home));near(food-G.supplyFood(home.supplyStock),G.LIFE.eatPerYear/G.YEAR_DAYS);assert.equal(c.dietVariety,3);assert(!G.tryMealJourney(c,true));assert.equal(G.eatHousehold(c,G.LIFE.eatPerDay).length,0);});
test('fractional near-door positions must walk exact final distance',()=>{const {G,c,home}=setup('house',[30],3.1,4);assert(!G.atMealTarget(c,home));runMeal(G,c);assert.equal(c.x,3);});
test('children and students walk without becoming workers; accrued study preserved',()=>{const {G,people}=setup('boarding',[2,12,30]);const student=people[1];student.student=true;student.adult=false;student.studyHours=37;student.studyToday=3;student.studyDay=G.game.day;for(const c of people)runMeal(G,c);assert.equal(people[0].adult,false);assert.equal(student.adult,false);assert.equal(student.studyHours,37);assert.equal(student.studyToday,3);assert.equal(student.carry,null);});
test('unhoused family eats only at its own real camp',()=>{const G=fresh(),{f,c}=family(G,null,[30],25,20);G.enablePhysicalSupplyPrototype();const camp=G.supplyFamilyTarget(f,true);seedStore(G,camp,{grain:20});c.lastMealDay=null;c.x=35;c.y=20;runMeal(G,c);assert(G.atMealTarget(c,camp));});
test('insufficient ration never partially consumes and adult supply stays possible',()=>{const {G,c,home}=setup();home.supplyStock=G.emptySupplyStock();seedStore(G,home,{grain:.5});assert(!G.tryMealJourney(c,true));near(home.supplyStock.grain,.5);assert.match(c.mealWaitReason,/不足/);assert(G.tryHouseholdSupply(c));assert.equal(c.task.kind,'supply');});
test('moving family during trip cannot consume old household or another family',()=>{const {G,c,f,home}=setup();const next=build(G,'house',35,15);seedStore(G,next,{grain:20});assert(G.tryMealJourney(c,true));const old=G.supplyFood(home.supplyStock);f.houseId=next.id;next.family=f.id;home.family=null;runMeal(G,c);near(G.supplyFood(home.supplyStock),old);assert(G.atMealTarget(c,next));});
test('fire target loss never consumes locked home food',()=>{const {G,c,home}=setup();assert(G.tryMealJourney(c,true));const before=G.supplyFood(home.supplyStock);home.houseFire={incident:1};for(let i=0;i<100;i++)G.stepCitizen(c,.1);near(G.supplyFood(home.supplyStock),before);assert.notEqual(c.lastMealDay,G.game.day);});
test('long meal trip ignores ordinary sleep distance cutoff',()=>{const {G,c,home}=setup('house',[30],65,5);G.game.h=23;c.state='rest';c.camped=true;runMeal(G,c);assert(G.atMealTarget(c,home));});
test('full-store cargo remains same object and resumes after meal',()=>{const {G,c}=setup();const cargo={type:'stone',qty:3,staffingReturn:true};c.carry=cargo;c.state='waitStorage';c.hunger=2;G.game.res.stone=G.storageCap('stone');const total=inventory(G);runMeal(G,c);assert.equal(c.carry,cargo);near(c.carry.qty,3);conserved(G,total,'stone carry');});
test('partial work stays in existing paused slot, untouched by meal',()=>{const {G,c}=setup();const b=build(G,'gatherer',35,25);c.job=b.id;b.workers=[c.id];const spot=G.workSpot(G.world,b,c.x,c.y);const t={kind:'work',b,tx:spot.x,ty:spot.y,work:4,workLeft:1.23};c.task=t;c.state='work';c.hunger=1;runMeal(G,c);assert.equal(c.task,t);near(t.workLeft,1.23);});
test('medical and firefighting tasks are not preempted',()=>{for(const kind of ['care','clinic','firefight']){const {G,c}=setup();c.hunger=3;c.task={kind};assert(!G.tryMealJourney(c,true));assert.equal(c.task.kind,kind);}});
test('strict daily accounting does not double-charge midnight',()=>{const {G,c,home}=setup();runMeal(G,c);const food=G.supplyFood(home.supplyStock);G.endDay();near(G.supplyFood(home.supplyStock),food);assert.equal(c.hunger,0);runMeal(G,c);near(food-G.supplyFood(home.supplyStock),G.LIFE.eatPerYear/G.YEAR_DAYS);});
test('strict last meal day persists and repeat reload cannot duplicate meals',()=>{const {G,c}=setup();runMeal(G,c);const initial=inventory(G);for(let i=0;i<3;i++){G.applySaveData(snapshot(G));const loaded=G.world.cmap[c.id];assert.equal(loaded.lastMealDay,G.game.day);assert(!G.tryMealJourney(loaded,true));conserved(G,initial,'reload');}});
test('old physical save pauses with fixed eight-day deadline on repeated reload',()=>{const {G}=setup();const old=snapshot(G);delete old.game.mealRuleVersion;delete old.game.mealTransitionStart;delete old.game.mealTransitionEnd;for(const c of old.citizens)delete c.lastMealDay;G.game.paused=false;G.applySaveData(old);assert(G.game.paused);assert.equal(G.game.mealTransitionEnd,G.game.day+8);const end=G.game.mealTransitionEnd;for(let i=0;i<3;i++){G.applySaveData(snapshot(G));assert.equal(G.game.mealTransitionEnd,end);}assert.match(G.mealTransitionNotice(),/8 日/);});
test('legacy grace real stock debit ends permanently, starts real trips meanwhile',()=>{const {G,c,home}=setup();G.game.mealTransitionStart=G.game.day;G.game.mealTransitionEnd=G.game.day+8;wall(G);const before=G.supplyFood(home.supplyStock);G.endDay();near(before-G.supplyFood(home.supplyStock),G.LIFE.eatPerYear/G.YEAR_DAYS);assert.equal(c.lastMealDay,G.game.day-1);G.world.water.fill(0);G.bumpNavigation(G.world);runMeal(G,c);G.game.day=G.game.mealTransitionEnd;const food=G.supplyFood(home.supplyStock);c.lastMealDay=null;c.x=30;wall(G);G.endDay();near(G.supplyFood(home.supplyStock),food);assert.equal(G.mealTransitionActive(),false);});
test('final eighth grace day is settled before strict outgoing days begin',()=>{const {G,c,home}=setup();G.game.mealTransitionStart=0;G.game.mealTransitionEnd=8;G.game.day=7;c.lastMealDay=6;c.hunger=0;wall(G);const before=G.supplyFood(home.supplyStock);assert(G.mealTransitionActive());G.endDay();assert.equal(G.game.day,8);near(before-G.supplyFood(home.supplyStock),G.LIFE.eatPerDay);assert.equal(c.lastMealDay,7);assert.equal(c.hunger,0);assert(!G.mealTransitionActive());const food=G.supplyFood(home.supplyStock);G.endDay();near(G.supplyFood(home.supplyStock),food);assert.equal(c.hunger,1);});
test('migration validation rejects malformed deadline and future meal atomically',()=>{const {G}=setup();for(const alter of [d=>{d.game.mealTransitionStart=d.game.day;d.game.mealTransitionEnd=d.game.day+9},d=>{d.citizens[0].lastMealDay=d.game.day+1},d=>{d.game.mealRuleVersion=2}]){const d=snapshot(G);alter(d);const w=G.world,g=G.game;assert.throws(()=>G.applySaveData(d));assert.equal(G.world,w);assert.equal(G.game,g);}});
test('automatic saves and daily public meals unchanged',()=>{const G=fresh(),home=build(G,'house',4,4),{c}=family(G,home);G.game.paused=false;const d=snapshot(G);G.applySaveData(d);assert.equal(G.game.mealRuleVersion,undefined);const before=G.game.res.food;G.endDay();near(before-G.game.res.food,G.LIFE.eatPerYear/G.YEAR_DAYS);assert.equal(G.world.cmap[c.id].hunger,0);});
test('actual bridge and tunnel construction restore meal reachability',()=>{
 for(const type of ['bridge','tunnel']){const {G,c,home}=setup(),w=G.world;
  if(type==='bridge')wall(G);else{w.mountain=new Uint8Array(w.N*w.N);for(let y=0;y<w.N;y++)w.mountain[y*w.N+15]=1;G.bumpNavigation(w);}
  assert(!G.tryMealJourney(c,true));const worker=G.spawnCitizen({x:11,y:10,age:30,sex:'m'});
  const r=type==='bridge'?G.addBridge({x:14,y:10},{x:16,y:10}):G.addTunnel({x:14,y:10},{x:16,y:10});assert(r.ok,r.reason);const b=r.b;
  b.workers=[worker.id];worker.job=b.id;G.requestTask(worker);
  for(let i=0;i<5000&&b.state!=='ok';i++)G.stepCitizen(worker,.1);assert.equal(b.state,'ok');
  c.mealRetryH=0;runMeal(G,c);assert(G.atMealTarget(c,home));
 }
});
test('road topology change during a meal trip cannot consume across a new wall',()=>{const {G,c,home}=setup();assert(G.tryMealJourney(c,true));G.stepCitizen(c,.1);wall(G);const before=G.supplyFood(home.supplyStock);for(let i=0;i<40;i++)G.stepCitizen(c,.1);assert.notEqual(c.lastMealDay,G.game.day);near(G.supplyFood(home.supplyStock),before);assert.match(c.mealWaitReason,/断路/);});
test('scheduler cannot steal a citizen or partial task during a meal trip',()=>{const {G,c}=setup();const b=build(G,'woodcutter',35,25);c.hunger=1;assert(G.tryMealJourney(c,true));const trip=c.mealJourney;G.scheduleJobs();assert.equal(c.mealJourney,trip);assert.equal(c.job,null);assert(G.goalCommitment(c));G.assignWorker(b,c);assert.equal(c.job,null);runMeal(G,c);});
test('food cargo is never used as a household ration and survives reload in a meal trip',()=>{const {G,c,home}=setup();const cargo={type:'grain',qty:6,staffingReturn:true};c.carry=cargo;c.state='waitStorage';c.hunger=1;G.game.res.grain=G.storageCap()-G.game.res.meat-G.game.res.vegetables;G.game.res.food=G.storageCap();const initial=inventory(G);assert(G.tryMealJourney(c,true));G.stepCitizen(c,.1);G.applySaveData(snapshot(G));const loaded=G.world.cmap[c.id];assert.equal(loaded.carry.qty,6);const local=G.supplyFood(G.world.bmap[home.id].supplyStock);runMeal(G,loaded);near(local-G.supplyFood(G.world.bmap[home.id].supplyStock),G.LIFE.eatPerDay);assert.equal(loaded.carry.qty,6);conserved(G,initial,'saved grain cargo');});
test('supply cargo death during meal uses the existing recovery-cache owner',()=>{const {G,c,home}=setup();c.carry={type:'grain',qty:4,staffingReturn:true,supplyBatch:{kind:'home',familyId:c.familyId,to:home.id}};G.game.res.grain-=4;G.game.res.food-=4;c.hunger=1;const initial=inventory(G);assert(G.tryMealJourney(c,true));G.killCitizen(c,'测试');assert(!G.world.cmap[c.id]);assert.equal(G.world.supplyCaches.at(-1).supplyStock.grain,4);conserved(G,initial,'dead carrier');});
test('material cargo and original recipe progress survive a meal',()=>{const {G,c}=setup();const b=build(G,'blacksmith',35,25);c.job=b.id;b.workers=[c.id];const spot=G.workSpot(G.world,b,c.x,c.y);const t={kind:'smith',phase:'work',b,tx:spot.x,ty:spot.y,work:4,workLeft:1.5};c.task=t;c.carry={type:'iron',qty:1,extra:{wood:2},smithInput:true,staffingReturn:true};const cargo=c.carry;c.hunger=1;c.state='work';runMeal(G,c);assert.equal(c.carry,cargo);assert.equal(c.task,t);near(t.workLeft,1.5);});
test('calendar advancement for multiple residents conserves food and never counts two same-day meals',()=>{const {G,people}=setup('boarding',[30,12,2]);const initial=inventory(G),seen=new Map();for(let i=0;i<500;i++){G.advanceSim(.1);for(const c of people){if(c.lastMealDay!=null){const k=c.id+':'+c.lastMealDay;seen.set(k,true);}}conserved(G,initial,'whole world');}assert(people.every(c=>!c.dead));near(G.supplyFood(G.game.supplyUsed),seen.size*G.LIFE.eatPerDay);});
console.log(`${results.length} reachable meal checks passed`);
