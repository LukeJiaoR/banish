/* Chicken pasture, independent egg inventory and three nutrition groups.
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
      emit(type, detail = 1) { for (const fn of handlers[type] || []) fn({target: this, detail, preventDefault() {}}); },
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
const input = (f, id) => f.info.querySelector('#' + id);
const live = (f, id) => f.info.querySelector(`[data-economy-live="${id}"]`).textContent;
const message = f => f.info.querySelector('[data-economy-message]').textContent;
function choose(f, type) {
  input(f, 'pasture-type').focus(); input(f, 'pasture-type').value = type;
  input(f, 'pasture-type-form').emit('submit');
}
function stock(f, qty) { input(f, 'pasture-stock-quantity').value = qty; input(f, 'pasture-stock-form').emit('submit'); }
function target(f, qty) { input(f, 'pasture-target-quantity').value = qty; input(f, 'pasture-target-form').emit('submit'); }
function setup(chicken = true) {
  const f = fixture(); f.b = f.building('pasture'); f.building('storage');
  f.G.game.h = 12;
  for (const key of f.G.FOOD_KEYS) f.G.game.res[key] = 0;
  f.G.game.res.food = f.G.game.res.grain = 100;
  f.G.game.livestock = { sheep: 4, cattle: 4, chicken: 4 };
  f.select(f.b); if (chicken) choose(f, 'chicken');
  return f;
}
function merchant(f, id = 'general') {
  const b = f.building('tradingpost');
  b.merchant = { id, arrivedDay: 0, leaveDay: 12, stock: { chicken: 4, eggs: 200, meat: 200 } };
  b.tradeInventory = { firewood: 400 }; f.select(b); return b;
}
function exchange(f, good, qty, payment = 'firewood') {
  input(f, 'trade-good').value = good; input(f, 'trade-buy-quantity').value = qty;
  input(f, 'trade-payment').value = payment; f.G.ui.refreshEconomyInfo(f.G.world.bmap[f.G.sel.id]);
  input(f, 'trade-exchange-form').emit('submit');
}

test('chicken choice applies explicitly, has capacity 24 and default retention 8, and names independent outputs', () => {
  const f = setup(false), select = input(f, 'pasture-type');
  assert(select.querySelectorAll('option').some(o => o.value === 'chicken' && /鸡蛋、肉/.test(o.textContent)));
  select.value = 'chicken'; assert.equal(f.G.pastureTypeOf(f.b), 'sheep');
  choose(f, 'chicken'); assert.equal(f.G.pastureTypeOf(f.b), 'chicken');
  assert.match(live(f, 'animals'), /鸡群 0\/24 只.*保留 8 只/);
  assert.equal(input(f, 'pasture-stock-quantity').max, '24');
  assert.equal(input(f, 'pasture-target-quantity').max, '24');
  assert.match(live(f, 'pasture-rule'), /0\.5.*96.*20.*6肉/);
  assert.match(f.info.textContent, /6×6.*24只.*保留8只/);
  const outputs = f.info.querySelector('[data-pasture-output]').textContent;
  assert.match(outputs, /肉类.*鸡蛋/); assert(!/羊毛|皮革/.test(outputs));
  assert.match(live(f, 'sheep-bank'), /羊 4 · 牛 4 · 鸡 4/);
});

test('stocking spends only chicken bank, refuses mixing, and repeated exhausted stocking cannot duplicate birds', () => {
  const f = setup(); stock(f, 4); stock(f, 4);
  assert.equal(f.b.animals, 4); assert.equal(f.G.game.livestock.chicken, 0);
  assert.equal(f.G.game.livestock.sheep, 4); assert.equal(f.G.game.livestock.cattle, 4);
  assert(input(f, 'pasture-stock').disabled); assert(input(f, 'pasture-type-apply').disabled);
  choose(f, 'cattle'); assert.equal(f.G.pastureTypeOf(f.b), 'chicken');
  assert.match(live(f, 'pasture-switch'), /禁止混养/);
});

test('retention accepts 2 through 24 but rejects fractions, blanks and outside values; other species retain their caps', () => {
  const f = setup();
  for (const invalid of [1, 25, 2.5, '', -1]) {
    target(f, invalid); assert.equal(f.b.animalTarget, 8); assert.match(message(f), /2–24/);
  }
  target(f, 24); assert.equal(f.b.animalTarget, 24); assert.match(message(f), /24 只/);
  target(f, 2); assert.equal(f.b.animalTarget, 2);
  choose(f, 'cattle'); assert.equal(input(f, 'pasture-target-quantity').max, '10');
  choose(f, 'sheep'); assert.equal(input(f, 'pasture-target-quantity').max, '12');
});

test('live eggs, fractional progress and meat are separate from incoming cargo and public stock', () => {
  const f = setup(); f.b.animals = 8; f.b.animalGrowth = .6; f.b.eggProgress = .5;
  f.b.pastureProducts = { eggs: 17, meat: 6, leather: 0 };
  const c = f.G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm', name: '送蛋牧人' });
  c.name = '送蛋牧人'; c.carry = { type: 'eggs', qty: 20, pastureId: f.b.id }; c.state = 'haul';
  f.G.ui.refreshEconomyInfo(f.b);
  assert.match(live(f, 'pasture-production'), /繁殖进度 60%.*待取鸡蛋 17 \/ 96.*未成蛋进度 50%.*肉 6/);
  assert(!/皮革/.test(live(f, 'pasture-production')));
  assert.match(live(f, 'pasture-logistics'), /20枚.*满仓保留.*送蛋牧人：鸡蛋 20.*未入库/);
  assert.equal(f.G.game.res.eggs, 0); assert.equal(f.G.game.res.meat, 0);
  assert.match(live(f, 'pasture-stock'), /鸡蛋 0.*肉类 0.*不含场内与在途.*鸡蛋目标/);
  assert.equal(f.G.ui.citizenStatus(c).includes('鸡蛋'), true);
  assert(!f.G.ui.citizenStatus(c).includes('鸡肉'));
});

test('pending eggs visibly prevent species switching without discarding the original birds or produce', () => {
  const f = setup(); f.b.pastureProducts = { eggs: 9, meat: 0, leather: 0 };
  f.G.ui.refreshEconomyInfo(f.b); assert(input(f, 'pasture-type-apply').disabled);
  choose(f, 'sheep'); assert.equal(f.G.pastureTypeOf(f.b), 'chicken'); assert.equal(f.b.pastureProducts.eggs, 9);
  assert.match(live(f, 'pasture-switch'), /产物/);
});

test('typed retention, unsubmitted species choice and focus survive routine refresh without writes or implicit apply', () => {
  const f = setup(), field = input(f, 'pasture-target-quantity'), type = input(f, 'pasture-type');
  field.value = '23'; field.focus(); type.value = 'cattle'; const writes = f.info.htmlWrites;
  f.b.animals = 7; f.b.eggProgress = .5; f.b.pastureProducts.eggs = 3;
  f.G.ui.renderInfo(); f.G.ui.refreshEconomyInfo(f.b);
  assert.equal(input(f, 'pasture-target-quantity'), field); assert.equal(f.doc.activeElement, field);
  assert.equal(field.value, '23'); assert.equal(type.value, 'cattle'); assert.equal(f.b.animalTarget, 8);
  assert.equal(f.G.pastureTypeOf(f.b), 'chicken'); assert.equal(f.info.htmlWrites, writes);
  assert.match(live(f, 'pasture-production'), /待取鸡蛋 3/);
  input(f, 'pasture-target-form').emit('submit'); assert.equal(f.b.animalTarget, 23);
});

test('stale chicken forms cannot stock, switch or change targets after navigation, replacement, closure or a modal', () => {
  for (const mode of ['selection', 'dom', 'hidden', 'modal', 'world', 'game', 'element', 'removed', 'replacement', 'site', 'closed']) {
    const f = setup(), stockForm = input(f, 'pasture-stock-form'), typeForm = input(f, 'pasture-type-form'), targetForm = input(f, 'pasture-target-form');
    input(f, 'pasture-stock-quantity').value = 2; input(f, 'pasture-type').value = 'cattle'; input(f, 'pasture-target-quantity').value = 24;
    let calls = 0; for (const key of ['stockPasture', 'setPastureType', 'setPastureTarget']) f.G[key] = () => { calls++; return true; };
    if (mode === 'selection') f.select(f.building('pasture'));
    if (mode === 'dom') { f.G.ui._infoWorld = null; f.G.ui.renderInfo(true); }
    if (mode === 'hidden') f.info.classList.add('hidden');
    if (mode === 'modal') f.G.hasOpenModal = () => true;
    if (mode === 'world') f.G.world = { ...f.G.world };
    if (mode === 'game') f.G.game = { ...f.G.game };
    if (mode === 'element') f.G.ui.el.info = f.mount('replacement-info');
    if (mode === 'removed') delete f.G.world.bmap[f.b.id];
    if (mode === 'replacement') f.G.world.bmap[f.b.id] = { ...f.b };
    if (mode === 'site') f.b.state = 'site';
    if (mode === 'closed') f.G.ui.hideInfo();
    stockForm.emit('submit'); typeForm.emit('submit'); targetForm.emit('submit');
    assert.equal(calls, 0, mode); assert.equal(f.b.animals, 0, mode); assert.equal(f.b.animalTarget, 8, mode);
  }
});

test('ten-chicken split preview explains eggs stay, cancel restores focus, and repeat confirmation cannot duplicate animals', () => {
  const f = setup(), destination = f.building('pasture', { animalType: 'chicken' });
  f.b.animals = 10; f.b.eggProgress = .5; f.b.pastureProducts = { eggs: 12, meat: 6, leather: 0 };
  f.G.ui.refreshEconomyInfo(f.b);
  const start = input(f, 'pasture-split-start'), confirm = input(f, 'pasture-split-confirm');
  start.click(); assert.match(f.info.querySelector('[data-pasture-split-quote]').textContent, /5只鸡.*不移动鸡蛋、未成蛋进度/);
  input(f, 'pasture-split-cancel').click(); assert.equal(f.doc.activeElement, start); assert.equal(destination.animals, 0);
  start.click(); confirm.click(); confirm.click(2);
  assert.equal(f.b.animals, 5); assert.equal(destination.animals, 5); assert.equal(f.b.pastureProducts.eggs, 12); assert.equal(f.b.eggProgress, .5);
  assert.equal(destination.pastureProducts.eggs, 0); assert.match(message(f), /已分5只鸡/);
});

test('splitting still requires ten birds and expires a quote when count changes', () => {
  const f = setup(), destination = f.building('pasture', { animalType: 'chicken' });
  f.b.animals = 9; f.G.ui.refreshEconomyInfo(f.b); assert(input(f, 'pasture-split-start').disabled);
  f.b.animals = 10; f.G.ui.refreshEconomyInfo(f.b); input(f, 'pasture-split-start').click();
  f.b.animals = 11; f.G.ui.refreshEconomyInfo(f.b); input(f, 'pasture-split-confirm').click();
  assert.equal(f.b.animals, 11); assert.equal(destination.animals, 0); assert.match(message(f), /重新查看/);
});

test('guide counts eggs and meat as one nutrition group and remains three at full variety', () => {
  const f = setup();
  Object.assign(f.G.game.res, { meat: 8, eggs: 8, grain: 0, vegetables: 0, food: 16 });
  f.G.ui.refreshGuide(); assert.match(f.guide.textContent, /营养组 1\/3/);
  Object.assign(f.G.game.res, { meat: 0, grain: 8, vegetables: 8, food: 24 });
  f.G.ui.refreshGuide(); assert.match(f.guide.textContent, /营养组 3\/3/);
  assert(!/\/4/.test(f.guide.textContent)); assert.match(f.G.ui.healthSummaryMarkup(), /肉类含鸡蛋/);
});

test('HUD labels eggs independently, includes them once in food total, and identifies their nutrition group', () => {
  const f = setup(); Object.assign(f.G.game.res, { meat: 6, eggs: 12, vegetables: 3, grain: 4, food: 25 });
  f.G.ui.refreshHUD(); const eggs = f.doc.getElementById('res-eggs'), food = f.doc.getElementById('res-food');
  assert.equal(eggs.querySelector('b').textContent, '12'); assert.equal(food.querySelector('b').textContent, '25');
  assert.match(eggs.title, /鸡蛋.*独立库存.*同属肉类营养组/); assert.match(food.title, /肉类 6.*鸡蛋 12.*蔬菜 3.*主食 4/);
  assert.match(f.G.ui.resourceIcon('eggs'), /res_eggs\.png/); assert(!eggs.title.includes('三类食物共享'));
});

test('production targets show separate egg stock, shared total limits and preservation of produced eggs', () => {
  const f = setup(); f.mount('production-goals');
  for (const key of ['food', 'meat', 'eggs']) { f.mount('goal-stock-' + key); f.mount('goal-status-' + key); }
  f.G.setProductionGoal('eggs', 0); f.G.ui.refreshProductionGoals();
  assert.match(f.doc.getElementById('goal-status-eggs').textContent, /关闭新自动生产.*总食物.*暂停新产蛋.*保留/);
  assert.match(f.doc.getElementById('goal-stock-eggs').textContent, /库存 0.*共享总仓容/);
  assert.match(f.doc.getElementById('goal-status-food').textContent, /各食物物品独立目标/);
  assert.equal(f.G.productionGoalOf('meat'), null);
  f.G.ui.refreshEconomyInfo(f.b); assert.match(live(f, 'pasture-stock'), /鸡蛋目标 0.*暂停新产蛋/);
  f.G.setProductionGoal('eggs', f.G.storageCap('eggs') + 1); f.G.ui.refreshProductionGoals();
  const status = f.doc.getElementById('goal-status-eggs').textContent;
  assert.match(status, /已有鸡蛋保留/); assert(!/交货仍可能损失|整田/.test(status));
});

test('town ledger renders four item histories and sums eggs without calling them four nutrition groups', () => {
  const f = setup(); f.G.ledgerRecord('produced', 'eggs', 7); f.G.ledgerRecord('produced', 'meat', 3);
  const data = f.G.ui.townLedgerInfoData(); assert.equal(data['flow-eggs-current-produced'], '7'); assert.equal(data['flow-food-current-produced'], '10');
  const html = f.G.ui.townLedgerInfoMarkup(data);
  assert.match(html, /食物物品明细/); assert.match(html, /flow-eggs-current-produced/); assert.match(html, /flow-eggs-recent-produced/);
  assert.match(html, /仍为三组营养/); assert(!/三类相加|三类食物明细|四组营养/.test(html));
});

test('chickens trade at 400 into their own bank and cannot be bought again after stock exhaustion', () => {
  const f = setup(), b = merchant(f);
  exchange(f, 'chicken', 4); assert.equal(f.G.game.livestock.chicken, 8); assert.equal(b.tradeInventory.firewood, 0);
  assert.equal(f.G.game.livestock.sheep, 4); assert.match(message(f), /已购买鸡 × 4.*支付柴火 × 400.*鸡牧场/);
  exchange(f, 'chicken', 4); assert.equal(f.G.game.livestock.chicken, 8);
});

test('egg and meat purchases have distinct prices and station inventories, with no immediate public stock increase', () => {
  const f = setup(), b = merchant(f);
  const beforeFood = f.G.game.res.food;
  exchange(f, 'eggs', 20); assert.equal(b.tradeInventory.eggs, 20); assert.equal(b.tradeInventory.firewood, 390);
  assert.match(message(f), /已购买鸡蛋 × 20.*支付柴火 × 10/);
  exchange(f, 'meat', 20); assert.equal(b.tradeInventory.meat, 20); assert.equal(b.tradeInventory.firewood, 385);
  assert.equal(f.G.game.res.eggs, 0); assert.equal(f.G.game.res.meat, 0); assert.equal(f.G.game.res.food, beforeFood);
  assert.match(live(f, 'inventory'), /鸡蛋：待售 20/); assert.match(live(f, 'inventory'), /肉类：待售 20/);
});

test('egg sale targets and payment values stay separate from meat, and food-refusing merchants reject both', () => {
  const f = setup(), b = merchant(f);
  input(f, 'trade-target-resource').value = 'eggs'; input(f, 'trade-target-quantity').value = '15'; input(f, 'trade-target-form').emit('submit');
  assert.equal(b.tradeTargets.eggs, 15); assert(!b.tradeTargets.meat); assert.match(message(f), /鸡蛋待售目标已设为 15/);
  b.tradeInventory.eggs = 10; exchange(f, 'meat', 20, 'eggs');
  assert.equal(b.tradeInventory.eggs, 0); assert.equal(b.tradeInventory.meat, 20); assert.match(message(f), /支付鸡蛋 × 10/);
  const supplies = merchant(f, 'supplies');
  assert.match(live(f, 'merchant-payments'), /拒收食物：肉类、鸡蛋、蔬菜、主食/);
  const eggPayment = input(f, 'trade-payment').querySelectorAll('option').find(o => o.value === 'eggs');
  assert(eggPayment.disabled); assert.equal(f.G.merchantAccepts(supplies, 'eggs'), false);
});

test('chicken, egg and meat orders retain the same merchant contract, independent quantities and bounds', () => {
  const f = setup(), b = merchant(f), form = input(f, 'trade-order-form');
  for (const [good, quantity] of [['chicken', 4], ['eggs', 200], ['meat', 200]]) {
    input(f, 'trade-order-good').value = good; input(f, 'trade-order-quantity').value = quantity;
    f.G.ui.refreshEconomyInfo(b); assert.equal(input(f, 'trade-order-quantity').max, String(quantity));
    form.emit('submit'); assert.equal(b.merchantOrders.general.good, good); assert.equal(b.merchantOrders.general.qty, quantity);
    assert.equal(b.tradeInventory.firewood, 400); assert.match(message(f), /无需预付款/);
  }
});

test('egg auto-buy preserves draft focus and explicit confirmation, and never purchases the current ship retroactively', () => {
  const f = setup(), b = merchant(f);
  input(f, 'auto-trade-enabled').value = 'on'; input(f, 'auto-trade-good').value = 'eggs'; input(f, 'auto-trade-quantity').value = '20';
  input(f, 'auto-trade-payment').value = 'firewood'; input(f, 'auto-trade-price').value = '2';
  const field = input(f, 'auto-trade-quantity'); field.focus(); const writes = f.info.htmlWrites;
  f.G.ui.renderInfo(); assert.equal(f.doc.activeElement, field); assert.equal(field.value, '20'); assert.equal(f.info.htmlWrites, writes);
  input(f, 'auto-trade-form').emit('submit'); assert.equal(b.autoTrade.enabled, false);
  assert.match(f.info.querySelector('[data-auto-trade-terms]').textContent, /鸡蛋 × 20.*最多支付 10 柴火/);
  input(f, 'auto-trade-cancel').click(); assert.equal(b.autoTrade.enabled, false);
  input(f, 'auto-trade-form').emit('submit'); input(f, 'auto-trade-confirm').click(); input(f, 'auto-trade-confirm').click(2);
  assert.equal(b.autoTrade.good, 'eggs'); assert.equal(b.autoTrade.qty, 20); assert.equal(b.autoTrade.enabled, true);
  assert.equal(b.tradeInventory.firewood, 400); assert(!b.tradeInventory.eggs); assert.match(message(f), /当前船不会补买/);
});

test('changed merchant and detached trade forms cannot buy eggs or save a stale auto-buy confirmation', () => {
  const f = setup(), b = merchant(f), exchangeForm = input(f, 'trade-exchange-form');
  input(f, 'trade-good').value = 'eggs'; input(f, 'trade-buy-quantity').value = '10'; input(f, 'trade-payment').value = 'firewood';
  b.merchant = { ...b.merchant, stock: { ...b.merchant.stock } }; exchangeForm.emit('submit');
  assert.equal(b.tradeInventory.firewood, 400); assert(!b.tradeInventory.eggs);
  input(f, 'auto-trade-enabled').value = 'on'; input(f, 'auto-trade-good').value = 'eggs'; input(f, 'auto-trade-quantity').value = '20';
  input(f, 'auto-trade-payment').value = 'firewood'; input(f, 'auto-trade-price').value = '2'; input(f, 'auto-trade-form').emit('submit');
  const confirm = input(f, 'auto-trade-confirm'); f.select(f.b); confirm.click(); assert.equal(b.autoTrade.enabled, false);
});

test('chicken detail refresh is read-only across serialization and retains physical inventory', () => {
  const f = setup(); stock(f, 2); f.b.eggProgress = .5; f.b.pastureProducts.eggs = 7;
  const before = JSON.stringify(f.G.serializeGame()); input(f, 'pasture-type').focus();
  f.G.ui.renderInfo(); f.G.ui.refreshEconomyInfo(f.b); f.G.ui.refreshGuide();
  assert.equal(JSON.stringify(f.G.serializeGame()), before); assert.equal(f.G.game.res.eggs, 0);
});

console.log(`Chicken UI: ${passed} DOM/live-simulation suites passed (not browser/mobile).`);
