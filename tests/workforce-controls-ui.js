/* Guarded workforce controls exercise real simulation APIs; this is DOM QA, not browser/mobile acceptance. */
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
const input = (f, id) => f.info.querySelector('#' + id);
const live = (f, key) => f.info.querySelector(`[data-workforce="${key}"]`).textContent;
function setup(type = 'stonequarry', options = {}) {
  const f = fixture();
  f.building('storage');
  f.b = f.building(type, options);
  f.G.game.res.food = f.G.game.res.grain = 500;
  f.select(f.b);
  return f;
}
function apply(f, value) {
  const field = input(f, 'worker-limit-input');
  field.focus(); field.value = value;
  input(f, 'worker-limit-form').emit('submit');
}
function worker(f, b = f.b) {
  const c = f.G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm' });
  f.G.assignWorker(b, c);
  assert.equal(c.job, b.id, 'fixture must obtain a real job');
  return c;
}
function until(f, c, condition, max = 3000) {
  for (let i = 0; i < max && !condition(); i++) f.G.stepCitizen(c, .1);
  assert(condition(), 'real citizen did not reach the expected stage');
}

test('rules are opt-in native disclosure after controls while current facts stay visible', () => {
  for (const options of [{}, { state: 'site', progress: .5, workLeft: 10, totalWork: 20, constructionStarted: true }]) {
    const f = setup('woodcutter', options), panel = f.info.querySelector('[data-workforce-panel]');
    const rule = panel.querySelector('[data-workforce="rule"]'), help = rule.parentNode;
    assert.equal(help.tagName, 'DETAILS');
    assert.equal(help.getAttribute('open'), null, 'help defaults closed');
    const summary = help.children[0];
    assert.equal(summary.tagName, 'SUMMARY'); assert.equal(summary.textContent, '用工说明');
    assert.equal(summary.getAttribute('tabindex'), null, 'native keyboard focus is not suppressed');
    assert.equal(summary.getAttribute('role'), null, 'keep native disclosure semantics');
    for (const key of ['current', 'limit', 'reason']) {
      const fact = panel.querySelector(`[data-workforce="${key}"]`);
      assert.equal(fact.parentNode, panel, key + ' must stay outside the collapsed disclosure');
    }
    const action = options.state === 'site' ? panel.querySelector('[data-workforce-site-action]') : input(f, 'worker-limit-form');
    assert.equal(action.parentNode, panel);
    assert(panel.children.indexOf(action) < panel.children.indexOf(help), 'controls precede optional explanation');
    assert.equal(rule.textContent, f.G.workforceSummary(f.b).rule, 'no simulation rule text is discarded');
    if (!options.state) assert.equal(input(f, 'worker-limit-note').textContent, '0 停接新工作；点击应用后生效。');
  }
});

test('opening help and keyboard focus survive live updates without hiding actual blockers', () => {
  const f = setup('woodcutter'), rule = f.info.querySelector('[data-workforce="rule"]'), help = rule.parentNode;
  help.setAttribute('open', '');
  const summary = help.children[0]; summary.focus();
  f.G.game.res.wood = 0; f.G.ui.renderInfo();
  assert.equal(f.info.querySelector('[data-workforce="rule"]').parentNode, help);
  assert.equal(help.getAttribute('open'), ''); assert.equal(f.doc.activeElement, summary);
  assert.match(live(f, 'reason'), /木|原料|材料/);
  assert.equal(f.info.querySelector('[data-workforce="reason"]').parentNode, help.parentNode);
  const field = input(f, 'worker-limit-input'); field.focus(); field.value = '0';
  f.G.ui.renderInfo();
  assert.equal(field.value, '0'); assert.equal(f.doc.activeElement, field);
  assert.equal(f.G.workerLimitOf(f.b), f.G.BDEF.woodcutter.jobs, 'editing is not applying');
});

