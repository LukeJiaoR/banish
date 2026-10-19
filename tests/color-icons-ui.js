/* Original asset/markup regression. Real browser evidence is recorded separately. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = { console };
context.window = context;
vm.createContext(context);
for (const file of ['core', 'defs', 'ui']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), context);
const { G } = context, icon = name => G.ui.icon(name);
function asset(name, file, fallback) {
  const markup = icon(name);
  assert(markup.includes(`src="${file}"`), name);
  assert(fs.existsSync(path.join(root, file)), file);
  assert(markup.includes(`<span class="icon-fallback">${fallback}</span>`));
  assert.match(markup, /class="ui-icon" aria-hidden="true"/);
  assert.match(markup, /alt="" onerror="this.remove\(\)"/);
  assert(!/<svg|data-tone=|https?:/.test(markup));
}
for (const [name, r] of Object.entries(G.RES)) asset(name, `assets/icons/${r.iconAsset}.png`, r.icon);
const tools = ['stonehouse','boarding','mine','stonequarry','blacksmith','hunting','house','storage','stockpile','gatherer','forester','woodcutter','dock','school','herbalist','hospital','townhall','tavern','farm','road','stoneroad','bridge','demolish'];
for (const name of tools) asset(name, `assets/icons/tool_${name}.png`, name === 'demolish' ? '🚫' : G.BDEF[name].icon);
for (const name of ['tailor','tradingpost','pasture','orchard','chapel']) asset(name, `assets/buildings/${name}.png`, G.BDEF[name].icon);
for (const name of ['market','well','cemetery','tunnel']) {
  assert(icon(name).includes(G.BDEF[name].icon));
  assert(!icon(name).includes('<img'));
}
for (const [name, symbol] of Object.entries({save:'💾',folder:'📂',sprout:'🌱',mail:'📮',help:'❓',people:'👥',pause:'⏸',play:'▶',fast:'⏩',fastest:'⏭',fell:'🪚',quarry:'⛏'})) {
  assert(icon(name).includes(symbol)); assert(!/<img|<svg/.test(icon(name)));
}
for (const [name, symbol] of Object.entries({homes:'🏠',food:'🌾',industry:'⚒️',services:'🏘️',land:'🛣️',other:'🔨'})) {
  const markup = G.ui.toolCategoryButton({id:name,name:'分类',icon:symbol});
  assert(markup.includes(G.ui.iconMarkup(symbol))); assert(!/<img|<svg/.test(markup));
}
for (const name of ['alert','check','close','chevronDown','clock','settings','citizen']) {
  assert.match(icon(name), /stroke="currentColor"/);
  assert(!icon(name).includes('data-tone='));
}
for (const name of ['unknown','__proto__','constructor','" onload="bad']) assert.equal(icon(name), G.ui.iconMarkup('🏠'));
assert(!G.ui.iconMarkup('<x>', 'local"bad').includes('<x>'));
assert(G.ui.iconMarkup('<x>', 'local"bad').includes('src="local&quot;bad"'));
const css = fs.readFileSync(path.join(root, 'styles/readability.css'), 'utf8');
assert.match(css, /\.ui-icon > img \+ \.icon-fallback \{ display: none; \}/);
assert(!css.includes('data-tone'));
assert.match(css, /button:focus-visible/);
console.log('Original icons: 20 resource PNGs, 23 tool PNGs, 5 building thumbnails, historical emoji, neutral controls and safe fallback passed.');
