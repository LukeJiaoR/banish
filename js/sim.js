'use strict';
/* ============================================================
 * sim.js —— 游戏状态、时间、市民 AI、职业调度、经济与生死
 * ============================================================ */

G.newGameState = function () {
  return {
    h: 6, day: 0, season: 0, year: 1,
    speed: 1, paused: false,
    res: { wood: 80, stone: 48, iron: 0, tools: 15, food: 500, meat: 0, vegetables: 0, grain: 500, leather: 0, wool: 0, clothes: 0, warmCoats: 0, herbs: 0, coal: 0, steelTools: 0, ale: 0, firewood: 50 }, // 开局（原版中难度 5 家庭，工具 15 件≈第一轮磨损周期）；存粮较原版加厚：15 人 6 天食物跑道撑不到第一座采集屋建成
    healthStartDay: 0,
    nomads: {nextDay:G.YEAR_DAYS,serial:0,offer:null,accepted:0,declined:0},
    schedT: 1,
    over: false,
    stats: { born: 0, died: 0, deadReasons: {} },
    prevFood: 200,
    unlocks: { orchard: false, cabbage:false }, livestock: { sheep: 0 },
    foodNet: 0,
    foodUrgent: false,
    warned: {},
    hist: [],       // 每日摘要环形缓冲（末 60 条）：反馈快照的时间维度，复盘/分析用
    buildLog: [],   // 最近 30 次建造/拆除（负号前缀 = 拆除）
    steelToolWear: 0,
    toolWear: 0,    // 工具磨损累积器（满 1 磨掉 1 把）
  };
};
G.game = G.newGameState();

G.seasonOf = function (day) { return Math.floor((day % G.YEAR_DAYS) / G.SEASON_DAYS); };
G.isWinter = function () { return G.game.season === 3; };
G.isRestTime = function () { const h = G.game.h; return h >= G.LIFE.restFrom || h < G.LIFE.restTo; };

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

/* 有人居住的取暖建筑（独栋住宅看 family 字段，宿舍看 family.houseId 反向引用） */
G.isOccupiedHome = function (w, b) {
  const def = G.BDEF[b.type];
  if (b.state !== 'ok' || def.warmWoodPerYear == null) return false;
  return b.family != null || w.families.some(f => f.houseId === b.id);
};

