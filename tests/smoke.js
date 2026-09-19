/* 冒烟测试：node tests/smoke.js
 * 直接加载 core/defs/map/sim（无 DOM、无渲染），覆盖：
 * 经济修复（生育门槛/按屋取暖/完工扣料/读档搬运）、昼夜作息、教育系统、存档新字段。
 * 命中 assert 即退出码非 0，可挂 CI。 */
global.window = global;
global.addEventListener = () => {}; // main.js 顶层注册 DOMContentLoaded 用
// 按浏览器加载顺序 require 游戏源码（仅本地仓库文件，无动态执行）
require('../js/core.js');
require('../js/defs.js');
require('../js/map.js');
require('../js/sim.js');
require('../js/main.js');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};
function mkWorld(N = 12) {
  return {
    seed: 1, N,
    water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1),
    trees: [], rockCleared: [], marked: new Set(),
    buildings: [], bmap: {}, citizens: [], cmap: {}, families: [],
    start: { x: 6, y: 6 },
  };
}
function addB(w, type, x, y, bw, bh) {
  const b = { id: G.nextId(), type, x, y, w: bw, h: bh, state: 'ok', progress: 1, workLeft: 0, totalWork: 70, workers: [], family: null, noWork: false, warnText: '' };
  w.buildings.push(b); w.bmap[b.id] = b;
  for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) w.bgrid[j * w.N + i] = b.id;
  return b;
}
function freshGame() {
  G.world = mkWorld();
  G.game = G.newGameState();
  G.ui = { toast() {}, refreshHUD() {} };
  return G.game;
}
function houseWith(w, owner) {
  const h = addB(w, 'house', 2, 2, 2, 2);
  const fam = { id: G.nextId(), members: [owner.id], houseId: h.id };
  owner.familyId = fam.id;
  w.families.push(fam);
  h.family = fam.id;
  return { house: h, fam };
}

/* ================= 一、经济修复 ================= */
G.ui = { toast() {}, refreshHUD() {} };
{
  freshGame();
  check('eatPerDay ≈ 2.08 且为有限数值', Number.isFinite(G.LIFE.eatPerDay) && G.LIFE.eatPerDay > 2 && G.LIFE.eatPerDay < 2.2);
}

/* ---- 生育门槛 + 饥饿警告 ---- */
{
  const g = freshGame();
  g.day = 1; g.res.food = 0;
  const m = G.spawnCitizen({ x: 6, y: 6, sex: 'm', age: 30 });
  const f = G.spawnCitizen({ x: 6, y: 6, sex: 'f', age: 30 });
  const fam = { id: G.nextId(), members: [m.id, f.id], houseId: null };
  m.familyId = fam.id; f.familyId = fam.id;
  G.world.families.push(fam);
  const h = addB(G.world, 'house', 2, 2, 2, 2);
  h.family = fam.id; fam.houseId = h.id;
  G.endDay();
  check('食物耗尽 → 饥饿警告置位', g.warned.hunger === true);
  check('断粮当天不生育', G.world.citizens.length === 2);
  g.res.food = 10000;
  G.endDay();
  check('粮食充足后警告复位', g.warned.hunger === false);
}

/* ---- 柴火按屋支付 ---- */
{
  freshGame();
  const g = G.game;
  g.day = 35; g.res.food = 10000; g.res.firewood = 5; // 每屋每天 2.5，只够前两栋
  const fams = [];
  for (let i = 0; i < 3; i++) {
    const c = G.spawnCitizen({ x: 6 + i, y: 6, sex: 'm', age: 30 });
    const { fam } = houseWith(G.world, c);
    const h = G.world.bmap[fam.houseId];
    h.x = 1 + i * 3; // 错开位置
    fams.push(fam);
  }
  const homeless = G.spawnCitizen({ x: 9, y: 9, sex: 'm', age: 25 });
  G.endDay();
  const hs = G.world.buildings.filter(b => b.type === 'house');
  check('柴火按屋消耗至 0', g.res.firewood === 0);
  check('前两栋暖、第三栋 unheated', !hs[0].unheated && !hs[1].unheated && hs[2].unheated === true);
  check('冷屋居民 cold=1，无房者 0.6，暖屋 0',
    G.world.cmap[fams[2].members[0]].cold === 1 && homeless.cold === 0.6 &&
    G.world.cmap[fams[0].members[0]].cold === 0);
}

