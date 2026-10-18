/* Town-hall DOM contracts, not browser visual acceptance. */
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
          const presence = selector.match(/^\[data-([^=]+)\]$/);
          if (presence) return Object.hasOwn(child.dataset, presence[1]);
          const data = selector.match(/^\[data-([^=]+)="([^"]*)"\]$/);
          return data ? child.dataset[data[1]] === data[2] : child.tagName === selector.toUpperCase();
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
  G.BDEF.townhall ||= {name:'市政厅',icon:'🏛️',w:4,h:4,jobs:0,cost:{wood:60,stone:80,iron:20},buildWork:180,desc:'查看镇况并接待迁入家庭。'};
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
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, button };
}

let passed = 0;
function test(name, fn) { fn(); console.log('ok ' + name); passed++; }
const live = (f, key) => f.info.querySelector(`[data-townhall="${key}"]`);
function town() {
  const f = fixture(), { G } = f, b = f.building('townhall');
  const s = { population: 12, adults: 8, children: 4, educated: 3, homelessFamilies: 2,
    freeHomes: 1, boardingSlots: 0, averageHealth: 3.75, sick: 1, doctors: 0, herbs: 5,
    foodDays: 20, offer: null, offerPeople: 5, offerAdults: 4, offerChildren: 1, offerFamilies: 2,
    foodDaysAfter: 14.1, addedFoodPerDay: 10.4, addedFuelPerWinter: 60,
    arriving: 0, nextDay: 30, accepted: 0, declined: 0 };
  G.townHallSummary = hall => ({ ...s, offer: s.offer && s.offer.hallId === hall.id ? s.offer : null });
  const calls = [];
  G.decideNomads = (hall, id, accept) => {
    calls.push({ hall, id, accept });
    if (!s.offer || s.offer.id !== id) return { ok: false, reason: '申请已过期' };
    if (accept) { s.accepted += s.offerPeople; s.arriving = s.offerPeople; }
    else s.declined += s.offerPeople;
    s.offer = null;
    return { ok: true, count: s.offerPeople };
  };
  function offer(id = 7) { s.offer = { id, hallId: b.id, expiresDay: 42,
    families: [{ fatherAge: 28, motherAge: 27, childAges: [4] }, { fatherAge: 32, motherAge: 30, childAges: [] }], sickCount: 1 }; }
  return { ...f, b, s, calls, offer };
}

test('town hall appears in services with dedicated icon, and completed hall needs no worker', () => {
  const f = town(); f.G.ui.initToolbar();
  assert(f.G.ui.toolGroups.find(group => group.id === 'services').tools.includes('townhall'));
  assert.match(f.G.ui.toolButton('townhall'), /class="ui-icon"/);
  f.select(f.b);
  assert.match(f.info.textContent, /无需安排工人/);
  assert.doesNotMatch(f.info.textContent, /工人：/);
  assert.match(live(f, 'population').textContent, /人口 12.*成人 8.*儿童\/学生 4/);
  assert.match(live(f, 'education').textContent, /已受教育 3 人/);
  assert.match(live(f, 'health').textContent, /3.8.*患病 1/);
  assert.match(live(f, 'medical').textContent, /已任职健康医师 0/);
});

test('pending offer discloses real family ages and every shortage before either explicit choice', () => {
  const f = town(); f.offer(); f.select(f.b);
  assert.equal(f.calls.length, 0);
  assert.match(live(f, 'offerPeople').textContent, /5 人 \/ 2 户.*成人 4.*儿童 1.*全部未受教育/);
  assert.match(live(f, 'offerFamilies').textContent, /父亲 28 岁、母亲 27 岁；孩子 4 岁/);
  assert.match(live(f, 'offerHousing').textContent, /新来 2 户.*现有无房 2 户.*共需 4.*空屋 1.*宿舍空位 0.*还缺 3/);
  assert.match(live(f, 'offerFood').textContent, /10.4 \/ 天.*20.0 天 → 14.1 天/);
  assert.match(live(f, 'offerFuel').textContent, /每户新家庭住木屋.*60 柴火/);
  assert.match(live(f, 'offerMedical').textContent, /医师 0 人.*有 1 人患季节热病.*不会直接致死/);
  assert.match(f.info.textContent, /即使住房、食物或医疗不足，也可自行决定接纳/);
  assert(f.doc.getElementById('townhall-accept')); assert(f.doc.getElementById('townhall-decline'));
});

