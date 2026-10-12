/* Guarded housing-fire and rebuild controls exercise real simulation APIs; this is DOM QA, not browser/mobile acceptance. */
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
  for (const name of ['core', 'defs', 'map', 'sim', 'fire', 'render', 'ui', 'main'])
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
const control = (f, id, kind = 'fire-rules') => f.info.querySelector('#' + kind + '-' + id);
const live = (f, key, kind = 'fire-rules') => f.info.querySelector(`[data-${kind}="${key}"]`).textContent;
const pending = (f, kind = 'fire-rules') => !f.info.querySelector(`[data-${kind}-confirm]`).classList.contains('hidden');
const state = f => JSON.stringify(f.G.serializeGame());
const begin = (f, kind) => control(f, 'start', kind).click();
const confirm = (f, kind) => control(f, 'confirm', kind).click();
function workUntil(f,condition){f.G.game.h=12;if(f.c.job!==f.home.id){f.G.releaseWorker(f.c);f.G.assignWorker(f.home,f.c);}if(!f.c.task&&!f.c.carry)f.G.requestTask(f.c);for(let i=0;i<10000&&!condition();i++)f.G.stepCitizen(f.c,.1);assert(condition(),'actual rebuilt home delivery/build must progress');}

function setup() {
  const f = fixture(), G = f.G;
  f.building('storage'); f.hall = f.building('townhall'); f.home = f.building('house'); f.c = f.resident(f.home);
  Object.assign(G.game.res, { wood: 500, stone: 500, iron: 500, grain: 500, food: 500 });
  f.select(f.hall); return f;
}
function setFires(f, enabled) {
  const q = f.G.fireToggleQuote(enabled);
  assert(q.ok, q.reason); assert.equal(f.G.setFireDisasters(enabled, q.key, f.G.game), true);
}

test('new villages default off and fire control appears only in completed Townhall', () => {
  const f = setup();
  assert.equal(f.G.fireRulesSummary().enabled, false);
  assert.match(live(f, 'state'), /关闭.*首次开启后有 48 天宽限/);
  assert.match(f.info.textContent, /12 小时烟雾预警.*36 小时火势窗口.*最多波及 3 座/);
  for (const [type, status] of [['house', 'ok'], ['stonehouse', 'ok'], ['boarding', 'ok'], ['townhall', 'site'], ['well', 'ok']]) {
    const other = fixture(), b = other.building(type, { state: status }); other.select(b);
    assert.equal(control(other, 'start'), null, type + ':' + status);
  }
});

test('opening, reading, beginning and cancelling controls do not alter simulation', () => {
  const f = setup(), before = state(f);
  confirm(f); assert.equal(state(f), before);
  begin(f); assert(pending(f)); assert.equal(state(f), before); assert.equal(f.doc.activeElement, control(f, 'confirm'));
  control(f, 'cancel').click(); assert(!pending(f)); assert.equal(state(f), before);
  assert.equal(f.doc.activeElement, control(f, 'start'));
  confirm(f); assert.equal(state(f), before);
  f.G.ui.renderInfo(); assert.equal(state(f), before);
});

test('explicit enable grants first grace once and disable also requires a separate confirmation', () => {
  const f = setup(), startDay = f.G.game.day;
  begin(f); confirm(f);
  const s = f.G.fireRulesSummary(); assert.equal(s.enabled, true); assert.equal(s.graceUntil, startDay + 48);
  assert.match(control(f, 'start').textContent, /关闭/);
  begin(f); assert.equal(f.G.fireRulesSummary().enabled, true);
  assert.match(f.info.querySelector('[data-fire-rules-quote]').textContent, /只阻止新起火和新蔓延.*继续燃烧、受损和接受救援.*不会撤销已有损失/);
  confirm(f); assert.equal(f.G.fireRulesSummary().enabled, false);
  assert.match(f.info.querySelector('[data-fire-rules-message]').textContent, /当前火灾、损伤与救援仍会继续/);
  f.G.game.day += 3; begin(f); confirm(f);
  assert.equal(f.G.fireRulesSummary().graceUntil, s.graceUntil);
});

