/* Cemetery capacity, grief details and stable demolition controls. DOM only. */
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
const field=(f,k)=>f.info.querySelector(`[data-cemetery="${k}"]`);
function grave(b,G,name='测试逝者'){b.graves=b.graves||[];b.graves.push({slot:b.graves.length,name,deathDay:G.game.day,expiresDay:G.game.day+192});}
test('empty and occupied cemeteries explain capacity, timing, route and demolition limits',()=>{const f=fixture(),{G}=f,b=f.building('cemetery');f.select(b);assert.match(field(f,'capacity').textContent,/0 \/ 8/);assert.match(field(f,'status').textContent,/可达/);grave(b,G);G.ui.renderInfo();assert.match(field(f,'capacity').textContent,/1 \/ 8/);assert.match(field(f,'expiry').textContent,/192/);assert.match(field(f,'removal').textContent,/拆围栏前先预览并确认/);});
test('timed updates keep the focused demolition button and panel nodes stable',()=>{const f=fixture(),{G}=f,b=f.building('cemetery');f.select(b);const button=f.doc.getElementById('info-demolish'),node=field(f,'capacity'),writes=f.info.htmlWrites;button.focus();grave(b,G);for(let i=0;i<12;i++)G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.equal(f.doc.activeElement,button);assert.equal(field(f,'capacity'),node);assert.match(node.textContent,/1 \/ 8/);});
test('occupied demolition action cannot erase grave records or refund materials',()=>{const f=fixture(),{G}=f,b=f.building('cemetery');grave(b,G);f.select(b);const before=JSON.stringify(G.game.res);f.doc.getElementById('info-demolish').click();assert.equal(G.world.bmap[b.id],b);assert.equal(b.graves.length,1);assert.equal(JSON.stringify(G.game.res),before);});
test('full/expiry facts update while retained records remain read-only',()=>{const f=fixture(),{G}=f,b=f.building('cemetery');for(let i=0;i<8;i++)grave(b,G);f.select(b);assert.match(field(f,'status').textContent,/已满/);G.game.day=192;const before=JSON.stringify(b.graves);G.ui.renderInfo();assert.match(field(f,'capacity').textContent,/0 \/ 8/);assert.match(field(f,'removal').textContent,/拆围栏前先预览并确认/);assert.equal(JSON.stringify(b.graves),before);});
test('citizen grief is escaped and refreshed in the existing happiness panel',()=>{const f=fixture(),{G}=f,c=f.resident(f.building('house'));c.grief={loss:1,days:48,name:'<script>亲属</script>',buried:false};G.sel={kind:'c',id:c.id};G.ui.showInfo();let node=f.info.querySelector('[data-citizen-leisure="grief"]');assert.match(node.textContent,/−1.00/);assert.match(node.textContent,/48/);assert.equal(f.info.querySelector('script'),null);const button=f.doc.getElementById('info-close');button.focus();c.grief.loss=.25;c.grief.days=12;c.grief.buried=true;G.ui.renderInfo();assert.equal(f.info.querySelector('[data-citizen-leisure="grief"]'),node);assert.match(node.textContent,/已安葬/);assert.match(node.textContent,/−0.25/);assert.match(f.info.querySelector('[data-citizen-leisure="work"]').textContent,/无负惩罚/);});
test('old same-ID village DOM cannot demolish a freshly loaded cemetery',()=>{const f=fixture(),{G}=f,b=f.building('cemetery');f.select(b);const old=f.doc.getElementById('info-demolish'),d=JSON.parse(JSON.stringify(G.serializeGame()));f.mount('over');G.applySaveData(d);const loaded=G.world.bmap[b.id];f.select(loaded);old.click();assert.equal(G.world.bmap[b.id],loaded);assert.notEqual(loaded,b);});
test('site completion re-renders the real grave panel and no grave list is shown on construction',()=>{const f=fixture(),{G}=f,b=f.building('cemetery',{state:'site',progress:0,workLeft:80});f.select(b);assert.equal(field(f,'capacity'),null);const old=f.doc.getElementById('info-demolish');old.focus();b.state='ok';b.progress=1;b.workLeft=0;G.ui.renderInfo();assert(field(f,'capacity'));old.click();assert.equal(G.world.bmap[b.id],b);});
console.log(`Cemetery UI: ${passed} passed (DOM only)`);
