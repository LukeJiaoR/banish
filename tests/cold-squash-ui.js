/* Cold-squash DOM and live-simulation contracts, not browser/mobile visual acceptance. */
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
      emit(type) { for (const fn of handlers[type] || []) fn({target: this, preventDefault() {}}); },
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
  for (const name of ['core', 'defs', 'map', 'sim', 'ui', 'main'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
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
function farm(unlocked = false) {
  const f = fixture(), { G } = f, b = f.building('farm');
  f.building('storage'); G.game.h = 12; G.game.unlocks.squash = unlocked;
  G.game.res.grain = G.game.res.food = 200; G.game.res.tools = 20;
  const c = G.spawnCitizen({ x: b.x - 1, y: b.y, age: 30, sex: 'm', name: '瓜田农夫' });
  c.job = b.id; b.workers = [c.id];
  const get = id => G.ui.el.info.querySelector('#' + id);
  return { ...f, b, c, get };
}
function choose(f, crop) {
  const select = f.get('farm-crop'); select.focus(); select.value = crop; select.emit('change'); return select;
}
function grown(f, growth = 1) {
  f.G.setFarmCrop(f.b, 'squash'); f.b.sownAll = true; f.b.growth = growth;
  f.b.farm.forEach(tile => { tile.sown = true; }); f.G.game.day = 36; f.G.game.season = 3;
  f.select(f.b);
}
function trader(f, stock) {
  const b = f.building('tradingpost');
  b.merchant = { id: 'seeds', arrivedDay: f.G.game.day, leaveDay: f.G.game.day + 12,
    stock: stock || Object.fromEntries(f.G.MERCHANTS.seeds.goods.map(good => [good, f.G.TRADE_GOODS[good].stock])) };
  b.merchantVisits = 3; b.tradeInventory.firewood = 1500; return b;
}
function trade(f, good = 'squashSeed', qty = 1, payment = 'firewood') {
  f.get('trade-good').value = good; f.get('trade-buy-quantity').value = String(qty);
  f.get('trade-payment').value = payment; f.get('trade-good').emit('input');
  return f.get('trade-exchange-form');
}
function order(f, good = 'squashSeed', qty = 1) {
  f.get('trade-order-good').value = good; f.get('trade-order-quantity').value = String(qty);
  f.get('trade-order-good').emit('input'); return f.get('trade-order-form');
}
function stepUntil(f, condition, limit = 6000) {
  for (let i = 0; i < limit && !condition(); i++) { f.G.stepCitizen(f.c, .1); f.G.ui.renderInfo(); }
  assert(condition(), 'live simulation did not reach the expected state');
}
const snapshot = f => JSON.stringify(f.G.serializeGame());
const live = (f, key) => f.info.querySelector(`[data-economy-live="${key}"]`).textContent;

test('locked squash and the calendar adaptation are visible without granting seed',()=>{
  const f=farm();f.select(f.b);
  assert.deepEqual(f.get('farm-crop').querySelectorAll('option').map(o=>o.value),['wheat','cabbage','beans','squash']);
  assert.equal(f.get('farm-crop').querySelectorAll('option').find(o=>o.value==='squash').disabled,true);
  assert.match(f.node('seeds').textContent,/耐寒瓜未解锁.*贸易购买耐寒瓜种子/);
  assert.match(f.info.textContent,/入冬后的前两日.*第3日零时.*冬季.*不播种、不成长/);
  assert.match(f.info.textContent,/48日历适配.*不是气温模拟/);
  assert.match(f.info.textContent,/肉类（含鸡蛋）、蔬菜（含苹果和梨）、主食三组/);
  choose(f,'squash');assert.equal(f.G.farmCropOf(f.b),'wheat');assert.equal(f.G.game.unlocks.squash,false);
});

test('real seed payment unlocks choice once and pending choice never changes an old crop',()=>{
  const f=farm(),{G}=f,b=trader(f);f.select(b);
  trade(f).emit('submit');assert.equal(G.game.unlocks.squash,true);assert.equal(b.tradeInventory.firewood,875);
  const stock=b.tradeInventory.firewood;trade(f).emit('submit');assert.equal(b.tradeInventory.firewood,stock);
  f.select(f.b);G.requestTask(f.c);f.c.carry={type:'grain',qty:14};choose(f,'squash');
  assert.equal(G.farmCropOf(f.b),'wheat');assert.equal(G.cropChoiceOf(f.b),'squash');assert.equal(f.c.carry.type,'grain');
  assert.match(f.node('cold').textContent,/本季作物不耐寒.*改选下季耐寒瓜不会保护本季/);
  assert.match(f.node('choice').textContent,/耐寒瓜.*下一春/);
});

test('winter window counts down in place and preserves focused selection draft',()=>{
  const f=farm(true),{G,b}=f;grown(f);G.game.h=0;G.ui.renderInfo();
  assert.match(f.node('current').textContent,/耐寒瓜 → 蔬菜/);
  assert.match(f.node('timing').textContent,/成长 24 天.*入冬后的前两日.*冬季不成长.*14 蔬菜/);
  assert.match(f.node('cold').textContent,/还剩 48.0 小时/);
  const sel=f.get('farm-crop'),writes=f.info.htmlWrites;sel.focus();sel.value='wheat';
  G.game.day=37;G.game.h=23.5;G.ui.renderInfo();
  assert.match(f.node('cold').textContent,/还剩 0.5 小时/);assert.equal(f.info.htmlWrites,writes);
  assert.equal(f.doc.activeElement,sel);assert.equal(sel.value,'wheat');assert.equal(G.cropChoiceOf(b),'squash');
  const before=snapshot(f);for(let n=0;n<3;n++)G.ui.renderInfo();assert.equal(snapshot(f),before);
});

test('immature winter crop requires real early-harvest confirmation and supports cancel',()=>{
  const f=farm(true),{G,b}=f;grown(f,.5);
  f.get('early-harvest-start').click();assert.equal(b.earlyHarvestYield,undefined);
  assert.match(f.info.querySelector('[data-early-harvest-quote]').textContent,/7/);
  f.get('early-harvest-cancel').click();assert.equal(b.earlyHarvestYield,undefined);
  f.get('early-harvest-start').click();f.get('early-harvest-confirm').click();assert.equal(b.earlyHarvestYield,7);
  assert.equal(G.game.res.vegetables,0);assert.equal(G.farmHarvestReady(b),true);
  assert.match(f.node('cold').textContent,/不能靠冬季等待增产/);
});

test('day-three cutoff invalidates pending confirmation and retains already harvested cargo',()=>{
  const f=farm(true),{G,b,c}=f;grown(f,.5);G.game.day=37;G.game.h=23.9;G.ui.renderInfo();
  f.get('early-harvest-start').click();const confirm=f.get('early-harvest-confirm');c.carry={type:'vegetables',qty:7};
  G.endDay();G.game.h=0;G.ui.renderInfo();confirm.click();
  assert.equal(b.earlyHarvestYield,undefined);assert.equal(b.growth,0);assert.equal(G.farmHarvestReady(b),false);
  assert.equal(c.carry.qty,7);assert.equal(c.carry.type,'vegetables');
  assert.match(f.node('cold').textContent,/本冬收割窗口已结束/);assert.equal(f.get('early-harvest-start').disabled,true);
});

test('replacement worlds, panels, hidden views and modals reject stale crop and harvest controls',()=>{
  for(const mode of ['world','game','panel','hidden','removed','modal']){
    const f=farm(true),{G,b}=f;grown(f,.5);f.get('early-harvest-start').click();
    const confirm=f.get('early-harvest-confirm'),sel=f.get('farm-crop');
    if(mode==='world')G.world={...G.world};if(mode==='game')G.game={...G.game};
    if(mode==='panel'){f.select(G.world.buildings.find(x=>x.type==='storage'));f.select(b);}
    if(mode==='hidden')f.info.classList.add('hidden');if(mode==='removed')delete G.world.bmap[b.id];if(mode==='modal')G.hasOpenModal=()=>true;
    confirm.click();sel.value='wheat';sel.emit('change');
    assert.equal(b.earlyHarvestYield,undefined,mode);assert.equal(G.cropChoiceOf(b),'squash',mode);
  }
});

test('seed orders expose squash through the existing merchant form',()=>{
  const f=farm(),{G}=f,b=trader(f,{cabbageSeed:1});f.select(b);
  assert(f.get('trade-order-good').querySelectorAll('option').some(o=>o.value==='squashSeed'));
  order(f).emit('submit');
  assert.equal(b.merchantOrders.seeds.good,'squashSeed');assert.equal(G.game.unlocks.squash,false);
});

test('saved winter squash restores the same crop, clock, growth and harvested cargo',()=>{
  const f=farm(true),{G,b,c}=f;grown(f,.5);G.game.day=37;G.game.h=6;G.game.townLedger=G.newTownLedger(G.game);c.carry={type:'vegetables',qty:7};
  const data=JSON.parse(JSON.stringify(G.serializeGame())),restored=G.prepareSaveData(data);G.world=restored.world;G.game=restored.game;
  const loaded=G.world.bmap[b.id];f.select(loaded);assert.equal(loaded.growth,.5);assert.match(f.node('cold').textContent,/还剩 18.0 小时/);
  assert.equal(G.world.cmap[c.id].carry.qty,7);assert.match(f.node('current').textContent,/耐寒瓜/);
  delete data.game.unlocks.squash;for(const item of data.buildings)if(item.type==='farm'){item.cropType='wheat';item.cropChoice='wheat';}
  const old=G.prepareSaveData(data);assert.equal(old.game.unlocks.squash,false);assert.equal(old.world.cmap[c.id].carry.qty,7);
});

console.log(`Cold squash UI: ${passed} DOM/live-state suites passed (not browser/mobile acceptance).`);