/* ---- 伐木屋：完工才扣料 + 两段式背料 ---- */
{
  freshGame();
  const w = G.world;
  const b = addB(w, 'woodcutter', 2, 2, 2, 2);
  const c = G.spawnCitizen({ x: 5, y: 5, sex: 'm', age: 25 });
  c.job = b.id;
  G.game.res.wood = 2;
  const t = G.makeTask(b, c);
  check('无仓库时就地加工（phase work）', !!t && t.kind === 'firewood' && t.phase === 'work' && t.consume && G.game.res.wood === 2);
  G.game.res.wood = 0;
  c.task = t; t.workLeft = 0;
  G.completeTask(c);
  check('材料耗尽 → 不凭空产柴', c.carry == null);
  G.game.res.wood = 2; b.noWork = false; c.job = b.id;
  const t2 = G.makeTask(b, c);
  c.task = t2; t2.workLeft = 0;
  G.completeTask(c);
  check('完工扣 2 木产 6 柴入仓', G.game.res.wood === 0 && G.game.res.firewood === 24 + 6);
}
{
  freshGame();
  const w = G.world;
  const b = addB(w, 'woodcutter', 2, 2, 2, 2);
  addB(w, 'storage', 8, 8, 3, 3);
  const c = G.spawnCitizen({ x: 5, y: 5, sex: 'm', age: 25 });
  c.job = b.id;
  G.game.res.wood = 10;
  const t = G.makeTask(b, c);
  check('有仓库 → 先去仓库背料（phase fetch）', !!t && t.kind === 'firewood' && t.phase === 'fetch');
  c.task = t;
  G.completeTask(c); // 到仓库
  check('背料段不扣木材、转入加工段', t.phase === 'work' && G.game.res.wood === 10 && t.workLeft === t.work);
  t.workLeft = 0;
  G.completeTask(c); // 加工完成
  check('加工完扣 2 木、6 柴背着去仓库', G.game.res.wood === 8 && c.carry && c.carry.type === 'firewood' && c.carry.qty === 6);
  for (let k = 0; k < 100 && c.carry; k++) G.stepCitizen(c, 0.5);
  check('柴火送达仓库', G.game.res.firewood === 24 + 6 && !c.carry);
}

/* ---- 读档后随身货物重新入仓 ---- */
{
  freshGame();
  const w = G.world;
  addB(w, 'storage', 2, 2, 3, 3);
  const c = G.spawnCitizen({ x: 8, y: 8, sex: 'm', age: 25 });
  c.carry = { type: 'food', qty: 5 };
  G.game.res.food = 0;
  G.startHaul(c);
  check('有货者进入搬运状态', c.state === 'haul' && !!c.path);
  for (let k = 0; k < 300 && c.state === 'haul'; k++) G.stepCitizen(c, 1);
  check('货物送达仓库', G.game.res.food === 5 && c.carry == null);
}

