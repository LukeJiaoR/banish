/* Early-bean DOM and live-simulation contracts, not browser/mobile visual acceptance. */
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
  f.building('storage'); G.game.h = 12; G.game.unlocks.beans = unlocked;
  G.game.res.grain = G.game.res.food = 200; G.game.res.tools = 20;
  const c = G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm', name: '豆田农夫' });
  c.job = b.id; b.workers = [c.id];
  const get = id => G.ui.el.info.querySelector('#' + id);
  return { ...f, b, c, get };
}
function choose(f, crop) {
  const select = f.get('farm-crop'); select.focus(); select.value = crop; select.emit('change'); return select;
}
function grown(f, growth = 1) {
  f.G.setFarmCrop(f.b, 'beans'); f.b.sownAll = true; f.b.growth = growth;
  f.b.farm.forEach(tile => { tile.sown = true; }); f.G.game.day = 12; f.G.game.season = 1;
  f.select(f.b);
}
function trader(f, stock) {
  const b = f.building('tradingpost');
  b.merchant = { id: 'seeds', arrivedDay: f.G.game.day, leaveDay: f.G.game.day + 12,
    stock: stock || Object.fromEntries(f.G.MERCHANTS.seeds.goods.map(good => [good, f.G.TRADE_GOODS[good].stock])) };
  b.merchantVisits = 3; b.tradeInventory.firewood = 1500; return b;
}
function trade(f, good = 'beanSeed', qty = 1, payment = 'firewood') {
  f.get('trade-good').value = good; f.get('trade-buy-quantity').value = String(qty);
  f.get('trade-payment').value = payment; f.get('trade-good').emit('input');
  return f.get('trade-exchange-form');
}
function order(f, good = 'beanSeed', qty = 1) {
  f.get('trade-order-good').value = good; f.get('trade-order-quantity').value = String(qty);
  f.get('trade-order-good').emit('input'); return f.get('trade-order-form');
}
function stepUntil(f, condition, limit = 6000) {
  for (let i = 0; i < limit && !condition(); i++) { f.G.stepCitizen(f.c, .1); f.G.ui.renderInfo(); }
  assert(condition(), 'live simulation did not reach the expected state');
}
const snapshot = f => JSON.stringify(f.G.serializeGame());
const live = (f, key) => f.info.querySelector(`[data-economy-live="${key}"]`).textContent;

test('locked beans are visible with accurate growth, lower yield and three-food-category explanation', () => {
  const f = farm(); f.select(f.b);
  assert.deepEqual(f.get('farm-crop').querySelectorAll('option').map(option => option.value), ['wheat', 'cabbage', 'beans', 'squash']);
  assert.equal(f.get('farm-crop').querySelectorAll('option').find(option => option.value === 'beans').disabled, true);
  assert.match(f.node('seeds').textContent, /早熟豆类未解锁.*贸易购买早熟豆类种子.*永久解锁.*不占仓位/);
  assert.match(f.node('timing').textContent, /本季小麦.*全田播完后成长 24 天.*秋季全熟.*每格 14 主食/);
  assert.match(f.info.textContent, /全田播完才开始成长.*早熟豆类成长 12 天.*夏、秋全熟即可正常收获/);
  assert.match(f.info.textContent, /基础每格 10 蔬菜.*低于.*14.*播种、走路、收割和送仓仍需时间/);
  assert.match(f.info.textContent, /大田或农夫不足会推迟入库.*不保证夏初.*每年只种收一季.*不能在夏季再次播种/);
  assert.match(f.info.textContent, /肉类（含鸡蛋）、蔬菜（含苹果和梨）、主食三组.*早熟豆类和耐寒瓜也计入蔬菜.*不额外增加饮食类别/);
  choose(f, 'beans'); assert.equal(f.G.farmCropOf(f.b), 'wheat'); assert.equal(f.get('farm-crop').value, 'wheat');
  assert.match(f.info.querySelector('[data-farm-message]').textContent, /未更改.*购买/);
});

