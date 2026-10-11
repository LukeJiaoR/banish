/* Species, cattle trade and guarded pasture controls. DOM is not browser acceptance. */
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

let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
function setup(){const f=fixture();f.b=f.building('pasture');f.building('storage');f.G.game.h=12;f.G.game.res.food=f.G.game.res.grain=100;f.G.game.livestock={sheep:4,cattle:4};f.select(f.b);return f;}
const input=(f,id)=>f.info.querySelector('#'+id),live=(f,id)=>f.info.querySelector(`[data-economy-live="${id}"]`).textContent;
function choose(f,type){input(f,'pasture-type').focus();input(f,'pasture-type').value=type;input(f,'pasture-type-form').emit('submit');}
function stock(f,qty){input(f,'pasture-stock-quantity').value=qty;input(f,'pasture-stock-form').emit('submit');}
test('empty pens clearly separate applied species from an unsubmitted choice',()=>{const f=setup();assert.match(live(f,'animals'),/羊群 0\/12/);input(f,'pasture-type').value='cattle';assert.equal(f.G.pastureTypeOf(f.b),'sheep');choose(f,'cattle');assert.equal(f.G.pastureTypeOf(f.b),'cattle');assert.match(live(f,'animals'),/牛群 0\/10/);assert.match(live(f,'pasture-rule'),/36肉＋4皮革/);assert.match(f.info.querySelector('[data-pasture-output]').textContent,/皮革/);assert(!f.info.querySelector('[data-pasture-output]').textContent.includes('羊毛'));});
test('stocking deducts only the applied species, updates both bank facts, and refuses mixing',()=>{const f=setup();choose(f,'cattle');stock(f,2);assert.equal(f.b.animals,2);assert.equal(f.G.game.livestock.cattle,2);assert.equal(f.G.game.livestock.sheep,4);assert.match(live(f,'sheep-bank'),/羊 4 · 牛 2/);assert(input(f,'pasture-type-apply').disabled);choose(f,'sheep');assert.equal(f.G.pastureTypeOf(f.b),'cattle');assert.match(live(f,'pasture-switch'),/禁止混养/);});
test('typed quantities and focus survive live refresh without applying themselves',()=>{const f=setup();choose(f,'cattle');const field=input(f,'pasture-target-quantity');field.focus();field.value='3';const writes=f.info.htmlWrites;f.b.animals=5;f.b.animalGrowth=.6;f.G.ui.renderInfo();assert.equal(input(f,'pasture-target-quantity'),field);assert.equal(f.doc.activeElement,field);assert.equal(field.value,'3');assert.equal(f.b.animalTarget,8);assert.equal(f.info.htmlWrites,writes);assert.match(live(f,'pasture-production'),/60%/);input(f,'pasture-target-form').emit('submit');assert.equal(f.b.animalTarget,3);});
test('cow capacity and target bounds are visible and enforced, sheep still permits twelve',()=>{const f=setup();choose(f,'cattle');assert.equal(input(f,'pasture-target-quantity').max,'10');input(f,'pasture-target-quantity').value=11;input(f,'pasture-target-form').emit('submit');assert.equal(f.b.animalTarget,8);assert.match(f.info.querySelector('[data-economy-message]').textContent,/2–10/);choose(f,'sheep');input(f,'pasture-target-quantity').value=12;input(f,'pasture-target-form').emit('submit');assert.equal(f.b.animalTarget,12);});
test('pending dual outputs and paused old tasks disable switching with a visible reason',()=>{const f=setup();choose(f,'cattle');f.b.pastureProducts={meat:16,leather:4};f.G.ui.refreshEconomyInfo(f.b);assert.match(live(f,'pasture-production'),/肉 16 · 皮革 4/);assert(input(f,'pasture-type-apply').disabled);assert.match(live(f,'pasture-switch'),/待送产物/);f.b.pastureProducts={meat:0,leather:0};const c=f.G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.pausedTask={economy:'pasture',b:f.b};f.G.ui.refreshEconomyInfo(f.b);assert.match(live(f,'pasture-switch'),/任务或产物仍在途中/);});
test('full warehouse and output goals show why fresh slaughter pauses',()=>{const f=setup();choose(f,'cattle');f.b.animals=9;f.b.workers=[99];f.G.setProductionGoal('leather',0);f.G.ui.refreshEconomyInfo(f.b);assert.match(f.info.querySelector('[data-economy-status]').textContent,/皮革达到目标/);f.G.setProductionGoal('leather',null);f.G.game.res.leather=f.G.storageCap();f.G.ui.refreshEconomyInfo(f.b);assert.match(f.info.querySelector('[data-economy-status]').textContent,/皮革仓满/);});
test('stale forms from another selection, old DOM, hidden panel or modal do nothing',()=>{for(const mode of ['selection','dom','hidden','modal']){const f=setup(),form=input(f,'pasture-stock-form');input(f,'pasture-stock-quantity').value=2;if(mode==='selection'){const other=f.building('pasture');f.select(other);}if(mode==='dom'){f.G.ui._infoWorld=null;f.G.ui.renderInfo(true);}if(mode==='hidden')f.info.classList.add('hidden');if(mode==='modal')f.G.hasOpenModal=()=>true;form.emit('submit');assert.equal(f.b.animals,0);assert.equal(f.G.game.livestock.sheep,4);}});
test('switching world/game with reused building ids makes old forms inert',()=>{const f=setup(),typeForm=input(f,'pasture-type-form'),stockForm=input(f,'pasture-stock-form');input(f,'pasture-type').value='cattle';const replacement={...f.b};f.G.world={...f.G.world,bmap:{[replacement.id]:replacement},buildings:[replacement]};f.G.game=f.G.newGameState();f.G.game.livestock={sheep:4,cattle:4};typeForm.emit('submit');stockForm.emit('submit');assert.equal(f.G.pastureTypeOf(replacement),'sheep');assert.equal(replacement.animals,0);assert.equal(f.G.game.livestock.cattle,4);});
test('trade quotes cattle as 800 value and actual purchase enters cattle bank rather than warehouse',()=>{const f=setup(),b=f.building('tradingpost');b.merchant={leaveDay:12,stock:{cattle:2}};b.tradeInventory={stone:229};f.select(b);input(f,'trade-good').value='cattle';input(f,'trade-payment').value='stone';input(f,'trade-buy-quantity').value=2;f.G.ui.refreshEconomyInfo(b);assert.match(live(f,'quote'),/229/);assert.match(live(f,'quote'),/单价 800/);assert(!input(f,'trade-execute').disabled);input(f,'trade-exchange-form').emit('submit');assert.equal(f.G.game.livestock.cattle,6);assert.equal(f.G.game.livestock.sheep,4);assert.equal(b.tradeInventory.stone,0);input(f,'trade-exchange-form').emit('submit');assert.equal(f.G.game.livestock.cattle,6);});
test('read-only focused pasture refresh leaves save state and species unchanged',()=>{const f=setup();input(f,'pasture-type').focus();const before=JSON.stringify(f.G.serializeGame());f.G.ui.renderInfo();f.G.ui.refreshEconomyInfo(f.b);assert.equal(JSON.stringify(f.G.serializeGame()),before);});
console.log(`Cattle pasture UI: ${passed} DOM/live-simulation suites passed (not browser/mobile).`);
