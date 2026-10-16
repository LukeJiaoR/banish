/* Guarded home-upgrade controls exercise real simulation APIs; this is DOM QA, not browser/mobile acceptance. */
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
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar');
  G.ui.el = { info, guide, toolbar, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
  G.ui.toast = () => {};
  for (const key of G.RES_KEYS) mount('res-' + key).appendChild(element('b'));
  function building(type, options = {}) {
    const def = G.BDEF[type], n = G.world.buildings.length;
    const b = Object.assign({ id: G.nextId(), type, x: 2 + (n % 3) * 12, y: 2 + Math.floor(n / 3) * 12,
      w: def.w, h: def.h, state: 'ok', workers: [], family: null, noWork: false, warnText: '',
      progress: 1, totalWork: def.buildWork, workLeft: 0 }, options);
    if (type === 'farm') { b.farm = []; for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) b.farm.push({ x, y, sown: false, harvested: false }); b.sownAll = false; b.growth = 0; b.harvestDone = false; }
    // Existing direct fixtures model an already-paid, stocked legacy worksite.
    if (b.state === 'site') { const cost=b.paidCost||def.cost;b.construction=G.newConstruction(cost,cost);if(b.constructionStarted||b.progress>0||b.workLeft<b.totalWork)b.construction.legacyRefundHalf=true; }
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
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, mount };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const control = (f, id) => f.info.querySelector('#house-upgrade-' + id);
const live = (f, key) => f.info.querySelector(`[data-house-upgrade="${key}"]`).textContent;
const pending = f => !f.info.querySelector('[data-house-upgrade-confirm]').classList.contains('hidden');
function setup(options = {}) {
  const f = fixture(), G = f.G;
  f.building('storage');
  f.b = f.building('house', options);
  f.c = f.resident(f.b);
  Object.assign(G.game.res, { wood: 100, stone: 100, iron: 100, grain: 500, food: 500 });
  G.game.h = 12;
  f.select(f.b);
  assert(G.houseUpgradeQuote(f.b).ok, 'fixture needs an eligible house');
  return f;
}
const state = f => JSON.stringify(f.G.serializeGame());
const begin = f => control(f, 'start').click();
const confirm = f => control(f, 'confirm').click();
function workUntil(f,condition){if(f.c.job!==f.b.id){f.G.releaseWorker(f.c);f.G.assignWorker(f.b,f.c);}if(!f.c.task&&!f.c.carry)f.G.requestTask(f.c);for(let i=0;i<10000&&!condition();i++)f.G.stepCitizen(f.c,.1);assert(condition(),'actual delivery and construction must progress');}


test('only a completed wooden house has the upgrade action', () => {
  for (const [type, status] of [['house', 'ok'], ['house', 'site'], ['stonehouse', 'ok'], ['stonehouse', 'site'], ['boarding', 'ok'], ['storage', 'ok']]) {
    const f = fixture(), b = f.building(type, { state: status }); f.select(b);
    assert.equal(!!control(f, 'start'), type === 'house' && status === 'ok', type + ':' + status);
  }
});

test('review shows exact cost, actual salvage, net payment, displacement and qualified housing/fuel risks', () => {
  const f = setup();
  assert.deepEqual(['wood', 'stone', 'iron'].map(r => live(f, 'cost-' + r)), ['24', '40', '10']);
  assert.deepEqual(['wood', 'stone', 'iron'].map(r => live(f, 'salvage-' + r)), ['8', '4', '0']);
  assert.deepEqual(['wood', 'stone', 'iron'].map(r => live(f, 'due-' + r)), ['16', '36', '10']);
  assert.match(live(f, 'displaced'), /1 户 \/ 1 人/);
  assert.match(live(f, 'housing'), /空屋 0 户.*宿舍空位 0 户.*未核实.*可达.*不会预留/);
  assert.match(live(f, 'cold'), /受冻.*不能保证入住/);
  assert.match(live(f, 'fuel'), /本作.*有人入住.*每年约 30 → 15 柴火/);
  assert.match(f.info.textContent, /原屋永久消失.*取消升级工地也不会还原木屋/);
  f.b.paidCost = { wood: 10, stone: 6 }; f.G.ui.renderInfo();
  assert.deepEqual(['wood', 'stone'].map(r => live(f, 'salvage-' + r)), ['5', '3']);
  assert.deepEqual(['wood', 'stone', 'iron'].map(r => live(f, 'due-' + r)), ['19', '37', '10']);
});