/* ================= 二、昼夜作息 ================= */
{
  const g = freshGame();
  g.h = 23;
  check('23 点是休息时间', G.isRestTime() === true);
  g.h = 8;
  check('8 点不是休息时间', G.isRestTime() === false);
  g.h = 3;
  check('凌晨 3 点是休息时间', G.isRestTime() === true);
}
{
  const g = freshGame();
  g.h = 23; g.res.food = 10000;
  const c = G.spawnCitizen({ x: 8, y: 8, sex: 'm', age: 25 });
  houseWith(G.world, c);
  G.goHome(c);
  check('深夜有房者回家路上', c.state === 'walk' && c.walkKind === 'home');
  for (let k = 0; k < 100 && c.state !== 'rest'; k++) G.stepCitizen(c, 1);
  check('到家后睡觉', c.state === 'rest');
  g.h = 8;
  G.stepCitizen(c, 0.5);
  check('天亮起床', c.state === 'idle');
}
{
  const g = freshGame();
  g.h = 23;
  const c = G.spawnCitizen({ x: 8, y: 8, sex: 'm', age: 25 }); // 无房
  c.state = 'idle';
  G.stepCitizen(c, 0.5);
  check('无房者就地睡觉', c.state === 'rest');
}
{
  const g = freshGame();
  g.h = 23;
  const c = G.spawnCitizen({ x: 8, y: 8, sex: 'm', age: 25 });
  c.state = 'work';
  c.task = { kind: 'work', work: 5, workLeft: 5 };
  G.stepCitizen(c, 0.1);
  check('深夜打断工作', c.task == null && (c.state === 'rest' || (c.state === 'walk' && c.walkKind === 'home')));
}
{
  const g = freshGame();
  g.h = 23;
  const w = G.world;
  addB(w, 'storage', 2, 2, 3, 3);
  const c = G.spawnCitizen({ x: 8, y: 8, sex: 'm', age: 25 });
  c.carry = { type: 'food', qty: 5 };
  c.state = 'haul';
  c.path = [{ x: 7, y: 7 }, { x: 6, y: 6 }];
  c.pi = 0;
  G.stepCitizen(c, 0.5);
  check('深夜搬运不中断（先送完货）', c.state === 'haul');
}
{
  const g = freshGame();
  g.h = 23;
  const w = G.world;
  const b = addB(w, 'gatherer', 2, 2, 2, 2);
  const c = G.spawnCitizen({ x: 8, y: 8, sex: 'm', age: 25 });
  c.job = b.id;
  G.requestTask(c);
  check('深夜不接受新任务', c.task == null && (c.state === 'rest' || (c.state === 'walk' && c.walkKind === 'home')));
}

/* ================= 三、教育系统 ================= */
{
  const g = freshGame();
  g.res.food = 10000;
  const teacher = G.spawnCitizen({ x: 3, y: 3, sex: 'f', age: 30 });
  const school = addB(G.world, 'school', 2, 2, 3, 3);
  school.workers.push(teacher.id); teacher.job = school.id;
  const kid = G.spawnCitizen({ x: 6, y: 6, sex: 'm', age: 10, adult: false });
  const kid2 = G.spawnCitizen({ x: 6, y: 7, sex: 'f', age: 10, adult: false }); // 同一天入学，占 2 个名额
  G.endDay();
  check('有在办学堂 → 满 10 岁入学', kid.student === true && kid.school === school.id && kid2.student === true);
  const n = G.world.citizens.filter(c => c.school === school.id).length;
  check('学生计数正确', n === 2);
  g.day += 1;
  G.endDay();
  check('学生不长大成人、不参加工作', !kid.adult && kid.job == null);
}
{
  const g = freshGame();
  g.res.food = 10000;
  const kid = G.spawnCitizen({ x: 6, y: 6, sex: 'm', age: 10, adult: false }); // 无学堂
  G.endDay();
  check('无学堂 → 满 10 岁直接当工人', kid.adult === true && kid.student === false && !kid.educated);
}
{
  const g = freshGame();
  g.res.food = 10000;
  const teacher = G.spawnCitizen({ x: 3, y: 3, sex: 'f', age: 30 });
  const school = addB(G.world, 'school', 2, 2, 3, 3);
  school.workers.push(teacher.id); teacher.job = school.id;
  const kid = G.spawnCitizen({ x: 6, y: 6, sex: 'm', age: 17, adult: false, student: false });
  // 手动置为在读学生（模拟多年前面入学）
  kid.student = true; kid.school = school.id;
  G.endDay();
  check('17 岁毕业：受教育、成为劳动力', kid.adult === true && kid.educated === true && kid.student === false && kid.school == null);
}
{
  freshGame();
  const w = G.world;
  const b = addB(w, 'woodcutter', 2, 2, 2, 2);
  const edu = G.spawnCitizen({ x: 5, y: 5, sex: 'm', age: 25, adult: true });
  edu.educated = true;
  G.game.res.wood = 10;
  const t = G.makeTask(b, edu);
  check('受教育伐木工：配比加成 2 木 → 8 柴，工时不变', t && t.yield.qty === 8 && t.work === 7);
  const plain = G.spawnCitizen({ x: 5, y: 5, sex: 'f', age: 25, adult: true });
  const t2 = G.makeTask(b, plain);
  check('未受教育伐木工：2 木 → 6 柴', t2 && t2.yield.qty === 6 && t2.work === 7);
}
{
  freshGame();
  const w = G.world;
  const b = addB(w, 'woodcutter', 2, 2, 2, 2);
  const kid = G.spawnCitizen({ x: 5, y: 5, sex: 'm', age: 12, adult: false });
  kid.student = true;
  G.scheduleJobs();
  check('学生不被派工', b.workers.length === 0 && kid.job == null);
}
{
  freshGame();
  const man = G.spawnCitizen({ x: 5, y: 5, sex: 'm', age: 20 });
  const girl = G.spawnCitizen({ x: 6, y: 5, sex: 'f', age: 15 });
  girl.student = true; // 在读学生不谈婚论嫁
  G.formFamilies();
  check('学生不组建家庭', G.world.families.length === 0);
}

