/* Merchant/order DOM contracts against the real simulation APIs; not browser/mobile acceptance. */
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
function trader(id = 'general', stock) {
  const f = fixture(), { G } = f, b = f.building('tradingpost');
  b.merchant = { id, arrivedDay: G.game.day, leaveDay: G.game.day + 12,
    stock: stock || Object.fromEntries(G.MERCHANTS[id].goods.map(good => [good, G.TRADE_GOODS[good].stock])) };
  b.tradeInventory.firewood = 1500;
  f.select(b);
  const get = id => f.info.querySelector('#' + id);
  const live = key => f.info.querySelector(`[data-economy-live="${key}"]`).textContent;
  function trade(good, qty = 1, payment = 'firewood') {
    get('trade-good').value = good; get('trade-buy-quantity').value = String(qty); get('trade-payment').value = payment;
    get('trade-good').emit('input'); return get('trade-exchange-form');
  }
  function order(good, qty = 1) {
    get('trade-order-good').value = good; get('trade-order-quantity').value = String(qty);
    get('trade-order-good').emit('input'); return get('trade-order-form');
  }
  return { ...f, b, get, live, trade, order };
}
const snapshot = f => JSON.stringify(f.G.serializeGame());

test('all three merchant names, accepted payments, refusal labels and order catalogs are visible', () => {
  for (const id of ['general', 'supplies', 'seeds']) {
    const f = trader(id), { G, get, live } = f;
    assert.match(live('merchant'), new RegExp(G.MERCHANTS[id].name + '停靠中.*12 天后离开'));
    assert.deepEqual(get('trade-order-good').querySelectorAll('option').map(option => option.value), Array.from(G.MERCHANTS[id].goods));
    assert.match(live('merchant-payments'), id === 'general' ? /接受肉类、鸡蛋、蔬菜、主食、苹果、梨付款/ : /拒收食物：肉类、鸡蛋、蔬菜、主食、苹果、梨/);
    for (const option of get('trade-payment').querySelectorAll('option')) assert.equal(option.disabled, id !== 'general' && G.FOOD_KEYS.includes(option.value));
    assert.equal(get('trade-target-resource').querySelectorAll('option').some(option => option.disabled), false, 'stocking food remains allowed');
    assert.match(f.info.textContent, /无需预付款，不会自动交易/);
    assert.match(f.info.textContent, /每站每位商人只保留一份一次性订单/);
  }
});

test('legacy merchant remains general with original stock and departure time', () => {
  const f = trader(), { G, b } = f; delete b.merchant.id; b.merchant.leaveDay = 9; b.merchant.stock.coal = 31;
  const before = snapshot(f); G.ui.renderInfo();
  assert.match(f.live('merchant'), /河湾杂货商.*9 天后离开/);
  f.trade('coal'); assert.match(f.live('quote'), /商船存货 31/);
  assert.equal(snapshot(f), before);
});

test('absent goods reject trade while the same catalog item remains available to order', () => {
  const f = trader('supplies', { coal: 20 });
  f.trade('leather', 3);
  assert.equal(f.get('trade-execute').disabled, true); assert.match(f.live('quote'), /未带|现货不足/);
  f.order('leather', 3);
  assert.equal(f.get('trade-order-confirm').disabled, false); assert.match(f.live('order-quote'), /皮革 × 3.*订货单价 12/);
  const before = f.b.tradeInventory.firewood;
  f.get('trade-order-form').emit('submit');
  assert.equal(f.b.merchantOrders.supplies.good, 'leather'); assert.equal(f.b.merchantOrders.supplies.qty, 3);
  assert.equal(f.b.tradeInventory.firewood, before); assert.equal(f.b.merchant.stock.leather, undefined);
});

test('declined food payment remains selected and explains refusal without spending it', () => {
  for (const id of ['supplies', 'seeds']) {
    const f = trader(id); f.b.tradeInventory.grain = 1000;
    const good = id === 'supplies' ? 'coal' : 'orchardSeed', form = f.trade(good, 1, 'grain'), before = snapshot(f);
    assert.equal(f.get('trade-payment').value, 'grain'); assert.match(f.live('quote'), /不收食物/);
    assert.equal(f.get('trade-execute').disabled, true); form.emit('submit'); assert.equal(snapshot(f), before);
  }
});

