/* Household supply controls use the real core migration/save APIs. Headless DOM QA only; no browser or mobile visual claim. */
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
      remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; } },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); },
      contains(child) { for (; child; child = child.parentNode) if (child === this) return true; return false; },
      querySelectorAll(selector) {
        return this.descendants().filter(child => {
          if (selector[0] === '#') return child.id === selector.slice(1);
          if (selector[0] === '.') return child.classList.contains(selector.slice(1));
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
  doc.body = mount('body'); doc.createElement = tag => element(tag);
  const downloads = [];
  const ctx = { Blob, URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} }, console, document: doc, __errs: [], setTimeout() {}, addEventListener() {}, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'fire', 'supply', 'render', 'ui', 'main'])
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
  for (const key of G.RES_KEYS) { const chip = mount('res-' + key); chip.appendChild(element('b')); chip.appendChild(element('span', { class: 'res-label' })); }
  mount('net-food'); mount('over').classList.add('hidden'); G.T2S = () => [0, 0]; G.cam = { x: 0, y: 0, z: 1 }; G.groundDirty = new Set();
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
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, mount, downloads, ctx, element };
}

let passed = 0;
function test(name, run) { run(); console.log('ok ' + name); passed++; }
const control = (f, id) => f.info.querySelector('#supply-mode-' + id);
const live = (f, group, key) => f.info.querySelector(`[data-${group}="${key}"]`)?.textContent;
const pending = f => !f.info.querySelector('[data-supply-mode-confirm]').classList.contains('hidden');
const state = f => JSON.stringify(f.G.serializeGame());
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function setup(type = 'townhall') {
  const f = fixture(), G = f.G;
  f.building('storage'); f.home = f.building('house'); f.c = f.resident(f.home);
  f.b = f.building(type);
  Object.assign(G.game.res, { grain: 60, vegetables: 40, meat: 20, food: 120, firewood: 1, coal: 20 });
  G.game.day = 36; G.game.season = 3; G.game.year = 1; G.game.townLedger = G.newTownLedger(G.game); G.setHeatingPolicy(true, 0);
  f.select(f.b); return f;
}
const begin = f => control(f, 'start').click();
const confirm = f => control(f, 'confirm').click();

for (const type of ['townhall', 'market']) test(`${type}: readonly preview shows exact public debits and per-home allocations before irreversible confirmation`, () => {
  const f = setup(type), G = f.G, quote = G.supplyModeQuote(), before = state(f);
  for (const k of G.SUPPLY.types) {
    assert(live(f, 'supply-mode', 'cost').includes(`${G.RES[k].name} ${quote.cost[k]}`));
    assert(f.info.querySelector('[data-supply-mode-rows]').textContent.includes(`${G.RES[k].name} ${quote.rows[0].stock[k]}`));
  }
  assert.match(f.info.textContent, /不能切回自动供给.*必须先导出/);
  assert(f.info.innerHTML.indexOf('id="supply-mode-export"') < f.info.innerHTML.indexOf('id="supply-mode-confirm"'));
  assert.equal(G.game.supplyMode, 'automatic');
  confirm(f); assert.equal(state(f), before);
  begin(f); assert(pending(f)); assert.equal(state(f), before);
  assert.equal(f.doc.activeElement, control(f, 'confirm'));
  control(f, 'cancel').click(); assert(!pending(f)); assert.equal(f.doc.activeElement, control(f, 'start')); confirm(f);
  assert.equal(state(f), before);
});

test('households and homeless camps get actual insufficient rations with no fabricated two-day promise', () => {
  const f = setup(), G = f.G, child = f.resident(f.home), family = G.familyOf(child);
  family.houseId = null; child.age = 7; child.adult = false; child.name = '<无房&儿童>';
  Object.assign(G.game.res, { grain: 1, vegetables: 0, meat: 0, food: 1, firewood: 0, coal: 0 });
  const before = state(f); G.ui.renderInfo(); begin(f);
  assert.match(live(f, 'supply-mode', 'coverage'), /库存不足.*不能保证两日/);
  assert.match(live(f, 'supply-mode', 'buyers'), /无健康成人采购者 1 户/);
  assert.match(f.info.querySelector('[data-supply-mode-rows]').textContent, /无房家庭临时补给点.*不足两日/);
  assert(!family.supplyCamp); assert.equal(state(f), before);
  confirm(f); assert.equal(G.game.supplyMode, 'physical'); assert(family.supplyCamp);
  near(G.supplyFood(family.supplyCamp.supplyStock), .5);
});

