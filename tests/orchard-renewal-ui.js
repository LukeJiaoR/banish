/* Orchard controls and per-tree feedback. DOM fixture, not browser acceptance. */
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
function setup(){const f=fixture();f.b=f.building('orchard',{orchardTrees:f.G.newOrchardTrees(),orchardDay:0,orchardReplant:true});f.G.game.unlocks.orchard=true;f.select(f.b);return f;}
const input=(f,id)=>f.info.querySelector('#'+id),live=(f,k)=>f.info.querySelector('[data-economy-live="orchard-'+k+'"]').textContent;
test('future 50-fruit help distinguishes existing fruit and actual storage from the seasonal maximum',()=>{const f=setup();assert.match(f.info.innerHTML,/每株未来秋季最多50果，已结旧果不补发，搬运后才入库/);assert.match(f.G.BDEF.orchard.desc,/9株、2名农夫/);assert.match(f.G.BDEF.orchard.desc,/50果（全园450）/);});
test('nine empty slots and applied replant choice are explicit; selecting alone does not apply',()=>{const f=setup();assert.match(live(f,'age'),/空位 9.*幼树 0.*成树 0/);input(f,'orchard-replant').value='off';f.G.ui.refreshEconomyInfo(f.b);assert(f.b.orchardReplant);assert.match(live(f,'renewal'),/允许/);input(f,'orchard-replant-form').emit('submit');assert.equal(f.b.orchardReplant,false);assert.match(live(f,'renewal'),/暂停/);assert.match(f.info.querySelector('[data-economy-message]').textContent,/已开始的工作继续/);});
test('per-tree age fruit and warning reflect actual trees without mutating stock or swallowing edited value',()=>{const f=setup(),t=f.b.orchardTrees[0];Object.assign(t,{planted:true,age:f.G.orchardLifetime(0)-20,fruit:17,season:1});f.G.syncOrchardTotals(f.b);f.G.game.season=2;const field=input(f,'orchard-replant');field.value='off';field.focus();const before=JSON.stringify(f.G.serializeGame()),writes=f.info.htmlWrites;for(let i=0;i<20;i++)f.G.ui.renderInfo();assert.equal(JSON.stringify(f.G.serializeGame()),before);assert.equal(field.value,'off');assert.equal(f.doc.activeElement,field);assert.equal(f.info.htmlWrites,writes);assert.match(live(f,'renewal'),/一年内将枯尽 1.*20 树龄日/);assert.match(live(f,'harvest'),/本季未采果实合计 17/);assert.match(live(f,'trees'),/第1株.*待采蔬菜 17/);});
test('stale selection old DOM hidden panel modal and changed world cannot apply replant',()=>{for(const mode of ['selection','dom','hidden','modal','world']){const f=setup(),form=input(f,'orchard-replant-form');input(f,'orchard-replant').value='off';if(mode==='selection')f.select(f.building('orchard'));if(mode==='dom'){f.G.ui._infoWorld=null;f.G.ui.renderInfo(true);}if(mode==='hidden')f.info.classList.add('hidden');if(mode==='modal')f.G.hasOpenModal=()=>true;if(mode==='world'){f.G.world={...f.G.world};f.G.game=f.G.newGameState();}form.emit('submit');assert(f.b.orchardReplant);}});
test('actual save load with reused id rejects detached original form',()=>{const f=setup(),form=input(f,'orchard-replant-form');input(f,'orchard-replant').value='off';f.mount('over');f.G.T2S=(x,y)=>[x,y];f.G.cam={x:0,y:0,z:1};f.G.groundDirty=new Set();const id=f.b.id;f.G.applySaveData(JSON.parse(JSON.stringify(f.G.serializeGame())));form.emit('submit');assert(f.G.world.bmap[id].orchardReplant);});
test('citizen feedback names exact tree and distinguishes walking from work',()=>{const f=setup(),c=f.G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.job=f.b.id;c.task={kind:'orchard',b:f.b,ti:3,phase:'plant'};c.state='walk';c.walkKind='task';assert.match(f.G.ui.citizenStatus(c),/前往空树位.*第4株/);c.state='work';assert.match(f.G.ui.citizenStatus(c),/种植果树.*第4株/);c.task.phase='harvest';assert.match(f.G.ui.citizenStatus(c),/采收果实/);});
console.log('Orchard renewal UI: '+passed+' passed (DOM only)');
