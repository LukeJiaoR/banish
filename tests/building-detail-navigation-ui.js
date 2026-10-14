/* Presentation-only inspector regression using the existing live simulation DOM fixture.
 * This does not claim browser or mobile visual acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'workforce-controls-ui.js'), 'utf8');
const context = { require, console, __dirname, module: { exports: {} } };
vm.runInNewContext(source.slice(0, source.indexOf('let passed')) + '\nmodule.exports = fixture;', context);
const fixture = context.module.exports;
const tab = (f, key) => f.info.querySelector(`[data-building-tab="${key}"]`);
const pane = (f, key) => f.info.querySelector(`[data-building-panel="${key}"]`);
const node = (f, id) => f.info.querySelector('#' + id);
let passed = 0;
const test = (name, fn) => { fn(); console.log('ok', name); passed++; };
const select = (type, options) => { const f = fixture(); f.b = f.building(type, options); f.select(f.b); return f; };

test('all applicable buildings start with overview, a single visible pane and unique IDs', () => {
  for (const type of ['forester','gatherer','woodcutter','mine','stonequarry','blacksmith','house','stonehouse','boarding','storage','stockpile','market','townhall','school','chapel','hospital','herbalist','farm','orchard','pasture','tradingpost','tavern','tailor','well','cemetery']) {
    const f = select(type);
    assert.equal(f.G.ui._buildingDetailTab, 'overview', type);
    assert.equal(tab(f, 'overview').getAttribute('aria-pressed'), 'true', type);
    assert.equal(f.info.querySelectorAll('[data-building-panel]').filter(p => !p.classList.contains('hidden')).length, 1, type);
    const ids = f.info.descendants().map(n => n.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, type);
    if (['house','storage','well'].includes(type)) assert.equal(tab(f, 'production'), null, type);
    if (['house','storage','stockpile','mine','stonequarry','blacksmith','woodcutter'].includes(type)) assert(tab(f, 'inventory'), type);
  }
});

test('keyboard menus select, hide, mark inert and move focus without changing simulation', () => {
  const f = select('blacksmith'), before = JSON.stringify(f.G.game.res);
  tab(f, 'overview').emit('keydown', { key: 'ArrowRight' });
  assert.equal(f.G.ui._buildingDetailTab, 'production');
  assert.equal(f.doc.activeElement, tab(f, 'production'));
  assert(pane(f, 'overview').inert);
  assert(!pane(f, 'production').inert);
  tab(f, 'production').emit('keydown', { key: 'End' });
  assert.equal(f.G.ui._buildingDetailTab, 'management');
  tab(f, 'management').emit('keydown', { key: 'Home' });
  assert.equal(f.G.ui._buildingDetailTab, 'overview');
  assert.equal(JSON.stringify(f.G.game.res), before);
});

test('specialized live refresh preserves tab, element identity, drafts and scroll', () => {
  const f = select('blacksmith'); tab(f, 'production').click();
  const input = node(f, 'worker-limit-input'); input.value = '0'; input.focus();
  f.info.scrollTop = 63;
  for (let i = 0; i < 4; i++) f.G.ui.renderInfo();
  assert.equal(node(f, 'worker-limit-input'), input);
  assert.equal(input.value, '0'); assert.equal(f.G.ui._buildingDetailTab, 'production'); assert.equal(f.info.scrollTop, 63);
});

test('generic forced rebuild preserves open submenus, draft, tab and scroll', () => {
  const f = select('forester'); tab(f, 'production').click();
  node(f, 'worker-limit-input').value = '0';
  const detail = f.info.querySelectorAll('details')[0]; detail.open = true;
  const summary = detail.querySelector('summary').textContent;
  f.info.scrollTop = 47; f.doc.activeElement = null;
  f.G.ui.renderInfo(true);
  assert.equal(f.G.ui._buildingDetailTab, 'production'); assert.equal(f.info.scrollTop, 47);
  assert.equal(node(f, 'worker-limit-input').value, '0');
  assert(f.info.querySelectorAll('details').find(d => d.querySelector('summary').textContent === summary).open);
});

test('new selection and a same-ID replacement world reset to overview; detached menus cannot act', () => {
  const f = select('blacksmith'); const old = tab(f, 'inventory'); old.click();
  f.select(f.building('house'));
  assert.equal(f.G.ui._buildingDetailTab, 'overview'); old.emit('click'); assert.equal(f.G.ui._buildingDetailTab, 'overview');
  tab(f, 'management').click(); const oldWorld = f.G.world; f.G.world = { ...oldWorld }; f.G.ui.renderInfo();
  assert.equal(f.G.ui._buildingDetailTab, 'overview');
});

test('overview staffing changes on live refresh and warehouse values are explicitly town totals', () => {
  const f = select('blacksmith'); const target = f.info.querySelector('[data-building-overview-workforce]');
  const c = f.resident(f.building('house')); f.b.workers.push(c.id); c.job = f.b.id; f.G.ui.renderInfo();
  assert.equal(target.textContent, f.G.ui.workforceInfoData(f.b).data.current);
  const store = f.building('storage'); f.select(store); tab(f, 'inventory').click();
  f.G.game.res.wood = 123; f.G.ui.renderInfo();
  assert.match(pane(f, 'inventory').textContent, /全镇公共库存/); assert.match(pane(f, 'inventory').textContent, /123/);
});

test('leaving farm production clears both pests and harvest pending intents without altering stocks', () => {
  const f = select('farm'); tab(f, 'production').click();
  const panel = f.info.querySelector('[data-farm-panel]');
  assert.equal(typeof panel._detailPestReset, 'function'); assert.equal(typeof panel._detailHarvestReset, 'function');
  const before = JSON.stringify(f.G.game.res);
  node(f, 'farm-pests-toggle').click(); assert(panel._pestEnable);
  panel._harvestQuote = 'stale-quote';
  tab(f, 'overview').click();
  assert.equal(panel._pestEnable, null); assert.equal(panel._harvestQuote, null);
  node(f, 'farm-pests-confirm').emit('click'); node(f, 'early-harvest-confirm').emit('click');
  assert.equal(f.G.farmPestSummary(f.b).enabled, false); assert.equal(JSON.stringify(f.G.game.res), before);
});

test('leaving management cancels a house-upgrade review and old confirmation cannot upgrade', () => {
  const f = select('house'); f.resident(f.b); f.G.game.res.wood = 1000; f.G.game.res.stone = 1000; f.G.game.res.iron = 1000;
  f.G.ui.renderInfo(true); tab(f, 'management').click(); node(f, 'house-upgrade-start').click();
  const panel = f.info.querySelector('[data-house-upgrade-panel]'); assert(panel._upgradePending);
  const confirm = node(f, 'house-upgrade-confirm'); tab(f, 'overview').click(); assert.equal(panel._upgradePending, null);
  confirm.emit('click'); assert.equal(f.G.world.bmap[f.b.id], f.b); assert.equal(f.b.type, 'house');
});

test('trade, pasture, orchard and farm use task-level disclosures rather than all-expanded forms', () => {
  for (const type of ['tradingpost','pasture','orchard','farm','townhall']) {
    const f = select(type); const details = pane(f, type === 'townhall' ? 'management' : 'production').querySelectorAll('details');
    assert(details.length >= 3, type); assert(details.every(d => !d.open), type);
  }
});
console.log(`Building detail navigation: ${passed} DOM/live-simulation suites passed (not browser/mobile).`);
