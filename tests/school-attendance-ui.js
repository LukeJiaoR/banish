/* School attendance UI and real simulation; not browser visual acceptance. */
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
  const node = key => info.querySelector(`[data-school="${key}"]`);
  return { G, doc, info, guide, toolbar, building, resident, homes, select, node, mount };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function setup(){const f=fixture(),{G}=f,b=f.building('school');f.building('storage');G.game.h=12;const t=G.spawnCitizen({x:b.x-1,y:b.y,age:30,sex:'f'});t.name='教师<甲>';t.job=b.id;b.workers=[t.id];const c=G.spawnCitizen({x:b.x-1,y:b.y+2,age:12,adult:false,sex:'m'});c.name='学生<乙>';c.student=true;c.school=b.id;return {...f,b,t,c};}
function selectPupil(f){f.G.sel={kind:'c',id:f.c.id};f.G.ui.showInfo();}
const sn=(f,k)=>f.G.ui.el.info.querySelector(`[data-student="${k}"]`);
function arrive(f){const {G,t,c}=f;G.requestTask(t);G.requestTask(c);for(let i=0;i<1000&&!(G.inSchool(t)&&G.inSchool(c));i++){G.stepCitizen(t,.1);G.stepCitizen(c,.1);}assert(G.inSchool(t)&&G.inSchool(c));}
function click(f,id){const node=f.G.ui.el.info.querySelector('#'+id);assert(node,id);node.click();return node;}

