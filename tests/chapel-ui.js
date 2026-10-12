/* Chapel DOM contracts. Uses the real chapel simulation API; not browser visual acceptance. */
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
      tagName: tag.toUpperCase(), id: attrs.id || '', value: attrs.value || '', dataset: Object.fromEntries(Object.entries(attrs)
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
      emit(type) { for (const fn of handlers[type] || []) fn({ target: this, preventDefault() {} }); },
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
  G.setTool = type => { G.tool = type ? { kind: 'build', type } : null; G.ui.refreshToolbarNavigation(); };
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

let passed = 0;
function test(name, fn) { fn(); console.log('ok ' + name); passed++; }
const live = (f, key) => f.info.querySelector(`[data-chapel="${key}"]`);
const citizenLive = (f, key) => f.info.querySelector(`[data-citizen-leisure="${key}"]`);
function chapel() {
  const f = fixture(), { G } = f;
  assert(G.BDEF.chapel && G.CHAPEL && G.chapelSummary, 'Chapel simulation API must be installed before running chapel-ui.js');
  const b = f.building('chapel');
  const cleric = G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm', name: '牧师<甲>' });
  cleric.name = '牧师<甲>'; cleric.job = b.id; b.workers = [cleric.id]; cleric.state = 'work';
  cleric.task = { kind: 'cleric', b, tx: cleric.x, ty: cleric.y, workLeft: 4, work: 4 };
  const visitor = G.spawnCitizen({ x: b.x - 1, y: b.y + 1, age: 28, sex: 'f', name: '来访住户' });
  G.game.h = 10; G.game.res.grain = 900; G.game.res.food = G.FOOD_KEYS.reduce((sum, key) => sum + G.game.res[key], 0);
  return { ...f, b, cleric, visitor };
}
function worship(f, c = f.visitor, state = 'work') {
  c.state = state;
  c.task = { kind: 'worship', b: f.b, tx: f.b.x - 1, ty: f.b.y + 1, work: 2, workLeft: 2, waitingH: 0 };
  return c;
}
function selectCitizen(f, c = f.visitor) { f.G.sel = { kind: 'c', id: c.id }; f.G.ui.showInfo(); }

test('chapel is in town services and returning to categories preserves its mounted tool', () => {
  const f = chapel(), { G } = f; G.ui.initToolbar();
  assert(G.ui.toolGroups.find(group => group.id === 'services').tools.includes('chapel'));
  assert.equal(G.ui.toolGroups.filter(group => group.tools.includes('chapel')).length, 1);
  assert.equal(G.BDEF.chapel.jobs, 1);
  const button = f.toolbar.querySelector('[data-tool="chapel"]');
  assert(button); assert.match(button.textContent, /礼拜堂/);
  assert.match(G.ui.toolButton('chapel'), /assets\/buildings\/chapel\.png/);
  G.ui.openToolCategory('services'); button.click(); assert.equal(G.tool.type, 'chapel');
  f.doc.getElementById('toolbar-back').click();
  assert.equal(G.tool, null); assert.equal(G.ui.menuCategory, null);
  assert.equal(f.toolbar.querySelector('[data-tool="chapel"]'), button);
  assert.equal(f.doc.activeElement, f.toolbar.querySelector('[data-category="services"]'));
  G.ui.openToolCategory('services'); assert.equal(f.toolbar.querySelector('[data-tool="chapel"]'), button);
});

test('details separate 200 service members from 8 reservations and disclose actual service rules', () => {
  const f = chapel(); f.select(f.b);
  assert.match(live(f, 'staff').textContent, /已分配 1 \/ 1.*健康在岗 1 \/ 1/);
  assert.match(f.info.innerHTML, /牧师&lt;甲&gt;/);
  assert.match(live(f, 'capacity').textContent, /0 \/ 200.*记忆.*预约去重/);
  assert.match(live(f, 'visitors').textContent, /0 \/ 8.*现场 0.*在途 0/);
  assert.match(live(f, 'service').textContent, /2 小时实际服务.*6 天礼拜记忆.*幸福目标 \+0.5.*即时 \+0.2.*叠加酒馆.*上限 5/);
  assert.match(live(f, 'rule').textContent, /200 人.*8 人.*本作适配.*步行不计.*工具、教育和幸福不缩短.*无需食物或麦酒/);
  assert.match(live(f, 'priority').textContent, /缺粮、饥饿、患病或需要上课.*未完成服务不会获得/);
  assert.equal(f.info.querySelector('[data-chapel-panel]').querySelectorAll('button').length, 0);
  assert(f.doc.getElementById('worker-limit-form'));
});

test('live occupancy and staffing refresh in place without losing a staffing draft or keyboard focus', () => {
  const f = chapel(); f.select(f.b);
  const panel = f.info.querySelector('[data-chapel-panel]'), input = f.doc.getElementById('worker-limit-input');
  const writes = f.info.htmlWrites, panelWrites = panel.htmlWrites; input.value = '0'; input.focus();
  worship(f);
  const traveling = f.G.spawnCitizen({ x: 1, y: 1, age: 28, sex: 'm' }); worship(f, traveling, 'walk');
  for (let i = 0; i < 3; i++) f.G.ui.renderInfo();
  assert.match(live(f, 'capacity').textContent, /2 \/ 200/);
  assert.match(live(f, 'visitors').textContent, /2 \/ 8.*现场 1.*在途 1/);
  f.cleric.state = 'walk'; f.G.ui.renderInfo();
  assert.match(live(f, 'staff').textContent, /已分配 1.*健康在岗 0/);
  assert.equal(live(f, 'status').textContent, f.G.chapelSummary(f.b).status);
  assert.equal(f.info.htmlWrites, writes); assert.equal(panel.htmlWrites, panelWrites);
  assert.equal(f.doc.getElementById('worker-limit-input'), input); assert.equal(f.doc.activeElement, input);
  assert.equal(input.value, '0'); assert.equal(f.G.workerLimitOf(f.b), 1);
});

test('service capacity counts remembered residents and does not label them as on-site visitors', () => {
  const f = chapel(); f.visitor.chapelDays = 6; f.visitor.chapelId = f.b.id; f.select(f.b);
  assert.match(live(f, 'capacity').textContent, /1 \/ 200/);
  assert.match(live(f, 'visitors').textContent, /0 \/ 8.*现场 0.*在途 0/);
  f.visitor.chapelDays = 0; f.G.ui.renderInfo(); assert.match(live(f, 'capacity').textContent, /0 \/ 200/);
});

test('the shared staffing form applies zero and restore without remounting controls or granting memory', () => {
  const f = chapel(); worship(f); f.select(f.b);
  const input = f.doc.getElementById('worker-limit-input'), form = f.doc.getElementById('worker-limit-form');
  const writes = f.info.htmlWrites; input.focus(); input.value = '0'; form.emit('submit');
  assert.equal(f.G.workerLimitOf(f.b), 0); assert.equal(f.G.chapelStaff(f.b), false);
  assert.equal(f.G.chapelDaysOf(f.visitor), 0); assert.match(live(f, 'staff').textContent, /健康在岗 0/);
  assert.equal(f.doc.getElementById('worker-limit-input'), input); assert.equal(f.doc.activeElement, input);
  input.value = '1'; form.emit('submit'); assert.equal(f.G.workerLimitOf(f.b), 1);
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.G.chapelDaysOf(f.visitor), 0);
});

