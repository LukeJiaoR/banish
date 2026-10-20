'use strict';
// DOM-contract checks only; not browser geometry or touch acceptance.
const assert = require('node:assert/strict');
const {loadGame}=require('./helpers/playability');
const path=require('node:path'),fs=require('node:fs');
const G=loadGame(path.resolve(__dirname,'..'));
global.window=global;global.G=G;require('../js/ui.js');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.open=false;this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  querySelector(q){return this.children.find(n=>q[0]==='.'?n.className===q.slice(1):n.tag===q)||this.children.map(n=>n.querySelector(q)).find(Boolean);}
}
global.document={createElement:tag=>new Element(tag)};
G.game.res={wood:10,stone:0,iron:0};
const el=new Element('div');
G.ui.renderPlacementPreview(el,'gatherer','完整预览\n不能建：地形\n缺料与生产警告');
const d=el.querySelector('details'),summary=d.querySelector('summary');
assert.equal(d.open,false);
assert.match(summary.textContent,/木材30（缺20）/);
assert.match(d.querySelector('.placement-full').textContent,/不能建：地形\n缺料与生产警告/);
d.open=true;G.game.res.wood=100;
G.ui.renderPlacementPreview(el,'gatherer','刷新完整预览');
assert.equal(el.querySelector('details'),d);assert.equal(d.querySelector('summary'),summary);
assert.equal(d.open,true);assert.doesNotMatch(summary.textContent,/木材30（缺/);
G.ui.renderPlacementPreview(el,'house','住宅预览');assert.equal(d.open,false);
d.open=false;G.ui.renderPlacementPreview(el,'house','关闭详情后实时刷新');assert.equal(d.open,false);
d.open=true;G.ui.renderPlacementPreview(el,'house','展开详情后实时刷新');assert.equal(d.open,true);
const css=fs.readFileSync(path.join(__dirname,'../styles/mobile-occlusion.css'),'utf8');
assert.match(css,/max-height:500px\) and \(min-width:761px/);
assert.match(css,/left:282px/);assert.match(css,/max-height:60px/);
assert.match(css,/min-height:44px/);
console.log('PASS mobile preview content, shortages, disclosure persistence, explicit open/closed persistence, and stylesheet contracts (not visual QA)');
