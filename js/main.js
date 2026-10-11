'use strict';
/* ============================================================
 * main.js —— 初始化、游戏循环、输入、存档
 * ============================================================ */

G.cv = null;
G.ctx = null;
G.dpr = 1;
G.tool = null;                 // null | {kind:'build',type} | {kind:'road'|'fell'|'quarry'|'demolish'}
G.hover = { tx: -1, ty: -1 };
G.sel = null;
G.keys = {};
G.autosaveBlocked = false;
G.RECOVERY_SAVE_KEY = G.AUTOSAVE_KEY + '_recovery';

G.topModal = function () {
  // Overlay order matches the DOM stacking order (all use the same z-index).
  return ['over', 'fb', 'errs', 'saves', 'production-goals', 'help'].map(id => document.getElementById(id))
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
  G.sel = null;
  G.tool = null; G.cancelRoadPlan(); G.cancelHarvestPlan(); G.cancelFarmPlan();
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
  G.reconcileFood(g);
  return {
    v: 1, seed: w.seed, N: w.N, mapVersion: w.mapVersion || 0, // N：地图尺寸（旧档跨尺寸迁移裸索引用）
    game: {
      v: G.VERSION,
      h: g.h, day: g.day, season: g.season, year: g.year,
      res: g.res, stats: g.stats, prevFood: g.prevFood, foodNet: g.foodNet, foodUrgent: g.foodUrgent, warned: g.warned,
      supplyMode:g.supplyMode,clothingSupply:g.clothingSupply,supplyStartedDay:g.supplyStartedDay,supplyUsed:g.supplyUsed,supplyLost:g.supplyLost,
      heating:g.heating, fishingRules:g.fishingRules, fireDisasters:g.fireDisasters, farmPests:g.farmPests, townLedger:g.townLedger, challenges:g.challenges, hist: g.hist, buildLog: g.buildLog, toolMode:g.toolMode,toolRemainders:g.toolRemainders,toolWear: g.toolWear, steelToolWear: g.steelToolWear, healthStartDay: g.healthStartDay, nomads:g.nomads, unlocks: g.unlocks, livestock: g.livestock,
      productionGoals: g.productionGoals && { ...g.productionGoals }, productionPaused: g.productionPaused && { ...g.productionPaused },
    },
    roads: Array.from(w.road).flatMap((road, i) => road ? [i] : []),
    stoneRoads: Array.from(w.road).flatMap((road, i) => road === 2 ? [i] : []),
    trees: w.trees.map(t => [t.i, t.x, t.y, t.b]),
    marked: [...w.marked],
    markedRocks: [...(w.markedRocks || [])],
    rockCleared: w.rockCleared,
    buildings: w.buildings.map(b => ({
      id: b.id, type: b.type, x: b.x, y: b.y, state: b.state,
      upgradeFrom:b.upgradeFrom, workerLimit:b.workerLimit, sitePaused:b.sitePaused, sitePriority:b.sitePriority, progress: b.progress, workLeft: b.workLeft, totalWork: b.totalWork, paidCost: b.paidCost, constructionStarted: b.constructionStarted,
      workers: b.workers, family: b.family, noWork: b.noWork, warnText: b.warnText,
      bridgeAxis: b.bridgeAxis, bridgeLength: b.type === 'bridge' ? b.w + b.h - 1 : undefined,
      houseFire:b.houseFire&&{...b.houseFire},ruinFrom:b.ruinFrom,ruinIncident:b.ruinIncident,
      mineralUnits:b.mineralUnits, pitSource:b.pitSource, mineMode: b.mineMode, legacyMine: b.legacyMine, mineTick: b.mineTick, toolRecipe: b.toolRecipe, reserveDays:b.reserveDays, coatRecipe:b.coatRecipe, coatMaterial:b.coatMaterial,
      doCut: b.doCut, doPlant: b.doPlant, fuelLimit: b.fuelLimit, toolLimit: b.toolLimit,
      farmSize:b.type==='farm'&&b.farmSize?[...b.farmSize]:undefined,
      farm: b.farm ? b.farm.map(f => [f.sown ? 1 : 0, f.harvested ? 1 : 0, f.pestLost ? 1 : 0]) : undefined,
      sownAll: b.sownAll, growth: b.growth, harvestDone: b.harvestDone, cropType:b.cropType, cropChoice:b.cropChoice,
      sowingCommitted: b.sowingCommitted, pestInfestation:b.pestInfestation, lastPestCrop:b.lastPestCrop, earlyHarvestYield:b.earlyHarvestYield, productionPaused: b.productionPaused,
      tradeInventory: b.tradeInventory, tradeTargets: b.tradeTargets, merchant: b.merchant, nextMerchantDay: b.nextMerchantDay, merchantVisits:b.merchantVisits, merchantOrders:b.merchantOrders, autoTrade:b.autoTrade, autoTradeLast:b.autoTradeLast,
      supplyStock:b.supplyStock,lastHeating:b.lastHeating, unheated:b.unheated, graves:b.graves,
      animalType:b.animalType, pastureProducts:b.pastureProducts, animals: b.animals, animalGrowth: b.animalGrowth, animalTarget: b.animalTarget, woolReady: b.woolReady,
      orchardAge: b.orchardAge, orchardYield: b.orchardYield, orchardSeason: b.orchardSeason, tendedDay: b.tendedDay,
      orchardTrees:b.orchardTrees?b.orchardTrees.map(t=>({...t})):undefined,orchardDay:b.orchardDay,orchardReplant:b.orchardReplant,orchardWarnYear:b.orchardWarnYear,
    })),
    families: w.families.map(f => ({ id: f.id, members: f.members, houseId: f.houseId, coupleIds: f.coupleIds,supplyCamp:f.supplyCamp&&{x:f.supplyCamp.x,y:f.supplyCamp.y,supplyStock:f.supplyCamp.supplyStock} })),
    citizens: w.citizens.map(c => ({
      id: c.id, name: c.name, sex: c.sex, age: c.age, adult: c.adult,
      x: c.x, y: c.y, familyId: c.familyId, job: c.job,
      partnerId: c.partnerId, parentIds: c.parentIds, grandparentIds: c.grandparentIds, ancestorIds: c.ancestorIds, birthFamilyId: c.birthFamilyId,
      student: c.student ? 1 : 0, educated: c.educated ? 1 : 0, school: c.school != null ? c.school : null, studyHours:G.studyHoursOf(c),studyToday:G.studyTodayOf(c),studyDay:g.day,
      toolType:c.toolType,toolHours:c.toolHours,arrivalHallId:c.arrivalHallId, hunger: c.hunger, cold: c.cold, clothingLeft: c.clothingLeft, clothingType:c.clothingType, dietVariety: c.dietVariety, dietScore: c.dietScore, happiness: c.happiness, leisureDays:c.leisureDays, grief:c.grief, health: c.health, sickDays: c.sickDays, immunityDays: c.immunityDays, herbCooldown: c.herbCooldown, careHours: c.careHours, camped: c.camped ? 1 : 0, carry: c.carry,
    })),
    supplyCaches:(w.supplyCaches||[]).map(b=>({id:b.id,x:b.x,y:b.y,w:b.w,h:b.h,supplyStock:b.supplyStock})),
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
  const supplyStock=(value,field,limit=Infinity)=>{
    record(value,field);const keys=Object.keys(value),legacy=gd.clothingSupply===undefined&&keys.length===5&&['grain','vegetables','meat','firewood','coal'].every(k=>keys.includes(k));
    if(!legacy&&(keys.length!==G.SUPPLY.types.length||keys.some(k=>!G.SUPPLY.types.includes(k))))bad(field+'种类');
    const stock=Object.fromEntries(G.SUPPLY.types.map(k=>[k,number(legacy&&G.CLOTHING_KEYS.includes(k)?0:value[k],field,0)]));
    for(const k of G.CLOTHING_KEYS)if(!Number.isSafeInteger(stock[k])||stock[k]>0&&!g.clothingSupply)bad(field+'衣物');
    if(G.supplySum(stock)>limit+1e-6)bad(field+'容量');return stock;
  };
  record(d, '根对象');
  if (d.v !== undefined && d.v !== 1) bad('版本不受支持');
  integer(d.seed, '地图种子', -0x80000000, 0xffffffff);
  const oldN = d.N === undefined ? G.MAP : integer(d.N, '地图尺寸', 1, 4096);
  const gd = record(d.game, '游戏状态'), g = G.newGameState();
  g.h = number(gd.h, '小时', 0, G.DAY_H); if (g.h === G.DAY_H) bad('小时');
  g.day = integer(gd.day, '天数'); g.season = integer(gd.season, '季节', 0, 3); g.year = integer(gd.year, '年份', 1);
  record(gd.res, '资源');
  for (const key of G.RES_KEYS) {
    const value = gd.res[key] === undefined && ['iron', ...G.FOOD_KEYS, 'leather', 'wool', 'clothes', 'herbs', 'coal', 'steelTools', 'ale', 'warmCoats'].includes(key) ? 0 : gd.res[key] === undefined && key === 'tools' ? 10 : gd.res[key];
    g.res[key] = number(value, '资源 ' + key, 0);
  }
  const hasFoodClasses = G.FOOD_KEYS.some(k => gd.res[k] !== undefined);
  if (hasFoodClasses && Math.abs(G.FOOD_KEYS.reduce((n,k) => n + g.res[k], 0) - g.res.food) > 0.00001) bad('食物分类合计');
  if (!hasFoodClasses) g.res.grain = g.res.food; // legacy stock is preserved once
  if (gd.unlocks !== undefined) {record(gd.unlocks,'产业解锁');if(typeof gd.unlocks.orchard !== 'boolean')bad('果树种子解锁');for(const key of ['cabbage','beans'])if(gd.unlocks[key]!==undefined&&typeof gd.unlocks[key]!=='boolean')bad('农田种子解锁');g.unlocks={orchard:gd.unlocks.orchard,cabbage:gd.unlocks.cabbage===true,beans:gd.unlocks.beans===true};}
  if (gd.livestock !== undefined) {record(gd.livestock,'待安置牲畜');g.livestock={sheep:integer(gd.livestock.sheep,'待安置羊',0,1000000),cattle:gd.livestock.cattle===undefined?0:integer(gd.livestock.cattle,'待安置牛',0,1000000)};}
  if(gd.fishingRules!==undefined&&!['classic','shared'].includes(gd.fishingRules))bad('渔场规则');
  g.fishingRules=gd.fishingRules===undefined?'classic':gd.fishingRules;
  if(gd.supplyMode!==undefined&&!['automatic','physical'].includes(gd.supplyMode))bad('生活配送规则');
  if(gd.clothingSupply!==undefined&&typeof gd.clothingSupply!=='boolean')bad('衣物配送规则');
  g.clothingSupply=gd.clothingSupply===true;if(g.clothingSupply&&gd.supplyMode!=='physical')bad('衣物配送须先启用家庭配送');
  g.supplyMode=gd.supplyMode||'automatic';g.supplyStartedDay=gd.supplyStartedDay==null?null:integer(gd.supplyStartedDay,'配送启用日',0,g.day);
  g.supplyUsed=gd.supplyUsed===undefined?G.emptySupplyStock():supplyStock(gd.supplyUsed,'家庭实际消耗');
  g.supplyLost=gd.supplyLost===undefined?G.emptySupplyStock():supplyStock(gd.supplyLost,'家庭实际损失');
  if(g.supplyMode==='automatic'&&(g.supplyStartedDay!==null||G.supplySum(g.supplyUsed)||G.supplySum(g.supplyLost)))bad('自动供给带配送记录');
  if(gd.fireDisasters!==undefined){const f=record(gd.fireDisasters,'住房火灾设置');if(typeof f.enabled!=='boolean')bad('住房火灾开关');
    const startedDay=f.startedDay===null?null:integer(f.startedDay,'首次火灾启用日',0,g.day),graceUntil=integer(f.graceUntil,'火灾宽限日',0,g.day+48);
    if(graceUntil!==(startedDay===null?0:startedDay+48)||(f.enabled&&startedDay===null))bad('火灾宽限状态');
    const incidentHomes=ids(f.incidentHomes,'本次火情住房');if(incidentHomes.length>3||new Set(incidentHomes).size!==incidentHomes.length)bad('火情传播上限');
    g.fireDisasters={enabled:f.enabled,startedDay,graceUntil,lastDay:integer(f.lastDay,'火灾结算日',-1,g.day),nextIgnitionDay:integer(f.nextIgnitionDay,'下次可起火日',0,g.day+24),serial:integer(f.serial,'火情序号',0),incidentHomes};
    if(g.fireDisasters.serial===0&&incidentHomes.length)bad('火情序号');
  }
  if(gd.farmPests!==undefined){const p=record(gd.farmPests,'农田虫害设置');if(typeof p.enabled!=='boolean')bad('农田虫害开关');
    g.farmPests={enabled:p.enabled,graceUntil:integer(p.graceUntil,'虫害宽限日',0,g.day+G.FARM_PESTS.graceDays),lastDay:integer(p.lastDay,'虫害结算日',-1,g.day)};
  }
  if(gd.challenges!==undefined){
    const q=record(gd.challenges,'发展挑战');if(q.v!==1)bad('发展挑战版本');const completed=record(q.completed,'挑战确认日');
    for(const key of Object.keys(completed)){if(!G.TOWN_CHALLENGE_KEYS.includes(key))bad('发展挑战项目');g.challenges.completed[key]=integer(completed[key],'挑战确认日',0,g.day);}
  }
  if (gd.productionGoals !== undefined) {
    const goals = record(gd.productionGoals, '自动生产目标');
    const paused = gd.productionPaused === undefined ? {} : record(gd.productionPaused, '生产暂停状态');
    g.productionGoals = {}; g.productionPaused = {};
    for (const type of Object.keys(goals)) {
      if (!G.RES_KEYS.includes(type)) bad('生产目标资源');
      g.productionGoals[type] = integer(goals[type], '生产目标', 0, G.PRODUCTION_GOAL_MAX);
    }
    for (const type of Object.keys(paused)) {
      if (!G.RES_KEYS.includes(type) || typeof paused[type] !== 'boolean') bad('生产暂停状态');
      if (G.productionGoalOf(type, g) !== null) g.productionPaused[type] = paused[type];
    }
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
  g.healthStartDay = gd.healthStartDay === undefined ? g.day : integer(gd.healthStartDay, '健康机制启用日', 0, g.day);
  g.nomads={nextDay:g.day+G.YEAR_DAYS,serial:0,offer:null,accepted:0,declined:0};
  if(gd.nomads!==undefined){
    const n=record(gd.nomads,'迁入记录');
    g.nomads={nextDay:integer(n.nextDay,'下次来访日'),serial:integer(n.serial,'来访序号'),accepted:integer(n.accepted,'累计接纳'),declined:integer(n.declined,'累计拒绝'),offer:null};
    if(n.offer!=null){const o=record(n.offer,'来访申请'),fs=array(o.families,'来访家庭');if(fs.length<1||fs.length>2)bad('来访家庭数');
      const families=fs.map(f=>{record(f,'来访家庭');const ages=array(f.childAges,'来访子女年龄');if(ages.length>1)bad('来访子女人数');return {fatherAge:integer(f.fatherAge,'来访父亲年龄',22,38),motherAge:integer(f.motherAge,'来访母亲年龄',22,38),childAges:ages.map(a=>integer(a,'来访孩子年龄',2,8))};});
      g.nomads.offer={id:id(o.id,'来访序号'),hallId:id(o.hallId,'申请市政厅'),expiresDay:integer(o.expiresDay,'申请截止日'),families,sickCount:integer(o.sickCount,'来访热病人数',0,1)};
      if(o.id>g.nomads.serial)bad('来访序号超前');
    }
  }

  if(gd.heating!==undefined){const p=record(gd.heating,'取暖策略');if(typeof p.allowCoal!=='boolean')bad('煤取暖开关');g.heating={allowCoal:p.allowCoal,coalReserve:integer(p.coalReserve,'取暖保留煤',0,G.PRODUCTION_GOAL_MAX)};}

  if(gd.townLedger===undefined)g.townLedger=G.newTownLedger(g); // Legacy history is unknown, not zero production.
  else {
    const l=record(gd.townLedger,'经营流水');if(l.v!==1)bad('经营流水版本');
    const startDay=integer(l.startDay,'流水起始日',0,g.day),startHour=number(l.startHour,'流水起始小时',0,G.DAY_H);
    if(startHour>=G.DAY_H)bad('流水起始小时');
    const exactKeys=(obj,keys,field)=>{record(obj,field);if(Object.keys(obj).length!==keys.length||Object.keys(obj).some(k=>!keys.includes(k)))bad(field+'字段');};
    const stock=(value,field)=>{exactKeys(value,G.LEDGER_RES,field);return Object.fromEntries(G.LEDGER_RES.map(k=>[k,number(value[k],field,0)]));};
    const bucket=(value,closed)=>{
      const r=record(value,'流水日记录'),day=integer(r.day,'流水日',startDay,g.day),fromHour=number(r.fromHour,'流水日开始小时',0,G.DAY_H);
      if(fromHour>=G.DAY_H||fromHour!==(day===startDay?startHour:0)||r.partial!==(fromHour>0))bad('流水部分日');
      if(closed?(day>=g.day||r.toHour!==G.DAY_H):(day!==g.day||fromHour>g.h))bad('流水日范围');
      exactKeys(r.flows,G.LEDGER_RES,'流水资源');const flows={};
      for(const k of G.LEDGER_RES){
        const old=r.flows[k]?.distributedUsed===undefined&&r.flows[k]?.distributedLost===undefined;
        exactKeys(r.flows[k],old?G.LEDGER_METRICS.filter(m=>!m.startsWith('distributed')):G.LEDGER_METRICS,'流水计量');
        flows[k]=Object.fromEntries(G.LEDGER_METRICS.map(m=>[m,old&&m.startsWith('distributed')?0:number(r.flows[k][m],'流水数量',0)]));
      }
      return {day,fromHour,partial:r.partial,opening:stock(r.opening,'期初库存'),flows,...(closed?{toHour:G.DAY_H,closing:stock(r.closing,'期末库存')}:{})};
    };
    const input=array(l.days,'流水历史');if(input.length>48)bad('流水历史过长');
    const days=input.map(r=>bucket(r,true));
    for(let i=1;i<days.length;i++)if(days[i].day!==days[i-1].day+1)bad('流水日期顺序');
    if(days.length?days[days.length-1].day!==g.day-1:g.day!==startDay)bad('流水日期缺失');
    if(days.length<48&&days.length&&days[0].day!==startDay)bad('流水起始记录缺失');
    g.townLedger={v:1,startDay,startHour,current:bucket(l.current,false),days};
  }

  g.toolWear = Number.isFinite(gd.toolWear) && gd.toolWear >= 0 ? gd.toolWear : 0;
  g.steelToolWear = gd.steelToolWear === undefined ? 0 : number(gd.steelToolWear, '钢工具磨损', 0, 1);
  if(gd.toolMode!==undefined&&!['pooled','individual'].includes(gd.toolMode))bad('个人工具规则');
  g.toolMode=gd.toolMode||'pooled';g.toolRemainders={tools:0,steelTools:0};
  if(g.toolMode==='individual'&&gd.toolRemainders===undefined)bad('缺少旧工具余寿记录');
  if(gd.toolRemainders!==undefined){const r=record(gd.toolRemainders,'旧半用工具');if(Object.keys(r).length!==2||Object.keys(r).some(k=>!G.isTool(k)))bad('旧半用工具种类');
    for(const k of ['tools','steelTools']){g.toolRemainders[k]=number(r[k],'旧半用工具余寿',0,G.toolLifeHours(k));if(g.toolRemainders[k]>=G.toolLifeHours(k))bad('旧半用工具须保留实际磨损');}}
  if(g.toolMode==='pooled'&&Object.values(g.toolRemainders).some(n=>n>0)||g.toolMode==='individual'&&(g.toolWear!==0||g.steelToolWear!==0))bad('工具磨损重复计量');
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
  for (const i of optionalArray(d.roads, '道路')) { const t = gridIndex(i, '道路索引'); if (t !== null) G.setRoad(w, t % w.N, Math.floor(t / w.N), true); }
  for (const i of optionalArray(d.stoneRoads, '石路')) { const t = gridIndex(i, '石路索引'); if (t !== null) { if(w.water[t]===1) bad('水上石路'); G.setRoad(w,t%w.N,Math.floor(t/w.N),2); } }

  const used = new Set(); let usedMax = 0;
  const uniqueId = (value, field) => {
    id(value, field); if (used.has(value)) bad('重复 ID');
    used.add(value); usedMax = Math.max(usedMax, value); return value;
  };
  for (const bd of buildings) {
    record(bd, '建筑记录');
    if (!Object.prototype.hasOwnProperty.call(G.BDEF, bd.type)) bad('建筑类型');
    let def = G.BDEF[bd.type];
    if(bd.farmSize!==undefined){if(bd.type!=='farm'||!G.farmDefinition(bd.farmSize))bad('农田尺寸');def=G.farmDefinition(bd.farmSize);}
    if (bd.type === 'bridge') {
      if (!['x','y'].includes(bd.bridgeAxis)) bad('木桥方向');
      const length = integer(bd.bridgeLength,'木桥长度',3,24);
      def = {...def,w:bd.bridgeAxis==='x'?length:1,h:bd.bridgeAxis==='y'?length:1,buildWork:length*3};
    }
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
      reserveDays:bd.type==='tavern'?(bd.reserveDays===undefined?12:integer(bd.reserveDays,'酿酒储粮天数',8,48)):undefined,
    };
    if(bd.houseFire!==undefined){const h=record(bd.houseFire,'住房火情');if(!['house','stonehouse'].includes(b.type)||b.state!=='ok'||b.family!==null||b.workers.length||g.fireDisasters.startedDay===null)bad('住房火情状态');
      const incident=integer(h.incident,'火情来源',1),elapsed=number(h.elapsed,'火情发展小时',0,48),spreadAt=integer(h.spreadAt,'下次传播小时',18,54);
      if(incident!==g.fireDisasters.serial||!g.fireDisasters.incidentHomes.includes(b.id)||elapsed>=48||spreadAt%6)bad('火情进度');
      b.houseFire={incident,elapsed,need:integer(h.need,'剩余灭火桶数',1,3),spreadAt};
    }
    if(bd.type==='burntruins'){
      if(!['house','stonehouse'].includes(bd.ruinFrom)||b.state!=='ok'||b.family!==null||b.workers.length||b.progress!==1||b.workLeft!==0)bad('烧毁住房状态');
      if(bd.paidCost!==undefined&&Object.keys(record(bd.paidCost,'废墟建材')).length)bad('废墟不能退还旧建材');b.ruinFrom=bd.ruinFrom;b.ruinIncident=integer(bd.ruinIncident,'废墟火情序号',1,g.fireDisasters.serial);b.paidCost={};
    }else if(bd.ruinFrom!==undefined||bd.ruinIncident!==undefined)bad('非废墟来源');
    if(bd.upgradeFrom!==undefined){if(bd.upgradeFrom!=='house'||bd.type!=='stonehouse')bad('住房升级来源');b.upgradeFrom='house';}
    if(bd.workerLimit!==undefined)b.workerLimit=integer(bd.workerLimit,'建筑用工上限',0,def.jobs||0);
    if(bd.sitePriority!==undefined){if(typeof bd.sitePriority!=='boolean'||b.state!=='site')bad('施工优先级');b.sitePriority=bd.sitePriority;}
    if(bd.sitePaused!==undefined){if(typeof bd.sitePaused!=='boolean'||(bd.sitePaused&&b.state!=='site'))bad('工地暂停状态');b.sitePaused=bd.sitePaused;}
    if (bd.type === 'bridge') {
      b.bridgeAxis=bd.bridgeAxis;
      if(!G.planBridge(w,{x,y},{x:x+b.w-1,y:y+b.h-1}).ok) bad('木桥跨岸几何');
    }
    if (bd.type === 'mine') {
      b.mineMode = bd.mineMode === undefined ? 'legacy' : bd.mineMode;
      if (!['legacy', 'iron', 'coal'].includes(b.mineMode)) bad('矿井产出模式');
      if (bd.legacyMine !== undefined && typeof bd.legacyMine !== 'boolean') bad('旧矿井标记');
      b.legacyMine = bd.legacyMine === undefined ? b.mineMode === 'legacy' : bd.legacyMine;
      if (b.mineMode === 'legacy' && !b.legacyMine) bad('旧矿井模式');
      b.mineTick = bd.mineTick === undefined ? 0 : integer(bd.mineTick, '混采批次', 0);
    }
    if(G.MINERAL_RULES[bd.type]&&bd.mineralUnits!==undefined){
      b.mineralUnits=integer(bd.mineralUnits,'矿点剩余储量',0,G.MINERAL_RULES[bd.type].capacity);
      if((b.state==='site'&&b.mineralUnits!==G.MINERAL_RULES[bd.type].capacity)||(bd.type==='mine'&&b.mineMode==='legacy'))bad('有限矿点状态');
    }else if(bd.type!=='mineralpit'&&bd.mineralUnits!==undefined)bad('非矿点储量');
    if(bd.type==='mineralpit'){
      if(b.state!=='ok'||b.workers.length||b.family!==null||b.progress!==1||b.workLeft!==0||typeof bd.pitSource!=='string'||!Object.hasOwn(G.MINERAL_RULES,bd.pitSource))bad('永久矿坑状态');
      b.pitSource=bd.pitSource;b.mineralUnits=integer(bd.mineralUnits,'废弃矿坑储量',0,G.MINERAL_RULES[b.pitSource].capacity-1);
      if(bd.paidCost!==undefined&&(typeof bd.paidCost!=='object'||bd.paidCost===null||Object.keys(bd.paidCost).length))bad('矿坑不能返还建材');
      b.paidCost={};
    }else if(bd.pitSource!==undefined)bad('非矿坑来源');
    if (bd.type === 'blacksmith') {
      b.toolRecipe = bd.toolRecipe === undefined ? 'iron' : bd.toolRecipe;
      if (!['iron', 'steel'].includes(b.toolRecipe)) bad('工具配方');
    }
    if(bd.type==='tailor'){b.coatRecipe=bd.coatRecipe===undefined?'basic':bd.coatRecipe;if(!['basic','warm'].includes(b.coatRecipe))bad('衣物配方');b.coatMaterial=bd.coatMaterial===undefined?'auto':bd.coatMaterial;if(!['auto','leather','wool'].includes(b.coatMaterial))bad('普通衣原料选择');}
    if (bd.type === 'tradingpost') {
      for(const field of ['tradeInventory','tradeTargets']){
        b[field]={};if(bd[field]!==undefined){record(bd[field],field);for(const key of Object.keys(bd[field])){
          if(!Object.hasOwn(G.TRADE_VALUES,key))bad('贸易资源');b[field][key]=number(bd[field][key],field,0,field==='tradeTargets'?2000:1000000);
        }}
      }
      if(G.tradeStored(b)>G.TRADE_CAPACITY+1e-6)bad('贸易库存超容量');
      b.nextMerchantDay=bd.nextMerchantDay===undefined?g.day+G.SEASON_DAYS:integer(bd.nextMerchantDay,'商船下次到访',0);
      b.merchantVisits=bd.merchantVisits===undefined?(bd.merchant?1:0):integer(bd.merchantVisits,'商人来访轮次',0,1000000);
      b.autoTrade=G.defaultAutoTrade();
      if(bd.autoTrade!==undefined){const rule=record(bd.autoTrade,'自动购买规则');if(G.autoTradeConfigReason(rule))bad('自动购买规则');
        b.autoTrade={enabled:rule.enabled,good:rule.good,qty:rule.qty,payment:rule.payment,maxPrice:rule.maxPrice};}
      if(bd.autoTradeLast!==undefined){const r=record(bd.autoTradeLast,'自动购买结果');
        if(typeof r.good!=='string'||!Object.hasOwn(G.TRADE_GOODS,r.good)||typeof r.payment!=='string'||!Object.hasOwn(G.TRADE_VALUES,r.payment)||
          typeof r.merchantId!=='string'||!Object.hasOwn(G.MERCHANTS,r.merchantId)||typeof r.ok!=='boolean'||typeof r.reason!=='string'||r.reason.length>200)bad('自动购买结果');
        b.autoTradeLast={day:integer(r.day,'自动购买日期',0,g.day),visit:integer(r.visit,'自动购买轮次',1,b.merchantVisits),merchantId:r.merchantId,
          good:r.good,qty:integer(r.qty,'自动购买数量',1,G.TRADE_GOODS[r.good].stock),payment:r.payment,
          unitPrice:integer(r.unitPrice,'自动购买单价',1,1000000),paid:integer(r.paid,'自动购买实付',0,G.TRADE_CAPACITY),ok:r.ok,reason:r.reason};
        if(r.paid!==(r.ok?Math.ceil(r.unitPrice*r.qty/G.TRADE_VALUES[r.payment]):0))bad('自动购买实付结果');
      }
      b.merchantOrders={};
      if(bd.merchantOrders!==undefined){record(bd.merchantOrders,'回访订货');for(const id of Object.keys(bd.merchantOrders)){
        if(!Object.hasOwn(G.MERCHANTS,id))bad('订货商人');const order=record(bd.merchantOrders[id],'订货');
        if(typeof order.good!=='string'||!G.MERCHANTS[id].goods.includes(order.good))bad('商人订货目录');
        b.merchantOrders[id]={good:order.good,qty:integer(order.qty,'订货数量',1,G.TRADE_GOODS[order.good].stock)};
      }}
      if(bd.merchant!=null){record(bd.merchant,'商船');record(bd.merchant.stock,'商船货物');
        const id=bd.merchant.id===undefined?'general':bd.merchant.id;if(!Object.hasOwn(G.MERCHANTS,id))bad('商人身份');
        b.merchant={id,leaveDay:integer(bd.merchant.leaveDay,'商船离港',0),stock:{},autoTradeDone:true};
        // A serialized docked boat has already crossed its one arrival event.
        if(bd.merchant.autoTradeDone!==undefined&&bd.merchant.autoTradeDone!==true)bad('自动购买到港标记');
        if(bd.merchant.arrivedDay!==undefined){b.merchant.arrivedDay=integer(bd.merchant.arrivedDay,'商船到港',0,g.day);if(b.merchant.leaveDay<=b.merchant.arrivedDay)bad('商船停靠日期');}
        for(const key of Object.keys(bd.merchant.stock)){if(!G.MERCHANTS[id].goods.includes(key))bad('商船货物种类');b.merchant.stock[key]=integer(bd.merchant.stock[key],'商船库存',0,G.TRADE_GOODS[key].stock);}
        if(bd.merchant.orderedGood!==undefined){const good=bd.merchant.orderedGood;if(typeof good!=='string'||!Object.hasOwn(b.merchant.stock,good))bad('本次订货货物');b.merchant.orderedGood=good;}
      }
    }
    if(bd.unheated!==undefined){if(def.warmWoodPerYear==null||b.state!=='ok'||typeof bd.unheated!=='boolean')bad('住宅供暖状态');b.unheated=bd.unheated;}
    if(bd.lastHeating!==undefined){
      if(def.warmWoodPerYear==null||b.state!=='ok')bad('住宅取暖记录');const r=record(bd.lastHeating,'取暖记录'),day=integer(r.day,'取暖日期',0,g.day),need=def.warmWoodPerYear/G.SEASON_DAYS;
      if(G.seasonOf(day)!==3||r.need!==need)bad('取暖季节或需求');const wood=number(r.wood,'已烧柴火',0,need),coal=number(r.coal,'已烧煤',0,need/G.COAL_HEAT);
      if(wood+coal*G.COAL_HEAT>need+1e-8)bad('超额取暖记录');b.lastHeating={day,need,wood,coal};
      if(bd.unheated===undefined)b.unheated=g.season===3&&day===g.day&&wood+coal*G.COAL_HEAT+1e-8<need;
    }
    if(bd.type==='cemetery'){
      const rows=bd.graves===undefined?[]:array(bd.graves,'墓位');if(rows.length>G.MEMORIAL.capacity||(b.state!=='ok'&&rows.length))bad('墓位容量或施工状态');
      const slots=new Set();b.graves=rows.map(r=>{record(r,'墓位');const slot=integer(r.slot,'墓位编号',0,G.MEMORIAL.capacity-1);if(slots.has(slot))bad('重复墓位');slots.add(slot);
        if(typeof r.name!=='string'||r.name.length>80)bad('墓碑姓名');const deathDay=integer(r.deathDay,'安葬日期',0,g.day),expiresDay=integer(r.expiresDay,'墓位到期日',deathDay);
        if(expiresDay!==deathDay+G.MEMORIAL.graveDays)bad('墓位期限');return {slot,name:r.name,deathDay,expiresDay};});
    }else if(bd.graves!==undefined)bad('非墓园墓位');
    if(bd.type==='pasture'){
      if(bd.animalType!==undefined&&!G.isLivestockType(bd.animalType))bad('牧场物种');
      b.animalType=bd.animalType||'sheep';const cap=G.LIVESTOCK[b.animalType].cap;
      b.animals=bd.animals===undefined?0:integer(bd.animals,'牲畜数量',0,cap);
      b.animalTarget=bd.animalTarget===undefined?8:integer(bd.animalTarget,'保留牲畜数量',2,cap);
      b.pastureProducts={meat:0,leather:0};if(bd.pastureProducts!==undefined){record(bd.pastureProducts,'待送牧场产物');for(const type of Object.keys(bd.pastureProducts)){if(!['meat','leather'].includes(type))bad('牧场产物类型');b.pastureProducts[type]=number(bd.pastureProducts[type],'牧场待送'+type,0,G.LIVESTOCK[b.animalType][type]);}}
      b.animalGrowth=bd.animalGrowth===undefined?0:number(bd.animalGrowth,'繁殖进度',0,1);
      b.woolReady=bd.woolReady===undefined?0:number(bd.woolReady,'待剪羊毛',0,b.animalType==='sheep'?48:0);
    }
    if(['orchardTrees','orchardDay','orchardReplant','orchardWarnYear'].some(k=>bd[k]!==undefined)&&bd.type!=='orchard')bad('果园树株字段');
    if(bd.type==='orchard'){
      const age=bd.orchardAge===undefined?0:integer(bd.orchardAge,'果树养护年龄',0,G.ORCHARD.matureDays);
      let fruit=bd.orchardYield===undefined?0:number(bd.orchardYield,'待收果实',0,180);
      const season=bd.orchardSeason===undefined?0:integer(bd.orchardSeason,'果树产季',1,g.year);
      if(bd.orchardReplant!==undefined&&typeof bd.orchardReplant!=='boolean')bad('果园补种开关');
      b.orchardReplant=bd.orchardReplant!==false;
      if(bd.orchardTrees!==undefined){
        if(!Array.isArray(bd.orchardTrees)||bd.orchardTrees.length!==G.ORCHARD.count)bad('果园树株数量');
        b.orchardTrees=bd.orchardTrees.map((t,i)=>{record(t,'果园树株');if(typeof t.planted!=='boolean')bad('果树种植状态');
          const tree={planted:t.planted,age:integer(t.age,'单株树龄',0,G.orchardLifetime(i)-1),fruit:number(t.fruit,'单株果实',0,G.ORCHARD.fruit),season:integer(t.season,'单株产季',0,g.year),tendedDay:integer(t.tendedDay,'单株照料日',-1,g.day),cycle:integer(t.cycle,'单株更新次数',0)};
          if(!tree.planted&&(tree.age||tree.fruit))bad('空果树位含生长或果实');return tree;});
        b.orchardDay=integer(bd.orchardDay,'果园推进日',0,g.day);
        G.syncOrchardTotals(b);if(b.orchardAge!==age||Math.abs(b.orchardYield-fruit)>1e-7)bad('果园汇总与树株不符');
      }else{
        const tended=bd.tendedDay===undefined?-1:integer(bd.tendedDay,'旧果园照料日',0,g.day);
        b.orchardTrees=Array.from({length:G.ORCHARD.count},()=>{const n=Math.min(G.ORCHARD.fruit,fruit);fruit-=n;return {planted:true,age,fruit:n,season,tendedDay:tended,cycle:0};});
        b.orchardDay=g.day;G.syncOrchardTotals(b);
      }
      if(bd.orchardWarnYear!==undefined)b.orchardWarnYear=integer(bd.orchardWarnYear,'果园预警年份',1,g.year);
    }
    if(bd.tendedDay!==undefined)b.tendedDay=integer(bd.tendedDay,'最近照料日',0,g.day);
    if (bd.productionPaused !== undefined && typeof bd.productionPaused !== 'boolean') bad('本屋生产暂停状态');
    if (['woodcutter', 'blacksmith'].includes(bd.type) && bd.productionPaused !== undefined) b.productionPaused = bd.productionPaused;
    if (bd.constructionStarted !== undefined && typeof bd.constructionStarted !== 'boolean') bad('工地开工状态');
    b.constructionStarted = bd.constructionStarted === true;
    if (bd.paidCost !== undefined) {
      record(bd.paidCost, '已付建材'); b.paidCost = {};
      for (const key of Object.keys(bd.paidCost)) {
        if (!G.RES_KEYS.includes(key)) bad('已付建材类型');
        b.paidCost[key] = number(bd.paidCost[key], '已付建材数量', 0);
      }
    }
    if(bd.earlyHarvestYield!==undefined&&bd.type!=='farm')bad('抢收仅用于农田');
    if (bd.type === 'farm') {
      if(bd.farmSize!==undefined)b.farmSize=[...bd.farmSize];
      b.cropType=bd.cropType===undefined?'wheat':bd.cropType;b.cropChoice=bd.cropChoice===undefined?b.cropType:bd.cropChoice;
      if(typeof b.cropType!=='string'||typeof b.cropChoice!=='string'||!Object.hasOwn(G.CROPS,b.cropType)||!Object.hasOwn(G.CROPS,b.cropChoice))bad('农田作物种类');
      if([b.cropType,b.cropChoice].some(k=>k!=='wheat'&&!g.unlocks[k]))bad('农田作物种子未解锁');
      if (!Array.isArray(bd.farm) || bd.farm.length !== b.w * b.h) bad('农田格数');
      b.farm = bd.farm.map((row, k) => {
        if (!Array.isArray(row) || ![2,3].includes(row.length) || !row.every(v => v === 0 || v === 1 || v === false || v === true)) bad('农田状态');
        if(row[2]&&(!row[0]||!row[1]))bad('虫害损失格状态');
        return { x: x + k % b.w, y: y + Math.floor(k / b.w), sown: !!row[0], harvested: !!row[1], ...(row[2]?{pestLost:true}:{}) };
      });
      if(bd.lastPestCrop!==undefined){if(typeof bd.lastPestCrop!=='string'||!Object.hasOwn(G.CROPS,bd.lastPestCrop))bad('上次虫害作物');b.lastPestCrop=bd.lastPestCrop;}
      if(bd.pestInfestation!==undefined){const p=record(bd.pestInfestation,'农田虫害');if(p.crop!==b.cropType||b.state!=='ok'||!g.farmPests.enabled)bad('农田虫害状态');
        b.pestInfestation={crop:p.crop,startedDay:integer(p.startedDay,'虫害发现日',0,g.day)};
      }
      b.sownAll = !!bd.sownAll; b.harvestDone = !!bd.harvestDone;
      if (bd.sowingCommitted !== undefined && typeof bd.sowingCommitted !== 'boolean') bad('农田本季承诺');
      if (bd.sowingCommitted === true) b.sowingCommitted = true;
      b.growth = bd.growth === undefined ? 0 : number(bd.growth, '农田生长', 0, 1);
      if(bd.earlyHarvestYield!==undefined){
        b.earlyHarvestYield=integer(bd.earlyHarvestYield,'抢收基础产量',1,G.farmBaseYield(b));
        if(b.state!=='ok'||!b.sownAll||!b.farm.every(f=>f.sown)||b.earlyHarvestYield!==Math.floor(G.farmBaseYield(b)*b.growth+1e-9))bad('抢收农田状态');
      }
    }
    for (let yy = y; yy < y + b.h; yy++) for (let xx = x; xx < x + b.w; xx++) {
      const i = yy * w.N + xx; if (w.bgrid[i] >= 0) bad('建筑重叠'); w.bgrid[i] = b.id;
    }
    if(bd.supplyStock!==undefined){
      if(!['house','stonehouse','boarding','market'].includes(b.type)||b.state!=='ok'||g.supplyMode!=='physical')bad('配送库存建筑');
      b.supplyStock=supplyStock(bd.supplyStock,'建筑配送库存',b.type==='market'?G.SUPPLY.marketCap:G.SUPPLY.homeCap);
    }
    w.buildings.push(b); w.bmap[b.id] = b;
  }
  w.families = families.map(fd => {
    record(fd, '家庭记录');
    const f={ id: uniqueId(fd.id, '家庭 ID'), members: ids(fd.members, '家庭成员'), houseId: nullableId(fd.houseId, '住房'),
      coupleIds: fd.coupleIds === undefined ? undefined : ids(fd.coupleIds, '配偶') };
    if(fd.supplyCamp!==undefined){const camp=record(fd.supplyCamp,'临时生活补给点');if(g.supplyMode!=='physical')bad('自动供给带临时补给');
      f.supplyCamp={id:f.id,type:'supplycamp',state:'ok',w:1,h:1,x:integer(camp.x,'补给点 x',0,Math.min(oldN,w.N)-1),y:integer(camp.y,'补给点 y',0,Math.min(oldN,w.N)-1),supplyStock:supplyStock(camp.supplyStock,'临时生活库存',G.SUPPLY.homeCap)};
    }return f;
  });
  for (const cd of citizens) {
    record(cd, '市民记录');
    if (typeof cd.name !== 'string' || !['m', 'f'].includes(cd.sex)) bad('市民身份');
    let carry = null;
    if (cd.carry != null) {
      record(cd.carry, '随身资源'); if (!G.RES_KEYS.includes(cd.carry.type)) bad('随身资源类型');
      carry = { type: cd.carry.type === 'food' ? 'grain' : cd.carry.type, qty: number(cd.carry.qty, '随身资源数量', 0) };
      if(cd.carry.staffingReturn!==undefined){if(cd.carry.staffingReturn!==true)bad('撤岗保货标记');carry.staffingReturn=true;}
      if(cd.carry.smithInput!==undefined){if(cd.carry.smithInput!==true||!carry.staffingReturn||!['iron','wood','coal'].includes(carry.type)||carry.qty>(carry.type==='iron'?1:2)||cd.carry.brewIngredient!==undefined||cd.carry.pastureId!==undefined)bad('铁匠原料货批');carry.smithInput=true;}
      if(cd.carry.coatInput!==undefined){if(!['leather','wool'].includes(carry.type)||!carry.staffingReturn||carry.qty>2||['smithInput','fuelInput','brewIngredient','pastureId','orchardId','firewoodId','tailorId'].some(k=>cd.carry[k]!==undefined))bad('裁缝衣料货批');carry.coatInput=integer(cd.carry.coatInput,'衣料来源',1);}
      if(cd.carry.tailorId!==undefined){if(!['clothes','warmCoats'].includes(carry.type)||carry.qty>2||['extra','smithInput','fuelInput','brewIngredient','pastureId','orchardId','firewoodId','coatInput'].some(k=>cd.carry[k]!==undefined))bad('裁缝成衣货批');carry.tailorId=integer(cd.carry.tailorId,'成衣来源',1);}
      if(cd.carry.fuelInput!==undefined){if(cd.carry.fuelInput!==true||carry.type!=='wood'||!carry.staffingReturn||carry.qty>G.PROD.woodcutter.logsIn||['extra','smithInput','brewIngredient','pastureId','orchardId','firewoodId'].some(k=>cd.carry[k]!==undefined))bad('伐木屋原木货批');carry.fuelInput=true;}
      if(cd.carry.firewoodId!==undefined){if(carry.type!=='firewood'||carry.qty>G.PROD.woodcutter.logsIn*G.PROD.woodcutter.eduFirewoodPerLog||['extra','smithInput','brewIngredient','pastureId','orchardId','fuelInput'].some(k=>cd.carry[k]!==undefined))bad('伐木屋成柴货批');carry.firewoodId=integer(cd.carry.firewoodId,'伐木屋成柴来源',1);}
      if(cd.carry.orchardId!==undefined){if(carry.type!=='vegetables'||cd.carry.extra!==undefined||cd.carry.smithInput!==undefined||cd.carry.brewIngredient!==undefined||cd.carry.pastureId!==undefined||carry.qty>G.ORCHARD.fruit)bad('果园携果类型');carry.orchardId=integer(cd.carry.orchardId,'果园携果来源',1);}
      if(cd.carry.pastureId!==undefined){if(!['meat','leather','wool'].includes(carry.type)||cd.carry.extra!==undefined)bad('牧场携货类型');carry.pastureId=integer(cd.carry.pastureId,'牧场携货来源',1);}
      if(cd.carry.brewIngredient!==undefined){if(cd.carry.brewIngredient!==true||carry.type!=='grain')bad('酿造原粮标记');carry.brewIngredient=true;}
      if(cd.carry.supplyBatch!==undefined){const batch=record(cd.carry.supplyBatch,'生活配送货批');
        if(g.supplyMode!=='physical'||!carry.staffingReturn||!G.SUPPLY.types.includes(carry.type)||['smithInput','coatInput','tailorId','fuelInput','firewoodId','orchardId','pastureId','brewIngredient'].some(k=>cd.carry[k]!==undefined))bad('生活配送货批类型');
        if(!['home','vendor','return'].includes(batch.kind)||Object.keys(batch).some(k=>!['kind','to','familyId'].includes(k)))bad('生活配送目的类型');
        const to=nullableId(batch.to,'生活配送目的地');if((batch.kind==='return')!==(to===null))bad('生活配送目的地');
        carry.supplyBatch={kind:batch.kind,to};if(batch.kind==='home')carry.supplyBatch.familyId=id(batch.familyId,'生活配送家庭');else if(batch.familyId!==undefined)bad('生活配送家庭');
      }
      if (cd.carry.extra !== undefined) {
        if(cd.carry.type!=='meat'&&!carry.staffingReturn)bad('副产物携带类型');
        record(cd.carry.extra, '随身副产物'); carry.extra = {};
        for (const type of Object.keys(cd.carry.extra)) {
          if(carry.coatInput&&(type===carry.type||cd.carry.extra[type]>2))bad('衣料副批数量');
          if (!(carry.supplyBatch?G.SUPPLY.types:carry.smithInput?['iron','wood','coal']:['leather','wool']).includes(type)||carry.smithInput&&(type===carry.type||cd.carry.extra[type]>(type==='iron'?1:2))) bad('副产物种类');
          if(carry.supplyBatch&&type===carry.type)bad('重复配送主货');
          carry.extra[type] = number(cd.carry.extra[type], '副产物数量', 0);
        }
      }
    }
    if(carry?.supplyBatch&&(carry.qty<=0||G.supplySum(G.supplyCargoItems(carry))>(carry.supplyBatch.kind==='home'?G.SUPPLY.homeCarry:G.SUPPLY.vendorCarry)+1e-6))bad('生活配送批量');
    if(carry?.supplyBatch)for(const k of G.CLOTHING_KEYS){const n=G.supplyCargoItems(carry)[k]||0;if(!Number.isSafeInteger(n)||n>0&&!g.clothingSupply)bad('随身配送衣物');}
    if(g.toolMode==='individual'&&(!Object.hasOwn(cd,'toolType')||!Object.hasOwn(cd,'toolHours')))bad('缺少个人工具记录');
    const toolType=cd.toolType??null,toolHours=cd.toolHours===undefined?0:number(cd.toolHours,'个人工具余寿',0,toolType===null?0:G.toolLifeHours(toolType));
    if(toolType!==null&&!G.isTool(toolType)||!!toolType!==(toolHours>0)||toolType!==null&&(g.toolMode!=='individual'||!cd.adult||cd.student))bad('个人工具装备');
    if(cd.clothingType!=null&&!['basic','warm'].includes(cd.clothingType))bad('穿着衣物类型');
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
      studyHours:cd.studyHours===undefined?G.legacyStudyHours(cd):number(cd.studyHours,'已学习课时',0,G.EDUCATION.totalHours),
      studyToday:cd.studyToday===undefined?0:number(cd.studyToday,'本日学习课时',0,G.EDUCATION.dailyHours),
      studyDay:cd.studyDay===undefined?g.day:integer(cd.studyDay,'学习日期',0,g.day),
      arrivalHallId:nullableId(cd.arrivalHallId,'入村登记点'), task: null, pausedTask: null, carry, state: 'idle', walkKind: '', path: null, pi: 0, camped: !!cd.camped,
      wanderT: 0, hunger: cd.hunger === undefined ? 0 : number(cd.hunger, '饥饿', 0),
      cold: cd.cold === undefined ? 0 : number(cd.cold, '寒冷', 0), animT: 0, dead: false,
      clothingLeft: cd.clothingLeft === undefined ? 0 : number(cd.clothingLeft, '衣物耐久天数', 0, G.YEAR_DAYS),
      clothingType:cd.clothingType??(cd.clothingLeft>0?'basic':null),
      toolType,toolHours,
      dietVariety: cd.dietVariety === undefined ? 0 : integer(cd.dietVariety, '饮食种类', 0, 3),
      dietScore: cd.dietScore === undefined ? 1 : number(cd.dietScore, '饮食多样性', 0, 3),
      happiness: cd.happiness === undefined ? 3 : number(cd.happiness, '幸福度', 1, 5),
      leisureDays:cd.leisureDays===undefined?0:number(cd.leisureDays,'休闲记忆天数',0,6),
      health: cd.health === undefined ? 4 : number(cd.health, '健康', 0, 5),
      sickDays: cd.sickDays === undefined ? 0 : integer(cd.sickDays, '患病天数', 0, 8),
      immunityDays: cd.immunityDays === undefined ? 0 : integer(cd.immunityDays, '免疫天数', 0, 12),
      herbCooldown: cd.herbCooldown === undefined ? 0 : integer(cd.herbCooldown, '草药保健间隔', 0, 4),
      careHours: cd.careHours === undefined ? 0 : number(cd.careHours, '医师已照料小时', 0, 24),
    };
    if(cd.grief!=null){const r=record(cd.grief,'亲属哀伤');if(typeof r.name!=='string'||r.name.length>80||typeof r.buried!=='boolean')bad('哀伤来源');
      c.grief={loss:number(r.loss,'哀伤幅度',0,G.MEMORIAL.maxLoss),days:integer(r.days,'哀伤天数',1,G.MEMORIAL.griefDays),name:r.name,buried:r.buried};
    }else c.grief=null;
    w.citizens.push(c); w.cmap[c.id] = c;
  }
  w.supplyCaches=optionalArray(d.supplyCaches,'散落生活物资').map(row=>{
    record(row,'散落生活物资');if(g.supplyMode!=='physical')bad('自动供给带散落物资');
    const width=integer(row.w,'散落范围宽',1,4),height=integer(row.h,'散落范围高',1,3);
    if(![[1,1],[2,2],[3,3],[4,3]].some(([x,y])=>x===width&&y===height))bad('散落物资原占地'); // citizen/camp, house, market, boarding
    return {id:uniqueId(row.id,'散落物资 ID'),type:'supplycache',state:'ok',x:integer(row.x,'散落物资 x',0,Math.min(oldN,w.N)-width),y:integer(row.y,'散落物资 y',0,Math.min(oldN,w.N)-height),w:width,h:height,supplyStock:supplyStock(row.supplyStock,'散落生活库存',G.SUPPLY.homeCap)};
  });
  for(const f of w.families)if(f.houseId!==null&&(w.bmap[f.houseId]?.houseFire||w.bmap[f.houseId]?.type==='burntruins'))bad('火情住房不能入住');
  for(const c of w.citizens)if(c.job!==null&&['well','burntruins'].includes(w.bmap[c.job]?.type))bad('无岗位消防设施');
  if(g.nomads.offer){const h=w.bmap[g.nomads.offer.hallId];if(!h||h.type!=='townhall'||h.state!=='ok')bad('来访申请市政厅失效');}
  for(const c of w.citizens)if(c.job!==null&&w.bmap[c.job]?.type==='mineralpit')bad('永久矿坑不能分配岗位');
  for(const c of w.citizens)if(G.isArriving(c)){c.job=null;for(const b of w.buildings)b.workers=b.workers.filter(id=>id!==c.id);}
  // Old resource huts held four workers. Keep two stable assignments on completed
  // specialist huts; builders keep their construction slots until finishBuilding runs.
  // Tasks already restart under the existing snapshot contract; cargo stays owned
  // by its citizen and is delivered by applySaveData after validation commits.
  for (const b of w.buildings) if (['forester','dock','gatherer','hunting','mine'].includes(b.type) && b.state === 'ok') {
    const assigned = w.citizens.filter(c => c.job === b.id);
    const eligible = new Set(assigned.map(c => c.id));
    const ordered = [...new Set([...b.workers.filter(id => eligible.has(id)), ...eligible])];
    b.workers = ordered.slice(0, G.BDEF[b.type].jobs);
    const keep = new Set(b.workers);
    for (const c of assigned) if (!keep.has(c.id)) c.job = null;
  }
  for(const b of w.buildings)if(b.workerLimit!==undefined||b.sitePaused){
    const assigned=w.citizens.filter(c=>c.job===b.id),allowed=G.workerLimitOf(b),eligible=new Set(assigned.map(c=>c.id));
    b.workers=[...new Set([...b.workers.filter(id=>eligible.has(id)),...eligible])].slice(0,allowed);
    const kept=new Set(b.workers);for(const c of assigned)if(!kept.has(c.id)){G.markStaffingCargo(c);c.job=null;}
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
  G.updateProductionGoals(g, w);
  return { world: w, game: g, nextUid: Math.max(nextUid, usedMax + 1), rng: G.makeRng((d.seed ^ 0x51f15e) >>> 0) };
};

/* 把存档 JSON 应用为当前局面（本机档 / 服务器档 / 导入文件共用） */
G.applySaveData = function (d) {
  const candidate = G.prepareSaveData(d);
  G.world = candidate.world; G.game = candidate.game; G.rng = candidate.rng; G.setUid(candidate.nextUid);
  if (G._recoveryBackedUp) G.autosaveBlocked = false;
  G.sel = null; G.tool = null; G.cancelRoadPlan(); G.cancelHarvestPlan(); G.cancelFarmPlan(); G.smoke = []; G.flakes = null; G.keys = {};
  G.ui.hideInfo(); G.ui.setToolActive();
  document.getElementById('over').classList.add('hidden');
  // All cargo is validated and owned by the candidate; now resume its deliveries.
  for (const c of G.world.citizens) if (c.carry) G.startHaul(c); else if(G.isArriving(c))G.startImmigration(c);
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
  G.cancelRoadPlan(); G.cancelHarvestPlan(); G.cancelFarmPlan();
  if (t == null) { G.tool = null; }
  else if (t === 'demolish') G.tool = { kind: 'demolish' };
  else if (['road','stoneroad','bridge'].includes(t)) G.tool = { kind: 'road', surface:t==='stoneroad'?'stone':t==='bridge'?'bridge':'dirt' };
  else if (t === 'fell') G.tool = { kind: 'fell' };
  else if (t === 'quarry') G.tool = { kind: 'quarry' };
  else G.tool = { kind: 'build', type: t };
  G.ui.setToolActive();
};

/* 「砍伐」工具：沿线把树木标记为待砍（按拖拽轨迹逐格标记，不是矩形框选） */
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

/* 「采石采铁」工具拖拽：沿线给岩石做清除标记（与砍伐同款沿线画法；只标岩石，不删建筑） */
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
  if(type==='farm'){G.selectFarmCorner(tx,ty);return;}
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
      G.setRoad(w, x, y, true);
      G.markGroundDirty(x, y);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
};

