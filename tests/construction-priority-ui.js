/* Classified public stockpile capacity and transport facts. DOM only. */
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



let passed=0;function test(n,f){f();passed++;console.log('ok '+n);}
function finish(f){const G=f.G;G.game.h=12;G.scheduleJobs=()=>{};const c=G.spawnCitizen({x:f.b.x-1,y:f.b.y,age:30,sex:'m'});G.assignWorker(f.b,c);for(let i=0;i<6000&&f.b.state==='site';i++)G.stepCitizen(c,.1);assert.equal(f.b.state,'ok');}
const setup=()=>{const f=fixture();f.b=f.building('house',{state:'site',progress:.2,workLeft:72,constructionStarted:true,paidCost:{wood:16,stone:8}});f.select(f.b);return f;};
test('existing site panel adds two fixed-intent controls without a new menu or material charge',()=>{const f=setup(),{G}=f,high=f.doc.getElementById('construction-priority'),normal=f.doc.getElementById('construction-normal'),before=JSON.stringify(G.game.res);assert(!high.disabled);assert(normal.disabled);high.click();assert(f.b.sitePriority);assert(high.disabled);assert(!normal.disabled);assert.match(f.info.querySelector('[data-workforce="rule"]').textContent,/优先施工.*不保证/);assert.equal(JSON.stringify(G.game.res),before);high.click();assert(f.b.sitePriority);normal.click();assert(!f.b.sitePriority);});
test('focus and current priority update in place, pause wins without clearing rank',()=>{const f=setup(),{G}=f,high=f.doc.getElementById('construction-priority'),writes=f.info.htmlWrites;high.click();assert.equal(f.doc.activeElement,f.doc.getElementById('construction-normal'));for(let i=0;i<10;i++)G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.equal(f.doc.getElementById('construction-priority'),high);f.doc.getElementById('construction-pause').click();assert(f.b.sitePaused);assert(f.b.sitePriority);assert.match(f.info.querySelector('[data-workforce="reason"]').textContent,/暂停/);});
test('old callbacks after selection, world reload, dismissal or completion cannot change new entities',()=>{for(const mode of ['selection','load','hide','finish']){const f=setup(),{G}=f,old=f.doc.getElementById('construction-priority');if(mode==='selection')f.select(f.building('house',{state:'site',progress:0,workLeft:90}));if(mode==='load'){f.mount('over');G.applySaveData(JSON.parse(JSON.stringify(G.serializeGame())));f.select(G.world.bmap[f.b.id]);}if(mode==='hide')G.ui.hideInfo();if(mode==='finish'){finish(f);G.ui.renderInfo();}old.click();assert(!G.world.bmap[f.b.id].sitePriority);}});
test('modal and double-click guards preserve one priority gesture and completion moves focus to close',()=>{const f=setup(),{G}=f,high=f.doc.getElementById('construction-priority');G.hasOpenModal=()=>true;high.click();assert(!f.b.sitePriority);G.hasOpenModal=()=>false;high.emit('click',{detail:2});assert(!f.b.sitePriority);high.click();const normal=f.doc.getElementById('construction-normal');normal.focus();finish(f);G.ui.renderInfo();assert.equal(f.doc.activeElement,f.doc.getElementById('info-close'));assert(!f.doc.getElementById('construction-normal'));});
console.log('Construction priority UI: '+passed+' passed (DOM only)');
