/* Warm-coat DOM and live-simulation contracts, not browser visual acceptance. */
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
      value: attrs.value || '', tagName: tag.toUpperCase(), id: attrs.id || '', dataset: Object.fromEntries(Object.entries(attrs)
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

let passed = 0;
function test(name, fn) { fn(); console.log('ok ' + name); passed++; }
const live = (f, key) => f.info.querySelector(`[data-tailor="${key}"]`);
const clothing = (f, key) => f.info.querySelector(`[data-citizen-clothing="${key}"]`);
function tailor() {
  const f = fixture(), b = f.building('tailor'), { G } = f;
  f.building('storage'); G.game.h = 12;
  G.game.res.leather = 12; G.game.res.wool = 8; G.game.res.clothes = 2; G.game.res.warmCoats = 1;
  const c = G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm', name: '裁缝<甲>' });
  c.name = '裁缝<甲>'; c.job = b.id; b.workers = [c.id]; c.clothingLeft = 12;
  return { ...f, b, c };
}
function choose(f, recipe) {
  const select = f.doc.getElementById('coat-recipe');
  select.focus(); select.value = recipe; select.emit('change'); return select;
}
function selectCitizen(f, c = f.c) { f.G.sel = { kind: 'c', id: c.id }; f.G.ui.showInfo(); }

test('basic defaults show the legacy recipe, atomic consumption, stock split and truthful winter limits', () => {
  const f = tailor(); f.select(f.b);
  assert.equal(f.G.tailorRecipeOf(f.b), 'basic');
  assert.match(f.info.innerHTML, /value="basic" selected/);
  assert.match(live(f, 'recipe').textContent, /2 皮革或 2 羊毛（自动优先皮革）.*1 普通衣（受教育 2）.*8 小时/);
  assert.match(live(f, 'materials').textContent, /2 皮革.*到仓才整批领取/);
  assert.match(live(f, 'stock').textContent, /普通衣物 2.*暖衣 1.*在途未入库不计/);
  assert.match(f.info.textContent, /整批领取衣料并立即出库.*同批不再次扣料/);
  assert.match(f.info.textContent, /中断或读档退回未用衣料/);
  assert.match(f.info.textContent, /48 天.*日终磨损 1 天.*穿坏时先领暖衣/);
  assert.match(f.info.textContent, /旧衣剩余耐久保留/);
  assert.match(f.info.textContent, /降低 40%.*降低 70%.*比普通再减半/);
  assert.match(f.info.textContent, /衣物不改变无柴冷屋受冻或烧柴暖屋恢复/);
  assert.match(f.info.innerHTML, /裁缝&lt;甲&gt;/);
  assert.equal(f.doc.getElementById('coat-recipe').getAttribute('aria-describedby'), 'coat-recipe-note');
});

test('recipe changes use the real setter and keep the native selector and keyboard draft mounted', () => {
  const f = tailor(); f.select(f.b);
  const select = f.doc.getElementById('coat-recipe'), panel = f.info.querySelector('[data-tailor-panel]');
  const writes = f.info.htmlWrites, panelWrites = panel.htmlWrites;
  for (const value of ['warm', 'basic', 'warm']) {
    choose(f, value); assert.equal(f.G.tailorRecipeOf(f.b), value);
    assert.equal(f.doc.activeElement, select); assert.equal(f.doc.getElementById('coat-recipe'), select);
  }
  assert.match(live(f, 'recipe').textContent, /2 皮革 \+ 2 羊毛.*1 保暖外套（受教育 2）.*8 小时/);
  assert.match(live(f, 'production').textContent, /保暖外套/);
  select.value = 'basic'; f.G.game.res.wool = 3;
  for (let i = 0; i < 4; i++) f.G.ui.renderInfo();
  assert.equal(select.value, 'basic'); assert.equal(f.G.tailorRecipeOf(f.b), 'warm');
  assert.equal(f.info.htmlWrites, writes); assert.equal(panel.htmlWrites, panelWrites);
  assert.equal(f.doc.activeElement, select); assert.match(live(f, 'inputs').textContent, /羊毛 3/);
  f.doc.activeElement = null; f.G.ui.renderInfo(); assert.equal(select.value, 'warm');
});

test('real basic material choice changes with stock while warm shortages require both materials', () => {
  const f = tailor(); f.select(f.b); f.G.game.res.leather = 1; f.G.ui.renderInfo();
  assert.match(live(f, 'materials').textContent, /2 羊毛/); assert.match(live(f, 'status').textContent, /可制作/);
  choose(f, 'warm'); assert.match(live(f, 'status').textContent, /缺料/);
  f.G.game.res.leather = 2; f.G.game.res.wool = 1; f.G.ui.renderInfo();
  assert.match(live(f, 'status').textContent, /缺料/);
  f.G.game.res.wool = 2; f.G.ui.renderInfo(); assert.match(live(f, 'status').textContent, /可制作/);
  f.G.game.res.warmCoats = f.G.storageCap(); f.G.ui.renderInfo();
  assert.match(live(f, 'status').textContent, /保暖外套仓容已满/);
  choose(f, 'basic'); assert.match(live(f, 'status').textContent, /可制作/);
});

test('independent output targets update in place and do not imply the other coat is paused', () => {
  const f = tailor(); f.select(f.b);
  const select = choose(f, 'warm');
  f.G.setProductionGoal('clothes', 0); f.G.setProductionGoal('warmCoats', 10); f.G.ui.renderInfo();
  assert.match(live(f, 'targets').textContent, /普通衣 0（关闭新生产）.*保暖外套 10（可生产）/);
  assert.match(live(f, 'goals').textContent, /保暖外套目标 10/);
  assert.match(live(f, 'status').textContent, /可制作/);
  choose(f, 'basic'); assert.match(live(f, 'status').textContent, /目标已达/);
  assert.match(live(f, 'goals').textContent, /普通衣目标 0.*已关闭新生产/);
  assert.equal(f.doc.activeElement, select);
});

test('accepted and paused recipes retain their own outputs, deduplicate shared tasks and escape carrier names', () => {
  const f = tailor(), { G, b, c } = f;
  const task = G.makeTask(b, c); c.task = task; c.pausedTask = task; c.state = 'walk';
  assert.equal(task.yield.type, 'clothes');
  const inputs = JSON.stringify(task.consume); c.carry = { type: 'clothes', qty: 3 };
  f.select(b); choose(f, 'warm');
  assert.equal(c.task, task); assert.equal(JSON.stringify(task.consume), inputs); assert.equal(c.task.yield.type, 'clothes');
  assert.match(live(f, 'batches').textContent, /普通衣 1（暂停保留 · 裁缝<甲>）.*普通衣 3（待送仓/);
  assert.equal(live(f, 'batches').textContent.match(/普通衣 1/g).length, 1);
  assert.match(live(f, 'stock').textContent, /普通衣物 2.*暖衣 1/);
  c.pausedTask = null; c.carry = null; task.phase = 'fetch'; G.ui.renderInfo();
  assert.match(live(f, 'batches').textContent, /前往仓库领料/);
  task.phase = 'process'; G.ui.renderInfo(); assert.match(live(f, 'batches').textContent, /回铺 \/ 制作/);
});

test('rejected and invalid recipe changes restore the actual value without replacing or blurring the selector', () => {
  for (const value of ['invalid', 'warm']) {
    const f = tailor(); f.select(f.b); const writes = f.info.htmlWrites;
    if (value === 'warm') f.G.setCoatRecipe = () => false;
    const select = choose(f, value);
    assert.equal(f.G.tailorRecipeOf(f.b), 'basic'); assert.equal(select.value, 'basic');
    assert.equal(f.doc.getElementById('coat-recipe'), select); assert.equal(f.doc.activeElement, select);
    assert.equal(f.info.htmlWrites, writes); assert.match(f.info.querySelector('[data-tailor-message]').textContent, /未更改/);
  }
});

test('modal, hidden panel, changed selection, rebuilt panel, replaced world/game/building and removed building guard callbacks', () => {
  for (const change of ['modal', 'hidden', 'selection', 'panel', 'world', 'game', 'infoElement', 'removed', 'replacement', 'site', 'closed']) {
    const f = tailor(); f.select(f.b); const old = f.doc.getElementById('coat-recipe'); let calls = 0;
    f.G.setCoatRecipe = () => { calls++; return true; };
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
    old.value = 'warm'; old.emit('change'); assert.equal(calls, 0, change);
  }
});

test('construction completion mounts recipe controls and makes the stale cancel harmless', () => {
  const f = tailor(); f.b.state = 'site'; f.b.progress = .5; f.select(f.b);
  const old = f.doc.getElementById('info-demolish'); old.focus(); assert.equal(f.doc.getElementById('coat-recipe'), null);
  f.b.state = 'ok'; f.G.ui.renderInfo(); assert(f.doc.getElementById('coat-recipe'));
  assert.equal(f.doc.activeElement.id, 'info-close'); old.click(); assert.equal(f.G.world.bmap[f.b.id], f.b);
});

test('citizen clothing updates in place on real wear, delayed upgrade, expiry and exhausted-stock fallback', () => {
  const f = tailor(), { G, c } = f; c.clothingLeft = 2; c.clothingType = 'basic';
  selectCitizen(f); const close = f.doc.getElementById('info-close'), writes = f.info.htmlWrites; close.focus();
  const worn = clothing(f, 'worn');
  assert.match(worn.textContent, /普通衣物.*剩 2 天/); assert.match(clothing(f, 'cold').textContent, /×0.6.*降低 40%/);
  G.wearClothing(c); G.ui.renderInfo();
  assert.match(worn.textContent, /普通衣物.*剩 1 天/); assert.equal(G.game.res.warmCoats, 1);
  G.wearClothing(c); G.ui.renderInfo();
  assert.match(worn.textContent, /暖衣.*剩 48 天/); assert.equal(G.game.res.warmCoats, 0);
  assert.match(clothing(f, 'cold').textContent, /×0.3.*降低 70%.*再减半/);
  c.clothingLeft = 1; G.wearClothing(c); G.ui.renderInfo();
  assert.match(worn.textContent, /普通衣物.*剩 48 天/); assert.equal(G.game.res.clothes, 1);
  G.game.res.clothes = 0; c.clothingLeft = 1; G.wearClothing(c); G.ui.renderInfo();
  assert.match(worn.textContent, /已耗尽/); assert(worn.classList.contains('warn-txt'));
  assert.match(clothing(f, 'cold').textContent, /×1.0.*无衣物防寒/);
  G.game.res.warmCoats = 1; G.wearClothing(c); G.ui.renderInfo(); assert(!worn.classList.contains('warn-txt'));
  assert.equal(f.info.htmlWrites, writes); assert.equal(clothing(f, 'worn'), worn); assert.equal(f.doc.activeElement, close);
});

test('legacy coat durability and leisure updates coexist without false instant replacement', () => {
  const f = tailor(), { G, c } = f; delete c.clothingType; c.clothingLeft = 7.25; c.leisureDays = 6;
  selectCitizen(f); f.doc.getElementById('info-close').focus();
  assert.match(clothing(f, 'worn').textContent, /普通衣物.*剩 8 天/);
  G.wearClothing(c); c.leisureDays = 3; G.ui.renderInfo();
  assert.equal(c.clothingLeft, 6.25); assert.match(clothing(f, 'worn').textContent, /剩 7 天/);
  assert.match(f.info.querySelector('[data-citizen-leisure="memory"]').textContent, /3.0 天/);
  assert.equal(G.game.res.warmCoats, 1); assert.equal(G.game.res.clothes, 2);
  delete c.happiness; c.clothingLeft = 1; G.wearClothing(c); G.ui.renderInfo();
  assert.match(clothing(f, 'worn').textContent, /暖衣/);
});

test('citizen work feedback follows the accepted coat rather than the newly selected recipe', () => {
  const f = tailor(), { G, b, c } = f; c.task = G.makeTask(b, c); c.state = 'walk';
  G.setCoatRecipe(b, 'warm'); assert.match(G.ui.citizenStatus(c), /前往通用仓取衣料.*尚未扣料/);
  c.task.phase = 'process'; assert.match(G.ui.citizenStatus(c), /返回裁缝铺制作普通衣/);
  c.state = 'work'; assert.equal(G.ui.citizenStatus(c), '制作普通衣（使用随身衣料）');
  c.task.yield.type = 'warmCoats'; assert.equal(G.ui.citizenStatus(c), '制作保暖外套（使用随身衣料）');
  c.task = null; c.carry = { type: 'warmCoats', qty: 1 }; c.state = 'haul';
  assert.equal(G.ui.citizenStatus(c), '搬运保暖外套（送仓）');
});

test('warm coat HUD and goals use the dedicated resource, batch draft controls, separate targets and true winter text', () => {
  const f = tailor(), { G } = f;
  assert(G.RES_KEYS.includes('warmCoats')); assert(!G.FOOD_KEYS.includes('warmCoats'));
  assert.match(G.ui.resourceIcon('warmCoats'), /aria-label="保暖外套"[\s\S]*stroke="currentColor"/);
  f.c.carry = { type: 'warmCoats', qty: 2 }; G.ui.refreshHUD();
  const title = f.doc.getElementById('res-warmCoats').title;
  assert.match(title, /另有 2 随身待入库（尚不可用）/); assert.match(title, /2 皮革 \+ 2 羊毛.*降低 70%.*再减半/);
  assert.match(title, /48 天.*穿坏才.*不替代住房与柴火/);
  assert.match(f.doc.getElementById('res-clothes').title, /2 皮革或 2 羊毛.*降低 40%/);
  for (const id of ['production-goals', 'production-goal-rows', 'btn-production-goals', 'production-goals-close', 'production-goals-message']) f.mount(id);
  G.ui.initProductionGoals(); G.setProductionGoal('warmCoats', 7); G.setProductionGoal('clothes', 0); G.ui.refreshProductionGoals();
  assert(f.doc.getElementById('goal-input-warmCoats'));
  assert.match(f.doc.getElementById('production-goal-rows').innerHTML, /data-goal="warmCoats" data-inherit="true"/);
  assert.match(f.doc.getElementById('goal-status-warmCoats').textContent, /已应用目标 7.*两类衣物目标独立.*已接批次保留/);
  assert.match(f.doc.getElementById('goal-status-clothes').textContent, /关闭新自动生产/);
});

test('live walking, completion, cargo and actual wardrobe upgrade flow through the open DOM', () => {
  const f = tailor(), { G, b, c } = f;
  G.game.res.clothes = 0; G.game.res.warmCoats = 0; c.clothingLeft = 0;
  G.setCoatRecipe(b, 'warm'); G.requestTask(c); f.select(b);
  assert(c.task); const select = f.doc.getElementById('coat-recipe'); select.focus();
  const inputs = [G.game.res.leather, G.game.res.wool]; const phases = new Set();
  // Closing new production preserves the already accepted batch.
  G.setProductionGoal('warmCoats', 0);
  for (let i = 0; i < 1200 && G.game.res.warmCoats < 1; i++) {
    G.ui.renderInfo();
    for (const batch of G.tailorSummary(b).batches) phases.add(batch.phase);
    if (c.task) assert.deepEqual([G.game.res.leather, G.game.res.wool], c.task.phase==='fetch'?inputs:inputs.map(n=>n-2));
    G.stepCitizen(c, .1);
  }
  G.ui.renderInfo(); assert.equal(G.game.res.warmCoats, 1);
  assert.deepEqual([G.game.res.leather, G.game.res.wool], inputs.map(n => n - 2));
  assert(phases.has('fetch')); assert(phases.has('process')); assert(phases.has('haul'));
  assert.match(live(f, 'stock').textContent, /暖衣 1/); assert.match(live(f, 'batches').textContent, /：无/);
  assert.equal(f.doc.activeElement, select); assert.equal(f.doc.getElementById('coat-recipe'), select);
  selectCitizen(f); f.doc.getElementById('info-close').focus(); G.wearClothing(c); G.ui.renderInfo();
  assert.equal(G.game.res.warmCoats, 0); assert.match(clothing(f, 'worn').textContent, /暖衣.*48 天/);
});

test('clothing UI and real adult coldStep agree outdoors, in cold homes and in fuelled homes', () => {
  const f = tailor(), { G, c } = f; G.game.season = 3;
  for (const [type, expected, mul] of [['none', .4, '1.0'], ['basic', .24, '0.6'], ['warm', .12, '0.3']]) {
    c.clothingType = type; c.clothingLeft = type === 'none' ? 0 : 48; c.cold = 0; c.state = 'idle';
    G.coldStep(c, 24); assert(Math.abs(c.cold - expected) < 1e-9);
    selectCitizen(f); assert.match(clothing(f, 'cold').textContent, new RegExp('×' + mul));
  }
  const home = f.building('house'), r = f.resident(home); r.clothingType = 'warm'; r.clothingLeft = 48; r.state = 'rest'; r.camped = false;
  home.unheated = true; r.cold = 0; G.coldStep(r, 24); assert.equal(r.cold, .3);
  home.unheated = false; r.cold = 2; G.coldStep(r, 24); assert.equal(r.cold, .5);
  selectCitizen(f, r); assert.match(clothing(f, 'shelter').textContent, /不改变无柴冷屋受冻或烧柴暖屋恢复/);
});

test('reading tailor and resident facts leaves stock, tasks, recipe and existing wear unchanged', () => {
  const f = tailor(), { G, b, c } = f;
  c.task = G.makeTask(b, c); c.pausedTask = c.task; c.carry = { type: 'warmCoats', qty: 2 };
  const snapshot = () => JSON.stringify({ res: G.game.res, coat: b.coatRecipe, left: c.clothingLeft,
    type: c.clothingType, task: c.task, paused: c.pausedTask, carry: c.carry });
  const before = snapshot();
  for (let i = 0; i < 5; i++) { G.ui.tailorInfoData(b); G.ui.citizenClothingData(c); G.ui.citizenStatus(c); }
  assert.equal(snapshot(), before);
});

test('unreachable warehouse and changed staffing stay visible without overriding a focused draft', () => {
  const f = tailor(); f.select(f.b); const select = choose(f, 'warm');
  f.b.noWork = true; f.b.warnText = '仓库不可达'; f.G.ui.renderInfo();
  assert.match(live(f, 'status').textContent, /仓库不可达/);
  assert.match(f.G.ui.citizenStatus(f.c), /仓库不可达/);
  f.b.noWork = false; f.b.warnText = ''; f.b.workers = []; f.G.ui.renderInfo();
  assert.match(live(f, 'status').textContent, /等待可用工人/); assert.equal(live(f, 'workers').textContent, '无');
  f.b.workers = [f.c.id]; f.G.ui.renderInfo(); assert.match(live(f, 'workers').textContent, /裁缝<甲>/);
  assert.equal(f.doc.getElementById('coat-recipe'), select); assert.equal(f.doc.activeElement, select);
});

test('new game or info element invalidates stale callbacks and mounts working replacement controls', () => {
  for (const change of ['game', 'element']) {
    const f = tailor(); f.select(f.b); const old = choose(f, 'basic');
    if (change === 'game') f.G.game = { ...f.G.game };
    else f.G.ui.el.info = f.mount('new-info');
    f.G.ui.renderInfo(); const current = f.G.ui.el.info.querySelector('#coat-recipe');
    assert(current); assert.notEqual(current, old);
    old.value = 'warm'; old.emit('change'); assert.equal(f.G.tailorRecipeOf(f.b), 'basic');
    current.focus(); current.value = 'warm'; current.emit('change');
    assert.equal(f.G.tailorRecipeOf(f.b), 'warm'); assert.equal(f.doc.activeElement, current);
  }
});

test('constructing the tailor is reported as building work rather than clothes production', () => {
  const f = tailor(); f.b.state = 'site'; f.c.task = { kind: 'build', b: f.b }; f.c.state = 'work';
  assert.equal(f.G.ui.citizenStatus(f.c), '建造中');
  f.c.state = 'walk'; assert.equal(f.G.ui.citizenStatus(f.c), '前往工作点');
});

test('ordinary material selector locks only future batches and preserves focused draft during live refresh',()=>{
 const f=tailor(),{G,b,c}=f;f.select(b);const input=f.info.querySelector('#coat-material');assert(input);assert.equal(input.value,'auto');
 c.task=G.makeTask(b,c);const accepted=c.task;input.focus();input.value='wool';const writes=f.info.htmlWrites;G.ui.renderInfo();assert.equal(input.value,'wool');assert.equal(G.tailorMaterialOf(b),'auto');input.emit('change');
 assert.equal(G.tailorMaterialOf(b),'wool');assert.equal(accepted.consume[0].type,'leather');assert.equal(f.doc.activeElement,input);assert.equal(f.info.htmlWrites,writes);assert.match(live(f,'recipe').textContent,/仅用所选材料/);assert.match(live(f,'materials').textContent,/2 羊毛/);
 G.game.res.wool=0;G.ui.renderInfo();assert.match(live(f,'status').textContent,/不会自动改料/);
});
test('warm recipe disables ordinary-material controls without discarding the saved future choice',()=>{
 const f=tailor(),{G,b}=f;G.setCoatMaterial(b,'wool');f.select(b);choose(f,'warm');const input=f.info.querySelector('#coat-material');assert.equal(input.disabled,true);input.value='leather';input.emit('change');assert.equal(G.tailorMaterialOf(b),'wool');choose(f,'basic');assert.equal(input.disabled,false);assert.equal(input.value,'wool');
});
test('old material callback cannot change new worlds, selected buildings or a dismissed panel',()=>{
 for(const mode of ['world','selection','closed']){const f=tailor(),{G,b}=f;f.select(b);const input=f.info.querySelector('#coat-material');if(mode==='world')G.world={...G.world};else if(mode==='selection')G.sel=null;else f.info.classList.add('hidden');input.value='wool';input.emit('change');assert.equal(G.tailorMaterialOf(b),'auto');}
});
test('live raw mixed cargo and returns are visible separately from public material and finished coats',()=>{
 const f=tailor(),{G,b,c}=f;G.setCoatRecipe(b,'warm');G.game.res.leather=G.game.res.wool=2;c.task=G.makeTask(b,c);c.task.phase='process';c.carry={type:'leather',qty:2,extra:{wool:2},staffingReturn:true,coatInput:b.id};G.game.res.leather=G.game.res.wool=0;c.state='walk';f.select(b);assert.match(live(f,'batches').textContent,/原配料 2 皮革.*2 羊毛 已出库/);assert.match(G.ui.citizenStatus(c),/携衣料返回裁缝铺/);c.task=null;c.state='haul';G.ui.renderInfo();assert.match(live(f,'batches').textContent,/退回未用衣料.*皮革 2.*羊毛 2/);assert.match(G.ui.citizenStatus(c),/退回未使用衣料/);assert.match(live(f,'stock').textContent,/普通衣物 2.*暖衣 1/);
});

console.log(`Warm coats UI: ${passed} DOM and live-simulation suites passed (browser visual acceptance not performed).`);
