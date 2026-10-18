/* Inspector presentation/refresh contracts on a real-simulation DOM fixture.
 * CSS contracts supplement these checks; they are not browser/zoom acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'household-supply-ui.js'), 'utf8');
const context = { require, console, Blob, __dirname, module: { exports: {} } };
vm.runInNewContext(source.slice(0, source.indexOf('let passed')) + '\nmodule.exports = fixture;', context);
const fixture = context.module.exports;
const find = (f, selector) => f.info.querySelector(selector);
const tab = (f, name) => find(f, `[data-building-tab="${name}"]`);
const body = f => find(f, '[data-detail-scroll]');
const stock = f => find(f, '[data-household-supply="stock"]');
const selectCitizen = (f, c) => { f.G.sel = { kind: 'c', id: c.id }; f.G.ui.showInfo(); };
let passed = 0;
function test(name, run) { run(); passed++; console.log('ok', name); }

test('building headers share management naming and do not live in the scroll body', () => {
  for (const type of ['house', 'boarding', 'storage', 'blacksmith', 'woodcutter', 'farm', 'townhall', 'school', 'tradingpost', 'hospital']) {
    const f = fixture(), b = f.building(type); f.select(b);
    const title = f.info.children[0], scroll = body(f), debug = find(f, '[data-building-debug]');
    assert.match(title.textContent, new RegExp(f.G.BDEF[type].name + '管理'), type);
    assert(!scroll.contains(title), type);
    assert(!scroll.contains(find(f, '#info-close')), type);
    assert(!scroll.contains(tab(f, 'management')), type);
    assert.equal(find(f, '#info-close').getAttribute('aria-label'), '关闭建筑详情');
    assert(debug && !debug.open, type);
    assert.match(debug.textContent, new RegExp(`${b.x}, ${b.y}`), type);
    assert.equal(find(f, '[data-building-phase]').textContent, '已建成', type);
  }
});

test('activity legend begins collapsed, current state refreshes without remounting', () => {
  const f = fixture(), b = f.building('blacksmith');
  let activity = { state: 'fetching', label: '正在取料', detail: '标记：取料不会播放现场加工动效。' };
  f.G.buildingActivity = () => activity; f.select(b);
  const legend = find(f, '[data-building-activity-help]'), chip = find(f, '[data-building-current-activity]');
  assert(!legend.open); assert.equal(chip.textContent, '取料中');
  assert.match(legend.textContent, /标记/);
  legend.open = true; find(f, '#worker-limit-input').focus();
  const writes = f.info.htmlWrites;
  activity = { state: 'working', label: '现场加工', detail: '已携实料到场。' }; f.G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(find(f, '[data-building-current-activity]'), chip);
  assert.equal(chip.textContent, '现场加工'); assert(legend.open);
  activity = null; f.G.ui.renderInfo();
  assert(chip.classList.contains('hidden')); assert(legend.classList.contains('hidden'));
});

test('management action is fixed outside the scroll body and tab activation controls access', () => {
  const f = fixture(), b = f.building('house'); f.select(b);
  const action = find(f, '#info-demolish'), footer = find(f, '[data-building-actions="management"]');
  assert(!body(f).contains(action)); assert(footer.contains(action));
  assert(footer.classList.contains('hidden')); assert(footer.inert);
  const before = JSON.stringify(f.G.serializeGame());
  tab(f, 'management').click(); assert(!footer.classList.contains('hidden')); assert(!footer.inert);
  tab(f, 'overview').click(); assert(footer.classList.contains('hidden')); assert(footer.inert);
  assert.equal(JSON.stringify(f.G.serializeGame()), before);
  assert.equal(f.info.querySelectorAll('#info-demolish').length, 1);
});

test('site pause and resume patch overview phase to match its persistent status chip', () => {
  const f = fixture(), b = f.building('house', { state: 'site', progress: 0, workLeft: 90 }); f.select(b);
  const phase = find(f, '[data-building-overview-phase]'), chip = find(f, '[data-building-phase]');
  find(f, '#info-close').focus(); const writes = f.info.htmlWrites;
  for (const paused of [true, false, true]) {
    b.sitePaused = paused; f.G.ui.renderInfo();
    assert.equal(find(f, '[data-building-overview-phase]'), phase);
    assert.equal(phase.textContent, paused ? '施工暂停' : '施工中');
    assert.equal(phase.textContent, chip.textContent); assert.equal(f.info.htmlWrites, writes);
  }
});

test('forced refresh preserves body scroll, focused staffing draft and disclosures', () => {
  const f = fixture(), b = f.building('forester'); f.select(b); tab(f, 'production').click();
  const field = find(f, '#worker-limit-input'); field.value = '0'; field.focus();
  body(f).scrollTop = 95;
  find(f, '[data-building-debug]').open = true;
  f.G.ui.renderInfo(true);
  assert.equal(body(f).scrollTop, 95); assert.equal(find(f, '#worker-limit-input').value, '0');
  assert.equal(f.doc.activeElement, find(f, '#worker-limit-input'));
  assert(find(f, '[data-building-debug]').open);
  tab(f, 'overview').click(); assert.equal(body(f).scrollTop, 0);
  f.select(f.building('house')); assert.equal(body(f).scrollTop, 0);
});

test('citizen survival is first, factual and refreshed in place with keyboard focus', () => {
  const f = fixture(), home = f.building('house'), c = f.resident(home);
  f.G.game.season = 3; home.unheated = true;
  Object.assign(c, { hunger: 2, cold: 2, health: 2.5, sickDays: 1, clothingLeft: 0 });
  selectCitizen(f, c);
  assert(body(f).children[0].classList.contains('citizen-survival'));
  const hunger = find(f, '[data-citizen-survival="hunger"]'), warmth = find(f, '[data-citizen-survival="cold"]');
  assert.match(hunger.textContent, /饥饿 2 天/); assert.match(warmth.textContent, /正在受冻/);
  assert.match(find(f, '[data-citizen-survival="health"]').textContent, /2.5 \/ 5.*患病/);
  assert.match(find(f, '[data-citizen-survival="home"]').textContent, /冷屋/);
  assert.match(find(f, '[data-citizen-survival="clothing"]').textContent, /等待衣物/);
  const close = find(f, '#info-close'); assert(!body(f).contains(close)); close.focus();
  const writes = f.info.htmlWrites;
  Object.assign(c, { hunger: 0, cold: 0, health: 4, sickDays: 0, clothingLeft: 8, clothingType: 'warm' }); home.unheated = false;
  const before = JSON.stringify(f.G.serializeGame()); f.G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(find(f, '[data-citizen-survival="hunger"]'), hunger);
  assert.match(hunger.textContent, /未饥饿/); assert(!hunger.classList.contains('is-warning'));
  assert.match(find(f, '[data-citizen-survival="clothing"]').textContent, /暖衣/);
  assert.equal(f.doc.activeElement, close); assert.equal(JSON.stringify(f.G.serializeGame()), before);
});

test('nonzero household inventory appears first and every zero stays in one closed disclosure', () => {
  const f = fixture(), home = f.building('house'), c = f.resident(home);
  home.supplyStock = { grain: 6, firewood: 2, apples: .001 }; selectCitizen(f, c);
  const holder = stock(f), present = holder.querySelector('[data-supply-present]'), empty = holder.querySelector('[data-supply-empty]');
  assert.match(present.textContent, /主食 6/); assert.match(present.textContent, /柴火 2/); assert.match(present.textContent, /苹果 <0.01/);
  assert(!empty.open); assert.match(empty.querySelector('summary').textContent, /其余为空/);
  assert(!present.textContent.includes('梨 0')); assert.match(empty.textContent, /梨 0/);
  assert.equal(f.G.SUPPLY.types.length - 3, Number(empty.querySelector('summary').textContent.match(/（(\d+)/)[1]));
  assert(holder.children.indexOf(present) < holder.children.indexOf(empty));
});

test('focused health disclosure patches its details and diet alongside the survival summary', () => {
  const f = fixture(), c = f.resident(f.building('house'));
  Object.assign(c, { health: 5, sickDays: 0, dietVariety: 3, dietScore: 3 }); selectCitizen(f, c);
  const details = f.info.querySelectorAll('details').find(node => node.querySelector('summary')?.textContent === '健康与饮食');
  details.open = true; const summary = details.querySelector('summary'); summary.focus();
  const health = find(f, '[data-citizen-health="health"]'), diet = find(f, '[data-citizen-diet]'), writes = f.info.htmlWrites;
  Object.assign(c, { health: 1, sickDays: 2, dietVariety: 0, dietScore: .5 }); f.G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, summary); assert(details.open);
  assert.equal(find(f, '[data-citizen-health="health"]'), health); assert.equal(find(f, '[data-citizen-diet]'), diet);
  assert.match(health.textContent, /健康：1.0 \/ 5/); assert(health.classList.contains('warn-txt'));
  assert.match(find(f, '[data-citizen-health="disease"]').textContent, /患病第 2 天/);
  assert.match(diet.textContent, /0 \/ 3.*0.5\/3/);
  assert.match(find(f, '[data-citizen-survival="health"]').textContent, /1.0 \/ 5.*患病/);
});

test('inventory transitions preserve disclosure, focus and scroller while patching visible amounts', () => {
  const f = fixture(), home = f.building('house'), c = f.resident(home);
  home.supplyStock = { grain: 6 }; selectCitizen(f, c);
  const holder = stock(f), empty = holder.querySelector('[data-supply-empty]'), summary = empty.querySelector('summary');
  empty.open = true; summary.focus(); body(f).scrollTop = 132;
  const writes = f.info.htmlWrites;
  home.supplyStock.grain = 0; home.supplyStock.meat = 3;
  f.G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(stock(f), holder);
  assert.equal(holder.querySelector('[data-supply-empty]'), empty); assert(empty.open);
  assert.equal(f.doc.activeElement, summary); assert.equal(body(f).scrollTop, 132);
  assert.match(holder.querySelector('[data-supply-present]').textContent, /肉类 3/);
  assert(!holder.querySelector('[data-supply-present]').textContent.includes('主食'));
  assert.match(empty.textContent, /主食 0/);
  f.doc.activeElement = null; home.supplyStock.firewood = 2; f.G.ui.renderInfo(true);
  assert(stock(f).querySelector('[data-supply-empty]').open, 'changing count does not collapse the disclosure');
  assert.equal(body(f).scrollTop, 132);
});

test('all-empty and all-nonzero stock never hide a focused or open disclosure during refresh', () => {
  const f = fixture(), home = f.building('house'), c = f.resident(home); home.supplyStock = {}; selectCitizen(f, c);
  const holder = stock(f), empty = holder.querySelector('[data-supply-empty]'), summary = empty.querySelector('summary');
  assert.equal(holder.querySelector('[data-supply-present]').textContent, '暂无');
  empty.open = true; summary.focus();
  for (const key of f.G.SUPPLY.types) home.supplyStock[key] = 1;
  f.G.ui.renderInfo(); assert(!empty.classList.contains('hidden')); assert.equal(f.doc.activeElement, summary);
  assert.match(summary.textContent, /0 项/);
  empty.open = false; find(f, '#info-close').focus(); f.G.ui.renderInfo(); assert(empty.classList.contains('hidden'));
  empty.open = true; f.doc.activeElement = null; f.G.ui.renderInfo(true);
  assert(stock(f).querySelector('[data-supply-empty]').open);
  assert(!stock(f).querySelector('[data-supply-empty]').classList.contains('hidden'));
});

test('detail CSS defines one independent scroll body, fixed controls and short-window reflow', () => {
  const css = fs.readFileSync(path.join(__dirname, '../styles/details.css'), 'utf8');
  assert.match(css, /#info\.detail-inspector\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/);
  assert.match(css, /#info \.detail-scroll\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/);
  assert.match(css, /#info \.detail-actions\s*\{[^}]*flex:\s*none;/);
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /@media \(max-height: 500px\)/);
  assert(!/font-size:\s*(?:[0-9]|10)px/.test(css), 'details do not introduce sub-11px text');
});

console.log(`Detail readability: ${passed} DOM/CSS suites passed (not browser/zoom acceptance).`);