test('unlock and focused drafts refresh in place, and unstarted spring or summer fields can select beans', () => {
  for (const season of [0, 1]) {
    const f = farm(), { G, b } = f; G.game.season = season; f.select(b);
    const select = f.get('farm-crop'), panel = f.info.querySelector('[data-farm-panel]'), writes = f.info.htmlWrites;
    select.focus(); select.value = 'beans'; G.game.unlocks.beans = true; G.ui.renderInfo();
    assert.equal(select.querySelectorAll('option').find(option => option.value === 'beans').disabled, false);
    assert.equal(select.value, 'beans'); assert.equal(G.cropChoiceOf(b), 'wheat');
    assert.match(f.node('seeds').textContent, /卷心菜未解锁.*早熟豆类已永久解锁/);
    choose(f, 'beans'); assert.equal(G.farmCropOf(b), 'beans');
    assert.match(f.node('current').textContent, /早熟豆类 → 蔬菜/);
    assert.match(f.node('timing').textContent, /全田播完后成长 12 天.*夏、秋全熟.*每格 10 蔬菜/);
    assert.match(f.node('plot').textContent, /成熟满收理论 640 食物/);
    assert.match(f.node('yield').textContent, /每格 10 蔬菜/);
    select.value = 'wheat'; G.game.res.vegetables = 19; G.ui.renderInfo();
    assert.equal(select.value, 'wheat'); assert.equal(G.cropChoiceOf(b), 'beans');
    assert.equal(f.info.htmlWrites, writes); assert.equal(f.info.querySelector('[data-farm-panel]'), panel);
    assert.equal(f.doc.activeElement, select); assert.match(f.node('stock').textContent, /蔬菜 19/);
    f.doc.activeElement = null; G.ui.renderInfo(); assert.equal(select.value, 'beans');
  }
});

test('pending beans never change the old crop timing, full yield, tasks or carried grain', () => {
  for (const stage of ['first-task', 'sown', 'growing', 'harvested']) {
    const f = farm(true), { G, b, c } = f;
    if (stage === 'first-task') G.requestTask(c);
    else b.farm[0].sown = true;
    if (stage === 'growing' || stage === 'harvested') { b.sownAll = true; b.growth = stage === 'growing' ? .5 : 1; b.farm.forEach(tile => { tile.sown = true; }); }
    if (stage === 'harvested') { G.game.season = 2; b.harvestDone = true; b.farm.forEach(tile => { tile.harvested = true; }); }
    c.carry = { type: 'grain', qty: 14 }; const task = c.task; f.select(b); choose(f, 'beans');
    assert.equal(G.farmCropOf(b), 'wheat'); assert.equal(G.cropChoiceOf(b), 'beans'); assert.equal(c.task, task);
    assert.equal(c.carry.type, 'grain'); assert.equal(c.carry.qty, 14);
    assert.match(f.node('current').textContent, /小麦 → 主食/);
    assert.match(f.node('choice').textContent, /早熟豆类 → 蔬菜.*下一春/);
    assert.match(f.node('timing').textContent, /小麦.*成长 24 天.*每格 14 主食/);
    assert.match(f.node('plot').textContent, /成熟满收理论 896 食物/);
  }
});

test('mature beans naturally harvest in summer and autumn without offering early harvest', () => {
  for (const season of [1, 2]) {
    const f = farm(true), { G, b } = f; grown(f); G.game.season = season; G.ui.renderInfo();
    assert.equal(G.farmHarvestReady(b), true); assert.equal(G.earlyHarvestQuote(b).ok, false);
    assert.equal(f.get('early-harvest-start').disabled, true);
    assert.doesNotMatch(f.node('status').textContent, /等待秋季|抢收/);
    assert.match(f.info.querySelector('[data-early-harvest-status]').textContent, /成熟.*正常/);
    const before = snapshot(f); f.get('early-harvest-start').click(); f.get('early-harvest-confirm').click();
    assert.equal(snapshot(f), before); assert.equal(b.earlyHarvestYield, undefined);
  }
});

