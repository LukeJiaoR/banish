/* Resource-chain DOM contracts, not browser visual acceptance. */
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
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      emit(type) { for (const fn of handlers[type] || []) fn({target: this}); },
      click() { this.focus(); for (const fn of handlers.click || []) fn({ target: this }); },
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
            const a = Object.fromEntries(Array.from(token[3].matchAll(/([\w-]+)="([^"]*)"/g), match => [match[1], decode(match[2])]));
            const child = stack[stack.length - 1].appendChild(element(token[2], a));
            if (!['img', 'br', 'input'].includes(token[2])) stack.push(child);
          }
        }
      },
    };
  }
  function mount(id) { const el = element('div', { id }); roots.push(el); return el; }
  const ctx = { console, document: doc, __errs: [], setTimeout() {} };
  ctx.window = ctx; vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'ui'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  const info = mount('info'), guide = mount('guide');
  G.ui.el = { info, guide, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
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
  return { G, doc, info, guide, building, resident, homes, select, node, button };
}

let passed=0;
function test(name,fn){fn();console.log('ok '+name);passed++}
const live=(f,key)=>f.info.querySelector(`[data-resource-chain-live="${key}"]`);
test('new mine exposes only iron and coal; repeated changes preserve focused node and live facts',()=>{
 const f=fixture(),b=f.building('mine',{mineMode:'iron'});f.select(b);const select=f.doc.getElementById('mine-mode'),writes=f.info.htmlWrites;
 assert(select);assert.match(f.info.innerHTML,/value="iron" selected/);assert.doesNotMatch(f.info.innerHTML,/value="legacy"/);select.focus();
 for(const mode of ['coal','iron','coal']){select.value=mode;select.emit('change');assert.equal(f.G.mineModeOf(b),mode);assert(live(f,'production').textContent.includes(f.G.RES[mode].name));f.G.game.res[mode]=17;f.G.ui.renderInfo();assert.equal(f.doc.activeElement,select);assert.equal(f.doc.getElementById('mine-mode'),select);assert.match(live(f,'stock').textContent,/17/)}
 assert.equal(f.info.htmlWrites,writes);assert.match(f.info.innerHTML,/无限矿源/);
});
test('legacy mine stays mixed through refresh and permits explicit switch back',()=>{
 const f=fixture(),b=f.building('mine',{mineMode:'legacy',legacyMine:true});f.select(b);const select=f.doc.getElementById('mine-mode');assert.match(f.info.innerHTML,/value="legacy" selected/);for(let n=0;n<3;n++)f.G.ui.renderInfo();assert.equal(f.G.mineModeOf(b),'legacy');for(const mode of ['coal','iron','legacy']){select.value=mode;select.emit('change');assert.equal(f.G.mineModeOf(b),mode)}assert.match(live(f,'production').textContent,/石头.*铁.*旧档混采/);
});
test('blacksmith shows steel recipe inputs and output-specific target without touching accepted iron batch',()=>{
 const f=fixture(),b=f.building('blacksmith',{toolRecipe:'iron',toolLimit:30}),c=f.G.spawnCitizen({x:1,y:1,age:30,sex:'m',name:'铁匠'});c.job=b.id;b.workers=[c.id];const task=c.task={b,kind:'work',yield:{type:'tools',qty:2}};c.carry={type:'tools',qty:1};f.select(b);const select=f.doc.getElementById('tool-recipe');select.focus();select.value='steel';select.emit('change');assert.equal(f.G.blacksmithOutput(b),'steelTools');assert.equal(c.task,task);assert.equal(c.task.yield.type,'tools');assert.equal(c.carry.qty,1);assert.match(live(f,'recipe').textContent,/1 铁 \+ 2 木材 \+ 2 煤 → 2 钢工具/);assert.match(live(f,'batches').textContent,/铁工具 2.*铁工具 1/);assert.match(live(f,'inputs').textContent,/煤 0/);assert.match(live(f,'status').textContent,/煤需 2/);assert.match(live(f,'target').textContent,/本屋钢工具目标：30/);
 f.G.game.res.coal=9;f.G.game.res.iron=9;f.G.ui.renderInfo();assert.equal(f.doc.activeElement,select);assert.equal(f.doc.getElementById('tool-recipe'),select);assert.match(live(f,'inputs').textContent,/煤 9/);assert.equal(live(f,'status').textContent,'运作中');f.info.querySelector('[data-tl="10"]').click();assert.equal(b.toolLimit,40);assert.match(live(f,'target').textContent,/40/);
});
test('detached selectors cannot change another selection or a newly rendered panel of same building',()=>{
 const f=fixture(),b=f.building('mine',{mineMode:'iron'}),b2=f.building('mine',{mineMode:'iron'});f.select(b);const old=f.doc.getElementById('mine-mode');f.select(b2);old.value='coal';old.emit('change');assert.equal(b.mineMode,'iron');assert.equal(b2.mineMode,'iron');f.select(b);old.emit('change');assert.equal(b.mineMode,'iron');const current=f.doc.getElementById('mine-mode');delete f.G.world.bmap[b.id];current.value='coal';current.emit('change');assert.equal(b.mineMode,'iron');
});
test('new world, modal, site completion and invalid selection are guarded',()=>{
 const f=fixture(),b=f.building('blacksmith',{toolRecipe:'iron'});f.select(b);const select=f.doc.getElementById('tool-recipe');f.G.hasOpenModal=()=>true;select.value='steel';select.emit('change');assert.equal(b.toolRecipe,'iron');f.G.hasOpenModal=()=>false;select.value='invalid';select.emit('change');assert.equal(b.toolRecipe,'iron');assert.equal(select.value,'iron');f.G.world={...f.G.world};select.value='steel';select.emit('change');assert.equal(b.toolRecipe,'iron');
 const g=fixture(),site=g.building('mine',{state:'site',mineMode:'iron',progress:.5});g.select(site);assert.equal(g.doc.getElementById('mine-mode'),null);g.doc.getElementById('info-demolish').focus();site.state='ok';g.G.ui.renderInfo();assert(g.doc.getElementById('mine-mode'));assert.equal(g.doc.activeElement.id,'info-close');
});
test('quarry has current stone production and infinite-source explanation without a mine selector',()=>{
 const f=fixture(),b=f.building('stonequarry');f.select(b);assert.match(live(f,'production').textContent,/石头/);assert.match(f.info.innerHTML,/无限矿源/);assert.equal(f.doc.getElementById('mine-mode'),null);const old=f.info.htmlWrites;f.G.game.res.stone=123;f.G.ui.renderInfo();assert.equal(f.info.htmlWrites,old);assert.match(live(f,'stock').textContent,/123/);
});
test('both tool HUD chips show shared wear-adjusted days and coal full-cargo retention',()=>{
 const f=fixture();f.resident(f.building('house'));f.G.game.res.tools=1;f.G.game.res.steelTools=1;f.G.game.toolWear=.5;f.G.game.steelToolWear=.5;f.G.ui.refreshHUD();for(const k of ['tools','steelTools']){const title=f.doc.getElementById('res-'+k).title;assert.match(title,/不限仓储/);assert.match(title,/合计 2 件.*180 天/);assert.doesNotMatch(title,/undefined|NaN/)}const c=f.G.world.citizens[0];c.carry={type:'coal',qty:2};f.G.game.res.coal=f.G.storageCap();f.G.ui.refreshHUD();assert.match(f.doc.getElementById('res-coal').title,/仓满保留余矿/);
});
console.log(`Resource chain UI: ${passed} interaction suites passed (DOM fixture; no browser visual acceptance).`);
