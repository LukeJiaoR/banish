'use strict';
/* ============================================================
 * sim.js —— 游戏状态、时间、市民 AI、职业调度、经济与生死
 * ============================================================ */

G.newGameState = function () {
  return {
    h: 6, day: 0, season: 0, year: 1,
    speed: 1, paused: false,
    res: { wood: 80, stone: 48, food: 200, firewood: 24 }, // 原版中难度开局
    schedT: 1,
    over: false,
    stats: { born: 0, died: 0, deadReasons: {} },
    prevFood: 200,
    foodNet: 0,
    warned: {},
  };
};
G.game = G.newGameState();

G.seasonOf = function (day) { return Math.floor((day % G.YEAR_DAYS) / G.SEASON_DAYS); };
G.isWinter = function () { return G.game.season === 3; };

/* ================= 时间推进 ================= */
G.advanceSim = function (dtH) {
  const g = G.game;
  if (g.over) return;
  g.h += dtH;
  let guard = 0;
  while (g.h >= G.DAY_H && guard++ < 20) { g.h -= G.DAY_H; G.endDay(); if (g.over) return; }
  g.schedT -= dtH;
  if (g.schedT <= 0) { g.schedT = 2; G.scheduleJobs(); }
  for (const c of G.world.citizens) G.stepCitizen(c, dtH);
};

G.endDay = function () {
  const g = G.game, w = G.world;
  g.day++;
  const oldSeason = g.season;
  g.season = G.seasonOf(g.day);
  g.year = Math.floor(g.day / G.YEAR_DAYS) + 1;
  if (g.season !== oldSeason) G.onSeasonChange(oldSeason, g.season);

  // ---- 农田生长 ----
  for (const b of w.buildings) {
    if (b.type === 'farm' && b.state === 'ok' && b.sownAll && b.growth < 1 && g.season !== 3)
      b.growth = Math.min(1, b.growth + 1 / G.PROD.farm.growDays);
  }

  // ---- 进食 / 受冻 / 年龄 / 死亡 ----
  // 原版：每人每年吃 100 食物（儿童相同），粮食不足时儿童优先
  const eat = G.LIFE.eatPerYear / G.YEAR_DAYS;
  let food = g.res.food;
  const sorted = w.citizens.slice().sort((a, b) => (a.age >= G.ADULT_AGE ? 1 : 0) - (b.age >= G.ADULT_AGE ? 1 : 0));
  for (const c of sorted) {
    if (food >= eat) { food -= eat; c.hunger = 0; }
    else c.hunger++;
  }
  g.res.food = food;

  const winter = g.season === 3;
  const houses = w.buildings.filter(b => b.type === 'house' && b.state === 'ok' && b.family != null);
  // 原版：木屋每年约烧 30 柴火，集中在冬季消耗；柴火按屋支付，付不起的屋子挨冻
  const perHouse = G.LIFE.houseWarmWoodPerYear / G.SEASON_DAYS;
  for (const h of houses) h.unheated = false;
  if (winter && houses.length) {
    for (const h of houses) {
      if (g.res.firewood >= perHouse) g.res.firewood -= perHouse;
      else { h.unheated = true; g.res.firewood = 0; }
    }
  }

  const dead = [];
  for (const c of w.citizens) {
    c.age += 1 / G.YEAR_DAYS;
    // 长大成人
    if (!c.adult && c.age >= G.ADULT_AGE) {
      c.adult = true;
      G.ui.toast(`${c.name} 长大成人，可以工作了`, 'good');
    }
    // 冻：取暖看自家的屋子——没分到柴火的房子挨冻，无房更冷
    if (winter) {
      const fam = c.familyId != null ? w.families.find(f => f.id === c.familyId) : null;
      const home = fam && fam.houseId != null ? w.bmap[fam.houseId] : null;
      const housed = !!(home && home.state === 'ok');
      const childMul = c.age < G.ADULT_AGE ? G.LIFE.coldChildMul : 1;
      if (housed && !home.unheated) c.cold = 0;
      else if (housed) c.cold += childMul;             // 有房但没柴火
      else c.cold += G.LIFE.homelessCold * childMul;   // 无家可归
    } else c.cold = 0;
    // 自然老死
    if (c.age > G.OLD_AGE && G.chance(Math.min(0.25, (c.age - G.OLD_AGE) * 0.005)))
      dead.push([c, '寿终正寝']);
    else if (c.hunger >= G.LIFE.starveDays) dead.push([c, '饿死']);
    else if (c.cold >= G.LIFE.coldDays) dead.push([c, '冻死']);
  }
  for (const [c, why] of dead) G.killCitizen(c, why);

  // ---- 无效岗位释放工人 ----
  for (const b of w.buildings) {
    if (b.noWork && b.state === 'ok' && b.workers.length) {
      for (const id of b.workers) { const c = w.cmap[id]; if (c) { c.job = null; c.task = null; c.state = 'idle'; } }
      b.workers = [];
    }
    b.noWork = false;
  }

  // ---- 组建家庭 ----
  if (g.day % G.LIFE.pairEvery === 0) G.formFamilies();
  // ---- 搬入空房 ----
  G.assignHousing();
  // ---- 生育 ----
  if (g.season !== 3) G.tryBirths();

  // ---- 警告 ----
  const pop = w.citizens.length;
  if (pop > 0 && !g.warned.hunger && g.res.food <= 0) {
    g.warned.hunger = true;
    G.ui.toast('⚠ 食物耗尽！镇民正在挨饿', 'bad');
  }
  if (pop > 0 && g.res.food > pop * G.LIFE.eatPerDay * 8) g.warned.hunger = false;
  if (pop > 0 && !g.warned.firewood && g.season === 2 && g.res.firewood < pop * 0.6) {
    g.warned.firewood = true;
    G.ui.toast('⚠ 冬天将至，柴火可能不足', 'warn');
  }
  if (g.season !== 2) g.warned.firewood = false;
  if (pop > 0 && !g.warned.foodLow && g.res.food < pop * 3) {
    g.warned.foodLow = true;
    G.ui.toast('⚠ 食物储备不足 3 天', 'warn');
  }
  if (g.res.food > pop * 8) g.warned.foodLow = false;

  g.foodNet = g.res.food - g.prevFood;
  g.prevFood = g.res.food;
  G.ui.refreshHUD();
};