for (const type of ['townhall', 'market']) test(`${type}: confirm is one-way and moves exactly the real quote, including cold-season coal`, () => {
  const f = setup(type), G = f.G, quote = G.supplyModeQuote(), before = { ...G.game.res }, oldConfirm = control(f, 'confirm');
  begin(f); confirm(f);
  assert.equal(G.game.supplyMode, 'physical');
  for (const k of G.SUPPLY.types) { near(G.game.res[k], before[k] - quote.cost[k]); near(f.home.supplyStock[k], quote.rows[0].stock[k]); }
  assert(quote.cost.coal > 0); assert(control(f, 'start').disabled); assert(control(f, 'confirm').disabled);
  assert.equal(f.doc.activeElement, f.info.querySelector('#info-close'));
  const after = state(f); oldConfirm.click(); oldConfirm.click(); control(f, 'start').click(); confirm(f);
  assert.equal(state(f), after); assert.equal(G.enableHouseholdSupply(quote.key, G.game), false);
});

test('stable ticks retain focused market staffing drafts and pending controls', () => {
  const f = setup('market'), G = f.G, input = f.info.querySelector('#worker-limit-input'), button = control(f, 'confirm');
  input.value = '0'; begin(f); input.focus(); const writes = f.info.htmlWrites;
  G.ui.renderInfo(); G.game.h += .2; G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, input); assert.equal(input.value, '0');
  assert.equal(control(f, 'confirm'), button); assert(pending(f));
  G.game.res.grain += 1; G.game.res.food += 1; G.ui.renderInfo();
  assert(!pending(f)); assert.equal(f.doc.activeElement, input); assert.equal(input.value, '0'); assert.equal(f.info.htmlWrites, writes);
});

for (const change of ['stock', 'family', 'policy', 'navigation', 'day', 'buyer']) test(`${change} changes invalidate pending consent, both on click and periodic refresh`, () => {
  for (const refresh of [false, true]) {
    const f = setup(), G = f.G; begin(f);
    if (change === 'stock') { G.game.res.grain += 1; G.game.res.food += 1; }
    if (change === 'family') { G.familyOf(f.c).houseId = null; f.home.family = null; }
    if (change === 'policy') G.setHeatingPolicy(false, 0);
    if (change === 'navigation') G.bumpNavigation(G.world);
    if (change === 'day') G.game.day++;
    if (change === 'buyer') f.c.student = true;
    const before = state(f); if (refresh) G.ui.renderInfo(); confirm(f);
    assert.equal(state(f), before); assert.equal(G.game.supplyMode, 'automatic'); assert(!pending(f));
    begin(f); assert(pending(f));
  }
});

test('actual save export cancels the pending quote, invokes download once, and never implies verified backup', () => {
  const f = setup(), before = state(f); begin(f); control(f, 'export').click();
  assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].type, 'application/json');
  assert(!pending(f)); confirm(f); assert.equal(state(f), before);
  assert.match(f.info.querySelector('[data-supply-mode-message]').textContent, /请求浏览器下载.*自行核对.*需要重新预览/);
  control(f, 'export').emit('click', { detail: 2 }); assert.equal(f.downloads.length, 1);
  begin(f); confirm(f); assert.equal(f.G.game.supplyMode, 'physical');
});

test('failed export cannot claim a backup or retain consent', () => {
  const f = setup(), before = state(f); begin(f);
  f.ctx.URL.createObjectURL = () => { throw Error('download blocked'); };
  control(f, 'export').click(); confirm(f);
  assert.equal(state(f), before); assert(!pending(f));
  assert.match(f.info.querySelector('[data-supply-mode-message]').textContent, /导出未完成.*未切换/);
  assert(!f.info.querySelector('[data-supply-mode-message]').textContent.includes('已保存'));
});

test('repeated clicks and held keyboard activation cannot combine confirmation steps', () => {
  const f = setup(), before = state(f); control(f, 'start').emit('click', { detail: 2 }); confirm(f); assert.equal(state(f), before);
  begin(f); control(f, 'confirm').emit('click', { detail: 2 }); assert.equal(state(f), before); assert(!pending(f));
  let prevented = 0;
  for (const id of ['start', 'confirm', 'cancel', 'export']) control(f, id).emit('keydown', { key: 'Enter', repeat: true, preventDefault() { prevented++; } });
  assert.equal(prevented, 4);
});

