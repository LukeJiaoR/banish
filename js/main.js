'use strict';
/* ============================================================
 * main.js —— 初始化、游戏循环、输入、存档
 * ============================================================ */

G.cv = null;
G.ctx = null;
G.dpr = 1;
G.tool = null;                 // null | {kind:'build',type} | {kind:'road'} | {kind:'demolish'}
G.hover = { tx: -1, ty: -1 };
G.sel = null;
G.keys = {};

/* ---------- 新游戏 ---------- */
G.newGame = function (seed) {
  seed = seed || ((Math.random() * 0xffffffff) >>> 0);
  G.rng = G.makeRng(seed ^ 0x51f15e);
  G.world = G.genWorld(seed);
  // 原版「中等」难度开局：4 个家庭（无房），一辆储物车（仓库）
  // 资源：木 80 / 石 48 / 食物 200 / 柴火 24
  G.game = G.newGameState();
  G.game.res = { wood: 80, stone: 48, food: 200, firewood: 24 };
  G.sel = null;
  G.tool = null;
  G.smoke = [];
  G.flakes = null;
  localStorage.removeItem(G.AUTOSAVE_KEY); // 主动重开时清掉旧自动存档
  G.ui.hideInfo();
  G.ui.setToolActive();
  document.getElementById('over').classList.add('hidden');

  const s = G.world.start;
  G.addBuilding('storage', s.x - 1, s.y - 1, { instant: true, free: true });

  // 4 个家庭：2 名成人 + 若干孩子（原版开局全部无家可归，入冬前必须盖房）
  let kidPlan = [2, 2, 1, 0];
  for (let f = 0; f < 4; f++) {
    const ang = (f / 4) * Math.PI * 2;
    const hx = s.x + Math.round(Math.cos(ang) * 2), hy = s.y + Math.round(Math.sin(ang) * 2);
    const m = G.spawnCitizen({ x: hx, y: hy, sex: 'm', age: G.ri(19, 38) });
    const fm = G.spawnCitizen({ x: hx, y: hy, sex: 'f', age: G.ri(18, 36) });
    const fam = { id: G.nextId(), members: [m.id, fm.id], houseId: null };
    m.familyId = fam.id; fm.familyId = fam.id;
    G.world.families.push(fam);
    for (let k = 0; k < kidPlan[f]; k++) {
      const kid = G.spawnCitizen({ x: hx, y: hy, age: G.ri(2, 9), adult: false, familyId: fam.id });
      fam.members.push(kid.id);
    }
  }

  // 相机对准镇址
  const [sx, sy] = G.T2S(s.x, s.y);
  G.cam.x = window.innerWidth / 2 - sx * G.cam.z;
  G.cam.y = window.innerHeight / 2 - sy * G.cam.z;
  G.needGround = true;
  G.groundDirty.clear();

  G.ui.toast('归园 · 放逐小镇复刻原型（原版数值）', 'good');
  G.ui.toast('中难度开局：4 个家庭无家可归。先盖木屋（16木+8石）安家，再修采集小屋、护林小屋保食物木材', 'warn');
  G.ui.toast('在岩石上盖房/铺路可获得石头 · 入冬前备好柴火（每屋每年约 30）', 'info');
  G.scheduleJobs();
  G.ui.refreshHUD();
};

