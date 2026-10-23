/* #89: actual task/occupancy presentation; no simulation or save mutation. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {loadGame}=require('./helpers/playability');const root=path.resolve(__dirname,'..');let passed=0;
function fresh(){const G=loadGame(root);const context={G,console,document:{},performance:{now:()=>1000},setTimeout(){},clearTimeout(){},matchMedia:()=>({matches:false})};for(const name of ['sprites','render'])vm.runInNewContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context);G.newGame(1);const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];G.bumpNavigation(w);G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});for(const k of G.RES_KEYS)G.game.res[k]=0;Object.assign(G.game.res,{wood:200,iron:100,coal:100,tools:20,grain:1000,food:1000,leather:30,wool:30});return G;}
function build(G,type,x=12,y=10){const r=G.addBuilding(type,x,y,{instant:true,free:true});assert(r.ok,r.reason);return r.b;}
function worker(G,b){const c=G.spawnCitizen({x:8,y:10,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];return c;}
function until(G,c,f){for(let i=0;i<3000&&!f();i++)G.stepCitizen(c,.05);assert(f(),'expected real work transition');}
function process(type){const G=fresh(),b=build(G,type),c=worker(G,b);G.requestTask(c);assert(c.task);assert.equal(G.buildingActivity(b).active,false);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');assert(G.buildingActivity(b).active);return {G,b,c};}
function home(type='house'){const G=fresh(),b=build(G,type),c=G.spawnCitizen({x:8,y:10,age:30,sex:'m',familyId:100});const f={id:100,houseId:b.id,members:[c.id]};G.world.families=[f];b.family=f.id;return {G,b,c,f};}
const test=(n,f)=>{f();passed++;console.log('ok '+n);};

test('art follows actual at-home presence, not assigned household',()=>{const {G,b,c,f}=home();assert.equal(G.houseArtName(b),'house-a-v2-square-empty');c.x=b.x-1;c.y=b.y;c.state='rest';c.camped=false;c.path=null;assert.equal(G.houseArtName(b),'house-a-v2-square-occupied');c.path=[{x:1,y:1}];assert.equal(G.houseArtName(b),'house-a-v2-square-empty');c.path=null;f.houseId=null;assert.equal(G.houseArtName(b),'house-a-v2-square-empty');b.houseFire={};assert.equal(G.houseArtName(b),null);});
test('source anchors map exactly to requested world foot; size and fallback checked',()=>{const G=fresh(),calls=[],ctx={drawImage(...a){calls.push(a);}};for(const name of Object.keys(G.A_ART)){const spec=G.A_ART[name];assert.equal(G.drawCalibratedArt(ctx,name,20,30,128),null);G.SPR.map.set(name,{width:spec.source[0],height:spec.source[1]});assert(G.drawCalibratedArt(ctx,name,20,30,128));const a=calls.at(-1),k=128/(spec.span||spec.height);assert.equal(a[1]+spec.anchor[0]*k,20);assert.equal(a[2]+spec.anchor[1]*k,30);G.SPR.map.set(name,{width:100,height:100});assert.equal(G.drawCalibratedArt(ctx,name,20,30,128),null);}});
test('tree selection preserves mature species and adds independent juvenile art',()=>{const G=fresh(),selected=[];G.drawCalibratedArt=(ctx,name)=>{selected.push(name);return [1,1];};G.sprDraw=(ctx,name)=>{selected.push(name);return [1,1];};const t={x:20,y:20,b:-1000};G.game.season=1;G.drawTree({},t,{variant:false,scale:1});G.drawTree({},t,{variant:true,scale:1});assert.deepEqual(selected,['tree-a-v1-broadleaf','tree-a-v1-willow']);G.game.season=3;G.drawTree({},t,{variant:true,scale:1});assert.equal(selected.at(-1),'tree-a-v1-willow-winter');G.drawTree({},t,{variant:false,scale:1});assert.equal(selected.at(-1),'tree-a-v1-broadleaf-winter');for(const kind of ['broadleaf','willow'])assert.equal(JSON.stringify(G.A_ART['tree-a-v1-'+kind]),JSON.stringify(G.A_ART['tree-a-v1-'+kind+'-winter']));G.game.season=1;t.b=G.game.day;G.drawTree({},t,{variant:true,scale:1});assert.equal(selected.at(-1),'tree-a-v2-willow-sapling');const a=JSON.stringify(G.treeVariation(t));G.treeVariation({...t,b:t.b+30});assert.equal(JSON.stringify(G.treeVariation(t)),a);});
test('presentation lookup is deterministic and leaves serialized game unchanged',()=>{const {G,b}=home();const before=JSON.stringify(G.serializeGame());for(let i=0;i<20;i++){G.houseArtName(b);G.treeVariation({x:10,y:11,b:-100});}assert.equal(JSON.stringify(G.serializeGame()),before);});
test('runtime workshop export keeps original calibrated geometry and PNG dimensions',()=>{
 const G=fresh();for(const [name,anchor,span] of [['woodcutter-a-idle',[790,957],1097],['woodcutter-a-processing-v2',[790,964],1123]]){
  const spec=G.A_ART[name],png=fs.readFileSync(path.join(root,'assets/a-style',name+'.png'));
  assert.equal(png.readUInt32BE(16),1056);assert.equal(png.readUInt32BE(20),704);
  assert.equal(spec.source[0],1056);assert.equal(spec.source[1],704);
  for(let j=0;j<2;j++)assert.equal(spec.anchor[j]/spec.span,anchor[j]/span);
  assert.equal(spec.source[0]/spec.span,1536/span);
 }
 const s=G.A_ART['woodcutter-a-processing-v2'];
 assert.equal((s.contact[0]-s.anchor[0])/s.span,(750-790)/1123);
 assert.equal((s.contact[1]-s.anchor[1])/s.span,(673-964)/1123);
 for(const file of fs.readdirSync(path.join(root,'assets/portraits')).filter(x=>x.endsWith('.png'))){const b=fs.readFileSync(path.join(root,'assets/portraits',file));assert.equal(b.readUInt32BE(16),288);assert.equal(b.readUInt32BE(20),288);}
});
console.log(`A-style art: ${passed} suites passed`);