test('completed jobs expose default, zero, restoration and integer bounds through real APIs', () => {
  const f = setup(), max = f.G.BDEF[f.b.type].jobs;
  assert.equal(f.G.workerLimitOf(f.b), max);
  assert.equal(input(f, 'worker-limit-input').getAttribute('max'), String(max));
  assert.match(live(f, 'limit'), new RegExp(`已应用上限 ${max} 人 · 原最大 ${max} 人`));
  apply(f, '0'); assert.equal(f.G.workerLimitOf(f.b), 0);
  assert.match(live(f, 'limit'), /已应用上限 0 人/);
  assert.match(f.info.querySelector('[data-workforce-message]').textContent, /停止接新工作/);
  for (const bad of ['', ' ', '-1', String(max + 1), '0.5', 'bad', 'Infinity']) {
    apply(f, bad); assert.equal(f.G.workerLimitOf(f.b), 0, String(bad));
    assert.match(f.info.querySelector('[data-workforce-message]').textContent, /整数/);
  }
  apply(f, String(max)); assert.equal(f.G.workerLimitOf(f.b), max);
});

test('housing and storage show a read-only town overview without inventing worker controls', () => {
  for (const type of ['house', 'storage', 'townhall']) {
    const f = setup(type);
    assert.equal(input(f, 'worker-limit-input'), null);
    assert.equal(input(f, 'construction-pause'), null);
    assert.match(live(f, 'current'), /无需安排工人/);
    assert.match(live(f, 'available'), /可再派工/);
  }
});

test('unapplied input and focus survive live refreshes, focus elsewhere, and a forced rebuild', () => {
  const f = setup('forester', { doCut: false, doPlant: true }), field = input(f, 'worker-limit-input');
  const max = f.G.workerLimitOf(f.b), writes = f.info.htmlWrites;
  field.focus(); field.value = '0';
  f.G.ui.renderInfo();
  assert.equal(input(f, 'worker-limit-input'), field);
  assert.equal(f.doc.activeElement, field);
  assert.equal(f.info.htmlWrites, writes);
  assert.equal(f.G.workerLimitOf(f.b), max);
  f.toolbar.focus(); f.G.ui.renderInfo();
  assert.equal(input(f, 'worker-limit-input').value, '0');
  assert.equal(f.G.workerLimitOf(f.b), max);
  input(f, 'worker-limit-input').focus(); f.G.ui.renderInfo(true);
  assert.equal(f.doc.activeElement, input(f, 'worker-limit-input'));
  assert.equal(input(f, 'worker-limit-input').value, '0');
  assert.equal(f.G.workerLimitOf(f.b), max);
});

test('all existing special panels refresh workforce before returning without replacing focused input', () => {
  for (const type of ['townhall', 'tavern', 'tailor', 'farm', 'school', 'tradingpost', 'pasture', 'orchard', 'hospital', 'herbalist', 'mine', 'stonequarry', 'blacksmith', 'woodcutter']) {
    const f = setup(type), field = input(f, 'worker-limit-input') || input(f, 'info-close');
    field.focus(); if (field.id === 'worker-limit-input') field.value = '0';
    const writes = f.info.htmlWrites;
    f.G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm' });
    f.G.ui.renderInfo();
    assert.equal(f.info.htmlWrites, writes, type);
    assert.equal(f.doc.activeElement, field, type);
    assert.match(live(f, 'population'), /成人 1 人/, type);
    assert.match(live(f, 'available'), /可再派工 1 人/, type);
    if (field.id === 'worker-limit-input') assert.equal(field.value, '0', type);
  }
});

