/* Winter heating uses shared exact budgets in existing A-interface panels.
 * DOM/live-state contracts only, not desktop/mobile browser acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
// Reuse the real new-game HTML/control fixture without running its own tests.
const source = fs.readFileSync(path.join(__dirname, 'start-settings-ui.js'), 'utf8');
const context = { require, console, __dirname, module: { exports: {} } };
vm.runInNewContext(source.slice(0, source.indexOf("test('actual HTML")) +
  '\nmodule.exports = { fixture, settings, press, seed, node };', context);
const { fixture: baseFixture, settings, press, seed, node: settingNode } = context.module.exports;
function fixture(type = 'fair', day = 36, houseType = 'house') {
  const f = baseFixture(), { G, ctx } = f;
  // The settings fixture stubs the HUD; restore production rendering here.
  const previousUI = G.ui;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), ctx, { filename: 'ui.js' });
  G.ui.el = previousUI.el; G.ui.toast = previousUI.toast;
  for (const name of ['fire', 'supply', 'goal-presets'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  Object.assign(G.game, { day, season: G.seasonOf(day), year: Math.floor(day / G.YEAR_DAYS) + 1,
    climate: type ? { v: 1, type, lastDay: day } : null,
    heatRules: type ? { v: 1, lastDay: day } : null });
  const home = f.building(houseType); f.resident(home); f.select(home);
  return { ...f, home };
}
const heatingNode = (f, key) => f.info.querySelector(`[data-heating="${key}"]`);
const snapshot = G => JSON.stringify(G.serializeGame());
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function daily(G, type, day) {
  const base = { house: 30, stonehouse: 20, boarding: 75 }[type];
  if (G.seasonOf(day) !== 3) return 0;
  const t = G.temperatureFor(G.world.seed, day, G.game.climate.type);
  return base / 12 * Math.max(.5, Math.min(1.5, 1 - (t + 2.4) / 20));
}
function total(G, type, start, count) {
  return Array.from({ length: count }, (_, i) => daily(G, type, start + i)).reduce((a, b) => a + b, 0);
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }

test('UI and goal context delegate to the same unrounded town budget', () => {
  const { G } = fixture();
  const budget = { fullWinter: 30.001, winter: true, futureDays: 11, futureWinter: 27.003 };
  let calls = 0; G.townHeatingBudget = () => { calls++; return budget; };
  assert.equal(G.ui.heatDemand(), budget);
  assert.equal(G.goalRecommendationContext().fullWinter, budget.fullWinter);
  assert.equal(calls, 2);
  assert.match(G.ui.heatDemandText(budget), /整冬约需 31.*本冬此后约需 28/);
  assert.equal(budget.fullWinter, 30.001); assert.equal(budget.futureWinter, 27.003);
});

for (const climate of ['mild', 'fair', 'harsh']) test(climate + ' home shows current winter temperature and exact daily/whole-winter cost', () => {
  for (const type of ['house', 'stonehouse', 'boarding']) {
    const f = fixture(climate, 39, type), { G } = f;
    const text = heatingNode(f, 'home').textContent;
    assert(text.includes(`今日气温 ${G.temperatureFor(G.world.seed, 39, climate)}°C`));
    assert(text.includes(`今日需要 ${daily(G, type, 39).toFixed(2)}`));
    assert(!text.includes('冬季每日需要'));
    const expected = total(G, type, 36, 12), budget = heatingNode(f, 'budget').textContent;
    assert(budget.includes(`整冬 12 日合计约 ${G.ui.supplyNumber(expected)}`));
    assert.match(budget, /逐日气温累计.*不能用今日耗量乘天数/);
    near(G.goalRecommendationContext().fullWinter, expected);
  }
});

test('outside winter the housing preview pairs the first winter day temperature with its cost', () => {
  const f = fixture('harsh', 28), { G, home } = f;
  const s = G.homeHeatingSummary(home);
  assert.equal(G.homeHeatingNeed(home), 0);
  assert.equal(s.temperature, G.temperatureFor(G.world.seed, 36, 'harsh'));
  near(s.perDay, daily(G, 'house', 36));
  assert.match(heatingNode(f, 'home').textContent, /入冬首日气温.*入冬首日需要/);
  assert(!heatingNode(f, 'home').textContent.includes('今日需要'));
});

test('HUD, cutter and town hall share the rolling exact winter budget and presentation rounding', () => {
  const f = fixture('harsh', 39), { G } = f, cutter = f.building('woodcutter'), hall = f.building('townhall');
  const budget = G.ui.heatDemand(), expectedFull = total(G, 'house', 36, 12), expectedRest = total(G, 'house', 40, 8);
  near(budget.fullWinter, expectedFull); near(budget.futureWinter, expectedRest);
  assert.equal(budget.futureDays, 8);
  assert(Math.abs(expectedRest - daily(G, 'house', 39) * 8) > .01);
  const text = G.ui.heatDemandText(budget);
  G.ui.refreshHUD();
  assert(f.doc.getElementById('res-firewood').title.includes(text));
  assert.equal(G.ui.fuelInfoData(cutter).heat, text);
  assert(G.ui.townHallInfoData(hall).data.fuel.includes(text));
  G.game.res.firewood = expectedRest;
  assert(!G.ui.fuelInfoData(cutter).gap.includes('少约'));
  G.ui.refreshGuide(); assert(!f.guide.textContent.includes('柴火不足'));
  G.game.res.firewood = expectedRest - .00001;
  assert.match(G.ui.fuelInfoData(cutter).gap, /少约 1/);
  G.ui.refreshGuide(); assert(f.guide.textContent.includes('柴火不足'));
});

test('last winter day has zero remaining budget and the next year starts a new full forecast', () => {
  const f = fixture('fair', 47), { G } = f;
  assert.equal(G.ui.heatDemand().futureDays, 0); assert.equal(G.ui.heatDemand().futureWinter, 0);
  assert.match(G.ui.heatDemandText(G.ui.heatDemand()), /本冬此后约需 0/);
  Object.assign(G.game, { day: 48, season: 0, year: 2 });
  const heat = G.ui.heatDemand(); near(heat.fullWinter, total(G, 'house', 84, 12));
  assert.equal(heat.futureWinter, heat.fullWinter); assert.equal(heat.futureDays, 12);
  assert(!G.ui.heatDemandText(heat).includes('本冬此后'));
});

test('today estimate can change while the previous bill remains its recorded historical values', () => {
  const f = fixture('harsh'), { G, home } = f;
  G.game.heatRules.lastDay = 35; G.game.res.firewood = 1; G.game.res.coal = 20.25;
  G.setHeatingPolicy(true, 20); G.advanceHomeHeating(); G.ui.renderInfo();
  const bill = JSON.stringify(home.lastHeating), receipt = heatingNode(f, 'receipt').textContent;
  assert.match(receipt, /第 37 天.*实际烧柴 1.00、煤 0.25.*当时燃料未足/);
  assert.match(heatingNode(f, 'home').textContent, /当前未供暖/);
  G.game.day = 37; G.game.climate.lastDay = 37; G.ui.renderInfo();
  assert.equal(heatingNode(f, 'receipt').textContent, receipt); assert.equal(JSON.stringify(home.lastHeating), bill);
  assert(heatingNode(f, 'home').textContent.includes(daily(G, 'house', 37).toFixed(2)));
});

test('climate live refresh keeps typed reserve, focus, policy controls and stored state', () => {
  const f = fixture(), { G } = f, input = f.doc.getElementById('heating-reserve');
  const apply = f.doc.getElementById('heating-apply'), writes = f.info.htmlWrites;
  input.value = '73'; input.focus();
  G.game.day = 37; G.game.climate.lastDay = 37; G.game.heatRules.lastDay = 37;
  const before = snapshot(G);
  for (let i = 0; i < 10; i++) { G.ui.renderInfo(); G.ui.refreshHUD(); G.recommendProductionGoals('winter'); }
  assert.equal(snapshot(G), before); assert.equal(input.value, '73');
  assert.equal(f.doc.activeElement, input); assert.equal(f.doc.getElementById('heating-apply'), apply);
  assert.equal(f.info.htmlWrites, writes);
  assert(heatingNode(f, 'home').textContent.includes(daily(G, 'house', 37).toFixed(2)));
});

test('physical local coverage sums chronological future bills and excludes public/incoming fuel', () => {
  const f = fixture('harsh', 39), { G, home } = f;
  G.enablePhysicalSupplyPrototype(); G.setHeatingPolicy(true, 20);
  const fuel = daily(G, 'house', 40) + daily(G, 'house', 41) + daily(G, 'house', 42) * .5;
  home.supplyStock.firewood = fuel - 1; home.supplyStock.coal = .5;
  G.game.res.firewood = G.game.res.coal = 9999;
  const incoming = G.supplyIncoming; G.supplyIncoming = b => ({ ...incoming(b), firewood: 999 });
  const before = snapshot(G), summary = G.householdSupplySummary(home);
  near(summary.fuelDays, 2.5); assert.notEqual(summary.fuelDays, fuel / G.homeHeatingNeed(home));
  const facts = G.ui.householdSupplyInfoData(home);
  assert.match(facts.days, /取暖燃料 2.5 个冬季日.*逐日气温顺序累计.*本冬结束.*在途未到不算可用/);
  assert.match(G.ui.heatingInfoData(home).data.stock, /本屋柴火.*取暖只用本地现货.*公共煤.*不能直接暖屋/);
  assert.equal(snapshot(G), before);
  G.game.day = 47; assert.equal(G.householdSupplySummary(home).fuelDays, 0);
});

test('legacy and climate homeless camps never turn fuel stocks into housing warmth or infinite coverage', () => {
  for (const climate of [null, 'fair']) {
    const { G } = fixture(climate, 39);
    G.enablePhysicalSupplyPrototype();
    const family = G.world.families[0]; family.houseId = null;
    G.reconcileSupplyHomes(); const camp = family.supplyCamp;
    camp.supplyStock.firewood = 10; camp.supplyStock.coal = 5;
    G.setHeatingPolicy(true, 0);
    assert.equal(G.householdSupplySummary(camp).fuelDays, 0);
    const facts = G.ui.householdSupplyInfoData(camp);
    assert.match(facts.days, /取暖燃料 0 个冬季日.*临时补给点不能代替住房取暖/);
    assert(!facts.days.includes('Infinity'));
  }
});

test('empty climate housing labels hypothetical occupancy without promising warmth', () => {
  const f = fixture(), { G, home } = f;
  home.family = null; G.world.families.forEach(family => { family.houseId = null; });
  G.ui.renderInfo(); assert.equal(G.ui.heatDemand().fullWinter, 0);
  assert.match(heatingNode(f, 'home').textContent, /空置不耗燃料.*入住时今日需要/);
  assert.match(heatingNode(f, 'budget').textContent, /按本屋入住计算.*空屋不扣料/);
});

test('legacy seasonal and v5 crop-climate villages retain fixed housing text and budgets', () => {
  for (const cropClimate of [null, 'fair']) {
    const f = fixture(null, 36, 'stonehouse'), { G } = f;
    G.game.climate = cropClimate ? { v: 1, type: cropClimate, lastDay: 36 } : null;
    G.ui.renderInfo(); G.ui.refreshHUD();
    assert.equal(G.ui.heatDemand().fullWinter, 20);
    assert.match(heatingNode(f, 'home').textContent, /冬季每日需要 1.67/);
    assert.match(heatingNode(f, 'budget').textContent, /固定冬季日耗/);
    assert(!heatingNode(f, 'home').textContent.includes('°C'));
    if (cropClimate) assert.match(G.ui.el.date.title, /住房取暖和果园仍沿用原规则/);
  }
});

test('climate HUD explains only winter heating and still limits orchard scope', () => {
  const f = fixture('mild'), { G } = f; G.ui.refreshHUD();
  assert.match(G.ui.el.date.title, /冬季住房耗柴随气温变化.*果园仍沿用原规则/);
});

test('upgrade estimate rounds only displayed exact whole-winter wood and stone budgets', () => {
  const { G, home } = fixture('harsh');
  const facts = G.ui.houseUpgradeInfoData(home), oldFuel = total(G, 'house', 36, 12), newFuel = total(G, 'stonehouse', 36, 12);
  near(facts.quote.oldFuel, oldFuel); near(facts.quote.newFuel, newFuel);
  assert(facts.data.fuel.includes(`${G.ui.supplyNumber(oldFuel)} → ${G.ui.supplyNumber(newFuel)}`));
  assert.match(facts.data.fuel, /本年整冬.*省三分之一/);
});

test('new-game note and review disclose v6, retain orchard limit, and create the selected heating rules', () => {
  const f = settings(), { G } = f;
  assert.match(settingNode(f, 'climate-note').textContent, /冬季住房耗柴随气温变化.*果园沿用原规则.*v6.*旧程序无法读取.*v1–v5.*原取暖规则/);
  assert.equal(G.game.heatRules, null);
  seed(f, 17); press(f, 'climate-harsh'); press(f, 'review-button');
  assert.match(settingNode(f, 'confirm-summary').textContent, /v6.*旧程序无法读取.*冬季住房耗柴随气温变化.*果园沿用原规则/s);
  assert.equal(G.game.heatRules, null);
  press(f, 'confirm'); assert.equal(G.game.climate.type, 'harsh'); assert.equal(G.game.heatRules.v, 1);
  const save = G.serializeGame(); assert.equal(save.v, 6); assert.equal(G.prepareSaveData(save).game.heatRules.v, 1);
});

console.log(`Winter heating UI: ${passed} DOM/live-state suites passed (not browser/mobile acceptance).`);