test('timed refreshes leave consent, focused controls and existing Townhall sections mounted', () => {
  const f = setup(), button = control(f, 'start'), offer = f.info.querySelector('[data-townhall-offer]');
  button.focus(); const writes = f.info.htmlWrites; f.G.ui.renderInfo();
  assert.equal(control(f, 'start'), button); assert.equal(f.doc.activeElement, button); assert.equal(f.info.htmlWrites, writes);
  begin(f); const consent = control(f, 'confirm');
  f.G.game.h += .2; f.G.ui.renderInfo();
  assert(pending(f)); assert.equal(control(f, 'confirm'), consent); assert.equal(f.doc.activeElement, consent);
  assert.equal(f.info.querySelector('[data-townhall-offer]'), offer); assert.equal(f.info.htmlWrites, writes);
});

test('double clicks and repeated keyboard activation never combine confirmation steps', () => {
  const f = setup(); begin(f);
  control(f, 'confirm').emit('click', { detail: 2 }); assert.equal(f.G.fireRulesSummary().enabled, false); assert(!pending(f));
  for (const id of ['start', 'confirm', 'cancel']) {
    let prevented = false; control(f, id).emit('keydown', { repeat: true, key: 'Enter', preventDefault() { prevented = true; } }); assert(prevented);
  }
  begin(f); control(f, 'start').emit('click', { detail: 2 }); assert(!pending(f));
  begin(f); confirm(f); const before = state(f); confirm(f); assert.equal(state(f), before);
});

test('toggle rejects stale world, game, hall, entity, selection, panel, node and hidden controls', () => {
  for (const change of ['world', 'game', 'selection', 'entity', 'type', 'state', 'element', 'panel', 'node', 'cleared', 'hidden', 'removed']) {
    const f = setup(); begin(f); const stale = control(f, 'confirm');
    if (change === 'world') f.G.world = { ...f.G.world };
    if (change === 'game') f.G.game = { ...f.G.game };
    if (change === 'selection') f.G.sel = { kind: 'b', id: f.home.id };
    if (change === 'entity') f.G.world.bmap[f.hall.id] = { ...f.hall };
    if (change === 'type') f.hall.type = 'house';
    if (change === 'state') f.hall.state = 'site';
    if (change === 'element') f.G.ui.el.info = f.mount('other-info');
    if (change === 'panel') f.G.ui.renderInfo(true);
    if (change === 'node') f.info.querySelector('[data-fire-rules-confirm]').innerHTML = '<button id="fire-rules-confirm">replacement</button>';
    if (change === 'cleared') f.info.querySelector('[data-fire-rules-panel]').innerHTML = '';
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'removed') delete f.G.world.bmap[f.hall.id];
    const before = state(f); stale.click(); assert.equal(state(f), before, change);
  }
});

test('closing or navigating away never revives consent when returning to the same hall', () => {
  for (const flow of ['close', 'selection']) {
    const f = setup(); begin(f); const oldStart = control(f, 'start'), oldConfirm = control(f, 'confirm');
    if (flow === 'close') f.G.ui.hideInfo(); else f.select(f.home);
    f.select(f.hall); const before = state(f); oldStart.click(); oldConfirm.click();
    assert.equal(state(f), before); assert(!pending(f)); assert.notEqual(control(f, 'confirm'), oldConfirm);
    begin(f); confirm(f); assert.equal(f.G.fireRulesSummary().enabled, true);
  }
});

test('modal interruption cancels consent with and without a refresh', () => {
  for (const refresh of [false, true]) {
    const f = setup(); begin(f); const stale = control(f, 'confirm'); f.G.hasOpenModal = () => true;
    if (refresh) f.G.ui.renderInfo(); else stale.click();
    assert(!pending(f)); f.G.hasOpenModal = () => false; stale.click(); assert.equal(f.G.fireRulesSummary().enabled, false);
    begin(f); confirm(f); assert.equal(f.G.fireRulesSummary().enabled, true);
  }
});

test('settings changes invalidate old consent without stealing unrelated focus', () => {
  const f = setup(); begin(f); const consent = control(f, 'confirm'); f.toolbar.focus();
  setFires(f, true); const before = state(f); f.G.ui.renderInfo(); consent.click();
  assert.equal(state(f), before); assert(!pending(f));
  assert.match(f.info.querySelector('[data-fire-rules-message]').textContent, /已变化/);
  // The timed refresh preserves unrelated focus; the synthetic click above itself focuses the clicked node.
  f.toolbar.focus(); f.G.ui.renderInfo(); assert.equal(f.doc.activeElement, f.toolbar);
  begin(f); confirm(f); assert.equal(f.G.fireRulesSummary().enabled, false);
});

