'use strict';
// DOM markup and actual setTool -> tryPlace -> addBuilding contracts, no browser claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadGame} = require('./helpers/playability');
const G = loadGame(path.resolve(__dirname, '..'));
global.G = G; global.window = global;
global.document = {getElementById(){return null;}};
require('../js/ui.js');
const ui = G.ui;
G.ui.toast = ()=>{}; G.ui.refreshHUD = ()=>{}; G.ui.hideInfo=()=>{};G.ui.setToolActive=()=>{};
G.ui.toggleHelp=()=>{};G.newGame(4712);
const snapshot=()=>JSON.stringify(G.serializeGame());
const before=snapshot();
const markup=ui.toolButton('house');
assert.match(markup,/木材 16/);assert.match(markup,/石头 8/);assert.match(markup,/class="ui-icon"/);
assert(markup.includes('assets/icons/tool_house.png')); assert(!markup.includes('disabled'));
assert.equal(snapshot(),before);
G.game.res.wood=0;G.game.res.stone=0;
assert.match(ui.toolMaterialShortage('house'),/木材缺16、石头缺8/);
assert.match(ui.toolButton('house'),/缺料 · 可选址/);
const empty=snapshot();G.setTool('house');assert.equal(G.tool.type,'house');assert.equal(snapshot(),empty);
let position;
for(let y=1;y<G.world.N-3&&!position;y++)for(let x=1;x<G.world.N-3;x++)if(G.canPlace(G.world,'house',x,y).ok){position={x,y};break;}
assert(position);
const buildings=G.world.buildings.length;
G.tryPlace(position.x,position.y);
assert.equal(G.world.buildings.length,buildings);assert.equal(G.game.res.wood,0);assert.equal(G.game.res.stone,0);
G.game.res.wood=16;G.game.res.stone=8;
assert.equal(ui.toolMaterialShortage('house'),'');
G.tryPlace(position.x,position.y);
assert.equal(G.world.buildings.length,buildings+1);
assert.equal(G.world.buildings.at(-1).state,'site');
assert.equal(G.game.res.wood,16);assert.equal(G.game.res.stone,8);
assert.equal(G.world.buildings.at(-1).construction.required.wood,16);
G.tryPlace(position.x,position.y);assert.equal(G.world.buildings.length,buildings+1);
// Distributed/held stock is not added to public affordability.
G.game.res.wood=0;G.supplyInventory=()=>({available:{wood:999,stone:999}});
assert.match(ui.toolMaterialShortage('house'),/木材缺16/);
for(const key of G.RES_KEYS){const icon=ui.resourceIcon(key);assert.match(icon,/aria-label=/);assert(icon.includes(`assets/icons/${G.RES[key].iconAsset}.png`));}
for(const type of ['farm','pasture','orchard','cemetery','road','stoneroad','bridge','tunnel'])assert.equal(ui.toolMaterialShortage(type),'');
const css=fs.readFileSync(path.join(__dirname,'../styles/readability.css'),'utf8');
assert.match(css,/--ui-body: 12px/);assert.match(css,/--ui-secondary: 11px/);assert.match(css,/focus-visible/);
console.log('Build affordability, original resource icons and typography: 15 contract groups passed.');
