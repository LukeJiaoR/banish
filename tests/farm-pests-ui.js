/* Optional farm-pest DOM and live-simulation contracts, not browser visual acceptance. */
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
const save = G => JSON.parse(JSON.stringify(G.serializeGame()));
function farm(unlocked = false) {
  const f = fixture(), { G } = f, b = f.building('farm');
  f.building('storage'); G.game.h = 12; G.game.unlocks.cabbage = unlocked;
  G.game.res.grain = G.game.res.food = 200; G.game.res.tools = 100;
  for (const tile of b.farm) tile.sown = true;
  b.sownAll = true; b.growth = .5;
  G.rng = () => 0;
  f.select(b);
  const get = id => f.G.ui.el.info.querySelector('#farm-pests-' + id);
  return { ...f, b, get };
}
function choose(f, type) {
  const select = f.G.ui.el.info.querySelector('#farm-crop');
  select.focus(); select.value = type; select.emit('change'); return select;
}
function enable(f) { f.get('toggle').click(); f.get('confirm').click(); assert.equal(f.G.game.farmPests.enabled, true); }
function advance(f, day) {
  f.G.game.day = day; f.G.game.season = Math.floor(day % f.G.YEAR_DAYS / f.G.SEASON_DAYS);
  f.G.advanceFarmPests(); f.G.ui.renderInfo();
}
function infested(unlocked = false) { const f = farm(unlocked); enable(f); advance(f, 12); assert(f.G.farmPestSummary(f.b).active); return f; }

// These use the real gameplay APIs, seeded randomness and the actual mounted UI.
// Fixtures only supply terrain and a small DOM; there are no stub pest/harvest APIs.
test('new and legacy games remain off, and opening or reading details cannot enable surprises', () => {
  for (const legacy of [false, true]) {
    const f = farm(), { G } = f;
    let b = f.b;
    if (legacy) {
      const data = save(G); delete data.game.farmPests;
      for (const row of data.buildings) if (row.farm) row.farm = row.farm.map(tile => tile.slice(0, 2));
      const restored = G.prepareSaveData(data); G.world = restored.world; G.game = restored.game; b = G.world.bmap[b.id]; f.select(b);
    }
    const snapshot = JSON.stringify(save(G));
    for (let i = 0; i < 4; i++) { G.ui.farmInfoData(b); G.ui.renderInfo(); }
    assert.equal(G.game.farmPests.enabled, false);
    assert.equal(JSON.stringify(save(G)), snapshot);
    assert.match(f.info.textContent, /全镇农田虫害：已关闭/);
    assert.match(f.info.textContent, /新局和旧档默认关闭/);
    assert.equal(f.get('toggle').getAttribute('aria-describedby'), 'farm-pests-note');
    for (const day of [12, 13, 14, 25, 26]) advance(f, day);
    assert.equal(G.farmPestSummary(b).lost, 0); assert.equal(b.pestInfestation, undefined);
  }
});

test('enable requires an inline global confirmation; cancel and confirm-without-start are no-ops', () => {
  const f = farm(), { G, b } = f, before = JSON.stringify(save(G));
  const actual = G.setFarmPests; let calls = 0;
  G.setFarmPests = (...args) => { calls++; return actual(...args); };
  f.get('confirm').click(); assert.equal(calls, 0);
  f.get('toggle').click();
  const box = f.info.querySelector('[data-farm-pests-confirm]');
  assert.equal(box.classList.contains('hidden'), false);
  assert.equal(f.doc.activeElement, f.get('confirm'));
  assert.equal(f.get('toggle').getAttribute('aria-expanded'), 'true');
  assert.match(box.textContent, /全镇所有农田.*本作适配.*12天宽限.*预警2天.*逐日损失未收作物/);
  assert.match(f.info.textContent, /仓内库存和已背起的粮食不受影响.*果园、牧场不受影响/);
  assert.equal(G.farmPestSummary(b).enabled, false);
  f.get('cancel').click(); f.get('confirm').click();
  assert.equal(calls, 0); assert.equal(JSON.stringify(save(G)), before);
  assert(box.classList.contains('hidden')); assert.equal(f.get('toggle').getAttribute('aria-expanded'), 'false');
  // A real cancellation returns keyboard focus to the opening control.
  f.get('toggle').click(); f.get('cancel').click(); assert.equal(f.doc.activeElement, f.get('toggle'));
});