test('real sowing starts growth only after the whole plot, then summer harvesting hauls lower-yield vegetables', () => {
  const f = farm(true), { G, b, c } = f; b.farm = b.farm.slice(0, 2); f.select(b); choose(f, 'beans');
  G.requestTask(c); stepUntil(f, () => b.farm.some(tile => tile.sown));
  assert.equal(b.sownAll, false); assert.equal(b.growth, 0);
  stepUntil(f, () => b.sownAll); assert.equal(b.growth, 0);
  for (let day = 0; day < 11; day++) G.endDay();
  assert(b.growth < 1); assert.equal(G.farmHarvestReady(b), false);
  G.endDay(); G.ui.renderInfo(); assert.equal(G.game.season, 1); assert.equal(b.growth, 1);
  const vegetables = G.game.res.vegetables, grain = G.game.res.grain;
  assert.equal(f.get('early-harvest-start').disabled, true); G.requestTask(c);
  stepUntil(f, () => c.carry && c.carry.type === 'vegetables'); assert.equal(G.game.res.vegetables, vegetables);
  stepUntil(f, () => b.harvestDone && !c.carry);
  assert.equal(G.game.res.vegetables, vegetables + 20); assert.equal(G.game.res.grain, grain);
  assert.match(f.node('progress').textContent, /实际收获 2\/2/); assert.match(f.node('status').textContent, /收获完成/);
  choose(f, 'wheat'); assert.equal(G.farmCropOf(b), 'beans'); assert.equal(G.cropChoiceOf(b), 'wheat');
  assert.match(f.node('choice').textContent, /小麦.*下一春/); assert.equal(G.makeTask(b, c), null);
  G.game.day = 47; G.game.season = 3; G.endDay(); G.ui.renderInfo();
  assert.equal(G.farmCropOf(b), 'wheat'); assert.equal(G.game.season, 0);
  assert.match(f.node('timing').textContent, /小麦.*成长 24 天/);
});

test('immature bean early harvest uses canonical bean and tool-adjusted quotes without instant food', () => {
  const f = farm(true), { G, b } = f; grown(f, .5);
  const q = G.earlyHarvestQuote(b); assert.equal(q.base, 5); assert.equal(q.estimated, 320); assert.equal(q.fullEstimated, 640);
  assert.equal(f.info.querySelector('[data-early-harvest-status]').textContent, G.ui.earlyHarvestText(q));
  f.get('early-harvest-start').click(); assert.equal(f.doc.activeElement, f.get('early-harvest-confirm'));
  assert.match(f.info.querySelector('[data-early-harvest-quote]').textContent, /基础每格5.*预计320 蔬菜.*全熟预计640.*不可撤回/);
  G.game.res.tools = G.game.res.steelTools = 0; G.ui.renderInfo();
  assert(f.info.querySelector('[data-early-harvest-confirm]').classList.contains('hidden'));
  assert.equal(b.earlyHarvestYield, undefined);
  const now = G.earlyHarvestQuote(b), stock = JSON.stringify(G.game.res);
  assert.equal(now.perTile, G.taskYield(5)); assert.equal(now.fullPerTile, G.taskYield(10));
  f.get('early-harvest-start').click(); f.get('early-harvest-confirm').click();
  assert.equal(b.earlyHarvestYield, 5); assert.equal(JSON.stringify(G.game.res), stock);
  assert.match(f.node('yield').textContent, new RegExp(`每格 ${now.perTile} 蔬菜`));
  assert.match(f.node('plot').textContent, /成熟满收理论 640 食物/);
});