/* ================= 四、存档新字段 ================= */
{
  freshGame();
  // localStorage / DOM 桩
  global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, contains: () => true }, addEventListener() {}, querySelectorAll: () => [] }) };
  G.T2S = (x, y) => [0, 0];
  G.cam = { x: 0, y: 0, z: 1 };
  G.groundDirty = { clear() {} }; // render.js 全局（本测试不加载渲染层）
  G.ui.hideInfo = () => {};
  G.ui.setToolActive = () => {};
  const kid = G.spawnCitizen({ x: 6, y: 6, sex: 'm', age: 12, adult: false });
  kid.student = true; kid.school = 999;
  const edu = G.spawnCitizen({ x: 6, y: 7, sex: 'f', age: 30 });
  edu.educated = true;
  const forester = addB(G.world, 'forester', 6, 2, 2, 2);
  forester.doCut = false; forester.doPlant = true;
  G.saveGame('test_key', true);
  G.loadGame('test_key');
  const kid2 = G.world.cmap[kid.id], edu2 = G.world.cmap[edu.id];
  check('存读档保留 学生/受教育/学校 字段', kid2 && kid2.student === true && kid2.school === 999 && edu2 && edu2.educated === true);
  const f2 = G.world.buildings.find(x => x.type === 'forester');
  check('存读档保留 护林小屋砍伐/补种开关', f2 && f2.doCut === false && f2.doPlant === true);
  delete global.localStorage;
  delete global.document;
}

