/* Crop, seed-trade DOM and live-simulation contracts, not browser visual acceptance. */
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

let passed=0;function test(name,f){f();passed++;console.log('ok '+name);}
function ready(){const f=fixture(),G=f.G,b=f.building('farm');f.building('storage');G.game.h=12;G.game.day=12;G.game.season=1;G.game.townLedger=G.newTownLedger(G.game);G.game.res.tools=20;for(const t of b.farm)t.sown=true;b.sownAll=true;b.growth=.5;f.select(b);const get=id=>f.info.querySelector('#early-harvest-'+id);return {...f,b,get};}
test('two-step quote explains locked yield and cancellation leaves crop and stock unchanged',()=>{const f=ready(),{G,b,get}=f,res=JSON.stringify(G.game.res);assert(f.info.textContent.includes('提前抢收'));assert(f.info.textContent.includes('448'));assert(f.info.textContent.includes('896'));get('start').click();assert.equal(f.doc.activeElement,get('confirm'));assert(f.info.querySelector('[data-early-harvest-quote]').textContent.includes('不可撤回'));assert(!b.earlyHarvestYield);get('cancel').click();assert(!b.earlyHarvestYield);assert.equal(JSON.stringify(G.game.res),res);assert(f.info.querySelector('[data-early-harvest-confirm]').classList.contains('hidden'));assert.equal(f.doc.activeElement,get('start'));});
test('confirmation makes one reduced-yield order, no instant food, and a repeat cannot resow or reprice',()=>{const f=ready(),{G,b,get}=f,res=JSON.stringify(G.game.res);get('start').click();get('confirm').click();assert.equal(b.earlyHarvestYield,7);assert.equal(JSON.stringify(G.game.res),res);assert(get('start').disabled);assert(f.info.textContent.includes('本季已确认抢收'));assert(f.info.querySelector('[data-farm="yield"]').textContent.includes('每格 7'));get('confirm').click();get('start').click();assert.equal(b.earlyHarvestYield,7);assert.equal(JSON.stringify(G.game.res),res);});
test('a changed growth/day/tool quote resets confirmation rather than accepting unseen terms',()=>{for(const viaRefresh of [false,true]){const f=ready(),{G,b,get}=f;get('start').click();b.growth=.75;if(viaRefresh)G.ui.refreshFarmInfo(b);get('confirm').click();assert(!b.earlyHarvestYield);assert(f.info.querySelector('[data-early-harvest-confirm]').classList.contains('hidden'));assert(f.info.querySelector('[data-farm-message]').textContent.includes('重新确认'));get('start').click();get('confirm').click();assert.equal(b.earlyHarvestYield,10);}});
test('old confirmation callbacks after select/hide/replace/load-style world or game changes cannot order a new crop',()=>{for(const mode of ['selection','hidden','panel','world','game','entity','winter','spring']){const f=ready(),{G,b,get}=f;get('start').click();const button=get('confirm');if(mode==='selection')G.sel={kind:'b',id:9999};if(mode==='hidden')f.info.classList.add('hidden');if(mode==='panel'){f.select(G.world.buildings.find(x=>x.type==='storage'));f.select(b);}if(mode==='world')G.world={...G.world};if(mode==='game')G.game={...G.game};if(mode==='entity')G.world.bmap[b.id]={...b};if(mode==='winter')G.game.season=3;if(mode==='spring'){G.game.season=0;G.game.year++;G.resetFarm(b,true);}button.click();assert(!b.earlyHarvestYield,mode);}});
test('modal interruption, no-start confirmation and unavailable fields are safe with clear reasons',()=>{const f=ready(),{G,b,get}=f;get('confirm').click();assert(!b.earlyHarvestYield);get('start').click();G.hasOpenModal=()=>true;G.ui.refreshFarmInfo(b);get('confirm').click();assert(!b.earlyHarvestYield);G.hasOpenModal=()=>false;b.growth=0;G.ui.refreshFarmInfo(b);assert(get('start').disabled);assert(f.info.textContent.includes('成长不足'));b.growth=.5;b.sownAll=false;G.ui.refreshFarmInfo(b);assert(f.info.textContent.includes('全田播完'));G.game.season=3;G.ui.refreshFarmInfo(b);assert(f.info.textContent.includes('冬季休耕'));});
test('live refresh keeps original buttons/focus and reading never changes simulation state',()=>{const f=ready(),{G,b,get}=f,button=get('start'),snapshot=JSON.stringify(G.serializeGame());button.focus();for(let i=0;i<5;i++)G.ui.refreshFarmInfo(b);assert.equal(button,get('start'));assert.equal(f.doc.activeElement,button);assert.equal(JSON.stringify(G.serializeGame()),snapshot);});
console.log('Early harvest UI: '+passed+' passed (DOM only)');
