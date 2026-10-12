/* Distinct fruit trees, real fruit brewing and six-item/three-group food UI.
 * These are DOM/live-simulation contracts, not browser/mobile visual acceptance. */
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
      emit(type, detail = 1) {
        const event = { target: this, ...(typeof detail === 'object' ? detail : { detail }), defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; } };
        for (const fn of handlers[type] || []) fn(event);
        return event;
      },
      click(detail = 1) { if (roots.some(root => root.contains(this))) this.focus(); for (const fn of handlers.click || []) fn({ target: this, detail }); },
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
  for (const name of ['core', 'defs', 'map', 'sim', 'fire', 'supply', 'ui', 'main'])
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
const input = (f, id) => f.info.querySelector('#' + id);
const live = (f, id) => f.info.querySelector(`[data-economy-live="${id}"]`).textContent;
const tavernLive = (f, id) => f.info.querySelector(`[data-tavern="${id}"]`).textContent;
const message = f => f.info.querySelector('[data-economy-message]').textContent;
const syncFood = G => { G.game.res.food = G.FOOD_KEYS.reduce((n, type) => n + (G.game.res[type] || 0), 0); };
function orchard() {
  const f = fixture(); f.b = f.building('orchard', { orchardTrees: f.G.newOrchardTrees() }); f.building('storage');
  f.G.game.h = 12; f.select(f.b); return f;
}
function chooseOrchard(f, type) { input(f, 'orchard-type').value = type; input(f, 'orchard-type-form').emit('submit'); }
function brewery() {
  const f = fixture(), { G } = f; f.b = f.building('tavern'); f.store = f.building('storage');
  G.game.h = 12; for (const key of G.FOOD_KEYS) G.game.res[key] = 0;
  Object.assign(G.game.res, { grain: 150, apples: 90, pears: 60, vegetables: 500, ale: 0 }); syncFood(G);
  f.c = G.spawnCitizen({ x: f.store.x - 1, y: f.store.y, age: 30, sex: 'm' }); f.c.name = '酿酒工<甲>';
  f.c.job = f.b.id; f.c.state = 'idle'; f.b.workers = [f.c.id]; f.select(f.b); return f;
}
function chooseRecipe(f, type) { input(f, 'tavern-recipe').value = type; input(f, 'tavern-recipe-form').emit('submit'); }
function merchant(f, id = 'general') {
  const b = f.building('tradingpost');
  b.merchant = { id, arrivedDay: 0, leaveDay: 12, stock: { appleSeed: 1, pearSeed: 1, orchardSeed: 1, apples: 100, pears: 100 } };
  b.tradeInventory = { firewood: 1800 }; f.select(b); return b;
}
function exchange(f, good, qty = 1, payment = 'firewood') {
  input(f, 'trade-good').value = good; input(f, 'trade-buy-quantity').value = qty;
  input(f, 'trade-payment').value = payment; f.G.ui.refreshEconomyInfo(f.G.world.bmap[f.G.sel.id]);
  input(f, 'trade-exchange-form').emit('submit');
}
function stale(f, mode, control) {
  if (mode === 'selection') f.select(f.building('house'));
  if (mode === 'dom') { f.G.ui._infoWorld = null; f.G.ui.renderInfo(true); }
  if (mode === 'hidden') f.info.classList.add('hidden');
  if (mode === 'modal') f.G.hasOpenModal = () => true;
  if (mode === 'world') f.G.world = { ...f.G.world };
  if (mode === 'game') f.G.game = { ...f.G.game };
  if (mode === 'element') f.G.ui.el.info = f.mount('replacement-info');
  if (mode === 'removed') delete f.G.world.bmap[f.b.id];
  if (mode === 'replacement') f.G.world.bmap[f.b.id] = { ...f.b };
  if (mode === 'site') f.b.state = 'site';
  if (mode === 'type') f.b.type = 'house';
  if (mode === 'closed') f.G.ui.hideInfo();
  if (mode === 'control') control.id = 'detached-old-control';
}
const staleModes = ['selection', 'dom', 'hidden', 'modal', 'world', 'game', 'element', 'removed', 'replacement', 'site', 'type', 'closed', 'control'];

