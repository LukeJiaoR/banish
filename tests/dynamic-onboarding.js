'use strict';
// Read-only coach contracts with real game construction/housing state, not a full tutorial playthrough.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {loadGame}=require('./helpers/playability');
const root=path.resolve(__dirname,'..');
let passed=0;
function fresh(){
 const G=loadGame(root);G.newGame(1);const local=new Map(),nodes={};
 const document={activeElement:null,getElementById:id=>nodes[id]||null,querySelector:()=>null};
 const context={G,document,localStorage:{getItem:k=>local.get(k),setItem:(k,v)=>local.set(k,v)}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'js/onboarding.js'),'utf8'),context);
 G.harvestFeedback=()=>({trees:G.world.marked.size,rocks:G.world.markedRocks.size,carry:{}});
 G.ui.menuCategory='food';return {G,local,nodes};
}
function plain(G){const w=G.world;w.water.fill(0);w.rock.fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};G.bumpNavigation(w);G.addBuilding('storage',2,2,{instant:true,free:true});}
function ready(G,type,x){const b=G.addBuilding(type,x,10,{instant:true,free:true}).b;assert(b);const c=G.world.citizens.find(c=>c.adult&&!c.dead&&!c._coachTaken);c._coachTaken=true;c.job=b.id;b.workers=[c.id];return b;}
function test(name,fn){fn();passed++;console.log('ok',name);}
test('new village is prompted to place food even with zero wood and stone',()=>{const {G}=fresh();G.game.res.wood=G.game.res.stone=0;assert.equal(G.onboarding.next().stage,'1 · 持续食物');G.tool={kind:'build',type:'gatherer'};assert.match(G.onboarding.next().text,/放下/);});
test('existing site progresses to materials, not another building or false completion',()=>{const {G}=fresh();plain(G);const b=G.addBuilding('gatherer',10,10).b;assert(b);G.game.res.wood=0;assert.equal(G.onboarding.next().stage,'1 · 持续食物');G.tool={kind:'fell'};assert.match(G.onboarding.next().text,/框选/);assert.equal(b.state,'site');});
test('real pending relevant mineral marks distinguish iron from stone',()=>{const {G}=fresh();plain(G);const b=G.addBuilding('gatherer',10,10).b;G.game.res.wood=100;G.game.res.stone=0;G.world.markedRocks.add(0);G.world.rock[0]=2;G.tool={kind:'quarry'};assert.match(G.onboarding.next().text,/灰色岩石/);G.world.rock[0]=1;G.game.paused=false;assert.match(G.onboarding.next().text,/等待石头采运/);});
test('stock already enough skips resource harvesting; paused site requests actual simulation',()=>{const {G}=fresh();plain(G);G.addBuilding('gatherer',10,10);G.game.res.wood=100;G.game.res.stone=100;G.game.paused=true;assert.equal(G.onboarding.next().target,'#quick-pause');});
test('built but unstaffed food does not unlock next stage',()=>{const {G}=fresh();plain(G);const b=G.addBuilding('gatherer',10,10,{instant:true,free:true}).b;b.workers=[];G.game.paused=false;assert.equal(G.onboarding.next().buildingId,b.id);assert.equal(G.onboarding.next().complete,undefined);});
test('actual existing staffed food and fuel skip directly to housing; empty pasture is not food',()=>{const {G}=fresh();plain(G);ready(G,'pasture',10);ready(G,'woodcutter',20);assert.equal(G.onboarding.next().stage,'1 · 持续食物');ready(G,'gatherer',30);assert.equal(G.onboarding.next().stage,'3 · 安家');});
test('stocked pasture is recognized without demanding another gatherer',()=>{const {G}=fresh();plain(G);ready(G,'pasture',10).animals=2;assert.equal(G.onboarding.next().stage,'2 · 备柴');});
test('house site is not completed housing; assignment is required and observations do not mutate save',()=>{const {G}=fresh();plain(G);ready(G,'gatherer',10);ready(G,'woodcutter',20);G.addBuilding('house',30,10);const before=JSON.stringify(G.serializeGame());assert.equal(G.onboarding.next().stage,'3 · 安家');assert.equal(JSON.stringify(G.serializeGame()),before);});
test('foundation complete requires actual assigned households, without claiming winter survival',()=>{const {G}=fresh();plain(G);ready(G,'gatherer',10);ready(G,'woodcutter',20);for(let i=0;i<G.world.families.length;i++)G.addBuilding('house',10+i*5,30,{instant:true,free:true});G.assignHousing();assert(G.onboarding.next().complete);assert.match(G.onboarding.next().detail,/不代表已安全过冬/);});
test('startup removes forced modal and long toast cascade; help remains explicit',()=>{const main=fs.readFileSync(path.join(root,'js/main.js'),'utf8');const newGame=main.slice(main.indexOf('G.newGame ='),main.indexOf('G.confirmNewGame ='));assert(!newGame.includes('toggleHelp'));assert.equal((newGame.match(/G.ui.toast/g)||[]).length,2);const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert(html.includes('id="coach-replay"'));assert(html.includes('class="help-reference"'));});

