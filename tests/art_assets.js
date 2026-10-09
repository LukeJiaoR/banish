/* node tests/art_assets.js — manifest paths, sprite coverage, load fallback and badges. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = global;
require('../js/core.js');
require('../js/defs.js');
const queued = [];
global.Image = class {
  set src(value) { this.path = value; queued.push(this); }
};
require('../js/sprites.js');
for (const image of queued) {
  const file = path.join(__dirname, '..', image.path);
  assert(fs.existsSync(file), `Missing manifest asset: ${image.path}`);
  assert(fs.readFileSync(file).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  image.onload();
}
assert(G.SPR.ready);
assert.deepStrictEqual(G.SPR.failed, []);
for (const type of G.TOOLBAR.filter(type => G.BDEF[type] && !['farm','road','fell'].includes(type))) {
  assert(G.SPR.get(type), `Building has only a geometric fallback: ${type}`);
}
for (const resource of G.RES_KEYS) assert(G.SPR.get('carry_' + resource), `Missing carried ${resource}`);
for (const name of ['tool_stonehouse','tool_boarding','tool_mine','tool_blacksmith','tool_hunting','res_iron','res_tools']) assert(G.SPR.get(name));
G.needGround = false;
queued.find(image => image.path.endsWith('/res_iron.png')).onload();
assert(G.needGround, 'Ore sprite must invalidate cached ground');
require('../js/render.js');
const calls = [];
const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]), set: () => true });
G.drawNeedBadge(ctx, 20, 30, 'cold');
G.drawNeedBadge(ctx, 20, 30, 'food');
assert.equal(calls.filter(call => call[0] === 'save').length, 2);
assert.equal(calls.filter(call => call[0] === 'restore').length, 2);
assert(!calls.some(call => call[0] === 'fillText'), 'Need badges must not depend on emoji glyphs');
console.log(`Art assets: ${queued.length} PNG paths and all buildings/carry resources verified; badge drawing passed.`);
