/* Area pasture planning and detail controls use real game APIs.
 * These are DOM/live-simulation contracts, not browser/mobile visual acceptance. */
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
  G.ui.refreshHUD = () => { if (G.ui.refreshPasturePlanControls) G.ui.refreshPasturePlanControls(); }; 
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
  function windowEvent(type, props = {}) { for (const fn of windowEvents[type] || []) fn({ type, preventDefault() {}, stopImmediatePropagation() {}, ...props }); }
  function documentEvent(type, props = {}) { for (const fn of documentEvents[type] || []) fn({ type, preventDefault() {}, ...props }); }
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, mount, element, toasts, windowEvent, documentEvent }; 
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const input = (f, id) => f.doc.getElementById(id);
const live = (f, key) => f.info.querySelector(`[data-economy-live="${key}"]`).textContent;
function planning() {
  const f = fixture();
  const panel = f.mount('pasture-plan-controls'); panel.classList.add('hidden');
  panel.innerHTML = '<p id="pasture-plan-status" role="status" aria-live="polite"></p><button type="button" id="pasture-plan-confirm">确认圈地</button><button type="button" id="pasture-plan-cancel">重选两个角</button>';
  const farm = f.mount('farm-plan-controls'); farm.classList.add('hidden');
  farm.innerHTML = '<p id="farm-plan-status"></p><button type="button" id="farm-plan-confirm">确认开田</button><button type="button" id="farm-plan-cancel">重选两个角</button>';
  f.G.ui.initToolbar(); f.G.ui.initPasturePlanControls(); f.G.ui.initFarmPlanControls();
  f.G.setTool('pasture');
  return f;
}
function preview(f, width = 7, height = 7, x = 2, y = 2) {
  f.G.cancelPasturePlan(); f.G.selectPastureCorner(x, y); f.G.selectPastureCorner(x + width - 1, y + height - 1);
  f.G.ui.refreshPasturePlanControls(); return f.G.pasturePlanStatus();
}
function activate(f, mode = 'mousedown') {
  const button = input(f, 'pasture-plan-confirm');
  button.emit(mode, mode === 'keydown' ? { key: 'Enter', repeat: false } : {}); return button;
}
function snapshot(f) { return JSON.stringify({ res: f.G.game.res, buildings: f.G.world.buildings, marks: [...f.G.world.marked], trees: f.G.world.trees }); }
function detail(size, type = 'sheep') {
  const f = fixture();
  const result = f.G.addBuilding('pasture', 2, 2, { instant: true, free: true, ...(size ? { pastureSize: size } : {}) });
  assert(result.ok, result.reason); f.b = result.b;
  f.G.setPastureType(f.b, type); f.G.game.livestock = { sheep: 100, cattle: 100, chicken: 100 };
  f.select(f.b); return f;
}
function setType(f, type) { input(f, 'pasture-type').value = type; input(f, 'pasture-type-form').emit('submit'); }

// Verify the shipped integration points as well as the mounted DOM fixture.
test('HTML mounts accessible preview controls and toolbar advertises rectangle planning', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const id of ['pasture-plan-controls', 'pasture-plan-status', 'pasture-plan-confirm', 'pasture-plan-cancel']) assert.match(html, new RegExp(`id="${id}"`));
  const f = planning();
  assert.match(input(f, 'toolbar-state').textContent, /选两个角或拖出矩形.*确认圈地/);
  assert.match(f.toolbar.querySelector('[data-tool="pasture"]').textContent, /7–20格/);
  assert(!input(f, 'pasture-plan-controls').classList.contains('hidden'));
  assert(input(f, 'pasture-plan-confirm').disabled);
});

