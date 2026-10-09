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
G.autosaveBlocked = false;
G.RECOVERY_SAVE_KEY = G.AUTOSAVE_KEY + '_recovery';

G.topModal = function () {
  // Overlay order matches the DOM stacking order (all use the same z-index).
  return ['over', 'fb', 'errs', 'saves', 'help'].map(id => document.getElementById(id))
    .find(el => el && !el.classList.contains('hidden')) || null;
};
G.hasOpenModal = function () { return !!G.topModal(); };
G.isEditingTarget = function (target) {
  if (!target) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '') ||
    !!(target.closest && target.closest('input, textarea, select, [role="textbox"]'));
};
G.isInputTarget = function (target) {
  if (!target) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName || '') ||
    !!(target.closest && target.closest('input, textarea, select, button, a, [role="textbox"]'));
};

/* ---------- 新游戏 ---------- */
G.newGame = function (seed, options) {
  options = options || {};
  G.autosaveBlocked = !!options.preserveSaves;
  seed = seed || ((Math.random() * 0xffffffff) >>> 0);
  G.rng = G.makeRng(seed ^ 0x51f15e);
  G.world = G.genWorld(seed);
  // 原版「中等」难度开局：5 个家庭（无房），一辆储物车（仓库）
  // 资源：木 80 / 石 48 / 食 500 / 柴 50 / 工具 15（≈第一轮磨损周期，之后靠铁匠铺）
  G.game = G.newGameState();
  G.game.res = { wood: 80, stone: 48, iron: 0, tools: 15, food: 500, firewood: 50 };
  G.sel = null;
  G.tool = null;
  G.smoke = [];
  G.flakes = null;
  if (!options.preserveSaves) {
    try { localStorage.removeItem(G.AUTOSAVE_KEY); } catch (e) { G.ui.toast('无法清理本机旧自动档：' + e.message, 'warn'); }
    G.deleteServerSaveQuiet('autosave');
  }
  G.ui.hideInfo();
  G.ui.setToolActive();
  document.getElementById('over').classList.add('hidden');

  const s = G.world.start;
  const initialStorage = G.addBuilding('storage', s.x - 1, s.y - 1, { instant: true, free: true });
  if (!initialStorage.ok) throw new Error('起始储物车放置失败：' + initialStorage.reason);

  // 5 个家庭（原版中难度）：2 名成人 + 若干孩子，开局全部无家可归，入冬前必须盖房
  let kidPlan = [2, 2, 1, 0, 0];
  for (let f = 0; f < 5; f++) {
    const ang = (f / 5) * Math.PI * 2;
    const hx = s.x + Math.round(Math.cos(ang) * 2), hy = s.y + Math.round(Math.sin(ang) * 2);
    const m = G.spawnCitizen({ x: hx, y: hy, sex: 'm', age: G.ri(19, 38) });
    const fm = G.spawnCitizen({ x: hx, y: hy, sex: 'f', age: G.ri(18, 36) });
    const fam = { id: G.nextId(), members: [m.id, fm.id], houseId: null, coupleIds: [m.id, fm.id] };
    m.partnerId = fm.id; fm.partnerId = m.id;
    m.familyId = fam.id; fm.familyId = fam.id;
    G.world.families.push(fam);
    for (let k = 0; k < kidPlan[f]; k++) {
      const kid = G.spawnCitizen({ x: hx, y: hy, age: G.ri(2, 9), adult: false, familyId: fam.id });
      kid.parentIds = [m.id, fm.id];
      fam.members.push(kid.id);
    }
  }

  if (G.normalizeFamilyRelations) G.normalizeFamilyRelations(G.world);

  // 相机对准镇址
  const [sx, sy] = G.T2S(s.x, s.y);
  G.cam.x = window.innerWidth / 2 - sx * G.cam.z;
  G.cam.y = window.innerHeight / 2 - sy * G.cam.z;
  G.needGround = true;
  G.groundDirty.clear();

  G.ui.toast('归园 · 放逐小镇复刻原型（原版数值）', 'good');
  G.ui.toast('先保食物：把采集小屋建在成熟森林旁，再补住房与柴火；别一口气盖满五间木屋耗光材料', 'warn');
  G.ui.toast('岩石给石头、锈色铁矿给铁 · 入冬前备好柴火（木屋每年约 30，石屋省一半）', 'info');
  G.scheduleJobs();
  G.ui.refreshHUD();
  if (!G._hasShownHelp && G.ui.toggleHelp) { G._hasShownHelp = true; G.ui.toggleHelp(true); }
};

