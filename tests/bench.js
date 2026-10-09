/* 产能基准：node tests/bench.js
 * 固定种子生成真实地图，建一座微型村庄（采集/护林/伐木/码头/农田各一座、满编工人），
 * 预热一年后统计第二年的产出——用于校准 defs.js / README 的产能文案。
 * 选址取「就近最优」（采集/护林挑森林最密处、码头挑水域最大处），衡量的是合理布局下的产能。
 * 为隔离干扰：市民不受冻不冻死（coldOutdoor/coldIndoors/warmRecover 置 0）、伐木屋燃料上限调高、
 * 市民不组建家庭（避免生育/住房噪声）。产出按任务完工记账，与吃/取暖等消耗无关。 */
global.window = global;
global.addEventListener = () => {};
require('../js/core.js');
require('../js/defs.js');
require('../js/map.js');
require('../js/sim.js');
require('../js/main.js');

G.ui = { toast() {}, refreshHUD() {} };
G.markGroundDirty = G.markGroundDirty || (() => {});

/* 选一张开局条件达标（附近有水有林）的种子 */
let seed = 0;
for (let s = 1; s <= 300; s++) {
  const w = G.genWorld(s);
  if (G.countWaterInRadius(w, w.start.x, w.start.y, 12) >= 8 &&
      G.countTreesInRadius(w, w.start.x, w.start.y, 8) >= 25) { seed = s; break; }
}
if (!seed) { console.error('找不到合适的种子'); process.exit(1); }

G.world = G.genWorld(seed);
G.rng = G.makeRng((seed ^ 0x51f15e) >>> 0); // 固定逻辑随机流，保证可复现
G.game = G.newGameState();
const w = G.world, s = w.start;

function canPlaceSpots(type, cx, cy, r) {
  const out = [];
  for (let rad = 2; rad <= r; rad++)
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const def = G.BDEF[type];
        const ox = cx + dx - ((def.w - 1) >> 1), oy = cy + dy - ((def.h - 1) >> 1);
        if (G.canPlace(w, type, ox, oy).ok) out.push({ x: ox, y: oy });
      }
  return out;
}
function bestSpot(type, cx, cy, r, score) {
  let best = null, bs = -1;
  for (const spot of canPlaceSpots(type, cx, cy, r)) {
    const v = score(spot.x + (G.BDEF[type].w >> 1), spot.y + (G.BDEF[type].h >> 1));
    if (v > bs) { bs = v; best = spot; }
  }
  return best;
}

G.addBuilding('storage', s.x - 1, s.y - 1, { instant: true, free: true });
const built = {};
const PG = G.PROD.gatherer, PF = G.PROD.forester, PD = G.PROD.dock;
// 逐座现算现建（先算好的候选点会被后建的建筑占掉）
const plan = [
  ['gatherer', (x, y) => G.treesInRadius(w, x, y, PG.radius, false).length, 10],
  ['forester', (x, y) => G.treesInRadius(w, x, y, PF.radius, true).length, 10],
  ['dock', (x, y) => G.countWaterInRadius(w, x, y, PD.waterR), 14],
  ['woodcutter', null, 3], // 紧邻仓库（README 建议摆法），就近即可
  ['farm', null, 16],
  ['hunting', (x, y) => G.treesInRadius(w, x, y, G.PROD.hunting.radius, true).length - G.dist(x, y, s.x, s.y) * 2, 14], // 放最后：与护林同林会拉低彼此基准
];
for (const [type, score, r] of plan) {
  let spot;
  if (score) spot = bestSpot(type, s.x, s.y, r, score);
  else spot = canPlaceSpots(type, s.x, s.y, r)[0];
  if (!spot) { console.error(type, '附近找不到可建位置'); process.exit(1); }
  const res = G.addBuilding(type, spot.x, spot.y, { instant: true, free: true });
  if (!res.ok) { console.error(type, '建造失败：', res.reason); process.exit(1); }
  built[type] = res.b;
}
const spot2 = canPlaceSpots('storage', s.x, s.y, 9)[0]; // 第二仓库放最后：木/柴产出不被仓储上限截断，也不挤占伐木屋的位置
if (spot2) G.addBuilding('storage', spot2.x, spot2.y, { instant: true, free: true });
built.woodcutter.fuelLimit = 999999; // 隔离燃料上限对测量的干扰

