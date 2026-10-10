'use strict';
/* ============================================================
 * map.js —— 地形生成、树木、寻路、放置判定
 * ============================================================ */

/* 双线性值噪声 */
function vnoise(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = G.h2(seed, x0, y0), b = G.h2(seed, x0 + 1, y0);
  const c = G.h2(seed, x0, y0 + 1), d = G.h2(seed, x0 + 1, y0 + 1);
  return G.lerp(G.lerp(a, b, sx), G.lerp(c, d, sx), sy);
}
function fbm(seed, x, y) {
  return 0.55 * vnoise(seed, x / 24, y / 24)
       + 0.30 * vnoise(seed + 101, x / 12, y / 12)
       + 0.15 * vnoise(seed + 202, x / 6, y / 6);
}

/* 生成新世界 */
G.genWorld = function (seed, options) {
  const starterResources = !options || options.starterResources !== false;
  const N = G.MAP;
  const w = {
    seed, N, mapVersion: starterResources ? 1 : 0,
    water: new Uint8Array(N * N),
    rock: new Uint8Array(N * N),
    rockCleared: [],
    road: new Uint8Array(N * N),
    roadCount: 0, // maintained only by setRoad; absent on foreign fixtures means unknown
    bgrid: new Int32Array(N * N).fill(-1),   // 建筑占位（存建筑 id）
    treeIdx: new Int32Array(N * N).fill(-1), // 树（存 trees 数组下标）
    trees: [],
    buildings: [],
    bmap: {},
    citizens: [],
    cmap: {},
    families: [],
    marked: new Set(),  // 「砍伐」工具标记的树（散工来砍）
    markedRocks: new Set(), // 「采石采铁」工具标记的岩石/铁矿（散工来清除入库）
    start: { x: N >> 1, y: N >> 1 },
  };

  // 高度场 → 水体
  const hmap = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      hmap[y * N + x] = fbm(seed, x, y);
  const WATER_H = 0.34, SAND_H = 0.375;
  for (let i = 0; i < N * N; i++) {
    const h = hmap[i];
    if (h < WATER_H) w.water[i] = 1;
    else if (h < SAND_H) w.water[i] = 2; // 沙滩（视为陆地）
  }

  // 岩石露头（噪声成簇，原版初期石头来源；w.rock: 1=石头 2=铁矿）
  // 铁是石矿带里的富集核心：同一噪声场用更高阈值判定，石:铁 ≈ 4:1（实测标定），锈色矿嵌在灰色岩带里成簇分布
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (w.water[i]) continue;
      if (fbm(seed + 555, x, y) > 0.715) w.rock[i] = fbm(seed + 888, x, y) > 0.65 ? 2 : 1;
    }

  // 森林：独立噪声场
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (w.water[i]) continue;
      const f = fbm(seed + 777, x, y);
      if (f > 0.52 && G.h2(seed + 13, x, y) < 0.62) {
        G.addTree(w, x, y, -(G.h2(seed + 29, x, y) * 300 | 0)); // 出生天数随机（部分已成熟）
      }
    }

  // 寻找镇址：平坦陆地 + 附近有森林 + 不太远有水 + 附近有岩石（第一冬安家的石头来源）。
  // 三项约束是过滤器而非保证——全图筛空时不能静默回退默认出生点（实测约一半种子半径 12 内 0 岩石，
  // 最近矿簇在 24 格外，清一格要 15-40 小时走路），必须兜底选岩石最多的候选。
  let best = null, bestScore = -1;
  let fallback = null, fallbackScore = -1;
  const cx = N >> 1, cy = N >> 1;
  for (let r = 0; r < N; r += 2) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const sx = Math.round(cx + Math.cos(ang) * r), sy = Math.round(cy + Math.sin(ang) * r);
      if (sx < 6 || sy < 6 || sx > N - 7 || sy > N - 7) continue;
      if (!G.areaLand(w, sx - 2, sy - 2, 6, 6)) continue;
      // 起始仓库必须放得下；areaLand 不检查岩石，不能让储物车静默消失。
      if (!G.canPlace(w, 'storage', sx - 1, sy - 1).ok) continue;
      const forest = G.countTreesInRadius(w, sx, sy, 8);
      const waterN = G.countWaterInRadius(w, sx, sy, 12);
      const rockN = G.countRocksInRadius(w, sx, sy, 12);
      const score = forest + waterN + rockN * 2 - r * 0.6;
      if (forest >= 25 && waterN >= 6 && rockN >= 3) { // 没有近处岩石，开局石头撑不起第一冬的住房
        if (score > bestScore) { bestScore = score; best = { x: sx, y: sy }; }
      } else if (!best) {
        const fb = rockN * 10 + Math.min(forest, 30) + waterN - r * 0.3; // 兜底分：岩石优先，森林/水/距离做次级权衡
        if (fb > fallbackScore) { fallbackScore = fb; fallback = { x: sx, y: sy }; }
      }
    }
    if (best && r > 10) break;
  }
  if (!best && !fallback) {
    // 稀有地图没有满足环境评分的镇址时，穷举最近的可放仓库陆地。
    let nearest = Infinity;
    for (let y = 2; y < N - 3; y++) for (let x = 2; x < N - 3; x++) {
      const d = G.d2(x, y, cx, cy);
      if (d < nearest && G.canPlace(w, 'storage', x - 1, y - 1).ok) {
        nearest = d; fallback = { x, y };
      }
    }
  }
  if (!best && !fallback) throw new Error('地图没有可用镇址');
  w.start = best || fallback;
  // 新地图保底可劳动获得的启动铁矿；矿井本身要铁，零铁地图会永久锁死工具循环。
  // 旧档重建地形时关闭此补点，避免给已建村庄凭空塞入矿石。
  if (starterResources) {
    const candidates = [];
    for (let y = Math.max(1, w.start.y - 14); y <= Math.min(N - 2, w.start.y + 14); y++)
      for (let x = Math.max(1, w.start.x - 14); x <= Math.min(N - 2, w.start.x + 14); x++) {
        const i = y * N + x, d = G.d2(x, y, w.start.x, w.start.y);
        if (d < 36 || d > 196 || w.water[i] || w.treeIdx[i] >= 0) continue;
        const path = G.findPath(w, w.start.x, w.start.y, x, y);
        if (path && path.length <= 24) candidates.push({ i, d, rock: w.rock[i] });
      }
    let needed = Math.max(0, 3 - candidates.filter(p => p.rock === 2).length);
    candidates.sort((a, b) => (a.rock === 1 ? 0 : 1) - (b.rock === 1 ? 0 : 1) || a.d - b.d || a.i - b.i);
    for (const p of candidates) {
      if (!needed) break;
      if (p.rock === 2) continue;
      w.rock[p.i] = 2; needed--;
    }
  }
  // 清出空地
  G.clearTreesInRadius(w, w.start.x, w.start.y, 3.2);
  return w;
};

