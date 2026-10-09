/* 标准开局重测：node tests/opening.js
 * 用一个「合格玩家」脚本打前三年（采集屋→伐木屋→宿舍过冬→护林屋→农田/住房→标记岩石补石头），
 * 输出逐季资源/人口曲线与生死台账，验证开局体验：第一冬压力是否公平、人口是否开始增长。
 * 建造走真实资源与工时（非 instant），劳动力由游戏内自动调度，与真人玩法一致。 */
global.window = global;
global.addEventListener = () => {};
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, contains: () => true }, addEventListener() {}, querySelectorAll: () => [] }) };
require('../js/core.js');
require('../js/defs.js');
require('../js/map.js');
require('../js/sim.js');
require('../js/main.js');

G.ui = { toast() {}, refreshHUD() {}, hideInfo() {}, setToolActive() {} };
G.markGroundDirty = G.markGroundDirty || (() => {}); // render.js 未加载（smoke.js 同款兜底）
G.T2S = (x, y) => [0, 0];
G.cam = { x: 0, y: 0, z: 1 };
G.groundDirty = { clear() {} };

const SEED = 1;
G.newGame(SEED);
const w = G.world, g = G.game, s = w.start;

/* ---------- 选址工具（就近最优，与 bench 一致） ---------- */
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
const count = (type) => w.buildings.filter(b => b.type === type).length;
const buildLog = [];
function tryBuild(type, spot) {
  if (!spot) return false;
  const r = G.addBuilding(type, spot.x, spot.y);
  if (r.ok) buildLog.push(`d${g.day}:${type}@${spot.x},${spot.y}`);
  return r.ok;
}

/* ---------- 开局：标记一片树给散工砍（木材收入） ----------
 * 劳动纪律：散工先砍标记树、再清岩石——石头没攒够就不砍树（宿舍过冬的石头最优先）；
 * 木料够用（≥150）也收手：无节制清场会把镇边森林砍穿，逼着后来的采集屋远岗开工 */
function markTrees() {
  if (g.res.wood >= 150 || g.res.stone < 120 || w.marked.size >= 12) return;
  const trees = G.treesInRadius(w, s.x, s.y, 12, false)
    .filter(t => !w.marked.has(t.i))
    .sort((a, b) => G.d2(a.x, a.y, s.x, s.y) - G.d2(b.x, b.y, s.x, s.y));
  for (let k = 0; k < 12 - w.marked.size && k < trees.length; k++) G.markFellAt(w, trees[k].x, trees[k].y);
}
function markRocks() {
  if (w.markedRocks.size >= 6) return;
  const rocks = [];
  for (let i = 0; i < w.rock.length; i++)
    if (w.rock[i] && !w.markedRocks.has(i)) {
      const x = i % w.N, y = (i / w.N) | 0;
      if (G.d2(x, y, s.x, s.y) <= 400) rocks.push({ x, y });
    }
  rocks.sort((a, b) => G.d2(a.x, a.y, s.x, s.y) - G.d2(b.x, b.y, s.x, s.y));
  for (let k = 0; k < 6 - w.markedRocks.size && k < rocks.length; k++) G.markRockAt(w, rocks[k].x, rocks[k].y);
}
markTrees();

