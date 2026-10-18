/* HUD presentation-only regression. DOM fixtures do not constitute browser/visual acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(__dirname, 'workforce-controls-ui.js'), 'utf8');
source = source.slice(0, source.indexOf('let passed'))
  .replace("'sim', 'render'", "'sim', 'fire', 'supply', 'render'")
  .replace("  for (const key of G.RES_KEYS) mount('res-' + key).appendChild(element('b'));", '')
  .replace("if (selector === '.mini-tog') return child.classList.contains('mini-tog');", "if (selector[0] === '.') return child.classList.contains(selector.slice(1));");
const context = { require, console, __dirname, module: { exports: {} } };
vm.runInNewContext(source + '\nmodule.exports = fixture;', context);
const baseFixture = context.module.exports;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const guideMarkup = html.match(/<section id="survival-guide"[^>]*>([\s\S]*?)<\/section>/)[1];
const visibleRows = f => f.guide.querySelectorAll('[data-guide-kind]').filter(row => !row.hidden);
const guideRow = (f, kind) => f.guide.querySelector(`[data-guide-kind="${kind}"]`);
const get = (f, id) => f.doc.getElementById(id);
function fixture() {
  const f = baseFixture(), { G } = f;
  // This suite asserts behavior and semantic keys, not a fake SVG layout engine.
  G.ui.icon = name => `<span class="ui-icon" data-icon="${name}" aria-hidden="true"></span>`;
  G.ui.el.resRow = f.mount('res-row');
  f.guide.innerHTML = guideMarkup;
  f.mount('save-status'); f.mount('btn-load');
  G.ui.initResourceHUD(); G.ui.initGuideHUD();
  G.ui.refreshHUD();
  return f;
}
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok', name); };

test('six permanent core slots have exact order and retain zero quantities', () => {
  const f = fixture(), { G } = f;
  assert.deepEqual(Array.from(get(f, 'core-resources').children, el => el.dataset.resource), ['food', 'wood', 'stone', 'iron', 'tools', 'firewood']);
  const core = get(f, 'core-resources').children.slice();
  for (const key of G.RES_KEYS) G.game.res[key] = 0;
  G.ui.refreshHUD();
  assert.deepEqual(get(f, 'core-resources').children, core);
  for (const node of core) { assert.equal(node.querySelector('b').textContent, '0'); assert(!node.hidden); }
  assert.equal(get(f, 'res-tools').querySelector('.res-label').textContent, '铁工具');
  assert.equal(get(f, 'secondary-resources').hidden, true);
});

test('all secondary slots stay mounted in fixed order through zero and stock changes', () => {
  const f = fixture(), { G } = f, panel = get(f, 'secondary-resources');
  const nodes = panel.children.slice(), keys = Array.from(nodes, el => el.dataset.resource);
  assert(keys.includes('steelTools') && keys.includes('warmCoats') && keys.includes('eggs'));
  assert.equal(new Set([...G.ui.hudCoreResources(), ...keys]).size, G.RES_KEYS.length);
  for (let i = 0; i < 4; i++) { G.game.res.steelTools = i ? 0 : 33; G.game.res.ale = 99 * i; G.ui.refreshHUD(); }
  assert.deepEqual(panel.children, nodes);
  assert.deepEqual(Array.from(panel.children, el => el.dataset.resource), keys);
});

test('More toggle is stable, semantic, survives refresh and restores focus on collapse', () => {
  const f = fixture(), { G } = f, button = get(f, 'resource-more'), panel = get(f, 'secondary-resources');
  button.click(); assert.equal(button.getAttribute('aria-expanded'), 'true'); assert.equal(panel.hidden, false);
  get(f, 'res-steelTools').focus(); G.ui.refreshHUD();
  assert.equal(get(f, 'resource-more'), button); assert.equal(panel.hidden, false);
  G.ui.setResourceExpanded(false); assert.equal(f.doc.activeElement, button); assert.equal(panel.hidden, true);
  button.click(); let stopped = false;
  f.G.ui.el.resRow.emit('keydown', { key: 'Escape', stopPropagation() { stopped = true; } });
  assert(stopped); assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(f.doc.activeElement, button);
});

test('hidden shortages and blocked cargo are disclosed by a counted accessible badge', () => {
  const f = fixture(), { G } = f;
  f.resident(f.building('house')).clothingLeft = 0;
  for (const k of ['meat','eggs','vegetables','apples','pears','clothes','warmCoats']) G.game.res[k] = 0;
  G.game.res.grain = G.game.res.food = 20;
  G.ui.refreshHUD();
  assert.equal(get(f, 'resource-warning-count').textContent, '3');
  assert.match(get(f, 'resource-more').getAttribute('aria-label'), /3 项提醒/);
  assert.match(get(f, 'res-clothes').title, /衣物耗尽/);
  const before = get(f, 'resource-warning-count').textContent;
  G.game.res.ale = G.storageCap('ale');
  G.ui.refreshResourceWarnings({ carry: { ale: 6 } }, null);
  assert.equal(Number(get(f, 'resource-warning-count').textContent), Number(before) + 1);
  assert.match(get(f, 'res-ale').title, /仓满/);
});

test('empty optional steel tools never masquerade as loss of available iron tools', () => {
  const f = fixture(), { G } = f;
  G.game.res.tools = 9; G.game.res.steelTools = 0;
  G.ui.refreshHUD();
  assert.equal(get(f, 'res-tools').querySelector('b').textContent, '9');
  assert.equal(get(f, 'res-steelTools').querySelector('b').textContent, '0');
  assert.match(get(f, 'res-tools').title, /铁工具需铁与原木/);
  assert.match(get(f, 'res-steelTools').title, /钢工具需铁、原木与煤/);
  assert(!get(f, 'res-steelTools').classList.contains('resource-warning'));
});

test('public stock, distributed supply and carried output remain separate', () => {
  const f = fixture(), { G } = f;
  f.resident(f.building('house'));
  G.game.supplyMode = 'physical';
  G.game.res.food = G.game.res.grain = 0;
  const supplies = { available: { ...G.game.res, grain: 40, food: 40 }, transit: { grain: 5 }, public: G.game.res };
  G.supplyInventory = () => supplies;
  G.ui.refreshHUD();
  const chip = get(f, 'res-food');
  assert.equal(chip.querySelector('b').textContent, '0');
  assert.equal(chip.querySelector('.res-label').textContent, '公共总食物');
  assert.match(chip.title, /配送在途 5/); assert.match(chip.title, /全村食物 40/);
  assert.match(chip.title, /各家能否食用看本地储备/);
  assert.match(guideRow(f, 'food').title, /逐户现货才可食用/);
  assert.notEqual(guideRow(f, 'food').dataset.level, 'urgent');
});

test('physical supply never hides real public herbs behind a false shortage warning', () => {
  const f = fixture(), { G } = f;
  f.resident(f.building('house')); G.isSick = () => true;
  G.game.supplyMode = 'physical'; G.game.res.herbs = 25;
  G.ui.refreshHUD();
  assert(!get(f, 'res-herbs').classList.contains('resource-warning'));
  assert.doesNotMatch(get(f, 'resource-more').title, /草药暂无储备/);
  G.game.res.herbs = 0; G.ui.refreshHUD();
  assert(get(f, 'res-herbs').classList.contains('resource-warning'));
});

test('urgent risks precede recommendations and only three checklist rows are visible', () => {
  const f = fixture(), { G } = f, c = f.resident(f.building('house'));
  c.hunger = 1; c.cold = 1; G.game.season = 3; G.game.day = 36;
  G.game.res.wood = G.game.res.firewood = 0;
  G.ui.refreshGuide();
  const shown = visibleRows(f);
  assert.equal(shown.length, 3);
  assert.deepEqual(Array.from(shown, row => row.dataset.guideKind), ['food', 'heating', 'cold']);
  assert(shown.every(row => row.dataset.level === 'urgent'));
  assert.match(get(f, 'guide-count').textContent, /3 项紧急/);
  assert.equal(guideRow(f, 'wood').hidden, true);
});

test('All shows every keyed type, retains focused control, and refresh never cycles priorities', () => {
  const f = fixture(), { G } = f, c = f.resident(f.building('house'));
  c.hunger = 1; G.game.res.wood = 0; G.ui.refreshGuide();
  const button = get(f, 'guide-toggle'); button.click();
  const list = get(f, 'guide-list'), writes = list.htmlWrites, first = visibleRows(f)[0];
  assert(visibleRows(f).length > 3); assert.equal(button.getAttribute('aria-expanded'), 'true');
  for (let i = 0; i < 4; i++) { G.game.h += 0.2; G.ui.refreshGuide(); }
  assert.equal(list.htmlWrites, writes); assert.equal(visibleRows(f)[0], first);
  assert.equal(get(f, 'guide-toggle'), button); assert.equal(f.doc.activeElement, button);
  button.click(); assert.equal(visibleRows(f).length, 3); assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('a replacement world resets the checklist expansion', () => {
  const f = fixture(); get(f, 'guide-toggle').click();
  f.G.world = { ...f.G.world }; f.G.ui.refreshGuide();
  assert.equal(get(f, 'guide-toggle').getAttribute('aria-expanded'), 'false');
  assert(visibleRows(f).length <= 3);
});

test('normal information is gray status and autumn preparation is yellow, not a red emergency', () => {
  const f = fixture(), { G } = f;
  f.resident(f.building('house')); G.game.season = 2; G.game.day = 24; G.game.res.firewood = 0;
  G.ui.refreshGuide(); assert.equal(guideRow(f, 'heating').dataset.level, 'recommend');
  assert.equal(guideRow(f, 'season').dataset.level, 'status');
  G.game.res.firewood = 30; G.ui.refreshGuide(); assert.equal(guideRow(f, 'heating'), null);
});

test('winter budget keeps fractional correctness and does not charge the final day twice', () => {
  const f = fixture(), { G } = f;
  f.resident(f.building('stonehouse')); G.game.season = 3; G.game.day = 36; G.game.res.firewood = 13.75;
  G.ui.refreshGuide(); assert.equal(guideRow(f, 'heating'), null);
  G.game.res.firewood = 13.74; G.ui.refreshGuide(); assert.equal(guideRow(f, 'heating').dataset.level, 'urgent');
  G.game.day = 47; G.game.res.firewood = 0; G.ui.refreshGuide(); assert.equal(guideRow(f, 'heating'), null);
});

test('automatic-save protection belongs beside system controls, outside survival priorities', () => {
  const f = fixture(), { G } = f;
  G.autosaveBlocked = true; G.ui.refreshHUD();
  assert.equal(get(f, 'save-status').hidden, false); assert.match(get(f, 'save-status').textContent, /原自动档已保护/);
  assert(get(f, 'btn-load').classList.contains('save-attention'));
  assert.doesNotMatch(f.guide.textContent, /自动档|自动保存|存档管理/);
  G.autosaveBlocked = false; G.ui.refreshHUD(); assert.equal(get(f, 'save-status').hidden, true);
});

test('time uses the same neutral clock at 04, 12, 20 and 23 hours regardless of rest schedule', () => {
  const f = fixture(), { G } = f;
  G.isRestTime = () => { throw new Error('HUD must not use worker rest as astronomical time'); };
  // Other read-only helpers legitimately inspect rest state; isolate HUD time only.
  G.harvestFeedback = () => ({ carry: {}, total: 0, trees: 0 });
  for (const h of [4, 12, 20, 23]) {
    G.game.h = h; G.ui.refreshHUD();
    assert.match(f.G.ui.el.date.innerHTML, /data-icon="clock"/);
    assert.match(f.G.ui.el.date.textContent, new RegExp(String(h).padStart(2, '0') + ':00'));
    assert.doesNotMatch(f.G.ui.el.date.innerHTML, /moon|sun|🌙|☀/);
  }
});

test('repeated HUD reads and expansion do not alter simulation or save-format facts', () => {
  const f = fixture(), { G } = f; f.resident(f.building('house'));
  const snapshot = () => JSON.stringify({ game: G.game, citizens: G.world.citizens, buildings: G.world.buildings, families: G.world.families });
  const before = snapshot();
  get(f, 'resource-more').click(); get(f, 'guide-toggle').click();
  for (let i = 0; i < 5; i++) G.ui.refreshHUD();
  assert.equal(snapshot(), before);
});

test('compact/scrolling CSS and external save warning have explicit static contracts', () => {
  const css = fs.readFileSync(path.join(root, 'styles/hud.css'), 'utf8');
  assert.match(css, /#secondary-resources[^}]*max-height:[^}]*overflow: auto/s);
  assert.match(css, /max-height: 650px/); assert.match(css, /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /data-level="urgent"/); assert.match(css, /data-level="recommend"/);
  assert.match(css, /#topbar \[hidden\]/);
  for (const size of css.matchAll(/font-size:\s*(\d+)px/g)) assert(Number(size[1]) >= 11, 'secondary UI text must stay at least 11px');
  assert(html.indexOf('id="save-status"') < html.indexOf('id="survival-guide"'));
});
console.log(`HUD and survival guidance: ${passed} passed (DOM/static only; browser acceptance separate)`);