/* Farm placement is a transient rectangle, not an immediate stamp. */
G.farmPlan=null;G.farmDrag=null;G.farmGestureVersion=0;
G.isFarmPlanning=()=>G.tool?.kind==='build'&&G.tool.type==='farm';
G.cancelFarmPlan=function(){G.farmPlan=null;G.farmDrag=null;G.farmGestureVersion++;};
G.farmPoint=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)?{x:Math.floor(x),y:Math.floor(y)}:null;
G.farmBounds=function(p){if(!p?.start||!p.end)return null;return {x:Math.min(p.start.x,p.end.x),y:Math.min(p.start.y,p.end.y),w:Math.abs(p.end.x-p.start.x)+1,h:Math.abs(p.end.y-p.start.y)+1};};
G.selectFarmCorner=function(x,y){
  if(!G.world||!G.isFarmPlanning()||G.hasOpenModal())return;
  const point=G.farmPoint(x,y);if(!point)return;
  const old=G.farmPlan;
  if(!old||old.world!==G.world||old.game!==G.game||old.end)G.farmPlan={world:G.world,game:G.game,start:point,end:null};
  else G.farmPlan={...old,end:point};
};
G.farmPlanStatus=function(){
  const plan=G.farmPlan,w=G.world;
  if(G.farmDrag)return {ok:false,reason:'正在选择矩形；松开后查看面积与用工，再确认开田'};
  if(!plan||plan.world!==w||plan.game!==G.game||!plan.end)return {ok:false,reason:plan?.world===w?'已选第一角，请选择对角':'鼠标拖出矩形，或点击两个对角；每边4至15格'};
  const bounds=G.farmBounds(plan),size=[bounds.w,bounds.h],def=G.farmDefinition(size),base={plan,bounds,size};
  if(!def)return {...base,ok:false,reason:'农田每边须为4至15格；当前 '+bounds.w+'×'+bounds.h};
  const check=G.canPlace(w,'farm',bounds.x,bounds.y,size);if(!check.ok)return {...base,...check};
  const trees=G.siteTrees(bounds),area=bounds.w*bounds.h,workers=G.initialFarmWorkers(size);
  return {...base,ok:true,area,workers,work:def.buildWork,trees:trees.length,fullYield:area*G.PROD.farm.perTile,
    signature:[bounds.x,bounds.y,...size,w.navigationRevision||0,trees.map(t=>t.i+':'+t.b).join(',')].join('|')};
};
G.confirmFarmPlan=function(intent){
  if(!G.isFarmPlanning()||G.hasOpenModal())return {ok:false,reason:'先关闭弹窗并回到农田规划'};
  const s=G.farmPlanStatus();if(!s.ok)return s;
  if(!intent||intent.plan!==s.plan||intent.signature!==s.signature)return {ok:false,reason:'地块或清树需求已变，请复查预览后重新确认'};
  const r=G.addBuilding('farm',s.bounds.x,s.bounds.y,{farmSize:s.size});
  if(r.ok){G.cancelFarmPlan();G.ui.refreshHUD();}return r;
};

