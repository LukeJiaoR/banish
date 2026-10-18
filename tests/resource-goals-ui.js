/* Focus and modal DOM contracts only. No browser/touch/layout acceptance. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function fixture(){
 const roots=[],handlers={};
 const doc={activeElement:null,visibilityState:'visible',getElementById(id){return roots.flatMap(x=>[x,...x.descendants()]).find(x=>x.id===id)||null;},addEventListener(){}};
 function element(tag='div',attrs={}){
  const events={},classes=new Set((attrs.class||'').split(/\s+/));let html='',text='';
  return {id:attrs.id||'',tagName:tag.toUpperCase(),dataset:Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),v])),children:[],parentNode:null,style:{},htmlWrites:0,value:'',tabIndex:0,disabled:false,
  classList:{add(x){classes.add(x)},remove(x){classes.delete(x)},contains(x){return classes.has(x)},toggle(x,on){if(on)classes.add(x);else classes.delete(x)}},
  appendChild(c){this.children.push(c);c.parentNode=this;return c},descendants(){return this.children.flatMap(c=>[c,...c.descendants()])},contains(c){for(;c;c=c.parentNode)if(c===this)return true;return false},
  querySelectorAll(sel){return this.descendants().filter(c=>sel.split(',').some(s=>{s=s.trim();if(s[0]==='#')return c.id===s.slice(1);if(s[0]==='.')return c.classList.contains(s.slice(1));if(s==='[tabindex]')return c.getAttribute('tabindex')!==null;return c.tagName===s.split(/[:\[]/)[0].toUpperCase()}))},querySelector(s){return this.querySelectorAll(s)[0]||null},
  focus(){doc.activeElement=this},addEventListener(type,fn){(events[type]||=[]).push(fn)},click(){this.focus();for(const f of events.click||[])f({target:this})},emit(type,e={}){e=Object.assign({target:this,button:0,clientX:1,clientY:1,preventDefault(){this.prevented=true}},e);for(const f of events[type]||[])f(e);return e},
  setAttribute(k,v){this.attrs[k]=String(v)},getAttribute(k){return this.attrs[k]??null},attrs:{...attrs},closest(){return null},getClientRects(){return [{}]},getBoundingClientRect(){return{left:0,top:0}},getContext(){return{}},
  appendText(v){text+=v},get textContent(){return text+this.children.map(c=>c.textContent).join('')},set textContent(v){text=String(v);this.children=[]},get innerHTML(){return html},set innerHTML(v){html=String(v);this.htmlWrites++;this.children=[];text='';const stack=[this];for(const t of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/gi)){if(t[4])stack.at(-1).appendText(t[4]);else if(t[1])stack.pop();else{const a=Object.fromEntries(Array.from(t[3].matchAll(/([\w-]+)="([^"]*)"/g),m=>[m[1],m[2]]));const c=stack.at(-1).appendChild(element(t[2],a));if(!['img','br','input'].includes(t[2]))stack.push(c)}}}};
 }
 function mount(id,tag='div',hidden=false){const x=element(tag,{id,class:hidden?'hidden':''});roots.push(x);return x}
 for(const id of ['help','over','fb','errs','saves','production-goals'])mount(id,'div',true);
 const modal=doc.getElementById('production-goals');
 const page=fs.readFileSync(path.join(root,'index.html'),'utf8'),block=page.slice(page.indexOf('  <div id="production-goals"'),page.indexOf('  <div id="saves"'));
 modal.innerHTML=block.slice(block.indexOf('>')+1,block.lastIndexOf('</div>'));const rows=doc.getElementById('production-goal-rows');
 mount('btn-production-goals','button');mount('game','canvas');mount('info');
 const ctx={console,document:doc,__errs:[],innerWidth:390,innerHeight:844,setTimeout(){},setInterval(){},localStorage:{getItem(){return null}},location:{protocol:'file:'},performance:{now(){return 0}},requestAnimationFrame(){},addEventListener(type,fn){(handlers[type]||=[]).push(fn)}};ctx.window=ctx;vm.createContext(ctx);
 for(const n of ['core','defs','map','sim','supply','goal-presets','ui','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),ctx);
 const G=ctx.G;G.ui.toast=()=>{};G.ui.refreshHUD=()=>G.ui.refreshProductionGoals();G.ui.hideInfo=()=>{G.sel=null};G.ui.setToolActive=()=>{};G.T2S=()=>[0,0];G.cam={x:0,y:0,z:1};G.markGroundDirty=()=>{};G.groundDirty=new Set();G.autosave=()=>{};G._hasShownHelp=true;G.newGame(21);G.ui.el={info:doc.getElementById('info'),help:doc.getElementById('help')};G.ui.initProductionGoals();
 return {G,doc,rows,modal,handlers,ctx,button(type,key,val){return rows.querySelectorAll('button').find(b=>b.dataset.goal===type&&b.dataset[key]===val)},emit(type,e={}){e=Object.assign({key:'',target:doc.activeElement,preventDefault(){this.prevented=true}},e);for(const f of handlers[type]||[])f(e);return e}};
}
let pass=0,fail=0;function test(n,fn){try{fn();pass++;console.log('ok '+n)}catch(e){fail++;console.error('FAIL '+n+'\n'+e.stack)}}
test('all registry rows distinguish hard storage, inheritance, and committed farms',()=>{const f=fixture();f.G.ui.showProductionGoals();assert.equal(f.rows.children.filter(x=>x.dataset['goal-row']).length,20);assert.equal(f.G.RES_KEYS.length,20);for(const k of f.G.RES_KEYS){assert.ok(f.doc.getElementById('goal-input-'+k));assert.match(f.doc.getElementById('goal-status-'+k).textContent,/继承原规则/)}assert.match(f.doc.getElementById('goal-stock-tools').textContent,/不限/)});
test('opening twice and closing twice preserves existing pause and restores focus',()=>{for(const paused of [false,true]){const f=fixture(),opener=f.doc.getElementById('btn-production-goals');opener.focus();f.G.game.paused=paused;f.G.ui.showProductionGoals();f.G.ui.showProductionGoals();assert.equal(f.G.game.paused,true);assert.equal(f.G.topModal(),f.modal);f.G.ui.closeProductionGoals();f.G.ui.closeProductionGoals();assert.equal(f.G.game.paused,paused);assert.equal(f.doc.activeElement,opener)}});
test('refresh never replaces focused input or overwrites uncommitted draft',()=>{const f=fixture();f.G.ui.showProductionGoals();const input=f.doc.getElementById('goal-input-food');input.value='1234';input.focus();const writes=f.rows.htmlWrites;const before=JSON.stringify(f.G.game);for(let n=0;n<100;n++)f.G.ui.refreshProductionGoals();assert.equal(f.rows.htmlWrites,writes);assert.equal(input.value,'1234');assert.equal(f.doc.activeElement,input);assert.equal(JSON.stringify(f.G.game),before)});
test('batch controls stage, validate all rows, apply and retain hysteresis',()=>{
 const f=fixture(),{G}=f;G.ui.showProductionGoals();const food=f.doc.getElementById('goal-input-food'),wood=f.doc.getElementById('goal-input-wood'),apply=f.doc.getElementById('production-goals-apply');
 food.value='200';wood.value='80';food.emit('input');assert.equal(G.productionGoalOf('food'),null);apply.click();assert.equal(G.productionGoalOf('food'),200);assert.equal(G.productionGoalOf('wood'),80);assert.equal(G.goalPaused('food'),true);
 G.game.res.food=190;G.updateProductionGoals();apply.click();assert.equal(G.goalPaused('food'),true);
 food.value='250';wood.value='-1';let writes=0;const original=G.setProductionGoal;G.setProductionGoal=(...a)=>{writes++;return original(...a)};apply.click();assert.equal(writes,0);assert.equal(G.productionGoalOf('food'),200);assert.equal(f.doc.activeElement,wood);assert.equal(wood.getAttribute('aria-invalid'),'true');
 f.button('food','inherit','true').click();assert.equal(G.productionGoalOf('food'),200);assert.equal(food.value,'');wood.value='80';apply.click();assert.equal(G.productionGoalOf('food'),null);
});
test('0 and capacity warnings are truthful during status transitions with focus intact',()=>{const f=fixture();f.G.ui.showProductionGoals();const input=f.doc.getElementById('goal-input-stone');input.focus();f.G.setProductionGoal('stone',0);f.G.ui.refreshProductionGoals();assert.match(f.doc.getElementById('goal-status-stone').textContent,/关闭新自动生产/);f.G.setProductionGoal('stone',f.G.storageCap()+1);f.G.ui.refreshProductionGoals();assert.match(f.doc.getElementById('goal-status-stone').textContent,/高于仓容.*余矿保留/);f.G.setProductionGoal('food',f.G.storageCap()+1);f.G.ui.refreshProductionGoals();assert.match(f.doc.getElementById('goal-status-food').textContent,/高于仓容.*损失/);assert.equal(f.doc.activeElement,input)});
test('modal is wired into actual escape, tab, map, speed and pan guards',()=>{const f=fixture(),{G}=f;G.ui.init=()=>{};G.feedback={init(){}};G.initSprites=()=>{};G.resize=()=>{};G.draw=()=>{};G.render=()=>{};G.frame=()=>{};G.probeServerSaves=()=>{};G.init();G.ui.showProductionGoals();const input=f.doc.getElementById('goal-input-wood');input.focus();input.value='400';G.tool={kind:'road'};let paint=0;G.paintRoad=()=>paint++;f.doc.getElementById('game').emit('mousedown');f.doc.getElementById('game').emit('mousemove',{clientX:20,clientY:20});f.emit('mouseup');assert.equal(paint,0);const speed=G.game.speed;f.emit('keydown',{key:'3'});f.emit('keydown',{key:' '});f.emit('keydown',{key:'w'});assert.equal(G.game.speed,speed);assert.equal(G.game.paused,true);assert.deepEqual(Object.keys(G.keys),[]);const stops=f.modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]');stops.at(-1).focus();assert.equal(f.emit('keydown',{key:'Tab'}).prevented,true);assert.equal(f.doc.activeElement,stops[0]);input.focus();f.emit('keydown',{key:'Escape'});assert.equal(f.modal.classList.contains('hidden'),true);assert.equal(G.game.paused,false);assert.equal(G.productionGoalOf('wood'),null)});
test('invalid native number draft cannot silently restore inheritance',()=>{const f=fixture();f.G.setProductionGoal('wood',100);f.G.ui.showProductionGoals();const input=f.doc.getElementById('goal-input-wood');input.value='';input.validity={badInput:true};f.doc.getElementById('production-goals-apply').click();assert.equal(f.G.productionGoalOf('wood'),100);assert.match(f.doc.getElementById('production-goals-message').textContent,/有效数字/);input.validity.badInput=false;f.doc.getElementById('production-goals-apply').click();assert.equal(f.G.productionGoalOf('wood'),null)});
test('legacy local controls explain min sources and repeated bounds do not clear hysteresis',()=>{
 const f=fixture(),{G}=f,b={id:999,type:'blacksmith',state:'ok',workers:[],x:20,y:20,w:3,h:3,toolLimit:500};G.world.buildings.push(b);G.world.bmap[b.id]=b;G.sel={kind:'b',id:b.id};G.game.res.tools=500;G.setProductionGoal('tools',1000);G.game.res.tools=499;G.updateProductionGoals();G.ui.renderInfo();const info=f.doc.getElementById('info');assert.match(info.innerHTML,/全镇 1000 与本屋 500 取较低值/);info.querySelectorAll('button').find(x=>x.dataset.tl==='10').click();assert.equal(G.toolLimited(b),true);b.toolLimit=450;G.game.res.tools=455;G.updateProductionGoals();G.ui.renderInfo(true);info.querySelectorAll('button').find(x=>x.dataset.tl==='10').click();assert.equal(b.toolLimit,460);assert.equal(G.toolLimited(b),false);
});
test('zero and blank differ in the same batch without changing stock or local limits',()=>{
 const f=fixture(),{G}=f;G.setProductionGoal('stone',35);G.ui.showProductionGoals();const before=JSON.stringify(G.game.res);
 f.doc.getElementById('goal-input-wood').value='0';f.doc.getElementById('goal-input-stone').value='';f.doc.getElementById('production-goals-apply').click();
 assert.equal(G.productionGoalOf('wood'),0);assert.equal(G.goalPaused('wood'),true);assert.equal(G.productionGoalOf('stone'),null);assert.equal(JSON.stringify(G.game.res),before);
});
test('all invalid number forms reject the entire batch, including a late row',()=>{
 for(const value of ['1.2','-1','1e3','Infinity','1000001','abc']){const f=fixture(),{G}=f;G.ui.showProductionGoals();f.doc.getElementById('goal-input-wood').value='30';f.doc.getElementById('goal-input-warmCoats').value=value;const before=JSON.stringify(G.game);f.doc.getElementById('production-goals-apply').click();assert.equal(JSON.stringify(G.game),before);}
});
test('closing and resetting discard unapplied edits while apply stays explicit',()=>{
 const f=fixture(),{G}=f;G.setProductionGoal('wood',22);G.ui.showProductionGoals();const wood=f.doc.getElementById('goal-input-wood');wood.value='77';f.doc.getElementById('production-goals-reset').click();assert.equal(wood.value,'22');wood.value='66';G.ui.closeProductionGoals();assert.equal(G.productionGoalOf('wood'),22);G.ui.showProductionGoals();assert.equal(wood.value,'22');
});
test('recommendations stage only their listed values and retain other drafts',()=>{
 const f=fixture(),{G}=f;G.setProductionGoal('meat',0);G.ui.showProductionGoals();f.doc.getElementById('goal-input-ale').value='17';const before=JSON.stringify(G.serializeGame());
 for(const mode of ['balanced','winter','stockpile']){f.doc.getElementById('goal-preset-'+mode).click();assert.equal(JSON.stringify(G.serializeGame()),before);assert.equal(f.doc.getElementById('goal-input-ale').value,'17');assert.equal(f.doc.getElementById('goal-input-meat').value,'0');assert.match(f.doc.getElementById('goal-preset-notes').textContent,/不保证.*过冬/);}
 f.doc.getElementById('production-goals-apply').click();assert.ok(G.productionGoalOf('food')>0);assert.equal(G.productionGoalOf('ale'),17);assert.equal(G.productionGoalOf('meat'),0);
});
test('draft gaps use distributed stock and exclude ordinary production cargo',()=>{
 const f=fixture(),{G}=f;G.game.supplyMode='physical';G.game.res.grain=100;G.game.res.meat=0;G.game.res.vegetables=0;G.game.res.food=100;
 const house={id:999,type:'house',state:'ok',family:1,supplyStock:{grain:12}};G.world.buildings.push(house);
 G.world.citizens[0].carry={type:'grain',qty:7,supplyBatch:{kind:'home',to:999}};G.world.citizens[1].carry={type:'grain',qty:50};
 G.ui.showProductionGoals();const input=f.doc.getElementById('goal-input-food');input.value='150';input.emit('input');assert.equal(f.doc.getElementById('goal-stock-value-food').textContent,'119');assert.equal(f.doc.getElementById('goal-gap-food').textContent,'31');assert.match(f.doc.getElementById('goal-public-food').textContent,/公共 100/);
 input.value='';input.emit('input');assert.equal(f.doc.getElementById('goal-gap-food').textContent,'—');input.value='0';input.emit('input');assert.equal(f.doc.getElementById('goal-gap-food').textContent,'0');assert.match(f.doc.getElementById('goal-gap-note-food').textContent,/停止新生产/);
});
test('stale or hidden dialogs cannot apply to a replaced game or change its pause',()=>{
 const f=fixture(),{G}=f;G.ui.showProductionGoals();f.doc.getElementById('goal-input-wood').value='0';const old=G.game;G.game=G.newGameState();G.game.paused=true;f.doc.getElementById('production-goals-apply').click();assert.equal(G.productionGoalOf('wood'),null);assert.equal(old.productionGoals,undefined);G.ui.closeProductionGoals();assert.equal(G.game.paused,true);
 f.doc.getElementById('production-goals-apply').click();assert.equal(G.productionGoalOf('wood'),null);
});
test('semantic table and bounded scroll body keep actions outside the scrolling table',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),css=fs.readFileSync(path.join(root,'styles/resource-goals.css'),'utf8');
 assert.match(html,/<table class="production-goal-table">/);assert.match(html,/<th scope="col">草稿缺口/);assert.match(html,/<footer class="production-goals-footer">/);assert.match(css,/production-goals-body[^}]*min-height: 0[^}]*overflow-y: auto/s);assert.match(css,/production-goals-footer[^}]*flex: 0 0 auto/s);assert.match(css,/100dvh/);
});
test('interrupted pointer and old-session apply clicks cannot commit reopened drafts',()=>{
 const f=fixture(),{G}=f;G.ui.showProductionGoals();const apply=f.doc.getElementById('production-goals-apply');apply.emit('pointerdown');G.ui.closeProductionGoals();G.ui.showProductionGoals();f.doc.getElementById('goal-input-wood').value='0';apply.click();assert.equal(G.productionGoalOf('wood'),null);
 apply.emit('pointerdown');apply.emit('pointercancel');apply.click();assert.equal(G.productionGoalOf('wood'),null);apply.emit('pointerdown');apply.click();assert.equal(G.productionGoalOf('wood'),0);
});
test('native rule summaries are included in modal keyboard focus stops',()=>{
 const f=fixture(),{G}=f;G.ui.init=()=>{};G.feedback={init(){}};G.initSprites=()=>{};G.resize=()=>{};G.draw=()=>{};G.render=()=>{};G.frame=()=>{};G.probeServerSaves=()=>{};G.init();G.ui.showProductionGoals();
 const summary=f.rows.querySelector('summary');assert.equal(summary.getAttribute('tabindex'),'0');summary.focus();const stops=f.modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]');assert.ok(stops.includes(summary));const event=f.emit('keydown',{key:'Tab'});assert.equal(event.prevented,undefined);assert.equal(f.doc.activeElement,summary);
});
test('individual tool gaps count a partial spare once and never count equipped tools',()=>{
 const f=fixture(),{G}=f;G.game.toolMode='individual';G.game.res.tools=3;G.game.toolRemainders={tools:10,steelTools:0};G.world.citizens[0].toolType='tools';G.world.citizens[0].toolHours=50;
 G.ui.showProductionGoals();const input=f.doc.getElementById('goal-input-tools');input.value='10';input.emit('input');assert.equal(f.doc.getElementById('goal-stock-value-tools').textContent,'4');assert.equal(f.doc.getElementById('goal-gap-tools').textContent,'6');assert.match(f.doc.getElementById('goal-stock-tools').textContent,/不含已装备/);
});
test('lower suggestions explicitly warn before replacing a higher food draft',()=>{
 const f=fixture(),{G}=f;G.ui.showProductionGoals();f.doc.getElementById('goal-input-food').value='999';f.doc.getElementById('goal-preset-balanced').click();assert.equal(G.productionGoalOf('food'),null);assert.match(f.doc.getElementById('goal-preset-notes').textContent,/建议调低草稿：食物 999 →/);assert.match(f.doc.getElementById('goal-preset-notes').textContent,/应用后可能提前停产/);
});
console.log(`Resource goal UI: ${pass} passed, ${fail} failed (DOM only).`);if(fail)process.exitCode=1;