test('lowering to zero reports a real committed batch as occupied until it finishes', () => {
  const f = setup(), c = worker(f), before = f.G.game.res.stone;
  assert(c.task, 'real quarry task must exist');
  apply(f, '0');
  assert.equal(c.job, f.b.id);
  assert.match(live(f, 'current'), /当前占岗 1 人 · 其中收尾 1 人/);
  assert.match(live(f, 'assigned'), /已分配 1 人 · 其中收尾 1 人/);
  assert.match(live(f, 'available'), /可再派工 0 人/);
  const field = input(f, 'worker-limit-input'); field.value = '1';
  const saved = JSON.stringify(f.G.serializeGame());
  f.G.ui.renderInfo(); f.G.ui.renderInfo();
  assert.equal(JSON.stringify(f.G.serializeGame()), saved, 'facts-only refresh must not mutate save state');
  assert.equal(field.value, '1');
  until(f, c, () => c.job === null && !c.carry);
  f.G.ui.renderInfo();
  assert(f.G.game.res.stone > before);
  assert.match(live(f, 'current'), /当前占岗 0 人 · 其中收尾 0 人/);
  assert.match(live(f, 'assigned'), /已分配 0 人 · 其中收尾 0 人/);
  assert.match(live(f, 'available'), /可再派工 1 人/);
  assert.equal(f.G.workerLimitOf(f.b), 0);
  assert.equal(field.value, '1');
  const after = f.G.game.res.stone;
  for (let i = 0; i < 40; i++) { f.G.scheduleJobs(); f.G.stepCitizen(c, .1); }
  assert.equal(c.job, null); assert.equal(f.G.game.res.stone, after);
});

test('warehouse-blocked finishing and jobless cargo are not advertised as available labor', () => {
  const f = setup(), c = worker(f);
  apply(f, '0'); f.G.game.res.stone = f.G.storageCap();
  until(f, c, () => c.state === 'waitStorage' && c.carry);
  f.G.ui.renderInfo();
  assert.match(live(f, 'available'), /可再派工 0 人/);
  const s = f.G.workforceSummary(f.b);
  assert.equal(s.global.available, 0);
  assert(s.draining > 0 || s.global.hauling > 0, 'held output must remain visible');
  assert.match(live(f, 'reason'), /仓|收尾|送/);
  const qty = c.carry.qty; f.G.game.res.stone -= qty;
  f.G.startHaul(c); until(f, c, () => !c.carry && c.job === null);
  f.G.ui.renderInfo(); assert.match(live(f, 'available'), /可再派工 1 人/);
});

test('overview separates students, committed staff, jobless cargo and genuinely free adults', () => {
  const f = setup('school'); worker(f);
  const student = f.G.spawnCitizen({ x: 1, y: 1, age: 10, adult: false, sex: 'f' });
  f.G.advanceEducation(student, f.G.schoolCounts()); assert.equal(student.student, true);
  f.G.spawnCitizen({ x: 1, y: 1, age: 5, sex: 'm' });
  f.G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm', arrivalHallId: 999 });
  const hauler = f.G.spawnCitizen({ x: 30, y: 30, age: 30, sex: 'f' });
  hauler.carry = { type: 'stone', qty: 3 }; f.G.startHaul(hauler);
  f.G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm' });
  f.G.ui.renderInfo();
  assert.match(live(f, 'population'), /成人 3 人 · 学生 1 人/);
  assert.match(live(f, 'assigned'), /已分配 1 人 · 其中收尾 0 人/);
  assert.match(live(f, 'available'), /可再派工 1 人 · 无岗带货 1 人/);
  until(f, hauler, () => !hauler.carry); f.G.ui.renderInfo();
  assert.match(live(f, 'available'), /可再派工 2 人 · 无岗带货 0 人/);
});

test('lack of people, materials and storage appear as current reasons', () => {
  const f = setup('woodcutter');
  f.G.game.res.wood = 20; f.G.ui.renderInfo();
  assert.match(live(f, 'reason'), /工人|人手|派工|缺人|成人不足/);
  f.G.game.res.wood = 0; f.G.ui.renderInfo();
  assert.match(live(f, 'reason'), /木|原料|材料/);
  const q = setup(); q.G.game.res.stone = q.G.storageCap(); q.G.ui.renderInfo();
  assert.match(live(q, 'reason'), /仓|已满/);
});

