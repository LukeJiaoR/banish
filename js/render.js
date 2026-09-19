'use strict';
/* ============================================================
 * render.js —— 等距渲染：地面缓存、建筑、市民、树木、粒子
 * 坐标系：tile(z=1) 屏幕 = ((tx-ty)*32, (tx+ty)*16) + 相机
 * ============================================================ */

G.cam = { x: 0, y: 0, z: 1 };
G.groundScale = 0.5;   // 地面缓存画布降采样
G.groundOX = 0; G.groundOY = 0;
G.needGround = true;
G.groundDirty = new Set();  // 只变了道路/岩石的瓦片：局部重绘，不整图重建
G.smoke = [];
G.flakes = null;

/* 夜色浓度（0-1）：20 点入夜 → 22 点全暗 → 4 点最暗 → 6 点天亮 */
G.nightAlpha = function () {
  const h = G.game.h;
  if (h >= G.LIFE.restFrom || h < 4) return 0.42;
  if (h >= 20) return 0.42 * (h - 20) / (G.LIFE.restFrom - 20);
  if (h >= 4 && h < G.LIFE.restTo) return 0.42 * (1 - (h - 4) / (G.LIFE.restTo - 4));
  return 0;
};

/* tile → z=1 屏幕坐标（返回瓦片顶角） */
G.T2S = function (tx, ty) { return [(tx - ty) * 32, (tx + ty) * 16]; };

/* 屏幕(css px) → tile 浮点坐标 */
G.screenToTile = function (sx, sy) {
  const u = (sx - G.cam.x) / G.cam.z;
  const v = (sy - G.cam.y) / G.cam.z;
  const tx = u / 64 + v / 32;
  const ty = v / 32 - u / 64;
  return { tx, ty };
};

G.diamondPath = function (ctx, sx, sy) {
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + 32, sy + 16);
  ctx.lineTo(sx, sy + 32);
  ctx.lineTo(sx - 32, sy + 16);
  ctx.closePath();
};

/* ---------- 地面缓存（半分辨率整图；道路/岩石改动只局部重绘脏瓦片） ---------- */
G.markGroundDirty = function (x, y) {
  if (!G.world || x < 0 || y < 0 || x >= G.world.N || y >= G.world.N) return;
  G.groundDirty.add(y * G.world.N + x);
};

