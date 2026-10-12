/* Deer hunting details use real game APIs.
 * These are DOM/live-simulation contracts, not browser/mobile visual acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function fixture() {
  const roots = [], documentEvents = {};
  const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g,
    (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[key]));
  const doc = { activeElement: null, addEventListener(type, fn) { (documentEvents[type] ||= []).push(fn); },
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
      emit(type, detail = 1) {
        const event = { target: this, type, ...(typeof detail === 'object' ? detail : { detail }), defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
        for (const fn of handlers[type] || []) fn(event);
        return event;
      },
      click(detail = 1) { if (roots.some(root => root.contains(this))) this.focus(); return this.emit('click', detail); },
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
  const windowEvents = {};
  const ctx = { console, performance: { now: () => 0 }, setInterval() {}, requestAnimationFrame() {}, innerWidth: 1200, innerHeight: 800, document: doc, __errs: [], setTimeout() {}, addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); }, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'render', 'ui', 'main'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 64;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  G.markGroundDirty = () => {}; G.autosave = () => {};
  const generate = G.genWorld;
  G.genWorld = (seed, options) => { const w = generate(seed, options); w.water.fill(0); w.rock.fill(0); return w; };
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar');
  G.ui.el = { info, guide, toolbar, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
  const toasts = []; G.ui.toast = (...args) => toasts.push(args);
  G.game.res.wood = 1000; G.game.res.stone = 1000;
  G.ui.refreshHUD = () => { if (G.ui.refreshOrchardPlanControls) G.ui.refreshOrchardPlanControls(); }; 
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
  function windowEvent(type, props = {}) { for (const fn of windowEvents[type] || []) fn({ type, preventDefault() {}, stopImmediatePropagation() {}, ...props }); }
  function documentEvent(type, props = {}) { for (const fn of documentEvents[type] || []) fn({ type, preventDefault() {}, ...props }); }
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, mount, element, toasts, windowEvent, documentEvent }; 
}

let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
function setup(){const f=fixture(),G=f.G;G.game.h=12;f.b=f.building('hunting',{huntingReadyDay:0});
 G.world.deer=Array.from({length:24},(_,i)=>({id:i+1,x:8+i%3,y:5+Math.floor(i/3),homeX:8+i%3,homeY:5+Math.floor(i/3),returnDay:i<3?null:20,moveDay:1}));
 for(const d of G.world.deer.slice(0,3)){const t={x:d.x,y:d.y,b:-48};t.i=t.y*G.world.N+t.x;G.world.treeIdx[t.i]=G.world.trees.length;G.world.trees.push(t);}
 f.select(f.b);return f;}
const row=(f,k)=>f.info.querySelector(`[data-hunting="${k}"]`).textContent;
test('hunting and forester descriptions retain distinct production and cut/plant contracts',()=>{const f=setup(),G=f.G;assert.match(G.BDEF.hunting.desc,/方形圈/);assert.match(G.BDEF.hunting.desc,/8天/);assert.match(G.BDEF.forester.desc,/专业护林人/);assert.match(G.BDEF.forester.desc,/可分别关闭砍伐\/补种/);assert(!G.BDEF.forester.desc.includes('每只鹿产肉'));});
test('cabin panel shows actual available deer, shared cooldown, adapted yields and physical delivery',()=>{const f=setup();assert.match(row(f,'prey'),/圈内 3 只/);assert.match(row(f,'prey'),/可达 3 只/);assert.match(row(f,'cooldown'),/8 天/);assert.match(row(f,'batch'),/160.*200.*4.*6/);assert.match(row(f,'delivery'),/走到可达通用仓才入库/);assert.match(row(f,'source'),/本作适配/);assert(!f.info.textContent.includes('砍伐、建造清林会影响产出'));});
test('timed cooldown and loss refresh retain focused workforce controls',()=>{const f=setup(),el=f.info.querySelector('#worker-limit-input');assert(el);el.value='1';el.focus();const writes=f.info.htmlWrites;f.b.huntingReadyDay=8.5;f.G.game.huntingLost={meat:3,leather:2};f.G.ui.renderInfo();assert.equal(f.doc.activeElement,el);assert.equal(el.value,'1');assert.equal(f.info.htmlWrites,writes);assert.match(row(f,'cooldown'),/8.0 天/);assert.match(row(f,'losses'),/肉 3、皮革 2/);f.G.game.day=8;f.G.ui.renderInfo();assert.match(row(f,'cooldown'),/已就绪/);});
test('paused hut, another selection and close/reopen use current facts',()=>{const f=setup();f.b.workerLimit=0;f.G.ui.renderInfo();assert.match(row(f,'status'),/暂停/);const other=f.building('hunting',{huntingReadyDay:0});f.select(other);assert.match(row(f,'cooldown'),/已就绪/);f.G.ui.hideInfo();assert.equal(f.G.sel,null);f.select(f.b);assert.match(row(f,'status'),/暂停/);});
test('placement gives prey rather than a false minimum mature-tree production requirement',()=>{const f=setup(),G=f.G,before=JSON.stringify([G.game,G.world.deer]);const p=G.placementInfo('hunting',4,4);assert.match(p.text,/圈内 3 只/);assert.match(p.text,/最多2名猎人/);assert(!p.text.includes('至少需 10'));assert(!p.text.includes('产量随成熟林增加'));assert.equal(JSON.stringify([G.game,G.world.deer]),before);G.world.deer.forEach(d=>d.returnDay=20);const empty=G.placementInfo('hunting',4,4);assert(empty.warning);assert.match(empty.text,/没有可达/);});
test('placement excludes deer inside footprint and does not offer blocked prey',()=>{const f=setup(),G=f.G;G.world.deer[0].x=4;G.world.deer[0].y=4;G.world.deer[1].returnDay=G.world.deer[2].returnDay=20;const t={x:5,y:4,b:-48,i:4*64+5};G.world.treeIdx[t.i]=G.world.trees.length;G.world.trees.push(t);const p=G.placementInfo('hunting',4,4);assert.equal(p.hunting.reachable,0);assert(p.warning);});
test('real claim and worker changes refresh without rebuilding the selected panel',()=>{const f=setup(),G=f.G,c=G.spawnCitizen({x:5,y:4,age:30,sex:'m',name:'追踪者'});c.job=f.b.id;f.b.workers=[c.id];G.requestTask(c);assert.equal(c.task?.kind,'hunt');G.ui.renderInfo();assert.match(row(f,'prey'),/未被追踪 2 只/);assert.match(row(f,'status'),/已有猎人/);assert.equal(f.info.querySelector('[data-hunting-workers]').textContent,c.name);c.task=null;c.pausedTask=null;f.b.workers=[];c.job=null;G.ui.renderInfo();assert.match(row(f,'prey'),/未被追踪 3 只/);assert.equal(f.info.querySelector('[data-hunting-workers]').textContent,'无');});
test('hunter feedback distinguishes pursuit, work and actual mixed shipment',()=>{const f=setup(),G=f.G,c=G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.job=f.b.id;c.task={kind:'hunt',deerId:2};c.state='walk';assert.match(G.ui.citizenStatus(c),/追踪鹿 #2/);c.state='work';assert.match(G.ui.citizenStatus(c),/完成后才获得/);c.state='haul';c.carry={type:'meat',qty:160,extra:{leather:4},staffingReturn:true,huntingId:0};assert.match(G.ui.citizenStatus(c),/运送遗留肉皮入仓/);c.carry.huntingId=f.b.id;assert.match(G.ui.citizenStatus(c),/运送猎物入仓/);assert.match(G.ui.cargoText(c.carry),/160/);});
console.log(`Deer UI: ${passed} DOM/live-game suites passed (not browser acceptance).`);