G.onSeasonChange = function (from, to) {
  const g = G.game;
  G.ui.toast(`${G.SEASON_ICONS[to]} ${G.SEASON_NAMES[to]}天来了`, to === 3 ? 'warn' : 'info');
  if (to === 3) {
    // 未收获的作物冻死
    for (const b of G.world.buildings) {
      if (b.type === 'farm' && b.sownAll && !b.harvestDone) {
        G.ui.toast('农田里的作物被冻死了', 'bad');
        G.resetFarm(b);
      }
    }
  }
  G.needGround = true;
  if (G.autosave) G.autosave();
};

/* ================= 家庭 ================= */
G.formFamilies = function () {
  const w = G.world;
  const singles = w.citizens.filter(c => !c.dead && c.age >= G.MOTHER_MIN && c.familyId == null);
  const men = singles.filter(c => c.sex === 'm'), women = singles.filter(c => c.sex === 'f');
  for (const m of men) {
    if (m.familyId != null) continue;
    // 找最近的单身女性
    let best = null, bd = Infinity;
    for (const f of women) {
      if (f.familyId != null) continue;
      const d = G.d2(m.x, m.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) return;
    const fam = { id: G.nextId(), members: [m.id, best.id], houseId: null };
    w.families.push(fam);
    m.familyId = fam.id; best.familyId = fam.id;
    G.ui.toast(`${m.name} 与 ${best.name} 结为夫妇`, 'good');
  }
};

G.familyOf = function (c) {
  return c.familyId != null ? G.world.families.find(f => f.id === c.familyId) : null;
};
G.homeOf = function (c) {
  const fam = G.familyOf(c);
  if (fam && fam.houseId != null) {
    const h = G.world.bmap[fam.houseId];
    if (h) return h;
  }
  return null;
};

G.assignHousing = function () {
  const w = G.world;
  const free = w.buildings.filter(b => b.type === 'house' && b.state === 'ok' && b.family == null);
  if (!free.length) return;
  const homeless = w.families.filter(f => f.houseId == null && f.members.length >= 2);
  for (const fam of homeless) {
    const house = free.shift();
    if (!house) break;
    fam.houseId = house.id;
    house.family = fam.id;
  }
};

G.tryBirths = function () {
  const w = G.world, g = G.game;
  const pop = Math.max(1, w.citizens.length);
  for (const fam of w.families) {
    if (fam.members.length < 2 || fam.houseId == null || fam.members.length >= G.LIFE.maxFamily) continue;
    const mother = fam.members.map(id => w.cmap[id]).find(c => c && !c.dead && c.sex === 'f');
    if (!mother || mother.age < G.MOTHER_MIN || mother.age > G.MOTHER_MAX) continue;
    if (g.res.food < pop * G.LIFE.eatPerDay * G.LIFE.birthFoodDays) continue; // 粮食紧张时不生育
    if (G.chance(G.LIFE.birthChance)) {
      const house = w.bmap[fam.houseId];
      G.spawnCitizen({
        x: house.x + 1, y: house.y + 1,
        sex: G.chance(0.5) ? 'm' : 'f',
        age: 0, adult: false,
        familyId: fam.id,
      });
      fam.members.push(w.citizens[w.citizens.length - 1].id);
      g.stats.born++;
      const baby = w.citizens[w.citizens.length - 1];
      G.ui.toast(`👶 ${baby.name} 出生了`, 'good');
    }
  }
};

/* ================= 市民 ================= */
G.spawnCitizen = function (opt) {
  const w = G.world;
  const c = {
    id: G.nextId(),
    name: G.citizenName(opt.sex || (G.chance(0.5) ? 'm' : 'f')),
    sex: opt.sex || 'm',
    age: opt.age !== undefined ? opt.age : G.ri(18, 40),
    adult: opt.adult !== undefined ? opt.adult : (opt.age === undefined ? true : opt.age >= G.ADULT_AGE),
    x: opt.x, y: opt.y,
    familyId: opt.familyId != null ? opt.familyId : null,
    job: null, task: null, carry: null,
    state: 'idle', walkKind: '', path: null, pi: 0,
    wanderT: G.rng() * 3,
    hunger: 0, cold: 0,
    animT: G.rng() * 10,
    dead: false,
  };
  w.citizens.push(c);
  w.cmap[c.id] = c;
  return c;
};

G.killCitizen = function (c, why) {
  if (c.dead) return;
  c.dead = true;
  const w = G.world, g = G.game;
  g.stats.died++;
  g.stats.deadReasons[why] = (g.stats.deadReasons[why] || 0) + 1;
  G.ui.toast(`🕯 ${c.name}${why}（享年 ${Math.floor(c.age)} 岁）`, 'bad');
  if (c.job) {
    const b = w.bmap[c.job];
    if (b) b.workers = b.workers.filter(id => id !== c.id);
  }
  const fam = G.familyOf(c);
  if (fam) {
    fam.members = fam.members.filter(id => id !== c.id);
    if (fam.members.length === 0) {
      if (fam.houseId != null) {
        const h = w.bmap[fam.houseId];
        if (h) h.family = null;
      }
      w.families = w.families.filter(f => f.id !== fam.id);
    }
  }
  if (G.sel && G.sel.kind === 'c' && G.sel.id === c.id) G.ui.hideInfo();
  w.citizens = w.citizens.filter(x => x !== c);
  delete w.cmap[c.id];
};

/* 移动速度（格/游戏小时） */
G.moveSpeed = function (c) {
  const w = G.world;
  const road = G.onRoad(w, Math.round(c.x), Math.round(c.y));
  let v = road ? 2.6 : 1.6;
  if (G.isWinter()) v *= 0.75;
  if (c.carry) v *= 0.9;
  return v;
};

G.anchorOf = function (c) {
  const h = G.homeOf(c);
  if (h) return h;
  const s = G.world.buildings.find(b => b.type === 'storage' && b.state === 'ok');
  return s || { x: G.world.start.x, y: G.world.start.y };
};

/* 闲逛 */
G.wander = function (c) {
  const a = G.anchorOf(c);
  for (let tries = 0; tries < 6; tries++) {
    const tx = G.clamp(Math.round(a.x + G.ri(-4, 4)), 0, G.world.N - 1);
    const ty = G.clamp(Math.round(a.y + G.ri(-4, 4)), 0, G.world.N - 1);
    if (G.tileBlocked(G.world, tx, ty)) continue;
    const p = G.findPath(G.world, Math.round(c.x), Math.round(c.y), tx, ty);
    if (p && p.length) {
      c.path = p; c.pi = 0; c.state = 'walk'; c.walkKind = 'wander';
      return;
    }
  }
};

/* 发送市民去任务点 */
G.sendTo = function (c, tx, ty) {
  const p = G.findPath(G.world, Math.round(c.x), Math.round(c.y), tx, ty);
  if (!p) { c.state = 'idle'; c.task = null; return; }
  c.path = p; c.pi = 0;
  if (p.length === 0) { c.state = 'work'; if (c.task) c.task.workLeft = c.task.work; }
  else { c.state = 'walk'; c.walkKind = 'task'; }
};

/* 开始搬运去仓库 */
G.startHaul = function (c) {
  const storages = G.world.buildings.filter(b => b.type === 'storage' && b.state === 'ok');
  let best = null, bd = Infinity;
  for (const s of storages) {
    const d = G.d2(c.x, c.y, s.x + s.w / 2, s.y + s.h / 2);
    if (d < bd) { bd = d; best = s; }
  }
  if (!best) { // 没有仓库：直接入库
    G.game.res[c.carry.type] += c.carry.qty;
    c.carry = null;
    G.requestTask(c);
    return;
  }
  const spot = G.workSpot(G.world, best, c.x, c.y) || { x: best.x, y: best.y };
  c.haulTo = best.id;
  G.sendTo(c, spot.x, spot.y);
  if (c.state !== 'walk') { // 已到达
    G.game.res[c.carry.type] += c.carry.qty;
    c.carry = null;
    G.requestTask(c);
  } else c.state = 'haul';
};

/* 市民每帧步进 */
G.stepCitizen = function (c, dtH) {
  if (c.dead) return;
  switch (c.state) {
    case 'walk':
    case 'haul': {
      if (!c.path || c.pi >= c.path.length) { G.arrive(c); return; }
      let mv = G.moveSpeed(c) * dtH;
      while (mv > 0) {
        if (!c.path || c.pi >= c.path.length) break;
        const t = c.path[c.pi];
        const dx = t.x - c.x, dy = t.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d <= mv) { c.x = t.x; c.y = t.y; mv -= d; c.pi++; }
        else { c.x += (dx / d) * mv; c.y += (dy / d) * mv; mv = 0; }
      }
      c.animT += dtH * 8;
      if (c.pi >= c.path.length) G.arrive(c);
      return;
    }
    case 'work': {
      if (!c.task) { c.state = 'idle'; return; }
      c.task.workLeft -= dtH;
      c.animT += dtH * 12;
      if (c.task.workLeft <= 0) G.completeTask(c);
      return;
    }
    default: { // idle
      c.wanderT -= dtH;
      if (c.wanderT <= 0) {
        c.wanderT = 2 + G.rng() * 5;
        if (c.age >= G.ADULT_AGE && c.job) G.requestTask(c);
        else G.wander(c);
      }
    }
  }
};