test('timed refresh preserves focused buttons and open ledger while patching live town and offer facts', () => {
  const f = town(); f.offer(); f.select(f.b);
  const button = f.doc.getElementById('townhall-accept'), holder = f.info.querySelector('[data-townhall-offer]');
  const ledger = f.info.querySelector('details'), writes = f.info.htmlWrites, offerWrites = holder.htmlWrites;
  ledger.open = true; button.focus();
  f.s.population = 13; f.s.foodDaysAfter = 8; f.s.freeHomes = 3; f.s.doctors = 1;
  for (let i = 0; i < 3; i++) f.G.ui.renderInfo();
  assert.equal(f.info.htmlWrites, writes); assert.equal(holder.htmlWrites, offerWrites);
  assert.equal(f.doc.getElementById('townhall-accept'), button); assert.equal(f.doc.activeElement, button); assert.equal(ledger.open, true);
  assert.match(live(f, 'population').textContent, /人口 13/);
  assert.match(live(f, 'offerFood').textContent, /8.0 天/);
  assert.match(live(f, 'offerMedical').textContent, /医师 1 人.*医师到岗/);
  assert.match(live(f, 'offerHousing').textContent, /空屋 3/);
});

test('accept and decline are explicit, repeated clicks cannot duplicate, and arrivals stay visible', () => {
  const f = town(); f.offer(); f.select(f.b); const oldAccept = f.doc.getElementById('townhall-accept');
  oldAccept.click(); oldAccept.click();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].id, 7); assert.equal(f.calls[0].accept, true);
  assert.equal(f.doc.getElementById('townhall-accept'), null);
  assert.match(live(f, 'arriving').textContent, /迁入途中 5 人/);
  assert.equal(f.doc.activeElement.id, 'info-close');
  f.offer(8); f.G.ui.renderInfo(); const reject = f.doc.getElementById('townhall-decline');
  reject.click(); reject.click(); oldAccept.click();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].accept, false); assert.equal(f.s.declined, 5);
  assert.match(f.info.querySelector('[data-townhall-message]').textContent, /已婉拒/);
});

test('expired or replaced offer cannot be accepted by an old callback, including before next UI tick', () => {
  const f = town(); f.offer(); f.select(f.b); const old = f.doc.getElementById('townhall-accept');
  f.offer(8); old.click(); assert.equal(f.calls.length, 0);
  const next = f.doc.getElementById('townhall-accept'); assert.notEqual(next, old);
  old.click(); assert.equal(f.calls.length, 0);
  f.s.offer = null; next.click(); assert.equal(f.calls.length, 0); assert.equal(f.doc.getElementById('townhall-accept'), null);
});

test('modal, changed selection, rebuilt panel, replacement world/game and removed hall guard callbacks', () => {
  for (const change of ['modal', 'selection', 'panel', 'world', 'game', 'removed', 'site']) {
    const f = town(); f.offer(); f.select(f.b); const old = f.doc.getElementById('townhall-accept');
    if (change === 'modal') f.G.hasOpenModal = () => true;
    if (change === 'selection') f.G.sel = { kind: 'b', id: f.building('house').id };
    if (change === 'panel') { f.select(f.building('house')); f.select(f.b); }
    if (change === 'world') f.G.world = { ...f.G.world };
    if (change === 'game') f.G.game = { ...f.G.game };
    if (change === 'removed') delete f.G.world.bmap[f.b.id];
    if (change === 'site') f.b.state = 'site';
    old.click(); assert.equal(f.calls.length, 0, change);
  }
});

test('blocked entry keeps the offer and shows the simulation reason without duplicating people', () => {
  const f = town(); f.offer(); f.G.decideNomads = () => ({ ok: false, reason: '没有可达的地图边界入村路线' });
  f.select(f.b); const old = f.doc.getElementById('townhall-accept'); old.click();
  assert.equal(f.doc.getElementById('townhall-accept'), old); assert.equal(f.s.arriving, 0);
  assert.match(f.info.querySelector('[data-townhall-message]').textContent, /没有可达/);
});

test('ledger contains only actual recent 60-day population, birth and death records', () => {
  const f = town(); f.G.game.day = 70;
  f.G.game.hist = Array.from({ length: 70 }, (_, i) => ({ d: i + 1, pop: i + 10, born: 1, died: i === 69 ? 1 : 0 }));
  f.select(f.b);
  assert.match(live(f, 'historyTitle').textContent, /最近 60 天.*已记录 60 天/);
  assert.match(live(f, 'historySummary').textContent, /第 11–70 天：出生 60 · 死亡 1；人口 20 → 79/);
  assert.equal(live(f, 'historyRows').textContent.split('\n').length, 60);
  assert.match(live(f, 'historyRows').textContent, /^第 11 天.*人口 20/);
  assert.doesNotMatch(f.info.textContent, /100 年|百年/);
  f.G.game.hist = []; f.G.ui.renderInfo();
  assert.equal(live(f, 'historyRows').textContent, ''); assert.match(live(f, 'historySummary').textContent, /尚无每日记录/);
});

