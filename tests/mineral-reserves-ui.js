/* Finite mineral reserve and guarded demolition controls exercise real simulation APIs; this is DOM QA, not browser/mobile acceptance. */
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
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar'), placement = mount('placement-info');
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
  const node = key => info.querySelector(`[data-farm="${key}"]`);
  return { G, doc, info, guide, toolbar, placement, building, resident, homes, select, node, mount };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const live = (f, key) => f.info.querySelector(`[data-resource-chain-live="${key}"]`).textContent;
const control = (f, id) => f.info.querySelector('#mineral-removal-' + id);
const pending = f => !f.info.querySelector('[data-mineral-removal-confirm]').classList.contains('hidden');
const state = f => JSON.stringify(f.G.serializeGame());
const begin = f => f.info.querySelector('#info-demolish').click();
const confirm = f => control(f, 'confirm').click();
function setup(type = 'mine', options = {}) {
  const f = fixture(), G = f.G;
  f.building('storage');
  Object.assign(G.game.res, { wood: 1000, stone: 1000, iron: 1000, grain: 500, food: 500 });
  const result = G.addBuilding(type, 14, 2, { instant: true, ...options });
  assert(result.ok, result.reason); f.b = result.b;
  G.game.res.iron = 0; G.game.res.stone = 0;
  f.c = G.spawnCitizen({ x: 13, y: 2, age: 30, sex: 'm', name: '矿工' });
  f.c.job = f.b.id; f.b.workers = [f.c.id];
  f.select(f.b);
  return f;
}
function acceptTask(f, c = f.c) {
  const task = f.G.makeMineralTask(f.b, c); assert(task, 'expected a real mining task');
  c.task = task; c.state = 'walk'; return task;
}
function extract(f, c = f.c) {
  const task = c.task || acceptTask(f, c);
  c.x = task.tx; c.y = task.ty; c.state = 'work';
  assert(f.G.completeMineralTask(c, task));
  c.task = null; c.pausedTask = null;
  return task;
}
function mined(type = 'mine') { const f = setup(type); extract(f); f.G.ui.renderInfo(); return f; }

test('selected build tools expose permanent-land risk before placement, without relying on tooltip', () => {
  const f = fixture(), G = f.G; G.ui.initToolbar();
  for (const [type, pattern] of [['mine', /3500 铁或 7000 煤.*共享储量/], ['stonequarry', /4000 石头.*本作适配/]]) {
    G.setTool(type);
    const status = f.doc.getElementById('toolbar-state');
    assert.match(status.textContent, pattern);
    assert.match(status.textContent, /首次实际开采后.*永久留下 3×3.*无法复垦、建造或通行.*未开采时取消\/拆除不留坑/);
    G.ui.refreshPlacement(type, 20, 20);
    assert.match(f.placement.textContent, pattern);
    assert.match(f.placement.textContent, /永久留下 3×3/);
  }
  G.setTool('house'); assert.doesNotMatch(f.doc.getElementById('toolbar-state').textContent, /储量|矿坑/);
  assert.equal(f.toolbar.querySelector('[data-tool="mineralpit"]'), null);
});

test('actual newly built points display finite totals while old-save points remain explicitly unlimited', () => {
  for (const [type, capacity, equivalent] of [['mine', 7000, /3500 铁或 7000 煤/], ['stonequarry', 4000, /4000 石头/]]) {
    const f = setup(type); assert(f.G.finiteMineral(f.b));
    assert.match(live(f, 'reserve'), new RegExp(`剩余 ${capacity} / ${capacity}`));
    assert.match(live(f, 'reserve'), equivalent);
    assert.match(live(f, 'ground'), /尚未实际开采.*不留废坑/);
    assert.equal(!!f.doc.getElementById('mine-mode'), type === 'mine');
    const legacy = f.building(type, { mineMode: type === 'mine' ? 'legacy' : undefined, legacyMine: true });
    f.select(legacy); assert(!f.G.finiteMineral(legacy));
    assert.match(live(f, 'reserve'), /旧版无限.*不会耗尽/);
    assert.match(live(f, 'mineralWarning'), /普通拆除.*不留下永久废矿坑/);
    assert.equal(control(f, 'confirm'), null);
  }
});

