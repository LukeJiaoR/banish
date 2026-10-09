'use strict';
// Logic/DOM contract checks, not browser acceptance.
const assert = require('node:assert/strict');
const {loadGame}=require('./helpers/playability');
const path=require('node:path');
const G=loadGame(path.resolve(__dirname,'..'));
global.window=global;global.G=G;require('../js/ui.js');
G.ui.toast=()=>{};G.ui.refreshHUD=()=>{};G.ui.hideInfo=()=>{};G.ui.setToolActive=()=>{};
const toggleHelp=G.ui.toggleHelp;G.ui.toggleHelp=()=>{};G.newGame(1);G.ui.toggleHelp=toggleHelp;
global.document={getElementById(){return null;}};
assert.equal(typeof G.placementInfo,'function');
const x=G.world.start.x+4,y=G.world.start.y+4;
const p=G.placementInfo('gatherer',x,y);
assert.equal(p.radius,G.PROD.gatherer.radius);
assert.deepEqual(p.bounds,[Math.max(0,x-p.radius),Math.max(0,y-p.radius),Math.min(G.world.N,x+p.radius+1),Math.min(G.world.N,y+p.radius+1)]);
const edge=G.placementInfo('gatherer',0,0);assert.deepEqual(edge.bounds,[0,0,edge.radius+1,edge.radius+1]);
assert.equal(p.trees,G.treesInRadius(G.world,x,y,p.radius,false).filter(t=>!(t.x>=x&&t.x<x+2&&t.y>=y&&t.y<y+2)).length);
G.game.res.wood=0;
const poor=G.placementInfo('gatherer',x,y);
assert.equal(poor.affordable,false);assert.match(poor.text,/木材.*0\/30/);
assert.match(poor.text,/工作范围/);assert.match(poor.text,/仓/);
const dock=G.placementInfo('dock',x,y);assert.equal(dock.water,G.countWaterInRadius(G.world,x,y,G.PROD.dock.waterR));
let hidden=true;G.ui.el.help={classList:{contains:()=>hidden,toggle(k,v){hidden=v;}}};
G.game.paused=false;G.ui.toggleHelp(true);assert.equal(G.game.paused,true);G.ui.toggleHelp(true);G.ui.toggleHelp(false);assert.equal(G.game.paused,false);
G.game.paused=true;G.ui.toggleHelp(true);G.ui.toggleHelp(false);assert.equal(G.game.paused,true);
const fs=require('node:fs');const css=fs.readFileSync(path.join(__dirname,'../style.css'),'utf8');
assert.match(css,/overflow-x:\s*auto/);assert.match(css,/:focus-visible/);
console.log('Placement UX logic, help pause, and responsive CSS contracts passed (no browser QA).');

const preview={textContent:'',dataset:{},classList:{add(){},remove(){}}};G.ui.el.placement=preview;
let spot;for(let yy=0;yy<G.world.N-8&&!spot;yy++)for(let xx=0;xx<G.world.N-8;xx++)if(G.canPlace(G.world,'farm',xx,yy).ok){spot={x:xx,y:yy};break;}
G.ui.refreshPlacement('farm',spot.x,spot.y);assert.match(preview.textContent,/可建造/);
const result=G.addBuilding('farm',spot.x,spot.y);assert.equal(result.ok,true);
G.ui.refreshPlacement('farm',spot.x,spot.y);assert.match(preview.textContent,/不能建/);
console.log('Paused free placement invalidates the preview text cache.');