/* ---------- 树 ---------- */
G.addTree = function (w, x, y, born) {
  if (x < 0 || y < 0 || x >= w.N || y >= w.N) return;
  const i = y * w.N + x;
  if (w.water[i] || w.rock[i] || w.treeIdx[i] >= 0 || w.bgrid[i] >= 0) return;
  w.trees.push({ i, x, y, b: born !== undefined ? born : G.game ? G.game.day : 0 });
  w.treeIdx[i] = w.trees.length - 1;
};
/* 清理岩石：只从网格移除并记录（资源由散工的清除任务完工时入库，不再原地白给） */
G.clearRock = function (w, x, y) {
  if (x < 0 || y < 0 || x >= w.N || y >= w.N) return false;
  const i = y * w.N + x;
  if (!w.rock[i]) return false;
  w.rock[i] = 0;
  w.rockCleared.push(i);
  if (w.markedRocks) w.markedRocks.delete(i);
  G.markGroundDirty(x, y);
  return true;
};
G.removeTree = function (w, x, y) {
  const i = y * w.N + x;
  const idx = w.treeIdx[i];
  if (idx < 0) return;
  if (w.marked) w.marked.delete(i); // 树没了，标记随之清除
  const last = w.trees.pop();
  if (idx < w.trees.length) {
    w.trees[idx] = last;
    w.treeIdx[last.i] = idx;
  }
  w.treeIdx[i] = -1;
};
/* 「砍伐」工具：标记一棵树（原版 Harvest Trees），散工会来砍 */
G.markFellAt = function (w, x, y) {
  if (x < 0 || y < 0 || x >= w.N || y >= w.N) return;
  const i = y * w.N + x;
  if (w.treeIdx[i] < 0) return;
  if (w.marked.size >= 300) return; // 队列上限，防误拖全图
  const first = w.marked.size === 0;
  w.marked.add(i);
  if (first && G.ui && G.ui.toast) G.ui.toast('🪚 已标记砍伐：空闲的市民会自动前往（无人空闲则排队等候）', 'info');
};
/* 仅按真实可达标记预留散工。四向连通与禁止穿角的寻路有相同可达性。
 * 每次派工按当前市民和地形重算；不在渲染帧内运行，也不缓存跨建造失效的路径。 */