/* Transient, explicitly confirmed road plan. Existing marked work is never
 * cancelled by discarding a preview; planning does not change the world. */
G.roadPlan = null;
G.roadDrag = null;
G.roadGestureVersion = 0;
G.cancelRoadPlan = function () { G.roadPlan = null; G.roadDrag = null; G.roadGestureVersion++; };
G.selectRoadEndpoint = function (x, y) {
  if (!G.world || !G.tool || G.tool.kind !== 'road' || G.hasOpenModal()) return;
  const w = G.world, old = G.roadPlan, surface=G.tool.surface||'dirt';
  let point={x,y};
  if(surface==='bridge'&&old&&old.start&&!old.end)point=G.bridgeEnd(old.start,point);
  if (!old || old.world !== w || old.end) {
    const check = surface==='bridge' ? G.bridgeStartStatus(w,point) : G.planRoad(w, point, point);
    G.roadPlan = { world: w, surface, start: point, end: null, result: check, message: check.ok ? '起点已选，请点击终点' : check.reason };
    if (!check.ok) G.roadPlan.start = null;
    return;
  }
  if (!old.start) { G.roadPlan = null; G.selectRoadEndpoint(x, y); return; }
  const result = surface==='bridge'?G.planBridge(w,old.start,point):G.planRoad(w, old.start, point);
  G.roadPlan = { world: w, surface, start: old.start, end: point, result, message: result.ok ? '' : result.reason };
};
G.roadPlanStatus = function () {
  if (G.roadDrag && G.roadDrag.world === G.world) return { ok: false, reason: '正在选择终点；松开后计算路线，再确认铺路。虚线仅表示起终点方向。' };
  const plan = G.roadPlan, w = G.world;
  if (!plan || plan.world !== w || (plan.surface||'dirt') !== (G.tool?.surface||'dirt') || !plan.end || !plan.result.ok) return { ok: false, reason: plan && plan.world === w ? plan.message : '点击起点，再点击终点预览路线' };
  if(plan.surface==='bridge') {
    const result=G.planBridge(w,plan.start,plan.end);
    if(!result.ok)return result;
    return {ok:true,trees:[],added:[],plan,materials:result.materials,bridge:true};
  }
  const trees = [], added = [];
  for (const p of plan.result.path) {
    const i = p.y * w.N + p.x;
    if (w.water[i] === 1 || w.rock[i] || w.bgrid[i] >= 0) return { ok: false, reason: '路线已被新障碍阻断，请重新选择起终点' };
    if (w.treeIdx[i] >= 0) { trees.push(p); if (!w.marked.has(i)) added.push(p); }
  }
  if (w.marked.size + added.length > 300) return { ok: false, reason: '清树标记将超过300处，请等待现有任务完成或取消多余标记' };
  const materials={wood:0,stone:plan.surface==='stone'?plan.result.path.filter(p=>w.road[p.y*w.N+p.x]!==2).length:0};
  return { ok: true, trees, added, plan, materials };
};
G.confirmRoadPlan = function (intent) {
  if (!G.tool || G.tool.kind !== 'road' || G.hasOpenModal()) return { ok: false };
  const status = G.roadPlanStatus();
  if (!status.ok) return status;
  const w = G.world, plan = status.plan;
  const mode = status.bridge?'bridge':status.trees.length ? 'clear' : 'pave';
  const treeSignature = status.trees.map(p => p.y * w.N + p.x).join(',');
  if (intent && (intent.plan !== plan || intent.mode !== mode || intent.trees !== treeSignature))
    return { ok: false, reason: '路线或清树需求已变化，请复查预览后重新确认' };
  if(status.bridge){const result=G.addBridge(plan.start,plan.end);if(result.ok){G.cancelRoadPlan();G.ui.refreshHUD();}return {...result,bridge:true};}
  if (status.trees.length) {
    for (const p of status.added) G.markFellAt(w, p.x, p.y);
    plan.message = '已确认清树任务；工人清树后，再点击确认铺路；木材仍须搬运入仓。退出规划不会撤销已确认标记。';
    return { ok: true, clearing: true, marked: status.added.length };
  }
  if(G.game.res.stone<status.materials.stone)return {ok:false,reason:`石头不足：需${status.materials.stone}，现有${Math.floor(G.game.res.stone)}`};
  G.game.res.stone-=status.materials.stone;
  let placed = 0;
  for (const p of plan.result.path) {
    const i = p.y * w.N + p.x;
    if (plan.surface==='stone'?w.road[i]!==2:!w.road[i]) { G.setRoad(w, p.x, p.y, plan.surface==='stone'?2:true); G.markGroundDirty(p.x, p.y); placed++; }
  }
  G.cancelRoadPlan();
  G.ui.refreshHUD();return { ok: true, placed, surface:plan.surface||'dirt' };
};

