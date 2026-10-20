/* Automatic-purchase DOM contracts against real simulation and save APIs; not browser/mobile acceptance. */
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
const snapshot = f => JSON.stringify(f.G.serializeGame());
function post(docked = false) {
  const f = fixture(), { G } = f, b = f.building('tradingpost');
  b.tradeInventory.stone = 400;
  if (docked) G.arriveMerchant(b);
  f.select(b);
  const get = id => f.info.querySelector('#' + id);
  const field = key => get('auto-trade-' + key);
  const text = key => f.info.querySelector('[data-auto-trade-' + key + ']').textContent;
  const panel = () => f.info.querySelector('[data-auto-trade]');
  const edit = (values = {}) => {
    panel().open = true;
    for (const [id, value] of Object.entries(values)) field(id).value = String(value);
    field(Object.keys(values)[0] || 'enabled').emit('input');
  };
  const enable = (values = {}) => { edit({ enabled: 'on', ...values }); field('form').emit('submit'); field('confirm').click(); };
  return { ...f, b, get, field, text, panel, edit, enable };
}

test('new and legacy posts are off by default with one collapsed editor available offship', () => {
  const f = post(), { G, b } = f;
  assert.equal(b.autoTrade.enabled, false); assert.equal(f.field('enabled').value, 'off');
  assert.notEqual(f.panel().open, true); assert.equal(f.info.querySelectorAll('[data-auto-trade]').length, 1);
  assert.equal(f.field('disable').disabled, true); assert.match(f.text('status'), /已关闭/);
  assert.match(f.text('receipt'), /尚无到访执行记录/);
  assert.equal(f.panel().contains(f.info.querySelector('[data-auto-trade-status]')), false);
  assert.equal(f.panel().contains(f.info.querySelector('[data-auto-trade-receipt]')), false);
  assert.match(f.info.textContent, /手动交易仍可.*只在未来每艘船到达时检查一次.*当前停靠船不补买.*离港不执行/s);
  assert.match(f.info.textContent, /工人上限 0 会停止备货与运回.*自动规则仍可用现有站内库存成交.*停止自动成交请关闭规则/);
  assert.equal(f.get('trade-execute').disabled, true); assert.equal(f.get('trade-order-confirm').disabled, true);
  assert.equal(f.field('apply').disabled, false);
  const data = JSON.parse(snapshot(f));
  for (const record of data.buildings) { delete record.autoTrade; delete record.autoTradeLast; }
  const loaded = G.prepareSaveData(data); G.world = loaded.world; G.game = loaded.game; f.select(G.world.bmap[b.id]);
  assert.equal(G.world.bmap[b.id].autoTrade.enabled, false); assert.equal(f.field('enabled').value, 'off');
  assert.notEqual(f.panel().open, true); assert.match(f.text('receipt'), /尚无到访执行记录/);
});

test('enabling previews a station-only whole-batch ceiling and never trades the current boat', () => {
  const f = post(true), { G, b } = f, before = snapshot(f), inventory = JSON.stringify(b.tradeInventory), stock = JSON.stringify(b.merchant.stock);
  f.edit({ enabled: 'on', good: 'coal', quantity: 3, payment: 'stone', price: 6 });
  f.field('form').emit('submit');
  assert.equal(snapshot(f), before); assert.equal(f.field('confirm').disabled, false);
  assert.match(f.text('terms'), /每船整批购买煤 × 3.*每船上限 100.*最高单价 6.*本站石头库存/);
  assert.match(f.text('terms'), /每船最多支付 3 石头（6 × 3 ÷ 7，向上取整）/);
  assert.match(f.text('terms'), /只使用已搬入本站的游戏库存.*不动全镇库存或在途货.*当前停靠船不会补买.*不足整批.*不再重试/);
  f.field('confirm').click();
  assert.equal(b.autoTrade.enabled, true); assert.equal(b.autoTrade.qty, 3);
  assert.equal(JSON.stringify(b.tradeInventory), inventory); assert.equal(JSON.stringify(b.merchant.stock), stock);
  assert.equal(b.autoTradeLast, undefined); assert.equal(f.field('confirm').disabled, true);
  const saved = snapshot(f); f.field('confirm').click(); G.ui.renderInfo(); assert.equal(snapshot(f), saved);
  assert.match(f.text('status'), /每船煤 × 3.*最多支付本站石头 × 3.*当前船不补买/);
});