test('orchard names three separately locked varieties and never silently applies an unlocked choice', () => {
  const f = orchard(), { G } = f;
  assert.equal(G.orchardTypeOf(f.b), 'legacy');
  assert.equal(input(f, 'orchard-type').value, 'legacy');
  assert(input(f, 'orchard-type').querySelectorAll('option').every(o => o.disabled));
  chooseOrchard(f, 'apple'); assert.equal(G.orchardTypeOf(f.b), 'legacy'); assert.match(message(f), /先在贸易站购买/);
  G.game.unlocks.apple = true; G.ui.refreshEconomyInfo(f.b);
  assert.equal(G.game.unlocks.orchard, false); assert.equal(G.orchardTypeOf(f.b), 'legacy');
  assert(!input(f, 'orchard-type').querySelectorAll('option').find(o => o.value === 'apple').disabled);
  input(f, 'orchard-type').value = 'apple'; assert.equal(G.orchardTypeOf(f.b), 'legacy');
  input(f, 'orchard-type-form').emit('submit'); assert.equal(G.orchardTypeOf(f.b), 'apple');
  assert.match(live(f, 'orchard-selection'), /已应用以后种植：苹果 → 苹果/);
  assert.match(f.info.textContent, /苹果和梨种子各2500.*买新果种不必先买通用种子/);
  assert.match(f.info.textContent, /旧通用果树种子仅解锁旧通用树.*不赠苹果、梨/);
});

test('mature legacy trees, pending fruit and carried old produce retain their identity after new selection', () => {
  const f = orchard(), { G } = f; Object.assign(G.game.unlocks, { orchard: true, apple: true });
  Object.assign(f.b.orchardTrees[0], { type: 'legacy', planted: true, age: G.YEAR_DAYS * 7, fruit: 14, season: G.game.year });
  G.syncOrchardTotals(f.b); const before = JSON.stringify(f.b.orchardTrees);
  const c = G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm' }); c.name = '旧果运输'; c.carry = { type: 'vegetables', qty: 6, orchardId: f.b.id }; c.state = 'haul';
  chooseOrchard(f, 'apple'); assert.equal(JSON.stringify(f.b.orchardTrees), before);
  assert.equal(c.carry.type, 'vegetables'); assert.equal(c.carry.qty, 6);
  assert.match(live(f, 'orchard-types'), /旧通用果树 1株 · 待采蔬菜 14.*苹果 0株/);
  assert.match(live(f, 'orchard-trees'), /第1株：旧通用果树 · 树龄 7.0 年.*待采蔬菜 14/);
  assert.match(live(f, 'orchard-logistics'), /旧果运输：蔬菜 6.*尚未入库/);
  assert.match(f.info.querySelector('[data-orchard-output]').textContent, /苹果.*蔬菜/);
});

test('mixed orchard reports independent actual tree counts and fractional fruit, while preserving draft and focus', () => {
  const f = orchard(), { G } = f; Object.assign(G.game.unlocks, { orchard: true, apple: true, pear: true });
  for (const [i, type, fruit] of [[0, 'legacy', 4], [1, 'apple', 7.5], [2, 'pear', 9]]) Object.assign(f.b.orchardTrees[i], { type, planted: true, age: G.ORCHARD.matureDays, fruit });
  G.syncOrchardTotals(f.b); G.ui.refreshEconomyInfo(f.b);
  const select = input(f, 'orchard-type'), writes = f.info.htmlWrites; select.value = 'pear'; select.focus();
  G.ui.renderInfo(); G.ui.refreshEconomyInfo(f.b);
  assert.equal(input(f, 'orchard-type'), select); assert.equal(select.value, 'pear'); assert.equal(f.doc.activeElement, select);
  assert.equal(f.info.htmlWrites, writes); assert.equal(G.orchardTypeOf(f.b), 'legacy');
  assert.match(live(f, 'orchard-types'), /旧通用果树 1株 · 待采蔬菜 4.*苹果 1株 · 待采苹果 7.5.*梨 1株 · 待采梨 9/);
  assert.match(live(f, 'orchard-harvest'), /合计 20.5/);
  input(f, 'orchard-type-cancel').click(); assert.equal(select.value, 'legacy'); assert.equal(f.doc.activeElement, select);
  assert.equal(G.orchardTypeOf(f.b), 'legacy'); assert.equal(f.b.orchardTrees[1].fruit, 7.5);
});

