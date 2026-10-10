'use strict';
// Player-visible warning response: change targets, mark resources, pay for a smith.
const fs=require('fs');const {run}=require('./helpers/playability');const root=require('node:path').resolve(__dirname,'..'),results=[];
for(const mode of ['unmanaged','marked-recovery','early-smith']){let initialized=false,active=false,done=false,changes=[];const r=run(root,29,'normal',5,G=>{const g=G.game,w=G.world;
 if(!initialized){for(const[k,v]of Object.entries({food:1000,wood:150,stone:100,iron:40,tools:40,firewood:150}))G.setProductionGoal(k,v);initialized=true;}
 const trigger=mode==='unmanaged'?false:mode==='early-smith'?g.res.tools<=10:g.warned.toolsLow;
 if(trigger&&!active&&!done&&!w.buildings.some(b=>b.type==='blacksmith')){active=true;G.setProductionGoal('food',300);G.setProductionGoal('firewood',60);changes.push({day:g.day,action:'reserve labor and logs: food300/firewood60',res:{...g.res}})}
 if(active){const smith=w.buildings.find(b=>b.type==='blacksmith');if(smith){active=false;done=true;G.setProductionGoal('food',1000);G.setProductionGoal('firewood',150);changes.push({day:g.day,action:'smith started; restore targets',res:{...g.res}})}else{
 const origin=G.nearestWalkable(w,w.start.x,w.start.y,8),gatherers=w.buildings.filter(b=>b.type==='gatherer');
 if(g.res.wood<50&&w.marked.size<4){const ts=w.trees.filter(t=>G.treeStage(t)>=2&&gatherers.every(b=>G.d2(t.x,t.y,b.x,b.y)>(G.PROD.gatherer.radius+1)**2)&&!w.marked.has(t.i)&&G.findPath(w,origin.x,origin.y,t.x,t.y));ts.sort((a,b)=>G.d2(a.x,a.y,origin.x,origin.y)-G.d2(b.x,b.y,origin.x,origin.y));const before=w.marked.size;for(const t of ts.slice(0,10))G.markFellAt(w,t.x,t.y);const n=w.marked.size-before;if(n)changes.push({day:g.day,action:'mark trees',count:n})}
 if(g.res.stone<24&&w.markedRocks.size<2){const rocks=[];for(let i=0;i<w.rock.length;i++)if(w.rock[i]===1&&!w.markedRocks.has(i)){const x=i%w.N,y=(i/w.N)|0;if(G.findPath(w,origin.x,origin.y,x,y))rocks.push({x,y})}rocks.sort((a,b)=>G.d2(a.x,a.y,origin.x,origin.y)-G.d2(b.x,b.y,origin.x,origin.y));const before=w.markedRocks.size;for(const t of rocks.slice(0,3))G.markRockAt(w,t.x,t.y);const n=w.markedRocks.size-before;if(n)changes.push({day:g.day,action:'mark stone',count:n})}
 }}
 });r.mode=mode;r.changes=changes;results.push(r);console.log(mode,r.day,r.population,r.died,r.causes,r.resources,JSON.stringify(changes),r.buildLog.join('|'));}
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(results,null,2));
const assert=require('node:assert/strict');
assert.ok(results.find(r=>r.mode==='unmanaged').causes['饿死']>0,'unchanged failure strategy remains a real counterexample');
for(const r of results.filter(r=>r.mode!=='unmanaged')){assert.equal(r.day,240,'recovery reaches five winters');assert.equal(r.died,0,'warning response prevents deaths');assert.ok(r.resources.tools>0,'tools recovered');assert.ok(r.changes.some(c=>c.action==='smith started; restore targets'),'actually started paid smith');assert.ok(r.changes.some(c=>c.action==='mark trees'),'real tree markings were made');}
console.log('Unmanaged starvation retained; two same-seed, real-cost recovery policies passed; no free resources, worker overrides, or economy tuning.');