test('well stays in Services, never exposes a ruin tool, and promises no fake water stock or job', () => {
  const f = setup(); f.G.ui.initToolbar();
  assert(f.G.ui.toolGroups.find(group => group.id === 'services').tools.includes('well'));
  assert(!f.G.ui.toolGroups.some(group => group.tools.includes('burntruins')));
  assert.equal(f.toolbar.querySelectorAll('[data-tool="well"]').length, 1);
  const well = f.building('well'); f.select(well);
  assert.match(f.info.textContent, /无需安排工人/);
  assert.match(f.info.querySelector('[data-well-purpose]').textContent, /可达通路.*取水.*无常驻岗位.*不生成全镇水库存.*河岸/);
  assert.equal(f.info.querySelector('#worker-limit-input'), null);
});

function ignite(f) { if (f.G.fireRulesSummary().startedDay === null) setFires(f, true); assert.equal(f.G.igniteHouse(f.home), true); return f.home; }
function ruins(type = 'house') {
  const f = setup();
  if (type !== 'house') f.home.type = type;
  ignite(f); assert.equal(f.G.finishHouseFire(f.home, true), true);
  f.select(f.home); assert.equal(f.home.type, 'burntruins');
  assert(f.G.fireRebuildQuote(f.home).ok, 'fixture needs a rebuildable ruin'); return f;
}

test('active-home smoke, damage and water update in place and block demolition and old upgrade buttons', () => {
  const f = setup(); f.select(f.home);
  const upgradeStart = f.info.querySelector('#house-upgrade-start'); upgradeStart.click();
  const upgradeConfirm = f.info.querySelector('#house-upgrade-confirm'); ignite(f);
  const before = { ...f.G.game.res }; upgradeConfirm.click(); assert.equal(f.home.type, 'house');
  assert.deepEqual({ ...f.G.game.res }, before);
  upgradeConfirm.focus(); f.G.ui.renderInfo();
  assert.equal(f.doc.activeElement, f.info.querySelector('#info-close'));
  assert.equal(f.info.querySelector('#house-upgrade-start'), null);
  assert.match(live(f, 'status', 'home-fire'), /烟警/);
  assert.match(live(f, 'water', 'home-fire'), /3 桶水/);
  assert.match(live(f, 'shelter', 'home-fire'), /饥饿、受冻.*不驱逐.*不强制/);
  assert.equal(f.info.querySelector('#info-demolish').disabled, true);
  f.info.querySelector('#info-demolish').click(); assert.equal(f.G.world.bmap[f.home.id], f.home);
  const panel = f.info.querySelector('[data-home-fire-panel]'), writes = f.info.htmlWrites;
  f.G.advanceHousingFires(30); f.G.ui.renderInfo();
  assert.equal(f.info.querySelector('[data-home-fire-panel]'), panel); assert.equal(f.info.htmlWrites, writes);
  assert.match(live(f, 'status', 'home-fire'), /火焰/);
  assert.match(live(f, 'progress', 'home-fire'), /30.0 小时.*损伤 50%/);
  assert.match(f.info.querySelector('[data-home-status]').textContent, /火焰/);
});

test('turning off active incidents requires warning and leaves actual fire damage and rescuers running', () => {
  const f = setup(); setFires(f, true); ignite(f); f.G.ui.renderInfo();
  const active = f.G.fireRulesSummary(), incident = f.home.houseFire;
  begin(f); assert.match(f.info.querySelector('[data-fire-rules-quote]').textContent, /当前 1 座.*仍会继续燃烧/);
  confirm(f); assert.equal(f.G.fireRulesSummary().enabled, false);
  assert.equal(f.home.houseFire, incident); assert.equal(f.G.fireRulesSummary().rescuers, active.rescuers);
  f.G.advanceHousingFires(15); f.G.ui.renderInfo();
  assert.equal(f.home.houseFire.elapsed, 15); assert(f.G.houseFireSummary(f.home).damage > 0);
  assert.match(live(f, 'state'), /当前关闭.*活动住宅 1 座/);
});