test('a pending immature quote is cancelled when beans mature naturally in summer', () => {
  const f = farm(true), { G, b } = f; grown(f, .9); f.get('early-harvest-start').click();
  const confirm = f.get('early-harvest-confirm'); b.growth = 1; G.ui.renderInfo();
  assert(f.info.querySelector('[data-early-harvest-confirm]').classList.contains('hidden'));
  assert.equal(f.get('early-harvest-start').disabled, true); assert.equal(f.doc.activeElement.id, 'info-close');
  confirm.click(); assert.equal(b.earlyHarvestYield, undefined); assert.equal(G.farmHarvestReady(b), true);
});

test('bean seed trade quotes one permanent unlock, never adds seed inventory and refuses repeat payment', () => {
  const f = farm(), { G } = f, b = trader(f); f.select(b);
  const form = trade(f, 'beanSeed', 2), initial = b.tradeInventory.firewood;
  assert.equal(G.ui.tradeQuote(b).ok, false); assert.match(G.ui.tradeQuote(b).reason, /1份/);
  form.emit('submit'); assert.equal(b.tradeInventory.firewood, initial); assert.equal(G.game.unlocks.beans, false);
  trade(f); const quote = G.ui.tradeQuote(b); assert.equal(quote.cost, 625); assert.equal(quote.unitPrice, 2500);
  assert.match(quote.text, /永久解锁.*不可复购.*不占仓位/); form.emit('submit');
  assert.equal(G.game.unlocks.beans, true); assert.equal(b.tradeInventory.firewood, initial - 625);
  assert.equal(b.tradeInventory.beanSeed, undefined); assert.equal(G.game.res.beanSeed, undefined); assert.equal(b.merchant.stock.beanSeed, 0);
  const message = f.info.querySelector('[data-economy-message]').textContent;
  assert.match(message, /永久解锁早熟豆类.*到农田选择.*下一春.*不占仓位/); assert.doesNotMatch(message, /物资已到本站/);
  b.merchant.stock.beanSeed = 1; form.emit('submit');
  assert.equal(b.tradeInventory.firewood, initial - 625); assert.equal(b.merchant.stock.beanSeed, 1);
  assert.match(f.info.querySelector('[data-economy-message]').textContent, /已永久解锁/);
  f.select(f.b); choose(f, 'beans'); assert.equal(G.farmCropOf(f.b), 'beans');
});

test('an old current boat never gains bean stock when details refresh, while bean orders remain available', () => {
  const f = farm(), { G } = f, b = trader(f, { orchardSeed: 1, cabbageSeed: 1 }); f.select(b);
  const before = snapshot(f), writes = f.info.htmlWrites;
  assert.deepEqual(f.get('trade-order-good').querySelectorAll('option').map(option => option.value), ['orchardSeed','appleSeed','pearSeed','cabbageSeed','beanSeed','squashSeed','wheatSeed']);
  trade(f); order(f); f.get('trade-order-quantity').focus();
  for (let i = 0; i < 5; i++) G.ui.renderInfo();
  assert.equal(G.ui.tradeQuote(b).ok, false); assert.match(live(f, 'quote'), /未带|现货不足/);
  assert.equal(f.get('trade-execute').disabled, true); assert.equal(f.get('trade-order-confirm').disabled, false);
  assert.equal(snapshot(f), before); assert.equal(f.info.htmlWrites, writes); assert.equal(b.merchant.stock.beanSeed, undefined);
  assert.equal(f.doc.activeElement, f.get('trade-order-quantity')); assert.equal(f.get('trade-order-good').value, 'beanSeed');
});

