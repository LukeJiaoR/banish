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

let passed=0;function test(name,f){f();passed++;console.log('ok '+name);}
function pens(){const f=fixture(),G=f.G,a=f.building('pasture',{animals:12,animalTarget:12}),b=f.building('pasture',{animals:0,animalTarget:12});G.game.h=12;f.select(a);const get=id=>f.info.querySelector('#pasture-split-'+id);return {...f,a,b,get};}
test('split shows explicit aggregate placement and two-step confirmation, cancel changes no livestock',()=>{const f=pens(),{G,a,b,get}=f,before=JSON.stringify(G.serializeGame());assert(f.info.textContent.includes('不模拟逐头赶路'));assert(!get('start').disabled);get('start').click();assert.equal(f.doc.activeElement,get('confirm'));assert(f.info.querySelector('[data-pasture-split-quote]').textContent.includes('6头羊'));get('cancel').click();assert.equal(JSON.stringify(G.serializeGame()),before);assert.equal(a.animals,12);assert.equal(b.animals,0);assert.equal(f.doc.activeElement,get('start'));});
test('confirm moves exactly half once and repeated old confirmation cannot move another batch',()=>{const f=pens(),{G,a,b,get}=f;get('start').click();const confirm=get('confirm');confirm.click();assert.equal(a.animals,6);assert.equal(b.animals,6);confirm.click();assert.equal(a.animals+b.animals,12);assert(get('start').disabled);assert(f.info.textContent.includes('至少10头'));assert.equal(G.game.livestock.sheep,0);});
test('changing target or counts after viewing a quote cannot silently split to a different field or quantity',()=>{for(const mode of ['target','count','occupied','navigation','day','limit']){const f=pens(),{G,a,b,get}=f,c=f.building('pasture');G.ui.refreshEconomyInfo(a);get('start').click();if(mode==='target'){get('target').value=String(c.id);get('target').emit('change');}if(mode==='count')a.animals=11;if(mode==='occupied')b.animals=1;if(mode==='navigation')G.bumpNavigation(G.world);if(mode==='day')G.game.day++;if(mode==='limit')G.setPastureTarget(b,2);get('confirm').click();assert.equal(a.animals,mode==='count'?11:12);assert.equal(b.animals,mode==='occupied'?1:0);assert.equal(c.animals,0);}});
test('modal, dismissal/reopen, different selection, reloaded world/game and replaced targets keep old buttons inert',()=>{for(const mode of ['modal','dismiss','selection','world','game','target']){const f=pens(),{G,a,b,get}=f;get('start').click();const button=get('confirm');if(mode==='modal')G.hasOpenModal=()=>true;if(mode==='dismiss'){G.ui.hideInfo();f.select(a);}if(mode==='selection')f.select(b);if(mode==='world')G.world={...G.world};if(mode==='game')G.game={...G.game};if(mode==='target')G.world.bmap[b.id]={...b};button.click();assert.equal(a.animals,12,mode);assert.equal(b.animals,0,mode);}});
test('ordinary refresh is pure and does not pathfind, replace select/buttons or steal the focused target draft',()=>{const f=pens(),{G,a,get}=f;const select=get('target'),button=get('start'),before=JSON.stringify(G.serializeGame()),work=G.workSpot;let searches=0;G.workSpot=(...args)=>{searches++;return work(...args);};select.focus();for(let i=0;i<10;i++)G.ui.refreshEconomyInfo(a);assert.equal(searches,0);assert.equal(select,get('target'));assert.equal(button,get('start'));assert.equal(f.doc.activeElement,select);assert.equal(JSON.stringify(G.serializeGame()),before);button.click();assert.equal(searches,1);get('confirm').click();assert.equal(searches,2);});
test('unreachable destination explains the route failure before exposing confirmation',()=>{const f=pens(),{G,a,b,get}=f;for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+11]=1;G.bumpNavigation(G.world);get('start').click();assert(f.info.querySelector('[data-pasture-split-confirm]').classList.contains('hidden'));assert(f.info.querySelector('[data-economy-message]').textContent.includes('没有可达通路'));assert.equal(a.animals,12);assert.equal(b.animals,0);});
console.log('Pasture split UI: '+passed+' passed (DOM only)');