test('valid preview discloses densities, three capacities, wood, work and staffing without side effects', () => {
  const f = planning(), before = snapshot(f), s = preview(f, 10, 20);
  assert(s.ok, s.reason); assert.equal(snapshot(f), before);
  const text = input(f, 'pasture-plan-status').textContent;
  assert.match(text, /10×20.*200格/); assert.match(text, /羊 12 头.*牛 10 头.*鸡 33 只/);
  assert.match(text, /木材×75.*278 工时.*本作适配/); assert.match(text, /上限 2 人/);
  assert.match(text, /牛20格\/头、羊16格\/头、鸡6格\/只.*向下取整/);
  assert.match(text, /工人实际砍伐搬木后施工/); assert.match(text, /确认创建工地，不预扣\/预留材料/);
  const confirm = input(f, 'pasture-plan-confirm'); confirm.focus();
  const writes = input(f, 'pasture-plan-controls').htmlWrites;
  f.G.ui.refreshPasturePlanControls();
  assert.equal(input(f, 'pasture-plan-confirm'), confirm); assert.equal(f.doc.activeElement, confirm);
  assert.equal(input(f, 'pasture-plan-controls').htmlWrites, writes);
});

test('confirmation creates exactly one sized construction material plan and reselect leaves it intact', () => {
  const f = planning(); preview(f);
  const wood = f.G.game.res.wood; activate(f).click();
  assert.equal(f.G.world.buildings.length, 1); const b = f.G.world.buildings[0];
  assert.equal(b.type, 'pasture'); assert.equal(b.state, 'site');
  assert.deepEqual(Array.from(b.pastureSize), [7, 7]); assert.equal(b.animals || 0, 0);
  assert.equal(f.G.game.res.wood, wood); assert.equal(b.construction.required.wood,35); assert.equal(Object.values(b.construction.onsite).reduce((a,n)=>a+n,0),0); assert.equal(b.totalWork, 69);
  input(f, 'pasture-plan-confirm').click(2); assert.equal(f.G.world.buildings.length, 1);
  preview(f, 8, 8, 15, 15); const before = snapshot(f);
  input(f, 'pasture-plan-cancel').click();
  assert.equal(f.G.pasturePlan, null); assert.equal(snapshot(f), before);
  assert.equal(f.doc.activeElement, f.toolbar.querySelector('[data-tool="pasture"]'));
});

test('cancel before confirmation changes no world, marks or resources', () => {
  const f = planning(); preview(f); const before = snapshot(f);
  activate(f); input(f, 'pasture-plan-cancel').click(); input(f, 'pasture-plan-confirm').click();
  assert.equal(snapshot(f), before); assert.equal(f.G.pasturePlan, null);
});

for (const key of ['Enter', ' ']) test(`held ${key === ' ' ? 'Space' : key} never confirms a newer preview`, () => {
  const f = planning(); preview(f); const b = input(f, 'pasture-plan-confirm');
  b.emit('keydown', { key }); if (key === ' ') b.emit('keyup', { key }); b.click(0);
  assert.equal(f.G.world.buildings.length, 1);
  preview(f, 7, 7, 20, 20); const before = snapshot(f);
  const event = b.emit('keydown', { key, repeat: true }); assert(event.defaultPrevented); b.click(0);
  assert.equal(snapshot(f), before);
  b.emit('keyup', { key }); b.emit('keydown', { key }); if (key === ' ') b.emit('keyup', { key }); b.click(0);
  assert.equal(f.G.world.buildings.length, 2);
});

for (const mode of ['pointercancel', 'touchcancel', 'blur', 'window-blur']) test(`${mode} discards a partially armed confirmation`, () => {
  const f = planning(); preview(f); const b = activate(f), before = snapshot(f);
  if (mode === 'window-blur') f.windowEvent('blur'); else b.emit(mode);
  b.click(); assert.equal(snapshot(f), before);
  activate(f).click(); assert.equal(f.G.world.buildings.length, 1);
});

for (const mode of ['world', 'game', 'tool', 'generation', 'plan', 'hidden', 'panel', 'confirm', 'cancel', 'modal']) test(`stale ${mode} confirmation cannot spend or build`, () => {
  const f = planning(); preview(f); const b = activate(f);
  if (mode === 'world') f.G.world = { ...f.G.world };
  if (mode === 'game') f.G.game = { ...f.G.game };
  if (mode === 'tool') f.G.setTool('house');
  if (mode === 'generation') { f.G.cancelPasturePlan(); preview(f, 9, 9); }
  if (mode === 'plan') { f.G.selectPastureCorner(20, 20); f.G.selectPastureCorner(27, 27); f.G.ui.refreshPasturePlanControls(); }
  if (mode === 'hidden') input(f, 'pasture-plan-controls').classList.add('hidden');
  if (mode === 'panel') input(f, 'pasture-plan-controls').id = 'removed-pasture-panel';
  if (mode === 'confirm') b.id = 'removed-pasture-confirm';
  if (mode === 'cancel') input(f, 'pasture-plan-cancel').id = 'removed-pasture-cancel';
  if (mode === 'modal') f.mount('help');
  const before = snapshot(f); b.click(); assert.equal(snapshot(f), before);
});