test('enabled changes require a new preview and cancel or duplicate confirmation is harmless', () => {
  const f = post(true), { b } = f; f.enable();
  const original = JSON.stringify(b.autoTrade), inventory = JSON.stringify(b.tradeInventory);
  f.edit({ quantity: 8, price: 7 }); f.field('form').emit('submit');
  assert.equal(JSON.stringify(b.autoTrade), original); assert.match(f.text('terms'), /煤 × 8.*最高单价 7.*最多支付 8 石头/);
  f.field('cancel').click(); f.field('confirm').click(); assert.equal(JSON.stringify(b.autoTrade), original);
  f.field('form').emit('submit'); f.field('confirm').click(2); assert.equal(JSON.stringify(b.autoTrade), original);
  f.field('form').emit('submit'); f.field('confirm').click();
  assert.equal(b.autoTrade.qty, 8); assert.equal(b.autoTrade.maxPrice, 7); assert.equal(JSON.stringify(b.tradeInventory), inventory);
  assert.equal(b.autoTradeLast, undefined);
});

test('malformed states, goods, payment, quantities and prices cannot change any game data', () => {
  const invalid = [['enabled', 'yes'], ['good', 'magic'], ['good', '__proto__'], ['payment', 'magic'], ['payment', 'toString'],
    ['quantity', ''], ['quantity', 0], ['quantity', -1], ['quantity', 1.5], ['quantity', 101],
    ['price', ''], ['price', 0], ['price', -1], ['price', 1.5], ['price', 1000001], ['price', 'Infinity']];
  for (const [key, value] of invalid) {
    const f = post(true); f.enable(); const before = snapshot(f);
    f.edit({ [key]: value }); assert.equal(f.field('apply').disabled, true, key + ':' + value);
    f.field('form').emit('submit'); f.field('confirm').click(); assert.equal(snapshot(f), before, key + ':' + value);
  }
  const f = post(); f.edit({ enabled: 'on', good: 'beanSeed', quantity: 2, price: 2500 });
  assert.equal(f.field('quantity').max, '1'); assert.equal(f.field('apply').disabled, true);
  const before = snapshot(f); f.field('form').emit('submit'); f.field('confirm').click(); assert.equal(snapshot(f), before);
});

test('clear disable uses the applied rule despite an invalid draft and never changes past inventory', () => {
  const f = post(true), { b } = f; f.enable({ quantity: 5, price: 7 });
  const inventory = JSON.stringify(b.tradeInventory), stock = JSON.stringify(b.merchant.stock);
  f.edit({ quantity: '', price: -2, payment: 'magic' }); f.field('disable').click();
  assert.equal(b.autoTrade.enabled, false); assert.equal(b.autoTrade.qty, 5); assert.equal(b.autoTrade.maxPrice, 7); assert.equal(b.autoTrade.payment, 'stone');
  assert.equal(f.field('enabled').value, 'off'); assert.equal(f.field('disable').disabled, true);
  assert.equal(JSON.stringify(b.tradeInventory), inventory); assert.equal(JSON.stringify(b.merchant.stock), stock);
  const before = snapshot(f); f.field('disable').click(); assert.equal(snapshot(f), before);
  assert.match(f.text('status'), /已关闭/);
});

test('ordinary live refresh preserves all focused drafts, disclosure state and confirmation nodes', () => {
  const f = post(true), { G } = f;
  f.edit({ enabled: 'on', good: 'iron', quantity: 12, payment: 'firewood', price: 8 });
  f.field('form').emit('submit'); f.field('quantity').focus();
  const ids = ['enabled', 'good', 'quantity', 'payment', 'price', 'form', 'confirm'];
  const nodes = ids.map(f.field), values = nodes.map(node => node.value), writes = f.info.htmlWrites, before = snapshot(f);
  for (let i = 0; i < 12; i++) G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, f.field('quantity')); assert.equal(f.panel().open, true);
  ids.forEach((id, i) => { assert.equal(f.field(id), nodes[i]); assert.equal(f.field(id).value, values[i]); });
  assert.equal(f.field('confirm').disabled, false); assert.equal(snapshot(f), before);
});

