/* New-game and farm climate DOM contracts use real simulation and save APIs.
 * These are not browser/mobile visual acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
// Reuse the production-HTML fixture without executing its separate test suite.
const fixtureSource = fs.readFileSync(path.join(__dirname, 'start-settings-ui.js'), 'utf8');
const context = { require, console, __dirname, module: { exports: {} } };
vm.runInNewContext(fixtureSource.slice(0, fixtureSource.indexOf("test('actual HTML")) +
  '\nmodule.exports = { fixture, settings, press, seed, review, node };', context);
const { fixture, settings, press, seed, review, node } = context.module.exports;
const coldSource = fs.readFileSync(path.join(__dirname, 'cold-squash-ui.js'), 'utf8');
const hudContext = { require, console, __dirname, module: { exports: {} } };
vm.runInNewContext(coldSource.slice(0, coldSource.indexOf('let passed')) + '\nmodule.exports = fixture;', hudContext);
const hudFixture = hudContext.module.exports;
const guideSource = fs.readFileSync(path.join(__dirname, 'hud-guidance-ui.js'), 'utf8');
const guideContext = { require, console, __dirname, module: { exports: {} } };
vm.runInNewContext(guideSource.slice(0, guideSource.indexOf('\nlet passed = 0;')) + '\nmodule.exports = fixture;', guideContext);
const fullGuideFixture = guideContext.module.exports;

const snapshot = G => JSON.stringify(G.serializeGame());
const get = (f, id) => f.info.querySelector('#' + id);
function farm(type = 'fair', crop = 'wheat') {
  const f = fixture(), { G } = f;
  G.game.climate = type ? { v: 1, type, lastDay: G.game.day } : null;
  G.game.unlocks[crop] = true;
  G.game.res.tools = 20;
  G.game.res.grain = G.game.res.food = 300;
  const b = f.building('farm');
  G.setFarmCrop(b, crop);
  b.sownAll = true; b.growth = .5;
  b.farm.forEach(tile => { tile.sown = true; });
  const c = G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm', name: '气候农夫' });
  c.job = b.id; b.workers = [c.id];
  G.game.day = 28; G.game.season = 2; G.game.climate && (G.game.climate.lastDay = G.game.day);
  f.select(b);
  return { ...f, b, c };
}
function insideDetails(el) {
  for (; el; el = el.parentNode) if (el.tagName === 'DETAILS') return true;
  return false;
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }

test('actual HTML exposes three labelled climates and visible scope/save warnings', () => {
  const f = settings(), group = node(f, 'climate');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), '选择新村气候');
  for (const type of ['mild', 'fair', 'harsh']) {
    const button = node(f, 'climate-' + type);
    assert(group.contains(button));
    assert(button.textContent.includes(f.G.CLIMATES[type].name));
    assert(button.textContent.includes(f.G.CLIMATES[type].note));
  }
  const note = node(f, 'climate-note');
  assert.equal(group.getAttribute('aria-describedby'), note.id);
  assert(!insideDetails(note));
  assert.match(note.textContent, /仅新村.*农田成长.*提前.*冬季.*住房耗柴随气温变化.*秋霜损失树上未采果实.*提前采果.*v9.*旧程序无法读取.*v1–v6.*原果园规则.*v1–v5.*原固定取暖.*v1–v7.*不启用提前采果/);
});

test('default Fair draft does not silently upgrade a legacy village', () => {
  const f = settings(), { G } = f, before = snapshot(G), world = G.world, rng = G.rng;
  assert.equal(G.ui._startSession.climate, 'fair');
  assert.equal(node(f, 'climate-fair').getAttribute('aria-pressed'), 'true');
  assert.match(node(f, 'preview').textContent, /均衡 · Fair/);
  assert.match(node(f, 'current').textContent, /原季节规则（未启用温度气候）/);
  assert(!node(f, 'current').textContent.includes('Fair'));
  press(f, 'climate-harsh'); press(f, 'close');
  assert.equal(G.world, world); assert.equal(G.rng, rng); assert.equal(G.game.climate, null);
  assert.equal(snapshot(G), before); assert.equal(f.calls.removed.length, 0);
});

test('a legacy recorded startConfig stays labelled as the original seasonal rules', () => {
  const f = settings(), { G } = f;
  press(f, 'close'); G.game.startConfig = { v: 1, preset: 'classic', seed: G.world.seed };
  G.ui.showNewGameSettings();
  assert.match(node(f, 'current').textContent, /原季节规则（未启用温度气候）/);
  assert(!node(f, 'current').textContent.includes('Fair'));
  assert.equal(G.game.climate, null); assert.equal(G.game.startConfig.climate, undefined);
});

for (const type of ['mild', 'fair', 'harsh']) test(type + ' survives review, actual creation and save/load', () => {
  const f = settings(), { G } = f;
  seed(f, 17); press(f, 'climate-' + type); press(f, 'review-button');
  assert.equal(G.ui._startSession.intent.config.climate, type);
  assert(node(f, 'confirm-summary').textContent.includes(G.CLIMATES[type].name));
  assert.match(node(f, 'confirm-summary').textContent, /v9.*旧程序无法读取.*冬季住房耗柴随气温变化.*秋霜仅损失树上未采果实.*v1–v6.*不启用果园冷害.*v1–v7.*不启用提前采果/);
  press(f, 'confirm');
  assert.equal(G.game.climate.type, type); assert.equal(G.game.startConfig.climate, type);
  const data = JSON.parse(snapshot(G)); assert.equal(data.v, 9);
  assert.deepEqual(data.game.heatRules, { v: 1, lastDay: 0 });
  const loaded = G.prepareSaveData(data); assert.equal(loaded.game.climate.type, type);
  assert.equal(loaded.game.startConfig.climate, type);
  G.ui.showNewGameSettings(); assert(node(f, 'current').textContent.includes(G.CLIMATES[type].name));
  assert.equal(G.ui._startSession.climate, 'fair');
});

test('Hard, mountain and 192 choices preserve the selected climate through confirmation', () => {
  const f = settings(), { G } = f;
  seed(f, 1); press(f, 'climate-harsh'); press(f, 'preset-hard'); press(f, 'terrain-mountain'); press(f, 'size-192');
  press(f, 'review-button'); press(f, 'confirm');
  assert.equal(G.world.N, 192); assert.equal(G.world.mapVersion, 2);
  assert.equal(G.game.startConfig.preset, 'hard'); assert.equal(G.game.climate.type, 'harsh');
  assert.equal(G.game.unlocks.wheat, false); assert.equal(G.world.citizens.length, 13);
});

test('changing climate twice invalidates an already captured final click', () => {
  const f = settings(), { G } = f, old = G.world;
  review(f, 0); node(f, 'confirm').emit('mousedown', { button: 0 });
  press(f, 'climate-harsh'); assert.equal(G.ui._startSession.phase, 'edit');
  assert.equal(G.ui._startSession.intent, null);
  press(f, 'climate-fair'); press(f, 'review-button'); node(f, 'confirm').click();
  assert.equal(G.world, old); assert.equal(f.calls.removed.length, 0);
  press(f, 'confirm'); assert.equal(G.game.climate.type, 'fair'); assert.equal(f.calls.removed.length, 1);
});

test('a programmatic climate change cannot reuse a reviewed key', () => {
  const f = settings(), old = f.G.world;
  review(f, 1); f.G.ui._startSession.climate = 'harsh'; press(f, 'confirm');
  assert.equal(f.G.world, old); assert.equal(f.G.ui._startSession.phase, 'edit');
  assert.equal(f.calls.removed.length, 0);
});

test('climate selection preserves focused controls and interruption cancels confirmation', () => {
  const f = settings(); press(f, 'climate-mild');
  const card = node(f, 'climate-mild'), body = node(f, 'body'); card.focus(); body.scrollTop = 250;
  for (let i = 0; i < 10; i++) f.G.ui.refreshNewGameSettings();
  assert.equal(f.doc.activeElement, card); assert.equal(node(f, 'climate-mild'), card); assert.equal(body.scrollTop, 250);
  review(f, 1); f.windowEvent('blur'); assert.equal(f.G.ui._startSession.phase, 'edit');
  assert.equal(f.G.ui._startSession.climate, 'mild'); press(f, 'confirm'); assert.equal(f.calls.removed.length, 0);
  press(f, 'close'); f.G.ui.showNewGameSettings(); assert.equal(f.G.ui._startSession.climate, 'fair');
});

test('older DOM fixtures without new climate nodes can refresh and reopen', () => {
  const f = settings();
  for (const id of ['climate', 'climate-note']) {
    const el = node(f, id); el.parentNode.children = el.parentNode.children.filter(child => child !== el); el.parentNode = null;
  }
  assert.doesNotThrow(() => f.G.ui.refreshNewGameSettings());
  press(f, 'close'); assert.doesNotThrow(() => f.G.ui.showNewGameSettings());
});

test('farm temperature, two-day risk and frost count are visible beside current progress', () => {
  const f = farm('harsh'), { G, b } = f;
  const s = G.farmClimateSummary(b), climate = f.node('climate'), progress = f.node('progress');
  assert(climate && !insideDetails(climate)); assert(!insideDetails(progress));
  assert(climate.textContent.includes(String(s.temperature) + '°C'));
  assert(climate.textContent.includes(s.warning)); assert.match(climate.textContent, /温度成长倍率.*霜损阈值.*提前抢收.*仍可能霜损/);
  assert.match(progress.textContent, /实际收获 0\/64.*本季霜损 0\/64/);
  assert.match(f.node('timing').textContent, /24 有效日（按温度累计）/);
  assert(!f.info.textContent.includes('不是气温模拟'));
  assert.match(f.info.textContent, /冬季截止前.*耐寒瓜.*不保证免霜/);
});

test('live frost damage refreshes count and risk without rebuilding a focused crop selector', () => {
  const f = farm('harsh'), { G, b, c } = f, select = get(f, 'farm-crop'), writes = f.info.htmlWrites;
  select.focus(); select.value = 'beans'; c.carry = { type: 'grain', qty: 7 };
  G.damageFrostTiles(b, b.farm.slice(0, 3)); G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(get(f, 'farm-crop'), select);
  assert.equal(f.doc.activeElement, select); assert.equal(select.value, 'beans');
  assert.equal(G.farmCropOf(b), 'wheat'); assert.equal(c.carry.qty, 7);
  assert.match(f.node('progress').textContent, /实际收获 0\/64.*本季霜损 3\/64/);
  assert(f.node('climate').textContent.includes(G.farmClimateSummary(b).warning));
  const before = snapshot(G); for (let i = 0; i < 5; i++) G.ui.renderInfo(); assert.equal(snapshot(G), before);
});

test('real frost loss invalidates an outstanding early-harvest quote', () => {
  const f = farm('harsh'), { G, b } = f;
  get(f, 'early-harvest-start').click();
  assert.match(f.info.querySelector('[data-early-harvest-quote]').textContent, /提前抢收不免霜/);
  G.damageFrostTiles(b, b.farm.slice(0, 2)); G.ui.renderInfo();
  assert(f.info.querySelector('[data-early-harvest-confirm]').classList.contains('hidden'));
  get(f, 'early-harvest-confirm').click(); assert.equal(b.earlyHarvestYield, undefined);
  get(f, 'early-harvest-start').click(); get(f, 'early-harvest-confirm').click();
  assert.equal(b.earlyHarvestYield, 7); assert.equal(G.game.res.grain, 300);
  assert.match(f.node('progress').textContent, /本季霜损 2\/64/);
});

test('next-season squash does not rewrite the current wheat frost threshold', () => {
  const f = farm('harsh'), { G, b } = f;
  G.game.unlocks.squash = true; G.ui.renderInfo();
  const select = get(f, 'farm-crop'); select.value = 'squash'; select.emit('change');
  assert.equal(G.farmCropOf(b), 'wheat'); assert.equal(G.cropChoiceOf(b), 'squash');
  assert.match(f.node('current').textContent, /小麦/);
  assert(f.node('climate').textContent.includes('低于 ' + G.CROP_TEMPERATURES.wheat.frostBelow + '°C'));
  assert.match(f.node('choice').textContent, /耐寒瓜.*下一春生效/);
  const squash = farm('harsh', 'squash');
  assert(squash.node('climate').textContent.includes('低于 ' + G.CROP_TEMPERATURES.squash.frostBelow + '°C'));
  assert.match(squash.node('cold').textContent, /耐寒不等于免霜.*第3日零时/);
});

test('legacy farms retain original calendar wording without invented temperatures or frost history', () => {
  const f = farm(null), { G } = f;
  assert.equal(f.node('climate'), null); assert(!f.node('progress').textContent.includes('霜损'));
  assert.match(f.node('timing').textContent, /成长 24 天/);
  assert.match(f.info.textContent, /48日历适配.*不是气温模拟/);
  assert(!f.info.textContent.includes('有效日')); assert.equal(G.farmClimateSummary(f.b), null);
});

test('real HUD displays today temperature only for climate villages and clears it on legacy load', () => {
  const f = hudFixture(), { G } = f, date = G.ui.el.date;
  G.game.climate = { v: 1, type: 'mild', lastDay: G.game.day };
  G.ui.refreshHUD(); assert(date.textContent.includes('今日 ' + G.climateWeather().temperature + '°C'));
  assert.match(date.title, /温和.*农田成长与霜损.*取暖和果园仍沿用原规则/);
  G.game.day++; G.game.climate.lastDay = G.game.day; G.ui.refreshHUD();
  assert(date.textContent.includes('今日 ' + G.climateWeather().temperature + '°C'));
  G.game.climate = null; G.ui.refreshHUD(); assert(!date.textContent.includes('°C')); assert(!date.title.includes('气候'));
});


test('existing guide surfaces imminent field frost before loss and clears it after all crops are picked', () => {
  const f = hudFixture(), { G } = f, b = f.building('farm');
  G.game.climate = {v:1,type:'harsh',lastDay:0};b.sownAll=true;b.growth=.6;b.farm.forEach(tile=>tile.sown=true);
  const warningDay=Array.from({length:35},(_,i)=>i).find(day=>[1,2].some(offset=>G.temperatureFor(G.world.seed,day+offset,'harsh')<0));
  assert(warningDay!==undefined);G.game.day=warningDay;G.game.season=G.seasonOf(warningDay);G.game.climate.lastDay=warningDay;
  const before=JSON.stringify(b);G.ui.refreshGuide();assert.match(f.guide.textContent,/1块农田有近两日霜害风险/);assert.match(f.guide.textContent,/已采收和在途粮食保留/);assert.equal(JSON.stringify(b),before);
  b.farm.forEach(tile=>tile.harvested=true);b.harvestDone=true;G.ui.refreshGuide();assert(!f.guide.textContent.includes('近两日霜害风险'));
});


test('real collapsed guide preserves urgent-food priority and exposes frost through the existing All toggle', () => {
  const f = fullGuideFixture(), { G } = f, b = f.building('farm');
  G.game.climate={v:1,type:'harsh',lastDay:0};b.sownAll=true;b.growth=.6;b.farm.forEach(tile=>tile.sown=true);
  const c=G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.hunger=1;G.game.res.food=G.game.res.grain=0;
  const day=Array.from({length:35},(_,i)=>i).find(d=>[1,2].some(o=>G.temperatureFor(G.world.seed,d+o,'harsh')<0));
  G.game.day=day;G.game.season=G.seasonOf(day);G.game.climate.lastDay=day;G.ui.refreshGuide();
  const row=f.guide.querySelector('[data-guide-kind="crop-frost"]');assert(row);assert(row.hidden);assert.equal(f.guide.querySelector('[data-guide-kind="food"]').hidden,false);
  f.doc.getElementById('guide-toggle').click();assert.equal(row.hidden,false);assert.match(row.textContent,/近两日霜害风险/);assert.match(row.title,/未采下的格仍会受霜害/);
});

console.log(`Crop climate UI: ${passed} DOM/live-state suites passed (not browser/mobile acceptance).`);
