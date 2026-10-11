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

test('real input cargo and each trip are described without claiming uncollected inputs',()=>{
 const f=fixture(),G=f.G,b=f.building('blacksmith',{toolRecipe:'steel',toolLimit:30}),c=G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];c.task={b,kind:'smith',phase:'fetch',consume:[{type:'iron',qty:1},{type:'wood',qty:2},{type:'coal',qty:2}],yield:{type:'steelTools',qty:2}};c.state='walk';c.walkKind='task';f.select(b);assert.match(G.ui.citizenStatus(c),/尚未扣料/);assert.match(live(f,'batches').textContent,/取料途中，未扣原料/);assert.match(live(f,'logistics').textContent,/整批扣料.*通用仓库.*读档/);
 c.carry={type:'iron',qty:1,extra:{wood:2,coal:2},smithInput:true,staffingReturn:true};c.task.phase='process';G.ui.renderInfo();assert.match(G.ui.citizenStatus(c),/返回铁匠铺/);assert.match(live(f,'batches').textContent,/原料已出库：铁 1.*木材 2.*煤 2.*返回铁匠铺/);c.state='work';assert.match(G.ui.citizenStatus(c),/使用随身已取原料/);c.pausedTask=c.task;c.task=null;c.state='rest';G.ui.renderInfo();assert.match(live(f,'batches').textContent,/夜间暂停/);
});
test('recipe selector and repeated readonly refresh retain node, focus and raw batch identity',()=>{
 const f=fixture(),G=f.G,b=f.building('blacksmith',{toolRecipe:'steel',toolLimit:30}),c=G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];const cargo=c.carry={type:'iron',qty:1,extra:{wood:2,coal:2},smithInput:true,staffingReturn:true},t=c.task={b,kind:'smith',phase:'process',yield:{type:'steelTools',qty:2},inputCargo:cargo};c.state='walk';f.select(b);const select=f.doc.getElementById('tool-recipe'),writes=f.info.htmlWrites,stock=JSON.stringify(G.game.res);select.focus();select.value='iron';select.emit('change');for(let n=0;n<10;n++)G.ui.renderInfo();assert.equal(f.doc.activeElement,select);assert.equal(f.doc.getElementById('tool-recipe'),select);assert.equal(f.info.htmlWrites,writes);assert.equal(c.carry,cargo);assert.equal(c.task,t);assert.equal(JSON.stringify(G.game.res),stock);assert.match(live(f,'batches').textContent,/钢工具 2.*煤 2/);assert.match(live(f,'recipe').textContent,/铁工具/);assert.match(live(f,'inputs').textContent,/不含已出库批次/);
});
test('cancelled batch and partial raw return are visible including all remaining resources',()=>{
 const f=fixture(),G=f.G,b=f.building('blacksmith',{toolRecipe:'steel',toolLimit:30}),c=G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];c.carry={type:'wood',qty:1.5,extra:{coal:2},smithInput:true,staffingReturn:true};c.state='waitStorage';c.haulPending=true;c.haulWait='space';G.game.res.wood=G.storageCap('wood');f.select(b);assert.match(live(f,'batches').textContent,/退回原料 木材 1.5.*煤 2.*仓满/);assert.match(G.ui.citizenStatus(c),/仓满/);c.state='haul';assert.match(G.ui.citizenStatus(c),/退回铁匠原料/);G.sel={kind:'c',id:c.id};G.ui.showInfo();assert.match(f.info.innerHTML,/木材 1.5.*煤 2.*尚未消耗/);c.carry={type:'tools',qty:2};c.state='haul';assert.doesNotMatch(G.ui.citizenStatus(c),/原料/);
});
console.log('Blacksmith input UI: '+passed+' passed (DOM, not browser acceptance)');
