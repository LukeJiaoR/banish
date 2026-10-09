'use strict';
/* ============================================================
 * sim.js —— 游戏状态、时间、市民 AI、职业调度、经济与生死
 * ============================================================ */

G.newGameState = function () {
  return {
    h: 6, day: 0, season: 0, year: 1,
    speed: 1, paused: false,
    res: { wood: 80, stone: 48, iron: 0, tools: 15, food: 500, firewood: 50 }, // 开局（原版中难度 5 家庭，工具 15 件≈第一轮磨损周期）；存粮较原版加厚：15 人 6 天食物跑道撑不到第一座采集屋建成
    schedT: 1,
    over: false,
    stats: { born: 0, died: 0, deadReasons: {} },
    prevFood: 200,
    foodNet: 0,
    foodUrgent: false,
    warned: {},
    hist: [],       // 每日摘要环形缓冲（末 60 条）：反馈快照的时间维度，复盘/分析用
    buildLog: [],   // 最近 30 次建造/拆除（负号前缀 = 拆除）
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
  let food = g.res.food;
  const sorted = w.citizens.slice().sort((a, b) => (a.age >= G.ADULT_AGE && !a.student ? 1 : 0) - (b.age >= G.ADULT_AGE && !b.student ? 1 : 0));
  for (const c of sorted) {
    if (food >= eat) { food -= eat; c.hunger = 0; }
    else c.hunger++;
  }
  g.res.food = food;

  const winter = g.season === 3;
  // ---- 工具磨损：每个成人每天磨损 1/toolLifeDays 把；用尽则全员生产减半 ----
  const adultsNow = w.citizens.filter(c => !c.dead && c.adult).length;
  if (g.res.tools > 0) {
    g.toolWear = (g.toolWear || 0) + adultsNow / G.LIFE.toolLifeDays;
    while (g.toolWear >= 1 && g.res.tools > 0) { g.toolWear -= 1; g.res.tools -= 1; }
    if (g.res.tools <= 0) g.toolWear = 0; // 恰好磨完最后一把：清掉陈旧累积，别把新打的第一件工具秒扣掉
  } else g.toolWear = 0;
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
  const toolDays = g.res.tools * G.LIFE.toolLifeDays / Math.max(1, adultsNow);
  if (pop > 0 && g.res.tools > 0 && toolDays <= G.YEAR_DAYS && !g.warned.toolsLow) {
    g.warned.toolsLow = true;
    G.ui.toast(`⚠ 工具约够 ${Math.floor(toolDays)} 天，尽早备好铁匠铺与铁矿；近矿耗尽时需向外找矿`, 'warn');
  }
  if (toolDays > G.YEAR_DAYS * 1.5) g.warned.toolsLow = false;
  if (pop > 0 && !g.warned.noTools && g.res.tools <= 0) {
    g.warned.noTools = true;
    G.ui.toast('⚠ 工具用尽，生产减半——尽快建铁匠铺打工具（1铁+2木→2件）', 'bad');
  }
  if (g.res.tools > 0) g.warned.noTools = false;
  if (g.warned.storageFull) { // 满仓提示在腾出空间后复位
    const fullest = Math.max(...G.RES_KEYS.filter(k => k !== 'tools').map(k => g.res[k]));
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
      if (b.type === 'farm' && b.state === 'ok') G.resetFarm(b);
    }
  }
  if (to === 3) {
    // 未收获的作物冻死
    for (const b of G.world.buildings) {
      if (b.type === 'farm' && b.sownAll && !b.harvestDone) {
        G.ui.toast('农田里的作物被冻死了', 'bad');
        G.resetFarm(b);
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
  // 没有空独栋：无房家庭入住宿舍（原版 Boarding House 最多 5 家）
  const boardings = w.buildings.filter(b => b.type === 'boarding' && b.state === 'ok');
  if (boardings.length) {
    for (const fam of homeless) {
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
    if (couple.length !== 2 || couple.some(c => !c || c.dead || c.student || c.familyId !== fam.id || !fam.members.includes(c.id))) continue;
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
    job: null, task: null, carry: null, pausedTask: null,
    student: false, educated: false, school: null,
    state: 'idle', walkKind: '', path: null, pi: 0, camped: false,
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
  if (p.length === 0) { c.state = 'work'; if (c.task && !(c.task.workLeft > 0)) c.task.workLeft = c.task.work; }
  else { c.state = 'walk'; c.walkKind = 'task'; }
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
  const p = G.findPath(G.world, Math.round(c.x), Math.round(c.y), spot ? spot.x : h.x, spot ? spot.y : h.y);
  if (p && p.length) { c.path = p; c.pi = 0; c.state = 'walk'; c.walkKind = 'home'; c.camped = false; }
  else if (p) { c.path = null; c.state = 'rest'; c.camped = false; } // 已站在家门口：算回家了（空路径 ≠ 找不到路）
  else { c.path = null; c.state = 'rest'; c.camped = true; }        // 真找不到路也只能露宿
};

/* 天亮续接昨晚挂起的任务；目标已失效（树被砍/建筑拆了/换岗位）则放弃 */
G.resumeTask = function (c) {
  const t = c.pausedTask;
  c.pausedTask = null;
  if (!t) return false;
  const w = G.world;
  // 有建筑的任务要求仍在原岗位；无建筑任务 = 散工砍标记树，只看树还在不在
  let ok = t.b ? (c.job != null && w.bmap[c.job] === t.b) : (t.kind === 'chop' || t.kind === 'clearrock');
  if (ok && t.kind === 'chop') {
    const idx = w.treeIdx[t.ty * w.N + t.tx];
    ok = idx >= 0 && w.trees[idx] === t.tree;   // 同一棵树还在（防止重种/互换后误续）
  } else if (ok && t.kind === 'clearSite') {
    const idx = w.treeIdx[t.tree.y * w.N + t.tree.x];
    ok = t.b.state === 'site' && idx >= 0 && w.trees[idx] === t.tree;
  } else if (ok && t.kind === 'clearrock') {
    ok = w.rock[t.ty * w.N + t.tx] === t.rock;
  } else if (ok && t.kind === 'plant') {
    const i = t.ty * w.N + t.tx;
    ok = !w.water[i] && !w.rock[i] && !w.road[i] && w.treeIdx[i] < 0 && w.bgrid[i] < 0;
  } else if (ok && t.kind === 'sow') {
    ok = !!(t.b.farm && t.b.farm[t.ti] && !t.b.farm[t.ti].sown);
  } else if (ok && t.kind === 'harvest') {
    ok = !!(t.b.farm && t.b.farm[t.ti] && t.b.farm[t.ti].sown && !t.b.farm[t.ti].harvested);
  } else if (ok && t.kind === 'firewood') {
    ok = t.b.state === 'ok';
  } else if (ok && t.kind === 'build') {
    ok = t.b.state === 'site';
  }
  if (!ok) return false;
  c.task = t;
  c.state = 'idle';
  G.sendTo(c, t.tx, t.ty); // sendTo/arrive 只在 workLeft 为 0 时才重置满工时
  return true;
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
  const w = G.world;
  const stores = w.buildings.filter(b => b.type === 'storage' && b.state === 'ok')
    .sort((a, b) => G.d2(x, y, a.x + a.w / 2, a.y + a.h / 2) - G.d2(x, y, b.x + b.w / 2, b.y + b.h / 2));
  for (const storage of stores) {
    const spots = [];
    for (let sy = storage.y - 1; sy <= storage.y + storage.h; sy++)
      for (let sx = storage.x - 1; sx <= storage.x + storage.w; sx++)
        if ((sx < storage.x || sx >= storage.x + storage.w || sy < storage.y || sy >= storage.y + storage.h) && !G.tileBlocked(w, sx, sy))
          spots.push({ x: sx, y: sy });
    spots.sort((a, b) => G.d2(x, y, a.x, a.y) - G.d2(x, y, b.x, b.y));
    for (const spot of spots) {
      const path = G.findPath(w, Math.round(x), Math.round(y), spot.x, spot.y);
      if (path) return { storage, spot, path };
    }
  }
  return null;
};

/* 开始搬运去仓库 */
G.startHaul = function (c) {
  if (!G.nearestStorage(c.x, c.y)) { // 兼容旧的无仓存档：仍受仓储上限约束
    G.deposit(c.carry.type, c.carry.qty);
    c.carry = null;
    G.requestTask(c);
    return;
  }
  const route = G.storageRoute(c.x, c.y);
  if (!route) { c.task = null; c.path = null; c.state = 'idle'; c.wanderT = 2; return; }
  c.haulTo = route.storage.id;
  c.path = route.path; c.pi = 0; c.task = null;
  if (!c.path.length) {
    G.deposit(c.carry.type, c.carry.qty);
    c.carry = null;
    G.requestTask(c);
  } else c.state = 'haul';
};

/* 燃料上限（原版 Wood Cutter 的 Fuel Limit）：柴火库存达到上限即停产；旧档/测试无该字段时用默认值 */
G.fuelLimitOf = function (b) { return Number.isFinite(b.fuelLimit) ? G.clamp(b.fuelLimit, 0, G.PROD.woodcutter.fuelMax) : G.PROD.woodcutter.fuelLimit; };
G.fuelLimited = function (b) { return b.type === 'woodcutter' && G.game.res.firewood >= G.fuelLimitOf(b); };
G.toolLimitOf = function (b) { return Number.isFinite(b.toolLimit) ? G.clamp(b.toolLimit, 0, G.PROD.blacksmith.toolMax) : G.PROD.blacksmith.toolLimit; };
G.toolLimited = function (b) { return b.type === 'blacksmith' && G.game.res.tools >= G.toolLimitOf(b); };
G.productionLimited = function (b) { return G.fuelLimited(b) || G.toolLimited(b); };

/* 仓储上限：每座（建成的）仓库 +STORAGE_CAP，至少按 1 座计 */
G.storageCap = function () {
  const n = G.world.buildings.filter(b => b.type === 'storage' && b.state === 'ok').length;
  return G.STORAGE_CAP * Math.max(1, n);
};

/* 入库：受仓储上限约束，满仓部分丢弃并提示（工具随身小件不受限） */
G.deposit = function (type, qty) {
  const g = G.game;
  if (type === 'tools') { g.res.tools += qty; return qty; }
  const space = Math.max(0, G.storageCap() - g.res[type]);
  const got = Math.min(qty, space);
  g.res[type] += got;
  if (got < qty && !g.warned.storageFull) {
    g.warned.storageFull = true;
    G.ui.toast('⚠ 仓库满了，多出的资源只能丢弃——再建一座仓库吧', 'warn');
  }
  return got;
};

/* 背料到达仓库：转入回屋加工段。返回 false = 仓库没料（白跑） */
G.firewoodFetchDone = function (c, t) {
  if (G.game.res[t.consume.type] < t.consume.qty) return false;
  const spot = G.workSpot(G.world, t.b, c.x, c.y);
  if (!spot) return false;
  t.phase = 'work';
  t.tx = spot.x; t.ty = spot.y;
  t.workLeft = t.work;
  c.task = t;   // completeTask 入口会清空任务，续段要挂回去
  c.state = 'idle';
  G.sendTo(c, t.tx, t.ty);
  return true;
};

/* 受冻（原版双侧模型）：冬季户外累积寒冷，回到烧着柴的家里恢复；
 * 冷屋挡风但没柴火，屋内缓慢累积；露宿/无房者整夜在外照常累积。
 * 速率常量为「处于该状态每满 24 小时」的量，按实际小时数折算；非冬季持续回暖清零 */
G.coldStep = function (c, dtH) {
  if (!G.isWinter()) { c.cold = 0; return; }
  const childMul = c.age < G.ADULT_AGE ? G.LIFE.coldChildMul : 1;
  if (c.state === 'rest' && !c.camped) {
    const home = G.homeOf(c);
    if (home && home.state === 'ok') {
      if (!home.unheated) { c.cold = Math.max(0, c.cold - dtH * G.LIFE.warmRecover / 24); return; }
      c.cold += dtH * G.LIFE.coldIndoors / 24 * childMul; // 冷屋挡风但不取暖
      return;
    }
  }
  c.cold += dtH * G.LIFE.coldOutdoor / 24 * childMul;
};

/* 市民每帧步进 */
G.stepCitizen = function (c, dtH) {
  if (c.dead) return;
  G.coldStep(c, dtH);
  if (c.state === 'rest') {
    if (!G.isRestTime()) {
      c.state = 'idle';
      if (!G.resumeTask(c)) c.wanderT = 0.5 + G.rng() * 2; // 天亮起床：先接着干昨晚的活
    }
    return;
  }
  // 深夜：回家睡觉（正在搬货的先送完这趟）
  if (G.isRestTime() && c.state !== 'haul' && !(c.state === 'walk' && c.walkKind === 'home')) {
    G.goHome(c);
    if (c.state === 'rest') return;
  }
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
      if (c.task.b && c.task.b.state === 'site') c.task.b.constructionStarted = true;
      c.task.workLeft -= dtH;
      c.animT += dtH * 12;
      if (c.task.workLeft <= 0) G.completeTask(c);
      return;
    }
    default: { // idle
      c.wanderT -= dtH;
      if (c.wanderT <= 0) {
        c.wanderT = 2 + G.rng() * 5;
        if (c.age >= G.ADULT_AGE) G.requestTask(c); // 有岗位的接活；无业散工顺路处理「砍伐」标记
        else G.wander(c);
      }
    }
  }
};

G.arrive = function (c) {
  c.path = null;
  if (c.state === 'haul') {
    if (c.carry) {
      G.deposit(c.carry.type, c.carry.qty);
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
G.requestTask = function (c) {
  c.task = null;
  if (G.isRestTime()) { G.goHome(c); return; } // 深夜不接受新任务
  const w = G.world;
  const b = c.job != null ? w.bmap[c.job] : null;
  // 换岗/任务中断后先交货；农田未满批可继续收割，找不到下一格时也必须交货。
  if (c.carry && (!b || b.type !== 'farm' || b.state !== 'ok' || c.carry.type !== 'food' || c.carry.qty >= G.PROD.farm.haulCap)) {
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
    const mr = G.pickMarkedRock(w, c.x, c.y, claimedR);
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
        G.sendTo(c, spot.x, spot.y); return;
      }
      c.state = 'idle'; c.wanderT = 2; return; // 其余树已有人砍，不能提前建造。
    }
    if (b.workLeft <= 0) { G.finishBuilding(b); c.state = 'idle'; return; }
    const spot = G.workSpot(w, b, c.x, c.y) || { x: b.x, y: b.y };
    c.task = {
      kind: 'build', b, tx: spot.x, ty: spot.y,
      work: Math.min(G.taskWork(c, G.PROD.builderChunk), b.workLeft),
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
  const m = G.game.res.tools > 0 ? 1 : G.NO_TOOL_MULT;
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

/* 按建筑类型生成任务 */
G.makeTask = function (b, c) {
  const P = G.PROD, g = G.game, w = G.world;
  switch (b.type) {
    case 'woodcutter': {
      if (G.fuelLimited(b)) { // 燃料上限：库存够用时自动停工（原版 Fuel Limit）
        b.noWork = true; b.warnText = '柴火已达上限';
        return null;
      }
      if (g.res.wood >= P.woodcutter.logsIn) {
        const spot = G.workSpot(w, b, c.x, c.y);
        if (!spot) return null;
        // 两段式（原版）：先去仓库背原木，回伐木屋加工，产出再背回仓库；没仓库就就地加工
        const st = G.nearestStorage(c.x, c.y);
        const route = st ? G.storageRoute(c.x, c.y) : null;
        if (st && !route) { b.noWork = true; b.warnText = '仓库不可达'; return null; }
        const target = route ? route.spot : spot;
        return {
          kind: 'firewood', b, tx: target.x, ty: target.y, phase: st ? 'fetch' : 'work',
          work: P.woodcutter.workH, workLeft: 0,
          consume: { type: 'wood', qty: P.woodcutter.logsIn },
          // 原版：受教育工人 1 原木出 4 柴火（配比加成，而非提速）
          yield: { type: 'firewood', qty: G.taskYield(c.educated ? P.woodcutter.logsIn * P.woodcutter.eduFirewoodPerLog : P.woodcutter.firewoodOut) },
        };
      }
      b.noWork = true; b.warnText = '缺木材';
      return null;
    }
    case 'forester': {
      const R = P.forester.radius;
      // 砍倒即原地补种（原版护林人的可持续轮伐）：砍+种合并为一个任务，
      // 采伐区稳定在屋旁成熟林带；圈 内无成熟树时才单独补种育林
      const plantTask = () => {
        // 同屋工人在种的坑不再重复认领（防止多人挤同一个点白跑）
        const claimed = new Set();
        for (const c2 of w.citizens)
          if (c2 !== c && c2.task && c2.task.kind === 'plant' && c2.task.b === b) claimed.add(c2.task.ty * w.N + c2.task.tx);
        const spot = G.nearestPlantSpot(w, b.x, b.y, R, claimed);
        return spot ? { kind: 'plant', b, tx: spot.x, ty: spot.y, work: G.taskWork(c, P.forester.plantH), workLeft: 0 } : null;
      };
      if (b.doCut) { // 砍伐成熟树（面板可开关，原版 Forester 的 Cut 选项）
        const trees = G.treesInRadius(w, b.x, b.y, R, true).filter(t => w.bgrid[t.i] < 0);
        // 成熟树存量低于下限就停砍育林：防止清穿森林（也会拖垮同址采集小屋），等补种长回来
        if (trees.length > P.forester.minMature) {
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
          if (best) return {
            kind: 'chop', b, tx: best.x, ty: best.y, tree: best, logs: G.taskYield(G.taskLogYield(c)),
            // 砍+原地补种合并（补种耗时会加进工时；关补种则只砍不种，森林会被清光）
            replant: b.doPlant,
            work: G.taskWork(c, P.forester.workH + (b.doPlant ? P.forester.plantH : 0)), workLeft: 0,
          };
        }
      }
      if (b.doPlant) { // 补种（原版 Plant 选项；无成熟树可砍时育林）
        const t = plantTask();
        if (t) return t;
      }
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
      const t = trees[G.ri(0, trees.length - 1)];
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
      return {
        kind: 'work', b, tx: spot.x, ty: spot.y,
        work: G.taskWork(c, P.dock.workH), workLeft: 0, yield: { type: P.dock.yield.type, qty },
      };
    }
    case 'mine': {
      const spot = G.workSpot(w, b, c.x, c.y);
      if (!spot) return null;
      // 满仓不白挖：石铁都到仓储上限就停工；只有一项满仓时改为专采另一项
      const cap = G.storageCap();
      const stoneFull = g.res.stone >= cap, ironFull = g.res.iron >= cap;
      if (stoneFull && ironFull) {
        b.noWork = true; b.warnText = '仓库已满';
        return null;
      }
      // 每 ironEvery 趟出 1 趟铁，其余采石（深井矿脉不枯竭）
      b.mineTick = (b.mineTick || 0) + 1;
      let ironTurn = b.mineTick % P.mine.ironEvery === 0;
      if (stoneFull && !ironTurn) ironTurn = true;
      else if (ironFull && ironTurn) ironTurn = false;
      return {
        kind: 'work', b, tx: spot.x, ty: spot.y,
        work: G.taskWork(c, P.mine.workH), workLeft: 0,
        yield: { type: ironTurn ? 'iron' : 'stone', qty: G.taskYield(P.mine.yield) },
      };
    }
    case 'blacksmith': {
      if (G.toolLimited(b)) { b.noWork = true; b.warnText = '工具已达上限'; return null; }
      const spot = G.workSpot(w, b, c.x, c.y);
      if (!spot) return null;
      const cons = P.blacksmith.consume;
      if (cons.some(c2 => g.res[c2.type] < c2.qty)) {
        b.noWork = true; b.warnText = '缺铁或木材';
        return null;
      }
      // 1铁+2木 → 2 件工具（受教育 3）；铁匠抡锤不用工具，不吃减产
      return {
        kind: 'work', b, tx: spot.x, ty: spot.y,
        work: G.taskWork(c, P.blacksmith.workH), workLeft: 0,
        consume: cons,
        yield: { type: 'tools', qty: c.educated ? P.blacksmith.eduToolsOut : P.blacksmith.toolsOut },
      };
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
        const d = G.d2(b.x, b.y, t2.x, t2.y) + G.rng() * 8;
        if (d < bd) { bd = d; best = t2; }
      }
      return {
        kind: 'work', b, tx: best.x, ty: best.y,
        work: G.taskWork(c, P.hunting.workH), workLeft: 0, yield: { type: 'food', qty },
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
      if (!b.sownAll && (g.season === 0 || g.season === 1)) {
        const ti = b.farm.findIndex((f, i) => !f.sown && !claimed.has(i));
        if (ti >= 0) {
          const f = b.farm[ti];
          return { kind: 'sow', b, ti, tx: f.x, ty: f.y, work: G.taskWork(c, P2.tileWorkH), workLeft: 0 };
        }
      }
      // 收获（秋，作物长成）
      if (b.sownAll && b.growth >= 1 && g.season === 2 && !b.harvestDone) {
        const ti = b.farm.findIndex((f, i) => f.sown && !f.harvested && !claimed.has(i));
        if (ti >= 0) {
          const f = b.farm[ti];
          return { kind: 'harvest', b, ti, tx: f.x, ty: f.y, work: G.taskWork(c, P2.tileWorkH), workLeft: 0 };
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
        c.carry = { type: 'wood', qty: t.logs || G.TREE_LOGS };
        G.recordProduction(t.b, 'wood', t.logs || G.TREE_LOGS);
        if (t.replant && t.b && t.b.doPlant) G.addTree(G.world, t.tx, t.ty); // 砍倒即原地补种
      }
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
    case 'work': {
      if (t.consume) {
        const cons = Array.isArray(t.consume) ? t.consume : [t.consume];
        if (cons.some(c2 => G.game.res[c2.type] < c2.qty)) break; // 材料在干活的这几个小时里被同行用掉，本次白干
        for (const c2 of cons) G.game.res[c2.type] -= c2.qty;
      }
      if (t.yield) c.carry = { type: t.yield.type, qty: t.yield.qty };
      break;
    }
    case 'firewood': {
      if (t.phase === 'fetch') {
        // 到仓库背料：有料转入加工段（木料在完工时才扣）；没料则白跑一趟
        if (!G.firewoodFetchDone(c, t)) break;
        return;
      }
      if (G.game.res[t.consume.type] < t.consume.qty) break; // 加工期间料被挪用，这趟白干
      G.game.res[t.consume.type] -= t.consume.qty;
      c.carry = { type: 'firewood', qty: t.yield.qty };
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
      if (t.b && t.b.farm && t.b.farm[t.ti] && !t.b.farm[t.ti].harvested) {
        t.b.farm[t.ti].harvested = true;
        // 攒批搬运：收获累计到 haulCap 才送一趟仓库
        const P = G.PROD.farm;
        if (c.carry && c.carry.type === 'food') c.carry.qty = Math.min(P.haulCap, c.carry.qty + G.taskYield(P.perTile));
        else c.carry = { type: 'food', qty: G.taskYield(P.perTile) };
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
  c.job = null; c.task = null; c.pausedTask = null;
  if (c.carry) { G.startHaul(c); return; } // 手上的货先送仓，不烂在身上
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
  const adultsOf = (b) => b.workers.map(id => w.cmap[id]).filter(c => c && !c.dead && c.adult);
  for (const b of staffed) {
    const xs = adultsOf(b);
    if (xs.length > G.BDEF[b.type].jobs) return xs[0]; // 超员
  }
  for (const b of staffed)
    if (G.productionLimited(b)) return adultsOf(b)[0];
  const cap = G.storageCap();
  for (const b of staffed)
    if (b.type === 'mine' && G.game.res.stone >= cap && G.game.res.iron >= cap) return adultsOf(b)[0];
  if (!harvestSeason)
    for (const b of staffed)
      if (b.type === 'farm' && b.sownAll) return adultsOf(b)[0]; // 已播完种的农田；播种进行中不抽（否则秋收窗口顺延）
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
  return (!b.sownAll && (season === 0 || season === 1)) ||
    (b.sownAll && b.growth >= 1 && season === 2 && !b.harvestDone);
};

/* 纯读的派工前置检查，避免为缺料/停用岗位取消正在干活的粮工。 */
G.jobCanProduce = function (b) {
  const w = G.world, r = G.game.res, p = G.PROD;
  if (G.productionLimited(b)) return false;
  if (b.type === 'farm') return G.farmHasWork(b);
  if (b.type === 'woodcutter') return r.wood >= p.woodcutter.logsIn;
  if (b.type === 'blacksmith') return p.blacksmith.consume.every(c => r[c.type] >= c.qty);
  if (b.type === 'forester') return (b.doCut && G.treesInRadius(w, b.x, b.y, p.forester.radius, true).length > p.forester.minMature) ||
    (b.doPlant && !!G.nearestPlantSpot(w, b.x, b.y, p.forester.radius));
  if (b.type === 'gatherer') return G.treesInRadius(w, b.x, b.y, p.gatherer.radius, false).length >= p.gatherer.needTrees;
  if (b.type === 'hunting') return G.treesInRadius(w, b.x, b.y, p.hunting.radius, true).length >= p.hunting.needTrees;
  if (b.type === 'mine') return r.stone < G.storageCap() || r.iron < G.storageCap();
  return true;
};

G.scheduleJobs = function () {
  const w = G.world;
  for (const b of w.buildings) {
    // 在重新探测岗位前先释放确实没活的闲人；旧逻辑每2h清旗，导致每日释放永远看不到它。
    if (b.noWork) for (const id of b.workers.slice()) {
      const c = w.cmap[id];
      if (c && !c.task && !c.pausedTask && c.state !== 'haul') G.releaseWorker(c);
    }
    b.noWork = false;
    if (b.type === 'farm' && b.state === 'ok' && !G.farmHasWork(b))
      for (const id of b.workers.slice()) { const c = w.cmap[id]; if (c) G.releaseWorker(c); }
  }
  const jobless = () => w.citizens.filter(c => !c.dead && c.adult && c.job == null);
  // 「砍伐」/「清除岩石」标记需要散工处理：预留 1-2 名无业成人（不够则稍后从闲余岗位抽调）
  w.markReachability = Object.assign(G.reachableMarks(w), { day: G.game.day, h: G.game.h,
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
  const isFood = b => b && b.state === 'ok' && FOOD_JOBS.includes(b.type) && (b.type !== 'farm' || G.farmHasWork(b));
  const foodCount = () => w.citizens.filter(c => c.adult && !c.dead && isFood(w.bmap[c.job])).length;
  if (G.game.foodUrgent) {
    // 已占满的工地也必须能回补粮岗；只保护尚可工作的食物建筑，不空留人。
    const foodBuildings = w.buildings.filter(isFood).filter(b => {
      if (b.type === 'gatherer') return G.treesInRadius(w, b.x, b.y, G.PROD.gatherer.radius, false).length >= G.PROD.gatherer.needTrees;
      if (b.type === 'hunting') return G.treesInRadius(w, b.x, b.y, G.PROD.hunting.radius, true).length >= G.PROD.hunting.needTrees;
      return true;
    });
    for (const b of foodBuildings) {
      let guard = 0;
      while (b.workers.length < G.BDEF[b.type].jobs && foodCount() < needFood && guard++ < 4) {
        const free = jobless();
        let c = free.length > wantLabor ? G.pickNearest(free, b) : null;
        if (!c) {
          const donors = w.citizens.filter(c2 => {
            const job = w.bmap[c2.job];
            if (!c2.adult || c2.dead || !job || isFood(job) || job.type === 'school') return false;
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
          if (ci.dead || !ci.adult || ci.job == null) return false;
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
    if (G.productionLimited(b)) continue; // 柴火/工具达到上限的岗位不拉人，空闲者留给「砍伐」标记
    let guard = 0;
    while (b.workers.length < def.jobs && guard++ < 6) {
      const pool = jobless();
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
    if (jobless().length > wantLabor) break; // 只有非预留散工才由第二优先处理；标记散工不能阻断再平衡
    // 从供体岗位抽人：优先抽当下正闲置的那个（别的工人还在干活）
    const give = (x) => {
      let idx = x.workers.length - 1;
      const lazyIdx = x.workers.findIndex(id => { const c = w.cmap[id]; return c && c.state === 'idle' && !c.task; });
      if (lazyIdx >= 0) idx = lazyIdx;
      const c = w.cmap[x.workers[idx]];
      if (c) { G.releaseWorker(c); G.assignWorker(b, c); }
    };
    // 供体 1：非收获季且已播完种的农田（播种进行中不抽，否则秋收窗口顺延）
    if (!harvestSeason) {
      const farm = w.buildings.find(x => x.type === 'farm' && x.state === 'ok' && x.sownAll && x.workers.length > 0);
      if (farm) { give(farm); return; }
    }
    // 供体 2：有闲置工人的岗位（工人正闲着就是临时富余；粮食岗至少留 1 人。
    // 旧实现要求「全员闲置」——那种时刻几乎不会同时出现，抽调链一断，
    // 关键岗位（伐木屋）会永久 0 工人，柴火归零冻死人）
    const lazy = w.buildings.find(x => x !== b && x.state === 'ok' && G.BDEF[x.type].jobs > 0 && x.workers.length > 0
      && x.type !== 'school' // 教师不外借，保证学堂开学
      && (!FOOD_SET.includes(x.type) || (x.workers.length > 1 && (FOOD_JOBS.includes(b.type) || foodWorkerCount() > needFood)))
      && x.workers.some(id => { const c = w.cmap[id]; return c && c.state === 'idle' && !c.task; }));
    if (lazy) { give(lazy); return; }
    // 关键空岗不能永远等粮工碰巧idle：采集任务完工会直接接下一趟，正常忙碌不是不可抽调。
    if (b.workers.length === 0 && ['woodcutter', 'blacksmith', 'farm', 'forester'].includes(b.type) && foodWorkerCount() > needFood) {
      const surplus = w.buildings.find(x => x !== b && x.state === 'ok' && FOOD_JOBS.includes(x.type) && x.workers.length > 1);
      if (surplus) { give(surplus); return; }
    }
    // 供体 3：伐木屋缺人且木材有富余 → 护林屋（>1 人）抽一人锯柴
    if (b.type === 'woodcutter' && G.game.res.wood > 10 && !G.fuelLimited(b)) {
      const forester = w.buildings.find(x => x.type === 'forester' && x.state === 'ok' && x.workers.length > 1);
      if (forester) { give(forester); return; }
    }
    // 供体 4：秋收窗口宝贵 → 从伐木/护林抽人抢收
    if (harvestSeason && b.type === 'farm') {
      const winterNeed = w.buildings.reduce((n, x) => n + (G.isOccupiedHome(w, x) ? G.BDEF[x.type].warmWoodPerYear : 0), 0);
      const d = w.buildings.find(x => x.state === 'ok' && x.type === 'forester' && x.workers.length > 0) ||
        w.buildings.find(x => x.state === 'ok' && x.type === 'woodcutter' && x.workers.length > 0 && G.game.res.firewood >= winterNeed);
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
  spots.sort((a, z) => G.d2(a.x, a.y, tree.x, tree.y) - G.d2(z.x, z.y, tree.x, tree.y) || G.d2(c.x, c.y, a.x, a.y) - G.d2(c.x, c.y, z.x, z.y));
  return spots.find(p => G.findPath(w, Math.round(c.x), Math.round(c.y), p.x, p.y)) || null;
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
    b.farm = [];
    for (let j = y; j < y + def.h; j++)
      for (let i = x; i < x + def.w; i++)
        b.farm.push({ x: i, y: j, sown: false, harvested: false });
    b.sownAll = false; b.growth = 0; b.harvestDone = false;
  }
  if (type === 'forester') { b.doCut = true; b.doPlant = true; } // 原版 Forester 的 Cut / Plant 开关
  if (type === 'blacksmith') b.toolLimit = G.PROD.blacksmith.toolLimit;
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
  b.progress = 1;
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
  if (b.type === 'storage') {
    const left = w.buildings.filter(x => x.type === 'storage').length;
    if (left <= 1) { G.ui.toast('不能拆除最后一座仓库', 'warn'); return; }
  }
  for (const id of b.workers) {
    const c = w.cmap[id];
    if (c) { c.job = null; c.task = null; c.pausedTask = null; c.path = null; c.state = 'idle'; }
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
  if (w.road[i]) { w.road[i] = 0; G.markGroundDirty(tx, ty); return; }
  if (w.treeIdx[i] >= 0) { G.removeTree(w, tx, ty); return; }
  if (w.rock[i]) { G.markRockAt(w, tx, ty); return; } // 岩石改为标记后由散工清除（资源入库需劳动）
};
