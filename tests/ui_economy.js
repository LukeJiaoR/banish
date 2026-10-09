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