test('real active and paused tasks reserve units but only actual extraction decreases stock in the ground', () => {
  const f = setup(), G = f.G; f.b.mineralUnits = 17;
  const second = G.spawnCitizen({ x: 13, y: 3, age: 30, sex: 'm', name: '夜间矿工' }); second.job = f.b.id; f.b.workers.push(second.id);
  const firstTask = acceptTask(f), secondTask = acceptTask(f, second);
  second.pausedTask = secondTask; second.task = null;
  G.ui.renderInfo();
  assert.equal(firstTask.mineralUnits, 12); assert.equal(secondTask.mineralUnits, 4);
  assert.match(live(f, 'reserve'), /剩余 17 \/ 7000/);
  assert.match(live(f, 'reserved'), /预留 16 单位.*新批次 1 单位.*实际开采才减少/);
  assert.match(live(f, 'batches'), /铁 6.*铁 2/);
  const initialStored = G.game.res.iron; extract(f); G.ui.renderInfo();
  assert.equal(G.game.res.iron, initialStored, 'carried ore is not warehouse stock');
  assert.match(live(f, 'reserve'), /剩余 5 \/ 7000/);
  assert.match(live(f, 'reserved'), /预留 4 单位.*新批次 1 单位/);
  assert.match(live(f, 'batches'), /铁 6（待送仓）.*铁 2/);
});

test('last iron unit explains the actual blocker and coal switch preserves the focused selector and existing batch', () => {
  const f = setup(), G = f.G; f.b.mineralUnits = 13;
  const task = acceptTask(f), select = f.doc.getElementById('mine-mode'), writes = f.info.htmlWrites;
  select.focus(); select.value = 'coal'; select.emit('change');
  assert.equal(f.b.mineralUnits, 13); assert.equal(task.yield.type, 'iron'); assert.equal(G.mineralReserved(f.b), 12);
  assert.match(live(f, 'production'), /煤/); assert.match(live(f, 'reserve'), /6 铁或 13 煤/);
  extract(f); G.ui.renderInfo();
  assert.equal(f.b.mineralUnits, 1); assert.equal(f.doc.activeElement, select);
  select.value = 'iron'; select.emit('change');
  assert.match(live(f, 'status'), /不足1铁.*切换采煤/); assert.doesNotMatch(live(f, 'status'), /仓.*满/);
  assert.match(live(f, 'mineralWarning'), /20%/);
  select.value = 'coal'; select.emit('change');
  assert.equal(f.b.mineralUnits, 1); assert.doesNotMatch(live(f, 'status'), /不足1铁/);
  f.c.carry = null; const coal = acceptTask(f); assert.equal(coal.yield.qty, 1); extract(f); G.ui.renderInfo();
  assert.match(live(f, 'status'), /耗尽/); assert.match(live(f, 'mineralWarning'), /耗尽/);
  assert.doesNotMatch(live(f, 'status'), /仓.*满/);
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.getElementById('mine-mode'), select);
});

test('low-reserve warning updates in place independently of warehouse and production-goal blockers', () => {
  const f = setup('stonequarry'), G = f.G;
  f.b.mineralUnits = 801; G.ui.renderInfo(); assert.doesNotMatch(live(f, 'mineralWarning'), /20%/);
  f.b.mineralUnits = 800; G.ui.renderInfo(); assert.match(live(f, 'mineralWarning'), /20% 及以下/);
  f.b.mineralUnits = 799; G.ui.renderInfo(); assert.match(live(f, 'mineralWarning'), /20%/);
  G.game.res.stone = G.storageCap('stone'); G.ui.renderInfo(); assert.match(live(f, 'status'), /仓容.*满|目标/);
  f.b.mineralUnits = 0; G.ui.renderInfo(); assert.match(live(f, 'status'), /耗尽/);
  assert.doesNotMatch(live(f, 'status'), /仓.*满/);
});

test('review and cancel make no simulation changes; hidden or repeated confirmation cannot remove the point', () => {
  const f = mined(), before = state(f); confirm(f); assert.equal(state(f), before);
  begin(f); assert(pending(f)); assert.equal(state(f), before);
  const quote = f.info.querySelector('[data-mineral-removal-quote]').textContent;
  assert.match(quote, /永久留下 3×3.*无法复垦.*不可通行.*不能再次拆除/);
  assert.match(quote, /剩余 6988 储量单位.*3494 铁或 6988 煤.*永久丢弃/);
  assert.match(quote, /一半已付建材.*仅退一次.*随身携带的矿物保留/);
  assert.equal(f.doc.activeElement, control(f, 'confirm'));
  control(f, 'cancel').click(); assert(!pending(f)); assert.equal(state(f), before);
  assert.equal(f.doc.activeElement, f.info.querySelector('#info-demolish'));
  confirm(f); assert.equal(state(f), before);
});

