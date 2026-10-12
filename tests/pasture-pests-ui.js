/* Optional pasture disease and explicit whole-herd emptying.
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
const node = (f, attr) => f.info.querySelector('[data-' + attr + ']');
const message = f => node(f, 'economy-message').textContent;
const click = (f, id, detail = 1) => input(f, 'pasture-' + id).click(detail);
function setup(count = 4, type = 'chicken') {
  const f = fixture();
  f.b = f.building('pasture', { animalType: type, animals: count });
  f.target = f.building('pasture', { animalType: type });
  f.G.game.livestock = { sheep: 4, cattle: 4, chicken: 4 }; f.G.game.h = 12;
  f.select(f.b); return f;
}
function enable(f) { click(f, 'pests-toggle'); click(f, 'pests-confirm'); }
function infect(f, lost = 0) {
  const p = f.G.game.pasturePests;
  p.enabled = true; p.graceUntil = 0; p.lastDay = -1;
  f.b.pastureInfestation = { animalType: f.G.pastureTypeOf(f.b), startedDay: f.G.game.day, lost };
  f.G.ui.refreshEconomyInfo(f.b);
}
function preview(f) { click(f, 'empty-start'); assert(node(f, 'pasture-empty')._emptyQuote); }

function stale(f, mode, control) {
  if (mode === 'selection') f.select(f.target);
  if (mode === 'dom') { f.G.ui._infoWorld = null; f.G.ui.renderInfo(true); }
  if (mode === 'hidden') f.info.classList.add('hidden');
  if (mode === 'modal') f.G.hasOpenModal = () => true;
  if (mode === 'world') f.G.world = { ...f.G.world };
  if (mode === 'game') f.G.game = { ...f.G.game };
  if (mode === 'element') f.G.ui.el.info = f.mount('replacement-info');
  if (mode === 'removed') delete f.G.world.bmap[f.b.id];
  if (mode === 'replacement') f.G.world.bmap[f.b.id] = { ...f.b };
  if (mode === 'site') f.b.state = 'site';
  if (mode === 'type') f.b.type = 'orchard';
  if (mode === 'closed') f.G.ui.hideInfo();
  if (mode === 'control') control.id = 'detached-old-control';
}
const staleModes = ['selection', 'dom', 'hidden', 'modal', 'world', 'game', 'element', 'removed', 'replacement', 'site', 'type', 'closed', 'control'];

test('default-off controls disclose optional town-wide scope, grace, warning, loss, cap and non-refundable death', () => {
  const f = setup();
  assert.equal(f.G.game.pasturePests.enabled, false);
  assert.match(node(f, 'pasture-pests-status').textContent, /全镇牧场疫病：已关闭/);
  assert.match(f.info.textContent, /新局和旧档默认关闭.*12天宽限.*最多1座.*预警2天.*病死1只\/头.*不返还/);
  assert.equal(input(f, 'pasture-pests-toggle').getAttribute('aria-expanded'), 'false');
  assert.match(f.info.textContent, /每场每天1\.2%的基础概率/);
  click(f, 'pests-toggle');
  assert.equal(f.G.game.pasturePests.enabled, false);
  assert.equal(f.doc.activeElement, input(f, 'pasture-pests-confirm'));
  assert.match(node(f, 'pasture-pests-quote').textContent, /全镇所有牧场.*12天宽限.*最多1场.*预警2天.*病死1只\/头.*不返还.*同种.*容量.*正常屠宰.*本作适配/);
});

test('cancel returns focus without enabling and double confirmation changes settings only once', () => {
  const f = setup(), toggle = input(f, 'pasture-pests-toggle');
  click(f, 'pests-toggle'); click(f, 'pests-cancel');
  assert.equal(f.G.game.pasturePests.enabled, false); assert.equal(f.doc.activeElement, toggle);
  assert(node(f, 'pasture-pests-confirm').classList.contains('hidden'));
  let calls = 0; const set = f.G.setPasturePests;
  f.G.setPasturePests = (...args) => { calls++; return set(...args); };
  enable(f); assert.equal(f.doc.activeElement, toggle);
  input(f, 'pasture-pests-confirm').emit('click', 2); input(f, 'pasture-pests-confirm').emit('click');
  assert.equal(calls, 1); assert.equal(f.G.game.pasturePests.enabled, true);
  assert.equal(f.G.game.pasturePests.graceUntil, f.G.game.day + 12);
  assert.equal(f.doc.activeElement, toggle);
  f.G.ui.refreshEconomyInfo(f.b); assert.match(node(f, 'pasture-pests-status').textContent, /宽限还剩 12 天/);
});

test('day, settings replacement and livestock changes invalidate an unconfirmed enable preview', () => {
  for (const mode of ['day', 'settings', 'herd']) for (const refresh of [false, true]) {
    const f = setup(); click(f, 'pests-toggle');
    if (mode === 'day') f.G.game.day++;
    if (mode === 'settings') f.G.game.pasturePests = { ...f.G.game.pasturePests };
    if (mode === 'herd') f.b.animals--;
    let calls = 0; f.G.setPasturePests = () => { calls++; return true; };
    if (refresh) f.G.ui.refreshEconomyInfo(f.b);
    click(f, 'pests-confirm'); assert.equal(calls, 0, mode + ':' + refresh); assert.equal(f.G.game.pasturePests.enabled, false);
  }
});

// Model native keyboard activation only when keydown was not canceled. This is
// a DOM contract, not a claim about visual or physical browser acceptance.
function keyboardActivate(button, key, repeat) {
  const event = button.emit('keydown', { key, repeat });
  if (!event.defaultPrevented) button.emit('click', 0);
  return event;
}

test('held Enter or Space cannot follow preview focus and confirm town-wide disease or a whole-herd move', () => {
  for (const key of ['Enter', ' ']) for (const kind of ['pests', 'empty']) {
    const f = setup(2), start = input(f, `pasture-${kind}-${kind === 'pests' ? 'toggle' : 'start'}`);
    const confirm = input(f, `pasture-${kind}-confirm`);
    assert.equal(keyboardActivate(start, key, false).defaultPrevented, false);
    assert.equal(f.doc.activeElement, confirm);
    for (let i = 0; i < 3; i++) assert.equal(keyboardActivate(confirm, key, true).defaultPrevented, true);
    assert.equal(f.G.game.pasturePests.enabled, false); assert.equal(f.b.animals, 2); assert.equal(f.target.animals, 0);
    assert(node(f, `pasture-${kind}`)[kind === 'pests' ? '_pestEnable' : '_emptyQuote']);
    confirm.emit('keyup', { key, repeat: false });
    assert.equal(keyboardActivate(confirm, key, false).defaultPrevented, false);
    if (kind === 'pests') assert.equal(f.G.game.pasturePests.enabled, true);
    else { assert.equal(f.b.animals, 0); assert.equal(f.target.animals, 2); }
  }
});

test('every pasture start, confirm and cancel button suppresses repeated activation but preserves fresh key presses', () => {
  for (const key of ['Enter', ' ']) for (const kind of ['pests', 'empty']) {
    const f = setup(2), start = input(f, `pasture-${kind}-${kind === 'pests' ? 'toggle' : 'start'}`);
    const cancel = input(f, `pasture-${kind}-cancel`), confirm = input(f, `pasture-${kind}-confirm`);
    assert.equal(keyboardActivate(start, key, true).defaultPrevented, true);
    assert.equal(node(f, `pasture-${kind}`)[kind === 'pests' ? '_pestEnable' : '_emptyQuote'], null);
    keyboardActivate(start, key, false);
    for (const button of [start, confirm, cancel]) assert.equal(keyboardActivate(button, key, true).defaultPrevented, true);
    assert(node(f, `pasture-${kind}`)[kind === 'pests' ? '_pestEnable' : '_emptyQuote']);
    assert.equal(f.G.game.pasturePests.enabled, false); assert.equal(f.b.animals, 2); assert.equal(f.target.animals, 0);
    assert.equal(cancel.emit('keydown', { key: 'Tab', repeat: true }).defaultPrevented, false);
    assert.equal(keyboardActivate(cancel, key, false).defaultPrevented, false);
    assert.equal(node(f, `pasture-${kind}`)[kind === 'pests' ? '_pestEnable' : '_emptyQuote'], null);
    assert.equal(f.doc.activeElement, start);
  }
});

test('detached enable, cancel and disable controls cannot act after every context interruption', () => {
  for (const mode of staleModes) for (const action of ['pests-confirm', 'pests-toggle', 'pests-cancel']) {
    const f = setup();
    if (action === 'pests-toggle') enable(f); else click(f, 'pests-toggle');
    const button = input(f, 'pasture-' + action), enabled = f.G.game.pasturePests.enabled;
    let calls = 0; f.G.setPasturePests = () => { calls++; return true; };
    stale(f, mode, button); button.emit('click');
    assert.equal(calls, 0, mode + ':' + action); assert.equal(f.G.game.pasturePests.enabled, enabled);
  }
});

test('closing an expired preview does not steal focus from another field or a modal', () => {
  for (const modal of [false, true]) {
    const f = setup(); click(f, 'pests-toggle');
    const focus = modal ? f.mount('modal-control') : input(f, 'pasture-target-quantity'); focus.focus();
    f.G.game.day++; if (modal) f.G.hasOpenModal = () => true;
    f.G.ui.refreshEconomyInfo(f.b);
    assert.equal(f.doc.activeElement, focus); assert(node(f, 'pasture-pests-confirm').classList.contains('hidden'));
    assert.equal(node(f, 'pasture-pests')._pestEnable, null);
  }
});

test('turning disease off clears the active event without restoring dead animals or clearing products', () => {
  const f = setup(3); infect(f, 2); f.b.pastureProducts.eggs = 9;
  const before = f.b.animals; click(f, 'pests-toggle');
  assert.equal(f.G.game.pasturePests.enabled, false); assert(!f.b.pastureInfestation);
  assert.equal(f.b.animals, before); assert.equal(f.b.pastureProducts.eggs, 9);
  assert.match(message(f), /清除1座.*已病死牲畜不返还.*产物和携货保留/);
});

test('active warning, mortality, loss count and stocking guard update without clearing draft inputs', () => {
  const f = setup(5); infect(f, 1);
  const field = input(f, 'pasture-target-quantity'); field.value = '19'; field.focus(); const writes = f.info.htmlWrites;
  assert.match(node(f, 'pasture-pests-field').textContent, /预警.*2天.*本次已病死 1 只.*不能拆除.*新畜/);
  assert(input(f, 'pasture-stock').disabled); assert(input(f, 'info-demolish').disabled);
  input(f, 'pasture-stock-quantity').value = '1'; input(f, 'pasture-stock-form').emit('submit');
  assert.equal(f.b.animals, 5); assert.equal(f.G.game.livestock.chicken, 4); assert.match(message(f), /正在染疫/);
  f.G.game.day = 2; f.G.advancePasturePests(); f.G.ui.renderInfo();
  assert.equal(f.b.animals, 4); assert.match(node(f, 'pasture-pests-field').textContent, /染疫中.*本次已病死 2 只/);
  assert.equal(field.value, '19'); assert.equal(f.doc.activeElement, field); assert.equal(f.info.htmlWrites, writes);
});

test('whole-herd move remains available below ten for each species while split stays blocked', () => {
  for (const type of ['sheep', 'cattle', 'chicken']) for (const count of [1, 2, 9]) {
    const f = setup(count, type); assert(input(f, 'pasture-split-start').disabled);
    assert(!input(f, 'pasture-empty-start').disabled); preview(f); click(f, 'empty-confirm');
    assert.equal(f.b.animals, 0); assert.equal(f.target.animals, count);
    assert.match(message(f), /源场归零.*清除疫病/);
  }
});

test('empty preview explains retained target and slaughter risk; cancel preserves herd and restores focus', () => {
  const f = setup(12); f.target.animalTarget = 8; f.G.ui.refreshEconomyInfo(f.b); preview(f);
  assert.match(node(f, 'pasture-empty-quote').textContent, /全部12只鸡.*归零.*不模拟逐头赶路.*仍为8只.*超出4只.*正常屠宰.*实际照料.*已产鸡蛋、未成蛋进度、羊毛、肉皮、携货和工人/);
  assert.equal(f.target.animalTarget, 8); assert.equal(f.target.animals, 0);
  click(f, 'empty-cancel'); assert.equal(f.doc.activeElement, input(f, 'pasture-empty-start'));
  assert.equal(f.b.animals, 12); assert.equal(node(f, 'pasture-empty')._emptyQuote, null);
  assert.equal(input(f, 'pasture-empty-start').getAttribute('aria-expanded'), 'false');
});

test('moving infected herd clears source epidemic once and leaves products, egg progress, workers and carried cargo intact', () => {
  const f = setup(6); infect(f, 2); f.b.eggProgress = .75; f.b.wool = 2;
  f.b.pastureProducts = { eggs: 7, meat: 6, leather: 3 }; f.b.animalGrowth = .6;
  const c = f.G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm' });
  c.job = f.b.id; f.b.workers = [c.id]; c.carry = { type: 'eggs', qty: 4, pastureId: f.b.id };
  f.target.tendedDay = f.G.game.day; const carry = c.carry, products = f.b.pastureProducts;
  f.G.ui.refreshEconomyInfo(f.b); preview(f);
  let calls = 0; const move = f.G.emptyPasture; f.G.emptyPasture = (...args) => { calls++; return move(...args); };
  click(f, 'empty-confirm'); assert.equal(f.doc.activeElement, input(f, 'info-close'));
  input(f, 'pasture-empty-confirm').emit('click', 2); input(f, 'pasture-empty-confirm').emit('click');
  assert.equal(f.doc.activeElement, input(f, 'info-close')); assert(!input(f, 'info-demolish').disabled);
  assert.equal(calls, 1); assert.equal(f.b.animals, 0); assert.equal(f.target.animals, 6); assert(!f.b.pastureInfestation);
  assert.equal(f.b.pastureProducts, products); assert.equal(f.b.eggProgress, .75); assert.equal(f.b.wool, 2);
  assert.equal(c.carry, carry); assert.equal(c.job, f.b.id); assert.deepEqual(Array.from(f.b.workers), [c.id]);
  assert.equal(f.target.animalTarget, 8); assert.equal(f.target.tendedDay, undefined); assert.equal(f.target.animalGrowth, .6);
});

test('no eligible destination explains a same-species reserve pen and blocks empty confirmation', () => {
  const f = setup(); f.target.animalType = 'sheep'; f.G.ui.refreshEconomyInfo(f.b);
  assert(input(f, 'pasture-empty-start').disabled); assert.match(node(f, 'pasture-empty-status').textContent, /同种.*备用空场/);
  click(f, 'empty-start'); click(f, 'empty-confirm'); assert.equal(f.b.animals, 4); assert.equal(f.target.animals, 0);
});

test('occupied, unfinished, undersized, product-laden and unreachable destinations cannot receive a herd', () => {
  for (const mode of ['occupied', 'site', 'capacity', 'products', 'route']) {
    const f = setup();
    if (mode === 'occupied') f.target.animals = 1;
    if (mode === 'site') f.target.state = 'site';
    if (mode === 'capacity') f.b.animals = 25;
    if (mode === 'products') f.target.pastureProducts.eggs = 1;
    if (mode === 'route') f.G.workSpot = () => null;
    f.G.ui.refreshEconomyInfo(f.b); const count = f.b.animals;
    click(f, 'empty-start'); assert.equal(node(f, 'pasture-empty')._emptyQuote, null, mode);
    click(f, 'empty-confirm'); assert.equal(f.b.animals, count, mode);
  }
});

test('day, death, herd, species, retention, growth, navigation and epidemic changes invalidate whole-herd quotes', () => {
  const mutations = {
    day: f => f.G.game.day++, death: f => { infect(f); f.G.game.day = 2; f.G.advancePasturePests(); },
    herd: f => f.b.animals++, species: f => { f.b.animalType = f.target.animalType = 'sheep'; },
    sourceTarget: f => f.b.animalTarget++, targetTarget: f => f.target.animalTarget++,
    growth: f => f.b.animalGrowth = .5, targetGrowth: f => f.target.animalGrowth = .5,
    navigation: f => f.G.world.navigationRevision = 1,
    event: f => { f.b.pastureInfestation = { animalType: 'chicken', startedDay: 0, lost: 0 }; },
    settings: f => f.G.game.pasturePests.enabled = true,
    targetOccupied: f => f.target.animals = 1, targetReplaced: f => f.G.world.bmap[f.target.id] = { ...f.target },
  };
  for (const [mode, mutate] of Object.entries(mutations)) for (const refresh of [false, true]) {
    const f = setup(); preview(f); mutate(f); let calls = 0;
    f.G.emptyPasture = () => { calls++; return { ok: true, qty: 4, type: 'chicken' }; };
    if (refresh) f.G.ui.refreshEconomyInfo(f.b);
    click(f, 'empty-confirm'); assert.equal(calls, 0, mode + ':' + refresh);
  }
});

test('actual daily mortality expires a pending move and a new preview uses only surviving animals', () => {
  const f = setup(6); infect(f); preview(f);
  f.G.game.day = 2; f.G.advancePasturePests();
  assert.equal(f.b.animals, 5); click(f, 'empty-confirm');
  assert.equal(f.b.animals, 5); assert.equal(f.target.animals, 0); assert.match(message(f), /重新查看/);
  preview(f); assert.match(node(f, 'pasture-empty-quote').textContent, /全部5只鸡/);
  click(f, 'empty-confirm'); assert.equal(f.b.animals, 0); assert.equal(f.target.animals, 5);
  assert(!f.b.pastureInfestation); assert.equal(f.G.game.res.meat, 0);
});

test('target change cancels the preview and a new preview binds to the newly chosen exact building', () => {
  const f = setup(), other = f.building('pasture', { animalType: 'chicken' }); f.G.ui.refreshEconomyInfo(f.b);
  preview(f); const target = input(f, 'pasture-empty-target'); target.value = String(other.id); target.emit('change');
  assert.equal(node(f, 'pasture-empty')._emptyQuote, null); click(f, 'empty-confirm'); assert.equal(f.b.animals, 4);
  preview(f); click(f, 'empty-confirm'); assert.equal(other.animals, 4); assert.equal(f.target.animals, 0);
});

test('interrupted empty start, confirm and cancel handlers never submit or steal focus', () => {
  for (const mode of staleModes) for (const action of ['empty-start', 'empty-confirm', 'empty-cancel']) {
    const f = setup(); if (action !== 'empty-start') preview(f);
    const button = input(f, 'pasture-' + action); let calls = 0;
    f.G.emptyPasture = () => { calls++; return { ok: true, qty: 4, type: 'chicken' }; };
    stale(f, mode, button); const external = f.mount('other-focus'); external.focus(); button.emit('click');
    assert.equal(calls, 0, mode + ':' + action); assert.equal(f.b.animals, 4); assert.equal(f.doc.activeElement, external);
  }
});

test('expired move preview restores focus only from its hidden controls and preserves target selection and typed retention', () => {
  for (const focusInPreview of [true, false]) {
    const f = setup(); preview(f);
    const field = input(f, 'pasture-target-quantity'); field.value = '21'; if (!focusInPreview) field.focus();
    const select = input(f, 'pasture-empty-target'), selection = select.value, writes = f.info.htmlWrites;
    f.G.game.day++; f.G.ui.renderInfo();
    assert.equal(f.info.htmlWrites, writes); assert.equal(field.value, '21'); assert.equal(select.value, selection);
    assert.equal(f.doc.activeElement, focusInPreview ? input(f, 'pasture-empty-start') : field);
    assert(node(f, 'pasture-empty-confirm').classList.contains('hidden')); assert.match(message(f), /重新查看整群搬空/);
  }
});

test('a modal invalidates both open previews without stealing its focus or applying either action', () => {
  const f = setup(); click(f, 'pests-toggle'); preview(f);
  f.G.hasOpenModal = () => true; const modal = f.mount('modal-button'); modal.focus(); f.G.ui.refreshEconomyInfo(f.b);
  assert.equal(f.doc.activeElement, modal); assert.equal(node(f, 'pasture-empty')._emptyQuote, null); assert.equal(node(f, 'pasture-pests')._pestEnable, null);
  f.G.hasOpenModal = () => false; click(f, 'pests-confirm'); click(f, 'empty-confirm');
  assert.equal(f.G.game.pasturePests.enabled, false); assert.equal(f.b.animals, 4);
});

test('opening and immediately closing a dialog cancels both previews even without a refresh tick', () => {
  const f = setup(); click(f, 'pests-toggle'); preview(f);
  f.mount('help'); f.G.ui.enterDialog('help'); f.G.ui.leaveDialog('help');
  assert.equal(f.doc.activeElement, input(f, 'pasture-empty-start'));
  assert.equal(node(f, 'pasture-empty')._emptyQuote, null); assert.equal(node(f, 'pasture-pests')._pestEnable, null);
  input(f, 'pasture-empty-confirm').emit('click'); input(f, 'pasture-pests-confirm').emit('click');
  assert.equal(f.b.animals, 4); assert.equal(f.G.game.pasturePests.enabled, false);
});

test('close and reopen mounts fresh controls and rejects both dismissed confirmations', () => {
  const f = setup(); click(f, 'pests-toggle'); preview(f);
  const pest = input(f, 'pasture-pests-confirm'), move = input(f, 'pasture-empty-confirm');
  f.G.ui.hideInfo(); f.select(f.b); pest.emit('click'); move.emit('click');
  assert.notEqual(input(f, 'pasture-empty-confirm'), move); assert.notEqual(input(f, 'pasture-pests-confirm'), pest);
  assert.equal(f.b.animals, 4); assert.equal(f.G.game.pasturePests.enabled, false);
  assert.equal(node(f, 'pasture-empty')._emptyQuote, null); assert.equal(node(f, 'pasture-pests')._pestEnable, null);
});

test('status, options and native previews remain read-only across repeated detail refreshes', () => {
  const f = setup(); infect(f, 2); f.b.pastureProducts.eggs = 3;
  const before = JSON.stringify(f.G.serializeGame()); const random = f.G.chance;
  f.G.chance = () => { throw Error('UI must not consume simulation randomness'); };
  preview(f); f.G.ui.renderInfo(); f.G.ui.refreshEconomyInfo(f.b);
  assert.equal(JSON.stringify(f.G.serializeGame()), before); f.G.chance = random;
});

console.log(`Pasture pests UI: ${passed} DOM/live-simulation suites passed (not browser/mobile).`);