/* ---------- 存档 ---------- */
/* 序列化当前对局（存档与反馈快照共用；不含 savedAt）。
 * 尚未保存 RNG 当前位置及市民正在进行/挂起的任务，读档不是确定性逐步回放。 */
G.serializeGame = function () {
  const w = G.world, g = G.game;
  return {
    v: 1, seed: w.seed, N: w.N, mapVersion: w.mapVersion || 0, // N：地图尺寸（旧档跨尺寸迁移裸索引用）
    game: {
      v: G.VERSION,
      h: g.h, day: g.day, season: g.season, year: g.year,
      res: g.res, stats: g.stats, prevFood: g.prevFood, foodNet: g.foodNet, foodUrgent: g.foodUrgent, warned: g.warned,
      hist: g.hist, buildLog: g.buildLog, toolWear: g.toolWear,
    },
    roads: Array.from(w.road).flatMap((road, i) => road ? [i] : []),
    trees: w.trees.map(t => [t.i, t.x, t.y, t.b]),
    marked: [...w.marked],
    markedRocks: [...(w.markedRocks || [])],
    rockCleared: w.rockCleared,
    buildings: w.buildings.map(b => ({
      id: b.id, type: b.type, x: b.x, y: b.y, state: b.state,
      progress: b.progress, workLeft: b.workLeft, totalWork: b.totalWork, paidCost: b.paidCost, constructionStarted: b.constructionStarted,
      workers: b.workers, family: b.family, noWork: b.noWork, warnText: b.warnText,
      doCut: b.doCut, doPlant: b.doPlant, fuelLimit: b.fuelLimit, toolLimit: b.toolLimit,
      farm: b.farm ? b.farm.map(f => [f.sown ? 1 : 0, f.harvested ? 1 : 0]) : undefined,
      sownAll: b.sownAll, growth: b.growth, harvestDone: b.harvestDone,
    })),
    families: w.families.map(f => ({ id: f.id, members: f.members, houseId: f.houseId, coupleIds: f.coupleIds })),
    citizens: w.citizens.map(c => ({
      id: c.id, name: c.name, sex: c.sex, age: c.age, adult: c.adult,
      x: c.x, y: c.y, familyId: c.familyId, job: c.job,
      partnerId: c.partnerId, parentIds: c.parentIds, grandparentIds: c.grandparentIds, ancestorIds: c.ancestorIds, birthFamilyId: c.birthFamilyId,
      student: c.student ? 1 : 0, educated: c.educated ? 1 : 0, school: c.school != null ? c.school : null,
      hunger: c.hunger, cold: c.cold, camped: c.camped ? 1 : 0, carry: c.carry,
    })),
    nextUid: G._peekUid(),
  };
};

G.saveGame = function (key, silent) {
  key = key || G.SAVE_KEY;
  if (key === G.AUTOSAVE_KEY && G.autosaveBlocked) return false;
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
  if (G.world && !G.game.over && !G.autosaveBlocked) {
    G.saveGame(G.AUTOSAVE_KEY, true);
    G.saveToServer('autosave', true).catch(() => {}); // 自动档镜像到服务器；不可用时静默跳过
  }
};

G._peekUid = function () {
  // 偷看下一个 id 且不消耗：回退过多会重发已用过的 id——两个建筑同 id 时
  // 后者会覆盖 w.bmap 里的前者，旧建筑变成「满编幽灵」永远不再派工
  const v = G.nextId();
  G.setUid(v);
  return v;
};