test('both completed mineral types leave an actual permanent pit once and keep carried ore after confirmation', () => {
  for (const type of ['mine', 'stonequarry']) {
    const f = mined(type), G = f.G, old = f.b, before = { ...G.game.res }, cargo = { ...f.c.carry };
    begin(f); const stale = control(f, 'confirm'); confirm(f);
    assert.equal(G.world.bmap[old.id], undefined);
    const pit = G.world.buildings.find(b => b.type === 'mineralpit'); assert(pit);
    assert.equal(pit.pitSource, type); assert.equal(pit.mineralUnits, old.mineralUnits);
    for (const [resource, paid] of Object.entries(old.paidCost)) assert.equal(G.game.res[resource], before[resource] + Math.floor(paid / 2));
    assert.equal(f.c.carry.type, cargo.type); assert.equal(f.c.carry.qty, cargo.qty);
    const after = state(f); stale.click(); stale.click(); G.removeBuilding(old); assert.equal(state(f), after);
    f.select(pit); assert.match(f.info.textContent, /永久废矿坑.*不可复垦.*不可通行/);
    assert.match(f.info.querySelector('[data-mineral-pit-source]').textContent, new RegExp(G.BDEF[type].name));
    assert.equal(f.info.querySelector('#info-demolish'), null);
    assert.equal(f.info.querySelector('[data-workforce-panel]'), null);
    assert.equal(f.doc.getElementById('mine-mode'), null);
    assert.equal(G.removeBuilding(pit), false); assert.equal(state(f), after);
  }
});

test('map demolish opens the same confirmation when no details are selected, and cancellation is harmless', () => {
  const f = mined(), G = f.G; G.ui.hideInfo(); G.setTool('demolish'); const before = state(f);
  G.demolishAt(f.b.x, f.b.y);
  assert.equal(G.sel.id, f.b.id); assert(!f.info.classList.contains('hidden')); assert(pending(f));
  assert.equal(state(f), before); control(f, 'cancel').click(); assert.equal(state(f), before);
  G.demolishAt(f.b.x, f.b.y); assert(pending(f)); confirm(f); assert(G.world.buildings.some(b => b.type === 'mineralpit'));
});

test('unstarted sites and completed but unused points demolish directly without permanent pits', () => {
  for (const type of ['mine', 'stonequarry']) for (const instant of [false, true]) {
    const f = setup(type, { instant }), before = { ...f.G.game.res }, paid = f.b.paidCost;
    assert(!f.G.mineralRemovalQuote(f.b).leavesPit); begin(f);
    assert.equal(f.G.world.bmap[f.b.id], undefined);
    assert(!f.G.world.buildings.some(b => b.type === 'mineralpit'));
    for (const [resource, amount] of Object.entries(paid)) assert.equal(f.G.game.res[resource], before[resource] + (instant ? Math.floor(amount / 2) : amount));
  }
});

test('new extraction revokes pending intent on both timed refresh and direct confirm without a tick', () => {
  for (const tick of [false, true]) {
    const f = mined(); begin(f); f.c.carry = null; extract(f); const before = state(f), stale = control(f, 'confirm');
    if (tick) f.G.ui.renderInfo(); else stale.click();
    assert.equal(state(f), before); assert(!pending(f)); assert(stale.disabled);
    assert.match(f.info.querySelector('[data-mineral-removal-message]').textContent, /储量或矿点状态已变化/);
    begin(f); assert(pending(f)); confirm(f); assert.equal(f.G.world.bmap[f.b.id], undefined);
  }
});