for (const mode of ['resources', 'resource-quote', 'water', 'rock', 'building', 'tree']) test(`live ${mode} changes invalidate the captured quote`, () => {
  const f = planning(); preview(f); const b = activate(f), tile = 3 * f.G.world.N + 3;
  if (mode === 'resources') f.G.game.res.wood = 0;
  if (mode === 'resource-quote') f.G.game.res.wood -= 1;
  if (mode === 'water') f.G.world.water[tile] = 1;
  if (mode === 'rock') f.G.world.rock[tile] = 1;
  if (mode === 'building') f.G.world.bgrid[tile] = 999;
  if (mode === 'tree') { f.G.world.trees.push({ x: 3, y: 3, age: 12, alive: true, b: 1 }); f.G.world.treeIdx[tile] = 0; }
  const before = snapshot(f); b.click(); assert.equal(snapshot(f), before);
  assert(f.toasts.some(([text]) => /不足|水|岩石|重叠|变化|已变|复查/.test(text)), JSON.stringify(f.toasts));
});

for (const size of [[6, 7], [7, 21]]) test(`${size.join('x')} invalid size stays unconfirmable`, () => {
  const f = planning(); preview(f, ...size); const before = snapshot(f);
  assert(input(f, 'pasture-plan-confirm').disabled); assert.match(input(f, 'pasture-plan-status').textContent, /7.*20/);
  activate(f).click(); assert.equal(snapshot(f), before);
});

test('insufficient wood retains an informative quote and fresh resources require fresh activation', () => {
  const f = planning(); f.G.game.res.wood = 0; preview(f);
  assert.match(input(f, 'pasture-plan-status').textContent, /羊 3 头.*牛 2 头.*鸡 8 只/);
  assert.match(input(f, 'pasture-plan-status').textContent, /木材×35.*69 工时/);
  assert(input(f, 'pasture-plan-confirm').disabled);
  const confirm = activate(f); f.G.game.res.wood = 100; f.G.ui.refreshPasturePlanControls(); confirm.click();
  assert.equal(f.G.world.buildings.length, 0);
  activate(f).click(); assert.equal(f.G.world.buildings.length, 1);
});

test('preview reports real tree clearing and the below-200 staffing boundary', () => {
  const f = planning(), tile = 3 * f.G.world.N + 3;
  f.G.world.trees.push({ x: 3, y: 3, age: 12, alive: true, b: 1 }); f.G.world.treeIdx[tile] = 0;
  preview(f, 10, 19); assert.match(input(f, 'pasture-plan-status').textContent, /先清 1 棵树/);
  assert.match(input(f, 'pasture-plan-status').textContent, /上限 1 人/);
  preview(f, 10, 20); assert.match(input(f, 'pasture-plan-status').textContent, /上限 2 人/);
  assert.equal(f.G.world.trees[0].alive, true);
});

test('tool navigation hides pasture preview and restores focus to active tool', () => {
  const f = planning(); preview(f); input(f, 'pasture-plan-confirm').focus();
  f.G.setTool('farm');
  assert(input(f, 'pasture-plan-controls').classList.contains('hidden')); assert.equal(f.G.pasturePlan, null);
  assert.equal(f.doc.activeElement, f.toolbar.querySelector('[data-tool="farm"]'));
  f.G.setTool('pasture'); preview(f); f.G.ui.backToCategories();
  assert.equal(f.G.tool, null); assert.equal(f.G.pasturePlan, null); assert(input(f, 'pasture-plan-confirm').disabled);
});

