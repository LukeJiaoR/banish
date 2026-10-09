/* DOM-stub behavior checks; these are not browser/visual acceptance. */
'use strict';
const assert=require('node:assert/strict');
global.window=global;
for(const name of ['core','defs','map','sim','ui']) require('../js/'+name+'.js');
const buttons=[];
const info={innerHTML:'',querySelectorAll(){
  buttons.length=0;
  for(const match of this.innerHTML.matchAll(/<button class="mini-tog" data-(tl|fl)="([^"]+)"/g)) {
    const b={dataset:{[match[1]]:match[2]},addEventListener(name,fn){this[name]=fn;}};buttons.push(b);
  }
  return buttons;
}};
global.document={getElementById(){return{addEventListener(){}}}};
const b={id:1,type:'blacksmith',state:'ok',workers:[],toolLimit:30};
G.world={bmap:{1:b},buildings:[b],cmap:{},citizens:[],families:[]};G.sel={kind:'b',id:1};G.ui.el.info=info;
G.game=G.newGameState();G.game.res.tools=30;G.game.res.iron=10;
G.ui.renderInfo();assert.match(info.innerHTML,/工具已达上限/);assert.match(info.innerHTML,/工具上限：<b>30/);
buttons.find(x=>x.dataset.tl==='10').click();assert.equal(b.toolLimit,40);assert.match(info.innerHTML,/等待可用工人/);
b.toolLimit=0;G.ui.renderInfo();buttons.find(x=>x.dataset.tl==='-10').click();assert.equal(b.toolLimit,0);
b.toolLimit=500;G.ui.renderInfo();buttons.find(x=>x.dataset.tl==='10').click();assert.equal(b.toolLimit,500);
b.toolLimit='<img onerror=bad()>';G.ui.renderInfo();assert.ok(!info.innerHTML.includes('onerror=bad'));assert.match(info.innerHTML,/工具上限：<b>30/);
console.log('UI economy: target controls, bounds, staffing feedback and numeric fallback passed (DOM stubs only).');
const evil=G.spawnCitizen({x:0,y:0,age:30,sex:'m',name:'<img src=x onerror=bad()>'});
evil.name='<img src=x onerror=bad()>';G.sel={kind:'c',id:evil.id};G.ui.renderInfo();assert.ok(!info.innerHTML.includes('<img src=x'));assert.match(info.innerHTML,/&lt;img/);
console.log('Imported citizen labels are escaped.');
assert.match(G.ui.saveGameStr({game:{}}),/格式不完整/);
assert.match(G.ui.saveGameStr({game:{year:'<img>',day:0,season:0,res:{food:20}}}),/格式不完整/);
console.log('Malformed save summaries remain reviewable.');
const controls={};global.document={getElementById(id){return controls[id] || (controls[id]={classList:{toggle(){}},querySelectorAll(){return[];}});}};
global.localStorage={getItem(){throw new Error('SecurityError');}};
G.ui.renderServerSaves=()=>{};let exported=false;G.exportSaveFile=()=>{exported=true;};
G.ui.renderSaves();assert.match(controls['saves-hint'].textContent,/本机存储不可用/);
controls['save-export'].onclick();assert.equal(exported,true);assert.equal(typeof controls['save-import'].onclick,'function');
console.log('Blocked local storage still allows current-game file export/import.');
G.ui.el.guide={textContent:''};G.world.buildings.push({id:2,type:'house',state:'ok',family:5});G.world.families=[{id:5,houseId:2,members:[evil.id]}];
G.game.season=2;G.game.res.wood=0;G.game.res.firewood=0;G.ui.refreshGuide();
assert.match(G.ui.el.guide.textContent,/木材耗尽.*更远可达森林/);assert.match(G.ui.el.guide.textContent,/柴火不足/);
console.log('Wood exploration and autumn fuel warnings persist in the guide.');

G.game.season=3;G.game.day=47;G.ui.refreshGuide();assert.ok(!G.ui.el.guide.textContent.includes('柴火不足'),'last winter day has no future heating deductions');
