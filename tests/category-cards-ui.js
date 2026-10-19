/* Category-card DOM and stylesheet contracts, not browser/mobile visual acceptance. */
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
      tagName: tag.toUpperCase(), id: attrs.id || '', value: attrs.value || '', dataset: Object.fromEntries(Object.entries(attrs)
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
      emit(type) { for (const fn of handlers[type] || []) fn({ target: this, preventDefault() {} }); },
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
  const ctx = { console, document: doc, __errs: [], setTimeout() {}, addEventListener() {} };
  ctx.window = ctx; vm.createContext(ctx);
  for (const name of ['core', 'defs', 'map', 'sim', 'ui'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  const G = ctx.G, N = 40;
  G.world = { seed: 17, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 1, y: 1 } };
  G.game = G.newGameState(); G.rng = G.makeRng(917); G.setUid(1);
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar');
  G.ui.el = { info, guide, toolbar, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
  G.ui.toast = () => {};
  G.setTool = type => { G.tool = type ? { kind: 'build', type } : null; G.ui.refreshToolbarNavigation(); };
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
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, button, mount };
}

let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
function toolbar(){const f=fixture();f.G.ui.initToolbar();return f;}
test('all five top-level cards contain only icon, name and arrow, with complete accessible names',()=>{
 const f=toolbar(),cards=f.toolbar.querySelectorAll('[data-category]');assert.equal(cards.length,5);
 for(const [i,b]of cards.entries()){const g=f.G.ui.toolGroups[i];assert.equal(b.getAttribute('aria-label'),g.name);assert.equal(b.getAttribute('title'),g.name);assert.equal(b.getAttribute('aria-controls'),'toolbar-group-'+g.id);assert.equal(b.getAttribute('aria-expanded'),'false');assert.equal(b.tagName,'BUTTON');assert.equal(b.children.length,2);assert.equal(b.children[0].getAttribute('aria-hidden'),'true');assert.equal(b.children[1].children.length,2);assert.equal(b.children[1].children[1].getAttribute('aria-hidden'),'true');assert.equal(b.textContent,g.icon+g.name+'›');assert(b.descendants().some(n=>n.classList.contains('ui-icon')));assert(!b.descendants().some(n=>n.tagName==='IMG'));assert(!b.descendants().some(n=>n.classList.contains('cost')));assert(!b.textContent.includes('项'));}
});
test('opening every category, selecting a real tool and returning retains all mounted second-level tools',()=>{
 const f=toolbar(),G=f.G,initial=f.toolbar.querySelectorAll('[data-tool]'),count=G.ui.toolGroups.reduce((n,g)=>n+g.tools.length,0);assert.equal(initial.length,count);assert.equal(new Set(initial.map(b=>b.dataset.tool)).size,count);
 for(const g of G.ui.toolGroups){const card=f.toolbar.querySelector(`[data-category="${g.id}"]`);card.click();assert.equal(G.ui.menuCategory,g.id);assert.equal(card.getAttribute('aria-expanded'),'true');assert(f.doc.getElementById('toolbar-categories').classList.contains('hidden'));assert(!f.doc.getElementById('toolbar-group-'+g.id).classList.contains('hidden'));const first=f.toolbar.querySelector(`[data-tool="${g.tools[0]}"]`);first.click();assert(G.tool);f.doc.getElementById('toolbar-back').click();assert.equal(G.tool,null);assert.equal(G.ui.menuCategory,null);assert.equal(f.doc.activeElement,card);assert.equal(card.getAttribute('aria-expanded'),'false');}
 assert.deepEqual(f.toolbar.querySelectorAll('[data-tool]'),initial);assert(initial.some(b=>b.descendants().some(n=>n.classList.contains('cost'))));
});
test('extra-category fallback uses the same plain card and keeps its actual tool',()=>{
 const f=fixture(),G=f.G;G.BDEF.extraTest={...G.BDEF.house,name:'额外建筑测试'};G.TOOLBAR=[...G.TOOLBAR,'extraTest'];G.ui.initToolbar();const card=f.toolbar.querySelector('[data-category="other"]');assert(card);assert.equal(card.textContent,'🔨其他建筑›');assert.equal(card.getAttribute('aria-label'),'其他建筑');assert(f.toolbar.querySelector('[data-tool="extraTest"]'));
});
test('very long names remain complete in label/title and escape markup without adding a detail row',()=>{
 const f=fixture(),name='未来很长的分类名称用于验证固定宽高和完整可访问文字 <更多&内容>';const box=f.mount('long-card');box.innerHTML=f.G.ui.toolCategoryButton({id:'long',name,icon:'🔨'});const b=box.children[0];assert.equal(b.getAttribute('aria-label'),name);assert.equal(b.getAttribute('title'),name);assert.equal(b.children[1].children[0].textContent,name);assert.equal(b.children[1].children.length,2);assert(!b.descendants().some(n=>n.classList.contains('cost')));
});
test('desktop and narrow categories have fixed equal boxes, zero flex growth/shrink and a uniform icon box',()=>{
 const css=fs.readFileSync(path.join(root,'style.css'),'utf8'),rules=[...css.matchAll(/#toolbar \.tb-category\s*\{([^}]+)\}/g)].map(m=>m[1]);assert.equal(rules.length,2);const base=rules[0],narrow=rules[1];
 assert.match(base,/--category-card-width:\s*126px/);assert.match(base,/flex:\s*0 0 var\(--category-card-width\)/);
 for(const prop of ['width','min-width','max-width'])assert(base.includes(prop+': var(--category-card-width)'));
 for(const prop of ['height','min-height','max-height'])assert(base.includes(prop+': 72px'));
 assert.match(base,/box-sizing:\s*border-box/);assert.match(base,/padding:\s*8px 7px/);assert.match(base,/gap:\s*5px/);assert.match(narrow,/--category-card-width:\s*106px/);
 assert.match(css,/@media \(max-width: 760px\)[\s\S]*?#toolbar \.tb-category \{ --category-card-width: 106px; \}/);
 assert(css.includes('#toolbar .tb:not(.tb-category) { min-width: 86px; }'));
 assert.match(css,/#toolbar \.tb-category \.ic \{[^}]*width: 26px;[^}]*height: 26px;[^}]*line-height: 26px;[^}]*font-size: 20px;/);
});
test('long-label overflow cannot increase card height or hide the fixed arrow; scrolling stays available',()=>{
 const css=fs.readFileSync(path.join(root,'style.css'),'utf8');assert.match(css,/#toolbar \.tb-category \.lb \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);assert(css.includes('#toolbar .tb-category .category-arrow { flex: none; }'));assert.match(css,/\.toolbar-items \{[^}]*gap: 6px;[^}]*overflow-x: auto;/);assert.match(css,/#toolbar \.tb-category \.category-label \{[^}]*height: 18px;[^}]*line-height: 18px;/);
});
console.log('Category cards: '+passed+' DOM/CSS suites passed (not browser layout or mobile acceptance).');