G.reachableMarks = function (w) {
  const targets = [];
  for (const i of w.marked || []) if (w.treeIdx[i] >= 0) targets.push(i);
  for (const i of w.markedRocks || []) if (w.rock[i]) targets.push(i);
  if (!targets.length) return { count: 0, unreachable: 0 };
  const N = w.N, seen = new Uint8Array(N * N), queue = [];
  for (const c of w.citizens) {
    if (c.dead || !c.adult) continue;
    const x = Math.round(c.x), y = Math.round(c.y), i = y * N + x;
    if (x < 0 || y < 0 || x >= N || y >= N || seen[i]) continue;
    seen[i] = 1; queue.push(i);
  }
  const wanted = new Map();
  for (const i of targets) {
    let x = i % N, y = Math.floor(i / N);
    if (G.tileBlocked(w, x, y)) {
      const alt = G.nearestWalkable(w, x, y, 4);
      if (!alt) continue;
      x = alt.x; y = alt.y;
    }
    const to = y * N + x;
    wanted.set(to, (wanted.get(to) || 0) + 1);
  }
  let count = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % N, y = Math.floor(i / N);
    if (wanted.has(i)) { count += wanted.get(i); wanted.delete(i); if (!wanted.size) break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (seen[ni] || G.tileBlocked(w, nx, ny)) continue;
      seen[ni] = 1; queue.push(ni);
    }
  }
  return { count, unreachable: targets.length - count };
};
/* 取离散工最近的标记树（claimed 中的坐标跳过：一人一树） */
G.pickMarkedTree = function (w, x, y, claimed) {
  let best = null, bd = Infinity;
  for (const i of w.marked) {
    if (claimed && claimed.has(i)) continue;
    const idx = w.treeIdx[i];
    if (idx < 0) continue;
    const tx = i % w.N, ty = (i / w.N) | 0;
    // A solid construction site owns its covered trees; do not let findPath's
    // general blocked-target fallback hide a farther valid manual mark.
    if (G.tileBlocked(w, tx, ty)) continue;
    const d = G.d2(x, y, tx, ty);
    if (d < bd && G.findPath(w, Math.round(x), Math.round(y), tx, ty)) { bd = d; best = { x: tx, y: ty, tree: w.trees[idx] }; }
  }
  return best;
};
/* 「采石采铁」工具：标记一块岩石/铁矿，空闲散工前来清除（石头/铁入库） */
G.markRockAt = function (w, x, y) {
  if (x < 0 || y < 0 || x >= w.N || y >= w.N) return;
  const i = y * w.N + x;
  if (!w.rock[i]) return;
  if (w.markedRocks.size >= 300) return; // 队列上限，防误拖全图
  const first = w.markedRocks.size === 0;
  w.markedRocks.add(i);
  if (first && G.ui && G.ui.toast) G.ui.toast('⛏ 已标记清除岩石：空闲的市民会前来采集（石头/铁入库）', 'info');
};
/* 取离散工最近的标记岩石（claimed 中的坐标跳过：一人一坑） */
G.pickMarkedRock = function (w, x, y, claimed) {
  let best = null, bd = Infinity;
  for (const i of w.markedRocks) {
    if (claimed && claimed.has(i)) continue;
    if (!w.rock[i]) continue;
    const tx = i % w.N, ty = (i / w.N) | 0;
    const d = G.d2(x, y, tx, ty);
    if (d < bd && G.findPath(w, Math.round(x), Math.round(y), tx, ty)) { bd = d; best = { x: tx, y: ty, rock: w.rock[i] }; }
  }
  return best;
};
G.treeStage = function (t) {
  const day = G.game ? G.game.day : 9999;
  const age = day - t.b;
  return age >= G.TREE_MATURE ? 2 : (age >= G.TREE_YOUNG ? 1 : 0);
};
G.treesInRadius = function (w, cx, cy, r, matureOnly) {
  const out = [];
  const x0 = Math.max(0, cx - r), x1 = Math.min(w.N - 1, cx + r);
  const y0 = Math.max(0, cy - r), y1 = Math.min(w.N - 1, cy + r);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const idx = w.treeIdx[y * w.N + x];
      if (idx < 0) continue;
      const t = w.trees[idx];
      if (matureOnly && G.treeStage(t) < 2) continue;
      out.push(t);
    }
  return out;
};
G.countTreesInRadius = function (w, cx, cy, r) { return G.treesInRadius(w, cx, cy, r, false).length; };
G.countWaterInRadius = function (w, cx, cy, r) {
  let n = 0;
  const x0 = Math.max(0, cx - r), x1 = Math.min(w.N - 1, cx + r);
  const y0 = Math.max(0, cy - r), y1 = Math.min(w.N - 1, cy + r);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (w.water[y * w.N + x] === 1) n++;
  return n;
};
G.countRocksInRadius = function (w, cx, cy, r) {
  let n = 0;
  const x0 = Math.max(0, cx - r), x1 = Math.min(w.N - 1, cx + r);
  const y0 = Math.max(0, cy - r), y1 = Math.min(w.N - 1, cy + r);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (w.rock[y * w.N + x]) n++;
  return n;
};
G.clearTreesInRadius = function (w, cx, cy, r) {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w.N - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(w.N - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (G.d2(x, y, cx, cy) <= r2 && w.treeIdx[y * w.N + x] >= 0)
        G.removeTree(w, x, y);
};
G.areaLand = function (w, x, y, ww, hh) {
  for (let j = y; j < y + hh; j++)
    for (let i = x; i < x + ww; i++) {
      if (i < 0 || j < 0 || i >= w.N || j >= w.N) return false;
      if (w.water[j * w.N + i]) return false;
    }
  return true;
};

/* ---------- 通行 ---------- */
G.tileBlocked = function (w, x, y) {
  if (x < 0 || y < 0 || x >= w.N || y >= w.N) return true;
  const i = y * w.N + x;
  if (w.water[i] === 1) return true;
  const bid = w.bgrid[i];
  if (bid >= 0) {
    const b = w.bmap[bid];
    if (b && !G.BDEF[b.type].passable) return true;
  }
  return false;
};
G.onRoad = function (w, x, y) {
  if (x < 0 || y < 0 || x >= w.N || y >= w.N) return false;
  return w.road[y * w.N + x] === 1;
};

// All normal road writes go through this helper. Unknown maps keep the
// conservative road-speed lower bound rather than guessing a cached count.
G.bumpNavigation = function (w) { w.navigationRevision = (w.navigationRevision || 0) + 1; };
G.setRoad = function (w, x, y, present) {
  const i = y * w.N + x, next = present ? 1 : 0, previous = w.road[i] ? 1 : 0;
  if (next === previous) return;
  w.road[i] = next;
  G.bumpNavigation(w);
  if (Number.isInteger(w.roadCount)) {
    w.roadCount += next - previous;
    // Half-tile expansion matches round(position) surface boundaries. Removing
    // roads may leave a wider box: that only weakens, never raises, the bound.
    if (next) {
      const b = w.roadBounds;
      w.roadBounds = b ? { minX: Math.min(b.minX, x - .5), maxX: Math.max(b.maxX, x + .5), minY: Math.min(b.minY, y - .5), maxY: Math.max(b.maxY, y + .5) }
        : { minX: x - .5, maxX: x + .5, minY: y - .5, maxY: y + .5 };
    }
  }
};

/* A* 寻路（8 向，禁止穿角；二叉堆开表，路面加速） */
const PF_DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// Center-to-center motion spends half an edge on each endpoint surface.
// Winter/cargo are uniform speed multipliers and do not change route ranking.
G.travelEdgeHours = function (w, sx, sy, tx, ty) {
  const v = G.TRAVEL_SPEED;
  return Math.hypot(tx - sx, ty - sy) * 0.5 *
    (1 / (w.road[sy * w.N + sx] ? v.road : v.field) + 1 / (w.road[ty * w.N + tx] ? v.road : v.field));
};
G.travelGridDistance = function (dx, dy) {
  dx = Math.abs(dx); dy = Math.abs(dy);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
};
G.roadExitDistance = function (w, x, y) {
  const b = w.roadBounds;
  if (!Number.isInteger(w.roadCount) || !b) return 0;
  return G.travelGridDistance(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY));
};
G.travelLowerBound = function (dx, dy, fastest = Math.max(G.TRAVEL_SPEED.road, G.TRAVEL_SPEED.field), fieldTail = 0) {
  const distance = G.travelGridDistance(dx, dy), field = G.TRAVEL_SPEED.field;
  // Either never use a road, or eventually leave the road envelope. Taking the
  // minimum also protects short all-field routes outside that envelope.
  return Math.min(distance / field, distance / fastest + fieldTail * (1 / field - 1 / fastest));
};