test('construction finishes into town overview and in-transit citizen status is explicit', () => {
  const f = town(); f.offer(); f.b.state = 'site'; f.b.progress = .5; f.select(f.b);
  assert.equal(f.doc.getElementById('townhall-accept'), null); f.doc.getElementById('info-demolish').focus();
  f.b.state = 'ok'; f.G.ui.renderInfo(); assert(f.doc.getElementById('townhall-accept')); assert.equal(f.doc.activeElement.id, 'info-close');
  const c = f.G.spawnCitizen({ x: 1, y: 1, age: 30, sex: 'm', name: '新住户' }); c.arrivalHallId = f.b.id;
  assert.match(f.G.ui.citizenStatus(c), /迁入途中.*市政厅报到/);
});
test('real simulation acceptance updates the persistent panel and spawns real families at the boundary once', () => {
  const f = fixture(), { G } = f, b = f.building('townhall');
  G.ui.refreshHUD = () => {};
  for (let i = 0; i < 10; i++) G.spawnCitizen({ x: 1, y: 1, age: 30, sex: i % 2 ? 'm' : 'f' });
  G.game.nomads.offer = { id: 88, hallId: b.id, expiresDay: 12,
    families: [{ fatherAge: 28, motherAge: 27, childAges: [4] }], sickCount: 1 };
  f.select(b); const accept = f.doc.getElementById('townhall-accept');
  assert.match(live(f, 'offerPeople').textContent, /3 人 \/ 1 户/);
  accept.click(); accept.click();
  const newcomers = G.world.citizens.filter(G.isArriving);
  assert.equal(G.world.citizens.length, 13); assert.equal(newcomers.length, 3);
  assert.equal(G.world.families.length, 1); assert.equal(G.world.families[0].members.length, 3);
  assert(newcomers.every(c => c.x === 0 || c.y === 0 || c.x === G.world.N - 1 || c.y === G.world.N - 1));
  assert(newcomers.every(c => !c.educated && c.arrivalHallId === b.id));
  assert.equal(newcomers.filter(G.isSick).length, 1);
  assert.match(live(f, 'population').textContent, /人口 13/);
  assert.match(live(f, 'arriving').textContent, /迁入途中 3 人/);
  assert.equal(G.game.nomads.offer, null);
});
test('development challenges explain adapted independent criteria without granting rewards or rewriting old dates',()=>{
 const f=town(),{G,b}=f;f.select(b);assert.match(f.info.textContent,/发展挑战（本作适配）/);assert.match(live(f,'challengeSettlement').textContent,/已入村 0\/30 人/);assert.match(live(f,'challengeFood').textContent,/0\/12 日.*0\/3/);assert.match(live(f,'challengeEducation').textContent,/0\/3 人.*0\/1 人/);assert.match(f.info.textContent,/无资源奖励或效率加成/);assert.match(f.info.textContent,/旧档不追溯历史完成日/);
 G.game.day=80;G.game.challenges.completed.settlement=80;G.ui.renderInfo();assert.match(live(f,'challengeSettlement').textContent,/已确认：第 80 天/);
});
test('challenge rows update in place while details controls retain focus and rendering remains read-only',()=>{
 const f=town(),{G,b}=f;f.select(b);const close=f.info.querySelector('#info-close');close.focus();const row=live(f,'challengeFood'),writes=f.info.htmlWrites;const before=JSON.stringify({g:G.game,w:G.world});for(let i=0;i<30;i++)G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.equal(live(f,'challengeFood'),row);assert.equal(f.doc.activeElement,close);assert.equal(JSON.stringify({g:G.game,w:G.world}),before);
});
test('new village never inherits a previous worlds confirmation dates in the existing hall view',()=>{
 const f=town(),{G,b}=f;G.game.challenges.completed.education=0;f.select(b);assert.match(live(f,'challengeEducation').textContent,/已确认：第 0 天/);G.game=G.newGameState();G.ui.renderInfo();assert.doesNotMatch(live(f,'challengeEducation').textContent,/已确认/);assert.deepEqual(Object.keys(G.game.challenges.completed),[]);
});

console.log(`Town hall UI: ${passed} interaction suites passed (DOM fixture; browser visual acceptance not performed).`);