/* 画单个地面瓦片（陆地/道路/岩石 或 水体+岸线），整图与局部重绘共用 */
G.drawGroundTile = function (c, w, pal, x, y) {
  const N = w.N;
  const i = y * N + x;
  const [sx, sy] = G.T2S(x, y);
  if (w.water[i] === 1) {
    G.diamondPath(c, sx, sy);
    c.fillStyle = pal.water;
    c.fill();
    c.strokeStyle = pal.water;
    c.lineWidth = 1;
    c.stroke();
    c.strokeStyle = pal.shore;
    c.lineWidth = 1.5;
    const corner = [[sx, sy, sx + 32, sy + 16], [sx + 32, sy + 16, sx, sy + 32], [sx, sy + 32, sx - 32, sy + 16], [sx - 32, sy + 16, sx, sy]];
    const nbs = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
    for (let k = 0; k < 4; k++) {
      const nx = nbs[k][0], ny = nbs[k][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || w.water[ny * N + nx] === 1) continue; // 只在邻格是陆地时描岸线
      c.beginPath();
      c.moveTo(corner[k][0], corner[k][1]);
      c.lineTo(corner[k][2], corner[k][3]);
      c.stroke();
    }
    return;
  }
  const h = G.h2(w.seed + 5, x, y);
  let col = pal.grass;
  if (w.water[i] === 2) col = pal.sand;
  else col = h < 0.33 ? pal.grassAlt : (h > 0.8 ? pal.grassDark : pal.grass);
  if (w.road[i]) col = h < 0.5 ? pal.road : pal.roadAlt;
  G.diamondPath(c, sx, sy);
  c.fillStyle = col;
  c.fill();
  c.strokeStyle = col;   // 同色描边消除瓦片接缝
  c.lineWidth = 1;
  c.stroke();
  // 岩石露头（1=石头 2=铁矿，锈色）
  if (w.rock[i]) {
    const iron = w.rock[i] === 2;
    const rk = iron ? pal.iron : pal.rock, rkD = iron ? pal.ironD : pal.rockD;
    const cx = sx, cy = sy + 16;
    c.fillStyle = rkD;
    c.beginPath(); c.ellipse(cx + 4, cy + 4, 9, 5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = rk;
    c.beginPath(); c.ellipse(cx - 2, cy - 1, 10, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = rkD;
    c.beginPath(); c.ellipse(cx - 6, cy + 5, 5, 3, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.beginPath(); c.ellipse(cx - 4, cy - 3, 5, 2.5, 0, 0, Math.PI * 2); c.fill();
  }
};

G.buildGround = function () {
  const w = G.world, N = w.N, s = G.groundScale;
  const partial = !G.needGround && !!G._gcv && G.groundDirty.size > 0;
  G.groundOX = N * 32 + 40;
  G.groundOY = 40;
  const gw = Math.ceil((N * 64 + 80) * s), gh = Math.ceil((N * 32 + 80) * s);
  if (!G._gcv) G._gcv = document.createElement('canvas');
  if (G._gcv.width !== gw || G._gcv.height !== gh) { G._gcv.width = gw; G._gcv.height = gh; }
  const c = G._gcv.getContext('2d');
  c.setTransform(s, 0, 0, s, G.groundOX * s, G.groundOY * s);
  const pal = G.PAL[G.game.season];

  if (partial) {
    // 局部重绘：脏瓦片 + 四邻（描边会轻微外溢到相邻瓦片）；先陆地后水体，保持岸线压在陆地上
    const uniq = new Set();
    for (const idx of G.groundDirty) {
      const x = idx % N, y = (idx / N) | 0;
      uniq.add(idx);
      if (x > 0) uniq.add(idx - 1);
      if (x < N - 1) uniq.add(idx + 1);
      if (y > 0) uniq.add(idx - N);
      if (y < N - 1) uniq.add(idx + N);
    }
    for (const idx of uniq) if (w.water[idx] !== 1) G.drawGroundTile(c, w, pal, idx % N, (idx / N) | 0);
    for (const idx of uniq) if (w.water[idx] === 1) G.drawGroundTile(c, w, pal, idx % N, (idx / N) | 0);
  } else {
    c.clearRect(-G.groundOX, -G.groundOY, N * 64 + 80, N * 32 + 80);
    c.fillStyle = pal.bg;
    c.fillRect(-G.groundOX, -G.groundOY, N * 64 + 80, N * 32 + 80);
    // 陆地（含道路、岩石），再水体（含岸线）——保持水面岸线压在陆地上
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        if (w.water[y * N + x] !== 1) G.drawGroundTile(c, w, pal, x, y);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        if (w.water[y * N + x] === 1) G.drawGroundTile(c, w, pal, x, y);
  }
  G.groundDirty.clear();
  G.needGround = false;
};

/* ---------- 树 ---------- */
G.drawTree = function (ctx, t) {
  const [sx, sy] = G.T2S(t.x, t.y);
  const by = sy + 16;
  const stage = G.treeStage(t);
  const col = G.TREE_COLORS.canopy[(t.x * 7 + t.y * 13) % G.TREE_COLORS.canopy.length];
  const trunk = G.TREE_COLORS.trunk;
  const winter = G.isWinter();
  if (stage === 0) {
    ctx.fillStyle = trunk; ctx.fillRect(sx - 0.7, by - 5, 1.4, 5);
    tri(ctx, sx, by - 5, 4.5, 7, col);
  } else if (stage === 1) {
    ctx.fillStyle = trunk; ctx.fillRect(sx - 1.2, by - 9, 2.4, 9);
    tri(ctx, sx, by - 14, 7, 9, col);
    tri(ctx, sx, by - 8, 8.5, 9, col);
    if (winter) tri(ctx, sx, by - 14, 5.5, 4, G.TREE_COLORS.snowCap);
  } else {
    ctx.fillStyle = trunk; ctx.fillRect(sx - 1.8, by - 13, 3.6, 13);
    tri(ctx, sx, by - 19, 7.5, 10, col);
    tri(ctx, sx, by - 13, 9.5, 10, col);
    tri(ctx, sx, by - 7, 11, 10, col);
    if (winter) {
      tri(ctx, sx, by - 19, 6, 4, G.TREE_COLORS.snowCap);
      tri(ctx, sx, by - 13, 7.5, 3.5, G.TREE_COLORS.snowCap);
    }
  }
};
function tri(ctx, cx, top, halfW, h, col) {
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + halfW, top + h);
  ctx.lineTo(cx - halfW, top + h);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
}

/* ---------- 建筑 ---------- */
function quadFill(ctx, x1, y1, x2, y2, x3, y3, x4, y4, col) {
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
}

G.drawBuilding = function (ctx, b, time) {
  const w = G.world;
  const T = G.T2S(b.x, b.y);
  const R = G.T2S(b.x + b.w, b.y);
  const B = G.T2S(b.x + b.w, b.y + b.h);
  const L = G.T2S(b.x, b.y + b.h);
  const def = G.BDEF[b.type];

  if (b.type === 'farm') { G.drawFarm(ctx, b); return; }
  if (b.type === 'dock') { G.drawDock(ctx, b); return; }

  if (b.state === 'site') {
    // 工地：地基 + 木架
    G.diamondPath(ctx, T[0], T[1]);
    ctx.fillStyle = 'rgba(120,90,55,0.35)';
    ctx.fill();
    ctx.strokeStyle = '#a8845a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = '#8a6a42';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(T[0], T[1]); ctx.lineTo(T[0], T[1] - 16);
    ctx.moveTo(R[0], R[1]); ctx.lineTo(R[0], R[1] - 16);
    ctx.moveTo(B[0], B[1]); ctx.lineTo(B[0], B[1] - 16);
    ctx.moveTo(L[0], L[1]); ctx.lineTo(L[0], L[1] - 16);
    ctx.stroke();
    // 进度条
    const px = (T[0] + B[0]) / 2, py = T[1] - 24;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px - 16, py, 32, 4);
    ctx.fillStyle = '#d8b25a';
    ctx.fillRect(px - 16, py, 32 * b.progress, 4);
    return;
  }

  const H = b.type === 'storage' ? 17 : 20;
  // 右墙（东南面，暗）
  quadFill(ctx, R[0], R[1], B[0], B[1], B[0], B[1] - H, R[0], R[1] - H, def.wallD);
  // 左墙（西南面，亮）
  quadFill(ctx, L[0], L[1], B[0], B[1], B[0], B[1] - H, L[0], L[1] - H, def.wall);
  // 门（左墙中部）
  const mx = (L[0] + B[0]) / 2, my = (L[1] + B[1]) / 2 - H;
  quadFill(ctx, mx - 3, my + 6, mx + 1, my + 8, mx + 1, my + 13, mx - 3, my + 11, '#3a2a1a');
  // 窗（住宅冬夜透光）
  if (def.isHome) {
    const wx = (B[0] + R[0]) / 2, wy = (B[1] + R[1]) / 2 - H;
    ctx.fillStyle = (G.isWinter() || G.nightAlpha() > 0.15) ? '#ffd98a' : '#2e2013';
    ctx.fillRect(wx - 2.5, wy + 3, 5, 4);
  }
  // 屋顶（整体上移，微外扩）
  const o = 0.22;
  const Tr = G.T2S(b.x - o, b.y - o), Rr = G.T2S(b.x + b.w + o, b.y - o),
        Br = G.T2S(b.x + b.w + o, b.y + b.h + o), Lr = G.T2S(b.x - o, b.y + b.h + o);
  const roofH = H + (def.isHome ? 8 : 4);
  // 屋顶两坡
  quadFill(ctx, Tr[0], Tr[1] - roofH, Br[0], Br[1] - roofH, Lr[0], Lr[1] - roofH + 0.1, Lr[0], Lr[1] - roofH + 0.1, def.roof);
  ctx.beginPath();
  ctx.moveTo(Tr[0], Tr[1] - roofH);
  ctx.lineTo(Rr[0], Rr[1] - roofH);
  ctx.lineTo(Br[0], Br[1] - roofH);
  ctx.lineTo(Lr[0], Lr[1] - roofH);
  ctx.closePath();
  ctx.fillStyle = def.roof;
  ctx.fill();
  // 屋脊亮线
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Tr[0], Tr[1] - roofH);
  ctx.lineTo(Br[0], Br[1] - roofH);
  ctx.stroke();
  // 烟囱（住宅与宿舍）
  if (def.chimney) {
    const cx = Tr[0] + (Br[0] - Tr[0]) * 0.25, cy = Tr[1] + (Br[1] - Tr[1]) * 0.25 - roofH;
    ctx.fillStyle = '#5a5148';
    ctx.fillRect(cx - 2.5, cy - 7, 5, 9);
    b._chimney = [cx, cy - 7];
  }
};