test('new variety forms reject stale events and repeated activation never reapplies a successful choice', () => {
  for (const mode of staleModes) {
    const f = orchard(); f.G.game.unlocks.apple = true; input(f, 'orchard-type').value = 'apple';
    const form = input(f, 'orchard-type-form'); let calls = 0; f.G.setOrchardType = () => { calls++; return true; };
    stale(f, mode, form); form.emit('submit'); assert.equal(calls, 0, mode);
  }
  const f = orchard(); f.G.game.unlocks.apple = true; let calls = 0; const set = f.G.setOrchardType;
  f.G.setOrchardType = (...args) => { calls++; return set(...args); };
  chooseOrchard(f, 'apple'); input(f, 'orchard-type-form').emit('submit'); assert.equal(calls, 1);
  for (const id of ['orchard-type-form', 'orchard-type', 'orchard-type-apply', 'orchard-type-cancel']) for (const key of ['Enter', ' ']) {
    const event = input(f, id).emit('keydown', { key, repeat: true }); assert(event.defaultPrevented, id + key);
  }
});

test('apple and pear seed purchases each cost 2500, unlock only themselves, and repeated purchase cannot double-charge', () => {
  const f = orchard(), b = merchant(f), { G } = f;
  for (const [good, unlock] of [['appleSeed', 'apple'], ['pearSeed', 'pear']]) {
    assert.equal(G.TRADE_GOODS[good].price, 2500); const paid = b.tradeInventory.firewood;
    exchange(f, good); assert.equal(G.game.unlocks[unlock], true); assert.equal(b.tradeInventory.firewood, paid - 625);
    assert.match(message(f), /已永久解锁.*果园明确选择.*已有树和在途果实保留/);
    const after = b.tradeInventory.firewood; exchange(f, good); assert.equal(b.tradeInventory.firewood, after);
    assert.equal(b.tradeInventory[good], undefined);
  }
  assert.equal(G.game.unlocks.orchard, false); assert.equal(G.orchardTypeOf(f.b), 'legacy');
  assert.equal(G.game.res.apples, 0); assert.equal(G.game.res.pears, 0);
});

test('legacy seed only unlocks generic trees and fruit purchases remain station stock until transported', () => {
  const f = orchard(), b = merchant(f), { G } = f;
  exchange(f, 'orchardSeed'); assert.equal(G.game.unlocks.orchard, true); assert.equal(G.game.unlocks.apple, false); assert.equal(G.game.unlocks.pear, false);
  assert.match(message(f), /旧通用果树/);
  const before = G.game.res.food; exchange(f, 'apples', 20); exchange(f, 'pears', 12);
  assert.equal(b.tradeInventory.apples, 20); assert.equal(b.tradeInventory.pears, 12);
  assert.equal(G.game.res.apples, 0); assert.equal(G.game.res.pears, 0); assert.equal(G.game.res.food, before);
  assert.match(live(f, 'inventory'), /苹果：待售 20.*梨：待售 12/s);
  input(f, 'trade-target-resource').value = 'apples'; input(f, 'trade-target-quantity').value = '17'; input(f, 'trade-target-form').emit('submit');
  assert.equal(b.tradeTargets.apples, 17); assert(!b.tradeTargets.pears);
  const reject = merchant(f, 'supplies'); assert.equal(G.merchantAccepts(reject, 'apples'), false); assert.equal(G.merchantAccepts(reject, 'pears'), false);
  assert.match(live(f, 'merchant-payments'), /拒收食物：.*苹果、梨/);
});