test('draft edits, direct value changes, close and external applied changes invalidate pending confirmation', () => {
  for (const change of ['input', 'change', 'silent', 'refresh', 'close', 'applied']) {
    const f = post(), { G, b } = f;
    f.edit({ enabled: 'on' }); f.field('form').emit('submit');
    if (['input', 'change', 'silent', 'refresh'].includes(change)) {
      f.field('quantity').value = '3';
      if (['input', 'change'].includes(change)) f.field('quantity').emit(change);
      if (change === 'refresh') G.ui.renderInfo();
    }
    if (change === 'close') { f.panel().open = false; f.panel().emit('toggle'); }
    if (change === 'applied') G.setAutoTrade(b, { ...b.autoTrade, qty: 4 }, G.game);
    const before = snapshot(f); f.field('confirm').click(); assert.equal(snapshot(f), before, change);
    assert.equal(f.field('confirm').disabled, true, change);
    if (change === 'close') assert.equal(f.doc.activeElement, f.field('summary'), 'closing moves focus to the visible disclosure');
  }
});

test('arrival remount preserves draft and open editor but cancels stale confirmation and payment focus', () => {
  for (const focus of ['quantity', 'confirm', 'cancel']) {
    const f = post(), { G, b } = f; f.edit({ enabled: 'on', quantity: 13, payment: 'firewood', price: 9 });
    f.field('form').emit('submit'); f.field(focus).focus();
    const oldForm = f.field('form'), oldConfirm = f.field('confirm');
    G.game.day = 12; G.arriveMerchant(b); G.ui.renderInfo();
    assert.equal(f.panel().open, true); assert.equal(f.field('quantity').value, '13'); assert.equal(f.field('payment').value, 'firewood'); assert.equal(f.field('price').value, '9');
    assert.equal(f.field('confirm').disabled, true); assert.equal(f.doc.activeElement, f.field(focus === 'quantity' ? focus : 'apply'));
    const before = snapshot(f); oldForm.emit('submit'); oldConfirm.click(); assert.equal(snapshot(f), before);
    assert.equal(b.autoTrade.enabled, false); assert.equal(b.autoTradeLast, undefined);
  }
});

test('stale forms, confirms and disable actions reject world, game, entity, panel, modal and boat changes', () => {
  for (const change of ['world', 'game', 'panel', 'selection', 'building', 'removed', 'site', 'type', 'modal', 'hidden', 'element', 'closed', 'boat']) {
    const f = post(true), { G, b } = f; f.enable(); f.edit({ quantity: 3 }); f.field('form').emit('submit');
    const form = f.field('form'), confirm = f.field('confirm'), disable = f.field('disable');
    if (change === 'world') G.world = { ...G.world };
    if (change === 'game') G.game = { ...G.game };
    if (change === 'panel') { f.select(f.building('house')); f.select(b); }
    if (change === 'selection') G.sel = { kind: 'b', id: f.building('house').id };
    if (change === 'building') G.world.bmap[b.id] = { ...b };
    if (change === 'removed') delete G.world.bmap[b.id];
    if (change === 'site') b.state = 'site';
    if (change === 'type') b.type = 'stockpile';
    if (change === 'modal') G.hasOpenModal = () => true;
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'element') G.ui.el.info = f.mount('other-info');
    if (change === 'closed') G.ui.hideInfo();
    if (change === 'boat') { G.game.day = 16; G.arriveMerchant(b); }
    const before = JSON.stringify({ b, game: G.game }); form.emit('submit'); confirm.click(); disable.click();
    assert.equal(JSON.stringify({ b, game: G.game }), before, change);
  }
});

test('same-ID save/load invalidates old controls and never replays an already docked boat', () => {
  const f = post(true), { G, b } = f; f.enable(); f.edit({ quantity: 3 }); f.field('form').emit('submit');
  const form = f.field('form'), confirm = f.field('confirm'), disable = f.field('disable');
  const restored = G.prepareSaveData(JSON.parse(snapshot(f))); G.world = restored.world; G.game = restored.game;
  const loaded = G.world.bmap[b.id]; f.select(loaded);
  assert.notEqual(loaded, b); assert.equal(loaded.id, b.id); assert.equal(loaded.autoTrade.enabled, true);
  assert.equal(loaded.autoTrade.qty, 10); assert.equal(loaded.merchant.autoTradeDone, true);
  assert.equal(loaded.tradeInventory.stone, 400); assert.equal(loaded.autoTradeLast, undefined);
  const before = snapshot(f); form.emit('submit'); confirm.click(); disable.click(); G.ui.renderInfo(); assert.equal(snapshot(f), before);
  f.field('disable').click(); assert.equal(loaded.autoTrade.enabled, false); assert.equal(b.autoTrade.enabled, true);
});