G.arrive = function (c) {
  c.path = null;
  if (c.state === 'haul') {
    if (c.carry) {
      G.game.res[c.carry.type] += c.carry.qty;
      c.carry = null;
    }
    G.requestTask(c);
  } else if (c.state === 'walk') {
    if (c.walkKind === 'task' && c.task) {
      c.state = 'work';
      c.task.workLeft = c.task.work;
    } else {
      c.state = 'idle';
      c.wanderT = 2 + G.rng() * 5;
    }
  }
};

/* ================= 任务系统 ================= */
G.requestTask = function (c) {
  c.task = null;
  const w = G.world;
  const b = c.job != null ? w.bmap[c.job] : null;
  if (!b) { c.state = 'idle'; return; }
  if (b.state === 'site') {
    if (b.workLeft <= 0) { G.finishBuilding(b); c.state = 'idle'; return; }
    const spot = G.workSpot(w, b, c.x, c.y) || { x: b.x, y: b.y };
    c.task = {
      kind: 'build', b, tx: spot.x, ty: spot.y,
      work: Math.min(G.PROD.builderChunk, b.workLeft),
      workLeft: 0, total: b.totalWork,
    };
    G.sendTo(c, spot.x, spot.y);
    return;
  }
  const t = G.makeTask(b, c);
  if (t) {
    b.warnText = '';
    c.task = t;
    G.sendTo(c, t.tx, t.ty);
  } else {
    c.state = 'idle';
    c.wanderT = 4;
  }
};