for (const type of Object.keys(built)) {
  const b = built[type];
  for (let k = 0; k < G.BDEF[type].jobs; k++) {
    // 出生点必须在建筑脚印之外（站在占位格里无法寻路干活，与游戏内出生逻辑一致）
    const c = G.spawnCitizen({ x: s.x + 4, y: s.y + 4, sex: k % 2 ? 'f' : 'm', age: 25 });
    c.job = b.id; b.workers.push(c.id);
  }
}
G.LIFE.coldOutdoor = 0; G.LIFE.coldIndoors = 0; G.LIFE.warmRecover = 0; // 市民不受冻不冻死（隔离干扰）

/* 产出记账（按任务完工，与消耗无关） */
const tally = {}, tasks = {};
const add = (k, qty) => { tally[k] = (tally[k] || 0) + qty; tasks[k] = (tasks[k] || 0) + 1; };
const origComplete = G.completeTask;
G.completeTask = function (c) {
  const t = c.task;
  const phase = t ? t.phase : null;
  const woodBefore = G.game.res.wood, fwBefore = G.game.res.firewood;
  if (t && t.kind === 'work' && t.yield) add(t.b.type, t.yield.qty);
  else if (t && t.kind === 'harvest') add('farm', G.PROD.farm.perTile);
  origComplete(c);
  if (t && t.kind === 'chop') { // 砍倒的木头可能已入仓或还在背上
    const deposited = G.game.res.wood - woodBefore;
    const carried = (c.carry && c.carry.type === 'wood') ? c.carry.qty : 0;
    add(t.b ? t.b.type : 'laborer', deposited + carried);
  }
  if (t && t.kind === 'firewood' && phase === 'work')
    add('woodcutter', (G.game.res.firewood - fwBefore) + (c.carry && c.carry.type === 'firewood' ? c.carry.qty : 0));
};

const YEAR_H = G.YEAR_DAYS * G.DAY_H;
const dt = 0.5;
const yearSteps = Math.ceil(YEAR_H / dt);
for (let step = 0; step < yearSteps; step++) { // 预热第 1 年
  G.advanceSim(dt);
  if (G.game.over) break;
}
if (G.game.over) { console.error('对局提前结束（人口清零）'); process.exit(1); }
const snap = { ...tally }, snapTasks = { ...tasks };
for (let step = 0; step < yearSteps; step++) { // 计量第 2 年
  G.advanceSim(dt);
  if (G.game.over) break;
}

console.log(`种子 ${seed} · 地图 ${w.N}×${w.N} · 存活 ${w.citizens.length} 人 · 食物存量 ${Math.floor(G.game.res.food)} · 第 2 年人均年产量：`);
const rows = [
  ['gatherer', '采集小屋', 'food', G.BDEF.gatherer.jobs],
  ['dock', '渔码头', 'food', G.BDEF.dock.jobs],
  ['farm', '农田', 'food', G.BDEF.farm.jobs],
  ['forester', '护林小屋', 'wood', G.BDEF.forester.jobs],
  ['woodcutter', '伐木屋', 'firewood', G.BDEF.woodcutter.jobs],
  ['hunting', '猎人小屋', 'food', G.BDEF.hunting.jobs],
];
for (const [type, name, res, jobs] of rows) {
  const perYear = (tally[type] || 0) - (snap[type] || 0);
  const nTasks = (tasks[type] || 0) - (snapTasks[type] || 0);
  const avg = nTasks ? Math.round(perYear / nTasks * 10) / 10 : 0;
  console.log(`  ${name}（${jobs} 人）：${Math.round(perYear / jobs)} /人/年 · 每所 ${Math.round(perYear)} /年 · ${nTasks} 次 × 均 ${avg} ${G.RES[res].name}`);
}