test('school states explain assigned versus present staff, curriculum and reversible interruption',()=>{const f=setup();f.select(f.b);assert.match(f.node('staff').textContent,/分配教师 1.*实际在场：否/);assert.match(f.node('seats').textContent,/学生 1\/20.*实际到校 0/);assert.match(f.node('rule').textContent,/17岁且修满1344小时.*6小时/);assert.match(f.node('recovery').textContent,/保留学籍和课时/);assert(!f.info.innerHTML.includes('教师<甲>'));assert(f.info.innerHTML.includes('教师&lt;甲&gt;'));});
test('actual staff arrival and capped real study refresh the same focused school nodes',()=>{const f=setup();f.select(f.b);const node=f.node('seats'),close=f.info.querySelector('#info-close');close.focus();const writes=f.info.htmlWrites;arrive(f);f.G.stepCitizen(f.c,3);f.G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.equal(f.node('seats'),node);assert.match(node.textContent,/实际到校 1/);assert.match(f.node('staff').textContent,/实际在场：是/);assert.match(f.node('students').textContent,/今日3/);assert.equal(f.doc.activeElement,close);});
test('resident feedback explains teacher absence, progress, daily limit and both graduation conditions',()=>{const f=setup();selectPupil(f);assert.match(sn(f,'progress').textContent,/0.0\/1344.*0.0\/6/);assert.match(sn(f,'graduation').textContent,/17岁.*课时达标/);f.c.age=18;f.c.studyHours=300;f.info.querySelector('#info-close').focus();f.G.ui.renderInfo();assert.match(sn(f,'status').textContent,/尚缺课时/);f.c.studyHours=1344;f.c.age=16;f.G.ui.renderInfo();assert.match(sn(f,'status').textContent,/等待17岁/);});
test('graduation updates the focused resident role, knowledge and labour without leaving a stale study action',()=>{const f=setup();selectPupil(f);f.info.querySelector('#school-leave-start').focus();const writes=f.info.htmlWrites;f.c.age=17;f.c.studyHours=1344;f.G.advanceEducation(f.c,f.G.schoolCounts());f.G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.match(sn(f,'knowledge').textContent,/受过教育/);assert.match(f.info.querySelector('[data-citizen-role]').textContent,/成人/);assert.match(f.info.querySelector('[data-citizen-job]').textContent,/无业/);assert(f.info.querySelector('#school-leave-start').disabled);});
test('ending education requires a second explicit click, supports cancel and consumes no resource',()=>{const f=setup();selectPupil(f);const before=JSON.stringify(f.G.game.res);click(f,'school-leave-start');assert(f.c.student);assert(!f.info.querySelector('[data-school-leave-confirm]').classList.contains('hidden'));assert.match(f.info.textContent,/不能重新入学/);click(f,'school-leave-cancel');assert(f.c.student);assert(f.info.querySelector('[data-school-leave-confirm]').classList.contains('hidden'));click(f,'school-leave-confirm');assert(f.c.student);click(f,'school-leave-start');const confirm=click(f,'school-leave-confirm');assert(!f.c.student&&f.c.adult&&!f.c.educated);confirm.click();assert(!f.c.student&&!f.c.educated);assert.equal(JSON.stringify(f.G.game.res),before);assert.match(sn(f,'knowledge').textContent,/未受教育/);});
test('a focused confirmation survives ordinary ticks but not a modal interruption',()=>{const f=setup();selectPupil(f);click(f,'school-leave-start');const confirm=f.info.querySelector('#school-leave-confirm'),writes=f.info.htmlWrites;f.G.ui.renderInfo();assert.equal(f.info.htmlWrites,writes);assert.equal(f.doc.activeElement,confirm);f.G.hasOpenModal=()=>true;f.G.ui.renderInfo();assert(f.info.querySelector('[data-school-leave-confirm]').classList.contains('hidden'));f.G.hasOpenModal=()=>false;confirm.click();assert(f.c.student);});
test('stale confirmation after changed world/game/selection/DOM or hidden panel cannot end study',()=>{for(const kind of ['world','game','selection','dom','hidden','removed']){const f=setup();selectPupil(f);click(f,'school-leave-start');const confirm=f.info.querySelector('#school-leave-confirm');if(kind==='world')f.G.world={...f.G.world};if(kind==='game')f.G.game={...f.G.game};if(kind==='selection')f.G.sel={kind:'b',id:f.b.id};if(kind==='dom')f.G.ui.el.info=f.mount('new-info');if(kind==='hidden')f.info.classList.add('hidden');if(kind==='removed')delete f.G.world.cmap[f.c.id];confirm.click();assert(f.c.student,kind);}});
test('a rebuilt resident panel invalidates the old confirmation even for the same citizen',()=>{const f=setup();selectPupil(f);click(f,'school-leave-start');const confirm=f.info.querySelector('#school-leave-confirm');f.G.ui.renderInfo(true);confirm.click();assert(f.c.student);click(f,'school-leave-start');click(f,'school-leave-confirm');assert(!f.c.student);});
test('transfer and no-school wait reasons remain visible without permanent dropout',()=>{const f=setup();f.select(f.b);const next=f.building('school'),t=f.G.spawnCitizen({x:next.x-1,y:next.y,age:30,sex:'f'});t.job=next.id;next.workers=[t.id];f.t.job=null;f.b.workers=[];f.G.advanceEducation(f.c,f.G.schoolCounts());assert.equal(f.c.school,next.id);selectPupil(f);assert.match(sn(f,'school').textContent,new RegExp('#'+next.id));next.workers=[];t.job=null;f.G.advanceEducation(f.c,f.G.schoolCounts());f.info.querySelector('#info-close').focus();f.G.ui.renderInfo();assert.match(sn(f,'status').textContent,/缺教师/);assert(f.c.student);});
test('daily credit resets visibly and sickness pauses without erasing course progress',()=>{const f=setup();arrive(f);selectPupil(f);f.info.querySelector('#info-close').focus();f.G.stepCitizen(f.c,20);f.G.ui.renderInfo();assert.match(sn(f,'progress').textContent,/6.0\/6/);f.G.game.day++;f.G.ui.renderInfo();assert.match(sn(f,'progress').textContent,/今日 0.0\/6/);f.c.sickDays=1;f.G.ui.renderInfo();assert.match(sn(f,'status').textContent,/生病暂停/);assert.equal(f.G.studyHoursOf(f.c),6);});
test('underage and already educated residents cannot expose an active permanent-exit choice',()=>{const f=setup();f.c.student=false;f.c.age=5;selectPupil(f);assert(f.info.querySelector('#school-leave-start').classList.contains('hidden'));click(f,'school-leave-start');click(f,'school-leave-confirm');assert(!f.c.adult);f.c.age=25;f.c.adult=true;f.c.educated=true;f.G.ui.renderInfo(true);click(f,'school-leave-start');click(f,'school-leave-confirm');assert(f.c.educated);});
test('new game or info element remounts a working panel instead of retaining stale handlers',()=>{const f=setup();selectPupil(f);const old=f.info.querySelector('#school-leave-start');f.G.game={...f.G.game};f.G.ui.renderInfo();assert.notEqual(f.G.ui.el.info.querySelector('#school-leave-start'),old);click(f,'school-leave-start');assert(f.G.ui.el.info.querySelector('[data-student-panel]')._leavePending);click(f,'school-leave-cancel');});
test('legacy progress migrates near graduation and is shown without adding false completed education',()=>{const f=setup();f.c.age=16.99;const saved=JSON.parse(JSON.stringify(f.G.serializeGame()));for(const c of saved.citizens)for(const key of ['studyHours','studyToday','studyDay'])delete c[key];const prepared=f.G.prepareSaveData(saved);f.G.world=prepared.world;f.G.game=prepared.game;f.c=f.G.world.cmap[f.c.id];selectPupil(f);assert.match(sn(f,'knowledge').textContent,/就读中/);assert(f.G.studyHoursOf(f.c)>1342);assert.match(sn(f,'progress').textContent,/1342/);});
test('loading an actual save with reused citizen ids invalidates the old permanent-exit confirmation',()=>{const f=setup();selectPupil(f);const old=f.c;click(f,'school-leave-start');const confirm=f.info.querySelector('#school-leave-confirm'),saved=JSON.parse(JSON.stringify(f.G.serializeGame()));f.mount('over');f.G.T2S=()=>[0,0];f.G.cam={x:0,y:0,z:1};f.G.groundDirty=new Set();f.G.applySaveData(saved);const replacement=f.G.world.cmap[old.id];assert.notEqual(replacement,old);confirm.click();assert(replacement.student);assert(old.student);assert.equal(replacement.studyHours,old.studyHours);f.c=replacement;selectPupil(f);click(f,'school-leave-start');click(f,'school-leave-cancel');assert(replacement.student);assert.equal(replacement.studyHours,old.studyHours);});
test('school roster opens indoor pupils without an invisible map target and preserves focused entries across ticks',()=>{const f=setup();arrive(f);f.select(f.b);const entry=f.info.querySelector(`[data-student-id="${f.c.id}"]`);assert(entry);entry.focus();f.G.ui.renderInfo();assert.equal(f.info.querySelector(`[data-student-id="${f.c.id}"]`),entry);entry.click();assert.equal(f.G.sel.kind,'c');assert.equal(f.G.sel.id,f.c.id);assert(sn(f,'progress'));});
test('reading and refreshing school and student facts does not mutate simulation state',()=>{const f=setup();const before=JSON.stringify(f.G.serializeGame());f.G.ui.schoolInfoData(f.b);f.G.ui.studentInfoData(f.c);f.select(f.b);f.G.ui.renderInfo();selectPupil(f);f.info.querySelector('#info-close').focus();f.G.ui.renderInfo();assert.equal(JSON.stringify(f.G.serializeGame()),before);});
test('school roster also opens indoor teachers and rejects stale controls after their assignment changes',()=>{const f=setup();arrive(f);f.select(f.b);const entry=f.info.querySelector(`[data-student-id="${f.t.id}"]`);assert(entry);entry.click();assert.equal(f.G.sel.kind,'c');assert.equal(f.G.sel.id,f.t.id);f.select(f.b);const stale=f.info.querySelector(`[data-student-id="${f.t.id}"]`);f.t.job=null;f.b.workers=[];stale.click();assert.equal(f.G.sel.kind,'b');});
console.log(`School attendance UI: ${passed} DOM and real-simulation suites passed (not browser/mobile acceptance).`);