test('stale shared staffing forms cannot change a hidden, replaced, removed, modal, or other selected chapel', () => {
  for (const change of ['modal', 'hidden', 'selection', 'panel', 'world', 'game', 'infoElement', 'removed', 'replacement', 'site', 'closed']) {
    const f = chapel(); f.select(f.b);
    const old = f.doc.getElementById('worker-limit-form'); f.doc.getElementById('worker-limit-input').value = '0'; let calls = 0;
    f.G.setWorkerLimit = () => { calls++; return true; };
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
    old.emit('submit'); assert.equal(calls, 0, change);
  }
});

test('construction completion mounts chapel facts and stale cancellation cannot demolish it', () => {
  const f = chapel(); f.b.state = 'site'; f.b.progress = .5; f.select(f.b);
  const old = f.doc.getElementById('info-demolish'); old.focus();
  assert.equal(f.info.querySelector('[data-chapel-panel]'), null);
  f.b.state = 'ok'; f.G.ui.renderInfo(); assert(f.info.querySelector('[data-chapel-panel]'));
  assert.equal(f.doc.activeElement.id, 'info-close'); old.click(); assert.equal(f.G.world.bmap[f.b.id], f.b);
});

test('citizen details show chapel and tavern memories together with a capped target and patch in place', () => {
  const f = chapel(), c = f.visitor;
  c.chapelDays = 6; c.chapelId = f.b.id; c.leisureDays = 6; c.dietScore = 3; c.happiness = 5;
  selectCitizen(f);
  assert.match(citizenLive(f, 'happiness').textContent, /5.0 \/ 5.*目标 5.0 \/ 5/);
  assert.match(citizenLive(f, 'chapel').textContent, /约余 6.0 天.*幸福目标 \+0.5/);
  assert.match(citizenLive(f, 'memory').textContent, /约余 6.0 天.*幸福目标 \+1/);
  assert.match(citizenLive(f, 'basis').textContent, /礼拜记忆可叠加休闲记忆.*总上限 5/);
  const close = f.doc.getElementById('info-close'), writes = f.info.htmlWrites; close.focus();
  c.chapelDays = 2.5; f.G.ui.renderInfo(); assert.match(citizenLive(f, 'chapel').textContent, /约余 2.5 天/);
  c.chapelDays = 0; f.G.ui.renderInfo(); assert.match(citizenLive(f, 'chapel').textContent, /暂无/);
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, close);
});