for (const guard of ['world', 'game', 'selection', 'entity', 'type', 'state', 'panel', 'node', 'hidden', 'modal']) test(`stale ${guard} invalidates callbacks before any mutation`, () => {
  const f = setup(), G = f.G; begin(f); const old = control(f, 'confirm');
  if (guard === 'world') G.world = { ...G.world };
  if (guard === 'game') G.game = { ...G.game };
  if (guard === 'selection') G.sel = { kind: 'b', id: f.home.id };
  if (guard === 'entity') G.world.bmap[f.b.id] = { ...f.b };
  if (guard === 'type') f.b.type = 'market';
  if (guard === 'state') f.b.state = 'site';
  if (guard === 'panel') { f.info.innerHTML = f.info.innerHTML; }
  if (guard === 'node') { const box = f.info.querySelector('[data-supply-mode-confirm]'); box.innerHTML = box.innerHTML; }
  if (guard === 'hidden') f.info.classList.add('hidden');
  if (guard === 'modal') G.hasOpenModal = () => true;
  const before = state(f); old.click(); assert.equal(state(f), before); assert.equal(G.game.supplyMode, 'automatic');
});

test('close, navigation, modal entry, and same-ID applySaveData revoke old callbacks', () => {
  const f = setup(), G = f.G;
  begin(f); let old = control(f, 'confirm'); G.ui.hideInfo(); f.select(f.b); const initial = state(f); old.click(); assert.equal(state(f), initial);
  begin(f); old = control(f, 'confirm'); f.select(f.home); f.select(f.b); old.click(); assert.equal(state(f), initial);
  begin(f); f.mount('test-modal'); G.ui.enterDialog('test-modal'); assert(!pending(f));
  begin(f); old = control(f, 'confirm'); const saved = G.serializeGame(), id = f.b.id;
  G.applySaveData(saved); assert.notEqual(G.world.bmap[id], f.b); const loaded = state(f); old.click(); assert.equal(state(f), loaded);
  f.select(G.world.bmap[id]); assert.equal(G.game.supplyMode, 'automatic'); assert(!pending(f));
  begin(f); confirm(f); assert.equal(G.game.supplyMode, 'physical');
});

test('new and legacy saves remain automatic until explicitly migrated', () => {
  const f = setup(), G = f.G, save = G.serializeGame(); assert.equal(G.newGameState().supplyMode, 'automatic');
  delete save.game.supplyMode; G.applySaveData(save); assert.equal(G.game.supplyMode, 'automatic');
  f.select(G.world.bmap[f.b.id]); assert(control(f, 'start')); assert(!pending(f));
});

test('core revalidation failure leaves automatic mode without accepting a changed quote', () => {
  const f = setup(), G = f.G, enable = G.enableHouseholdSupply;
  G.enableHouseholdSupply = (key, game) => { G.game.res.firewood++; return enable(key, game); };
  begin(f); confirm(f); assert.equal(G.game.supplyMode, 'automatic'); assert(!pending(f));
  assert.match(f.info.querySelector('[data-supply-mode-message]').textContent, /条件已变化.*未切换/);
});

test('physical market detail updates actual inventory, incoming and current-target workers without remounting', () => {
  const f = setup('market'), G = f.G; begin(f); confirm(f);
  f.b.supplyStock.grain = 10; f.b.supplyStock.coal = 3; f.c.job = f.b.id; f.b.workers = [f.c.id]; f.c.name = '<货商&甲>';
  f.c.carry = { type: 'vegetables', qty: 4, extra: { firewood: 2 }, supplyBatch: { kind: 'vendor', to: f.b.id } };
  const writes = f.info.htmlWrites, input = f.info.querySelector('#worker-limit-input'); input.focus(); input.value = '0'; G.ui.renderInfo();
  assert.match(live(f, 'market-supply', 'stock'), /主食 10.*煤 3/);
  assert.match(live(f, 'market-supply', 'capacity'), /已存 13 \/ 240/);
  assert.match(live(f, 'market-supply', 'incoming'), /蔬菜 4.*柴火 2/);
  assert.match(live(f, 'market-supply', 'workers'), /当前货商 1 \/ 已应用上限 1.*<货商&甲>/);
  assert.equal(f.info.htmlWrites, writes); assert.equal(input.value, '0'); assert.equal(f.doc.activeElement, input);
  assert.match(live(f, 'market-supply', 'rule'), /近仓.*更快.*不生产/);
});