// Reaching any point in the destination envelope is an optimistic relaxation.
// The road envelope adds only the unavoidable final field distance to that set.
G.destinationFieldTail = function (w, b) {
  const r = w.roadBounds;
  if (!Number.isInteger(w.roadCount) || !r) return 0;
  return G.travelGridDistance(Math.max(b.minX-r.maxX,r.minX-b.maxX,0), Math.max(b.minY-r.maxY,r.minY-b.maxY,0));
};
G.destinationLowerBound = function (x, y, b, fastest, tail) {
  return G.travelLowerBound(Math.max(b.minX-x,x-b.maxX,0), Math.max(b.minY-y,y-b.maxY,0), fastest, tail);
};
G.routeSpot = function (route) {
  if (!route) return null;
  const spot = {x:route.target.x,y:route.target.y};
  Object.defineProperty(spot,'route',{value:route});
  return spot;
};
G.findPathToAny = function (w, x, y, targets) {
  if (!targets.length) return null;
  const sx = Math.round(x), sy = Math.round(y);
  const path = G.findPath(w, sx, sy, targets[0].x, targets[0].y, targets);
  if (!path) return null;
  const end = path.length ? path[path.length-1] : {x:sx,y:sy};
  const target = targets.find(p => p.x === end.x && p.y === end.y);
  if (!target) return null;
  let eta = 0, px = sx, py = sy;
  for (const p of path) { eta += G.travelEdgeHours(w,px,py,p.x,p.y); px=p.x; py=p.y; }
  return {target,path,eta,world:w,revision:w.navigationRevision||0,fromX:x,fromY:y};
};