/* 一键复盘：服务器在 /api/feedback/<id>/replay 页面里注入 window.__REPLAY_SAVE，
 * 打开链接即已带上快照——这里只做无网络的本地还原。 */
G.tryReplayLoad = function () {
  const d = window.__REPLAY_SAVE;
  if (!d) return false;
  delete window.__REPLAY_SAVE;
  try {
    G.applySaveData(d);
    G.ui.toast('📂 已加载复盘存档（反馈快照）', 'good');
    return true;
  } catch (e) {
    G.ui.toast('复盘存档加载失败：' + e.message, 'bad');
    return false;
  }
};

G.loadGame = function (key) {
  key = key || G.SAVE_KEY;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) { G.ui.toast('没有找到存档', 'warn'); return false; }
    G.applySaveData(JSON.parse(raw));
    G.ui.toast(key === G.AUTOSAVE_KEY ? '📂 已自动恢复上次进度（🌱 可开新局）' : '📂 存档已载入', 'good');
    return true;
  } catch (e) {
    console.error(e);
    G.ui.toast('读档失败：' + e.message, 'bad');
    return false;
  }
};

/* A broken startup save must never strand the player on an uninitialized world,
 * delete the server copy, or get silently overwritten by the temporary new town. */
G.recoverBrokenAutosave = function (raw) {
  G._recoveryBackedUp = false;
  try {
    let key = G.RECOVERY_SAVE_KEY;
    const previous = localStorage.getItem(key);
    if (previous && previous !== raw) key += '_' + Date.now();
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) throw new Error('备份未写入');
    G.recoverySaveKey = key; G._recoveryBackedUp = true;
  } catch (e) { /* Keep the original untouched even if quota/privacy blocks the backup. */ }
  G.newGame(undefined, { preserveSaves: true });
  G.ui.toast('自动档无法载入，原文已保留。已开临时新局并暂停自动保存；可手动保存，或确认新游戏后继续自动保存。', 'warn');
};

/* Validate and build a candidate without changing the running town. All entry points
 * (local, server, replay and file import) use this same transaction boundary. */