function dom(f) {
 const handlers={};
 for (const id of ['dynamic-coach','survival-guide','coach-stage','coach-text','coach-detail','coach-action','coach-skip','coach-replay','coach-explanation']) {
   f.nodes[id]={hidden:false,textContent:'',classList:{toggle(){},remove(){},add(){}},addEventListener:(event,fn)=>{(handlers[id]||=([])).push(fn);}};
 }
 return {click(id){for(const fn of handlers[id]||[])fn();},handlers};
}
test('old world is quiet, new town starts, skip sticks and replay is explicit',()=>{const f=fresh(),d=dom(f),{G}=f;
 G.onboarding.init();assert(f.nodes['dynamic-coach'].hidden);
 G.onboarding.newTown({preserveSaves:true});assert(f.nodes['dynamic-coach'].hidden);
 G.onboarding.newTown({});assert(!f.nodes['dynamic-coach'].hidden);
 const tool=G.tool,paused=G.game.paused;d.click('coach-skip');assert(f.nodes['dynamic-coach'].hidden);assert.equal(G.tool,tool);assert.equal(G.game.paused,paused);
 G.onboarding.newTown({});assert(f.nodes['dynamic-coach'].hidden);
 G.ui.toggleHelp=()=>{};d.click('coach-replay');assert(!f.nodes['dynamic-coach'].hidden);
 const original=G.world;G.world={...G.world};G.onboarding.refresh();assert(f.nodes['dynamic-coach'].hidden);G.world=original;G.onboarding.refresh();assert(!f.nodes['dynamic-coach'].hidden);
});
test('modal hides and clears coach without skipping; init is idempotent and controls stay mounted',()=>{const f=fresh(),d=dom(f),{G}=f;G.onboarding.init();G.onboarding.init();assert.equal(d.handlers['coach-skip'].length,1);G.onboarding.start();
 const action=f.nodes['coach-action'];G.hasOpenModal=()=>true;G.onboarding.refresh();assert(f.nodes['dynamic-coach'].hidden);G.hasOpenModal=()=>false;G.onboarding.refresh();assert(!f.nodes['dynamic-coach'].hidden);assert.equal(f.nodes['coach-action'],action);assert.equal(action.disabled,undefined);
});

test('paused pending material marks explicitly request continue',()=>{const {G}=fresh();plain(G);G.addBuilding('gatherer',10,10);G.game.res.wood=100;G.game.res.stone=0;G.world.markedRocks.add(0);G.world.rock[0]=1;G.game.paused=true;assert.equal(G.onboarding.next().target,'#quick-pause');});
test('finished unstaffed food is preferred to deliberately paused site',()=>{const {G}=fresh();plain(G);const site=G.addBuilding('gatherer',10,10).b;site.sitePaused=true;const built=G.addBuilding('dock',20,10,{instant:true,free:true,force:true});if(!built.ok){const b=G.addBuilding('gatherer',30,10,{instant:true,free:true}).b;b.workers=[];G.game.paused=false;assert.equal(G.onboarding.next().buildingId,b.id);}else{built.b.workers=[];G.game.paused=false;assert.equal(G.onboarding.next().buildingId,built.b.id);}});
console.log(`Dynamic onboarding: ${passed} passed`);
