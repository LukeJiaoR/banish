/* Area cemetery planning and detail controls use real game APIs.
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
  G.ui.refreshHUD = () => { if (G.ui.refreshCemeteryPlanControls) G.ui.refreshCemeteryPlanControls(); }; 
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
  const panel = f.mount('cemetery-plan-controls'); panel.classList.add('hidden');
  panel.innerHTML = '<p id="cemetery-plan-status" role="status" aria-live="polite"></p><button type="button" id="cemetery-plan-confirm">确认圈地</button><button type="button" id="cemetery-plan-cancel">重选两个角</button>';
  const farm = f.mount('farm-plan-controls'); farm.classList.add('hidden');
  farm.innerHTML = '<p id="farm-plan-status"></p><button type="button" id="farm-plan-confirm">确认开田</button><button type="button" id="farm-plan-cancel">重选两个角</button>';
  f.G.ui.initToolbar(); f.G.ui.initCemeteryPlanControls(); f.G.ui.initFarmPlanControls();
  f.G.setTool('cemetery');
  return f;
}
function preview(f, width = 7, height = 7, x = 2, y = 2) {
  f.G.cancelCemeteryPlan(); f.G.selectCemeteryCorner(x, y); f.G.selectCemeteryCorner(x + width - 1, y + height - 1);
  f.G.ui.refreshCemeteryPlanControls(); return f.G.cemeteryPlanStatus();
}
function activate(f, mode = 'mousedown') {
  const button = input(f, 'cemetery-plan-confirm');
  button.emit(mode, mode === 'keydown' ? { key: 'Enter', repeat: false } : {}); return button;
}
function snapshot(f) { return JSON.stringify({ res: f.G.game.res, buildings: f.G.world.buildings, marks: [...f.G.world.marked], trees: f.G.world.trees }); }
function detail(size) {
 const f=fixture(),r=f.G.addBuilding('cemetery',2,2,{instant:true,free:true,...(size?{cemeterySize:size}:{})});assert(r.ok,r.reason);f.b=r.b;f.select(f.b);return f;
}
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

test('HTML and toolbar use the bounded existing planner',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const k of ['controls','status','confirm','cancel'])assert(html.includes('id="cemetery-plan-'+k+'"'));
 const f=planning();assert.match(input(f,'toolbar-state').textContent,/选两个角或拖出矩形.*确认建园/);assert.match(f.toolbar.querySelector('[data-tool="cemetery"]').textContent,/7–20格/);
 assert(input(f,'cemetery-plan-confirm').disabled);
});
test('four table corners show actual graves, stone, no jobs and unwithdrawn construction plans',()=>{
 for(const [w,h,cap,cost]of [[7,7,9,24],[7,8,9,26],[8,7,12,26],[20,20,144,76]]){
  const f=planning();preview(f,w,h);assert.match(input(f,'cemetery-plan-status').textContent,new RegExp(`实际墓位 ${cap} 个`));assert.match(input(f,'cemetery-plan-status').textContent,/无常驻岗位.*192日.*适配/);
  const stone=f.G.game.res.stone;activate(f).click();assert.equal(f.G.world.buildings.length,1);const b=f.G.world.buildings[0];assert.equal(b.state,'site');assert.equal(b.construction.required.stone,cost);assert.equal(b.construction.required.wood,undefined);assert.equal(b.totalWork,cost);assert.equal(f.G.game.res.stone,stone);assert.equal(f.G.cemeteryCapacity(b),cap);
  input(f,'cemetery-plan-confirm').click(2);assert.equal(f.G.world.buildings.length,1);
 }
});
test('invalid bounds block but insufficient materials allow planning; cancel is read-only',()=>{
 const f=planning();for(const [w,h]of [[6,7],[7,21]]){preview(f,w,h);assert(input(f,'cemetery-plan-confirm').disabled);activate(f).click();assert.equal(f.G.world.buildings.length,0);}
 f.G.game.res.stone=0;preview(f,20,20);assert.match(input(f,'cemetery-plan-status').textContent,/实际墓位 144/);assert.match(input(f,'cemetery-plan-status').textContent,/等待材料/);assert(!input(f,'cemetery-plan-confirm').disabled);activate(f).click();assert.equal(f.G.world.buildings.length,1);assert.equal(f.G.game.res.stone,0);assert.equal(f.G.world.buildings[0].progress,0);f.G.removeBuilding(f.G.world.buildings[0]);assert.equal(f.G.game.res.stone,0);
 f.G.game.res.stone=1000;preview(f);const before=snapshot(f);input(f,'cemetery-plan-cancel').click();assert.equal(snapshot(f),before);assert.equal(f.G.cemeteryPlan,null);
});
for(const mode of ['world','game','tool','generation','plan','hidden','modal','cancelled'])test('stale planning activation cannot commit after '+mode,()=>{
 const f=planning();preview(f);const confirm=activate(f);
 if(mode==='world')f.G.world={...f.G.world};if(mode==='game')f.G.game={...f.G.game};if(mode==='tool')f.G.setTool('house');
 if(mode==='generation'){f.G.cancelCemeteryPlan();preview(f,9,9);}if(mode==='plan'){f.G.selectCemeteryCorner(30,30);f.G.selectCemeteryCorner(38,38);}
 if(mode==='hidden')input(f,'cemetery-plan-controls').classList.add('hidden');if(mode==='modal')f.G.hasOpenModal=()=>true;if(mode==='cancelled')confirm.emit('pointercancel');
 const before=snapshot(f);confirm.click();assert.equal(snapshot(f),before);
});
test('actual mouse and touch bindings plan rectangles before explicit confirmation',()=>{
 {const f=bindInput();f.mouse('mousedown',3,3);f.mouse('mousemove',10,9);f.mouse('mouseup',10,9);assert.equal(f.G.world.buildings.length,0);assert(f.G.cemeteryPlanStatus().ok);f.G.ui.refreshCemeteryPlanControls();activate(f).click();assert.deepEqual(Array.from(f.G.world.buildings[0].cemeterySize),[8,7]);}
 {const f=bindInput();for(const [x,y]of [[3,3],[9,10]]){f.touch('touchstart',x,y);f.touch('touchend',x,y);}assert(f.G.cemeteryPlanStatus().ok);assert.equal(f.G.world.buildings.length,0);f.G.ui.refreshCemeteryPlanControls();activate(f,'touchstart').click();assert.deepEqual(Array.from(f.G.world.buildings[0].cemeterySize),[7,8]);}
});
function occupied(size){const f=detail(size);const c=f.G.spawnCitizen({x:f.b.x-1,y:f.b.y,age:30,sex:'m',name:'旧姓名<保留>'});c.name='旧姓名<保留>';f.G.killCitizen(c,'老去');assert.equal(f.b.graves.length,1);f.select(f.b);return f;}
function openRemoval(f){input(f,'info-demolish').click();return input(f,'cemetery-removal-confirm');}
test('legacy details keep eight slots and removal preview preserves all state until confirmed',()=>{
 const f=occupied();assert.match(f.info.textContent,/墓位：1 \/ 8/);assert.match(f.info.textContent,/旧园保留8墓位与原成本/);
 const before=snapshot(f),confirm=openRemoval(f);assert(!confirm.disabled);assert.match(f.info.textContent,/保留 1 座已有墓碑.*占用 1 格.*释放其余 15 格/);assert.equal(snapshot(f),before);
 input(f,'cemetery-removal-cancel').click();assert.equal(snapshot(f),before);assert(confirm.disabled);
 openRemoval(f).click();const remains=f.G.world.buildings.filter(b=>b.type==='graveremnant');assert.equal(remains.length,1);const after=snapshot(f);confirm.click();assert.equal(snapshot(f),after);
 f.select(remains[0]);assert.match(f.info.textContent,/旧姓名<保留>.*原墓园.*原到期日/);assert.equal(input(f,'info-demolish'),null);assert.doesNotMatch(f.info.textContent,/永久废矿坑|永久占地 3×3/);
 const writes=f.info.htmlWrites;f.G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);
});
for(const mode of ['death','day','world','game','hidden','panel','modal'])test('stale wall removal confirmation rejects '+mode,()=>{
 const f=occupied([7,7]),confirm=openRemoval(f);let old=f.b;
 if(mode==='death'){const c=f.G.spawnCitizen({x:old.x-1,y:old.y,age:30,sex:'m'});f.G.killCitizen(c,'老去');}
 if(mode==='day')f.G.game.day++;if(mode==='world')f.G.world={...f.G.world};if(mode==='game')f.G.game={...f.G.game};if(mode==='hidden')f.info.classList.add('hidden');
 if(mode==='panel'){f.G.ui.hideInfo();f.select(old);}if(mode==='modal')f.G.hasOpenModal=()=>true;
 const before=snapshot(f);confirm.click();assert.equal(snapshot(f),before);assert.equal(f.G.world.bmap[old.id],old);
});
test('grave details refresh without changing identity or forcing focus, then close on expiration',()=>{
 const f=occupied([7,7]);openRemoval(f).click();const b=f.G.world.buildings.find(x=>x.type==='graveremnant');f.select(b);const close=input(f,'info-close');close.focus();const writes=f.info.htmlWrites;
 f.G.game.day++;f.G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.equal(f.doc.activeElement,close);const before=snapshot(f);f.G.ui.renderInfo();assert.equal(snapshot(f),before);
 f.G.game.day=b.grave.expiresDay;f.G.advanceMemorials();f.G.ui.renderInfo();assert.equal(f.G.world.bmap[b.id],undefined);assert(f.info.classList.contains('hidden'));
});
console.log(`Cemetery area UI: ${passed} DOM/input suites passed; not browser/mobile acceptance.`);

