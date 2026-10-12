/* Building activity is shared read-only presentation. Focused DOM contracts, not browser/mobile acceptance. */
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
  for (const name of ['core', 'defs', 'map', 'sim', 'fire', 'ui'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.game.h = 12; G.rng = G.makeRng(917); G.setUid(1);
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
const supported = ['house', 'stonehouse', 'boarding', 'blacksmith', 'woodcutter', 'tailor', 'tavern'];
const activityRow = f => f.info.querySelector('[data-building-activity]');
const facts = (label = '已分配工人，等待到岗', detail = '通勤不计生产') =>
  Object.freeze({ kind: 'workshop', state: 'commuting', label, detail, active: false });
const text = data => `${data.label} · ${data.detail}`;
function installActivity(G, read = () => facts()) {
  G.buildingActivity = b => b && b.state === 'ok' && supported.includes(b.type) && !G.houseFireSummary?.(b)?.active ? read(b) : null;
}

test('missing helper keeps existing finished-building panels usable without an activity row', () => {
  for (const type of supported) {
    const f = fixture(), b = f.building(type);
    assert.equal(f.G.buildingActivity, undefined);
    f.select(b); assert.equal(activityRow(f), null, type);
    f.info.querySelector('#info-close').focus(); f.G.ui.renderInfo();
    assert.equal(activityRow(f), null, type);
    assert(f.info.querySelector('#info-demolish'), type);
  }
});

test('unsupported buildings, sites and active fires do not show activity labels', () => {
  for (const [type, state] of [['storage', 'ok'], ['well', 'ok'], ['mine', 'ok'], ['house', 'site'], ['woodcutter', 'site']]) {
    const f = fixture(), b = f.building(type, { state }); installActivity(f.G);
    f.select(b); assert.equal(activityRow(f), null, type + ':' + state);
    assert(f.info.querySelector('#info-demolish'));
  }
  const f = fixture(), b = f.building('house'); f.resident(b); installActivity(f.G);
  f.select(b); assert(activityRow(f));
  const quote = f.G.fireToggleQuote(true);
  assert(quote.ok); assert(f.G.setFireDisasters(true, quote.key, f.G.game));
  assert(f.G.igniteHouse(b)); f.G.ui.renderInfo();
  assert.equal(activityRow(f), null);
  assert(f.info.querySelector('[data-home-fire-panel]'));
  assert.equal(f.info.querySelector('#info-demolish').disabled, true);
});

test('all supported buildings show exactly the helper facts without replacing original status', () => {
  for (const type of supported) {
    const f = fixture(), b = f.building(type), data = facts();
    f.select(b);
    const statusBefore = f.info.children[1].textContent;
    f.G.ui.hideInfo(); installActivity(f.G, () => data); f.select(b);
    assert.equal(activityRow(f).textContent, text(data), type);
    assert.equal(f.info.children[1].textContent, statusBefore, type);
    assert.equal(f.info.querySelectorAll('[data-building-activity]').length, 1, type);
    assert.doesNotMatch(activityRow(f).textContent, /生产中|加工中/);
  }
});

test('initial label and detail escape HTML and live updates remain plain text', () => {
  const f = fixture(), b = f.building('house');
  let data = facts('<img src=x onerror="bad()">&\'label', '<script>bad()</script> "detail"');
  installActivity(f.G, () => data); f.select(b);
  const row = activityRow(f);
  assert.equal(row.textContent, text(data));
  assert.match(f.info.innerHTML, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;&amp;&#39;label/);
  assert.match(f.info.innerHTML, /&lt;script&gt;bad\(\)&lt;\/script&gt; &quot;detail&quot;/);
  assert.equal(row.querySelector('img'), null); assert.equal(row.querySelector('script'), null);
  data = facts('<b>暂停</b>', '<img src=x> & 待命'); f.G.ui.renderInfo();
  assert.equal(activityRow(f), row); assert.equal(row.textContent, text(data));
  assert.equal(row.children.length, 0);
});

test('each specialized early return refreshes activity in place and preserves focused drafts', () => {
  const refreshers = { house: 'refreshHomeInfo', stonehouse: 'refreshHomeInfo', boarding: 'refreshHomeInfo',
    blacksmith: 'refreshResourceChainInfo', woodcutter: 'refreshFuelInfo', tailor: 'refreshTailorInfo', tavern: 'refreshTavernInfo' };
  for (const type of supported) {
    const f = fixture(), b = f.building(type), G = f.G;
    let data = facts('已分配工人，等待到岗', '尚无实际生产'); installActivity(G, () => data); f.select(b);
    const row = activityRow(f), control = f.info.querySelector('#worker-limit-input') || f.info.querySelector('#info-close');
    if (control.id === 'worker-limit-input') control.value = '17'; control.focus();
    const writes = f.info.htmlWrites, rowWrites = row.htmlWrites, draft = control.value;
    const method = refreshers[type], refresh = G.ui[method]; let earlyReturns = 0;
    G.ui[method] = function (...args) { const result = refresh.apply(this, args); if (result) earlyReturns++; return result; };
    for (const [label, detail] of [['实际加工', '当前批次已到工位'], ['暂停', '世界时间暂停'], ['等待原料', '没有可加工批次']]) {
      data = facts(label, detail); G.ui.renderInfo();
      assert.equal(row.textContent, text(data), type + ':' + label);
      assert.equal(activityRow(f), row, type);
      assert.equal(f.info.htmlWrites, writes, type); assert.equal(row.htmlWrites, rowWrites, type);
      assert.equal(f.doc.activeElement, control, type); assert.equal(control.value, draft, type);
    }
    assert.equal(earlyReturns, 3, type + ' must exercise its real specialized return');
    const textWrites = row.textWrites; G.ui.renderInfo();
    assert.equal(row.textWrites, textWrites, type + ' unchanged facts need no text write');
  }
});

test('withdrawn or unavailable helper facts clear stale text without a panel rebuild', () => {
  const f = fixture(), b = f.building('tavern'); let data = facts();
  installActivity(f.G, () => data); const helper = f.G.buildingActivity; f.select(b);
  const row = activityRow(f), writes = f.info.htmlWrites;
  const control = f.info.querySelector('#worker-limit-input'); control.value = '19'; control.focus();
  for (const helperPresent of [true, false]) {
    data = null; f.G.buildingActivity = helperPresent ? helper : undefined; f.G.ui.renderInfo();
    assert.equal(row.textContent, ''); assert(row.classList.contains('hidden'));
    assert.equal(f.info.htmlWrites, writes); assert.equal(f.doc.activeElement, control); assert.equal(control.value, '19');
    data = facts('暂停', '等待恢复'); f.G.buildingActivity = helper; f.G.ui.renderInfo();
    assert.equal(row.textContent, text(data)); assert(!row.classList.contains('hidden'));
    assert.equal(activityRow(f), row); assert.equal(f.info.htmlWrites, writes);
  }
});

test('activity refresh preserves an existing home demolition/upgrade confirmation', () => {
  const f = fixture(), G = f.G; f.building('storage'); const b = f.building('house'); f.resident(b);
  Object.assign(G.game.res, { wood: 100, stone: 100, iron: 100, grain: 500, food: 500 });
  let data = facts('有人居住', '住户在外'); installActivity(G, () => data); f.select(b);
  f.info.querySelector('#house-upgrade-start').click();
  const panel = f.info.querySelector('[data-house-upgrade-panel]'), confirm = f.info.querySelector('#house-upgrade-confirm');
  const pending = panel._upgradePending, writes = f.info.htmlWrites;
  assert(pending); assert.equal(f.doc.activeElement, confirm);
  data = facts('住户休息', '屋内 1 人'); G.ui.renderInfo();
  assert.equal(panel._upgradePending, pending); assert.equal(f.info.querySelector('#house-upgrade-confirm'), confirm);
  assert.equal(confirm.disabled, false); assert.equal(f.doc.activeElement, confirm); assert.equal(f.info.htmlWrites, writes);
  assert.equal(activityRow(f).textContent, text(data));
});

test('unsupported finite-mine demolition confirmation remains mounted and pending', () => {
  const f = fixture(), G = f.G, b = f.building('mine', { mineralUnits: 80 }); installActivity(G);
  f.select(b); assert(G.ui.confirmMineralRemoval(b, G.mineralRemovalQuote(b)));
  const panel = f.info.querySelector('[data-mineral-removal-panel]'), confirm = f.info.querySelector('#mineral-removal-confirm');
  const pending = panel._mineralPending, writes = f.info.htmlWrites;
  G.ui.renderInfo(); G.ui.renderInfo();
  assert.equal(activityRow(f), null); assert.equal(panel._mineralPending, pending);
  assert.equal(f.info.querySelector('#mineral-removal-confirm'), confirm); assert.equal(f.doc.activeElement, confirm);
  assert.equal(confirm.disabled, false); assert.equal(f.info.htmlWrites, writes);
});

test('finishing construction and selecting a different building use the correct fresh facts', () => {
  const f = fixture(), G = f.G, b = f.building('house', { state: 'site' });
  installActivity(G, selected => facts('当前建筑', String(selected.id))); f.select(b);
  assert.equal(activityRow(f), null); b.state = 'ok'; G.ui.renderInfo();
  assert.equal(activityRow(f).textContent, text(facts('当前建筑', String(b.id))));
  const other = f.building('tavern'); f.select(other);
  assert.equal(activityRow(f).textContent, text(facts('当前建筑', String(other.id))));
  f.select(f.building('storage')); assert.equal(activityRow(f), null);
});

console.log(`Building activity UI: ${passed} DOM suites passed (not browser/mobile acceptance).`);
