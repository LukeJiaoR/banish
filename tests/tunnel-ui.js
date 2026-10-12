/* Tunnel controls use the real planning, removal, and construction APIs.
 * These are DOM/input contracts, not browser/mobile visual acceptance. */
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
  G.ui.refreshHUD = () => { if (G.ui.refreshRoadControls) G.ui.refreshRoadControls(); }; 
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

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const input = (f, id) => f.doc.getElementById(id);
const snapshot = f => JSON.stringify({world:f.G.world,game:f.G.game});
const fact = (f, key) => f.info.querySelector(`[data-tunnel="${key}"]`);
function mountainLine(f, start, end) {
 const {G}=f,w=G.world;w.mountain ||= new Uint8Array(w.N*w.N);w.mapVersion=2;
 const dx=Math.sign(end.x-start.x),dy=Math.sign(end.y-start.y),length=Math.abs(end.x-start.x)+Math.abs(end.y-start.y)+1;
 for(let i=1;i<length-1;i++)w.mountain[(start.y+dy*i)*w.N+start.x+dx*i]=1;
}
function planning() {
 const f=fixture(),{G}=f,panel=f.mount('road-controls');panel.classList.add('hidden');
 panel.innerHTML='<p id="road-plan-status" role="status" aria-live="polite"></p><button type="button" id="road-confirm">确认铺路</button><button type="button" id="road-cancel">重选起终点</button>';
 G.scheduleJobs=()=>{};G.spawnCitizen({x:1,y:1,age:30,sex:'f',name:'测试建筑工'});
 G.ui.initToolbar();G.ui.initRoadControls();G.setTool('tunnel');return f;
}
function preview(f,start={x:8,y:8},end={x:12,y:8}) {
 mountainLine(f,start,end);f.G.cancelRoadPlan();f.G.selectRoadEndpoint(start.x,start.y);f.G.selectRoadEndpoint(end.x,end.y);f.G.ui.refreshRoadControls();
}
function activate(f,id='road-confirm',type='mousedown') { const b=input(f,id);b.emit(type,type==='keydown'?{key:'Enter'}:{});return b; }
function detail(site=false,reverse=false) {
 const f=fixture(),{G}=f;G.scheduleJobs=()=>{};
 mountainLine(f,{x:8,y:8},{x:12,y:8});
 const b=f.building('tunnel',{x:8,y:8,w:5,h:1,tunnelAxis:'x',tunnelStart:reverse?1:0,state:site?'site':'ok',progress:site?0:1,workLeft:site?15:0,totalWork:15,paidCost:{stone:20},construction:G.newConstruction({stone:20}),constructionStarted:!site});
 if(!site)b.construction.consumed=true;
 G.world.road[8*G.world.N+8]=2;G.world.road[8*G.world.N+12]=1;
 f.b=b;f.select(b);return f;
}
function openRemoval(f) { input(f,'info-demolish').click();return input(f,'tunnel-removal-confirm'); }
function acceptRemoval(f,type='mousedown') { return activate(f,'tunnel-removal-confirm',type).click(); }