/* 按建筑类型生成任务 */
G.makeTask = function (b, c) {
  const P = G.PROD, g = G.game, w = G.world;
  switch (b.type) {
    case 'woodcutter': {
      if (g.res.wood >= P.woodcutter.logsIn) {
        const spot = G.workSpot(w, b, c.x, c.y);
        if (!spot) return null;
        return {
          kind: 'work', b, tx: spot.x, ty: spot.y,
          work: P.woodcutter.workH, workLeft: 0,
          consume: { type: 'wood', qty: P.woodcutter.logsIn },  // 完工时才扣料，任务中途取消不丢木材
          yield: { type: 'firewood', qty: P.woodcutter.firewoodOut },
        };
      }
      b.noWork = true; b.warnText = '缺木材';
      return null;
    }
    case 'forester': {
      const R = P.forester.radius;
      const trees = G.treesInRadius(w, b.x, b.y, R, true);
      // 已被其他工人认领的树不再重复认领（全部被认领时允许重叠）
      const claimed = new Set();
      for (const c2 of w.citizens)
        if (c2.task && c2.task.kind === 'chop' && c2 !== c) claimed.add(c2.task.ty * w.N + c2.task.tx);
      let best = null, bd = Infinity;
      for (const t of trees) {
        if (claimed.has(t.i) && claimed.size < trees.length) continue;
        const d = G.d2(b.x, b.y, t.x, t.y) + G.rng() * 8;
        if (d < bd) { bd = d; best = t; }
      }
      if (best) return { kind: 'chop', b, tx: best.x, ty: best.y, tree: best, work: P.forester.workH, workLeft: 0 };
      // 补种：螺旋扫描找最近可种空地（确定性，原版一棵树约 4 年成材）
      const spot = G.nearestPlantSpot(w, b.x, b.y, R);
      if (spot) return { kind: 'plant', b, tx: spot.x, ty: spot.y, work: P.forester.plantH, workLeft: 0 };
      b.noWork = true; b.warnText = '无成熟树木且无空地';
      return null;
    }
    case 'gatherer': {
      const R = P.gatherer.radius;
      const trees = G.treesInRadius(w, b.x, b.y, R, false);
      if (trees.length < P.gatherer.needTrees) {
        b.noWork = true; b.warnText = '附近没有森林';
        return null;
      }
      const t = trees[G.ri(0, trees.length - 1)];
      return {
        kind: 'work', b, tx: t.x, ty: t.y,
        work: P.gatherer.workH, workLeft: 0, yield: { type: P.gatherer.yield.type, qty: P.gatherer.yield.qty },
      };
    }
    case 'dock': {
      const spot = G.workSpot(w, b, c.x, c.y);
      if (!spot) return null;
      return {
        kind: 'work', b, tx: spot.x, ty: spot.y,
        work: P.dock.workH, workLeft: 0, yield: { type: P.dock.yield.type, qty: P.dock.yield.qty },
      };
    }
    case 'farm': {
      if (b.state !== 'ok') return null;
      const P2 = P.farm;
      // 播种（春）
      if (!b.sownAll && (g.season === 0 || g.season === 1)) {
        const ti = b.farm.findIndex(f => !f.sown);
        if (ti >= 0) {
          const f = b.farm[ti];
          return { kind: 'sow', b, ti, tx: f.x, ty: f.y, work: P2.tileWorkH, workLeft: 0 };
        }
      }
      // 收获（秋，作物长成）
      if (b.sownAll && b.growth >= 1 && g.season === 2 && !b.harvestDone) {
        const ti = b.farm.findIndex(f => !f.harvested);
        if (ti >= 0) {
          const f = b.farm[ti];
          return { kind: 'harvest', b, ti, tx: f.x, ty: f.y, work: P2.tileWorkH, workLeft: 0 };
        }
      }
      return null;
    }
  }
  return null;
};