G.prepareSaveData = function (d) {
  const bad = field => { throw new Error('存档数据无效：' + field); };
  const record = (v, field) => { if (!v || typeof v !== 'object' || Array.isArray(v)) bad(field); return v; };
  const number = (v, field, min = -Infinity, max = Infinity) => {
    if (!Number.isFinite(v) || v < min || v > max) bad(field);
    return v;
  };
  const integer = (v, field, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    number(v, field, min, max); if (!Number.isSafeInteger(v)) bad(field); return v;
  };
  const array = (v, field) => { if (!Array.isArray(v)) bad(field); return v; };
  const optionalArray = (v, field) => v === undefined ? [] : array(v, field);
  const id = (v, field) => integer(v, field, 1, 0x7ffffffe);
  const nullableId = (v, field) => v == null ? null : id(v, field);
  const ids = (v, field) => array(v, field).map(x => id(x, field));
  const clone = v => JSON.parse(JSON.stringify(v));
  record(d, '根对象');
  if (d.v !== undefined && d.v !== 1) bad('版本不受支持');
  integer(d.seed, '地图种子', -0x80000000, 0xffffffff);
  const oldN = d.N === undefined ? G.MAP : integer(d.N, '地图尺寸', 1, 4096);
  const gd = record(d.game, '游戏状态'), g = G.newGameState();
  g.h = number(gd.h, '小时', 0, G.DAY_H); if (g.h === G.DAY_H) bad('小时');
  g.day = integer(gd.day, '天数'); g.season = integer(gd.season, '季节', 0, 3); g.year = integer(gd.year, '年份', 1);
  record(gd.res, '资源');
  for (const key of G.RES_KEYS) {
    const value = gd.res[key] === undefined && key === 'iron' ? 0 : gd.res[key] === undefined && key === 'tools' ? 10 : gd.res[key];
    g.res[key] = number(value, '资源 ' + key, 0);
  }
  if (gd.stats !== undefined) {
    const stats = record(gd.stats, '统计');
    g.stats.born = integer(stats.born, '出生统计'); g.stats.died = integer(stats.died, '死亡统计');
    const reasons = record(stats.deadReasons || {}, '死亡原因');
    for (const key of Object.keys(reasons)) integer(reasons[key], '死亡原因统计');
    g.stats.deadReasons = clone(reasons);
  }
  if (gd.prevFood !== undefined) g.prevFood = number(gd.prevFood, '昨日食物', 0);
  if (gd.foodNet !== undefined) g.foodNet = number(gd.foodNet, '食物变化');
  g.toolWear = Number.isFinite(gd.toolWear) && gd.toolWear >= 0 ? gd.toolWear : 0;
  g.warned = gd.warned === undefined ? {} : clone(record(gd.warned, '提醒状态'));
  g.hist = clone(optionalArray(gd.hist, '历史记录'));
  g.buildLog = clone(optionalArray(gd.buildLog, '建造记录'));
  const trees = array(d.trees, '树木'), buildings = array(d.buildings, '建筑');
  const families = array(d.families, '家庭'), citizens = array(d.citizens, '市民');
  g.foodUrgent = typeof gd.foodUrgent === 'boolean' ? gd.foodUrgent : g.res.food < citizens.length * G.LIFE.eatPerDay * 8;
  // Loading while reading a dialog must never secretly resume its simulation.
  g.paused = !!(G.game && G.game.paused) || G.hasOpenModal();
  g.speed = G.game && [1, 2, 5].includes(G.game.speed) ? G.game.speed : 1;

  const w = G.genWorld(d.seed, { starterResources: d.mapVersion >= 1 });
  const gridIndex = (i, field) => {
    integer(i, field, 0, oldN * oldN - 1);
    const x = i % oldN, y = Math.floor(i / oldN);
    // A smaller map drops off-map cells; never let x overflow into a new row.
    return x < w.N && y < w.N ? y * w.N + x : null;
  };
  w.trees = []; w.treeIdx.fill(-1);
  for (const row of trees) {
    if (!Array.isArray(row) || row.length !== 4) bad('树木记录');
    const x = integer(row[1], '树木 x', 0, oldN - 1), y = integer(row[2], '树木 y', 0, oldN - 1);
    const born = number(row[3], '树龄');
    if (x >= w.N || y >= w.N) continue;
    const i = y * w.N + x;
    if (w.treeIdx[i] >= 0) bad('重复树木');
    w.treeIdx[i] = w.trees.length; w.trees.push({ i, x, y, b: born });
  }
  for (const i of optionalArray(d.rockCleared, '已清理岩石')) {
    const t = gridIndex(i, '岩石索引'); if (t === null) continue;
    if (!w.rockCleared.includes(t)) w.rockCleared.push(t);
    w.rock[t] = 0;
  }
  for (const i of optionalArray(d.marked, '砍伐标记')) { const t = gridIndex(i, '砍伐索引'); if (t !== null) w.marked.add(t); }
  for (const i of optionalArray(d.markedRocks, '采矿标记')) { const t = gridIndex(i, '采矿索引'); if (t !== null && w.rock[t]) w.markedRocks.add(t); }
  for (const i of optionalArray(d.roads, '道路')) { const t = gridIndex(i, '道路索引'); if (t !== null) w.road[t] = 1; }

  const used = new Set(); let usedMax = 0;
  const uniqueId = (value, field) => {
    id(value, field); if (used.has(value)) bad('重复 ID');
    used.add(value); usedMax = Math.max(usedMax, value); return value;
  };
  for (const bd of buildings) {
    record(bd, '建筑记录');
    if (!Object.prototype.hasOwnProperty.call(G.BDEF, bd.type)) bad('建筑类型');
    const def = G.BDEF[bd.type];
    const x = integer(bd.x, '建筑 x', 0, Math.min(oldN, w.N) - def.w);
    const y = integer(bd.y, '建筑 y', 0, Math.min(oldN, w.N) - def.h);
    if (bd.state !== 'ok' && bd.state !== 'site') bad('建筑状态');
    const b = {
      id: uniqueId(bd.id, '建筑 ID'), type: bd.type, x, y, w: def.w, h: def.h, state: bd.state,
      progress: bd.progress === undefined ? (bd.state === 'ok' ? 1 : 0) : number(bd.progress, '建造进度', 0, 1),
      workLeft: bd.workLeft === undefined ? (bd.state === 'ok' ? 0 : def.buildWork) : number(bd.workLeft, '剩余工时'),
      totalWork: bd.totalWork === undefined ? (def.buildWork || 1) : number(bd.totalWork, '总工时', 0),
      workers: ids(bd.workers, '工人'), family: nullableId(bd.family, '建筑家庭'),
      noWork: !!bd.noWork, warnText: typeof bd.warnText === 'string' ? bd.warnText : '',
      doCut: bd.doCut !== false, doPlant: bd.doPlant !== false,
      toolLimit: bd.type === 'blacksmith' ? G.toolLimitOf(bd) : undefined,
      fuelLimit: bd.type === 'woodcutter' ? G.fuelLimitOf(bd) : undefined,
    };
    if (bd.constructionStarted !== undefined && typeof bd.constructionStarted !== 'boolean') bad('工地开工状态');
    b.constructionStarted = bd.constructionStarted === true;
    if (bd.paidCost !== undefined) {
      record(bd.paidCost, '已付建材'); b.paidCost = {};
      for (const key of Object.keys(bd.paidCost)) {
        if (!G.RES_KEYS.includes(key)) bad('已付建材类型');
        b.paidCost[key] = number(bd.paidCost[key], '已付建材数量', 0);
      }
    }
    if (bd.type === 'farm') {
      if (!Array.isArray(bd.farm) || bd.farm.length !== b.w * b.h) bad('农田格数');
      b.farm = bd.farm.map((row, k) => {
        if (!Array.isArray(row) || row.length !== 2 || !row.every(v => v === 0 || v === 1 || v === false || v === true)) bad('农田状态');
        return { x: x + k % b.w, y: y + Math.floor(k / b.w), sown: !!row[0], harvested: !!row[1] };
      });
      b.sownAll = !!bd.sownAll; b.harvestDone = !!bd.harvestDone;
      b.growth = bd.growth === undefined ? 0 : number(bd.growth, '农田生长', 0, 1);
    }
    for (let yy = y; yy < y + b.h; yy++) for (let xx = x; xx < x + b.w; xx++) {
      const i = yy * w.N + xx; if (w.bgrid[i] >= 0) bad('建筑重叠'); w.bgrid[i] = b.id;
    }
    w.buildings.push(b); w.bmap[b.id] = b;
  }
  w.families = families.map(fd => {
    record(fd, '家庭记录');
    return { id: uniqueId(fd.id, '家庭 ID'), members: ids(fd.members, '家庭成员'), houseId: nullableId(fd.houseId, '住房'),
      coupleIds: fd.coupleIds === undefined ? undefined : ids(fd.coupleIds, '配偶') };
  });
  for (const cd of citizens) {
    record(cd, '市民记录');
    if (typeof cd.name !== 'string' || !['m', 'f'].includes(cd.sex)) bad('市民身份');
    let carry = null;
    if (cd.carry != null) {
      record(cd.carry, '随身资源'); if (!G.RES_KEYS.includes(cd.carry.type)) bad('随身资源类型');
      carry = { type: cd.carry.type, qty: number(cd.carry.qty, '随身资源数量', 0) };
    }
    const c = {
      id: uniqueId(cd.id, '市民 ID'), name: cd.name, sex: cd.sex, age: number(cd.age, '年龄', 0), adult: !!cd.adult,
      x: number(cd.x, '市民 x', 0, Math.min(oldN, w.N) - 1), y: number(cd.y, '市民 y', 0, Math.min(oldN, w.N) - 1),
      familyId: nullableId(cd.familyId, '市民家庭'), job: nullableId(cd.job, '岗位'),
      partnerId: cd.partnerId === undefined ? undefined : nullableId(cd.partnerId, '配偶 ID'),
      parentIds: cd.parentIds === undefined ? undefined : ids(cd.parentIds, '父母 ID'),
      grandparentIds: cd.grandparentIds === undefined ? [] : ids(cd.grandparentIds, '祖父母 ID'),
      ancestorIds: cd.ancestorIds === undefined ? undefined : ids(cd.ancestorIds, '祖辈 ID'),
      birthFamilyId: cd.birthFamilyId === undefined ? undefined : nullableId(cd.birthFamilyId, '原生家庭'),
      student: !!cd.student, educated: !!cd.educated, school: nullableId(cd.school, '学校'),
      task: null, pausedTask: null, carry, state: 'idle', walkKind: '', path: null, pi: 0, camped: !!cd.camped,
      wanderT: 0, hunger: cd.hunger === undefined ? 0 : number(cd.hunger, '饥饿', 0),
      cold: cd.cold === undefined ? 0 : number(cd.cold, '寒冷', 0), animT: 0, dead: false,
    };
    w.citizens.push(c); w.cmap[c.id] = c;
  }
  if (G.normalizeFamilyRelations) G.normalizeFamilyRelations(w);
  // Relocate old saves' citizens trapped inside a footprint before committing.
  for (const c of w.citizens) {
    const cx = Math.round(c.x), cy = Math.round(c.y);
    if (G.tileBlocked(w, cx, cy)) {
      const spot = G.nearestWalkable(w, cx, cy, 8);
      if (spot) { c.x = spot.x; c.y = spot.y; c.camped = false; }
    }
  }
  const nextUid = d.nextUid === undefined ? 10000 : id(d.nextUid, '下一个 ID');
  return { world: w, game: g, nextUid: Math.max(nextUid, usedMax + 1), rng: G.makeRng((d.seed ^ 0x51f15e) >>> 0) };
};