test('six independent food HUD values and actual diet grouping retain three nutrition groups', () => {
  const f = orchard(), { G } = f; assert.equal(G.FOOD_KEYS.length, 6);
  for (const type of G.FOOD_KEYS) G.game.res[type] = 0;
  Object.assign(G.game.res, { vegetables: 3, apples: 7, pears: 11 }); syncFood(G);
  G.ui.refreshHUD(); G.ui.refreshGuide(); assert.match(f.guide.textContent, /营养组 1\/3/);
  for (const type of ['apples', 'pears']) { const el = f.doc.getElementById('res-' + type); assert.equal(el.querySelector('b').textContent, String(G.game.res[type])); assert.match(el.title, /独立库存与生产目标.*营养归蔬菜组/); }
  assert.match(f.doc.getElementById('res-food').title, /苹果 7.*梨 11/); assert.equal(f.doc.getElementById('res-food').querySelector('b').textContent, '21');
  Object.assign(G.game.res, { meat: 5, eggs: 6, grain: 4 }); syncFood(G); G.ui.refreshGuide(); assert.match(f.guide.textContent, /营养组 3\/3/);
  assert.match(G.ui.healthSummaryMarkup(), /蔬菜含苹果和梨/);
});

test('fruit production goals and ledger show independent stocks and shared total without a fourth nutrition group', () => {
  const f = orchard(), { G } = f; f.mount('production-goals');
  for (const key of ['food', 'apples', 'pears']) { f.mount('goal-stock-' + key); f.mount('goal-status-' + key); }
  G.setProductionGoal('apples', 0); G.ui.refreshProductionGoals();
  assert.match(f.doc.getElementById('goal-status-apples').textContent, /关闭新自动生产.*总食物.*独立果品目标.*仍为三组/);
  assert.equal(G.productionGoalOf('pears'), null);
  G.setProductionGoal('apples', G.storageCap('apples') + 1); G.ui.refreshProductionGoals();
  assert.match(f.doc.getElementById('goal-status-apples').textContent, /随身已有果实保留.*树上未采果仍受冬损与枯尽/);
  G.ledgerRecord('produced', 'apples', 7); G.ledgerRecord('produced', 'pears', 11);
  const data = G.ui.townLedgerInfoData(), html = G.ui.townLedgerInfoMarkup(data);
  assert.equal(data['flow-apples-current-produced'], '7'); assert.equal(data['flow-pears-current-produced'], '11'); assert.equal(data['flow-food-current-produced'], '18');
  assert.match(html, /flow-apples-recent-produced/); assert.match(html, /flow-pears-current-produced/);
  assert.match(html, /六种物品之和.*苹果和梨归蔬菜组.*仍为三组营养/);
});

test('physical household and market panels list real delivered apples and pears separately from public food', () => {
  const f = orchard(), { G } = f, home = f.building('house'); f.resident(home); G.game.supplyMode = 'physical';
  const market = f.building('market'); Object.assign(G.game.res, { apples: 40, pears: 30 }); syncFood(G);
  for (const [target, type, qty] of [[home, 'apples', 7], [home, 'pears', 4], [market, 'apples', 9], [market, 'pears', 6]]) { assert.equal(G.withdrawResource(type, qty), qty); G.supplyStock(target)[type] = qty; }
  f.select(home); assert.match(f.info.querySelector('[data-household-supply="stock"]').textContent, /苹果 7.*梨 4/);
  assert.match(f.info.querySelector('[data-household-supply="incoming"]').textContent, /苹果 0.*梨 0/);
  f.select(market); assert.match(f.info.querySelector('[data-market-supply="stock"]').textContent, /苹果 9.*梨 6/);
  G.ui.refreshHUD(); assert.match(f.doc.getElementById('res-apples').title, /公共库存.*苹果：24.*全村苹果 40/);
  assert.match(G.ui.villageSupplyInfoData().homes, /苹果 7.*梨 4/);
});

