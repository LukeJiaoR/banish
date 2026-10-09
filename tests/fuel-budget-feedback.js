/* Fuel budget feedback: read-only estimates, real control handlers, and simulation
 * boundaries. Run: node tests/fuel-budget-feedback.js [checkout]
 * The small DOM fixture checks text/focus/identity contracts, not browser layout,
 * native keyboard activation, screenshots, or visual acceptance.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

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
        .filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value])),
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
          const data = selector.match(/^\[data-([^=]+)="([^"]*)"\]$/);
          return data ? child.dataset[data[1]] === data[2] : child.tagName === selector.toUpperCase();
        });
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      focus() { doc.activeElement = this; },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      click() { this.focus(); for (const fn of handlers.click || []) fn({ target: this }); },
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
            const a = Object.fromEntries(Array.from(token[3].matchAll(/([\w-]+)="([^"]*)"/g), match => [match[1], decode(match[2])]));
            const child = stack[stack.length - 1].appendChild(element(token[2], a));
            if (!['img', 'br', 'input'].includes(token[2])) stack.push(child);
          }
        }
      },
    };
  }
  function mount(id) { const el = element('div', { id }); roots.push(el); return el; }
  const ctx = { console, document: doc, __errs: [], setTimeout() {} };
  ctx.window = ctx; vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'ui'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  const info = mount('info'), guide = mount('guide');
  G.ui.el = { info, guide, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
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
  return { G, doc, info, guide, building, resident, homes, select, node, button };
}
function state(G) {
  return JSON.stringify({ game: G.game, world: G.world, sel: G.sel,
    marked: Array.from(G.world.marked), markedRocks: Array.from(G.world.markedRocks) });
}
function assertSharedText(f) {
  f.G.ui.refreshHUD(); f.G.ui.renderInfo();
  const text = f.G.ui.heatDemandText(f.G.ui.heatDemand());
  assert.ok(f.doc.getElementById('res-firewood').title.includes(text));
  assert.equal(f.node('heat').textContent, text);
  const heat = f.G.ui.heatDemand(), need = heat.winter ? heat.futureWinter : heat.fullWinter;
  if (f.G.game.season >= 2 && f.G.game.res.firewood < need)
    assert.ok(f.guide.textContent.includes(`${heat.winter ? '本冬此后' : '整冬'}约需 ${Math.ceil(need)}`));
}
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

test('autumn 100 stock / 100 target is explicitly short of four occupied homes demand 120', () => {
  const f = fixture(), { G } = f; f.homes(); const b = f.building('woodcutter');
  G.game.day = 24; G.game.season = 2; G.game.res.firewood = 100; G.game.res.wood = 20;
  f.select(b); assertSharedText(f);
  assert.match(f.node('target').textContent, /本屋燃料目标：100/);
  assert.match(f.node('stock').textContent, /全镇库存：柴火 100 · 原木 20/);
  assert.match(f.node('heat').textContent, /整冬约需 120/);
  assert.match(f.node('status').textContent, /本屋暂停新批次.*本屋目标/);
  assert.match(f.node('gap').textContent, /整冬取暖估算少约 20/);
  assert.match(f.guide.textContent, /柴火不足.*整冬约需 120/);
  assert.doesNotMatch(f.guide.textContent, /本冬此后/);
  const plus = f.button(G.PROD.woodcutter.fuelStep), before = state(G);
  plus.click(); assert.equal(b.fuelLimit, 150);
  assert.match(f.node('target').textContent, /150/); assert.match(f.node('heat').textContent, /120/);
  assert.match(f.node('status').textContent, /等待可用工人/);
  assert.equal(f.button(G.PROD.woodcutter.fuelStep), plus);
  assert.equal(G.game.res.wood, 20); assert.equal(G.game.res.firewood, 100);
  assert.notEqual(state(G), before, 'only the authorized target control changes building state');
});

test('recorded day 192 / wood 20 / fuel 104 / target 150 retains independent figures', () => {
  const f = fixture(), { G } = f; f.homes(); const b = f.building('woodcutter', { fuelLimit: 150 });
  Object.assign(G.game, { day: 192, season: 0, year: 5 }); Object.assign(G.game.res, { wood: 20, firewood: 104 });
  f.select(b); assertSharedText(f);
  assert.match(f.node('target').textContent, /150/); assert.match(f.node('stock').textContent, /柴火 104 · 原木 20/);
  assert.match(f.node('heat').textContent, /120/); assert.match(f.node('gap').textContent, /少约 16/);
  assert.doesNotMatch(f.node('status').textContent, /已达/);
  assert.match(f.info.innerHTML, /不会预留建材/); assert.match(f.info.innerHTML, /已接批次仍可能耗木/);
});

test('empty homes and sites are excluded; stone homes and boarding are charged per occupied building', () => {
  const f = fixture(), { G } = f;
  const cutter = f.building('woodcutter'); f.building('house'); f.building('stonehouse'); f.building('boarding');
  f.resident(f.building('house', { state: 'site', progress: 0 }));
  f.resident(f.building('stonehouse', { state: 'site', progress: 0 }));
  f.resident(f.building('boarding', { state: 'site', progress: 0 }));
  assert.equal(G.ui.heatDemand().fullWinter, 0);
  f.select(cutter); assertSharedText(f); assert.match(f.node('heat').textContent, /整冬约需 0/);
  f.resident(f.building('house')); f.resident(f.building('stonehouse'));
  const boarding = f.building('boarding'); f.resident(boarding); f.resident(boarding);
  assert.equal(boarding.family, null, 'boarding occupancy uses family.houseId');
  const expected = G.BDEF.house.warmWoodPerYear + G.BDEF.stonehouse.warmWoodPerYear + G.BDEF.boarding.warmWoodPerYear;
  assert.equal(G.ui.heatDemand().fullWinter, expected); assert.equal(expected, 120);
  assertSharedText(f); assert.match(f.node('heat').textContent, /120/);
  G.world.families = G.world.families.filter(family => family.houseId !== boarding.id);
  assert.equal(G.ui.heatDemand().fullWinter, 45);
});

test('winter day 36 excludes the first charge, day 47 has zero future charges, next year uses full budget', () => {
  const f = fixture(), { G } = f; f.homes(); const cutter = f.building('woodcutter'); f.select(cutter);
  Object.assign(G.game, { day: 35, season: 2, h: 12 }); G.game.res.food = 10000; G.game.res.firewood = 120;
  G.endDay(); assert.equal(G.game.day, 36); assert.equal(G.game.res.firewood, 110);
  assert.equal(G.ui.heatDemand().fullWinter, 120); assert.equal(G.ui.heatDemand().futureDays, 11);
  assert.equal(G.ui.heatDemand().futureWinter, 110); assertSharedText(f);
  assert.match(f.node('heat').textContent, /整冬约需 120.*本冬此后约需 110.*11 次扣除/);
  assert.doesNotMatch(f.guide.textContent, /柴火不足/);
  G.game.res.firewood = 109; assertSharedText(f); assert.match(f.guide.textContent, /柴火不足.*本冬此后约需 110/);
  G.game.res.firewood = 110;
  for (let day = 37; day <= 47; day++) G.endDay();
  assert.equal(G.game.day, 47); assert.equal(G.game.res.firewood, 0);
  assert.equal(G.ui.heatDemand().futureDays, 0); assert.equal(G.ui.heatDemand().futureWinter, 0);
  assertSharedText(f); assert.match(f.node('heat').textContent, /整冬约需 120.*本冬此后约需 0/);
  assert.doesNotMatch(f.guide.textContent, /柴火不足/); assert.doesNotMatch(f.info.textContent, /安全过冬|保证过冬/);
  G.endDay(); assert.equal(G.game.day, 48); assert.equal(G.ui.heatDemand().futureWinter, 120);
  assertSharedText(f); assert.doesNotMatch(f.node('heat').textContent, /本冬此后/);
});

test('fractional stone-home future heating stays exact in calculations and rounds up only for display', () => {
  const f = fixture(), { G } = f; f.resident(f.building('stonehouse'));
  Object.assign(G.game, { day: 36, season: 3 });
  assert.equal(G.ui.heatDemand().fullWinter, 15); assert.equal(G.ui.heatDemand().futureWinter, 13.75);
  assert.match(G.ui.heatDemandText(G.ui.heatDemand()), /本冬此后约需 14/);
  G.game.day = 46; assert.equal(G.ui.heatDemand().futureWinter, 1.25);
  assert.match(G.ui.heatDemandText(G.ui.heatDemand()), /本冬此后约需 2/);
  G.game.day = 47; assert.equal(G.ui.heatDemand().futureWinter, 0);
});

test('fractional sufficient stocks never trigger a rounded-budget shortage and pay every real future charge', () => {
  for (const [day, stock] of [[36, 13.75], [46, 1.25], [46, 1.75]]) {
    const f = fixture(), { G } = f; const home = f.building('stonehouse'); f.resident(home);
    const cutter = f.building('woodcutter'); f.select(cutter);
    // Enter the test day through real endDay charging, including its own 1.25.
    Object.assign(G.game, { day: day - 1, season: G.seasonOf(day - 1), h: 12 });
    G.game.res.food = 10000; G.game.res.firewood = stock + G.BDEF.stonehouse.warmWoodPerYear / G.SEASON_DAYS;
    G.endDay(); assert.equal(G.game.day, day); assert.equal(G.game.res.firewood, stock);
    const need = G.ui.heatDemand().futureWinter; assert.ok(stock >= need);
    assertSharedText(f); assert.doesNotMatch(f.guide.textContent, /柴火不足/); assert.doesNotMatch(f.node('gap').textContent, /少约/);
    while (G.game.day < 47) { G.endDay(); assert.equal(home.unheated, false); }
    assert.equal(G.game.res.firewood, stock - need);
  }
});

test('slightly insufficient fractional stocks warn using the raw gap and fail the final real charge', () => {
  for (const [day, stock, gap] of [[36, 13.5, 0.25], [36, 12.875, 0.875], [46, 1, 0.25], [46, 0.375, 0.875]]) {
    const f = fixture(), { G } = f; const home = f.building('stonehouse'); f.resident(home);
    const cutter = f.building('woodcutter'); f.select(cutter);
    Object.assign(G.game, { day: day - 1, season: G.seasonOf(day - 1), h: 12 });
    G.game.res.food = 10000; G.game.res.firewood = stock + G.BDEF.stonehouse.warmWoodPerYear / G.SEASON_DAYS;
    G.endDay(); assert.equal(G.game.res.firewood, stock);
    assert.equal(G.ui.heatDemand().futureWinter - stock, gap);
    assertSharedText(f); assert.match(f.guide.textContent, /柴火不足/); assert.match(f.node('gap').textContent, /少约 1/);
    while (G.game.day < 47) G.endDay();
    assert.equal(home.unheated, true); assert.equal(G.game.res.firewood, 0);
    assertSharedText(f); assert.doesNotMatch(f.guide.textContent, /柴火不足/);
  }
});

test('multiple cutters share town stocks but keep independent cutoffs and selection identity', () => {
  const f = fixture(), { G } = f; f.homes();
  const a = f.building('woodcutter', { fuelLimit: 100 }), b = f.building('woodcutter', { fuelLimit: 150 });
  G.game.res.firewood = 100; G.game.res.wood = 20; f.select(a);
  const oldPlus = f.button(50); oldPlus.focus(); const writes = f.info.htmlWrites;
  f.select(b); assert.equal(f.info.htmlWrites, writes + 1);
  assert.match(f.node('target').textContent, /150/); assert.match(f.node('status').textContent, /等待可用工人/);
  const before = state(G); oldPlus.click(); assert.equal(state(G), before, 'detached old control cannot change either cutter');
  f.button(-50).click(); assert.equal(b.fuelLimit, 100); assert.equal(a.fuelLimit, 100);
  f.button(-50).click(); assert.equal(b.fuelLimit, 50); assert.equal(a.fuelLimit, 100);
  G.game.res.firewood = 80; assert.equal(G.fuelLimited(a), false); assert.equal(G.fuelLimited(b), true);
  const worker = G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm', name: '工人' });
  assert.ok(G.makeTask(a, worker)); assert.equal(G.makeTask(b, worker), null);
  assert.match(f.info.innerHTML, /其他伐木屋按各自目标继续/);
});

test('control lowering clamps at zero and raising uses the actual definitions upper bound', () => {
  const f = fixture(), { G } = f, P = G.PROD.woodcutter; const b = f.building('woodcutter'); f.select(b);
  const minus = f.button(-P.fuelStep), plus = f.button(P.fuelStep);
  for (let i = 0; i < 5; i++) minus.click(); assert.equal(b.fuelLimit, 0); assert.equal(G.fuelLimited(b), true);
  b.fuelLimit = P.fuelMax - 1; G.ui.renderInfo(); plus.click(); plus.click();
  assert.equal(b.fuelLimit, P.fuelMax); assert.equal(f.button(P.fuelStep), plus);
  assert.match(f.node('target').textContent, new RegExp(String(P.fuelMax)));
  b.fuelLimit = '<img onerror=bad()>'; G.ui.renderInfo();
  assert.equal(f.node('target').textContent, `本屋燃料目标：${P.fuelLimit}`);
  assert.doesNotMatch(f.info.textContent, /onerror/);
});

test('lowering the target does not cancel existing or paused batches; accepted work still consumes wood at completion', () => {
  const f = fixture(), { G } = f; const b = f.building('woodcutter', { fuelLimit: 150 });
  const c = G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm', name: '工人' });
  c.job = b.id; b.workers.push(c.id); G.game.res.wood = 20; G.game.res.firewood = 104;
  const task = G.makeTask(b, c); assert.ok(task); assert.equal(task.phase, 'work'); c.task = task;
  const paused = { ...task }; c.pausedTask = paused;
  f.select(b); for (let i = 0; i < 4; i++) f.button(-G.PROD.woodcutter.fuelStep).click();
  assert.equal(b.fuelLimit, 0); assert.equal(c.task, task); assert.equal(c.pausedTask, paused);
  assert.equal(G.game.res.wood, 20); assert.equal(G.game.res.firewood, 104);
  G.completeTask(c);
  assert.equal(G.game.res.wood, 20 - G.PROD.woodcutter.logsIn);
  assert.equal(G.game.res.firewood, 104 + G.PROD.woodcutter.firewoodOut);
  assert.equal(c.task, null, 'no new batch is accepted above target'); assert.equal(c.pausedTask, paused);
});

test('repeated and focused refreshes update quantities/status/workers without replacing controls or mutating simulation', () => {
  const f = fixture(), { G } = f; f.homes(); const b = f.building('woodcutter');
  G.game.res.firewood = 100; G.game.res.wood = 20; f.select(b);
  const plus = f.button(50); plus.focus();
  const nodes = Object.fromEntries(['target', 'stock', 'heat', 'gap', 'status', 'workers', 'refund'].map(key => [key, f.node(key)]));
  const writes = f.info.htmlWrites, textWrites = Object.values(nodes).map(el => el.textWrites);
  let calls = 0; const random = G.makeRng(53), expectedRandom = G.makeRng(53);
  G.rng = () => { calls++; return random(); };
  const before = state(G);
  for (const name of ['makeTask', 'scheduleJobs', 'findPath']) G[name] = () => { throw new Error('display called ' + name); };
  for (let i = 0; i < 120; i++) { G.ui.tickInfo(0.5); G.ui.refreshHUD(); }
  assert.equal(state(G), before); assert.equal(calls, 0); assert.equal(random(), expectedRandom());
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, plus);
  assert.deepEqual(Object.values(nodes).map(el => el.textWrites), textWrites);
  G.game.res.firewood = 80; G.game.res.wood = 0; G.ui.tickInfo(0.5);
  assert.match(nodes.stock.textContent, /柴火 80 · 原木 0/); assert.match(nodes.status.textContent, /缺原木/);
  G.game.res.wood = 20; b.noWork = true; b.warnText = '柴火已达上限'; G.ui.tickInfo(0.5);
  assert.match(nodes.status.textContent, /等待可用工人/, 'stale simulation warning must not imply current cutoff');
  const worker = G.world.citizens[0]; worker.name = '<img onerror=bad()>'; b.workers.push(worker.id);
  f.resident(f.building('stonehouse')); G.ui.tickInfo(0.5);
  assert.match(nodes.heat.textContent, /135/); assert.match(nodes.status.textContent, /运作中/);
  assert.equal(nodes.workers.textContent, worker.name); assert.equal(nodes.workers.children.length, 0);
  assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, plus); assert.equal(f.button(50), plus);
  for (const [key, el] of Object.entries(nodes)) assert.equal(f.node(key), el);
});

test('focused selection changes, world replacement, deletion, close/reopen and site completion do not leave stale fuel panels', () => {
  const f = fixture(), { G } = f; const a = f.building('woodcutter'), house = f.building('house'); f.select(a);
  f.button(50).focus(); f.select(house); assert.equal(f.node('target'), null); assert.match(f.info.innerHTML, /木屋/);
  f.select(a); f.button(50).focus();
  const worker = G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm', name: '工人' });
  G.sel = { kind: 'c', id: worker.id }; G.ui.renderInfo(); assert.equal(f.node('target'), null);
  f.select(a); const oldPlus = f.button(50), oldWorld = G.world;
  const replacement = { ...a, fuelLimit: 300 }; G.world = { ...oldWorld, bmap: { ...oldWorld.bmap, [a.id]: replacement },
    buildings: oldWorld.buildings.map(b => b === a ? replacement : b) };
  oldPlus.focus(); G.ui.renderInfo(); assert.match(f.node('target').textContent, /300/);
  oldPlus.click(); assert.equal(replacement.fuelLimit, 300);
  G.ui.hideInfo(); assert.equal(G.sel, null); f.select(replacement); assert.match(f.node('target').textContent, /300/);
  f.button(50).focus(); delete G.world.bmap[a.id]; G.ui.renderInfo();
  assert.equal(G.sel, null); assert.equal(f.info.classList.contains('hidden'), true);
  const site = f.building('woodcutter', { state: 'site', progress: 0, totalWork: 60, workLeft: 60 }); f.select(site);
  assert.match(f.node('refund').textContent, /未开工.*全部/);
  f.button(50).focus(); site.constructionStarted = true; G.ui.renderInfo();
  assert.match(f.node('refund').textContent, /已开工.*一半/);
  site.progress = 0.75; G.ui.renderInfo(); assert.match(f.node('status').textContent, /75%/);
  site.state = 'ok'; G.ui.renderInfo(); assert.doesNotMatch(f.node('status').textContent, /建造中/);
  assert.match(f.info.innerHTML, /id="info-demolish" class="danger">拆除/);
});

test('descriptions explain inventory cutoff rather than asserting that target means enough fuel', () => {
  const { G } = fixture(); const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const text of [G.BDEF.woodcutter.desc, html]) {
    assert.doesNotMatch(text, /柴火够用时自动停工/);
    assert.match(text, /目标不代表过冬需求/); assert.match(text, /本屋停止接新批次/);
  }
});

console.log(`Fuel budget feedback: ${passed} passed, ${failed} failed (DOM fixtures and simulation contracts; no browser acceptance).`);
if (failed) process.exitCode = 1;