/* ---------- 「合格玩家」的建造优先级 ---------- */
function bot() {
  const res = g.res;
  markTrees();
  if (res.stone < 120) markRocks(); // 石头从头就攒：第一冬安家（宿舍 45 石）全靠它
  // 1. 第一座采集屋：食物命脉，开工越早越好
  if (!count('gatherer') && res.wood >= 30 && res.stone >= 12)
    tryBuild('gatherer', bestSpot('gatherer', s.x, s.y, 10, (x, y) => G.treesInRadius(w, x, y, G.PROD.gatherer.radius, false).length));
  // 2. 伐木屋：紧邻仓库（README 建议摆法），入冬前必须有柴
  if (!count('woodcutter') && res.wood >= 24 + 8 + 15) {
    const spot = canPlaceSpots('woodcutter', s.x, s.y, 4)[0];
    tryBuild('woodcutter', spot);
  }
  // 3. 宿舍：石头木材一凑齐就动工（第一冬全员过冬的最高优先级，优先于第二采集屋）
  if (!count('boarding') && res.wood >= 100 + 15 && res.stone >= 45 + 5)
    tryBuild('boarding', canPlaceSpots('boarding', s.x, s.y, 7)[0]);
  // 4. 食物余量吃紧 → 第二采集屋：最高优先（不等宿舍、不受工地数限制）。
  //    阈值 10 天 = 真的快见底了才补产能（余量稳在两周上下的「紧平衡」不算危机，
  //    把劳动力省给林业）；选址重罚距离——近处被砍薄的林子也比远处原始林强
  const pop = w.citizens.length;
  const foodDays = res.food / (pop * G.LIFE.eatPerDay);
  if (count('gatherer') >= 1 && count('gatherer') < 2 && foodDays < 10 && res.wood >= 30 + 12)
    tryBuild('gatherer', bestSpot('gatherer', s.x, s.y, 14, (x, y) => G.treesInRadius(w, x, y, G.PROD.gatherer.radius, false).length - G.dist(x, y, s.x, s.y) * 4));
  // 取暖盘点：有人住的房屋年烧柴合计超过伐木屋燃料上限就抬高上限（面板滑条的真实操作）；
  // 秋天柴火没备足就不开新工程——让伐木屋安心备冬
  const warmNeed = w.buildings.reduce((sum, b) => sum + (G.isOccupiedHome(w, b) ? G.BDEF[b.type].warmWoodPerYear : 0), 0);
  for (const b of w.buildings)
    if (b.type === 'woodcutter' && b.state === 'ok' && warmNeed > G.fuelLimitOf(b) - 50)
      b.fuelLimit = Math.min(G.PROD.woodcutter.fuelMax, warmNeed + 100);
  const firewoodSafe = g.season !== 2 || res.firewood >= warmNeed;
  // 5-10. 宿舍落成后的扩张队列：一次只开一个工地；第二采集屋动工前其余工程留木料。
  // 农田免费且是全年的口粮，第 2 年春一到就建，不排队
  const woodReserve = (count('gatherer') < 2 && foodDays < 12) ? 30 + 12 + 18 : 0; // 危机采集屋的木料预留（仅危机时生效）
  const sites = w.buildings.filter(b => b.state === 'site').length;
  if (count('boarding') >= 1 && firewoodSafe && sites === 0) {
    if (g.day >= 48 && count('farm') === 0 && g.season === 0)
      tryBuild('farm', canPlaceSpots('farm', s.x, s.y, 14)[0]);
    else if (g.day >= 48 && !count('forester') && res.wood >= 32 + 12 + 20 + woodReserve)
      tryBuild('forester', bestSpot('forester', s.x, s.y, 10, (x, y) => G.treesInRadius(w, x, y, G.PROD.forester.radius, true).length));
    else if (res.tools < pop && res.wood >= 42 + 20 + woodReserve && res.stone >= 24 + 10 && res.iron >= 11)
      tryBuild('blacksmith', canPlaceSpots('blacksmith', s.x, s.y, 8)[0]);
    else if (count('storage') < 3 && Math.max(res.wood, res.stone) > G.storageCap() - 20 && res.wood >= 48 + 30 + woodReserve && res.stone >= 16 + 10)
      tryBuild('storage', canPlaceSpots('storage', s.x, s.y, 9)[0]);
    else if (count('hunting') === 0 && count('gatherer') >= 2 && w.citizens.filter(c => c.adult).length >= 17 && res.wood >= 44 + 15 + woodReserve && res.stone >= 10 + 8)
      tryBuild('hunting', bestSpot('hunting', s.x, s.y, 10, (x, y) => G.treesInRadius(w, x, y, G.PROD.hunting.radius, true).length - G.dist(x, y, s.x, s.y) * 4));
    else if (g.day >= 60 && res.wood >= 16 + 8 + 90 + woodReserve && res.stone >= 8 + 20 && count('house') < 4)
      tryBuild('house', canPlaceSpots('house', s.x, s.y, 9)[0]);
  }
}

/* ---------- 跑三年，逐季记录 ---------- */
const dt = 0.5, DAYS = 144, totalSteps = DAYS * 24 / dt;
const snapLog = [];
let lastSeason = -1, winterMinFood = Infinity, winterMinFirewood = Infinity;
const dieLog = [];
G.ui.toast = (msg, cls) => { if (/饿死|冻死|寿终正寝/.test(msg)) dieLog.push(`第${g.day}天 ${msg}`); };

for (let step = 0; step < totalSteps && !g.over; step++) {
  G.advanceSim(dt);
  bot();
  if (g.season === 3) { winterMinFood = Math.min(winterMinFood, g.res.food); winterMinFirewood = Math.min(winterMinFirewood, g.res.firewood); }
  if (g.season !== lastSeason) {
    lastSeason = g.season;
    const housed = w.families.filter(f => { const h = f.houseId != null ? w.bmap[f.houseId] : null; return h && h.type !== 'boarding'; }).length;
    const boarding = w.families.filter(f => { const h = f.houseId != null ? w.bmap[f.houseId] : null; return h && h.type === 'boarding'; }).length;
    snapLog.push(`第${g.year}年${G.SEASON_NAMES[g.season]}初(day${g.day})  人口${String(w.citizens.length).padStart(2)}  食${String(Math.floor(g.res.food)).padStart(5)}  柴${String(Math.floor(g.res.firewood)).padStart(4)}  木${String(Math.floor(g.res.wood)).padStart(4)}  石${String(Math.floor(g.res.stone)).padStart(3)}  有房${housed}+宿舍${boarding}  死亡${g.stats.died} 出生${g.stats.born}`);
  }
}

console.log(`\n=== 标准开局重测（种子 ${SEED}，脚本化玩家，3 年 ${DAYS} 天）===`);
console.log(snapLog.join('\n'));
console.log(`\n结局：人口 ${w.citizens.length} · 出生 ${g.stats.born} · 死亡 ${g.stats.died}`);
console.log('死因：' + (Object.keys(g.stats.deadReasons).map(k => `${k}×${g.stats.deadReasons[k]}`).join('、') || '无'));
if (dieLog.length) console.log('死亡台账：\n  ' + dieLog.join('\n  '));
console.log(`第一个冬天最低储备：食物 ${Math.floor(winterMinFood)} · 柴火 ${Math.floor(winterMinFirewood)}`);
console.log('建造序列：' + buildLog.join(' '));
const housedEnd = w.families.filter(f => { const h = f.houseId != null ? w.bmap[f.houseId] : null; return h && h.type !== 'boarding'; }).length;
console.log(`住房：独栋 ${housedEnd} + 宿舍入住 ${w.families.filter(f => { const h = f.houseId != null ? w.bmap[f.houseId] : null; return h && h.type === 'boarding'; }).length} 家`);
console.log(`成年劳动力分布：` + ['gatherer', 'forester', 'woodcutter', 'dock', 'farm', 'mine'].map(t => `${G.BDEF[t].name}×${w.buildings.filter(b => b.type === t).length}`).join(' '));