test('enable commits once for all fields with 12 days of grace and preserves food', () => {
  const f = farm(), { G } = f, other = f.building('farm'), stock = JSON.stringify(G.game.res);
  const actual = G.setFarmPests; let calls = 0;
  G.setFarmPests = (enabled, game) => { calls++; assert.equal(game, G.game); return actual(enabled, game); };
  enable(f); f.get('confirm').click(); f.get('confirm').click(2);
  assert.equal(calls, 1); assert.equal(G.game.farmPests.graceUntil, 12);
  assert.equal(G.farmPestSummary(other).enabled, true);
  assert.match(f.info.querySelector('[data-farm-pests-status]').textContent, /已开启.*宽限还剩 12 天/);
  assert.equal(f.get('toggle').textContent, '关闭全镇农田虫害');
  assert.equal(f.get('toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(JSON.stringify(G.game.res), stock);
  for (let day = 1; day < 12; day++) advance(f, day);
  assert.equal(G.farmPestSummary(f.b).active, false); assert.equal(G.farmPestSummary(f.b).lost, 0);
});

test('old setting controls reject stale selection, world, game, panel, modal and building state', () => {
  for (const action of ['enable', 'disable']) for (const mode of ['selection', 'world', 'game', 'panel', 'info', 'hidden', 'closed', 'removed', 'replacement', 'site', 'type', 'modal']) {
    const f = farm(), { G, b } = f;
    if (action === 'disable') enable(f); else f.get('toggle').click();
    const old = f.get(action === 'enable' ? 'confirm' : 'toggle'), actual = G.setFarmPests; let calls = 0;
    G.setFarmPests = (...args) => { calls++; return actual(...args); };
    if (mode === 'selection') G.sel = { kind: 'b', id: f.building('house').id };
    if (mode === 'world') G.world = { ...G.world };
    if (mode === 'game') G.game = { ...G.game };
    if (mode === 'panel') { f.select(f.building('house')); f.select(b); }
    if (mode === 'info') G.ui.el.info = f.mount('new-info');
    if (mode === 'hidden') f.info.classList.add('hidden');
    if (mode === 'closed') G.ui.hideInfo();
    if (mode === 'removed') delete G.world.bmap[b.id];
    if (mode === 'replacement') G.world.bmap[b.id] = { ...b };
    if (mode === 'site') b.state = 'site';
    if (mode === 'type') b.type = 'house';
    if (mode === 'modal') G.hasOpenModal = () => true;
    old.click(); assert.equal(calls, 0, action + ':' + mode);
    assert.equal(G.game.farmPests.enabled, action === 'disable', action + ':' + mode);
  }
});

test('loaded saves with reused IDs reject both old enable confirmations and old disable controls', () => {
  for (const action of ['enable', 'disable']) {
    const f = farm(), { G, b } = f;
    if (action === 'disable') enable(f); else f.get('toggle').click();
    const old = f.get(action === 'enable' ? 'confirm' : 'toggle'), oldGame = G.game, oldWorld = G.world;
    const restored = G.prepareSaveData(save(G)); G.world = restored.world; G.game = restored.game;
    assert.notEqual(G.game, oldGame); assert.notEqual(G.world, oldWorld);
    assert.notEqual(G.world.bmap[b.id], b); f.select(G.world.bmap[b.id]);
    old.click(); assert.equal(G.game.farmPests.enabled, action === 'disable');
    if (action === 'enable') { enable(f); assert.equal(G.game.farmPests.enabled, true); }
    else { f.get('toggle').click(); assert.equal(G.game.farmPests.enabled, false); }
  }
});

test('modal interruptions and replaced settings clear pending confirmations without changing the rules', () => {
  for (const viaRefresh of [false, true]) {
    const f = farm(), { G } = f;
    f.get('toggle').click(); G.hasOpenModal = () => true;
    if (viaRefresh) G.ui.refreshFarmInfo(f.b);
    f.get('confirm').click(); assert.equal(G.game.farmPests.enabled, false);
    G.hasOpenModal = () => false; f.get('confirm').click(); assert.equal(G.game.farmPests.enabled, false);
    f.get('toggle').click(); G.game.farmPests = { ...G.game.farmPests };
    if (viaRefresh) G.ui.refreshFarmInfo(f.b);
    f.get('confirm').click(); assert.equal(G.game.farmPests.enabled, false);
    assert(f.info.querySelector('[data-farm-pests-confirm]').classList.contains('hidden'));
    enable(f);
  }
});

test('warning counts down for two days before damage, without calling lost tiles harvested', () => {
  const f = infested(), { G, b } = f;
  assert.match(f.node('pestField').textContent, /预警中.*还有 2 天.*每天最多损失 6 格.*已虫损 0 格.*尚未收割 64 格/);
  advance(f, 13); assert.match(f.node('pestField').textContent, /还有 1 天/);
  assert.equal(G.farmSummary(b).harvested, 0); assert.equal(G.farmPestSummary(b).lost, 0);
  advance(f, 14);
  assert.match(f.node('pestField').textContent, /正在损失.*已虫损 6 格.*尚未收割 58 格/);
  assert.match(f.node('progress').textContent, /实际收获 0\/64.*虫害损失 6\/64/);
  assert.equal(G.farmSummary(b).harvested, 0);
  assert.equal(b.farm.filter(tile => tile.harvested).length, 6);
  G.advanceFarmPests(); G.ui.renderInfo(); assert.equal(G.farmPestSummary(b).lost, 6);
  advance(f, 15); assert.match(f.node('progress').textContent, /实际收获 0\/64.*虫害损失 12\/64/);
});

test('disable immediately clears all active fields and prevents later loss without refunds or cargo changes', () => {
  const f = infested(), { G, b } = f, other = f.building('farm');
  for (const tile of other.farm) tile.sown = true;
  other.sownAll = true; other.growth = .5;
  advance(f, 14); assert(G.farmPestSummary(other).active);
  const c = G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm' });
  c.carry = { type: 'grain', qty: 14 };
  const cargo = c.carry, stock = JSON.stringify(G.game.res), lost = G.farmPestSummary(b).lost;
  f.get('toggle').click();
  assert.equal(G.game.farmPests.enabled, false);
  assert.equal(b.pestInfestation, undefined); assert.equal(other.pestInfestation, undefined);
  assert.match(f.info.querySelector('[data-farm-message]').textContent, /活动虫害已清除.*已损失作物不返还.*库存和在途粮食不变/);
  assert.match(f.node('pestField').textContent, /已关闭.*已虫损 6 格/);
  for (const day of [15, 16, 17, 24, 25]) advance(f, day);
  assert.equal(G.farmPestSummary(b).lost, lost); assert.equal(G.farmPestSummary(other).lost, 0);
  assert.equal(c.carry, cargo); assert.equal(c.carry.qty, 14); assert.equal(JSON.stringify(G.game.res), stock);
  enable(f); assert.equal(G.game.farmPests.graceUntil, G.game.day + 12); assert.equal(G.farmPestSummary(b).lost, lost);
});

test('rotation remains seed-locked, then actual dropdown chooses next spring without curing the current crop', () => {
  const f = infested(), { G, b } = f;
  assert.match(f.node('rotation').textContent, /卷心菜未解锁.*贸易站购买种子/);
  assert.match(f.node('rotation').textContent, /本田已有小麦虫害记录.*未来复发风险/);
  const select = choose(f, 'cabbage'); assert.equal(select.value, 'wheat');
  assert.equal(G.farmPestSummary(b).rotationPlanned, false);
  const trader = f.building('tradingpost');
  trader.tradeInventory.firewood = 625;
  trader.merchant = { leaveDay: G.game.day + 12, stock: { cabbageSeed: 1 } };
  assert.equal(G.executeTrade(trader, 'cabbageSeed', 1, 'firewood').ok, true);
  G.ui.renderInfo();
  assert.equal(select.querySelectorAll('option').find(option => option.value === 'cabbage').disabled, false);
  assert.match(f.node('rotation').textContent, /可用上方作物选择/);
  choose(f, 'cabbage');
  assert.equal(G.farmCropOf(b), 'wheat'); assert.equal(G.cropChoiceOf(b), 'cabbage');
  assert.equal(G.farmPestSummary(b).rotationPlanned, true); assert.equal(G.farmPestSummary(b).active, true);
  assert.match(f.node('current').textContent, /本季作物：小麦/);
  assert.match(f.node('choice').textContent, /卷心菜.*下一春/);
  assert.match(f.node('rotation').textContent, /已选下一春种卷心菜，本季仍是小麦.*当前虫害不会因改选消失/);
  assert.match(f.node('rotation').textContent, /实际播下不同作物才重置复发风险.*只改下季选择不会重置/);
  assert.equal(b.lastPestCrop, 'wheat');
});

test('crop rotation risk is retained after selecting and is only cleared by real new-crop sowing', () => {
  const f = infested(true), { G, b } = f;
  choose(f, 'cabbage'); f.get('toggle').click();
  G.game.day = 47; G.game.season = 3; G.endDay(); G.game.h = 12; G.ui.renderInfo();
  assert.equal(G.farmCropOf(b), 'cabbage'); assert.equal(b.lastPestCrop, 'wheat');
  assert.match(f.node('current').textContent, /卷心菜/); assert.match(f.node('choice').textContent, /与本季一致/);
  const c = G.spawnCitizen({ x: b.x, y: b.y, age: 30, sex: 'm' }); c.job = b.id; b.workers = [c.id];
  G.requestTask(c); assert.equal(c.task.kind, 'sow');
  for (let i = 0; i < 1000 && !b.farm.some(tile => tile.sown); i++) G.stepCitizen(c, .1);
  assert(b.farm.some(tile => tile.sown)); assert.equal(b.lastPestCrop, undefined);
  G.ui.renderInfo(); assert.equal(G.farmPestSummary(b).recurrence, false);
});

test('pest damage refresh preserves original native-select drafts, buttons, focus and read-only state', () => {
  const f = infested(true), { G, b } = f;
  const select = f.info.querySelector('#farm-crop'), panel = f.info.querySelector('[data-farm-panel]'), toggle = f.get('toggle'), writes = f.info.htmlWrites;
  select.focus(); select.value = 'cabbage';
  for (const day of [13, 14, 15]) {
    advance(f, day);
    assert.equal(f.doc.activeElement, select); assert.equal(select.value, 'cabbage');
    assert.equal(G.cropChoiceOf(b), 'wheat'); assert.equal(f.info.htmlWrites, writes);
    assert.equal(f.info.querySelector('[data-farm-panel]'), panel); assert.equal(f.get('toggle'), toggle);
  }
  const snapshot = JSON.stringify(save(G));
  for (let i = 0; i < 5; i++) { G.ui.farmInfoData(b); G.ui.refreshFarmInfo(b); }
  assert.equal(JSON.stringify(save(G)), snapshot);
  f.doc.activeElement = null; G.ui.renderInfo(); assert.equal(select.value, 'wheat');
  assert.match(f.node('progress').textContent, /虫害损失 12\/64/);
});

test('early harvest still uses the canonical reduced quote, invalidates on pest loss and grants no instant food', () => {
  const f = infested(), { G, b } = f;
  const early = id => f.info.querySelector('#early-harvest-' + id);
  early('start').click(); const original = G.earlyHarvestQuote(b);
  assert.equal(original.estimated, 448); assert.equal(original.fullEstimated, 896);
  assert.equal(f.info.querySelector('[data-early-harvest-status]').textContent, G.ui.earlyHarvestText(original));
  assert.match(f.info.textContent, /等待能提高成熟产量.*等候和收割期间仍可能损失未收格/);
  advance(f, 14); early('confirm').click(); assert.equal(b.earlyHarvestYield, undefined);
  assert.match(f.info.querySelector('[data-farm-message]').textContent, /预计产量已变.*重新确认/);
  const q = G.earlyHarvestQuote(b), stock = JSON.stringify(G.game.res);
  assert.equal(q.remaining, 58); assert.equal(q.estimated, 406); assert.equal(q.fullEstimated, 812);
  early('start').click();
  assert.equal(f.info.querySelector('[data-early-harvest-quote]').textContent.startsWith(G.ui.earlyHarvestText(q)), true);
  early('confirm').click(); assert.equal(b.earlyHarvestYield, 7);
  assert.equal(JSON.stringify(G.game.res), stock); assert.equal(G.farmPestSummary(b).lost, 6);
  const c = G.spawnCitizen({ x: b.x, y: b.y, age: 30, sex: 'm' }); c.job = b.id; b.workers = [c.id];
  G.requestTask(c);
  for (let i = 0; i < 1000 && G.farmSummary(b).harvested < 1; i++) G.stepCitizen(c, .1);
  assert.equal(G.farmSummary(b).harvested, 1); assert.equal(G.farmPestSummary(b).lost, 6);
  G.ui.renderInfo(); assert.match(f.node('progress').textContent, /实际收获 1\/64.*虫害损失 6\/64/);
});

test('a fully lost field ends with loss wording rather than a fake full harvest', () => {
  const f = infested(), { G, b } = f, stock = JSON.stringify(G.game.res);
  for (let day = 13; day <= 24; day++) advance(f, day);
  assert.equal(G.farmPestSummary(b).active, false); assert.equal(G.farmPestSummary(b).lost, 64);
  assert.equal(G.farmSummary(b).harvested, 0); assert.equal(b.harvestDone, true);
  assert.match(f.node('status').textContent, /本季已结束（含虫害损失）/);
  assert.match(f.node('progress').textContent, /实际收获 0\/64.*虫害损失 64\/64/);
  assert.match(f.node('pestField').textContent, /当前无活动虫害.*已虫损 64 格.*尚未收割 0 格/);
  assert.equal(f.info.querySelector('#early-harvest-start').disabled, true);
  assert.equal(JSON.stringify(G.game.res), stock);
});

console.log(`Farm pests UI: ${passed} DOM and live-simulation suites passed (browser visual acceptance not performed).`);
