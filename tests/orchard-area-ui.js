/* Area orchard planning and detail controls use real game APIs.
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
  G.ui.refreshHUD = () => { if (G.ui.refreshOrchardPlanControls) G.ui.refreshOrchardPlanControls(); }; 
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
  const panel = f.mount('orchard-plan-controls'); panel.classList.add('hidden');
  panel.innerHTML = '<p id="orchard-plan-status" role="status" aria-live="polite"></p><button type="button" id="orchard-plan-confirm">确认圈地</button><button type="button" id="orchard-plan-cancel">重选两个角</button>';
  const farm = f.mount('farm-plan-controls'); farm.classList.add('hidden');
  farm.innerHTML = '<p id="farm-plan-status"></p><button type="button" id="farm-plan-confirm">确认开田</button><button type="button" id="farm-plan-cancel">重选两个角</button>';
  f.G.ui.initToolbar(); f.G.ui.initOrchardPlanControls(); f.G.ui.initFarmPlanControls();
  f.G.setTool('orchard');
  return f;
}
function preview(f, width = 4, height = 4, x = 2, y = 2) {
  f.G.cancelOrchardPlan(); f.G.selectOrchardCorner(x, y); f.G.selectOrchardCorner(x + width - 1, y + height - 1);
  f.G.ui.refreshOrchardPlanControls(); return f.G.orchardPlanStatus();
}
function activate(f, mode = 'mousedown') {
  const button = input(f, 'orchard-plan-confirm');
  button.emit(mode, mode === 'keydown' ? { key: 'Enter', repeat: false } : {}); return button;
}
function snapshot(f) { return JSON.stringify({ res: f.G.game.res, buildings: f.G.world.buildings, marks: [...f.G.world.marked], trees: f.G.world.trees }); }
function detail(size) {
 const f=fixture(),r=f.G.addBuilding('orchard',2,2,{instant:true,free:true,...(size?{orchardSize:size}:{})});assert(r.ok,r.reason);f.b=r.b;f.select(f.b);return f;
}
test('actual HTML and toolbar describe bounded orchard planning',()=>{const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of ['orchard-plan-controls','orchard-plan-status','orchard-plan-confirm','orchard-plan-cancel'])assert(html.includes('id="'+id+'"'));const f=planning();assert.match(input(f,'toolbar-state').textContent,/选两个角或拖出矩形.*确认开园/);assert.match(f.toolbar.querySelector('[data-tool="orchard"]').textContent,/4–15格/);assert(input(f,'orchard-plan-confirm').disabled);});
for(const [w,h,n,c,r]of [[4,4,4,2,2],[15,4,16,8,2],[4,13,10,2,5],[13,4,14,7,2],[15,15,40,8,5]])test(`${w}x${h} quote shows exact trees, costs, staffing and stays read-only`,()=>{const f=planning(),before=snapshot(f),s=preview(f,w,h);assert(s.ok,s.reason);assert.equal(snapshot(f),before);const text=input(f,'orchard-plan-status').textContent;assert(text.includes(`${w}×${h}`));assert(text.includes(`可种 ${n} 株`));assert(text.includes(`东西 ${c} 列 × 南北 ${r} 行`));assert(text.includes(`木材×${w+h}`));assert(text.includes(`${w*h} 工时`));assert(text.includes(`上限 ${Math.min(3,Math.ceil(w*h/72))} 人`));assert(text.includes('旧6×6果园保留9株'));const b=input(f,'orchard-plan-confirm');b.focus();const writes=input(f,'orchard-plan-controls').htmlWrites;f.G.ui.refreshOrchardPlanControls();assert.equal(f.doc.activeElement,b);assert.equal(input(f,'orchard-plan-controls').htmlWrites,writes);});
test('confirmation pays once and creates an empty sized construction site',()=>{const f=planning();preview(f,15,4);const wood=f.G.game.res.wood;activate(f).click();assert.equal(f.G.world.buildings.length,1);const b=f.G.world.buildings[0];assert.equal(b.state,'site');assert.deepEqual(Array.from(b.orchardSize),[15,4]);assert.equal(f.G.game.res.wood,wood-19);assert.equal(b.totalWork,60);assert.equal((b.orchardTrees||[]).filter(t=>t.planted).length,0);input(f,'orchard-plan-confirm').click(2);assert.equal(f.G.world.buildings.length,1);});
for(const size of [[3,4],[4,16]])test(`${size} cannot confirm outside 4–15 bounds`,()=>{const f=planning();preview(f,...size);const before=snapshot(f);assert(input(f,'orchard-plan-confirm').disabled);activate(f).click();assert.equal(snapshot(f),before);});
test('insufficient resources still show trees and require a fresh quote activation after restocking',()=>{const f=planning();f.G.game.res.wood=0;preview(f,15,15);assert(input(f,'orchard-plan-status').textContent.includes('可种 40 株'));assert(input(f,'orchard-plan-confirm').disabled);const b=activate(f);f.G.game.res.wood=100;f.G.ui.refreshOrchardPlanControls();b.click();assert.equal(f.G.world.buildings.length,0);activate(f).click();assert.equal(f.G.world.buildings.length,1);});
test('clearing and 72/144 tile staffing steps are visible before spending',()=>{const f=planning(),i=3*f.G.world.N+3;f.G.world.trees.push({x:3,y:3,age:12,alive:true,b:1});f.G.world.treeIdx[i]=0;for(const [w,h,n]of [[8,9,1],[5,15,2],[12,12,2],[10,15,3]]){preview(f,w,h);const text=input(f,'orchard-plan-status').textContent;assert(text.includes('先清 1 棵树'));assert(text.includes(`上限 ${n} 人`));assert(f.G.world.trees[0].alive);}});
for(const size of [undefined,[4,4],[15,4],[15,15]])test(`${size||'legacy'} details reflect actual tree slots and worker maximum without replacing focused choices`,()=>{const f=detail(size),n=size?Math.ceil(size[0]/2)*Math.ceil(size[1]/3):9,max=size?Math.min(3,Math.ceil(size[0]*size[1]/72)):2;assert(live(f,'orchard-age').includes(`共${n}位`));assert(live(f,'orchard-area').includes(`${n}树位`));assert.equal(input(f,'worker-limit-input').getAttribute('max'),String(max));if(!size)assert(live(f,'orchard-area-rule').includes('旧6×6果园保留原9株'));const choice=input(f,'orchard-type');choice.focus();choice.value='pear';f.G.ui.refreshEconomyInfo(f.b);assert.equal(choice.value,'pear');assert.equal(f.doc.activeElement,choice);input(f,'worker-limit-input').value=String(max+1);input(f,'worker-limit-form').emit('submit');assert.equal(f.G.workerLimitOf(f.b),max);input(f,'worker-limit-input').value='0';input(f,'worker-limit-form').emit('submit');assert.equal(f.G.workerLimitOf(f.b),0);});
test('cancel before confirmation changes no world, marks or resources', () => {
  const f = planning(); preview(f); const before = snapshot(f);
  activate(f); input(f, 'orchard-plan-cancel').click(); input(f, 'orchard-plan-confirm').click();
  assert.equal(snapshot(f), before); assert.equal(f.G.orchardPlan, null);
});

for (const key of ['Enter', ' ']) test(`held ${key === ' ' ? 'Space' : key} never confirms a newer preview`, () => {
  const f = planning(); preview(f); const b = input(f, 'orchard-plan-confirm');
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
  if (mode === 'generation') { f.G.cancelOrchardPlan(); preview(f, 9, 9); }
  if (mode === 'plan') { f.G.selectOrchardCorner(20, 20); f.G.selectOrchardCorner(27, 27); f.G.ui.refreshOrchardPlanControls(); }
  if (mode === 'hidden') input(f, 'orchard-plan-controls').classList.add('hidden');
  if (mode === 'panel') input(f, 'orchard-plan-controls').id = 'removed-orchard-panel';
  if (mode === 'confirm') b.id = 'removed-orchard-confirm';
  if (mode === 'cancel') input(f, 'orchard-plan-cancel').id = 'removed-orchard-cancel';
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
  assert(f.G.orchardDrag); assert.equal(f.G.orchardPlan, null); assert.equal(snapshot(f), before);
  f.G.ui.refreshOrchardPlanControls(); assert(input(f, 'orchard-plan-confirm').disabled);
  f.mouse('mouseup', 8, 8); assert.equal(f.G.orchardDrag, null);
  assert.deepEqual(Array.from(f.G.orchardPlanStatus().size), [7, 7]); assert.equal(snapshot(f), before);
  f.G.ui.refreshOrchardPlanControls(); activate(f).click(); assert.equal(f.G.world.buildings.length, 1);
});

test('production mouse clicks choose two corners and the immediate-placement route only plans', () => {
  const f = bindInput();
  f.mouse('mousedown', 4, 5); f.mouse('mouseup', 4, 5); assert(f.G.orchardPlan.start); assert.equal(f.G.orchardPlan.end, null);
  f.mouse('mousedown', 13, 16); f.mouse('mouseup', 13, 16);
  assert.deepEqual(Array.from(f.G.orchardPlanStatus().size), [10, 12]); assert.equal(f.G.world.buildings.length, 0);
  f.G.cancelOrchardPlan(); f.G.tryPlace(2, 2); f.G.tryPlace(8, 8);
  assert.equal(f.G.world.buildings.length, 0); assert(f.G.orchardPlanStatus().ok);
});

test('production touch bindings select two corners without synthetic fixed placement', () => {
  const f = bindInput(), before = snapshot(f);
  assert(f.touch('touchstart', 3, 4).defaultPrevented); f.touch('touchend', 3, 4);
  assert.equal(f.G.orchardPlan.end, null);
  f.touch('touchstart', 12, 15); f.touch('touchend', 12, 15);
  assert.deepEqual(Array.from(f.G.orchardPlanStatus().size), [10, 12]); assert.equal(snapshot(f), before);
});

for (const mode of ['move', 'multi', 'cancel', 'blur', 'hidden', 'world', 'tool', 'modal', 'focus']) test(`production ${mode} interruption cannot finish a pending orchard gesture`, () => {
  const f = bindInput(); f.touch('touchstart', 3, 3);
  if (mode === 'move') f.touch('touchmove', 4, 4);
  if (mode === 'multi') f.touch('touchmove', 3, 3, { touches: [f.point(3, 3), f.point(4, 4)] });
  if (mode === 'cancel') f.canvas.emit('touchcancel');
  if (mode === 'blur') f.windowEvent('blur');
  if (mode === 'hidden') { f.doc.visibilityState = 'hidden'; f.documentEvent('visibilitychange'); }
  if (mode === 'world') f.G.world = { ...f.G.world };
  if (mode === 'tool') { f.G.setTool('farm'); f.G.setTool('orchard'); }
  if (mode === 'modal') f.mount('help');
  if (mode === 'focus') f.documentEvent('focusin', { target: input(f, 'orchard-plan-confirm') });
  f.touch('touchend', 3, 3); assert.equal(f.G.orchardPlan, null); assert.equal(f.G.world.buildings.length, 0);
});

test('production mouse drag cancellation respects Escape, right click and placement controls', () => {
  for (const mode of ['escape', 'right', 'controls']) {
    const f = bindInput(); f.mouse('mousedown', 2, 2); f.mouse('mousemove', 8, 8);
    if (mode === 'escape') f.windowEvent('keydown', { key: 'Escape', target: f.canvas });
    if (mode === 'right') f.mouse('mousedown', 8, 8, { button: 2 });
    if (mode === 'controls') f.documentEvent('focusin', { target: input(f, 'orchard-plan-cancel') });
    f.mouse('mouseup', 8, 8); assert.equal(f.G.orchardPlan, null); assert.equal(f.G.world.buildings.length, 0);
  }
});

test('production farm mouse and touch corner bindings remain independent', () => {
  for (const mode of ['mouse', 'touch']) {
    const f = bindInput(); f.G.setTool('farm');
    if (mode === 'mouse') { f.mouse('mousedown', 2, 2); f.mouse('mousemove', 5, 5); f.mouse('mouseup', 5, 5); }
    else { f.touch('touchstart', 2, 2); f.touch('touchend', 2, 2); f.touch('touchstart', 5, 5); f.touch('touchend', 5, 5); }
    assert.deepEqual(Array.from(f.G.farmPlanStatus().size), [4, 4]); assert.equal(f.G.orchardPlan, null);
  }
});

test('stale cancel activation cannot dismiss a newly selected rectangle or world', () => {
  for (const mode of ['plan', 'world', 'tool']) {
    const f = planning(); preview(f); const cancel = input(f, 'orchard-plan-cancel'); cancel.emit('mousedown');
    if (mode === 'world') f.G.world = { ...f.G.world };
    if (mode === 'tool') { f.G.setTool('farm'); f.G.setTool('orchard'); }
    preview(f, 9, 9); const plan = f.G.orchardPlan; cancel.click(); assert.equal(f.G.orchardPlan, plan);
  }
});

console.log(`Orchard area UI: ${passed} DOM/live-simulation suites passed (not browser acceptance).`);