test('a pending bean seed order waits for the same merchant and unlocks only after manual premium purchase', () => {
  const f = farm(), { G } = f, b = trader(f, { orchardSeed: 1 }); f.select(b);
  const initial = b.tradeInventory.firewood; order(f).emit('submit');
  assert.equal(b.merchantOrders.seeds.good, 'beanSeed'); assert.equal(b.merchantOrders.seeds.qty, 1);
  assert.equal(b.tradeInventory.firewood, initial); assert.equal(G.game.unlocks.beans, false);
  assert.match(live(f, 'merchant-order'), /待到货：早熟豆类种子 × 1.*48 天后回访.*下一艘船可能不同/);
  G.game.day = 16; G.arriveMerchant(b); G.ui.renderInfo(); assert.equal(G.merchantProfile(b).id, 'general');
  assert.match(live(f, 'merchant-orders'), /绿篱种子商.*早熟豆类种子 × 1/);
  G.game.day = 32; G.arriveMerchant(b); G.ui.renderInfo(); assert.equal(G.merchantProfile(b).id, 'supplies');
  assert.equal(b.merchantOrders.seeds.good, 'beanSeed');
  G.game.day = 48; G.arriveMerchant(b); G.ui.renderInfo(); assert.equal(G.merchantProfile(b).id, 'seeds');
  assert.equal(b.merchantOrders.seeds, undefined); assert.equal(b.merchant.stock.beanSeed, 1);
  assert.equal(b.tradeInventory.firewood, initial); assert.equal(G.game.unlocks.beans, false);
  assert.match(live(f, 'merchant-order'), /已带到早熟豆类种子.*手动确认/);
  trade(f); assert.equal(G.ui.tradeQuote(b).unitPrice, 3125); assert.equal(G.ui.tradeQuote(b).cost, 782);
  f.get('trade-exchange-form').emit('submit'); assert.equal(G.game.unlocks.beans, true);
  assert.equal(b.tradeInventory.firewood, initial - 782); assert.equal(b.tradeInventory.beanSeed, undefined);
  order(f).emit('submit'); assert.equal(b.merchantOrders.seeds, undefined); assert.match(live(f, 'order-quote'), /已永久解锁/);
});

test('bean crop callbacks reject stale world, game, panel, entity, focus owner and modal contexts', () => {
  for (const change of ['world', 'game', 'panel', 'selection', 'hidden', 'element', 'removed', 'replacement', 'site', 'modal', 'closed']) {
    const f = farm(true), { G, b } = f; f.select(b); const select = f.get('farm-crop');
    if (change === 'world') G.world = { ...G.world };
    if (change === 'game') G.game = { ...G.game };
    if (change === 'panel') { f.select(f.building('house')); f.select(b); }
    if (change === 'selection') G.sel = { kind: 'b', id: f.building('house').id };
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'element') G.ui.el.info = f.mount('replacement-info');
    if (change === 'removed') delete G.world.bmap[b.id];
    if (change === 'replacement') G.world.bmap[b.id] = { ...b };
    if (change === 'site') b.state = 'site';
    if (change === 'modal') G.hasOpenModal = () => true;
    if (change === 'closed') G.ui.hideInfo();
    select.value = 'beans'; select.emit('change');
    assert.equal(G.farmCropOf(b), 'wheat', change); assert.equal(G.cropChoiceOf(b), 'wheat', change);
  }
});

test('stale bean trade and order forms cannot spend, unlock, or create orders in replacement contexts', () => {
  for (const change of ['world', 'game', 'panel', 'hidden', 'element', 'removed', 'modal', 'boat', 'departed']) {
    const f = farm(), { G } = f, b = trader(f); f.select(b);
    const oldTrade = trade(f), oldOrder = order(f);
    if (change === 'world') G.world = { ...G.world };
    if (change === 'game') G.game = { ...G.game };
    if (change === 'panel') { f.select(f.b); f.select(b); }
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'element') G.ui.el.info = f.mount('replacement-info');
    if (change === 'removed') delete G.world.bmap[b.id];
    if (change === 'modal') G.hasOpenModal = () => true;
    if (change === 'boat') b.merchant = { ...b.merchant, stock: { beanSeed: 1 } };
    if (change === 'departed') b.merchant.leaveDay = G.game.day;
    oldTrade.emit('submit'); oldOrder.emit('submit');
    assert.equal(b.tradeInventory.firewood, 1500, change); assert.equal(G.game.unlocks.beans, false, change);
    assert.equal(b.merchantOrders.seeds, undefined, change);
  }
});