G.findPath = function (w, sx, sy, tx, ty, destinations = null) {
  sx |= 0; sy |= 0; tx |= 0; ty |= 0;
  let goals = null, bounds = null;
  if (destinations) {
    const valid = destinations.filter(p => Number.isInteger(p.x) && Number.isInteger(p.y) && !G.tileBlocked(w, p.x, p.y));
    if (!valid.length) return null;
    goals = new Set(valid.map(p => p.y * w.N + p.x));
    bounds = { minX: Math.min(...valid.map(p => p.x)), maxX: Math.max(...valid.map(p => p.x)), minY: Math.min(...valid.map(p => p.y)), maxY: Math.max(...valid.map(p => p.y)) };
    if (goals.has(sy * w.N + sx)) return [];
  } else {
    if (G.tileBlocked(w, tx, ty)) {
      const alt = G.nearestWalkable(w, tx, ty, 4);
      if (!alt) return null;
      tx = alt.x; ty = alt.y;
    }
    if (sx === tx && sy === ty) return [];
  }
  const N = w.N;
  const gen = ++G._pfGen || (G._pfGen = 1);
  if (!w._pf) {
    w._pf = { g: new Float32Array(N * N), f: new Float32Array(N * N), from: new Int32Array(N * N), gen: new Int32Array(N * N), closed: new Int32Array(N * N) };
  }
  const pf = w._pf;
  // Immutable priority snapshots keep duplicate heap entries ordered when a node
  // receives a cheaper route. Reading mutable pf.f for old entries breaks heap order.
  const heap = [], heapF = [];
  let hn = 0;
  const push = (i) => {
    let k = hn++;
    heap[k] = i; heapF[k] = pf.f[i];
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= heapF[k]) break;
      const t = heap[p]; heap[p] = heap[k]; heap[k] = t;
      const f = heapF[p]; heapF[p] = heapF[k]; heapF[k] = f;
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    hn--;
    if (hn > 0) {
      heap[0] = heap[hn]; heapF[0] = heapF[hn];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < hn && heapF[l] < heapF[m]) m = l;
        if (r < hn && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t;
        const f = heapF[m]; heapF[m] = heapF[k]; heapF[k] = f;
        k = m;
      }
    }
    return top;
  };
  const fastest = w.roadCount === 0 ? G.TRAVEL_SPEED.field : Math.max(G.TRAVEL_SPEED.road, G.TRAVEL_SPEED.field);
  const fieldTail = bounds ? G.destinationFieldTail(w, bounds) : G.roadExitDistance(w, tx, ty);
  const heuristic = bounds
    ? (x, y) => G.destinationLowerBound(x, y, bounds, fastest, fieldTail)
    : (x, y) => G.travelLowerBound(tx - x, ty - y, fastest, fieldTail);
  const start = sy * N + sx;
  let goal = ty * N + tx;
  pf.g[start] = 0; pf.f[start] = heuristic(sx, sy); pf.from[start] = -1; pf.gen[start] = gen;
  push(start);
  let iter = 0, found = false;
  while (hn > 0) {
    const cur = pop();
    if (pf.closed[cur] === gen) continue; // stale entries do not spend the expansion budget
    if (++iter > N * N) break; // each real grid cell can close at most once
    pf.closed[cur] = gen;
    if (goals ? goals.has(cur) : cur === goal) { goal = cur; found = true; break; }
    const cx = cur % N, cy = (cur / N) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + PF_DIRS[d][0], ny = cy + PF_DIRS[d][1], base = PF_DIRS[d][2];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (G.tileBlocked(w, nx, ny)) continue;
      if (nx !== cx && ny !== cy) { // 禁止穿角
        if (G.tileBlocked(w, cx + (nx - cx), cy) || G.tileBlocked(w, cx, cy + (ny - cy))) continue;
      }
      const ni = ny * N + nx;
      if (pf.closed[ni] === gen) continue;
      const ng = pf.g[cur] + base * 0.5 * (1 / (w.road[cur] ? G.TRAVEL_SPEED.road : G.TRAVEL_SPEED.field) + 1 / (w.road[ni] ? G.TRAVEL_SPEED.road : G.TRAVEL_SPEED.field));
      if (pf.gen[ni] !== gen || ng < pf.g[ni]) {
        pf.gen[ni] = gen;
        pf.g[ni] = ng;
        pf.f[ni] = ng + heuristic(nx, ny);
        pf.from[ni] = cur;
        push(ni);
      }
    }
  }
  if (!found) return null;
  const path = [];
  let cur = goal;
  while (cur !== start && cur >= 0) {
    path.push({ x: cur % N, y: (cur / N) | 0 });
    cur = pf.from[cur];
  }
  path.reverse();
  return path;
};
G.nearestWalkable = function (w, x, y, r) {
  for (let rad = 0; rad <= r; rad++)
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (!G.tileBlocked(w, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
  return null;
};
/* 最近的可种树空地（螺旋扫描，确定性；claimed 中的格子跳过：一人一坑） */
G.nearestPlantSpot = function (w, cx, cy, r, claimed, reachable) {
  for (let rad = 1; rad <= r; rad++)
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w.N || y >= w.N) continue;
        const i = y * w.N + x;
        if (w.water[i] || w.rock[i] || w.road[i] || w.treeIdx[i] >= 0 || w.bgrid[i] >= 0) continue;
        if (claimed && claimed.has(i)) continue;
        if (reachable && !reachable(x, y)) continue;
        return { x, y };
      }
  return null;
};
/* 建筑（或工地）旁最省预计时间的真实可达入口。
 * reachable 参数保留兼容旧调用；默认也不返回水面隔离的死口。 */