test('teacher service stops immediately and restoring the limit does not promise staffing', () => {
  const f = setup('school'), c = worker(f);
  until(f, c, () => f.G.schoolTeacherPresent(f.b));
  assert.equal(f.G.schoolTeachers(f.b).length, 1);
  apply(f, 0);
  assert.equal(f.G.schoolTeacherPresent(f.b), false);
  assert.equal(c.job, null);
  assert.match(live(f, 'current'), /当前占岗 0 人 · 其中收尾 0 人/);
  apply(f, 1);
  assert.equal(f.G.workerLimitOf(f.b), 1);
  assert.match(f.info.querySelector('[data-workforce-message]').textContent, /等待派工/);
  f.G.scheduleJobs(); f.G.ui.renderInfo();
  assert.equal(c.job, f.b.id);
});

test('site pause preserves paid materials and completed work, cancels one unfinished segment, and resumes once', () => {
  const f = setup('house', { state: 'site', progress: .25, totalWork: 90, workLeft: 67.5, constructionStarted: true, paidCost: { wood: 16, stone: 8 } });
  const c = worker(f), paid = JSON.stringify(f.b.paidCost), res = JSON.stringify(f.G.game.res), left = f.b.workLeft;
  assert.equal(c.task.kind, 'build');
  until(f, c, () => c.state === 'work'); f.G.stepCitizen(c, .1);
  assert(c.task.workLeft > 0 && c.task.workLeft < c.task.work, 'pause interrupts an actual partially worked segment');
  assert.equal(input(f, 'worker-limit-input'), null);
  const pause = input(f, 'construction-pause'); pause.click();
  assert.equal(f.G.workforceSummary(f.b).paused, true);
  assert.equal(c.task, null); assert.equal(c.job, null);
  assert.equal(f.b.workLeft, left); assert.equal(f.b.progress, .25);
  assert.equal(JSON.stringify(f.b.paidCost), paid); assert.equal(JSON.stringify(f.G.game.res), res);
  assert.match(live(f, 'limit'), /已应用上限 0 人 · 原最大 4 人/);
  assert.match(f.info.textContent, /已完成工段|已完成.*保留/);
  const resume = input(f, 'construction-resume');
  assert.equal(input(f, 'construction-pause'), pause); assert(pause.disabled); assert(!resume.disabled);
  assert.equal(f.doc.activeElement, resume);
  pause.click(); assert.equal(f.G.workforceSummary(f.b).paused, true, 'stale second click cannot resume');
  resume.emit('click', { detail: 2 }); assert.equal(f.G.workforceSummary(f.b).paused, true, 'native double-click second event cannot resume');
  resume.click(); assert.equal(f.G.workforceSummary(f.b).paused, false);
  assert.equal(JSON.stringify(f.G.game.res), res);
  assert(resume.disabled); assert(!pause.disabled);
  assert.equal(f.doc.activeElement, pause);
  assert.match(live(f, 'limit'), /已应用上限 4 人/);
  f.G.scheduleJobs(); assert.equal(c.job, f.b.id);
  assert.equal(f.b.workLeft, left); assert.equal(JSON.stringify(f.G.game.res), res);
});

test('repeated worker form submission is idempotent and never releases or duplicates committed output early', () => {
  const f = setup(), c = worker(f);
  apply(f, 0); const job = c.job, task = c.task, carry = c.carry;
  const form = input(f, 'worker-limit-form'); form.emit('submit'); form.emit('submit');
  assert.equal(c.job, job); assert.equal(c.task, task); assert.equal(c.carry, carry);
  assert.equal(f.G.workforceSummary(f.b).draining, 1);
  assert.equal(f.b.workers.length, 1);
});

