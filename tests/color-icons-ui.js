/* Pigment/markup regression only. Real browser evidence is recorded separately. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = { G: {}, window: {}, document: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), context);
const icon = name => context.G.ui.icon(name);
const tones = new Set(['ochre','copper','moss','slate','berry','plum']);
const colored = ['wood','stone','iron','coal','tools','steelTools','food','meat','eggs','vegetables','grain','apples','pears','firewood','leather','wool','clothes','warmCoats','herbs','ale','homes','industry','services','land','farm','save','folder','sprout','mail','help','settings'];
for (const name of colored) {
  const svg = icon(name), tone = svg.match(/data-tone="([a-z]+)"/);
  assert(tone && tones.has(tone[1]), name + ' must use the shared palette');
  assert.match(svg, /class="icon-pigment"/);
  assert.match(svg, /aria-hidden="true" focusable="false"/);
  assert.match(svg, /viewBox="0 0 24 24" fill="none" stroke="currentColor"/);
  assert(!/<img|<image|https?:|onload=/.test(svg));
}
for (const name of ['alert','check','close','chevronDown','demolish','pause','play','fast','fastest']) {
  const svg = icon(name);
  assert(!svg.includes('data-tone='), name + ' must retain inherited state color');
  assert(!svg.includes('icon-pigment'));
}
for (const [alias, original] of [['house','building'],['hunting','meat'],['settings','tools'],['gatherer','vegetables'],['orchard','apples']]) assert.equal(icon(alias), icon(original));
for (const name of ['unknown', '__proto__', 'constructor', '" onload="bad']) assert.equal(icon(name), icon('building'));
const css = fs.readFileSync(path.join(root, 'styles/readability.css'), 'utf8');
assert.match(css, /@media \(forced-colors: active\)/);
assert.match(css, /\.ui-icon\[data-tone\] \{ color: inherit; \}/);
assert.match(css, /\.ui-icon \.icon-pigment, \.ui-icon \.icon-highlight \{ fill: none; \}/);
assert.match(css, /button:focus-visible/);
console.log('Colored icons: 31 palette mappings, 9 state glyphs, aliases, safe fallback and forced-color contracts passed.');
