'use strict';
/* Real ui.js toolbar handlers plus navigation/jade composition in script and
 * DOMContentLoaded order. This minimal DOM checks identity, events and focus;
 * it is not a CSS hit-testing, geometry, touch or browser acceptance test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const dataKey = key => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g,
  (_, key) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"}[key]));

function fixture() {
  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn, options = false) {
      const capture = typeof options === 'boolean' ? options : !!options.capture;
      const list = this.listeners.get(type) || [];
      list.push({fn, capture}); this.listeners.set(type, list);
    }
    removeEventListener(type, fn) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x.fn !== fn));
    }
  }
  const window = new Target(), document = new Target();
  document.activeElement = null;
  document.visibilityState = 'visible';
  Object.defineProperty(document,'hidden',{get:()=>document.visibilityState==='hidden'});
  function dispatch(target, type, props = {}) {
    const event = {type, target, repeat: false, defaultPrevented: false, ...props,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = this.immediate = true; }};
    const ancestors = [];
    for (let p = target.parentNode; p; p = p.parentNode) ancestors.push(p);
    if (target !== document && !ancestors.includes(document)) ancestors.push(document);
    if (target !== window) ancestors.push(window);
    function invoke(node, capture) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners.get(type) || [])]) {
        if (listener.capture !== capture) continue;
        listener.fn.call(node, event);
        if (event.immediate) break;
      }
    }
    for (const ancestor of [...ancestors].reverse()) {
      invoke(ancestor, true); if (event.stopped) return event;
    }
    invoke(target, true);
    if (!event.immediate) invoke(target, false);
    if (!event.stopped) for (const ancestor of ancestors) {
      invoke(ancestor, false); if (event.stopped) break;
    }
    return event;
  }
  class Element extends Target {
    constructor(tag = 'div') {
      super(); this.tagName = tag.toUpperCase(); this.children = [];
      this.parentNode = null; this.dataset = {}; this.attrs = {};
      this.hidden = false; this.disabled = false; this.id = ''; this._text = '';
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, force) {
          const next = force === undefined ? !classes.has(name) : !!force;
          next ? classes.add(name) : classes.delete(name); return next;
        },
        toString: () => [...classes].join(' '),
      };
    }
    get className() { return this.classList.toString(); }
    set className(value) {
      for (const name of this.className.split(/\s+/).filter(Boolean)) this.classList.remove(name);
      this.classList.add(...String(value).split(/\s+/).filter(Boolean));
    }
    get title() { return this.attrs.title || ''; }
    set title(value) { this.attrs.title = String(value); }
    setAttribute(key, value) {
      value = String(value); this.attrs[key] = value;
      if (key === 'id') this.id = value;
      if (key === 'class') this.className = value;
      if (key === 'hidden') this.hidden = true;
      if (key.startsWith('data-')) this.dataset[dataKey(key.slice(5))] = value;
    }
    getAttribute(key) {
      if (key === 'id') return this.id || null;
      if (key === 'class') return this.className || null;
      if (key.startsWith('data-')) return this.dataset[dataKey(key.slice(5))] ?? null;
      return this.attrs[key] ?? null;
    }
    remove() {
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    append(...nodes) {
      for (const node of nodes) {
        assert(node instanceof Element, 'fixture append requires an existing element');
        node.remove(); node.parentNode = this; this.children.push(node);
      }
    }
    prepend(...nodes) {
      for (const node of [...nodes].reverse()) {
        node.remove(); node.parentNode = this; this.children.unshift(node);
      }
    }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    contains(node) {
      for (; node; node = node.parentNode) if (node === this) return true;
      return false;
    }
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const attr = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (attr) return attr[2] === undefined ? this.getAttribute(attr[1]) !== null : this.getAttribute(attr[1]) === attr[2];
      return this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) {
      const parts = selector.trim().split(/\s+/);
      return this.descendants().filter(node => {
        if (!node.matches(parts[parts.length - 1])) return false;
        for (let i = parts.length - 2, p = node.parentNode; i >= 0; i--) {
          while (p && p !== this && !p.matches(parts[i])) p = p.parentNode;
          if (!p || !p.matches(parts[i])) return false;
          p = p.parentNode;
        }
        return true;
      });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      for (let p = this; p instanceof Element; p = p.parentNode) if (p.matches(selector)) return p;
      return null;
    }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) { this.focus(); return dispatch(this, 'click'); } }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) {
      for (const child of [...this.children]) child.remove();
      this._text = String(value);
    }
    get innerHTML() { return this._html || ''; }
    set innerHTML(value) {
      this.textContent = ''; this._html = String(value);
      const stack = [this];
      for (const token of this._html.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/gi)) {
        if (token[4]) { stack.at(-1)._text += decode(token[4]); continue; }
        if (token[1]) { if (stack.length > 1) stack.pop(); continue; }
        const child = new Element(token[2]);
        for (const attr of token[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(attr[1], decode(attr[2] || ''));
        stack.at(-1).append(child);
        if (!['img', 'br', 'input', 'image'].includes(token[2]) && !token[3].endsWith('/')) stack.push(child);
      }
    }
  }
  const body = new Element('body');
  document.body = body;
  document.createElement = tag => new Element(tag);
  document.getElementById = id => [body, ...body.descendants()].find(node => node.id === id) || null;
  document.querySelectorAll = selector => body.querySelectorAll(selector);
  const mount = (id, parent = body, tag = 'div', classes = '') => {
    const node = new Element(tag); node.id = id; node.className = classes; parent.append(node); return node;
  };
  const hud = mount('hud'), top = mount('topbar', hud);
  const resRow = mount('res-row', top), core = mount('core-resources', resRow);
  mount('resource-more',resRow,'button');
  const secondary = mount('secondary-resources', resRow); secondary.hidden = true;
  for (const key of ['food', 'wood', 'stone', 'iron', 'tools', 'firewood']) mount('res-' + key, core);
  for (const id of ['date', 'pop', 'speed', 'sys']) mount(id, top);
  mount('quick-pause', top, 'button');
  const sysButton = mount('btn-save', document.getElementById('sys'), 'button');
  sysButton.setAttribute('aria-label', '保存');
  const toolbar = mount('toolbar', hud), placement = mount('placement-panel', hud);
  mount('placement-info', placement);
  const harvestStrip=mount('harvest-map-controls',hud,'section','hidden');
  mount('harvest-map-title',harvestStrip);mount('harvest-map-status',harvestStrip);
  mount('harvest-exit',harvestStrip,'button');
  mount('harvest-range-controls',placement,'div','hidden');
  mount('harvest-cancel',placement,'div','hidden');
  const dock = mount('town-dock', hud);
  for (const id of ['open-town', 'open-build', 'close-build']) mount(id, dock, 'button');
  const town = mount('town-controls', hud); town.hidden = true;
  mount('close-town', town, 'button'); mount('', town, 'div', 'town-controls-body');
  const info = mount('info', hud, 'div', 'hidden');
  const guide = mount('survival-guide', hud), list = mount('guide-list', guide, 'ul');
  const row = mount('', list, 'li'); row.dataset.level = 'status';
  mount('', row, 'span', 'guide-text').textContent = '储备粮食';
  mount('guide-count', guide, 'span').hidden = true;
  mount('dynamic-coach', guide).hidden = true; mount('coach-text', guide);
  let modal = false, hudReads = 0, saves = 0;
  const G = {game: {paused: false, res: {wood: 80, stone: 48}}, tool: null, sel: null,
    world: {buildings:[]}, pendingBuildingPlacement:null, buildingPlacementGestureVersion:0,
    RES: {wood: {name: '木材', icon: '🪵'}, stone: {name: '石材', icon: '🪨'}},
    BDEF: Object.fromEntries(['house', 'stonehouse', 'gatherer', 'storage'].map(type =>
      [type, {name: type, icon: '🏠', w:2, h:2, cost: {wood: 16, stone: 8}, jobs: 0, desc: '测试建筑'}])),
    hasOpenModal: () => modal, topModal: () => modal ? {id: 'help'} : null,
    isEditingTarget: target => /^(INPUT|SELECT|TEXTAREA)$/.test(target?.tagName || '')};
  // Legacy fixed dimensions/cost remain in BDEF for old saves; the new cemetery
  // header must defer to its rectangular planner instead of displaying them.
  G.BDEF.cemetery = {name: '墓园', icon: '🪦', w: 4, h: 4, jobs: 0,
    cost: {wood: 16, stone: 40}, desc: '新墓园框选7–20格矩形，材料按规划计算。'};
  // Execute the production staging/confirmation APIs against a tiny validated
  // world. The full simulation/input/render path is covered separately by
  // building-placement-confirm.js; this fixture checks the real UI handoff.
  G.canPlace = (world,type,x,y) => x<0||y<0||world.buildings.some(b=>b.x===x&&b.y===y)
    ? {ok:false,reason:'位置被占用'} : {ok:true};
  G.addBuilding = (type,x,y) => {
    const check=G.canPlace(G.world,type,x,y); if(!check.ok)return check;
    const b={type,x,y,state:'site'};G.world.buildings.push(b);return {ok:true,b};
  };
  const ctx = vm.createContext({window, document, G, console});
  vm.runInContext(read('js/ui.js'), ctx, {filename: 'ui.js'});
  const main=read('js/main.js');
  vm.runInContext(main.slice(main.indexOf('// Ordinary buildings keep'),main.indexOf('G.paintRoad =')),ctx,{filename:'main.js (placement APIs)'});
  const ui = G.ui;
  ui.el = {hud, toolbar, info, guide, placement:document.getElementById('placement-info'), harvestCancel:document.getElementById('harvest-cancel')};
  ui.refreshHUD = () => { hudReads++; return 'hud-result'; };
  ui.showInfo = () => info.classList.remove('hidden');
  ui.hideInfo = () => { G.sel = null; info.classList.add('hidden'); };
  const toasts=[];ui.toast=(...args)=>toasts.push(args);
  for (const name of ['refreshRoadControls',
    'refreshFarmPlanControls', 'refreshPasturePlanControls', 'refreshOrchardPlanControls', 'refreshCemeteryPlanControls']) ui[name] = () => {};
  G.setTool = type => {
    G.cancelBuildingPlacement();
    G.tool = type ? ['gatherall', 'fell', 'collectstone', 'collectiron', 'cancelremoval', 'quarry', 'demolish'].includes(type) ? {kind: type} : {kind: 'build', type} : null;
    ui.setToolActive();
  };
  let originalCancel;
  // Mirrors main.js: initialization is registered before navigation and jade,
  // but installs toolbar/capture handlers only when DOMContentLoaded fires.
  window.addEventListener('DOMContentLoaded', () => {
    ui.initToolbar(); ui.initHarvestRangeControls(); ui.refreshToolbarNavigation();
    originalCancel = document.getElementById('toolbar-cancel');
    sysButton.addEventListener('click', () => { if (!modal) saves++; });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.repeat && !modal && !G.isEditingTarget(event.target)) {
        if (G.tool) G.setTool(null);
        else if (G.sel) ui.hideInfo();
        event.preventDefault();
      }
    });
  });
  const originals = {close: document.getElementById('close-build'), placement,
    date: document.getElementById('date'), pop: document.getElementById('pop'), sysButton};
  vm.runInContext(read('js/navigation.js'), ctx, {filename: 'navigation.js'});
  vm.runInContext(read('js/jade-layout.js'), ctx, {filename: 'jade-layout.js'});
  dispatch(document, 'DOMContentLoaded');
  originals.cancel = originalCancel;
  return {G, ui, hud, toolbar, document, originals, mount, toasts,
    get: id => document.getElementById(id),
    event: (target,type,props={}) => dispatch(target,type,props),
    windowEvent: (type,props={}) => dispatch(window,type,props),
    documentEvent: (type,props={}) => dispatch(document,type,props),
    key: (key, props = {}) => dispatch(document.activeElement || body, 'keydown', {key, ...props}),
    modal: value => { modal = value; }, hudReads: () => hudReads, saves: () => saves};
}

const html = read('index.html');
assert(html.indexOf('js/navigation.js') < html.indexOf('js/jade-layout.js'), 'composition must run after navigation');
let passed = 0;
function test(name, fn) { fn(fixture()); passed++; console.log('ok', name); }

test('existing nodes are moved once, retaining identity and bound system handlers', f => {
  for (const [id, key, parent] of [
    ['toolbar-cancel', 'cancel', 'jade-build-actions'], ['close-build', 'close', 'jade-build-actions'],
    ['placement-panel', 'placement', 'jade-build-copy'], ['date', 'date', 'jade-status'], ['pop', 'pop', 'jade-status'],
  ]) {
    assert.equal(f.get(id), f.originals[key]);
    assert.equal(f.get(id).parentNode.id, parent);
    assert.equal(f.document.querySelectorAll('#' + id).length, 1);
  }
  assert(!f.get('town-dock').contains(f.originals.close));
  assert(!f.get('toolbar').querySelector('.toolbar-heading').contains(f.originals.cancel));
  assert.deepEqual(Array.from(f.ui.hudVisibleResources()), ['food', 'wood', 'stone']);
  for (const key of ['iron', 'tools', 'firewood']) {
    assert.equal(f.get('res-' + key).parentNode, f.get('secondary-resources'));
    assert.equal(f.document.querySelectorAll('#res-' + key).length, 1);
  }
  f.get('open-town').click(); assert.equal(f.get('town-controls').hidden, false);
  f.originals.sysButton.click(); assert.equal(f.saves(), 1);
});

test('build, real category/tool handlers, pause, cancel and close work after reparenting', f => {
  assert.equal(f.hud.dataset.mode, 'explore'); assert(f.toolbar.hidden);
  f.get('open-build').click(); assert.equal(f.hud.dataset.mode, 'build'); assert(!f.toolbar.hidden);
  const category = f.toolbar.querySelector('[data-category="homes"]');
  assert.equal(f.document.activeElement, category);
  category.click();
  const house = f.toolbar.querySelector('[data-tool="house"]');
  house.click(); assert.equal(f.G.tool.type, 'house');
  assert.equal(f.get('jade-build-header').dataset.selected, 'house');
  assert(f.hud.classList.contains('jade-has-tool'));
  f.get('quick-pause').click(); assert(f.G.game.paused);
  assert.equal(f.get('quick-pause').getAttribute('aria-pressed'), 'true');
  const before = f.hudReads(); f.ui.refreshHUD(); assert.equal(f.hudReads(), before + 1);
  f.originals.cancel.click(); assert.equal(f.G.tool, null);
  assert.equal(f.document.activeElement, house); assert(!f.hud.classList.contains('jade-has-tool'));
  f.originals.close.click(); assert(f.toolbar.hidden); assert.equal(f.hud.dataset.mode, 'explore');
  assert.equal(f.document.activeElement, f.get('open-build'));
});

test('hero returns to real categories and restores the original category focus', f => {
  f.get('open-build').click();
  const category = f.toolbar.querySelector('[data-category="homes"]');
  category.click(); f.toolbar.querySelector('[data-tool="house"]').click();
  f.get('jade-build-art').click();
  assert.equal(f.G.tool, null); assert.equal(f.ui.menuCategory, null);
  assert.equal(f.document.activeElement, category);
  assert(!f.get('toolbar-categories').classList.contains('hidden'));
  assert(f.get('toolbar-group-homes').classList.contains('hidden'));
});

test('cemetery header shows rectangular planning and clears legacy fixed footprint and costs', f => {
  f.get('open-build').click();
  f.toolbar.querySelector('[data-category="homes"]').click();
  f.toolbar.querySelector('[data-tool="house"]').click();
  const costs = f.get('jade-build-costs'), benefit = f.get('jade-build-benefit');
  assert(costs.querySelectorAll('.jade-cost').length > 0);
  f.get('toolbar-back').click();
  f.toolbar.querySelector('[data-category="services"]').click();
  f.toolbar.querySelector('[data-tool="cemetery"]').click();
  assert.equal(f.G.tool.type, 'cemetery');
  assert.equal(f.get('jade-build-header').dataset.planning, 'true');
  assert.equal(f.get('jade-build-confirm').hidden, true);
  for (let refresh = 0; refresh < 2; refresh++) {
    assert.equal(benefit.textContent, '7–20格矩形 · 消耗按规划计算');
    assert.equal(costs.innerHTML, '');
    assert.equal(costs.querySelectorAll('.jade-cost').length, 0);
    f.ui.refreshHUD();
  }
  f.get('toolbar-back').click();
  f.toolbar.querySelector('[data-category="homes"]').click();
  f.toolbar.querySelector('[data-tool="house"]').click();
  assert.equal(benefit.textContent, '一家人的住所');
  assert(costs.querySelectorAll('.jade-cost').length > 0);
  assert.equal(f.G.world.buildings.length, 0);
});

test('guide Escape takes precedence over tool, category and selection dismissal', f => {
  f.get('open-build').click();
  const category = f.toolbar.querySelector('[data-category="homes"]');
  category.click(); f.toolbar.querySelector('[data-tool="house"]').click();
  const tool = f.G.tool, chip = f.get('jade-guide-chip');
  chip.click(); assert(f.hud.classList.contains('jade-guide-open'));
  let event = f.key('Escape');
  assert(event.defaultPrevented); assert(event.immediate);
  assert.equal(f.G.tool, tool); assert.equal(f.ui.menuCategory, 'homes');
  assert.equal(f.document.activeElement, chip); assert.equal(chip.getAttribute('aria-expanded'), 'false');
  f.originals.cancel.click(); chip.click(); f.key('Escape');
  assert.equal(f.ui.menuCategory, 'homes', 'guide closes before the real category Escape handler');
  const selection = f.G.sel = {kind: 'b', id: 1};
  f.ui.showInfo(); chip.click(); f.key('Escape');
  assert.equal(f.G.sel, selection); assert.equal(f.hud.dataset.mode, 'detail');
  assert(!f.get('info').classList.contains('hidden'));
});

test('modal guards block moved and new controls without changing game or guide state', f => {
  f.get('open-build').click();
  f.toolbar.querySelector('[data-category="homes"]').click();
  f.toolbar.querySelector('[data-tool="house"]').click();
  const tool = f.G.tool; f.get('jade-guide-chip').click();
  f.modal(true);
  for (const id of ['quick-pause', 'toolbar-cancel', 'close-build', 'jade-build-art', 'jade-guide-chip', 'open-build']) f.get(id).click();
  f.key('Escape');
  assert.equal(f.G.tool, tool); assert.equal(f.ui.menuCategory, 'homes');
  assert.equal(f.G.game.paused, false); assert.equal(f.hud.dataset.mode, 'build');
  assert(f.hud.classList.contains('jade-guide-open'));
  f.modal(false); f.key('Escape'); assert(!f.hud.classList.contains('jade-guide-open'));
});

test('guide Escape ignores held keys and editing fields, while ordinary Escape still cancels tools', f => {
  f.get('open-build').click();
  f.toolbar.querySelector('[data-category="homes"]').click();
  f.toolbar.querySelector('[data-tool="house"]').click();
  f.get('jade-guide-chip').click();
  f.key('Escape', {repeat: true}); assert(f.hud.classList.contains('jade-guide-open'));
  const input = f.mount('test-input', f.get('survival-guide'), 'input'); input.focus();
  f.key('Escape'); assert(f.hud.classList.contains('jade-guide-open')); assert(f.G.tool);
  f.get('jade-guide-chip').focus(); f.key('Escape'); assert(f.G.tool);
  f.key('Escape'); assert.equal(f.G.tool, null);
});

test('icon-only tools retain stable names and More Escape preserves the active tool', f => {
  f.get('open-build').click();
  f.toolbar.querySelector('[data-category="homes"]').click();
  const house=f.toolbar.querySelector('[data-tool="house"]');
  assert.equal(house.getAttribute('aria-label'),f.G.BDEF.house.name);
  house.click();const tool=f.G.tool;
  f.ui.setResourceExpanded(true);f.get('resource-more').focus();
  const event=f.key('Escape');
  assert.equal(f.ui._resourceExpanded,false);assert.equal(f.G.tool,tool);
  assert.equal(f.document.activeElement,f.get('resource-more'));
  assert.equal(house.getAttribute('aria-label'),f.G.BDEF.house.name);
});

function selectHouse(f) {
  f.get('open-build').click();
  f.toolbar.querySelector('[data-category="homes"]').click();
  f.toolbar.querySelector('[data-tool="house"]').click();
}
function stage(f,x=10,y=10) {
  const result=f.G.stageBuildingPlacement(x,y);f.ui.refreshHUD();return result;
}

test('click-only semantic confirmation builds the staged site exactly once', f => {
  selectHouse(f);const confirm=f.get('jade-build-confirm'),stocks={...f.G.game.res};
  assert.equal(confirm.hidden,false);assert.equal(confirm.disabled,true);
  assert.equal(confirm.textContent,'选择位置');
  assert(stage(f).ok);assert.equal(f.G.world.buildings.length,0);
  assert.equal(confirm.disabled,false);assert.equal(confirm.textContent,'确认建造');
  confirm.click();
  assert.equal(f.G.world.buildings.length,1);assert.equal(f.G.world.buildings[0].x,10);
  assert.equal(f.G.pendingBuildingPlacement,null);assert.equal(confirm.disabled,true);
  confirm.click();assert.equal(f.G.world.buildings.length,1);
  assert.deepEqual(f.G.game.res,stocks);
});

for(const event of ['pointerdown','mousedown','Enter',' '])test(event+' captures the exact pending position and rejects a later position', f=>{
  selectHouse(f);stage(f);const confirm=f.get('jade-build-confirm'),old=f.G.pendingBuildingPlacement;
  if(event==='Enter'||event===' '){confirm.focus();f.key(event);}
  else f.event(confirm,event,{button:0});
  stage(f,20,20);assert.notEqual(f.G.pendingBuildingPlacement,old);
  confirm.click();assert.equal(f.G.world.buildings.length,0);
  assert.match(f.toasts.at(-1)[0],/位置已更新/);
  f.event(confirm,'pointerdown',{button:0});confirm.click();
  assert.equal(f.G.world.buildings.length,1);assert.equal(f.G.world.buildings[0].x,20);
});

test('blocked placement shows its current reason and disabled action, then recovers with stock',f=>{
  selectHouse(f);f.G.game.res.wood=0;stage(f);
  const confirm=f.get('jade-build-confirm'),benefit=f.get('jade-build-benefit');
  assert.equal(confirm.disabled,true);assert.match(benefit.textContent,/木材不足/);
  assert(benefit.classList.contains('is-blocked'));assert.match(f.get('jade-build-costs').innerHTML,/is-short/);
  confirm.click();assert.equal(f.G.world.buildings.length,0);
  f.G.game.res.wood=80;f.ui.refreshHUD();
  assert.equal(confirm.disabled,false);assert(!benefit.classList.contains('is-blocked'));
  confirm.click();assert.equal(f.G.world.buildings.length,1);
});

test('details Escape closes only the details and Back restores categories with correct aria',f=>{
  selectHouse(f);stage(f);
  const title=f.get('jade-build-title'),head=f.get('jade-build-header');
  const tool=f.G.tool,pending=f.G.pendingBuildingPlacement;
  title.click();assert(head.classList.contains('jade-details-open'));
  assert.equal(title.getAttribute('aria-expanded'),'true');
  const event=f.key('Escape');assert(event.immediate);assert(event.defaultPrevented);
  assert(!head.classList.contains('jade-details-open'));assert.equal(title.getAttribute('aria-expanded'),'false');
  assert.equal(f.G.tool,tool);assert.equal(f.G.pendingBuildingPlacement,pending);
  assert.equal(f.document.activeElement,title);
  title.click();f.get('jade-back-categories').click();
  assert(!head.classList.contains('jade-details-open'));assert.equal(title.getAttribute('aria-expanded'),'false');
  assert.equal(f.G.tool,null);assert.equal(f.G.pendingBuildingPlacement,null);assert.equal(f.ui.menuCategory,null);
});

test('switching tools closes details and discards the earlier pending position',f=>{
  selectHouse(f);stage(f);const title=f.get('jade-build-title');
  title.click();f.G.setTool('stonehouse');
  assert.equal(title.getAttribute('aria-expanded'),'false');
  assert(!f.get('jade-build-header').classList.contains('jade-details-open'));
  assert.equal(f.G.pendingBuildingPlacement,null);assert.equal(f.get('jade-build-confirm').disabled,true);
});

test('modal guards block confirmation, details toggles, Back and details Escape',f=>{
  selectHouse(f);stage(f);const title=f.get('jade-build-title'),head=f.get('jade-build-header');
  title.click();const pending=f.G.pendingBuildingPlacement,tool=f.G.tool;
  f.modal(true);
  f.get('jade-build-confirm').click();title.click();f.get('jade-back-categories').click();f.key('Escape');
  assert.equal(f.G.world.buildings.length,0);assert.equal(f.G.tool,tool);
  assert.equal(f.G.pendingBuildingPlacement,pending);assert(head.classList.contains('jade-details-open'));
  assert.equal(title.getAttribute('aria-expanded'),'true');
  f.modal(false);f.get('jade-build-confirm').click();assert.equal(f.G.world.buildings.length,1);
});

for(const interrupt of ['pointercancel','touchcancel','blur','hidden'])test(interrupt+' does not turn a cancelled activation into a fresh click-only confirmation',f=>{
  selectHouse(f);stage(f);const confirm=f.get('jade-build-confirm');
  f.event(confirm,'pointerdown',{button:0});
  if(interrupt==='blur')f.windowEvent('blur');
  else if(interrupt==='hidden'){f.document.visibilityState='hidden';f.documentEvent('visibilitychange');f.document.visibilityState='visible';}
  else f.event(confirm,interrupt);
  confirm.click();assert.equal(f.G.world.buildings.length,0);
  stage(f,20,20);
  f.event(confirm,'pointerdown',{button:0});confirm.click();assert.equal(f.G.world.buildings.length,1);
});

for(const key of ['Enter',' '])test('held '+(key===' '?'Space':key)+' cannot confirm a newly staged position through repeat clicks',f=>{
  selectHouse(f);stage(f);const confirm=f.get('jade-build-confirm');
  confirm.focus();f.key(key);confirm.click();
  assert.equal(f.G.world.buildings.length,1);
  stage(f,20,20);const pending=f.G.pendingBuildingPlacement;
  const repeated=f.key(key,{repeat:true});assert(repeated.defaultPrevented);
  confirm.click();assert.equal(f.G.world.buildings.length,1);
  assert.equal(f.G.pendingBuildingPlacement,pending);
  // Even an extra non-repeat keydown without release is not a fresh action.
  assert(f.key(key).defaultPrevented);confirm.click();
  assert.equal(f.G.world.buildings.length,1);
  f.event(confirm,'keyup',{key});
  f.key(key);confirm.click();assert.equal(f.G.world.buildings.length,2);
  assert.equal(f.G.world.buildings[1].x,20);
});

test('Space release keeps the original captured position and a fresh press can retry',f=>{
  selectHouse(f);stage(f);const confirm=f.get('jade-build-confirm');
  confirm.focus();f.key(' ');
  stage(f,20,20);f.event(confirm,'keyup',{key:' '});confirm.click();
  assert.equal(f.G.world.buildings.length,0);
  assert.match(f.toasts.at(-1)[0],/位置已更新/);
  f.key(' ');f.event(confirm,'keyup',{key:' '});confirm.click();
  assert.equal(f.G.world.buildings.length,1);assert.equal(f.G.world.buildings[0].x,20);
});

// A key can be released after focus/window visibility has changed, so its
// keyup never reaches the confirmation button. A later fresh press must work.
for (const interrupt of ['button-blur', 'window-blur', 'hidden'])
  for (const key of ['Enter', ' ']) test(interrupt+' releases interrupted '+(key===' '?'Space':key)+' confirmation', f => {
    selectHouse(f); stage(f);
    const confirm=f.get('jade-build-confirm'); confirm.focus(); f.key(key);
    if(interrupt==='button-blur') f.event(confirm,'blur');
    else if(interrupt==='window-blur') f.windowEvent('blur');
    else { f.document.visibilityState='hidden'; f.documentEvent('visibilitychange'); f.document.visibilityState='visible'; }
    // A delayed activation from the interrupted gesture remains rejected.
    confirm.click(); assert.equal(f.G.world.buildings.length,0);
    // The old key was released elsewhere. No keyup is delivered to this button.
    confirm.focus(); const fresh=f.key(key);
    assert.equal(fresh.defaultPrevented,false,'fresh keyboard input must not stay latched');
    if(key===' ') f.event(confirm,'keyup',{key});
    confirm.click(); assert.equal(f.G.world.buildings.length,1);
  });

test('focus loss after Enter activation rejects a delayed click against a new site', f => {
  selectHouse(f); stage(f); const confirm=f.get('jade-build-confirm');
  confirm.focus(); f.key('Enter'); confirm.click();
  assert.equal(f.G.world.buildings.length,1);
  f.event(confirm,'blur'); stage(f,20,20);
  confirm.click(); assert.equal(f.G.world.buildings.length,1);
  confirm.focus(); f.key('Enter'); confirm.click();
  assert.equal(f.G.world.buildings.length,2);
});

test('collection catalogue separates resource types and omits legacy combined mining', f => {
  const tools=f.ui.toolGroups.flatMap(group=>group.tools);
  for(const type of ['gatherall','fell','collectstone','collectiron','cancelremoval']) assert(tools.includes(type));
  assert(!tools.includes('quarry'));
});
for(const type of ['gatherall','fell','collectstone','collectiron','cancelremoval']) test(type+' uses map strip with no detail page and Exit restores tool focus',f=>{
  f.get('open-build').click();f.ui.openToolCategory('land');
  const button=f.toolbar.querySelector(`[data-tool="${type}"]`);button.focus();button.click();
  assert.equal(f.G.tool.kind,type);
  assert(f.hud.classList.contains('is-harvesting'));
  assert.equal(f.toolbar.inert,true);
  assert(!f.get('harvest-map-controls').classList.contains('hidden'));
  assert(f.get('harvest-range-controls').classList.contains('hidden'));
  assert(f.get('harvest-cancel').classList.contains('hidden'));
  assert.equal(f.document.activeElement,f.get('harvest-exit'));
  assert.match(f.get('harvest-map-status').textContent,/松开/);
  assert.doesNotMatch(f.get('harvest-map-status').textContent,/确认/);
  for(let i=0;i<20;i++)f.ui.refreshHarvest();
  assert(f.get('placement-info').classList.contains('hidden'));
  f.modal(true);f.get('harvest-exit').click();assert.equal(f.G.tool.kind,type);
  f.modal(false);f.get('harvest-exit').click();
  assert.equal(f.G.tool,null);assert.equal(f.toolbar.inert,false);
  assert(!f.hud.classList.contains('is-harvesting'));
  assert(f.get('harvest-map-controls').classList.contains('hidden'));
  assert.equal(f.document.activeElement,button);
});
test('switching collection to a building restores normal workspace',f=>{
  f.get('open-build').click();f.ui.openToolCategory('land');f.G.setTool('collectiron');
  f.ui.openToolCategory('homes');f.G.setTool('house');
  assert.equal(f.G.tool.type,'house');assert(!f.hud.classList.contains('is-harvesting'));
  assert.equal(f.toolbar.inert,false);assert(f.get('harvest-map-controls').classList.contains('hidden'));
});
const mapCss=read('styles/harvest-map.css');
assert.match(mapCss,/#hud\.is-harvesting #toolbar,[\s\S]*?display:none !important/);
assert.match(mapCss,/#harvest-map-controls button[^}]*min-height:44px/);
assert(html.indexOf('styles/harvest-map.css')>html.indexOf('styles/desktop-workspace.css'));

console.log(`Jade composition: ${passed} behavioral groups passed (real toolbar/navigation/layout scripts; minimal DOM, no browser hit-testing).`);
