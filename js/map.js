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
G.genWorld = function (seed) {
  const N = G.MAP;
  const w = {
    seed, N,
    water: new Uint8Array(N * N),
    rock: new Uint8Array(N * N),
    rockCleared: [],
    road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1),   // 建筑占位（存建筑 id）
    treeIdx: new Int32Array(N * N).fill(-1), // 树（存 trees 数组下标）
    trees: [],
    buildings: [],
    bmap: {},
    citizens: [],
    cmap: {},
    families: [],
    marked: new Set(),  // 「砍伐」工具标记的树（散工来砍）
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

  // 岩石露头（噪声成簇，原版初期石头来源）
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (w.water[i]) continue;
      if (fbm(seed + 555, x, y) > 0.715) w.rock[i] = 1;
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

  // 寻找镇址：平坦陆地 + 附近有森林 + 不太远有水
  let best = null, bestScore = -1;
  const cx = N >> 1, cy = N >> 1;
  for (let r = 0; r < N; r += 2) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const sx = Math.round(cx + Math.cos(ang) * r), sy = Math.round(cy + Math.sin(ang) * r);
      if (sx < 6 || sy < 6 || sx > N - 7 || sy > N - 7) continue;
      if (!G.areaLand(w, sx - 2, sy - 2, 6, 6)) continue;
      const forest = G.countTreesInRadius(w, sx, sy, 8);
      const waterN = G.countWaterInRadius(w, sx, sy, 12);
      if (forest < 25 || waterN < 6) continue;
      const score = forest + waterN - r * 0.6;
      if (score > bestScore) { bestScore = score; best = { x: sx, y: sy }; }
    }
    if (best && r > 10) break;
  }
  if (best) w.start = best;
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
/* 清理岩石 → 石头入库（原版：在岩石上盖房/铺路即采石） */
G.clearRock = function (w, x, y) {
  if (x < 0 || y < 0 || x >= w.N || y >= w.N) return false;
  const i = y * w.N + x;
  if (!w.rock[i]) return false;
  w.rock[i] = 0;
  w.rockCleared.push(i);
  G.markGroundDirty(x, y);
  if (G.game) G.game.res.stone += G.ROCK_STONE;
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
/* 取离散工最近的标记树（claimed 中的坐标跳过：一人一树） */
G.pickMarkedTree = function (w, x, y, claimed) {
  let best = null, bd = Infinity;
  for (const i of w.marked) {
    if (claimed && claimed.has(i)) continue;
    const idx = w.treeIdx[i];
    if (idx < 0) continue;
    const tx = i % w.N, ty = (i / w.N) | 0;
    const d = G.d2(x, y, tx, ty);
    if (d < bd) { bd = d; best = { x: tx, y: ty, tree: w.trees[idx] }; }
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

/* A* 寻路（8 向，禁止穿角；二叉堆开表，路面加速） */
const PF_DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.42], [1, -1, 1.42], [-1, 1, 1.42], [-1, -1, 1.42]];

G.findPath = function (w, sx, sy, tx, ty) {
  sx |= 0; sy |= 0; tx |= 0; ty |= 0;
  if (G.tileBlocked(w, tx, ty)) {
    const alt = G.nearestWalkable(w, tx, ty, 4);
    if (!alt) return null;
    tx = alt.x; ty = alt.y;
  }
  if (sx === tx && sy === ty) return [];
  const N = w.N;
  const gen = ++G._pfGen || (G._pfGen = 1);
  if (!w._pf) {
    w._pf = { g: new Float32Array(N * N), f: new Float32Array(N * N), from: new Int32Array(N * N), gen: new Int32Array(N * N), closed: new Int32Array(N * N) };
  }
  const pf = w._pf;
  // 二叉小顶堆：按 f 取最小。允许重复入堆（代替 decrease-key），弹出时用 closed 标记跳过过期项
  const heap = [];
  let hn = 0;
  const push = (i) => {
    let k = hn++;
    heap[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (pf.f[heap[p]] <= pf.f[heap[k]]) break;
      const t = heap[p]; heap[p] = heap[k]; heap[k] = t;
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    hn--;
    if (hn > 0) {
      heap[0] = heap[hn];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < hn && pf.f[heap[l]] < pf.f[heap[m]]) m = l;
        if (r < hn && pf.f[heap[r]] < pf.f[heap[m]]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t;
        k = m;
      }
    }
    return top;
  };
  const start = sy * N + sx, goal = ty * N + tx;
  pf.g[start] = 0; pf.f[start] = Math.hypot(tx - sx, ty - sy); pf.from[start] = -1; pf.gen[start] = gen;
  push(start);
  let iter = 0, found = false;
  while (hn > 0) {
    if (++iter > 20000) break;
    const cur = pop();
    if (pf.closed[cur] === gen) continue; // 过期堆项
    pf.closed[cur] = gen;
    if (cur === goal) { found = true; break; }
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
      const ng = pf.g[cur] + base * (w.road[ni] ? 0.55 : 1);
      if (pf.gen[ni] !== gen || ng < pf.g[ni]) {
        pf.gen[ni] = gen;
        pf.g[ni] = ng;
        pf.f[ni] = ng + Math.hypot(tx - nx, ty - ny);
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
/* 最近的可种树空地（螺旋扫描，确定性） */
G.nearestPlantSpot = function (w, cx, cy, r) {
  for (let rad = 1; rad <= r; rad++)
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w.N || y >= w.N) continue;
        const i = y * w.N + x;
        if (w.water[i] || w.rock[i] || w.road[i] || w.treeIdx[i] >= 0 || w.bgrid[i] >= 0) continue;
        return { x, y };
      }
  return null;
};
/* 建筑（或工地）旁的可站立点：离 (fx,fy) 最近 */
G.workSpot = function (w, b, fx, fy) {
  let best = null, bd = Infinity;
  for (let j = b.y - 1; j <= b.y + b.h; j++)
    for (let i = b.x - 1; i <= b.x + b.w; i++) {
      const edge = (i < b.x || i >= b.x + b.w || j < b.y || j >= b.y + b.h);
      if (!edge) continue;
      if (i < 0 || j < 0 || i >= w.N || j >= w.N) continue;
      if (G.tileBlocked(w, i, j)) continue;
      const d = G.d2(i, j, fx, fy);
      if (d < bd) { bd = d; best = { x: i, y: j }; }
    }
  return best;
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
      if (w.bgrid[t] >= 0) return { ok: false, reason: '与其他建筑重叠' };
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
  if (w.water[i] === 1 || w.bgrid[i] >= 0 || w.road[i]) return false;
  return true;
};