test('new incident invalidates old confirmation but rolling time and damage do not', () => {
  const f = setup(); setFires(f, true); f.G.ui.renderInfo(); begin(f);
  ignite(f); const before = state(f); confirm(f);
  assert.equal(state(f), before); assert(!pending(f)); assert.equal(f.G.fireRulesSummary().enabled, true);
  begin(f); const consent = control(f, 'confirm'), writes = f.info.htmlWrites;
  f.G.advanceHousingFires(13); f.G.ui.renderInfo();
  assert(pending(f)); assert.equal(control(f, 'confirm'), consent); assert.equal(f.info.htmlWrites, writes);
  confirm(f); assert.equal(f.G.fireRulesSummary().enabled, false);
});

test('replacing the settings object revokes pending consent even with identical values', () => {
  const f = setup(); begin(f); f.G.game.fireDisasters = { ...f.G.game.fireDisasters };
  const before = state(f); confirm(f); assert.equal(state(f), before); assert(!pending(f));
});

test('no free rescuers and staff protection are explicit with real workforce counts', () => {
  const f = setup(), school = f.building('school'); f.c.job = school.id; school.workers = [f.c.id];
  ignite(f); f.G.ui.renderInfo();
  assert.match(live(f, 'rescue'), /可用空闲救援者 0 人.*没有空闲救援者/);
  assert.match(live(f, 'staffing'), /不会自动抽走教师、医师或生产工人.*降低用工上限.*收尾/);
  assert.equal(f.c.job, school.id); assert.equal(f.G.fireRulesSummary().rescuers, 0);
  f.select(f.home); assert.match(live(f, 'staffing', 'home-fire'), /没有空闲救援者.*降低其他建筑用工上限/);
});

test('extinguishing restores ordinary home panel and upgrade, without moving housed replacement families', () => {
  const f = setup(), spare = f.building('house'); ignite(f); f.select(f.home);
  const family = f.G.familyOf(f.c), temporary = family.houseId; assert.notEqual(temporary, f.home.id);
  f.G.finishHouseFire(f.home, false); f.G.ui.renderInfo();
  assert.equal(f.info.querySelector('[data-home-fire-panel]'), null);
  assert(f.info.querySelector('#house-upgrade-start')); assert.equal(f.info.querySelector('#info-demolish').disabled, false);
  assert.equal(family.houseId, temporary); assert.equal(temporary, spare.id);
});

test('burnout while focused replaces unsafe home controls with zero-refund ruin and guarded rebuild', () => {
  const f = setup(); ignite(f); f.select(f.home); f.info.querySelector('#info-close').focus();
  f.G.advanceHousingFires(48); f.G.ui.renderInfo();
  assert.equal(f.home.type, 'burntruins'); assert(control(f, 'start', 'fire-rebuild'));
  assert.equal(f.doc.activeElement, f.info.querySelector('#info-close'));
  assert.match(f.info.querySelector('[data-info-refund]').textContent, /退还 0 材料/);
  assert.match(f.info.querySelector('#info-demolish').textContent, /清理废墟（无返料）/);
  assert.equal(f.info.querySelector('#worker-limit-input'), null); assert.equal(f.info.querySelector('#house-upgrade-start'), null);
});

test('ruin review quotes full original wooden or stone home costs and winter housing risk', () => {
  for (const type of ['house', 'stonehouse']) {
    const f = ruins(type); f.G.game.season = 3; f.G.game.day = f.G.SEASON_DAYS * 3; f.G.ui.renderInfo();
    const cost = f.G.BDEF[type].cost;
    for (const [resource, n] of Object.entries(cost)) assert(live(f, 'cost', 'fire-rebuild').includes(f.G.RES[resource].name + '×' + n));
    assert.match(live(f, 'origin', 'fire-rebuild'), /无旧料回收或抵扣.*0 材料/);
    assert.match(live(f, 'housing', 'fire-rebuild'), /无房家庭 1 户.*寒冬.*受冻.*不预留床位/);
    const before = state(f); begin(f, 'fire-rebuild'); assert.equal(state(f), before);
    control(f, 'cancel', 'fire-rebuild').click(); assert.equal(state(f), before); assert(!pending(f, 'fire-rebuild'));
    confirm(f, 'fire-rebuild'); assert.equal(state(f), before);
  }
});