test('actual order premium uses floor then payment ceiling and ordinary goods retain normal prices', () => {
  const f = trader(), { G, b } = f;
  b.merchant.orderedGood = 'coal'; f.trade('coal', 3);
  const quote = G.ui.tradeQuote(b);
  assert.equal(quote.unitPrice, 7); assert.equal(quote.cost, 6); assert.match(quote.text, /单价 7.*原价 6 × 1.25 向下取整/);
  assert.match(f.get('trade-good').querySelectorAll('option').find(option => option.value === 'coal').textContent, /单价 7 · 订货价/);
  f.get('trade-exchange-form').emit('submit'); assert.equal(b.tradeInventory.firewood, 1494); assert.equal(b.tradeInventory.coal, 3);
  f.trade('steelTools', 2); assert.equal(G.ui.tradeQuote(b).unitPrice, 10); assert.equal(G.ui.tradeQuote(b).cost, 5);
  assert.doesNotMatch(G.ui.tradeQuote(b).text, /本次订货价/);
  b.merchant.orderedGood = 'cabbageSeed'; f.trade('cabbageSeed');
  assert.equal(G.ui.tradeQuote(b).unitPrice, 3125); assert.equal(G.ui.tradeQuote(b).cost, 782);
});

test('editing a draft is read-only; explicit order, replace and cancel never prepay or trade', () => {
  const f = trader(), { b } = f, before = snapshot(f);
  const form = f.order('iron', 11); assert.equal(snapshot(f), before);
  form.emit('submit'); assert.equal(b.merchantOrders.general.good, 'iron'); assert.equal(b.merchantOrders.general.qty, 11);
  assert.equal(b.tradeInventory.firewood, 1500); assert.equal(b.merchant.stock.iron, 100);
  assert.match(f.live('merchant-order'), /待到货：铁 × 11.*48 天后回访/);
  assert.match(f.get('trade-order-confirm').textContent, /确认替换/);
  f.order('leather', 8).emit('submit'); form.emit('submit');
  assert.deepEqual(Object.keys(b.merchantOrders), ['general']); assert.equal(b.merchantOrders.general.qty, 8);
  assert.equal(b.tradeInventory.firewood, 1500); assert.equal(b.merchant.stock.leather, 80);
  f.get('trade-order-cancel').click(); assert.equal(b.merchantOrders.general, undefined);
  f.get('trade-order-cancel').click(); assert.equal(b.tradeInventory.firewood, 1500);
  assert.equal(f.get('trade-order-cancel').disabled, true);
});

test('invalid order quantities, out-of-catalog goods and already-unlocked seeds are refused without mutation', () => {
  for (const [good, qty] of [['coal', ''], ['coal', 0], ['coal', -1], ['coal', 1.5], ['coal', 101], ['cattle', 1], ['magic', 1]]) {
    const f = trader('supplies'), before = snapshot(f);
    f.order(good, qty).emit('submit'); assert.equal(snapshot(f), before, good + ':' + qty);
    assert.equal(f.get('trade-order-confirm').disabled, true);
  }
  const f = trader('seeds'); f.G.game.unlocks.cabbage = true;
  const before = snapshot(f); f.order('cabbageSeed').emit('submit');
  assert.equal(snapshot(f), before); assert.match(f.live('order-quote'), /已永久解锁/);
  f.order('orchardSeed', 2).emit('submit'); assert.equal(snapshot(f), before); assert.match(f.live('order-quote'), /1/);
});