test('pre-chapel citizen fields default to no memory without mutation or undefined labels', () => {
  const f = chapel(), c = f.visitor;
  delete c.chapelDays; delete c.chapelId; delete c.chapelRetryH;
  const before = JSON.stringify(c); selectCitizen(f);
  const close = f.doc.getElementById('info-close'); close.focus(); f.G.ui.renderInfo();
  assert.match(citizenLive(f, 'chapel').textContent, /暂无/);
  assert.doesNotMatch(f.info.textContent, /undefined|NaN/); assert.equal(JSON.stringify(c), before);
});

test('resident and cleric activity distinguish travel, actual service, interrupted service and going home', () => {
  const f = chapel(), { G } = f, c = worship(f, f.visitor, 'walk');
  assert.match(G.ui.citizenStatus(c), /前往礼拜堂.*通勤不计/);
  c.state = 'work'; c.task.workLeft = 1.2; assert.match(G.ui.citizenStatus(c), /礼拜中.*尚需 1.2 小时实际服务/);
  assert.equal(G.ui.citizenStatus(f.cleric), '牧师在岗主持礼拜');
  f.cleric.state = 'walk'; assert.match(G.ui.citizenStatus(f.cleric), /牧师步行.*尚未提供服务/);
  assert.match(G.ui.citizenStatus(c), /等待健康牧师实际到岗.*尚未获得/);
  c.state = 'walk'; c.walkKind = 'home'; assert.equal(G.ui.citizenStatus(c), '回家途中');
  c.state = 'rest'; assert.doesNotMatch(G.ui.citizenStatus(c), /礼拜中|前往礼拜堂/);
  f.cleric.state = 'work'; f.cleric.sickDays = 1; assert.match(G.ui.citizenStatus(f.cleric), /服务暂停.*健康/);
});

test('focused citizen status follows real worship task changes and prioritizes school', () => {
  const f = chapel(), { G } = f, c = worship(f); selectCitizen(f);
  const close = f.doc.getElementById('info-close'); close.focus();
  c.task.workLeft = .7; G.ui.renderInfo(); assert.match(f.info.querySelector('[data-citizen-status]').textContent, /尚需 0.7 小时/);
  c.student = true; c.studyHours = 100; c.studyDay = G.game.day; c.studyToday = 0;
  const summary = G.studentSummary; G.studentSummary = () => ({ status: '应先上课' });
  assert.equal(G.ui.citizenStatus(c), '应先上课'); G.studentSummary = summary;
  c.studyToday = G.EDUCATION.dailyHours; assert.match(G.ui.citizenStatus(c), /礼拜中/); c.student = false;
  c.hunger = 1; assert.match(G.ui.citizenStatus(c), /饥饿.*优先补充口粮/); c.hunger = 0;
  c.task = null; c.state = 'idle'; G.ui.renderInfo(); assert.doesNotMatch(f.info.querySelector('[data-citizen-status]').textContent, /礼拜中/);
  assert.equal(f.doc.activeElement, close);
});

test('completing real service reveals six-day memory and immediate happiness without consuming food or ale', () => {
  const f = chapel(), { G } = f, c = worship(f);
  c.chapelDays = 0; c.happiness = 4; selectCitizen(f);
  const close = f.doc.getElementById('info-close'); close.focus();
  const before = JSON.stringify(G.game.res), request = G.requestTask; G.requestTask = () => {};
  G.stepWorship(c, 1); G.ui.renderInfo();
  assert.equal(G.chapelDaysOf(c), 0); assert.match(f.info.querySelector('[data-citizen-status]').textContent, /尚需 1.0 小时/);
  G.stepWorship(c, 1); G.ui.renderInfo(); G.requestTask = request;
  assert.equal(G.chapelDaysOf(c), 6); assert.equal(c.task, null); assert.equal(JSON.stringify(G.game.res), before);
  assert.match(citizenLive(f, 'chapel').textContent, /约余 6.0 天/);
  assert.match(citizenLive(f, 'happiness').textContent, /幸福：4.2 \/ 5/);
  assert.match(citizenLive(f, 'basis').textContent, /完成礼拜即时 \+0.2/);
  assert.equal(f.doc.getElementById('info-close'), close); assert.equal(f.doc.activeElement, close);
});

test('placement explains clergy and real access without claiming chapel output needs storage', () => {
  const f = chapel(), info = f.G.placementInfo('chapel', 20, 20);
  assert.match(info.text, /最多 1 名牧师.*服务容量 200 人.*预约最多 8 人/);
  assert.match(info.text, /健康牧师.*实际到场.*无需仓库供给/);
  assert.doesNotMatch(info.text, /产物无法正常入库/);
});
console.log(`Chapel UI: ${passed} DOM suites passed (browser visual acceptance not performed).`);