/* 把存档 JSON 应用为当前局面（本机档 / 服务器档 / 导入文件共用） */
G.applySaveData = function (d) {
  const candidate = G.prepareSaveData(d);
  G.world = candidate.world; G.game = candidate.game; G.rng = candidate.rng; G.setUid(candidate.nextUid);
  if (G._recoveryBackedUp) G.autosaveBlocked = false;
  G.sel = null; G.tool = null; G.smoke = []; G.flakes = null; G.keys = {};
  G.ui.hideInfo(); G.ui.setToolActive();
  document.getElementById('over').classList.add('hidden');
  // All cargo is validated and owned by the candidate; now resume its deliveries.
  for (const c of G.world.citizens) if (c.carry) G.startHaul(c);
  const s = G.world.start, [sx, sy] = G.T2S(s.x, s.y);
  G.cam.x = window.innerWidth / 2 - sx * G.cam.z;
  G.cam.y = window.innerHeight / 2 - sy * G.cam.z;
  G.needGround = true; G.groundDirty.clear();
  G.ui.refreshHUD();
};

/* ---------- 服务器存档（server.py /api/saves；静态/dev 服务器上不可用） ---------- */
G.serverSaves = { available: null };   // null=探测中 true=可用 false=不可用

G.probeServerSaves = function () {
  if (location.protocol === 'file:') { G.serverSaves.available = false; return; }
  fetch('/api/saves').then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then(j => {
      G.serverSaves.available = !!(j && j.ok);
      G.ui.refreshSavesIfOpen();
    })
    .catch(() => { G.serverSaves.available = false; G.ui.refreshSavesIfOpen(); });
};