G.completeTask = function (c) {
  const t = c.task;
  c.task = null;
  if (!t) { G.requestTask(c); return; }
  const b = t.b;
  switch (t.kind) {
    case 'build': {
      if (b && b.state === 'site') {
        b.workLeft -= t.work;
        b.progress = G.clamp(1 - b.workLeft / b.totalWork, 0, 1);
        if (b.workLeft <= 0) G.finishBuilding(b);
      }
      break;
    }
    case 'chop': {
      if (b && G.world.treeIdx[t.ty * G.world.N + t.tx] >= 0) {
        G.removeTree(G.world, t.tx, t.ty);
        c.carry = { type: 'wood', qty: G.TREE_LOGS };
      }
      break;
    }
    case 'plant': {
      G.addTree(G.world, t.tx, t.ty);
      break;
    }
    case 'work': {
      if (t.consume) {
        if (G.game.res[t.consume.type] < t.consume.qty) break; // 材料在干活的这几个小时里被同行用掉，本次白干
        G.game.res[t.consume.type] -= t.consume.qty;
      }
      if (t.yield) c.carry = { type: t.yield.type, qty: t.yield.qty };
      break;
    }
    case 'sow': {
      if (b && b.farm && b.farm[t.ti]) {
        b.farm[t.ti].sown = true;
        if (b.farm.every(f => f.sown)) b.sownAll = true;
      }
      break;
    }
    case 'harvest': {
      if (b && b.farm && b.farm[t.ti] && !b.farm[t.ti].harvested) {
        b.farm[t.ti].harvested = true;
        c.carry = { type: 'food', qty: G.PROD.farm.perTile };
        if (b.farm.every(f => f.harvested)) b.harvestDone = true;
      }
      break;
    }
  }
  if (c.carry) G.startHaul(c);
  else G.requestTask(c);
};