/* ---------- 存档 ---------- */
/* 序列化当前对局（存档与反馈快照共用；不含 savedAt） */
G.serializeGame = function () {
  const w = G.world, g = G.game;
  return {
    v: 1, seed: w.seed,
    game: {
      h: g.h, day: g.day, season: g.season, year: g.year,
      res: g.res, stats: g.stats, prevFood: g.prevFood, foodNet: g.foodNet, warned: g.warned,
    },
      trees: w.trees.map(t => [t.i, t.x, t.y, t.b]),
      marked: [...w.marked],
      rockCleared: w.rockCleared,
    buildings: w.buildings.map(b => ({
      id: b.id, type: b.type, x: b.x, y: b.y, state: b.state,
      progress: b.progress, workLeft: b.workLeft, totalWork: b.totalWork,
      workers: b.workers, family: b.family, noWork: b.noWork, warnText: b.warnText,
      doCut: b.doCut, doPlant: b.doPlant,
      farm: b.farm ? b.farm.map(f => [f.sown ? 1 : 0, f.harvested ? 1 : 0]) : undefined,
      sownAll: b.sownAll, growth: b.growth, harvestDone: b.harvestDone,
    })),
    families: w.families.map(f => ({ id: f.id, members: f.members, houseId: f.houseId })),
    citizens: w.citizens.map(c => ({
      id: c.id, name: c.name, sex: c.sex, age: c.age, adult: c.adult,
      x: c.x, y: c.y, familyId: c.familyId, job: c.job,
      student: c.student ? 1 : 0, educated: c.educated ? 1 : 0, school: c.school != null ? c.school : null,
      hunger: c.hunger, cold: c.cold, carry: c.carry,
    })),
    nextUid: G._peekUid(),
  };
};

G.saveGame = function (key, silent) {
  key = key || G.SAVE_KEY;
  try {
    const data = G.serializeGame();
    data.savedAt = Date.now();
    localStorage.setItem(key, JSON.stringify(data));
    if (!silent) G.ui.toast('💾 已保存', 'good');
  } catch (e) {
    G.ui.toast('保存失败：' + e.message, 'bad');
  }
};

/* 自动存档（换季 / 离开页面时调用，启动时自动恢复） */
G.autosave = function () {
  if (G.world && !G.game.over) G.saveGame(G.AUTOSAVE_KEY, true);
};

G._peekUid = function () {
  // 生成一个 id 保证单调，再回退
  const v = G.nextId();
  G.setUid(v - 1);
  return v;
};

G.loadGame = function (key) {
  key = key || G.SAVE_KEY;
  const raw = localStorage.getItem(key);
  if (!raw) { G.ui.toast('没有找到存档', 'warn'); return; }
  try {
    const d = JSON.parse(raw);
    G.rng = G.makeRng((d.seed ^ 0x51f15e) >>> 0);
    G.world = G.genWorld(d.seed);
    G.game = G.newGameState();
    const g = G.game, w = G.world;
    Object.assign(g, d.game);
    G.sel = null; G.tool = null; G.smoke = []; G.flakes = null;
    G.ui.hideInfo(); G.ui.setToolActive();
    document.getElementById('over').classList.add('hidden');

    G.setUid(d.nextUid || 10000);
    // 树：清空重建
    w.trees = []; w.treeIdx.fill(-1);
    for (const [i, x, y, b] of d.trees) {
      w.trees.push({ i, x, y, b });
      w.treeIdx[i] = w.trees.length - 1;
    }
    // 已清理的岩石
    for (const i of d.rockCleared || []) {
      w.rock[i] = 0;
      w.rockCleared.push(i);
    }
    // 「砍伐」标记
    if (d.marked) for (const i of d.marked) w.marked.add(i);
    // 建筑
    for (const bd of d.buildings) {
      const b = {
        id: bd.id, type: bd.type, x: bd.x, y: bd.y, w: G.BDEF[bd.type].w, h: G.BDEF[bd.type].h,
        state: bd.state, progress: bd.progress, workLeft: bd.workLeft, totalWork: bd.totalWork,
        workers: bd.workers, family: bd.family, noWork: bd.noWork, warnText: bd.warnText || '',
        doCut: bd.doCut !== false, doPlant: bd.doPlant !== false, // 旧档无此字段默认全开
      };
      if (bd.type === 'farm') {
        b.farm = [];
        let k = 0;
        for (let j = b.y; j < b.y + b.h; j++)
          for (let i = b.x; i < b.x + b.w; i++)
            b.farm.push({ x: i, y: j, sown: !!bd.farm[k][0], harvested: !!bd.farm[k][1] }), k++;
        b.sownAll = bd.sownAll; b.growth = bd.growth; b.harvestDone = bd.harvestDone;
      }
      w.buildings.push(b);
      w.bmap[b.id] = b;
      for (let j = b.y; j < b.y + b.h; j++)
        for (let i = b.x; i < b.x + b.w; i++)
          w.bgrid[j * w.N + i] = b.id;
    }
    // 家庭 & 市民
    w.families = d.families.map(f => ({ id: f.id, members: f.members, houseId: f.houseId }));
    for (const cd of d.citizens) {
      const c = {
        id: cd.id, name: cd.name, sex: cd.sex, age: cd.age, adult: cd.adult,
        x: cd.x, y: cd.y, familyId: cd.familyId, job: cd.job,
        student: !!cd.student, educated: !!cd.educated, school: cd.school != null ? cd.school : null,
        task: null, pausedTask: null, carry: cd.carry, state: 'idle', walkKind: '', path: null, pi: 0,
        wanderT: Math.random() * 3, hunger: cd.hunger, cold: cd.cold, animT: 0, dead: false,
      };
      w.citizens.push(c);
      w.cmap[c.id] = c;
    }
    // 存档时正在搬运的资源：重新派人送仓（读档后市民都回到 idle，不处理会一直挂在身上）
    for (const c of w.citizens) {
      if (c.carry) G.startHaul(c);
    }
    const s = w.start;
    const [sx, sy] = G.T2S(s.x, s.y);
    G.cam.x = window.innerWidth / 2 - sx * G.cam.z;
    G.cam.y = window.innerHeight / 2 - sy * G.cam.z;
    G.needGround = true;
    G.groundDirty.clear();
    G.ui.toast(key === G.AUTOSAVE_KEY ? '📂 已自动恢复上次进度（🌱 可开新局）' : '📂 存档已载入', 'good');
    G.ui.refreshHUD();
  } catch (e) {
    console.error(e);
    G.ui.toast('读档失败：' + e.message, 'bad');
  }
};