G.endDay = function () {
  const g = G.game, w = G.world;
  g.day++;
  const born0 = g.stats.born, died0 = g.stats.died; // 当日生死增量（进滚动日志）
  const oldSeason = g.season;
  g.season = G.seasonOf(g.day);
  g.year = Math.floor(g.day / G.YEAR_DAYS) + 1;
  if (g.season !== oldSeason) G.onSeasonChange(oldSeason, g.season);

  G.advanceTownEconomy();
  G.advanceNomads();

  // ---- 农田生长 ----
  for (const b of w.buildings) {
    if (b.type === 'farm' && b.state === 'ok' && b.sownAll && b.growth < 1 && g.season !== 3)
      b.growth = Math.min(1, b.growth + 1 / G.PROD.farm.growDays);
  }

  // ---- 森林自然轮转：非冬季偶发自播（护林屋之外，森林也能缓慢恢复/扩张） ----
  if (g.season !== 3 && w.trees.length > 0 && G.chance(G.TREE_SPREAD_CHANCE)) {
    const t0 = w.trees[(G.rng() * w.trees.length) | 0];
    G.addTree(w, t0.x + G.ri(-2, 2), t0.y + G.ri(-2, 2), g.day); // addTree 自带越界/占位检查
  }

  // ---- 进食 / 受冻 / 年龄 / 死亡 ----
  // 原版：每人每年吃 100 食物（儿童相同），粮食不足时儿童与在读学生优先
  const eat = G.LIFE.eatPerYear / G.YEAR_DAYS;
  G.reconcileFood(g);
  const sorted = w.citizens.slice().sort((a, b) => (a.age >= G.ADULT_AGE && !a.student ? 1 : 0) - (b.age >= G.ADULT_AGE && !b.student ? 1 : 0));
  for (const c of sorted) {
    if (g.res.food >= eat) {
      const meal = G.consumeFood(eat); c.hunger = 0; c.dietVariety = meal.length;
      c.dietScore = (c.dietScore ?? 1) * 0.9 + meal.length * 0.1;
    } else { c.hunger++; c.dietVariety = 0; }
    G.wearClothing(c);
    c.leisureDays=Math.max(0,G.leisureDaysOf(c)-1);
    c.happiness=G.clamp((c.happiness||3)+G.clamp(G.happinessTarget(c)-(c.happiness||3),-.1,.1),1,5);
  }


  G.advanceHealth();

  const winter = g.season === 3;
  // ---- 工具磨损：每个成人每天磨损 1/toolLifeDays 把；用尽则全员生产减半 ----
  const adultsNow = w.citizens.filter(c => !c.dead && c.adult).length;
  G.wearTools(adultsNow);
  // 有人住的房子才烧柴（含石屋/宿舍；取暖量按建筑类型，原版石屋省一半）
  const houses = w.buildings.filter(b => G.isOccupiedHome(w, b));
  // 原版：木屋每年约烧 30 柴火（石屋 15），集中在冬季消耗；柴火按屋支付，付不起的屋子挨冻
  for (const h of houses) h.unheated = false;
  if (winter && houses.length) {
    for (const h of houses) {
      const perHouse = G.BDEF[h.type].warmWoodPerYear / G.SEASON_DAYS;
      if (g.res.firewood >= perHouse) g.res.firewood -= perHouse;
      else { h.unheated = true; g.res.firewood = 0; }
    }
  }

  // 学堂学生数（每天重算，供入学容量判断）
  const schoolCount = {};
  for (const c of w.citizens) if (c.school != null) schoolCount[c.school] = (schoolCount[c.school] || 0) + 1;

  const dead = [];
  for (const c of w.citizens) {
    c.age += 1 / G.YEAR_DAYS;
    // 学堂停办（教师离职/学堂拆除）：在读学生立即辍学当工人，永久失去受教育机会（原版规则）
    if (c.student) {
      const sb = w.bmap[c.school];
      if (!sb || sb.state !== 'ok' || sb.workers.length === 0) {
        c.student = false; c.adult = true; c.school = null;
        G.ui.toast(`📚 ${c.name} 所在学堂停办，辍学当了工人`, 'warn');
      }
    }
    // 成长：有在办学堂就入学，否则直接当工人；学生毕业成为受教育工人
    if (!c.adult && c.age >= G.ADULT_AGE && !c.student) {
      const sc = G.pickSchool(schoolCount);
      if (sc) {
        c.student = true; c.school = sc.id;
        schoolCount[sc.id] = (schoolCount[sc.id] || 0) + 1;
        G.ui.toast(`🎓 ${c.name} 进入学堂读书`, 'good');
      } else {
        c.adult = true;
        G.ui.toast(`${c.name} 长大成人，可以工作了`, 'good');
      }
    }
    if (c.student && c.age >= G.LIFE.gradAge) {
      c.student = false; c.adult = true; c.educated = true; c.school = null;
      G.ui.toast(`🎓 ${c.name} 学成毕业`, 'good');
    }
    // 冻死判定（受冻累积在 stepCitizen 的 coldStep 按小时结算：户外累积/暖屋恢复/冷屋缓冻）
    // 自然老死（原版市民多活到 70~85 岁；死亡率随年龄缓升，实测死亡多落在 71~85 区间）
    if (c.age > G.OLD_AGE && G.chance(Math.min(0.25, (c.age - G.OLD_AGE) * 0.002)))
      dead.push([c, '寿终正寝']);
    else if (c.hunger >= G.LIFE.starveDays) dead.push([c, '饿死']);
    else if (c.cold >= G.LIFE.coldDays) dead.push([c, '冻死']);
  }
  for (const [c, why] of dead) G.killCitizen(c, why);

  // ---- 无效岗位释放工人 ----
  for (const b of w.buildings) {
    if (b.noWork && b.state === 'ok' && b.workers.length) {
      for (const id of b.workers) { const c = w.cmap[id]; if (c && !G.goalCommitment(c)) { c.job = null; c.task = null; c.state = 'idle'; } }
      b.workers = b.workers.filter(id => w.cmap[id] && w.cmap[id].job === b.id);
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
  if (pop > 0 && g.season === 2) {
    // 按实际取暖需求警告：需求 ≈ Σ 有人住的房屋年取暖量（冬季集中烧完）
    const warmNeed = w.buildings.reduce((s, b) => s + (G.isOccupiedHome(w, b) ? G.BDEF[b.type].warmWoodPerYear : 0), 0);
    if (g.res.firewood >= warmNeed) g.warned.firewood = false;
    else if (!g.warned.firewood) {
      g.warned.firewood = true;
      G.ui.toast(`⚠ 冬天将至，柴火不足（现有 ${Math.floor(g.res.firewood)}，需求约 ${warmNeed}）`, 'warn');
    }
  } else g.warned.firewood = false;
  if (pop > 0 && !g.warned.foodLow && g.res.food < pop * G.LIFE.eatPerDay * 3) {
    g.warned.foodLow = true;
    G.ui.toast('⚠ 食物储备不足 3 天', 'warn');
  }
  if (g.res.food > pop * G.LIFE.eatPerDay * 8) g.warned.foodLow = false;
  const toolDays = G.toolDaysLeft(adultsNow);
  if (pop > 0 && G.hasTools() && toolDays <= G.YEAR_DAYS && !g.warned.toolsLow) {
    g.warned.toolsLow = true;
    G.ui.toast(`⚠ 工具约够 ${Math.floor(toolDays)} 天，尽早备好铁匠铺与铁矿；近矿耗尽时需向外找矿`, 'warn');
  }
  if (toolDays > G.YEAR_DAYS * 1.5) g.warned.toolsLow = false;
  if (pop > 0 && !g.warned.noTools && !G.hasTools()) {
    g.warned.noTools = true;
    G.ui.toast('⚠ 工具用尽，生产减半——尽快建铁匠铺打工具（1铁+2木→2件）', 'bad');
  }
  if (G.hasTools()) g.warned.noTools = false;
  if (g.warned.storageFull) { // 满仓提示在腾出空间后复位
    const fullest = Math.max(...G.RES_KEYS.filter(k => !G.isTool(k)).map(k => g.res[k]));
    if (fullest < G.storageCap() - 50) g.warned.storageFull = false;
  }

  g.foodNet = g.res.food - g.prevFood;
  g.prevFood = g.res.food;
  // 每日摘要（末 60 条）：反馈快照自带时间曲线，饥荒/寒冬可复盘
  g.hist.push({
    d: g.day, season: g.season, pop: w.citizens.length,
    food: Math.round(g.res.food), firewood: Math.round(g.res.firewood),
    wood: Math.round(g.res.wood), stone: Math.round(g.res.stone), iron: Math.round(g.res.iron),
    born: g.stats.born - born0, died: g.stats.died - died0,
    warn: (g.warned.hunger ? 'h' : '') + (g.warned.firewood ? 'w' : '') + (g.warned.foodLow ? 'l' : ''),
  });
  if (g.hist.length > 60) g.hist.shift();
  G.ui.refreshHUD();
};

G.onSeasonChange = function (from, to) {
  const g = G.game;
  G.ui.toast(`${G.SEASON_ICONS[to]} ${G.SEASON_NAMES[to]}天来了`, to === 3 ? 'warn' : 'info');
  if (to === 0) {
    // 春回大地：农田全部复位（含上年已收获的），开始新一轮播种
    for (const b of G.world.buildings) {
      if (b.type === 'farm' && b.state === 'ok') G.resetFarm(b,true);
    }
  }
  if (to === 3) {
    // 未收获的作物冻死
    for (const b of G.world.buildings) {
      if (b.type === 'farm' && G.farmSeasonCommitted(b) && !b.harvestDone) {
        G.ui.toast('农田里的作物被冻死了', 'bad');
        G.resetFarm(b,false);
      }
    }
  }
  G.needGround = true;          // 换季调色板变化，整图重绘
  if (G.groundDirty) G.groundDirty.clear();
  if (G.autosave) G.autosave();
};

/* ================= 家庭 ================= */
/* 亲缘独立于同住家庭：搬家、丧偶与父母去世不能抹掉血缘。
 * 旧档只有同住名单，不能可靠推断谁是夫妇；保留住户与住房，以原户作为
 * 保守的亲缘屏障。仅明确、双向的配偶关系可生育，迁移不会凭同住造配偶。 */
G.normalizeFamilyRelations = function (w = G.world) {
  const ids = a => Array.from(new Set(Array.isArray(a) ? a.filter(id => Number.isSafeInteger(id) && id > 0) : []));
  for (const c of w.citizens) {
    c.parentIds = ids(c.parentIds).filter(id => id !== c.id);
    c.grandparentIds = ids(c.grandparentIds).filter(id => id !== c.id);
    c.ancestorIds = ids(c.ancestorIds).filter(id => id !== c.id);
    if (!Number.isSafeInteger(c.birthFamilyId)) c.birthFamilyId = null;
    if (!Number.isSafeInteger(c.partnerId)) c.partnerId = null;
  }
  const seen = new Set();
  for (const f of w.families) {
    const legacy = !Array.isArray(f.coupleIds);
    f.members = ids(f.members).filter(id => {
      const c = w.cmap[id];
      if (!c || c.dead || seen.has(id) || (c.familyId != null && c.familyId !== f.id)) return false;
      seen.add(id); c.familyId = f.id; return true;
    });
    for (const c of w.citizens) if (c.familyId === f.id && !seen.has(c.id)) { f.members.push(c.id); seen.add(c.id); }
    if (legacy) {
      // 旧版开局的唯一可证关系：连续生成男、女，再生成家庭 ID。
      // 丈妻均活着时旧逻辑绝不会重组此户；父母亡故后孩子 ID 大于户 ID，
      // 不可能落入此模式。其余同住名单不能作为婚配证据。
      const m = w.cmap[f.members[0]], mother = w.cmap[f.members[1]];
      if (m && mother && m.id === f.id - 2 && mother.id === f.id - 1 && m.sex === 'm' && mother.sex === 'f' && m.age >= 18 && mother.age >= 18) {
        f.coupleIds = [m.id, mother.id]; m.partnerId = mother.id; mother.partnerId = m.id;
        for (const id of f.members.slice(2)) {
          const child = w.cmap[id];
          if (!child.parentIds.length) child.parentIds = [m.id, mother.id];
          if (child.birthFamilyId == null) child.birthFamilyId = f.id;
        }
      } else for (const id of f.members) {
        const c = w.cmap[id];
        if (c.birthFamilyId == null) c.birthFamilyId = f.id;
      }
    }
    f.coupleIds = ids(f.coupleIds).filter(id => f.members.includes(id));
    for (const id of f.members) {
      const c = w.cmap[id];
      if (c.parentIds.length && c.birthFamilyId == null) c.birthFamilyId = f.id;
    }
  }
  for (const c of w.citizens) if (!seen.has(c.id)) c.familyId = null;
  // 祖辈 ID 随孩子保存；祖辈死亡后不依赖 cmap，重载后仍可判亲缘。
  for (let pass = 0; pass < w.citizens.length; pass++) {
    let changed = false;
    for (const c of w.citizens) {
      const ancestry = new Set(c.ancestorIds.concat(c.parentIds)), grandparents = new Set(c.grandparentIds);
      for (const id of c.parentIds) {
        const p = w.cmap[id];
        if (p) {
          for (const id of p.parentIds) if (id !== c.id) grandparents.add(id);
          for (const ancestor of p.parentIds.concat(p.ancestorIds)) if (ancestor !== c.id) ancestry.add(ancestor);
        }
      }
      if (grandparents.size !== c.grandparentIds.length) { c.grandparentIds = Array.from(grandparents); changed = true; }
      if (ancestry.size !== c.ancestorIds.length) { c.ancestorIds = Array.from(ancestry); changed = true; }
    }
    if (!changed) break;
  }
  for (const c of w.citizens) {
    const p = w.cmap[c.partnerId];
    if (!p || p.dead || p.partnerId !== c.id || c.familyId == null || p.familyId !== c.familyId || G.areCloseKin(c, p)) c.partnerId = null;
  }
  for (const f of w.families) {
    const pairs = f.members.map(id => w.cmap[id]).filter(c => c.partnerId != null);
    // 一个居住家庭只有一对育儿伴侣；修复意外的重复关系不任意再配对。
    const first = pairs.find(c => f.coupleIds.includes(c.id)) || pairs[0];
    f.coupleIds = first ? [first.id, first.partnerId] : [];
    for (const c of pairs) if (!f.coupleIds.includes(c.id)) c.partnerId = null;
  }
};

G.areCloseKin = function (a, b) {
  if (!a || !b || a.id === b.id) return true;
  if (a.birthFamilyId != null && a.birthFamilyId === b.birthFamilyId) return true;
  const aa = new Set((a.parentIds || []).concat(a.ancestorIds || []));
  const bb = new Set((b.parentIds || []).concat(b.ancestorIds || []));
  if (aa.has(b.id) || bb.has(a.id)) return true;
  // 旁系限于父母/祖父母两代；更远的共同祖先不能永久封死整个村庄。
  const nearA = new Set((a.parentIds || []).concat(a.grandparentIds || []));
  const nearB = new Set((b.parentIds || []).concat(b.grandparentIds || []));
  for (const id of nearA) if (nearB.has(id)) return true;
  return false;
};

/* 工作成年年龄不等于成家年龄；在读学生与已婚者不参与配对。 */
G.isSingle = function (c) {
  if (!c || c.dead || c.student || c.age < Math.max(18, G.MOTHER_MIN)) return false;
  const p = G.world.cmap[c.partnerId];
  return !p || p.dead || p.partnerId !== c.id;
};

/* 只让本人及其未独立子女随迁，成年子女不再困在父母家庭中。
 * 双方原户还有其他住户时，需要空独栋住宅才另立门户。 */
G.joinFamilies = function (a, b) {
  const w = G.world;
  if (!G.isSingle(a) || !G.isSingle(b) || a.sex === b.sex || G.areCloseKin(a, b)) return false;
  const fa = G.familyOf(a), fb = G.familyOf(b);
  if (fa && fa === fb) return false;
  const moving = c => {
    const f = G.familyOf(c);
    return [c.id].concat(f ? f.members.filter(id => {
      const child = w.cmap[id];
      return child && child.id !== c.id && (child.parentIds || []).includes(c.id) && child.partnerId == null && (child.age < 18 || child.student);
    }) : []);
  };
  const am = moving(a), bm = moving(b), members = Array.from(new Set(am.concat(bm)));
  if (members.length > G.LIFE.maxFamily) return false;
  const wholeA = fa && fa.members.every(id => am.includes(id));
  const wholeB = fb && fb.members.every(id => bm.includes(id));
  const retained = [wholeA && fa, wholeB && fb].filter(Boolean).sort((x, y) => (x.houseId == null ? 1 : 0) - (y.houseId == null ? 1 : 0))[0];
  const free = w.buildings.find(h => (h.type === 'house' || h.type === 'stonehouse') && h.state === 'ok' && h.family == null);
  if (!retained && (fa || fb) && !free) return false;
  const fam = retained || { id: G.nextId(), members: [], houseId: free ? free.id : null, coupleIds: [] };
  for (const old of [fa, fb]) {
    if (!old || old === fam) continue;
    old.members = old.members.filter(id => !members.includes(id));
    old.coupleIds = (old.coupleIds || []).filter(id => old.members.includes(id));
    if (!old.members.length) {
      const h = w.bmap[old.houseId];
      if (h && h.family === old.id) h.family = null;
      w.families = w.families.filter(f => f !== old);
    }
  }
  if (!retained) w.families.push(fam);
  fam.members = members;
  fam.coupleIds = [a.id, b.id];
  for (const id of members) w.cmap[id].familyId = fam.id;
  a.partnerId = b.id; b.partnerId = a.id;
  const home = w.bmap[fam.houseId];
  if (home && home.type !== 'boarding') home.family = fam.id;
  G.ui.toast(`${a.name} 与 ${b.name} 结为夫妇`, 'good');
  return true;
};

G.formFamilies = function () {
  const w = G.world;
  G.normalizeFamilyRelations(w);
  const men = w.citizens.filter(c => c.sex === 'm' && G.isSingle(c));
  const women = w.citizens.filter(c => c.sex === 'f' && G.isSingle(c));
  for (const m of men) {
    if (!G.isSingle(m)) continue;
    const candidates = women.filter(f => G.isSingle(f) && !G.areCloseKin(m, f))
      .sort((a, b) => G.d2(m.x, m.y, a.x, a.y) - G.d2(m.x, m.y, b.x, b.y));
    for (const f of candidates) if (G.joinFamilies(m, f)) break;
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

/* 宿舍当前入住的家庭数 */
G.boardingFamilies = function (w, b) {
  return w.families.filter(f => f.houseId === b.id);
};

G.assignHousing = function () {
  const w = G.world;
  const free = w.buildings.filter(b => (b.type === 'house' || b.type === 'stonehouse') && b.state === 'ok' && b.family == null);
  // 原版：市民不会主动住宿舍，但没房子的家庭会被安排进宿舍过冬；
  // 一旦有空独栋木屋（含石屋），先安置无房家庭（含丧偶独居者）、再让宿舍里的家庭搬出
  const homeless = w.families.filter(f => f.houseId == null && f.members.length >= 2);
  const homelessSolo = w.families.filter(f => f.houseId == null && f.members.length === 1);
  const inBoarding = w.families.filter(f => {
    const h = f.houseId != null ? w.bmap[f.houseId] : null;
    return h && h.type === 'boarding';
  });
  for (const fam of homeless.concat(homelessSolo, inBoarding)) {
    const house = free.shift();
    if (!house) break;
    fam.houseId = house.id;
    house.family = fam.id;
  }
  // 没有空独栋：无房家庭（含单人户）入住宿舍，仍先安排多人户（最多 5 家）
  const boardings = w.buildings.filter(b => b.type === 'boarding' && b.state === 'ok');
  if (boardings.length) {
    for (const fam of homeless.concat(homelessSolo)) {
      if (fam.houseId != null) continue;
      const b = boardings.find(b2 => G.boardingFamilies(w, b2).length < G.LIFE.boardingCap);
      if (!b) break;
      fam.houseId = b.id;
    }
  }
};

G.tryBirths = function () {
  const w = G.world, g = G.game;
  const pop = Math.max(1, w.citizens.length);
  for (const fam of w.families) {
    if (fam.members.length < 2 || fam.houseId == null || fam.members.length >= G.LIFE.maxFamily) continue;
    const couple = (fam.coupleIds || []).map(id => w.cmap[id]);
    if (couple.length !== 2 || couple.some(c => !c || c.dead || c.student || G.isArriving(c) || c.familyId !== fam.id || !fam.members.includes(c.id))) continue;
    const mother = couple.find(c => c.sex === 'f'), father = couple.find(c => c.sex === 'm');
    if (!mother || !father || mother.partnerId !== father.id || father.partnerId !== mother.id || G.areCloseKin(mother, father)) continue;
    if (mother.age < Math.max(18, G.MOTHER_MIN) || mother.age > G.MOTHER_MAX || father.age < 18) continue;
    const house = w.bmap[fam.houseId];
    if (!house || house.state !== 'ok' || !['house', 'stonehouse', 'boarding'].includes(house.type)) continue;
    if (g.res.food < pop * G.LIFE.eatPerDay * G.LIFE.birthFoodDays) continue; // 粮食紧张时不生育
    if (G.chance(G.LIFE.birthChance)) {
      // 出生点必须在房屋脚印之外：占位格不可通行，站进去寻路全失败，
      // 夜里回不了家按露宿挨冻、白天也挪不动（冬季婴儿冻死的根源）
      const spot = G.nearestWalkable(w, house.x + 1, house.y + 1, 4);
      G.spawnCitizen({
        x: spot ? spot.x : house.x + 1,
        y: spot ? spot.y : house.y + 1,
        sex: G.chance(0.5) ? 'm' : 'f',
        age: 0, adult: false,
        familyId: fam.id, partnerId: null, parentIds: [mother.id, father.id],
        grandparentIds: Array.from(new Set((mother.parentIds || []).concat(father.parentIds || []))),
        ancestorIds: Array.from(new Set([mother.id, father.id].concat(mother.ancestorIds || [], father.ancestorIds || [], mother.parentIds || [], father.parentIds || []))),
        birthFamilyId: fam.id,
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
  const sex = opt.sex || (G.chance(0.5) ? 'm' : 'f');
  const c = {
    id: G.nextId(),
    name: G.citizenName(sex),
    sex,
    age: opt.age !== undefined ? opt.age : G.ri(18, 40),
    adult: opt.adult !== undefined ? opt.adult : (opt.age === undefined ? true : opt.age >= G.ADULT_AGE),
    x: opt.x, y: opt.y,
    familyId: opt.familyId != null ? opt.familyId : null,
    partnerId: opt.partnerId != null ? opt.partnerId : null,
    parentIds: Array.isArray(opt.parentIds) ? opt.parentIds.slice() : [],
    grandparentIds: Array.isArray(opt.grandparentIds) ? opt.grandparentIds.slice() : [],
    ancestorIds: Array.isArray(opt.ancestorIds) ? opt.ancestorIds.slice() : [],
    birthFamilyId: opt.birthFamilyId != null ? opt.birthFamilyId : null,
    job: null, task: null, carry: null, pausedTask: null, arrivalHallId:opt.arrivalHallId??null,
    student: false, educated: false, school: null,
    state: 'idle', walkKind: '', path: null, pi: 0, camped: false,
    wanderT: G.rng() * 3,
    hunger: 0, cold: 0, clothingLeft: 0, clothingType:null, dietVariety: 0, dietScore: 1, happiness: 3, leisureDays:0, health: 4, sickDays: 0, immunityDays: 0, herbCooldown: 0, careHours: 0,
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
  const partner = w.cmap[c.partnerId];
  if (partner && partner.partnerId === c.id) partner.partnerId = null;
  c.partnerId = null;
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
    if ((fam.coupleIds || []).includes(c.id)) fam.coupleIds = [];
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
  let v = G.surfaceSpeed(w, Math.round(c.x), Math.round(c.y));
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

/* A forest/field task owns a physical tile; a factory task owns a building
 * perimeter. Never turn the former into work at a nearby arbitrary doorway. */
G.physicalTaskEndpoint = function (t) {
  return !!t && (['chop', 'clearrock', 'plant', 'sow', 'harvest'].includes(t.kind) ||
    (t.kind === 'work' && t.b && ['gatherer', 'hunting', 'herbalist'].includes(t.b.type)));
};
G.dropBlockedTask = function (c, t) {
  if (c.pausedTask === t) c.pausedTask = null;
  if (c.task !== t) return;
  c.task = null;
  if (c.state === 'work' || (c.state === 'walk' && c.walkKind === 'task')) {
    c.path = null; c.pi = 0; c.state = 'idle'; c.walkKind = ''; c.wanderT = .5;
  }
};
G.alternateTaskEndpoint = function (c, t) {
  if (!t || G.physicalTaskEndpoint(t) || !t.b || G.world.bmap[t.b.id] !== t.b) return null;
  if (['build','clearSite'].includes(t.kind) ? t.b.state !== 'site' : t.b.state !== 'ok') return null;
  if (t.kind === 'clearSite' && (!t.tree || G.world.trees[G.world.treeIdx[t.tree.i]] !== t.tree)) return null;
  if (['care', 'clinic', 'arrival', 'leisure', 'host'].includes(t.kind)) return G.workSpot(G.world, t.b, c.x, c.y, true);
  if (t.kind === 'clearSite') return G.siteClearSpot(c, t.b, t.tree);
  if (['firewood', 'trade', 'brew'].includes(t.kind) && t.phase === 'fetch') return G.storageRoute(c.x, c.y)?.spot || null;
  if (t.kind === 'build' || t.kind === 'firewood' || t.kind === 'trade' || t.kind === 'brew' ||
      (t.kind === 'work' && ['dock', 'mine', 'stonequarry', 'blacksmith', 'pasture', 'orchard'].includes(t.b.type)))
    return G.workSpot(G.world, t.b, c.x, c.y, true);
  return null;
};

// An immediate dispatch hint is non-serialized and never a persistent route cache.
G.withTaskRoute = function (task, route) {
  if (route) Object.defineProperty(task,'dispatchRoute',{value:route,configurable:true});
  return task;
};
G.routeCanReuse = function (route, c, tx, ty) {
  if (!route || route.world !== G.world || route.revision !== (G.world.navigationRevision||0) || route.fromX !== c.x || route.fromY !== c.y || route.target.x !== tx || route.target.y !== ty) return false;
  const owner=route.target.building||route.target.storage;
  if (owner && (G.world.bmap[owner.id]!==owner || owner.state!==(route.target.storage?'ok':route.target.state))) return false;
  return !G.tileBlocked(G.world,tx,ty);
};

/* 发送市民去任务点 */
G.sendTo = function (c, tx, ty, planned = null) {
  let route=planned||(c.task&&c.task.dispatchRoute);
  if(c.task) delete c.task.dispatchRoute;
  const buildingTask=c.task && (['build','clearSite','firewood','trade','care','clinic','arrival','leisure','host','brew'].includes(c.task.kind) || (c.task.kind==='work' && c.task.b && ['dock','mine','stonequarry','blacksmith','pasture','orchard'].includes(c.task.b.type)));
  if((route && !G.routeCanReuse(route,c,tx,ty)) || (!route && buildingTask)) {
    const spot=G.alternateTaskEndpoint(c,c.task);
    if(!spot){if(c.task)G.dropBlockedTask(c,c.task);c.path=null;c.state='idle';c.wanderT=.5;return false;}
    tx=spot.x;ty=spot.y;route=spot.route;c.task.tx=tx;c.task.ty=ty;
  }
  if (G.tileBlocked(G.world, tx, ty)) {
    const spot = G.alternateTaskEndpoint(c, c.task);
    if (!spot) { if (c.task) G.dropBlockedTask(c, c.task); c.state = 'idle'; c.path = null; c.wanderT = .5; return false; }
    tx = spot.x; ty = spot.y; route=spot.route; c.task.tx = tx; c.task.ty = ty;
  }
  const p = G.routeCanReuse(route,c,tx,ty) ? route.path : G.findPath(G.world, Math.round(c.x), Math.round(c.y), tx, ty);
  if (!p) { c.state = 'idle'; c.task = null; return false; }
  c.path = p; c.pi = 0;
  if (p.length === 0) { c.state = 'work'; if (c.task && !(c.task.workLeft > 0)) c.task.workLeft = c.task.work; }
  else { c.state = 'walk'; c.walkKind = 'task'; }
  return true;
};

/* 回家睡觉（无房者就地睡）。没干完的活先挂起，天亮接着干——
 * 否则 40 小时的伐木任务永远无法在 16 小时的工作日内完成 */
G.goHome = function (c) {
  if (c.task) c.pausedTask = c.task;
  c.task = null;
  const h = G.homeOf(c);
  if (!h) { c.path = null; c.state = 'rest'; c.camped = true; return; }
  // 离家太远（如护林人深入林中）：就地露宿，天亮原地续接——
  // 深夜长途回家再折返会把整个工作日耗在路上
  const d = Math.sqrt(G.d2(c.x, c.y, h.x + h.w / 2, h.y + h.h / 2));
  if (d > G.LIFE.campDist) { c.path = null; c.state = 'rest'; c.camped = true; return; }
  const spot = G.workSpot(G.world, h, c.x, c.y);
  const p = spot ? (G.routeCanReuse(spot.route,c,spot.x,spot.y) ? spot.route.path : G.findPath(G.world,Math.round(c.x),Math.round(c.y),spot.x,spot.y)) : null;
  // A nearby home can require a long detour around water or buildings. For a
  // suspended job, reuse the route already found rather than restarting the same
  // unfinished commute every morning. No new path search or cross-day cache.
  if (c.pausedTask && p && p.length) {
    let distance = 0, previous = c;
    for (const point of p) {
      distance += G.dist(previous.x, previous.y, point.x, point.y);
      if (distance > G.LIFE.campDist) { c.path = null; c.state = 'rest'; c.camped = true; return; }
      previous = point;
    }
  }
  if (p && p.length) { c.path = p; c.pi = 0; c.state = 'walk'; c.walkKind = 'home'; c.camped = false; }
  else if (p) { c.path = null; c.state = 'rest'; c.camped = false; } // 已站在家门口：算回家了（空路径 ≠ 找不到路）
  else { c.path = null; c.state = 'rest'; c.camped = true; }        // 真找不到路也只能露宿
};

/* 天亮续接昨晚挂起的任务；目标已失效（树被砍/建筑拆了/换岗位）则放弃 */
G.resumeTask = function (c) {
  if (G.isArriving(c)) {c.pausedTask=null;return G.startImmigration(c);}
  const t = c.pausedTask;
  c.pausedTask = null;
  if (!t) return false;
  const w = G.world;
  // 建筑任务要求仍在原岗位；散工任务还须保留玩家标记，不能续接已取消的命令。
  const i = t.ty * w.N + t.tx;
  let ok = t.b ? (c.job != null && w.bmap[c.job] === t.b) :
    (t.kind === 'chop' ? !!(w.marked && w.marked.has(i)) :
      t.kind === 'clearrock' && !!(w.markedRocks && w.markedRocks.has(i)));
  if (ok && t.kind === 'chop') {
    const idx = w.treeIdx[t.ty * w.N + t.tx];
    ok = idx >= 0 && w.trees[idx] === t.tree;   // 同一棵树还在（防止重种/互换后误续）
  } else if (ok && t.kind === 'clearSite') {
    const idx = w.treeIdx[t.tree.y * w.N + t.tree.x];
    ok = t.b.state === 'site' && idx >= 0 && w.trees[idx] === t.tree;
  } else if (ok && t.kind === 'clearrock') {
    ok = t.rock > 0 && w.rock[i] === t.rock;
  } else if (ok && t.kind === 'plant') {
    const i = t.ty * w.N + t.tx;
    ok = !w.water[i] && !w.rock[i] && !w.road[i] && w.treeIdx[i] < 0 && w.bgrid[i] < 0;
  } else if (ok && t.kind === 'sow') {
    ok = G.farmTaskCurrent(t) && !t.b.farm[t.ti].sown;
  } else if (ok && t.kind === 'harvest') {
    ok = G.farmTaskCurrent(t) && t.b.farm[t.ti].sown && !t.b.farm[t.ti].harvested;
  } else if (ok && t.kind === 'firewood') {
    ok = t.b.state === 'ok';
  } else if (ok && t.kind === 'build') {
    ok = t.b.state === 'site';
  }
  if (!ok) return false;
  c.task = t;
  c.state = 'idle';
  return G.sendTo(c, t.tx, t.ty); // preserve remaining work only at a real endpoint
};

/* 最近的可用仓库 */
G.nearestStorage = function (x, y) {
  let best = null, bd = Infinity;
  for (const s of G.world.buildings) {
    if (s.type !== 'storage' || s.state !== 'ok') continue;
    const d = G.d2(x, y, s.x + s.w / 2, s.y + s.h / 2);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
};

/* 找最近可达的交货点。直线最近仓库可能隔河，不能让它挡住其他可用仓库。 */
G.storageRoute = function (x, y) {
  const w = G.world, targets = [];
  for (const storage of w.buildings) {
    if (storage.type !== 'storage' || storage.state !== 'ok') continue;
    for (let sy=storage.y-1;sy<=storage.y+storage.h;sy++)
      for (let sx=storage.x-1;sx<=storage.x+storage.w;sx++)
        if ((sx<storage.x||sx>=storage.x+storage.w||sy<storage.y||sy>=storage.y+storage.h)&&!G.tileBlocked(w,sx,sy)) targets.push({x:sx,y:sy,storage});
  }
  const route=G.findPathToAny(w,x,y,targets);
  return route ? {storage:route.target.storage,spot:G.routeSpot(route),path:route.path,eta:route.eta} : null;
};

/* Limited minerals retain one ordinary carried batch when a warehouse rejects
 * part of a delivery. Tavern output and refundable raw grain share this bounded
 * delivery path; other ordinary resource delivery policy is unchanged. */
G.isMineralCargo = function (c) { return !!c.carry && (['stone','iron','coal','ale','clothes','warmCoats'].includes(c.carry.type) || (c.carry.type==='grain' && c.carry.brewIngredient===true)); };
G.mineralStorageSpace = function (type) { return Math.max(0, G.storageCap() - G.game.res[G.isFood(type)?'food':type]); };
// Ordinary in-flight minerals remain eligible as before; only an already
// blocked delivery cannot count as available labour or occupy a productive slot.
G.mineralDeliveryBlocked = function (c) {
  return G.isMineralCargo(c) && c.haulPending && c.state !== 'haul' &&
    (c.haulWait === 'route' || (c.haulWait === 'space' && G.mineralStorageSpace(c.carry.type) <= 0));
};
G.waitForMineralStorage = function (c, reason) {
  c.haulWait = reason; c.task = null; c.path = null; c.pi = 0; c.haulTo = null;
  c.state = 'waitStorage'; c.wanderT = 2;
};
G.warnMineralStorage = function () {
  if (G.game.warned.mineralStorageFull) return;
  G.game.warned.mineralStorageFull = true;
  G.ui.toast('⚠ 仓位已满，矿物、麦酒、成衣或退回原粮由市民随身保留；使用库存或建成新仓库后继续送仓', 'warn');
};
G.cargoWaitReason = function (c) {
  if (!G.isMineralCargo(c) || !c.haulPending || c.state === 'haul') return '';
  if (G.mineralStorageSpace(c.carry.type) <= 0) return '仓满，带货等待空间（使用库存或新建仓库）';
  return c.haulWait === 'route' ? '带货等待可达仓库' : '带货等待送仓';
};
G.finishMineralHaul = function (c) {
  c.carry.qty -= G.depositCargo(c.carry);
  if (c.carry.qty > 0) { G.warnMineralStorage(); G.waitForMineralStorage(c, 'space'); return; }
  c.carry = null; c.haulPending = false; c.haulWait = ''; c.haulTo = null;
  G.requestTask(c);
};
G.startMineralHaul = function (c) {
  c.haulPending = true;
  if (G.mineralStorageSpace(c.carry.type) <= 0) { G.warnMineralStorage(); G.waitForMineralStorage(c, 'space'); return; }
  if (!G.nearestStorage(c.x, c.y)) { G.finishMineralHaul(c); return; } // legacy no-warehouse save
  const route = G.storageRoute(c.x, c.y);
  if (!route) { G.waitForMineralStorage(c, 'route'); return; }
  c.haulWait = ''; c.haulTo = route.storage.id; c.path = route.path; c.pi = 0; c.task = null;
  if (!c.path.length) G.finishMineralHaul(c);
  else c.state = 'haul';
};
/* Full minerals remain marked in the ground, without reserving food workers. */
G.availableRockMarks = function (w) {
  const cap = G.storageCap(), r = G.game.res;
  if (r.stone < cap && r.iron < cap) return w.markedRocks;
  return new Set([...(w.markedRocks || [])].filter(i => w.rock[i] === 2 ? r.iron < cap : r.stone < cap));
};

/* 开始搬运去仓库 */
G.startHaul = function (c) {
  if (G.isMineralCargo(c)) { G.startMineralHaul(c); return; }
  if (!G.nearestStorage(c.x, c.y)) { // 兼容旧的无仓存档：仍受仓储上限约束
    G.depositCargo(c.carry);
    c.carry = null;
    G.requestTask(c);
    return;
  }
  const route = G.storageRoute(c.x, c.y);
  if (!route) { c.task = null; c.path = null; c.state = 'idle'; c.wanderT = 2; return; }
  c.haulTo = route.storage.id;
  c.path = route.path; c.pi = 0; c.task = null;
  if (!c.path.length) {
    G.depositCargo(c.carry);
    c.carry = null;
    G.requestTask(c);
  } else c.state = 'haul';
};

/* 燃料上限（原版 Wood Cutter 的 Fuel Limit）：柴火库存达到上限即停产；旧档/测试无该字段时用默认值 */
G.fuelLimitOf = function (b) { return Number.isFinite(b.fuelLimit) ? G.clamp(b.fuelLimit, 0, G.PROD.woodcutter.fuelMax) : G.PROD.woodcutter.fuelLimit; };
G.fuelLimited = function (b) { return b.type === 'woodcutter' && (G.productionGoalOf('firewood') === null ? G.game.res.firewood >= G.fuelLimitOf(b) : G.goalPaused('firewood', b)); };
G.toolLimitOf = function (b) { return Number.isFinite(b.toolLimit) ? G.clamp(b.toolLimit, 0, G.PROD.blacksmith.toolMax) : G.PROD.blacksmith.toolLimit; };
G.toolLimited = function (b) { const type = G.blacksmithOutput(b); return b.type === 'blacksmith' && (G.productionGoalOf(type) === null ? G.game.res[type] >= G.toolLimitOf(b) : G.goalPaused(type, b)); };

/* Optional automatic-production goals. Unset means the exact legacy rules.
 * Hysteresis changes at deliveries and the normal 2h scheduler, never in UI reads. */
G.PRODUCTION_GOAL_MAX = 1000000;
G.PRODUCTION_OUTPUTS = { woodcutter: ['firewood'], blacksmith: ['tools'], forester: ['wood'], mine: ['stone', 'iron'], stonequarry: ['stone'], gatherer: ['food', 'vegetables'], dock: ['food', 'meat'], hunting: ['food', 'meat', 'leather'], farm: ['food', 'grain'], tailor: ['clothes'], pasture: ['food', 'meat', 'wool'], orchard: ['food', 'vegetables'], herbalist: ['herbs'], tavern:['ale'] };
G.productionGoalOf = function (type, game) {
  const goals = (game || G.game).productionGoals;
  return goals && Object.prototype.hasOwnProperty.call(goals, type) && Number.isFinite(goals[type]) ? goals[type] : null;
};
G.productionResumeAt = function (target) { return Math.max(0, target - Math.min(100, Math.max(1, Math.ceil(target * 0.1)))); };
G.effectiveProductionGoal = function (type, b, game) {
  const target = G.productionGoalOf(type, game);
  if (target === null) return null;
  const local = b && b.type === 'woodcutter' && type === 'firewood' ? G.fuelLimitOf(b)
    : b && b.type === 'blacksmith' && type === G.blacksmithOutput(b) ? G.toolLimitOf(b) : Infinity;
  return Math.min(target, local);
};
G.nextGoalPause = function (stock, target, paused) {
  if (target === 0 || stock >= target) return true;
  if (stock <= G.productionResumeAt(target)) return false;
  return paused === true;
};
G.updateProductionGoals = function (game, world) {
  const g = game || G.game, w = world || G.world;
  if (!g.productionGoals) return;
  g.productionPaused = g.productionPaused || {};
  for (const type of G.RES_KEYS) {
    const target = G.productionGoalOf(type, g);
    if (target === null) { delete g.productionPaused[type]; continue; }
    g.productionPaused[type] = G.nextGoalPause(g.res[type], target, g.productionPaused[type]);
  }
  for (const b of w.buildings) {
    const type = b.type === 'woodcutter' ? 'firewood' : b.type === 'blacksmith' ? G.blacksmithOutput(b) : null;
    if (!type) continue;
    const target = G.effectiveProductionGoal(type, b, g);
    if (target === null) delete b.productionPaused;
    else b.productionPaused = G.nextGoalPause(g.res[type], target, typeof b.productionPaused === 'boolean' ? b.productionPaused : g.productionPaused[type]);
  }
};
G.goalPaused = function (type, b) {
  if (G.FOOD_KEYS.includes(type) && G.goalPaused('food')) return true;
  if (G.productionGoalOf(type) === null) return false;
  if (b && ((b.type === 'woodcutter' && type === 'firewood') || (b.type === 'blacksmith' && type === G.blacksmithOutput(b)))) return b.productionPaused === true || !!(G.game.productionPaused && G.game.productionPaused[type]);
  return !!(G.game.productionPaused && G.game.productionPaused[type]);
};
G.farmSeasonCommitted = function (b) {
  return !!(b.sowingCommitted || b.sownAll || (b.farm && b.farm.some(f => f.sown)));
};
G.setProductionGoal = function (type, value) {
  if (!G.RES_KEYS.includes(type) || (value !== null && (!Number.isInteger(value) || value < 0 || value > G.PRODUCTION_GOAL_MAX))) return false;
  const g = G.game;
  const previous = G.productionGoalOf(type);
  if (previous === value) return true;
  g.productionGoals = g.productionGoals || {}; g.productionPaused = g.productionPaused || {};
  // A not-yet-finished first sow task is already a seasonal commitment.
  if ((type === 'food' || type === 'grain' || type === 'vegetables') && value !== null) for (const b of G.world.buildings)
    if (b.type === 'farm' && (G.farmSeasonCommitted(b) ||
      G.world.citizens.some(c => [c.task, c.pausedTask].some(t => t && t.b === b && t.kind === 'sow')))) b.sowingCommitted = true;
  if (value === null) delete g.productionGoals[type]; else g.productionGoals[type] = value;
  delete g.productionPaused[type];
  for (const b of G.world.buildings) if ((type === 'firewood' && b.type === 'woodcutter') || (b.type === 'blacksmith' && type === G.blacksmithOutput(b))) {
    const local = type === 'firewood' ? G.fuelLimitOf(b) : G.toolLimitOf(b);
    const oldEffective = previous === null ? null : Math.min(previous, local);
    if (oldEffective !== G.effectiveProductionGoal(type, b)) delete b.productionPaused;
  }
  G.updateProductionGoals();
  if (!Object.keys(g.productionGoals).length) { delete g.productionGoals; delete g.productionPaused; }
  g.schedT = 0; // Normal scheduler, no task cancellation in the setting action.
  return true;
};
G.hasProductionGoal = function (b) {
  const types = G.productionOutputsOf(b);
  return types.some(type => G.productionGoalOf(type) !== null);
};
G.productionLimited = function (b) {
  if (b.state !== 'ok') return false; // Construction and manual clearing never stop.
  if (G.fuelLimited(b) || G.toolLimited(b)) return true;
  if (['gatherer', 'dock', 'hunting'].includes(b.type)) return G.goalPaused(b.type === 'gatherer' ? 'vegetables' : 'meat');
  if (b.type === 'tailor') return G.goalPaused(G.tailorOutput(b));
  if (b.type === 'farm') return G.goalPaused(G.farmOutput(b)) && !G.farmSeasonCommitted(b);
  if (b.type === 'forester') return G.goalPaused('wood') && !b.doPlant;
  if (b.type === 'stonequarry' || (b.type === 'mine' && G.mineModeOf(b) !== 'legacy')) {
    const type = b.type === 'stonequarry' ? 'stone' : G.mineModeOf(b);
    return G.goalPaused(type) || G.game.res[type] >= G.storageCap();
  }
  if (b.type === 'mine' && (G.productionGoalOf('stone') !== null || G.productionGoalOf('iron') !== null)) return (G.goalPaused('stone') || G.game.res.stone >= G.storageCap()) &&
    (G.goalPaused('iron') || G.game.res.iron >= G.storageCap());
  return false;
};
G.buildingGoalStatus = function (b) {
  if (b.state !== 'ok') return '';
  const types = G.productionOutputsOf(b);
  const configured = types.filter(type => G.productionGoalOf(type) !== null);
  if (!configured.length) return '';
  if (b.type === 'farm' && G.farmSeasonCommitted(b)) return '本季已开始：继续播完和收获，目标仅限制未开始的新一季';
  return configured.map(type => {
    const target = G.effectiveProductionGoal(type, b), local = ['woodcutter', 'blacksmith'].includes(b.type);
    const source = local ? `（全镇 ${G.productionGoalOf(type)} 与本屋 ${type === 'firewood' ? G.fuelLimitOf(b) : G.toolLimitOf(b)} 取较低值）` : '（全镇）';
    const state = G.goalPaused(type, b) ? (target === 0 ? '已关闭新生产' : `暂停新生产，库存≤${G.productionResumeAt(target)}恢复`)
      : !G.isTool(type) && G.game.res[type] >= G.storageCap() ? '硬仓容已满' : '可接新生产';
    return `${G.RES[type].name}目标 ${target}${source}：${state}${b.type === 'forester' && G.goalPaused(type) && b.doPlant ? '；仍可补种育林' : ''}`;
  }).join('；');
};
// Only configured automatic jobs gain completion protection. Never change the
// unset baseline, teachers, manual tasks, or construction scheduling here.
G.goalCommitment = function (c) {
  if (G.isArriving(c) || G.isLeisureVisitor(c)) return true;
  if ([c.task,c.pausedTask].some(t=>t&&t.kind==='brew'&&t.phase==='process') && c.carry?.brewIngredient) return true;
  if (c.task && c.task.kind === 'care') return true;
  const b = G.world.bmap[c.job];
  if (b && b.type === 'hospital' && !G.isSick(c) && G.world.citizens.some(G.isSick)) return true;
  if (!b || b.state !== 'ok') return false;
  const outputs = G.productionOutputsOf(b);
  // A player switching specialization must not make the old accepted batch
  // disposable to the scheduler merely because the new product is paused.
  if (['mine', 'blacksmith', 'tailor'].includes(b.type)) {
    const previousOutput = type => type && !outputs.includes(type);
    if (c.carry && previousOutput(c.carry.type)) return true;
    if ([c.task, c.pausedTask].some(t => t && t.b === b && t.yield && previousOutput(t.yield.type))) return true;
  }
  const paused = type => outputs.includes(type) && G.goalPaused(type, b);
  if (c.carry && paused(c.carry.type)) return true;
  return [c.task, c.pausedTask].some(task => {
    if (!task || task.b !== b) return false;
    const type = task.yield ? task.yield.type : ['sow','harvest'].includes(task.kind) ? G.CROPS[task.crop || G.farmCropOf(b)].output : ({ chop: 'wood', firewood: 'firewood' })[task.kind];
    return !!type && paused(type);
  });
};

/* 仓储上限：每座（建成的）仓库 +STORAGE_CAP，至少按 1 座计 */
G.storageCap = function () {
  const n = G.world.buildings.filter(b => b.type === 'storage' && b.state === 'ok').length;
  return G.STORAGE_CAP * Math.max(1, n);
};

/* Food categories share the existing total food capacity. The total stays a
 * compatibility summary for scheduling and old saves, never a fourth food. */
G.reconcileFood = function (game) {
  const g = game || G.game, r = g.res;
  for (const k of G.FOOD_KEYS) if (!Number.isFinite(r[k])) r[k] = 0;
  const sum = G.FOOD_KEYS.reduce((n,k) => n + r[k], 0), total = Math.max(0, Number(r.food) || 0);
  if (Math.abs(sum - total) > 1e-7) {
    if (total > sum) r.grain += total - sum; // legacy unclassified stock
    else if (sum > 0) for (const k of G.FOOD_KEYS) r[k] *= total / sum;
  }
  r.food = G.FOOD_KEYS.reduce((n,k) => n + r[k], 0);
};
G.consumeFood = function (qty) {
  G.reconcileFood(); const r = G.game.res, eaten = new Set(); let left = Math.min(qty, r.food);
  // Share a meal across available groups, then fill deficits from what remains.
  for (let pass = 0; pass < 3 && left > 1e-9; pass++) {
    const keys = G.FOOD_KEYS.filter(k => r[k] > 1e-9), portion = left / keys.length;
    for (const k of keys) { const take = Math.min(r[k], portion); r[k] -= take; left -= take; if (take > 0) eaten.add(k); }
  }
  r.food = G.FOOD_KEYS.reduce((n,k) => n + r[k], 0); return [...eaten];
};
G.depositCargo = function (cargo) {
  const accepted = G.deposit(cargo.type, cargo.qty, cargo.brewIngredient===true);
  if (cargo.extra) { for (const [type, qty] of Object.entries(cargo.extra)) G.deposit(type, qty); delete cargo.extra; }
  return accepted;
};
G.deposit = function (type, qty, retain=false) {
  const g = G.game;
  if (type === 'food') type = 'grain'; // old carried food retains its quantity
  if (G.FOOD_KEYS.includes(type)) G.reconcileFood();
  const stock = G.FOOD_KEYS.includes(type) ? g.res.food : g.res[type];
  const space = G.isTool(type) ? Infinity : Math.max(0, G.storageCap() - stock);
  const got = Math.min(qty, space); g.res[type] = (g.res[type] || 0) + got;
  if (G.FOOD_KEYS.includes(type)) g.res.food += got;
  if (got < qty && !retain && !['stone', 'iron', 'coal', 'ale', 'clothes', 'warmCoats'].includes(type) && !g.warned.storageFull) {
    g.warned.storageFull = true; G.ui.toast('⚠ 仓库满了，多出的资源只能丢弃——再建一座仓库吧', 'warn');
  }
  G.updateProductionGoals(); return got;
};

/* 背料到达仓库：转入回屋加工段。返回 false = 仓库没料（白跑） */
G.firewoodFetchDone = function (c, t) {
  if (G.taskIngredients(t).some(item=>G.game.res[item.type]<item.qty)) return false;
  const spot = G.workSpot(G.world, t.b, c.x, c.y);
  if (!spot) return false;
  t.phase = 'work';
  t.tx = spot.x; t.ty = spot.y;
  t.workLeft = t.work;
  c.task = t;   // completeTask 入口会清空任务，续段要挂回去
  c.state = 'idle';
  return G.sendTo(c, t.tx, t.ty, spot.route);
};

/* 受冻（原版双侧模型）：冬季户外累积寒冷，回到烧着柴的家里恢复；
 * 冷屋挡风但没柴火，屋内缓慢累积；露宿/无房者整夜在外照常累积。
 * 速率常量为「处于该状态每满 24 小时」的量，按实际小时数折算；非冬季持续回暖清零 */
G.coldStep = function (c, dtH) {
  if (!G.isWinter()) { c.cold = 0; return; }
  if (G.inMedicalCare(c)) { c.cold = Math.max(0, c.cold - dtH * G.LIFE.warmRecover / 24); return; }
  const childMul = c.age < G.ADULT_AGE ? G.LIFE.coldChildMul : 1;
  if (c.state === 'rest' && !c.camped) {
    const home = G.homeOf(c);
    if (home && home.state === 'ok') {
      if (!home.unheated) { c.cold = Math.max(0, c.cold - dtH * G.LIFE.warmRecover / 24); return; }
      c.cold += dtH * G.LIFE.coldIndoors / 24 * childMul; // 冷屋挡风但不取暖
      return;
    }
  }
  c.cold += dtH * G.LIFE.coldOutdoor / 24 * childMul * G.clothingColdMul(c);
};

/* Validate only the next segment after dispatch, including diagonal side
 * tiles. Failed detours retain the task/cargo and retry every two hours. */
G.pathStepBlocked = function (w, c, t) {
  if (G.tileBlocked(w, t.x, t.y)) return true;
  const dx = t.x - c.x, dy = t.y - c.y;
  if (Math.abs(dx) < 1e-8 || Math.abs(dy) < 1e-8) return false;
  const sx = Math.round(c.x), sy = Math.round(c.y);
  if (sx === t.x || sy === t.y) return false;
  return G.tileBlocked(w, t.x, sy) || G.tileBlocked(w, sx, t.y);
};
G.detourCitizen = function (c, dtH) {
  c.pathRetryH = Math.max(0, (c.pathRetryH || 0) - dtH);
  if (c.pathRetryH > 0) return;
  c.pathRetryH = 2;
  let goal = c.path[c.path.length - 1];
  if (G.tileBlocked(G.world, goal.x, goal.y)) {
    // An arbitrary nearestWalkable point is not a valid door/delivery target.
    if (c.state === 'haul' && c.carry) { G.startHaul(c); return; }
    if (c.walkKind === 'home') {
      const home = G.homeOf(c);
      if (!home) { c.path = null; c.state = 'rest'; c.camped = true; }
      else G.goHome(c);
      return;
    }
    const t = c.task;
    if (G.physicalTaskEndpoint(t)) { G.dropBlockedTask(c, t); return; }
    if (t) {
      const spot = G.alternateTaskEndpoint(c, t);
      if (!spot) { if (t.kind === 'care') G.cancelMedicalCare(c); else if(t.kind==='leisure')G.cancelLeisure(c); return; }
      goal = spot; t.tx = spot.x; t.ty = spot.y;
    } else if (c.walkKind === 'wander') { c.path = null; c.state = 'idle'; c.wanderT = 2; return; }
    else return;
  }
  const path = G.routeCanReuse(goal.route,c,goal.x,goal.y) ? goal.route.path : G.findPath(G.world, Math.round(c.x), Math.round(c.y), goal.x, goal.y);
  if (!path) {
    if (c.task && c.task.kind === 'care') { G.cancelMedicalCare(c); return; }
    if(G.isLeisureVisitor(c)){G.cancelLeisure(c);return;}
    if (c.state === 'haul' && G.isMineralCargo(c)) { c.haulPending = true; G.waitForMineralStorage(c, 'route'); }
    return;
  }
  if (path.length && G.pathStepBlocked(G.world, c, path[0])) return;
  c.path = path; c.pi = 0; c.pathRetryH = 0;
  if (!path.length) G.arrive(c);
};

/* 市民每帧步进 */
G.stepCitizen = function (c, dtH) {
  if (c.dead) return;
  G.coldStep(c, dtH);
  c.leisureRetryH=Math.max(0,(c.leisureRetryH||0)-dtH);
  if(G.isLeisureVisitor(c) && (!G.validLeisureTask(c) || G.isRestTime()))G.cancelLeisure(c);
  c.careRetryH = Math.max(0, (c.careRetryH || 0) - dtH);
  if (c.task && c.task.kind === 'care' && !G.validCareTask(c)) G.cancelMedicalCare(c);
  if (c.task && c.task.kind === 'care' && c.state === 'work') { G.stepMedicalCare(c, dtH); return; }
  if (c.state === 'rest') {
    if (!G.isRestTime()) {
      c.state = 'idle';
      if (!G.resumeTask(c)) c.wanderT = 0.5 + G.rng() * 2; // 天亮起床：先接着干昨晚的活
    }
    return;
  }
  // 深夜：回家睡觉（正在搬货的先送完这趟）
  if (G.isRestTime() && !(c.task && c.task.kind === 'care') && c.state !== 'haul' && !(c.state === 'walk' && c.walkKind === 'home')) {
    G.goHome(c);
    if (c.state === 'rest') return;
  }
  switch (c.state) {
    case 'waitStorage':
      c.wanderT -= dtH;
      if (c.wanderT <= 0) G.startHaul(c);
      return;
    case 'walk':
    case 'haul': {
      if (!c.path || c.pi >= c.path.length) { G.arrive(c); return; }
      let mv = G.moveSpeed(c) * dtH;
      while (mv > 0) {
        if (!c.path || c.pi >= c.path.length) break;
        const t = c.path[c.pi];
        if (G.pathStepBlocked(G.world, c, t)) { G.detourCitizen(c, dtH); return; }
        c.pathRetryH = 0;
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
      if(G.isLeisureVisitor(c)){G.stepLeisure(c,dtH);return;}
      if(c.task?.kind==='brew'&&c.task.phase==='process'&&(G.isSick(c)||!G.tavernBrewStatus(c.task.b,true).ok)){G.returnBrewGrain(c);return;}
      if (!c.task) { c.state = 'idle'; return; }
      if (c.task.b && c.task.b.state === 'site') c.task.b.constructionStarted = true;
      c.task.workLeft -= dtH * (1+G.happinessBonus(c)) / G.healthWorkMul(c);
      c.animT += dtH * 12;
      if (c.task.workLeft <= 0) G.completeTask(c);
      return;
    }
    default: { // idle
      c.wanderT -= dtH;
      if (c.wanderT <= 0) {
        c.wanderT = 2 + G.rng() * 5;
        if (G.isArriving(c) || c.age >= G.ADULT_AGE) G.requestTask(c); // 有岗位的接活；无业散工顺路处理「砍伐」标记
        else if (!G.tryMedicalCare(c)) G.wander(c);
      }
    }
  }
};

G.arrive = function (c) {
  c.path = null;
  if (c.state === 'haul') {
    if (G.isMineralCargo(c)) {
      const storage = G.world.bmap[c.haulTo];
      if (!storage || storage.state !== 'ok') G.startMineralHaul(c);
      else G.finishMineralHaul(c);
      return;
    }
    if (c.carry) {
      G.depositCargo(c.carry);
      c.carry = null;
    }
    G.requestTask(c);
  } else if (c.state === 'walk') {
    if (c.walkKind === 'task' && c.task) {
      if (c.task.kind === 'firewood' && c.task.phase === 'fetch') {
        // 到仓库只是背料，不加工：直接转入回屋加工段
        if (!G.firewoodFetchDone(c, c.task)) { c.task = null; c.state = 'idle'; c.wanderT = 2; }
        return;
      }
      c.state = 'work';
      if (!(c.task.workLeft > 0)) c.task.workLeft = c.task.work; // 续接的任务保留剩余工时
    } else if (c.walkKind === 'home') {
      c.state = 'rest';
    } else {
      c.state = 'idle';
      c.wanderT = 2 + G.rng() * 5;
    }
  }
};

/* ================= 任务系统 ================= */
/* 撤销一种玩家采集命令；不撤销护林/清场岗位，也不退工时或已产出的货。
 * 只中止任务路线，回家、休息、送仓保持原样；新派工仍走正常调度。 */
G.cancelResourceMarks = function (kind) {
  const result = { marks: 0, active: 0, paused: 0 }, w = G.world;
  if (!w || (kind !== 'trees' && kind !== 'rocks')) return result;
  const marks = kind === 'trees' ? w.marked : w.markedRocks;
  const taskKind = kind === 'trees' ? 'chop' : 'clearrock';
  if (marks) { result.marks = marks.size; marks.clear(); }
  const matches = t => t && !t.b && t.kind === taskKind;
  for (const c of w.citizens) {
    const task = c.task, paused = c.pausedTask;
    if (matches(task)) {
      c.task = null; result.active++;
      if (c.state === 'work' || (c.state === 'walk' && c.walkKind === 'task')) {
        c.path = null; c.pi = 0; c.walkKind = ''; c.state = 'idle'; c.wanderT = 0.5;
      }
    }
    if (matches(paused)) {
      c.pausedTask = null;
      if (paused !== task) result.paused++;
    }
  }
  if (result.marks || result.active || result.paused) w.markReachability = null;
  return result;
};

G.requestTask = function (c) {
  c.task = null;
  if (G.isArriving(c)) {if(G.isRestTime())G.goHome(c);else G.startImmigration(c);return;}
  if (!c.carry && G.tryMedicalCare(c)) return;
  if (G.isRestTime()) { G.goHome(c); return; } // 深夜不接受新任务
  if(!c.carry && G.tryLeisure(c))return;
  const w = G.world;
  const b = c.job != null ? w.bmap[c.job] : null;
  // 换岗/任务中断后先交货；农田未满批可继续收割，找不到下一格时也必须交货。
  const partialFarm = b && b.type === 'farm' && b.state === 'ok' && c.carry && c.carry.type === G.farmOutput(b) && !c.carry.brewIngredient && c.carry.qty < G.PROD.farm.haulCap;
  const partialForester = b && b.type === 'forester' && b.state === 'ok' && b.doCut && !G.goalPaused('wood') && c.carry && c.carry.type === 'wood' && c.carry.qty + G.taskYield(G.taskLogYield(c)) <= G.PROD.forester.haulCap;
  if (c.carry && !partialFarm && !partialForester) {
    G.startHaul(c); return;
  }
  if (!b) {
    // 无业散工：处理「砍伐」与「清除岩石」标记（原版 Harvest Trees 由劳动者执行）
    // 同一棵标记树只派一人（标记数量有限，不允许多人工复重叠）
    const claimed = new Set();
    for (const c2 of w.citizens) for (const t2 of [c2.task, c2.pausedTask])
      if (c2 !== c && t2 && (t2.kind === 'chop' || t2.kind === 'clearSite') && t2.tree) claimed.add(t2.tree.y * w.N + t2.tree.x);
    const mt = G.pickMarkedTree(w, c.x, c.y, claimed);
    if (mt) {
      c.task = { kind: 'chop', b: null, tx: mt.x, ty: mt.y, tree: mt.tree, logs: G.taskYield(G.taskLogYield(c)), work: G.taskWork(c, G.PROD.forester.workH), workLeft: 0 };
      G.sendTo(c, mt.x, mt.y);
      return;
    }
    // 再看「清除岩石」标记：石头/铁的来源，需劳动清除后入库
    const claimedR = new Set();
    for (const c2 of w.citizens) for (const t2 of [c2.task, c2.pausedTask])
      if (c2 !== c && t2 && t2.kind === 'clearrock') claimedR.add(t2.ty * w.N + t2.tx);
    const availableRocks = G.availableRockMarks(w);
    const mr = G.pickMarkedRock(availableRocks === w.markedRocks ? w : { ...w, markedRocks: availableRocks }, c.x, c.y, claimedR);
    if (mr) {
      c.task = { kind: 'clearrock', b: null, tx: mr.x, ty: mr.y, rock: mr.rock, work: G.taskWork(c, G.ROCK_WORK), workLeft: 0 };
      G.sendTo(c, mr.x, mr.y);
      return;
    }
    c.state = 'idle';
    G.wander(c); // 没有标记树则照常闲逛
    return;
  }
  if (b.state === 'site') {
    const trees = G.siteTrees(b);
    if (trees.length) {
      const claimed = new Set();
      for (const c2 of w.citizens) for (const t of [c2.task, c2.pausedTask])
        if (c2 !== c && t && (t.kind === 'clearSite' || t.kind === 'chop') && t.tree) claimed.add(t.tree);
      const targets = trees.filter(t => !claimed.has(t)).sort((a, z) => G.d2(c.x, c.y, a.x, a.y) - G.d2(c.x, c.y, z.x, z.y));
      for (const tree of targets) {
        // 农田可以走进树格；实体建筑在边缘施工，目标树仍以独立坐标记录。
        const spot = G.siteClearSpot(c, b, tree);
        // 实体工地所有树共用周边入口，无需重复做整图寻路。
        // 可穿行农田仍逐树判断，保留各目标的独立路径语义。
        if (!spot) { if (!G.BDEF[b.type].passable) break; else continue; }
        c.task = { kind: 'clearSite', b, tree, tx: spot.x, ty: spot.y,
          logs: G.taskYield(G.taskLogYield(c)), work: G.taskWork(c, G.PROD.forester.workH), workLeft: 0 };
        G.sendTo(c, spot.x, spot.y, spot.route); return;
      }
      c.state = 'idle'; c.wanderT = 2; return; // 其余树已有人砍，不能提前建造。
    }
    if (b.workLeft <= 0) { G.finishBuilding(b); c.state = 'idle'; return; }
    const spot = G.workSpot(w, b, c.x, c.y, true);
    if (!spot) { c.state = 'idle'; c.wanderT = 2; return; }
    c.task = {
      kind: 'build', b, tx: spot.x, ty: spot.y,
      work: Math.min(G.taskWork(c, G.PROD.builderChunk), b.workLeft),
      workLeft: 0, total: b.totalWork,
    };
    G.sendTo(c, spot.x, spot.y, spot.route);
    return;
  }
  const t = G.makeTask(b, c);
  if (partialForester && (!t || t.kind !== 'chop')) { G.startHaul(c); return; }
  if (t) {
    b.warnText = '';
    c.task = t;
    G.sendTo(c, t.tx, t.ty);
  } else if (c.carry) {
    G.startHaul(c); // 末格被同田工人认领时，把不满一批的尾货送仓
  } else {
    c.state = 'idle';
    c.wanderT = 4;
  }
};

/* 任务工时：受过教育的工人更快（原版教育产出加成，产出不变、耗时缩短） */
G.taskWork = function (c, hours) { return c.educated ? hours * G.LIFE.eduWorkMul : hours; };

/* 任务产出按工具状态折算：工具用尽时减产（原版工具是效率核心，约 2.5 年磨坏一件） */
G.taskYield = function (base) {
  const m = G.hasTools() ? 1 : G.NO_TOOL_MULT;
  return Math.max(1, Math.round(base * m));
};

/* 砍树原木数：未受教育 2、受教育 3（原版 Forester/散工的教育加成） */
G.taskLogYield = function (c) { return c.educated ? G.PROD.forester.eduLogsYield : G.TREE_LOGS; };

/* 产出时点按建筑累计（建筑详情「累计产出」行）：任务完成即计，与是否送达仓库无关；
 * 散工砍树/清石无建筑归属，不计入任何建筑 */
G.recordProduction = function (b, type, qty) {
  if (!b) return;
  if (!b.produced) b.produced = {};
  b.produced[type] = (b.produced[type] || 0) + qty;
};

/* 护林派单内按需扩张的四向连通扫描，与禁穿角 A* 可达性一致。
 * 找到当前候选即停；无路时最多遍历一次起点连通分量，后续候选复用结果。
 * 仅供本次 makeTask 使用，不跨任务缓存，建造、道路、水域、读档无需失效钩子。
 * 真正出发仍由 sendTo 使用道路加权 A*，不改变行走路径与搬运成本。 */
G.foresterReachability = function (w, c) {
  const sx = Math.round(c.x), sy = Math.round(c.y), N = w.N;
  let seen = null, queue = null, head = 0;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  return (x, y) => {
    if (G.tileBlocked(w, x, y)) {
      const alt = G.nearestWalkable(w, x, y, 4);
      if (!alt) return false;
      x = alt.x; y = alt.y;
    }
    if (!seen) {
      seen = new Uint8Array(N * N);
      queue = [sy * N + sx];
      seen[queue[0]] = 1; // 与 findPath 一样，允许从刚被建筑占据的起点走出。
    }
    const target = y * N + x;
    while (head < queue.length && !seen[target]) {
      const i = queue[head++], cx = i % N, cy = Math.floor(i / N);
      for (const [dx, dy] of directions) {
        const nx = cx + dx, ny = cy + dy, ni = ny * N + nx;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen[ni] || G.tileBlocked(w, nx, ny)) continue;
        seen[ni] = 1; queue.push(ni);
      }
    }
    return !!seen[target];
  };
};

// Preserve forest density/yield rules, but require an actual legal work tile.
G.foodForestCanWork = function (b) {
  const p = G.PROD[b.type];
  const trees = G.treesInRadius(G.world, b.x, b.y, p.radius, b.type === 'hunting');
  return trees.length >= p.needTrees && trees.some(t => !G.tileBlocked(G.world, t.x, t.y));
};

/* 按建筑类型生成任务 */
G.makeTask = function (b, c) {
  const P = G.PROD, g = G.game, w = G.world;
  if (b.state === 'ok' && G.productionLimited(b) && !['woodcutter', 'blacksmith', 'herbalist', 'mine', 'stonequarry'].includes(b.type)) {
    b.warnText = G.buildingGoalStatus(b); return null;
  }
  switch (b.type) {
    case 'herbalist': return G.makeHerbalistTask(b, c);
    case 'hospital': return G.makeClinicTask(b, c);
    case 'tavern': return G.makeTavernTask(b,c);
    case 'woodcutter': {
      if (G.fuelLimited(b)) { // 燃料上限：库存够用时自动停工（原版 Fuel Limit）
        b.noWork = true; b.warnText = '柴火已达上限';
        return null;
      }
      if (g.res.wood >= P.woodcutter.logsIn) {
        // Plan only the current leg. The return workshop route is chosen from
        // the warehouse at fetchDone, against the then-current map.
        const st = G.nearestStorage(c.x, c.y);
        const route = st ? G.storageRoute(c.x, c.y) : null;
        if (st && !route) { b.noWork = true; b.warnText = '仓库不可达'; return null; }
        const target = route ? route.spot : G.workSpot(w, b, c.x, c.y);
        if (!target) { b.noWork = true; b.warnText = '工作入口不可达'; return null; }
        return G.withTaskRoute({
          kind: 'firewood', b, tx: target.x, ty: target.y, phase: st ? 'fetch' : 'work',
          work: P.woodcutter.workH, workLeft: 0,
          consume: { type: 'wood', qty: P.woodcutter.logsIn },
          // 原版：受教育工人 1 原木出 4 柴火（配比加成，而非提速）
          yield: { type: 'firewood', qty: G.taskYield(c.educated ? P.woodcutter.logsIn * P.woodcutter.eduFirewoodPerLog : P.woodcutter.firewoodOut) },
        }, target.route);
      }
      b.noWork = true; b.warnText = '缺木材';
      return null;
    }
    case 'forester': {
      const R = P.forester.radius;
      const reachable = G.foresterReachability(w, c);
      let waitingForClaim = false;
      // 砍倒即原地补种（原版护林人的可持续轮伐）：砍+种合并为一个任务，
      // 在作业范围内就近连续采伐；无成熟树时才单独补种育林
      const plantTask = () => {
        // 同屋工人在种的坑不再重复认领（防止多人挤同一个点白跑）
        const claimed = new Set();
        for (const c2 of w.citizens) for (const task of [c2.task, c2.pausedTask])
          if (c2 !== c && task && task.kind === 'plant') claimed.add(task.ty * w.N + task.tx);
        const spot = G.nearestPlantSpot(w, b.x, b.y, R, claimed, reachable);
        if (!spot && claimed.size && G.nearestPlantSpot(w, b.x, b.y, R, null, reachable)) waitingForClaim = true;
        return spot ? { kind: 'plant', b, tx: spot.x, ty: spot.y, work: G.taskWork(c, P.forester.plantH), workLeft: 0 } : null;
      };
      if (b.doCut && !G.goalPaused('wood')) { // 砍伐成熟树（面板可开关，原版 Forester 的 Cut 选项）
        const trees = G.treesInRadius(w, b.x, b.y, R, true).filter(t => w.bgrid[t.i] < 0);
        // 成熟树存量低于下限就停砍育林：防止清穿森林（也会拖垮同址采集小屋），等补种长回来
        if (trees.length > P.forester.minMature) {
          // 已被其他工人认领的树不再重复认领，包括夜间暂停的任务
          const claimed = new Set();
          for (const c2 of w.citizens) for (const task of [c2.task, c2.pausedTask])
            if (c2 !== c && task && ['chop', 'clearSite'].includes(task.kind) && task.tree) claimed.add(task.tree.i);
          const ranked = [];
          for (const t of trees) {
            if (claimed.has(t.i)) continue;
            const d = G.d2(c.x, c.y, t.x, t.y) + G.rng() * 8;
            ranked.push({ tree: t, d });
          }
          if (!ranked.length && claimed.size) waitingForClaim = true;
          ranked.sort((a, z) => a.d - z.d);
          const best = ranked.find(t => reachable(t.tree.x, t.tree.y))?.tree;
          if (best) return {
            kind: 'chop', b, tx: best.x, ty: best.y, tree: best, logs: G.taskYield(G.taskLogYield(c)),
            // 砍+原地补种合并（补种耗时会加进工时；关补种则只砍不种，森林会被清光）
            replant: b.doPlant,
            work: G.taskWork(c, (P.forester.cutWorkH || P.forester.workH) + (b.doPlant ? P.forester.plantH : 0)), workLeft: 0,
          };
        }
      }
      if (b.doPlant) { // 补种（原版 Plant 选项；无成熟树可砍时育林）
        const t = plantTask();
        if (t) return t;
      }
      if (waitingForClaim) { b.noWork = false; b.warnText = '等待其他工人完成已认领的林业任务'; return null; }
      b.noWork = true;
      b.warnText = !b.doCut && !b.doPlant ? '已停用（砍伐/补种均关）'
        : (b.doCut ? '附近成熟树不足' : '无处可补种');
      return null;
    }
    case 'gatherer': {
      const R = P.gatherer.radius;
      const trees = G.treesInRadius(w, b.x, b.y, R, false);
      if (trees.length < P.gatherer.needTrees) {
        b.noWork = true; b.warnText = '附近没有森林';
        return null;
      }
      // 产出随森林成熟度浮动：成熟树越多采集越丰（护林砍穿森林会砸了采集小屋的饭碗）
      const mature = trees.reduce((s, t2) => s + (G.treeStage(t2) >= 2 ? 1 : 0), 0);
      const qty = G.taskYield(Math.max(1, Math.round(P.gatherer.yield.qty * (0.4 + 0.6 * Math.min(1, mature / P.gatherer.fullForest)))));
      const targets = trees.filter(t => !G.tileBlocked(w, t.x, t.y));
      if (!targets.length) { b.noWork = true; b.warnText = '森林目标被工地覆盖，需先清场'; return null; }
      const t = targets[G.ri(0, targets.length - 1)];
      return {
        kind: 'work', b, tx: t.x, ty: t.y,
        work: G.taskWork(c, P.gatherer.workH), workLeft: 0, yield: { type: P.gatherer.yield.type, qty },
      };
    }
    case 'dock': {
      const spot = G.workSpot(w, b, c.x, c.y);
      if (!spot) return null;
      // 渔获随水域大小浮动：一片小水洼撑不起满产
      const waterN = G.countWaterInRadius(w, b.x, b.y, P.dock.waterR);
      const qty = G.taskYield(Math.max(1, Math.round(P.dock.yield.qty * (0.5 + 0.5 * Math.min(1, waterN / P.dock.fullWater)))));
      return G.withTaskRoute({
        kind: 'work', b, tx: spot.x, ty: spot.y,
        work: G.taskWork(c, P.dock.workH), workLeft: 0, yield: { type: P.dock.yield.type, qty },
      }, spot.route);
    }
    case 'mine':
    case 'stonequarry': return G.makeMineralTask(b, c);
    case 'tradingpost': return G.makeTradeTask(b,c);
    case 'pasture': {
      G.ensureEconomyBuilding(b);
      if (!b.animals) { b.noWork=true; b.warnText='需购买羊并移入牧场'; return null; }
      const spot=G.workSpot(w,b,c.x,c.y); if(!spot)return null;
      return G.withTaskRoute({kind:'work',b,tx:spot.x,ty:spot.y,work:G.taskWork(c,8),workLeft:0,economy:'pasture'},spot.route);
    }
    case 'orchard': {
      G.ensureEconomyBuilding(b);
      if (!g.unlocks.orchard) {b.noWork=true;b.warnText='需贸易购买果树种子';return null;}
      if (b.orchardAge < G.YEAR_DAYS*4 && b.tendedDay===g.day) { b.noWork=true; b.warnText='今日照料完成，等待果树长成'; return null; }
      if (b.orchardAge >= G.YEAR_DAYS*4 && (!b.orchardYield || g.season!==2)) { b.noWork=true; b.warnText='等待秋季果实'; return null; }
      if (G.goalPaused('vegetables') && b.orchardAge>=G.YEAR_DAYS*4) return null;
      const spot=G.workSpot(w,b,c.x,c.y);if(!spot)return null;
      return G.withTaskRoute({kind:'work',b,tx:spot.x,ty:spot.y,work:G.taskWork(c,6),workLeft:0,economy:'orchard'},spot.route);
    }
    case 'tailor': {
      const status=G.tailorProductionStatus(b);
      if(!status.ok){b.noWork=true;b.warnText=status.reason;return null;}
      const route=G.storageRoute(c.x,c.y);
      if(!route){b.noWork=true;b.warnText='取料仓库不可达';return null;}
      // Snapshot ingredients and output now. Selection changes never rewrite
      // an accepted batch; the established tailor contract charges at completion.
      return G.withTaskRoute({kind:'firewood',b,tx:route.spot.x,ty:route.spot.y,phase:'fetch',
        work:G.taskWork(c,8),workLeft:0,consume:status.materials.map(item=>({...item})),
        yield:{type:G.tailorOutput(b),qty:c.educated?2:1}},route.spot.route);
    }
    case 'blacksmith': {
      if (G.toolLimited(b)) { b.noWork = true; b.warnText = '工具已达上限'; return null; }
      const spot = G.workSpot(w, b, c.x, c.y);
      if (!spot) return null;
      const cons = G.blacksmithRecipe(b);
      if (cons.some(c2 => g.res[c2.type] < c2.qty)) {
        b.noWork = true; b.warnText = G.blacksmithOutput(b) === 'steelTools' ? '缺铁、木材或煤' : '缺铁或木材';
        return null;
      }
      // 1铁+2木 → 2 件工具（受教育 3）；铁匠抡锤不用工具，不吃减产
      return G.withTaskRoute({
        kind: 'work', b, tx: spot.x, ty: spot.y,
        work: G.taskWork(c, P.blacksmith.workH), workLeft: 0,
        consume: cons,
        yield: { type: G.blacksmithOutput(b), qty: c.educated ? P.blacksmith.eduToolsOut : P.blacksmith.toolsOut },
      }, spot.route);
    }
    case 'hunting': {
      const R = P.hunting.radius;
      // 狩猎依赖成熟林（鹿群栖息地）：成熟树不足不开工，产出随林况浮动——与采集互补的食物来源
      const trees = G.treesInRadius(w, b.x, b.y, R, true);
      if (trees.length < P.hunting.needTrees) {
        b.noWork = true; b.warnText = '附近成熟林太少，猎物绝迹';
        return null;
      }
      const mature = trees.reduce((s, t2) => s + (G.treeStage(t2) >= 2 ? 1 : 0), 0);
      const qty = G.taskYield(Math.max(1, Math.round(P.hunting.yield * (0.4 + 0.6 * Math.min(1, mature / P.hunting.fullForest)))));
      // 走最近的猎场（小抖动分散站位）：随机选树会把猎人的工作日耗在路上
      let best = null, bd = Infinity;
      for (const t2 of trees) {
        if (G.tileBlocked(w, t2.x, t2.y)) continue;
        const d = G.d2(b.x, b.y, t2.x, t2.y) + G.rng() * 8;
        if (d < bd) { bd = d; best = t2; }
      }
      if (!best) { b.noWork = true; b.warnText = '猎场目标被工地覆盖，需先清场'; return null; }
      return {
        kind: 'work', b, tx: best.x, ty: best.y,
        work: G.taskWork(c, P.hunting.workH), workLeft: 0, yield: { type: 'meat', qty },
        extra: G.goalPaused('leather') ? null : { leather: c.educated ? 2 : 1 },
      };
    }
    case 'farm': {
      if (b.state !== 'ok') return null;
      const P2 = P.farm;
      // 同田工人在种/收的格子不再重复认领：四人挤一格会把播种拖成十天，
      // 成熟期随 sownAll 顺延，秋收窗口不够就只能看着作物冻死
      const claimed = new Set();
      for (const c2 of w.citizens) for (const t2 of [c2.task, c2.pausedTask])
        if (c2 !== c && t2 && t2.b === b && c2.job === b.id && (t2.kind === 'sow' || t2.kind === 'harvest'))
          claimed.add(t2.ti);
      // 播种（春）
      if (!b.sownAll && (g.season === 0 || g.season === 1) && (!G.goalPaused(G.farmOutput(b)) || G.farmSeasonCommitted(b))) {
        const ti = b.farm.findIndex((f, i) => !f.sown && !claimed.has(i));
        if (ti >= 0) {
          const f = b.farm[ti];
          b.sowingCommitted = true; // First accepted sow locks this season's crop, even before arrival.
          return { kind: 'sow', b, ti, crop:G.farmCropOf(b), cropYear:g.year, tx: f.x, ty: f.y, work: G.taskWork(c, P2.tileWorkH), workLeft: 0 };
        }
      }
      // 收获（秋，作物长成）
      if (b.sownAll && b.growth >= 1 && g.season === 2 && !b.harvestDone) {
        const ti = b.farm.findIndex((f, i) => f.sown && !f.harvested && !claimed.has(i));
        if (ti >= 0) {
          const f = b.farm[ti];
          return { kind: 'harvest', b, ti, crop:G.farmCropOf(b), cropYear:g.year, tx: f.x, ty: f.y, work: G.taskWork(c, P2.tileWorkH), workLeft: 0 };
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
    case 'arrival': {
      if(b && G.world.bmap[b.id]===b && b.state==='ok' && G.d2(c.x,c.y,t.tx,t.ty)<.04 && !G.tileBlocked(G.world,t.tx,t.ty)){c.arrivalHallId=null;c.pausedTask=null;G.game.schedT=0;if(!c.adult){c.state='idle';c.wanderT=1;return;}}
      else {G.startImmigration(c);return;}
      break;
    }
    case 'clinic':
    case 'host': break;
    case 'brew': G.completeBrew(c,t);return;
    case 'build': {
      if (b && b.state === 'site') {
        b.workLeft -= t.work;
        b.progress = G.clamp(1 - b.workLeft / b.totalWork, 0, 1);
        if (b.workLeft <= 0) G.finishBuilding(b);
      }
      break;
    }
    case 'clearSite': {
      const w = G.world, idx = w.treeIdx[t.tree.y * w.N + t.tree.x];
      if (b && w.bmap[b.id] === b && b.state === 'site' && idx >= 0 && w.trees[idx] === t.tree) {
        G.removeTree(w, t.tree.x, t.tree.y);
        c.carry = { type: 'wood', qty: t.logs || G.TREE_LOGS };
        G.recordProduction(b, 'wood', c.carry.qty);
      }
      break;
    }
    case 'chop': {
      const treeIndex = G.world.treeIdx[t.ty * G.world.N + t.tx];
      const treeOk = treeIndex >= 0 && G.world.trees[treeIndex] === t.tree;
      const jobOk = !t.b || G.world.bmap[t.b.id] === t.b; // b 为空 = 散工砍标记树
      if (treeOk && jobOk) {
        G.removeTree(G.world, t.tx, t.ty);
        const logs = t.logs || G.TREE_LOGS;
        if (t.b && t.b.type === 'forester' && c.carry && c.carry.type === 'wood') c.carry.qty += logs;
        else c.carry = { type: 'wood', qty: logs };
        G.recordProduction(t.b, 'wood', t.logs || G.TREE_LOGS);
        if (t.replant && t.b && t.b.doPlant) G.addTree(G.world, t.tx, t.ty); // 砍倒即原地补种
      }
      if (treeOk && jobOk && t.b && t.b.type === 'forester' && c.carry && c.carry.qty < G.PROD.forester.haulCap) { G.requestTask(c); return; }
      break;
    }
    case 'plant': {
      G.addTree(G.world, t.tx, t.ty);
      break;
    }
    case 'clearrock': {
      const i = t.ty * G.world.N + t.tx;
      if (G.world.rock[i] === t.rock) {
        G.clearRock(G.world, t.tx, t.ty);
        c.carry = { type: t.rock === 2 ? 'iron' : 'stone', qty: G.taskYield(t.rock === 2 ? G.ROCK_IRON : G.ROCK_STONE) };
      }
      break;
    }
    case 'trade': { G.completeTradeTask(c,t); return; }
    case 'work': {
      if (t.economy) { G.completeEconomyWork(c,t); break; }
      if (t.consume) {
        const cons = Array.isArray(t.consume) ? t.consume : [t.consume];
        if (cons.some(c2 => G.game.res[c2.type] < c2.qty)) break; // 材料在干活的这几个小时里被同行用掉，本次白干
        for (const c2 of cons) G.game.res[c2.type] -= c2.qty;
      }
      if (t.yield) { c.carry = { type: t.yield.type, qty: t.yield.qty };
        if (t.extra) c.carry.extra = { ...t.extra };
      }
      break;
    }
    case 'firewood': {
      if (t.phase === 'fetch') {
        // 到仓库背料：有料转入加工段（木料在完工时才扣）；没料则白跑一趟
        if (!G.firewoodFetchDone(c, t)) break;
        return;
      }
      if(b?.type==='tailor'&&(G.world.bmap[b.id]!==b||b.state!=='ok'||c.job!==b.id||!G.atMedicalDoor(c,b)||G.d2(c.x,c.y,t.tx,t.ty)>.04))break;
      const ingredients=G.taskIngredients(t);
      if(ingredients.some(item=>G.game.res[item.type]<item.qty))break; // all-or-nothing, no partial wool/leather charge
      for(const item of ingredients)G.withdrawResource(item.type,item.qty);
      c.carry = { type: t.yield.type, qty: t.yield.qty };
      if(b?.type==='tailor')G.recordProduction(b,t.yield.type,t.yield.qty);
      break;
    }
    case 'sow': {
      if (G.farmTaskCurrent(t) && !b.farm[t.ti].sown) {
        b.farm[t.ti].sown = true;
        if (b.farm.every(f => f.sown)) b.sownAll = true;
      }
      break;
    }
    case 'harvest': {
      if (G.farmTaskCurrent(t) && b.farm[t.ti].sown && !b.farm[t.ti].harvested && (!c.carry || (c.carry.type===G.farmOutput(b) && !c.carry.brewIngredient))) {
        t.b.farm[t.ti].harvested = true;
        // 攒批搬运：收获累计到 haulCap 才送一趟仓库
        const P = G.PROD.farm;
        const output=G.CROPS[t.crop || G.farmCropOf(b)].output,qty=G.taskYield(P.perTile);
        if (c.carry) c.carry.qty += qty;
        else c.carry = { type: output, qty };
        G.recordProduction(b,output,qty);
        if (b.farm.every(f => f.harvested)) b.harvestDone = true;
        // 还没背满且田里没收完：继续收下一格
        if (c.carry.qty < P.haulCap && !b.harvestDone) { G.requestTask(c); return; }
      }
      break;
    }
  }
  if (c.carry) G.startHaul(c);
  else G.requestTask(c);
};

G.resetFarm = function (b, applyChoice = G.game.season === 0) {
  if(applyChoice)b.cropType=G.cropChoiceOf(b);
  for (const f of b.farm) { f.sown = false; f.harvested = false; }
  b.sownAll = false; b.growth = 0; b.harvestDone = false; delete b.sowingCommitted;
  // A commitment belongs to this crop season, not next year's empty field.
  // Expire every old season's crop task, including paused tasks; keep actual cargo.
  for (const c of G.world.citizens) {
    const expired = t => t && t.b === b && (t.kind === 'sow' || t.kind === 'harvest');
    if (expired(c.task)) {
      c.task = null;
      if (c.state === 'work' || (c.state === 'walk' && c.walkKind === 'task')) {
        c.path = null; c.pi = 0; c.walkKind = ''; c.state = 'idle'; c.wanderT = 0.5;
      }
    }
    if (expired(c.pausedTask)) c.pausedTask = null;
  }
};

/* ================= 职业调度 ================= */
G.releaseWorker = function (c) {
  const w = G.world;
  if (c.job != null) {
    const b = w.bmap[c.job];
    if (b) b.workers = b.workers.filter(id => id !== c.id);
  }
  c.job = null; c.task = null; c.pausedTask = null;
  if (c.carry) { G.startHaul(c); return; } // 手上的货先送仓，不烂在身上
  c.state = 'idle'; c.wanderT = 0.5;
};

G.assignWorker = function (b, c) {
  if(G.isArriving(c))return;
  if(b.type==='tavern'&&b.state==='ok'&&(c.age<18||G.isSick(c)))return;
  if (b.type === 'hospital' && b.state === 'ok' && G.isSick(c)) return;
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

/* 找一所还有空位的在办学堂（有教师才开学） */
G.pickSchool = function (counts) {
  const w = G.world;
  for (const b of w.buildings)
    if (b.type === 'school' && b.state === 'ok' && b.workers.length > 0 && (counts[b.id] || 0) < G.LIFE.schoolCap) return b;
  return null;
};

/* 「砍伐/清石」标记的抽人对象：越闲的岗位越先出人（常规岗位保持至少 1 人留守）。
 * 顺序：超员 → 柴满伐木屋（燃料上限停产，纯闲）→ 石铁双满的矿井 → 非收获季农田 →
 * 人手最多的非粮食岗 → 粮食富余岗（人数 > 按人口测算的需求） */
G.pickMarkDonor = function (w, harvestSeason, foodJobs, needFood) {
  const staffed = w.buildings.filter(b => b.state === 'ok' && G.BDEF[b.type].jobs > 0 && b.workers.length > 0);
  const adultsOf = (b) => b.workers.map(id => w.cmap[id]).filter(c => c && !c.dead && c.adult && !G.goalCommitment(c) && !G.mineralDeliveryBlocked(c));
  for (const b of staffed) {
    const xs = adultsOf(b);
    if (xs.length > G.BDEF[b.type].jobs) return xs[0]; // 超员
  }
  for (const b of staffed)
    if (G.productionLimited(b)) { const c = adultsOf(b)[0]; if (c) return c; }
  for (const b of staffed)
    if (['mine', 'stonequarry'].includes(b.type) && !G.jobCanProduce(b)) { const c = adultsOf(b)[0]; if (c) return c; }
  if (!harvestSeason)
    for (const b of staffed)
      if (b.type === 'farm' && b.sownAll) { const c = adultsOf(b)[0]; if (c) return c; } // 已播完种的农田；播种进行中不抽（否则秋收窗口顺延）
  let best = null, bestN = 1;
  for (const b of staffed) {
    if (b.type === 'school' || foodJobs.includes(b.type)) continue;
    const n = adultsOf(b).length;
    if (n > bestN) { bestN = n; best = b; }
  }
  if (best) return adultsOf(best)[0];
  const foodStaff = staffed.filter(b => foodJobs.includes(b.type));
  const totalFood = foodStaff.reduce((n, b) => n + adultsOf(b).length, 0);
  if (totalFood <= needFood) return null;
  const fb = foodStaff.sort((a, b) => adultsOf(b).length - adultsOf(a).length)[0];
  return fb ? adultsOf(fb)[0] : null;
};

G.farmHasWork = function (b) {
  const season = G.game.season;
  return (!b.sownAll && (season === 0 || season === 1) && (!G.goalPaused(G.farmOutput(b)) || G.farmSeasonCommitted(b))) ||
    (b.sownAll && b.growth >= 1 && season === 2 && !b.harvestDone);
};

/* 纯读的派工前置检查，避免为缺料/停用岗位取消正在干活的粮工。 */
G.jobCanProduce = function (b) {
  const w = G.world, r = G.game.res, p = G.PROD;
  if (b.type === 'hospital') return G.world.citizens.some(G.isSick);
  if(b.type==='tavern')return G.tavernBrewStatus(b).ok || G.game.res.ale>0;
  if (b.type === 'herbalist') return true; // A staffed hut also provides preventive care when gathering pauses.
  if (G.productionLimited(b)) return false;
  if (b.type === 'farm') return G.farmHasWork(b);
  if (b.type === 'woodcutter') return r.wood >= p.woodcutter.logsIn;
  if (b.type === 'tradingpost') return G.tradeHasWork(b);
  if (b.type === 'pasture') return (b.animals || 0)>0;
  if (b.type === 'orchard') return G.game.unlocks.orchard && ((b.orchardAge || 0)<G.YEAR_DAYS*4 ? b.tendedDay!==G.game.day : (b.orchardYield || 0)>0 && G.game.season===2);
  if (b.type === 'tailor') return G.tailorProductionStatus(b).ok;
  if (b.type === 'blacksmith') return G.blacksmithRecipe(b).every(c => r[c.type] >= c.qty);
  if (b.type === 'forester') return (b.doCut && !G.goalPaused('wood') && G.treesInRadius(w, b.x, b.y, p.forester.radius, true).length > p.forester.minMature) ||
    (b.doPlant && !!G.nearestPlantSpot(w, b.x, b.y, p.forester.radius));
  if (b.type === 'gatherer' || b.type === 'hunting') return G.foodForestCanWork(b);
  if (['mine', 'stonequarry'].includes(b.type)) return G.productionOutputsOf(b).some(type => !G.goalPaused(type) && r[type] < G.storageCap());
  return true;
};

G.scheduleJobs = function () {
  const w = G.world;
  G.updateProductionGoals();
  // A held mineral batch is not a free pair of hands. Free only an empty job
  // slot; releaseWorker preserves cargo and retries the same bounded delivery.
  for (const c of w.citizens) if (!c.dead && c.job != null && !c.task && !c.pausedTask && G.mineralDeliveryBlocked(c)) G.releaseWorker(c);
  for (const b of w.buildings) {
    // 在重新探测岗位前先释放确实没活的闲人；旧逻辑每2h清旗，导致每日释放永远看不到它。
    if (b.noWork || (G.hasProductionGoal(b) && G.productionLimited(b))) for (const id of b.workers.slice()) {
      const c = w.cmap[id];
      if (c && !c.task && !c.pausedTask && !G.goalCommitment(c) && c.state !== 'haul') G.releaseWorker(c);
    }
    b.noWork = false;
    if (b.type === 'farm' && b.state === 'ok' && !G.farmHasWork(b))
      for (const id of b.workers.slice()) { const c = w.cmap[id]; if (c && !G.goalCommitment(c)) G.releaseWorker(c); }
  }
  const jobless = () => w.citizens.filter(c => !c.dead && c.adult && c.job == null && !G.goalCommitment(c) && !G.mineralDeliveryBlocked(c));
  // 「砍伐」/「清除岩石」标记需要散工处理：预留 1-2 名无业成人（不够则稍后从闲余岗位抽调）
  const availableRocks = G.availableRockMarks(w);
  w.markReachability = Object.assign(G.reachableMarks(availableRocks === w.markedRocks ? w : { ...w, markedRocks: availableRocks }), { day: G.game.day, h: G.game.h,
    storageBlocked: (w.markedRocks ? w.markedRocks.size : 0) - (availableRocks ? availableRocks.size : 0),
    total: (w.marked ? w.marked.size : 0) + (w.markedRocks ? w.markedRocks.size : 0) });
  const markCount = w.markReachability.count;
  const wantLabor = markCount > 0 ? Math.min(2, Math.ceil(markCount / 2)) : 0;

  const harvestSeason = G.game.season === 2;
  const FOOD_JOBS = harvestSeason ? ['gatherer', 'dock', 'hunting', 'farm'] : ['gatherer', 'dock', 'hunting'];
  const dailyFood = w.citizens.filter(x => !x.dead).length * G.LIFE.eatPerDay;
  const foodDays = dailyFood ? G.game.res.food / dailyFood : Infinity;
  const foodLow = Math.min(dailyFood * 8, G.storageCap() * 0.5);
  const foodRecovered = Math.min(dailyFood * 12, G.storageCap() * 0.8);
  if (G.game.res.food < foodLow) G.game.foodUrgent = true;
  else if (G.game.res.food > foodRecovered) G.game.foodUrgent = false; // 滞回，避免在阈值附近反复打断工地
  const needFood = Math.ceil(dailyFood / (G.game.foodUrgent ? 4 : 8));
  const forestEligibility = new Map();
  const hasForestWork = b => {
    if (!['gatherer', 'hunting'].includes(b.type)) return true;
    if (!forestEligibility.has(b.id)) forestEligibility.set(b.id, G.foodForestCanWork(b));
    return forestEligibility.get(b.id);
  };
  const isFood = b => b && hasForestWork(b) && b.state === 'ok' && !G.productionLimited(b) && FOOD_JOBS.includes(b.type) && (b.type !== 'farm' || G.farmHasWork(b));
  const foodCount = () => w.citizens.filter(c => c.adult && !c.dead && isFood(w.bmap[c.job])).length;
  if (G.game.foodUrgent) {
    // 已占满的工地也必须能回补粮岗；只保护尚可工作的食物建筑，不空留人。
    const foodBuildings = w.buildings.filter(isFood);
    for (const b of foodBuildings) {
      let guard = 0;
      while (b.workers.length < G.BDEF[b.type].jobs && foodCount() < needFood && guard++ < 4) {
        const free = jobless();
        let c = free.length > wantLabor ? G.pickNearest(free, b) : null;
        if (!c) {
          const donors = w.citizens.filter(c2 => {
            const job = w.bmap[c2.job];
            if (!c2.adult || c2.dead || G.goalCommitment(c2) || !job || isFood(job) || job.type === 'school') return false;
            if (job.type === 'farm' && !job.sownAll && job.workers.length <= 1) return false;
            return job.type !== 'woodcutter' || job.state === 'site' || job.workers.length > 1;
          }).sort((a, z) => (w.bmap[a.job].state === 'site' ? 0 : 1) - (w.bmap[z.job].state === 'site' ? 0 : 1));
          c = donors[0];
          if (!c) break;
          G.releaseWorker(c);
        }
        G.assignWorker(b, c);
        if (c.job !== b.id) break;
      }
    }
  }
  // 落实标记散工预留：本作劳动岗位自动调度、玩家无法像原版那样手动保留劳动者，
  // 无业者不足额时由调度器从「闲余岗位」释放工人（优先级见 pickMarkDonor）；
  // 释放者保持无业状态承接标记，标记清完后会被正常岗位重新雇佣
  if (wantLabor) {
    while (jobless().length < wantLabor) {
      const donor = G.pickMarkDonor(w, harvestSeason, FOOD_JOBS, needFood);
      if (!donor) break;
      G.releaseWorker(donor);
    }
  }

  // 第一优先：建筑工地（人手不足时抽调：先抽非粮食岗位；
  // 粮食岗位仅在有富余时抽调 —— 保留约 pop/4 的粮食劳动力。
  // 注意：非收获季的农田没有产出，其工人视为普通劳动力可被抽调）
  for (const b of w.buildings) {
    if (b.state !== 'site') continue;
    let guard = 0;
    while (b.workers.length < 4 && guard++ < 8) {
      // 有标记待处理时给「砍伐/清石」保留 wantLabor 名无业散工——不够额就改抽在岗者（否则扩张期清石永远停摆）
      const free = jobless();
      let c = free.length > wantLabor ? G.pickNearest(free, b) : null;
      if (!c) {
        const busyAll = w.citizens.filter(ci => {
          if (ci.dead || !ci.adult || ci.job == null || G.goalCommitment(ci)) return false;
          const jb = w.bmap[ci.job];
          return jb && jb.state === 'ok' && G.BDEF[jb.type].jobs > 0 && jb.type !== 'school'
            && !(jb.type === 'farm' && !jb.sownAll && (G.game.season === 0 || G.game.season === 1) && jb.workers.length <= 1); // 教师不抽调
        });
        let pool = busyAll.filter(ci => !FOOD_JOBS.includes(w.bmap[ci.job].type));
        if (!pool.length) {
          // 粮食劳动力富余量：按人口测算所需粮食工人
          const foodWorkers = busyAll.filter(ci => FOOD_JOBS.includes(w.bmap[ci.job].type));
          if (foodWorkers.length > needFood) pool = foodWorkers;
        }
        c = G.pickNearest(pool, b);
        if (!c) break;
        G.releaseWorker(c);
      }
      G.assignWorker(b, c);
    }
  }

  // 第二优先：普通工作岗位（不侵占标记散工预留；柴火到上限的伐木屋不拉人）
  for (const b of w.buildings) {
    if (b.state !== 'ok') continue;
    const def = G.BDEF[b.type];
    if (!def.jobs || !G.jobCanProduce(b)) continue;
    if (b.type !== 'herbalist' && G.productionLimited(b)) continue; // 柴火/工具达到上限的岗位不拉人，空闲者留给「砍伐」标记
    let guard = 0;
    while (b.workers.length < def.jobs && guard++ < 6) {
      const pool = jobless().filter(c => (b.type !== 'hospital' || !G.isSick(c)) && (b.type!=='tavern'||(c.age>=18&&!G.isSick(c))));
      if (wantLabor && pool.length <= wantLabor) break;
      const c = G.pickNearest(pool, b);
      if (!c) break;
      G.assignWorker(b, c);
    }
  }

  // 第三步：劳动力再平衡（每个调度周期最多调整一人，避免抖动）
  // 优先级：伐木屋（柴火=过冬命脉）> 其他；供体依次为：
  //   非收获季农田 → 全员闲置岗位 → 木材富余时的护林屋 → 秋收季从林业抽人抢收
  const FOOD_SET = ['gatherer', 'dock', 'hunting', 'farm'];
  const foodWorkerCount = () => w.buildings.filter(x => x.state === 'ok' && FOOD_JOBS.includes(x.type)).reduce((n, x) => n + x.workers.length, 0);
  const targets = w.buildings
    .filter(b => b.state === 'ok' && G.BDEF[b.type].jobs > 0 && b.workers.length < G.BDEF[b.type].jobs && !b.noWork && G.jobCanProduce(b))
    .sort((a, b2) => (a.type === 'woodcutter' ? -1 : b2.type === 'woodcutter' ? 1 : 0));
  for (const b of targets) {
    const eligibleForTarget = c => c && !G.goalCommitment(c) && (b.type !== 'hospital' || !G.isSick(c)) && (b.type!=='tavern'||(c.age>=18&&!G.isSick(c)));
    if (jobless().filter(eligibleForTarget).length > wantLabor) break; // 不能任医师的病人不能挡住健康接班人。
    // 从供体岗位抽人：优先抽当下正闲置的那个（别的工人还在干活）
    const available = x => x.workers.some(id => eligibleForTarget(w.cmap[id]));
    const give = (x) => {
      const eligible = x.workers.map(id => w.cmap[id]).filter(eligibleForTarget);
      const c = eligible.find(c => c.state === 'idle' && !c.task) || eligible[eligible.length - 1];
      if (c) { G.releaseWorker(c); G.assignWorker(b, c); }
    };
    // 供体 1：非收获季且已播完种的农田（播种进行中不抽，否则秋收窗口顺延）
    if (!harvestSeason) {
      const farm = w.buildings.find(x => x.type === 'farm' && x.state === 'ok' && x.sownAll && x.workers.length > 0 && available(x));
      if (farm) { give(farm); return; }
    }
    // 供体 2：有闲置工人的岗位（工人正闲着就是临时富余；粮食岗至少留 1 人。
    // 旧实现要求「全员闲置」——那种时刻几乎不会同时出现，抽调链一断，
    // 关键岗位（伐木屋）会永久 0 工人，柴火归零冻死人）
    const lazy = w.buildings.find(x => x !== b && x.state === 'ok' && G.BDEF[x.type].jobs > 0 && x.workers.length > 0
      && x.type !== 'school' // 教师不外借，保证学堂开学
      && (!FOOD_SET.includes(x.type) || (x.workers.length > 1 && (FOOD_JOBS.includes(b.type) || foodWorkerCount() > needFood)))
      && x.workers.some(id => { const c = w.cmap[id]; return eligibleForTarget(c) && c.state === 'idle' && !c.task; }));
    if (lazy) { give(lazy); return; }
    // 关键空岗不能永远等粮工碰巧idle：采集任务完工会直接接下一趟，正常忙碌不是不可抽调。
    if (b.workers.length === 0 && ['woodcutter', 'blacksmith', 'farm', 'forester'].includes(b.type) && foodWorkerCount() > needFood) {
      const surplus = w.buildings.find(x => x !== b && x.state === 'ok' && FOOD_JOBS.includes(x.type) && x.workers.length > 1 && available(x));
      if (surplus) { give(surplus); return; }
    }
    // 供体 3：伐木屋缺人且木材有富余 → 护林屋（>1 人）抽一人锯柴
    if (b.type === 'woodcutter' && G.game.res.wood > 10 && !G.fuelLimited(b)) {
      const forester = w.buildings.find(x => x.type === 'forester' && x.state === 'ok' && x.workers.length > 1 && available(x));
      if (forester) { give(forester); return; }
    }
    // 供体 4：秋收窗口宝贵 → 从伐木/护林抽人抢收
    if (harvestSeason && b.type === 'farm') {
      const winterNeed = w.buildings.reduce((n, x) => n + (G.isOccupiedHome(w, x) ? G.BDEF[x.type].warmWoodPerYear : 0), 0);
      const d = w.buildings.find(x => x.state === 'ok' && x.type === 'forester' && x.workers.length > 0 && available(x)) ||
        w.buildings.find(x => x.state === 'ok' && x.type === 'woodcutter' && x.workers.length > 0 && G.game.res.firewood >= winterNeed && available(x));
      if (d) { give(d); return; }
    }
  }
};

/* ================= 建筑 ================= */
G.siteClearSpot = function (c, b, tree) {
  const w = G.world;
  const spots = [];
  if (!G.tileBlocked(w, tree.x, tree.y)) spots.push({ x: tree.x, y: tree.y });
  else for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (x !== b.x - 1 && x !== b.x + b.w && y !== b.y - 1 && y !== b.y + b.h) continue;
    if (!G.tileBlocked(w, x, y)) spots.push({ x, y });
  }
  for(const spot of spots){spot.building=b;spot.state=b.state;}
  return G.routeSpot(G.findPathToAny(w,c.x,c.y,spots));
};
G.siteTrees = function (b) {
  const w = G.world, trees = [];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = w.treeIdx[y * w.N + x];
    if (i >= 0) trees.push(w.trees[i]);
  }
  return trees;
};
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
  if (opt.instant && G.siteTrees({ x, y, w: def.w, h: def.h }).length) return { ok: false, reason: '立即放置需要已清场的地面' };
  if (!opt.free) for (const k in def.cost) G.game.res[k] -= def.cost[k];

  // 保留占地资源；工地先安排真实砍伐与搬运，清场完毕才开始建造。

  const b = {
    id: G.nextId(), type, x, y, w: def.w, h: def.h,
    state: opt.instant ? 'ok' : 'site',
    progress: opt.instant ? 1 : 0,
    workLeft: opt.instant ? 0 : def.buildWork,
    totalWork: def.buildWork || 1,
    workers: [], family: null, noWork: false, warnText: '',
    paidCost: opt.free ? {} : Object.assign({}, def.cost), constructionStarted: false,
  };
  if (type === 'farm') {
    b.cropType='wheat';b.cropChoice='wheat';
    b.farm = [];
    for (let j = y; j < y + def.h; j++)
      for (let i = x; i < x + def.w; i++)
        b.farm.push({ x: i, y: j, sown: false, harvested: false });
    b.sownAll = false; b.growth = 0; b.harvestDone = false;
  }
  if (type === 'forester') { b.doCut = true; b.doPlant = true; } // 原版 Forester 的 Cut / Plant 开关
  if (type === 'mine') { b.mineMode = 'iron'; b.legacyMine = false; b.mineTick = 0; }
  if (type === 'blacksmith') { b.toolLimit = G.PROD.blacksmith.toolLimit; b.toolRecipe = 'iron'; }
  if(type==='tavern')b.reserveDays=12;
  if(type==='tailor')b.coatRecipe='basic';
  if (type === 'woodcutter') b.fuelLimit = G.PROD.woodcutter.fuelLimit; // 燃料上限（原版 Fuel Limit）
  if (G.game && G.game.buildLog) { // 建造/拆除记录（反馈分析用；负号前缀 = 拆除）
    G.game.buildLog.push({ d: G.game.day, t: type });
    if (G.game.buildLog.length > 30) G.game.buildLog.shift();
  }
  w.buildings.push(b);
  w.bmap[b.id] = b;
  for (let j = y; j < y + def.h; j++)
    for (let i = x; i < x + def.w; i++)
      w.bgrid[j * w.N + i] = b.id;
  G.bumpNavigation(w);
  // A solid footprint invalidates forest/field claims inside it immediately,
  // so its builders can take over real clearing. Partial cargo stays owned.
  if (!def.passable) for (const c of w.citizens) for (const task of [c.task, c.pausedTask])
    if (G.physicalTaskEndpoint(task) && task.tx >= x && task.tx < x + def.w && task.ty >= y && task.ty < y + def.h)
      G.dropBlockedTask(c, task);
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
  if (opt.instant && ['house', 'stonehouse', 'boarding'].includes(type)) G.assignHousing();
  return { ok: true, b };
};

G.finishBuilding = function (b) {
  if (b.state !== 'site' || G.siteTrees(b).length) return;
  b.state = 'ok';
  if(b.type==='townhall')G.game.nomads.nextDay=Math.max(G.game.nomads.nextDay,G.game.day+G.SEASON_DAYS);
  b.progress = 1;
  G.bumpNavigation(G.world);
  // 建造工人多于正式岗位时，释放多余人员
  const def = G.BDEF[b.type];
  while (b.workers.length > def.jobs) {
    const id = b.workers.pop();
    const c = G.world.cmap[id];
    if (c) { c.job = null; c.task = null; c.state = 'idle'; }
  }
  G.ui.toast(`🏗 ${G.BDEF[b.type].name} 建成了`, 'good');
  if (['house', 'stonehouse', 'boarding'].includes(b.type)) G.assignHousing();
  G.scheduleJobs();
  G.ui.refreshHUD();
};

G.removeBuilding = function (b) {
  const w = G.world;
  if(b.type==='townhall'&&G.game.nomads.offer?.hallId===b.id)G.game.nomads.offer=null;
  if (b.type === 'bridge') { const check=G.bridgeRemovalStatus(w,b); if(!check.ok){G.ui.toast(check.reason,'warn');return;} }
  if (b.type === 'tradingpost' && Object.values(b.tradeInventory || {}).some(q => q > 0)) { G.ui.toast('先把待售目标设0，搬空贸易库存再拆除','warn'); return; }
  if (b.type === 'pasture' && b.animals) { G.game.livestock.sheep += b.animals; b.animals = 0; }
  if (b.type === 'storage') {
    const left = w.buildings.filter(x => x.type === 'storage').length;
    if (left <= 1) { G.ui.toast('不能拆除最后一座仓库', 'warn'); return; }
  }
  for (const id of b.workers) {
    const c = w.cmap[id];
    if (c) { c.job = null; c.task = null; c.pausedTask = null; c.path = null; c.state = 'idle'; }
  }
  for (const c of w.citizens) {
    if(c.task && c.task.kind==='care' && c.task.b===b)G.cancelMedicalCare(c);
    if(G.isLeisureVisitor(c)&&c.task.b===b)G.cancelLeisure(c);
  }
  // 尚未开工的规划全额撤销；已经劳动/建成的建筑拆除返还一半。
  const def = G.BDEF[b.type];
  const paid = b.paidCost || def.cost; // 旧档没有付款快照，沿用历史建材成本。
  const untouched = b.state === 'site' && !b.constructionStarted && b.progress === 0 && b.workLeft >= b.totalWork;
  const refund = [];
  for (const k in paid) {
    const n = untouched ? paid[k] : Math.floor(paid[k] / 2);
    if (n > 0) { G.game.res[k] += n; refund.push(`${G.RES[k].icon}×${n}`); }
  }
  // 住户搬出（独栋住宅与宿舍都以 fam.houseId 指向本建筑）
  for (const fam of w.families) if (fam.houseId === b.id) fam.houseId = null;
  w.buildings = w.buildings.filter(x => x !== b);
  delete w.bmap[b.id];
  if (G.game && G.game.buildLog) {
    G.game.buildLog.push({ d: G.game.day, t: '-' + b.type });
    if (G.game.buildLog.length > 30) G.game.buildLog.shift();
  }
  // 清除占地占位：残留会让该地块成为"幽灵建筑"——点击无详情、原地也无法重建
  for (let j = b.y; j < b.y + b.h; j++)
    for (let i = b.x; i < b.x + b.w; i++)
      w.bgrid[j * w.N + i] = -1;
  G.bumpNavigation(w);
  if (G.sel && G.sel.kind === 'b' && G.sel.id === b.id) G.ui.hideInfo();
  G.ui.toast(`🚧 已拆除 ${def.name}${refund.length ? `，返还 ${refund.join(' ')}` : ''}`, 'info');
  G.scheduleJobs();
};

G.demolishAt = function (tx, ty) {
  const w = G.world;
  const i = ty * w.N + tx;
  const bid = w.bgrid[i];
  if (bid >= 0) {
    const b = w.bmap[bid];
    if (b) G.removeBuilding(b); // 拆除提示（含返还材料）在 removeBuilding 内
    return;
  }
  if (w.road[i]) { G.setRoad(w, tx, ty, false); G.markGroundDirty(tx, ty); return; }
  if (w.treeIdx[i] >= 0) { G.removeTree(w, tx, ty); return; }
  if (w.rock[i]) { G.markRockAt(w, tx, ty); return; } // 岩石改为标记后由散工清除（资源入库需劳动）
};

/* Town development: explicit inventories and worker trips, not global free production. */
G.TRADE_CAPACITY = 2000;
G.tradeStored = b => Object.values(b.tradeInventory || {}).reduce((n,q) => n + q, 0);
G.TRADE_VALUES = {wood:2,stone:7,iron:5,tools:8,firewood:4,meat:1,vegetables:1,grain:1,leather:10,wool:5,clothes:15,warmCoats:20,herbs:4,coal:6,steelTools:10};
G.TRADE_GOODS = {coal:{name:'煤',price:6,stock:100},steelTools:{name:'钢工具',price:10,stock:20},sheep:{name:'羊',price:600,stock:4},orchardSeed:{name:'果树种子',price:2500,stock:1},cabbageSeed:{name:'卷心菜种子',price:2500,stock:1},grain:{name:'主食',price:1,stock:400},iron:{name:'铁',price:5,stock:100},leather:{name:'皮革',price:10,stock:80}};
G.ensureEconomyBuilding = function(b) {
  if(b.type==='tradingpost'){b.tradeInventory=b.tradeInventory||{};b.tradeTargets=b.tradeTargets||{};if(!Number.isFinite(b.nextMerchantDay))b.nextMerchantDay=G.game.day+G.SEASON_DAYS;}
  if(b.type==='pasture'){b.animals=b.animals||0;b.animalGrowth=b.animalGrowth||0;b.woolReady=b.woolReady||0;if(!Number.isFinite(b.animalTarget))b.animalTarget=8;}
  if(b.type==='orchard'){b.orchardAge=b.orchardAge||0;b.orchardYield=b.orchardYield||0;}
};
G.withdrawResource = function(type,qty){
  if(!Number.isFinite(qty)||qty<=0)return 0;
  if(G.isFood(type))G.reconcileFood();
  if(type==='food')type='grain';
  const r=G.game.res,n=Math.min(qty,r[type]||0);r[type]-=n;if(G.FOOD_KEYS.includes(type))r.food-=n;return n;
};
G.setTradeTarget = function(b,type,qty){
  if(G.world.bmap[b.id]!==b||b.type!=='tradingpost'||!Object.hasOwn(G.TRADE_VALUES,type)||!Number.isInteger(qty)||qty<0||qty>2000)return false;
  G.ensureEconomyBuilding(b);b.tradeTargets[type]=qty;G.game.schedT=0;return true;
};
G.tradeHasWork = function(b){
  G.ensureEconomyBuilding(b);return Object.keys(G.TRADE_VALUES).some(k=>(b.tradeInventory[k]||0)>(b.tradeTargets[k]||0)||((b.tradeInventory[k]||0)<(b.tradeTargets[k]||0)&&G.game.res[k]>0&&G.tradeStored(b)<G.TRADE_CAPACITY));
};
G.makeTradeTask = function(b,c){
  G.ensureEconomyBuilding(b);
  for(const type of Object.keys(G.TRADE_VALUES)){
    const stock=b.tradeInventory[type]||0,target=b.tradeTargets[type]||0;
    const returning=stock>target;
    if(!returning&&!(stock<target&&G.game.res[type]>0&&G.tradeStored(b)<G.TRADE_CAPACITY))continue;
    const route=returning?null:G.storageRoute(c.x,c.y),spot=returning?G.workSpot(G.world,b,c.x,c.y):route&&route.spot;
    if(!spot){b.noWork=true;b.warnText='搬运路线不可达';return null;}
    return G.withTaskRoute({kind:'trade',b,tx:spot.x,ty:spot.y,phase:returning?'return':'fetch',resource:type,work:0.25,workLeft:0},spot.route);
  }
  b.noWork=true;b.warnText='待售库存已达目标';return null;
};
G.completeTradeTask = function(c,t){
  const b=t.b;if(G.world.bmap[b.id]!==b||b.state!=='ok'){G.requestTask(c);return;}
  G.ensureEconomyBuilding(b);const type=t.resource;
  if(t.phase==='fetch'){
    const room=Math.min(Math.max(0,(b.tradeTargets[type]||0)-(b.tradeInventory[type]||0)),Math.max(0,G.TRADE_CAPACITY-G.tradeStored(b)));
    const spot=G.workSpot(G.world,b,c.x,c.y);if(!spot){G.requestTask(c);return;}
    const qty=G.withdrawResource(type,Math.min(20,room));if(!qty){G.requestTask(c);return;}
    c.carry={type,qty};t.phase='deliver';t.tx=spot.x;t.ty=spot.y;t.workLeft=t.work;c.task=t;
    G.sendTo(c,t.tx,t.ty,spot.route);return;
  }
  if(t.phase==='deliver'&&c.carry){b.tradeInventory[c.carry.type]=(b.tradeInventory[c.carry.type]||0)+c.carry.qty;c.carry=null;}
  if(t.phase==='return'){
    const qty=Math.min(20,Math.max(0,(b.tradeInventory[type]||0)-(b.tradeTargets[type]||0)));
    if(qty){b.tradeInventory[type]-=qty;c.carry={type,qty};G.startHaul(c);return;}
  }
  G.requestTask(c);
};
G.executeTrade = function(b,good,qty,payment){
  if(G.world.bmap[b.id]!==b||b.type!=='tradingpost'||b.state!=='ok'||!b.merchant||b.merchant.leaveDay<=G.game.day)return {ok:false,reason:'没有停靠商人'};
  const offer=Object.hasOwn(G.TRADE_GOODS,good)?G.TRADE_GOODS[good]:null,value=Object.hasOwn(G.TRADE_VALUES,payment)?G.TRADE_VALUES[payment]:0;
  if(!offer||!value||!Number.isInteger(qty)||qty<=0||qty>(b.merchant.stock[good]||0))return {ok:false,reason:'交易数量或货物无效'};
  const seedReason=G.seedTradeReason(good,qty);if(seedReason)return {ok:false,reason:seedReason};
  const cost=Math.ceil(offer.price*qty/value);if((b.tradeInventory[payment]||0)<cost)return {ok:false,reason:'待售库存不足，请先让商人搬入'};
  if(good!=='sheep'&&!G.seedUnlockKey(good)&&G.tradeStored(b)-cost+qty>G.TRADE_CAPACITY)return {ok:false,reason:'贸易站库存容量不足（共2000）'};
  b.tradeInventory[payment]-=cost;b.merchant.stock[good]-=qty;
  if(good==='sheep')G.game.livestock.sheep+=qty;
  else if(G.seedUnlockKey(good))G.game.unlocks[G.seedUnlockKey(good)]=true;
  else b.tradeInventory[good]=(b.tradeInventory[good]||0)+qty;
  G.game.schedT=0;return {ok:true,paid:cost};
};
G.stockPasture = function(b,qty){
  if(G.world.bmap[b.id]!==b||b.type!=='pasture'||b.state!=='ok'||!Number.isInteger(qty)||qty<=0)return false;
  G.ensureEconomyBuilding(b);if(qty>G.game.livestock.sheep||b.animals+qty>12)return false;
  G.game.livestock.sheep-=qty;b.animals+=qty;G.game.schedT=0;return true;
};
G.setPastureTarget = function(b,qty){if(G.world.bmap[b.id]!==b||b.type!=='pasture'||!Number.isInteger(qty)||qty<2||qty>12)return false;b.animalTarget=qty;return true;};
G.advanceTownEconomy = function(){
  const g=G.game;g.unlocks=g.unlocks||{orchard:false};g.livestock=g.livestock||{sheep:0};
  for(const b of G.world.buildings){if(b.state!=='ok')continue;G.ensureEconomyBuilding(b);
    if(b.type==='tradingpost'){
      if(b.merchant&&g.day>=b.merchant.leaveDay){b.merchant=null;b.nextMerchantDay=g.day+G.YEAR_DAYS-G.SEASON_DAYS;}
      if(!b.merchant&&g.day>=b.nextMerchantDay){b.merchant={leaveDay:g.day+G.SEASON_DAYS,stock:Object.fromEntries(Object.entries(G.TRADE_GOODS).map(([k,v])=>[k,v.stock]))};G.ui.toast('⛵ 商船已到贸易站，可换物资、羊和种子','good');}
    }
    if(b.type==='pasture'&&b.animals>0&&b.tendedDay>=g.day-2){
      if(b.animals>=2)b.animalGrowth+=b.animals/(G.YEAR_DAYS*2);while(b.animalGrowth>=1&&b.animals<12){b.animals++;b.animalGrowth--;}
      b.animalGrowth=Math.min(1,b.animalGrowth);b.woolReady=Math.min(48,b.woolReady+b.animals/G.SEASON_DAYS);
    }
    if(b.type==='orchard'&&g.unlocks.orchard){
      if(b.orchardAge<G.YEAR_DAYS*4&&b.tendedDay>=g.day-2)b.orchardAge++;
      if(g.season===2&&b.orchardAge>=G.YEAR_DAYS*4&&b.orchardSeason!==g.year){b.orchardYield=180;b.orchardSeason=g.year;}
      if(g.season===3)b.orchardYield=0;
    }
  }
};
G.completeEconomyWork = function(c,t){
  const b=t.b;if(G.world.bmap[b.id]!==b||b.state!=='ok')return;G.ensureEconomyBuilding(b);b.tendedDay=G.game.day;
  if(t.economy==='pasture'){
    if(b.animals>b.animalTarget&&!G.goalPaused('meat')){b.animals--;c.carry={type:'meat',qty:24};}
    else if(b.woolReady>=1&&!G.goalPaused('wool')){const qty=Math.min(8,Math.floor(b.woolReady));b.woolReady-=qty;c.carry={type:'wool',qty};}
  }else if(t.economy==='orchard'&&G.game.season===2&&b.orchardAge>=G.YEAR_DAYS*4&&b.orchardYield>0){const qty=Math.min(20,b.orchardYield);b.orchardYield-=qty;c.carry={type:'vegetables',qty};}
};

/* Health is separate from happiness. Rates/capacity are small-town adaptations;
 * the first illness is deliberately nonlethal and reversible during playtesting. */
G.HEALTH = { hospitalBeds: 8, herbVisitors: 2, hospitalHours: 24, herbHours: 3,
  herbRecovery: 0.5, naturalRecoveryDays: 8, immunityDays: 12, herbCooldownDays: 4 };
G.healthOf = c => G.clamp(Number.isFinite(c.health) ? c.health : 4, 0, 5);
G.isSick = c => !!c && !c.dead && c.sickDays > 0;
G.healthWorkMul = c => (1 + Math.max(0, 3 - G.healthOf(c)) * 0.08) * (G.isSick(c) ? 1.5 : 1);
G.medicalPatients = b => G.world.citizens.filter(c => !c.dead && c.task && c.task.kind === 'care' && c.task.b === b);
G.medicalStaff = function (b) {
  if (!b || G.world.bmap[b.id] !== b || b.state !== 'ok') return false;
  return b.workers.some(id => {
    const c = G.world.cmap[id];
    if (!c || c.dead || G.isSick(c) || c.job !== b.id || (c.task && c.task.kind === 'care')) return false;
    return b.type === 'herbalist' || (c.state === 'work' && c.task && c.task.kind === 'clinic' && c.task.b === b && G.atMedicalDoor(c, b));
  });
};
G.atMedicalDoor = (c, b) => c.x >= b.x - 1 && c.x <= b.x + b.w && c.y >= b.y - 1 && c.y <= b.y + b.h &&
  (c.x < b.x || c.x >= b.x + b.w || c.y < b.y || c.y >= b.y + b.h) && !G.tileBlocked(G.world, Math.round(c.x), Math.round(c.y));
G.validCareTask = function (c) {
  const t = c.task, b = t && t.b;
  return !!(t && t.kind === 'care' && b && G.world.bmap[b.id] === b && b.state === 'ok' &&
    (t.careType === 'hospital' ? b.type === 'hospital' && G.isSick(c) : b.type === 'herbalist' && !G.isSick(c)));
};
G.inMedicalCare = c => G.validCareTask(c) && c.state === 'work' && (!c.path || c.path.length === 0) && !c.carry && G.atMedicalDoor(c, c.task.b);
G.cancelMedicalCare = function (c) {
  c.task = null; c.path = null; c.pi = 0; c.walkKind = ''; c.state = 'idle'; c.wanderT = 1; c.careRetryH = 4;
};
G.recoverCitizen = function (c) { c.sickDays = 0; c.careHours = 0; c.immunityDays = G.HEALTH.immunityDays; };
G.medicalStatus = function (c) {
  if (c.task && c.task.kind === 'care') {
    if (c.state !== 'work') return c.task.careType === 'hospital' ? '前往诊所' : '前往采药屋保健';
    if (!G.medicalStaff(c.task.b)) return '等待医师到岗';
    return c.task.careType === 'hospital' ? `住院照料 ${Math.floor(c.careHours || 0)} / ${G.HEALTH.hospitalHours} 小时` : '服用草药保健';
  }
  if (G.isSick(c)) return `季节热病第 ${c.sickDays} 天 · 寻找有医师且可达的诊所`;
  if (G.healthOf(c) < 3.8 && !(c.herbCooldown > 0)) return (G.game.res.herbs || 0) < 1 ? '健康偏低：缺草药，需成熟林与采药员' : '健康偏低：需可达且有人值守的采药屋';
  return c.herbCooldown > 0 ? '草药保健后休养' : '健康稳定';
};
G.healthSummary = function () {
  const cs = G.world.citizens.filter(c => !c.dead);
  return { average: cs.length ? cs.reduce((n,c) => n + G.healthOf(c), 0) / cs.length : 0,
    sick: cs.filter(G.isSick).length, treated: cs.filter(c => G.inMedicalCare(c) && c.task.careType === 'hospital').length,
    herbs: G.game.res.herbs || 0 };
};
G.tryMedicalCare = function (c) {
  if (c.dead || c.carry || c.careRetryH > 0) return false;
  const sick = G.isSick(c), type = sick ? 'hospital' : 'herbalist';
  if (!sick && (G.healthOf(c) >= 3.8 || c.herbCooldown > 0 || (G.game.res.herbs || 0) < 1 || G.isRestTime())) return false;
  // A clinic worker never abandons their own service to "treat themselves".
  // Another hut may treat them; ill physicians leave the workforce below.
  const candidates = G.world.buildings.filter(b => b.type === type && b.state === 'ok' && b.id !== c.job && G.medicalStaff(b) &&
    G.medicalPatients(b).length < (sick ? G.HEALTH.hospitalBeds : G.HEALTH.herbVisitors))
    .sort((a,b) => G.d2(c.x,c.y,a.x,a.y) - G.d2(c.x,c.y,b.x,b.y));
  for (const b of candidates) {
    const spot = G.workSpot(G.world, b, c.x, c.y, true);
    if (!spot) continue;
    c.task = { kind: 'care', careType: sick ? 'hospital' : 'herbs', b, tx: spot.x, ty: spot.y,
      work: sick ? G.HEALTH.hospitalHours : G.HEALTH.herbHours, workLeft: sick ? G.HEALTH.hospitalHours : G.HEALTH.herbHours, waitingH: 0 };
    if (G.sendTo(c, spot.x, spot.y, spot.route)) return true;
  }
  c.careRetryH = 4;
  return false;
};
G.stepMedicalCare = function (c, dtH) {
  const t = c.task;
  if (!G.inMedicalCare(c)) { G.cancelMedicalCare(c); return; }
  if (!G.medicalStaff(t.b)) {
    t.waitingH = (t.waitingH || 0) + dtH;
    // Overnight rest is allowed; a closed/staffless clinic cannot trap a citizen.
    if (t.waitingH >= 12) G.cancelMedicalCare(c);
    return;
  }
  t.waitingH = 0;
  if (t.careType === 'hospital') {
    c.careHours = Math.min(G.HEALTH.hospitalHours, (c.careHours || 0) + dtH);
    if (c.careHours < G.HEALTH.hospitalHours) return;
    G.recoverCitizen(c); G.ui.toast(`⚕ ${c.name} 经诊所照料康复`, 'good');
  } else {
    if ((G.game.res.herbs || 0) < 1) { G.cancelMedicalCare(c); return; }
    t.workLeft -= dtH;
    if (t.workLeft > 0) return;
    G.game.res.herbs--; c.health = Math.min(5, G.healthOf(c) + G.HEALTH.herbRecovery); c.herbCooldown = G.HEALTH.herbCooldownDays;
  }
  G.cancelMedicalCare(c); G.requestTask(c);
};
G.makeClinicTask = function (b, c) {
  if (G.isSick(c)) { b.noWork = true; b.warnText = '医师患病，等待健康医师接班'; return null; }
  if (b.type === 'hospital' && !G.world.citizens.some(G.isSick)) { b.noWork = true; b.warnText = '暂无病人，医师可参加其他劳动'; return null; }
  const spot = G.workSpot(G.world, b, c.x, c.y, true);
  if (!spot) { b.noWork = true; b.warnText = '医疗入口不可达'; return null; }
  return G.withTaskRoute({kind:'clinic', b, tx:spot.x, ty:spot.y, work:4, workLeft:0}, spot.route);
};
G.makeHerbalistTask = function (b, c) {
  const p = G.PROD.herbalist, w = G.world;
  const trees = G.treesInRadius(w, b.x, b.y, p.radius, true).filter(t => !G.tileBlocked(w,t.x,t.y));
  if (G.goalPaused('herbs') || (G.game.res.herbs || 0) >= G.storageCap() || trees.length < p.needTrees) {
    b.warnText = trees.length < p.needTrees ? '成熟林不足，仍可用库存草药保健' : '采药暂停，仍提供草药保健';
    return G.makeClinicTask(b,c);
  }
  // One multi-target routing pass chooses a physically reachable mature tree.
  const route = G.findPathToAny(w,c.x,c.y,trees.map(t => ({x:t.x,y:t.y})));
  if (!route) { b.warnText = '成熟林不可达，仍提供草药保健'; return G.makeClinicTask(b,c); }
  const qty = G.taskYield(Math.max(1,Math.round(p.yield*Math.min(1,trees.length/p.fullForest))));
  return G.withTaskRoute({kind:'work',b,tx:route.target.x,ty:route.target.y,work:G.taskWork(c,p.workH),workLeft:0,yield:{type:'herbs',qty}},route);
};
G.advanceHealth = function () {
  const g = G.game, cs = G.world.citizens.filter(c => !c.dead), sickAtStart = cs.filter(G.isSick);
  for (const c of cs) {
    c.health = G.clamp(G.healthOf(c) + ((c.dietScore || 1) - 2)*0.025 - Math.min(2,c.hunger || 0)*0.08 - Math.min(3,c.cold || 0)*0.01, 1, 5);
    c.herbCooldown = Math.max(0,(c.herbCooldown || 0)-1);
    c.immunityDays = Math.max(0,(c.immunityDays || 0)-1);
    if (G.isSick(c)) {
      c.sickDays++;
      if (c.sickDays >= G.HEALTH.naturalRecoveryDays) { G.recoverCitizen(c); if (c.task && c.task.kind === 'care') G.cancelMedicalCare(c); }
      else if (G.world.bmap[c.job]?.type === 'hospital') G.releaseWorker(c);
    }
  }
  // One-year grace applies both to new towns and imported pre-health saves.
  // Snapshot exposure prevents newly infected people infecting others this tick.
  if (g.day - (g.healthStartDay || 0) >= G.YEAR_DAYS) {
    let newCases = 0;
    const active = sickAtStart.filter(c => G.isSick(c) && !G.inMedicalCare(c));
    const ceiling = Math.max(1,Math.ceil(cs.length*0.2));
    const currentSick = cs.filter(G.isSick).length;
    for (const c of cs) {
      if (newCases >= 1 || currentSick + newCases >= ceiling) break;
      if (G.isSick(c) || c.immunityDays > 0) continue;
      const exposed = active.some(other => other !== c && G.d2(c.x,c.y,other.x,other.y) <= 9);
      const p = exposed ? 0.04 + (5-G.healthOf(c))*0.012 : g.day%7===0 ? 0.002 + (5-G.healthOf(c))*0.0015 : 0;
      if (p>0 && G.chance(p)) { c.sickDays=1; c.careHours=0; newCases++; }
    }
    if (newCases && !g.warned.illness) { g.warned.illness=true; G.ui.toast('⚠ 季节热病出现：患病会拖慢劳动。诊所医师能加速康复；草药与三类饮食有助预防。本批热病不会直接致死。','warn'); }
  }
  if (!cs.some(G.isSick)) g.warned.illness=false;
  const summary = G.healthSummary();
  if (summary.average < 3.5 && !g.warned.healthLow) { g.warned.healthLow=true; G.ui.toast('🌿 镇民健康正在下降：补齐肉类、蔬菜、主食，并让采药员在成熟林旁采药、为居民保健。','warn'); }
  if (summary.average > 4) g.warned.healthLow=false;
};

/* Resource specialization retains the old mine/save contract until the player
 * chooses another product. Exhaustion and irreversible pits are a later slice. */
G.isTool = type => type === 'tools' || type === 'steelTools';
G.toolStock = () => (G.game.res.tools || 0) + (G.game.res.steelTools || 0);
G.hasTools = () => G.toolStock() > 0;
G.toolDaysLeft = function (adults) {
  const g = G.game;
  const days = Math.max(0,(g.res.tools || 0)-(g.toolWear || 0))*G.LIFE.toolLifeDays +
    Math.max(0,(g.res.steelTools || 0)-(g.steelToolWear || 0))*G.LIFE.steelToolLifeDays;
  return days / Math.max(1,adults);
};
G.wearTools = function (adults) {
  const g = G.game; let demand = Math.max(0,adults);
  // Existing pooled-tool abstraction: steel supplies work-days first; any
  // overflow demand uses iron. Never charge both pools for the same adult-day.
  for (const [type,key,life] of [['steelTools','steelToolWear',G.LIFE.steelToolLifeDays],['tools','toolWear',G.LIFE.toolLifeDays]]) {
    let stock = Math.max(0,g.res[type] || 0), wear = Math.max(0,g[key] || 0);
    if (!stock) { g[key]=0; continue; }
    const used = Math.min(demand,Math.max(0,stock-wear)*life);
    wear += used/life; demand -= used;
    if (wear >= stock-1e-9) { stock=0; wear=0; }
    else { const broken=Math.floor(wear+1e-9); stock-=broken; wear=Math.max(0,wear-broken); }
    g.res[type]=stock; g[key]=wear;
  }
};
G.mineModeOf = b => ['iron','coal'].includes(b.mineMode) ? b.mineMode : 'legacy';
G.blacksmithOutput = b => b && b.toolRecipe === 'steel' ? 'steelTools' : 'tools';
G.blacksmithRecipe = b => G.blacksmithOutput(b) === 'steelTools' ? [...G.PROD.blacksmith.consume,{type:'coal',qty:2}] : G.PROD.blacksmith.consume;
G.productionOutputsOf = function (b) {
  if(b.type==='farm')return ['food',G.farmOutput(b)];
  if(b.type==='tailor')return [G.tailorOutput(b)];
  if (b.type === 'mine') return G.mineModeOf(b) === 'legacy' ? ['stone','iron'] : [G.mineModeOf(b)];
  if (b.type === 'blacksmith') return [G.blacksmithOutput(b)];
  return G.PRODUCTION_OUTPUTS[b.type] || [];
};
G.setMineMode = function (b, mode) {
  if (!b || G.world.bmap[b.id] !== b || b.type !== 'mine' || b.state !== 'ok' ||
      !['iron','coal','legacy'].includes(mode) || (mode === 'legacy' && !b.legacyMine)) return false;
  b.mineMode=mode; b.noWork=false; b.warnText=''; G.game.schedT=0; return true;
};
G.setToolRecipe = function (b, recipe) {
  if (!b || G.world.bmap[b.id] !== b || b.type !== 'blacksmith' || b.state !== 'ok' || !['iron','steel'].includes(recipe)) return false;
  b.toolRecipe=recipe; delete b.productionPaused; b.noWork=false; b.warnText=''; G.updateProductionGoals(); G.game.schedT=0; return true;
};
G.makeMineralTask = function (b, c) {
  const w=G.world, g=G.game, cap=G.storageCap(), p=b.type==='stonequarry'?G.PROD.stonequarry:G.PROD.mine;
  let type=b.type==='stonequarry'?'stone':G.mineModeOf(b);
  const blocked = k => g.res[k]>=cap || G.goalPaused(k);
  if (type==='legacy') {
    if (blocked('stone') && blocked('iron')) { b.noWork=true; b.warnText='仓库已满'; return null; }
    b.mineTick=(b.mineTick || 0)+1;
    type=b.mineTick%p.ironEvery===0?'iron':'stone';
    if (blocked(type)) type=type==='iron'?'stone':'iron';
  } else if (blocked(type)) { b.noWork=true; b.warnText=G.RES[type].name+'仓容或目标已满'; return null; }
  const spot=G.workSpot(w,b,c.x,c.y);
  if (!spot) { b.noWork=true; b.warnText='采矿入口不可达'; return null; }
  const qty=type==='coal'?p.coalYield:p.yield;
  return G.withTaskRoute({kind:'work',b,tx:spot.x,ty:spot.y,work:G.taskWork(c,p.workH),workLeft:0,yield:{type,qty:G.taskYield(qty)}},spot.route);
};

G.addBridge = function(start,end) {
  const w=G.world,plan=G.planBridge(w,start,end);if(!plan.ok)return plan;
  for(const [type,qty]of Object.entries(plan.materials))if(G.game.res[type]<qty)return {ok:false,reason:`${G.RES[type].name}不足（需要${qty}）`};
  const b={id:G.nextId(),type:'bridge',x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x)+1,h:Math.abs(start.y-end.y)+1,bridgeAxis:plan.axis,state:'site',progress:0,workLeft:plan.length*3,totalWork:plan.length*3,workers:[],family:null,noWork:false,warnText:'',paidCost:{...plan.materials},constructionStarted:false};
  // Only shoreline workers can start a bridge. Never grant walkable water early.
  const shadow={...w,bmap:{...w.bmap,[b.id]:b},bgrid:w.bgrid.slice(),_pf:null};for(const p of plan.path)shadow.bgrid[p.y*w.N+p.x]=b.id;
  if(!w.citizens.some(c=>!c.dead&&c.adult&&G.workSpot(shadow,b,c.x,c.y)))return {ok:false,reason:'没有居民能到达桥头施工；请从现有城镇可达的岸边起桥'};
  for(const [type,qty]of Object.entries(plan.materials))G.game.res[type]-=qty;
  w.buildings.push(b);w.bmap[b.id]=b;for(const p of plan.path){w.bgrid[p.y*w.N+p.x]=b.id;G.markGroundDirty(p.x,p.y);}
  G.bumpNavigation(w);G.game.buildLog.push({d:G.game.day,t:'bridge'});if(G.game.buildLog.length>30)G.game.buildLog.shift();G.scheduleJobs();return {ok:true,b};
};

/* One town-wide offer: accepting is an explicit, idempotent gameplay decision.
 * Family sizes and timing are intentionally bounded for this small-town model. */
G.isArriving = c => !!c && !c.dead && c.arrivalHallId != null;
G.nomadPeople = offer => offer ? offer.families.reduce((n,f)=>n+2+f.childAges.length,0) : 0;
G.advanceNomads = function() {
  const g=G.game,w=G.world,n=g.nomads;
  if(n.offer && (n.offer.expiresDay<=g.day || w.bmap[n.offer.hallId]?.type!=='townhall' || w.bmap[n.offer.hallId]?.state!=='ok'))n.offer=null;
  if(n.offer || g.day<n.nextDay || g.season>=2 || w.citizens.length<10)return;
  const hall=w.buildings.find(b=>b.type==='townhall'&&b.state==='ok');if(!hall)return;
  const count=G.clamp(Math.round(w.citizens.length*(.1+G.rng()*.2)),2,6),families=[];
  const households=count>=4?2:1;let kids=count-households*2;
  for(let f=0;f<households;f++){const childCount=Math.min(1,kids);kids-=childCount;families.push({fatherAge:G.ri(22,38),motherAge:G.ri(22,38),childAges:Array.from({length:childCount},()=>G.ri(2,8))});}
  n.offer={id:++n.serial,hallId:hall.id,expiresDay:g.day+G.SEASON_DAYS,families,sickCount:G.chance(.2)?1:0};
  n.nextDay=g.day+G.YEAR_DAYS;
  G.ui.toast(`🏛 有${G.nomadPeople(n.offer)}名来访者申请迁入，请在市政厅查看需求后接纳或拒绝（${G.SEASON_DAYS}天内）`,'info');
};
G.nomadEntry = function(b) {
  const w=G.world;if(!b||w.bmap[b.id]!==b||b.state!=='ok'||b.type!=='townhall')return null;
  const edges=[];for(let k=0;k<w.N;k++)for(const p of [{x:k,y:0},{x:k,y:w.N-1},{x:0,y:k},{x:w.N-1,y:k}])if(!G.tileBlocked(w,p.x,p.y))edges.push(p);
  // A stranded resident at one side of the hall must not veto another doorway
  // connected to both the settled village and a walkable map boundary.
  const checked=new Set();
  for(const c of w.citizens){
    if(c.dead||G.isArriving(c))continue;
    const door=G.workSpot(w,b,c.x,c.y);if(!door)continue;
    const key=door.y*w.N+door.x;if(checked.has(key))continue;checked.add(key);
    const outward=G.findPathToAny(w,door.x,door.y,edges);if(!outward)continue;
    const boundary=outward.target,back=[{x:door.x,y:door.y},...outward.path].reverse().slice(1);
    return {boundary,door:{x:door.x,y:door.y,building:b,state:'ok'},path:back};
  }
  return null;
};
G.startImmigration = function(c,entry=null) {
  if(!G.isArriving(c))return false;
  const w=G.world;let b=w.bmap[c.arrivalHallId],spot;
  if(b&&b.type==='townhall'&&b.state==='ok')spot=entry?entry.door:G.workSpot(w,b,c.x,c.y);
  else {b=null;for(const fallback of w.buildings.filter(x=>x.state==='ok'&&['townhall','storage'].includes(x.type))){spot=G.workSpot(w,fallback,c.x,c.y);if(spot){b=fallback;break;}}}
  if(!b||!spot){c.task=null;c.path=null;c.state='idle';c.wanderT=2;return false;}
  c.task={kind:'arrival',b,tx:spot.x,ty:spot.y,work:.1,workLeft:.1};
  const route=entry?{world:w,revision:w.navigationRevision||0,fromX:c.x,fromY:c.y,target:entry.door,path:entry.path}:spot.route;
  return G.sendTo(c,spot.x,spot.y,route);
};
G.decideNomads = function(b,offerId,accept) {
  const w=G.world,g=G.game,n=g.nomads,o=n.offer;
  if(w.bmap[b?.id]!==b||b?.type!=='townhall'||b.state!=='ok'||!o||o.id!==offerId||o.hallId!==b.id||o.expiresDay<=g.day||typeof accept!=='boolean')return {ok:false,reason:'这批申请已变化或过期，请查看当前市政厅记录'};
  const count=G.nomadPeople(o);
  if(!accept){n.offer=null;n.declined+=count;return {ok:true,count};}
  const entry=G.nomadEntry(b);if(!entry)return {ok:false,reason:'没有从地图边界通往本村市政厅的可达路线，请先打通道路或桥梁'};
  // Consume the exact offer before creating people. Repeated/stale clicks cannot
  // add the same families twice, including callbacks from another hall/world.
  n.offer=null;const newcomers=[];
  for(const f of o.families){
    const base={x:entry.boundary.x,y:entry.boundary.y,arrivalHallId:b.id};
    const father=G.spawnCitizen({...base,sex:'m',age:f.fatherAge}),mother=G.spawnCitizen({...base,sex:'f',age:f.motherAge});
    const fam={id:G.nextId(),members:[father.id,mother.id],houseId:null,coupleIds:[father.id,mother.id]};
    father.partnerId=mother.id;mother.partnerId=father.id;father.familyId=fam.id;mother.familyId=fam.id;w.families.push(fam);newcomers.push(father,mother);
    for(const age of f.childAges){const child=G.spawnCitizen({...base,age,adult:false,familyId:fam.id,parentIds:[father.id,mother.id],birthFamilyId:fam.id});fam.members.push(child.id);newcomers.push(child);}
  }
  if(o.sickCount)newcomers[0].sickDays=1; // disclosed, existing nonlethal fever only
  n.accepted+=count;G.normalizeFamilyRelations(w);G.assignHousing();
  for(const c of newcomers)G.startImmigration(c,entry);
  g.schedT=0;G.ui.refreshHUD();return {ok:true,count};
};
G.townHallSummary = function(b) {
  const w=G.world,g=G.game,n=g.nomads,cs=w.citizens.filter(c=>!c.dead),pop=cs.length;
  const offer=n.offer&&n.offer.hallId===b.id&&n.offer.expiresDay>g.day?n.offer:null,people=G.nomadPeople(offer);
  const children=cs.filter(c=>!c.adult).length,offeredFamilies=offer?offer.families.length:0;
  return {population:pop,adults:cs.filter(c=>c.adult).length,children,educated:cs.filter(c=>c.educated).length,
    homelessFamilies:w.families.filter(f=>f.members.length&&f.houseId==null).length,
    freeHomes:w.buildings.filter(h=>h.state==='ok'&&['house','stonehouse'].includes(h.type)&&h.family==null).length,
    boardingSlots:w.buildings.filter(h=>h.state==='ok'&&h.type==='boarding').reduce((s,h)=>s+Math.max(0,G.LIFE.boardingCap-G.boardingFamilies(w,h).length),0),
    averageHealth:pop?cs.reduce((s,c)=>s+G.healthOf(c),0)/pop:0,sick:cs.filter(G.isSick).length,
    doctors:w.buildings.filter(h=>h.type==='hospital'&&h.state==='ok').reduce((s,h)=>s+h.workers.filter(id=>w.cmap[id]&&!w.cmap[id].dead&&!G.isSick(w.cmap[id])).length,0),herbs:g.res.herbs,
    foodDays:pop?g.res.food/(pop*G.LIFE.eatPerDay):0,offer,offerPeople:people,offerFamilies:offeredFamilies,offerAdults:offeredFamilies*2,offerChildren:people-offeredFamilies*2,
    foodDaysAfter:pop+people?g.res.food/((pop+people)*G.LIFE.eatPerDay):0,addedFoodPerDay:people*G.LIFE.eatPerDay,addedFuelPerWinter:offeredFamilies*30,
    arriving:cs.filter(G.isArriving).length,nextDay:n.nextDay,accepted:n.accepted,declined:n.declined};
};

/* Tavern: one explicit food-to-leisure chain. Food safety is rechecked when
 * fetching and before fermenting. Reserved grain is physical refundable cargo. */
G.LEISURE={age:18,hours:2,days:6,capacity:4,maxTravelHours:6,retryHours:6};
G.leisureDaysOf=c=>G.clamp(Number.isFinite(c.leisureDays)?c.leisureDays:0,0,G.LEISURE.days);
G.happinessTarget=c=>G.clamp(2.5+.5*(Number.isFinite(c.dietScore)?c.dietScore:1)+(G.leisureDaysOf(c)>0?1:0)-Math.min(2,(c.hunger||0)/3),1,5);
G.happinessBonus=c=>G.clamp(((c.happiness||3)-3)*.025,0,.05);
G.leisureSummary=c=>({dietBase:2.5+.5*(Number.isFinite(c.dietScore)?c.dietScore:1),leisureBonus:G.leisureDaysOf(c)>0?1:0,
  target:G.happinessTarget(c),happiness:c.happiness||3,workBonus:G.happinessBonus(c),remainingDays:G.leisureDaysOf(c)});
G.tavernReserveDays=b=>Number.isInteger(b.reserveDays)?G.clamp(b.reserveDays,8,48):12;
G.setTavernReserve=function(b,days){
  if(!b||G.world.bmap[b.id]!==b||b.type!=='tavern'||b.state!=='ok'||!Number.isInteger(days)||days<8||days>48)return false;
  b.reserveDays=days;b.noWork=false;G.game.schedT=0;return true;
};
G.tavernBrewStatus=function(b,reserved=false){
  const r=G.game.res,reserveDays=G.tavernReserveDays(b),reserveFood=G.world.citizens.filter(c=>!c.dead).length*G.LIFE.eatPerDay*reserveDays;
  const foodAfterBatch=r.food-(reserved?0:30),info={reserveDays,reserveFood,foodAfterBatch};
  let reason='口粮充足，可取30主食酿酒';
  if(!reserved && r.grain<30)reason='主食不足：每批需要30';
  else if(foodAfterBatch<reserveFood)reason=reserved?`低于全村${reserveDays}天口粮，退回未酿原粮`:`取粮后不足全村${reserveDays}天口粮，暂停新酿造`;
  else if(!reserved && G.goalPaused('ale'))reason='麦酒生产目标已达，仍可接待休闲';
  else if(!reserved && r.ale>=Math.min(G.productionGoalOf('ale')??30,G.storageCap()))reason='麦酒备货目标或仓容已满，仍可接待休闲（未设全镇目标时备30）';
  else return {...info,ok:true,reason};
  return {...info,ok:false,reason};
};
G.isLeisureVisitor=c=>!!c&&!c.dead&&c.task?.kind==='leisure';
G.tavernVisitors=b=>G.world.citizens.filter(c=>G.isLeisureVisitor(c)&&c.task.b===b);
G.tavernStaff=function(b){
  if(!b||G.world.bmap[b.id]!==b||b.type!=='tavern'||b.state!=='ok')return false;
  return b.workers.some(id=>{const c=G.world.cmap[id],t=c?.task;return c&&!c.dead&&c.age>=18&&!G.isSick(c)&&c.job===b.id&&c.state==='work'&&t?.b===b&&
    (t.kind==='host'||(t.kind==='brew'&&t.phase==='process'))&&G.atMedicalDoor(c,b);});
};
G.makeTavernTask=function(b,c){
  if(c.age<18||G.isSick(c)){b.noWork=true;b.warnText='需要18岁以上健康酿酒工';return null;}
  const status=G.tavernBrewStatus(b),visitors=G.tavernVisitors(b);
  // While guests are on their way, keep the host physically on site rather
  // than repeatedly leaving to fetch the next production batch.
  if(visitors.length||!status.ok){
    b.warnText=status.reason;
    if(G.game.res.ale<=0){b.noWork=true;return null;}
    const spot=G.workSpot(G.world,b,c.x,c.y);if(!spot){b.noWork=true;b.warnText='酒馆入口不可达';return null;}
    return G.withTaskRoute({kind:'host',b,tx:spot.x,ty:spot.y,work:4,workLeft:4},spot.route);
  }
  const route=G.storageRoute(c.x,c.y);if(!route){b.noWork=true;b.warnText='取粮仓库不可达';return null;}
  return G.withTaskRoute({kind:'brew',phase:'fetch',b,tx:route.spot.x,ty:route.spot.y,work:.1,workLeft:.1,yield:{type:'ale',qty:c.educated?4:3}},route.spot.route);
};
G.returnBrewGrain=function(c){c.task=null;c.pausedTask=null;if(c.carry)G.startHaul(c);else{c.state='idle';c.wanderT=2;}};
G.completeBrew=function(c,t){
  const b=t.b,w=G.world;
  if(!b||w.bmap[b.id]!==b||b.state!=='ok'||c.job!==b.id||G.isSick(c)||G.d2(c.x,c.y,t.tx,t.ty)>.04||G.tileBlocked(w,t.tx,t.ty)){G.returnBrewGrain(c);return;}
  if(t.phase==='fetch'){
    if(!w.buildings.some(s=>s.type==='storage'&&s.state==='ok'&&G.atMedicalDoor(c,s))||!G.tavernBrewStatus(b).ok){G.returnBrewGrain(c);return;}
    const spot=G.workSpot(w,b,c.x,c.y);if(!spot){G.returnBrewGrain(c);return;}
    const qty=G.withdrawResource('grain',30);c.carry={type:'grain',qty,brewIngredient:true};
    t.phase='process';t.tx=spot.x;t.ty=spot.y;t.work=t.workLeft=G.taskWork(c,6);c.task=t;
    if(!G.sendTo(c,t.tx,t.ty,spot.route))G.returnBrewGrain(c);
    return;
  }
  if(t.phase!=='process'||!G.atMedicalDoor(c,b)||!c.carry?.brewIngredient||c.carry.type!=='grain'||c.carry.qty!==30||!G.tavernBrewStatus(b,true).ok){G.returnBrewGrain(c);return;}
  c.carry={type:'ale',qty:t.yield.qty};G.recordProduction(b,'ale',t.yield.qty);G.startHaul(c);
};
G.validLeisureTask=function(c){
  const b=c.task?.b;return G.isLeisureVisitor(c)&&c.age>=18&&!G.isSick(c)&&!c.carry&&b&&G.world.bmap[b.id]===b&&b.state==='ok'&&b.type==='tavern';
};
G.cancelLeisure=function(c){c.task=null;c.path=null;c.pi=0;c.state='idle';c.walkKind='';c.wanderT=1;c.leisureRetryH=G.LEISURE.retryHours;};
G.tryLeisure=function(c){
  if(c.dead||c.age<18||!c.adult||c.carry||G.isArriving(c)||G.isSick(c)||G.isRestTime()||c.leisureRetryH>0||G.leisureDaysOf(c)>0||G.game.res.ale<1)return false;
  const w=G.world,pop=w.citizens.filter(x=>!x.dead).length;
  if(c.hunger>0||G.game.res.food<pop*G.LIFE.eatPerDay*8||G.game.res.ale<=w.citizens.filter(G.isLeisureVisitor).length)return false;
  if(w.bmap[c.job]?.type==='hospital'&&w.citizens.some(G.isSick))return false;
  const taverns=w.buildings.filter(b=>b.type==='tavern'&&b.id!==c.job&&b.state==='ok'&&G.tavernStaff(b)&&G.tavernVisitors(b).length<G.LEISURE.capacity&&G.d2(c.x,c.y,b.x,b.y)<=24*24)
    .sort((a,b)=>G.d2(c.x,c.y,a.x,a.y)-G.d2(c.x,c.y,b.x,b.y));
  for(const b of taverns){
    const spot=G.workSpot(w,b,c.x,c.y,true);if(!spot||spot.route.eta>G.LEISURE.maxTravelHours)continue;
    c.task={kind:'leisure',b,tx:spot.x,ty:spot.y,work:G.LEISURE.hours,workLeft:G.LEISURE.hours,waitingH:0};
    if(G.sendTo(c,spot.x,spot.y,spot.route))return true;
  }
  c.leisureRetryH=G.LEISURE.retryHours;return false;
};
G.stepLeisure=function(c,dtH){
  if(!G.validLeisureTask(c)||!G.atMedicalDoor(c,c.task.b)||G.d2(c.x,c.y,c.task.tx,c.task.ty)>.04){G.cancelLeisure(c);return;}
  const t=c.task;
  if(!G.tavernStaff(t.b)){t.waitingH+=dtH;if(t.waitingH>=4)G.cancelLeisure(c);return;}
  if(G.game.res.ale<1){G.cancelLeisure(c);return;}
  t.waitingH=0;t.workLeft-=dtH;if(t.workLeft>0)return;
  G.game.res.ale--;c.leisureDays=G.LEISURE.days;c.happiness=Math.min(5,(c.happiness||3)+.4);
  G.cancelLeisure(c);G.game.schedT=0;G.requestTask(c);
};
G.tavernSummary=function(b){
  const s=G.tavernBrewStatus(b),cs=G.world.citizens;
  return {...s,canBrew:s.ok,visitors:G.tavernVisitors(b).length,ale:G.game.res.ale,
    workers:b.workers.filter(id=>G.world.cmap[id]&&!G.world.cmap[id].dead).length,onDuty:G.tavernStaff(b),
    capacity:G.LEISURE.capacity,eligibleAdults:cs.filter(c=>!c.dead&&c.adult&&c.age>=18).length,batchGrain:30,batchAle:3,workHours:6,aleLimit:G.productionGoalOf('ale')??30};
};

/* Ordinary clothes remain the legacy stock. Warm coats are an optional
 * wool-and-leather upgrade, not a second food group or indoor heating source. */
G.clothingTypeOf=c=>!(c.clothingLeft>0)?'none':c.clothingType==='warm'?'warm':'basic';
G.clothingColdMul=c=>({none:1,basic:.6,warm:.3})[G.clothingTypeOf(c)];
G.wearClothing=function(c){
  c.clothingLeft=Math.max(0,(c.clothingLeft||0)-1);
  if(c.clothingLeft>0)return;
  c.clothingType=null;
  const type=G.game.res.warmCoats>=1?'warmCoats':G.game.res.clothes>=1?'clothes':null;
  if(!type)return;
  G.game.res[type]--;c.clothingType=type==='warmCoats'?'warm':'basic';c.clothingLeft=G.YEAR_DAYS;
};
G.taskIngredients=t=>!t.consume?[]:Array.isArray(t.consume)?t.consume:[t.consume];
G.tailorRecipeOf=b=>b.coatRecipe==='warm'?'warm':'basic';
G.tailorOutput=b=>G.tailorRecipeOf(b)==='warm'?'warmCoats':'clothes';
G.tailorProductionStatus=function(b){
  const r=G.game.res,output=G.tailorOutput(b),warm=output==='warmCoats';
  const material=r.leather>=2?'leather':r.wool>=2?'wool':'leather';
  const materials=warm?[{type:'leather',qty:2},{type:'wool',qty:2}]:[{type:material,qty:2}];
  let reason='材料齐备，可接新批次';
  if(G.goalPaused(output))reason=`${G.RES[output].name}目标已达，暂停新批次`;
  else if(r[output]>=G.storageCap())reason=`${G.RES[output].name}仓容已满`;
  else if(materials.some(item=>r[item.type]<item.qty))reason=warm?'保暖外套缺料：每批同时需要2皮革+2羊毛':'普通衣缺料：每批需要2皮革或2羊毛';
  else return {ok:true,reason,materials};
  return {ok:false,reason,materials};
};
G.setCoatRecipe=function(b,recipe){
  if(!b||G.world.bmap[b.id]!==b||b.type!=='tailor'||b.state!=='ok'||!['basic','warm'].includes(recipe))return false;
  b.coatRecipe=recipe;b.noWork=false;b.warnText='';G.updateProductionGoals();G.game.schedT=0;return true;
};
G.tailorSummary=function(b){
  const s=G.tailorProductionStatus(b),batches=[],seen=new Set(),wearers={basic:0,warm:0,ragged:0};
  for(const c of G.world.citizens){
    if(!c.dead)wearers[({none:'ragged',basic:'basic',warm:'warm'})[G.clothingTypeOf(c)]]++;
    for(const task of [c.task,c.pausedTask]){
      if(!task||task.b!==b||!task.yield||!['clothes','warmCoats'].includes(task.yield.type)||seen.has(task))continue;
      seen.add(task);batches.push({type:task.yield.type,qty:task.yield.qty,phase:task===c.pausedTask?'paused':task.phase||'work',carrier:c.name});
    }
    if(c.job===b.id&&c.carry&&['clothes','warmCoats'].includes(c.carry.type))batches.push({type:c.carry.type,qty:c.carry.qty,phase:'haul',carrier:c.name});
  }
  return {recipe:G.tailorRecipeOf(b),output:G.tailorOutput(b),materials:s.materials,canProduce:s.ok,reason:s.reason,batches,
    clothes:G.game.res.clothes,warmCoats:G.game.res.warmCoats,wearers};
};


/* Crop diversity stays inside the three existing food classes. Selection is
 * next-season intent; a started field and its cargo keep the actual crop. */
G.CROPS={wheat:{name:'小麦',output:'grain'},cabbage:{name:'卷心菜',output:'vegetables'}};
G.seedUnlockKey=good=>good==='orchardSeed'?'orchard':good==='cabbageSeed'?'cabbage':null;
G.seedTradeReason=function(good,qty){
  const key=G.seedUnlockKey(good);if(!key)return '';
  if(G.game.unlocks[key])return `${G.TRADE_GOODS[good].name}已永久解锁，无需重复购买`;
  return qty!==1?'种子只需购买1份，永久解锁所有对应农田或果园':'';
};
G.cropUnlocked=type=>type==='wheat'||(type==='cabbage'&&G.game.unlocks.cabbage===true);
G.farmCropOf=b=>b.cropType==='cabbage'?'cabbage':'wheat';
G.cropChoiceOf=b=>b.cropChoice==='cabbage'?'cabbage':'wheat';
G.farmOutput=b=>G.CROPS[G.farmCropOf(b)].output;
G.farmTaskCurrent=function(t){
  const b=t&&t.b,g=G.game;
  if(!b||G.world.bmap[b.id]!==b||b.type!=='farm'||b.state!=='ok'||!b.farm[t.ti]||
    (t.crop&&t.crop!==G.farmCropOf(b))||(t.cropYear!==undefined&&t.cropYear!==g.year))return false;
  return t.kind==='sow'?(g.season===0||g.season===1):t.kind==='harvest'&&g.season===2&&b.sownAll&&b.growth>=1&&!b.harvestDone;
};
G.setFarmCrop=function(b,type){
  if(!b||G.world.bmap[b.id]!==b||b.type!=='farm'||b.state!=='ok'||!Object.hasOwn(G.CROPS,type)||!G.cropUnlocked(type))return false;
  // An outstanding first sow counts even for older runtime tasks without a flag.
  if(G.world.citizens.some(c=>[c.task,c.pausedTask].some(t=>t&&t.b===b&&t.kind==='sow')))b.sowingCommitted=true;
  b.cropChoice=type;
  if(!G.farmSeasonCommitted(b)&&(G.game.season===0||G.game.season===1))b.cropType=type;
  b.noWork=false;b.warnText='';G.updateProductionGoals();G.game.schedT=0;return true;
};
G.farmSummary=function(b){
  const crop=G.farmCropOf(b),choice=G.cropChoiceOf(b),committed=G.farmSeasonCommitted(b),g=G.game;
  const sown=b.farm.filter(f=>f.sown).length,harvested=b.farm.filter(f=>f.harvested).length;
  let status=g.season===3?'冬季休耕，等待下一春':b.harvestDone?'本季收获完成':!b.sownAll?
    (g.season===2?'秋季已过播种窗口':G.goalPaused(G.farmOutput(b))&&!committed?'目标已达，暂停新季播种':`播种 ${sown}/${b.farm.length}`):
    b.growth<1?`生长中 ${Math.floor(b.growth*100)}%`:g.season===2?`秋收 ${harvested}/${b.farm.length}`:'作物成熟，等待秋季';
  const reason=committed?'本季已开始：只改下一春，不改变已接任务、在田作物或在途收获':
    g.season===0||g.season===1?'空田尚未开始：已解锁作物可用于本季播种':'当前不能播种：选择留待下一春';
  return {crop,choice,output:G.CROPS[crop].output,choiceOutput:G.CROPS[choice].output,pending:crop!==choice,committed,
    unlocked:{wheat:true,cabbage:G.cropUnlocked('cabbage')},status,reason,growth:b.growth,sown,harvested,total:b.farm.length,
    grain:g.res.grain,vegetables:g.res.vegetables,workers:b.workers.filter(id=>G.world.cmap[id]&&!G.world.cmap[id].dead&&G.world.cmap[id].job===b.id).length};
};