/* ================= 五、跨夜任务挂起与续接（伐木 40h 必须跨 3 个工作日） ================= */
{
  const g = freshGame();
  g.res.food = 10000;
  const w = G.world;
  const b = addB(w, 'forester', 2, 2, 2, 2);
  G.addTree(w, 5, 5, -200); // 成年树
  G.addTree(w, 5, 6, -200);
  const c = G.spawnCitizen({ x: 5, y: 7, sex: 'm', age: 25 });
  houseWith(w, c);
  c.job = b.id;
  const tree = w.trees[0];
  const t = { kind: 'chop', b, tx: tree.x, ty: tree.y, tree, work: 40, workLeft: 30 };
  c.task = t; c.state = 'work';
  g.h = 23;
  G.stepCitizen(c, 0.1);
  check('深夜挂起任务而非丢弃', c.task == null && c.pausedTask === t && t.workLeft === 30);
  check('挂起后回家/就地睡', c.state === 'rest' || (c.state === 'walk' && c.walkKind === 'home'));
  g.h = 8;
  for (let k = 0; k < 50 && c.task !== t; k++) G.stepCitizen(c, 0.5); // 到家睡着 → 天亮续接
  check('天亮续接昨天的任务', c.task === t && c.task.workLeft === 30);
  check('续接后前往目标', c.state === 'work' || (c.state === 'walk' && c.walkKind === 'task'));
  // 持续步进直到树被砍倒（30h 剩余 + 路程；carry 会被 startHaul 立即入仓，观察树与库存）
  for (let k = 0; k < 400 && w.treeIdx[tree.y * w.N + tree.x] >= 0; k++) G.stepCitizen(c, 0.5);
  const felled = w.treeIdx[tree.y * w.N + tree.x] < 0;
  check('40h 伐木任务跨天完成、2 原木入仓', felled && G.game.res.wood === 80 + 2);
}
{
  const g = freshGame();
  const w = G.world;
  const b = addB(w, 'forester', 2, 2, 2, 2);
  G.addTree(w, 5, 5, -200);
  const c = G.spawnCitizen({ x: 5, y: 7, sex: 'm', age: 25 });
  houseWith(w, c);
  c.job = b.id;
  const tree = w.trees[0];
  c.pausedTask = { kind: 'chop', b, tx: tree.x, ty: tree.y, tree, work: 40, workLeft: 30 };
  G.removeTree(w, tree.x, tree.y); // 树夜里被别人砍了
  g.h = 23;
  G.stepCitizen(c, 0.1); // 深夜回家（挂起任务保留）
  g.h = 8;
  for (let k = 0; k < 50 && c.pausedTask != null; k++) G.stepCitizen(c, 0.5); // 到家→睡醒→尝试续接
  check('目标失效 → 放弃续接转闲逛', c.pausedTask == null && c.task == null && c.state === 'idle');
}
{
  freshGame();
  const c = G.spawnCitizen({ x: 5, y: 5, sex: 'm', age: 25 });
  c.pausedTask = { kind: 'work' };
  G.releaseWorker(c);
  check('离开岗位时清除挂起任务', c.pausedTask == null);
}

/* ================= 五、护林小屋砍伐/补种开关 ================= */
{
  freshGame();
  const w = G.world;
  const b = addB(w, 'forester', 2, 2, 2, 2);
  G.addTree(w, 5, 5, -200);
  const c = G.spawnCitizen({ x: 4, y: 4, sex: 'm', age: 25 });
  c.job = b.id;
  b.doCut = false; b.doPlant = true;
  let t = G.makeTask(b, c);
  check('关砍伐 → 只补种', t && t.kind === 'plant');
  b.doCut = true; b.doPlant = false;
  t = G.makeTask(b, c);
  check('关补种 → 只砍成熟树', t && t.kind === 'chop');
  b.doCut = false; b.doPlant = false;
  t = G.makeTask(b, c);
  check('全关 → 停工并标记 noWork', t === null && b.noWork === true && !!b.warnText);
}

/* ================= 六、「砍伐」标记工具（原版 Harvest Trees） ================= */
{
  freshGame();
  const w = G.world;
  G.addTree(w, 5, 5, -200);
  const i = 5 * w.N + 5;
  w.marked.add(i);
  const c = G.spawnCitizen({ x: 6, y: 5, sex: 'm', age: 25 }); // 无业散工
  G.requestTask(c);
  check('无业散工领取标记砍伐任务', c.task && c.task.kind === 'chop' && c.task.b === null && c.task.tx === 5);
  c.task.workLeft = 0;
  G.completeTask(c);
  check('砍倒标记树 → 2 原木入库、标记清除', G.game.res.wood === 80 + 2 && !w.marked.has(i) && G.world.treeIdx[i] < 0);
}
{
  freshGame();
  const w = G.world;
  G.addTree(w, 5, 5, -200);
  G.addTree(w, 6, 5, -200);
  const c = G.spawnCitizen({ x: 7, y: 5, sex: 'm', age: 25 });
  G.markFellAt(w, 5, 5);
  G.markFellAt(w, 6, 5);
  const t = G.pickMarkedTree(w, c.x, c.y);
  check('领取离自己最近的标记树', t && t.x === 6 && t.y === 5);
  G.removeTree(w, 6, 5); // 树在别处被砍掉
  check('树被砍后标记自动清除', !w.marked.has(6 * w.N + 5) && w.marked.has(5 * w.N + 5));
}
{
  // 有标记时不从岗位抽人：只有空闲市民才处理标记；空闲者也不会被派进岗位
  freshGame();
  const w = G.world;
  G.addTree(w, 5, 5, -200);
  const b = addB(w, 'forester', 2, 2, 2, 2);
  b.doCut = true; b.doPlant = true;
  const w1 = G.spawnCitizen({ x: 4, y: 4, sex: 'm', age: 25 });
  const w2 = G.spawnCitizen({ x: 4, y: 5, sex: 'f', age: 25 });
  G.scheduleJobs();
  check('预备：两名工人都被派进护林小屋', b.workers.length === 2 && w1.job != null && w2.job != null);
  w.marked.add(5 * w.N + 5);
  G.scheduleJobs();
  check('无人空闲 → 不抽调，岗位不动', b.workers.length === 2 && w1.job != null && w2.job != null);
  G.releaseWorker(w1); // 模拟岗位自然释放（如建筑被拆），w1 成为空闲市民
  G.scheduleJobs();
  check('有空闲者时不再把他派进岗位（留给标记）', w1.job == null);
  G.requestTask(w1);
  check('空闲者领取标记任务', w1.task && w1.task.kind === 'chop' && w1.task.b === null);
  G.removeTree(w, 5, 5);
  w.marked.clear();
  w1.task = null; w1.state = 'idle';
  G.scheduleJobs();
  check('标记清空后空闲者正常回流岗位', w1.job != null && b.workers.length === 2);
}