test('farm planning, cancellation and explicit confirmation still use their own panel', () => {
  const f = planning(); preview(f); f.G.setTool('farm');
  f.G.selectFarmCorner(2, 2); f.G.selectFarmCorner(5, 5); f.G.ui.refreshFarmPlanControls();
  assert(!input(f, 'farm-plan-confirm').disabled); assert(input(f, 'pasture-plan-controls').classList.contains('hidden'));
  input(f, 'farm-plan-cancel').click(); assert.equal(f.G.farmPlan, null);
  f.G.selectFarmCorner(2, 2); f.G.selectFarmCorner(5, 5); f.G.ui.refreshFarmPlanControls();
  input(f, 'farm-plan-confirm').click();
  assert.equal(f.G.world.buildings.length, 1); assert.equal(f.G.world.buildings[0].type, 'farm');
  assert.equal(f.G.world.buildings[0].w, 4);
});

for (const size of [[7, 7], [10, 20], [20, 20]]) test(`${size.join('x')} detail uses area capacity and its real worker maximum`, () => {
  const f = detail(size), area = size[0] * size[1], maximum = area >= 200 ? 2 : 1;
  assert.match(live(f, 'pasture-area'), new RegExp(`${size[0]}×${size[1]}.*${area}格.*上限 ${maximum} 人`));
  assert.match(live(f, 'pasture-capacity-rule'), /原版面积密度.*向下取整/);
  assert.equal(input(f, 'worker-limit-input').getAttribute('max'), String(maximum));
  for (const [type, density] of [['sheep', 16], ['cattle', 20], ['chicken', 6]]) {
    setType(f, type); const cap = Math.floor(area / density);
    assert.equal(input(f, 'pasture-stock-quantity').max, String(cap));
    assert.equal(input(f, 'pasture-target-quantity').max, String(cap));
    const target = input(f, 'pasture-target-quantity'); target.focus(); target.value = String(cap);
    f.G.ui.refreshEconomyInfo(f.b); assert.equal(target.value, String(cap)); assert.equal(f.doc.activeElement, target);
    input(f, 'pasture-target-form').emit('submit'); assert.equal(f.b.animalTarget, cap);
    target.value = String(cap + 1); input(f, 'pasture-target-form').emit('submit'); assert.equal(f.b.animalTarget, cap);
  }
  input(f, 'worker-limit-input').value = String(maximum + 1); input(f, 'worker-limit-form').emit('submit');
  assert.equal(f.G.workerLimitOf(f.b), maximum);
  input(f, 'worker-limit-input').value = '0'; input(f, 'worker-limit-form').emit('submit'); assert.equal(f.G.workerLimitOf(f.b), 0);
});

test('legacy detail explicitly preserves 6x6 adaptation and old species capacities', () => {
  const f = detail();
  assert.match(live(f, 'pasture-area'), /6×6.*36格/);
  assert.match(live(f, 'pasture-capacity-rule'), /旧版6×6小地图容量适配.*羊12头.*牛10头.*鸡24只.*不按新面积规则缩减/);
  for (const [type, cap] of [['sheep', 12], ['cattle', 10], ['chicken', 24]]) {
    setType(f, type); assert.equal(input(f, 'pasture-stock-quantity').max, String(cap)); assert.equal(input(f, 'pasture-target-quantity').max, String(cap));
  }
});

test('site and ruined pasture never gain completed stocking actions', () => {
  const f = detail([7, 7]);
  f.b.state = 'site'; f.G.ui.renderInfo(true);
  assert.equal(input(f, 'pasture-stock'), null); assert.equal(input(f, 'pasture-type-apply'), null);
  f.b.type = 'burntruins'; f.b.state = 'ok'; f.G.ui.renderInfo(true);
  assert.equal(input(f, 'pasture-stock'), null); assert.equal(input(f, 'pasture-target-form'), null);
});