test('pending orders for other merchants stay readable but only the current merchant can be cancelled', () => {
  const f = trader('supplies'), { b } = f;
  b.merchantOrders = { general: { good: 'cattle', qty: 2 }, supplies: { good: 'iron', qty: 11 }, seeds: { good: 'cabbageSeed', qty: 1 } };
  f.G.ui.renderInfo(); assert.match(f.live('merchant-orders'), /河湾杂货商.*牛 × 2.*绿篱种子商.*卷心菜种子 × 1/);
  assert.match(f.live('merchant-order'), /待到货：铁 × 11/);
  f.get('trade-order-cancel').click(); assert.equal(b.merchantOrders.supplies, undefined);
  assert.equal(b.merchantOrders.general.qty, 2); assert.equal(b.merchantOrders.seeds.qty, 1);
  delete b.merchant; f.G.ui.renderInfo();
  assert.match(f.live('merchant-orders'), /河湾杂货商.*绿篱种子商/);
  assert.match(f.live('merchant-order'), /暂不能订货、替换或取消/);
  assert.equal(f.get('trade-order-confirm').disabled, true); assert.equal(f.get('trade-order-cancel').disabled, true);
});

test('the next boat is never promised as the ordered merchant and arrival requires manual purchase', () => {
  const f = trader(), { G, b } = f; b.merchantVisits = 1;
  f.order('coal', 17).emit('submit'); assert.match(f.live('merchant-order'), /48 天后回访.*下一艘船可能不同/);
  const initial = b.tradeInventory.firewood;
  G.game.day = 16; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(G.merchantProfile(b).id, 'supplies'); assert.equal(b.merchantOrders.general.qty, 17);
  assert.match(f.live('merchant-orders'), /河湾杂货商 · 煤 × 17/);
  G.game.day = 32; G.arriveMerchant(b); G.ui.renderInfo(); assert.equal(G.merchantProfile(b).id, 'seeds');
  G.game.day = 48; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(G.merchantProfile(b).id, 'general'); assert.equal(b.merchantOrders.general, undefined);
  assert.equal(b.merchant.stock.coal, 17); assert.equal(b.tradeInventory.firewood, initial);
  assert.match(f.live('merchant-order'), /本次已带到煤，订单已清除.*手动确认/);
  f.trade('coal', 17).emit('submit'); assert.equal(b.tradeInventory.firewood, initial - 30); assert.equal(b.tradeInventory.coal, 17);
});

test('ordinary refresh preserves focused drafts and nodes without mutating simulation state', () => {
  const f = trader('supplies'), { G, get } = f;
  f.trade('iron', 6); f.order('leather', 8); get('trade-target-quantity').value = '123';
  const ids = ['trade-good', 'trade-buy-quantity', 'trade-payment', 'trade-order-good', 'trade-order-quantity', 'trade-target-quantity', 'trade-order-confirm'];
  const nodes = ids.map(get), values = nodes.map(node => node.value), writes = f.info.htmlWrites, before = snapshot(f);
  get('trade-order-quantity').focus();
  for (let i = 0; i < 10; i++) G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, get('trade-order-quantity'));
  ids.forEach((id, i) => { assert.equal(get(id), nodes[i]); assert.equal(get(id).value, values[i]); });
  assert.equal(snapshot(f), before);
});

test('new boat replaces callbacks, retains valid drafts and moves action focus away from payment', () => {
  for (const focused of ['trade-order-quantity', 'trade-execute', 'trade-order-confirm', 'trade-order-cancel']) {
    const f = trader(), { G, b, get } = f; f.order('coal', 8); f.trade('iron', 3); get('trade-target-quantity').value = '213';
    const oldOrder = get('trade-order-form'), oldTrade = get('trade-exchange-form'), oldCancel = get('trade-order-cancel');
    get(focused).focus(); b.merchant = { id: 'supplies', arrivedDay: 16, leaveDay: 28, stock: { coal: 20, iron: 40 } }; G.game.day = 16;
    G.ui.renderInfo(); assert.notEqual(get('trade-order-form'), oldOrder); assert.notEqual(get('trade-exchange-form'), oldTrade);
    assert.equal(get('trade-order-quantity').value, '8'); assert.equal(get('trade-order-good').value, 'coal'); assert.equal(get('trade-good').value, 'iron'); assert.equal(get('trade-buy-quantity').value, '3'); assert.equal(get('trade-target-quantity').value, '213');
    assert.equal(f.doc.activeElement, get(focused === 'trade-order-quantity' ? focused : 'trade-good'));
    const before = snapshot(f); oldOrder.emit('submit'); oldTrade.emit('submit'); oldCancel.click(); assert.equal(snapshot(f), before);
    get('trade-order-form').emit('submit'); assert.equal(b.merchantOrders.supplies.qty, 8);
  }
});