/* ================= 七、建造视觉间距（不能叠在已有建筑“上/后”） ================= */
/* 等距视角下，脚印不重叠也可能视觉叠放：新建筑的前墙脚线（南缘）落在已有建筑
 * 屋顶投影内时，画出来像“盖在已有建筑上”。canPlace 必须把这些位置判为非法。 */
{
  freshGame();
  const w = G.world;
  addB(w, 'house', 5, 5, 2, 2);   // 占 (5..6, 5..6)，前墙脚在 y=7 行
  check('脚印同位重叠拒绝', G.canPlace(w, 'house', 5, 5).ok === false);
  check('脚印部分重叠拒绝', G.canPlace(w, 'house', 6, 6).ok === false);
  check('正北 0 间距拒绝（会叠在已有建筑上）', G.canPlace(w, 'house', 5, 3).ok === false);
  check('正南 0 间距拒绝（会挡住已有建筑）', G.canPlace(w, 'house', 5, 7).ok === false);
  check('斜后方 0 间距拒绝（会叠在已有建筑上）', G.canPlace(w, 'house', 3, 3).ok === false);
  check('正西错半行拒绝（墙脚被压住）', G.canPlace(w, 'house', 3, 4).ok === false);
  check('正北留 1 格允许', G.canPlace(w, 'house', 5, 2).ok === true);
  check('正南留 1 格允许', G.canPlace(w, 'house', 5, 8).ok === true);
  check('正西 0 间距成排允许', G.canPlace(w, 'house', 3, 5).ok === true);
  check('正东 0 间距成排允许', G.canPlace(w, 'house', 7, 5).ok === true);
  check('远离已有建筑允许', G.canPlace(w, 'house', 3, 8).ok === true);
  // addBuilding 端到端：叠放位置在扣除资源前就应被拒
  const before = G.game.res.wood;
  const r = G.addBuilding('house', 5, 3, { free: true });
  check('addBuilding 拒绝叠放且不扣料', r.ok === false && G.game.res.wood === before && w.buildings.length === 1);
  // 农田是平的，不产生视觉遮挡：紧贴农田北缘（0 间距）放屋应放行
  addB(w, 'farm', 2, 2, 8, 8);    // 占 (2..9, 2..9)
  check('农田不产生视觉遮挡', G.canPlace(w, 'house', 3, 0).ok === true);
}

/* ================= 八、原版数值对齐（对照 banished-wiki.com 复核） ================= */
G.markGroundDirty = G.markGroundDirty || (() => {}); // render.js 未加载时清岩石/铺路需要