G.resetFarm = function (b) {
  for (const f of b.farm) { f.sown = false; f.harvested = false; }
  b.sownAll = false; b.growth = 0; b.harvestDone = false;
};

/* ================= 职业调度 ================= */
G.releaseWorker = function (c) {
  const w = G.world;
  if (c.job != null) {
    const b = w.bmap[c.job];
    if (b) b.workers = b.workers.filter(id => id !== c.id);
  }
  c.job = null; c.task = null;
  c.state = 'idle'; c.wanderT = 0.5;
};

G.assignWorker = function (b, c) {
  c.job = b.id;
  b.workers.push(c.id);
  G.requestTask(c);
  if (b.noWork) G.releaseWorker(c); // 无法派活的岗位立即释放
};

/* 选拔离 b 最近的市民 */
G.pickNearest = function (cands, b) {
  let best = null, bd = Infinity;
  for (const c of cands) {
    const d = G.d2(c.x, c.y, b.x, b.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
};

G.scheduleJobs = function () {
  const w = G.world;
  for (const b of w.buildings) b.noWork = false;
  const jobless = () => w.citizens.filter(c => !c.dead && c.adult && c.job == null);

  // 第一优先：建筑工地（人手不足时抽调：先抽非粮食岗位；
  // 粮食岗位仅在有富余时抽调 —— 保留约 pop/4 的粮食劳动力。
  // 注意：非收获季的农田没有产出，其工人视为普通劳动力可被抽调）
  const harvestSeason = G.game.season === 2;
  const FOOD_JOBS = harvestSeason ? ['gatherer', 'dock', 'farm'] : ['gatherer', 'dock'];
  for (const b of w.buildings) {
    if (b.state !== 'site') continue;
    let guard = 0;
    while (b.workers.length < 4 && guard++ < 8) {
      let c = G.pickNearest(jobless(), b);
      if (!c) {
        const busyAll = w.citizens.filter(ci => {
          if (ci.dead || !ci.adult || ci.job == null) return false;
          const jb = w.bmap[ci.job];
          return jb && jb.state === 'ok' && G.BDEF[jb.type].jobs > 0;
        });
        let pool = busyAll.filter(ci => !FOOD_JOBS.includes(w.bmap[ci.job].type));
        if (!pool.length) {
          // 粮食劳动力富余量：按人口测算所需粮食工人
          const foodWorkers = busyAll.filter(ci => FOOD_JOBS.includes(w.bmap[ci.job].type));
          const needFood = Math.ceil(w.citizens.filter(x => !x.dead).length * G.LIFE.eatPerYear / G.YEAR_DAYS / 8);
          if (foodWorkers.length > needFood) pool = foodWorkers;
        }
        c = G.pickNearest(pool, b);
        if (!c) break;
        G.releaseWorker(c);
      }
      G.assignWorker(b, c);
    }
  }

  // 第二优先：普通工作岗位
  for (const b of w.buildings) {
    if (b.state !== 'ok') continue;
    const def = G.BDEF[b.type];
    if (!def.jobs) continue;
    let guard = 0;
    while (b.workers.length < def.jobs && guard++ < 6) {
      const c = G.pickNearest(jobless(), b);
      if (!c) break;
      G.assignWorker(b, c);
    }
  }

  // 第三步：劳动力再平衡（每个调度周期最多调整一人，避免抖动）
  // 优先级：伐木屋（柴火=过冬命脉）> 其他；供体依次为：
  //   非收获季农田 → 全员闲置岗位 → 木材富余时的护林屋 → 秋收季从林业抽人抢收
  const FOOD_SET = ['gatherer', 'dock', 'farm'];
  const targets = w.buildings
    .filter(b => b.state === 'ok' && G.BDEF[b.type].jobs > 0 && b.workers.length < G.BDEF[b.type].jobs && !b.noWork)
    .sort((a, b2) => (a.type === 'woodcutter' ? -1 : b2.type === 'woodcutter' ? 1 : 0));
  for (const b of targets) {
    if (jobless().length) break; // 有无业者时由第二优先处理
    const give = (x) => {
      const c = w.cmap[x.workers[x.workers.length - 1]];
      if (c) { G.releaseWorker(c); G.assignWorker(b, c); }
    };
    // 供体 1：非收获季的农田（春夏无产出）
    if (!harvestSeason) {
      const farm = w.buildings.find(x => x.type === 'farm' && x.state === 'ok' && x.workers.length > 0);
      if (farm) { give(farm); continue; }
    }
    // 供体 2：全员闲置的岗位（粮食岗需 >1 人才能出借）
    const lazy = w.buildings.find(x => x !== b && x.state === 'ok' && G.BDEF[x.type].jobs > 0 && x.workers.length > 0
      && (!FOOD_SET.includes(x.type) || x.workers.length > 1)
      && x.workers.every(id => { const c = w.cmap[id]; return c && c.state === 'idle' && !c.task; }));
    if (lazy) { give(lazy); continue; }
    // 供体 3：伐木屋缺人且木材有富余 → 护林屋（>1 人）抽一人锯柴
    if (b.type === 'woodcutter' && G.game.res.wood > 10) {
      const forester = w.buildings.find(x => x.type === 'forester' && x.state === 'ok' && x.workers.length > 1);
      if (forester) { give(forester); continue; }
    }
    // 供体 4：秋收窗口宝贵 → 从伐木/护林抽人抢收
    if (harvestSeason && b.type === 'farm') {
      const d = w.buildings.find(x => x.state === 'ok' && (x.type === 'woodcutter' || x.type === 'forester') && x.workers.length > 0);
      if (d) { give(d); continue; }
    }
  }
};

/* ================= 建筑 ================= */
G.addBuilding = function (type, x, y, opt) {
  opt = opt || {};
  const def = G.BDEF[type];
  const w = G.world;
  if (!opt.free) {
    for (const k in def.cost) {
      if (G.game.res[k] < def.cost[k]) return { ok: false, reason: `${G.RES[k].name}不足（需要 ${def.cost[k]}）` };
    }
  }
  const chk = G.canPlace(w, type, x, y);
  if (!chk.ok) return chk;
  if (!opt.free) for (const k in def.cost) G.game.res[k] -= def.cost[k];

  // 清理占地上的树与岩石（原版：盖在树上得木材、盖在岩石上得石头）
  let bonusWood = 0;
  for (let j = y; j < y + def.h; j++)
    for (let i = x; i < x + def.w; i++) {
      if (w.treeIdx[j * w.N + i] >= 0) {
        G.removeTree(w, i, j);
        bonusWood += 2;
      }
      G.clearRock(w, i, j);
    }
  if (bonusWood) G.game.res.wood += bonusWood;

  const b = {
    id: G.nextId(), type, x, y, w: def.w, h: def.h,
    state: opt.instant ? 'ok' : 'site',
    progress: opt.instant ? 1 : 0,
    workLeft: opt.instant ? 0 : def.buildWork,
    totalWork: def.buildWork || 1,
    workers: [], family: null, noWork: false, warnText: '',
  };
  if (type === 'farm') {
    b.farm = [];
    for (let j = y; j < y + def.h; j++)
      for (let i = x; i < x + def.w; i++)
        b.farm.push({ x: i, y: j, sown: false, harvested: false });
    b.sownAll = false; b.growth = 0; b.harvestDone = false;
  }
  w.buildings.push(b);
  w.bmap[b.id] = b;
  for (let j = y; j < y + def.h; j++)
    for (let i = x; i < x + def.w; i++)
      w.bgrid[j * w.N + i] = b.id;
  // 把站在占地内的市民挤到最近的可站立格（防止被封死在建筑里）
  for (const c of w.citizens) {
    const cx = Math.round(c.x), cy = Math.round(c.y);
    if (cx >= x && cx < x + def.w && cy >= y && cy < y + def.h) {
      const spot = G.nearestWalkable(w, cx, cy, 8);
      if (spot) {
        c.x = spot.x; c.y = spot.y; c.path = null; c.pi = 0;
        if (c.state === 'walk' || c.state === 'haul') { c.state = 'idle'; c.wanderT = 0.5; }
      }
    }
  }
  G.scheduleJobs();
  if (opt.instant && type === 'house') G.assignHousing();
  return { ok: true, b };
};

G.finishBuilding = function (b) {
  if (b.state !== 'site') return;
  b.state = 'ok';
  b.progress = 1;
  // 建造工人多于正式岗位时，释放多余人员
  const def = G.BDEF[b.type];
  while (b.workers.length > def.jobs) {
    const id = b.workers.pop();
    const c = G.world.cmap[id];
    if (c) { c.job = null; c.task = null; c.state = 'idle'; }
  }
  G.ui.toast(`🏗 ${G.BDEF[b.type].name} 建成了`, 'good');
  if (b.type === 'house') G.assignHousing();
  G.scheduleJobs();
  G.ui.refreshHUD();
};

G.removeBuilding = function (b) {
  const w = G.world;
  if (b.type === 'storage') {
    const left = w.buildings.filter(x => x.type === 'storage').length;
    if (left <= 1) { G.ui.toast('不能拆除最后一座仓库', 'warn'); return; }
  }
  for (const id of b.workers) {
    const c = w.cmap[id];
    if (c) { c.job = null; c.task = null; c.state = 'idle'; }
  }
  if (b.family != null) {
    const fam = w.families.find(f => f.id === b.family);
    if (fam) fam.houseId = null;
  }
  for (let j = b.y; j < b.y + b.h; j++)
    for (let i = b.x; i < b.x + b.w; i++)
      w.bgrid[j * w.N + i] = -1;
  w.buildings = w.buildings.filter(x => x !== b);
  delete w.bmap[b.id];
  if (G.sel && G.sel.kind === 'b' && G.sel.id === b.id) G.ui.hideInfo();
  G.scheduleJobs();
};

G.demolishAt = function (tx, ty) {
  const w = G.world;
  const i = ty * w.N + tx;
  const bid = w.bgrid[i];
  if (bid >= 0) {
    const b = w.bmap[bid];
    if (b) { G.removeBuilding(b); G.ui.toast(`已拆除 ${G.BDEF[b.type].name}`, 'info'); }
    return;
  }
  if (w.road[i]) { w.road[i] = 0; G.needGround = true; return; }
  if (w.treeIdx[i] >= 0) { G.removeTree(w, tx, ty); return; }
  if (w.rock[i]) { G.clearRock(w, tx, ty); G.needGround = true; }
};