G.saveToServer = function (name, silent) {
  if (!G.world || !G.game) return Promise.reject(new Error('当前没有对局'));
  name = String(name || '').trim();
  if (!name) return Promise.reject(new Error('请先填写存档名'));
  const body = JSON.stringify({ name, data: G.serializeGame() });
  return fetch('/api/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: body.length < 60000, // 离开页面时小包仍可送达（keepalive 上限 64KB）
  }).then(r => r.json().then(j => ({ ok: r.ok, j }))).then(({ ok, j }) => {
    if (!ok || !j.ok) throw new Error(j.error || '保存失败');
    if (!silent) G.ui.toast('💾 已保存到服务器：' + name, 'good');
    G.ui.refreshSavesIfOpen();
  });
};

G.loadFromServer = function (name) {
  return fetch('/api/saves/' + encodeURIComponent(name))
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then(d => { G.applySaveData(d); G.ui.toast('📂 已从服务器载入：' + name, 'good'); });
};

G.deleteServerSave = function (name) {
  return fetch('/api/saves/' + encodeURIComponent(name), { method: 'DELETE' })
    .then(r => r.json())
    .then(j => { if (!j.ok) throw new Error(j.error || '删除失败'); G.ui.refreshSavesIfOpen(); });
};

/* 静默删除服务器自动档（新开局/死档时镜像清理，与本机自动档同步） */
G.deleteServerSaveQuiet = function (name) {
  if (G.serverSaves.available !== true) return;
  fetch('/api/saves/' + encodeURIComponent(name), { method: 'DELETE' }).catch(() => {});
};