test('one explicit rebuild creates the real unpaid material plan once, and detaches old callbacks', () => {
  for (const type of ['house', 'stonehouse']) {
    const f = ruins(type), before = { ...f.G.game.res }, cost = { ...f.G.BDEF[type].cost }, stale = control(f, 'confirm', 'fire-rebuild');
    begin(f, 'fire-rebuild'); confirm(f, 'fire-rebuild');
    assert.equal(f.home.type, type); assert.equal(f.home.state, 'site'); assert.equal(f.G.world.bmap[f.home.id], f.home);
    assert.equal(f.home.progress, 0); assert.equal(f.home.totalWork, f.G.BDEF[type].buildWork);
    assert.deepEqual({ ...f.home.paidCost }, cost); assert.equal(f.G.familyOf(f.c).houseId, null);
    for (const [key, n] of Object.entries(cost)) {assert.equal(f.G.game.res[key], before[key]);assert.equal(f.home.construction.required[key],n);assert.equal(f.home.construction.onsite[key]||0,0);}
    assert.equal(control(f, 'start', 'fire-rebuild'), null); assert.match(f.info.querySelector('[data-site-status]').textContent, /取料/);
    assert.equal(f.doc.activeElement, f.info.querySelector('#info-close'));
    const after = state(f); stale.click(); stale.click(); assert.equal(state(f), after);
  }
});

test('rebuild condition changes invalidate consent and preserve typed or unrelated focus', () => {
  for (const change of ['materials', 'winter', 'homeless', 'origin', 'builder']) {
    const f = ruins(); begin(f, 'fire-rebuild');
    if (change === 'materials') f.G.game.res.wood = 0;
    if (change === 'winter') { f.G.game.season = 3; f.G.game.day = f.G.SEASON_DAYS * 3; }
    if (change === 'homeless') { const b = f.building('house'); f.G.familyOf(f.c).houseId = b.id; b.family = f.c.familyId; }
    if (change === 'origin') f.home.ruinFrom = 'stonehouse';
    if (change === 'builder') { f.c.adult = false; f.c.student = true; }
    const before = state(f); f.toolbar.focus(); f.G.ui.renderInfo();
    assert.equal(f.doc.activeElement, f.toolbar); assert(!pending(f, 'fire-rebuild'), change);
    confirm(f, 'fire-rebuild'); assert.equal(state(f), before, change); assert.equal(f.home.type, 'burntruins', change);
  }
});

test('rebuild ticks preserve focused confirmation and current full quote', () => {
  const f = ruins(); begin(f, 'fire-rebuild'); const consent = control(f, 'confirm', 'fire-rebuild'), writes = f.info.htmlWrites;
  f.G.game.h += .25; f.G.ui.renderInfo();
  assert.equal(control(f, 'confirm', 'fire-rebuild'), consent); assert.equal(f.doc.activeElement, consent);
  assert(pending(f, 'fire-rebuild')); assert.equal(f.info.htmlWrites, writes);
});

test('rebuild rejects hidden, removed, replaced, modal and wrong-world controls', () => {
  for (const change of ['world', 'game', 'selection', 'entity', 'type', 'state', 'element', 'panel', 'node', 'cleared', 'hidden', 'removed', 'modal']) {
    const f = ruins(); begin(f, 'fire-rebuild'); const stale = control(f, 'confirm', 'fire-rebuild');
    if (change === 'world') f.G.world = { ...f.G.world };
    if (change === 'game') f.G.game = { ...f.G.game };
    if (change === 'selection') f.G.sel = { kind: 'b', id: f.hall.id };
    if (change === 'entity') f.G.world.bmap[f.home.id] = { ...f.home };
    if (change === 'type') f.home.type = 'house';
    if (change === 'state') f.home.state = 'site';
    if (change === 'element') f.G.ui.el.info = f.mount('other-info');
    if (change === 'panel') f.G.ui.renderInfo(true);
    if (change === 'node') f.info.querySelector('[data-fire-rebuild-confirm]').innerHTML = '<button id="fire-rebuild-confirm">replacement</button>';
    if (change === 'cleared') f.info.querySelector('[data-fire-rebuild-panel]').innerHTML = '';
    if (change === 'hidden') f.info.classList.add('hidden');
    if (change === 'removed') delete f.G.world.bmap[f.home.id];
    if (change === 'modal') f.G.hasOpenModal = () => true;
    const before = state(f); stale.click(); assert.equal(state(f), before, change);
  }
});