test('home detail shows three food groups, fuel, local days, actual purchaser and no-buyer reason', () => {
  const f = setup(), G = f.G; begin(f); confirm(f); f.select(f.home);
  const b = f.home; Object.assign(b.supplyStock, { meat: 3, vegetables: 4, grain: 5, firewood: 2, coal: 3 });
  f.c.name = '<采购&甲>'; f.c.carry = { type: 'grain', qty: 6, supplyBatch: { kind: 'home', to: b.id, familyId: f.c.familyId } };
  const writes = f.info.htmlWrites; G.ui.renderInfo();
  assert.match(live(f, 'household-supply', 'stock'), /主食 5.*蔬菜 4.*肉类 3.*柴火 2.*煤 3/);
  assert.match(live(f, 'household-supply', 'incoming'), /主食 6/);
  assert.match(live(f, 'household-supply', 'buyers'), /正在采购\/送回：<采购&甲>/);
  assert.match(live(f, 'household-supply', 'days'), /仅本地现货.*在途未到不算可用/);
  f.c.carry = null; f.c.student = true; G.ui.renderInfo();
  assert.match(live(f, 'household-supply', 'buyers'), /无健康成人采购者.*散工协助/);
  assert.match(live(f, 'heating', 'stock'), /本屋柴火 2.*煤 3.*公共煤.*不能直接暖屋/);
  assert.equal(f.info.htmlWrites, writes);
});

test('citizen supply state comes from the core and homeless camp details are visible', () => {
  const f = setup(), G = f.G; G.familyOf(f.c).houseId = null; begin(f); confirm(f);
  const camp = G.familyOf(f.c).supplyCamp;
  f.c.task = { kind: 'supply', phase: 'fetch', vendor: false, to: camp }; f.c.state = 'walk';
  assert.equal(G.ui.citizenStatus(f.c), G.supplyCitizenStatus(f.c));
  G.sel = { kind: 'c', id: f.c.id }; G.ui.showInfo();
  assert.match(f.info.textContent, /家庭临时补给/); assert.match(f.info.querySelector('[data-citizen-status]').textContent, /为家庭前往采购/);
  f.info.querySelector('#info-close').focus(); f.c.state = 'supplyWait'; G.ui.renderInfo();
  assert.match(f.info.querySelector('[data-citizen-status]').textContent, /等待有货且可达的采购点/);
});

test('town distribution separates public, market, homes/camps, transit, recovery and fire locked stock', () => {
  const f = setup(), G = f.G; begin(f); confirm(f);
  const market = f.building('market'); market.supplyStock = { grain: 7 };
  f.home.supplyStock.grain = 3; G.world.supplyCaches = [{ id: 99, type: 'supplycache', supplyStock: { grain: 4 } }];
  const family = G.familyOf(f.c); family.supplyCamp = { id: family.id, type: 'supplycamp', supplyStock: { grain: 5 } };
  f.c.carry = { type: 'grain', qty: 6, supplyBatch: { kind: 'return', to: null } };
  G.ui.renderInfo(); assert.match(live(f, 'village-supply', 'homes'), /主食 8/);
  assert.match(live(f, 'village-supply', 'market'), /主食 7/); assert.match(live(f, 'village-supply', 'cache'), /主食 4/);
  assert.match(live(f, 'village-supply', 'transit'), /主食 6/);
  f.home.houseFire = { incident: 1 }; G.ui.renderInfo();
  assert.match(live(f, 'village-supply', 'locked'), /主食 3.*烧毁才计/);
  assert.match(live(f, 'village-supply', 'homes'), /主食 5/);
  assert.match(live(f, 'townhall', 'food'), /公共食物.*全村食物/);
});

test('HUD visibly labels public counts and explains distributed stock without asserting lost food', () => {
  const f = setup(), G = f.G; G.ui.refreshHUD();
  assert.equal(f.doc.getElementById('res-food').querySelector('.res-label').textContent, '总食物');
  begin(f); confirm(f); G.ui.refreshHUD();
  assert.equal(f.doc.getElementById('res-food').querySelector('.res-label').textContent, '公共总食物');
  assert.equal(f.doc.getElementById('res-firewood').querySelector('.res-label').textContent, '公共柴火');
  assert.match(f.doc.getElementById('res-food').title, /公共库存.*全村食物.*各家能否食用看本地储备/);
  assert.match(f.doc.getElementById('net-food').title, /全村食物净变.*左侧数字仅为公共库存/);
});