test('structured review keeps all safety facts visible outside optional details', () => {
  const f = setup(), panel = f.info.querySelector('[data-house-upgrade-panel]');
  const table = panel.querySelector('table'), details = panel.querySelector('details');
  assert(table); assert.equal(table.querySelectorAll('td').length, 9);
  assert.equal(table.querySelectorAll('th').length, 7);
  assert.equal(table.querySelector('caption').textContent, '建材对照');
  assert(details); assert.equal(details.getAttribute('open'), null);
  assert(details.contains(panel.querySelector('[data-house-upgrade="fuel"]')));
  for (const key of ['displaced', 'housing', 'cold', 'reason']) {
    assert(!details.contains(panel.querySelector('[data-house-upgrade="' + key + '"]')), key);
  }
  assert(!details.textContent.includes('原屋永久消失'));
  assert.match(panel.textContent, /拆除不可逆/);
  const cell = panel.querySelector('[data-house-upgrade="due-wood"]');
  details.setAttribute('open', '');
  f.b.paidCost = { wood: 10, stone: 6 };
  f.G.ui.renderInfo();
  assert.equal(panel.querySelector('[data-house-upgrade="due-wood"]'), cell);
  assert.equal(cell.textContent, '19');
  assert.equal(details.getAttribute('open'), '');
});

test('begin and explicit cancel preserve simulation and a hidden confirm cannot act', () => {
  const f = setup(), before = state(f);
  confirm(f); assert.equal(state(f), before);
  begin(f); assert(pending(f)); assert.equal(state(f), before);
  assert.equal(f.doc.activeElement, control(f, 'confirm'));
  control(f, 'cancel').click();
  assert(!pending(f)); assert.equal(state(f), before);
  assert.equal(f.doc.activeElement, control(f, 'start'));
  confirm(f); assert.equal(state(f), before);
});

test('one explicit confirmation converts the real entity once and safely focuses site close', () => {
  const f = setup(), before = { ...f.G.game.res }, stale = control(f, 'confirm');
  begin(f); confirm(f);
  assert.equal(f.G.world.bmap[f.b.id], f.b);
  assert.equal(f.b.type, 'stonehouse'); assert.equal(f.b.state, 'site');
  assert.equal(f.b.upgradeFrom, 'house'); assert.equal(f.b.totalWork, 120);
  assert.equal(f.b.family, null); assert.notEqual(f.G.familyOf(f.c).houseId, f.b.id);
  assert.equal(f.G.game.res.wood, before.wood);assert.equal(f.b.construction.required.wood,24);assert.equal(f.b.construction.onsite.wood,8);
  assert.equal(f.G.game.res.stone, before.stone);assert.equal(f.b.construction.onsite.stone,4);
  assert.equal(f.G.game.res.iron, before.iron);assert.equal(f.b.construction.required.iron,10);
  assert.equal(control(f, 'start'), null);
  assert.equal(f.doc.activeElement, f.info.querySelector('#info-close'));
  assert.match(f.info.querySelector('[data-site-status]').textContent, /木屋升级石屋.*取料/);
  const after = state(f); stale.click(); stale.click(); assert.equal(state(f), after);
});

test('ordinary ticks refresh quote and resident details without replacing focused controls', () => {
  const f = setup(), start = control(f, 'start'), residents = f.info.querySelector('[data-home-residents]');
  start.focus(); const writes = f.info.htmlWrites;
  f.c.name = '<住户&乙>'; f.c.age = 31;
  f.G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(control(f, 'start'), start);
  assert.equal(f.info.querySelector('[data-home-residents]'), residents);
  assert.match(residents.textContent, /<住户&乙>\(31岁\)/); assert.equal(f.doc.activeElement, start);
  begin(f); const button = control(f, 'confirm');
  f.G.ui.renderInfo(); assert.equal(f.doc.activeElement, button); assert(pending(f));
  f.toolbar.focus(); f.G.ui.renderInfo(); assert.equal(control(f, 'confirm'), button); assert(pending(f));
  assert.equal(f.info.htmlWrites, writes);
});

test('resident changes update counts/names/status, revoke consent and keep controls mounted', () => {
  const f = setup(), start = control(f, 'start'), residents = f.info.querySelector('[data-home-residents]'); begin(f);
  const fam = f.G.familyOf(f.c); fam.houseId = null; f.b.family = null;
  f.G.ui.renderInfo();
  assert.equal(control(f, 'start'), start); assert.equal(f.info.querySelector('[data-home-residents]'), residents);
  assert.match(residents.textContent, /暂无/); assert.match(f.info.querySelector('[data-home-status]').textContent, /空置/);
  assert.match(live(f, 'displaced'), /0 户 \/ 0 人/); assert(!pending(f));
  assert.equal(f.doc.activeElement, start); confirm(f); assert.equal(f.b.type, 'house');
});