test('clearing actual burned ruins refunds zero and cannot be followed by stale reconstruction', () => {
  const f = ruins(), before = { ...f.G.game.res }; begin(f, 'fire-rebuild'); const stale = control(f, 'confirm', 'fire-rebuild');
  f.info.querySelector('#info-demolish').click();
  assert.equal(f.G.world.bmap[f.home.id], undefined); assert.deepEqual({ ...f.G.game.res }, before);
  const after = state(f); stale.click(); assert.equal(state(f), after);
});

test('core-side changed rebuild quote is reported instead of silently using a newer price', () => {
  const f = ruins(), rebuild = f.G.rebuildBurntHome;
  f.G.rebuildBurntHome = (b, key, game) => { f.G.game.res.wood = 0; return rebuild(b, key, game); };
  begin(f, 'fire-rebuild'); confirm(f, 'fire-rebuild'); assert.equal(f.home.type, 'burntruins'); assert(!pending(f, 'fire-rebuild'));
  assert.match(f.info.querySelector('[data-fire-rebuild-message]').textContent, /改变|变化/);
  assert.equal(f.doc.activeElement, control(f, 'start', 'fire-rebuild'));
});

function reload(f, saved) {
  f.mount('over'); f.G.T2S = () => [0, 0]; f.G.cam = { x: 0, y: 0, z: 1 }; f.G.groundDirty = new Set();
  f.G.applySaveData(saved);
}

test('actual legacy save loads default-off while stale toggle callbacks cannot change the new world', () => {
  const f = setup(); begin(f); const stale = control(f, 'confirm'), oldHall = f.hall, saved = JSON.parse(state(f));
  delete saved.game.fireDisasters; reload(f, saved);
  assert.equal(f.G.fireRulesSummary().enabled, false); assert.notEqual(f.G.world.bmap[oldHall.id], oldHall);
  const before = state(f); stale.click(); assert.equal(state(f), before);
  f.hall = f.G.world.bmap[oldHall.id]; f.select(f.hall); assert(!pending(f)); begin(f); confirm(f);
  assert.equal(f.G.fireRulesSummary().enabled, true);
});

test('same-ID active-fire save reload preserves incident and rejects old disable consent', () => {
  const f = setup(); setFires(f, true); ignite(f); f.G.advanceHousingFires(15); f.G.ui.renderInfo(); begin(f);
  const stale = control(f, 'confirm'), homeId = f.home.id, hallId = f.hall.id, saved = JSON.parse(state(f));
  reload(f, saved); const restored = f.G.world.bmap[homeId], before = state(f);
  stale.click(); assert.equal(state(f), before); assert.equal(f.G.fireRulesSummary().enabled, true);
  assert.equal(f.G.houseFireSummary(restored).elapsed, 15); assert.equal(f.G.houseFireSummary(restored).waterNeeded, 3);
  f.select(restored); assert.match(live(f, 'status', 'home-fire'), /火焰/);
  f.hall = f.G.world.bmap[hallId]; f.select(f.hall); begin(f); confirm(f);
  assert.equal(f.G.fireRulesSummary().enabled, false); assert.equal(f.G.houseFireSummary(restored).active, true);
});

test('same-ID ruin reload requires fresh reconstruction consent and pays once', () => {
  const f = ruins('stonehouse'); setFires(f, true); begin(f, 'fire-rebuild');
  const old = f.home, stale = control(f, 'confirm', 'fire-rebuild'), saved = JSON.parse(state(f)); reload(f, saved);
  const restored = f.G.world.bmap[old.id], before = state(f); stale.click(); assert.equal(state(f), before);
  assert.equal(old.type, 'burntruins'); assert.equal(restored.type, 'burntruins');
  f.home = restored; f.select(restored); begin(f, 'fire-rebuild'); confirm(f, 'fire-rebuild');
  assert.equal(restored.type, 'stonehouse'); assert.equal(restored.state, 'site');
});