// G.init binds the production input handlers. Only rendering, startup IO and
// timers are suspended; projection, planning and simulation APIs remain real.
function bindInput() {
  const f = planning(), canvas = f.mount('game');
  canvas.style = {}; canvas.getContext = () => ({});
  canvas.getBoundingClientRect = () => ({ left: 17, top: 29 });
  f.G.ui.init = () => {}; f.G.feedback = { init() {} };
  f.G.tryReplayLoad = () => true; f.G.probeServerSaves = () => {};
  f.G.init();
  function point(x, y) { const [sx, sy] = f.G.T2S(x + .25, y + .25); return { clientX: 17 + sx * f.G.cam.z + f.G.cam.x, clientY: 29 + sy * f.G.cam.z + f.G.cam.y, target: canvas, button: 0 }; }
  function mouse(type, x, y, props = {}) { const event = { ...point(x, y), ...props }; return type === 'mousedown' ? canvas.emit(type, event) : f.windowEvent(type, event); }
  function touch(type, x, y, props = {}) { const p = point(x, y); return canvas.emit(type, { touches: type === 'touchend' ? [] : [p], changedTouches: [p], ...props }); }
  return Object.assign(f, { canvas, point, mouse, touch });
}

test('production mouse bindings create a drag preview and only confirm creates the site', () => {
  const f = bindInput(), before = snapshot(f);
  f.mouse('mousedown', 2, 2); f.mouse('mousemove', 8, 8);
  assert(f.G.pastureDrag); assert.equal(f.G.pasturePlan, null); assert.equal(snapshot(f), before);
  f.G.ui.refreshPasturePlanControls(); assert(input(f, 'pasture-plan-confirm').disabled);
  f.mouse('mouseup', 8, 8); assert.equal(f.G.pastureDrag, null);
  assert.deepEqual(Array.from(f.G.pasturePlanStatus().size), [7, 7]); assert.equal(snapshot(f), before);
  f.G.ui.refreshPasturePlanControls(); activate(f).click(); assert.equal(f.G.world.buildings.length, 1);
});

test('production mouse clicks choose two corners and the immediate-placement route only plans', () => {
  const f = bindInput();
  f.mouse('mousedown', 4, 5); f.mouse('mouseup', 4, 5); assert(f.G.pasturePlan.start); assert.equal(f.G.pasturePlan.end, null);
  f.mouse('mousedown', 13, 24); f.mouse('mouseup', 13, 24);
  assert.deepEqual(Array.from(f.G.pasturePlanStatus().size), [10, 20]); assert.equal(f.G.world.buildings.length, 0);
  f.G.cancelPasturePlan(); f.G.tryPlace(2, 2); f.G.tryPlace(8, 8);
  assert.equal(f.G.world.buildings.length, 0); assert(f.G.pasturePlanStatus().ok);
});

test('production touch bindings select two corners without synthetic fixed placement', () => {
  const f = bindInput(), before = snapshot(f);
  assert(f.touch('touchstart', 3, 4).defaultPrevented); f.touch('touchend', 3, 4);
  assert.equal(f.G.pasturePlan.end, null);
  f.touch('touchstart', 12, 23); f.touch('touchend', 12, 23);
  assert.deepEqual(Array.from(f.G.pasturePlanStatus().size), [10, 20]); assert.equal(snapshot(f), before);
});

for (const mode of ['move', 'multi', 'cancel', 'blur', 'hidden', 'world', 'tool', 'modal', 'focus']) test(`production ${mode} interruption cannot finish a pending pasture gesture`, () => {
  const f = bindInput(); f.touch('touchstart', 3, 3);
  if (mode === 'move') f.touch('touchmove', 4, 4);
  if (mode === 'multi') f.touch('touchmove', 3, 3, { touches: [f.point(3, 3), f.point(4, 4)] });
  if (mode === 'cancel') f.canvas.emit('touchcancel');
  if (mode === 'blur') f.windowEvent('blur');
  if (mode === 'hidden') { f.doc.visibilityState = 'hidden'; f.documentEvent('visibilitychange'); }
  if (mode === 'world') f.G.world = { ...f.G.world };
  if (mode === 'tool') { f.G.setTool('farm'); f.G.setTool('pasture'); }
  if (mode === 'modal') f.mount('help');
  if (mode === 'focus') f.documentEvent('focusin', { target: input(f, 'pasture-plan-confirm') });
  f.touch('touchend', 3, 3); assert.equal(f.G.pasturePlan, null); assert.equal(f.G.world.buildings.length, 0);
});