test('real arrival buys once from station stock and keeps a dated original receipt after edits and departure', () => {
  const f = post(), { G, b } = f; b.tradeInventory.stone = 20; b.workerLimit = 0;
  const publicStock = JSON.stringify(G.game.res); f.enable();
  G.game.day = 12; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(b.tradeInventory.stone, 11); assert.equal(b.tradeInventory.coal, 10); assert.equal(b.merchant.stock.coal, 90);
  assert.equal(JSON.stringify(G.game.res), publicStock); assert.equal(b.autoTradeLast.ok, true);
  assert.match(f.text('receipt'), /第 13 天（历史回执）.*当时规则煤 × 10.*已成交.*单价 6.*石头 × 9/);
  const receipt = f.text('receipt'); f.enable({ good: 'iron', quantity: 2, price: 5 });
  assert.match(f.text('status'), /每船铁 × 2/); assert.equal(f.text('receipt'), receipt); assert.equal(b.tradeInventory.stone, 11);
  b.merchant = null; G.ui.renderInfo(); assert.equal(f.text('receipt'), receipt); assert.equal(f.get('trade-execute').disabled, true);
  f.field('disable').click(); assert.equal(f.text('receipt'), receipt); assert.match(f.text('status'), /已关闭/);
});

test('price skips remain visible after raising the ceiling and never retry the current boat', () => {
  const f = post(), { G, b } = f; f.enable({ price: 5 });
  G.game.day = 12; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(b.tradeInventory.stone, 400); assert.equal(b.autoTradeLast.ok, false);
  assert.match(f.text('receipt'), /历史回执.*已跳过，未扣库存.*单价6超出最高单价5/);
  const receipt = f.text('receipt'); f.enable({ price: 6 });
  assert.equal(b.tradeInventory.stone, 400); assert.equal(f.text('receipt'), receipt); assert.equal(b.merchant.stock.coal, 100);
  f.get('trade-good').value = 'coal'; f.get('trade-buy-quantity').value = '1'; f.get('trade-payment').value = 'stone'; f.get('trade-good').emit('input');
  assert.equal(f.get('trade-execute').disabled, false); f.get('trade-exchange-form').emit('submit');
  assert.equal(b.tradeInventory.stone, 399); assert.equal(b.tradeInventory.coal, 1); assert.equal(f.text('receipt'), receipt);
});

test('insufficient station stock skips the entire batch and later stocked goods do not cause a retry', () => {
  const f = post(), { G, b } = f; b.tradeInventory.stone = 8; f.enable();
  G.game.day = 12; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(b.tradeInventory.stone, 8); assert.equal(b.tradeInventory.coal || 0, 0); assert.equal(b.merchant.stock.coal, 100);
  assert.match(f.text('receipt'), /已跳过，未扣库存.*待售库存不足/);
  b.tradeInventory.stone = 40; G.ui.renderInfo(); f.field('form').emit('submit'); f.field('confirm').click();
  assert.equal(b.tradeInventory.stone, 40); assert.equal(b.tradeInventory.coal || 0, 0); assert.match(f.text('receipt'), /待售库存不足/);
});

test('seed and livestock rules use actual unlock and pending-animal destinations', () => {
  const seed = post(), { G, b } = seed; seed.enable({ good: 'beanSeed', quantity: 1, price: 2500 });
  G.game.day = 12; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(G.game.unlocks.beans, true); assert.equal(b.tradeInventory.stone, 42); assert.equal(b.tradeInventory.beanSeed, undefined);
  assert.match(seed.text('receipt'), /早熟豆类种子 × 1.*已成交.*石头 × 358/);
  b.tradeInventory.stone = 400; b.merchantVisits = 3; G.game.day = 60; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(b.tradeInventory.stone, 400); assert.match(seed.text('receipt'), /已跳过.*已永久解锁/);
  const animals = post(); animals.enable({ good: 'sheep', quantity: 2, price: 600 });
  animals.G.game.day = 12; animals.G.arriveMerchant(animals.b); animals.G.ui.renderInfo();
  assert.equal(animals.G.game.livestock.sheep, 2); assert.equal(animals.b.tradeInventory.sheep, undefined);
  assert.match(animals.text('receipt'), /羊 × 2.*已成交.*石头 × 172/);
});