test('tavern offers three explicit next-batch recipes without requiring seed ownership or permitting vegetables', () => {
  const f = brewery(), { G } = f;
  assert.equal(G.tavernRecipeOf(f.b), 'grain'); assert.match(tavernLive(f, 'recipe'), /30 主食 → 3 麦酒（受教育 4）.*6 小时/);
  assert.deepEqual(input(f, 'tavern-recipe').querySelectorAll('option').map(o => o.value), ['grain', 'apples', 'pears']);
  chooseRecipe(f, 'apples'); assert.equal(G.tavernRecipeOf(f.b), 'apples'); assert.equal(G.game.unlocks.apple, false);
  assert.match(tavernLive(f, 'recipe'), /30 苹果 → 10 麦酒（受教育 10）/);
  assert.match(tavernLive(f, 'stock'), /主食 150.*苹果 90.*梨 60/);
  chooseRecipe(f, 'vegetables'); assert.equal(G.tavernRecipeOf(f.b), 'apples');
  assert.match(f.info.querySelector('[data-tavern-message]').textContent, /配方未更改/);
  assert.match(f.info.textContent, /通用蔬菜与旧果园的蔬菜不能酿酒/);
  assert.match(f.info.textContent, /六种食物物品仍为三组营养/);
});

test('accepted fruit fetching, carried batch and delivered ale are never relabeled by a future recipe change', () => {
  const f = brewery(), { G, c, b } = f; chooseRecipe(f, 'apples');
  const task = G.makeTavernTask(b, c); assert(task); assert.equal(task.recipe.key, 'apples');
  c.task = task; c.state = 'walk'; chooseRecipe(f, 'pears');
  assert.match(tavernLive(f, 'recipe'), /30 梨 → 10/); assert.match(tavernLive(f, 'batches'), /已接苹果批次.*30 苹果 → 10.*尚未出库/);
  assert.match(G.ui.citizenStatus(c), /取酿酒苹果/);
  c.x = task.tx; c.y = task.ty; c.state = 'work'; G.completeBrew(c, task);
  assert.equal(c.carry.type, 'apples'); assert.equal(c.carry.qty, 30); assert.equal(G.game.res.apples, 60); assert.equal(G.game.res.pears, 60);
  G.ui.refreshTavernInfo(b); assert.match(tavernLive(f, 'batches'), /苹果 30 已出库.*本批仍产 10/);
  assert.match(G.ui.citizenStatus(c), /搬运酿酒苹果/);
  chooseRecipe(f, 'grain'); c.pausedTask = c.task; c.task = null; G.ui.refreshTavernInfo(b);
  assert.match(tavernLive(f, 'batches'), /苹果 30.*夜间暂停.*10 麦酒/);
  c.task = c.pausedTask; c.pausedTask = null; c.x = c.task.tx; c.y = c.task.ty; c.state = 'work'; G.completeBrew(c, c.task);
  assert.equal(c.carry.type, 'ale'); assert.equal(c.carry.qty, 10); G.ui.refreshTavernInfo(b);
  assert.match(tavernLive(f, 'batches'), /已酿麦酒 10.*尚不可使用/);
  assert(!/已接.*批次/.test(tavernLive(f, 'batches'))); assert.match(f.info.innerHTML, /酿酒工&lt;甲&gt;/);
});

test('returning unbrewed fruit is described as actual refundable cargo, without promised ale', () => {
  const f = brewery(), { G } = f;
  f.c.carry = { type: 'pears', qty: 30, brewIngredient: true }; f.c.state = 'haul'; f.c.task = null;
  G.ui.refreshTavernInfo(f.b); assert.match(tavernLive(f, 'batches'), /梨 30 已出库.*退回仓库.*尚未消耗/);
  assert(!/本批仍产/.test(tavernLive(f, 'batches'))); assert.match(G.ui.citizenStatus(f.c), /酿酒梨.*退回仓库/);
});

test('next-batch recipe draft, focus and mounted controls survive live refresh; cancel restores actual selection', () => {
  const f = brewery(), { G } = f, select = input(f, 'tavern-recipe'); select.value = 'pears'; select.focus();
  const writes = f.info.htmlWrites; G.game.res.apples = 50; syncFood(G); G.ui.renderInfo(); G.ui.refreshTavernInfo(f.b);
  assert.equal(input(f, 'tavern-recipe'), select); assert.equal(select.value, 'pears'); assert.equal(f.doc.activeElement, select); assert.equal(f.info.htmlWrites, writes);
  assert.equal(G.tavernRecipeOf(f.b), 'grain'); assert.match(tavernLive(f, 'stock'), /苹果 50/);
  input(f, 'tavern-recipe-cancel').click(); assert.equal(select.value, 'grain'); assert.equal(f.doc.activeElement, select);
});