/* ---- 8.1 建造成本与入口 ---- */
{
  freshGame();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('采集小屋 30木+12石（原版）', eq(G.BDEF.gatherer.cost, { wood: 30, stone: 12 }));
  check('护林小屋 32木+12石（原版）', eq(G.BDEF.forester.cost, { wood: 32, stone: 12 }));
  check('仓库 48木+16石（原版）', eq(G.BDEF.storage.cost, { wood: 48, stone: 16 }));
  check('学堂 50木+16石+16铁（原版）', eq(G.BDEF.school.cost, { wood: 50, stone: 16, iron: 16 }));
  check('石屋 24木+40石+10铁（原版）', !!G.BDEF.stonehouse && eq(G.BDEF.stonehouse.cost, { wood: 24, stone: 40, iron: 10 }));
  check('宿舍 100木+45石（原版）', !!G.BDEF.boarding && eq(G.BDEF.boarding.cost, { wood: 100, stone: 45 }));
  check('渔码头 30木+16石（原版）', eq(G.BDEF.dock.cost, { wood: 30, stone: 16 }));
  check('伐木屋 24木+8石（原版）', eq(G.BDEF.woodcutter.cost, { wood: 24, stone: 8 }));
  check('石屋/宿舍进工具栏', G.TOOLBAR.includes('stonehouse') && G.TOOLBAR.includes('boarding'));
  check('铁是全局资源之一', G.RES_KEYS.includes('iron') && G.RES.iron.name === '铁');
}

/* ---- 8.2 石屋取暖省一半（原版木屋≈30/年、石屋 15/年） ---- */
{
  freshGame();
  const g = G.game;
  g.day = 35; g.res.food = 10000; g.res.firewood = 100; // 冬季
  const m1 = G.spawnCitizen({ x: 6, y: 6, sex: 'm', age: 30 });
  const { house: wh } = houseWith(G.world, m1);
  const m2 = G.spawnCitizen({ x: 8, y: 6, sex: 'm', age: 30 });
  const sh = addB(G.world, 'stonehouse', 8, 2, 2, 2);
  const fam2 = { id: G.nextId(), members: [m2.id], houseId: sh.id };
  m2.familyId = fam2.id; G.world.families.push(fam2); sh.family = fam2.id;
  G.endDay();
  check('木屋每天 2.5 + 石屋每天 1.25 柴火', Math.abs(g.res.firewood - (100 - 2.5 - 1.25)) < 1e-9);
  check('两户都取暖正常', !wh.unheated && !sh.unheated);
}

/* ---- 8.3 宿舍：无房家庭临时入住，有空独栋搬出（原版 Boarding House） ---- */
{
  freshGame();
  const w = G.world, g = G.game;
  const b = addB(w, 'boarding', 1, 1, 4, 3);
  const m = G.spawnCitizen({ x: 5, y: 5, sex: 'm', age: 30 });
  const f = G.spawnCitizen({ x: 5, y: 6, sex: 'f', age: 28 });
  const fam = { id: G.nextId(), members: [m.id, f.id], houseId: null };
  m.familyId = fam.id; f.familyId = fam.id;
  w.families.push(fam);
  G.assignHousing();
  check('无房家庭入住宿舍', fam.houseId === b.id);
  const h = addB(w, 'house', 7, 1, 2, 2);
  G.assignHousing();
  check('有空独栋后搬出宿舍', fam.houseId === h.id && h.family === fam.id);
  G.removeBuilding(h);
  G.assignHousing();
  check('独栋被拆 → 家庭回宿舍', fam.houseId === b.id);
  check('宿舍容量 5 家', G.LIFE.boardingCap === 5);
}

/* ---- 8.4 学堂停办 → 学生辍学成为工人（原版规则，永久未受教育） ---- */
{
  const g = freshGame();
  g.res.food = 10000;
  const teacher = G.spawnCitizen({ x: 3, y: 3, sex: 'f', age: 30 });
  const school = addB(G.world, 'school', 2, 2, 3, 3);
  school.workers.push(teacher.id); teacher.job = school.id;
  const kid = G.spawnCitizen({ x: 6, y: 6, sex: 'm', age: 10, adult: false });
  G.endDay();
  check('预备：孩子已入学', kid.student === true && kid.school === school.id);
  school.workers = []; teacher.job = null; // 教师离职
  G.endDay();
  check('教师离开 → 学生立即辍学当工人', kid.adult === true && kid.student === false && kid.school == null && !kid.educated);
}