test('production mouse drag cancellation respects Escape, right click and placement controls', () => {
  for (const mode of ['escape', 'right', 'controls']) {
    const f = bindInput(); f.mouse('mousedown', 2, 2); f.mouse('mousemove', 8, 8);
    if (mode === 'escape') f.windowEvent('keydown', { key: 'Escape', target: f.canvas });
    if (mode === 'right') f.mouse('mousedown', 8, 8, { button: 2 });
    if (mode === 'controls') f.documentEvent('focusin', { target: input(f, 'pasture-plan-cancel') });
    f.mouse('mouseup', 8, 8); assert.equal(f.G.pasturePlan, null); assert.equal(f.G.world.buildings.length, 0);
  }
});

test('production farm mouse and touch corner bindings remain independent', () => {
  for (const mode of ['mouse', 'touch']) {
    const f = bindInput(); f.G.setTool('farm');
    if (mode === 'mouse') { f.mouse('mousedown', 2, 2); f.mouse('mousemove', 5, 5); f.mouse('mouseup', 5, 5); }
    else { f.touch('touchstart', 2, 2); f.touch('touchend', 2, 2); f.touch('touchstart', 5, 5); f.touch('touchend', 5, 5); }
    assert.deepEqual(Array.from(f.G.farmPlanStatus().size), [4, 4]); assert.equal(f.G.pasturePlan, null);
  }
});

test('stale cancel activation cannot dismiss a newly selected rectangle or world', () => {
  for (const mode of ['plan', 'world', 'tool']) {
    const f = planning(); preview(f); const cancel = input(f, 'pasture-plan-cancel'); cancel.emit('mousedown');
    if (mode === 'world') f.G.world = { ...f.G.world };
    if (mode === 'tool') { f.G.setTool('farm'); f.G.setTool('pasture'); }
    preview(f, 9, 9); const plan = f.G.pasturePlan; cancel.click(); assert.equal(f.G.pasturePlan, plan);
  }
});

for (const size of [[7, 7], [7, 8], [8, 7]]) test(`${size.join('x')} warns about the two-cattle breeding and slaughter limit in preview and cattle details`, () => {
  const warning = /最多2头牛.*保种或转场.*保留量最低2头.*无法靠繁殖.*超额屠宰.*肉和皮革/;
  const f = planning(); preview(f, ...size); const before = snapshot(f);
  assert.match(input(f, 'pasture-plan-status').textContent, warning);
  assert(!input(f, 'pasture-plan-confirm').disabled, 'warning must not prohibit a valid seed or transfer pen');
  f.G.ui.refreshPasturePlanControls(); assert.equal(snapshot(f), before);
  const d = detail(size, 'cattle'); assert.equal(d.G.pastureCapacity(d.b), 2);
  assert.match(live(d, 'pasture-cattle-warning'), warning);
  const existing = snapshot(d); d.G.ui.refreshEconomyInfo(d.b); assert.equal(snapshot(d), existing);
  setType(d, 'sheep'); assert.equal(live(d, 'pasture-cattle-warning'), '');
  setType(d, 'chicken'); assert.equal(live(d, 'pasture-cattle-warning'), '');
  setType(d, 'cattle'); assert.match(live(d, 'pasture-cattle-warning'), warning);
});

test('three-cattle area pens and legacy pens do not show the two-cattle warning', () => {
  const f = planning(); preview(f, 7, 9);
  assert.equal(f.G.pasturePlanStatus().capacities.cattle, 3);
  assert.doesNotMatch(input(f, 'pasture-plan-status').textContent, /只适合保种或转场|无法靠繁殖/);
  const d = detail([7, 9], 'cattle'); assert.equal(d.G.pastureCapacity(d.b), 3);
  assert.equal(live(d, 'pasture-cattle-warning'), '');
  const legacy = detail(undefined, 'cattle'); assert.equal(legacy.G.pastureCapacity(legacy.b), 10);
  assert.equal(live(legacy, 'pasture-cattle-warning'), '');
  assert.doesNotMatch(legacy.info.textContent, /只适合保种或转场|无法靠繁殖/);
});

console.log(`${passed} pasture area UI contracts passed (DOM/live simulation, not browser visual acceptance)`);
