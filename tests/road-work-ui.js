/* Road-work planning/details use real simulation APIs. DOM/input contracts only;
 * these tests do not claim browser or mobile visual acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function fixture() {
  const roots = [], documentEvents = {};
  const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g,
    (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[key]));
  const doc = { activeElement: null, addEventListener(type, fn) { (documentEvents[type] ||= []).push(fn); },
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
        const event = { target: this, type, ...(typeof detail === 'object' ? detail : { detail }), defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
        for (const fn of handlers[type] || []) fn(event);
        return event;
      },
      click(detail = 1) { if (roots.some(root => root.contains(this))) this.focus(); return this.emit('click', detail); },
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
  const windowEvents = {};
  const ctx = { console, performance: { now: () => 0 }, setInterval() {}, requestAnimationFrame() {}, innerWidth: 1200, innerHeight: 800, document: doc, __errs: [], setTimeout() {}, addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); }, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'render', 'ui', 'main'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 64;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  G.markGroundDirty = () => {}; G.autosave = () => {};
  const generate = G.genWorld;
  G.genWorld = (seed, options) => { const w = generate(seed, options); w.water.fill(0); w.rock.fill(0); return w; };
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar');
  G.ui.el = { info, guide, toolbar, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
  const toasts = []; G.ui.toast = (...args) => toasts.push(args);
  G.game.res.wood = 1000; G.game.res.stone = 1000;
  G.ui.refreshHUD = () => { if (G.ui.refreshRoadControls) G.ui.refreshRoadControls(); }; 
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
  const node = key => info.querySelector(`[data-site-${key}]`);
  function windowEvent(type, props = {}) { for (const fn of windowEvents[type] || []) fn({ type, preventDefault() {}, stopImmediatePropagation() {}, ...props }); }
  function documentEvent(type, props = {}) { for (const fn of documentEvents[type] || []) fn({ type, preventDefault() {}, ...props }); }
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, mount, element, toasts, windowEvent, documentEvent }; 
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const input = (f, id) => f.doc.getElementById(id);
const fact = (f, key) => f.info.querySelector(`[data-site-${key}]`);
const snapshot = f => JSON.stringify({ world: f.G.world, game: f.G.game });
const cells = (x = 8, y = 8, count = 5) => Array.from({ length: count }, (_, n) => ({ x: x + n, y }));
const projects = f => f.G.world.buildings.filter(b => b.type === 'roadwork');
function planning(surface = 'stone') {
  const f = fixture(), { G } = f, panel = f.mount('road-controls');
  panel.classList.add('hidden');
  panel.innerHTML = '<p id="road-plan-status" role="status" aria-live="polite"></p><button type="button" id="road-confirm">确认铺路</button><button type="button" id="road-cancel">重选起终点</button>';
  G.scheduleJobs = () => {};
  G.ui.initToolbar(); G.ui.initRoadControls(); G.setTool(surface === 'stone' ? 'stoneroad' : 'road');
  return f;
}
function preview(f, start = { x: 8, y: 8 }, end = { x: 12, y: 8 }) {
  f.G.cancelRoadPlan(); f.G.selectRoadEndpoint(start.x, start.y); f.G.selectRoadEndpoint(end.x, end.y); f.G.ui.refreshRoadControls();
}
function activate(f, id = 'road-confirm', type = 'mousedown') {
  const button = input(f, id); button.emit(type, type === 'keydown' ? { key: 'Enter' } : {}); return button;
}
function detail(surface = 'stone') {
  const f = fixture(); f.G.scheduleJobs = () => {};
  const result = f.G.addRoadWork(cells(), surface); assert(result.ok); assert(result.b);
  f.b = result.b; f.select(f.b); return f;
}
function partial(f) {
  const first = f.b.roadWork.cells[0]; first.done = true; first.used = f.b.roadWork.surface === 'stone'; first.workLeft = 0;
  f.G.setRoad(f.G.world, first.x, first.y, first.target);
  f.b.workLeft = f.b.roadWork.cells.reduce((sum, cell) => sum + cell.workLeft, 0);
  f.b.progress = 1 - f.b.workLeft / f.b.totalWork;
}

test('road controls stay in the existing land category without exposing the internal project', () => {
  const f = planning(), { G } = f;
  assert.equal(f.toolbar.querySelectorAll('[data-category]').length, 5);
  assert(f.toolbar.querySelector('[data-tool="road"]')); assert(f.toolbar.querySelector('[data-tool="stoneroad"]'));
  assert.equal(f.toolbar.querySelector('[data-tool="roadwork"]'), null);
  assert.match(f.toolbar.querySelector('[data-tool="road"]').textContent, /免材料.*每格1工时/);
  assert.match(f.toolbar.querySelector('[data-tool="stoneroad"]').textContent, /每格1石.*1工时/);
  assert.match(f.toolbar.querySelector('[data-tool="stoneroad"]').getAttribute('title'), /本作适配.*逐格实运施工后才提速/);
  assert.equal(input(f, 'road-confirm').textContent, '确认排队施工'); assert(input(f, 'road-confirm').disabled);
  assert.equal(G.ui.toolGroups.flatMap(group => group.tools).filter(t => t === 'roadwork').length, 0);
});
test('low stock stone preview explains queue, material delivery, adaptation, and unchanged existing travel', () => {
  const f = planning(), { G } = f; G.game.res.stone = 0; G.setRoad(G.world, 8, 8, 2); G.setRoad(G.world, 9, 8, 1);
  preview(f); const text = input(f, 'road-plan-status').textContent;
  assert.match(text, /路线 5 格.*待排施工 4.*复用已成路 1.*已排队 0/);
  assert.match(text, /合计 4 石/); assert.match(text, /4 基础游戏施工小时.*本作适配/);
  assert.match(text, /不预扣或预留材料.*原道路仍可走.*每格实际完工后才提速/);
  assert.match(text, /材料不足：石头差4；仍可排队/); assert(!input(f, 'road-confirm').disabled);
  activate(f).click(); assert.equal(projects(f).length, 1); assert.equal(projects(f)[0].state, 'site'); assert.equal(G.game.res.stone, 0);
  assert.equal(G.world.road[8 * G.world.N + 8], 2); assert.equal(G.world.road[8 * G.world.N + 9], 1);
  assert.equal(G.world.road[8 * G.world.N + 10], 0); assert.equal(G.world.bgrid[8 * G.world.N + 10], -1);
  assert.match(f.toasts.at(-1)[0], /已排队 4 格石路施工.*逐格完工后才提速/);
  input(f, 'road-confirm').click(2); assert.equal(projects(f).length, 1);
});
test('dirt plan consumes no materials and queues actual work without an instant road', () => {
  const f = planning('dirt'); preview(f);
  assert.match(input(f, 'road-plan-status').textContent, /土路材料消耗：0/);
  const before = JSON.stringify(f.G.game.res); activate(f).click();
  assert.equal(projects(f).length, 1); assert.equal(projects(f)[0].roadWork.surface, 'dirt');
  assert.equal(JSON.stringify(f.G.game.res), before); assert.equal(f.G.world.road.reduce((sum, n) => sum + n, 0), 0);
  assert.match(f.toasts.at(-1)[0], /已排队 5 格土路施工/);
});
test('tree clearing remains a separate step before road construction confirmation', () => {
  const f = planning(), { G } = f, w = G.world, index = 8 * w.N + 8;
  w.trees.push({ x: 8, y: 8, age: 12, alive: true }); w.treeIdx[index] = 0;
  preview(f); assert.equal(input(f, 'road-confirm').textContent, '确认标记清树');
  activate(f).click(); assert(w.marked.has(index)); assert.equal(projects(f).length, 0);
  assert.equal(input(f, 'road-confirm').textContent, '等待工人清树'); assert(input(f, 'road-confirm').disabled);
  w.trees[0].alive = false; w.treeIdx[index] = -1; w.marked.delete(index); G.ui.refreshRoadControls();
  assert.equal(input(f, 'road-confirm').textContent, '确认排队施工'); assert(!input(f, 'road-confirm').disabled);
  activate(f).click(); assert.equal(projects(f).length, 1); assert.equal(w.road[index], 0);
});
for (const mode of ['plan', 'world', 'tool', 'modal', 'pointercancel', 'touchcancel', 'blur']) test('stale or interrupted road confirmation cannot queue after ' + mode, () => {
  const f = planning(); preview(f); const button = activate(f);
  if (mode === 'plan') preview(f, { x: 20, y: 8 }, { x: 24, y: 8 });
  if (mode === 'world') f.G.world = { ...f.G.world };
  if (mode === 'tool') f.G.setTool('house'); if (mode === 'modal') f.G.hasOpenModal = () => true;
  if (mode === 'pointercancel' || mode === 'touchcancel') button.emit(mode); if (mode === 'blur') f.windowEvent('blur');
  const before = snapshot(f); button.click(); assert.equal(snapshot(f), before);
});
test('touch and keyboard queue one project and preview cancellation never changes the world', () => {
  for (const type of ['touchstart', 'keydown']) {
    const f = planning(); preview(f); const before = snapshot(f); input(f, 'road-cancel').click(); assert.equal(snapshot(f), before);
    preview(f); const button = activate(f, 'road-confirm', type); button.click(); button.emit('keydown', { key: 'Enter', repeat: true }); button.click(2);
    assert.equal(projects(f).length, 1); assert.equal(f.G.world.road.reduce((sum, n) => sum + n, 0), 0);
  }
});
test('detail shows completed cells, material ownership, actual-hour adaptation, and live refund', () => {
  const f = detail(), { G } = f; partial(f); f.b.construction.onsite.stone = 2; G.ui.renderInfo();
  const s = G.roadWorkSummary(f.b);
  assert.match(fact(f, 'status').textContent, /石路施工.*已完成 1\/5 格.*待完工 4 格/);
  assert.match(fact(f, 'materials').textContent, /需要 5.*堆料点未用 2.*携带合计 0.*已投入 1.*待领 2/);
  assert.match(f.info.querySelector('[data-road-work-progress]').textContent, /剩余 4 \/ 总计 5 基础游戏施工小时.*本作适配/);
  assert.match(fact(f, 'delivery').textContent, /仓库→堆料点携带 0 石.*堆料点→施工格携带 0 石.*不重复计入/);
  assert.match(f.info.querySelector('[data-info-refund]').textContent, /当前可立即返还 石头×2.*已投入石材不返还.*已完工路面和原有道路保留/);
  assert(fact(f, 'status').textContent.includes(s.status)); assert.equal(input(f, 'info-demolish').textContent, '取消剩余铺路');
});
test('road read-only details refresh facts without remounting focused controls or mutating simulation', () => {
  const f = detail(), { G } = f, button = input(f, 'construction-priority'), material = fact(f, 'materials');
  button.focus(); const writes = f.info.htmlWrites; f.b.construction.onsite.stone = 3;
  const before = snapshot(f); G.ui.renderInfo(); assert.equal(snapshot(f), before);
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, button); assert.equal(fact(f, 'materials'), material);
  assert.match(material.textContent, /堆料点未用 3/); assert.match(f.info.querySelector('[data-info-refund]').textContent, /石头×3/);
});
test('dirt project explains zero material and still has real progress and workforce controls', () => {
  const f = detail('dirt'); assert.match(fact(f, 'status').textContent, /土路施工.*已完成 0\/5/);
  assert.match(fact(f, 'materials').textContent, /土路无需建材.*实际施工/);
  assert.match(f.info.querySelector('[data-info-refund]').textContent, /当前可立即返还 0 材料/);
  for (const id of ['construction-pause', 'construction-resume', 'construction-priority', 'construction-normal']) assert(input(f, id));
});
test('pause, resume, and priority reuse existing idempotent workforce controls', () => {
  const f = detail(), { G } = f; partial(f); f.b.construction.onsite.stone = 2; G.ui.renderInfo();
  const road = Array.from(G.world.road), pause = input(f, 'construction-pause'); pause.click(); assert(f.b.sitePaused); pause.click(2); assert(f.b.sitePaused);
  assert.match(fact(f, 'status').textContent, /暂停/); assert.deepEqual(Array.from(G.world.road), road); assert.equal(f.b.construction.onsite.stone, 2);
  input(f, 'construction-priority').click(); assert(f.b.sitePriority); input(f, 'construction-priority').click(2); assert(f.b.sitePriority);
  input(f, 'construction-resume').click(); assert(!f.b.sitePaused); assert.equal(f.b.construction.onsite.stone, 2);
  input(f, 'construction-normal').click(); assert(!f.b.sitePriority); assert.deepEqual(Array.from(G.world.road), road);
});
test('cancel remaining roadwork refunds only unspent staging stock once and retains completed road', () => {
  const f = detail(), { G } = f; partial(f); f.b.construction.onsite.stone = 2; G.ui.renderInfo();
  const road = Array.from(G.world.road), stone = G.game.res.stone, button = input(f, 'info-demolish');
  activate(f, 'info-demolish').click(); assert.equal(G.world.bmap[f.b.id], undefined); assert.equal(G.game.res.stone, stone + 2);
  assert.deepEqual(Array.from(G.world.road), road); const after = snapshot(f); button.click(2); assert.equal(snapshot(f), after);
});
for (const mode of ['world', 'game', 'selection', 'hidden', 'panel', 'modal', 'removed']) test('stale cancel and pause controls cannot change another project after ' + mode, () => {
  const f = detail(), { G } = f, cancel = activate(f, 'info-demolish'), pause = input(f, 'construction-pause');
  if (mode === 'world') G.world = { ...G.world }; if (mode === 'game') G.game = { ...G.game };
  if (mode === 'selection') { const other = G.addRoadWork(cells(20), 'dirt').b; f.select(other); }
  if (mode === 'hidden') f.info.classList.add('hidden'); if (mode === 'panel') { G.ui.hideInfo(); f.select(f.b); }
  if (mode === 'modal') G.hasOpenModal = () => true; if (mode === 'removed') G.removeBuilding(f.b);
  const before = snapshot(f); cancel.click(); pause.click(); assert.equal(snapshot(f), before);
});
for (const mode of ['pointercancel', 'touchcancel', 'blur', 'windowblur', 'repeat']) test('interrupted cancellation requires a fresh gesture after ' + mode, () => {
  const f = detail(), button = activate(f, 'info-demolish');
  if (mode === 'windowblur') f.windowEvent('blur'); else if (mode === 'repeat') button.emit('keydown', { key: 'Enter', repeat: true }); else button.emit(mode);
  const before = snapshot(f); button.click(); assert.equal(snapshot(f), before);
  activate(f, 'info-demolish').click(); assert.equal(f.G.world.bmap[f.b.id], undefined);
});
test('live detail distinguishes assigned shortage, warehouse hauling, and cell-bound stone without double counting', () => {
  const f = detail(), { G } = f;
  assert.match(fact(f, 'status').textContent, /等待分配铺路工人/);
  const fetch = G.spawnCitizen({ x: 4, y: 4, age: 30, sex: 'm', name: '运料工' });
  const pave = G.spawnCitizen({ x: 8, y: 8, age: 30, sex: 'f', name: '铺路工' });
  for (const c of [fetch, pave]) { c.job = f.b.id; f.b.workers.push(c.id); }
  G.game.res.stone = 0; G.ui.renderInfo(); assert.match(fact(f, 'status').textContent, /缺石材/);
  fetch.carry = { type: 'stone', qty: 2, constructionId: f.b.id }; G.ui.renderInfo();
  assert.match(fact(f, 'status').textContent, /实运石材/);
  pave.carry = { type: 'stone', qty: 1, constructionId: f.b.id, roadPaving: true }; f.b.construction.onsite.stone = 1;
  G.ui.renderInfo(); assert.match(fact(f, 'status').textContent, /现场石材带往目标格/);
  assert.match(fact(f, 'materials').textContent, /堆料点未用 1.*携带合计 3.*已投入 0.*待领 1/);
  assert.match(fact(f, 'delivery').textContent, /仓库→堆料点携带 2 石.*堆料点→施工格携带 1 石/);
  assert.match(f.info.querySelector('[data-info-refund]').textContent, /当前可立即返还 石头×1/);
});
function bindInput(surface) {
  const f = planning(surface), canvas = f.mount('game'); canvas.style = {}; canvas.getContext = () => ({}); canvas.getBoundingClientRect = () => ({ left: 17, top: 29 });
  f.G.ui.init = () => {}; f.G.feedback = { init() {} }; f.G.tryReplayLoad = () => true; f.G.probeServerSaves = () => {}; f.G.init();
  const point = (x, y) => { const [sx, sy] = f.G.T2S(x + .25, y + .25); return { clientX: 17 + sx * f.G.cam.z + f.G.cam.x, clientY: 29 + sy * f.G.cam.z + f.G.cam.y, target: canvas, button: 0 }; };
  const mouse = (type, x, y) => type === 'mousedown' ? canvas.emit(type, point(x, y)) : f.windowEvent(type, point(x, y));
  const touch = (type, x, y) => { const p = point(x, y); return canvas.emit(type, { touches: type === 'touchend' ? [] : [p], changedTouches: [p] }); };
  return Object.assign(f, { mouse, touch });
}
test('actual canvas mouse drag and touch endpoints preview first and separately queue real roadwork', () => {
  for (const [mode, surface] of [['mouse', 'dirt'], ['touch', 'stone']]) {
    const f = bindInput(surface);
    if (mode === 'mouse') { f.mouse('mousedown', 8, 8); f.mouse('mousemove', 12, 8); f.mouse('mouseup', 12, 8); }
    else for (const x of [8, 12]) { f.touch('touchstart', x, 8); f.touch('touchend', x, 8); }
    assert.equal(projects(f).length, 0); assert(f.G.roadPlanStatus().ok); f.G.ui.refreshRoadControls();
    activate(f, 'road-confirm', mode === 'mouse' ? 'mousedown' : 'touchstart').click();
    assert.equal(projects(f).length, 1); assert.equal(projects(f)[0].roadWork.surface, surface);
    assert.equal(f.G.world.road.reduce((sum, n) => sum + n, 0), 0);
  }
});
test('replanning separates completed roads from already queued work and never bills the same cells twice', () => {
  const f = planning(); preview(f); activate(f).click(); f.b = projects(f)[0]; partial(f);
  preview(f); const text = input(f, 'road-plan-status').textContent;
  assert.match(text, /待排施工 0.*复用已成路 1.*已排队 4/); assert.match(text, /合计 0 石/); assert.match(text, /新增建造 0 基础游戏施工小时/);
  const before = snapshot(f); activate(f).click(); assert.equal(snapshot(f), before); assert.equal(projects(f).length, 1);
  assert.match(f.toasts.at(-1)[0], /无需重复排队/);
  preview(f, { x: 8, y: 8 }, { x: 15, y: 8 }); assert.match(input(f, 'road-plan-status').textContent, /待排施工 3.*复用已成路 1.*已排队 4/);
  activate(f).click(); assert.equal(projects(f).length, 2); assert.equal(projects(f)[1].roadWork.cells.length, 3);
});
test('conflicting road surface reports its live blocker without permitting a second queue', () => {
  const f = planning('dirt'); preview(f); activate(f).click(); f.G.setTool('stoneroad'); preview(f);
  assert(input(f, 'road-confirm').disabled); assert.match(input(f, 'road-plan-status').textContent, /已有另一种铺路工程/);
  const before = snapshot(f); activate(f).click(); assert.equal(snapshot(f), before); assert.equal(projects(f).length, 1);
});
test('selecting an unbuilt road marker opens its existing project details without occupying the tile', () => {
  const f = detail(), { G } = f; G.ui.hideInfo(); assert.equal(G.world.bgrid[8 * G.world.N + 10], -1);
  G.selectAt(10, 8, { x: 0, y: 0 }); assert.equal(G.sel.id, f.b.id); assert(!f.info.classList.contains('hidden'));
  assert.match(fact(f, 'status').textContent, /已完成 0\/5 格/); assert.equal(input(f, 'info-demolish').textContent, '取消剩余铺路');
});
test('actual last-cell completion closes the temporary project and its old controls cannot remove finished road', () => {
  const f = detail('dirt'), { G } = f, oldCancel = input(f, 'info-demolish'), oldPause = input(f, 'construction-pause');
  const c = G.spawnCitizen({ x: 8, y: 8, age: 30, sex: 'f', name: '铺路工' }); c.job = f.b.id; f.b.workers.push(c.id);
  for (let index = 0; index < 5; index++) {
    G.requestRoadWork(c, f.b); assert.equal(c.task.kind, 'roadPave');
    const target = f.b.roadWork.cells[c.task.cell]; c.x = target.x; c.y = target.y; c.state = 'work'; G.stepRoadWork(c, 3);
    if (index < 4) { G.ui.renderInfo(); assert.match(fact(f, 'status').textContent, new RegExp(`已完成 ${index + 1}/5 格`)); }
  }
  assert.equal(G.world.bmap[f.b.id], undefined); assert.equal(G.sel, null); assert(f.info.classList.contains('hidden'));
  assert.equal(cells().filter(p => G.world.road[p.y * G.world.N + p.x] === 1).length, 5);
  const before = snapshot(f); oldCancel.click(); oldPause.click(); assert.equal(snapshot(f), before);
  assert.match(f.toasts.at(-1)[0], /铺路工程已完成/);
});
test('completed non-staging cell releases selection while the first material staging cell stays selectable', () => {
  const f = detail('dirt'), { G } = f;
  const c = G.spawnCitizen({ x: 8, y: 8, age: 30, sex: 'f', name: '铺路工' }); c.job = f.b.id; f.b.workers.push(c.id);
  for (let index = 0; index < 2; index++) {
    G.requestRoadWork(c, f.b); const target = f.b.roadWork.cells[c.task.cell]; c.x = target.x; c.y = target.y; c.state = 'work'; G.stepRoadWork(c, 3);
  }
  assert.equal(G.world.road[8 * G.world.N + 8], 1); assert.equal(G.world.road[8 * G.world.N + 9], 1);
  G.selectAt(9, 8, { x: -10000, y: -10000 }); assert.equal(G.sel, null); assert(f.info.classList.contains('hidden'));
  G.selectAt(8, 8, { x: -10000, y: -10000 }); assert.equal(G.sel.id, f.b.id); assert(!f.info.classList.contains('hidden'));
  assert.match(fact(f, 'delivery').textContent, /工程首格是临时堆料点 \(8,8\).*该格完工后仍保留至工程结束.*其他完工格释放/);
  assert.match(fact(f, 'status').textContent, /已完成 2\/5 格/);
});
test('citizen activity identifies road material pickup, travel, and actual paving while cargo keeps its specialized label', () => {
  const f = detail(), { G } = f, c = G.spawnCitizen({ x: 8, y: 8, age: 30, sex: 'f', name: '铺路工' });
  c.job = f.b.id; c.walkKind = 'job'; c.task = { kind: 'roadPave', phase: 'load', b: f.b, cell: 0 };
  for (const state of ['walk', 'work']) { c.state = state; assert.equal(G.ui.citizenStatus(c), '从现场领取铺路石材'); }
  c.task.phase = 'pave'; c.state = 'walk'; assert.equal(G.ui.citizenStatus(c), '前往待铺路格');
  c.state = 'work'; assert.equal(G.ui.citizenStatus(c), '正在铺路（该格完工后才提速）');
  c.state = 'idle'; assert.equal(G.ui.citizenStatus(c), '等待到格铺路');
  c.carry = { type: 'stone', qty: 1, constructionId: f.b.id, roadPaving: true }; c.state = 'walk';
  assert.equal(G.ui.citizenStatus(c), G.constructionCarryState(c), 'actual carried goods use the core material-leg label');
  c.carry = null; c.walkKind = 'home'; assert.equal(G.ui.citizenStatus(c), '回家途中');
});
console.log(`Road-work UI: ${passed} DOM/input suites passed (not browser/mobile acceptance).`);