test('a boat change between frames rejects the old submit or cancel rather than using the new merchant', () => {
  for (const action of ['trade-exchange-form', 'trade-order-form', 'trade-order-cancel']) {
    const f = trader(), { G, b, get } = f; f.trade('coal', 7); f.order('coal', 8);
    const old = get(action); b.merchantOrders.supplies = { good: 'iron', qty: 9 };
    b.merchant = { id: 'supplies', arrivedDay: 16, leaveDay: 28, stock: { coal: 20 } }; G.game.day = 16;
    const before = snapshot(f); if (action.endsWith('form')) old.emit('submit'); else old.click();
    assert.equal(snapshot(f), before, action); assert.match(f.live('merchant'), /山路物资商/);
  }
});

test('old forms remain inert after game, world, panel, selection, building, modal or visibility changes', () => {
  for (const change of ['world', 'game', 'panel', 'selection', 'building', 'removed', 'site', 'modal', 'hidden', 'element', 'closed']) {
    const f = trader(), { G, b, get } = f; f.trade('coal', 3); f.order('coal', 8).emit('submit');
    const trade = get('trade-exchange-form'), order = get('trade-order-form'), cancel = get('trade-order-cancel'); f.order('iron', 2);
    if (change === 'world') G.world = { ...G.world };
    if (change === 'game') G.game = { ...G.game };
    if (change === 'panel') { f.select(f.building('house')); f.select(b); }
    if (change === 'selection') f.select(f.building('house'));
    if (change === 'building') G.world.bmap[b.id] = { ...b };
    if (change === 'removed') delete G.world.bmap[b.id];
    if (change === 'site') b.state = 'site';
    if (change === 'modal') G.hasOpenModal = () => true;
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'element') G.ui.el.info = f.mount('other-info');
    if (change === 'closed') G.ui.hideInfo();
    const before = JSON.stringify({ b, game: G.game }); trade.emit('submit'); order.emit('submit'); cancel.click();
    assert.equal(JSON.stringify({ b, game: G.game }), before, change);
  }
});

test('departure disables orders and trade immediately and cannot cancel a pending order', () => {
  const f = trader(), { G, b } = f; f.order('coal', 8).emit('submit'); f.trade('coal', 4);
  b.merchant.leaveDay = G.game.day; const before = snapshot(f); G.ui.renderInfo();
  assert.equal(f.get('trade-execute').disabled, true); assert.equal(f.get('trade-order-confirm').disabled, true); assert.equal(f.get('trade-order-cancel').disabled, true);
  f.get('trade-exchange-form').emit('submit'); f.get('trade-order-form').emit('submit'); f.get('trade-order-cancel').click();
  assert.equal(snapshot(f), before); assert.match(f.live('merchant-orders'), /河湾杂货商 · 煤 × 8/);
});

test('stock, capacity and shared inbound reservation remain canonical trade constraints while ordering is free', () => {
  const f = trader(), { G, b } = f; b.tradeInventory = { stone: 1980 };
  const c = G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm', name: '商人' });
  c.job = b.id; c.carry = { type: 'wood', qty: 20, staffingReturn: true }; c.task = { kind: 'trade', phase: 'deliver', b, resource: 'wood' };
  f.trade('grain', 7, 'stone'); assert.match(f.live('quote'), /含在途占位/); assert.equal(f.get('trade-execute').disabled, true);
  assert.match(f.live('trade-capacity'), /已入站 1980.*在途占位 20.*可用空位 0/);
  f.order('grain', 400).emit('submit'); assert.equal(b.merchantOrders.general.qty, 400); assert.equal(b.tradeInventory.stone, 1980);
  c.task = null; c.carry = null; G.ui.renderInfo(); assert.equal(f.get('trade-execute').disabled, false);
});

console.log(`Merchant orders UI: ${passed} DOM/live-simulation suites passed (not browser/mobile acceptance).`);
