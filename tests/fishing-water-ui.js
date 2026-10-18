/* Fishing water details and guarded migration exercise real gameplay APIs; DOM QA is not browser visual acceptance. */
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
      click(detail = 1) { if (!this.disabled && roots.some(root => root.contains(this))) this.focus(); for (const fn of handlers.click || []) fn({ target: this, detail }); },
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
  for (const name of ['core', 'defs', 'map', 'sim', 'fire', 'ui', 'main'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  G.markGroundDirty = () => {}; G.autosave = () => {};
  const generate = G.genWorld;
  G.genWorld = (seed, options) => { const w = generate(seed, options); w.water.fill(0); w.rock.fill(0); return w; };
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar'), placement = mount('placement');
  G.ui.el = { info, guide, toolbar, placement, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
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
  const node = key => info.querySelector(`[data-fishing="${key}"]`);
  return { G, doc, info, guide, toolbar, placement, building, resident, homes, select, node, mount, element };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const save = G => JSON.parse(JSON.stringify(G.serializeGame()));
function fishing(rule = 'shared', type = 'dock', twin = true) {
  const f = fixture(), { G } = f;
  G.game.fishingRules = rule; G.game.h = 12;
  for (const key of ['wood', 'stone', 'tools']) G.game.res[key] = 200;
  for (let y = 8; y <= 25; y++) for (let x = 18; x <= 19; x++) G.world.water[y * G.world.N + x] = 1;
  f.building('storage', { x: 3, y: 10 });
  const a = f.building('dock', { x: 16, y: 16 }), docks = [a];
  if (twin) docks.push(f.building('dock', { x: 20, y: 16 }));
  const staff = b => {
    const c = G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm', name: '渔民' + b.id });
    c.job = b.id; b.workers.push(c.id); return c;
  };
  const fishers = docks.map(staff);
  const b = type === 'townhall' ? f.building('townhall', { x: 3, y: 3 }) : a;
  f.select(b);
  const get = id => f.info.querySelector('#fishing-' + id);
  return { ...f, a, b, docks, fishers, staff, get };
}
function enable(f) { f.get('start').click(); f.get('confirm').click(); assert.equal(f.G.game.fishingRules, 'shared'); }
function addBridge(f, y = 10) {
  const result = f.G.addBridge({ x: 17, y }, { x: 20, y });
  assert.equal(result.ok, true, result.reason); return result.b;
}
function restore(f) {
  const old = f.b, data = f.G.prepareSaveData(save(f.G)); f.G.world = data.world; f.G.game = data.game;
  f.b = f.G.world.bmap[old.id]; f.select(f.b); return f.b;
}

// Real terrain/staffing/task/policy/save functions supply all gameplay values.
test('new towns show shared rules without a switch back; classic reads and panels do not migrate', () => {
  for (const type of ['dock', 'townhall']) for (const rule of ['classic', 'shared']) {
    const f = fishing(rule, type), before = JSON.stringify(save(f.G));
    for (let i = 0; i < 3; i++) { f.G.ui.fishingInfoData(f.b); f.G.ui.renderInfo(); }
    assert.equal(JSON.stringify(save(f.G)), before);
    assert.match(f.node('rule').textContent, rule === 'classic' ? /经典水域.*旧档保留/ : /共享可用水域.*新局默认/);
    assert.equal(!!f.get('start'), rule === 'classic');
    assert.match(f.node('scope').textContent, /搬运或休息仍占份额.*空屋、工地和0上限.*产量目标暂停/);
    assert.match(f.node('timing').textContent, /夜间暂停.*已锁定.*读档.*重启未完成任务/);
    assert.match(f.node('adaptation').textContent, /本作适配.*教育缩短劳动时间/);
  }
  assert.equal(fixture().G.game.fishingRules, 'shared');
});

test('missing legacy policy loads as classic, preserves stock, and uses the guarded opt-in', () => {
  const f = fishing('classic'), original = save(f.G); delete original.game.fishingRules;
  const data = f.G.prepareSaveData(original); f.G.world = data.world; f.G.game = data.game;
  f.b = f.G.world.bmap[f.b.id]; f.select(f.b);
  assert.equal(f.G.game.fishingRules, 'classic');
  assert.deepEqual(JSON.parse(JSON.stringify(f.G.game.res)), original.game.res);
  assert.match(f.node('rule').textContent, /经典水域/);
  enable(f); assert.equal(f.G.fishingWaterSummary(f.b).rule, 'shared');
});

test('dock live estimates match real APIs and distinguish actual staffing from next-batch assumptions', () => {
  const f = fishing(), { G, a } = f, s = G.fishingWaterSummary(a);
  assert.equal(s.raw, 36); assert.equal(s.effective, 18); assert.equal(s.baseCatch, 6);
  assert.match(f.node('water').textContent, /原始 36 格.*桥占 0 格.*可用 36 格.*重叠共享 36 格.*有效 18 格/);
  assert.match(f.node('catch').textContent, /下一批估计：6 肉类.*基础 6/);
  assert.match(f.node('staffing').textContent, /另有 1 座.*假定本屋能接下一批/);
  G.setWorkerLimit(a, 0); G.ui.renderInfo();
  assert.match(f.node('staffing').textContent, /未参与共享/);
  assert.match(f.info.querySelector('[data-fishing-status]').textContent, /上限为0/);
  assert.equal(f.node('catch').textContent.includes('基础 6'), true, 'own estimate assumes new staffed batch');
});

test('inline confirmation previews every completed dock, warns of town-wide reductions and cancels without mutation', () => {
  for (const type of ['dock', 'townhall']) {
    const f = fishing('classic', type), { G } = f, before = JSON.stringify(save(G));
    const actual = G.enableSharedFishing; let calls = 0; G.enableSharedFishing = (...args) => { calls++; return actual(...args); };
    f.get('confirm').click(); assert.equal(calls, 0);
    f.get('start').click();
    assert.equal(G.game.fishingRules, 'classic'); assert.equal(f.get('confirm').disabled, false);
    assert.equal(f.get('start').getAttribute('aria-expanded'), 'true'); assert.equal(f.doc.activeElement, f.get('confirm'));
    assert.match(f.get('confirmation').textContent, /全镇所有渔屋永久.*未来批次可能下降.*免费.*一次/);
    assert.match(f.get('confirmation').textContent, /基础预估（未计工具）.*不是全镇同时增岗后的总产量/);
    for (const b of f.docks) assert(f.node('transition').textContent.includes(`渔屋 #${b.id}（${b.x},${b.y}）在岗：8 → 6`));
    f.get('cancel').click(); assert.equal(f.doc.activeElement, f.get('start'));
    assert.equal(f.get('confirm').disabled, true); f.get('confirm').click();
    assert.equal(calls, 0); assert.equal(JSON.stringify(save(G)), before);
  }
});

test('confirmed migration is one-time and updates all docks while preserving stocks and committed tasks/cargo', () => {
  for (const type of ['dock', 'townhall']) {
    const f = fishing('classic', type), { G } = f, [c1, c2] = f.fishers;
    c1.task = G.makeTask(f.docks[0], c1); c1.task.workLeft = c1.task.work;
    c2.carry = { type: 'meat', qty: 7 };
    const task = c1.task, taskQty = task.yield.qty, cargo = JSON.stringify(c2.carry), stock = JSON.stringify(G.game.res);
    let calls = 0; const actual = G.enableSharedFishing;
    G.enableSharedFishing = (key, game) => { calls++; assert.equal(game, G.game); return actual(key, game); };
    enable(f); f.get('confirm').click(); f.get('confirm').click(2);
    assert.equal(calls, 1); assert.equal(JSON.stringify(G.game.res), stock);
    assert.equal(c1.task, task); assert.equal(c1.task.yield.qty, taskQty); assert.equal(JSON.stringify(c2.carry), cargo);
    assert(f.docks.every(b => G.fishingWaterSummary(b).rule === 'shared'));
    assert.equal(G.makeTask(f.docks[0], c1).yield.qty, 6);
    assert(f.info.querySelector('[data-fishing-migration]').classList.contains('hidden'));
    assert.equal(f.doc.activeElement, f.info.querySelector('#info-close'));
    assert.match(f.node('rule').textContent, /共享可用水域/);
    assert.equal(f.get('start').disabled, true);
  }
});

test('detached or stale controls cannot change policy across selection, world, game, entity, node or modal changes', () => {
  for (const type of ['dock', 'townhall']) for (const action of ['start', 'confirm'])
    for (const mode of ['selection', 'world', 'game', 'panel', 'info', 'hidden', 'closed', 'removed', 'replacement', 'site', 'type', 'node', 'modal']) {
      const f = fishing('classic', type), { G, b } = f;
      if (action === 'confirm') f.get('start').click();
      const old = f.get(action), actual = G.enableSharedFishing; let calls = 0;
      G.enableSharedFishing = (...args) => { calls++; return actual(...args); };
      if (mode === 'selection') G.sel = { kind: 'b', id: f.docks[1].id };
      if (mode === 'world') G.world = { ...G.world };
      if (mode === 'game') G.game = { ...G.game };
      if (mode === 'panel') { f.select(f.building('house', { x: 3, y: 30 })); f.select(b); }
      if (mode === 'info') G.ui.el.info = f.mount('new-info');
      if (mode === 'hidden') f.info.classList.add('hidden');
      if (mode === 'closed') G.ui.hideInfo();
      if (mode === 'removed') delete G.world.bmap[b.id];
      if (mode === 'replacement') G.world.bmap[b.id] = { ...b };
      if (mode === 'site') b.state = 'site';
      if (mode === 'type') b.type = 'house';
      if (mode === 'node') { const parent = old.parentNode; parent.innerHTML = `<button id="${old.id}">replacement</button>`; }
      if (mode === 'modal') G.hasOpenModal = () => true;
      old.click(); assert.equal(calls, 0, `${type}:${action}:${mode}`); assert.equal(G.game.fishingRules, 'classic');
    }
});

test('actual same-ID save loads reject old controls and require a new confirmation', () => {
  for (const type of ['dock', 'townhall']) for (const action of ['start', 'confirm']) {
    const f = fishing('classic', type); f.get('start').click(); const old = f.get(action), oldGame = f.G.game, oldBuilding = f.b;
    restore(f); assert.notEqual(f.G.game, oldGame); assert.notEqual(f.b, oldBuilding); assert.equal(f.b.id, oldBuilding.id);
    old.click(); assert.equal(f.G.game.fishingRules, 'classic'); assert.equal(f.get('confirm').disabled, true);
    enable(f);
  }
});

test('changed staff, cap, bridge, water or dock roster invalidates the shown quote before commit', () => {
  for (const viaRefresh of [false, true]) for (const mode of ['cap', 'staff', 'death', 'bridge', 'water', 'dock', 'policy']) {
    const f = fishing('classic'), { G } = f; f.get('start').click();
    if (mode === 'cap') G.setWorkerLimit(f.docks[1], 0);
    if (mode === 'staff') { f.fishers[1].job = null; f.docks[1].workers = []; }
    if (mode === 'death') f.fishers[1].dead = true;
    if (mode === 'bridge') addBridge(f);
    if (mode === 'water') G.world.water[8 * G.world.N + 18] = 0;
    if (mode === 'dock') f.building('dock', { x: 16, y: 20 });
    if (mode === 'policy') G.enableSharedFishing(G.fishingPolicyQuote().key);
    if (viaRefresh) G.ui.renderInfo();
    f.get('confirm').click(); assert.equal(G.game.fishingRules, mode === 'policy' ? 'shared' : 'classic', mode);
    assert.equal(f.get('confirm').disabled, true); assert(f.get('confirmation').classList.contains('hidden'));
    if (mode !== 'policy') { f.get('start').click(); f.get('confirm').click(); assert.equal(G.game.fishingRules, 'shared'); }
  }
});

test('refresh keeps unchanged controls and focus stable; modal interruption does not steal modal focus or rearm', () => {
  const f = fishing('classic'), { G } = f;
  f.get('start').click(); const button = f.get('confirm'), writes = f.info.htmlWrites;
  for (let i = 0; i < 3; i++) { G.game.h += .1; G.ui.renderInfo(); assert.equal(f.doc.activeElement, button); assert.equal(f.get('confirm'), button); }
  assert.equal(f.info.htmlWrites, writes); assert.equal(button.disabled, false);
  const modal = f.mount('test-modal'); modal.focus(); G.hasOpenModal = () => true; G.ui.renderInfo();
  assert.equal(f.doc.activeElement, modal); assert.equal(button.disabled, true);
  G.hasOpenModal = () => false; button.click(); assert.equal(G.game.fishingRules, 'classic');
  f.get('start').click(); const field = f.info.querySelector('#worker-limit-input'); field.value = '1'; field.focus();
  G.ui.renderInfo(); assert.equal(f.doc.activeElement, field); assert.equal(field.value, '1'); assert.equal(f.info.htmlWrites, writes);
});

test('modal interruption before a refresh and repeated clicks never apply or reverse a migration', () => {
  const f = fishing('classic'), { G } = f; f.get('start').click();
  G.hasOpenModal = () => true; f.get('confirm').click(); G.hasOpenModal = () => false;
  f.get('confirm').click(); assert.equal(G.game.fishingRules, 'classic');
  f.get('start').click(2); f.get('confirm').click(); assert.equal(G.game.fishingRules, 'classic');
  enable(f); f.get('start').click(); f.get('confirm').click(); assert.equal(G.game.fishingRules, 'shared');
});

test('paused placement explains raw/free/blocked/shared/effective water and current-rule neighboring catch', () => {
  for (const rule of ['classic', 'shared']) {
    const f = fishing(rule, 'dock', false), { G } = f; G.game.paused = true;
    const p = G.ui.refreshPlacement('dock', 20, 16);
    assert.equal(p.water, 36); assert.equal(p.fishing.effective, 18);
    assert.match(f.placement.textContent, /材料（现有\/需要）[\s\S]*\n全镇渔业/);
    assert.match(f.placement.textContent, /原始 36.*桥占 0.*可用 36.*重叠共享 36.*有效 18/);
    assert.match(f.placement.textContent, /假定本屋完工并配渔民.*当前实际在岗/);
    assert(f.placement.textContent.includes(`#${f.a.id} 8 → ${rule === 'shared' ? 6 : 8}`));
    assert.equal(p.fishing.catch, rule === 'shared' ? 6 : 8);
    assert.match(f.placement.textContent, /当前地形可达仓/);
    assert.match(f.placement.textContent, /不是年度或入库保证/);
    assert.equal(G.game.fishingRules, rule);
    if (rule === 'classic') assert.match(f.placement.textContent, /新建不会自动切换/);
  }
});

test('paused placement caches unchanged footprints but immediately reflects town policy migration', () => {
  const f = fishing('classic', 'dock', false), { G } = f;
  let reads = 0; const actual = G.fishingPlacementSummary;
  G.fishingPlacementSummary = (...args) => { reads++; return actual(...args); };
  G.ui.refreshPlacement('dock', 20, 16); const before = reads;
  for (let i = 0; i < 5; i++) G.ui.refreshPlacement('dock', 20, 16);
  assert.equal(reads, before, 'identical animation frames should not recount all dock footprints');
  enable(f); G.ui.refreshPlacement('dock', 20, 16);
  assert.equal(reads, before + 1); assert.match(f.placement.textContent, /共享可用水域/);
  assert(f.placement.textContent.includes(`#${f.a.id} 8 → 6`));
});

test('external policy changes move focus out of hidden migration controls but preserve unrelated input focus', () => {
  for (const focused of ['confirm', 'input']) {
    const f = fishing('classic'), { G } = f; f.get('start').click();
    const input = f.info.querySelector('#worker-limit-input'); if (focused === 'input') input.focus();
    G.enableSharedFishing(G.fishingPolicyQuote().key); G.ui.renderInfo();
    assert.equal(f.doc.activeElement, focused === 'input' ? input : f.info.querySelector('#info-close'));
    assert.equal(f.get('confirm').disabled, true); assert.equal(G.game.fishingRules, 'shared');
  }
});

test('same-location paused placement invalidates after actual staffing limit, restore, and bridge changes', () => {
  const f = fishing('shared', 'dock', false), { G } = f;
  G.ui.refreshPlacement('dock', 20, 16); assert.match(f.placement.textContent, /有效 18 格/);
  G.setWorkerLimit(f.a, 0); G.ui.refreshPlacement('dock', 20, 16); assert.match(f.placement.textContent, /有效 36 格/);
  G.setWorkerLimit(f.a, 2); if (!f.a.workers.length) { f.fishers[0].job = f.a.id; f.a.workers.push(f.fishers[0].id); }
  G.ui.refreshPlacement('dock', 20, 16); assert.match(f.placement.textContent, /有效 18 格/);
  const bridge = addBridge(f); G.ui.refreshPlacement('dock', 20, 16); assert.match(f.placement.textContent, /桥占 2.*可用 34.*有效 17 格/);
  assert.equal(G.removeBuilding(bridge), true); G.ui.refreshPlacement('dock', 20, 16); assert.match(f.placement.textContent, /桥占 0.*可用 36.*有效 18 格/);
});

test('real bridge sites, completed bridges and removal refresh details without replacing focused controls', () => {
  const f = fishing('shared', 'dock', false), { G } = f;
  const field = f.info.querySelector('#worker-limit-input'); field.value = '1'; field.focus(); const writes = f.info.htmlWrites;
  const bridge = addBridge(f); G.ui.renderInfo(); assert.match(f.node('water').textContent, /桥占 2 格.*可用 34 格/);
  G.finishBuilding(bridge); G.ui.renderInfo(); assert.match(f.node('water').textContent, /桥占 2 格.*可用 34 格/);
  assert.equal(G.removeBuilding(bridge), true); G.ui.renderInfo(); assert.match(f.node('water').textContent, /桥占 0 格.*可用 36 格/);
  assert.equal(f.doc.activeElement, field); assert.equal(field.value, '1'); assert.equal(f.info.htmlWrites, writes);
});

test('zero free water shows zero catch and no production; tools and classic counts remain explicit', () => {
  const f = fishing('shared', 'dock', false), { G } = f; G.world.water.fill(0);
  for (const x of [18, 19]) G.world.water[10 * G.world.N + x] = 1;
  addBridge(f); G.ui.renderInfo();
  assert.match(f.node('water').textContent, /原始 2 格.*桥占 2 格.*可用 0 格.*有效 0 格/);
  assert.match(f.node('catch').textContent, /下一批估计：0 肉类.*基础 0/);
  assert.match(f.info.querySelector('[data-fishing-status]').textContent, /停工.*没有/);
  G.ui.refreshPlacement('dock', 20, 16); assert.match(f.placement.textContent, /无法接新捕鱼批次/);
  G.game.fishingRules = 'classic'; G.ui.renderInfo(); assert.match(f.node('catch').textContent, /基础 4/);
  G.game.res.tools = 0; G.game.res.steeltools = 0; G.ui.renderInfo();
  assert(f.node('catch').textContent.includes(`下一批估计：${G.fishingWaterSummary(f.a).catch}`));
});

test('sites and unrelated building details do not expose migration controls', () => {
  const f = fishing('classic'); f.b.state = 'site'; f.G.ui.renderInfo(true);
  assert.equal(f.info.querySelector('[data-fishing-panel]'), null);
  f.select(f.building('house', { x: 3, y: 30 })); assert.equal(f.info.querySelector('[data-fishing-panel]'), null);
});

console.log(`Fishing water UI: ${passed} DOM and live-API suites passed (browser visual acceptance not performed).`);