G.drawFarm = function (ctx, b) {
  const pal = G.PAL[G.game.season];
  for (const f of b.farm) {
    const [sx, sy] = G.T2S(f.x, f.y);
    G.diamondPath(ctx, sx, sy);
    ctx.fillStyle = f.harvested ? (pal.snow ? '#aeb6bd' : '#7a5c39') : pal.soil;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    if (f.sown && !f.harvested) {
      const g = b.growth;
      const cropCol = g >= 1 ? (G.game.season === 2 ? '#d8b23a' : '#c8a83a') : G.lerpColor('#5d8a3a', '#c2a13a', g);
      const rr = 1 + g * 1.6;
      ctx.fillStyle = cropCol;
      for (let k = 0; k < 4; k++) {
        const dx = (k % 2 ? 10 : -10), dy = (k < 2 ? -5 : 5) + 16;
        ctx.beginPath();
        ctx.arc(sx + dx, sy + dy - rr, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
};

G.drawDock = function (ctx, b) {
  const T = G.T2S(b.x, b.y);
  const R = G.T2S(b.x + b.w, b.y);
  const B = G.T2S(b.x + b.w, b.y + b.h);
  const L = G.T2S(b.x, b.y + b.h);
  // 平台
  ctx.beginPath();
  ctx.moveTo(T[0], T[1]); ctx.lineTo(R[0], R[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(L[0], L[1]);
  ctx.closePath();
  ctx.fillStyle = '#96714a';
  ctx.fill();
  ctx.strokeStyle = '#6d5034';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 木纹
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let k = 1; k < 4; k++) {
    const a = G.T2S(b.x + k * b.w / 4, b.y), c2 = G.T2S(b.x + k * b.w / 4, b.y + b.h);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
  }
  // 小屋
  const H = 12;
  const M = G.T2S(b.x + 0.5, b.y + 0.5);
  quadFill(ctx, M[0], M[1] - 8, M[0] + 14, M[1] + 0, M[0] + 14, M[1] - H, M[0], M[1] - 8 - H, '#7a5c3e');
  quadFill(ctx, M[0] + 14, M[1], M[0] + 22, M[1] - 8, M[0] + 22, M[1] - 8 - H, M[0] + 14, M[1] - H, '#5e4630');
  // 水桶
  ctx.fillStyle = '#8a5a3a';
  ctx.fillRect(M[0] - 8, M[1] - 6, 4, 5);
};

G.lerpColor = (function () {
  const cache = {};
  return function (a, b, t) {
    t = G.clamp(t, 0, 1);
    const key = a + b + ((t * 10) | 0);
    if (cache[key]) return cache[key];
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(G.lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
    const g = Math.round(G.lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
    const bl = Math.round(G.lerp(pa & 255, pb & 255, t));
    const v = `rgb(${r},${g},${bl})`;
    cache[key] = v;
    return v;
  };
})();

/* ---------- 市民 ---------- */
G.drawCitizen = function (ctx, c, time) {
  const [sx, sy0] = G.T2S(c.x, c.y);
  const sy = sy0 + 16;
  const child = c.age < G.ADULT_AGE;
  const s = child ? 0.72 : 1;
  const walking = c.state === 'walk' || c.state === 'haul';
  const bob = walking ? Math.abs(Math.sin(c.animT)) * 1.2 : (c.state === 'work' ? Math.abs(Math.sin(c.animT)) * 0.8 : 0);
  const resting = c.state === 'rest';
  if (resting) ctx.globalAlpha = 0.55; // 睡觉中的市民淡显
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 3.4 * s, 1.7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 身体
  ctx.fillStyle = child ? '#a3703f' : '#6e4a33';
  ctx.fillRect(sx - 1.7 * s, sy - 7.5 * s - bob, 3.4 * s, 5.2 * s);
  // 头
  ctx.fillStyle = '#d8a37a';
  ctx.beginPath();
  ctx.arc(sx, sy - 8.6 * s - bob, 1.8 * s, 0, Math.PI * 2);
  ctx.fill();
  // 携带物
  if (c.carry) {
    ctx.fillStyle = G.RES[c.carry.type].color;
    ctx.fillRect(sx + 1.6 * s, sy - 5.4 * s - bob, 2.6, 2.6);
  }
  // 选中圈
  if (G.sel && G.sel.kind === 'c' && G.sel.id === c.id) {
    ctx.strokeStyle = 'rgba(255,235,170,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 5.5 * s, 2.8 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (resting) ctx.globalAlpha = 1;
};

/* ---------- 粒子 ---------- */
G.updateParticles = function (dt) {
  // 炊烟
  if (G.isWinter() && !G.game.paused) {
    for (const b of G.world.buildings) {
      const def = G.BDEF[b.type];
      const lived = b.type === 'boarding' ? G.boardingFamilies(G.world, b).length > 0 : b.family != null;
      if (def.chimney && b.state === 'ok' && lived && b._chimney && Math.random() < 0.06) {
        G.smoke.push({ x: b._chimney[0], y: b._chimney[1], age: 0, max: 2.5 + Math.random() * 2 });
      }
    }
  }
  for (let i = G.smoke.length - 1; i >= 0; i--) {
    const p = G.smoke[i];
    p.age += dt;
    p.y -= dt * 9;
    p.x += Math.sin(p.age * 3) * dt * 3;
    if (p.age > p.max) G.smoke.splice(i, 1);
  }
  // 雪
  if (G.isWinter()) {
    if (!G.flakes) {
      G.flakes = [];
      for (let i = 0; i < 130; i++)
        G.flakes.push({ x: Math.random(), y: Math.random(), v: 0.05 + Math.random() * 0.1, ph: Math.random() * 10, r: 0.8 + Math.random() * 1.4 });
    }
    for (const f of G.flakes) {
      f.y += f.v * dt;
      f.ph += dt;
      if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
    }
  } else G.flakes = null;
};

/* ---------- 主绘制 ---------- */
G.frame = function (dtReal) {
  const cv = G.cv, ctx = G.ctx;
  G.updateParticles(dtReal);
  if (G.needGround || G.groundDirty.size) G.buildGround();

  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  ctx.fillStyle = '#14181d';
  ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);

  const z = G.cam.z;
  ctx.setTransform(G.dpr * z, 0, 0, G.dpr * z, G.dpr * G.cam.x, G.dpr * G.cam.y);

  // 地面
  ctx.drawImage(G._gcv, -G.groundOX, -G.groundOY,
    G._gcv.width / G.groundScale, G._gcv.height / G.groundScale);

  const w = G.world;

  // 建造幽灵：贴着地面画、在建筑之前——后面的建筑/树会正确把它挡住，
  // 不会出现“绿色预览浮在已有建筑上”的误导
  if (G.tool && G.tool.kind === 'build' && G.hover.tx >= 0) {
    const def = G.BDEF[G.tool.type];
    const ox = G.hover.tx - ((def.w - 1) >> 1), oy = G.hover.ty - ((def.h - 1) >> 1);
    const chk = G.canPlace(w, G.tool.type, ox, oy);
    for (let j = 0; j < def.h; j++)
      for (let i = 0; i < def.w; i++) {
        const [sx, sy] = G.T2S(ox + i, oy + j);
        G.diamondPath(ctx, sx, sy);
        ctx.fillStyle = chk.ok ? 'rgba(120,230,140,0.4)' : 'rgba(230,90,80,0.4)';
        ctx.fill();
      }
    G._ghost = { ox, oy };
  } else G._ghost = null;

  // 道路工具悬停（同样贴地）
  if (G.tool && G.tool.kind === 'road' && G.hover.tx >= 0) {
    const [sx, sy] = G.T2S(G.hover.tx, G.hover.ty);
    G.diamondPath(ctx, sx, sy);
    ctx.fillStyle = G.canPlaceRoad(w, G.hover.tx, G.hover.ty) ? 'rgba(120,230,140,0.4)' : 'rgba(230,90,80,0.4)';
    ctx.fill();
  }

  // 可视瓦片范围
  const W = cv.clientWidth, H = cv.clientHeight;
  const corners = [G.screenToTile(0, 0), G.screenToTile(W, 0), G.screenToTile(0, H), G.screenToTile(W, H)];
  let tx0 = 1e9, ty0 = 1e9, tx1 = -1e9, ty1 = -1e9;
  for (const c of corners) {
    tx0 = Math.min(tx0, c.tx); tx1 = Math.max(tx1, c.tx);
    ty0 = Math.min(ty0, c.ty); ty1 = Math.max(ty1, c.ty);
  }
  tx0 = Math.max(0, Math.floor(tx0) - 2); ty0 = Math.max(0, Math.floor(ty0) - 2);
  tx1 = Math.min(G.world.N - 1, Math.ceil(tx1) + 2); ty1 = Math.min(G.world.N - 1, Math.ceil(ty1) + 4);

  const items = [];
  // 树
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      const idx = w.treeIdx[y * w.N + x];
      if (idx >= 0) items.push({ d: x + y, k: 0, x, y, t: w.trees[idx], marked: w.marked.has(y * w.N + x) });
    }
  // 建筑
  for (const b of w.buildings) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (cx < tx0 - 3 || cx > tx1 + 3 || cy < ty0 - 3 || cy > ty1 + 3) continue;
    items.push({ d: b.x + b.y + b.w + b.h - 2 - 0.5, k: 1, b });
  }
  // 市民
  for (const c of w.citizens) {
    if (c.x < tx0 - 1 || c.x > tx1 + 1 || c.y < ty0 - 1 || c.y > ty1 + 1) continue;
    items.push({ d: c.x + c.y + 0.01, k: 2, c });
  }
  items.sort((a, b) => a.d - b.d);
  const now = performance.now() / 1000;
  for (const it of items) {
    if (it.k === 0) {
      G.drawTree(ctx, it.t);
      if (it.marked) { // 待砍标记（原版 Harvest Trees 的选中态）
        const [msx, msy] = G.T2S(it.x, it.y);
        G.diamondPath(ctx, msx, msy);
        ctx.strokeStyle = 'rgba(255,170,60,0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    else if (it.k === 1) {
      G.drawBuilding(ctx, it.b, now);
      // 警告标记
      if (it.b.noWork && it.b.state === 'ok') {
        const T = G.T2S(it.b.x + it.b.w / 2, it.b.y);
        ctx.font = '13px system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffcf4d';
        ctx.fillText('⚠', T[0], T[1] - 30);
      }
    } else G.drawCitizen(ctx, it.c, now);
  }

  // 悬停瓦片
  if (G.hover && G.hover.tx >= 0 && !G.tool) {
    const [sx, sy] = G.T2S(G.hover.tx, G.hover.ty);
    G.diamondPath(ctx, sx, sy);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 选中建筑高亮
  if (G.sel && G.sel.kind === 'b') {
    const b = w.bmap[G.sel.id];
    if (b) {
      const T = G.T2S(b.x, b.y), R = G.T2S(b.x + b.w, b.y), B = G.T2S(b.x + b.w, b.y + b.h), L = G.T2S(b.x, b.y + b.h);
      ctx.strokeStyle = `rgba(255,235,170,${0.5 + Math.sin(now * 4) * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(T[0], T[1]); ctx.lineTo(R[0], R[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(L[0], L[1]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // 炊烟（世界层）
  for (const p of G.smoke) {
    const a = Math.max(0, 1 - p.age / p.max);
    ctx.fillStyle = `rgba(210,210,215,${a * 0.35})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2 + p.age * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 屏幕空间：夜色 + 雪
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  const na = G.nightAlpha();
  if (na > 0) {
    ctx.fillStyle = `rgba(14,20,48,${na})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (G.flakes) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (const f of G.flakes) {
      const fx = (f.x + Math.sin(f.ph) * 0.01) * W;
      ctx.beginPath();
      ctx.arc(fx, f.y * H, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 地面缓存清晰度：缩放稳定后按当前倍率重建（上限 1 倍，控制内存）
  const tgt = G.clamp(z, 0.55, 1);
  if (Math.abs(tgt - G.groundScale) > 0.12 && !G._gsTimer) {
    G._gsTimer = setTimeout(() => {
      G._gsTimer = null;
      G.groundScale = G.clamp(G.cam.z, 0.55, 1);
      G.needGround = true;
    }, 250);
  } else if (Math.abs(tgt - G.groundScale) <= 0.12 && G._gsTimer) {
    clearTimeout(G._gsTimer);
    G._gsTimer = null;
  }
};
