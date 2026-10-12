/* Tavern DOM and live-simulation contracts, not browser visual acceptance. */
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
    let html = '', text = '';
    return {
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
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      emit(type) { for (const fn of handlers[type] || []) fn({target: this}); },
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
  const ctx = { console, document: doc, __errs: [], setTimeout() {}, addEventListener() {} };
  ctx.window = ctx; vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'ui'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar');
  G.ui.el = { info, guide, toolbar, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
  G.ui.toast = () => {};
  for (const key of G.RES_KEYS) mount('res-' + key).appendChild(element('b'));
  function building(type, options = {}) {
    const def = G.BDEF[type], n = G.world.buildings.length;
    const b = Object.assign({ id: G.nextId(), type, x: 2 + (n % 6) * 6, y: 2 + Math.floor(n / 6) * 6,
      w: def.w, h: def.h, state: 'ok', workers: [], family: null, noWork: false, warnText: '',
      progress: 1, totalWork: def.buildWork, workLeft: 0 }, options);
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
  const node = key => info.querySelector(`[data-fuel="${key}"]`);
  const button = delta => info.querySelector(`[data-fl="${delta}"]`);
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, button, mount };
}

const syncFood = G => { G.game.res.food = G.FOOD_KEYS.reduce((sum, key) => sum + G.game.res[key], 0); };
let passed = 0;
function test(name, fn) { fn(); console.log('ok ' + name); passed++; }
const live = (f, key) => f.info.querySelector(`[data-tavern="${key}"]`);
function tavern() {
  const f = fixture(), b = f.building('tavern'), { G } = f;
  G.game.res.grain = 900; syncFood(G); G.game.res.ale = 3;
  const brewer = G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm', name: '酿酒工<甲>' });
  brewer.name = '酿酒工<甲>'; brewer.job = b.id; b.workers = [brewer.id]; brewer.state = 'work';
  brewer.task = { kind: 'host', b, tx: brewer.x, ty: brewer.y, workLeft: 4, work: 4 };
  const visitor = G.spawnCitizen({ x: b.x - 1, y: b.y + 1, age: 28, sex: 'f', name: '来访住户' });
  G.game.h = 10;
  return { ...f, b, brewer, visitor };
}

test('tavern appears in industry with dedicated art and real recipe, food protection, adult service facts', () => {
  const f = tavern(); f.G.ui.initToolbar();
  assert(f.G.ui.toolGroups.find(group => group.id === 'industry').tools.includes('tavern'));
  assert.match(f.G.ui.toolButton('tavern'), /assets\/icons\/tool_tavern\.png/);
  assert.equal(f.G.BDEF.tavern.jobs, 1); f.select(f.b);
  assert.match(live(f, 'recipe').textContent, /30 主食 → 3 麦酒（受教育 4）.*6 小时/);
  assert.match(live(f, 'reserve').textContent, /全村 12 天.*50/);
  assert.match(live(f, 'afterBatch').textContent, /870/);
  assert.match(live(f, 'service').textContent, /可接待.*步行/);
  assert.match(live(f, 'visitors').textContent, /0 \/ 4.*18 岁以上 2 人/);
  assert.match(f.info.textContent, /工人从仓库领取整批主食、苹果或梨.*再把麦酒送仓/);
  assert.match(f.info.textContent, /通用蔬菜与旧果园的蔬菜不能酿酒.*不能充饥/);
  assert.match(f.info.textContent, /2 小时.*1 麦酒.*6 天/);
  assert.match(f.info.textContent, /18 岁以上且健康/);
  assert.match(f.info.innerHTML, /酿酒工&lt;甲&gt;/);
  assert.doesNotMatch(f.info.textContent, /原版精确|礼拜堂/);
});

test('timed refresh patches real stock, reserve, visitors and staff without replacing focused controls', () => {
  const f = tavern(); f.select(f.b);
  const button = f.doc.getElementById('tavern-reserve-more'), panel = f.info.querySelector('[data-tavern-panel]');
  const writes = f.info.htmlWrites, panelWrites = panel.htmlWrites; button.focus();
  f.G.game.res.ale = 2; f.G.game.res.grain = 400; syncFood(f.G);
  f.visitor.task = { kind: 'leisure', b: f.b, tx: f.visitor.x, ty: f.visitor.y, work: 2, workLeft: 2 }; f.visitor.state = 'walk';
  f.brewer.state = 'walk';
  for (let i = 0; i < 4; i++) f.G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(panel.htmlWrites, panelWrites);
  assert.equal(f.doc.getElementById('tavern-reserve-more'), button); assert.equal(f.doc.activeElement, button);
  assert.match(live(f, 'stock').textContent, /主食 400.*麦酒 2/);
  assert.match(live(f, 'visitors').textContent, /1 \/ 4/);
  assert.match(live(f, 'service').textContent, /服务暂停.*实际到岗/);
});

test('reserve buttons use real setter, keep focus, step by four, clamp boundaries and avoid redundant boundary mutations', () => {
  const f = tavern(), calls = [], setter = f.G.setTavernReserve;
  f.G.setTavernReserve = (b, n) => { calls.push(n); return setter(b, n); }; f.select(f.b);
  const more = f.doc.getElementById('tavern-reserve-more'), less = f.doc.getElementById('tavern-reserve-less'), writes = f.info.htmlWrites;
  more.click(); more.click(); assert.equal(f.G.tavernReserveDays(f.b), 20); assert.equal(f.doc.activeElement, more);
  less.click(); assert.equal(f.G.tavernReserveDays(f.b), 16);
  f.b.reserveDays = 9; f.G.ui.renderInfo(); less.click(); assert.equal(f.b.reserveDays, 8); assert.equal(less.disabled, true);
  const lowerCalls = calls.length; less.click(); assert.equal(calls.length, lowerCalls);
  f.b.reserveDays = 47; f.G.ui.renderInfo(); more.click(); assert.equal(f.b.reserveDays, 48); assert.equal(more.disabled, true);
  const upperCalls = calls.length; more.click(); assert.equal(calls.length, upperCalls);
  assert.equal(f.info.htmlWrites, writes); assert.match(live(f, 'reserve').textContent, /全村 48 天/);
  assert.match(f.info.querySelector('[data-tavern-message]').textContent, /48 天.*实际库存/);
});

test('modal, hidden panel, changed selection, rebuilt panel, replacement world/game/building and removed building guard callbacks', () => {
  for (const change of ['modal', 'hidden', 'selection', 'panel', 'world', 'game', 'infoElement', 'removed', 'replacement', 'site', 'closed']) {
    const f = tavern(); f.select(f.b); const old = f.doc.getElementById('tavern-reserve-more'); let calls = 0;
    f.G.setTavernReserve = () => { calls++; return true; };
    if (change === 'modal') f.G.hasOpenModal = () => true;
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'selection') f.G.sel = { kind: 'b', id: f.building('house').id };
    if (change === 'panel') { f.select(f.building('house')); f.select(f.b); }
    if (change === 'world') f.G.world = { ...f.G.world };
    if (change === 'game') f.G.game = { ...f.G.game };
    if (change === 'infoElement') f.G.ui.el.info = f.mount('replacement-info');
    if (change === 'removed') delete f.G.world.bmap[f.b.id];
    if (change === 'replacement') f.G.world.bmap[f.b.id] = { ...f.b };
    if (change === 'site') f.b.state = 'site';
    if (change === 'closed') f.G.ui.hideInfo();
    old.click(); assert.equal(calls, 0, change);
  }
});