test('risk or quote changes before a click require a new two-step confirmation', () => {
  for (const change of ['cost', 'housing', 'boarding', 'winter', 'resident', 'materials', 'builder']) {
    const f = setup(); begin(f);
    if (change === 'cost') f.b.paidCost = { wood: 4, stone: 2 };
    if (change === 'housing') f.building('house');
    if (change === 'boarding') f.building('boarding');
    if (change === 'winter') { f.G.game.season = 3; f.G.game.day = f.G.SEASON_DAYS * 3; }
    if (change === 'resident') { const other = f.G.spawnCitizen({ x: 1, y: 1, age: 8, sex: 'f' }); f.G.familyOf(f.c).members.push(other.id); }
    if (change === 'materials') f.G.game.res.iron = 0;
    if (change === 'builder') { f.c.adult = false; f.c.student = true; }
    const before = state(f); confirm(f);
    assert.equal(f.b.type, 'house', change); assert.equal(state(f), before, change); assert(!pending(f), change);
    assert.match(f.info.querySelector('[data-house-upgrade-message]').textContent, /已变化|已更新/, change);
    confirm(f); assert.equal(f.b.type, 'house', change);
    if (f.G.houseUpgradeQuote(f.b).ok) { begin(f); confirm(f); assert.equal(f.b.type, 'stonehouse', change); }
  }
});

test('live condition changes revoke pending confirmation without stealing focus from unrelated controls', () => {
  const f = setup(); begin(f); f.toolbar.focus(); f.building('boarding'); f.G.ui.renderInfo();
  assert(!pending(f)); assert.equal(f.doc.activeElement, f.toolbar);
  assert.match(live(f, 'housing'), /宿舍空位 5 户/);
  confirm(f); assert.equal(f.b.type, 'house');
});

test('blocked materials and unreachable builder expose reasons and never change the village', () => {
  for (const condition of ['materials', 'builder']) {
    const f = setup();
    if (condition === 'materials') f.G.game.res.iron = 0;
    else { f.c.adult = false; f.c.student = true; }
    f.G.ui.renderInfo();
    assert.equal(control(f, 'start').getAttribute('aria-disabled'), 'true');
    assert.match(live(f, 'reason'), condition === 'materials' ? /补料不足/ : /没有成人/);
    const before = state(f); begin(f); confirm(f); assert.equal(state(f), before); assert(!pending(f));
  }
});

test('double-click and repeated keyboard activation cannot combine the two confirmation steps', () => {
  const f = setup(); begin(f);
  control(f, 'confirm').emit('click', { detail: 2 }); assert.equal(f.b.type, 'house'); assert(!pending(f));
  for (const id of ['start', 'confirm', 'cancel']) {
    let stopped = false; control(f, id).emit('keydown', { repeat: true, key: 'Enter', preventDefault() { stopped = true; } }); assert(stopped);
  }
  begin(f); control(f, 'start').emit('click', { detail: 2 }); assert(!pending(f)); assert.equal(f.b.type, 'house');
  begin(f); confirm(f); assert.equal(f.b.type, 'stonehouse');
});

test('old callbacks reject changed world/game/selection/entity/type/state/panel/node and a hidden panel', () => {
  for (const change of ['world', 'game', 'selection', 'entity', 'type', 'state', 'element', 'panel', 'node', 'cleared', 'hidden', 'removed']) {
    const f = setup(); begin(f); const stale = control(f, 'confirm');
    if (change === 'world') f.G.world = { ...f.G.world };
    if (change === 'game') f.G.game = { ...f.G.game };
    if (change === 'selection') f.G.sel = { kind: 'c', id: f.c.id };
    if (change === 'entity') f.G.world.bmap[f.b.id] = { ...f.b };
    if (change === 'type') f.b.type = 'stonehouse';
    if (change === 'state') f.b.state = 'site';
    if (change === 'element') f.G.ui.el.info = f.mount('other-info');
    if (change === 'panel') f.G.ui.renderInfo(true);
    if (change === 'node') f.info.querySelector('[data-house-upgrade-confirm]').innerHTML = '<button id="house-upgrade-confirm">replacement</button>';
    if (change === 'cleared') f.info.querySelector('[data-house-upgrade-panel]').innerHTML = '';
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'removed') delete f.G.world.bmap[f.b.id];
    const before = state(f); stale.click(); assert.equal(state(f), before, change);
  }
});

test('modal interruptions cancel pending intent before or during live refresh', () => {
  for (const refresh of [false, true]) {
    const f = setup(); begin(f); const button = control(f, 'confirm'); f.G.hasOpenModal = () => true;
    if (refresh) f.G.ui.renderInfo(); else button.click();
    assert(!pending(f)); f.G.hasOpenModal = () => false; button.click(); assert.equal(f.b.type, 'house');
    begin(f); confirm(f); assert.equal(f.b.type, 'stonehouse');
  }
});