test('stale controls reject selection, DOM, panel, world, game, entity, hidden and modal changes', () => {
  for (const site of [false, true]) for (const mode of ['selection', 'dom', 'panel', 'world', 'game', 'entity', 'hidden', 'modal', 'dismiss']) {
    const f = setup(site ? 'house' : 'stonequarry', site ? { state: 'site', progress: 0, workLeft: 90, totalWork: 90 } : {});
    const old = input(f, site ? 'construction-pause' : 'worker-limit-form');
    if (!site) input(f, 'worker-limit-input').value = '0';
    let replacement;
    if (mode === 'selection') f.select(f.building(site ? 'house' : 'stonequarry', site ? { state: 'site' } : {}));
    if (mode === 'dom') { f.G.ui._infoSelection = null; f.G.ui.renderInfo(true); }
    if (mode === 'panel') f.G.ui.el.info = f.mount('new-info');
    if (mode === 'world') { replacement = { ...f.b }; f.G.world = { ...f.G.world, bmap: { [f.b.id]: replacement }, buildings: [replacement] }; }
    if (mode === 'game') f.G.game = f.G.newGameState();
    if (mode === 'entity') { replacement = { ...f.b }; f.G.world.bmap[f.b.id] = replacement; }
    if (mode === 'hidden') f.info.classList.add('hidden');
    if (mode === 'modal') f.G.hasOpenModal = () => true;
    if (mode === 'dismiss') { f.G.ui.hideInfo(); f.select(f.b); }
    const before = JSON.stringify(f.G.serializeGame());
    if (site) old.emit('click'); else old.emit('submit');
    assert.equal(JSON.stringify(f.G.serializeGame()), before, `${site ? 'site' : 'worker'} ${mode}`);
    if (!site) assert.equal(f.G.workerLimitOf(replacement || f.b), f.G.BDEF[f.b.type].jobs, mode);
    else assert.equal(f.G.workforceSummary(replacement || f.b).paused, false, mode);
  }
});

test('a real same-id save reload leaves old draft and pause callbacks unable to alter restored entities', () => {
  for (const site of [false, true]) {
    const f = setup(site ? 'house' : 'stonequarry', site ? { state: 'site', progress: 0, workLeft: 90, totalWork: 90 } : {});
    f.mount('over');
    const old = input(f, site ? 'construction-pause' : 'worker-limit-form');
    if (!site) input(f, 'worker-limit-input').value = '0';
    const snapshot = JSON.parse(JSON.stringify(f.G.serializeGame()));
    f.G.applySaveData(snapshot);
    const restored = f.G.world.bmap[f.b.id]; assert(restored); assert.notEqual(restored, f.b);
    f.select(restored);
    const before = JSON.stringify(f.G.serializeGame());
    if (site) old.emit('click'); else old.emit('submit');
    assert.equal(JSON.stringify(f.G.serializeGame()), before);
    if (site) assert.equal(f.G.workforceSummary(restored).paused, false);
    else assert.equal(input(f, 'worker-limit-input').value, String(f.G.BDEF[f.b.type].jobs));
  }
});

test('site completion replaces focused pause with safe close and makes its old callback inert', () => {
  for (const update of ['timer', 'callback']) for (const wasPaused of [false, true]) {
    const f = setup('woodcutter', { state: 'site', progress: .5, workLeft: 10, totalWork: 20, constructionStarted: true });
    if (wasPaused) input(f, 'construction-pause').click();
    const old = input(f, wasPaused ? 'construction-resume' : 'construction-pause'); old.focus();
    if(wasPaused)f.G.setConstructionPaused(f.b,false);
    const c=worker(f);until(f,c,()=>f.b.state==='ok');
    assert.equal(f.b.state, 'ok');
    if (update === 'timer') f.G.ui.renderInfo(); else old.click();
    assert.equal(f.doc.activeElement, input(f, 'info-close'), update);
    assert.equal(input(f, 'construction-pause'), null);
    assert.equal(input(f, 'construction-resume'), null);
    assert(input(f, 'worker-limit-input'));
    old.emit('click');
    assert.equal(f.G.workerLimitOf(f.b), f.G.BDEF[f.b.type].jobs);
    assert.equal(f.G.world.bmap[f.b.id], f.b);
  }
});

console.log(`Workforce UI: ${passed} DOM/live-simulation suites passed (not browser/mobile).`);