test('tunnel is a secondary road-category item and shares unchanged top-level cards',()=>{
 const f=planning(),G=f.G,b=f.toolbar.querySelector('[data-tool="tunnel"]');assert(b);assert.equal(f.toolbar.querySelectorAll('[data-category]').length,5);
 assert.equal(G.ui.toolGroups.find(g=>g.id==='land').tools.filter(t=>t==='tunnel').length,1);assert.match(b.textContent,/每格4石.*3工时/);
 assert.equal(b.getAttribute('aria-pressed'),'true');assert.match(input(f,'toolbar-state').textContent,/当前：隧道.*选起终点/);
 assert.equal(input(f,'road-confirm').textContent,'确认建隧道');assert(input(f,'road-confirm').disabled);
 input(f,'toolbar-cancel').click();assert.equal(G.tool,null);assert.equal(f.doc.activeElement,b);
});
test('both axes and reversed first-mouth order show actual costs before site-only confirmation',()=>{
 for(const [start,end,axis]of [[{x:8,y:8},{x:12,y:8},'东西'],[{x:12,y:8},{x:8,y:8},'东西'],[{x:8,y:12},{x:8,y:8},'南北']]){
  const f=planning();preview(f,start,end);const text=input(f,'road-plan-status').textContent;
  assert.match(text,/隧道 5 格（含两端）/);assert(text.includes(axis));assert(text.includes(`首选洞口 (${start.x},${start.y})`));assert(text.includes(`远端洞口 (${end.x},${end.y})`));
  assert.match(text,/石头 20.*15 游戏施工小时/);assert.match(text,/不预扣或预留材料/);assert.match(text,/材料只实运至首选洞口/);assert.match(text,/土路速度.*无常驻岗位/);
  const before=f.G.game.res.stone,confirm=input(f,'road-confirm');assert.equal(confirm._roadIntent.mode,'tunnel');assert.equal(confirm._roadIntent.trees,'');activate(f).click();
  assert.equal(f.G.game.res.stone,before);assert.equal(f.G.world.buildings.length,1);assert.equal(f.G.world.buildings[0].state,'site');assert.equal(f.G.world.buildings[0].construction.required.stone,20);
  assert.match(f.toasts.at(-1)[0],/材料只送首选洞口并在此施工/);confirm.click(2);assert.equal(f.G.world.buildings.length,1);
 }
});
test('material shortage is visible but a physical-delivery site can still be planned',()=>{
 const f=planning();f.G.game.res.stone=0;preview(f);assert.match(input(f,'road-plan-status').textContent,/材料不足：石头差20/);assert(!input(f,'road-confirm').disabled);
 activate(f).click();assert.equal(f.G.world.buildings.length,1);assert.equal(f.G.game.res.stone,0);assert.deepEqual(Object.keys(f.G.world.buildings[0].construction.onsite),[]);
});
test('invalid continuous mountain or uncleared mouth disables confirmation and cancel has no world effect',()=>{
 const f=planning();preview(f);f.G.world.mountain[8*f.G.world.N+10]=0;f.G.ui.refreshRoadControls();assert(input(f,'road-confirm').disabled);let before=snapshot(f);activate(f).click();assert.equal(snapshot(f),before);
 preview(f);f.G.world.rock[8*f.G.world.N+8]=1;f.G.ui.refreshRoadControls();assert(input(f,'road-confirm').disabled);before=snapshot(f);input(f,'road-cancel').click();assert.equal(snapshot(f),before);assert.equal(f.G.roadPlan,null);
});
for(const mode of ['plan','world','tool','modal','pointercancel','touchcancel','blur'])test('interrupted or stale tunnel planning activation rejects '+mode,()=>{
 const f=planning();preview(f);const button=activate(f);
 if(mode==='plan')preview(f,{x:20,y:8},{x:24,y:8});if(mode==='world')f.G.world={...f.G.world};if(mode==='tool')f.G.setTool('house');if(mode==='modal')f.G.hasOpenModal=()=>true;
 if(mode==='pointercancel'||mode==='touchcancel')button.emit(mode);if(mode==='blur')f.windowEvent('blur');const before=snapshot(f);button.click();assert.equal(snapshot(f),before);
});
test('touch and keyboard confirmation use the same tunnel intent and place exactly one site',()=>{
 for(const type of ['touchstart','keydown']){const f=planning();preview(f);const b=activate(f,'road-confirm',type);b.click();b.emit('keydown',{key:'Enter',repeat:true});b.click(2);assert.equal(f.G.world.buildings.length,1);}
});
test('finished details preserve first-mouth identity, report live traffic and retain focused controls',()=>{
 const f=detail(false,true),{G}=f;assert.match(fact(f,'route').textContent,/首选洞口 \(12,8\).*远端洞口 \(8,8\)/);assert.match(fact(f,'use').textContent,/已贯通.*土路速度.*无常驻岗位/);
 assert.match(fact(f,'cost').textContent,/石头 20.*15 游戏施工小时/);assert.match(fact(f,'traffic').textContent,/山内居民 0 人.*生活物资 0/);
 const button=input(f,'info-demolish'),node=fact(f,'traffic'),writes=f.info.htmlWrites;button.focus();const c=G.spawnCitizen({x:10,y:8,age:30,sex:'f'});c.x=10;c.y=8;
 G.world.supplyCaches=[{x:10,y:8,supplyStock:{grain:3}}];G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.equal(f.doc.activeElement,button);assert.equal(fact(f,'traffic'),node);assert.match(node.textContent,/山内居民 1 人.*生活物资 3/);
 const before=snapshot(f);G.ui.renderInfo();assert.equal(snapshot(f),before);
});
test('site details reuse live construction material/progress controls and never show finished demolition confirmation',()=>{
 const f=detail(true,true),{G}=f;assert.equal(input(f,'tunnel-removal-confirm'),null);assert.match(fact(f,'use').textContent,/只在首选洞口.*原洞口道路仍可走/);
 assert.match(f.info.querySelector('[data-site-materials]').textContent,/需要 20.*到场 0.*待领 20/);assert.match(f.info.querySelector('[data-info-refund]').textContent,/返还：0 材料/);
 const control=input(f,'construction-priority'),writes=f.info.htmlWrites;control.focus();f.b.construction.onsite.stone=12;G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.equal(f.doc.activeElement,control);assert.match(f.info.querySelector('[data-site-materials]').textContent,/到场 12/);
 const old=input(f,'info-demolish');old.focus();f.b.construction.consumed=true;f.b.state='ok';f.b.progress=1;f.b.workLeft=0;G.ui.renderInfo();assert.equal(f.doc.activeElement,input(f,'info-close'));assert(input(f,'tunnel-removal-confirm'));old.click();assert.equal(G.world.bmap[f.b.id],f.b);
});
test('demolition preview and cancellation do not mutate; accepted fresh quote refunds only once and retains mouth roads',()=>{
 const f=detail(),{G}=f,before=snapshot(f),confirm=openRemoval(f);assert(!confirm.disabled);assert.match(f.info.textContent,/山内恢复不可通行.*原有洞口道路保留/);assert.match(f.info.textContent,/石头×10/);assert.equal(snapshot(f),before);
 input(f,'tunnel-removal-cancel').click();assert.equal(snapshot(f),before);assert(confirm.disabled);assert.equal(f.doc.activeElement,input(f,'info-demolish'));
 openRemoval(f);const stone=G.game.res.stone;acceptRemoval(f);assert.equal(G.world.bmap[f.b.id],undefined);assert.equal(G.game.res.stone,stone+10);assert.equal(G.world.road[8*G.world.N+8],2);assert.equal(G.world.road[8*G.world.N+12],1);
 const after=snapshot(f);confirm.click();assert.equal(snapshot(f),after);
});
for(const mode of ['person','mouth','goods','route','refund','world','game','hidden','panel','modal','site','type'])test('fresh removal recheck prevents stale action after '+mode,()=>{
 const f=detail(),{G}=f,confirm=openRemoval(f);activate(f,'tunnel-removal-confirm');
 if(mode==='person'||mode==='mouth'){const c=G.spawnCitizen({x:mode==='mouth'?8:10,y:8,age:30,sex:'m'});c.x=mode==='mouth'?8:10;c.y=8;}
 if(mode==='goods')G.world.supplyCaches=[{x:10,y:8,supplyStock:{grain:2}}];if(mode==='route'){for(let y=0;y<G.world.N;y++)for(let x=9;x<12;x++)G.world.mountain[y*G.world.N+x]=1;G.bumpNavigation(G.world);}
 if(mode==='refund')f.b.construction.required.stone=24;if(mode==='world')G.world={...G.world};if(mode==='game')G.game={...G.game};if(mode==='hidden')f.info.classList.add('hidden');if(mode==='panel'){G.ui.hideInfo();f.select(f.b);}if(mode==='modal')G.hasOpenModal=()=>true;if(mode==='site')f.b.state='site';if(mode==='type')f.b.type='bridge';
 const before=snapshot(f);confirm.click();assert.equal(snapshot(f),before);assert.equal(G.world.bmap[f.b.id],f.b);
 if(['person','mouth','goods','route'].includes(mode)){assert(confirm.disabled);assert.match(f.info.querySelector('[data-tunnel-removal-message]').textContent,/有人|实货|唯一通路/);}
});
test('blocked sole route opens no armed confirmation and shows the core reason',()=>{
 const f=detail(),{G}=f;for(let y=0;y<G.world.N;y++)for(let x=9;x<12;x++)G.world.mountain[y*G.world.N+x]=1;G.bumpNavigation(G.world);
 const before=snapshot(f);openRemoval(f);assert(input(f,'tunnel-removal-confirm').disabled);assert.match(f.toasts.at(-1)[0],/唯一通路/);assert.equal(snapshot(f),before);
});
test('old press cannot authorize a newly quoted refund, while a fresh press can',()=>{
 const f=detail();openRemoval(f);const button=activate(f,'tunnel-removal-confirm');f.b.construction.required.stone=24;f.G.ui.renderInfo();openRemoval(f);assert(!button.disabled);const before=snapshot(f);button.click();assert.equal(snapshot(f),before);acceptRemoval(f);assert.equal(f.G.world.bmap[f.b.id],undefined);
});
for(const type of ['pointercancel','touchcancel','blur'])test('interrupted removal '+type+' cannot act until a new press',()=>{
 const f=detail();openRemoval(f);const button=activate(f,'tunnel-removal-confirm');button.emit(type);const before=snapshot(f);button.click();assert.equal(snapshot(f),before);acceptRemoval(f);assert.equal(f.G.world.bmap[f.b.id],undefined);
});
test('opening a modal immediately drops pending tunnel confirmation',()=>{
 const f=detail();openRemoval(f);const modal=f.mount('test-modal');modal.innerHTML='<button id="test-modal-close">关闭</button>';f.G.ui.enterDialog('test-modal');assert(input(f,'tunnel-removal-confirm').disabled);
 const before=snapshot(f);input(f,'tunnel-removal-confirm').click();assert.equal(snapshot(f),before);
});
function bindInput() {
 const f=planning(),canvas=f.mount('game');canvas.style={};canvas.getContext=()=>({});canvas.getBoundingClientRect=()=>({left:17,top:29});
 f.G.ui.init=()=>{};f.G.feedback={init(){}};f.G.tryReplayLoad=()=>true;f.G.probeServerSaves=()=>{};f.G.init();
 const point=(x,y)=>{const [sx,sy]=f.G.T2S(x+.25,y+.25);return {clientX:17+sx*f.G.cam.z+f.G.cam.x,clientY:29+sy*f.G.cam.z+f.G.cam.y,target:canvas,button:0};};
 const mouse=(type,x,y)=>type==='mousedown'?canvas.emit(type,point(x,y)):f.windowEvent(type,point(x,y));
 const touch=(type,x,y)=>{const p=point(x,y);return canvas.emit(type,{touches:type==='touchend'?[]:[p],changedTouches:[p]});};
 return Object.assign(f,{mouse,touch});
}
test('actual canvas mouse drag and touch endpoints still require separate tunnel confirmation',()=>{
 for(const mode of ['mouse','touch']){
  const f=bindInput();mountainLine(f,{x:8,y:8},{x:12,y:8});
  if(mode==='mouse'){f.mouse('mousedown',8,8);f.mouse('mousemove',12,8);f.mouse('mouseup',12,8);}
  else for(const x of [8,12]){f.touch('touchstart',x,8);f.touch('touchend',x,8);}
  assert.equal(f.G.world.buildings.length,0);assert(f.G.roadPlanStatus().ok);f.G.ui.refreshRoadControls();activate(f,'road-confirm',mode==='mouse'?'mousedown':'touchstart').click();assert.equal(f.G.world.buildings.length,1);assert.equal(f.G.world.buildings[0].type,'tunnel');
 }
});
test('reopening the same removal quote invalidates an earlier pointer activation',()=>{
 const f=detail();openRemoval(f);const old=activate(f,'tunnel-removal-confirm');openRemoval(f);const before=snapshot(f);old.click();assert.equal(snapshot(f),before);acceptRemoval(f);assert.equal(f.G.world.bmap[f.b.id],undefined);
});
test('window blur drops removal intent and requires a new preview plus activation',()=>{
 const f=detail();openRemoval(f);const b=activate(f,'tunnel-removal-confirm');f.windowEvent('blur');assert(b.disabled);const before=snapshot(f);b.click();assert.equal(snapshot(f),before);openRemoval(f);acceptRemoval(f);assert.equal(f.G.world.bmap[f.b.id],undefined);
});
console.log(`Tunnel UI: ${passed} DOM/input suites passed (not browser/mobile acceptance).`);
