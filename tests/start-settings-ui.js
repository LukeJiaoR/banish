/* New-game settings use production modal, save and generation APIs.
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
  G.markGroundDirty = () => {};
  const generate = G.genWorld;
  G.genWorld = (seed, options) => { const w = generate(seed, options); if(w.mapVersion!==2){w.water.fill(0); w.rock.fill(0);} return w; };
  const info = mount('info'), guide = mount('guide'), toolbar = mount('toolbar');
  G.ui.el = { info, guide, toolbar, date: mount('date'), pop: mount('pop'), speed: mount('speed') };
  const toasts = []; G.ui.toast = (...args) => toasts.push(args);
  G.game.res.wood = 1000; G.game.res.stone = 1000;
  G.ui.refreshHUD = () => { if (G.ui.refreshNewGameSettings) G.ui.refreshNewGameSettings(); }; 
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
  return { G, ctx, doc, info, guide, toolbar, building, resident, homes, select, node, mount, element, toasts, windowEvent, documentEvent }; 
}

let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name);}
function settings(){
  const f=fixture(),{G,ctx,mount,doc}=f;
  const calls={removed:[],saved:[],server:[],exported:0};
  ctx.innerWidth=1200;ctx.innerHeight=800;
  ctx.localStorage={getItem:()=>null,removeItem:k=>calls.removed.push(k),setItem:(k,v)=>calls.saved.push([k,v])};
  G.deleteServerSaveQuiet=k=>calls.server.push(k);G.saveToServer=()=>Promise.resolve();
  G.cam={x:0,y:0,z:1};G.T2S=(x,y)=>[(x-y)*32,(x+y)*16];G.groundDirty={clear(){}};G._hasShownHelp=true;
  for(const id of ['over','fb','errs','saves','production-goals','help']){const el=mount(id);el.classList.add('hidden');if(id==='over'||id==='help')G.ui.el[id]=el;}
  const modal=mount('new-game-settings');modal.classList.add('hidden');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),start=html.indexOf('<div class="dialog start-settings-dialog">'),end=html.indexOf('\n</div>\n\n<script>',start);
  const block=html.slice(start,end);modal.innerHTML=block.slice(0,block.lastIndexOf('</div>'));
  const open=mount('btn-new'),restart=mount('over-restart');open.focus();
  G.ui.initNewGameSettings();G.ui.showNewGameSettings();
  G.exportSaveFile=()=>{calls.exported++;};
  return {...f,modal,open,restart,calls};
}
const node=(f,id)=>f.doc.getElementById('new-game-'+id);
function press(f,id){const b=node(f,id);b.emit('mousedown',{button:0});b.click();}
function seed(f,value){node(f,'seed').value=String(value);node(f,'seed').emit('input');}
function review(f,value=0,preset='hard'){seed(f,value);press(f,'preset-'+preset);press(f,'review-button');assert.equal(f.G.ui._startSession.phase,'review');}
const snapshot=G=>JSON.stringify(G.serializeGame());
const clone=x=>JSON.parse(JSON.stringify(x));

test('actual HTML mounts labelled controls and reuses original icons with a separate final decision',()=>{const f=settings();assert.equal(node(f,'seed').getAttribute('maxlength'),'11');assert(node(f,'preset-hard').innerHTML.includes('assets/icons/res_food.png'));assert(node(f,'confirm').textContent.includes('放弃当前进度'));assert(node(f,'review').classList.contains('hidden'));assert(node(f,'current').textContent.includes('未记录'));assert.equal(f.G.game.paused,true);assert.equal(f.doc.activeElement,node(f,'seed'));});
test('opening, modifying and cancelling preserve the existing world, RNG, UID, resources and saves',()=>{const f=settings(),G=f.G,w=G.world,g=G.game,rng=G.rng,uid=G._peekUid(),before=snapshot(G);seed(f,0);press(f,'preset-hard');press(f,'random');press(f,'reuse');press(f,'close');assert.equal(G.world,w);assert.equal(G.game,g);assert.equal(G.rng,rng);assert.equal(G._peekUid(),uid);assert.equal(snapshot(G),before);assert.equal(g.paused,false);assert.deepEqual(f.calls,{removed:[],saved:[],server:[],exported:0});assert.equal(f.doc.activeElement,f.open);});
test('random and reuse change only draft values; seed zero remains explicit',()=>{const f=settings();const before=snapshot(f.G),rng=f.G.rng;press(f,'random');assert(Number.isInteger(Number(node(f,'seed').value)));assert(Number(node(f,'seed').value)>=0);press(f,'reuse');assert.equal(node(f,'seed').value,'17');seed(f,0);assert(node(f,'summary').textContent.includes('种子 0'));assert.equal(f.G.rng,rng);assert.equal(snapshot(f.G),before);});
for(const value of ['', '1.5','1e3','0x10','NaN','Infinity','4294967296','-2147483649'])test('invalid seed blocks review without writes: '+JSON.stringify(value),()=>{const f=settings(),w=f.G.world;seed(f,value);press(f,'review-button');assert.equal(f.G.ui._startSession.phase,'edit');assert(node(f,'review-button').disabled);assert.equal(f.G.world,w);assert.equal(f.calls.removed.length,0);assert.equal(f.calls.server.length,0);});
test('preset cards and preview state true population, stocks and lack of seeds',()=>{const f=settings();seed(f,0);assert(node(f,'summary').textContent.includes('5家庭 / 15人'));assert(node(f,'summary').textContent.includes('木材 80'));press(f,'preset-hard');assert(node(f,'summary').textContent.includes('4家庭 / 13人'));assert(node(f,'summary').textContent.includes('总食物')||node(f,'summary').textContent.includes('食物 400'));assert(node(f,'summary').textContent.includes('没有作物或果树种子'));assert.equal(f.G.world.citizens.length,0);});
test('first review click never starts a new world and all later edits disarm it',()=>{const f=settings(),w=f.G.world;review(f);assert.equal(f.G.world,w);assert.equal(f.calls.removed.length,0);seed(f,7);assert.equal(f.G.ui._startSession.phase,'edit');press(f,'confirm');assert.equal(f.G.world,w);});
test('programmatic field change between review and final click is re-quoted, not accepted',()=>{const f=settings(),w=f.G.world;review(f);node(f,'seed').value='8';press(f,'confirm');assert.equal(f.G.world,w);assert.equal(f.G.ui._startSession.phase,'edit');assert.equal(f.calls.removed.length,0);});
test('export requests a download without claiming it was saved and requires a new review',()=>{const f=settings();review(f);const w=f.G.world;press(f,'export');assert.equal(f.calls.exported,1);assert.equal(f.G.world,w);assert.equal(f.G.ui._startSession.phase,'edit');assert(node(f,'status').textContent.includes('自行核对'));assert.equal(f.calls.removed.length,0);});
test('failed export leaves the old village and automatic saves intact',()=>{const f=settings();f.G.exportSaveFile=()=>{throw Error('disk denied');};review(f);press(f,'export');assert(node(f,'status').textContent.includes('导出未完成'));assert.equal(f.G.ui._startSession.phase,'edit');assert.equal(f.calls.removed.length,0);});
test('back and close preserve a previously paused game exactly',()=>{const f=settings();press(f,'close');f.G.game.paused=true;f.G.ui.showNewGameSettings();review(f);press(f,'back');assert.equal(f.G.ui._startSession.phase,'edit');assert.equal(f.doc.activeElement,node(f,'seed'));press(f,'close');assert.equal(f.G.game.paused,true);});
test('final confirmation creates the actual seed-zero hard world only once and preserves manual saves',()=>{const f=settings(),old=f.G.world;review(f,0);press(f,'confirm');assert.notEqual(f.G.world,old);assert.equal(f.G.world.seed,0);assert.equal(f.G.world.families.length,4);assert.equal(f.G.world.citizens.length,13);assert.equal(f.G.game.res.food,400);assert.equal(f.G.game.unlocks.wheat,false);assert.equal(f.G.game.paused,false);assert(f.modal.classList.contains('hidden'));assert.deepEqual(f.calls.removed,[f.G.AUTOSAVE_KEY]);assert.deepEqual(f.calls.server,['autosave']);const w=f.G.world;node(f,'confirm').click();assert.equal(f.G.world,w);assert.equal(f.calls.removed.length,1);});
test('classic default still creates the existing five-family resources and wheat ownership',()=>{const f=settings();review(f,17,'classic');press(f,'confirm');assert.equal(f.G.world.families.length,5);assert.equal(f.G.game.res.wood,80);assert.equal(f.G.game.res.food,500);assert.equal(f.G.game.unlocks.wheat,true);});
test('same-world old draft cannot start after cancel and reopen',()=>{const f=settings();review(f);node(f,'confirm').emit('mousedown',{button:0});press(f,'close');f.G.ui.showNewGameSettings();seed(f,9);press(f,'review-button');const w=f.G.world;node(f,'confirm').click();assert.equal(f.G.world,w);assert.equal(f.calls.removed.length,0);});
test('a captured final click is invalidated by editing even back to the same seed',()=>{const f=settings();review(f);node(f,'confirm').emit('mousedown',{button:0});seed(f,1);seed(f,0);press(f,'review-button');const w=f.G.world;node(f,'confirm').click();assert.equal(f.G.world,w);});
test('pointercancel and touchcancel cannot fall back to a fresh dangerous click',()=>{for(const kind of ['pointercancel','touchcancel']){const f=settings();review(f);node(f,'confirm').emit('mousedown',{button:0});node(f,'confirm').emit(kind);node(f,'confirm').click();assert.equal(f.calls.removed.length,0);}});
for(const key of ['Enter',' '])test('holding '+JSON.stringify(key)+' across review does not activate the newly focused final button',()=>{const f=settings();seed(f,0);node(f,'review-button').focus();node(f,'review-button').emit('keydown',{key,repeat:false});node(f,'review-button').click(0);assert.equal(f.G.ui._startSession.phase,'review');node(f,'confirm').emit('keydown',{key,repeat:true});node(f,'confirm').click(0);assert.equal(f.calls.removed.length,0);node(f,'confirm').emit('keyup',{key});node(f,'confirm').emit('keydown',{key,repeat:false});node(f,'confirm').click(0);assert.equal(f.calls.removed.length,1);});
test('blur and document hiding disarm a final decision without deleting old saves',()=>{for(const event of ['blur','hidden']){const f=settings();review(f);if(event==='blur')f.windowEvent('blur');else{f.doc.visibilityState='hidden';f.documentEvent('visibilitychange');}assert.equal(f.G.ui._startSession.phase,'edit');press(f,'confirm');assert.equal(f.calls.removed.length,0);}});
test('a newer world blocks the old final intent and close does not rewrite new pause state',()=>{const f=settings();review(f);const newWorld={...f.G.world},newGame={...f.G.game,paused:false};f.G.world=newWorld;f.G.game=newGame;press(f,'confirm');assert.equal(f.calls.removed.length,0);f.G.ui.closeNewGameSettings();assert.equal(f.G.world,newWorld);assert.equal(newGame.paused,false);});
test('detached or replaced final controls cannot create a new village',()=>{const f=settings();review(f);const b=node(f,'confirm'),parent=b.parentNode;parent.children=parent.children.filter(x=>x!==b);b.parentNode=null;b.emit('click',{detail:1});assert.equal(f.calls.removed.length,0);});
test('unrelated open dialogs block opening or committing new-game settings',()=>{const f=settings();press(f,'close');f.doc.getElementById('help').classList.remove('hidden');f.G.ui.showNewGameSettings();assert(f.modal.classList.contains('hidden'));f.doc.getElementById('help').classList.add('hidden');f.G.ui.showNewGameSettings();review(f);f.doc.getElementById('saves').classList.remove('hidden');press(f,'confirm');assert.equal(f.calls.removed.length,0);});
test('game-over remains behind settings and cancelling returns without an automatic restart',()=>{const f=settings();press(f,'close');f.G.game.over=true;f.doc.getElementById('over').classList.remove('hidden');f.restart.focus();f.G.ui.showNewGameSettings();assert.equal(f.G.topModal(),f.modal);const w=f.G.world;press(f,'close');assert.equal(f.G.world,w);assert(!f.doc.getElementById('over').classList.contains('hidden'));assert.equal(f.doc.activeElement,f.restart);});
test('generation failure is reported while preserving world, UID, RNG and saves',()=>{const f=settings();review(f);const w=f.G.world,g=f.G.game,rng=f.G.rng,uid=f.G._peekUid();f.G.genWorld=()=>{throw Error('map probe failure');};press(f,'confirm');assert.equal(f.G.world,w);assert.equal(f.G.game,g);assert.equal(f.G.rng,rng);assert.equal(f.G._peekUid(),uid);assert.equal(f.calls.removed.length,0);assert.equal(f.calls.server.length,0);assert(node(f,'status').textContent.includes('map probe failure'));assert.equal(f.G.ui._startSession.phase,'edit');});
test('settings view blocks periodic autosave until cancelled without touching either slot',()=>{const f=settings();f.G.autosave();assert.equal(f.calls.saved.length,0);assert.equal(f.calls.server.length,0);press(f,'close');f.G.autosave();assert.equal(f.calls.saved.length,1);assert.equal(f.calls.saved[0][0],f.G.AUTOSAVE_KEY);});
test('farm detail no longer claims locked hard-start wheat is already unlocked',()=>{const f=settings();press(f,'close');f.G.game.unlocks.wheat=false;const b=f.building('farm');f.select(b);const text=f.info.textContent;assert(text.includes('小麦未解锁'));assert(!text.includes('小麦已解锁'));});
test('survival guide does not count a locked hard-start farm as a working food source',()=>{const f=settings();press(f,'close');f.G.game.unlocks.wheat=false;f.building('farm');f.G.ui.refreshGuide();assert(f.guide.textContent.includes('① 先保持续食物'));});
test('new-game entry points use settings rather than direct reset and keyboard escape knows the front dialog',()=>{const ui=fs.readFileSync(path.join(root,'js/ui.js'),'utf8'),main=fs.readFileSync(path.join(root,'js/main.js'),'utf8');assert(ui.includes("getElementById('btn-new').addEventListener('click', () => this.showNewGameSettings())"));assert(ui.includes("getElementById('over-restart').addEventListener('click', () => this.showNewGameSettings())"));assert(main.includes("if (visible('new-game-settings')) G.ui.closeNewGameSettings()"));assert(main.indexOf("'new-game-settings', 'over'")>=0);});
// Bind the production keyboard/lifecycle handlers; rendering, timers and startup IO stay suspended.
function bindSettingsInput() {
  const f=settings(), canvas=f.mount('game');canvas.style={};canvas.getContext=()=>({});canvas.getBoundingClientRect=()=>({left:0,top:0});
  f.G.ui.init=()=>{};f.G.feedback={init(){}};f.G.tryReplayLoad=()=>true;f.G.probeServerSaves=()=>{};f.G.init();
  const query=f.modal.querySelectorAll.bind(f.modal);
  f.modal.querySelectorAll=selector=>selector.includes('button, input')?f.modal.descendants().filter(el=>['BUTTON','INPUT','SELECT','TEXTAREA'].includes(el.tagName)):query(selector);
  for(const el of f.modal.descendants())el.getClientRects=()=>{for(let at=el;at;at=at.parentNode)if(at.classList.contains('hidden'))return [];return [{}];};
  return {...f,canvas};
}
test('production Escape cancels from the seed field and restores the old pause state without deleting saves',()=>{const f=bindSettingsInput(),w=f.G.world;review(f);node(f,'seed').focus();f.windowEvent('keydown',{key:'Escape',target:node(f,'seed')});assert(f.modal.classList.contains('hidden'));assert.equal(f.G.world,w);assert.equal(f.G.game.paused,false);assert.equal(f.calls.removed.length,0);assert.equal(f.doc.activeElement,f.open);});
test('production Tab traps focus among visible controls and ignores the hidden final confirmation',()=>{const f=bindSettingsInput();node(f,'close').focus();f.windowEvent('keydown',{key:'Tab',target:node(f,'close')});assert.equal(f.doc.activeElement,node(f,'seed'));f.windowEvent('keydown',{key:'Tab',shiftKey:true,target:node(f,'seed')});assert.equal(f.doc.activeElement,node(f,'close'));assert(!node(f,'confirm').getClientRects().length);});
test('production pause/speed shortcuts and canvas placement cannot change the old village under settings',()=>{const f=bindSettingsInput(),G=f.G,w=G.world,oldSpeed=G.game.speed;G.tool={kind:'build',type:'house'};f.canvas.focus();for(const key of [' ','1','2','3','w'])f.windowEvent('keydown',{key,target:f.canvas});f.canvas.emit('mousedown',{button:0,clientX:120,clientY:200});f.windowEvent('mouseup',{button:0,clientX:120,clientY:200,target:f.canvas});assert.equal(G.world,w);assert.equal(G.world.buildings.length,0);assert.equal(G.game.speed,oldSpeed);assert.equal(G.game.paused,true);assert.deepEqual(Object.keys(G.keys),[]);assert.equal(f.calls.removed.length,0);});
test('production page-hide and before-unload keep automatic saves untouched while settings are open',()=>{const f=bindSettingsInput();f.windowEvent('pagehide');f.windowEvent('beforeunload');f.doc.visibilityState='hidden';f.documentEvent('visibilitychange');assert.equal(f.calls.saved.length,0);assert.equal(f.calls.server.length,0);assert.equal(f.calls.removed.length,0);});
test('terrain choice is a read-only draft, explains v2 and tunnel limit, and cancels without replacing old land',()=>{const f=settings(),w=f.G.world,before=snapshot(f.G);press(f,'terrain-mountain');assert.equal(node(f,'terrain-mountain').getAttribute('aria-pressed'),'true');assert(node(f,'summary').textContent.includes('山地'));assert(node(f,'summary').textContent.includes('v2'));assert(node(f,'summary').textContent.includes('隧道尚未接入'));assert.equal(f.G.world,w);assert.equal(snapshot(f.G),before);press(f,'close');assert.equal(f.G.world,w);assert.equal(f.calls.removed.length,0);});
test('changing terrain invalidates a captured confirmation even when changed back',()=>{const f=settings();review(f);node(f,'confirm').emit('mousedown',{button:0});press(f,'terrain-mountain');assert.equal(f.G.ui._startSession.phase,'edit');press(f,'terrain-classic');press(f,'review-button');const w=f.G.world;node(f,'confirm').click();assert.equal(f.G.world,w);assert.equal(f.calls.removed.length,0);});
test('programmatic terrain change after review cannot reuse an old quote',()=>{const f=settings();review(f);const w=f.G.world;f.G.ui._startSession.terrain='mountain';press(f,'confirm');assert.equal(f.G.world,w);assert.equal(f.G.ui._startSession.phase,'edit');assert.equal(f.calls.removed.length,0);});
test('hard mountain final confirmation starts real collision terrain with no free houses or seeds',()=>{const f=settings();review(f,0);press(f,'terrain-mountain');press(f,'review-button');assert(node(f,'confirm-summary').textContent.includes('山地'));press(f,'confirm');const G=f.G;assert.equal(G.world.mapVersion,2);assert.equal(G.world.buildings.length,1);assert.equal(G.world.buildings[0].type,'storage');assert.equal(G.world.citizens.length,13);assert.equal(G.game.unlocks.wheat,false);assert.equal(G.game.res.wood,0);assert(G.world.startReport.ok);assert.equal(G.serializeGame().v,2);assert.equal(f.calls.removed.length,1);});
test('mountain proof failure leaves the old village, RNG, IDs and autosave untouched',()=>{const f=settings(),G=f.G,w=G.world,g=G.game,rng=G.rng,uid=G._peekUid();G.mountainStartReport=()=>({ok:false,reason:'测试：实际入口不可达'});review(f,1);press(f,'terrain-mountain');press(f,'review-button');press(f,'confirm');assert.equal(G.world,w);assert.equal(G.game,g);assert.equal(G.rng,rng);assert.equal(G._peekUid(),uid);assert.equal(f.calls.removed.length,0);assert(node(f,'status').textContent.includes('实际入口不可达'));});
test('a saved mountain village is named accurately while a new draft still defaults to original terrain',()=>{const f=settings();review(f,1);press(f,'terrain-mountain');press(f,'review-button');press(f,'confirm');f.G.ui.showNewGameSettings();assert(node(f,'current').textContent.includes('山地'));assert.equal(f.G.ui._startSession.terrain,'classic');assert.equal(node(f,'terrain-classic').getAttribute('aria-pressed'),'true');});
test('production mouse build over a raised rock top targets blocked mountain rather than the ground behind it',()=>{const f=bindSettingsInput(),G=f.G;press(f,'close');G.world.mountain=new Uint8Array(G.world.N**2);G.world.mountain[5*G.world.N+8]=1;G.cam={x:0,y:0,z:1};G.tool={kind:'build',type:'house'};const face=G.mountainPolygons(G.world,8,5).find(p=>p.kind==='topX'),point=face.points.reduce((a,p)=>[a[0]+p[0]/3,a[1]+p[1]/3],[0,0]),before=G.game.res.wood;f.canvas.emit('mousedown',{button:0,clientX:point[0],clientY:point[1]});f.windowEvent('mouseup',{button:0,clientX:point[0],clientY:point[1],target:f.canvas});assert.equal(G.world.buildings.length,0);assert.equal(G.game.res.wood,before);assert(f.toasts.some(row=>String(row[0]).includes('山体')));});
test('production touch area corner over a raised side records the same mountain collision cell',()=>{const f=bindSettingsInput(),G=f.G;press(f,'close');G.world.mountain=new Uint8Array(G.world.N**2);G.world.mountain[5*G.world.N+8]=1;G.cam={x:0,y:0,z:1};G.tool={kind:'build',type:'farm'};const face=G.mountainPolygons(G.world,8,5).find(p=>p.kind==='right'),point=face.points.reduce((a,p)=>[a[0]+p[0]/face.points.length,a[1]+p[1]/face.points.length],[0,0]),touch={clientX:point[0],clientY:point[1]};f.canvas.emit('touchstart',{touches:[touch]});f.canvas.emit('touchend',{touches:[],changedTouches:[touch]});assert.equal(G.farmPlan.start.x,8);assert.equal(G.farmPlan.start.y,5);assert.equal(G.world.buildings.length,0);});
test('normal click on a visible mountain cannot select a citizen hidden behind its surface',()=>{const f=settings(),G=f.G;press(f,'close');G.world.mountain=new Uint8Array(G.world.N**2);G.world.mountain[5*G.world.N+8]=1;G.sel={kind:'c',id:999};G.selectAt(8,5,{x:96,y:190});assert.equal(G.sel,null);assert(f.toasts.some(row=>String(row[0]).includes('山体不可步行')));});
test('foreground citizen beside a ridge remains selectable while rear citizens cannot click through it',()=>{const f=settings(),G=f.G;press(f,'close');G.world.mountain=new Uint8Array(G.world.N**2);G.world.mountain[5*G.world.N+8]=1;G.cam={x:0,y:0,z:1};let selected=null;G.ui.showInfo=s=>{selected=s;};G.ui.hideInfo=()=>{};const front=G.spawnCitizen({x:8,y:6,age:30,sex:'m'}),back=G.spawnCitizen({x:7,y:5,age:30,sex:'m'});for(const c of [front,back]){const [x,y]=G.T2S(c.x,c.y);selected=null;G.selectAt(8,5,{x,y:y+4});if(c===front)assert.equal(selected.id,front.id);else assert.equal(selected,null);}});
console.log(`Start settings UI: ${passed} DOM/live-simulation suites passed (not browser acceptance).`);