test('failed setter reports rejection and keeps actual reserve and mounted controls intact', () => {
  const f = tavern(); f.G.setTavernReserve = () => false; f.select(f.b);
  const button = f.doc.getElementById('tavern-reserve-more'); button.click();
  assert.equal(f.G.tavernReserveDays(f.b), 12); assert.equal(f.doc.getElementById('tavern-reserve-more'), button);
  assert.match(f.info.querySelector('[data-tavern-message]').textContent, /未更改/);
});

test('construction completion replaces site controls safely and stale cancel cannot demolish completed tavern', () => {
  const f = tavern(); f.b.state = 'site'; f.b.progress = .5; f.select(f.b);
  const old = f.doc.getElementById('info-demolish'); old.focus(); assert.equal(f.doc.getElementById('tavern-reserve-more'), null);
  f.b.state = 'ok'; f.G.ui.renderInfo(); assert(f.doc.getElementById('tavern-reserve-more'));
  assert.equal(f.doc.activeElement.id, 'info-close'); old.click(); assert.equal(f.G.world.bmap[f.b.id], f.b);
});

test('real food and grain shortages are separate from service availability, and stock exhaustion patches live', () => {
  const f = tavern(); f.G.game.res.grain = 35; syncFood(f.G); f.select(f.b);
  assert.match(live(f, 'status').textContent, /不足全村12天口粮/);
  assert.match(live(f, 'service').textContent, /可接待/);
  f.G.game.res.grain = 20; f.G.game.res.vegetables = 500; syncFood(f.G); f.G.ui.renderInfo();
  assert.match(live(f, 'status').textContent, /主食不足/); assert.match(live(f, 'afterBatch').textContent, /490/);
  f.G.game.res.ale = 0; f.G.ui.renderInfo(); assert.match(live(f, 'service').textContent, /需麦酒入库/);
  f.brewer.sickDays = 1; f.G.ui.renderInfo(); assert.match(live(f, 'service').textContent, /健康酿酒工实际到岗/);
});