/* ---- 8.5 受教育砍树 3 原木（未受教育 2） ---- */
{
  freshGame();
  const w = G.world;
  const b = addB(w, 'forester', 2, 2, 2, 2);
  b.doCut = true; b.doPlant = false;
  G.addTree(w, 5, 5, -200);
  const edu = G.spawnCitizen({ x: 4, y: 4, sex: 'm', age: 25 });
  edu.educated = true; edu.job = b.id;
  const t = G.makeTask(b, edu);
  check('受教育护林工：一棵树 3 原木', t && t.kind === 'chop' && t.logs === 3);
  const plain = G.spawnCitizen({ x: 4, y: 5, sex: 'f', age: 25 });
  plain.job = b.id;
  const t2 = G.makeTask(b, plain);
  check('未受教育护林工：一棵树 2 原木', t2 && t2.kind === 'chop' && t2.logs === 2);
  t.work = 1; t.workLeft = 0;
  edu.task = t;
  G.completeTask(edu); // 本局没有仓库 → 原木直接入库
  check('砍倒后 3 原木入库', G.game.res.wood === 80 + 3 && !edu.carry);
}
{
  freshGame();
  const w = G.world;
  G.addTree(w, 5, 5, -200);
  const c = G.spawnCitizen({ x: 6, y: 5, sex: 'm', age: 25 });
  c.educated = true;
  w.marked.add(5 * w.N + 5);
  G.requestTask(c);
  check('受教育散工砍标记树也是 3 原木', c.task && c.task.kind === 'chop' && c.task.logs === 3);
  c.task.workLeft = 0;
  G.completeTask(c);
  check('入库 3 原木', G.game.res.wood === 80 + 3);
}

/* ---- 8.6 拆除返还约一半材料（原版行为） ---- */
{
  freshGame();
  const g = G.game;
  const b = addB(G.world, 'house', 2, 2, 2, 2);
  const w0 = g.res.wood, s0 = g.res.stone;
  G.removeBuilding(b);
  check('拆除木屋返还 8木+4石', g.res.wood === w0 + 8 && g.res.stone === s0 + 4);
}

/* ---- 8.7 铁矿清理得铁；岩石清理得石头 ---- */
{
  freshGame();
  const w = G.world, g = G.game;
  w.rock[5 * w.N + 5] = 2;
  const iron0 = g.res.iron, stone0 = g.res.stone;
  G.clearRock(w, 5, 5);
  check('锈色铁矿清理得铁', g.res.iron === iron0 + G.ROCK_IRON && g.res.stone === stone0);
  w.rock[6 * w.N + 6] = 1;
  G.clearRock(w, 6, 6);
  check('灰色岩石清理得石头', g.res.stone === stone0 + G.ROCK_STONE);
}
{
  freshGame();
  const w = G.genWorld(12345);
  let stone = 0, iron = 0;
  for (let i = 0; i < w.rock.length; i++) { if (w.rock[i] === 1) stone++; if (w.rock[i] === 2) iron++; }
  check('真实地图同时含石头与铁矿', stone > 0 && iron > 0);
}

/* ---- 8.8 原版规则常量 ---- */
{
  freshGame();
  check('地图 128 格（原版「小型」地图尺寸）', G.MAP === 128);
  check('家庭人口上限 8（原版每屋 8 人）', G.LIFE.maxFamily === 8);
  check('毕业年龄 17 岁（原版）', G.LIFE.gradAge === 17);
  check('学堂容量 20 学生（原版）', G.LIFE.schoolCap === 20);
  check('自然死亡 70 岁起（原版多活到 70~85）', G.OLD_AGE === 70);
  check('开局默认速度 1（速度档为 1/2/5）', G.newGameState().speed === 1);
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