test('closing/reopening or selecting another building invalidates old callbacks for the same house', () => {
  for (const flow of ['close', 'selection']) {
    const f = setup(); begin(f); const oldStart = control(f, 'start'), oldConfirm = control(f, 'confirm');
    if (flow === 'close') f.G.ui.hideInfo(); else f.select(f.building('storage'));
    f.select(f.b); const before = state(f); oldStart.click(); oldConfirm.click();
    assert.equal(state(f), before); assert(!pending(f)); assert.notEqual(control(f, 'confirm'), oldConfirm);
    begin(f); confirm(f); assert.equal(f.b.type, 'stonehouse');
  }
});

test('actual same-ID save reload leaves the old confirmation unable to change either village', () => {
  const f = setup(), old = f.b; begin(f); const stale = control(f, 'confirm'), saved = JSON.parse(state(f));
  f.mount('over'); f.G.T2S = () => [0, 0]; f.G.cam = { x: 0, y: 0, z: 1 }; f.G.groundDirty = new Set();
  f.G.applySaveData(saved); const restored = f.G.world.bmap[old.id]; assert.notEqual(restored, old);
  const before = state(f); stale.click(); assert.equal(state(f), before); assert.equal(old.type, 'house'); assert.equal(restored.type, 'house');
  f.b = restored; f.select(restored); begin(f); control(f, 'cancel').click(); assert.equal(state(f), before);
});

test('demolished house rejects old upgrade callbacks and cannot spend materials', () => {
  const f = setup(); begin(f); const stale = control(f, 'confirm'); f.G.removeBuilding(f.b);
  const before = state(f); stale.click(); assert.equal(state(f), before); assert.equal(f.G.world.bmap[f.b.id], undefined);
});

test('core-side revalidation failure is reported without automatically accepting its changed quote', () => {
  const f = setup(), upgrade = f.G.upgradeHouse;
  f.G.upgradeHouse = (b, key) => { f.G.game.res.iron = 0; return upgrade(b, key); };
  begin(f); confirm(f); assert.equal(f.b.type, 'house'); assert(!pending(f));
  assert.match(f.info.querySelector('[data-house-upgrade-message]').textContent, /补料不足/);
  assert.equal(f.doc.activeElement, control(f, 'start'));
});

test('converted-site pause/resume, progress and cancellation retain one accurate refund explanation', () => {
  const f = setup(), before = { ...f.G.game.res }; begin(f); confirm(f);
  const pause = f.info.querySelector('#construction-pause'); assert(pause); pause.click(); assert(f.b.sitePaused);
  f.info.querySelector('#construction-resume').click(); assert(!f.b.sitePaused);
  const refund = f.info.querySelector('[data-info-refund]');
  assert.match(refund.textContent, /当前可立即返还：木材×8、石头×4.*不会还原木屋/);
  assert.equal(f.info.querySelectorAll('[data-info-refund]').length, 1);
  workUntil(f,()=>f.b.progress>=.5);
  f.info.querySelector('#info-close').focus(); f.G.ui.renderInfo();
  assert.match(refund.textContent, /建材按一半回收/); assert.match(f.info.querySelector('[data-site-status]').textContent, /建造中 [5-9][0-9]%/);
  f.info.querySelector('#info-demolish').click(); assert.equal(f.G.world.bmap[f.b.id], undefined);
  assert.equal(f.G.game.res.wood, before.wood - 16 + 12);
  assert.equal(f.G.game.res.stone, before.stone - 36 + 20);
  assert.equal(f.G.game.res.iron, before.iron - 10 + 5);
});

test('completion removes upgrade-site controls, refreshes housing and makes all old destructive callbacks inert', () => {
  const f = setup(), oldHouseDemolish = f.info.querySelector('#info-demolish'); begin(f); confirm(f);
  const oldCancel = f.info.querySelector('#info-demolish'), oldPause = f.info.querySelector('#construction-pause'); oldPause.focus();
  workUntil(f,()=>f.b.state==='ok'); f.G.ui.renderInfo();
  assert.equal(f.b.type, 'stonehouse'); assert.equal(f.b.state, 'ok');
  assert.equal(control(f, 'start'), null); assert.equal(f.info.querySelector('#construction-pause'), null);
  assert.equal(f.doc.activeElement, f.info.querySelector('#info-close'));
  assert(f.info.querySelector('[data-home-residents]'));
  const before = state(f); oldCancel.click(); oldPause.click(); oldHouseDemolish.click(); assert.equal(state(f), before);
});

test('opening and refreshing home information is read-only, including escaped resident names', () => {
  const f = setup(); f.c.name = '<甲&乙>'; const before = state(f);
  f.G.ui.renderInfo(true); assert(f.info.innerHTML.includes('&lt;甲&amp;乙&gt;'));
  for (let i = 0; i < 3; i++) { f.G.ui.houseUpgradeInfoData(f.b); f.G.ui.homeInfoData(f.b); f.G.ui.renderInfo(); }
  assert.equal(state(f), before);
});

console.log(`House upgrade UI: ${passed} DOM/live-simulation suites passed (not browser/mobile acceptance).`);