/* ---------- 存档文件导出/导入（无服务器时的兜底持久化） ---------- */
G.exportSaveFile = function () {
  if (!G.world || !G.game) { G.ui.toast('当前没有对局', 'warn'); return; }
  const data = G.serializeGame();
  data.savedAt = Date.now();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const t = new Date(), p = n => (n < 10 ? '0' : '') + n;
  a.href = url;
  a.download = `放逐小镇存档-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  G.ui.toast('⬇️ 存档文件已导出', 'good');
};

G.importSaveFile = function (file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      G.applySaveData(JSON.parse(rd.result));
      G.ui.toast('📂 存档文件已导入', 'good');
    } catch (e) {
      G.ui.toast('导入失败：' + e.message, 'bad');
    }
  };
  rd.onerror = () => G.ui.toast('文件读取失败', 'bad');
  rd.readAsText(file);
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

/* 「拆除」工具拖拽：沿线给岩石做清除标记（与砍伐同款沿线画法；只标岩石，不删建筑） */
G.paintRockLine = function (x0, y0, x1, y1) {
  const w = G.world;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    G.markRockAt(w, x, y);
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
  // 启动：一键复盘页（已注入快照）→ 有自动存档则恢复上次进度 → 否则开新局
  if (!G.tryReplayLoad()) {
    let raw = null;
    try { raw = localStorage.getItem(G.AUTOSAVE_KEY); } catch (e) {
      G.ui.toast('本机存储不可用，已开临时新局。请导出文件保存进度。', 'warn');
      G.newGame(undefined, { preserveSaves: true });
    }
    if (raw) { if (!G.loadGame(G.AUTOSAVE_KEY)) G.recoverBrokenAutosave(raw); }
    else if (!G.world) G.newGame();
  }
  G.probeServerSaves(); // 探测服务器存档接口（server.py 托管时可用）

  // 自动存档：换季（sim.js onSeasonChange）、定时、页面隐藏、刷新/关闭时写入
  window.addEventListener('beforeunload', () => G.autosave());
  window.addEventListener('pagehide', () => G.autosave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { resetInput(); G.autosave(); }
  });
  // 定时自动存档：每 90 秒（游戏进行中）
  setInterval(() => G.autosave(), 90000);

  /* ----- 输入 ----- */
  let dragging = false, dragBtn = -1, dragMoved = 0, lastX = 0, lastY = 0;
  let roadLast = null;
  let fellLast = null;
  let rockLast = null;
  function resetInput() {
    G.keys = {};
    dragging = false; dragBtn = -1; dragMoved = 0;
    roadLast = null; fellLast = null; rockLast = null;
  }
  window.addEventListener('blur', resetInput);
  document.addEventListener('focusin', e => { if (G.isInputTarget(e.target)) resetInput(); });

  const toLocal = (e) => {
    const r = G.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  G.cv.addEventListener('contextmenu', e => e.preventDefault());

  G.cv.addEventListener('mousedown', e => {
    if (G.hasOpenModal()) { resetInput(); return; }
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
    if (e.button === 0 && G.tool && G.tool.kind === 'demolish') {
      const t = G.screenToTile(p.x, p.y);
      const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
      G.markRockAt(G.world, tx, ty); // 点击岩石即标记；建筑/树木/道路的删除仍在 mouseup 单击判定
      rockLast = { x: tx, y: ty };
    }
  });

  window.addEventListener('mousemove', e => {
    if (G.hasOpenModal()) { resetInput(); return; }
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
    } else if (dragBtn === 0 && G.tool && G.tool.kind === 'demolish' && rockLast) {
      const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
      if (tx !== rockLast.x || ty !== rockLast.y) {
        G.paintRockLine(rockLast.x, rockLast.y, tx, ty);
        rockLast = { x: tx, y: ty };
      }
    }
  });

  window.addEventListener('mouseup', e => {
    if (G.hasOpenModal()) { resetInput(); return; }
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
    if (G.hasOpenModal()) return;
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
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const modal = G.topModal();
    if (e.key === 'Tab' && modal) {
      const stops = Array.from(modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'))
        .filter(el => !el.disabled && el.tabIndex !== -1 && (!el.getClientRects || el.getClientRects().length));
      const index = stops.indexOf(document.activeElement);
      if (!stops.length) { e.preventDefault(); return; }
      if (index < 0 || (e.shiftKey && index === 0) || (!e.shiftKey && index === stops.length - 1)) {
        stops[e.shiftKey ? stops.length - 1 : 0].focus(); e.preventDefault();
      }
      return;
    }
    const visible = id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); };
    // Escape dismisses the front dialog even if its text field owns focus.
    if (e.key === 'Escape' && !e.repeat) {
      if (visible('over')) return;
      else if (visible('fb')) G.feedback.close();
      else if (visible('errs')) G.ui.closeErrs();
      else if (visible('saves')) G.ui.closeSaves();
      else if (visible('help')) G.ui.toggleHelp(false);
      else if (G.isEditingTarget(e.target) || G.isEditingTarget(document.activeElement)) return;
      else if (G.tool) G.setTool(null);
      else if (G.sel) G.ui.hideInfo();
      resetInput(); e.preventDefault(); return;
    }
    if (G.isInputTarget(e.target) || G.isInputTarget(document.activeElement) || G.hasOpenModal()) {
      G.keys = {}; return;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      G.keys[key] = true; e.preventDefault(); return;
    }
    if (e.key === ' ') {
      e.preventDefault(); if (e.repeat) return;
      G.game.paused = !G.game.paused; G.ui.refreshHUD();
    } else if (['1', '2', '3'].includes(e.key) && !e.repeat) {
      G.game.paused = false; G.game.speed = { 1: 1, 2: 2, 3: 5 }[e.key]; G.ui.refreshHUD();
    } else if (e.key === '?' && !e.repeat) G.ui.toggleHelp();
  });
  window.addEventListener('keyup', e => { delete G.keys[e.key.toLowerCase()]; });

  /* ----- 主循环 ----- */
  let last = performance.now();
  let lastFrameWall = performance.now();
  let uiAcc = 0;
  function stepGame(dtReal) {
    // A dialog or newly focused field also stops a key held before it opened.
    if (G.hasOpenModal() || G.isInputTarget(document.activeElement)) G.keys = {};
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
  if (bid >= 0 && w.bmap[bid]) {
    G.sel = { kind: 'b', id: bid };
    G.ui.showInfo(G.sel);
    return;
  }
  // bgrid 指向已不存在的建筑（异常残留）时按空地处理
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