G.workSpot = function (w, b, fx, fy, reachable = false) {
  const spots = [];
  for (let j = b.y - 1; j <= b.y + b.h; j++)
    for (let i = b.x - 1; i <= b.x + b.w; i++) {
      const edge = (i < b.x || i >= b.x + b.w || j < b.y || j >= b.y + b.h);
      if (!edge) continue;
      if (i < 0 || j < 0 || i >= w.N || j >= w.N) continue;
      if (G.tileBlocked(w, i, j)) continue;
      spots.push({ x: i, y: j, building: b, state: b.state });
    }
  const route = G.findPathToAny(w, fx, fy, spots);
  return G.routeSpot(route);
};

/* ---------- 放置判定 ---------- */
G.canPlace = function (w, type, ox, oy) {
  const def = G.BDEF[type];
  const N = w.N;
  if (ox < 0 || oy < 0 || ox + def.w > N || oy + def.h > N) return { ok: false, reason: '超出地图范围' };
  let hasWater = false;
  for (let j = oy; j < oy + def.h; j++)
    for (let i = ox; i < ox + def.w; i++) {
      const t = j * N + i;
      if (w.water[t] === 1) return { ok: false, reason: '不能建在水上' };
      if (w.rock[t]) return { ok: false, reason: '地面有岩石，需先用采石采铁工具标记清除' };
      if (w.bgrid[t] >= 0) return { ok: false, reason: '与其他建筑重叠' };
    }
  // 等距视觉间距：脚印不重叠还不够——新建筑的前墙脚线（南缘）若落在已有建筑的
  // 屋顶投影内，画出来会像“盖在已有建筑上”；反向（新屋顶挡住旧前墙）同理。
  // 屋顶高约 28px ≈ 0.875 格，恰好盖住紧贴北/西侧一格内的墙脚。农田是平的，不参与。
  if (type !== 'farm') {
    const foot = oy + def.h;
    for (const b of w.buildings) {
      if (b.type === 'farm') continue;
      if (foot >= b.y && foot < b.y + b.h && ox < b.x + b.w && ox + def.w >= b.x)
        return { ok: false, reason: '与其他建筑贴得太近：会叠在它后面' };
      if (b.y + b.h >= oy && b.y + b.h < oy + def.h && b.x < ox + def.w && b.x + b.w >= ox)
        return { ok: false, reason: '与其他建筑贴得太近：会挡住它' };
    }
  }
  if (type === 'dock') {
    for (let j = oy - 1; j <= oy + def.h; j++)
      for (let i = ox - 1; i <= ox + def.w; i++) {
        if (i >= ox && i < ox + def.w && j >= oy && j < oy + def.h) continue;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        if (w.water[j * N + i] === 1) hasWater = true;
      }
    if (!hasWater) return { ok: false, reason: '码头必须紧邻水面' };
  }
  return { ok: true };
};
G.canPlaceRoad = function (w, x, y) {
  if (x < 0 || y < 0 || x >= w.N || y >= w.N) return false;
  const i = y * w.N + x;
  if (w.water[i] === 1 || w.rock[i] || w.bgrid[i] >= 0 || w.road[i]) return false;
  return true;
};

