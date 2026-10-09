'use strict';
// Frozen strategy from cdb7a7c; preserve its known mistakes for fair A/B comparisons.
module.exports = function (G) {
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


return { tick: bot, buildLog };
};