test('ledger sums public and household use, separately shows public equation and physical fire loss', () => {
  const f = setup(), G = f.G; G.ledgerRecord('used', 'grain', 2); G.ledgerRecord('distributedUsed', 'grain', 3);
  G.ledgerRecord('distributedLost', 'grain', 4); G.ledgerRecord('withdrawn', 'grain', 7); G.ui.renderInfo();
  assert.equal(live(f, 'townhall', 'flow-food-current-used'), '5');
  assert.equal(live(f, 'townhall', 'flow-food-current-publicUsed'), '2');
  assert.equal(live(f, 'townhall', 'flow-food-current-distributedLost'), '4');
  assert.equal(live(f, 'townhall', 'flow-food-current-produced'), '0');
  assert.match(f.info.textContent, /公共库存净变 = 实际入库 − 公共直接消耗 − 出库转运/);
  assert.match(f.info.textContent, /实物火灾损失不再重复扣公共库存/);
});

test('market placement describes real geometry and tradeoff without annual production claims', () => {
  const f = setup('market'), G = f.G, p = G.placementInfo('market', 5, 20);
  assert.equal(p.radius, 18); assert.match(p.text, /占地 3×3.*±18 格.*1 名货商.*80.*40.*近仓直接采购可能更快/);
  assert(!/年产|年度产出/.test(p.text));
  G.ui.initToolbar(); assert(G.ui.toolGroups.find(g => g.id === 'services').tools.includes('market'));
});


test('all summary and preview reads are side-effect-free in automatic and physical modes', () => {
  const f = setup('market'), G = f.G, hall = f.building('townhall');
  for (const physical of [false, true]) {
    if (physical) { f.select(f.b); begin(f); confirm(f); delete f.b.supplyStock; }
    const beforeFacts = JSON.stringify([G.game, G.world]);
    G.ui.householdSupplyInfoData(f.home); G.ui.marketSupplyInfoData(f.b); G.ui.supplyModeInfoData(); G.ui.villageSupplyInfoData();
    assert.equal(JSON.stringify([G.game, G.world]), beforeFacts);
    for (const b of [f.home, f.b, hall]) {
      // Existing house-upgrade reachability may populate navigation caches;
      // no persistent game state, stock, task or supply object may change.
      const before = state(f); f.select(b);
      for (let n = 0; n < 3; n++) G.ui.renderInfo();
      assert.equal(state(f), before);
    }
  }
});

test('external migration hides old actions, moves action focus safely, and preserves unrelated drafts', () => {
  for (const actionFocus of [true, false]) {
    const f = setup('market'), G = f.G; begin(f); const input = f.info.querySelector('#worker-limit-input'); input.value = '0';
    if (!actionFocus) input.focus(); const quote = G.supplyModeQuote(); assert(G.enableHouseholdSupply(quote.key, G.game));
    const writes = f.info.htmlWrites; G.ui.renderInfo();
    assert(!pending(f)); assert(control(f, 'confirm').disabled); assert.equal(f.info.htmlWrites, writes);
    assert.equal(f.doc.activeElement, actionFocus ? f.info.querySelector('#info-close') : input); assert.equal(input.value, '0');
  }
});

test('selected citizen moving from camp to house updates only their supply subsection', () => {
  const f = setup(), G = f.G, family = G.familyOf(f.c); family.houseId = null; begin(f); confirm(f);
  G.sel = { kind: 'c', id: f.c.id }; G.ui.showInfo(); const close = f.info.querySelector('#info-close'); close.focus();
  assert.match(f.info.querySelector('[data-citizen-household-supply]').textContent, /家庭临时补给/);
  const writes = f.info.htmlWrites; family.houseId = f.home.id; G.reconcileSupplyHomes(); G.ui.renderInfo();
  assert.match(f.info.querySelector('[data-citizen-household-supply]').textContent, /家庭生活物资/);
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, close);
});

test('physical survival guide includes distributed food and qualifies household accessibility', () => {
  const f = setup(), G = f.G; begin(f); confirm(f);
  for (const k of G.FOOD_KEYS) G.game.res[k] = 0; G.game.res.food = 0;
  f.home.supplyStock.grain = G.LIFE.eatPerDay * 4; f.home.supplyStock.meat = f.home.supplyStock.vegetables = 0;
  G.ui.refreshGuide(); assert.match(f.guide.textContent, /全村粮食合计约 4.0 天.*逐户现货才可食用/);
});

console.log(`Household supply UI: ${passed} suites passed (headless DOM with real migration/save APIs; browser/mobile visual acceptance not performed).`);
