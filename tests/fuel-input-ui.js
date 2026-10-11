/* Fuel budget feedback: read-only estimates, real control handlers, and simulation
 * boundaries. Run: node tests/fuel-budget-feedback.js [checkout]
 * The small DOM fixture checks text/focus/identity contracts, not browser layout,
 * native keyboard activation, screenshots, or visual acceptance.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

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
          const data = selector.match(/^\[data-([^=]+)="([^"]*)"\]$/);
          return data ? child.dataset[data[1]] === data[2] : child.tagName === selector.toUpperCase();
        });
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      focus() { doc.activeElement = this; },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
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
function state(G) {
  return JSON.stringify({ game: G.game, world: G.world, sel: G.sel,
    marked: Array.from(G.world.marked), markedRocks: Array.from(G.world.markedRocks) });
}
function assertSharedText(f) {
  f.G.ui.refreshHUD(); f.G.ui.renderInfo();
  const text = f.G.ui.heatDemandText(f.G.ui.heatDemand());
  assert.ok(f.doc.getElementById('res-firewood').title.includes(text));
  assert.equal(f.node('heat').textContent, text);
  const heat = f.G.ui.heatDemand(), need = heat.winter ? heat.futureWinter : heat.fullWinter;
  if (f.G.game.season >= 2 && f.G.game.res.firewood < need)
    assert.ok(f.guide.textContent.includes(`${heat.winter ? '本冬此后' : '整冬'}约需 ${Math.ceil(need)}`));
}
let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
test('fuel panel distinguishes public wood, real raw cargo, paused cutting and actual delivered stock',()=>{const f=fixture(),{G}=f,b=f.building('woodcutter');G.game.res.wood=2;G.game.res.firewood=0;const c=G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];c.task={kind:'fuel',phase:'fetch',b};c.state='walk';c.walkKind='task';f.select(b);assert.match(f.node('batches').textContent,/尚未扣料/);assert.match(G.ui.citizenStatus(c),/取原木.*尚未扣料/);G.game.res.wood=0;c.carry={type:'wood',qty:2,fuelInput:true,staffingReturn:true};c.task.phase='process';G.ui.renderInfo();assert.match(f.node('batches').textContent,/原木 2.00 已出库.*携木回屋/);assert.match(G.ui.citizenStatus(c),/携原木返回伐木屋/);c.state='work';G.ui.renderInfo();assert.match(f.node('batches').textContent,/在屋劈柴/);assert.match(G.ui.citizenStatus(c),/使用随身已取原木/);c.pausedTask=c.task;c.task=null;c.state='rest';G.ui.renderInfo();assert.match(f.node('batches').textContent,/夜间暂停/);});
test('raw refund and partial finished firewood are visible without claiming immediate warehouse stock',()=>{const f=fixture(),{G}=f,b=f.building('woodcutter'),c=G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];c.carry={type:'wood',qty:.5,fuelInput:true,staffingReturn:true};c.state='haul';f.select(b);assert.match(f.node('batches').textContent,/0.50 已出库.*中断后退仓/);assert.match(G.ui.citizenStatus(c),/退回未使用的原木/);c.carry={type:'firewood',qty:4,firewoodId:b.id};c.state='waitStorage';c.haulPending=true;c.haulWait='space';G.game.res.firewood=G.storageCap('firewood');G.ui.renderInfo();assert.match(f.node('batches').textContent,/已产柴火 4.00.*仓满/);});
test('new batch rows refresh in place and never mutate cargo, task, target or focused controls',()=>{const f=fixture(),{G}=f,b=f.building('woodcutter'),c=G.spawnCitizen({x:1,y:1,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];c.task={kind:'fuel',phase:'fetch',b};c.state='walk';f.select(b);const plus=f.button(50);plus.focus();const row=f.node('batches'),before=state(G),writes=f.info.htmlWrites;for(let i=0;i<50;i++)G.ui.renderInfo();assert.equal(f.node('batches'),row);assert.equal(f.doc.activeElement,plus);assert.equal(f.info.htmlWrites,writes);assert.equal(state(G),before);});
console.log('Fuel input UI: '+passed+' passed (DOM only)');