test('two posts keep independent rules, inventories, results and new-panel drafts', () => {
  const f = post(), { G, b } = f, other = f.building('tradingpost'); other.tradeInventory.stone = 100;
  f.enable({ quantity: 7 }); f.select(other);
  assert.equal(f.field('enabled').value, 'off'); assert.equal(f.field('quantity').value, '10'); assert.notEqual(f.panel().open, true);
  G.game.day = 12; G.arriveMerchant(b); G.arriveMerchant(other); G.ui.renderInfo();
  assert.equal(b.tradeInventory.coal, 7); assert.equal(b.tradeInventory.stone, 394);
  assert.equal(other.tradeInventory.coal || 0, 0); assert.equal(other.tradeInventory.stone, 100); assert.equal(other.autoTradeLast, undefined);
  assert.match(f.text('receipt'), /尚无到访执行记录/); f.select(b);
  assert.equal(f.field('quantity').value, '7'); assert.match(f.text('receipt'), /当时规则煤 × 7.*已成交/);
  f.field('disable').click(); assert.equal(b.autoTrade.enabled, false); assert.equal(other.autoTrade.enabled, false);
});

test('manual targets and orders remain independent and ordered premium is checked at actual arrival', () => {
  const f = post(true), { G, b } = f; f.enable();
  f.get('trade-target-resource').value = 'stone'; f.get('trade-target-resource').emit('change'); f.get('trade-target-quantity').value = '100';
  f.get('trade-target-form').emit('submit'); assert.equal(b.tradeTargets.stone, 100); assert.equal(b.autoTrade.qty, 10);
  f.get('trade-order-good').value = 'coal'; f.get('trade-order-quantity').value = '10'; f.get('trade-order-good').emit('input');
  assert.match(G.ui.merchantOrderQuote(b).text, /自动购买会另按规则检查/);
  f.get('trade-order-form').emit('submit'); assert.equal(b.merchantOrders.general.qty, 10); assert.equal(b.tradeInventory.stone, 400);
  b.merchantVisits = 3; G.game.day = 48; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(b.merchantOrders.general, undefined); assert.equal(b.merchant.orderedGood, 'coal'); assert.equal(b.merchant.stock.coal, 10);
  assert.match(f.text('receipt'), /已跳过.*单价7超出最高单价6/);
  assert.match(f.info.querySelector('[data-economy-live="merchant-order"]').textContent, /自动购买结果.*剩余货物可手动确认/);
  f.get('trade-good').value = 'coal'; f.get('trade-buy-quantity').value = '3'; f.get('trade-payment').value = 'stone'; f.get('trade-good').emit('input');
  assert.equal(G.ui.tradeQuote(b).unitPrice, 7); f.get('trade-exchange-form').emit('submit');
  assert.equal(b.tradeInventory.stone, 397); assert.equal(b.tradeInventory.coal, 3); assert.equal(b.merchant.stock.coal, 7);
});

test('ale export and stone import appear in targets, manual quotes, orders and automatic receipt', () => {
  const f = post(true), { G, b } = f; b.tradeInventory.ale = 7;
  for (const id of ['trade-target-resource', 'trade-payment', 'auto-trade-payment']) assert(f.get(id).children.some(o => o.value === 'ale'));
  for (const id of ['trade-good', 'trade-order-good', 'auto-trade-good']) assert(f.get(id).children.some(o => o.value === 'stone'));
  f.get('trade-target-resource').value = 'ale'; f.get('trade-target-quantity').value = '7'; f.get('trade-target-form').emit('submit');
  assert.equal(b.tradeTargets.ale, 7);
  f.get('trade-good').value = 'stone'; f.get('trade-buy-quantity').value = '8'; f.get('trade-payment').value = 'ale'; f.get('trade-good').emit('input');
  assert.equal(G.ui.tradeQuote(b).cost, 7); f.get('trade-exchange-form').emit('submit');
  assert.equal(b.tradeInventory.ale, 0); assert.equal(b.tradeInventory.stone, 408);
  f.get('trade-order-good').value = 'stone'; f.get('trade-order-quantity').value = '10'; f.get('trade-order-good').emit('input');
  f.get('trade-order-form').emit('submit'); assert.equal(b.merchantOrders.general.good, 'stone');
  b.tradeInventory.ale = 10; f.enable({ good: 'stone', quantity: 10, payment: 'ale', price: 8 });
  assert.equal(b.tradeInventory.ale, 10); b.merchantVisits = 3; G.game.day = 48; G.arriveMerchant(b); G.ui.renderInfo();
  assert.equal(b.tradeInventory.ale, 0); assert.equal(b.tradeInventory.stone, 418);
  assert.match(f.text('receipt'), /石料 × 10.*已成交.*麦酒 × 10/);
});

console.log(`Automatic purchase UI: ${passed} DOM/live-simulation suites passed (not browser/mobile acceptance).`);
