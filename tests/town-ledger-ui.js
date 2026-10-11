/* Read-only town flow ledger and stable disclosure/nomad controls. DOM QA, not browser visual acceptance. */
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
      emit(type, props = {}) { for (const fn of handlers[type] || []) fn({target: this, preventDefault() {}, ...props}); },
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
  for (const name of ['core', 'defs', 'map', 'sim', 'render', 'ui', 'main'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.game.h = 12; G.rng = G.makeRng(917); G.setUid(1);
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
function test(name, fn) { fn(); console.log('ok ' + name); passed++; }
const live = (f, key) => f.info.querySelector(`[data-townhall="${key}"]`);
function town() {
  const f = fixture(), { G } = f, b = f.building('townhall');
  const s = { population: 12, adults: 8, children: 4, educated: 3, homelessFamilies: 2,
    freeHomes: 1, boardingSlots: 0, averageHealth: 3.75, sick: 1, doctors: 0, herbs: 5,
    foodDays: 20, offer: null, offerPeople: 5, offerAdults: 4, offerChildren: 1, offerFamilies: 2,
    foodDaysAfter: 14.1, addedFoodPerDay: 10.4, addedFuelPerWinter: 60,
    arriving: 0, nextDay: 30, accepted: 0, declined: 0 };
  G.townHallSummary = hall => ({ ...s, offer: s.offer && s.offer.hallId === hall.id ? s.offer : null });
  const calls = [];
  G.decideNomads = (hall, id, accept) => {
    calls.push({ hall, id, accept });
    if (!s.offer || s.offer.id !== id) return { ok: false, reason: '申请已过期' };
    if (accept) { s.accepted += s.offerPeople; s.arriving = s.offerPeople; }
    else s.declined += s.offerPeople;
    s.offer = null;
    return { ok: true, count: s.offerPeople };
  };
  function offer(id = 7) { s.offer = { id, hallId: b.id, expiresDay: 42,
    families: [{ fatherAge: 28, motherAge: 27, childAges: [4] }, { fatherAge: 32, motherAge: 30, childAges: [] }], sickCount: 1 }; }
  return { ...f, b, s, calls, offer };
}

const flow = (f, resource, period, metric) => live(f, `flow-${resource}-${period}-${metric}`).textContent;
const json = value => JSON.stringify(value);
function beginLedger(f, day = 0, hour = 6) {
  const { G } = f, g = G.game;
  g.day = day; g.h = hour; g.season = G.seasonOf(day); g.year = Math.floor(day / G.YEAR_DAYS) + 1;
  g.townLedger = G.newTownLedger(g);
}
// Build real, balanced ledger buckets through the ledger's recording/rollover
// primitives. Core production-event coverage belongs to town-ledger.js.
function addFlows(f, flows) {
  const { G } = f;
  for (const resource of G.LEDGER_RES) {
    const row = flows[resource] || {};
    for (const metric of G.LEDGER_METRICS) G.ledgerRecord(metric, resource, row[metric] || 0);
    G.game.res[resource] += (row.received || 0) - (row.used || 0) - (row.withdrawn || 0);
  }
  G.game.res.food = G.FOOD_KEYS.reduce((total, key) => total + G.game.res[key], 0);
}
function history(f, count, flows = () => ({}), day = 0, hour = 6) {
  beginLedger(f, day, hour);
  for (let i = 0; i < count; i++) {
    addFlows(f, flows(i)); f.G.closeTownLedgerDay();
    f.G.game.day++; f.G.game.h = 0;
  }
  f.G.game.h = 18.25; f.G.game.season = f.G.seasonOf(f.G.game.day);
  f.G.game.year = Math.floor(f.G.game.day / f.G.YEAR_DAYS) + 1;
}
function load(f, saved) {
  if (!f.doc.getElementById('over')) f.mount('over');
  f.G.T2S = () => [0, 0]; f.G.cam = { x: 0, y: 0, z: 1 }; f.G.groundDirty = new Set();
  f.G.applySaveData(saved); f.b = f.G.world.bmap[f.b.id]; f.select(f.b);
}

test('missing API and old stock snapshots never become invented zero-production history', () => {
  const f = town(); delete f.G.townLedgerSummary;
  f.G.game.hist = [{ d: 1, pop: 20, born: 2, food: 700, firewood: 30 }]; f.G.game.day = 1;
  f.select(f.b);
  assert.match(live(f, 'flowCoverage').textContent, /尚未开始记录.*旧库存快照不能还原产出/);
  assert.match(live(f, 'flowRecentRange').textContent, /尚无完整日记录.*不是零产出/);
  assert.equal(flow(f, 'food', 'recent', 'produced'), '—');
  assert.equal(flow(f, 'firewood', 'current', 'used'), '—');
  assert.equal(flow(f, 'food', 'difference', 'delta'), '—');
  assert.match(live(f, 'food').textContent, /食物 500/);
});

test('new-game first day starts at 06:00 and never projects its partial output to a full day', () => {
  const f = town(); beginLedger(f); f.G.game.h = 10.25;
  addFlows(f, { grain: { produced: 4.25, received: 3.5 } }); f.select(f.b);
  assert.match(live(f, 'flowTodayRange').textContent, /第 1 天.*1年春1日.*06:00–10:15/);
  assert.match(live(f, 'flowCoverage').textContent, /已结算 0 天，其中 0 个完整日.*首日不足全天/);
  assert.equal(flow(f, 'food', 'current', 'produced'), '4.25');
  assert.equal(flow(f, 'food', 'recent', 'produced'), '—');
  assert.equal(flow(f, 'food', 'difference', 'produced'), '—');
  assert.match(live(f, 'flowTodayCoverage').textContent, /未折算全天/);
});

test('legacy mid-day start shows actual observed zero separately from unknown history without mutating game', () => {
  const f = town(); f.G.game.day = 10; f.G.game.h = 9.5; delete f.G.game.townLedger;
  const before = json(f.G.game); f.select(f.b);
  assert.equal(json(f.G.game), before); assert.equal(f.G.game.townLedger, undefined);
  assert.match(live(f, 'flowCoverage').textContent, /第 11 天 09:30.*更早流水未知.*已结算 0 天.*首日不足全天/);
  assert.match(live(f, 'flowTodayRange').textContent, /第 11 天.*1年春11日.*09:30–09:30/);
  assert.match(live(f, 'flowTodayCoverage').textContent, /首日不足全天.*未折算全天.*不纳入上方比较/);
  assert.equal(flow(f, 'food', 'current', 'produced'), '0');
  assert.equal(flow(f, 'food', 'current', 'opening'), '500');
  assert.equal(flow(f, 'food', 'recent', 'produced'), '—');
  assert.equal(flow(f, 'food', 'previous', 'opening'), '—');
  for (let i = 0; i < 5; i++) f.G.ui.renderInfo();
  assert.equal(json(f.G.game), before);
});

test('partial first day is excluded; short windows show real totals and exact ranges with no difference', () => {
  const f = town(); history(f, 4, i => ({ grain: { produced: i === 0 ? 900 : 1.25 } }));
  f.select(f.b);
  assert.match(live(f, 'flowCoverage').textContent, /已结算 4 天，其中 3 个完整日.*首日不足全天/);
  assert.match(live(f, 'flowRecentRange').textContent, /第 2–4 天.*1年春2日 → 1年春4日.*3 个完整日，未满 12 天/);
  assert.equal(flow(f, 'food', 'recent', 'produced'), '3.75');
  assert.equal(flow(f, 'food', 'previous', 'produced'), '—');
  assert.equal(flow(f, 'food', 'difference', 'produced'), '—');
  assert.match(live(f, 'flowComparison').textContent, /需两个各 12 天.*0 表示已记录的零/);
  history(f, 18, () => ({})); f.G.ui.renderInfo();
  assert.match(live(f, 'flowRecentRange').textContent, /12 个完整日/);
  assert.match(live(f, 'flowPreviousRange').textContent, /5 个完整日，未满 12 天/);
  assert.equal(flow(f, 'food', 'recent', 'produced'), '0');
  assert.equal(flow(f, 'food', 'previous', 'produced'), '0');
  assert.equal(flow(f, 'food', 'difference', 'produced'), '—');
});

test('two complete windows show derived food only once, arithmetic differences and separate current-day flows', () => {
  const f = town();
  history(f, 25, i => ({
    meat: { produced: i === 0 ? 888 : i <= 12 ? .125 : .25, received: .25 },
    vegetables: { produced: i <= 12 ? .25 : .5, received: .5 },
    grain: { produced: i <= 12 ? .375 : .75, received: .75, used: .125, withdrawn: .25 },
    firewood: { produced: i <= 12 ? 2.5 : 1.25, received: 1, used: 1.5, discarded: .25 },
  }));
  addFlows(f, { meat: { produced: 999, received: .125 }, firewood: { produced: 777, received: .25 } });
  f.select(f.b);
  assert.match(live(f, 'flowRecentRange').textContent, /第 14–25 天.*1年夏2日 → 1年秋1日/);
  assert.match(live(f, 'flowPreviousRange').textContent, /第 2–13 天.*1年春2日 → 1年夏1日/);
  assert.match(live(f, 'flowComparison').textContent, /差额 = 近期 − 前期.*季节不同/);
  assert.equal(flow(f, 'meat', 'recent', 'produced'), '3');
  assert.equal(flow(f, 'vegetables', 'recent', 'produced'), '6');
  assert.equal(flow(f, 'grain', 'recent', 'produced'), '9');
  assert.equal(flow(f, 'food', 'recent', 'produced'), '18');
  assert.equal(flow(f, 'food', 'previous', 'produced'), '9');
  assert.equal(flow(f, 'food', 'difference', 'produced'), '+9');
  assert.equal(flow(f, 'firewood', 'difference', 'produced'), '−15');
  assert.equal(flow(f, 'food', 'recent', 'received'), '18');
  assert.equal(flow(f, 'food', 'recent', 'used'), '1.5');
  assert.equal(flow(f, 'food', 'recent', 'withdrawn'), '3');
  assert.equal(flow(f, 'food', 'recent', 'delta'), '+13.5');
  assert.equal(flow(f, 'firewood', 'recent', 'delta'), '−6');
  assert.equal(flow(f, 'food', 'current', 'produced'), '999');
  assert.equal(flow(f, 'firewood', 'current', 'produced'), '777');
  assert.match(live(f, 'flowTodayRange').textContent, /第 26 天.*00:00–18:15/);
  assert.match(live(f, 'flowTodayCoverage').textContent, /尚未结算.*未折算全天/);
});

test('fractional quantities remain visible; comparisons subtract raw totals before rounding', () => {
  const f = town(); history(f, 24, i => ({ grain: { produced: i === 0 ? .006 : i === 12 ? 1.004 : 0 } }), 0, 0);
  addFlows(f, { grain: { produced: .004, received: .003, used: .002 } }); f.select(f.b);
  assert.equal(flow(f, 'food', 'recent', 'produced'), '1');
  assert.equal(flow(f, 'food', 'previous', 'produced'), '<0.01');
  assert.equal(flow(f, 'food', 'difference', 'produced'), '+1');
  assert.equal(flow(f, 'food', 'current', 'produced'), '<0.01');
  assert.equal(flow(f, 'food', 'current', 'delta'), '+<0.01');
  assert.equal(flow(f, 'firewood', 'difference', 'produced'), '0');
  const ledger = f.info.querySelector('[data-townledger-panel]');
  for (const label of ['真实产出', '实际入库', '居民食用', '住宅燃烧', '出库转运', '仓满弃货', '库存净变']) assert(ledger.textContent.includes(label), label);
  assert.match(ledger.textContent, /包含贸易运回与酿酒退料/);
  assert.match(ledger.textContent, /不等于已卖出或永久消耗/);
  assert.match(ledger.textContent, /等待空位的保留货物不算损失/);
  assert.match(ledger.textContent, /未满足的需求不计入/);
  assert.match(ledger.textContent, /真实产出与仓满弃货不加入这个库存等式/);
  assert.match(ledger.textContent, /产出减入库不等于携带中的货物/);
  assert.match(ledger.textContent, /窗口为本作的 12 天，留存为 48 天/);
});

test('live refresh preserves food/help disclosures, cells, keyboard focus and pending nomad controls without writes to ledger', () => {
  const f = town(); history(f, 25); f.offer(); f.select(f.b);
  const panel = f.info.querySelector('[data-townledger-panel]'), food = f.info.querySelector('[data-townledger-food]');
  const help = f.info.querySelector('[data-townledger-help]'), cell = live(f, 'flow-food-current-produced');
  const accept = f.doc.getElementById('townhall-accept'), holder = f.info.querySelector('[data-townhall-offer]');
  const writes = f.info.htmlWrites, offerWrites = holder.htmlWrites;
  panel.open = food.open = help.open = true; accept.focus();
  addFlows(f, { grain: { produced: 1.25, received: .75 } });
  const before = json(f.G.game), beforeWorld = json(f.G.world);
  for (let i = 0; i < 5; i++) f.G.ui.renderInfo();
  assert.equal(json(f.G.game), before); assert.equal(json(f.G.world), beforeWorld);
  assert.equal(f.info.htmlWrites, writes); assert.equal(holder.htmlWrites, offerWrites);
  assert.equal(f.doc.activeElement, accept); assert.equal(f.doc.getElementById('townhall-accept'), accept);
  assert.equal(f.info.querySelector('[data-townledger-panel]'), panel); assert(panel.open && food.open && help.open);
  assert.equal(live(f, 'flow-food-current-produced'), cell); assert.equal(cell.textContent, '1.25');
  const summary = food.querySelector('summary'); summary.focus();
  const cellWrites = cell.textWrites;
  for (let i = 0; i < 3; i++) f.G.ui.renderInfo();
  assert.equal(f.doc.activeElement, summary); assert.equal(cell.textWrites, cellWrites); assert.equal(f.calls.length, 0);
  assert.match(live(f, 'food').textContent, /现有人口约够/);
  assert.match(live(f, 'fuel').textContent, /柴火/);
  assert.match(live(f, 'tools').textContent, /工具/);
  accept.click(); accept.click(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].accept, true);
  assert.equal(f.info.querySelector('[data-townledger-panel]'), panel); assert(food.open && help.open);
  assert.match(live(f, 'arriving').textContent, /迁入途中 5 人/);
});

test('same-ID actual save reload restores its ledger; legacy reload clears previous table values and stale nomad callbacks', () => {
  const f = town(); history(f, 25, () => ({ grain: { produced: 2.5 } })); f.offer(); f.select(f.b);
  const oldPanel = f.info.querySelector('[data-townledger-panel]'), oldAccept = f.doc.getElementById('townhall-accept');
  const saved = JSON.parse(json(f.G.serializeGame()));
  assert.equal(flow(f, 'food', 'recent', 'produced'), '30');
  addFlows(f, { grain: { produced: 99 } }); f.G.ui.renderInfo();
  assert.equal(flow(f, 'food', 'current', 'produced'), '99');
  load(f, saved); oldAccept.click(); assert.equal(f.calls.length, 0);
  assert.notEqual(f.info.querySelector('[data-townledger-panel]'), oldPanel);
  assert.equal(flow(f, 'food', 'recent', 'produced'), '30');
  assert.equal(flow(f, 'food', 'current', 'produced'), '0');
  const restored = f.info.querySelector('[data-townledger-panel]');
  const legacy = JSON.parse(json(saved)); delete legacy.game.townLedger;
  legacy.game.day = 31; legacy.game.season = 2; legacy.game.h = 11.75;
  load(f, legacy);
  assert.notEqual(f.info.querySelector('[data-townledger-panel]'), restored);
  assert.equal(flow(f, 'food', 'recent', 'produced'), '—');
  assert.equal(flow(f, 'food', 'previous', 'produced'), '—');
  assert.equal(flow(f, 'food', 'difference', 'produced'), '—');
  assert.equal(flow(f, 'food', 'current', 'produced'), '0');
  assert.match(live(f, 'flowTodayRange').textContent, /第 32 天.*11:45–11:45/);
  assert.match(live(f, 'flowCoverage').textContent, /已结算 0 天/);
});

test('retained windows use their actual year/season ranges and never claim the first partial day is complete', () => {
  const f = town(); history(f, 51, () => ({ grain: { produced: 1 } })); f.select(f.b);
  assert.match(live(f, 'flowCoverage').textContent, /已结算 48 天，其中 48 个完整日/);
  assert.match(live(f, 'flowRecentRange').textContent, /第 40–51 天.*1年冬4日 → 2年春3日/);
  assert.match(live(f, 'flowPreviousRange').textContent, /第 28–39 天.*1年秋4日 → 1年冬3日/);
  assert.equal(flow(f, 'food', 'recent', 'produced'), '12');
  assert.equal(flow(f, 'food', 'previous', 'produced'), '12');
  assert.equal(flow(f, 'food', 'difference', 'produced'), '0');
});

console.log(`Town flow ledger UI: ${passed} suites passed (DOM fixture, actual summary/save APIs; browser visual acceptance not performed).`);
