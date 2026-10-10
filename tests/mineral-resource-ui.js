/* Shared resource registry and generated UI markup contracts; not browser visual QA. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const { loadGame } = require('./helpers/playability');
const G = loadGame(root); global.G = G; global.window = global;
require(path.join(root, 'js/ui.js'));
const elements = new Map();
global.document = { getElementById(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', classList: { add() {}, remove() {}, contains() { return true; } },
    addEventListener() {}, querySelectorAll() { return []; }, setAttribute() {}, getAttribute() { return null; } });
  return elements.get(id);
} };
G.ui.refreshHUD = () => {};
G.ui.init();
const hud = elements.get('res-row').innerHTML, toolbar = elements.get('toolbar').innerHTML;
let passed = 0;
for (const type of G.RES_KEYS) {
  const resource = G.RES[type], icon = G.ui.resourceIcon(type);
  assert.ok(resource.iconAsset && fs.existsSync(path.join(root, 'assets/icons', resource.iconAsset + '.png')));
  assert.ok(hud.includes(icon));
  const cost = G.ui.resourceCost({ [type]: 7 }, true);
  assert.ok(cost.includes(icon)); assert.match(cost, />7<\/span>/);
  assert.equal(G.ui.resourceCost({ [type]: 7 }, false), `${resource.name}×7`);
  assert.ok(icon.includes(`aria-label="${resource.name}"`));
  assert.ok(icon.includes(`aria-hidden="true">${resource.icon}</span>`));
  assert.ok(icon.includes('onerror="this.remove()"'), 'same emoji fallback for all resource locations');
  passed++;
}
for (const type of ['house', 'stonehouse', 'school', 'mine']) {
  const button = toolbar.match(new RegExp(`<button[^>]*data-tool="${type}"[\\s\\S]*?</button>`))[0];
  for (const key of Object.keys(G.BDEF[type].cost)) assert.ok(button.includes(G.ui.resourceIcon(key)));
  assert.ok(button.includes(G.ui.resourceCost(G.BDEF[type].cost, false)));
  passed++;
}
const mining = toolbar.match(/<button[^>]*data-tool="quarry"[\s\S]*?<\/button>/)[0];
assert.match(mining, /采石采铁/); assert.match(mining, /灰色岩石产石头，锈色铁矿产铁/);
assert.ok(!mining.includes('res_tools'), 'do not imply that mineral marking consumes tool inventory');
assert.ok(G.TOOLBAR.includes('quarry') && G.TOOLBAR.includes('demolish'));
const demolish = toolbar.match(/<button[^>]*data-tool="demolish"[\s\S]*?<\/button>/)[0];
assert.match(demolish, /点击建筑或道路移除/);
assert.equal(G.ui.resourceCost({}, true), '免费');
console.log(`Mineral resource UI: ${passed + 3} registry/markup contracts passed (headless only).`);