/* ---------- 相机 ---------- */
/* 把相机限制在地图附近（各边留一点余量，不允许拖到纯黑区域） */
G.clampCam = function () {
  if (!G.world || !G.cv) return;
  const z = G.cam.z, N = G.world.N, m = 60;
  const half = N * 32 * z; // u/v 两个方向的地图半跨
  G.cam.x = G.clamp(G.cam.x, m - half, G.cv.clientWidth - m + half);
  G.cam.y = G.clamp(G.cam.y, m - half, G.cv.clientHeight - m);
};

/* ---------- 工具模式 ---------- */
G.setTool = function (t) {
  if (t == null) { G.tool = null; }
  else if (t === 'demolish') G.tool = { kind: 'demolish' };
  else if (t === 'road') G.tool = { kind: 'road' };
  else if (t === 'fell') G.tool = { kind: 'fell' };
  else G.tool = { kind: 'build', type: t };
  G.ui.setToolActive();
};

/* 「砍伐」工具：沿线把树木标记为待砍（原版 Harvest Trees 的拖拽框选） */
G.paintFell = function (x0, y0, x1, y1) {
  const w = G.world;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    G.markFellAt(w, x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
};

/* ---------- 建造 ---------- */
G.tryPlace = function (tx, ty) {
  const type = G.tool.type;
  const def = G.BDEF[type];
  const ox = tx - ((def.w - 1) >> 1), oy = ty - ((def.h - 1) >> 1);
  const r = G.addBuilding(type, ox, oy);
  if (!r.ok) G.ui.toast(r.reason, 'warn');
  G.ui.refreshHUD();
};

G.paintRoad = function (x0, y0, x1, y1) {
  const w = G.world;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    if (G.canPlaceRoad(w, x, y)) {
      if (w.treeIdx[y * w.N + x] >= 0) G.removeTree(w, x, y);
      G.clearRock(w, x, y);
      w.road[y * w.N + x] = 1;
      G.markGroundDirty(x, y);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
};

/* ---------- 初始化 ---------- */
G.init = function () {
  G.cv = document.getElementById('game');
  G.ctx = G.cv.getContext('2d');
  G.dpr = Math.min(2, window.devicePixelRatio || 1);

  const resize = () => {
    G.cv.width = Math.floor(window.innerWidth * G.dpr);
    G.cv.height = Math.floor(window.innerHeight * G.dpr);
    G.cv.style.width = window.innerWidth + 'px';
    G.cv.style.height = window.innerHeight + 'px';
  };
  window.addEventListener('resize', resize);
  resize();

  G.ui.init();
  G.feedback.init();
  // 启动：有自动存档则恢复上次进度，否则开新局
  if (localStorage.getItem(G.AUTOSAVE_KEY)) G.loadGame(G.AUTOSAVE_KEY);
  else G.newGame();

  // 自动存档：换季（sim.js onSeasonChange）、定时、页面隐藏、刷新/关闭时写入
  window.addEventListener('beforeunload', () => G.autosave());
  window.addEventListener('pagehide', () => G.autosave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') G.autosave();
  });
  // 定时自动存档：每 90 秒（游戏进行中）
  setInterval(() => G.autosave(), 90000);

  /* ----- 输入 ----- */
  let dragging = false, dragBtn = -1, dragMoved = 0, lastX = 0, lastY = 0;
  let roadLast = null;
  let fellLast = null;

  const toLocal = (e) => {
    const r = G.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  G.cv.addEventListener('contextmenu', e => e.preventDefault());

  G.cv.addEventListener('mousedown', e => {
    const p = toLocal(e);
    if (e.button === 2 && G.tool) { G.setTool(null); return; } // 右键取消工具
    dragging = true; dragBtn = e.button; dragMoved = 0;
    lastX = p.x; lastY = p.y;
    if (e.button === 0 && G.tool && G.tool.kind === 'road') {
      const t = G.screenToTile(p.x, p.y);
      const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
      if (G.canPlaceRoad(G.world, tx, ty)) { G.paintRoad(tx, ty, tx, ty); roadLast = { x: tx, y: ty }; }
      else roadLast = { x: tx, y: ty };
    }
    if (e.button === 0 && G.tool && G.tool.kind === 'fell') {
      const t = G.screenToTile(p.x, p.y);
      const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
      G.markFellAt(G.world, tx, ty);
      fellLast = { x: tx, y: ty };
    }
  });

  window.addEventListener('mousemove', e => {
    const p = toLocal(e);
    const t = G.screenToTile(p.x, p.y);
    G.hover = { tx: Math.floor(t.tx), ty: Math.floor(t.ty) };
    if (!dragging) return;
    const dx = p.x - lastX, dy = p.y - lastY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    if (dragBtn === 2 || dragBtn === 1 || (dragBtn === 0 && !G.tool && dragMoved > 4)) {
      G.cam.x += dx; G.cam.y += dy;
      lastX = p.x; lastY = p.y;
    } else if (dragBtn === 0 && G.tool && G.tool.kind === 'road' && roadLast) {
      const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
      if (tx !== roadLast.x || ty !== roadLast.y) {
        G.paintRoad(roadLast.x, roadLast.y, tx, ty);
        roadLast = { x: tx, y: ty };
      }
    } else if (dragBtn === 0 && G.tool && G.tool.kind === 'fell' && fellLast) {
      const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
      if (tx !== fellLast.x || ty !== fellLast.y) {
        G.paintFell(fellLast.x, fellLast.y, tx, ty);
        fellLast = { x: tx, y: ty };
      }
    }
  });

  window.addEventListener('mouseup', e => {
    if (!dragging) return;
    dragging = false;
    const p = toLocal(e);
    const t = G.screenToTile(p.x, p.y);
    const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
    if (e.button === 0 && dragMoved <= 4) {
      if (G.tool && G.tool.kind === 'build') G.tryPlace(tx, ty);
      else if (G.tool && G.tool.kind === 'demolish') {
        if (tx >= 0 && ty >= 0 && tx < G.MAP && ty < G.MAP) G.demolishAt(tx, ty);
        G.ui.refreshHUD();
      } else if (G.tool && G.tool.kind === 'road') {
        // 已在拖拽中铺完
      } else {
        G.selectAt(tx, ty, p);
      }
    }
  });

  G.cv.addEventListener('wheel', e => {
    e.preventDefault();
    const p = toLocal(e);
    const oldZ = G.cam.z;
    const nz = G.clamp(oldZ * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.55, 2.6);
    // 以指针为中心缩放
    G.cam.x = p.x - (p.x - G.cam.x) * (nz / oldZ);
    G.cam.y = p.y - (p.y - G.cam.y) * (nz / oldZ);
    G.cam.z = nz;
  }, { passive: false });

  window.addEventListener('keydown', e => {
    G.keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { G.game.paused = !G.game.paused; G.ui.refreshHUD(); e.preventDefault(); }
    else if (e.key === '1') { G.game.paused = false; G.game.speed = 1; G.ui.refreshHUD(); }
    else if (e.key === '2') { G.game.paused = false; G.game.speed = 3; G.ui.refreshHUD(); }
    else if (e.key === '3') { G.game.paused = false; G.game.speed = 8; G.ui.refreshHUD(); }
    else if (e.key === 'Escape') {
      if (!document.getElementById('errs').classList.contains('hidden')) document.getElementById('errs').classList.add('hidden');
      else if (!document.getElementById('fb').classList.contains('hidden')) G.feedback.close();
      else if (!document.getElementById('saves').classList.contains('hidden')) G.ui.closeSaves();
      else if (G.tool) G.setTool(null);
      else if (G.sel) G.ui.hideInfo();
      else G.ui.toggleHelp(false);
    } else if (e.key === '?') G.ui.toggleHelp();
  });
  window.addEventListener('keyup', e => { G.keys[e.key.toLowerCase()] = false; });

  /* ----- 主循环 ----- */
  let last = performance.now();
  let lastFrameWall = performance.now();
  let uiAcc = 0;
  function stepGame(dtReal) {
    // 键盘平移
    const pan = 520 * dtReal / G.cam.z;
    if (G.keys['w'] || G.keys['arrowup']) G.cam.y += pan;
    if (G.keys['s'] || G.keys['arrowdown']) G.cam.y -= pan;
    if (G.keys['a'] || G.keys['arrowleft']) G.cam.x += pan;
    if (G.keys['d'] || G.keys['arrowright']) G.cam.x -= pan;
    if (G.world) G.clampCam();

    if (!G.game.paused && !G.game.over) {
      G.advanceSim(dtReal * G.HOURS_PER_SEC * G.game.speed);
      if (!G.game.over && G.world.citizens.length === 0 && G.game.day > 0) {
        G.game.over = true;
        G.ui.gameOver();
      }
    }
    uiAcc += dtReal;
    if (uiAcc > 0.3) { uiAcc = 0; G.ui.refreshHUD(); }
    G.ui.tickInfo(dtReal);
    G.frame(dtReal);
  }
  function loop(now) {
    lastFrameWall = performance.now();
    stepGame(G.clamp((now - last) / 1000, 0, 0.1));
    last = now;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // 看门狗：标签页在后台等场景下 rAF 停摆时，用定时器低频继续模拟
  setInterval(() => {
    const now = performance.now();
    if (now - lastFrameWall > 400) {
      stepGame(0.1);
      last = now;
      lastFrameWall = now;
    }
  }, 250);
};

/* ---------- 选择 ---------- */
G.selectAt = function (tx, ty, p) {
  const w = G.world;
  if (tx < 0 || ty < 0 || tx >= w.N || ty >= w.N) { G.ui.hideInfo(); return; }
  const bid = w.bgrid[ty * w.N + tx];
  if (bid >= 0) {
    G.sel = { kind: 'b', id: bid };
    G.ui.showInfo(G.sel);
    return;
  }
  // 找附近的市民（屏幕距离）
  let best = null, bd = 18 * 18;
  for (const c of w.citizens) {
    const [sx, sy] = G.T2S(c.x, c.y);
    const px = sx * G.cam.z + G.cam.x - p.x;
    const py = (sy + 16) * G.cam.z + G.cam.y - p.y;
    const d = px * px + py * py;
    if (d < bd) { bd = d; best = c; }
  }
  if (best) {
    G.sel = { kind: 'c', id: best.id };
    G.ui.showInfo(G.sel);
  } else G.ui.hideInfo();
};

window.addEventListener('DOMContentLoaded', G.init);
