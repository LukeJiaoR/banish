/* Crop, seed-trade DOM and live-simulation contracts, not browser visual acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function fixture() {
  const roots = [];
  const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g,
    (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[key]));
  const doc = { activeElement: null,
    getElementById(id) { return roots.flatMap(el => [el, ...el.descendants()]).find(el => el.id === id) || null; } };
  function element(tag = 'div', attrs = {}) {
    const handlers = {}, classes = new Set((attrs.class || '').split(/\s+/));
    let html = '', text = '', value = attrs.value;
    let disabled = Object.hasOwn(attrs, 'disabled');
    return {
      get value() { if (value !== undefined) return String(value); const option = this.children.find(child => child.tagName === 'OPTION' && child.getAttribute('selected') !== null) || this.children.find(child => child.tagName === 'OPTION'); return option ? option.value : ''; },
      set value(v) { value = String(v); },
      get disabled() { return disabled; }, set disabled(v) { disabled = !!v; },
      tagName: tag.toUpperCase(), id: attrs.id || '', dataset: Object.fromEntries(Object.entries(attrs)
        .filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value])),
      children: [], parentNode: null, htmlWrites: 0, textWrites: 0,
      classList: { add(k) { classes.add(k); }, remove(k) { classes.delete(k); }, contains(k) { return classes.has(k); },
        toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); },
      contains(child) { for (; child; child = child.parentNode) if (child === this) return true; return false; },
      querySelectorAll(selector) {
        return this.descendants().filter(child => {
          if (selector[0] === '#') return child.id === selector.slice(1);
          if (selector === '.mini-tog') return child.classList.contains('mini-tog');
          const presence = selector.match(/^\[data-([^=]+)\]$/);
          if (presence) return Object.hasOwn(child.dataset, presence[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
          const data = selector.match(/^\[data-([^=]+)="([^"]*)"\]$/);
          return data ? child.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === data[2] : child.tagName === selector.toUpperCase();
        });
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      focus() { doc.activeElement = this; },
      setAttribute(key, value) { attrs[key] = value; },
      getAttribute(key) { return attrs[key] ?? null; },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      emit(type) { for (const fn of handlers[type] || []) fn({target: this, preventDefault() {}}); },
      click() { if (roots.some(root => root.contains(this))) this.focus(); for (const fn of handlers.click || []) fn({ target: this }); },
      appendText(value) { text += value; },
      get textContent() { return text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { text = String(value); this.textWrites++; this.children = []; },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = String(value); text = ''; this.htmlWrites++;
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        const stack = [this];
        for (const token of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/gi)) {
          if (token[4]) stack[stack.length - 1].appendText(decode(token[4]));
          else if (token[1]) stack.pop();
          else {
            const a = Object.fromEntries(Array.from(token[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g), match => [match[1], decode(match[2] || '')]));
            const child = stack[stack.length - 1].appendChild(element(token[2], a));
            if (!['img', 'br', 'input'].includes(token[2])) stack.push(child);
          }
        }
      },
    };
  }
  function mount(id) { const el = element('div', { id }); roots.push(el); return el; }
  const ctx = { console, document: doc, __errs: [], setTimeout() {}, addEventListener() {}, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'ui', 'main'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  G.markGroundDirty = () => {}; G.autosave = () => {};
  const generate = G.genWorld;
  G.genWorld = (seed, options) => { const w = generate(seed, options); w.water.fill(0); w.rock.fill(0); return w; };
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar');
  G.ui.el = { info, guide, toolbar, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
  G.ui.toast = () => {};
  for (const key of G.RES_KEYS) mount('res-' + key).appendChild(element('b'));
  function building(type, options = {}) {
    const def = G.BDEF[type], n = G.world.buildings.length;
    const b = Object.assign({ id: G.nextId(), type, x: 2 + (n % 3) * 12, y: 2 + Math.floor(n / 3) * 12,
      w: def.w, h: def.h, state: 'ok', workers: [], family: null, noWork: false, warnText: '',
      progress: 1, totalWork: def.buildWork, workLeft: 0 }, options);
    if (type === 'farm') { b.farm = []; for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) b.farm.push({ x, y, sown: false, harvested: false }); b.sownAll = false; b.growth = 0; b.harvestDone = false; }
    G.ensureEconomyBuilding(b);
    G.world.buildings.push(b); G.world.bmap[b.id] = b;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) G.world.bgrid[y * N + x] = b.id;
    return b;
  }
  function resident(b) {
    const c = G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm', name: '测试住户' });
    const family = { id: G.nextId(), members: [c.id], houseId: b.id, coupleIds: [] };
    c.familyId = family.id; G.world.families.push(family);
    if (b.type !== 'boarding') b.family = family.id;
    return c;
  }
  function homes(count = 4) { for (let i = 0; i < count; i++) resident(building('house')); }
  function select(b) { G.sel = { kind: 'b', id: b.id }; G.ui.showInfo(); }
  const node = key => info.querySelector(`[data-farm="${key}"]`);
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, mount };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function farm(unlocked = false) {
  const f = fixture(), { G } = f, b = f.building('farm');
  f.building('storage'); G.game.h = 12; G.game.unlocks.cabbage = unlocked;
  G.game.res.grain = G.game.res.food = 200;
  const c = G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm', name: '农夫<甲>' });
  c.name = '农夫<甲>'; c.job = b.id; b.workers = [c.id];
  return { ...f, b, c };
}
function choose(f, crop) {
  const select = f.G.ui.el.info.querySelector('#farm-crop');
  select.focus(); select.value = crop; select.emit('change'); return select;
}
function trader(f) {
  const b = f.building('tradingpost');
  b.merchant = { leaveDay: f.G.game.day + 12, stock: Object.fromEntries(Object.entries(f.G.TRADE_GOODS).map(([type, value]) => [type, value.stock])) };
  b.tradeInventory.firewood = 1500; return b;
}
function tradeSelection(f, good, qty = 1, payment = 'firewood') {
  const info = f.G.ui.el.info;
  info.querySelector('#trade-good').value = good;
  info.querySelector('#trade-buy-quantity').value = String(qty);
  info.querySelector('#trade-payment').value = payment;
  info.querySelector('#trade-good').emit('input');
  return info.querySelector('#trade-exchange-form');
}
function stepUntil(f, condition, limit = 6000) {
  for (let i = 0; i < limit && !condition(); i++) { f.G.stepCitizen(f.c, .1); f.G.ui.renderInfo(); }
  assert(condition(), 'live simulation did not reach the expected state');
}

test('new and legacy fields start as wheat and explain the three food categories and locked seeds', () => {
  const f = farm(); f.select(f.b);
  assert.equal(f.G.farmCropOf(f.b), 'wheat'); assert.equal(f.G.cropChoiceOf(f.b), 'wheat');
  assert.match(f.node('current').textContent, /本季作物：小麦 → 主食/);
  assert.match(f.node('choice').textContent, /下季 \/ 空田选择：小麦/);
  assert.match(f.node('seeds').textContent, /卷心菜未解锁.*贸易购买.*不占仓位/);
  assert.match(f.node('yield').textContent, /每格 14 主食.*每筐达到 28 后送仓.*入仓后才可用/);
  assert.match(f.info.textContent, /肉类、蔬菜、主食三类.*小麦产主食，卷心菜产蔬菜/);
  assert.match(f.info.textContent, /全田播完才开始成长.*冬季未收作物损失/);
  assert.match(f.info.innerHTML, /农夫&lt;甲&gt;/);
  const select = f.doc.getElementById('farm-crop');
  assert.equal(select.getAttribute('aria-describedby'), 'farm-crop-note');
  assert.equal(select.querySelectorAll('option').find(option => option.value === 'cabbage').disabled, true);
  choose(f, 'cabbage'); assert.equal(f.G.farmCropOf(f.b), 'wheat'); assert.equal(select.value, 'wheat');
  assert.match(f.info.querySelector('[data-farm-message]').textContent, /未更改.*购买/);
  const fresh = f.G.addBuilding('farm', 20, 20, { instant: true, free: true });
  assert(fresh.ok); assert.equal(f.G.farmCropOf(fresh.b), 'wheat');
});

test('spring and summer empty fields switch immediately, with focused drafts and unlocks patched in place', () => {
  for (const season of [0, 1]) {
    const f = farm(); f.G.game.season = season; f.select(f.b);
    const select = f.doc.getElementById('farm-crop'), panel = f.info.querySelector('[data-farm-panel]'), writes = f.info.htmlWrites;
    select.focus(); f.G.game.unlocks.cabbage = true; f.G.ui.renderInfo();
    assert.equal(select.querySelectorAll('option').find(option => option.value === 'cabbage').disabled, false);
    for (const type of ['cabbage', 'wheat', 'cabbage']) { choose(f, type); assert.equal(f.G.farmCropOf(f.b), type); }
    assert.match(f.node('current').textContent, /卷心菜 → 蔬菜/);
    assert.match(f.node('yield').textContent, /每格 14 蔬菜/);
    select.value = 'wheat'; f.G.game.res.vegetables = 17; f.G.ui.renderInfo();
    assert.equal(select.value, 'wheat'); assert.equal(f.G.cropChoiceOf(f.b), 'cabbage');
    assert.match(f.node('stock').textContent, /蔬菜 17/);
    assert.equal(f.info.htmlWrites, writes); assert.equal(f.info.querySelector('[data-farm-panel]'), panel);
    assert.equal(f.doc.activeElement, select); assert.equal(f.doc.getElementById('farm-crop'), select);
    f.doc.activeElement = null; f.G.ui.renderInfo(); assert.equal(select.value, 'cabbage');
  }
});

test('accepting the first real sow locks wheat before the first tile is planted', () => {
  const f = farm(true), { G, b, c } = f; f.select(b);
  G.requestTask(c); assert.equal(c.task.kind, 'sow'); assert.equal(b.farm.filter(tile => tile.sown).length, 0);
  const task = c.task, writes = f.info.htmlWrites; const select = choose(f, 'cabbage');
  assert.equal(G.farmCropOf(b), 'wheat'); assert.equal(G.cropChoiceOf(b), 'cabbage'); assert.equal(c.task, task);
  assert.match(f.node('current').textContent, /小麦 → 主食/);
  assert.match(f.node('choice').textContent, /卷心菜 → 蔬菜.*下一春/);
  assert.match(f.node('reason').textContent, /本季已开始.*不改变已接任务/);
  stepUntil(f, () => b.farm.some(tile => tile.sown));
  assert.match(f.node('progress').textContent, /播种 [1-9]\d*\/64/);
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, select);
});

test('sown, growing and fully harvested seasons keep the current crop while changing next spring', () => {
  for (const stage of ['sown', 'growing', 'harvested']) {
    const f = farm(true), { G, b } = f;
    b.farm[0].sown = true;
    if (stage !== 'sown') { b.sownAll = true; b.farm.forEach(tile => { tile.sown = true; }); b.growth = .6; }
    if (stage === 'harvested') { G.game.season = 2; b.growth = 1; b.harvestDone = true; b.farm.forEach(tile => { tile.harvested = true; }); }
    f.select(b); choose(f, 'cabbage');
    assert.equal(G.farmCropOf(b), 'wheat'); assert.equal(G.cropChoiceOf(b), 'cabbage');
    assert.match(f.node('current').textContent, /小麦/); assert.match(f.node('choice').textContent, /卷心菜.*下一春/);
  }
});

test('autumn and winter empty fields defer their selection until the actual spring transition', () => {
  for (const season of [2, 3]) {
    const f = farm(true), { G, b } = f; G.game.season = season; f.select(b); choose(f, 'cabbage');
    assert.equal(G.farmCropOf(b), 'wheat'); assert.match(f.node('reason').textContent, /当前不能播种.*下一春/);
    G.game.day = G.YEAR_DAYS - 1; G.game.season = 3; G.endDay(); G.ui.renderInfo();
    assert.equal(G.game.season, 0); assert.equal(G.farmCropOf(b), 'cabbage');
    assert.match(f.node('current').textContent, /卷心菜 → 蔬菜/);
    assert.match(f.node('choice').textContent, /与本季一致/);
  }
});

test('winter crop loss does not apply next crop early, and spring leaves old carried grain intact', () => {
  const f = farm(true), { G, b, c } = f; b.sownAll = true; b.growth = 1; b.farm.forEach(tile => { tile.sown = true; });
  G.game.season = 2; G.game.day = 35; f.select(b); choose(f, 'cabbage');
  c.carry = { type: 'grain', qty: 14 }; c.task = G.makeTask(b, c); c.pausedTask = c.task;
  G.endDay(); G.ui.renderInfo();
  assert.equal(G.game.season, 3); assert.equal(G.farmCropOf(b), 'wheat'); assert.equal(b.sownAll, false);
  assert.equal(c.task, null); assert.equal(c.pausedTask, null); assert.equal(c.carry.type, 'grain');
  assert.match(f.node('status').textContent, /冬季/); assert.match(f.node('choice').textContent, /下一春/);
  G.game.day = 47; G.endDay(); G.ui.renderInfo();
  assert.equal(G.farmCropOf(b), 'cabbage'); assert.equal(c.carry.type, 'grain'); assert.equal(c.carry.qty, 14);
  const stock = G.game.res.grain; G.startHaul(c); stepUntil(f, () => !c.carry);
  assert.equal(G.game.res.grain, stock + 14); assert.equal(G.game.res.vegetables, 0);
});

test('real harvest and warehouse delivery preserve wheat this year, then produce cabbage next spring', () => {
  const f = farm(true), { G, b, c } = f;
  // Two tiles retain the real task, growth and delivery paths while keeping this focused UI test short.
  b.farm = b.farm.slice(0, 2); G.requestTask(c); f.select(b); choose(f, 'cabbage');
  stepUntil(f, () => b.sownAll); assert.equal(b.growth, 0);
  for (let day = 0; day <= G.PROD.farm.growDays; day++) G.endDay();
  G.ui.renderInfo(); assert.equal(b.growth, 1); assert.equal(G.game.season, 2);
  const grain = G.game.res.grain, vegetables = G.game.res.vegetables;
  G.requestTask(c); stepUntil(f, () => b.harvestDone && !c.carry);
  assert.equal(G.game.res.grain, grain + 28); assert.equal(G.game.res.vegetables, vegetables);
  assert.match(f.node('progress').textContent, /收获 2\/2/);
  G.game.day = 47; G.game.season = 3; G.endDay(); G.ui.renderInfo();
  assert.equal(G.farmCropOf(b), 'cabbage'); G.requestTask(c); stepUntil(f, () => b.sownAll);
  for (let day = 0; day <= G.PROD.farm.growDays; day++) G.endDay();
  const before = G.game.res.vegetables; G.requestTask(c); stepUntil(f, () => b.harvestDone && !c.carry);
  assert.equal(G.game.res.vegetables, before + 28); assert.match(f.node('current').textContent, /卷心菜 → 蔬菜/);
});

test('current and next crop targets remain separate, while stock and worker counts refresh without focus loss', () => {
  const f = farm(true), { G, b, c } = f; G.requestTask(c); f.select(b); const select = choose(f, 'cabbage');
  G.setProductionGoal('grain', 0); G.setProductionGoal('vegetables', 100); G.ui.renderInfo();
  assert.match(f.node('targets').textContent, /主食 0（关闭新一季）.*蔬菜 100/);
  assert.match(f.node('goals').textContent, /本季已开始.*目标仅限制未开始/);
  assert.equal(G.productionLimited(b), false); assert.match(f.node('workers').textContent, /1 人.*农夫<甲>/);
  b.workers = []; G.ui.renderInfo(); assert.match(f.node('workers').textContent, /0 人.*等待/);
  b.workers = [c.id]; c.job = null; G.ui.renderInfo(); assert.match(f.node('workers').textContent, /0 人.*等待/);
  G.game.res.tools = G.game.res.steelTools = 0; G.ui.renderInfo();
  assert.match(f.node('yield').textContent, new RegExp(`每格 ${G.taskYield(G.PROD.farm.perTile)} 主食`));
  assert.equal(f.doc.activeElement, select); assert.equal(f.doc.getElementById('farm-crop'), select);
});

test('both seed trades quote one permanent unlock, reject bulk quantities and do not create inventory items', () => {
  for (const [good, key] of [['cabbageSeed', 'cabbage'], ['orchardSeed', 'orchard']]) {
    const f = farm(), { G } = f, b = trader(f); f.select(b);
    const form = tradeSelection(f, good, 2); assert.equal(G.ui.tradeQuote(b).ok, false);
    assert.match(G.ui.tradeQuote(b).reason, /1份/); const before = b.tradeInventory.firewood;
    form.emit('submit'); assert.equal(b.tradeInventory.firewood, before); assert.equal(G.game.unlocks[key], false);
    tradeSelection(f, good); const quote = G.ui.tradeQuote(b); assert(quote.ok);
    assert.equal(quote.cost, 625); assert.match(quote.text, /永久解锁.*不可复购.*不占仓位/);
    form.emit('submit'); assert.equal(G.game.unlocks[key], true); assert.equal(b.tradeInventory.firewood, before - 625);
    assert.equal(b.tradeInventory[good], undefined); assert.equal(G.game.res[good], undefined);
    assert.match(f.info.querySelector('[data-economy-message]').textContent, /永久解锁.*不占仓位/);
    b.merchant.stock[good] = 1; form.emit('submit');
    assert.equal(b.tradeInventory.firewood, before - 625); assert.equal(b.merchant.stock[good], 1);
    assert.match(f.info.querySelector('[data-economy-message]').textContent, /已永久解锁/);
    const direct = G.executeTrade(b, good, 1, 'firewood'); assert.equal(direct.ok, false);
    assert.equal(b.tradeInventory.firewood, before - 625);
    if (key === 'cabbage') { f.select(f.b); choose(f, 'cabbage'); assert.equal(G.farmCropOf(f.b), 'cabbage'); }
  }
});

test('seed quote, costs and stock respond in place; sheep and ordinary goods keep their prior trade behavior', () => {
  const f = farm(), { G } = f, b = trader(f); f.select(b);
  const form = tradeSelection(f, 'cabbageSeed'), good = f.doc.getElementById('trade-good'); good.focus();
  const writes = f.info.htmlWrites; b.tradeInventory.firewood = 624; G.ui.renderInfo();
  assert.match(G.ui.tradeQuote(b).reason, /不足.*1/); assert.equal(f.doc.getElementById('trade-execute').disabled, true);
  b.tradeInventory.firewood = 2000; G.ui.renderInfo(); assert.equal(G.ui.tradeQuote(b).ok, true);
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, good);
  b.merchant.leaveDay = G.game.day; G.ui.renderInfo(); assert.match(G.ui.tradeQuote(b).reason, /尚未停靠/);
  form.emit('submit'); assert.equal(G.game.unlocks.cabbage, false); assert.equal(b.tradeInventory.firewood, 2000);
  b.merchant.leaveDay = G.game.day + 12; tradeSelection(f, 'sheep'); form.emit('submit');
  assert.equal(G.game.livestock.sheep, 1); assert.equal(b.tradeInventory.sheep, undefined);
  assert.match(f.info.querySelector('[data-economy-message]').textContent, /到羊牧场放入/);
  tradeSelection(f, 'grain', 4); form.emit('submit'); assert.equal(b.tradeInventory.grain, 4);
  assert.match(f.info.querySelector('[data-economy-message]').textContent, /物资已到本站/);
});

test('farm callbacks reject invalid selections and stale world, game, DOM, selection, modal and removed buildings', () => {
  for (const change of ['invalid', 'modal', 'hidden', 'selection', 'panel', 'world', 'game', 'infoElement', 'removed', 'replacement', 'site', 'closed']) {
    const f = farm(true); f.select(f.b); const old = f.doc.getElementById('farm-crop');
    const actual = f.G.setFarmCrop; let calls = 0; f.G.setFarmCrop = (...args) => { calls++; return actual(...args); };
    if (change === 'modal') f.G.hasOpenModal = () => true;
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'selection') f.G.sel = { kind: 'b', id: f.building('house').id };
    if (change === 'panel') { f.select(f.building('house')); f.select(f.b); }
    if (change === 'world') f.G.world = { ...f.G.world };
    if (change === 'game') f.G.game = { ...f.G.game };
    if (change === 'infoElement') f.G.ui.el.info = f.mount('replacement-info');
    if (change === 'removed') delete f.G.world.bmap[f.b.id];
    if (change === 'replacement') f.G.world.bmap[f.b.id] = { ...f.b };
    if (change === 'site') f.b.state = 'site';
    if (change === 'closed') f.G.ui.hideInfo();
    old.value = change === 'invalid' ? 'magic' : 'cabbage'; old.emit('change');
    assert.equal(f.G.farmCropOf(f.b), 'wheat', change); assert.equal(calls, change === 'invalid' ? 1 : 0, change);
    if (change === 'invalid') { assert.equal(old.value, 'wheat'); assert.match(f.info.querySelector('[data-farm-message]').textContent, /未更改/); }
  }
});

test('construction completion and legacy cold panels mount selectors despite focused old controls', () => {
  const f = farm(true); f.b.state = 'site'; f.b.progress = .5; f.select(f.b);
  const old = f.doc.getElementById('info-demolish'); old.focus(); assert.equal(f.doc.getElementById('farm-crop'), null);
  f.b.state = 'ok'; f.G.ui.renderInfo(); assert(f.doc.getElementById('farm-crop'));
  assert.equal(f.doc.activeElement.id, 'info-close'); old.click(); assert.equal(f.G.world.bmap[f.b.id], f.b);
  const summary = f.G.farmSummary; delete f.G.farmSummary; f.select(f.building('house')); f.select(f.b);
  const close = f.doc.getElementById('info-close'); close.focus(); assert.equal(f.doc.getElementById('farm-crop'), null);
  f.G.farmSummary = summary; f.G.ui.renderInfo(); assert(f.doc.getElementById('farm-crop'));
  assert.equal(f.doc.activeElement.id, 'info-close'); choose(f, 'cabbage'); assert.equal(f.G.farmCropOf(f.b), 'cabbage');
});

test('replacing a game or info element invalidates old controls and mounts functional replacements', () => {
  for (const change of ['game', 'element']) {
    const f = farm(true); f.select(f.b); const old = f.doc.getElementById('farm-crop');
    if (change === 'game') f.G.game = { ...f.G.game };
    else f.G.ui.el.info = f.mount('new-info');
    f.G.ui.renderInfo(); const current = f.G.ui.el.info.querySelector('#farm-crop'); assert(current); assert.notEqual(current, old);
    old.value = 'cabbage'; old.emit('change'); assert.equal(f.G.farmCropOf(f.b), 'wheat');
    current.focus(); current.value = 'cabbage'; current.emit('change'); assert.equal(f.G.farmCropOf(f.b), 'cabbage');
    assert.equal(f.doc.activeElement, current);
  }
});

test('detached or hidden trade forms never purchase in replacement games or panels', () => {
  for (const change of ['game', 'world', 'panel', 'hidden', 'element', 'removed', 'modal']) {
    const f = farm(), b = trader(f); f.select(b); const form = tradeSelection(f, 'cabbageSeed');
    if (change === 'game') f.G.game = { ...f.G.game };
    if (change === 'world') f.G.world = { ...f.G.world };
    if (change === 'panel') { f.select(f.b); f.select(b); }
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'element') f.G.ui.el.info = f.mount('new-info');
    if (change === 'removed') delete f.G.world.bmap[b.id];
    if (change === 'modal') f.G.hasOpenModal = () => true;
    form.emit('submit'); assert.equal(b.tradeInventory.firewood, 1500, change); assert.equal(f.G.game.unlocks.cabbage, false, change);
  }
});

test('real old-save migration opens as wheat with cabbage locked; new saves keep pending crop and grain cargo', () => {
  const f = farm(true), { G, b, c } = f; G.requestTask(c); G.setFarmCrop(b, 'cabbage'); c.carry = { type: 'grain', qty: 14 };
  let data = JSON.parse(JSON.stringify(G.serializeGame())), restored = G.prepareSaveData(data);
  G.world = restored.world; G.game = restored.game; f.select(G.world.bmap[b.id]);
  assert.match(f.node('current').textContent, /小麦/); assert.match(f.node('choice').textContent, /卷心菜.*下一春/);
  assert.equal(G.world.cmap[c.id].carry.type, 'grain');
  delete data.game.unlocks.cabbage;
  for (const record of data.buildings) { delete record.cropType; delete record.cropChoice; }
  restored = G.prepareSaveData(data); G.world = restored.world; G.game = restored.game; f.select(G.world.bmap[b.id]);
  assert.equal(G.farmCropOf(G.world.bmap[b.id]), 'wheat'); assert.equal(G.cropChoiceOf(G.world.bmap[b.id]), 'wheat');
  assert.match(f.node('current').textContent, /小麦 → 主食/); assert.match(f.node('seeds').textContent, /卷心菜未解锁/);
  assert.equal(G.world.cmap[c.id].carry.qty, 14);
});

test('reading farm facts and refreshing the DOM do not change seeds, crop, stock or outstanding tasks', () => {
  const f = farm(true), { G, b, c } = f; G.requestTask(c); c.pausedTask = c.task; f.select(b);
  const snapshot = () => JSON.stringify({ res: G.game.res, unlocks: G.game.unlocks, crop: b.cropType, choice: b.cropChoice,
    farm: b.farm, committed: b.sowingCommitted, task: c.task, pausedTask: c.pausedTask });
  const before = snapshot(); for (let i = 0; i < 5; i++) { G.ui.farmInfoData(b); G.ui.renderInfo(); }
  assert.equal(snapshot(), before);
});

test('trade quote and live capacity include real inbound reservation without rebuilding focused form',()=>{
 const f=farm(),{G,c}=f,b=trader(f);b.tradeInventory={stone:1980};b.merchant.stock.grain=400;c.job=b.id;c.carry={type:'wood',qty:20,staffingReturn:true};c.task={kind:'trade',phase:'deliver',b,resource:'wood'};c.state='walk';f.select(b);const form=tradeSelection(f,'grain',7,'stone'),good=f.doc.getElementById('trade-good');good.focus();const writes=f.info.htmlWrites;G.ui.renderInfo();assert.equal(G.ui.tradeQuote(b).ok,false);assert.match(G.ui.tradeQuote(b).reason,/含在途占位/);assert.match(f.info.querySelector('[data-economy-live="trade-capacity"]').textContent,/已入站 1980.*在途占位 20.*可用空位 0/);assert.equal(f.doc.getElementById('trade-execute').disabled,true);form.emit('submit');assert.equal(b.tradeInventory.stone,1980);assert.equal(b.merchant.stock.grain,400);
 c.pausedTask=c.task;c.task=null;G.ui.renderInfo();assert.equal(G.ui.tradeQuote(b).ok,false);c.pausedTask=null;G.ui.renderInfo();assert.equal(G.ui.tradeQuote(b).ok,true);assert.equal(f.doc.getElementById('trade-execute').disabled,false);assert.equal(f.doc.activeElement,good);assert.equal(f.info.htmlWrites,writes);
});

console.log(`Crop seeds UI: ${passed} DOM and live-simulation suites passed (browser visual acceptance not performed).`);
