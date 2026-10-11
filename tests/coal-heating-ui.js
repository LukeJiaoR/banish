/* Global coal-heating policy in existing housing, stable controls and precise facts. DOM only. */
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
const node=(f,k)=>f.info.querySelector(`[data-heating="${k}"]`);
function setup(type='house'){const f=fixture(),b=f.building(type);f.resident(b);f.b=b;f.select(b);return f;}
function apply(f,mode='coal',reserve='20'){f.doc.getElementById('heating-mode').value=mode;f.doc.getElementById('heating-reserve').value=reserve;f.doc.getElementById('heating-apply').click();}
test('all three existing home types expose the same explicit global policy and budget',()=>{for(const type of ['house','stonehouse','boarding']){const f=setup(type);assert.match(node(f,'policy').textContent,/仅烧柴/);assert.match(node(f,'rule').textContent,/全镇先烧柴/);assert.match(node(f,'rule').textContent,/1煤=2柴/);assert.match(node(f,'rule').textContent,/下一次冬季日界/);apply(f);assert(f.G.heatingPolicy().allowCoal);assert.match(node(f,'policy').textContent,/允许煤/);}});
test('applying policy does not burn stock and invalid form values cannot change it',()=>{const f=setup(),{G}=f,before=JSON.stringify(G.game.res);apply(f,'coal','12');assert.equal(G.heatingPolicy().coalReserve,12);assert.equal(JSON.stringify(G.game.res),before);for(const [m,n]of [['bad','20'],['wood',''],['wood','1.5'],['wood','-1']]){apply(f,m,n);assert(G.heatingPolicy().allowCoal);assert.equal(G.heatingPolicy().coalReserve,12);assert.match(f.info.querySelector('[data-heating-message]').textContent,/有效/);}});
test('repeated live refreshes preserve a typed reserve draft, focus and current controls',()=>{const f=setup(),{G}=f,input=f.doc.getElementById('heating-reserve'),button=f.doc.getElementById('heating-apply'),writes=f.info.htmlWrites;input.value='77';input.focus();G.game.res.coal=60;for(let i=0;i<10;i++)G.ui.renderInfo();assert.equal(input.value,'77');assert.equal(f.doc.activeElement,input);assert.equal(f.info.htmlWrites,writes);assert.equal(f.doc.getElementById('heating-apply'),button);assert.match(node(f,'stock').textContent,/60.00/);});
test('real winter receipts show separate coal use, inadequate heat and remain visible after reload',()=>{const f=setup(),{G}=f;f.mount('over');G.game.res.firewood=1;G.game.res.coal=20.25;G.setHeatingPolicy(true,20);G.game.day=35;G.game.season=2;G.game.h=23.9;G.game.townLedger=G.newTownLedger(G.game);G.advanceSim(.2);G.ui.renderInfo();assert.match(node(f,'receipt').textContent,/实际烧柴 1.00、煤 0.25/);assert.match(node(f,'home').textContent,/未供暖/);const d=JSON.parse(JSON.stringify(G.serializeGame()));G.applySaveData(d);f.b=G.world.bmap[f.b.id];f.select(f.b);assert.match(node(f,'receipt').textContent,/煤 0.25/);assert.match(node(f,'home').textContent,/未供暖/);});
test('switching policy makes budget warnings use only permitted coal above the reserve',()=>{const f=setup(),{G}=f;f.building('woodcutter');G.game.day=24;G.game.season=2;G.game.res.firewood=0;G.game.res.coal=40;G.ui.refreshGuide();assert.match(f.guide.textContent,/柴火不足/);G.setHeatingPolicy(true,20);G.ui.refreshGuide();assert.doesNotMatch(f.guide.textContent,/取暖燃料不足|柴火不足/);G.setHeatingPolicy(true,30);G.ui.refreshGuide();assert.match(f.guide.textContent,/取暖燃料不足/);});
test('stale controls after selecting another house, loading or upgrading cannot change the policy',()=>{for(const mode of ['selection','load','upgrade']){const f=setup(),{G}=f,old=f.doc.getElementById('heating-apply');f.doc.getElementById('heating-mode').value='coal';if(mode==='selection')f.select(f.building('stonehouse'));if(mode==='load'){f.mount('over');G.applySaveData(JSON.parse(JSON.stringify(G.serializeGame())));f.select(G.world.bmap[f.b.id]);}if(mode==='upgrade'){f.b.type='stonehouse';f.b.state='site';}old.click();assert.equal(G.heatingPolicy().allowCoal,false);}});
test('same-ID legacy reload defaults to wood and clears prior coal receipt without mutating stocks',()=>{const f=setup(),{G}=f;f.mount('over');G.setHeatingPolicy(true,0);const d=JSON.parse(JSON.stringify(G.serializeGame()));delete d.game.heating;G.applySaveData(d);f.b=G.world.bmap[f.b.id];f.select(f.b);assert.match(node(f,'policy').textContent,/仅烧柴/);assert.match(node(f,'receipt').textContent,/暂无/);assert.equal(f.doc.getElementById('heating-mode').value,'wood');});
console.log(`Coal heating UI: ${passed} passed (DOM only)`);