/* Two-endpoint dirt-road preview. Read-only, four-neighbour connected, bounded
 * work only on endpoint selection (never called by the render loop). */
G.planRoad = function (w, start, end, options) {
  options = options || {};
  const N = w.N, valid = p => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < N && p.y < N;
  if (!valid(start) || !valid(end)) return { ok: false, reason: '起终点必须在地图内' };
  const usable = (x, y) => x >= 0 && y >= 0 && x < N && y < N &&
    w.water[y * N + x] !== 1 && !w.rock[y * N + x] && w.bgrid[y * N + x] < 0;
  if (!usable(start.x, start.y)) return { ok: false, reason: '起点被水面、建筑或矿石挡住' };
  if (!usable(end.x, end.y)) return { ok: false, reason: '终点被水面、建筑或矿石挡住' };
  const distance = (x, y, p) => Math.abs(x - p.x) + Math.abs(y - p.y);
  const direct = distance(start.x, start.y, end), maxSteps = Math.ceil(direct * 1.75) + 16;
  const maxExpanded = Math.max(1, Math.min(20000, Number.isFinite(options.maxExpanded) ? Math.floor(options.maxExpanded) : 12000));
  let roadTiles = 0; for (const value of w.road) if (value) roadTiles++;
  let expanded = 0, budgetExceeded = false;
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  function search(weighted) {
    const scores = new Map(), parents = new Map(), steps = new Map(), closed = new Set(), heap = [];
    let order = 0;
    // Integer costs avoid floating tie drift; prefer deeper equal-cost prefixes.
    const estimate = (x, y, dir) => {
      const dx = end.x - x, dy = end.y - y, remaining = Math.abs(dx) + Math.abs(dy);
      if (!weighted) return remaining * 100;
      const xDir = dx > 0 ? 0 : 2, yDir = dy > 0 ? 1 : 3;
      const turns = !remaining ? 0 : dx && dy ? (dir === xDir || dir === yDir ? 1 : 2) : dir === (dx ? xDir : yDir) ? 0 : 1;
      return remaining * 115 - Math.min(remaining, roadTiles) * 15 + turns * 70;
    };
    const less = (a, b) => a.f < b.f || (a.f === b.f && (a.g > b.g || (a.g === b.g && a.order < b.order)));
    function push(node) {
      heap.push(node); let i = heap.length - 1;
      while (i) { const p = (i - 1) >> 1; if (!less(node, heap[p])) break; heap[i] = heap[p]; i = p; } heap[i] = node;
    }
    function pop() {
      const first = heap[0], last = heap.pop();
      if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1; if (child + 1 < heap.length && less(heap[child + 1], heap[child])) child++;
        if (!less(heap[child], last)) break; heap[i] = heap[child]; i = child;
      } heap[i] = last; } return first;
    }
    for (let dir = 0; dir < 4; dir++) {
      const id = (start.y * N + start.x) * 4 + dir;
      scores.set(id, 0); parents.set(id, -1); steps.set(id, 0); push({ id, g: 0, f: estimate(start.x, start.y, dir), order: order++ });
    }
    while (heap.length) {
      if (expanded >= maxExpanded) { budgetExceeded = true; return null; }
      const current = pop(), id = current.id;
      if (closed.has(id) || scores.get(id) !== current.g) continue;
      closed.add(id); expanded++;
      const cell = Math.floor(id / 4), x = cell % N, y = Math.floor(cell / N), dir = id % 4;
      if (x === end.x && y === end.y) {
        const path = []; let at = id;
        while (at >= 0) { const i = Math.floor(at / 4); path.push({ x: i % N, y: Math.floor(i / N) }); at = parents.get(at); }
        return path.reverse();
      }
      for (let d = 0; d < 4; d++) {
        const nx = x + directions[d][0], ny = y + directions[d][1];
        if (!usable(nx, ny)) continue;
        const nextStep = steps.get(id) + 1, remain = distance(nx, ny, end);
        if (nextStep + remain > maxSteps) continue;
        const ni = ny * N + nx, next = ni * 4 + d;
        if (closed.has(next)) continue;
        const cost = 100 + (weighted ? (d !== dir ? 70 : 0) + (w.road[ni] ? 0 : 15) + (w.treeIdx[ni] >= 0 ? 60 : 0) : 0);
        const score = current.g + cost;
        if (score >= (scores.get(next) ?? Infinity)) continue;
        scores.set(next, score); parents.set(next, id); steps.set(next, nextStep);
        push({ id: next, g: score, f: score + estimate(nx, ny, d), order: order++ });
      }
    }
    return null;
  }
  // If turn/clearance weighting exhausts an admissible prefix under the length
  // guard, a shortest-path fallback uses the same total node budget.
  const path = search(true) || (!budgetExceeded ? search(false) : null);
  if (!path) return { ok: false, reason: budgetExceeded ? '路线计算达到预算，请选择较近端点分段规划' : '没有连通路线，或绕行过远；请分段规划或先清障', expanded, maxSteps, budgetExceeded };
  let turns = 0, previous = null, newTiles = 0, reusedTiles = 0;
  const clearTrees = [];
  for (let j = 0; j < path.length; j++) {
    const p = path[j], i = p.y * N + p.x;
    if (w.road[i]) reusedTiles++; else newTiles++;
    if (w.treeIdx[i] >= 0) clearTrees.push({ x: p.x, y: p.y });
    if (j) { const d = [p.x - path[j - 1].x, p.y - path[j - 1].y]; if (previous && (d[0] !== previous[0] || d[1] !== previous[1])) turns++; previous = d; }
  }
  return { ok: true, path, steps: path.length - 1, turns, newTiles, reusedTiles, clearTrees, materials: { wood: 0, stone: 0 }, expanded, maxSteps };
};