test('recipe forms reject every stale callback and repeat key activation while successful resubmission is idempotent', () => {
  for (const mode of staleModes) {
    const f = brewery(), form = input(f, 'tavern-recipe-form'); input(f, 'tavern-recipe').value = 'apples';
    let calls = 0; f.G.setTavernRecipe = () => { calls++; return true; }; stale(f, mode, form);
    form.emit('submit'); assert.equal(calls, 0, mode);
  }
  const f = brewery(); let calls = 0; const set = f.G.setTavernRecipe;
  f.G.setTavernRecipe = (...args) => { calls++; return set(...args); };
  chooseRecipe(f, 'pears'); input(f, 'tavern-recipe-form').emit('submit'); assert.equal(calls, 1);
  for (const id of ['tavern-recipe-form', 'tavern-recipe', 'tavern-recipe-apply', 'tavern-recipe-cancel']) for (const key of ['Enter', ' ']) {
    const event = input(f, id).emit('keydown', { key, repeat: true }); assert(event.defaultPrevented, id + key);
  }
});

test('fruit shortage and food reserve remain distinct, and existing ale service stays independent', () => {
  const f = brewery(), { G } = f; chooseRecipe(f, 'pears'); G.game.res.pears = 20; syncFood(G); G.ui.refreshTavernInfo(f.b);
  assert.match(tavernLive(f, 'status'), /梨不足/); assert.match(tavernLive(f, 'afterBatch'), /30 梨/);
  for (const key of G.FOOD_KEYS) G.game.res[key] = 0; G.game.res.pears = 30; syncFood(G); G.ui.refreshTavernInfo(f.b);
  assert.match(tavernLive(f, 'status'), /不足全村12天口粮/);
  const spot = G.workSpot(G.world, f.b, f.c.x, f.c.y); f.c.x = spot.x; f.c.y = spot.y; f.c.task = { kind: 'host', b: f.b }; f.c.state = 'work'; G.game.res.ale = 2;
  G.ui.refreshTavernInfo(f.b); assert.match(tavernLive(f, 'service'), /可接待/);
});

test('cancel callbacks from dismissed fruit and recipe panels cannot overwrite newer drafts or steal focus', () => {
  for (const setup of [orchard, brewery]) for (const mode of staleModes) {
    const f = setup(), orchardPanel = f.b.type === 'orchard', id = orchardPanel ? 'orchard-type' : 'tavern-recipe';
    const cancel = input(f, id + '-cancel'), select = input(f, id); select.value = orchardPanel ? 'pear' : 'pears';
    stale(f, mode, cancel); const focus = f.doc.activeElement;
    cancel.emit('click'); assert.equal(select.value, orchardPanel ? 'pear' : 'pears', id + mode);
    assert.equal(f.doc.activeElement, focus, id + mode);
  }
});

test('repeat keypress cannot submit either next-choice form before a fresh activation', () => {
  for (const setup of [orchard, brewery]) {
    const f = setup(), orchardPanel = f.b.type === 'orchard', id = orchardPanel ? 'orchard-type' : 'tavern-recipe';
    if (orchardPanel) f.G.game.unlocks.apple = true;
    input(f, id).value = orchardPanel ? 'apple' : 'apples';
    input(f, id + '-form').emit('submit', { repeat: true });
    assert.equal(orchardPanel ? f.G.orchardTypeOf(f.b) : f.G.tavernRecipeOf(f.b), orchardPanel ? 'legacy' : 'grain');
    for (const key of ['Enter', ' ']) assert(!input(f, id + '-apply').emit('keydown', { key, repeat: false }).defaultPrevented);
    input(f, id + '-form').emit('submit');
    assert.equal(orchardPanel ? f.G.orchardTypeOf(f.b) : f.G.tavernRecipeOf(f.b), orchardPanel ? 'apple' : 'apples');
  }
});

console.log(`${passed} fruit/brewing UI contracts passed (DOM/live APIs; not browser or mobile visual acceptance).`);