test('beans alone provide a valid rotation while cabbage stays locked, without curing this season', () => {
  const f = farm(), { G, b, c } = f; b.sownAll = true; b.growth = .5; b.farm.forEach(tile => { tile.sown = true; });
  G.game.day = 12; G.game.season = 1; b.lastPestCrop = 'wheat';
  G.setFarmPests(true); b.pestInfestation = { crop: 'wheat', startedDay: 12 }; f.select(b);
  assert.match(f.node('rotation').textContent, /卷心菜未解锁.*早熟豆类未解锁.*贸易站购买种子/);
  G.game.unlocks.beans = true; G.ui.renderInfo(); assert.equal(G.game.unlocks.cabbage, false);
  assert.equal(G.farmPestSummary(b).rotationAvailable, true);
  assert.match(f.node('rotation').textContent, /可用上方作物选择安排不同于本季小麦/);
  assert.doesNotMatch(f.node('rotation').textContent, /购买种子后才能/);
  const pest = b.pestInfestation; choose(f, 'beans');
  assert.match(f.node('rotation').textContent, /已选下一春种早熟豆类.*本季仍是小麦.*当前虫害不会因改选消失/);
  assert.equal(b.pestInfestation, pest); assert.equal(b.lastPestCrop, 'wheat');
  G.game.day = 47; G.game.season = 3; G.endDay(); G.game.h = 12; G.ui.renderInfo();
  assert.equal(G.farmCropOf(b), 'beans'); assert.equal(b.lastPestCrop, 'wheat');
  assert.equal(G.farmPestSummary(b).rotationAvailable, true, 'free wheat remains an alternative to beans');
  G.requestTask(c); stepUntil(f, () => b.farm.some(tile => tile.sown));
  assert.equal(b.lastPestCrop, undefined); assert.equal(G.farmPestSummary(b).recurrence, false);
});

test('loaded bean choices preserve current crops and cargo, and live reads remain side-effect free', () => {
  const f = farm(true), { G, b, c } = f; G.requestTask(c); G.setFarmCrop(b, 'beans'); c.carry = { type: 'grain', qty: 14 };
  const data = JSON.parse(JSON.stringify(G.serializeGame())), restored = G.prepareSaveData(data);
  G.world = restored.world; G.game = restored.game; const loaded = G.world.bmap[b.id]; f.select(loaded);
  assert.match(f.node('current').textContent, /小麦 → 主食/); assert.match(f.node('choice').textContent, /早熟豆类 → 蔬菜.*下一春/);
  assert.match(f.node('timing').textContent, /成长 24 天/); assert.equal(G.world.cmap[c.id].carry.type, 'grain');
  const select = f.get('farm-crop'), writes = f.info.htmlWrites; select.focus(); select.value = 'wheat';
  const before = snapshot(f); for (let i = 0; i < 6; i++) { G.ui.farmInfoData(loaded); G.ui.renderInfo(); }
  assert.equal(snapshot(f), before); assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, select);
  assert.equal(select.value, 'wheat'); assert.equal(G.cropChoiceOf(loaded), 'beans');
  delete data.game.unlocks.beans; for (const record of data.buildings) if (record.type === 'farm') { delete record.cropChoice; delete record.cropType; }
  const legacy = G.prepareSaveData(data); G.world = legacy.world; G.game = legacy.game; f.select(G.world.bmap[b.id]);
  assert.equal(G.game.unlocks.beans, false); assert.match(f.node('seeds').textContent, /早熟豆类未解锁/);
  assert.match(f.node('current').textContent, /小麦/); assert.equal(G.world.cmap[c.id].carry.qty, 14);
});

console.log(`Early beans UI: ${passed} DOM and live-simulation suites passed (not browser/mobile visual acceptance).`);