test('rules tuning changes revoke existing consent and show adapted timing', () => {
  const f = setup(); begin(f); f.G.FIRE.warningHours = 10;
  const before = state(f); f.G.ui.renderInfo(); assert(!pending(f)); confirm(f); assert.equal(state(f), before);
  assert.match(live(f, 'risk'), /10 小时烟雾预警/);
});

test('rebuild site pause, progress and cancellation keep existing construction refunds accurate', () => {
  const f = ruins(), before = { ...f.G.game.res }, cost = f.G.BDEF.house.cost;
  begin(f, 'fire-rebuild'); confirm(f, 'fire-rebuild');
  f.info.querySelector('#construction-pause').click(); assert(f.home.sitePaused);
  f.info.querySelector('#construction-resume').click(); assert(!f.home.sitePaused);
  const refund = f.info.querySelector('[data-info-refund]'); assert.match(refund.textContent, /当前可立即返还：0 材料/);
  assert.doesNotMatch(refund.textContent, /旧屋回收/); assert.equal(f.info.querySelectorAll('[data-info-refund]').length, 1);
  workUntil(f,()=>f.home.progress>=.5);
  f.info.querySelector('#info-close').focus(); f.G.ui.renderInfo(); assert.match(refund.textContent, /建材按一半回收/);
  assert.match(f.info.querySelector('[data-site-status]').textContent, /建造中 [5-9][0-9]%/);
  f.info.querySelector('#info-demolish').click(); assert.equal(f.G.world.bmap[f.home.id], undefined);
  for (const [key, n] of Object.entries(cost)) assert.equal(f.G.game.res[key], before[key] - n / 2);
});

test('finishing a rebuilt home returns housing details and makes prior cancel/pause callbacks inert', () => {
  const f = ruins('stonehouse'); begin(f, 'fire-rebuild'); confirm(f, 'fire-rebuild');
  const cancel = f.info.querySelector('#info-demolish'), pause = f.info.querySelector('#construction-pause'); pause.focus();
  workUntil(f,()=>f.home.state==='ok'); f.G.ui.renderInfo();
  assert.equal(f.home.state, 'ok'); assert.equal(f.home.type, 'stonehouse'); assert(f.info.querySelector('[data-home-residents]'));
  assert.equal(f.info.querySelector('[data-home-fire-panel]'), null); assert.equal(f.info.querySelector('#construction-pause'), null);
  assert.equal(f.doc.activeElement, f.info.querySelector('#info-close'));
  const before = state(f); cancel.click(); pause.click(); assert.equal(state(f), before);
});

test('existing immigration decisions stay usable without replacing pending fire controls', () => {
  const f = setup(), G = f.G;
  G.game.nomads.offer = { id: 88, hallId: f.hall.id, expiresDay: 12,
    families: [{ fatherAge: 28, motherAge: 27, childAges: [4] }], sickCount: 0 };
  G.ui.renderInfo(); const accept = f.info.querySelector('#townhall-accept'); assert(accept);
  begin(f); const consent = control(f, 'confirm'), firePanel = f.info.querySelector('[data-fire-rules-panel]');
  const rules = firePanel.querySelector('details'); rules.open = true;
  accept.click(); assert.equal(G.game.nomads.offer, null); assert.equal(G.world.citizens.filter(G.isArriving).length, 3);
  assert.equal(f.info.querySelector('[data-fire-rules-panel]'), firePanel); assert.equal(control(f, 'confirm'), consent);
  assert.equal(rules.open, true); assert(pending(f)); confirm(f); assert.equal(G.fireRulesSummary().enabled, true);
});

test('resident details expose actual missing-water rescue reason rather than generic work status', () => {
  const f = setup(); ignite(f);
  assert(f.G.fireTaskOf(f.c)); assert.match(f.G.fireRescueState(f.c), /没有可达水井或河岸/);
  f.G.sel = { kind: 'c', id: f.c.id }; f.G.ui.showInfo();
  assert.match(f.info.querySelector('[data-citizen-status]').textContent, /没有可达水井或河岸/);
});

console.log(`Housing fire UI: ${passed} DOM/live-simulation suites passed (not browser/mobile acceptance).`);