/* Range previews are transient and hold original tree identities, never jobs or
 * inventory. Enumerate only when a corner/drag is committed, not while moving. */
G.harvestPlan = null;
G.harvestGestureVersion = 0;
G.cancelHarvestPlan = function () { G.harvestPlan = null; G.harvestGestureVersion++; };
G.harvestPoint = function (x, y) {
  const w = G.world;
  return w && Number.isFinite(x) && Number.isFinite(y) ? { x: G.clamp(Math.floor(x), 0, w.N - 1), y: G.clamp(Math.floor(y), 0, w.N - 1) } : null;
};
G.beginHarvestRange = function (x, y) {
  if (!G.tool || !['fell', 'quarry'].includes(G.tool.kind) || G.hasOpenModal()) return;
  const p = G.harvestPoint(x, y); if (!p) return;
  G.harvestPlan = { world: G.world, kind: G.tool.kind, start: p, end: p, frozen: false };
};
G.finishHarvestRange = function (x, y, awaitingSecond = false) {
  const p = G.harvestPlan, w = G.world, end = G.harvestPoint(x, y);
  if (!p || p.world !== w || !end || !G.tool || p.kind !== G.tool.kind || G.hasOpenModal()) return;
  const bounds = { x0: Math.min(p.start.x, end.x), y0: Math.min(p.start.y, end.y), x1: Math.max(p.start.x, end.x), y1: Math.max(p.start.y, end.y) };
  const targets = []; let total = 0;
  for (let y = bounds.y0; y <= bounds.y1; y++) for (let x = bounds.x0; x <= bounds.x1; x++) {
    const i = y * w.N + x, tree = p.kind === 'fell' && w.treeIdx[i] >= 0 ? w.trees[w.treeIdx[i]] : null;
    const rock = p.kind === 'quarry' ? w.rock[i] : 0;
    if (!tree && !rock) continue;
    total++;
    // At most 300 existing + 300 new marks can ever fit; bound retained memory.
    if (targets.length < 601) targets.push({ i, tree, rock });
  }
  G.harvestPlan = { ...p, end, bounds, targets, total, frozen: true, awaitingSecond };
};
G.selectHarvestCorner = function (x, y) {
  const p = G.harvestPlan;
  if (p && p.world === G.world && G.tool && p.kind === G.tool.kind && p.awaitingSecond) G.finishHarvestRange(x, y);
  else { G.beginHarvestRange(x, y); G.finishHarvestRange(x, y, true); }
};
G.harvestRangeStatus = function () {
  const p = G.harvestPlan, w = G.world;
  if (!p || p.world !== w || !G.tool || p.kind !== G.tool.kind || !p.frozen)
    return { ok: false, reason: p && !p.frozen ? '拖动范围，松开后查看目标并确认' : '鼠标拖出矩形；手机点两个角。确认前不会下达采集任务。' };
  if (p.total > 600) return { ok: false, reason: '范围内目标过多，请缩小范围；每类最多排队300处。' };
  const marks = p.kind === 'fell' ? w.marked : w.markedRocks, valid = [], added = [];
  const counts = { wood: 0, stone: 0, iron: 0 };
  for (const t of p.targets) {
    if (t.tree ? (w.treeIdx[t.i] < 0 || w.trees[w.treeIdx[t.i]] !== t.tree) : w.rock[t.i] !== t.rock) continue;
    valid.push(t); counts[t.tree ? 'wood' : t.rock === 2 ? 'iron' : 'stone']++;
    if (!marks.has(t.i)) added.push(t);
  }
  const signature = valid.map(t => t.i + ':' + (marks.has(t.i) ? 1 : 0)).join(',');
  const reason = !valid.length ? '范围内已无对应资源，请重选。' : marks.size + added.length > 300 ? '新增标记会超过300处，请缩小范围、等任务完成或取消多余标记。' : '';
  return { ok: !reason, reason, plan: p, valid, added, counts, existing: valid.length - added.length, signature };
};
G.confirmHarvestRange = function (intent) {
  if (G.hasOpenModal()) return { ok: false };
  const s = G.harvestRangeStatus(); if (!s.ok) return s;
  if (intent && (intent.plan !== s.plan || intent.signature !== s.signature)) return { ok: false, reason: '范围或目标已变化，请复查后重新确认。' };
  const w = G.world, mark = s.plan.kind === 'fell' ? G.markFellAt : G.markRockAt;
  for (const t of s.added) mark(w, t.i % w.N, Math.floor(t.i / w.N));
  G.cancelHarvestPlan();
  return { ok: true, marked: s.added.length };
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
    if (document.visibilityState === 'hidden') { resetInput(); G.cancelRoadPlan(); G.cancelHarvestPlan(); G.cancelFarmPlan(); G.autosave(); }
  });
  // 定时自动存档：每 90 秒（游戏进行中）
  setInterval(() => G.autosave(), 90000);

  /* ----- 输入 ----- */
  let dragging = false, dragBtn = -1, dragMoved = 0, lastX = 0, lastY = 0, pressX = 0, pressY = 0;
  let roadTouch = null, harvestTouch = null, roadMouse = null, farmTouch=null, farmMouse=null;
  function resetInput() {
    if (G.harvestPlan && !G.harvestPlan.frozen) G.cancelHarvestPlan();
    G.keys = {};
    dragging = false; dragBtn = -1; dragMoved = 0;
    roadTouch = null; harvestTouch = null; roadMouse = null; G.roadDrag = null;farmTouch=null;farmMouse=null;G.farmDrag=null;
  }
  window.addEventListener('blur', () => { resetInput(); roadTouch = null; G.cancelRoadPlan(); G.cancelHarvestPlan(); G.cancelFarmPlan(); });
  document.addEventListener('focusin', e => { if (G.isInputTarget(e.target)) resetInput(); });

  const toLocal = (e) => {
    const r = G.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const placementPanel = document.getElementById('placement-panel');
  const onPlacementPanel = e => placementPanel && placementPanel.contains && placementPanel.contains(e.target);

  G.cv.addEventListener('contextmenu', e => e.preventDefault());

  G.cv.addEventListener('mousedown', e => {
    if (G.hasOpenModal()) { resetInput(); return; }
    const p = toLocal(e);
    if (e.button === 2 && G.tool) { G.setTool(null); return; } // 右键取消工具
    dragging = true; dragBtn = e.button; dragMoved = 0;
    lastX = pressX = p.x; lastY = pressY = p.y;
    roadMouse = null;farmMouse=null;
    if(e.button===0&&G.isFarmPlanning()){const t=G.screenToTile(p.x,p.y);farmMouse={start:G.farmPoint(t.tx,t.ty),world:G.world,generation:G.farmGestureVersion};}
    if (e.button === 0 && G.tool && G.tool.kind === 'road') {
      const t = G.screenToTile(p.x, p.y);
      roadMouse = { start: { x: Math.floor(t.tx), y: Math.floor(t.ty) }, world: G.world, generation: G.roadGestureVersion };
    }
    if (e.button === 0 && G.tool && ['fell', 'quarry'].includes(G.tool.kind)) {
      const t = G.screenToTile(p.x, p.y);
      G.beginHarvestRange(t.tx, t.ty);
    }
  });

  window.addEventListener('mousemove', e => {
    if (G.hasOpenModal() || onPlacementPanel(e)) { resetInput(); return; }
    const p = toLocal(e);
    const t = G.screenToTile(p.x, p.y);
    G.hover = { tx: Math.floor(t.tx), ty: Math.floor(t.ty) };
    if (!dragging) return;
    const dx = p.x - lastX, dy = p.y - lastY;
    // Maximum displacement, not repeated distance from an unchanged lastX/Y.
    dragMoved = Math.max(dragMoved, Math.abs(p.x - pressX) + Math.abs(p.y - pressY));
    if (dragBtn === 2 || dragBtn === 1 || (dragBtn === 0 && !G.tool && dragMoved > 4)) {
      G.cam.x += dx; G.cam.y += dy;
      lastX = p.x; lastY = p.y;
    } else if(dragBtn===0&&G.isFarmPlanning()&&farmMouse&&farmMouse.world===G.world&&farmMouse.generation===G.farmGestureVersion&&dragMoved>4){
      G.farmDrag={world:G.world,start:farmMouse.start,end:G.farmPoint(t.tx,t.ty)};
    } else if (dragBtn === 0 && G.tool && G.tool.kind === 'road' && roadMouse && roadMouse.world === G.world && roadMouse.generation === G.roadGestureVersion && dragMoved > 4) {
      G.roadPlan = null;
      G.roadDrag = { world: G.world, start: roadMouse.start, end: { x: Math.floor(t.tx), y: Math.floor(t.ty) } };
    } else if (dragBtn === 0 && G.tool && ['fell', 'quarry'].includes(G.tool.kind)) {
      const plan = G.harvestPlan;
      if (plan && !plan.frozen && plan.world === G.world && plan.kind === G.tool.kind) plan.end = G.harvestPoint(t.tx, t.ty);
    }
  });

  window.addEventListener('mouseup', e => {
    if (G.hasOpenModal() || onPlacementPanel(e)) { resetInput(); return; }
    if (!dragging) return;
    dragging = false;
    const p = toLocal(e);
    const t = G.screenToTile(p.x, p.y);
    const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
    dragMoved = Math.max(dragMoved, Math.abs(p.x - pressX) + Math.abs(p.y - pressY));
    if(e.button===0&&G.isFarmPlanning()){const gesture=farmMouse;farmMouse=null;G.farmDrag=null;if(!gesture||gesture.world!==G.world||gesture.generation!==G.farmGestureVersion)return;if(dragMoved>4){G.farmPlan=null;G.selectFarmCorner(gesture.start.x,gesture.start.y);G.selectFarmCorner(tx,ty);}else G.selectFarmCorner(tx,ty);return;}
    if (e.button === 0 && G.tool && G.tool.kind === 'road') {
      const gesture = roadMouse; roadMouse = null; G.roadDrag = null;
      if (!gesture || gesture.world !== G.world || gesture.generation !== G.roadGestureVersion) return;
      if (dragMoved > 4) {
        G.roadPlan = null;
        G.selectRoadEndpoint(gesture.start.x, gesture.start.y);
        // Invalid starts remain a visible error, not a silent new end-as-start.
        if (G.roadPlan && G.roadPlan.start) G.selectRoadEndpoint(tx, ty);
      } else G.selectRoadEndpoint(tx, ty);
      return;
    }
    if (e.button === 0 && G.tool && ['fell', 'quarry'].includes(G.tool.kind)) {
      if (G.harvestPlan && !G.harvestPlan.frozen) G.finishHarvestRange(tx, ty);
      return;
    }
    if (e.button === 0 && dragMoved <= 4) {
      if (G.tool && G.tool.kind === 'build') G.tryPlace(tx, ty);
      else if (G.tool && G.tool.kind === 'demolish') {
        const w = G.world, i = ty * w.N + tx;
        // Keep the legacy demolishAt API; this UI action only targets built objects.
        if (tx >= 0 && ty >= 0 && tx < w.N && ty < w.N && (w.bgrid[i] >= 0 || w.road[i])) G.demolishAt(tx, ty);
        G.ui.refreshHUD();
      } else if (G.tool && G.tool.kind === 'road') {
        G.selectRoadEndpoint(tx, ty);
      } else if (G.tool && G.tool.kind === 'quarry') {
        // 采矿已在按下/拖拽时处理，不能落入对象选择或拆除
      } else {
        G.selectAt(tx, ty, p);
      }
    }
  });

  G.cv.addEventListener('touchstart',e=>{if(!G.isFarmPlanning())return;e.preventDefault();resetInput();farmTouch=!G.hasOpenModal()&&e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY,world:G.world,generation:G.farmGestureVersion}:null;},{passive:false});
  G.cv.addEventListener('touchmove',e=>{if(!G.isFarmPlanning())return;e.preventDefault();if(!farmTouch||e.touches.length!==1||Math.abs(e.touches[0].clientX-farmTouch.x)+Math.abs(e.touches[0].clientY-farmTouch.y)>10)farmTouch=null;},{passive:false});
  G.cv.addEventListener('touchend',e=>{if(!G.isFarmPlanning()){farmTouch=null;return;}e.preventDefault();if(farmTouch&&farmTouch.world===G.world&&farmTouch.generation===G.farmGestureVersion&&e.changedTouches.length===1&&!G.hasOpenModal()){const p=toLocal(e.changedTouches[0]),t=G.screenToTile(p.x,p.y);G.selectFarmCorner(t.tx,t.ty);}farmTouch=null;},{passive:false});
  const harvesting = () => G.tool && ['fell', 'quarry'].includes(G.tool.kind);
  G.cv.addEventListener('touchstart', e => {
    if (!harvesting()) return;
    e.preventDefault(); resetInput();
    harvestTouch = !G.hasOpenModal() && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, world: G.world, generation: G.harvestGestureVersion } : null;
  }, { passive: false });
  G.cv.addEventListener('touchmove', e => {
    if (!harvesting()) return;
    e.preventDefault();
    if (!harvestTouch || e.touches.length !== 1 || Math.abs(e.touches[0].clientX - harvestTouch.x) + Math.abs(e.touches[0].clientY - harvestTouch.y) > 10) harvestTouch = null;
  }, { passive: false });
  G.cv.addEventListener('touchend', e => {
    if (!harvesting()) { harvestTouch = null; return; }
    e.preventDefault();
    if (harvestTouch && harvestTouch.world === G.world && harvestTouch.generation === G.harvestGestureVersion && !G.hasOpenModal() && e.changedTouches.length === 1) {
      const p = toLocal(e.changedTouches[0]), t = G.screenToTile(p.x, p.y);
      G.selectHarvestCorner(t.tx, t.ty);
    }
    harvestTouch = null;
  }, { passive: false });

  G.cv.addEventListener('touchstart', e => {
    if (!G.tool || G.tool.kind !== 'road') return;
    e.preventDefault(); resetInput();
    roadTouch = !G.hasOpenModal() && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, world: G.world, generation: G.roadGestureVersion } : null;
  }, { passive: false });
  G.cv.addEventListener('touchmove', e => {
    if (!G.tool || G.tool.kind !== 'road') return;
    e.preventDefault();
    if (e.touches.length !== 1 || !roadTouch || Math.abs(e.touches[0].clientX - roadTouch.x) + Math.abs(e.touches[0].clientY - roadTouch.y) > 10) roadTouch = null;
  }, { passive: false });
  G.cv.addEventListener('touchcancel', () => { roadTouch = null; harvestTouch = null; G.cancelRoadPlan(); G.cancelHarvestPlan(); G.cancelFarmPlan(); });
  G.cv.addEventListener('touchend', e => {
    if (!G.tool || G.tool.kind !== 'road') { roadTouch = null; return; }
    e.preventDefault();
    if (roadTouch && roadTouch.world === G.world && roadTouch.generation === G.roadGestureVersion && e.changedTouches.length === 1 && !G.hasOpenModal()) {
      const p = toLocal(e.changedTouches[0]), t = G.screenToTile(p.x, p.y);
      G.selectRoadEndpoint(Math.floor(t.tx), Math.floor(t.ty));
    }
    roadTouch = null;
  }, { passive: false });

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
      else if (visible('production-goals')) G.ui.closeProductionGoals();
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
  let best = null, bd = 18 * 18, citizenHomes = null;
  for (const c of w.citizens) {
    if (c.state === 'rest' && c.camped === false && !citizenHomes && G.citizenHomeLookup) citizenHomes = G.citizenHomeLookup(w);
    if ((G.citizenIndoorHome && G.citizenIndoorHome(c, citizenHomes)) || G.inMedicalCare(c) || G.inSchool(c)) continue;
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