test('real citizen happiness reports dietary basis, six-day memory and bounded positive work bonus', () => {
  const f = tavern(), c = f.visitor;
  c.dietScore = 3; c.happiness = 5; c.leisureDays = 6;
  f.G.sel = { kind: 'c', id: c.id }; f.G.ui.showInfo();
  assert.match(f.info.textContent, /幸福：5.0 \/ 5.*当前目标 5.0/);
  assert.match(f.info.textContent, /休闲记忆：约余 6.0 天.*幸福目标 \+1/);
  assert.match(f.info.textContent, /劳动效率：\+5.0%.*无负惩罚/);
  assert.match(f.info.textContent, /三组营养（肉类含鸡蛋、蔬菜含苹果和梨、主食）是幸福基础.*4.0/);
  assert.match(f.info.textContent, /日终向目标最多变化 0.1/);
  const close = f.doc.getElementById('info-close'), writes = f.info.htmlWrites; close.focus();
  c.happiness = 1; c.leisureDays = 0; c.dietScore = 0; f.G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, close);
  assert.match(f.info.textContent, /劳动效率：\+0.0%/); assert.match(f.info.textContent, /当前饮食基础 2.5/);
  assert.match(f.info.textContent, /休闲记忆：暂无/);
});

test('citizen statuses distinguish actual fetching, ingredient transport, brewing, service, visit and night return', () => {
  const f = tavern(), c = f.brewer, status = () => f.G.ui.citizenStatus(c);
  c.task = { kind: 'brew', b: f.b, phase: 'fetch' }; c.state = 'walk'; assert.match(status(), /前往仓库取酿酒主食/);
  c.carry = { type: 'grain', qty: 30, brewIngredient: true }; assert.match(status(), /送往酒馆/);
  c.state = 'haul'; assert.match(status(), /退回仓库/); c.carry = null;
  c.state = 'work'; c.task.phase = 'process'; assert.equal(status(), '加工麦酒');
  c.task.kind = 'host'; assert.equal(status(), '酒馆在岗接待');
  const v = f.visitor; v.task = { kind: 'leisure', b: f.b, workLeft: 1.2 }; v.state = 'walk';
  assert.match(f.G.ui.citizenStatus(v), /前往酒馆休闲/); v.state = 'work'; assert.match(f.G.ui.citizenStatus(v), /尚需 1.2 小时/);
  c.state = 'walk'; assert.match(f.G.ui.citizenStatus(v), /等待健康酿酒工.*4 小时/);
  v.state = 'walk'; v.walkKind = 'home'; assert.equal(f.G.ui.citizenStatus(v), '回家途中');
});

test('ale HUD and production goal register independently of all six food items and describe lossless full-cargo delivery', () => {
  const f = tavern(), { G } = f;
  assert(G.RES_KEYS.includes('ale')); assert(!G.FOOD_KEYS.includes('ale'));
  assert.match(G.ui.resourceIcon('ale'), /assets\/icons\/res_ale\.png/);
  G.game.res.ale = G.storageCap(); f.visitor.carry = { type: 'ale', qty: 2 }; G.ui.refreshHUD();
  const title = f.doc.getElementById('res-ale').title;
  assert.match(title, /麦酒不计入食物，不可充饥.*18 岁以上.*1 麦酒/); assert.match(title, /仓满保留麦酒/);
  for (const id of ['production-goals', 'production-goal-rows', 'btn-production-goals', 'production-goals-close', 'production-goals-message']) f.mount(id);
  G.ui.initProductionGoals(); G.setProductionGoal('ale', G.storageCap() + 10); G.ui.refreshProductionGoals();
  assert(f.doc.getElementById('goal-input-ale'));
  assert.match(f.doc.getElementById('goal-status-ale').textContent, /余麦酒保留随身.*储粮保护.*不能充饥/);
});

test('real completed service consumes one ale, reveals six-day memory and happiness change in the focused citizen panel', () => {
  const f = tavern(), { G } = f, c = f.visitor;
  c.dietScore = 3; c.happiness = 4; c.leisureDays = 0;
  c.state = 'work'; c.task = { kind: 'leisure', b: f.b, tx: c.x, ty: c.y, work: 2, workLeft: 2, waitingH: 0 };
  G.sel = { kind: 'c', id: c.id }; G.ui.showInfo(); const close = f.doc.getElementById('info-close'); close.focus();
  const request = G.requestTask; G.requestTask = () => {};
  G.stepLeisure(c, 1); G.ui.renderInfo(); assert.equal(G.game.res.ale, 3); assert.match(f.info.textContent, /尚需 1.0 小时/);
  G.stepLeisure(c, 1); G.ui.renderInfo(); G.requestTask = request;
  assert.equal(G.game.res.ale, 2); assert.equal(G.leisureDaysOf(c), 6); assert.equal(c.task, null);
  assert.match(f.info.textContent, /幸福：4.4 \/ 5/); assert.match(f.info.textContent, /约余 6.0 天/);
  assert.equal(f.doc.activeElement, close); assert.equal(f.doc.getElementById('info-close'), close);
});
console.log(`Tavern UI: ${passed} DOM and live-simulation suites passed (browser visual acceptance not performed).`);
