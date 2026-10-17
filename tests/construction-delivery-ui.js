/* Construction delivery details use real game APIs.
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
  for (const name of ['core', 'defs', 'map', 'sim', 'fire', 'supply', 'render', 'ui', 'main'])
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
function setup(type='house') {
 const f=fixture(),G=f.G; G.game.h=12;G.scheduleJobs=()=>{};
 G.game.res.wood=100;G.game.res.stone=100;G.game.res.iron=100;
 assert(G.addBuilding('storage',2,2,{free:true,instant:true}).ok);
 const q=G.addBuilding(type,14,8);assert(q.ok);f.b=q.b;
 f.c=G.spawnCitizen({x:9,y:6,age:30,sex:'f',name:'搬料工'});f.c.job=f.b.id;f.b.workers=[f.c.id];
 f.select(f.b);return f;
}
const row=(f,key)=>f.info.querySelector('[data-site-'+key+']').textContent;
function until(f,cond,max=6000){for(let i=0;i<max&&!cond();i++)f.G.stepCitizen(f.c,.05);assert(cond(),'expected material phase missing');}
test('new site shows unwithdrawn material plan and no refundable phantom stock',()=>{
 const f=setup(),before=JSON.stringify([f.G.game,f.b.construction]);
 assert.match(row(f,'materials'),/需要 16.*到场 0.*在途 0.*已投入 0.*待领 16/);
 assert.match(row(f,'delivery'),/不预扣或预留/);assert.match(f.info.querySelector('[data-info-refund]').textContent,/返还：0 材料/);
 f.G.ui.siteInfoData(f.b);f.G.ui.renderInfo();assert.equal(JSON.stringify([f.G.game,f.b.construction]),before);
});
test('live pickup and arrival update facts while preserving focused priority button',()=>{
 const f=setup(),G=f.G,button=f.info.querySelector('#construction-priority');button.focus();const writes=f.info.htmlWrites;
 G.requestTask(f.c);until(f,()=>!!f.c.carry?.constructionId);G.ui.renderInfo();
 assert.equal(f.doc.activeElement,button);assert.equal(f.info.htmlWrites,writes);assert.match(row(f,'materials'),/在途 16/);
 assert.match(G.ui.citizenStatus(f.c),/建材|工地/);assert.equal(f.b.progress,0);
 until(f,()=>Object.values(f.b.construction.onsite).some(n=>n>0));G.ui.renderInfo();assert.match(row(f,'materials'),/到场 16/);
 assert.equal(f.doc.activeElement,button);assert.equal(f.info.htmlWrites,writes);
});
test('pause protects cargo and live resume does not debit a duplicate batch',()=>{
 const f=setup(),G=f.G;G.requestTask(f.c);until(f,()=>!!f.c.carry?.constructionId&&!G.atStorageDoor(f.c,f.c.carry.type));const qty=f.c.carry.qty,stock=G.game.res.wood;
 f.info.querySelector('#construction-pause').click();assert(f.b.sitePaused);assert.equal(f.c.carry.qty,qty);assert.equal(G.game.res.wood,stock);
 assert.match(row(f,'status'),/暂停/);assert.match(G.ui.citizenStatus(f.c),/退|返|仓/);
 f.info.querySelector('#construction-resume').click();assert(!f.b.sitePaused);assert.equal(G.game.res.wood,stock);
});
test('demolition refunds only arrived goods and old button cannot refund carried goods twice',()=>{
 const f=setup(),G=f.G;G.requestTask(f.c);until(f,()=>!!f.c.carry?.constructionId&&!G.atStorageDoor(f.c,f.c.carry.type));const button=f.info.querySelector('#info-demolish'),stock=G.game.res.wood,qty=f.c.carry.qty;
 button.click();assert(!G.world.bmap[f.b.id]);assert.equal(G.game.res.wood,stock);assert.equal(f.c.carry.qty,qty);button.click();assert.equal(G.game.res.wood,stock);
 until(f,()=>!f.c.carry);assert.equal(G.game.res.wood,stock+qty);
});
test('woodcutter site uses material phase rather than claiming immediate building',()=>{
 const f=setup('woodcutter');assert.match(row(f,'status'),/材料|建材|领料|取料|运料/);assert.match(row(f,'materials'),/到场 0/);
 const button=f.info.querySelector('#construction-priority');button.focus();f.G.game.res.wood=0;f.G.ui.renderInfo();assert.equal(f.doc.activeElement,button);assert.match(row(f,'delivery'),/缺料或断路会等待/);
});
test('upgrade and rebuild previews describe later real pickup, not immediate charge',()=>{
 const f=setup(),G=f.G;const house=G.addBuilding('house',22,8,{instant:true,free:true}).b;
 const upgrade=G.ui.houseUpgradeInfoData(house);assert.match(G.ui.houseUpgradeInfoMarkup(upgrade),/补料到仓领取才扣，不预留库存/);assert(!G.ui.houseUpgradeInfoMarkup(upgrade).includes('立即补付'));
 house.type='burntruins';house.ruinFrom='house';house.ruinIncident=1;G.game.fireDisasters.serial=1;
 const rebuild=G.ui.fireRebuildInfoData(house);assert.match(rebuild.confirmation,/不预扣或预留/);assert.match(rebuild.confirm,/创建重建工地/);
});
test('placement explains stock competition and new-site delivery without changing costs',()=>{
 const f=setup(),G=f.G,p=G.placementInfo('house',25,20);assert(p.ok);assert.match(p.text,/不预扣\/预留库存/);assert.match(p.text,/实运送齐后才施工/);assert.equal(G.BDEF.house.cost.wood,16);
});
test('explicit loss counters are visible, live and do not invent a refund',()=>{
 const f=setup(),G=f.G,before=G.game.res.wood;G.recordConstructionLoss({wood:3,stone:2});f.info.querySelector('#construction-priority').focus();G.ui.renderInfo();
 assert.match(row(f,'losses'),/木材 3、石头 2/);assert.match(row(f,'losses'),/旧档不追溯/);assert.equal(G.game.res.wood,before);assert.match(f.info.querySelector('[data-info-refund]').textContent,/返还：0 材料/);
});
console.log(`Construction UI: ${passed} DOM/live-game suites passed (not browser/mobile acceptance).`);