test('close, selection changes, modal interruptions and detached same-building controls invalidate consent', () => {
  for (const flow of ['close', 'selection', 'modal', 'game', 'world', 'same-id', 'state', 'type', 'panel']) {
    const f = mined(); begin(f); const stale = control(f, 'confirm');
    if (flow === 'close') { f.G.ui.hideInfo(); f.select(f.b); }
    if (flow === 'selection') { f.select(f.building('house')); f.select(f.b); }
    if (flow === 'modal') f.G.hasOpenModal = () => true;
    if (flow === 'game') f.G.game = { ...f.G.game };
    if (flow === 'world') f.G.world = { ...f.G.world };
    if (flow === 'same-id') f.G.world.bmap[f.b.id] = { ...f.b };
    if (flow === 'state') f.b.state = 'site';
    if (flow === 'type') f.b.type = 'stonequarry';
    if (flow === 'panel') { f.info.innerHTML = ''; f.G.ui._infoSelection = null; f.select(f.b); }
    const before = state(f); stale.click(); assert.equal(state(f), before, flow);
    assert(f.G.world.bmap[f.b.id], flow);
  }
});

test('actual same-ID save reload rejects old-world callbacks and keeps saved remaining units', () => {
  const f = mined(), old = f.b; begin(f); const stale = control(f, 'confirm'), saved = JSON.parse(state(f));
  f.mount('over'); f.G.T2S = () => [0, 0]; f.G.cam = { x: 0, y: 0, z: 1 }; f.G.groundDirty = new Set();
  f.G.applySaveData(saved);
  const restored = f.G.world.bmap[old.id]; assert.notEqual(restored, old); assert.equal(restored.mineralUnits, old.mineralUnits);
  const before = state(f); stale.click(); assert.equal(state(f), before);
  f.b = restored; f.select(restored); begin(f); assert(pending(f)); control(f, 'cancel').click(); assert.equal(state(f), before);
});

test('entering and immediately leaving a dialog cancels destructive intent even before the next UI tick', () => {
  const f = mined(); begin(f); const stale = control(f, 'confirm'), before = state(f);
  const dialog = f.mount('saves'); f.G.ui.enterDialog('saves'); dialog.classList.add('hidden'); f.G.ui.leaveDialog('saves');
  assert(!pending(f)); stale.click(); assert.equal(state(f), before);
  begin(f); f.G.hasOpenModal = () => true; f.G.ui.renderInfo(); assert(!pending(f));
});

test('double-click and repeated keyboard activation cannot join the two demolition steps', () => {
  const f = mined(), before = state(f); begin(f);
  let prevented = false;
  control(f, 'confirm').emit('keydown', { key: 'Enter', repeat: true, preventDefault() { prevented = true; } });
  assert(prevented);
  control(f, 'confirm').emit('click', { detail: 2 });
  assert(!pending(f)); assert.equal(state(f), before);
  begin(f); confirm(f); assert.equal(f.G.world.bmap[f.b.id], undefined);
});

test('a stale core quote does not silently reopen or accept a changed amount', () => {
  const f = mined(), key = f.G.mineralRemovalQuote(f.b).key;
  f.c.carry = null; extract(f); const before = state(f);
  assert.equal(f.G.removeBuilding(f.b, key), false); assert.equal(state(f), before); assert(!pending(f));
});

test('viewing details remains read-only and blacksmith controls and legacy demolition retain original behavior', () => {
  const f = mined(), before = state(f);
  for (let n = 0; n < 4; n++) f.G.ui.renderInfo(); assert.equal(state(f), before);
  const legacy = f.building('mine', { mineMode: 'legacy', legacyMine: true }); f.select(legacy);
  const select = f.doc.getElementById('mine-mode'); select.value = 'coal'; select.emit('change');
  assert(!f.G.finiteMineral(legacy)); assert.match(live(f, 'reserve'), /旧版无限/); begin(f);
  assert.equal(f.G.world.bmap[legacy.id], undefined); assert(!f.G.world.buildings.some(b => b.type === 'mineralpit'));
  const smith = f.building('blacksmith', { toolRecipe: 'iron', toolLimit: 30 }); f.select(smith);
  assert.equal(control(f, 'confirm'), null); assert.equal(f.info.querySelector('[data-resource-chain-live="reserve"]'), null);
  const recipe = f.doc.getElementById('tool-recipe'); recipe.value = 'steel'; recipe.emit('change');
  assert.equal(f.G.blacksmithOutput(smith), 'steelTools'); assert.match(live(f, 'recipe'), /煤 → 2 钢工具/);
  f.info.querySelector('[data-tl="10"]').click(); assert.equal(smith.toolLimit, 40);
});

console.log(`Mineral reserve UI: ${passed} DOM/live-simulation suites passed (not browser/mobile acceptance).`);
