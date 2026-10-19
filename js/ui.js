'use strict';
/* ============================================================
 * ui.js —— HUD、建造菜单、信息面板、通知、存档界面
 * ============================================================ */

G.ui = {
  el: {},
  infoT: 0,

  // Restore the original pre-#110 PNG/emoji set; keep the newer UI contracts.
  iconMarkup: function (symbol, imagePath) {
    // A failed image removes itself, exposing the same registry emoji. The two
    // are never painted on top of each other through the PNG's transparent edge.
    const image = imagePath ? `<img src="${this.escHtml(imagePath)}" alt="" onerror="this.remove()">` : '';
    return `<span class="ui-icon" aria-hidden="true">${image}<span class="icon-fallback">${this.escHtml(symbol)}</span></span>`;
  },

  icon: function (name) {
    if (Object.hasOwn(G.RES || {}, name)) {
      const r = G.RES[name];
      return this.iconMarkup(r.icon, r.iconAsset ? `assets/icons/${r.iconAsset}.png` : null);
    }
    const toolAssets = { stonehouse: 'tool_stonehouse', boarding: 'tool_boarding', mine: 'tool_mine', stonequarry: 'tool_stonequarry',
      blacksmith: 'tool_blacksmith', hunting: 'tool_hunting', house: 'tool_house', storage: 'tool_storage', stockpile: 'tool_stockpile',
      gatherer: 'tool_gatherer', forester: 'tool_forester', woodcutter: 'tool_woodcutter', dock: 'tool_dock',
      school: 'tool_school', herbalist: 'tool_herbalist', hospital: 'tool_hospital', townhall: 'tool_townhall', tavern: 'tool_tavern', farm: 'tool_farm', road: 'tool_road', stoneroad: 'tool_stoneroad', bridge: 'tool_bridge', demolish: 'tool_demolish' };
    const special = { demolish: '🚫', fell: '🪚', quarry: '⛏' };
    if (Object.hasOwn(G.BDEF || {}, name) || Object.hasOwn(special, name)) {
      const symbol = Object.hasOwn(special, name) ? special[name] : G.BDEF[name].icon;
      const image = Object.hasOwn(toolAssets, name) ? `assets/icons/${toolAssets[name]}.png` :
        ['tailor', 'tradingpost', 'pasture', 'orchard', 'chapel'].includes(name) ? `assets/buildings/${name}.png` : null;
      return this.iconMarkup(symbol, image);
    }
    const symbols = { save: '💾', folder: '📂', sprout: '🌱', mail: '📮', help: '❓', people: '👥',
      pause: '⏸', play: '▶', fast: '⏩', fastest: '⏭' };
    if (Object.hasOwn(symbols, name)) return this.iconMarkup(symbols[name]);
    // Controls introduced by the readable UI retain their neutral/status ink.
    const paths = {
      settings:'m4 20 9-9m-3-7 4 2 4-1 3 3-5 2-1 4m-2 1 6 6m-2-4 3-3',
      citizen:'M8 6a4 4 0 1 0 8 0 4 4 0 1 0-8 0ZM4 22v-4a8 8 0 0 1 16 0v4',
      clock:'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0Zm10-6v6l4 3',
      close:'m5 5 14 14M19 5 5 19', chevronDown:'m5 9 7 7 7-7',
      alert:'m12 2 10 19H2Zm0 6v6m0 3h.1', check:'m4 12 5 5L20 6',
    };
    if (!Object.hasOwn(paths, name)) return this.iconMarkup('🏠');
    return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[name]}"></path></svg>`;
  },

  resourceIcon: function (type) {
    const r = G.RES[type];
    return `<span class="res-icon" role="img" aria-label="${r.name}" title="${r.name}">${this.icon(type)}</span>`;
  },

  resourceCost: function (cost, html) {
    return Object.keys(cost).map(type => html
      ? `<span class="res-cost">${this.resourceIcon(type)}<span>${G.RES[type].name} ${cost[type]}</span></span>`
      : `${G.RES[type].name}×${cost[type]}`).join(' ') || '免费';
  },

  // Read-only citizen feedback. Idle is a scheduler state, not proof of a deadlock.
  citizenStatus: function (c) {
    const b = c.job != null ? G.world.bmap[c.job] : null;
    const fire = G.fireRescueState && G.fireRescueState(c);
    if (fire) return fire;
    if(c.mealJourney&&G.householdMealStatus)return G.householdMealStatus(c);
    const supply = G.supplyCitizenStatus && G.supplyCitizenStatus(c);
    if (supply) return supply;
    if (G.isArriving ? G.isArriving(c) : c.arrivalHallId != null) return '迁入途中：先步行到市政厅报到';
    if (c.task && c.task.kind === 'care' && G.medicalStatus) return G.medicalStatus(c);
    if(c.student&&G.studentSummary&&!(c.task?.kind==='worship'&&G.chapelLifeReady?.(c)))return G.studentSummary(c).status;
    if(c.task?.kind==='teach')return c.state==='walk'?'教师步行到校':G.inSchool(c)?'教师已到校，实际授课':'教师尚未到校';
    if (c.task && c.task.kind === 'worship' && c.state !== 'rest' && c.walkKind !== 'home') {
      if (G.isSick && G.isSick(c)) return G.medicalStatus ? G.medicalStatus(c) : '患病，礼拜暂停';
      if (c.hunger > 0) return '饥饿，礼拜暂停：优先补充口粮';
      if (c.cold >= 1) return '受冻，礼拜暂停：优先保暖';
      if (G.chapelLifeReady && !G.chapelLifeReady(c)) return '礼拜暂停：先保障口粮、医疗与课业';
      if (G.validWorshipTask && !G.validWorshipTask(c)) return '礼拜暂停：建筑或牧师岗位已不可用';
      if (c.state === 'walk') return '前往礼拜堂（通勤不计服务时间）';
      if (G.chapelStaff && !G.chapelStaff(c.task.b)) return '等待健康牧师实际到岗，尚未获得礼拜记忆';
      return c.state === 'work' ? `礼拜中（尚需 ${Math.max(0, Number(c.task.workLeft) || 0).toFixed(1)} 小时实际服务）` : '等待礼拜堂服务';
    }
    if (c.task && c.task.kind === 'leisure' && c.state !== 'rest' && c.walkKind !== 'home') {
      if (c.state === 'walk') return '前往酒馆休闲（18 岁以上）';
      if (G.tavernStaff && !G.tavernStaff(c.task.b)) return '等待健康酿酒工到岗（最多等待 4 小时）';
      return c.state === 'work' ? `酒馆休闲中（尚需 ${Math.max(0, Number(c.task.workLeft) || 0).toFixed(1)} 小时服务）` : '等待酒馆服务';
    }
    if (c.state === 'rest') {
      if (G.citizenIndoorHome && G.citizenIndoorHome(c)) return '屋内休息';
      return G.homeOf(c) ? '户外休息（未入屋）' : '露宿（无住房）';
    }
    const construction = G.constructionCarryState && G.constructionCarryState(c);
    if (construction) return construction;
    if (c.task?.kind === 'roadPave' && c.walkKind !== 'home')
      return c.task.phase === 'load' ? '从现场领取铺路石材' : c.state === 'work' ? '正在铺路（该格完工后才提速）' : c.state === 'walk' ? '前往待铺路格' : '等待到格铺路';
    if (c.state === 'work') {
      if(c.task?.kind==='hunt')return '狩猎鹿 #'+c.task.deerId+'（完成后才获得肉皮）';
      if(c.task?.kind==='toolFetch')return '在通用仓领取个人工具（完成领取才扣库存）';
      if(c.task?.kind==='tailor')return c.task.phase==='fetch'?'在库领取整批衣料':`制作${G.RES[c.task.yield.type].name}（使用随身衣料）`;
      if(c.task?.kind==='fuel')return c.task.phase==='fetch'?'在库领取原木（整批出库）':'劈柴中（使用随身已取原木）';
      if(c.task?.kind==='smith')return c.task.phase==='fetch'?'在库取铁匠原料（整批出库）':`锻造${G.RES[c.task.yield.type].name}（使用随身已取原料）`;
      if (c.task && c.task.kind === 'brew') return c.task.phase === 'fetch' ? `取${this.brewInputName(c.task)}酿酒` : '加工麦酒';
      if (c.task && c.task.kind === 'host') return '酒馆在岗接待';
      if (c.task && c.task.kind === 'cleric') return G.chapelStaff && G.chapelStaff(c.task.b) ? '牧师在岗主持礼拜' : '牧师服务暂停：需健康且实际到岗';
      if (c.task && c.task.kind === 'clinic') return b && b.type === 'herbalist' ? '采药屋值守' : '诊所值守';
      if (c.task && c.task.kind === 'trade') return c.task.phase === 'return' ? '退回待售库存' : '装卸贸易物资';
      if(c.task?.kind==='orchard')return ({plant:'种植果树',tend:'养护幼树',harvest:'采收果实'})[c.task.phase]+'（第'+(c.task.ti+1)+'株）';
      const labels = { clearSite: '清理工地', chop: '砍伐', clearrock: '清矿', build: '建造中', sow: '播种', harvest: '收获', plant: '补种', firewood: '加工柴火' };
      return c.task ? (labels[c.task.kind] || (b && b.type === 'tailor' ? '制作衣物' : b && b.type === 'orchard' ? '果园劳作' : b && b.type === 'pasture' ? `照料${G.LIVESTOCK[G.pastureTypeOf(b)].name}群` : '工作中')) : '等待下一项任务';
    }
    if (c.state === 'walk' || c.state === 'haul') {
      if(Number.isInteger(c.carry?.huntingId))return (c.carry.huntingId===0?'运送遗留肉皮入仓：':'运送猎物入仓：')+this.cargoText(c.carry);
      if(c.task?.kind==='hunt'&&c.walkKind!=='home')return '步行追踪鹿 #'+c.task.deerId;
      if(c.carry?.coatInput)return c.state==='haul'?'退回未使用衣料':c.walkKind==='home'?'带衣料回家休息':'携衣料返回裁缝铺';
      if(c.carry?.fuelInput)return c.state==='haul'?'退回未使用的原木':c.walkKind==='home'?'带原木回家休息':'携原木返回伐木屋';
      if(c.carry?.smithInput)return c.state==='haul'?'退回铁匠原料（已出库，未消耗）':c.walkKind==='home'?'带铁匠原料回家休息':c.task?.kind==='smith'?'携铁、木或煤返回铁匠铺':'铁匠原料待退仓';
      if (c.carry) return c.carry.brewIngredient ? `搬运酿酒${G.RES[c.carry.type].name}（${c.state === 'haul' ? '退回仓库' : '送往酒馆'}）` : `搬运${G.RES[c.carry.type].name}（${c.state === 'haul' ? '送仓' : '途中'}）`;
      if (c.walkKind === 'home') return '回家途中';
      if (c.walkKind === 'wander') return '闲逛';
      if(c.task?.kind==='toolFetch')return '步行去通用仓领工具（尚未扣库存）';
      if(c.task?.kind==='tailor')return c.task.phase==='fetch'?'前往通用仓取衣料（尚未扣料）':`返回裁缝铺制作${G.RES[c.task.yield.type].name}`;
      if (c.task && c.task.kind === 'firewood' && c.task.phase === 'fetch') return c.task.consume && G.RES[c.task.consume.type] ? `前往仓库取${G.RES[c.task.consume.type].name}` : '前往仓库取原木';
      if(c.task?.kind==='orchard')return ({plant:'前往空树位种植',tend:'前往幼树照料',harvest:'前往成熟果树采果'})[c.task.phase]+'（第'+(c.task.ti+1)+'株）';
      if(c.task?.kind==='fuel')return '前往堆料场或仓库取原木（尚未扣料）';
      if(c.task?.kind==='smith')return '前往堆料场或仓库取铁匠原料（尚未扣料）';
      if (c.task && c.task.kind === 'brew') return c.task.phase === 'fetch' ? `前往仓库取酿酒${this.brewInputName(c.task)}` : '前往酒馆加工麦酒';
      if (c.task && c.task.kind === 'cleric') return '牧师步行前往礼拜堂（尚未提供服务）';
      if (c.task && c.task.kind === 'trade') return c.task.phase === 'fetch' ? '前往仓库备货' : '运送贸易物资';
      return '前往工作点';
    }
    if (c.carry) return G.cargoWaitReason(c) || '等待送仓（需可达仓库）';
    if (G.isSick && G.isSick(c) && G.medicalStatus) return G.medicalStatus(c);
    if (c.student) return '就读中';
    if (!b) return c.age >= G.ADULT_AGE ? '散工待命' : '玩耍休息';
    if (b.state === 'site') return '等待下一项施工任务';
    if (b.type === 'school') return '教学中';
    if (b.type === 'tradingpost') return b.warnText || '贸易站备货待命';
    if (b.type === 'tavern' && G.tavernSummary) return G.tavernSummary(b).reason || '等待酒馆酿造或接待任务';
    if (b.type === 'chapel' && G.chapelSummary) return G.chapelSummary(b).status || '等待礼拜堂服务安排';
    if (b.type === 'pasture' && !(b.animals > 0)) return '等待放入同种牲畜';
    if (b.type === 'orchard' && G.orchardSummary) return G.orchardSummary(b).status;
    if (['mine', 'stonequarry'].includes(b.type) && G.mineralSummary) {
      const mineral = G.mineralSummary(b);
      if (mineral.finite && mineral.reason) return mineral.reason;
    }
    if (G.productionLimited(b) && G.buildingGoalStatus(b)) return G.buildingGoalStatus(b);
    if (G.fuelLimited(b)) return '暂停生产（柴火已达目标）';
    if (G.toolLimited(b)) return '暂停生产（工具已达目标）';
    if (b.type === 'woodcutter' && G.game.res.wood < G.PROD.woodcutter.logsIn) return '等待原木';
    if (b.type === 'blacksmith' && !G.jobCanProduce(b)) return G.blacksmithOutput(b) === 'steelTools' ? '等待铁、原木或煤' : '等待铁或原木';
    if (b.type === 'tailor' && G.tailorSummary) {
      const summary = G.tailorSummary(b);
      return !summary.canProduce ? summary.reason : b.noWork && b.warnText ? `等待：${b.warnText}` : '等待下一批衣物制作';
    }
    if (b.type === 'farm' && !G.farmHasWork(b)) return '农闲（等待播种或收获）';
    if (b.noWork && b.warnText) return `等待：${b.warnText}`;
    return '等待下一项任务';
  },

  // Read-only estimate at the current occupancy. endDay has already charged the
  // current winter day, so only later daily deductions belong in futureWinter.
  // Keep demand unrounded for stock comparisons; only displayed totals round up.
  heatDemand: function () {
    const g = G.game, w = G.world;
    const fullWinter = w.buildings.reduce((n, b) =>
      n + (G.isOccupiedHome(w, b) ? G.BDEF[b.type].warmWoodPerYear : 0), 0);
    const winter = g.season === 3;
    const futureDays = winter ? Math.max(0, G.SEASON_DAYS - 1 - g.day % G.SEASON_DAYS) : G.SEASON_DAYS;
    return { fullWinter, winter, futureDays, futureWinter: fullWinter * futureDays / G.SEASON_DAYS };
  },

  heatDemandText: function (heat) {
    return `当前已入住住房：整冬约需 ${heat.fullWinter} 柴火` + (G.heatingPolicy?.().allowCoal?`当量（煤补柴已开，可用煤 ${G.heatingCoalAvailable().toFixed(2)}，1煤=2柴）`:'') +
      (heat.winter ? `；本冬此后约需 ${Math.ceil(heat.futureWinter)}（还剩 ${heat.futureDays} 次扣除）` : '');
  },

  fuelInfoData: function (b) {
    const heat = this.heatDemand(), stock = G.game.res.firewood,usable=G.usableHeatingFuel?G.usableHeatingFuel():stock;
    const need = heat.winter ? heat.futureWinter : heat.fullWinter;
    let status;
    if (b.state === 'site') {
      const trees = G.siteTrees ? G.siteTrees(b).length : 0;
      status = this.siteInfoData(b).status;
    } else if (G.productionGoalOf('firewood') !== null && G.fuelLimited(b)) status = G.buildingGoalStatus(b);
    else if (G.fuelLimited(b)) status = '本屋暂停新批次：柴火库存已达本屋目标';
    else if (!G.jobCanProduce(b)) status = '本屋暂无新批次：缺原木';
    // A previous limit warning can outlive its cutoff after fuel is used up.
    else if (b.warnText !== '柴火已达上限' && (b.noWork || (b.warnText && !b.workers.length)))
      status = `停工：${b.warnText || '无法工作'}`;
    else status = b.workers.length ? '运作中' : '等待可用工人';
    return {
      target: `本屋燃料目标：${G.fuelLimitOf(b)}` + (G.productionGoalOf('firewood') !== null ? '；' + G.buildingGoalStatus(b) : ''),
      stock: `${G.supplyEnabled && G.supplyEnabled() ? '公共库存' : '全镇库存'}：柴火 ${Math.floor(stock)} · 原木 ${Math.floor(G.game.res.wood)}` + (G.supplyEnabled?.() ? `；目标计量柴火 ${this.supplyNumber(G.supplyEconomyStock('firewood'))}（含已配送与待回收，不含火情封存）` : ''),
      batches:this.fuelBatchText(b),
      heat: this.heatDemandText(heat),
      gap: usable < need ? `${G.heatingPolicy?.().allowCoal?'可用燃料':'柴火库存'}比${heat.winter ? '本冬后续' : '整冬'}取暖估算少约 ${Math.ceil(need - usable)}。` : '取暖估算会随住房入住情况变化。',
      status,
      workers: b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、') ||
        (b.state === 'site' ? '等待建筑工人' : '无'),
      refund: b.state === 'site' ? this.siteInfoData(b).refund : '已开工：拆除退还一半已付建材，已砍树不恢复',
    };
  },

  fuelBatchText: function(b){
    const rows=G.world.citizens.filter(c=>!c.dead&&(c.carry?.firewoodId===b.id||c.job===b.id&&c.carry?.fuelInput||[c.task,c.pausedTask].some(t=>t?.kind==='fuel'&&t.b===b))).map(c=>{
      const t=[c.task,c.pausedTask].find(t=>t?.kind==='fuel'&&t.b===b);
      if(c.carry?.type==='firewood')return `${c.name}：已产柴火 ${c.carry.qty.toFixed(2)}，${G.cargoWaitReason(c)||'送仓途中，尚不可使用'}`;
      if(c.carry?.coatInput)return c.state==='haul'?'退回未使用衣料':c.walkKind==='home'?'带衣料回家休息':'携衣料返回裁缝铺';
      if(c.carry?.fuelInput)return `${c.name}：原木 ${c.carry.qty.toFixed(2)} 已出库，${t?.phase==='process'?(c.pausedTask===t?'夜间暂停，次日续做':c.state==='work'?'在屋劈柴':'携木回屋'):'中断后退仓'}；不再重复扣料`;
      return `${c.name}：前往可达仓库取2原木，尚未扣料`;
    });return rows.join('；')||'暂无正在领料或送柴的批次';
  },

  refreshFuelInfo: function (b) {
    const el = this.el.info;
    if (!el.querySelector) return false; // Existing minimal DOM fixtures.
    const data = this.fuelInfoData(b), nodes = {};
    for (const key of Object.keys(data)) {
      nodes[key] = el.querySelector(`[data-fuel="${key}"]`);
      if (!nodes[key]) return false;
    }
    for (const key of Object.keys(data))
      if (nodes[key].textContent !== data[key]) nodes[key].textContent = data[key];
    return true;
  },

  init: function () {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), date: $('date'), pop: $('pop'),
      resRow: $('res-row'), speed: $('speed'),
      toolbar: $('toolbar'), info: $('info'), toasts: $('toasts'),
      over: $('over'), overText: $('over-text'), help: $('help'),
      guide: $('survival-guide'), placement: $('placement-info'),
      harvestCancel: $('harvest-cancel'), cancelTrees: $('cancel-tree-marks'),
      cancelRocks: $('cancel-rock-marks'), cancelStatus: $('harvest-cancel-status'),
    };

    // Core resources never disappear or move when their amount reaches zero.
    this.initResourceHUD();
    this.initGuideHUD();
    for (const [id, name] of [['btn-err', 'alert'], ['btn-production-goals', 'settings'], ['btn-save', 'save'], ['btn-load', 'folder'], ['btn-new', 'sprout'], ['btn-fb', 'mail'], ['btn-help', 'help']]) {
      const button = $(id);
      if (button && this.icon) button.innerHTML = this.icon(name);
    }

    // 速度按钮（原版：暂停 / 1x / 2x / 5x）
    this.el.speed.innerHTML = [
      ['pause', 'pause', '暂停 (空格)', '暂停'],
      ['play', 1, '正常速度 (1)', '1×'],
      ['fast', 2, '二倍速 (2)', '2×'],
      ['fastest', 5, '五倍速 (3)', '5×'],
    ].map(([ic, v, tip, label]) =>
      `<button class="sp" data-v="${v}" title="${tip}" aria-label="${tip}">${this.icon ? this.icon(ic) : ''}<span>${label}</span></button>`
    ).join('');
    this.el.speed.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (G.hasOpenModal && G.hasOpenModal()) return;
        const v = btn.dataset.v;
        if (v === 'pause') G.game.paused = !G.game.paused;
        else { G.game.paused = false; G.game.speed = +v; }
        this.refreshHUD();
      });
    });

    this.initToolbar();
    this.initHarvestControls();
    this.initHarvestRangeControls();
    this.initProductionGoals();
    this.initRoadControls();
    this.initFarmPlanControls();
    this.initPasturePlanControls();
    this.initOrchardPlanControls();
    this.initCemeteryPlanControls();
    this.initNewGameSettings();

    // 顶栏按钮
    document.getElementById('btn-save').addEventListener('click', () => { G.saveGame(); });
    document.getElementById('btn-load').addEventListener('click', () => this.showSaves());
    document.getElementById('btn-new').addEventListener('click', () => this.showNewGameSettings());
    document.getElementById('btn-help').addEventListener('click', () => this.toggleHelp());
    document.getElementById('btn-err').addEventListener('click', () => this.showErrs());
    document.getElementById('errs-close').addEventListener('click', () => this.closeErrs());
    document.getElementById('errs-clear').addEventListener('click', () => {
      window.__errs.length = 0;
      this.refreshHUD();
    });
    document.getElementById('help-close').addEventListener('click', () => this.toggleHelp(false));
    document.getElementById('over-restart').addEventListener('click', () => this.showNewGameSettings());
    document.getElementById('saves-close').addEventListener('click', () => this.closeSaves());

    this.refreshHUD();
    this.initHUDLayout();
  },

  initHUDLayout: function () {
    const hud = this.el.hud, top = document.getElementById('topbar'), toolbar = this.el.toolbar;
    if (!hud || !hud.style || !top || !toolbar || typeof ResizeObserver === 'undefined') return;
    const resize = () => {
      hud.style.setProperty('--hud-height', `${top.offsetHeight}px`);
      hud.style.setProperty('--toolbar-height', `${toolbar.offsetHeight}px`);
    };
    if (this._layoutObserver) this._layoutObserver.disconnect();
    this._layoutObserver = new ResizeObserver(resize);
    this._layoutObserver.observe(top); this._layoutObserver.observe(toolbar); resize();
  },

  // Keep every real tool mounted: switching category never recreates buttons.
  initToolbar: function () {
    const special = ['fell', 'quarry', 'demolish'];
    const available = t => !['burntruins', 'mineralpit'].includes(t) && (special.includes(t) || !!G.BDEF[t]);
    this.toolGroups = [
      { id: 'homes', name: '住房', icon: '🏠', tools: ['house', 'stonehouse', 'boarding'] },
      { id: 'food', name: '食物生产', icon: '🌾', tools: ['gatherer', 'hunting', 'dock', 'farm', 'orchard', 'pasture'] },
      { id: 'industry', name: '资源与加工', icon: '⚒️', tools: ['forester', 'woodcutter', 'stonequarry', 'mine', 'blacksmith', 'tailor', 'tavern'] },
      { id: 'services', name: '城镇服务', icon: '🏘️', tools: ['storage', 'stockpile', 'market', 'well', 'school', 'herbalist', 'hospital', 'chapel', 'tradingpost', 'townhall', 'cemetery'] },
      { id: 'land', name: '道路与采运', icon: '🛣️', tools: ['road', 'stoneroad', 'bridge', 'tunnel', 'fell', 'quarry', 'demolish'] },
    ].map(group => ({ ...group, tools: group.tools.filter(available) })).filter(group => group.tools.length);
    const registered = new Set(this.toolGroups.flatMap(group => group.tools));
    const extra = (G.TOOLBAR || []).filter(t => available(t) && !registered.has(t));
    if (extra.length) this.toolGroups.push({ id: 'other', name: '其他建筑', icon: '🔨', tools: extra });
    this.menuCategory = null;
    this.el.toolbar.innerHTML = `
      <div class="toolbar-heading">
        <button type="button" id="toolbar-back" class="toolbar-nav hidden" title="返回分类，并取消当前工具与未确认预览">‹ 返回分类</button>
        <span id="toolbar-path">建造与管理</span>
        <button type="button" id="toolbar-cancel" class="toolbar-nav hidden" title="退出当前工具；已确认的采运任务会保留">取消工具</button>
      </div>
      <div id="toolbar-categories" class="toolbar-items" role="group" aria-label="一级功能分类">
        ${this.toolGroups.map(group => this.toolCategoryButton(group)).join('')}
      </div>
      ${this.toolGroups.map(group => `<div id="toolbar-group-${group.id}" class="toolbar-items tool-group hidden" data-tool-group="${group.id}" role="group" aria-label="${group.name}二级操作">${group.tools.map(t => this.toolButton(t)).join('')}</div>`).join('')}
      <p id="toolbar-state" role="status" aria-live="polite">选择分类，再选择建筑或操作。</p>`;
    this.el.toolbar.querySelectorAll('[data-category]').forEach(btn => btn.addEventListener('click', () => this.openToolCategory(btn.dataset.category)));
    this.el.toolbar.querySelectorAll('[data-tool]').forEach(btn => btn.addEventListener('click', () => {
      if (G.hasOpenModal && G.hasOpenModal()) return;
      const k = btn.dataset.tool;
      const active = !!G.tool && (G.tool.kind === k || (G.tool.kind === 'build' && G.tool.type === k));
      G.setTool(active ? null : k);
    }));
    document.getElementById('toolbar-back').addEventListener('click', () => this.backToCategories());
    document.getElementById('toolbar-cancel').addEventListener('click', () => {
      if (G.hasOpenModal && G.hasOpenModal()) return;
      const selected = G.tool && (G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='tunnel'?'tunnel':G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind);
      G.setTool(null);
      const button = selected && this.el.toolbar.querySelector(`[data-tool="${selected}"]`);
      if (button && button.focus) button.focus({ preventScroll: true });
    });
    // Main handles Escape for active tools and selections; handle only the
    // remaining category level, so one Escape never dismisses two levels.
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || e.repeat || !this.menuCategory || G.tool || G.sel ||
          (G.hasOpenModal && G.hasOpenModal()) || (G.isEditingTarget && G.isEditingTarget(e.target))) return;
      this.backToCategories(); e.preventDefault(); e.stopImmediatePropagation();
    }, true);
  },

  toolCategoryButton: function (group) {
    const name=this.escHtml(group.name);
    return `<button type="button" class="tb tb-category" data-category="${group.id}" aria-controls="toolbar-group-${group.id}" aria-expanded="false" aria-label="${name}" title="${name}"><span class="ic" aria-hidden="true">${this.iconMarkup(group.icon)}</span><span class="category-label"><span class="lb">${name}</span><span class="category-arrow" aria-hidden="true">›</span></span></button>`;
  },

  toolButton: function (t) {
    const special = {
      demolish: { name: '拆除', icon: '🚫', cost: '建筑 · 道路', tip: '拆除：点击建筑或道路移除；树木请用砍伐，岩石和铁矿请用采石采铁' },
      quarry: { name: '采石采铁', icon: '⛏', cost: '灰石 · 锈铁', tip: '采石采铁：框选预览并确认矿石；灰色岩石产石头，锈色铁矿产铁，散工开采后搬运入库' },
      fell: { name: '砍伐', icon: '🪚', cost: '免费', tip: '标记砍伐：框选预览并确认树木，散工砍倒再搬运入库；未受教育 2 原木、受教育 3 原木' },
    };
    const def = G.BDEF[t], action = special[t];
    const name = action ? action.name : def.name, icon = action ? action.icon : def.icon;
    const cost = action ? action.cost : t === 'road' ? '免材料 · 每格1工时' : t === 'stoneroad' ? '每格1石 · 1工时' : t === 'tunnel' ? '每格4石 · 3工时' : t === 'pasture' ? '6×6 · 30木 · 1名牧人' : t === 'orchard' ? '6×6 · 12木 · 9株' : t === 'cemetery' ? '7–20格 · 按墓位规划' : this.resourceCost(def.cost, true);
    const tip = action ? action.tip : t === 'tunnel' ? '隧道：选两个已清场陆地洞口，沿一个网格轴穿过连续山体；每格4石、3游戏施工小时（含两端）。只在首选洞口实运材料并施工，完工后按土路速度通行' : t === 'cemetery' ? '墓园：每边7–20格，选两个角或拖出矩形；预览实际墓位、石材和工时，确认后实运施工。拆围栏不清除墓碑' : t === 'pasture' ? '牧场：点击地图放置固定6×6；羊12头、牛10头或鸡24只，1名牧人，30木、50工时' : t === 'orchard' ? '果园：点击地图放置固定6×6；9株、2名农夫，12木、36工时' : ['road', 'stoneroad'].includes(t) ? `${t === 'stoneroad' ? '石路每个新铺/升级格需1石' : '土路无需材料'}：点选或拖出起终点预览连通路线，清树后再确认施工；每格1基础游戏施工小时为本作适配。确认排队，逐格实运施工后才提速；原道路仍可走` :
      `${def.name}（${this.resourceCost(def.cost, false)}${def.jobs ? ' · 岗位×' + def.jobs : ''}）— ${def.desc}`;
    const shortage = this.toolMaterialShortage(t);
    return `<button type="button" class="tb${shortage ? ' is-short' : ''}" data-tool="${t}" title="${this.escHtml(tip)}" aria-pressed="false"><span class="ic" aria-hidden="true">${this.icon(t)}</span><span class="lb">${name}</span><span class="cost">${cost}</span><span class="material-badge${shortage ? '' : ' hidden'}" data-material-shortage="${t}">${shortage ? '缺料 · 可选址' : ''}</span></button>`;
  },

  // Preview is always available. addBuilding/plan confirmation retains the
  // authoritative public-stock check; opening a tool spends/reserves nothing.
  toolMaterialShortage: function (type) {
    const def = G.BDEF[type];
    if (!def || !G.game || ['road','stoneroad','bridge','tunnel','farm','pasture','orchard','cemetery'].includes(type)) return '';
    return Object.entries(def.cost || {}).filter(([key, qty]) => (G.game.res[key] || 0) < qty)
      .map(([key, qty]) => `${G.RES[key].name}缺${Math.ceil(qty - (G.game.res[key] || 0))}`).join('、');
  },

  refreshToolAffordability: function () {
    if (!this.el.toolbar) return;
    this.el.toolbar.querySelectorAll('[data-tool]').forEach(btn => {
      const missing = this.toolMaterialShortage(btn.dataset.tool);
      btn.classList.toggle('is-short', !!missing);
      const badge = btn.querySelector('[data-material-shortage]');
      if (badge) { badge.classList.toggle('hidden', !missing); badge.textContent = missing ? '缺料 · 可选址' : ''; badge.title = missing; }
      const base = btn._materialBaseTitle || btn.title || btn.getAttribute('title') || '';
      btn._materialBaseTitle = base;
      btn.title = base + (missing ? `；${missing}。可先查看选址，正式落点仍需公共库存足额；不预扣。` : '');
    });
  },

  openToolCategory: function (id) {
    if ((G.hasOpenModal && G.hasOpenModal()) || !this.toolGroups || !this.toolGroups.some(group => group.id === id)) return;
    if (G.tool) G.setTool(null);
    this.menuCategory = id;
    this.refreshToolbarNavigation();
    const first = this.el.toolbar.querySelector(`[data-tool-group="${id}"] button`);
    if (first && first.focus) first.focus({ preventScroll: true });
  },

  backToCategories: function () {
    if (G.hasOpenModal && G.hasOpenModal()) return;
    const previous = this.menuCategory;
    if (G.tool) G.setTool(null);
    this.menuCategory = null;
    this.refreshToolbarNavigation();
    const button = previous && this.el.toolbar.querySelector(`[data-category="${previous}"]`);
    if (button && button.focus) button.focus({ preventScroll: true });
  },

  refreshToolbarNavigation: function () {
    if (!this.toolGroups) return;
    const group = this.toolGroups.find(item => item.id === this.menuCategory);
    const categories = document.getElementById('toolbar-categories');
    if (categories) categories.classList.toggle('hidden', !!group);
    this.el.toolbar.querySelectorAll('[data-tool-group]').forEach(node => node.classList.toggle('hidden', node.dataset.toolGroup !== this.menuCategory));
    this.el.toolbar.querySelectorAll('[data-category]').forEach(btn => btn.setAttribute('aria-expanded', String(btn.dataset.category === this.menuCategory)));
    const back = document.getElementById('toolbar-back'), cancel = document.getElementById('toolbar-cancel');
    if (back) back.classList.toggle('hidden', !group);
    if (cancel) cancel.classList.toggle('hidden', !G.tool);
    const path = document.getElementById('toolbar-path'), status = document.getElementById('toolbar-state');
    if (path) path.textContent = group ? `建造与管理 / ${group.name}` : '建造与管理';
    if (status) {
      const t = G.tool && (G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='tunnel'?'tunnel':G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind);
      const names = { fell: '砍伐', quarry: '采石采铁', demolish: '拆除', road: '铺路' };
      status.textContent = t ? `当前：${names[t] || G.BDEF[t].name} · ${t === 'demolish' ? '点击建筑或道路拆除；已开采的有限矿点须确认永久废坑' : ['fell', 'quarry'].includes(t) ? '框选范围后确认标记' : ['road','stoneroad','bridge','tunnel'].includes(t) ? '选起终点后预览并确认' : t==='farm'?'选两个角或拖出矩形，再确认开田' : t==='pasture'||t==='orchard'?'点击地图放置固定6×6，可连续建造' : t==='cemetery'?'选两个角或拖出矩形，再确认建园' : '点击地图放置，可连续建造'} · Esc / 右键取消${this.mineralBuildRisk(t) ? '\n' + this.mineralBuildRisk(t) : ''}` :
        group ? '未选择工具。点击一项开始；返回分类可切换功能。' : '选择分类，再选择建筑或操作。';
    }
  },

  mineralBuildRisk: function (type) {
    if (!['mine', 'stonequarry'].includes(type)) return '';
    const capacity = G.MINERAL_RULES?.[type]?.capacity || (type === 'mine' ? 7000 : 4000);
    const reserve = type === 'mine' ? `新矿井共 ${capacity} 储量单位，最多采 ${Math.floor(capacity / 2)} 铁或 ${capacity} 煤（共享储量，切换不补充）`
      : `新采石场最多采 ${capacity} 石头（本作适配数值）`;
    return `${reserve}。首次实际开采后拆除会永久留下 3×3 废矿坑，无法复垦、建造或通行；未开采时取消/拆除不留坑。`;
  },

  setToolActive: function () {
    this.el.toolbar.querySelectorAll('button').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tool && btn.setAttribute) btn.setAttribute('aria-pressed', 'false');
    });
    if (G.tool) {
      const t = G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='tunnel'?'tunnel':G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind;
      const btn = this.el.toolbar.querySelector(`[data-tool="${t}"]`);
      if (btn) { btn.classList.add('active'); if (btn.setAttribute) btn.setAttribute('aria-pressed', 'true'); }
      const group = this.toolGroups && this.toolGroups.find(item => item.tools.includes(t));
      if (group) this.menuCategory = group.id;
    }
    this.refreshToolbarNavigation();
    this.refreshHarvestControls();
    this.refreshHarvestRangeControls();
    this.refreshRoadControls();
    this.refreshFarmPlanControls();
    this.refreshPasturePlanControls();
    this.refreshOrchardPlanControls();
    this.refreshCemeteryPlanControls();
  },

  initHarvestRangeControls: function () {
    const confirm = document.getElementById('harvest-confirm'), cancel = document.getElementById('harvest-preview-cancel');
    if (!confirm || !cancel) return;
    let armed = null, keyHeld = false;
    const capture = e => {
      if (e.type === 'mousedown' && armed && armed.source === 'touchstart') return;
      keyHeld = false;
      armed = confirm._harvestIntent ? { ...confirm._harvestIntent, source: e.type } : null;
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) confirm.addEventListener(name, capture);
    confirm.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key) || e.repeat) return;
      keyHeld = true;
      armed = confirm._harvestIntent ? { ...confirm._harvestIntent, source: 'keyboard' } : null;
    });
    confirm.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) keyHeld = false; });
    confirm.addEventListener('pointercancel', () => { armed = null; keyHeld = false; });
    confirm.addEventListener('touchcancel', () => { armed = null; keyHeld = false; });
    window.addEventListener('blur', () => { armed = null; keyHeld = false; });
    confirm.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const intent = armed || confirm._harvestIntent;
      if (!keyHeld) armed = null;
      if (!intent) { this.refreshHarvestRangeControls(); return; }
      const result = G.confirmHarvestRange(intent);
      if (result.reason) this.toast(result.reason, 'warn');
      else if (result.ok) this.toast(`已新增 ${result.marked} 处采集标记；工人仍需作业和搬运`, 'good');
      this.refreshHarvestRangeControls();
    });
    cancel.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (G.hasOpenModal()) return;
      G.cancelHarvestPlan(); this.refreshHarvestRangeControls();
    });
  },
  refreshHarvestRangeControls: function (force = true) {
    const el = document.getElementById('harvest-range-controls'); if (!el) return;
    const visible = !!G.world && !!G.tool && ['fell', 'quarry'].includes(G.tool.kind);
    if (!visible && el.contains(document.activeElement)) {
      const tool = G.tool ? (G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='tunnel'?'tunnel':G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind) : this._harvestRangeTool;
      const button = tool && this.el.toolbar.querySelector(`[data-tool="${tool}"]`);
      if (button) button.focus({ preventScroll: true });
    }
    el.classList.toggle('hidden', !visible); if (!visible) return;
    this._harvestRangeTool = G.tool.kind;
    const now = Date.now(), stamp = [G.harvestPlan, G.world, G.tool.kind, G.hasOpenModal(), G.world.marked.size, G.world.markedRocks.size];
    if (!force && this._rangeStamp && stamp.every((v, i) => v === this._rangeStamp[i]) && now - this._rangeRefreshAt < 250) return;
    this._rangeStamp = stamp; this._rangeRefreshAt = now;
    const text = document.getElementById('harvest-range-status'), button = document.getElementById('harvest-confirm');
    if (!text || !button) return;
    const s = G.harvestRangeStatus();
    let message = s.reason || '';
    if (s.counts) message = `树木 ${s.counts.wood} 棵 · 石头 ${s.counts.stone} 处 · 铁矿 ${s.counts.iron} 处\n新增 ${s.added.length} 处 · 已标记 ${s.existing} 处` + (s.reason ? '\n' + s.reason : '');
    message += '\n鼠标拖出矩形；手机点两个角。单格也可确认。退出预览不撤销已下达任务。';
    if (text.textContent !== message) text.textContent = message;
    button._harvestIntent = s.ok ? { plan: s.plan, signature: s.signature } : null;
    button.disabled = !s.ok || !s.added.length || G.hasOpenModal();
  },

  initFarmPlanControls: function(){
    const confirm=document.getElementById('farm-plan-confirm'),cancel=document.getElementById('farm-plan-cancel');if(!confirm||!cancel)return;
    let armed=null,keyHeld=false;
    const capture=e=>{if(e.type==='mousedown'&&armed?.source==='touchstart')return;keyHeld=false;armed=confirm._farmIntent?{...confirm._farmIntent,source:e.type}:null;};
    for(const name of(window.PointerEvent?['pointerdown']:['mousedown','touchstart']))confirm.addEventListener(name,capture);
    confirm.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key)||e.repeat)return;keyHeld=true;armed=confirm._farmIntent?{...confirm._farmIntent,source:'keyboard'}:null;});
    confirm.addEventListener('keyup',e=>{if(['Enter',' '].includes(e.key))keyHeld=false;});
    for(const name of ['pointercancel','touchcancel'])confirm.addEventListener(name,()=>{armed=null;keyHeld=false;});
    window.addEventListener('blur',()=>{armed=null;keyHeld=false;});
    confirm.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const intent=armed||confirm._farmIntent;if(!keyHeld)armed=null;if(!intent){this.refreshFarmPlanControls();return;}const r=G.confirmFarmPlan(intent);if(r.ok)this.toast(`农田 ${r.b.w}×${r.b.h} 已规划；工人清场施工后才能播种`,'good');else if(r.reason)this.toast(r.reason,'warn');this.refreshFarmPlanControls();});
    cancel.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(G.hasOpenModal())return;armed=null;keyHeld=false;G.cancelFarmPlan();this.refreshFarmPlanControls();});
  },
  refreshFarmPlanControls: function(){
    const el=document.getElementById('farm-plan-controls');if(!el)return;
    const visible=!!G.world&&G.isFarmPlanning&&G.isFarmPlanning();
    if(!visible&&el.contains&&el.contains(document.activeElement)){const b=this.el.toolbar?.querySelector('[data-tool="farm"]');if(b)b.focus({preventScroll:true});}
    el.classList.toggle('hidden',!visible);if(!visible)return;
    const text=document.getElementById('farm-plan-status'),button=document.getElementById('farm-plan-confirm');if(!text||!button)return;
    const s=G.farmPlanStatus();let message=s.reason||'';
    if(s.ok)message=`农田 ${s.size[0]}×${s.size[1]} · ${s.area}格\n免费；施工 ${Number(s.work.toFixed(2))} 工时，先清 ${s.trees} 棵树（实际搬木，不瞬间砍树）\n初始农夫上限 ${s.workers} 人，可在建成后改0–4；上限不保证配足人\n成熟满收理论 ${s.fullYield} 食物，未扣工具不足、冬损与仓满弃货；不是保证入库。大田种收与长途搬运可能赶不上季节。`;
    message+='\n鼠标拖矩形或点两个角；手机点两个角。每边4–15格，确认才创建工地。重选不撤销已确认工地。';
    if(text.textContent!==message)text.textContent=message;
    button._farmIntent=s.ok?{plan:s.plan,signature:s.signature}:null;button.disabled=!s.ok||G.hasOpenModal();
  },

  initPasturePlanControls: function () {
    const panel = document.getElementById('pasture-plan-controls');
    const confirm = document.getElementById('pasture-plan-confirm'), cancel = document.getElementById('pasture-plan-cancel');
    if (!panel || !confirm || !cancel || panel._pastureBound) return;
    panel._pastureBound = true;
    let activation = null, held = false, interrupted = false;
    const valid = intent => !!intent && G.world === intent.world && G.game === intent.game && G.tool === intent.tool &&
      G.pastureGestureVersion === intent.generation && G.isPasturePlanning() && !G.hasOpenModal() &&
      document.getElementById('pasture-plan-controls') === panel && !panel.classList.contains('hidden') &&
      document.getElementById('pasture-plan-confirm') === confirm && document.getElementById('pasture-plan-cancel') === cancel &&
      panel.contains(confirm) && panel.contains(cancel);
    const capture = e => {
      if (e.type === 'mousedown' && activation?.source === 'touchstart') return;
      held = false; interrupted = false;
      activation = { intent: confirm._pastureIntent, source: e.type, used: false };
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) confirm.addEventListener(name, capture);
    confirm.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key)) return;
      if (e.repeat || held) { e.preventDefault(); return; }
      held = true; interrupted = false;
      activation = { intent: confirm._pastureIntent, source: 'keyboard', used: false };
    });
    confirm.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) held = false; });
    const interrupt = () => { activation = null; held = false; interrupted = true; };
    for (const name of ['pointercancel', 'touchcancel', 'blur']) confirm.addEventListener(name, interrupt);
    window.addEventListener('blur', interrupt);
    confirm.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (interrupted || e.detail > 1 || activation?.used) return;
      const intent = activation ? activation.intent : confirm._pastureIntent;
      if (activation) activation.used = true;
      if (!valid(intent) || confirm.disabled) return;
      const result = G.confirmPasturePlan({ plan: intent.plan, signature: intent.signature });
      if (result.ok) this.toast(`牧场 ${result.b.w}×${result.b.h} 已规划；工人清场施工后才能放入牲畜`, 'good');
      else if (result.reason) this.toast(result.reason, 'warn');
      this.refreshPasturePlanControls();
    });
    let cancelActivation = null, cancelHeld = false, cancelInterrupted = false;
    const captureCancel = e => {
      if (e.type === 'mousedown' && cancelActivation?.source === 'touchstart') return;
      cancelHeld = false; cancelInterrupted = false;
      cancelActivation = { context: panel._pastureContext, plan: G.pasturePlan, source: e.type, used: false };
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) cancel.addEventListener(name, captureCancel);
    cancel.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key)) return;
      if (e.repeat || cancelHeld) { e.preventDefault(); return; }
      captureCancel(e); cancelHeld = true;
    });
    cancel.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) cancelHeld = false; });
    const interruptCancel = () => { cancelActivation = null; cancelHeld = false; cancelInterrupted = true; };
    for (const name of ['pointercancel', 'touchcancel', 'blur']) cancel.addEventListener(name, interruptCancel);
    window.addEventListener('blur', interruptCancel);
    cancel.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (cancelInterrupted || e.detail > 1 || cancelActivation?.used) return;
      const context = cancelActivation ? cancelActivation.context : panel._pastureContext;
      if (cancelActivation) { cancelActivation.used = true; if (cancelActivation.plan !== G.pasturePlan) return; }
      if (!valid(context)) return;
      interrupt(); G.cancelPasturePlan(); this.refreshPasturePlanControls();
      const button = this.el.toolbar?.querySelector('[data-tool="pasture"]');
      if (button?.focus) button.focus({ preventScroll: true });
    });
  },
  refreshPasturePlanControls: function () {
    const panel = document.getElementById('pasture-plan-controls'); if (!panel) return;
    const text = document.getElementById('pasture-plan-status'), button = document.getElementById('pasture-plan-confirm');
    const visible = !!G.world && !!G.isPasturePlanning && G.isPasturePlanning();
    if (!visible && panel.contains(document.activeElement)) {
      const selected = G.tool && (G.tool.kind === 'build' ? G.tool.type : G.tool.kind === 'road' ? (G.tool.surface === 'tunnel' ? 'tunnel' : G.tool.surface === 'bridge' ? 'bridge' : G.tool.surface === 'stone' ? 'stoneroad' : 'road') : G.tool.kind);
      const target = this.el.toolbar?.querySelector(`[data-tool="${selected || 'pasture'}"]`);
      if (target?.focus) target.focus({ preventScroll: true });
    }
    panel.classList.toggle('hidden', !visible);
    panel._pastureContext = visible ? { world: G.world, game: G.game, tool: G.tool, generation: G.pastureGestureVersion } : null;
    if (!visible) { if (button) { button._pastureIntent = null; button.disabled = true; } return; }
    if (!text || !button) return;
    const s = G.pasturePlanStatus(), capacities = s.capacities;
    const lines = [];
    if (s.size) lines.push(`牧场 ${s.size[0]}×${s.size[1]} · ${s.area ?? s.size[0] * s.size[1]}格`);
    if (capacities) lines.push(`可容纳羊 ${capacities.sheep} 头 / 牛 ${capacities.cattle} 头 / 鸡 ${capacities.chicken} 只（选择一种，不能混养）`);
    if (capacities?.cattle === 2) lines.push('本场最多2头牛，只适合保种或转场；保留量最低2头，无法靠繁殖产生超额屠宰的肉和皮革。');
    if (s.cost && Number.isFinite(s.work)) lines.push(`建材 ${this.resourceCost(s.cost, false)} · 施工 ${s.work} 工时（本作适配）；先清 ${s.trees || 0} 棵树，工人实际砍伐搬木后施工`);
    if (Number.isFinite(s.workers)) lines.push(`本场牧人上限 ${s.workers} 人：面积不足200格为1人，200格及以上为2人；上限不保证配足`);
    if (s.reason) lines.push(s.reason);
    lines.push('原版密度：牛20格/头、羊16格/头、鸡6格/只，容量向下取整。新场建成后再购买并放入同种牲畜。');
    lines.push('鼠标拖矩形或点两个角；手机点两个角。每边7–20格，确认创建工地，不预扣/预留材料；到仓领取时扣除，送齐才施工。重选不撤销已确认工地；Esc / 右键退出。');
    const message = lines.join('\n'); if (text.textContent !== message) text.textContent = message;
    button._pastureIntent = s.ok ? { plan: s.plan, signature: s.signature, ...panel._pastureContext } : null;
    button.disabled = !s.ok || G.hasOpenModal();
  },

  initOrchardPlanControls: function () {
    const panel = document.getElementById('orchard-plan-controls');
    const confirm = document.getElementById('orchard-plan-confirm'), cancel = document.getElementById('orchard-plan-cancel');
    if (!panel || !confirm || !cancel || panel._orchardBound) return;
    panel._orchardBound = true;
    let activation = null, held = false, interrupted = false;
    const valid = intent => !!intent && G.world === intent.world && G.game === intent.game && G.tool === intent.tool &&
      G.orchardGestureVersion === intent.generation && G.isOrchardPlanning() && !G.hasOpenModal() &&
      document.getElementById('orchard-plan-controls') === panel && !panel.classList.contains('hidden') &&
      document.getElementById('orchard-plan-confirm') === confirm && document.getElementById('orchard-plan-cancel') === cancel &&
      panel.contains(confirm) && panel.contains(cancel);
    const capture = e => {
      if (e.type === 'mousedown' && activation?.source === 'touchstart') return;
      held = false; interrupted = false;
      activation = { intent: confirm._orchardIntent, source: e.type, used: false };
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) confirm.addEventListener(name, capture);
    confirm.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key)) return;
      if (e.repeat || held) { e.preventDefault(); return; }
      held = true; interrupted = false;
      activation = { intent: confirm._orchardIntent, source: 'keyboard', used: false };
    });
    confirm.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) held = false; });
    const interrupt = () => { activation = null; held = false; interrupted = true; };
    for (const name of ['pointercancel', 'touchcancel', 'blur']) confirm.addEventListener(name, interrupt);
    window.addEventListener('blur', interrupt);
    confirm.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (interrupted || e.detail > 1 || activation?.used) return;
      const intent = activation ? activation.intent : confirm._orchardIntent;
      if (activation) activation.used = true;
      if (!valid(intent) || confirm.disabled) return;
      const result = G.confirmOrchardPlan({ plan: intent.plan, signature: intent.signature });
      if (result.ok) this.toast(`果园 ${result.b.w}×${result.b.h} 已规划；工人清场施工后，农夫才会逐株种植已购种子`, 'good');
      else if (result.reason) this.toast(result.reason, 'warn');
      this.refreshOrchardPlanControls();
    });
    let cancelActivation = null, cancelHeld = false, cancelInterrupted = false;
    const captureCancel = e => {
      if (e.type === 'mousedown' && cancelActivation?.source === 'touchstart') return;
      cancelHeld = false; cancelInterrupted = false;
      cancelActivation = { context: panel._orchardContext, plan: G.orchardPlan, source: e.type, used: false };
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) cancel.addEventListener(name, captureCancel);
    cancel.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key)) return;
      if (e.repeat || cancelHeld) { e.preventDefault(); return; }
      captureCancel(e); cancelHeld = true;
    });
    cancel.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) cancelHeld = false; });
    const interruptCancel = () => { cancelActivation = null; cancelHeld = false; cancelInterrupted = true; };
    for (const name of ['pointercancel', 'touchcancel', 'blur']) cancel.addEventListener(name, interruptCancel);
    window.addEventListener('blur', interruptCancel);
    cancel.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (cancelInterrupted || e.detail > 1 || cancelActivation?.used) return;
      const context = cancelActivation ? cancelActivation.context : panel._orchardContext;
      if (cancelActivation) { cancelActivation.used = true; if (cancelActivation.plan !== G.orchardPlan) return; }
      if (!valid(context)) return;
      interrupt(); G.cancelOrchardPlan(); this.refreshOrchardPlanControls();
      const button = this.el.toolbar?.querySelector('[data-tool="orchard"]');
      if (button?.focus) button.focus({ preventScroll: true });
    });
  },
  refreshOrchardPlanControls: function () {
    const panel = document.getElementById('orchard-plan-controls'); if (!panel) return;
    const text = document.getElementById('orchard-plan-status'), button = document.getElementById('orchard-plan-confirm');
    const visible = !!G.world && !!G.isOrchardPlanning && G.isOrchardPlanning();
    if (!visible && panel.contains(document.activeElement)) {
      const selected = G.tool && (G.tool.kind === 'build' ? G.tool.type : G.tool.kind === 'road' ? (G.tool.surface === 'tunnel' ? 'tunnel' : G.tool.surface === 'bridge' ? 'bridge' : G.tool.surface === 'stone' ? 'stoneroad' : 'road') : G.tool.kind);
      const target = this.el.toolbar?.querySelector(`[data-tool="${selected || 'orchard'}"]`);
      if (target?.focus) target.focus({ preventScroll: true });
    }
    panel.classList.toggle('hidden', !visible);
    panel._orchardContext = visible ? { world: G.world, game: G.game, tool: G.tool, generation: G.orchardGestureVersion } : null;
    if (!visible) { if (button) { button._orchardIntent = null; button.disabled = true; } return; }
    if (!text || !button) return;
    const s = G.orchardPlanStatus(), lines = [];
    if (s.size) lines.push(`果园 ${s.size[0]}×${s.size[1]} · ${s.area ?? s.size[0] * s.size[1]}格`);
    if (Number.isFinite(s.count)) lines.push(`可种 ${s.count} 株：东西 ${s.columns} 列 × 南北 ${s.rows} 行；东西每2格一树，南北每3格一行，方向互换可能改变株数。`);
    if (s.cost && Number.isFinite(s.work)) lines.push(`建材 ${this.resourceCost(s.cost, false)} · 施工 ${s.work} 工时（本作适配）；先清 ${s.trees || 0} 棵树，工人实际砍伐搬木后施工`);
    if (Number.isFinite(s.workers)) lines.push(`本园农夫上限 ${s.workers} 人：每72格增加一岗，最多3人（本作适配）；可调低，上限不保证配足，不直接增加每株产量。`);
    if (s.reason) lines.push(s.reason);
    lines.push('买对应种子后逐株种植，4年有效养护成熟；每株秋收最多20果，实际采收送仓。旧6×6果园保留9株和2岗位，不按此新树距改排。');
    lines.push('鼠标拖矩形或点两个角；手机点两个角。每边4–15格，确认创建工地，不预扣/预留材料；到仓领取时扣除，送齐才施工。重选不撤销已确认工地；Esc / 右键退出。');
    const message = lines.join('\n'); if (text.textContent !== message) text.textContent = message;
    button._orchardIntent = s.ok ? { plan: s.plan, signature: s.signature, ...panel._orchardContext } : null;
    button.disabled = !s.ok || G.hasOpenModal();
  },

  initCemeteryPlanControls: function () {
    const panel = document.getElementById('cemetery-plan-controls');
    const confirm = document.getElementById('cemetery-plan-confirm'), cancel = document.getElementById('cemetery-plan-cancel');
    if (!panel || !confirm || !cancel || panel._cemeteryBound) return;
    panel._cemeteryBound = true;
    let activation = null, held = false, interrupted = false;
    const valid = intent => !!intent && G.world === intent.world && G.game === intent.game && G.tool === intent.tool &&
      G.cemeteryGestureVersion === intent.generation && G.isCemeteryPlanning() && !G.hasOpenModal() &&
      document.getElementById('cemetery-plan-controls') === panel && !panel.classList.contains('hidden') &&
      document.getElementById('cemetery-plan-confirm') === confirm && document.getElementById('cemetery-plan-cancel') === cancel &&
      panel.contains(confirm) && panel.contains(cancel);
    const capture = e => {
      if (e.type === 'mousedown' && activation?.source === 'touchstart') return;
      held = false; interrupted = false;
      activation = { intent: confirm._cemeteryIntent, source: e.type, used: false };
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) confirm.addEventListener(name, capture);
    confirm.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key)) return;
      if (e.repeat || held) { e.preventDefault(); return; }
      held = true; interrupted = false;
      activation = { intent: confirm._cemeteryIntent, source: 'keyboard', used: false };
    });
    confirm.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) held = false; });
    const interrupt = () => { activation = null; held = false; interrupted = true; };
    for (const name of ['pointercancel', 'touchcancel', 'blur']) confirm.addEventListener(name, interrupt);
    window.addEventListener('blur', interrupt);
    confirm.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (interrupted || e.detail > 1 || activation?.used) return;
      const intent = activation ? activation.intent : confirm._cemeteryIntent;
      if (activation) activation.used = true;
      if (!valid(intent) || confirm.disabled) return;
      const result = G.confirmCemeteryPlan({ plan: intent.plan, signature: intent.signature });
      if (result.ok) this.toast(`墓园 ${result.b.w}×${result.b.h} 已规划；石材实运到场并施工完毕后才能安葬`, 'good');
      else if (result.reason) this.toast(result.reason, 'warn');
      this.refreshCemeteryPlanControls();
    });
    let cancelActivation = null, cancelHeld = false, cancelInterrupted = false;
    const captureCancel = e => {
      if (e.type === 'mousedown' && cancelActivation?.source === 'touchstart') return;
      cancelHeld = false; cancelInterrupted = false;
      cancelActivation = { context: panel._cemeteryContext, plan: G.cemeteryPlan, source: e.type, used: false };
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) cancel.addEventListener(name, captureCancel);
    cancel.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key)) return;
      if (e.repeat || cancelHeld) { e.preventDefault(); return; }
      captureCancel(e); cancelHeld = true;
    });
    cancel.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) cancelHeld = false; });
    const interruptCancel = () => { cancelActivation = null; cancelHeld = false; cancelInterrupted = true; };
    for (const name of ['pointercancel', 'touchcancel', 'blur']) cancel.addEventListener(name, interruptCancel);
    window.addEventListener('blur', interruptCancel);
    cancel.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (cancelInterrupted || e.detail > 1 || cancelActivation?.used) return;
      const context = cancelActivation ? cancelActivation.context : panel._cemeteryContext;
      if (cancelActivation) { cancelActivation.used = true; if (cancelActivation.plan !== G.cemeteryPlan) return; }
      if (!valid(context)) return;
      interrupt(); G.cancelCemeteryPlan(); this.refreshCemeteryPlanControls();
      const button = this.el.toolbar?.querySelector('[data-tool="cemetery"]');
      if (button?.focus) button.focus({ preventScroll: true });
    });
  },
  refreshCemeteryPlanControls: function () {
    const panel = document.getElementById('cemetery-plan-controls'); if (!panel) return;
    const text = document.getElementById('cemetery-plan-status'), button = document.getElementById('cemetery-plan-confirm');
    const visible = !!G.world && !!G.isCemeteryPlanning && G.isCemeteryPlanning();
    if (!visible && panel.contains(document.activeElement)) {
      const selected = G.tool && (G.tool.kind === 'build' ? G.tool.type : G.tool.kind === 'road' ? (G.tool.surface === 'tunnel' ? 'tunnel' : G.tool.surface === 'bridge' ? 'bridge' : G.tool.surface === 'stone' ? 'stoneroad' : 'road') : G.tool.kind);
      const target = this.el.toolbar?.querySelector(`[data-tool="${selected || 'cemetery'}"]`);
      if (target?.focus) target.focus({ preventScroll: true });
    }
    panel.classList.toggle('hidden', !visible);
    panel._cemeteryContext = visible ? { world: G.world, game: G.game, tool: G.tool, generation: G.cemeteryGestureVersion } : null;
    if (!visible) { if (button) { button._cemeteryIntent = null; button.disabled = true; } return; }
    if (!text || !button) return;
    const s = G.cemeteryPlanStatus(), lines = [];
    if (s.size) lines.push(`墓园 ${s.size[0]}×${s.size[1]} · ${s.area ?? s.size[0] * s.size[1]}格`);
    if (Number.isFinite(s.capacity)) lines.push(`实际墓位 ${s.capacity} 个；本作横边减4列、纵边每2格一行，换向可能改变容量，位置见地图预览。`);
    if (s.cost && Number.isFinite(s.work)) lines.push(`建材 ${this.resourceCost(s.cost, false)} · 施工 ${s.work} 工时（本作适配）；先清 ${s.trees || 0} 棵树，工人实际砍伐搬木后施工`);
    lines.push('无常驻岗位；完工后死亡时仍检查实际可达空墓位。墓期192日是本作适配，不能拆建刷新。');
    if (s.reason) lines.push(s.reason);
    lines.push('石材和劳动按围长2×(横边+纵边)−4，来自Wiki链接表；无木材要求。具体墓碑位置与工时尺度为本作适配。旧4×4园保留8墓位、旧成本和原到期日。');
    lines.push('鼠标拖矩形或点两个角；手机点两个角。每边7–20格，确认创建工地，不预扣/预留材料；到仓领取时扣除，送齐才施工。重选不撤销已确认工地；Esc / 右键退出。');
    const message = lines.join('\n'); if (text.textContent !== message) text.textContent = message;
    button._cemeteryIntent = s.ok ? { plan: s.plan, signature: s.signature, ...panel._cemeteryContext } : null;
    button.disabled = !s.ok || G.hasOpenModal();
  },

  initRoadControls: function () {
    const confirm = document.getElementById('road-confirm'), cancel = document.getElementById('road-cancel');
    if (!confirm || !cancel) return;
    let armed = null, keyHeld = false, interrupted = false;
    const capture = e => {
      if (e.type === 'mousedown' && armed && armed.source === 'touchstart') return;
      interrupted = false;
      keyHeld = false;
      armed = confirm._roadIntent ? { ...confirm._roadIntent, source: e.type } : null;
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) confirm.addEventListener(name, capture);
    confirm.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key) || e.repeat) return;
      interrupted = false;
      keyHeld = true;
      armed = confirm._roadIntent ? { ...confirm._roadIntent, source: 'keyboard' } : null;
    });
    confirm.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) keyHeld = false; });
    const interrupt = () => { armed = null; keyHeld = false; interrupted = true; };
    confirm.addEventListener('pointercancel', interrupt);
    confirm.addEventListener('touchcancel', interrupt);
    window.addEventListener('blur', interrupt);
    confirm.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (interrupted || e.detail > 1) return;
      const intent = armed || confirm._roadIntent;
      if (!keyHeld) armed = null;
      if (!intent) { this.refreshRoadControls(); return; }
      const result = G.confirmRoadPlan(intent);
      if (result.reason) this.toast(result.reason, 'warn');
      else if (result.tunnel && result.ok) this.toast('隧道工地已确认；材料只送首选洞口并在此施工，完工前山内不可通行', 'good');
      else if (result.bridge && result.ok) this.toast('木桥工地已确认；工人完工前不可通行', 'good');
      else if (result.queued != null) this.toast(result.queued > 0 ? `已排队 ${result.queued} 格${result.surface==='stone'?'石路':'土路'}施工；逐格完工后才提速，原道路仍可走` : '路线已铺好或已安排施工，无需重复排队', 'good');
      this.refreshRoadControls();
    });
    cancel.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (G.hasOpenModal()) return;
      G.cancelRoadPlan(); this.refreshRoadControls();
    });
  },
  refreshRoadControls: function () {
    const el = document.getElementById('road-controls');
    if (!el) return;
    const visible = G.tool && G.tool.kind === 'road' && G.world;
    el.classList.toggle('hidden', !visible);
    if (!visible) return;
    const text = document.getElementById('road-plan-status'), button = document.getElementById('road-confirm');
    if (!text || !button) return;
    const status = G.roadPlanStatus(), plan = G.roadPlan;
    let message = status.reason || '';
    if (status.ok) {
      const r = plan.result;
      const stone=plan.surface==='stone', bridge=plan.surface==='bridge', tunnel=plan.surface==='tunnel';
      const changed=status.queued ?? (stone?status.materials.stone:r.newTiles);
      const reused=status.reused ?? r.path?.length-changed, alreadyQueued=status.alreadyQueued || 0;
      message = tunnel ? `隧道 ${r.length} 格（含两端） · ${r.axis==='x'?'东西':'南北'}直线穿山\n首选洞口 (${r.start.x},${r.start.y}) → 远端洞口 (${r.end.x},${r.end.y})\n材料：石头 ${status.materials.stone} · 建造 ${r.length*3} 游戏施工小时\n确认只建工地，不预扣或预留材料；材料只实运至首选洞口，并在此施工。原洞口道路仍可走，山内完工前不可通行\n完工后沿隧道轴按土路速度实际步行和搬运；无常驻岗位` : bridge ? `木桥 ${r.path.length} 格 · 直线跨水\n桥头 (${plan.start.x},${plan.start.y}) → (${plan.end.x},${plan.end.y})\n材料：木材 ${status.materials.wood} / 石头 ${status.materials.stone} · 建造 ${r.path.length*3} 工时\n确认只建工地；材料从仓实运到岸边，送齐才施工，完工前不可通行` :
        `路线 ${r.path.length} 格 · 待排施工 ${changed} · 复用已成路 ${reused} · 已排队 ${alreadyQueued} · 转弯 ${r.turns} 次\n${stone?'石路每个新铺/升级格1石，合计 '+status.materials.stone+' 石':'土路材料消耗：0'} · 尚需清树 ${status.trees.length} 棵\n新增建造 ${status.work ?? changed} 基础游戏施工小时（每格1小时，为本作适配）\n确认只排队，不预扣或预留材料；原道路仍可走，每格实际完工后才提速。${stone?'石材先实运到临时堆料点，再由铺路工背至施工格。':''}`;
      const missing=Object.entries(status.materials).filter(([k,q])=>G.game.res[k]<q).map(([k,q])=>`${G.RES[k].name}差${Math.ceil(q-G.game.res[k])}`);
      if(missing.length)message+='\n材料不足：'+missing.join(' · ')+(bridge||tunnel?'':'；仍可排队，等待可用石材');
      if (plan.message) message += '\n' + plan.message;
    }
    message += G.tool.surface==='tunnel'?'\n点选/拖选两个洞口，终点吸附较长方向轴；两端清场陆地、中间连续山体，总长3–'+Math.min(G.world.N,128)+'格。二值山体、单端施工和游戏工时为本作适配。Esc/右键退出。':G.tool.surface==='bridge'?'\n点选/拖选两岸，终点吸附较长方向轴；需连续水面和清场桥头。Esc/右键退出。':'\n点选起终点，或鼠标拖出起终点、松开预览；树木先标记清除，再确认施工。水面、建筑和矿石需绕行。点选施工标记可暂停、优先或取消剩余铺路。Esc/右键退出。';
    if (text.textContent !== message) text.textContent = message;
    const waiting = status.ok && status.trees.length && !status.added.length;
    button._roadIntent = status.ok ? { plan, mode: status.tunnel?'tunnel':status.bridge?'bridge':status.trees.length ? 'clear' : 'pave', trees: status.trees.map(p => p.y * G.world.N + p.x).join(',') } : null;
    button.textContent = status.ok && status.trees.length ? (waiting ? '等待工人清树' : '确认标记清树') : status.tunnel||G.tool.surface==='tunnel'?'确认建隧道':status.bridge?'确认建桥':'确认排队施工';
    button.disabled = !status.ok || !!waiting || G.hasOpenModal();
  },

  // Persistent buttons are separate from the text-only, frame-refreshed preview.
  initHarvestControls: function () {
    for (const [kind, btn] of [['trees', this.el.cancelTrees], ['rocks', this.el.cancelRocks]]) {
      if (!btn) continue;
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!G.world || !G.tool || !['fell', 'quarry'].includes(G.tool.kind) ||
            (G.hasOpenModal && G.hasOpenModal())) return;
        const marks = kind === 'trees' ? G.world.marked : G.world.markedRocks;
        // Read live state, not the previous animation frame's count.
        if (!marks || !marks.size) { this.refreshHarvestControls(); return; }
        const result = G.cancelResourceMarks(kind);
        const name = kind === 'trees' ? '树' : '矿';
        if (this.el.cancelStatus) this.el.cancelStatus.textContent =
          `已取消 ${result.marks} 处${name}标记；停止执行 ${result.active} 项、夜间保留 ${result.paused} 项。已采货物仍送仓。`;
        this.refreshHarvest();
        this.refreshHUD();
      });
    }
  },

  refreshHarvestControls: function () {
    const el = this.el.harvestCancel;
    if (!el) return;
    const visible = !!G.world && !!G.tool && ['fell', 'quarry'].includes(G.tool.kind);
    if (!visible) {
      // Escape or a tool switch must not leave keyboard focus in a hidden group.
      if (el.contains(document.activeElement)) {
        const tool = G.tool ? (G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='tunnel'?'tunnel':G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind) : this._harvestTool;
        const btn = tool && this.el.toolbar.querySelector(`[data-tool="${tool}"]`);
        if (btn) btn.focus({ preventScroll: true });
      }
      el.classList.add('hidden');
      if (this.el.cancelStatus) this.el.cancelStatus.textContent = '';
      return;
    }
    if (this._harvestControlWorld !== G.world) {
      this._harvestControlWorld = G.world;
      if (this.el.cancelStatus) this.el.cancelStatus.textContent = '';
    }
    this._harvestTool = G.tool.kind;
    const blocked = !!(G.hasOpenModal && G.hasOpenModal());
    for (const [marks, btn, name] of [[G.world.marked, this.el.cancelTrees, '树'], [G.world.markedRocks, this.el.cancelRocks, '矿']]) {
      if (!btn) continue;
      const count = marks ? marks.size : 0;
      const text = `取消全部${name}标记（${count}）`;
      if (btn.textContent !== text) btn.textContent = text;
      // aria-disabled retains the focus target after cancelling the last mark.
      // The click handler independently guards every disabled state.
      const disabled = String(blocked || count === 0);
      if (btn.getAttribute('aria-disabled') !== disabled) btn.setAttribute('aria-disabled', disabled);
    }
    el.classList.remove('hidden');
  },

  toast: function (msg, cls) {
    const el = document.createElement('div');
    el.className = 'toast ' + (cls || 'info');
    el.textContent = msg;
    this.el.toasts.appendChild(el);
    while (this.el.toasts.children.length > 6) this.el.toasts.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 500);
    }, 6000);
  },

  // These views describe existing stock and risks; they never change simulation data.
  hudCoreResources: function () {
    return ['food', 'wood', 'stone', 'iron', 'tools', 'firewood'];
  },

  initResourceHUD: function () {
    const row = this.el.resRow;
    if (!row) return;
    const core = this.hudCoreResources();
    const secondary = [...(G.FOOD_KEYS || []), 'leather', 'wool', 'clothes', 'warmCoats', 'herbs', 'coal', 'steelTools', 'ale'];
    // Keep unknown future resources visible, after the established fixed slots.
    const extra = [...new Set([...secondary, ...G.RES_KEYS])].filter(k => !core.includes(k) && G.RES[k]);
    const chip = k => `<span class="res${k === 'food' ? ' res-total' : ''}" id="res-${k}" data-resource="${k}" tabindex="0" title="${G.RES[k].name}">${this.resourceIcon(k)}<span class="res-label">${k === 'food' ? '总食物' : G.RES[k].name}</span><b>0</b>${k === 'food' ? '<i id="net-food"></i>' : ''}</span>`;
    row.innerHTML = `<div id="core-resources" class="resource-group core-resources" aria-label="核心库存">${core.map(chip).join('')}</div>` +
      `<button type="button" id="resource-more" aria-expanded="false" aria-controls="secondary-resources" title="展开食物明细、衣物和其他资源">${this.icon ? this.icon('chevronDown') : ''}<span id="resource-more-label">更多</span><span id="resource-warning-count" hidden></span></button>` +
      `<div id="secondary-resources" class="resource-group secondary-resources hidden" aria-label="更多资源，固定排序" hidden>${extra.map(chip).join('')}</div>`;
    const button = document.getElementById('resource-more');
    button.addEventListener('click', () => {
      if (G.hasOpenModal?.()) return;
      this.setResourceExpanded(!this._resourceExpanded);
    });
    row.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !this._resourceExpanded || G.hasOpenModal?.()) return;
      e.preventDefault(); e.stopPropagation();
      this.setResourceExpanded(false); button.focus({ preventScroll: true });
    });
    this.setResourceExpanded(false);
  },

  setResourceExpanded: function (expanded) {
    const button = document.getElementById('resource-more'), panel = document.getElementById('secondary-resources');
    if (!button || !panel) return;
    if (!expanded && panel.contains?.(document.activeElement)) button.focus({ preventScroll: true });
    this._resourceExpanded = !!expanded;
    panel.hidden = !expanded; panel.classList.toggle('hidden', !expanded);
    button.setAttribute('aria-expanded', String(!!expanded));
    const label = document.getElementById('resource-more-label');
    if (label) label.textContent = expanded ? '收起' : '更多';
  },

  initGuideHUD: function () {
    G.onboarding?.init();
    const button = this.el.guide?.querySelector?.('#guide-toggle');
    if (!button || button._guideBound) return;
    button._guideBound = true;
    button.addEventListener('click', () => {
      if (G.hasOpenModal?.()) return;
      this._guideExpanded = !this._guideExpanded;
      this.refreshGuide();
    });
  },

  refreshSaveStatus: function () {
    const el = document.getElementById('save-status');
    if (!el) return;
    const warning = G.autosaveBlocked ? '原自动档已保护：临时局不自动保存，请打开存档管理备份或手动保存。' : '';
    el.textContent = warning; el.hidden = !warning;
    const button = document.getElementById('btn-load');
    if (button) button.classList.toggle('save-attention', !!warning);
  },

  refreshResourceWarnings: function (hauling, supplies) {
    const button = document.getElementById('resource-more');
    if (!button) return;
    const g = G.game, w = G.world, warnings = {};
    const physical = !!supplies, stock = physical ? supplies.available : g.res;
    const add = (key, text, urgent = false) => { warnings[key] = { text, urgent }; };
    const alive = w.citizens.filter(c => !c.dead);
    const groups = G.foodGroupsOf((G.FOOD_KEYS || []).filter(k => stock[k] > 0));
    if (alive.length && groups.length < 3) for (const type of ['meat', 'vegetables', 'grain'])
      if (!groups.includes(type)) add(type, `${G.RES[type].name}营养组暂无储备；可补充多样食物`);
    if (alive.some(c => !(c.clothingLeft > 0)) && (stock.clothes || 0) + (stock.warmCoats || 0) <= 0)
      add('clothes', '有居民衣物耗尽且暂无成衣储备；暖衣与普通衣均可补给', g.season === 3);
    if (alive.some(c => G.isSick?.(c)) && !(g.res.herbs > 0))
      add('herbs', '草药暂无储备；可补充保健用药，诊所治疗不消耗草药');
    if (w.buildings.some(b => b.type === 'blacksmith' && b.state === 'ok' && G.blacksmithOutput?.(b) === 'steelTools') && g.res.coal < 1)
      add('coal', '钢工具配方缺煤；铁工具不需要煤');
    for (const key of G.RES_KEYS) {
      if (hauling.carry[key] > 0 && !['tools', 'steelTools'].includes(key) && g.res[key] >= G.storageCap(key))
        add(key, `${G.RES[key].name}仓满，随身产出等待入库`);
      const chip = document.getElementById('res-' + key);
      if (chip) {
        chip.classList.toggle('resource-warning', !!warnings[key]);
        chip.classList.toggle('resource-urgent', !!warnings[key]?.urgent);
        if (warnings[key]) chip.title += ' · 提醒：' + warnings[key].text;
        chip.setAttribute?.('aria-label', chip.title);
      }
    }
    const core = this.hudCoreResources(), hidden = Object.keys(warnings).filter(k => !core.includes(k));
    const badge = document.getElementById('resource-warning-count');
    if (badge) { badge.textContent = String(hidden.length); badge.hidden = !hidden.length; }
    button.classList.toggle('has-warning', !!hidden.length);
    button.classList.toggle('has-urgent', hidden.some(k => warnings[k].urgent));
    button.title = hidden.length ? `更多资源有 ${hidden.length} 项提醒：` + hidden.map(k => warnings[k].text).join('；') : '食物明细、衣物和其他资源；数量为零仍保留原位';
    button.setAttribute('aria-label', `更多资源${hidden.length ? '，' + hidden.length + ' 项提醒' : ''}`);
  },

  refreshHUD: function () {
    if (!G.world) return;
    const g = G.game, physical = G.supplyEnabled && G.supplyEnabled(), supplies = physical ? G.supplyInventory() : null;
    const mealNotice=document.getElementById('meal-transition-notice');
    if(mealNotice){const notice=G.mealTransitionNotice?.()||'';mealNotice.textContent=notice;mealNotice.hidden=!notice;}
    this.refreshGuide();
    this.refreshSaveStatus();
    this.refreshToolAffordability?.();
    this.refreshProductionGoals();
    this.refreshNewGameSettings();
    const hauling = G.harvestFeedback();
    // Household/vendor cargo already left public stock and may contain several
    // resources. Exclude its primary slot from the legacy inbound-stock count;
    // the full mixed basket is displayed separately from supplyInventory below.
    if (physical) for (const c of G.world.citizens) if (!c.dead && c.carry?.supplyBatch)
      hauling.carry[c.carry.type] = Math.max(0, (hauling.carry[c.carry.type] || 0) - c.carry.qty);
    hauling.carry.food += (G.FOOD_KEYS || []).reduce((sum, type) => sum + (hauling.carry[type] || 0), 0);
    for (const k of G.RES_KEYS) {
      const el = document.getElementById('res-' + k);
      if (el) {
        el.querySelector('b').textContent = Math.floor(g.res[k]);
        const cap = G.storageCap(k);
        const foodClass = (G.FOOD_KEYS || []).includes(k);
        const tool = k === 'tools' || k === 'steelTools';
        const label = el.querySelector('.res-label');
        if (label) label.textContent = (physical ? '公共' : '') + (k === 'food' ? '总食物' : G.RES[k].name);
        el.title = `${physical ? '公共库存 · ' : ''}${G.RES[k].name}：${Math.floor(g.res[k])}${tool ? '（工具不限仓储）' : foodClass ? '（各食物物品共享总食物仓容 ' + cap + '）' : ' / ' + cap}`;
        if (k === 'food' && G.FOOD_KEYS) el.title += ' · ' + G.FOOD_KEYS.map(type => `${G.RES[type].name} ${Math.floor(g.res[type] || 0)}`).join(' + ') + '（物品之和，不重复计入库存）';
        if (hauling.carry[k]) el.title += ` · 另有 ${this.supplyNumber(hauling.carry[k])} 随身待入库（尚不可用）`;
        const supplyTransit = physical ? (k === 'food' ? G.supplyFood(supplies.transit) : supplies.transit[k] || 0) : 0;
        if (supplyTransit > 1e-8) el.title += ` · 配送在途 ${this.supplyNumber(supplyTransit)}（送往市场/住处或退仓，不是新产出）`;
        if (['stone', 'iron', 'coal'].includes(k) && hauling.carry[k] && g.res[k] >= cap) el.title += ' · 仓满保留余矿，使用库存或建成新仓库后送仓';
        if (physical && ['food', ...G.SUPPLY.types].includes(k)) el.title += ` · 已配送至市场/住处和在途物资另计；全村${k === 'food' ? '食物' : G.RES[k].name} ${this.supplyNumber(k === 'food' ? G.supplyFood(supplies.available) : supplies.available[k])}（含散落待回收，不含火情封存；各家能否食用看本地储备）`;
        if (!physical && k === 'food' && G.world.citizens.length) el.title += ` · 可供 ${(g.res.food / (G.world.citizens.length * G.LIFE.eatPerDay)).toFixed(1)} 天（不计新产出）`;
        if (tool) {
          const adults = G.world.citizens.filter(c => c.adult).length;
          if(G.personalToolsEnabled())el.title+=` · 公共全新备用；另有旧半用 ${(g.toolRemainders[k]||0)>0?1:0} 把（余 ${this.supplyNumber((g.toolRemainders[k]||0)/16)} 劳动日，只领用），已装备 ${G.world.citizens.filter(c=>!c.dead&&c.toolType===k&&G.toolEquipped(c)).length} 人；个人无工具才半速，钢仅耐用不加速；寿命按实际劳动累计`;
          else{el.title += ` · 单件寿命 ${k === 'steelTools' ? G.LIFE.steelToolLifeDays : G.LIFE.toolLifeDays} 成人天；两类工具生产效率相同，优先磨损钢工具`;
          if (adults) el.title += ` · 两类工具合计 ${Math.floor(G.toolStock())} 件，当前成人约可用 ${Math.floor(G.toolDaysLeft(adults))} 天（扣除已磨损，不计新产出）`;}

          el.title += k === 'steelTools' ? '；钢工具需铁、原木与煤' : '；铁工具需铁与原木';
        }
        if (k === 'clothes' || k === 'warmCoats') {
          const unprotected = G.world.citizens.filter(c => !(c.clothingLeft > 0)).length;
          el.title += ` · ${unprotected} 人衣物已耗尽；${k === 'warmCoats' ? '暖衣需 2 皮革 + 2 羊毛，户外受冻降低 70%（较普通衣物再减半）' : '普通衣物需 2 皮革或 2 羊毛，户外受冻降低 40%'}；每件 ${G.YEAR_DAYS} 天，日终穿坏才优先领暖衣，再领普通衣物；不替代住房与柴火` + (G.clothingSupplyEnabled?.() ? '；只从家中/临时补给点现货换衣，公共成衣需先实际配送' : '；沿用远程公共领取');
        }
        if (k === 'eggs') el.title += ' · 鸡蛋独立库存；与肉类同属肉类营养组，不增加第4组；鸡肉仍计入肉类库存';
        if (['apples', 'pears'].includes(k)) el.title += ' · 独立库存与生产目标；营养归蔬菜组，仍为三组；可直接食用，或用实际果品酿酒；旧通用果树不产此果品';
        if (k === 'herbs') el.title += ' · 采药屋在成熟林中采集，送仓后用于草药保健；诊所治疗不消耗草药';
        if (k === 'ale') el.title += ' · 麦酒不计入食物，不可充饥；仅供 18 岁以上居民到酒馆休闲，每次消耗 1 麦酒';
        if (k === 'ale' && hauling.carry[k] && g.res[k] >= cap) el.title += ' · 仓满保留麦酒，腾出空间后继续送仓';
        if (k === 'firewood') {
          el.title += ` · ${this.heatDemandText(this.heatDemand())}`;
        }
      }
    }
    this.refreshResourceWarnings(hauling, supplies);
    const netEl = document.getElementById('net-food');
    if (netEl) {
      const net = Math.round(g.foodNet);
      netEl.textContent = net > 0 ? `+${net}` : (net < 0 ? `${net}` : '');
      netEl.className = net < 0 ? 'neg' : 'pos';
      netEl.title = physical ? '全村食物净变（包括已配送物资）；左侧数字仅为公共库存' : '食物净变';
    }
    const hh = Math.floor(g.h);
    this.el.date.innerHTML = `${this.icon ? this.icon('clock') : ''}<span>第 ${g.year} 年 · ${G.SEASON_NAMES[g.season]} ${(g.day % G.SEASON_DAYS) + 1} 日 · ${String(hh).padStart(2, '0')}:00</span>`;
    this.el.date.title = '游戏时间；时钟图标不代表日照或居民作息';
    const w = G.world;
    const adults = w.citizens.filter(c => c.adult).length;
    const children = w.citizens.length - adults;
    const homeless = w.families.filter(f => f.houseId == null && f.members.length).length;
    this.el.pop.innerHTML = `${this.icon ? this.icon('people') : ''}<b>${w.citizens.length}</b> <small>成人${adults} · 儿童${children}</small>` +
      (homeless ? ` <span class="warn-txt">无房${homeless}家</span>` : '') + this.healthSummaryMarkup();
    const errBtn = document.getElementById('btn-err');
    if (errBtn) errBtn.classList.toggle('hidden', !window.__errs.length);
    this.el.speed.querySelectorAll('button').forEach(btn => {
      const v = btn.dataset.v;
      btn.classList.toggle('active', v === 'pause' ? g.paused : (!g.paused && g.speed === +v));
    });
  },

  healthSummaryMarkup: function () {
    if (!G.healthSummary) return '';
    const h = G.healthSummary();
    const average = Number.isFinite(h.average) ? h.average.toFixed(1) : '—';
    return `<span class="town-health${h.sick ? ' warn-txt' : ''}" title="全镇平均健康；三组营养（肉类含鸡蛋、蔬菜含苹果和梨、主食）搭配有助健康。草药库存 ${Math.floor(h.herbs || 0)}">健康 ${average}/5 · 患病 ${h.sick} · 治疗 ${h.treated}</span>`;
  },

  refreshGuide: function () {
    G.onboarding?.refresh();
    const el = this.el.guide;
    if (!el || !G.world) return;
    const g = G.game, w = G.world, physical = G.supplyEnabled && G.supplyEnabled(), supplies = physical ? G.supplyInventory().available : g.res;
    const alive = w.citizens.filter(c => !c.dead);
    const days = alive.length ? (physical ? G.supplyFood(supplies) : g.res.food) / (alive.length * G.LIFE.eatPerDay) : 0;
    const untilWinter = (G.SEASON_DAYS * 3 - g.day % G.YEAR_DAYS + G.YEAR_DAYS) % G.YEAR_DAYS;
    const food = w.buildings.some(b => ['gatherer', 'dock', 'hunting', 'farm', 'orchard', 'pasture'].includes(b.type) && b.state === 'ok' && (b.type !== 'farm' || G.cropUnlocked(G.farmCropOf(b))));
    const fuel = w.buildings.some(b => b.type === 'woodcutter' && b.state === 'ok');
    const homeless = w.families.filter(f => f.members.length && f.houseId == null).length;
    const heat = this.heatDemand(), remainingHeat = heat.winter ? heat.futureWinter : heat.fullWinter;
    const harvest = G.harvestFeedback(), rows = [];
    const add = (kind, level, priority, text, detail = text) => rows.push({ kind, level, priority, text, detail });
    const hungry = alive.filter(c => c.hunger > 0).length;
    const foodGroups = G.foodGroupsOf((G.FOOD_KEYS || []).filter(type => supplies[type] > 0));
    const foodLabel = `${physical ? '全村粮食合计' : '粮食'}约 ${days.toFixed(1)} 天`;
    const foodDetail = `${foodLabel}（不计新产出${physical ? '，含在途与待回收，逐户现货才可食用' : ''}）` + (G.FOOD_KEYS ? ` · 营养组 ${foodGroups.length}/3（肉类含鸡蛋，蔬菜含苹果和梨）` : '');
    add('food', alive.length && (hungry || days < 2) ? 'urgent' : alive.length && days < 5 ? 'recommend' : 'status', 0,
      `${hungry ? hungry + ' 人饥饿 · ' : ''}${foodLabel} · 营养组 ${foodGroups.length}/3`,
      `${hungry ? hungry + ' 人饥饿：检查现货、通路与食物生产。' : ''}${foodDetail}`);
    if (g.season >= 2 && G.usableHeatingFuel() < remainingHeat) {
      const coal = G.heatingPolicy().allowCoal;
      const detail = coal ? `取暖燃料不足：可用 ${Math.floor(G.usableHeatingFuel())} 柴火当量 / ${heat.winter ? '本冬此后' : '整冬'}约需 ${Math.ceil(remainingHeat)}，伐木屋需原木；住房可设煤补柴。` : `柴火不足：${physical ? '全村实物合计' : '现有'} ${Math.floor(physical ? supplies.firewood : g.res.firewood)} / ${heat.winter ? '本冬此后' : '整冬'}约需 ${Math.ceil(remainingHeat)}，伐木屋需原木。`;
      add('heating', heat.winter ? 'urgent' : 'recommend', 1,
        `${coal ? '取暖燃料不足' : '柴火不足'} · ${Math.floor(G.usableHeatingFuel())} / ${Math.ceil(remainingHeat)}${coal ? ' 柴火当量' : ''}；近仓备柴`, detail);
    }
    const cold = alive.filter(c => c.cold >= 1).length;
    if (cold) add('cold', 'urgent', 2, `${cold} 人受冻 · 检查住房与实际供暖`, '居民正在受冻；库存估算不保证每户有燃料，检查住房、配送和返家通路。');
    if (g.res.wood < 2) {
      const detail = harvest.carry.wood ? `木材库存耗尽：另有 ${harvest.carry.wood} 随身待入库，送达后才能使用。`
        : harvest.trees ? `木材库存耗尽：${harvest.trees} 棵已标记，查看采运进度；砍倒后仍需送仓。`
        : '木材耗尽：向更远可达森林标记砍伐，后续护林补种；避开食物林。';
      add('wood', 'recommend', 3, harvest.carry.wood ? `木材耗尽 · ${harvest.carry.wood} 随身待入库` : harvest.trees ? `木材耗尽 · ${harvest.trees} 棵已标记待采运` : '木材耗尽 · 标记更远可达森林，避开食物林', detail);
    }
    if (homeless) add('housing', heat.winter ? 'urgent' : 'recommend', 4,
      `${homeless} 家无房 · ${heat.winter ? '尽快安置并备柴' : '入冬前逐步补住房'}`);
    const stage = !food ? '① 先保持续食物：在近仓森林建采集小屋；不要先连盖住房耗尽木石。'
      : !fuel ? '② 近仓建伐木屋备柴；在食物林外标记砍伐和矿石，保留散工。'
      : homeless ? `③ 入冬前安家：还有 ${homeless} 家无房；逐步补住房和取暖柴。`
      : '④ 补齐肉类（含鸡蛋）、蔬菜（含苹果和梨）、主食三组营养与衣物，再扩教育、医疗和贸易，为下一代留空房。';
    if (!food || !fuel || !homeless) add('next-step', !food || !fuel ? 'recommend' : 'status', 2.5,
      !food ? '先保持续食物 · 在近仓森林建采集小屋' : !fuel ? '近仓建伐木屋 · 提前储备柴火' : '补齐营养与衣物，再扩教育、医疗和贸易', stage);
    if (harvest.total) add('harvest', harvest.reason ? 'recommend' : 'status', 8,
      `采运标记 · 待领 ${harvest.queued} · 执行 ${harvest.active} · 夜间保留 ${harvest.paused}`,
      `采运标记：待领 ${harvest.queued} · 执行 ${harvest.active} · 夜间保留 ${harvest.paused}${harvest.reason ? '；' + harvest.reason : ''}`);
    add('season', 'status', 9, `${G.isWinter() ? '寒冬中' : '距入冬 ' + untilWinter + ' 天'} · ${g.paused ? '已暂停' : '运行中'}`);
    const rank = { urgent: 0, recommend: 1, status: 2 };
    rows.sort((a, b) => rank[a.level] - rank[b.level] || a.priority - b.priority);
    // Legacy/minimal DOM consumers retain all descriptive facts. The real view
    // keeps the same keyed types, shows three priorities, and puts detail in titles.
    const list = el.querySelector?.('#guide-list');
    if (!list) { el.textContent = rows.map(row => row.detail).join('\n'); return; }
    if (this._guideWorld !== w) { this._guideWorld = w; this._guideExpanded = false; }
    const signature = rows.map(row => row.kind).join(':');
    if (list.dataset.signature !== signature) {
      list.innerHTML = rows.map(row => `<li data-guide-kind="${row.kind}"><span class="guide-level" data-guide-level></span><span class="guide-text" data-guide-text></span></li>`).join('');
      list.dataset.signature = signature;
    }
    const labels = { urgent: '紧急', recommend: '建议', status: '状态' };
    rows.forEach((row, i) => {
      const node = list.querySelector(`[data-guide-kind="${row.kind}"]`);
      node.dataset.level = row.level; node.title = row.detail;
      node.hidden = !this._guideExpanded && i >= 1;
      node.classList.toggle('hidden', node.hidden);
      node.querySelector('[data-guide-level]').textContent = labels[row.level];
      node.querySelector('[data-guide-text]').textContent = row.text;
    });
    el.classList.toggle('guide-expanded', !!this._guideExpanded);
    const toggle = el.querySelector('#guide-toggle'), count = el.querySelector('#guide-count');
    if (toggle) {
      toggle.textContent = this._guideExpanded ? '收起' : `全部 ${rows.length}`;
      toggle.setAttribute('aria-expanded', String(!!this._guideExpanded));
      toggle.hidden = rows.length <= 1;
    }
    if (count) {
      const urgent = rows.filter(row => row.level === 'urgent').length;
      count.textContent = urgent ? `${urgent} 项紧急` : '';
      count.hidden = !urgent;
    }
  },

  refreshHarvest: function () {
    if (this.refreshHarvestRangeControls) this.refreshHarvestRangeControls(false);
    if (this.refreshHarvestControls) this.refreshHarvestControls();
    const el = this.el.placement;
    if (!el || !G.world) return;
    this._placementKey = null;
    const h = G.harvestFeedback(), fell = G.tool.kind === 'fell';
    const cargo = G.RES_KEYS.filter(k => h.carry[k]).map(k => `${G.RES[k].name} ${h.carry[k]}`).join(' · ');
    const lines = [fell ? '砍伐：框选预览并确认树木' : '采石采铁：框选预览并确认；灰色岩石产石头，锈色铁矿产铁',
      `标记：树 ${h.trees} · 矿 ${h.rocks}；待领 ${h.queued} · 执行 ${h.active}（含赶路） · 夜间保留 ${h.paused}`,
      `散工 ${h.laborers} 人（含执行、搬运）；每 2 游戏小时自动调度。`];
    if (!fell) {
      const { tx, ty } = G.hover, w = G.world;
      const mineral = tx >= 0 && ty >= 0 && tx < w.N && ty < w.N ? w.rock[ty * w.N + tx] : 0;
      if (mineral) lines.push(`指向：${mineral === 2 ? '铁矿 → 铁' : '岩石 → 石头'}；开采后搬运入库。`);
      else lines.push('指向地块没有可采矿石；本工具只标记岩石和铁矿。');
    }
    if (cargo) lines.push(`随身待入库：${cargo}；搬运 ${h.haulers} 人 / 待送 ${h.waitingCarriers} 人（不计入库存）。`);
    if (h.blockedMineralCarriers) lines.push(`${h.blockedMineralCarriers} 人仓满带矿等待空间；使用石铁库存或建成新仓库后继续送仓。`);
    if (h.blockedMineralMarks) lines.push(`${h.blockedMineralMarks} 处矿石因该资源仓满暂不接新开采；标记保留，另一未满矿种仍可采。`);
    if (h.reason) lines.push(h.reason);
    const check = G.world.markReachability;
    if (check && h.total && Number.isFinite(check.day) && Number.isFinite(check.h) && check.unreachable > 0)
      lines.push(`最近派工检查：${check.unreachable} 处不可达（累计第 ${check.day + 1} 天 ${Math.floor(check.h)} 时；通路或标记变化后待复查）。`);
    if (h.trees && h.rocks) lines.push('散工接新任务时先砍树，再清矿。');
    if (h.trees >= 300 || h.rocks >= 300) lines.push('单类标记上限 300，达到上限后不再新增。');
    lines.push('绿色虚线为采集/狩猎食物林；砍树会降低食物产出。');
    lines.push('右键/Esc 退出工具；已画下的标记仍会执行。');
    const text = lines.join('\n');
    if (el.textContent !== text) el.textContent = text;
    el.dataset.state = h.reason ? 'warning' : 'ready';
    el.classList.remove('hidden');
  },

  refreshPlacement: function (type, x, y) {
    if (this.refreshRoadControls) this.refreshRoadControls();
    if(this.refreshFarmPlanControls)this.refreshFarmPlanControls();
    if(this.refreshPasturePlanControls)this.refreshPasturePlanControls();
    if(this.refreshOrchardPlanControls)this.refreshOrchardPlanControls();
    if(this.refreshCemeteryPlanControls)this.refreshCemeteryPlanControls();
    if (this.refreshHarvestRangeControls) this.refreshHarvestRangeControls(false);
    if (this.refreshHarvestControls) this.refreshHarvestControls();
    const el = this.el.placement;
    if (!el) return null;
    if (!type) { el.classList.add('hidden'); this._placementKey = null; return null; }
    // Avoid a path search on every animation frame; refresh moving terrain/resources regularly.
    // Fishing staffing and bridge changes must be visible even while paused.
    const fishingKey = type === 'dock' ? JSON.stringify([G.game.fishingRules, G.hasTools(), G.world.buildings
      .filter(b => ['dock', 'bridge'].includes(b.type)).map(b => [b.id, b.type, b.state, b.x, b.y, b.w, b.h, b.type === 'dock' && G.fishingDockActive(b)])]) : '';
    const key = [type, x, y, G.world.seed, G.world.buildings.map(b => b.id).join(','), Math.floor(G.game.h * 2), G.game.day,
      fishingKey,
      ...G.RES_KEYS.map(k => Math.floor(G.game.res[k]))].join(':');
    if (key !== this._placementKey || this._placementWorld !== G.world) {
      this._placementWorld = G.world;
      this._placementKey = key;
      this._placement = G.placementInfo(type, x, y);
      el.textContent = this._placement.text + (this.mineralBuildRisk(type) ? '\n' + this.mineralBuildRisk(type) : '');
      el.dataset.state = !this._placement.ok ? 'blocked' : this._placement.warning ? 'warning' : 'ready';
    }
    el.classList.remove('hidden');
    return this._placement;
  },

  /* ---------- 信息面板 ---------- */
  showInfo: function (sel) {
    this.el.info.classList.remove('hidden');
    this.renderInfo();
  },
  hideInfo: function () {
    this._buildingDetailTab = 'overview';
    this.resetPastureConfirmations();
    const supply = this.el.info.querySelector && this.el.info.querySelector('[data-supply-mode-panel]');
    if (supply) this.resetSupplyConfirmation(supply);
    const fishing = this.el.info.querySelector && this.el.info.querySelector('[data-fishing-panel]');
    if (fishing) this.resetFishingConfirmation(fishing);
    const panel = this.el.info.querySelector && this.el.info.querySelector('[data-mineral-removal-panel]');
    if (panel) this.resetMineralRemoval(panel);
    const tunnel = this.el.info.querySelector?.('[data-tunnel-removal-panel]');
    if (tunnel) this.resetTunnelRemoval(tunnel);
    for (const kind of ['fire-rules', 'fire-rebuild']) {
      const fire = this.el.info.querySelector && this.el.info.querySelector(`[data-${kind}-panel]`);
      if (fire) this.resetFireAction(fire);
    }
    G.sel = null;
    this.el.info.classList.add('hidden');
    this._infoSelection = null; // Reopening mounts new controls; dismissed callbacks stay stale.
  },
  workforceInfoData: function (b) {
    if (!G.workforceSummary) return null;
    const s = G.workforceSummary(b), g = s.global;
    if (G.workerMaximumOf && b.state !== 'site') s.maximum = G.workerMaximumOf(b);
    const data = {
      current: s.supported ? `当前占岗 ${s.current} 人 · 其中收尾 ${s.draining} 人` : '本建筑无需安排工人',
      limit: s.supported ? `已应用上限 ${s.limit} 人 · ${(b.type === 'pasture' && b.pastureSize) || (b.type === 'orchard' && b.orchardSize) ? '本场最大' : '原最大'} ${s.maximum} 人` : '',
      reason: s.supported ? s.reason || '等待下一次派工检查。' : '可在下方查看全镇人力。',
      rule: !s.supported ? '全镇概览只读，各建筑的岗位在各自详情中调整。' : s.rule || (b.state === 'site' ? '暂停保留已完成工段和已付建材，取消未完成的小工段；恢复不重复扣建材。' : '上限不保证配足人数。设为 0 后停止接新工作，已接有限批次结清才释放；服务岗位立即停服务。'),
      population: `成人 ${g.adults} 人 · 学生 ${g.students} 人`,
      assigned: `已分配 ${g.assigned} 人 · 其中收尾 ${g.finishing} 人`,
      available: `可再派工 ${g.available} 人 · 无岗带货 ${g.hauling} 人`,
    };
    return { summary: s, data };
  },
  workforceInfoMarkup: function (b, facts) {
    if (!facts) return '';
    const { summary: s, data } = facts;
    return `<section class="economy-form workforce-details" data-workforce-panel aria-labelledby="workforce-title">
      <h3 id="workforce-title">${b.state === 'site' ? '工地用工' : '建筑用工'}</h3>
      ${['current', 'limit', 'reason', 'rule'].map(key => `<p class="row${key === 'rule' ? ' desc' : ''}" data-workforce="${key}">${this.escHtml(data[key])}</p>`).join('')}
      ${s.supported ? b.state === 'site' ? '<div data-workforce-site-action></div>' : `<form id="worker-limit-form">
        <label for="worker-limit-input">用工上限（0–${s.maximum} 的整数）</label>
        <input id="worker-limit-input" type="number" min="0" max="${s.maximum}" step="1" inputmode="numeric" value="${s.limit}" aria-describedby="worker-limit-note">
        <button id="worker-limit-apply" type="submit">应用用工上限</button>
        <p class="desc" id="worker-limit-note">只设上限，不保证配足。0 停接新工作，收尾后释放；未点应用不生效。</p>
      </form>` : ''}
      <p class="economy-message" data-workforce-message role="status" aria-live="polite"></p>
      <details class="workforce-overview"><summary>全镇人力概览</summary>
        ${['population', 'assigned', 'available'].map(key => `<p class="row" data-workforce="${key}">${this.escHtml(data[key])}</p>`).join('')}
        <p class="desc">收尾仍占原岗位；收尾者和无岗带货者都不计入可再派工。</p>
      </details>
    </section>`;
  },
  workforceControlValid: function (b, context, node) {
    const { world, game, el, panel, state } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel && G.sel.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.state === state &&
      el.querySelector('[data-workforce-panel]') === panel && (!node || (!node.disabled && el.querySelector('#' + node.id) === node)) &&
      !(G.hasOpenModal && G.hasOpenModal());
  },
  initWorkforceInfo: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-workforce-panel]');
    if (!panel) return;
    const context = { world: G.world, game: G.game, el, panel, state: b.state };
    panel._workforceContext = context;
    const form = el.querySelector('#worker-limit-form'), input = el.querySelector('#worker-limit-input');
    if (form && input) form.addEventListener('submit', e => {
      e.preventDefault();
      if (!this.workforceControlValid(b, context, form) || el.querySelector('#worker-limit-input') !== input) return;
      const n = input.value.trim() === '' ? NaN : Number(input.value), s = G.workforceSummary(b);
      const ok = G.setWorkerLimit(b, n);
      const message = el.querySelector('[data-workforce-message]');
      if (message) message.textContent = ok ? `用工上限已设为 ${n} 人。${n === 0 ? '已停止接新工作；仍占岗的收尾者完成结清后释放。' : '等待派工，实际人数以当前占岗为准。'}` : `请输入 0–${s.maximum} 的整数。`;
      this.renderInfo();
    });
    this.refreshWorkforceInfo(b);
  },
  refreshWorkforceInfo: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-workforce-panel]');
    if (!panel || !panel._workforceContext || !this.workforceControlValid(b, panel._workforceContext)) return false;
    const facts = this.workforceInfoData(b);
    if (!facts) return false;
    const { summary: s, data } = facts;
    for (const key of Object.keys(data)) {
      const node = panel.querySelector(`[data-workforce="${key}"]`);
      if (node && node.textContent !== data[key]) node.textContent = data[key];
    }
    // Never assign input.value during refresh: it may hold an unapplied draft.
    const holder = panel.querySelector('[data-workforce-site-action]');
    if (holder) {
      if (!holder._bound) {
        // Fixed positions give each gesture one intent. A double click on Pause
        // cannot land on a newly renamed Resume button and reverse the action.
        holder._bound = true;
        holder.innerHTML = '<div class="economy-actions"><button type="button" id="construction-pause">暂停工地</button><button type="button" id="construction-resume">恢复工地</button><button type="button" id="construction-priority">优先施工</button><button type="button" id="construction-normal">恢复普通</button></div>';
        for (const [id,desired,priority] of [['construction-pause',true,false],['construction-resume',false,false],['construction-priority',true,true],['construction-normal',false,true]]) {
          const button = holder.querySelector('#' + id), context = panel._workforceContext;
          button.addEventListener('keydown', e => {
            if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
          });
          button.addEventListener('click', e => {
            if ((e && e.detail > 1) || !this.workforceControlValid(b, context, button)) {
              if (G.world === context.world && G.game === context.game && this.el.info === el &&
                  G.sel && G.sel.kind === 'b' && G.sel.id === b.id && G.world.bmap[b.id] === b && b.state !== context.state &&
                  el.querySelector('[data-workforce-panel]') === panel && !el.classList.contains('hidden') && !(G.hasOpenModal && G.hasOpenModal())) this.renderInfo();
              return;
            }
            if ((priority?!!b.sitePriority:G.workforceSummary(b).paused) === desired) { this.refreshWorkforceInfo(b); return; }
            if ((priority?G.setConstructionPriority:G.setConstructionPaused)(b,desired)) {
              const message = panel.querySelector('[data-workforce-message]');
              if (message) message.textContent = priority?(desired?'已设为优先施工。当前工作段和携货先结清，不会凭空增加工人。':'已恢复普通顺序；不会取消已完成工段或扣取新建材。'):desired ? '工地已暂停。已完成工段和到场建材保留；已领在途货仍需实运退仓。' : '工地已恢复，等待领料、送达和施工；已到场建材不重复领取。';
            }
            this.renderInfo();
          });
        }
      }
      const pause = holder.querySelector('#construction-pause'), resume = holder.querySelector('#construction-resume');
      pause.disabled = s.paused; resume.disabled = !s.paused;
      const high=holder.querySelector('#construction-priority'),normal=holder.querySelector('#construction-normal');
      high.disabled=!!b.sitePriority;normal.disabled=!b.sitePriority;
      const active = document.activeElement;
      if ((active === pause || active === resume) && active.disabled) {
        const next = s.paused ? resume : pause;
        if (next.focus) next.focus();
      }
      if((active===high||active===normal)&&active.disabled){const next=b.sitePriority?normal:high;if(next.focus)next.focus();}
    }
    return true;
  },
  siteInfoData: function (b) {
    if (b.type === 'roadwork' && G.roadWorkSummary) return this.roadWorkInfoData(b);
    const w = G.world, trees = G.siteTrees ? G.siteTrees(b).length : 0;
    const upgrade = b.type === 'stonehouse' && b.upgradeFrom === 'house';
    const summary = G.constructionSummary && G.constructionSummary(b);
    const untouched = !b.constructionStarted && b.progress === 0 && b.workLeft >= b.totalWork;
    const materialText = summary ? summary.materials.map(m => `${G.RES[m.type].name}：需要 ${m.required} · 到场 ${m.onsite} · 在途 ${m.incoming} · 已投入 ${m.incorporated} · 待领 ${m.missing}`).join('\n') || '无需建材，清场后仍须实际施工。' : '旧工地建材已付；载入后保留原进度。';
    const refundText = summary ? `当前可立即返还：${Object.entries(summary.refund).filter(([, n]) => n > 0).map(([k,n]) => `${G.RES[k].name}×${n}`).join('、') || '0 材料'}。${summary.legacyRefundHalf ? '旧档按历史已开工保留一半回收。' : summary.consumed ? '已投入施工的建材按一半回收。' : '未投入施工的到场建材全额回收。'}本作回收简化为直接返公共库存；在途货另行实运退仓，不计入此数。尚未领出的计划不退款。`
      : untouched ? '未开工：取消退还全部已付建材，保留树木' : '已开工：拆除退还一半已付建材，已砍树不恢复';
    return {
      status: (b.sitePriority ? '优先施工 · ' : '') + (upgrade ? '木屋升级石屋 · ' : '') + (summary ? summary.status + (summary.phase === 'clearing' ? `（还需 ${summary.clearing} 棵树）` : '') : trees ? `清理工地：还需砍 ${trees} 棵树（工人搬运入仓）` : `建造中 ${Math.floor(b.progress * 100)}%`),
      workers: b.workers.map(id => w.cmap[id]).filter(Boolean).map(c => c.name).join('、') || '等待建筑工人',
      materials: materialText,
      delivery: '新工地不预扣或预留公共库存：工人到仓/堆料场领料时扣除，实背到场，备齐才施工。缺料或断路会等待；暂停/转岗后的已领材料需送回仓，满仓保留。',
      losses: '本档已记录不可回收建材：' + (Object.entries(G.game.constructionLost || {}).filter(([,n])=>n>0).map(([k,n])=>`${G.RES[k].name} ${Number(n.toFixed(2))}`).join('、') || '0') + '（搬运死亡、拆除未回收和住房烧毁等；旧档不追溯）。',
      refund: refundText + (upgrade ? '原木屋已拆除，取消升级不会还原木屋。' : '已砍树不恢复。')
    };
  },
  roadWorkInfoData: function (b) {
    const s = G.roadWorkSummary(b), number = n => this.supplyNumber(n || 0);
    const refund = Object.entries(s.refund || {}).filter(([, n]) => n > 0).map(([type, n]) => `${G.RES[type].name}×${number(n)}`).join('、') || '0 材料';
    const material = (s.materials || []).map(m => `${G.RES[m.type].name}：需要 ${number(m.required)} · 堆料点未用 ${number(m.onsite)} · 携带合计 ${number(m.incoming)} · 已投入 ${number(m.incorporated)} · 待领 ${number(m.missing)}`).join('\n');
    return {
      status: `${b.sitePriority ? '优先施工 · ' : ''}${s.surface === 'stone' ? '石路' : '土路'}施工 · 已完成 ${s.completed}/${s.total} 格 · 待完工 ${s.pending} 格 · ${s.status}`,
      workers: b.workers.map(id => G.world.cmap[id]).filter(c => c && !c.dead).map(c => c.name).join('、') || '等待建筑工人',
      materials: material || '土路无需建材；每格仍须由工人实际施工。',
      progress: `剩余 ${number(s.workLeft)} / 总计 ${number(s.totalWork)} 基础游戏施工小时。每格1基础小时为本作适配，实际速度受工具和居民状态影响。`,
      delivery: `工程首格是临时堆料点 (${b.x},${b.y})，该格完工后仍保留至工程结束，可点选管理；其他完工格释放。确认不预扣或预留公共库存；到仓领取时才出库。${s.surface === 'stone' ? `仓库→堆料点携带 ${number(s.fetchCarried)} 石，堆料点→施工格携带 ${number(s.pavingCarried)} 石（两项合计为上方携带数，不重复计入到场或已投入）。石材送到施工格才投入。` : ''}施工标记不封路，已有路面和速度保持，每格完工后才按新路面提速。`,
      losses: '暂停保留已完工路面、已做工时和未用到场石材；已领随身材料仍须实际退仓，满仓保留。恢复后继续剩余铺路，不重复扣料。',
      refund: `取消剩余铺路：当前可立即返还 ${refund}，只含堆料点未用建材，直接返公共库存。携带中的材料另行实运退仓，不计入此数；尚未领出的计划不退款，已投入石材不返还。已完工路面和原有道路保留，已砍树不恢复。`,
    };
  },
  siteInfoMarkup: function (data) {
    return `<section class="economy-form" data-site-material-panel><h3>建材实运</h3>${data.progress ? `<p class="row" data-road-work-progress>${this.escHtml(data.progress)}</p>` : ''}<p class="row site-materials" data-site-materials>${this.escHtml(data.materials)}</p><p class="row desc" data-site-delivery>${this.escHtml(data.delivery)}</p><p class="row desc" data-site-losses>${this.escHtml(data.losses)}</p></section>`;
  },
  refreshSiteInfo: function (b) {
    const el = this.el.info;
    if (b.state !== 'site' || !el.querySelector?.('[data-site-material-panel]')) return false;
    const data = this.siteInfoData(b);
    for (const [key, selector] of [['status','[data-site-status]'],['workers','[data-site-workers]'],['materials','[data-site-materials]'],['delivery','[data-site-delivery]'],['losses','[data-site-losses]'],['refund','[data-info-refund]'],['progress','[data-road-work-progress]']]) {
      const node = el.querySelector(selector);
      if (node && node.textContent !== data[key]) node.textContent = data[key];
    }
    return true;
  },
  homeInfoData: function (b) {
    if (!['house', 'stonehouse','boarding'].includes(b.type) || b.state !== 'ok') return null;
    const families = G.world.families.filter(f => f.houseId === b.id);
    const residents = families.flatMap(f => f.members.map(id => G.world.cmap[id]).filter(c => c && !c.dead));
    return {
      status: G.houseFireSummary?.(b)?.active ? this.homeFireInfoData(b).data.status : b.type==='boarding'?`入住 ${families.length} / ${G.LIFE.boardingCap} 家`:residents.length ? '有人居住' : '空置',
      residents: residents.length ? `住户：${residents.map(c => `${c.name}(${Math.floor(c.age)}岁)`).join('、')}` : '住户：暂无',
    };
  },
  supplyNumber: function (n, exact = false) {
    return exact ? String(Number(n) || 0) : String(Number((Number(n) || 0).toFixed(2)));
  },
  supplyStockText: function (stock, exact = false) {
    return G.SUPPLY.types.map(k => `${G.RES[k].name} ${this.supplyNumber(stock?.[k], exact)}`).join(' · ');
  },
  householdSupplyInfoData: function (b) {
    if (!G.householdSupplySummary || !b) return null;
    const s = G.householdSupplySummary(b), physical = s.mode === 'physical';
    const candidates = G.supplyResidents(b).filter(c => c.adult && !c.student && !G.isSick(c));
    return {
      stock: `${b.type === 'supplycamp' ? '临时补给点' : '屋内'}现货：${this.supplyStockText(s.stock)}`,
      capacity: `本地存量 ${this.supplyNumber(G.supplySum(s.stock))} / ${G.SUPPLY.homeCap}；当前 ${s.people} 人`,
      days: physical ? `${b.houseFire ? '火情封存，目前不可食用或取暖；以下仅按存量折算。' : ''}仅本地现货：口粮 ${this.supplyNumber(s.foodDays)} 天；取暖燃料 ${this.supplyNumber(s.fuelDays)} 个冬季日（临时补给点不能代替住房取暖）。在途未到不算可用。` : '自动供给：每日仍直接使用公共粮柴；本地储备天数尚不适用。',
      incoming: `实际在途：${this.supplyStockText(s.incoming)}`,
      buyers: `正在采购/送回：${s.buyers.length ? s.buyers.map(c => c.name).join('、') : '无人'}；本户健康成人候选 ${candidates.length} 人（先收尾当前任务，不代表已出发）。${!candidates.length && s.people ? '无健康成人采购者，需空闲散工协助；学生和病人不采购。' : ''}`,
      reason: s.reason,
      meals: physical ? '必须实际到达当前家庭住处或营地，完成短用餐后才实扣口粮；每人每天最多一份。'+(G.mealTransitionNotice?.()||'') : '自动供给保持原每日结算。',
    };
  },
  householdSupplyInfoMarkup: function (b) {
    const data = this.householdSupplyInfoData(b);
    if (!data) return '';
    const summary = G.householdSupplySummary(b);
    return `<section class="economy-form household-supply" data-household-supply-panel><h3>${b.type === 'supplycamp' ? '家庭临时补给' : '家庭生活物资'}</h3>${Object.keys(data).map(k => ['stock', 'incoming'].includes(k)
      ? `<div class="household-inventory" data-household-supply="${k}">${this.householdInventoryMarkup(summary[k], k === 'stock' ? b.type === 'supplycamp' ? '临时补给点现货' : '屋内现货' : '实际在途')}</div>`
      : `<p class="row" data-household-supply="${k}">${this.escHtml(data[k])}</p>`).join('')}</section>`;
  },
  householdInventoryData: function (stock) {
    const present = G.SUPPLY.types.filter(k => Number(stock?.[k]) > 0);
    const empty = G.SUPPLY.types.filter(k => !(Number(stock?.[k]) > 0));
    return {
      present: present.map(k => `<span class="inventory-item">${this.escHtml(G.RES[k].name)} <b>${stock[k] < .01 ? '&lt;0.01' : this.supplyNumber(stock[k])}</b></span>`).join(' · '),
      empty: empty.map(k => `${G.RES[k].name} 0`).join(' · '),
      count: empty.length,
    };
  },
  householdInventoryMarkup: function (stock, label) {
    const data = this.householdInventoryData(stock);
    return `<p class="inventory-label">${this.escHtml(label)}：</p><div class="inventory-present" data-supply-present>${data.present || '<span class="inventory-none">暂无</span>'}</div><details class="inventory-empty${data.count ? '' : ' hidden'}" data-supply-empty data-detail-disclosure="supply-${this.escHtml(label)}"><summary data-supply-empty-summary>其余为空（${data.count} 项）</summary><p data-supply-empty-list>${this.escHtml(data.empty)}</p></details>`;
  },
  refreshHouseholdInventory: function (holder, stock) {
    const data = this.householdInventoryData(stock);
    const present = holder.querySelector('[data-supply-present]'), empty = holder.querySelector('[data-supply-empty]');
    if (!present || !empty) return;
    const markup = data.present || '<span class="inventory-none">暂无</span>';
    if (present.innerHTML !== markup) present.innerHTML = markup;
    const summary = empty.querySelector('[data-supply-empty-summary]'), list = empty.querySelector('[data-supply-empty-list]');
    if (summary) summary.textContent = `其余为空（${data.count} 项）`;
    if (list && list.textContent !== data.empty) list.textContent = data.empty;
    // Keep the disclosure and its focused summary intact as resources arrive.
    // An already-open empty list stays available until the user closes it.
    empty.classList.toggle('hidden', !data.count && !empty.open && document.activeElement !== summary);
  },
  refreshCitizenSupplyInfo: function (c) {
    this.refreshCitizenSurvival(c);
    const meal=this.el.info.querySelector?.('[data-citizen-meal]');if(meal)meal.textContent=G.householdMealStatus?.(c)||'';
    const holder = this.el.info.querySelector?.('[data-citizen-household-supply]');
    if (!holder || !G.supplyFamilyTarget) return;
    const target = G.supplyFamilyTarget(G.familyOf(c), false);
    if (holder._supplyTarget !== target) { holder.innerHTML = target ? this.householdSupplyInfoMarkup(target) : ''; holder._supplyTarget = target; }
    else if (target) this.refreshHouseholdSupplyInfo(target);
  },
  refreshHouseholdSupplyInfo: function (b) {
    const panel = this.el.info.querySelector?.('[data-household-supply-panel]'), data = this.householdSupplyInfoData(b);
    if (!panel || !data) return false;
    const summary = G.householdSupplySummary(b);
    for (const [k, value] of Object.entries(data)) {
      const node = panel.querySelector(`[data-household-supply="${k}"]`);
      if (node && ['stock', 'incoming'].includes(k)) this.refreshHouseholdInventory(node, summary[k]);
      else if (node && node.textContent !== value) node.textContent = value;
    }
    return true;
  },
  marketSupplyInfoData: function (b) {
    if (!G.marketSupplySummary || b.type !== 'market' || b.state !== 'ok') return null;
    const s = G.marketSupplySummary(b), names = G.workforceWorkers(b).map(c => c.name).join('、') || '无';
    return {
      status: s.reason,
      stock: `市场现货：${this.supplyStockText(s.stock)}`,
      capacity: `已存 ${this.supplyNumber(s.stored)} / ${s.capacity} 总容量；在途另列，到货才入市场`,
      incoming: `实际送往市场：${this.supplyStockText(s.incoming)}`,
      workers: `当前货商 ${s.workers} / 已应用上限 ${s.target}（最多 1 人）：${names}`,
      rule: `3×3 占地 · 服务范围 ±${s.radius} 格（方形，建筑原点）。货商最多搬 ${G.SUPPLY.vendorCarry}，家庭成人最多搬 ${G.SUPPLY.homeCarry}。近仓家庭直接采购可能更快；市场只搬现有物资，不生产食物或燃料。`,
    };
  },
  marketSupplyInfoMarkup: function (b) {
    const data = this.marketSupplyInfoData(b);
    return data ? `<section class="economy-form" data-market-supply-panel><h3>市场实物配送</h3>${Object.keys(data).filter(k => k !== 'status').map(k => `<p class="row" data-market-supply="${k}">${this.escHtml(data[k])}</p>`).join('')}</section>` : '';
  },
  refreshMarketSupplyInfo: function (b) {
    const data = this.marketSupplyInfoData(b), panel = this.el.info.querySelector?.('[data-market-supply-panel]');
    if (!panel || !data) return false;
    for (const [k, value] of Object.entries(data)) {
      const node = this.el.info.querySelector(`[data-market-supply="${k}"]`);
      if (node && node.textContent !== value) node.textContent = value;
    }
    const names = this.el.info.querySelector('[data-market-workers]');
    if (names) names.textContent = G.workforceWorkers(b).map(c => c.name).join('、') || '无';
    this.refreshSupplyModeInfo(b);
    return true;
  },
  villageSupplyInfoData: function () {
    if (!G.supplyInventory) return null;
    const s = G.supplyInventory(), homes = Object.fromEntries(G.SUPPLY.types.map(k => [k, s.home[k] + s.camp[k]]));
    return {
      mode: G.supplyEnabled() ? '真实配送：各家吃自己已到货的口粮、烧本地燃料；公共库存减少也可能只是配送转移。' : '自动供给（新旧存档默认）：居民每日从公共库存食用和取暖；切换须在下方单独确认。',
      public: `公共库存：${this.supplyStockText(s.public)}`,
      market: `市场现货：${this.supplyStockText(s.market)}`,
      homes: `住房与临时补给点：${this.supplyStockText(homes)}`,
      transit: `配送在途：${this.supplyStockText(s.transit)}`,
      cache: `散落待回收：${this.supplyStockText(s.cache)}（需空闲成人沿可达路线回收，且公共仓库有空位）`,
      locked: `火情封存：${this.supplyStockText(s.locked)}（暂不可取；烧毁才计火灾损失）`,
      rule: '以上分栏互不重复。转入市场、住房或随身物资不算产出；在途与散落物资尚不能让家中居民直接食用。工业与贸易仍使用公共库存。',
    };
  },
  villageSupplyInfoMarkup: function () {
    const data = this.villageSupplyInfoData();
    return data ? `<section class="economy-form" data-village-supply-panel><h3>全村生活物资分布</h3>${Object.keys(data).map(k => `<p class="row" data-village-supply="${k}">${this.escHtml(data[k])}</p>`).join('')}</section>` : '';
  },
  refreshVillageSupplyInfo: function () {
    const panel = this.el.info.querySelector?.('[data-village-supply-panel]'), data = this.villageSupplyInfoData();
    if (!panel || !data) return;
    for (const [k, value] of Object.entries(data)) {
      const node = panel.querySelector(`[data-village-supply="${k}"]`);
      if (node && node.textContent !== value) node.textContent = value;
    }
  },
  supplyModeInfoData: function () {
    if (!G.supplyModeQuote) return null;
    const quote = G.supplyModeQuote(), enabled = G.supplyEnabled();
    return { quote, enabled, data: {
      mode: enabled ? '本存档已启用全村真实配送，不能切回自动供给。' : '当前全村自动供给；真实配送为一次性、不可逆的整村规则切换。',
      rule: quote.rule || '已分配的物资不会重复领取；以后由货商与家庭采购者实际搬运。居民须实际到家或营地完成用餐，每天最多一份。'+(G.mealTransitionNotice?.()||''),
      cost: enabled ? '一次性启动分配已结束，不再扣取或赠送启动物资。' : `确认后从公共库存实际扣除：${this.supplyStockText(quote.cost, true)}。这些物资逐项移入下列住处，不是赠送。`,
      coverage: enabled ? '库存位置、在途与消耗请看实物分布和家庭详情。' : `本次实际启动口粮 ${this.supplyNumber(quote.foodDays)} 天（最多 2 天）；距两日口粮还缺 ${this.supplyNumber(quote.foodShortfall)}，冷季取暖还缺 ${this.supplyNumber(quote.fuelShortfall)} 柴火当量。${quote.foodDays < 2 - 1e-8 ? '库存不足，不能保证两日供给。' : ''}`,
      clothing: G.clothingSupplyEnabled?.() ? '衣物配送已启用：穿坏只从住处现货换衣；先暖衣后普通衣，保留已穿耐久。' : '衣物仍沿用远程公共领取。启用家庭配送后，可在这里另行确认把衣物加入真实配送。',
      buyers: enabled ? '无健康成人的家庭需空闲散工协助；配送需要可达道路和真实库存。' : `无健康成人采购者 ${quote.familiesWithoutBuyer || 0} 户；完工通用仓 ${quote.readyStores || 0} 座。无采购者家庭依赖空闲散工，市场需另外安排货商。`,
    } };
  },
  supplyModeInfoMarkup: function (b) {
    const facts = this.supplyModeInfoData();
    if (!facts) return '';
    return `<section class="economy-form" data-supply-mode-panel aria-labelledby="supply-mode-title"><h3 id="supply-mode-title">全村真实配送 · 不可逆切换</h3>
      ${Object.keys(facts.data).map(k => `<p class="row" data-supply-mode="${k}">${this.escHtml(facts.data[k])}</p>`).join('')}
      <div data-supply-mode-actions>
        <p class="warn-txt">此存档启用后不能切回自动供给。若想保留原局，必须先导出当前存档，并自行确认下载文件已保存。</p>
        <button type="button" id="supply-mode-export">先导出当前存档</button>
        <p class="desc">下列是每栋住房/无房家庭的实际启动分配；共享宿舍按整栋分配。未确认前不扣料、不创建补给点。</p>
        <ol data-supply-mode-rows></ol>
        <button type="button" id="supply-mode-start" aria-expanded="false">查看整村切换确认</button>
        <div class="hidden" data-supply-mode-confirm><p>确认后公共库存按上列数量转入各住处；今后必须实际配送。此存档不能返回自动供给，也不能再次领取启动物资。</p>
          <div class="economy-actions"><button type="button" id="supply-mode-confirm" class="danger" disabled>确认永久启用真实配送</button><button type="button" id="supply-mode-cancel">取消，保留自动供给</button></div>
        </div>
      </div><p class="economy-message" data-supply-mode-message role="status" aria-live="polite"></p>
      <div data-clothing-supply-controls class="hidden"><h3>加入衣物配送 · 不可逆</h3>
        <p data-clothing-supply-facts></p><p class="warn-txt">${this.escHtml(G.clothingSupplyQuote().rule)}请先导出原局，确认配送通路和家中衣物到货后再过冬。</p>
        <button type="button" id="clothing-supply-export">先导出当前存档</button>
        <button type="button" id="clothing-supply-start">查看衣物配送确认</button>
        <div data-clothing-supply-confirm class="hidden"><p>不扣取或分配任何衣服；今后需要实际送到家，公共有货不等于家人已穿上。不能切回远程领取。</p>
          <button type="button" id="clothing-supply-confirm" class="danger" disabled>确认永久启用衣物配送</button><button type="button" id="clothing-supply-cancel">取消，保留原领取规则</button></div>
        <p data-clothing-supply-message role="status" aria-live="polite"></p></div>${b?.type==='townhall'?this.toolModeInfoMarkup():''}</section>`;
  },
  supplyModeControlValid: function (b, context, node, allowModal = false) {
    if (!context) return false;
    const { world, game, el, panel, type } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel?.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.type === type && ['townhall', 'market'].includes(type) && b.state === 'ok' &&
      el.querySelector('[data-supply-mode-panel]') === panel && (!node || (!node.disabled && panel.querySelector('#' + node.id) === node)) &&
      (allowModal || !(G.hasOpenModal && G.hasOpenModal()));
  },
  resetSupplyConfirmation: function (panel, message, restoreFocus = false) {
    const box = panel.querySelector('[data-supply-mode-confirm]'), start = panel.querySelector('#supply-mode-start'), confirm = panel.querySelector('#supply-mode-confirm');
    panel._supplyPending = null;
    if (box) box.classList.add('hidden');
    if (start) start.setAttribute('aria-expanded', 'false');
    if (confirm) confirm.disabled = true;
    if (message !== undefined) panel.querySelector('[data-supply-mode-message]').textContent = message;
    if (restoreFocus && box?.contains(document.activeElement) && start?.focus && !start.disabled) start.focus();
  },
  refreshSupplyModeInfo: function (b, facts) {
    const panel = this.el.info.querySelector?.('[data-supply-mode-panel]');
    if (!panel || !this.supplyModeControlValid(b, panel._supplyContext, null, true)) { if (panel) this.resetSupplyConfirmation(panel); return false; }
    facts = facts || this.supplyModeInfoData();
    if (!facts) return false;
    const { data, quote, enabled } = facts;
    const actions = panel.querySelector('[data-supply-mode-actions]'), actionFocused = actions.contains(document.activeElement);
    for (const [k, value] of Object.entries(data)) {
      const node = panel.querySelector(`[data-supply-mode="${k}"]`);
      if (node && node.textContent !== value) node.textContent = value;
    }
    const rows = quote.rows.map(row => `${row.name} #${row.id}（${row.x}, ${row.y}；${row.families.length} 户 / ${row.people} 人）：${this.supplyStockText(row.stock, true)}；实际口粮 ${this.supplyNumber(row.foodDays)} 天${row.foodDays < 2 - 1e-8 ? '，不足两日' : ''}；冷季两日需 ${this.supplyNumber(row.fuelNeed)} 柴火当量，还缺 ${this.supplyNumber(Math.max(0, row.fuelNeed - row.stock.firewood - row.stock.coal * G.COAL_HEAT))}。`);
    const holder = panel.querySelector('[data-supply-mode-rows]'), rowKey = JSON.stringify(rows);
    // Only replace noninteractive quote rows when facts change, never controls.
    if (holder._supplyRows !== rowKey) { holder._supplyRows = rowKey; holder.innerHTML = rows.map(text => `<li>${this.escHtml(text)}</li>`).join(''); }
    const modal = G.hasOpenModal && G.hasOpenModal();
    if (modal || enabled || (panel._supplyPending !== null && (!quote.ok || panel._supplyPending !== quote.key)))
      this.resetSupplyConfirmation(panel, enabled ? undefined : modal ? '确认已取消，请关闭弹窗后重新预览。' : '库存、家庭、取暖策略或配送条件已变化，请核对最新分配后重新确认。', !modal);
    actions.classList.toggle('hidden', enabled);
    for (const id of ['start', 'export', 'cancel']) panel.querySelector('#supply-mode-' + id).disabled = enabled;
    panel.querySelector('#supply-mode-start').setAttribute('aria-disabled', String(enabled || !quote.ok));
    panel.querySelector('#supply-mode-confirm').disabled = enabled || !quote.ok || panel._supplyPending === null;
    if (enabled && actionFocused) this.el.info.querySelector('#info-close')?.focus?.();
    this.refreshClothingSupplyInfo(b);
    this.refreshToolModeInfo(b);
    return true;
  },
  initSupplyModeInfo: function (b) {
    const el = this.el.info, panel = el.querySelector?.('[data-supply-mode-panel]');
    if (!panel) return;
    const context = { world: G.world, game: G.game, el, panel, type: b.type };
    panel._supplyContext = context;
    this.resetSupplyConfirmation(panel, '');
    const button = id => panel.querySelector('#supply-mode-' + id), start = button('start'), confirm = button('confirm'), cancel = button('cancel'), exportButton = button('export');
    for (const node of [start, confirm, cancel, exportButton]) node.addEventListener('keydown', e => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); });
    start.addEventListener('click', e => {
      if (e.detail > 1 || !this.supplyModeControlValid(b, context, start)) { this.resetSupplyConfirmation(panel); return; }
      const facts = this.supplyModeInfoData(); this.refreshSupplyModeInfo(b, facts);
      if (!facts.quote.ok) { this.resetSupplyConfirmation(panel, facts.quote.reason); return; }
      panel._supplyPending = facts.quote.key;
      panel.querySelector('[data-supply-mode-confirm]').classList.remove('hidden'); start.setAttribute('aria-expanded', 'true'); confirm.disabled = false;
      panel.querySelector('[data-supply-mode-message]').textContent = '尚未切换或扣料。请核对逐户分配和不足天数；保留原局须先导出，再重新预览。';
      confirm.focus?.();
    });
    cancel.addEventListener('click', () => {
      if (!this.supplyModeControlValid(b, context, cancel)) { this.resetSupplyConfirmation(panel); return; }
      this.resetSupplyConfirmation(panel, '已取消；模式、库存与家庭补给均未改变。'); start.focus?.();
    });
    exportButton.addEventListener('click', e => {
      if (e.detail > 1 || !this.supplyModeControlValid(b, context, exportButton)) { this.resetSupplyConfirmation(panel); return; }
      this.resetSupplyConfirmation(panel, '已取消待确认切换，导出后需要重新预览。');
      try {
        G.exportSaveFile();
        panel.querySelector('[data-supply-mode-message]').textContent = '已请求浏览器下载当前存档，请自行核对文件已保存；尚未切换，需要重新预览。';
      } catch (error) {
        panel.querySelector('[data-supply-mode-message]').textContent = '导出未完成，未切换供给模式。请重试并核对备份文件，再重新预览。';
      }
    });
    confirm.addEventListener('click', e => {
      if (e.detail > 1 || !this.supplyModeControlValid(b, context, confirm) || panel._supplyPending === null) { this.resetSupplyConfirmation(panel); return; }
      const expectedKey = panel._supplyPending, facts = this.supplyModeInfoData(); this.refreshSupplyModeInfo(b, facts);
      if (!facts.quote.ok || facts.quote.key !== expectedKey || panel._supplyPending === null) return;
      this.resetSupplyConfirmation(panel);
      const ok = G.enableHouseholdSupply(expectedKey, context.game);
      this.refreshSupplyModeInfo(b); this.refreshVillageSupplyInfo(); this.refreshMarketSupplyInfo(b);
      this.resetSupplyConfirmation(panel, ok ? '已永久启用全村真实配送；启动物资已按预览从公共库存转入各住处，未新增物资。本存档不能切回自动供给。' : '条件已变化，未切换；请重新预览。');
      if (ok) { this.refreshHUD(); el.querySelector('#info-close')?.focus?.(); } else start.focus?.();
    });
    this.initClothingSupplyInfo(b);
    if(b.type==='townhall')this.initToolModeInfo(b);
    this.refreshSupplyModeInfo(b);
  },
  resetClothingConfirmation: function(panel, message) {
    panel._clothingPending = null;
    const box = panel.querySelector('[data-clothing-supply-confirm]'), button = panel.querySelector('#clothing-supply-confirm');
    if (box) box.classList.add('hidden'); if (button) button.disabled = true;
    if (message !== undefined) panel.querySelector('[data-clothing-supply-message]').textContent = message;
  },
  refreshClothingSupplyInfo: function(b) {
    const panel=this.el.info.querySelector?.('[data-supply-mode-panel]');if(!panel)return;
    const controls=panel.querySelector('[data-clothing-supply-controls]');if(!controls)return;
    const q=G.clothingSupplyQuote(),visible=G.supplyEnabled()&&!q.enabled,active=controls.contains(document.activeElement);
    const valid=this.supplyModeControlValid(b,panel._supplyContext,null,true),modal=G.hasOpenModal?.();
    if(!valid||modal||!q.ok||(panel._clothingPending!==null&&panel._clothingPending!==undefined&&panel._clothingPending!==q.key)) {
      const hadPending=panel._clothingPending!=null,inside=panel.querySelector('[data-clothing-supply-confirm]').contains(document.activeElement);
      this.resetClothingConfirmation(panel,hadPending?'条件已变化，请重新查看衣物配送确认。':undefined);
      if(inside&&visible&&!modal)panel.querySelector('#clothing-supply-start').focus();
    }
    controls.classList.toggle('hidden',!visible);
    panel.querySelector('[data-clothing-supply-facts]').textContent=`公共普通衣 ${this.supplyNumber(q.public.clothes)} / 暖衣 ${this.supplyNumber(q.public.warmCoats)}；衣物耗尽 ${q.unclothed} 人，7日内需换衣 ${q.soon} 人。启用不赠衣、不扣料、不重置已穿耐久。`;
    for(const id of ['start','export','cancel'])panel.querySelector('#clothing-supply-'+id).disabled=!visible;
    panel.querySelector('#clothing-supply-confirm').disabled=!visible||!q.ok||panel._clothingPending==null;
    if(!visible&&active)this.el.info.querySelector('#info-close')?.focus?.();
  },
  initClothingSupplyInfo: function(b) {
    const panel=this.el.info.querySelector('[data-supply-mode-panel]'),context=panel._supplyContext;
    const button=id=>panel.querySelector('#clothing-supply-'+id),valid=node=>G.supplyEnabled()&&!G.clothingSupplyEnabled()&&this.supplyModeControlValid(b,context,node);
    panel._clothingPending=null;
    for(const id of ['start','confirm','cancel','export']) {
      const node=button(id);node.addEventListener('keydown',e=>{if(e.repeat&&(e.key==='Enter'||e.key===' '))e.preventDefault();});
      node.addEventListener('click',e=>{
        if(e.detail>1||!valid(node)){this.resetClothingConfirmation(panel);return;}
        if(id==='cancel'){this.resetClothingConfirmation(panel,'已取消，领取规则未改。');button('start').focus();return;}
        if(id==='export'){
          this.resetClothingConfirmation(panel);
          try{G.exportSaveFile();panel.querySelector('[data-clothing-supply-message]').textContent='已请求下载，请核对文件已保存；尚未启用衣物配送，请重新确认。';}
          catch(error){panel.querySelector('[data-clothing-supply-message]').textContent='导出未完成，衣物领取规则未改。';}return;
        }
        const pending=panel._clothingPending,q=G.clothingSupplyQuote();this.refreshClothingSupplyInfo(b);
        if(!q.ok)return;
        if(id==='start'){panel._clothingPending=q.key;panel.querySelector('[data-clothing-supply-confirm]').classList.remove('hidden');button('confirm').disabled=false;button('confirm').focus();return;}
        if(pending==null||pending!==q.key||panel._clothingPending!==pending)return;
        this.resetClothingConfirmation(panel);
        if(G.enableClothingSupply(pending,context.game)){this.refreshSupplyModeInfo(b);this.refreshVillageSupplyInfo();this.refreshMarketSupplyInfo(b);this.refreshHUD();this.el.info.querySelector('#info-close')?.focus?.();}
      });
    }
  },
  toolModeInfoMarkup:function(){
    const q=G.toolModeQuote();return `<div data-tool-mode-controls><h3>个人工具 · 一次性切换</h3><p data-tool-mode-status></p><p data-tool-mode-facts></p>
      <div data-tool-mode-actions><p class="warn-txt">${this.escHtml(q.rule)}已接批次（含取料途中）先按原规则收尾，之后新批次才适用新规则。请先导出存档。</p><p>${this.escHtml(q.wearRule)}</p>
        <button type="button" id="tool-mode-export">先导出当前存档</button><button type="button" id="tool-mode-start">查看个人工具确认</button>
        <div data-tool-mode-confirm class="hidden"><p>不是赠送工具，也不立即装备全村；按以上明细保留旧磨损，之后每人需要亲自走到通用仓。此存档不能切回共用池。</p>
          <button type="button" id="tool-mode-confirm" class="danger" disabled>确认永久启用个人工具</button><button type="button" id="tool-mode-cancel">取消，保留共用工具</button></div>
      </div><p data-tool-mode-message role="status" aria-live="polite"></p></div>`;
  },
  resetToolModeConfirmation:function(panel,message){
    if(!panel.querySelector('[data-tool-mode-controls]'))return;panel._toolModePending=null;
    panel.querySelector('[data-tool-mode-confirm]').classList.add('hidden');panel.querySelector('#tool-mode-confirm').disabled=true;
    if(message!==undefined)panel.querySelector('[data-tool-mode-message]').textContent=message;
  },
  refreshToolModeInfo:function(b){
    const panel=this.el.info.querySelector?.('[data-supply-mode-panel]'),box=panel?.querySelector('[data-tool-mode-controls]');if(!box)return;
    const q=G.toolModeQuote(),valid=this.supplyModeControlValid(b,panel._supplyContext,null,true),modal=G.hasOpenModal?.(),pending=panel._toolModePending;
    if(!valid||modal||!q.ok||pending!=null&&pending!==q.key)this.resetToolModeConfirmation(panel,pending!=null?'条件已变化，未切换；请重新核对工具明细。':undefined);
    const equipped=G.world.citizens.filter(c=>!c.dead&&G.toolEquipped(c)).length;
    panel.querySelector('[data-tool-mode-status]').textContent=q.enabled?`个人工具已启用：已装备 ${equipped} 人；只有无工具的生产/建设者半速，运输和服务不受影响。`:'仍使用全镇共用工具池（新旧局默认）。';
    panel.querySelector('[data-tool-mode-facts]').textContent=q.enabled?['tools','steelTools'].map(k=>`${G.RES[k].name}：公共全新 ${this.supplyNumber(G.game.res[k])}；旧半用 ${(G.game.toolRemainders[k]||0)>0?1:0} 把（剩 ${this.supplyNumber((G.game.toolRemainders[k]||0)/16)} 劳动日，仅领用、不贸易）`).join('；'):
      q.rows.map(r=>`${G.RES[r.type].name}现存 ${this.supplyNumber(r.stock)} 把，旧累计磨损 ${this.supplyNumber(r.wear)} 把；切换后全新/余额 ${this.supplyNumber(r.spare)}，半用 ${r.remainingHours>0?1:0} 把（余 ${this.supplyNumber(r.remainingHours/16)} 劳动日）`).join('；')+(q.reason?'；不能切换：'+q.reason:'；不足整件的旧余额保留，凑满整件才可领取。');
    const actions=panel.querySelector('[data-tool-mode-actions]'),focused=actions.contains(document.activeElement);actions.classList.toggle('hidden',q.enabled);
    for(const id of ['start','export','cancel'])panel.querySelector('#tool-mode-'+id).disabled=q.enabled;
    panel.querySelector('#tool-mode-start').disabled=!q.ok;panel.querySelector('#tool-mode-confirm').disabled=!q.ok||panel._toolModePending==null;
    if(q.enabled&&focused)this.el.info.querySelector('#info-close')?.focus?.();
  },
  initToolModeInfo:function(b){
    const panel=this.el.info.querySelector('[data-supply-mode-panel]');if(!panel?.querySelector('[data-tool-mode-controls]'))return;
    const context=panel._supplyContext,button=id=>panel.querySelector('#tool-mode-'+id);panel._toolModePending=null;
    for(const id of ['export','start','cancel','confirm']){const node=button(id);node.addEventListener('keydown',e=>{if(e.repeat&&(e.key==='Enter'||e.key===' '))e.preventDefault();});node.addEventListener('click',e=>{
      if(e.detail>1||G.personalToolsEnabled()||!this.supplyModeControlValid(b,context,node)){this.resetToolModeConfirmation(panel);return;}
      if(id==='cancel'){this.resetToolModeConfirmation(panel,'已取消，工具规则及库存未变。');button('start').focus();return;}
      if(id==='export'){this.resetToolModeConfirmation(panel);try{G.exportSaveFile();panel.querySelector('[data-tool-mode-message]').textContent='已请求下载，请确认文件已保存；尚未切换，请重新预览。';}catch(error){panel.querySelector('[data-tool-mode-message]').textContent='导出未完成，工具规则未改。';}return;}
      const pending=panel._toolModePending,q=G.toolModeQuote();this.refreshToolModeInfo(b);if(!q.ok)return;
      if(id==='start'){panel._toolModePending=q.key;panel.querySelector('[data-tool-mode-confirm]').classList.remove('hidden');button('confirm').disabled=false;button('confirm').focus();return;}
      if(pending==null||pending!==q.key||panel._toolModePending!==pending)return;
      this.resetToolModeConfirmation(panel);if(G.enablePersonalTools(pending,context.game)){this.refreshToolModeInfo(b);this.refreshTownHallInfo(b);this.refreshHUD();this.el.info.querySelector('#info-close')?.focus?.();}
    });}
  },
  heatingInfoData:function(b){
    const s=G.homeHeatingSummary(b);if(!s)return null;
    const last=s.last,physical=G.supplyEnabled&&G.supplyEnabled(),local=physical?G.householdSupplySummary(b).stock:null;
    return {summary:s,data:{policy:`全镇策略：${s.allowCoal?'柴火不足时允许煤补足':'仅烧柴火，不动用煤'}；取暖保留煤底线 ${s.coalReserve}`,
      stock:physical?`本屋柴火 ${this.supplyNumber(local.firewood)} · 煤 ${this.supplyNumber(local.coal)}；取暖只用本地现货，公共煤 ${s.coalStock.toFixed(2)} 不能直接暖屋`:`煤库存 ${s.coalStock.toFixed(2)} · 可用于取暖 ${s.coalAvailable.toFixed(2)} · 当前燃料约 ${s.fuel.toFixed(2)} 柴火当量`,
      home:`本屋${s.occupied?'已入住':'空置不耗燃料'}，冬季每日需要 ${s.perDay.toFixed(2)} 柴火当量。${G.isWinter()&&s.occupied&&s.unheated?'当前未供暖，住户仍会受冻。':''}`,
      receipt:last?`最近结算：第 ${last.day+1} 天，实际烧柴 ${last.wood.toFixed(2)}、煤 ${last.coal.toFixed(2)} / 需求 ${last.need.toFixed(2)} 柴火当量${last.wood+last.coal*s.ratio+1e-8<last.need?'（当时燃料未足）':''}`:'暂无本屋冬季取暖结算记录；旧档不编造用量',
      rule:(physical?'真实配送只烧本屋现货，先柴后煤；煤底线仅限制公共库存向住宅配送，屋内已配送煤依当前策略使用。':'全镇先烧柴再用底线以上的煤补缺。')+'1煤=2柴热量为本作适配。底线只约束取暖，钢工具/贸易仍能使用煤。'+(physical?'修改影响后续配送和下一次冬季日界扣料':'修改仅影响下一次冬季日界扣料')+'，不会立即暖屋；粮柴账本不包含煤耗。'}};
  },
  heatingInfoMarkup:function(b){
    const f=this.heatingInfoData(b);if(!f)return '';const s=f.summary;
    return `<section class="economy-form" data-heating-panel><h3>全镇取暖策略</h3>${Object.keys(f.data).map(k=>`<p class="row desc" data-heating="${k}">${this.escHtml(f.data[k])}</p>`).join('')}
      <label>燃料<select id="heating-mode"><option value="wood"${s.allowCoal?'':' selected'}>仅柴火</option><option value="coal"${s.allowCoal?' selected':''}>允许煤补柴</option></select></label>
      <label>取暖保留煤底线<input id="heating-reserve" type="number" min="0" max="${G.PRODUCTION_GOAL_MAX}" step="1" value="${s.coalReserve}"></label>
      <button type="button" id="heating-apply">应用全镇策略</button><p data-heating-message role="status" aria-live="polite"></p></section>`;
  },
  refreshHeatingInfo:function(b){
    const f=this.heatingInfoData(b),el=this.el.info;if(!f||!el.querySelector)return;
    for(const k of Object.keys(f.data)){const node=el.querySelector(`[data-heating="${k}"]`);if(node&&node.textContent!==f.data[k])node.textContent=f.data[k];}
  },
  initHeatingInfo:function(b){
    const el=this.el.info,panel=el.querySelector('[data-heating-panel]');if(!panel)return;
    const w=G.world,g=G.game,type=b.type,mode=panel.querySelector('#heating-mode'),reserve=panel.querySelector('#heating-reserve'),button=panel.querySelector('#heating-apply');
    button.addEventListener('click',()=>{
      if(G.world!==w||G.game!==g||this.el.info!==el||el.classList.contains('hidden')||G.sel?.kind!=='b'||G.sel.id!==b.id||w.bmap[b.id]!==b||b.type!==type||b.state!=='ok'||el.querySelector('[data-heating-panel]')!==panel||(G.hasOpenModal&&G.hasOpenModal()))return;
      const n=reserve.value.trim()===''?NaN:Number(reserve.value),ok=['wood','coal'].includes(mode.value)&&G.setHeatingPolicy(mode.value==='coal',n);
      panel.querySelector('[data-heating-message]').textContent=ok?'已应用全镇策略，从下一次冬季日界扣料生效。':'请输入有效燃料策略与非负整数煤底线。';this.refreshHeatingInfo(b);
    });
  },
  fishingNumber: function (n) { return Number(n).toFixed(2).replace(/\.?0+$/, ''); },
  huntingInfoData: function(b) {
    if(b.type!=='hunting'||b.state!=='ok')return null;
    const h=G.huntingSummary(b),p=G.HUNTING;
    return {
      prey:`鹿群：圈内 ${h.count} 只 · 未被追踪 ${h.free} 只 · 从猎屋门外可达 ${h.reachable} 只`,
      cooldown:h.cooldownDays>0?`全屋共用猎杀间隔：还需 ${h.cooldownDays.toFixed(1)} 天`:`全屋共用猎杀间隔：已就绪，每次成功后等待 ${p.cooldownDays} 天`,
      status:h.reason||'猎人须实际到鹿的位置完成工作，才能获得猎物。',
      batch:`每鹿基础肉 ${p.meat} / 受教育 ${p.eduMeat}，皮革 ${p.leather} / ${p.eduLeather}；肉皮另受当前工具规则影响。两名猎人共用一个冷却，不会各算一次。`,
      losses:`猎获及遗留肉皮运输死亡损失：全镇累计肉 ${G.game.huntingLost?.meat||0}、皮革 ${G.game.huntingLost?.leather||0}（肉另计食物账本，皮革在此保留记录）。`,
      delivery:'猎物先成为实背肉皮，走到可达通用仓才入库；仓满或断路保留携货，减少岗位先运完。旧档来源不明的肉皮同样保货，标为遗留货物，不推定是鹿肉。',
      wildlife:`鹿会在栖地附近活动，被猎后 ${p.replenishDays} 天后补入；无永久灭绝、不吃庄稼。圈内数量不是入库保证。`,
      source:'原版每屋两月间隔按48日年折为8日；鹿群规模、产量和补入节奏为本作适配。旧档首次读入补建野生鹿，库存与携货不变；之后猎屋也按此间隔工作。',
    };
  },
  huntingInfoMarkup:function(b){const d=this.huntingInfoData(b);return d?`<section class="economy-form" data-hunting-panel><div class="row"><b>鹿群与狩猎</b></div>${Object.entries(d).map(([k,v])=>`<div class="row${['batch','delivery','wildlife','source'].includes(k)?' desc':''}" data-hunting="${k}">${this.escHtml(v)}</div>`).join('')}</section>`:'';},
  refreshHuntingInfo:function(b){
    const panel=this.el.info.querySelector?.('[data-hunting-panel]'),d=this.huntingInfoData(b);if(!panel||!d)return false;
    for(const[k,v]of Object.entries(d)){const n=panel.querySelector(`[data-hunting="${k}"]`);if(!n)return false;if(n.textContent!==v)n.textContent=v;}
    const status=this.el.info.querySelector('[data-hunting-status]');if(status)status.textContent=d.status;
    const workers=this.el.info.querySelector('[data-hunting-workers]');if(workers)workers.textContent=(b.workers||[]).map(id=>G.world.cmap[id]?.name).filter(Boolean).join('、')||'无';
    return true;
  },

  fishingInfoData: function (b) {
    if (!['dock', 'townhall'].includes(b.type) || b.state !== 'ok') return null;
    const shared = G.game.fishingRules === 'shared', quote = shared ? { ok: false, rows: [], key: null } : G.fishingPolicyQuote();
    const data = {
      rule: `全镇渔业规则：${shared ? '共享可用水域' : '经典水域（旧档保留）'}。${shared ? '新局默认采用；全镇所有渔屋统一生效，无切回按钮。' : '仍按原始水域计产；查看详情不会改变旧档规则。'}`,
      scope: '共享规则：桥梁工地和完工桥占用的水格不计；同一水格由覆盖它的已完工、有在岗渔民且用工上限大于0的渔屋均分。搬运或休息仍占份额；空屋、工地和0上限不占份额。全镇产量目标暂停本身不释放份额。',
      timing: '只影响之后新接的捕鱼批次。当前任务、夜间暂停的渔获和已背起的货物保持已锁定数量；读档仍按既有规则重启未完成任务，不保留未产出的批次。',
      adaptation: '沿用建筑原点±10格方形范围、40格满产参考；均分与产量曲线为本作适配，并非有限鱼群库存。单批估计不等于年度产量，工具影响每批数量，教育缩短劳动时间；行走、劳动和送仓时间仍影响实际入库。',
    };
    if (b.type === 'dock') {
      const s = G.fishingWaterSummary(b, { preview: true });
      data.water = `水域：原始 ${s.raw} 格 · 桥占 ${s.blocked} 格 · 可用 ${s.free} 格 · 重叠共享 ${s.sharedTiles} 格 · 共享口径有效 ${this.fishingNumber(s.effective)} 格。`;
      data.staffing = `当前${s.staffed ? shared ? '有在岗渔民，参与共享' : '有在岗渔民，启用共享后计入竞争' : '未参与共享（无在岗渔民或用工上限为0）'}；另有 ${s.competitors.length} 座在岗渔屋覆盖同一片可用水域。下列估计假定本屋能接下一批，不代表现在已有人开工。`;
      data.catch = `下一批估计：${s.catch} 肉类（基础 ${s.baseCatch}，已计当前工具规则）。${s.reason || ''}`;
    }
    data.transition = quote.rows.length ? quote.rows.map(row => `渔屋 #${row.id}（${row.x},${row.y}）${row.staffed ? '在岗' : '未在岗，假定接新批'}：${row.before} → ${row.after} 肉类/批；桥占 ${row.blocked} 格，共享 ${row.sharedTiles} 格，有效 ${this.fishingNumber(row.effective)} 格。`).join('\n') : '当前没有完工渔屋。之后新建渔屋也采用本镇统一规则。';
    return { shared, quote, data };
  },
  fishingInfoMarkup: function (b) {
    const f = this.fishingInfoData(b); if (!f) return '';
    const row = key => `<p class="row desc" data-fishing="${key}">${this.escHtml(f.data[key])}</p>`;
    return `<section class="economy-form" data-fishing-panel aria-labelledby="fishing-title">
      <h3 id="fishing-title">渔屋与可用水域</h3>${['rule', ...(b.type === 'dock' ? ['water', 'staffing', 'catch'] : [])].map(row).join('')}
      <details><summary>共享范围与批次规则</summary>${['scope', 'timing', 'adaptation'].map(row).join('')}</details>
      ${f.shared ? '' : `<div data-fishing-migration><button type="button" id="fishing-start" aria-expanded="false" aria-controls="fishing-confirmation">查看全镇共享规则确认</button>
        <div id="fishing-confirmation" class="hidden" data-fishing-confirm>
          <p id="fishing-warning">确认后全镇所有渔屋永久改用共享可用水域，未来批次可能下降；免费且仅可开启一次。当前任务和携货不追溯扣除。取消不改变任何规则或库存。</p>
          <p class="desc">逐屋基础预估（未计工具）：经典 → 共享；每屋均假定能接新批次，其他渔屋保持当前在岗状态。以下不是全镇同时增岗后的总产量。</p>
          <div style="white-space:pre-line" data-fishing="transition">${this.escHtml(f.data.transition)}</div>
          <div class="economy-actions"><button type="button" id="fishing-confirm" class="danger" aria-describedby="fishing-warning" disabled>确认全镇改用共享水域</button><button type="button" id="fishing-cancel">取消，保持经典规则</button></div>
        </div></div>`}
      <p data-fishing-message role="status" aria-live="polite"></p>
    </section>`;
  },
  fishingControlValid: function (b, context, node, allowModal) {
    if (!context) return false;
    const { world, game, el, panel, type } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel?.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.type === type && b.state === 'ok' &&
      el.querySelector('[data-fishing-panel]') === panel && (!node || (!node.disabled && panel.querySelector('#' + node.id) === node)) &&
      (allowModal || !(G.hasOpenModal && G.hasOpenModal()));
  },
  resetFishingConfirmation: function (panel, message, restoreFocus) {
    const box = panel.querySelector('[data-fishing-confirm]'), start = panel.querySelector('#fishing-start'), confirm = panel.querySelector('#fishing-confirm');
    panel._fishingPending = null;
    if (box) box.classList.add('hidden');
    if (start) start.setAttribute('aria-expanded', 'false');
    if (confirm) confirm.disabled = true;
    const status = panel.querySelector('[data-fishing-message]');
    if (message !== undefined && status) status.textContent = message;
    if (restoreFocus && box?.contains(document.activeElement) && start?.focus) start.focus();
  },
  refreshFishingInfo: function (b) {
    const el = this.el.info, panel = el.querySelector?.('[data-fishing-panel]');
    if (!panel || !this.fishingControlValid(b, panel._fishingContext, null, true)) { if (panel) this.resetFishingConfirmation(panel); return false; }
    const f = this.fishingInfoData(b); if (!f) return false;
    for (const [key, text] of Object.entries(f.data)) {
      const node = panel.querySelector(`[data-fishing="${key}"]`);
      if (node && node.textContent !== text) node.textContent = text;
    }
    const modal = G.hasOpenModal && G.hasOpenModal();
    if (panel._fishingPending && (modal || !f.quote.ok || panel._fishingPending.key !== f.quote.key))
      this.resetFishingConfirmation(panel, modal ? '确认已取消，请关闭弹窗后重新查看。' : '规则、在岗渔民或水域已变化，请核对最新逐屋预估后重新确认。', !modal);
    const start = panel.querySelector('#fishing-start'), confirm = panel.querySelector('#fishing-confirm'), controls = panel.querySelector('[data-fishing-migration]');
    if (f.shared && !modal && controls?.contains(document.activeElement)) { const close = el.querySelector('#info-close'); if (close?.focus) close.focus(); }
    if (controls) controls.classList.toggle('hidden', f.shared);
    if (start) start.disabled = !f.quote.ok;
    if (confirm) confirm.disabled = !panel._fishingPending || !f.quote.ok;
    if (b.type === 'dock') {
      const names = b.workers.map(id => G.world.cmap[id]).filter(c => c && !c.dead).map(c => c.name).join('、');
      const workers = el.querySelector('[data-fishing-workers]'); if (workers && workers.textContent !== (names || '无')) workers.textContent = names || '无';
      const status = el.querySelector('[data-fishing-status]');
      const text = G.productionLimited(b) && G.buildingGoalStatus(b) || (G.workerLimitOf(b) <= 0 ? '用工上限为0，停止接新批次' : !G.jobCanProduce(b) ? '停工：' + (G.fishingWaterSummary(b).reason || b.warnText || '当前无法捕鱼') : b.workers.length ? '运作中' : '等待可用工人');
      if (status && status.textContent !== text) status.textContent = text;
    }
    return true;
  },
  initFishingInfo: function (b) {
    const el = this.el.info, panel = el.querySelector('[data-fishing-panel]'); if (!panel) return;
    const context = { world: G.world, game: G.game, el, panel, type: b.type }; panel._fishingContext = context;
    const start = panel.querySelector('#fishing-start'), confirm = panel.querySelector('#fishing-confirm'), cancel = panel.querySelector('#fishing-cancel');
    if (!start || !confirm || !cancel) { this.refreshFishingInfo(b); return; }
    this.resetFishingConfirmation(panel, '');
    for (const button of [start, confirm, cancel]) button.addEventListener('keydown', e => { if (e.repeat && ['Enter', ' '].includes(e.key)) e.preventDefault(); });
    start.addEventListener('click', e => {
      if (e.detail > 1 || !this.fishingControlValid(b, context, start)) { this.resetFishingConfirmation(panel); return; }
      this.refreshFishingInfo(b); const quote = G.fishingPolicyQuote();
      if (!quote.ok) return;
      panel._fishingPending = { key: quote.key };
      panel.querySelector('[data-fishing-confirm]').classList.remove('hidden'); start.setAttribute('aria-expanded', 'true'); confirm.disabled = false;
      panel.querySelector('[data-fishing-message]').textContent = '尚未更改规则。请核对全镇各渔屋的下一批预估。';
      if (confirm.focus) confirm.focus();
    });
    cancel.addEventListener('click', () => {
      if (!this.fishingControlValid(b, context, cancel)) { this.resetFishingConfirmation(panel); return; }
      this.resetFishingConfirmation(panel, '已取消，全镇仍使用经典规则，库存和任务不变。'); if (start.focus) start.focus();
    });
    confirm.addEventListener('click', e => {
      if (e.detail > 1 || !this.fishingControlValid(b, context, confirm) || !panel._fishingPending) { this.resetFishingConfirmation(panel); return; }
      const pending = panel._fishingPending; this.refreshFishingInfo(b);
      if (!panel._fishingPending || pending.key !== G.fishingPolicyQuote().key) return;
      this.resetFishingConfirmation(panel);
      const ok = G.enableSharedFishing(pending.key, context.game);
      this.refreshFishingInfo(b);
      this.resetFishingConfirmation(panel, ok ? '已为全镇开启共享可用水域，仅影响之后新接的捕鱼批次；当前任务和携货数量不变。' : '条件已变化，未更改规则，请重新核对。');
      const focus = ok ? el.querySelector('#info-close') : start; if (focus?.focus) focus.focus();
    });
    this.refreshFishingInfo(b);
  },
  fireRulesInfoData: function (b) {
    if (b.type !== 'townhall' || b.state !== 'ok' || !G.fireRulesSummary || !G.fireToggleQuote) return null;
    const s = G.fireRulesSummary(), quote = G.fireToggleQuote(!s.enabled);
    const grace = s.startedDay == null ? `首次开启后有 ${G.FIRE?.graceDays || 48} 天宽限。`
      : Number.isFinite(s.graceUntil) && s.graceUntil > G.game.day ? `宽限至第 ${s.graceUntil} 天；重新开关不会重置。` : '首次宽限已结束；重新开关不会重置。';
    return { quote, title: '可选住宅火灾（本作适配）', start: s.enabled ? '查看关闭火灾确认' : '查看开启火灾确认',
      confirm: s.enabled ? '确认关闭新增火灾' : '确认开启住宅火灾',
      confirmation: s.enabled ? `关闭后只阻止新起火和新蔓延，当前 ${s.activeCount} 座住宅仍会继续燃烧、受损和接受救援，可能烧毁；不会撤销已有损失。`
        : `确认开启后，完工木屋和石屋可能低概率起火。${grace}住户撤离后仍需住房、食物与柴火，失去住房可能导致饥饿和受冻。`,
      data: {
        state: `全镇住宅火灾：${s.enabled ? '已开启' : '默认关闭 / 当前关闭'} · 活动住宅 ${s.activeCount} 座 · 焦土废墟 ${s.ruins} 处。${grace}`,
        rescue: `正在救火 ${s.rescuers} 人 / 最多 2 人 · 可用空闲救援者 ${s.availableRescuers} 人。${s.availableRescuers === 0 ? '没有空闲救援者，可降低其他建筑用工上限，等收尾后释放空闲成人；不会自动抽走在岗者。' : ''}${s.reason || ''}`,
        staffing: '仅健康、18岁以上、无岗位、无当前或暂停任务且不携货的空闲成人可救援；不会自动抽走教师、医师或生产工人。需要时请到其他建筑详情降低用工上限，待收尾后释放空闲成人。',
        water: '救援者必须真实往返可达水井或河岸取水，再到住宅灭火；水井无需岗位，不提供全镇水库存，距离与通路影响救援。',
        risk: `仅完工木屋/石屋受灾，先有 ${G.FIRE?.warningHours || 12} 小时烟雾预警，再有 ${G.FIRE?.burnHours || 36} 小时火势窗口，每起事故最多波及 ${G.FIRE?.maxHomes || 3} 座附近住宅。警报后家庭寻找空屋或宿舍；不直接烧死居民，但原有饥饿、受冻风险仍存在。`,
        recovery: '灭火后原屋按正常住房规则分配，不驱逐临时住处的新住户，也不强制原家庭搬回。烧毁后可付完整新建材料重建；清理废墟不返材料。',
      } };
  },
  fireRebuildInfoData: function (b) {
    const s = G.houseFireSummary && G.houseFireSummary(b);
    if (!s || !s.ruin || !G.fireRebuildQuote) return null;
    const quote = G.fireRebuildQuote(b), name = G.BDEF[quote.origin || s.origin]?.name || '原住宅';
    return { quote, title: '原址重建住宅', start: '查看重建确认', confirm: '确认创建重建工地',
      confirmation: `确认后原址创建${name}工地；新建材不预扣或预留，工人到仓领取并实运备齐后施工。完工前不能入住，不立即恢复住房。`,
      data: {
        origin: `原住宅：${name}。烧毁材料已损失，无旧料回收或抵扣；清理废墟退还 0 材料。`,
        cost: `完整新建材料：${this.resourceCost(quote.cost || {}, false)}。`,
        housing: `全镇无房家庭 ${Number(quote.homelessFamilies) || 0} 户。${quote.winter ? '⚠ 当前正值寒冬。' : ''}施工期间仍需可达空屋或宿舍、食物和柴火；冬季可能受冻，重建不预留床位。`,
        reason: quote.ok ? '当前材料与施工条件满足，可以确认创建工地；仍须领料、运到场和实际施工。' : `暂不能重建：${quote.reason || '请检查材料和可达建筑工人。'}`,
      } };
  },
  fireActionMarkup: function (kind, facts) {
    if (!facts) return '';
    const row = key => `<p class="row desc" data-${kind}="${key}">${this.escHtml(facts.data[key])}</p>`;
    const rows = kind === 'fire-rules' ? ['state', 'rescue'].map(row).join('') + `<details><summary>火灾范围、救援与安置规则</summary>${['staffing', 'water', 'risk', 'recovery'].map(row).join('')}</details>` : Object.keys(facts.data).map(row).join('');
    return `<section class="economy-form" data-${kind}-panel aria-labelledby="${kind}-title">
      <h3 id="${kind}-title">${this.escHtml(facts.title)}</h3>
      ${rows}
      <button type="button" id="${kind}-start" aria-expanded="false">${this.escHtml(facts.start)}</button>
      <div class="hidden" data-${kind}-confirm>
        <p data-${kind}-quote>${this.escHtml(facts.confirmation)}</p>
        <div class="economy-actions"><button type="button" id="${kind}-confirm" class="danger" disabled>${this.escHtml(facts.confirm)}</button><button type="button" id="${kind}-cancel">取消，保持现状</button></div>
      </div><p data-${kind}-message role="status" aria-live="polite"></p>
    </section>`;
  },
  fireActionValid: function (b, context, node, allowModal) {
    if (!context) return false;
    const { world, game, el, panel, type, state, kind } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel?.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.type === type && b.state === state &&
      el.querySelector(`[data-${kind}-panel]`) === panel && (!node || (!node.disabled && panel.querySelector('#' + node.id) === node)) &&
      (allowModal || !(G.hasOpenModal && G.hasOpenModal()));
  },
  resetFireAction: function (panel, message, restoreFocus) {
    const kind = panel._fireContext?.kind;
    if (!kind) return;
    const box = panel.querySelector(`[data-${kind}-confirm]`), start = panel.querySelector(`#${kind}-start`), confirm = panel.querySelector(`#${kind}-confirm`);
    panel._firePending = null;
    if (box) box.classList.add('hidden');
    if (start) start.setAttribute('aria-expanded', 'false');
    if (confirm) confirm.disabled = true;
    const status = panel.querySelector(`[data-${kind}-message]`);
    if (message !== undefined && status) status.textContent = message;
    if (restoreFocus && box?.contains(document.activeElement) && start?.focus) start.focus();
  },
  refreshFireAction: function (b, kind, facts) {
    const panel = this.el.info.querySelector?.(`[data-${kind}-panel]`);
    if (!panel || !panel._fireContext) return false;
    if (!this.fireActionValid(b, panel._fireContext, null, true)) { this.resetFireAction(panel); return false; }
    facts = facts || (kind === 'fire-rules' ? this.fireRulesInfoData(b) : this.fireRebuildInfoData(b));
    if (!facts) { this.resetFireAction(panel); return false; }
    for (const [key, text] of Object.entries(facts.data)) {
      const node = panel.querySelector(`[data-${kind}="${key}"]`);
      if (node && node.textContent !== text) node.textContent = text;
    }
    const start = panel.querySelector(`#${kind}-start`), confirm = panel.querySelector(`#${kind}-confirm`);
    if (!start || !confirm || !panel.querySelector(`[data-${kind}-confirm]`)) { this.resetFireAction(panel); return false; }
    if (start.textContent !== facts.start) start.textContent = facts.start;
    if (confirm.textContent !== facts.confirm) confirm.textContent = facts.confirm;
    const modal = G.hasOpenModal && G.hasOpenModal();
    if (panel._firePending && (modal || panel._firePending.settings !== G.game.fireDisasters || panel._firePending.rulesKey !== JSON.stringify(G.FIRE) || !facts.quote.ok || panel._firePending.key !== facts.quote.key))
      this.resetFireAction(panel, modal ? '确认已取消，请关闭弹窗后重新查看。' : '设置、火情或重建条件已变化，请核对最新信息后重新确认。', !modal);
    start.setAttribute('aria-disabled', String(!facts.quote.ok));
    confirm.disabled = !panel._firePending || !facts.quote.ok;
    return true;
  },
  initFireAction: function (b, kind) {
    const el = this.el.info, panel = el.querySelector(`[data-${kind}-panel]`);
    if (!panel) return;
    const context = { world: G.world, game: G.game, el, panel, type: b.type, state: b.state, kind };
    panel._fireContext = context;
    const start = panel.querySelector(`#${kind}-start`), confirm = panel.querySelector(`#${kind}-confirm`), cancel = panel.querySelector(`#${kind}-cancel`), box = panel.querySelector(`[data-${kind}-confirm]`);
    const factsNow = () => kind === 'fire-rules' ? this.fireRulesInfoData(b) : this.fireRebuildInfoData(b);
    this.resetFireAction(panel, '');
    for (const button of [start, confirm, cancel]) button.addEventListener('keydown', e => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
    start.addEventListener('click', e => {
      if (e.detail > 1 || !this.fireActionValid(b, context, start)) { this.resetFireAction(panel); return; }
      const facts = factsNow();
      this.refreshFireAction(b, kind, facts);
      if (!facts?.quote.ok) { this.resetFireAction(panel, facts?.quote.reason || '当前无法操作，请检查最新条件。'); return; }
      panel._firePending = { key: facts.quote.key, enabled: facts.quote.enabled, settings: G.game.fireDisasters, rulesKey: JSON.stringify(G.FIRE) };
      panel.querySelector(`[data-${kind}-quote]`).textContent = facts.confirmation;
      panel.querySelector(`[data-${kind}-message]`).textContent = '尚未更改设置或扣料，请核对后确认，也可取消。';
      box.classList.remove('hidden'); start.setAttribute('aria-expanded', 'true'); confirm.disabled = false;
      if (confirm.focus) confirm.focus();
    });
    cancel.addEventListener('click', () => {
      if (!this.fireActionValid(b, context, cancel)) { this.resetFireAction(panel); return; }
      this.resetFireAction(panel, '已取消，设置、建筑和材料保持不变。');
      if (start.focus) start.focus();
    });
    confirm.addEventListener('click', e => {
      if (e.detail > 1 || !this.fireActionValid(b, context, confirm) || !panel._firePending) { this.resetFireAction(panel); return; }
      const pending = panel._firePending, facts = factsNow();
      this.refreshFireAction(b, kind, facts);
      if (!facts?.quote.ok || !panel._firePending || facts.quote.key !== pending.key) return;
      this.resetFireAction(panel);
      const result = kind === 'fire-rules' ? { ok: G.setFireDisasters(pending.enabled, pending.key, context.game) }
        : G.rebuildBurntHome(b, pending.key, context.game);
      if (!result.ok) { this.refreshFireAction(b, kind); this.resetFireAction(panel, result.reason || '条件已变化，未执行，请重新确认。'); if (start.focus) start.focus(); return; }
      if (kind === 'fire-rules') {
        this.refreshFireAction(b, kind);
        this.resetFireAction(panel, pending.enabled ? '已开启住宅火灾。请留意宽限、空闲救援者和可达水源。' : '已关闭新增起火和新蔓延。当前火灾、损伤与救援仍会继续，已有损失不返还。');
        if (start.focus) start.focus();
      } else {
        this.renderInfo(true);
        const close = el.querySelector('#info-close'); if (close?.focus) close.focus();
      }
      this.refreshHUD();
    });
    this.refreshFireAction(b, kind);
  },
  homeFireInfoData: function (b) {
    const s = G.houseFireSummary && G.houseFireSummary(b);
    if (!s || (!s.active && !s.ruin)) return null;
    return { summary: s, data: {
      status: s.status || (s.ruin ? '住宅已烧毁，不能入住' : s.phase === 'warning' ? '烟雾预警，住户撤离中' : '住宅起火，住户撤离中'),
      progress: s.ruin ? '建筑已成为废墟，清理不返还材料。' : `已持续 ${Math.max(0, Number(s.elapsed) || 0).toFixed(1)} 小时 · 烟雾预警 ${Number(s.warningHours) || 12} 小时 · 损伤 ${Math.round(Number(s.damage) || 0)}%。`,
      water: s.ruin ? '救援已结束，需完整材料原址重建或清理废墟。' : `仍需送到 ${Math.max(0, Number(s.waterNeeded) || 0)} 桶水 · 本屋救援者 ${Number(s.rescuers) || 0} 人。${s.reason || ''}`,
      shelter: '报警后家庭寻找可达空屋或宿舍；未安置者仍面临饥饿、受冻风险。灭火后按正常住房规则分配，不驱逐临时住户，也不强制原家庭搬回。',
      staffing: '救援最多使用 2 名健康、18岁以上、无岗无任务且不携货的空闲成人。没有空闲救援者时，请降低其他建筑用工上限并等待收尾；不会自动抽走教师、医师或生产工人。',
    } };
  },
  homeFireInfoMarkup: function (facts) {
    return facts ? `<section class="economy-form" data-home-fire-panel><h3>住宅火情与安置</h3>${Object.entries(facts.data).map(([key, text]) => `<p class="row" data-home-fire="${key}">${this.escHtml(text)}</p>`).join('')}</section>` : '';
  },
  refreshHomeFireInfo: function (b) {
    const facts = this.homeFireInfoData(b), el = this.el.info;
    if (!facts || !el.querySelector('[data-home-fire-panel]')) return false;
    for (const [key, text] of Object.entries(facts.data)) {
      const node = el.querySelector(`[data-home-fire="${key}"]`);
      if (node && node.textContent !== text) node.textContent = text;
    }
    const demolish = el.querySelector('#info-demolish');
    if (demolish) demolish.disabled = !!facts.summary.active;
    this.refreshFireAction(b, 'fire-rebuild');
    return true;
  },
  houseUpgradeInfoData: function (b) {
    if (b.type !== 'house' || b.state !== 'ok' || !G.houseUpgradeQuote || G.houseFireSummary?.(b)?.active) return null;
    const quote = G.houseUpgradeQuote(b);
    const materialData = {};
    for (const kind of ['cost', 'salvage', 'due'])
      for (const resource of ['wood', 'stone', 'iron'])
        materialData[kind + '-' + resource] = String(Number(quote[kind]?.[resource]) || 0);
    return { quote, data: {
      ...materialData,
      displaced: `开始后搬出：${quote.families} 户 / ${quote.people} 人；施工期间不能住在这里。`,
      housing: `全镇其余空屋 ${quote.freeHomes} 户 · 宿舍空位 ${quote.boardingSlots} 户。仅为全镇统计，未核实对住户是否可达，也不会预留床位。`,
      cold: `${quote.winter ? '⚠ 当前正值寒冬。' : '冬季风险：'}搬出后若无可达住处和柴火，住户可能受冻；即使全镇有空位也不能保证入住。`,
      fuel: `本作取暖：有人入住时，每屋每年约 ${quote.oldFuel} → ${quote.newFuel} 柴火（冬季集中消耗，省一半）。`,
      reason: quote.ok ? '当前库存和可达建筑工人满足开始条件，补料运到场后才能施工；其他工地可能先领取库存。' : `暂不能升级：${quote.reason || '请检查建材和可用建筑工人。'}`,
    } };
  },
  houseUpgradeInfoMarkup: function (facts) {
    if (!facts) return '';
    return `<section class="economy-form house-upgrade-details" data-house-upgrade-panel aria-labelledby="house-upgrade-title">
      <h3 id="house-upgrade-title">木屋升级为石屋</h3>
      <table class="house-upgrade-materials">
        <caption>建材对照</caption>
        <thead><tr><th scope="col">材料</th><th scope="col">总需</th><th scope="col">回收</th><th scope="col">还需运入</th></tr></thead>
        <tbody>${['wood', 'stone', 'iron'].map(resource => `<tr><th scope="row">${this.escHtml(G.RES[resource].name)}</th>${['cost', 'salvage', 'due'].map(kind => `<td data-house-upgrade="${kind}-${resource}">${this.escHtml(facts.data[kind + '-' + resource])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="house-upgrade-note">回收留在工地；补料到仓领取才扣，不预留库存。</p>
      <section class="house-upgrade-group" aria-label="搬迁与安置">
        <h4>搬迁与安置</h4>
        <p data-house-upgrade="displaced">${this.escHtml(facts.data.displaced)}</p>
        <p class="house-upgrade-note" data-house-upgrade="housing">${this.escHtml(facts.data.housing)}</p>
      </section>
      <section class="house-upgrade-group" aria-label="开始条件">
        <h4>开始条件</h4>
        <p data-house-upgrade="reason">${this.escHtml(facts.data.reason)}</p>
      </section>
      <div class="house-upgrade-warning">
        <h4>冬季风险</h4>
        <p data-house-upgrade="cold">${this.escHtml(facts.data.cold)}</p>
        <h4>拆除不可逆</h4>
        <p>确认开始后立即拆除原木屋，住户搬出，原屋永久消失。取消升级工地也不会还原木屋。</p>
      </div>
      <details class="house-upgrade-secondary">
        <summary>查看省柴收益与回收说明</summary>
        <p data-house-upgrade="fuel">${this.escHtml(facts.data.fuel)}</p>
        <p>回收量按原屋实际投入计算，直接留在新工地，不额外发放到库存。</p>
      </details>
      <button type="button" id="house-upgrade-start" aria-expanded="false">查看升级确认</button>
      <div class="house-upgrade-confirm hidden" data-house-upgrade-confirm>
        <p>已了解上方最新建材、搬迁和受冻风险？确认后立即拆除木屋并留下回收材料；补料从仓实运到场后，原址施工石屋。</p>
        <div class="economy-actions"><button type="button" id="house-upgrade-confirm" class="danger">确认拆木屋并升级</button><button type="button" id="house-upgrade-cancel">取消，保留木屋</button></div>
      </div>
      <p class="economy-message" data-house-upgrade-message role="status" aria-live="polite"></p>
    </section>`;
  },
  houseUpgradeControlValid: function (b, context, node, allowModal) {
    const { world, game, el, panel } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel && G.sel.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.type === 'house' && b.state === 'ok' && !G.houseFireSummary?.(b)?.active &&
      el.querySelector('[data-house-upgrade-panel]') === panel && (!node || (!node.disabled && panel.querySelector('#' + node.id) === node)) &&
      (allowModal || !(G.hasOpenModal && G.hasOpenModal()));
  },
  resetHouseUpgrade: function (panel, message, restoreFocus) {
    const box = panel.querySelector('[data-house-upgrade-confirm]'), start = panel.querySelector('#house-upgrade-start'), confirm = panel.querySelector('#house-upgrade-confirm'), status = panel.querySelector('[data-house-upgrade-message]');
    panel._upgradePending = null;
    if (box) box.classList.add('hidden');
    if (start) start.setAttribute('aria-expanded', 'false');
    if (confirm) confirm.disabled = true;
    if (message !== undefined && status) status.textContent = message;
    if (restoreFocus && box && box.contains(document.activeElement) && start && start.focus) start.focus();
  },
  refreshHouseUpgradeInfo: function (b, facts) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-house-upgrade-panel]');
    if (!panel || !panel._upgradeContext || !this.houseUpgradeControlValid(b, panel._upgradeContext, null, true)) return false;
    const start = panel.querySelector('#house-upgrade-start'), confirm = panel.querySelector('#house-upgrade-confirm');
    if (!start || !confirm || !panel.querySelector('[data-house-upgrade-confirm]')) return false;
    facts = facts || this.houseUpgradeInfoData(b);
    if (!facts) return false;
    for (const key of Object.keys(facts.data)) {
      const node = panel.querySelector(`[data-house-upgrade="${key}"]`);
      if (node && node.textContent !== facts.data[key]) node.textContent = facts.data[key];
    }
    // Updating facts never silently renews a destructive confirmation.
    if (G.hasOpenModal && G.hasOpenModal()) this.resetHouseUpgrade(panel, '升级确认已取消，请关闭弹窗后重新查看。', false);
    else if (panel._upgradePending !== null && (!facts.quote.ok || panel._upgradePending !== facts.quote.key))
      this.resetHouseUpgrade(panel, '建材、住户或安置条件已变化。上方已更新，请重新查看升级确认。', true);
    start.setAttribute('aria-disabled', String(!facts.quote.ok));
    confirm.disabled = panel._upgradePending === null || !facts.quote.ok;
    return true;
  },
  refreshHomeInfo: function (b, upgradeFacts) {
    const data = this.homeInfoData(b), el = this.el.info;
    if (!data || !el.querySelector || !el.querySelector('[data-home-residents]')) return false;
    for (const key of Object.keys(data)) {
      const node = el.querySelector(`[data-home-${key}]`);
      if (node && node.textContent !== data[key]) node.textContent = data[key];
    }
    this.refreshHouseUpgradeInfo(b, upgradeFacts);
    this.refreshHeatingInfo(b);
    this.refreshHouseholdSupplyInfo(b);
    this.refreshHomeFireInfo(b);
    return true;
  },
  initHouseUpgradeInfo: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-house-upgrade-panel]');
    if (!panel) return;
    const context = { world: G.world, game: G.game, el, panel };
    panel._upgradeContext = context;
    const start = panel.querySelector('#house-upgrade-start'), confirm = panel.querySelector('#house-upgrade-confirm'), cancel = panel.querySelector('#house-upgrade-cancel'), box = panel.querySelector('[data-house-upgrade-confirm]');
    this.resetHouseUpgrade(panel, '');
    for (const button of [start, confirm, cancel]) button.addEventListener('keydown', e => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
    start.addEventListener('click', e => {
      if ((e && e.detail > 1) || !this.houseUpgradeControlValid(b, context, start)) { this.resetHouseUpgrade(panel); return; }
      const facts = this.houseUpgradeInfoData(b);
      this.refreshHomeInfo(b, facts);
      if (!facts.quote.ok) { this.resetHouseUpgrade(panel, facts.data.reason); return; }
      panel._upgradePending = facts.quote.key;
      box.classList.remove('hidden');
      start.setAttribute('aria-expanded', 'true');
      confirm.disabled = false;
      panel.querySelector('[data-house-upgrade-message]').textContent = '尚未拆除或扣料，请确认以上条件，或取消保留木屋。';
      if (confirm.focus) confirm.focus();
    });
    cancel.addEventListener('click', () => {
      if (!this.houseUpgradeControlValid(b, context, cancel)) { this.resetHouseUpgrade(panel); return; }
      this.resetHouseUpgrade(panel, '已取消确认，木屋、住户和建材均未改变。');
      if (start.focus) start.focus();
    });
    confirm.addEventListener('click', e => {
      if ((e && e.detail > 1) || !this.houseUpgradeControlValid(b, context, confirm) || panel._upgradePending === null) { this.resetHouseUpgrade(panel); return; }
      const facts = this.houseUpgradeInfoData(b), expectedKey = panel._upgradePending;
      this.refreshHomeInfo(b, facts);
      if (!facts.quote.ok || facts.quote.key !== expectedKey || panel._upgradePending === null) return;
      this.resetHouseUpgrade(panel);
      const result = G.upgradeHouse(b, expectedKey);
      if (!result.ok) {
        this.refreshHomeInfo(b);
        this.resetHouseUpgrade(panel, result.reason || '条件已改变，未开始升级，请重新查看。', true);
        if (start.focus) start.focus();
        return;
      }
      this.renderInfo(true);
      const close = el.querySelector('#info-close');
      if (close && close.focus) close.focus();
      this.refreshHUD();
    });
    this.refreshHouseUpgradeInfo(b);
  },
  stockpileInfoData: function(b) {
    if(!b||b.type!=='stockpile'||b.state!=='ok')return null;
    return {rules:'只接原木、石头、铁、煤、柴火；不收食物、工具、衣物。无需常驻工人。',
      capacity:'本场为以上每类公共仓容增加 '+G.STOCKPILE_CAP+'；这是公共合计，不是本场独立库存。',
      stocks:G.STOCKPILE_TYPES.map(k=>G.RES[k].name+' '+Math.floor(G.game.res[k])+' / '+G.storageCap(k)).join(' · '),
      removal:'拆除会降低分类仓容，但不删除已有公共资源；超过新容量时暂停入库。在途交货保留并改投可达兼容仓。',
      routing:'按真实可达通行时间选择交货点。粮食、工具等仍需要通用仓库；最后一座通用仓库不可拆。'};
  },
  stockpileInfoMarkup: function(b) {const d=this.stockpileInfoData(b);return Object.keys(d).map(k=>'<div class="row desc" data-stockpile="'+k+'">'+this.escHtml(d[k])+'</div>').join('');},
  refreshStockpileInfo: function(b) {const d=this.stockpileInfoData(b);for(const k of Object.keys(d)){const n=this.el.info.querySelector('[data-stockpile="'+k+'"]');if(n)n.textContent=d[k];}},
  graveRemnantInfoData: function(b) {
    const s=G.graveRemnantSummary(b);if(!s)return null;
    return {status:s.status,name:`墓碑：${s.name}`,identity:`原墓园 ${s.sourceId} · 墓位 ${s.slot+1}`,
      expiry:`安葬日 ${s.deathDay} · 原到期日 ${s.expiresDay} · 剩余 ${s.daysLeft} 天`,
      occupancy:'仅此1格仍被墓位占用，不能新建建筑或道路；仍可步行，原道路不被抹除。自然到期后释放。不可再次安葬、拆除或退款。'};
  },
  graveRemnantInfoMarkup: function(b) {
    const d=this.graveRemnantInfoData(b);return d?`<section data-grave-remnant>${Object.keys(d).map(k=>`<div class="row desc" data-grave="${k}">${this.escHtml(d[k])}</div>`).join('')}</section>`:'';
  },
  refreshGraveRemnantInfo: function(b) {
    const d=this.graveRemnantInfoData(b);if(!d)return;
    for(const k of Object.keys(d)){const n=this.el.info.querySelector(`[data-grave="${k}"]`);if(n&&n.textContent!==d[k])n.textContent=d[k];}
  },
  cemeteryInfoData: function(b) {
    const s=G.cemeterySummary(b);if(!s)return null;
    return {status:s.status,capacity:`墓位：${s.used} / ${s.capacity} · 空余 ${s.free}`,expiry:s.nextDays===null?'暂无墓位占用':`最早约 ${s.nextDays} 天后释放墓位`,
      records:s.graves.length?s.graves.map(r=>`${r.name}（余 ${r.daysLeft} 天）`).join('、'):'墓位空置，建成不会追溯减免此前的哀伤',
      layout:`占地 ${b.w}×${b.h} · ${b.cemeterySize?'按实际槽位规划':'旧园保留8墓位与原成本'}；墓期192日为本作适配`,
      removal:'拆围栏前先预览并确认：已有墓碑保留原到期日，所占格不可建造/铺路，仍可步行；其余土地释放。不能拆建刷新容量。'};
  },
  cemeteryInfoMarkup: function(data) {
    return `<section class="cemetery-info">${Object.keys(data).filter(k=>k!=='status').map(k=>`<div class="row desc" data-cemetery="${k}">${this.escHtml(data[k])}</div>`).join('')}</section>`;
  },
  refreshCemeteryInfo: function(b) {
    const data=this.cemeteryInfoData(b);if(!data||!this.el.info.querySelector)return;
    for(const k of Object.keys(data)){const node=this.el.info.querySelector(`[data-cemetery="${k}"]`);if(node&&node.textContent!==data[k])node.textContent=data[k];}
    this.refreshCemeteryRemoval(b);
  },
  townLedgerInfoData: function () {
    // A summary is a read-only view. Never initialize/backfill a ledger from UI
    // reads or reuse facts cached for another loaded game with the same hall ID.
    const s = G.townLedgerSummary ? G.townLedgerSummary() : null;
    const windowDays = s ? s.windowDays : 12, retentionDays = s ? s.retentionDays : 48;
    const number = (value, signed = false) => {
      if (!Number.isFinite(value)) return '—';
      if (value === 0) return '0';
      const magnitude = Math.abs(value), prefix = value < 0 ? '−' : signed ? '+' : '';
      return prefix + (magnitude < .01 ? '<0.01' : String(Number(magnitude.toFixed(2))));
    };
    const hour = value => {
      const minute = Math.floor(value * 60 + 1e-7);
      return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    };
    const seasonDate = day => `${Math.floor(day / G.YEAR_DAYS) + 1}年${G.SEASON_NAMES[Math.floor(day / G.SEASON_DAYS) % 4]}${day % G.SEASON_DAYS + 1}日`;
    const range = period => !period || !period.days ? '尚无完整日记录（不是零产出）'
      : `第 ${period.fromDay + 1}–${period.toDay + 1} 天（${seasonDate(period.fromDay)} → ${seasonDate(period.toDay)}），${period.days} 个完整日${period.days < windowDays ? `，未满 ${windowDays} 天` : ''}`;
    const current = s && s.current;
    const comparable = !!(s && s.comparable && s.recent.days === windowDays && s.previous.days === windowDays);
    const data = {
      flowTitle: `食物与柴火流水 · ${s ? s.completeDays : 0} 个完整日`,
      flowCoverage: s ? `自第 ${s.startedDay + 1} 天 ${hour(s.startedHour)} 起记账；更早流水未知。已结算 ${s.recordedDays} 天，其中 ${s.completeDays} 个完整日；最多保留 ${retentionDays} 个已结算日。${s.startedHour > 0 ? '首日不足全天，不纳入完整日比较。' : ''}`
        : '流水尚未开始记录；旧库存快照不能还原产出。',
      flowRecentRange: `近期：${range(s && s.recent)}`,
      flowPreviousRange: `前期：${range(s && s.previous)}`,
      flowComparison: comparable ? `差额 = 近期 − 前期（各 ${windowDays} 天）；仅作算术比较，季节不同会影响产出与取暖。`
        : `比较待记录：需两个各 ${windowDays} 天的完整窗口；— 表示未知或不可比较，0 表示已记录的零。`,
      flowTodayRange: current ? `今日 · 第 ${current.day + 1} 天（${seasonDate(current.day)}） ${hour(current.fromHour)}–${hour(current.toHour)}` : '今日 · 尚无流水记录',
      flowTodayCoverage: current ? `${current.partial ? '从本日记账起点开始，首日不足全天。' : ''}今日尚未结算，未折算全天，也不纳入上方比较。` : '尚未记录的时段不能视为零产出。',
    };
    const valueOf = (totals, metric) => !totals ? NaN : metric === 'used' ? totals.used + (totals.distributedUsed || 0) : metric === 'publicUsed' ? totals.used : metric === 'distributedLost' ? totals.distributedLost || 0 : totals[metric];
    for (const resource of ['food', 'firewood', ...G.FOOD_KEYS]) {
      for (const metric of ['produced', 'received', 'used', 'publicUsed', 'distributedLost', 'withdrawn', 'discarded', 'delta', 'opening', 'closing']) {
        for (const period of ['recent', 'previous', 'current']) {
          const p = s && s[period], known = p && (period === 'current' || p.days > 0);
          data[`flow-${resource}-${period}-${metric}`] = number(known ? valueOf(p.totals[resource], metric) : NaN, metric === 'delta');
        }
        data[`flow-${resource}-difference-${metric}`] = number(comparable ? valueOf(s.recent.totals[resource], metric) - valueOf(s.previous.totals[resource], metric) : NaN, true);
      }
    }
    return data;
  },
  townLedgerInfoMarkup: function (data) {
    const text = key => `<span data-townhall="${key}">${this.escHtml(data[key])}</span>`;
    const metrics = resource => [['produced', '真实产出'], ['received', '实际入库'], ['used', resource === 'firewood' ? '住宅燃烧（实际合计）' : '居民食用（实际合计）'], ['publicUsed', '其中：公共直接消耗'], ['distributedLost', '实物火灾损失'], ['withdrawn', '出库转运'], ['discarded', '仓满弃货'], ['delta', '库存净变']];
    const history = resource => `<div class="townledger-table-wrap" tabindex="0" role="region" aria-label="${G.RES[resource].name}历史流水表，可横向滚动"><table class="townledger-table">
      <caption>${G.RES[resource].name}${resource === 'food' ? '合计（食物物品相加）' : ''}</caption>
      <thead><tr><th scope="col">项目</th><th scope="col">近期</th><th scope="col">前期</th><th scope="col">差额</th></tr></thead>
      <tbody>${metrics(resource).map(([metric, label]) => `<tr><th scope="row">${label}</th>${['recent', 'previous', 'difference'].map(period => `<td>${text(`flow-${resource}-${period}-${metric}`)}</td>`).join('')}</tr>`).join('')}
        <tr class="townledger-stock"><th scope="row">期初库存</th><td>${text(`flow-${resource}-recent-opening`)}</td><td>${text(`flow-${resource}-previous-opening`)}</td><td>—</td></tr>
        <tr class="townledger-stock"><th scope="row">期末库存</th><td>${text(`flow-${resource}-recent-closing`)}</td><td>${text(`flow-${resource}-previous-closing`)}</td><td>—</td></tr>
      </tbody></table></div>`;
    const today = resources => `<div class="townledger-table-wrap" tabindex="0" role="region" aria-label="今日已记录流水表，可横向滚动"><table class="townledger-table">
      <thead><tr><th scope="col">今日已记录</th>${resources.map(resource => `<th scope="col">${G.RES[resource].name}</th>`).join('')}</tr></thead>
      <tbody>${[['produced', '真实产出'], ['received', '实际入库'], ['used', resources.includes('firewood') ? '居民食用 / 住宅燃烧（实际合计）' : '居民食用（实际合计）'], ['publicUsed', '其中：公共直接消耗'], ['distributedLost', '实物火灾损失'], ['withdrawn', '出库转运'], ['discarded', '仓满弃货'], ['delta', '库存净变'], ['opening', '起点库存'], ['closing', '当前库存']].map(([metric, label]) => `<tr><th scope="row">${label}</th>${resources.map(resource => `<td>${text(`flow-${resource}-current-${metric}`)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    return `<details class="townhall-ledger townledger-flows" data-townledger-panel>
      <summary data-townhall="flowTitle">${this.escHtml(data.flowTitle)}</summary>
      <p class="desc" data-townhall="flowCoverage">${this.escHtml(data.flowCoverage)}</p>
      <p data-townhall="flowRecentRange">${this.escHtml(data.flowRecentRange)}</p>
      <p data-townhall="flowPreviousRange">${this.escHtml(data.flowPreviousRange)}</p>
      <p class="townledger-note" data-townhall="flowComparison">${this.escHtml(data.flowComparison)}</p>
      ${history('food')}${history('firewood')}
      <section class="townledger-today" aria-label="今日部分时段流水">
        <h3 data-townhall="flowTodayRange">${this.escHtml(data.flowTodayRange)}</h3>
        <p class="townledger-note" data-townhall="flowTodayCoverage">${this.escHtml(data.flowTodayCoverage)}</p>
        ${today(['food', 'firewood'])}
      </section>
      <details data-townledger-food><summary>展开食物物品明细</summary>
        <p class="townledger-note">近期、前期和差额使用上方相同日期；食物合计为肉类、鸡蛋、蔬菜、主食、苹果、梨六种物品之和；鸡蛋与肉类同组，苹果和梨归蔬菜组，仍为三组营养。</p>
        ${G.FOOD_KEYS.map(history).join('')}${today(G.FOOD_KEYS)}
      </details>
      <details data-townledger-help><summary>这些数字怎样记账？</summary>
        <p>真实产出只计实际制成或收获；实际入库只计仓库接收，包含贸易运回与酿酒退料，并非全是本地生产。</p>
        <p>居民食用、住宅燃烧为公共直接消耗 + 各家实际消耗，只计实际吃掉或烧掉，未满足的需求不计入；配送转移不算食用。实物火灾损失另列，未烧毁的封存物资不算损失；本账本不包含煤耗。</p>
        <p>出库转运指贸易、酿酒取料或生活物资实际离开公共库存；转入市场、住房与携货不算生产，不等于已卖出或永久消耗。仓满弃货只计因仓满未保留的弃货，等待空位的保留货物不算损失。</p>
        <p>公共库存净变 = 实际入库 − 公共直接消耗 − 出库转运 = 期末公共库存 − 期初公共库存。各家已配送物资的消耗和实物火灾损失不再重复扣公共库存。真实产出与仓满弃货不加入这个库存等式。</p>
        <p>产出减入库不等于携带中的货物。数值为游戏物资单位，最多显示两位小数，非零微量显示 &lt;0.01；差额先按原始数值相减再显示。窗口为本作的 12 天，留存为 48 天。</p>
      </details>
    </details>`;
  },
  townChallengeInfoData:function(){
    const f=G.townChallengeFacts(),done=G.game.challenges?.completed||{};
    const status=key=>done[key]!==undefined?`已确认：第 ${done[key]} 天`:(f[key].ready?'当前已满足，待下次日界确认':'进行中');
    return {challengeSettlement:`安居村庄 · ${status('settlement')}：已入村 ${f.settlement.population}/30 人；有完工住房 ${f.settlement.homed}/${f.settlement.population} 人，还缺 ${f.settlement.population-f.settlement.homed} 人住处。`,
      challengeFood:!f.food.available?'一季多元生产：缺少流水统计，暂不能确认；不把未知产出当作零。':`一季多元生产 · ${status('food')}：最近完整记录 ${f.food.days}/12 日${f.food.days?`（第 ${f.food.fromDay}–${f.food.toDay} 天）`:''}；实际产出食物 ${f.food.produced.toFixed(1)} / 居民食用 ${f.food.used.toFixed(1)}；有实际产出的营养组 ${f.food.groups}/3（肉类含鸡蛋，蔬菜含苹果和梨）。${!f.food.contiguous?'需紧接今天的连续12个完整日。':''}`,
      challengeEducation:`教育传承 · ${status('education')}：受教育成人 ${f.education.educated}/3 人；已有课时且所属学堂完工的学生 ${f.education.students}/1 人。`};
  },
  townHallInfoData: function (b) {
    if (b.type !== 'townhall' || b.state !== 'ok' || !G.townHallSummary) return null;
    const s = G.townHallSummary(b), g = G.game, heat = this.heatDemand(), physical = G.supplyEnabled && G.supplyEnabled();
    const days = n => Number.isFinite(n) ? `${Math.max(0, n).toFixed(1)} 天` : n === Infinity ? '暂无消耗' : '暂无记录';
    const rows = (g.hist || []).filter(row => Number.isFinite(row.d) && row.d <= g.day && row.d > g.day - 60).slice(-60);
    const born = rows.reduce((n, row) => n + (Number(row.born) || 0), 0);
    const died = rows.reduce((n, row) => n + (Number(row.died) || 0), 0);
    const data = {
      status: '市政厅开放 · 无需安排工人',
      population: `人口 ${s.population} · 成人 ${s.adults} · 儿童/学生 ${s.children}`,
      housing: `无房家庭 ${s.homelessFamilies} 户 · 空屋 ${s.freeHomes} 户 · 宿舍空位 ${s.boardingSlots} 户`,
      education: `已受教育 ${s.educated} 人 / 全镇 ${s.population} 人`,
      health: `平均健康 ${Number(s.averageHealth || 0).toFixed(1)} / 5 · 患病 ${s.sick} 人`,
      medical: `已任职健康医师 ${s.doctors} · 草药 ${Math.floor(s.herbs || 0)}；治疗仍需医师到岗、可达通路及接诊名额。`,
      food: physical ? `公共食物 ${Math.floor(g.res.food)}；全村食物 ${this.supplyNumber(G.supplyFood(G.supplyInventory().available))}（含在途和待回收，不含火情封存）。各家能吃几天请看家庭现货。` : `食物 ${Math.floor(g.res.food)} · 现有人口约够 ${days(s.foodDays)}（不计新产出）`,
      fuel: `${physical ? '公共' : ''}柴火 ${Math.floor(g.res.firewood)} · ${this.heatDemandText(heat)}${physical ? '；住房只烧本地现货。' : ''}`,
      tools: G.personalToolsEnabled()?`公共备用工具 ${this.supplyNumber(G.toolStock())} 把（含旧半用）；已装备 ${G.world.citizens.filter(c=>!c.dead&&G.toolEquipped(c)).length} 人；个人无工具才半速，详细领取/旧磨损规则见下方。`:`工具 ${Math.floor(G.toolStock())} 件 · 当前成人约可用 ${days(G.toolDaysLeft(s.adults))}（不计新产出）`,
      arriving: `迁入途中 ${s.arriving} 人；从地图边界步行到市政厅报到后再参加工作。`,
      schedule: s.offer ? `本批申请至第 ${s.offer.expiresDay} 天；等待你的接纳或婉拒。`
        : s.arriving ? '已接纳的家庭正在赶来。'
        : Number.isFinite(s.nextDay) ? `暂无本厅申请，最早再访第 ${s.nextDay} 天；只在春夏来访。` : '暂无迁入申请。',
      decisions: `已接纳 ${s.accepted} 人 · 主动婉拒 ${s.declined} 人（逾期离开不计）`,
      historyTitle: `最近 60 天人口与库存 · 已记录 ${rows.length} 天`,
      historySummary: rows.length ? `第 ${rows[0].d}–${rows[rows.length - 1].d} 天：出生 ${born} · 死亡 ${died}；人口 ${rows[0].pop} → ${rows[rows.length - 1].pop}` : '尚无每日记录；结束第一天后开始记账。',
      historyRows: rows.map(row => `第 ${row.d} 天 · 人口 ${Number(row.pop) || 0} · 出生 ${Number(row.born) || 0} · 死亡 ${Number(row.died) || 0} · ${[['food','粮'],['firewood','柴'],['wood','木'],['stone','石'],['iron','铁']].map(([key,label]) => label + (Number.isFinite(row[key]) ? row[key] : '—')).join(' / ')}`).join('\n'),
    };
    Object.assign(data, this.townLedgerInfoData(), this.townChallengeInfoData());
    const offer = s.offer;
    if (offer) {
      const needed = s.offerFamilies + s.homelessFamilies, free = s.freeHomes + s.boardingSlots;
      data.offerPeople = `申请迁入 ${s.offerPeople} 人 / ${s.offerFamilies} 户：成人 ${s.offerAdults} · 儿童 ${s.offerChildren}；全部未受教育。`;
      data.offerFamilies = offer.families.map((f, i) => `家庭 ${i + 1}：父亲 ${f.fatherAge} 岁、母亲 ${f.motherAge} 岁${f.childAges.length ? '；孩子 ' + f.childAges.map(age => `${age} 岁`).join('、') : '；无随行儿童'}`).join('\n');
      data.offerHousing = `住房：新来 ${s.offerFamilies} 户 + 现有无房 ${s.homelessFamilies} 户，共需 ${needed} 个家庭名额；空屋 ${s.freeHomes} + 宿舍空位 ${s.boardingSlots} = ${free}。${free < needed ? `还缺 ${needed - free} 户住处，可能露宿。` : '名额足够，入住仍需可达。'}`;
      data.offerFood = `${physical ? '公共食物参考（不含已配送物资，不能保证逐户到货）：' : '食物：'}新增约 ${Number(s.addedFoodPerDay).toFixed(1)} / 天；库存覆盖由 ${days(s.foodDays)} → ${days(s.foodDaysAfter)}，未计新增生产。`;
      data.offerFuel = `取暖：若每户新家庭住木屋，整冬估计新增 ${Math.ceil(s.addedFuelPerWinter)} 柴火；现有柴火 ${Math.floor(g.res.firewood)}。石屋、宿舍与实际入住情况会改变需求。`;
      data.offerMedical = `医疗：已任职健康医师 ${s.doctors} 人 · 草药 ${Math.floor(s.herbs || 0)}。${s.doctors ? '治疗仍需医师到岗、可达诊所及接诊名额。' : '目前没有医师，可自然康复，也可另配医师治疗。'}${offer.sickCount ? ` 本批有 ${offer.sickCount} 人患季节热病：会拖慢劳动，有近距传播风险，本批疾病不会直接致死。` : ' 本批未发现热病。'}`;
    }
    return { summary: s, data };
  },
  townHallInfoMarkup: function (b, facts) {
    const data = facts.data;
    return `<section class="townhall-details" data-townhall-panel>
      <details class="building-help"><summary>全镇人口与生活概况</summary>${['population', 'housing', 'education', 'health', 'medical', 'food', 'fuel', 'tools', 'arriving', 'schedule', 'decisions'].map(key => `<p class="row" data-townhall="${key}">${this.escHtml(data[key])}</p>`).join('')}</details>
      <details class="building-task"><summary>生活物资与配送规则</summary>${this.villageSupplyInfoMarkup()}${this.supplyModeInfoMarkup(b)}</details>
      <details class="building-task"><summary>住宅火灾规则</summary>${this.fireActionMarkup('fire-rules', this.fireRulesInfoData(b))}</details>
      <details class="building-task"><summary>全镇捕鱼规则</summary>${this.fishingInfoMarkup(b)}</details>
      <div data-townhall-offer></div>
      <p class="economy-message" data-townhall-message role="status" aria-live="polite"></p>
      <details class="townhall-ledger" data-town-challenges><summary>发展挑战（本作适配）</summary>
        ${['challengeSettlement','challengeFood','challengeEducation'].map(key=>`<p class="row" data-townhall="${key}">${this.escHtml(data[key])}</p>`).join('')}
        <p class="desc">30名已入村居民都有完工住房；或连续12完整日肉类（含鸡蛋）/蔬菜（含苹果和梨）/主食三组各有实际产出、合计不少于实际食用且有人食用；或3名受教成人与1名已有课时学生。三项独立，无资源奖励或效率加成，不是原版成就的精确条件。</p>
        <p class="desc">日界首次观察满足后永久记录本次确认日；旧档不追溯历史完成日。产出可仍在搬运，贸易运回不算自产，统计不保证库存足够、均衡饮食或下一季继续自给。</p>
      </details>
      ${this.townLedgerInfoMarkup(data)}
      <details class="townhall-ledger"><summary data-townhall="historyTitle">${this.escHtml(data.historyTitle)}</summary>
        <p data-townhall="historySummary">${this.escHtml(data.historySummary)}</p>
        <div class="townhall-ledger-rows" data-townhall="historyRows">${this.escHtml(data.historyRows)}</div>
        <p class="desc">仅保留实际记录的最近 60 天。库存为日终快照，不是产出或消耗；出生、死亡与迁入分别计数，人口变化不等于出生减死亡。</p>
      </details>
    </section>`;
  },
  refreshTownHallInfo: function (b) {
    const el = this.el.info;
    if (!el.querySelector || !el.querySelector('[data-townhall-panel]')) return false;
    const facts = this.townHallInfoData(b);
    if (!facts) return false;
    const { data, summary: s } = facts;
    for (const key of Object.keys(data)) {
      const node = el.querySelector(`[data-townhall="${key}"]`);
      if (node && node.textContent !== data[key]) node.textContent = data[key];
    }
    this.refreshFireAction(b, 'fire-rules');
    this.refreshFishingInfo(b);
    this.refreshSupplyModeInfo(b);
    this.refreshVillageSupplyInfo();
    const holder = el.querySelector('[data-townhall-offer]'), offerId = s.offer ? s.offer.id : null;
    // Leave active controls intact on timed refreshes. Only a genuinely different
    // offer gets new controls, whose handlers capture that offer's immutable ID.
    if (holder._offerId !== offerId) {
      const hadFocus = holder.contains && holder.contains(document.activeElement);
      holder._offerId = offerId;
      holder.innerHTML = s.offer ? `<section class="townhall-offer economy-form" aria-labelledby="townhall-offer-title">
        <h3 id="townhall-offer-title">迁入申请 · 接纳前请核对</h3>
        ${['offerPeople', 'offerFamilies', 'offerHousing', 'offerFood', 'offerFuel', 'offerMedical'].map(key => `<p id="townhall-${key}" data-townhall="${key}">${this.escHtml(data[key])}</p>`).join('')}
        <p id="townhall-choice-note" class="townhall-choice-note">接纳会立即增加食物需求。即使住房、食物或医疗不足，也可自行决定接纳；婉拒不会增加人口。</p>
        <div class="economy-actions"><button type="button" id="townhall-accept" aria-describedby="townhall-offerPeople townhall-offerHousing townhall-offerFood townhall-offerFuel townhall-offerMedical townhall-choice-note">知悉风险，接纳</button><button type="button" id="townhall-decline">婉拒本批</button></div>
      </section>` : '';
      const message = el.querySelector('[data-townhall-message]');
      if (message) message.textContent = '';
      if (hadFocus) { const close = el.querySelector('#info-close'); if (close && close.focus) close.focus(); }
      if (s.offer) this.initTownHallOffer(b, holder, offerId);
    }
    return true;
  },
  initTownHallOffer: function (b, holder, offerId) {
    const w = G.world, g = G.game, el = this.el.info;
    let resolved = false;
    for (const [id, accept] of [['townhall-accept', true], ['townhall-decline', false]]) {
      const button = el.querySelector('#' + id);
      if (!button) continue;
      button.addEventListener('click', () => {
        if (resolved || G.world !== w || G.game !== g || this.el.info !== el || !G.sel || G.sel.kind !== 'b' || G.sel.id !== b.id ||
            w.bmap[b.id] !== b || b.state !== 'ok' || el.querySelector('[data-townhall-offer]') !== holder ||
            el.querySelector('#' + id) !== button || holder._offerId !== offerId || (G.hasOpenModal && G.hasOpenModal())) return;
        const current = G.townHallSummary(b).offer;
        if (!current || current.id !== offerId) { this.refreshTownHallInfo(b); return; }
        const result = G.decideNomads(b, offerId, accept);
        if (result.ok) resolved = true;
        this.refreshTownHallInfo(b);
        const message = el.querySelector('[data-townhall-message]');
        if (message) message.textContent = result.ok ? accept ? `已接纳 ${result.count || 0} 人，正在从地图边界赶来。` : '已婉拒本批申请。' : result.reason || '申请已变化，请查看最新情况后再决定。';
      });
    }
  },
  brewInputName: function (task) {
    // An accepted task owns its recipe. Never relabel it from the next-batch selector.
    const key = typeof task?.recipe === 'string' ? task.recipe : task?.recipe?.key;
    const type = task?.inputType || task?.recipe?.inputType || G.BREW_RECIPES?.[key]?.inputType || 'grain';
    return G.RES[type]?.name || '原料';
  },
  tavernBatchText: function (b, summary) {
    const rows = (summary.batches || []).map(batch => {
      const c = G.world.cmap[batch.citizenId], cargo = c?.carry;
      const input = G.RES[batch.inputType]?.name || '原料';
      if (batch.phase === 'deliver') return `${batch.name}：已酿麦酒 ${this.supplyNumber(cargo?.qty ?? batch.outputQty)}，${c && G.cargoWaitReason(c) || '送仓途中'}，尚不可使用`;
      if (cargo?.brewIngredient) return `${batch.name}：${G.RES[cargo.type].name} ${this.supplyNumber(cargo.qty)} 已出库，${c.state === 'haul' || batch.phase === 'return' ? '中断后退回仓库' : c.pausedTask?.kind === 'brew' ? '夜间暂停，次日续做' : c.state === 'work' ? '正在酿造' : '携料送往酒馆'}${batch.phase === 'return' ? '；尚未消耗' : `；本批仍产 ${batch.outputQty} 麦酒，不再重复扣料`}`;
      return `${batch.name}：已接${input}批次，需 ${batch.inputQty} ${input} → ${batch.outputQty} 麦酒；前往仓库取料，尚未出库`;
    });
    const known = new Set((summary.batches || []).map(batch => batch.citizenId));
    for (const c of G.world.citizens) {
      if (c.dead || known.has(c.id) || !c.carry || !(c.carry.tavernId === b.id || c.job === b.id)) continue;
      if (c.carry.brewIngredient) rows.push(`${c.name}：未酿${G.RES[c.carry.type].name} ${this.supplyNumber(c.carry.qty)}，中断后退回仓库`);
      else if (c.carry.type === 'ale') rows.push(`${c.name}：已酿麦酒 ${this.supplyNumber(c.carry.qty)}，${G.cargoWaitReason(c) || '送仓途中'}，尚不可使用`);
    }
    return rows.join('；') || '暂无已接取料或携料批次';
  },
  tavernInfoData: function (b) {
    if (b.type !== 'tavern' || b.state !== 'ok' || !G.tavernSummary) return null;
    const s = G.tavernSummary(b), g = G.game, recipe = G.BREW_RECIPES[G.tavernRecipeOf(b)];
    const input = G.RES[recipe.inputType].name;
    const names = b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、');
    const service = !s.onDuty ? '服务暂停：需健康酿酒工实际到岗' : s.ale < 1 ? '服务等待：需麦酒入库'
      : s.visitors >= s.capacity ? '休闲名额已满（含在途预约）' : '可接待：居民仍需步行到馆';
    const data = {
      status: `酿造：${s.canBrew ? '可接新批次' : s.reason || '暂不能接新批次'}`,
      workers: names || '无',
      service,
      visitors: `休闲名额：${s.visitors} / ${s.capacity}（含在途预约） · 全镇 18 岁以上 ${s.eligibleAdults} 人`,
      recipe: `已应用下一批：${recipe.inputQty} ${input} → ${recipe.outputQty} 麦酒（受教育 ${recipe.educatedOutputQty}）；基础劳动 ${s.workHours} 小时`,
      stock: `公共库存：${['grain', 'apples', 'pears'].map(type => `${G.RES[type].name} ${Math.floor(g.res[type] || 0)}`).join(' · ')} · 总食物 ${Math.floor(g.res.food || 0)} · 麦酒 ${Math.floor(s.ale || 0)}（已配送与携料另计）`,
      batches: `当前批次：${this.tavernBatchText(b, s)}`,
      reserve: `储粮保护：全村 ${s.reserveDays} 天食物（至少 ${Math.ceil(s.reserveFood)}）`,
      afterBatch: `取出下一批 ${recipe.inputQty} ${input}后，公共总食物约 ${Math.floor(s.foodAfterBatch)}；仍须达到储粮保护线。`,
      goals: G.buildingGoalStatus(b) || '全镇麦酒目标：未设置，默认备30；可在资源目标面板调整',
    };
    return { summary: s, selectedRecipe: G.tavernRecipeOf(b), data };
  },
  tavernInfoMarkup: function (facts) {
    const data = facts.data;
    return `<section class="tavern-details" data-tavern-panel>
      ${['service', 'visitors', 'recipe', 'stock', 'batches'].map(key => `<p class="row" data-tavern="${key}">${this.escHtml(data[key])}</p>`).join('')}
      <form id="tavern-recipe-form" class="economy-form"><label for="tavern-recipe">选择下一批原料</label><select id="tavern-recipe">${Object.entries(G.BREW_RECIPES).map(([key, recipe]) => `<option value="${key}"${key === facts.selectedRecipe ? ' selected' : ''}>${this.escHtml(G.RES[recipe.inputType].name)}：${recipe.inputQty} → ${recipe.outputQty} 麦酒</option>`).join('')}</select><div class="economy-actions"><button type="submit" id="tavern-recipe-apply">应用下一批配方</button><button type="button" id="tavern-recipe-cancel">取消未应用选择</button></div><p class="desc">改选只用于下一批新任务；已接取料、携料或暂停批次沿用原配方。买来的苹果、梨也可使用，无需先解锁种树。</p></form>
      <div class="tavern-reserve" role="group" aria-labelledby="tavern-reserve-label">
        <p id="tavern-reserve-label" data-tavern="reserve">${this.escHtml(data.reserve)}</p>
        <div class="tavern-actions"><button type="button" id="tavern-reserve-less" data-tavern-step="-4" aria-label="降低储粮保护 4 天" aria-describedby="tavern-reserve-note">−4 天</button>
          <button type="button" id="tavern-reserve-more" data-tavern-step="4" aria-label="提高储粮保护 4 天" aria-describedby="tavern-reserve-note">＋4 天</button></div>
        <p class="desc" id="tavern-reserve-note">可设 8–48 天，默认 12 天。按全村人数与每日食物消耗估算；人口和库存变化会改变可酿条件。</p>
      </div>
      <p class="row" data-tavern="afterBatch">${this.escHtml(data.afterBatch)}</p>
      <p class="row" data-tavern="goals">${this.escHtml(data.goals)}</p>
      <p class="economy-message" data-tavern-message role="status" aria-live="polite"></p>
      <p class="desc">工人从仓库领取整批主食、苹果或梨，送到酒馆加工，再把麦酒送仓。取料、开酿与完成前均检查储粮；不足时退回未酿原料，中断和存档不会吞掉原料。</p>
      <p class="desc">仅实际苹果、梨可作果品原料；通用蔬菜与旧果园的蔬菜不能酿酒。果品每30酿10麦酒；主食每30酿3（受教育4），6小时工时与共享麦酒库存为本作适配。麦酒不计入食物，也不能充饥。六种食物物品仍为三组营养：肉类含鸡蛋，蔬菜含苹果和梨，另有主食。</p>
      <p class="desc">仅接待 18 岁以上居民，最多 4 人（含在途预约）。到馆累计服务 2 小时后，每人消耗 1 麦酒，留下 6 天休闲记忆。需健康酿酒工实际在岗；失去服务会等待或取消，夜间照常回家。</p>
      <p class="desc">三组营养（肉类含鸡蛋、蔬菜含苹果和梨、主食）是幸福基础；休闲可把幸福补到 5。完成休闲即时 +0.4 幸福（上限 5），日终再向目标平滑变化。劳动效率仅获 0～+5% 正向加成，不因低幸福受到负惩罚。</p>
    </section>`;
  },
  refreshTavernInfo: function (b) {
    const el = this.el.info;
    if (!el.querySelector || !el.querySelector('[data-tavern-panel]')) return false;
    const facts = this.tavernInfoData(b);
    if (!facts) return false;
    const nodes = {};
    for (const key of Object.keys(facts.data)) {
      nodes[key] = el.querySelector(`[data-tavern="${key}"]`);
      if (!nodes[key]) return false;
    }
    for (const key of Object.keys(nodes)) if (nodes[key].textContent !== facts.data[key]) nodes[key].textContent = facts.data[key];
    const less = el.querySelector('#tavern-reserve-less'), more = el.querySelector('#tavern-reserve-more');
    if (less) less.disabled = facts.summary.reserveDays <= 8;
    if (more) more.disabled = facts.summary.reserveDays >= 48;
    return true;
  },
  initTavernInfo: function (b) {
    const el = this.el.info, w = G.world, g = G.game;
    const panel = el.querySelector && el.querySelector('[data-tavern-panel]');
    if (!panel || !G.setTavernReserve) return;
    const valid = node => G.world === w && G.game === g && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel?.kind === 'b' && G.sel.id === b.id && w.bmap[b.id] === b && b.type === 'tavern' && b.state === 'ok' &&
      el.querySelector('[data-tavern-panel]') === panel && el.querySelector('#' + node.id) === node && !node.disabled && !G.hasOpenModal?.();
    const form = panel.querySelector('#tavern-recipe-form'), select = panel.querySelector('#tavern-recipe');
    const cancel = panel.querySelector('#tavern-recipe-cancel'), apply = panel.querySelector('#tavern-recipe-apply');
    for (const node of [form, select, cancel, apply, ...panel.querySelectorAll('[data-tavern-step]')]) node.addEventListener('keydown', e => {
      if (e.repeat && ['Enter', ' '].includes(e.key)) e.preventDefault();
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (e.repeat || !valid(form) || !valid(select) || !valid(apply) || panel.querySelector('#tavern-recipe-form') !== form || panel.querySelector('#tavern-recipe') !== select || panel.querySelector('#tavern-recipe-apply') !== apply) return;
      const type = select.value, message = panel.querySelector('[data-tavern-message]');
      if (type === G.tavernRecipeOf(b)) { message.textContent = '下一批配方已是此选择；当前批次继续。'; return; }
      const accepted = G.setTavernRecipe(b, type);
      message.textContent = accepted ? `下一批已选${G.RES[G.BREW_RECIPES[type].inputType].name}；已接取料与携料批次保留原配方。` : '配方未更改，请选择主食、苹果或梨。';
      this.refreshTavernInfo(b);
    });
    cancel.addEventListener('click', e => {
      if (e.detail > 1 || !valid(cancel) || !valid(select) || panel.querySelector('#tavern-recipe-cancel') !== cancel || panel.querySelector('#tavern-recipe') !== select) return;
      select.value = G.tavernRecipeOf(b); select.focus();
      panel.querySelector('[data-tavern-message]').textContent = '已取消未应用的配方选择。';
    });
    for (const button of panel.querySelectorAll('[data-tavern-step]')) button.addEventListener('click', () => {
      // Detached controls never act on a new world, new panel, or same-ID replacement.
      if (G.world !== w || G.game !== g || this.el.info !== el || el.classList.contains('hidden') || !G.sel ||
          G.sel.kind !== 'b' || G.sel.id !== b.id || w.bmap[b.id] !== b || b.state !== 'ok' ||
          el.querySelector('[data-tavern-panel]') !== panel || el.querySelector('#' + button.id) !== button ||
          button.disabled || (G.hasOpenModal && G.hasOpenModal())) return;
      const days = G.clamp(G.tavernSummary(b).reserveDays + Number(button.dataset.tavernStep), 8, 48);
      const accepted = G.setTavernReserve(b, days);
      this.refreshTavernInfo(b);
      const message = el.querySelector('[data-tavern-message]');
      if (message) message.textContent = accepted ? `储粮保护已设为 ${days} 天；开酿前仍会核对实际库存。` : '储粮保护未更改，请检查酒馆是否仍可用。';
    });
    this.refreshTavernInfo(b);
  },
  chapelInfoData: function (b) {
    if (b.type !== 'chapel' || b.state !== 'ok' || !G.chapelSummary) return null;
    const s = G.chapelSummary(b), rules = G.CHAPEL;
    const names = b.workers.map(id => G.world.cmap[id]).filter(c => c && !c.dead && c.job === b.id).map(c => c.name).join('、');
    return {
      status: s.status || (!s.onDuty ? '服务暂停：需健康牧师实际到岗' : '可接待，居民仍需沿通路步行到场'),
      staff: `牧师：已分配 ${s.staffAssigned} / 1 人 · 健康在岗 ${s.onDuty ? 1 : 0} / 1 人 · ${names || '无'}`,
      capacity: `服务居民：${s.members} / ${s.capacity} 人（有效礼拜记忆与当前预约去重）`,
      visitors: `当前礼拜预约：${s.visitors} / ${rules.visitorCapacity} 人 · 现场 ${s.onSite} 人 · 在途 ${Math.max(0, s.visitors - s.onSite)} 人`,
      service: `到场累计 ${rules.hours} 小时实际服务后，获得 ${rules.days} 天礼拜记忆，幸福目标 +${rules.bonus}，完成时即时 +0.2 幸福；可叠加酒馆休闲记忆，幸福总上限 5。`,
      rule: `每座服务容量 ${s.capacity} 人；当前预约最多 ${rules.visitorCapacity} 人（含在途，本作适配）。步行不计服务时间，工具、教育和幸福不缩短礼拜时间；无需食物或麦酒。`,
      priority: '先保障生活：缺粮、饥饿、患病或需要上课时优先处理相应需要。无健康牧师到岗、通路中断、停岗或拆除时，未完成服务不会获得礼拜记忆。',
    };
  },
  chapelInfoMarkup: function (data) {
    return `<section class="chapel-details" data-chapel-panel>
      ${['staff', 'capacity', 'visitors', 'service', 'rule', 'priority'].map(key => `<p class="row${['rule', 'priority'].includes(key) ? ' desc' : ''}" data-chapel="${key}">${this.escHtml(data[key])}</p>`).join('')}
    </section>`;
  },
  refreshChapelInfo: function (b) {
    const el = this.el.info;
    if (!el.querySelector || !el.querySelector('[data-chapel-panel]')) return false;
    const data = this.chapelInfoData(b);
    if (!data) return false;
    const nodes = {};
    for (const key of Object.keys(data)) {
      nodes[key] = el.querySelector(`[data-chapel="${key}"]`);
      if (!nodes[key]) return false;
    }
    for (const key of Object.keys(nodes)) if (nodes[key].textContent !== data[key]) nodes[key].textContent = data[key];
    return true;
  },
  schoolInfoData: function(b){
    if(b.type!=='school'||b.state!=='ok'||!G.schoolSummary)return null;
    const v=G.schoolSummary(b);
    return {status:v.status,staff:`分配教师 ${v.staffAssigned} 人 · ${v.teacherNames.join('、')||'无'}；实际在场：${v.teacherPresent?'是':'否'}`,
      seats:`学生 ${v.enrolled}/${v.capacity} · 实际到校 ${v.onSite} 人`,
      rule:`10岁入学，至少${G.EDUCATION.graduateAge}岁且修满${G.EDUCATION.totalHours}小时才毕业；每日最多${G.EDUCATION.dailyHours}小时。老师和学生均实际到校才记课，通勤不计。`,
      students:v.students.map(c=>`${c.name}（${Math.floor(c.age)}岁） ${c.hours.toFixed(1)}/${G.EDUCATION.totalHours}h · 今日${c.today.toFixed(1)}h · ${c.status}`).join('；')||'暂无在读学生',
      recovery:'教师离职或学堂拆除：优先转入可达且有教师、空座的学校；无处可去就保留学籍和课时，恢复后继续。教室只挡风，不代替住宅柴火取暖。'};
  },
  schoolInfoMarkup:function(b){const d=this.schoolInfoData(b);return d?`<section class="school-details" data-school-panel>${Object.keys(d).filter(k=>k!=='status').map(k=>`<p class="row" data-school="${k}">${this.escHtml(d[k])}</p>`).join('')}<div data-school-student-list></div></section>`:'';},
  refreshSchoolInfo:function(b){
    const el=this.el.info,d=this.schoolInfoData(b);if(!d||!el.querySelector||!el.querySelector('[data-school-panel]'))return false;
    for(const key of Object.keys(d)){const node=el.querySelector(`[data-school="${key}"]`);if(!node)return false;if(node.textContent!==d[key])node.textContent=d[key];}this.refreshSchoolStudents(b);return true;
  },
  refreshSchoolStudents:function(b){
    const el=this.el.info,list=el.querySelector&&el.querySelector('[data-school-student-list]');if(!list)return;
    const w=G.world,g=G.game,teachers=G.schoolTeachers(b),students=[...teachers,...w.citizens.filter(c=>!c.dead&&c.student&&(c.school===b.id||c.school==null))];
    const key=JSON.stringify(students.map(c=>[c.id,c.name,c.school,c.job,c.student]));if(list._studentKey===key)return;
    const focused=list.contains&&list.contains(document.activeElement),focusedId=focused?document.activeElement.dataset.studentId:null;
    list.innerHTML=students.map(c=>`<button type="button" class="medical-patient" data-student-id="${c.id}">查看${teachers.includes(c)?'教师 ':''}${this.escHtml(c.name)}${c.student&&c.school==null?'（待转校）':''}</button>`).join('');list._studentKey=key;
    for(const button of list.querySelectorAll('[data-student-id]'))button.addEventListener('click',()=>{
      if(G.world!==w||G.game!==g||this.el.info!==el||el.classList.contains('hidden')||G.sel?.kind!=='b'||G.sel.id!==b.id||w.bmap[b.id]!==b||el.querySelector('[data-school-student-list]')!==list||(G.hasOpenModal&&G.hasOpenModal()))return;
      const c=w.cmap[Number(button.dataset.studentId)];if(!c||c.dead||!(G.schoolTeachers(b).includes(c)||(c.student&&(c.school===b.id||c.school==null))))return;G.sel={kind:'c',id:c.id};this.showInfo();
    });
    if(focused){const next=list.querySelector(`[data-student-id="${focusedId}"]`)||el.querySelector('#info-close');if(next&&next.focus)next.focus();}
  },
  studentInfoData:function(c){
    if(!G.studentSummary)return null;const d=G.studentSummary(c);
    return {knowledge:`学识：${c.student?'就读中':c.educated?'受过教育':'未受教育'}`,
      status:d.status,school:`学校：${c.student?d.schoolName:'不在读'}`,
      progress:`课程 ${d.hours.toFixed(1)}/${d.total} 小时（${Math.floor(d.progress*100)}%） · 今日 ${d.today.toFixed(1)}/${d.limit} 小时`,
      graduation:`毕业需要年龄至少${d.graduateAge}岁且课时达标，两者缺一不可。近校正常就读通常17岁毕业，远路、疾病或停课会延后。`,
      recovery:'失师或无可达空座不会自动永久退学，已有课时保留。旧档在读按已有年龄进度折算，已毕业和已工作的居民不倒退。'};
  },
  studentInfoMarkup:function(c){
    const d=this.studentInfoData(c);if(!d)return '';
    return `<section class="student-details" data-student-panel>${Object.keys(d).map(k=>`<p class="row" data-student="${k}">${this.escHtml(d[k])}</p>`).join('')}
      <button id="school-leave-start" class="danger${G.studentSummary(c).canLeave?'':' hidden'}">结束学业并工作</button>
      <div class="school-leave-confirm hidden" data-school-leave-confirm><p>永久退学：将作为未受教育工人，不会获得毕业生产加成，也不能重新入学。确定结束学业？</p><button id="school-leave-confirm" class="danger">确认永久退学</button><button id="school-leave-cancel">继续就读</button></div>
      <p data-school-leave-message role="status" aria-live="polite"></p></section>`;
  },
  refreshStudentInfo:function(c){
    const el=this.el.info,d=this.studentInfoData(c);if(!d||!el.querySelector)return;
    const panel=el.querySelector('[data-student-panel]');if(!panel)return;
    for(const key of Object.keys(d)){const node=el.querySelector(`[data-student="${key}"]`);if(node&&node.textContent!==d[key])node.textContent=d[key];}
    const canLeave=G.studentSummary(c).canLeave,start=el.querySelector('#school-leave-start'),confirm=el.querySelector('[data-school-leave-confirm]');
    if(start){start.disabled=!canLeave;start.classList.toggle('hidden',!canLeave);}
    if(!canLeave||(G.hasOpenModal&&G.hasOpenModal())){panel._leavePending=false;if(confirm)confirm.classList.add('hidden');}
    const status=el.querySelector('[data-citizen-status]');if(status)status.textContent=this.citizenStatus(c);
    const role=el.querySelector('[data-citizen-role]');if(role)role.textContent=`${c.sex==='m'?'男':'女'} · ${Math.floor(c.age)} 岁 · ${c.student?'学生':c.adult?'成人':'儿童'}`;
    const job=el.querySelector('[data-citizen-job]'),b=G.world.bmap[c.job];if(job)job.textContent=b?G.BDEF[b.type].name:c.student?'学堂学生':c.adult?'无业':'儿童';
  },
  initStudentInfo:function(c){
    const w=G.world,g=G.game,el=this.el.info,panel=el.querySelector&&el.querySelector('[data-student-panel]');if(!panel)return;
    const start=panel.querySelector('#school-leave-start'),confirm=panel.querySelector('#school-leave-confirm'),cancel=panel.querySelector('#school-leave-cancel'),box=panel.querySelector('[data-school-leave-confirm]'),message=panel.querySelector('[data-school-leave-message]');
    if(!start||!confirm||!cancel||!box)return;panel._leavePending=false;
    const reset=()=>{panel._leavePending=false;box.classList.add('hidden');};
    const valid=()=>G.world===w&&G.game===g&&this.el.info===el&&!el.classList.contains('hidden')&&G.sel?.kind==='c'&&G.sel.id===c.id&&w.cmap[c.id]===c&&el.querySelector('[data-student-panel]')===panel&&!(G.hasOpenModal&&G.hasOpenModal());
    start.addEventListener('click',()=>{if(!valid()||!G.studentSummary(c).canLeave){reset();return;}panel._leavePending=true;box.classList.remove('hidden');if(confirm.focus)confirm.focus();});
    cancel.addEventListener('click',()=>{if(!valid()){reset();return;}reset();if(start.focus)start.focus();});
    confirm.addEventListener('click',()=>{if(!valid()||!panel._leavePending||!G.studentSummary(c).canLeave){reset();return;}reset();const accepted=G.leaveSchool(c);message.textContent=accepted?'已确认永久结束学业，作为未受教育工人工作。':'学业未改变。';this.refreshStudentInfo(c);if(accepted){const close=el.querySelector('#info-close');if(close&&close.focus)close.focus();}});
  },
  farmInfoData: function (b) {
    if (b.type !== 'farm' || b.state !== 'ok' || !G.farmSummary) return null;
    const s = G.farmSummary(b), pests = G.farmPestSummary(b), crops = G.CROPS;
    const crop = crops[s.crop], choice = crops[s.choice], winter = s.winterWindow;
    const workerNames = b.workers.map(id => G.world.cmap[id]).filter(c => c && !c.dead && c.job === b.id).map(c => c.name);
    const target = type => {
      const value = G.productionGoalOf(type);
      return `${G.RES[type].name} ${value === null ? '未设置' : value === 0 ? '0（关闭新一季）' : value + (G.goalPaused(type) ? '（达标暂停新一季）' : '（可开始新一季）')}`;
    };
    return { summary: s, pests, data: {
      status: s.status,
      workers: `${s.workers} 人${workerNames.length ? ' · ' + workerNames.join('、') : '（等待可用农夫）'}`,
      plot: `地块 ${b.w}×${b.h} · ${s.total}格 · 成熟满收理论 ${s.total*G.farmBaseYield(b)} 食物；实际受种收工时、工具、冬损和仓容影响`,
      current: `本季作物：${crop.name} → ${G.RES[s.output].name}`,
      choice: `下季 / 空田选择：${choice.name} → ${G.RES[s.choiceOutput].name}${s.pending ? '（下一春生效）' : '（与本季一致）'}`,
      timing: `本季${crop.name}：全田播完后成长 ${s.growDays} 天，${s.summerHarvest ? '夏、秋全熟后正常收获' : s.winterHarvestDays ? '秋季全熟后正常收获；入冬后的前两日仍可收割，冬季不成长' : '秋季全熟后正常收获'}；基础每格 ${G.farmBaseYield(b)} ${G.RES[s.output].name}，每年只种收一季`,
      cold: winter?.enabled ? `耐寒时限（48日年适配）：入冬后的前两日可继续实收，冬季不播种、不成长；第3日零时清除未收作物，已背起的收成保留。${winter.active ? `当前窗口还剩 ${Math.max(0,winter.hoursRemaining).toFixed(1)} 小时；未全熟可确认抢收，不能靠冬季等待增产。` : G.game.season === 3 ? '本冬收割窗口已结束。' : '秋季仍应尽早收获，不保证延后两日就能收完。'}` : '本季作物不耐寒：入冬即清除未收部分；已背起的收成保留。改选下季耐寒瓜不会保护本季作物。',
      reason: s.reason,
      seeds: `种子：${Object.keys(crops).map(type => `${crops[type].name}${s.unlocked[type] ? '已永久解锁' : '未解锁，需贸易购买' + crops[type].name + '种子'}`).join(' · ')}（永久解锁，不是库存物品，不占仓位）`,
      progress: `播种 ${s.sown}/${s.total} · 成长 ${Math.floor(s.growth * 100)}% · 实际收获 ${s.harvested}/${s.total} · 虫害损失 ${pests.lost}/${s.total}`,
      pestField: this.farmPestFieldText(pests),
      rotation: this.farmRotationText(pests),
      yield: `收获产出：按当前工具状态，每格 ${G.taskYield(G.farmHarvestBase(b))} ${G.RES[s.output].name}；每筐达到 ${G.PROD.farm.haulCap} 后送仓，入仓后才可用`,
      stock: `全镇可用库存：主食 ${Math.floor(s.grain || 0)} · 蔬菜 ${Math.floor(s.vegetables || 0)}（在途未入库不计）`,
      targets: `全镇目标：${['food', 'grain', 'vegetables'].map(target).join(' · ')}`,
      goals: `本季产出：${G.buildingGoalStatus(b) || '未设目标，仍受仓容限制'}；目标只限制尚未开始的新一季，已接第一播种任务后继续本季。`,
    } };
  },
  farmInfoMarkup: function (facts) {
    return `<section class="farm-details" data-farm-panel>
      <div class="economy-form farm-crop"><label for="farm-crop">下季 / 空田选择</label>
        <select id="farm-crop" aria-describedby="farm-crop-note">${Object.keys(G.CROPS).map(type => `<option value="${type}"${type === facts.summary.choice ? ' selected' : ''}${facts.summary.unlocked[type] ? '' : ' disabled'}>${this.escHtml(G.CROPS[type].name)}${facts.summary.unlocked[type] ? '' : '（需购买种子）'}</option>`).join('')}</select>
        <p class="desc" id="farm-crop-note">春、夏尚未开始播种的空田立即应用；已接第一播种任务、已播种、生长或已收获的本季作物锁定，改选留到下一春。已背起的粮食不变。空田默认显示小麦；困难开局须先购种子。旧档缺少小麦解锁字段时保留可种。</p>
      </div>
      ${['current','progress','reason','pestField'].map(key => `<p class="row" data-farm="${key}">${this.escHtml(facts.data[key])}</p>`).join('')}<details class="building-help"><summary>种植、成长与目标明细</summary>${Object.keys(facts.data).filter(key => !['status','workers','current','progress','reason','pestField'].includes(key)).map(key => `<p class="row" data-farm="${key}">${this.escHtml(facts.data[key])}</p>`).join('')}</details>
      <details class="building-task"><summary>农田虫害设置</summary><div class="farm-pests-setting" data-farm-pests-setting>
        <p class="row" data-farm-pests-status>${this.escHtml(this.farmPestSettingText(facts.pests))}</p>
        <div class="economy-actions"><button type="button" id="farm-pests-toggle" aria-describedby="farm-pests-note" aria-expanded="false">${facts.pests.enabled ? '关闭全镇农田虫害' : '开启全镇农田虫害…'}</button></div>
        <p class="desc" id="farm-pests-note">可选全镇规则，新局和旧档默认关闭。仅影响农田未收作物，邻近同种作物田可互相传播；仓内库存和已背起的粮食不受影响；果园、牧场不受影响。关闭即停止新感染与后续损失、清除活动虫害，已损失作物不返还。</p>
        <div class="hidden" data-farm-pests-confirm role="group" aria-label="确认开启全镇农田虫害">
          <p class="desc">开启会影响全镇所有农田。本作适配：先有12天宽限；之后新感染先预警2天，再逐日损失未收作物。损失不会自动返还，仍可在此关闭。</p>
          <div class="economy-actions"><button type="button" id="farm-pests-confirm">确认全镇开启</button><button type="button" id="farm-pests-cancel">保持关闭</button></div>
        </div>
      </div>
      </details><div class="economy-actions"><button type="button" id="early-harvest-start">提前抢收</button></div>
      <p class="desc" data-early-harvest-status></p>
      <div class="hidden" data-early-harvest-confirm role="group" aria-label="确认提前抢收">
        <p class="desc" data-early-harvest-quote></p>
        <div class="economy-actions"><button type="button" id="early-harvest-confirm">确认本季抢收</button><button type="button" id="early-harvest-cancel">继续等待</button></div>
      </div>
      <p class="economy-message" data-farm-message role="status" aria-live="polite"></p>
      <details class="building-help"><summary>收割与过冬规则</summary><p class="desc">全田播完才开始成长；小麦、卷心菜和耐寒瓜成长 ${G.CROPS.wheat.growDays} 天、秋季全熟后收获；早熟豆类成长 ${G.CROPS.beans.growDays} 天，夏、秋全熟即可正常收获。早熟的代价是基础每格 ${G.CROPS.beans.perTile} 蔬菜，低于小麦、卷心菜和耐寒瓜的 ${G.CROPS.wheat.perTile}。播种、走路、收割和送仓仍需时间，大田或农夫不足会推迟入库，不保证夏初就有粮。每年只种收一季，收完不能在夏季再次播种。</p>
      <p class="desc">也可确认提前抢收，按当时成熟度锁定较低产量并停止继续成长，本季不能复种。等待能提高成熟产量；若开启虫害，等候和收割期间仍可能损失未收格。小麦、卷心菜和豆类入冬即损失未收作物；耐寒瓜可延至入冬后的前两日，第3日零时清除未收部分。所有作物冬季都不播种、不成长；农夫仍须收割并实际搬运入仓。耐寒窗口是48日历适配，不是气温模拟。</p>
      <p class="desc">营养仍分肉类（含鸡蛋）、蔬菜（含苹果和梨）、主食三组。小麦产主食，卷心菜产蔬菜，早熟豆类和耐寒瓜也计入蔬菜；多种作物不额外增加饮食类别，也不产肉。</p>
      </details></section>`;
  },
  refreshFarmInfo: function (b) {
    const el = this.el.info;
    if (!el.querySelector || !el.querySelector('[data-farm-panel]')) return false;
    const facts = this.farmInfoData(b);
    if (!facts) return false;
    const nodes = {};
    for (const key of Object.keys(facts.data)) {
      nodes[key] = el.querySelector(`[data-farm="${key}"]`);
      if (!nodes[key]) return false;
    }
    for (const key of Object.keys(nodes)) if (nodes[key].textContent !== facts.data[key]) nodes[key].textContent = facts.data[key];
    const select = el.querySelector('#farm-crop');
    if (select) {
      for (const option of select.querySelectorAll('option')) {
        const type = option.value, unlocked = facts.summary.unlocked[type];
        option.disabled = !unlocked;
        const label = `${G.CROPS[type].name}${unlocked ? '' : '（需购买种子）'}`;
        if (option.textContent !== label) option.textContent = label;
      }
      // Native selects may hold a keyboard draft before firing change.
      if (document.activeElement !== select) select.value = facts.summary.choice;
    }
    this.refreshFarmPests(b);
    this.refreshEarlyHarvest(b);
    return true;
  },
  initFarmInfo: function (b) {
    const el = this.el.info, w = G.world, g = G.game;
    const panel = el.querySelector && el.querySelector('[data-farm-panel]');
    const select = panel && panel.querySelector('#farm-crop');
    if (!select || !G.setFarmCrop) return;
    select.addEventListener('change', () => {
      if (G.world !== w || G.game !== g || this.el.info !== el || el.classList.contains('hidden') || !G.sel ||
          G.sel.kind !== 'b' || G.sel.id !== b.id || w.bmap[b.id] !== b || b.state !== 'ok' ||
          el.querySelector('[data-farm-panel]') !== panel || el.querySelector('#farm-crop') !== select ||
          (G.hasOpenModal && G.hasOpenModal())) return;
      const accepted = G.setFarmCrop(b, select.value);
      select.value = G.cropChoiceOf(b);
      this.refreshFarmInfo(b);
      const message = el.querySelector('[data-farm-message]');
      if (message) message.textContent = accepted ? G.farmSummary(b).pending ? '选择已保存，将在下一春生效；本季作物和在途粮食保留。' : '选择已保存，本季作物与下季选择一致。' : '作物未更改，请先购买对应种子并检查农田是否仍可用。';
    });
    this.initFarmPests(b);
    this.initEarlyHarvest(b);
    this.refreshFarmInfo(b);
  },
  farmPestSettingText: function (p) {
    return p.enabled ? `全镇农田虫害：已开启${p.graceDays > 0 ? ` · 宽限还剩 ${p.graceDays} 天` : ''}` : '全镇农田虫害：已关闭';
  },
  farmPestFieldText: function (p) {
    const state = !p.enabled ? '已关闭，不再新增感染或虫损' : p.graceDays > 0 ? '宽限中，暂不新增感染或虫损' :
      p.active ? p.warningDays > 0 ? `预警中，距开始损失还有 ${p.warningDays} 天；之后每天最多损失 ${p.damagePerDay} 格` :
        `正在损失，每天最多损失 ${p.damagePerDay} 格` : '当前无活动虫害';
    return `本田虫害：${state} · 已虫损 ${p.lost} 格 · 尚未收割 ${p.remaining} 格（虫损不计入实际收获）`;
  },
  farmRotationText: function (p) {
    const crop = G.CROPS[p.crop].name, choice = G.CROPS[p.choice].name;
    const locked = Object.keys(G.CROPS).filter(type => type !== p.crop && !G.cropUnlocked(type)).map(type => G.CROPS[type].name + '未解锁').join('、');
    const action = !p.rotationAvailable ? `${locked || '尚无已解锁的其他作物'}，须在贸易站购买种子后才能选择不同作物` :
      p.rotationPlanned ? `已选下一春种${choice}，本季仍是${crop}，当前虫害不会因改选消失` : `可用上方作物选择安排不同于本季${crop}的作物`;
    return `轮作：${action}。${p.recurrence ? `本田已有${crop}虫害记录，继续同种会提高未来复发风险。` : ''}连续种受过虫害的同种作物会提高风险；实际播下不同作物才重置复发风险，只改下季选择不会重置。`;
  },
  refreshFarmPests: function (b) {
    const el = this.el.info, panel = el.querySelector('[data-farm-panel]');
    if (!panel) return;
    const toggle = panel.querySelector('#farm-pests-toggle'), box = panel.querySelector('[data-farm-pests-confirm]'), status = panel.querySelector('[data-farm-pests-status]');
    if (!toggle || !box || !status) return;
    const p = G.farmPestSummary(b), modal = G.hasOpenModal && G.hasOpenModal();
    const label = p.enabled ? '关闭全镇农田虫害' : '开启全镇农田虫害…';
    if (toggle.textContent !== label) toggle.textContent = label;
    const text = this.farmPestSettingText(p);
    if (status.textContent !== text) status.textContent = text;
    const pending = panel._pestEnable;
    if (pending && (p.enabled || pending.game !== G.game || pending.settings !== G.game.farmPests || modal)) {
      panel._pestEnable = null; box.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false');
      if (!modal && box.contains && box.contains(document.activeElement) && toggle.focus) toggle.focus();
    }
  },
  initFarmPests: function (b) {
    const el = this.el.info, w = G.world, g = G.game, panel = el.querySelector('[data-farm-panel]');
    if (!panel) return;
    const toggle = panel.querySelector('#farm-pests-toggle'), confirm = panel.querySelector('#farm-pests-confirm'), cancel = panel.querySelector('#farm-pests-cancel'), box = panel.querySelector('[data-farm-pests-confirm]'), msg = panel.querySelector('[data-farm-message]');
    if (!toggle || !confirm || !cancel || !box) return;
    panel._pestEnable = null;
    const reset = () => { panel._pestEnable = null; box.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false'); };
    panel._detailPestReset = reset;
    const valid = () => G.world === w && G.game === g && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel?.kind === 'b' && G.sel.id === b.id && w.bmap[b.id] === b && b.type === 'farm' && b.state === 'ok' &&
      el.querySelector('[data-farm-panel]') === panel && panel.querySelector('#farm-pests-toggle') === toggle &&
      panel.querySelector('#farm-pests-confirm') === confirm && panel.querySelector('#farm-pests-cancel') === cancel &&
      !(G.hasOpenModal && G.hasOpenModal());
    toggle.addEventListener('click', e => {
      if (!valid() || e.detail > 1) { reset(); return; }
      if (G.farmPestSummary(b).enabled) {
        reset();
        if (G.setFarmPests(false, g)) {
          if (msg) msg.textContent = '已关闭全镇农田虫害：不再新增感染或虫损，活动虫害已清除；已损失作物不返还，库存和在途粮食不变。';
          this.refreshFarmInfo(b);
        }
        return;
      }
      panel._pestEnable = { game: g, settings: g.farmPests };
      box.classList.remove('hidden'); toggle.setAttribute('aria-expanded', 'true');
      if (confirm.focus) confirm.focus();
    });
    cancel.addEventListener('click', () => { if (!valid()) { reset(); return; } reset(); if (toggle.focus) toggle.focus(); });
    confirm.addEventListener('click', e => {
      const pending = panel._pestEnable;
      if (!valid() || !pending || pending.game !== g || pending.settings !== g.farmPests || G.farmPestSummary(b).enabled || e.detail > 1) { reset(); return; }
      reset();
      const accepted = G.setFarmPests(true, g);
      if (msg) msg.textContent = accepted ? '已开启全镇农田虫害，先有12天宽限；新感染预警2天后才开始损失，农夫仍须实际收割送仓。' : '设置未更改，请重新打开农田详情后确认。';
      this.refreshFarmInfo(b);
      if (toggle.focus) toggle.focus();
    });
  },
  earlyHarvestText:function(q){
    if(!q.ok)return q.reason;
    return `现成熟${Math.floor(q.growth*100)}%，基础每格${q.base}。按当前工具，每格${q.perTile}，剩余${q.remaining}格预计${q.estimated} ${G.RES[q.output].name}；等全熟预计${q.fullEstimated}，较全熟估算少${q.fullEstimated-q.estimated}。这是在田估算，仓满、工具变化或冬季未收完会影响实际入库。`;
  },
  refreshEarlyHarvest:function(b){
    const el=this.el.info,panel=el.querySelector('[data-farm-panel]');if(!panel)return;
    const start=panel.querySelector('#early-harvest-start'),box=panel.querySelector('[data-early-harvest-confirm]'),status=panel.querySelector('[data-early-harvest-status]');if(!start||!box||!status)return;
    const q=G.earlyHarvestQuote(b);start.disabled=!q.ok;status.textContent=this.earlyHarvestText(q);
    const modal=G.hasOpenModal&&G.hasOpenModal();
    if(panel._harvestQuote&&(!q.ok||panel._harvestQuote!==q.key||modal)){
      panel._harvestQuote=null;box.classList.add('hidden');
      const msg=panel.querySelector('[data-farm-message]');if(msg&&!modal)msg.textContent='抢收条件或预计产量已变，请重新确认。';
      if(!modal&&box.contains&&box.contains(document.activeElement)){const focus=q.ok?start:el.querySelector('#info-close');if(focus&&focus.focus)focus.focus();}
    }
  },
  initEarlyHarvest:function(b){
    const el=this.el.info,w=G.world,g=G.game,panel=el.querySelector('[data-farm-panel]');if(!panel)return;
    const start=panel.querySelector('#early-harvest-start'),confirm=panel.querySelector('#early-harvest-confirm'),cancel=panel.querySelector('#early-harvest-cancel'),box=panel.querySelector('[data-early-harvest-confirm]'),quote=panel.querySelector('[data-early-harvest-quote]'),msg=panel.querySelector('[data-farm-message]');
    if(!start||!confirm||!cancel||!box||!quote)return;panel._harvestQuote=null;
    const reset=()=>{panel._harvestQuote=null;box.classList.add('hidden');};panel._detailHarvestReset=reset;
    const valid=()=>G.world===w&&G.game===g&&this.el.info===el&&!el.classList.contains('hidden')&&G.sel?.kind==='b'&&G.sel.id===b.id&&w.bmap[b.id]===b&&b.state==='ok'&&el.querySelector('[data-farm-panel]')===panel&&!(G.hasOpenModal&&G.hasOpenModal());
    start.addEventListener('click',e=>{if(!valid()||e.detail>1){reset();return;}const q=G.earlyHarvestQuote(b);if(!q.ok){reset();this.refreshFarmInfo(b);return;}panel._harvestQuote=q.key;quote.textContent=this.earlyHarvestText(q)+' 确认后本季不再成长、不可撤回，也不能再次播种；只下收割指令，不会立即获得粮食。';box.classList.remove('hidden');if(confirm.focus)confirm.focus();});
    cancel.addEventListener('click',()=>{if(!valid()){reset();return;}reset();if(start.focus)start.focus();});
    confirm.addEventListener('click',e=>{if(!valid()||!panel._harvestQuote||e.detail>1){reset();return;}const key=panel._harvestQuote;reset();const result=G.beginEarlyHarvest(b,key);if(msg)msg.textContent=result.ok?'已确认本季抢收，等待农夫逐格收割送仓；没有立即增加库存。':result.reason;this.refreshFarmInfo(b);const focus=result.ok?el.querySelector('#info-close'):start;if(focus&&focus.focus)focus.focus();});
  },
  tailorInfoData: function (b) {
    if (b.type !== 'tailor' || b.state !== 'ok' || !G.tailorSummary) return null;
    const s = G.tailorSummary(b), warm = s.recipe === 'warm', g = G.game;
    const names = b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、');
    const phases = { fetch: '前往仓库领料，尚未出库', process:'已取衣料，回铺 / 制作', work: '回铺 / 制作', haul: '待送仓', paused: '暂停保留' };
    const batches = s.batches.map(batch => {
      if(batch.type==='raw')return `${batch.carrier}：退回未用衣料 ${this.cargoText(batch.cargo)}`;
      const carrier = typeof batch.carrier === 'object' && batch.carrier ? batch.carrier.name :
        batch.carrier;
      return `${G.RES[batch.type].name} ${batch.qty}（${phases[batch.phase] || '已接批次'}${carrier ? ' · ' + carrier : ''}）${batch.materials?.length?'；原配料 '+batch.materials.map(x=>`${x.qty} ${G.RES[x.type].name}`).join(' + ')+(batch.withdrawn?' 已出库':' 尚未出库'):''}`;
    });
    const targets = ['clothes', 'warmCoats'].map(type => {
      const target = G.productionGoalOf(type);
      return `${G.RES[type].name} ${target === null ? '未设置' : target === 0 ? '0（关闭新生产）' : target + (G.goalPaused(type) ? '（达标暂停）' : '（可生产）')}`;
    });
    return { summary: s, data: {
      status: `新批次：${s.canProduce ? b.noWork && b.warnText ? '等待：' + b.warnText : !names ? '等待可用工人' : '可制作' : s.reason || '暂不能制作'}`,
      workers: names || '无',
      production: `当前产出：${G.RES[s.output].name}`,
      recipe: `每批：${warm ? '2 皮革 + 2 羊毛' : s.material==='auto'?'2 皮革或 2 羊毛（自动优先皮革）':`2 ${G.RES[s.material].name}（仅用所选材料）`} → 1 ${G.RES[s.output].name}（受教育 2）；基础劳动 8 小时`,
      materials: '新批次用料：' + s.materials.map(item => `${item.qty} ${G.RES[item.type].name}`).join(' + ') + '（新任务锁定选择，到仓才整批领取）',
      inputs: `原料库存：皮革 ${Math.floor(g.res.leather || 0)} · 羊毛 ${Math.floor(g.res.wool || 0)}`,
      stock: `${G.clothingSupplyEnabled?.()?'公共成衣':'可用成衣'}：普通衣物 ${Math.floor(s.clothes || 0)} · 暖衣 ${Math.floor(s.warmCoats || 0)}（在途未入库不计）` + (G.clothingSupplyEnabled?.()?`；目标计量普通 ${this.supplyNumber(G.supplyEconomyStock('clothes'))} / 暖衣 ${this.supplyNumber(G.supplyEconomyStock('warmCoats'))}，含已配送未穿成衣，不含正在穿着和火情封存` : ''),
      wearers: `全镇穿着：普通 ${s.wearers.basic} 人 · 暖衣 ${s.wearers.warm} 人 · 衣物耗尽 ${s.wearers.ragged} 人`,
      targets: '独立全镇目标：' + targets.join(' · '),
      goals: `当前配方：${G.buildingGoalStatus(b) || '未设全镇目标，仍受本类衣物仓容限制'}`,
      batches: '已接批次 / 在途衣物：' + (batches.length ? batches.join('；') : '无'),
    } };
  },
  tailorInfoMarkup: function (facts) {
    return `<section class="tailor-details" data-tailor-panel>
      <div class="economy-form tailor-recipe"><label for="coat-recipe">裁缝配方（仅新批次）</label>
        <select id="coat-recipe" aria-describedby="coat-recipe-note">${[['basic', '普通衣物'], ['warm', '暖衣（保暖外套）']].map(([value, label]) => `<option value="${value}"${value === facts.summary.recipe ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <p class="desc" id="coat-recipe-note">切换只影响新批次；已接批次保留原产物、原材料，已有成衣继续送仓。旧档默认普通衣物。</p>
      </div>
      <div class="economy-form"><label for="coat-material">普通衣用料（仅新批次）</label>
        <select id="coat-material"${facts.summary.recipe==='warm'?' disabled':''}>${[['auto','自动：优先皮革'],['leather','仅皮革：保留羊毛'],['wool','仅羊毛：保留皮革']].map(([value,label])=>`<option value="${value}"${value===facts.summary.material?' selected':''}>${label}</option>`).join('')}</select>
        <p class="desc">限定材料不足就停新批次，不自动换料；暖衣始终同时需要皮革和羊毛。旧档沿用自动。</p>
      </div>
      ${Object.keys(facts.data).filter(key => !['status', 'workers'].includes(key)).map(key => `<p class="row" data-tailor="${key}">${this.escHtml(facts.data[key])}</p>`).join('')}
      <p class="economy-message" data-tailor-message role="status" aria-live="polite"></p>
      <p class="desc">工人到可达通用仓整批领取衣料并立即出库，实际携料回铺制作；同批不再次扣料。切换只影响新任务。中断或读档退回未用衣料，满仓保留余料；成衣实际入库后才可领取。近仓与道路减少往返。</p>
      <p class="desc">普通衣物和暖衣有独立库存与全镇目标，可在资源目标面板调整。目标只限制新批次；已接批次仍可能完成并超过目标。</p>
      <p class="desc">每件 ${G.YEAR_DAYS} 天，日终磨损 1 天；穿坏时先领暖衣，无则领普通衣物。现有普通衣物不会立即换新，旧衣剩余耐久保留。户外受冻：普通衣物降低 40%，暖衣降低 70%（比普通再减半）。衣物不改变无柴冷屋受冻或烧柴暖屋恢复，仍需住房与柴火。</p>
    </section>`;
  },
  refreshTailorInfo: function (b) {
    const el = this.el.info;
    if (!el.querySelector || !el.querySelector('[data-tailor-panel]')) return false;
    const facts = this.tailorInfoData(b);
    if (!facts) return false;
    const nodes = {};
    for (const key of Object.keys(facts.data)) {
      nodes[key] = el.querySelector(`[data-tailor="${key}"]`);
      if (!nodes[key]) return false;
    }
    for (const key of Object.keys(nodes)) if (nodes[key].textContent !== facts.data[key]) nodes[key].textContent = facts.data[key];
    const select = el.querySelector('#coat-recipe');
    // A focused native select can have a keyboard draft before its change event.
    if (select && document.activeElement !== select) select.value = facts.summary.recipe;
    const material=el.querySelector('#coat-material');if(material){material.disabled=facts.summary.recipe==='warm';if(document.activeElement!==material)material.value=facts.summary.material;}
    return true;
  },
  initTailorInfo: function (b) {
    const el = this.el.info, w = G.world, g = G.game;
    const panel = el.querySelector && el.querySelector('[data-tailor-panel]');
    const select = panel && panel.querySelector('#coat-recipe');
    if (!select || !G.setCoatRecipe) return;
    for(const [id,setter,getter] of [['coat-recipe','setCoatRecipe','tailorRecipeOf'],['coat-material','setCoatMaterial','tailorMaterialOf']]){
      const input=el.querySelector('#'+id);if(!input)continue;
      input.addEventListener('change',()=>{
        if(G.world!==w||G.game!==g||this.el.info!==el||el.classList.contains('hidden')||G.sel?.kind!=='b'||G.sel.id!==b.id||w.bmap[b.id]!==b||b.state!=='ok'||el.querySelector('[data-tailor-panel]')!==panel||el.querySelector('#'+id)!==input||(G.hasOpenModal&&G.hasOpenModal())||(id==='coat-material'&&G.tailorRecipeOf(b)==='warm'))return;
        const accepted=G[setter](b,input.value);input.value=G[getter](b);this.refreshTailorInfo(b);
        const message=el.querySelector('[data-tailor-message]');if(message)message.textContent=accepted?'配方与用料选择已应用于新批次；已有批次和在途衣物保留。':'选择未更改，请检查裁缝铺并重新选择。';
      });
    }
    this.refreshTailorInfo(b);
  },
  cargoText: function(cargo){return cargo?[{type:cargo.type,qty:cargo.qty},...Object.entries(cargo.extra||{}).map(([type,qty])=>({type,qty}))].filter(x=>x.qty>0&&G.RES[x.type]).map(x=>`${G.RES[x.type].name} ${Number(x.qty)}`).join(' + '):'无';},
  mineralEquivalentText: function (summary) {
    return summary.source === 'stonequarry' ? `${summary.stone} 石头` : `${summary.iron} 铁或 ${summary.coal} 煤（共享储量，不能相加）`;
  },
  tunnelInfoData: function (b) {
    if (b.type !== 'tunnel' || !G.tunnelSummary) return null;
    const s = G.tunnelSummary(b);
    return {
      route: `隧道 ${s.length} 格（含两端） · ${b.tunnelAxis === 'x' ? '东西' : '南北'}直线；首选洞口 (${s.start.x},${s.start.y}) → 远端洞口 (${s.end.x},${s.end.y})。`,
      use: b.state === 'site' ? '只在首选洞口接收实运建材并施工；原洞口道路仍可走，山内完工前不可通行。' : '已贯通：只沿隧道轴实际步行和搬运，按土路速度通行；无常驻岗位。',
      cost: `全长建造计划：石头 ${s.length * 4} · ${s.length * 3} 游戏施工小时。工时、二值山体和单端施工为本作适配。`,
      traffic: `山内居民 ${s.inside} 人 · 洞内遗留生活物资 ${this.supplyNumber(s.looseGoods)}。`,
      removal: b.state === 'site' ? '取消工地沿用下方建材退款规则；尚未领出的材料计划不退款。' : '拆除须重新预览并确认；洞内或洞口有人、洞内遗留生活物资、或这是唯一通路时禁止拆除。',
    };
  },
  tunnelInfoMarkup: function (data) {
    return data ? Object.keys(data).map(key => `<div class="row desc" data-tunnel="${key}">${this.escHtml(data[key])}</div>`).join('') : '';
  },
  refreshTunnelInfo: function (b) {
    const data = this.tunnelInfoData(b), el = this.el.info;
    if (!data || !el.querySelector?.('[data-tunnel="route"]')) return false;
    for (const [key, value] of Object.entries(data)) {
      const node = el.querySelector(`[data-tunnel="${key}"]`);
      if (node && node.textContent !== value) node.textContent = value;
    }
    return true;
  },
  tunnelRemovalMarkup: function (b) {
    if (b.type !== 'tunnel' || b.state !== 'ok') return '';
    return `<section class="economy-form" data-tunnel-removal-panel aria-label="隧道拆除确认">
      <div class="hidden" data-tunnel-removal-confirm role="group" aria-label="确认关闭穿山通道">
        <p class="desc" data-tunnel-removal-quote></p>
        <div class="economy-actions"><button type="button" id="tunnel-removal-confirm" class="danger" disabled>确认拆除隧道</button><button type="button" id="tunnel-removal-cancel">取消，保留隧道</button></div>
      </div>
      <p class="economy-message" data-tunnel-removal-message role="status" aria-live="polite"></p>
    </section>`;
  },
  tunnelRemovalControlValid: function (b, context, node, allowModal) {
    if (!context) return false;
    const { world, game, el, panel, type, state } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel?.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.type === type && b.state === state &&
      el.querySelector('[data-tunnel-removal-panel]') === panel && (!node || (!node.disabled && panel.querySelector('#' + node.id) === node)) &&
      (allowModal || !(G.hasOpenModal && G.hasOpenModal()));
  },
  resetTunnelRemoval: function (panel, message, restoreFocus) {
    const box = panel.querySelector('[data-tunnel-removal-confirm]'), confirm = panel.querySelector('#tunnel-removal-confirm');
    const status = panel.querySelector('[data-tunnel-removal-message]'), el = this.el.info;
    const hadFocus = box && box.contains && box.contains(document.activeElement);
    panel._tunnelPending = null;
    panel._tunnelConfirmation = null;
    if (box) box.classList.add('hidden');
    if (confirm) confirm.disabled = true;
    if (message !== undefined && status) status.textContent = message;
    const start = el.querySelector && el.querySelector('#info-demolish');
    if (restoreFocus && hadFocus && start && start.focus) start.focus();
  },
  refreshTunnelRemoval: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-tunnel-removal-panel]');
    if (!panel || !panel._tunnelContext) return false;
    if (!this.tunnelRemovalControlValid(b, panel._tunnelContext, null, true)) { this.resetTunnelRemoval(panel); return false; }
    if (G.hasOpenModal && G.hasOpenModal()) this.resetTunnelRemoval(panel, '拆除确认已取消，请关闭弹窗后重新查看。');
    else if (panel._tunnelPending !== null) {
      const quote = G.tunnelRemovalQuote(b);
      if (!quote.ok || quote.key !== panel._tunnelPending)
        this.resetTunnelRemoval(panel, quote.reason || '通路、洞内居民或退款已变化。未拆除，请重新查看最新确认。', true);
    }
    return true;
  },
  confirmTunnelRemoval: function (b, quote) {
    const world = G.world, game = G.game;
    if (!b || b.type !== 'tunnel' || b.state !== 'ok' || !world || world.bmap[b.id] !== b || !quote?.ok ||
        (G.hasOpenModal && G.hasOpenModal())) return false;
    const fresh = G.tunnelRemovalQuote(b);
    if (!fresh.ok || fresh.key !== quote.key) return false;
    // Both map demolition and building details use the same inline confirmation.
    G.sel = { kind: 'b', id: b.id };
    this.showInfo();
    this.selectBuildingDetailTab('management');
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-tunnel-removal-panel]');
    if (G.world !== world || G.game !== game || !panel || !this.tunnelRemovalControlValid(b, panel._tunnelContext)) return false;
    const current = G.tunnelRemovalQuote(b);
    if (!current.ok || current.key !== quote.key) return false;
    panel._tunnelPending = current.key;
    panel._tunnelConfirmation = {};
    panel.querySelector('[data-tunnel-removal-quote]').textContent =
      `拆除 ${current.length} 格隧道：首选洞口 (${current.start.x},${current.start.y}) → 远端洞口 (${current.end.x},${current.end.y})。山内恢复不可通行；原有洞口道路保留。此次返还 ${Object.values(current.refund).some(n => n > 0) ? this.resourceCost(current.refund, false) : '0 材料'}，只退一次。确认时会重新检查，洞内或洞口有人、洞内遗留生活物资或隧道是唯一通路时禁止拆除。`;
    panel.querySelector('[data-tunnel-removal-confirm]').classList.remove('hidden');
    panel.querySelector('[data-tunnel-removal-message]').textContent = '尚未拆除或退款。请确认关闭穿山通道，或取消保留隧道。';
    const confirm = panel.querySelector('#tunnel-removal-confirm');
    confirm.disabled = false;
    if (confirm.focus) confirm.focus();
    return true;
  },
  initTunnelRemoval: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-tunnel-removal-panel]');
    if (!panel) return;
    const context = { world: G.world, game: G.game, el, panel, type: b.type, state: b.state };
    panel._tunnelContext = context;
    this.resetTunnelRemoval(panel, '');
    const confirm = panel.querySelector('#tunnel-removal-confirm'), cancel = panel.querySelector('#tunnel-removal-cancel');
    let activation = null, interrupted = false;
    const capture = e => {
      if (e.type === 'mousedown' && activation?.source === 'touchstart') return;
      interrupted = false;
      activation = { key: panel._tunnelPending, confirmation: panel._tunnelConfirmation, source: e.type, used: false };
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) confirm.addEventListener(name, capture);
    confirm.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key)) return;
      if (e.repeat) { e.preventDefault(); return; }
      capture(e);
    });
    const interrupt = () => { activation = null; interrupted = true; };
    panel._tunnelInterrupt = interrupt;
    for (const name of ['pointercancel', 'touchcancel', 'blur']) confirm.addEventListener(name, interrupt);
    if (!this._tunnelRemovalBlurBound) {
      this._tunnelRemovalBlurBound = true;
      window.addEventListener('blur', () => {
        const current = this.el.info?.querySelector?.('[data-tunnel-removal-panel]');
        if (current) { current._tunnelInterrupt?.(); this.resetTunnelRemoval(current, '拆除确认已取消，请重新查看。'); }
      });
    }
    cancel.addEventListener('click', () => {
      if (!this.tunnelRemovalControlValid(b, context, cancel)) { this.resetTunnelRemoval(panel); return; }
      interrupt();
      this.resetTunnelRemoval(panel, '已取消确认，隧道和建材均未改变。', true);
    });
    confirm.addEventListener('click', e => {
      if (!this.tunnelRemovalControlValid(b, context, confirm)) { this.resetTunnelRemoval(panel); return; }
      if (interrupted || e.detail > 1 || activation?.used || panel._tunnelPending === null) return;
      if (activation && activation.confirmation !== panel._tunnelConfirmation) return;
      const key = activation ? activation.key : panel._tunnelPending;
      if (activation) activation.used = true;
      this.refreshTunnelRemoval(b);
      if (panel._tunnelPending !== key) return;
      this.resetTunnelRemoval(panel);
      const removed = G.removeBuilding(b, key);
      if (!removed) {
        const fresh = G.tunnelRemovalQuote(b);
        this.resetTunnelRemoval(panel, fresh.reason || '隧道状态已改变，未拆除。请重新查看。', true);
      } else {
        this.renderInfo(true);
        const close = el.querySelector('#info-close');
        if (!el.classList.contains('hidden') && close && close.focus) close.focus();
      }
    });
  },
  cemeteryRemovalMarkup: function (b) {
    if(b.type!=='cemetery'||b.state!=='ok')return '';
    return `<section class="economy-form" data-cemetery-removal-panel aria-label="墓园拆围栏确认">
      <div class="hidden" data-cemetery-removal-confirm role="group" aria-label="确认拆围栏并保留墓位">
        <p class="desc" data-cemetery-removal-quote></p>
        <div class="economy-actions"><button type="button" id="cemetery-removal-confirm" class="danger" disabled>确认拆围栏，保留墓位</button><button type="button" id="cemetery-removal-cancel">取消，保留墓园</button></div>
      </div>
      <p class="economy-message" data-cemetery-removal-message role="status" aria-live="polite"></p>
    </section>`;
  },
  cemeteryRemovalControlValid: function (b, context, node, allowModal) {
    const { world, game, el, panel, type, state } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel && G.sel.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.type === type && b.state === state &&
      el.querySelector('[data-cemetery-removal-panel]') === panel && (!node || (!node.disabled && panel.querySelector('#' + node.id) === node)) &&
      (allowModal || !(G.hasOpenModal && G.hasOpenModal()));
  },
  resetCemeteryRemoval: function (panel, message, restoreFocus) {
    const box = panel.querySelector('[data-cemetery-removal-confirm]'), confirm = panel.querySelector('#cemetery-removal-confirm');
    const status = panel.querySelector('[data-cemetery-removal-message]'), el = this.el.info;
    const hadFocus = box && box.contains && box.contains(document.activeElement);
    panel._cemeteryPending = null;
    if (box) box.classList.add('hidden');
    if (confirm) confirm.disabled = true;
    if (message !== undefined && status) status.textContent = message;
    const start = el.querySelector && el.querySelector('#info-demolish');
    if (restoreFocus && hadFocus && start && start.focus) start.focus();
  },
  refreshCemeteryRemoval: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-cemetery-removal-panel]');
    if (!panel || !panel._cemeteryContext) return false;
    if (!this.cemeteryRemovalControlValid(b, panel._cemeteryContext, null, true)) { this.resetCemeteryRemoval(panel); return false; }
    if (G.hasOpenModal && G.hasOpenModal()) this.resetCemeteryRemoval(panel, '拆除确认已取消，请关闭弹窗后重新查看。');
    else if (panel._cemeteryPending !== null) {
      const quote = G.cemeteryRemovalQuote(b);
      if (!quote.ok || quote.key !== panel._cemeteryPending)
        this.resetCemeteryRemoval(panel, '墓位、日期或退款已变化。未拆除，请重新查看最新确认。', true);
    }
    return true;
  },
  confirmCemeteryRemoval: function (b, quote) {
    const world = G.world, game = G.game;
    if (!b || !world || world.bmap[b.id] !== b || !quote?.ok || 
        (G.hasOpenModal && G.hasOpenModal()) || G.cemeteryRemovalQuote(b).key !== quote.key) return false;
    // Map-tool demolition has no selected details yet. Open the same owned panel.
    G.sel = { kind: 'b', id: b.id };
    this.showInfo();
    this.selectBuildingDetailTab('management');
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-cemetery-removal-panel]');
    if (G.world !== world || G.game !== game || !panel || !panel._cemeteryContext ||
        !this.cemeteryRemovalControlValid(b, panel._cemeteryContext)) return false;
    const current = G.cemeteryRemovalQuote(b);
    if (!current.ok || current.key !== quote.key) return false;
    panel._cemeteryPending = current.key;
    const graves=current.graves||[],last=graves.length?Math.max(...graves.map(r=>r.expiresDay))-G.game.day:0;
    panel.querySelector('[data-cemetery-removal-quote]').textContent =
      `拆除围栏后停止新安葬；保留 ${graves.length} 座已有墓碑，占用 ${current.retainedTiles.length} 格，释放其余 ${current.releaseTiles.length} 格。${graves.length?`最晚 ${last} 天后自然释放，姓名和原到期日保留。`:''}墓碑所在格不能新建建筑或道路，仍可走过；墓碑不能再次拆除或退款。此次返还 ${this.resourceCost(current.refund,false)||'无材料'}，只退一次；在途建材仍归搬运者。` ;
    panel.querySelector('[data-cemetery-removal-confirm]').classList.remove('hidden');
    panel.querySelector('[data-cemetery-removal-message]').textContent = '尚未拆围栏或退款。请确认保留墓位的占地后果，或取消保留墓园。';
    const confirm = panel.querySelector('#cemetery-removal-confirm');
    confirm.disabled = false;
    if (confirm.focus) confirm.focus();
    return true;
  },
  initCemeteryRemoval: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-cemetery-removal-panel]');
    if (!panel) return;
    const context = { world: G.world, game: G.game, el, panel, type: b.type, state: b.state };
    panel._cemeteryContext = context;
    this.resetCemeteryRemoval(panel, '');
    const confirm = panel.querySelector('#cemetery-removal-confirm'), cancel = panel.querySelector('#cemetery-removal-cancel');
    for (const button of [confirm, cancel]) button.addEventListener('keydown', e => {
      if (e.repeat && ['Enter', ' '].includes(e.key)) e.preventDefault();
    });
    cancel.addEventListener('click', () => {
      if (!this.cemeteryRemovalControlValid(b, context, cancel)) { this.resetCemeteryRemoval(panel); return; }
      this.resetCemeteryRemoval(panel, '已取消确认，墓园、墓碑和建材均未改变。', true);
    });
    confirm.addEventListener('click', e => {
      if ((e && e.detail > 1) || !this.cemeteryRemovalControlValid(b, context, confirm) || panel._cemeteryPending === null) {
        this.resetCemeteryRemoval(panel); return;
      }
      const key = panel._cemeteryPending;
      this.refreshCemeteryRemoval(b);
      if (panel._cemeteryPending !== key) return;
      this.resetCemeteryRemoval(panel);
      const removed = G.removeBuilding(b, key);
      if (!removed) this.resetCemeteryRemoval(panel, '墓园状态已改变，未拆除。请重新查看。', true);
      else {
        this.renderInfo(true);
        const close = el.querySelector('#info-close');
        if (!el.classList.contains('hidden') && close && close.focus) close.focus();
      }
    });
  },
  mineralRemovalMarkup: function (b) {
    if (!G.finiteMineral || !G.finiteMineral(b) || b.type === 'mineralpit') return '';
    return `<section class="economy-form" data-mineral-removal-panel aria-label="有限矿点拆除确认">
      <div class="hidden" data-mineral-removal-confirm role="group" aria-label="确认永久留下废矿坑">
        <p class="desc" data-mineral-removal-quote></p>
        <div class="economy-actions"><button type="button" id="mineral-removal-confirm" class="danger" disabled>确认拆除并永久留坑</button><button type="button" id="mineral-removal-cancel">取消，保留矿点</button></div>
      </div>
      <p class="economy-message" data-mineral-removal-message role="status" aria-live="polite"></p>
    </section>`;
  },
  mineralRemovalControlValid: function (b, context, node, allowModal) {
    const { world, game, el, panel, type, state } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel && G.sel.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.type === type && b.state === state &&
      el.querySelector('[data-mineral-removal-panel]') === panel && (!node || (!node.disabled && panel.querySelector('#' + node.id) === node)) &&
      (allowModal || !(G.hasOpenModal && G.hasOpenModal()));
  },
  resetMineralRemoval: function (panel, message, restoreFocus) {
    const box = panel.querySelector('[data-mineral-removal-confirm]'), confirm = panel.querySelector('#mineral-removal-confirm');
    const status = panel.querySelector('[data-mineral-removal-message]'), el = this.el.info;
    const hadFocus = box && box.contains && box.contains(document.activeElement);
    panel._mineralPending = null;
    if (box) box.classList.add('hidden');
    if (confirm) confirm.disabled = true;
    if (message !== undefined && status) status.textContent = message;
    const start = el.querySelector && el.querySelector('#info-demolish');
    if (restoreFocus && hadFocus && start && start.focus) start.focus();
  },
  refreshMineralRemoval: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-mineral-removal-panel]');
    if (!panel || !panel._mineralContext) return false;
    if (!this.mineralRemovalControlValid(b, panel._mineralContext, null, true)) { this.resetMineralRemoval(panel); return false; }
    if (G.hasOpenModal && G.hasOpenModal()) this.resetMineralRemoval(panel, '拆除确认已取消，请关闭弹窗后重新查看。');
    else if (panel._mineralPending !== null) {
      const quote = G.mineralRemovalQuote(b);
      if (!quote.ok || !quote.leavesPit || quote.key !== panel._mineralPending)
        this.resetMineralRemoval(panel, '储量或矿点状态已变化。未拆除，请重新查看最新拆除确认。', true);
    }
    return true;
  },
  confirmMineralRemoval: function (b, quote) {
    const world = G.world, game = G.game;
    if (!b || !world || world.bmap[b.id] !== b || !quote?.ok || !quote.leavesPit ||
        (G.hasOpenModal && G.hasOpenModal()) || G.mineralRemovalQuote(b).key !== quote.key) return false;
    // Map-tool demolition has no selected details yet. Open the same owned panel.
    G.sel = { kind: 'b', id: b.id };
    this.showInfo();
    this.selectBuildingDetailTab('management');
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-mineral-removal-panel]');
    if (G.world !== world || G.game !== game || !panel || !panel._mineralContext ||
        !this.mineralRemovalControlValid(b, panel._mineralContext)) return false;
    const current = G.mineralRemovalQuote(b);
    if (!current.ok || !current.leavesPit || current.key !== quote.key) return false;
    panel._mineralPending = current.key;
    panel.querySelector('[data-mineral-removal-quote]').textContent =
      `拆除${G.BDEF[b.type].name}后永久留下 3×3 废矿坑：土地无法复垦、无法建造、不可通行，废坑也不能再次拆除。剩余 ${current.remaining} 储量单位（最多 ${this.mineralEquivalentText(current)}）将全部永久丢弃。按当前普通拆除规则退还一半已付建材，仅退一次；已经实际开采并随身携带的矿物保留，继续送仓。`;
    panel.querySelector('[data-mineral-removal-confirm]').classList.remove('hidden');
    panel.querySelector('[data-mineral-removal-message]').textContent = '尚未拆除、弃矿或退料。请确认以上永久后果，或取消保留矿点。';
    const confirm = panel.querySelector('#mineral-removal-confirm');
    confirm.disabled = false;
    if (confirm.focus) confirm.focus();
    return true;
  },
  initMineralRemoval: function (b) {
    const el = this.el.info, panel = el.querySelector && el.querySelector('[data-mineral-removal-panel]');
    if (!panel) return;
    const context = { world: G.world, game: G.game, el, panel, type: b.type, state: b.state };
    panel._mineralContext = context;
    this.resetMineralRemoval(panel, '');
    const confirm = panel.querySelector('#mineral-removal-confirm'), cancel = panel.querySelector('#mineral-removal-cancel');
    for (const button of [confirm, cancel]) button.addEventListener('keydown', e => {
      if (e.repeat && ['Enter', ' '].includes(e.key)) e.preventDefault();
    });
    cancel.addEventListener('click', () => {
      if (!this.mineralRemovalControlValid(b, context, cancel)) { this.resetMineralRemoval(panel); return; }
      this.resetMineralRemoval(panel, '已取消确认，矿点、储量和建材均未改变。', true);
    });
    confirm.addEventListener('click', e => {
      if ((e && e.detail > 1) || !this.mineralRemovalControlValid(b, context, confirm) || panel._mineralPending === null) {
        this.resetMineralRemoval(panel); return;
      }
      const key = panel._mineralPending;
      this.refreshMineralRemoval(b);
      if (panel._mineralPending !== key) return;
      this.resetMineralRemoval(panel);
      const removed = G.removeBuilding(b, key);
      if (!removed) this.resetMineralRemoval(panel, '矿点状态已改变，未拆除。请重新查看。', true);
      else {
        this.renderInfo(true);
        const close = el.querySelector('#info-close');
        if (!el.classList.contains('hidden') && close && close.focus) close.focus();
      }
    });
  },
  resourceChainInfoData: function (b) {
    if (b.state !== 'ok' || !['mine', 'stonequarry', 'blacksmith'].includes(b.type)) return null;
    const smith = b.type === 'blacksmith', outputs = G.productionOutputsOf(b);
    const output = smith ? G.blacksmithOutput(b) : null;
    const mode = b.type === 'mine' ? G.mineModeOf(b) : null;
    const mineral = !smith && G.mineralSummary ? G.mineralSummary(b) : null;
    const names = outputs.map(type => G.RES[type].name).join(' · ');
    const workers = b.workers.map(id => G.world.cmap[id]).filter(Boolean);
    const goal = G.buildingGoalStatus(b);
    let status;
    if(smith&&workers.some(c=>[c.task,c.pausedTask].some(t=>t?.kind==='smith'&&t.phase==='process')))status='原料已整批出库，继续返屋或加工；公共原料库存只决定后续新批次';
    else if(smith&&workers.some(c=>c.carry?.smithInput))status='未消耗原料正在退仓；仓满或无通路时随身保留';
    else if (mineral?.finite && mineral.reason) status = mineral.reason;
    else if (G.productionLimited(b) && goal) status = goal;
    else if (smith && G.toolLimited(b)) status = `${G.RES[output].name}已达本屋目标，暂停新批次`;
    else if (!G.jobCanProduce(b)) {
      const missing = smith ? G.blacksmithRecipe(b).filter(item => G.game.res[item.type] < item.qty) : [];
      status = smith ? '等待原料：' + (missing.map(item => `${G.RES[item.type].name}需 ${item.qty}`).join(' · ') || '铁匠暂不能接新批次')
        : '暂停新开采：当前产物仓容已满或已达目标';
    } else status = b.noWork && b.warnText ? `等待：${b.warnText}` : !workers.length ? '等待可用工人' : '运作中';
    // Tasks keep their original yield across a selector change, including paused
    // tasks. Report those snapshots rather than implying they already changed.
    const batches = [], seen = new Set();
    for (const c of G.world.citizens) {
      for (const task of [c.task, c.pausedTask]) {
        if (!task || task.b !== b || !task.yield || !G.RES[task.yield.type] || seen.has(task)) continue;
        seen.add(task);
        batches.push(`${G.RES[task.yield.type].name} ${task.yield.qty}${task.kind==='smith'?(task.phase==='fetch'?'（取料途中，未扣原料）':`（原料已出库：${this.cargoText(c.carry)}；${c.pausedTask===task?'夜间暂停':c.state==='walk'?'返回铁匠铺':'加工中'}）`):''}`);
      }
      if(smith&&c.job===b.id&&c.carry?.smithInput&&![c.task,c.pausedTask].some(t=>t?.kind==='smith'&&t.phase==='process'))batches.push(`退回原料 ${this.cargoText(c.carry)}${G.cargoWaitReason(c)?'（'+G.cargoWaitReason(c)+'）':''}`);
      if (c.job === b.id && c.carry && (smith ? ['tools', 'steelTools'] : ['stone', 'iron', 'coal']).includes(c.carry.type))
        batches.push(`${G.RES[c.carry.type].name} ${c.carry.qty}（待送仓）`);
    }
    const data = {
      status,
      workers: workers.map(c => c.name).join('、') || '无',
      production: `当前生产：${names}${mode === 'legacy' ? '（旧档混采）' : ''}`,
      stock: `${smith ? '成品' : '全镇'}库存：${(smith ? ['tools', 'steelTools'] : outputs).map(type => `${G.RES[type].name} ${Math.floor(G.game.res[type] || 0)}`).join(' · ')}`,
      goals: goal || '全镇产量目标：未设置，继承原规则',
      batches: '已接批次：' + (batches.length ? batches.join(' · ') : '无'),
    };
    if (smith) {
      const recipe = G.blacksmithRecipe(b), p = G.PROD.blacksmith;
      data.recipe = `每批：${recipe.map(item => `${item.qty} ${G.RES[item.type].name}`).join(' + ')} → ${p.toolsOut} ${G.RES[output].name}（受教育 ${p.eduToolsOut}）`;
      data.logistics='取料：实际步行到兼容堆料场/仓库后整批扣料，携料回屋加工；工具仍送通用仓库。道路和仓点距离影响往返。中断或读档时未消耗原料退仓，仓满保留随身；读档不恢复加工工时。';
      data.inputs = '公共可用原料（不含已出库批次）：' + recipe.map(item => `${G.RES[item.type].name} ${Math.floor(G.game.res[item.type] || 0)}`).join(' · ');
      data.target = `本屋${G.RES[output].name}目标：${G.toolLimitOf(b)}（只看当前所选产物库存）`;
      data.lifetime = G.personalToolsEnabled()?`个人工具：铁120/钢240个16小时劳动日（本作适配），同速；公共全新 ${this.supplyNumber(G.game.res[G.blacksmithOutput(b)])} / 目标计量 ${this.supplyNumber(G.toolReserveCount(G.blacksmithOutput(b)))}（含旧半用，不含已装备）。无工具只让该工人半速，完整配方不变。`:`寿命：铁工具 ${G.LIFE.toolLifeDays} / 钢工具 ${G.LIFE.steelToolLifeDays} 成人天；生产效率相同，优先磨损钢工具。工具不限仓储。`;
    } else {
      data.reserve = mineral?.finite ? `有限储量：剩余 ${mineral.remaining} / ${mineral.capacity} 单位；最多 ${this.mineralEquivalentText(mineral)}。` : '旧版无限：无限矿源，保留旧存档既有矿点的产出规则，不会耗尽。';
      data.reserved = mineral?.finite ? `已接/夜间暂停批次预留 ${mineral.reserved} 单位；可供新批次 ${mineral.available} 单位。预留尚未扣除，实际开采才减少剩余储量；已产随身矿不再占储量。` : '旧版无限不占有限储量；切换模式不会把既有矿点改为有限矿点。';
      data.mineralWarning = mineral?.finite ? mineral.exhausted ? '⚠ 储量已耗尽，不能再开采。' : mineral.low ? '⚠ 剩余储量已到 20% 及以下，请安排其他矿源。' : '储量会随实际开采减少，切换模式不会补充。' : '旧版矿点沿用普通拆除，不留下永久废矿坑。';
      data.mineralRule = mineral?.finite ? b.type === 'mine' ? '每产 1 铁消耗 2 单位，每产 1 煤消耗 1 单位，共用同一矿藏；不足整批时只接剩余可产数量。' : '每产 1 石头消耗 1 单位；初始 4000 石头为本作适配数值，不足整批时只接剩余可产数量。' : '旧版矿点的已接批次按原产物完成。';
      data.ground = mineral?.finite ? mineral.willLeavePit ? '已经实际开采：拆除须再次确认，永久留下 3×3 不可复垦、不可建造、不可通行的废矿坑，并丢弃全部剩余矿藏。' : '尚未实际开采：取消或拆除不留废坑；首次实际开采后拆除将永久留下 3×3 废矿坑，无法复垦、建造或通行。' : '开采后须搬运入仓才可使用；满仓余矿保留随身，腾出空间后继续送仓。';
    }
    return data;
  },
  resourceChainInfoMarkup: function (b, data) {
    if (!data) return '';
    const smith = b.type === 'blacksmith', mine = b.type === 'mine';
    const choice = smith ? (G.blacksmithOutput(b) === 'steelTools' ? 'steel' : 'iron') : mine ? G.mineModeOf(b) : null;
    const options = smith ? [['iron', '铁工具'], ['steel', '钢工具']]
      : mine ? [...(b.legacyMine ? [['legacy', '旧档混采（石头 / 铁）']] : []), ['iron', '采铁'], ['coal', '采煤']] : [];
    const field = smith ? 'tool-recipe' : 'mine-mode';
    return `<section class="resource-chain-details" data-resource-chain="${b.type}">
      ${choice ? `<div class="economy-form"><label for="${field}">${smith ? '铁匠配方' : '矿井开采模式'}</label>
        <select id="${field}" aria-describedby="resource-chain-change-note">${options.map(([value, label]) => `<option value="${value}"${value === choice ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <p class="desc" id="resource-chain-change-note">${smith ? '切换后新批次使用所选配方；已接批次按原配方完成，已有随身物资继续送仓。' : '切换只影响新批次；已接开采批次和随身矿物保留，继续送仓。'}${mine && b.legacyMine ? '旧档混采不会自动切换，可在这里保留或改选。' : ''}</p></div>` : ''}
      ${['production', 'recipe'].filter(key => data[key]).map(key => `<div class="row" data-resource-chain-live="${key}">${this.escHtml(data[key])}</div>`).join('')}
      ${smith ? `<div class="row tog-row resource-chain-target"><span data-resource-chain-live="target">${this.escHtml(data.target)}</span>
        <button type="button" class="mini-tog" data-tl="-10" title="降低当前产物的本屋目标 10" aria-label="降低本屋工具目标 10">−</button>
        <button type="button" class="mini-tog" data-tl="10" title="提高当前产物的本屋目标 10" aria-label="提高本屋工具目标 10">＋</button></div>` : ''}
      <div class="row" data-resource-chain-live="goals">${this.escHtml(data.goals)}</div>
      ${smith ? `<div class="row desc" data-resource-chain-live="lifetime">${this.escHtml(data.lifetime)}</div><div class="row desc">铁工具、钢工具各有独立的全镇目标。本屋目标随当前配方生效；已接批次仍可能完成并超过目标。</div>`
        : ['reserve', 'reserved', 'mineralWarning', 'mineralRule', 'ground'].map(key => `<div class="row desc" data-resource-chain-live="${key}">${this.escHtml(data[key])}</div>`).join('') + '<div class="row desc">实际开采所得须搬运入仓才可使用；满仓余矿保留随身，腾出空间后继续送仓。</div>'}
      ${choice ? '<p class="economy-message" data-resource-chain-message role="status" aria-live="polite"></p>' : ''}
    </section>`;
  },
  refreshResourceChainInfo: function (b) {
    const el = this.el.info;
    if (!el.querySelector || !el.querySelector(`[data-resource-chain="${b.type}"]`)) return false;
    const data = this.resourceChainInfoData(b);
    if (!data) return false;
    const nodes = {};
    for (const key of Object.keys(data)) {
      nodes[key] = el.querySelector(`[data-resource-chain-live="${key}"]`);
      if (!nodes[key]) return false;
    }
    for (const key of Object.keys(data)) if (nodes[key].textContent !== data[key]) nodes[key].textContent = data[key];
    // Leave a keyboard user's uncommitted choice alone during the timed tick.
    const select = el.querySelector(b.type === 'mine' ? '#mine-mode' : '#tool-recipe');
    if (select && document.activeElement !== select) select.value = b.type === 'mine' ? G.mineModeOf(b) : G.blacksmithOutput(b) === 'steelTools' ? 'steel' : 'iron';
    this.refreshMineralRemoval(b);
    return true;
  },
  initResourceChainInfo: function (b) {
    const el = this.el.info, w = G.world, game = G.game, type = b.type;
    if (!el.querySelector || !el.querySelector('[data-resource-chain]')) return;
    const id = b.type === 'mine' ? 'mine-mode' : b.type === 'blacksmith' ? 'tool-recipe' : null;
    const select = id && el.querySelector('#' + id);
    if (!select) return;
    select.addEventListener('change', () => {
      if (G.world !== w || G.game !== game || this.el.info !== el || !G.sel || G.sel.kind !== 'b' || G.sel.id !== b.id || w.bmap[b.id] !== b || b.state !== 'ok' || b.type !== type ||
          el.querySelector('#' + id) !== select || (el.classList.contains && el.classList.contains('hidden')) || (G.hasOpenModal && G.hasOpenModal())) return;
      const accepted = b.type === 'mine' ? G.setMineMode(b, select.value) : G.setToolRecipe(b, select.value);
      if (!accepted) select.value = b.type === 'mine' ? G.mineModeOf(b) : G.blacksmithOutput(b) === 'steelTools' ? 'steel' : 'iron';
      this.refreshResourceChainInfo(b);
      const message = el.querySelector('[data-resource-chain-message]');
      if (message) message.textContent = accepted ? '已应用于新批次；已有批次和随身物资保留。' : '该生产选择不可用，请重新选择。';
    });
  },
  medicalInfoData: function (b) {
    if (!['herbalist', 'hospital'].includes(b.type) || b.state !== 'ok' || !G.medicalPatients || !G.medicalStaff) return null;
    const hospital = b.type === 'hospital', patients = G.medicalPatients(b);
    const staff = G.medicalStaff(b), workers = b.workers.map(id => G.world.cmap[id]).filter(Boolean);
    const healthyWorkers = workers.filter(c => !G.isSick(c));
    const cap = hospital ? G.HEALTH.hospitalBeds : G.HEALTH.herbVisitors;
    const arrived = patients.filter(c => G.inMedicalCare && G.inMedicalCare(c)).length;
    const herbs = Math.floor(G.game.res.herbs || 0);
    let availability = !staff ? hospital ? '等待健康医师到诊所值守' : '等待健康采药员在岗'
      : patients.length >= cap ? '接诊名额已满（含在途预约）'
      : !hospital && herbs < 1 ? '等待草药送仓'
      : '可接诊；居民仍需有可达通路';
    const role = hospital ? '医师' : '采药员';
    const data = {
      status: staff ? hospital ? '医师正在诊所值守' : '采药员在岗，可在工作圈采药'
        : !workers.length ? `等待分配${role}` : !healthyWorkers.length ? `${role}患病，服务暂停` : `${role}未到岗，服务暂停`,
      workers: workers.map(c => c.name).join('、') || '无',
      patients: `${hospital ? '病床' : '调养名额'}：${patients.length} / ${cap}（已到 ${arrived} · 在途 ${patients.length - arrived}）`,
      herbs: `全镇草药库存：${herbs}`,
      availability: `接诊：${availability}`,
    };
    if (!hospital) {
      const p = G.PROD.herbalist;
      const trees = G.treesInRadius(G.world, b.x, b.y, p.radius, false);
      const mature = trees.filter(t => G.treeStage(t) >= 2).length;
      data.forest = `采药工作圈：成熟树 ${mature} 棵 / 全部 ${trees.length} 棵；依赖成熟林`;
      data.production = G.productionLimited(b) && G.buildingGoalStatus(b) ? G.buildingGoalStatus(b)
        : mature < p.needTrees ? '采药暂停：成熟林不足；已有草药仍可用于保健'
        : herbs >= G.storageCap() ? '采药暂停：草药仓容已满；仍提供保健'
        : !healthyWorkers.length ? '采药员患病：劳动变慢，草药保健暂停' : '采药条件满足；采集后需搬运入仓';
    }
    return data;
  },
  medicalInfoMarkup: function (b, data) {
    if (!data) return '';
    const hospital = b.type === 'hospital';
    return `<section class="medical-details" data-medical="${b.type}">
      ${Object.keys(data).filter(key => !['status', 'workers'].includes(key)).map(key => `<div class="row" data-medical="${key}">${this.escHtml(data[key])}</div>`).join('')}
      <div class="medical-patients" data-medical-patient-list></div>
      <div class="row desc">${hospital ? '病人抵达后，健康医师累计照料24小时治愈；不消耗草药。医师不能治疗自己。季节热病自然8天康复，本批不会直接致死。' : '草药调养改善健康；健康采药员外出采药时仍保留服务资格。砍伐或建造清林会影响采药。'}</div>
    </section>`;
  },
  refreshMedicalPatients: function (b) {
    const el = this.el.info, list = el.querySelector && el.querySelector('[data-medical-patient-list]');
    if (!list) return;
    const patients = G.medicalPatients(b), w = G.world;
    const key = JSON.stringify(patients.map(c => [c.id, c.name]));
    if (list._patientKey !== key) {
      const focused = document.activeElement && list.contains && list.contains(document.activeElement);
      const focusedId = focused ? document.activeElement.dataset.patientId : null;
      list.innerHTML = patients.map(c => `<button type="button" class="medical-patient" data-patient-id="${Number(c.id)}"><span>${this.escHtml(c.name)}</span><small></small></button>`).join('');
      list._patientKey = key;
      list.querySelectorAll('[data-patient-id]').forEach(btn => btn.addEventListener('click', () => {
        if (G.world !== w || !G.sel || G.sel.kind !== 'b' || G.sel.id !== b.id || w.bmap[b.id] !== b) return;
        const c = w.cmap[Number(btn.dataset.patientId)];
        if (!c) return;
        G.sel = { kind: 'c', id: c.id }; this.renderInfo(true);
        const close = document.getElementById('info-close'); if (close && close.focus) close.focus();
      }));
      if (focused) {
        const next = list.querySelector(`[data-patient-id="${Number(focusedId)}"]`) || document.getElementById('info-close');
        if (next && next.focus) next.focus();
      }
    }
    for (const c of patients) {
      const node = list.querySelector(`[data-patient-id="${Number(c.id)}"] small`);
      if (node) node.textContent = G.medicalStatus(c);
    }
  },
  refreshMedicalInfo: function (b) {
    const el = this.el.info;
    if (!el.querySelector || !el.querySelector(`[data-medical="${b.type}"]`)) return false;
    const data = this.medicalInfoData(b);
    if (!data) return false;
    const nodes = {};
    for (const key of Object.keys(data)) {
      nodes[key] = el.querySelector(`[data-medical="${key}"]`);
      if (!nodes[key]) return false;
    }
    for (const key of Object.keys(data)) if (nodes[key].textContent !== data[key]) nodes[key].textContent = data[key];
    this.refreshMedicalPatients(b);
    return true;
  },
  citizenSurvivalData: function (c) {
    const home = G.homeOf?.(c), sheltered = home && home.state === 'ok' && !home.houseFire;
    const health = G.healthOf ? G.healthOf(c) : Number(c.health) || 0, sick = G.isSick?.(c);
    const clothing = G.clothingTypeOf ? G.clothingTypeOf(c) : c.clothingLeft > 0 ? 'basic' : 'none';
    return {
      hunger: { label: '进食', value: c.hunger > 0 ? `饥饿 ${this.supplyNumber(c.hunger)} 天` : '未饥饿', warn: c.hunger > 0 },
      cold: { label: '体温', value: c.cold > 1 ? '正在受冻' : c.cold > 0 ? '轻微受冻' : '未受冻', warn: c.cold > 1 },
      health: { label: '健康', value: `${health.toFixed(1)} / 5${sick ? ' · 患病' : ''}`, warn: sick || health < 3 },
      home: { label: '住房', value: sheltered ? home.unheated && G.isWinter?.() ? '冷屋 · 缺燃料' : '有住房' : '暂无可用住房', warn: !sheltered || !!(home.unheated && G.isWinter?.()) },
      clothing: { label: '衣物', value: clothing === 'warm' ? '暖衣' : clothing === 'basic' ? '普通衣物' : '等待衣物', warn: clothing === 'none' },
    };
  },
  citizenSurvivalMarkup: function (c) {
    const data = this.citizenSurvivalData(c);
    return `<section class="citizen-survival" aria-label="生存概况"><h3>生存概况</h3><dl>${Object.entries(data).map(([key, item]) => `<div class="survival-fact${item.warn ? ' is-warning' : ''}" data-citizen-survival="${key}"><dt>${item.label}</dt><dd>${this.escHtml(item.value)}</dd></div>`).join('')}</dl></section>`;
  },
  refreshCitizenSurvival: function (c) {
    for (const [key, item] of Object.entries(this.citizenSurvivalData(c))) {
      const node = this.el.info.querySelector?.(`[data-citizen-survival="${key}"]`), value = node?.querySelector('dd');
      if (value && value.textContent !== item.value) value.textContent = item.value;
      node?.classList.toggle('is-warning', !!item.warn);
    }
  },
  citizenHealthData: function (c) {
    if (!G.healthOf || !G.medicalStatus) return null;
    const health = G.healthOf(c), sick = G.isSick(c), work = G.healthWorkMul(c);
    return {
      health: { text: `健康：${health.toFixed(1)} / 5${work > 1 ? ` · 劳作工时 ×${work.toFixed(2)}` : ''}`, warn: health < 3 },
      disease: { text: `疾病：${sick ? `患病第 ${Math.ceil(c.sickDays)} 天` : '无'}${!sick && c.immunityDays > 0 ? ` · 免疫约余 ${Math.ceil(c.immunityDays)} 天` : ''}`, warn: sick },
      medical: { text: `医疗：${G.medicalStatus(c)}${c.herbCooldown > 0 ? ` · 草药调养间隔约余 ${Math.ceil(c.herbCooldown)} 天` : ''}`, warn: false },
    };
  },
  citizenHealthMarkup: function (c) {
    const data = this.citizenHealthData(c);
    return data ? Object.entries(data).map(([key, row]) => `<div class="row${row.warn ? ' warn-txt' : ''}" data-citizen-health="${key}">${this.escHtml(row.text)}</div>`).join('') : '';
  },
  citizenDietText: function (c) {
    return Number.isFinite(c.dietVariety) ? `最近饮食：${Math.max(0, Math.min(3, c.dietVariety))} / 3 营养组（肉类含鸡蛋，蔬菜含苹果和梨）${Number.isFinite(c.dietScore) ? ' · 长期均衡 ' + c.dietScore.toFixed(1) + '/3' : ''}` : '';
  },
  refreshCitizenHealth: function (c) {
    const data = this.citizenHealthData(c);
    for (const [key, row] of Object.entries(data || {})) {
      const node = this.el.info.querySelector?.(`[data-citizen-health="${key}"]`);
      if (node) { if (node.textContent !== row.text) node.textContent = row.text; node.classList.toggle('warn-txt', !!row.warn); }
    }
    const diet = this.el.info.querySelector?.('[data-citizen-diet]'), text = this.citizenDietText(c);
    if (diet) { if (diet.textContent !== text) diet.textContent = text; diet.classList.toggle('hidden', !text); }
  },
  citizenClothingData: function (c) {
    const type = G.clothingTypeOf ? G.clothingTypeOf(c) : c.clothingLeft > 0 ? 'basic' : 'none';
    const mul = G.clothingColdMul ? G.clothingColdMul(c) : type === 'none' ? 1 : .6;
    const left = Math.max(0, Number(c.clothingLeft) || 0);
    return {
      worn: `衣物：${type === 'warm' ? '暖衣' : type === 'basic' ? '普通衣物' : '已耗尽，等待成衣'}${type === 'none' ? '' : ' · 约剩 ' + Math.ceil(left) + ' 天'}`,
      cold: `户外受冻 ×${mul.toFixed(1)}${type === 'warm' ? '（降低 70%，比普通衣物再减半）' : type === 'basic' ? '（降低 40%）' : '（无衣物防寒）'}`,
      renewal: `日终磨损 1 天，穿坏才优先领暖衣，无则普通；每件 ${G.YEAR_DAYS} 天，不提前替换旧衣。` + (G.clothingSupplyEnabled?.() ? '只从家中/临时补给点现货领取，成人提前为7日内需换衣的家人实际采购。' : '仍沿用远程公共领取，可在市政厅或市场明确启用衣物配送。'),
      shelter: '衣物不改变无柴冷屋受冻或烧柴暖屋恢复，仍需住房与柴火。',
      tools:G.personalToolsEnabled()?`个人工具：${G.toolEquipped(c)?G.RES[c.toolType].name+'，余 '+this.supplyNumber(c.toolHours/16)+' 劳动日':'未装备'}；${G.toolEquipped(c)?'工作正常速度，钢工具不加速':G.toolWorker(c)?(c.toolWaitReason||'待空手到可达通用仓领取，目前本人生产/建设半速'):'当前没有需工具的生产/建设工作'}。切换时已接旧批次先按原规则收尾，步行、休息和服务不磨损。`:'工具：沿用全镇共用池，可在市政厅明确选择个人领取。',
    };
  },
  citizenClothingMarkup: function (c) {
    const data = this.citizenClothingData(c);
    return `<section class="citizen-clothing">${Object.keys(data).map(key => `<div class="row${key === 'worn' && !(c.clothingLeft > 0) ? ' warn-txt' : ''}${['renewal', 'shelter'].includes(key) ? ' desc' : ''}" data-citizen-clothing="${key}">${this.escHtml(data[key])}</div>`).join('')}</section>`;
  },
  refreshCitizenClothing: function (c) {
    const el = this.el.info, data = this.citizenClothingData(c);
    if (!el.querySelector) return;
    for (const key of Object.keys(data)) {
      const node = el.querySelector(`[data-citizen-clothing="${key}"]`);
      if (node && node.textContent !== data[key]) node.textContent = data[key];
      if (node && key === 'worn') node.classList.toggle('warn-txt', !(c.clothingLeft > 0));
    }
  },
  citizenLeisureData: function (c) {
    if (!Number.isFinite(c.happiness)) return null;
    const s = G.leisureSummary ? G.leisureSummary(c) : null;
    const happiness = Math.max(1, Math.min(5, s ? s.happiness : c.happiness));
    const bonus = Math.max(0, Math.min(.05, s ? s.workBonus : G.happinessBonus ? G.happinessBonus(c) : 0));
    const days = Math.max(0, Math.min(6, s ? s.remainingDays : G.leisureDaysOf ? G.leisureDaysOf(c) : 0));
    const chapelDays = Math.max(0, Math.min(G.CHAPEL?.days || 6, Number.isFinite(s?.chapelDays) ? s.chapelDays : G.chapelDaysOf ? G.chapelDaysOf(c) : Number(c.chapelDays) || 0));
    const chapelBonus = Number.isFinite(s?.chapelBonus) ? s.chapelBonus : chapelDays > 0 ? G.CHAPEL?.bonus || .5 : 0;
    return {
      happiness: `幸福：${happiness.toFixed(1)} / 5${s ? ` · 当前目标 ${s.target.toFixed(1)} / 5` : ''}`,
      grief: G.griefLoss(c)>0?`亲属哀伤：${c.grief.name} · ${c.grief.buried?'已安葬，损失减轻':'当时没有可达空墓位'} · 当前幸福目标 −${c.grief.loss.toFixed(2)}，约 ${c.grief.days} 天恢复`:'亲属哀伤：无',
      memory: days > 0 ? `休闲记忆：约余 ${days.toFixed(1)} 天${s ? ` · 幸福目标 +${s.leisureBonus}` : ''}` : '休闲记忆：暂无（酒馆仅接待 18 岁以上居民）',
      chapel: chapelDays > 0 ? `礼拜记忆：约余 ${chapelDays.toFixed(1)} 天 · 幸福目标 +${chapelBonus}` : '礼拜记忆：暂无（完成礼拜堂实际服务后获得）',
      work: `幸福带来的劳动效率：+${(bonus * 100).toFixed(1)}%（仅 0～+5%，无负惩罚）`,
      basis: `三组营养（肉类含鸡蛋、蔬菜含苹果和梨、主食）是幸福基础${s ? `，当前饮食基础 ${s.dietBase.toFixed(1)} / 5` : ''}；礼拜记忆可叠加休闲记忆，幸福总上限 5；饥饿和亲属哀伤会降低幸福目标。完成酒馆休闲即时 +0.4、完成礼拜即时 +0.2（均不超过 5）；日终向目标最多变化 0.1。`,
    };
  },
  citizenLeisureMarkup: function (c) {
    const data = this.citizenLeisureData(c);
    return data ? `<section class="citizen-leisure">${Object.keys(data).map(key => `<div class="row${key === 'basis' ? ' desc' : ''}" data-citizen-leisure="${key}">${this.escHtml(data[key])}</div>`).join('')}</section>` : '';
  },
  refreshCitizenLeisure: function (c) {
    const el = this.el.info, data = this.citizenLeisureData(c);
    if (!el.querySelector || !data) return;
    for (const key of Object.keys(data)) {
      const node = el.querySelector(`[data-citizen-leisure="${key}"]`);
      if (node && node.textContent !== data[key]) node.textContent = data[key];
    }
    const status = el.querySelector('[data-citizen-status]');
    if (status) status.textContent = this.citizenStatus(c);
  },
  // Navigation owns presentation only. Existing controls keep their original IDs,
  // panel contexts and transactional guards; simulation APIs are unchanged.
  buildingOverviewMarkup: function (b, def, workforce) {
    const facts = [['阶段', this.buildingStatusChipsData(b).phase]];
    if (workforce && workforce.summary.supported) facts.push(['用工', workforce.data.current]);
    return `<dl class="building-facts">${facts.map(([label,value]) => `<div><dt>${label}</dt><dd${label === '用工' ? ' data-building-overview-workforce' : label === '阶段' ? ' data-building-overview-phase' : ''}>${this.escHtml(value)}</dd></div>`).join('')}</dl>
      <div class="building-quick-actions">${workforce?.summary.supported ? `<button type="button" data-building-jump="production">${b.state === 'site' ? '暂停 / 优先施工' : '调整用工'}</button>` : ''}${!['mineralpit','graveremnant'].includes(b.type) ? `<button type="button" data-building-jump="management">${b.type === 'house' ? '升级 / 管理' : '查看管理'}</button>` : ''}</div>
      <details class="building-help"><summary>建筑说明</summary><p class="desc">${def.desc}</p></details>
      <details class="building-help" data-building-debug><summary>位置与调试信息</summary><dl class="building-debug-facts"><div><dt>位置</dt><dd>${b.x}, ${b.y}</dd></div><div><dt>占地</dt><dd>${b.w} × ${b.h}</dd></div><div><dt>建筑编号</dt><dd>${Number(b.id)}</dd></div></dl></details>`;
  },
  refreshBuildingOverview: function (b) {
    const phase = this.el.info.querySelector?.('[data-building-overview-phase]'), label = this.buildingStatusChipsData(b).phase;
    if (phase && phase.textContent !== label) phase.textContent = label;
    const node = this.el.info.querySelector?.('[data-building-overview-workforce]');
    const facts = node && this.workforceInfoData(b);
    if (facts && node.textContent !== facts.data.current) node.textContent = facts.data.current;
    const stock = this.el.info.querySelector?.('[data-building-public-stock]');
    if (stock) { const markup = G.RES_KEYS.filter(key => G.RES[key]).map(key => `<div><dt>${this.escHtml(G.RES[key].name)}</dt><dd>${Math.floor(G.game.res[key] || 0)}</dd></div>`).join(''); if (stock.innerHTML !== markup) stock.innerHTML = markup; }
    const alert = this.el.info.querySelector?.('[data-building-alert]');
    if (alert) {
      const mineral = G.mineralSummary?.(b);
      const text = mineral?.finite && mineral.low ? (mineral.exhausted ? '矿藏已耗尽，请安排其他矿源。' : '矿藏余量 ≤20%，请安排其他矿源。') : '';
      alert.textContent = text; alert.classList.toggle('hidden', !text);
    }
  },
  selectBuildingDetailTab: function (key, focus = false, resetScroll = true) {
    const el = this.el.info, target = el.querySelector?.(`[data-building-panel="${key}"]`);
    if (!target) return false;
    if (this._buildingDetailTab !== key) {
      const previous = el.querySelector(`[data-building-panel="${this._buildingDetailTab}"]`);
      if (previous) this.resetBuildingDetailConfirmations(previous);
    }
    this._buildingDetailTab = key;
    el.querySelectorAll('[data-building-panel]').forEach(panel => {
      const hidden = panel !== target;
      panel.classList.toggle('hidden', hidden);
      panel.inert = hidden;
    });
    el.querySelectorAll('[data-building-tab]').forEach(button => button.setAttribute?.('aria-pressed', String(button.dataset.buildingTab === key)));
    el.querySelectorAll('[data-building-actions]').forEach(actions => {
      const hidden = actions.dataset.buildingActions !== key;
      actions.classList.toggle('hidden', hidden); actions.inert = hidden;
    });
    if (focus) el.querySelector(`[data-building-tab="${key}"]`)?.focus();
    if (resetScroll) { el.scrollTop = 0; const scroll = el.querySelector('[data-detail-scroll]'); if (scroll) scroll.scrollTop = 0; }
    return true;
  },
  resetBuildingDetailConfirmations: function (root) {
    for (const [selector, method] of [
      ['[data-supply-mode-panel]', 'resetSupplyConfirmation'], ['[data-supply-mode-panel]', 'resetClothingConfirmation'], ['[data-supply-mode-panel]', 'resetToolModeConfirmation'],
      ['[data-fishing-panel]', 'resetFishingConfirmation'], ['[data-fire-rules-panel]', 'resetFireAction'], ['[data-fire-rebuild-panel]', 'resetFireAction'],
      ['[data-house-upgrade-panel]', 'resetHouseUpgrade'], ['[data-mineral-removal-panel]', 'resetMineralRemoval'], ['[data-cemetery-removal-panel]', 'resetCemeteryRemoval'], ['[data-tunnel-removal-panel]', 'resetTunnelRemoval'],
    ]) { const panel = root.querySelector(selector); if (panel) this[method](panel); }
    for (const selector of ['[data-pasture-pests]', '[data-pasture-empty]', '[data-pasture-split]']) root.querySelector(selector)?._detailReset?.();
    const farm = root.querySelector('[data-farm-panel]'); farm?._detailPestReset?.(); farm?._detailHarvestReset?.();
    root.querySelector('[data-auto-trade]')?._autoTradeReset?.();
  },
  initBuildingDetailNavigation: function (b) {
    const el = this.el.info, world = G.world, game = G.game;
    const valid = () => this.el.info === el && G.world === world && G.game === game && G.sel?.kind === 'b' && world.bmap[G.sel.id] === b && !el.classList.contains('hidden');
    const buttons = Array.from(el.querySelectorAll('[data-building-tab]'));
    for (const button of buttons) {
      button.addEventListener('click', () => { if (valid() && el.querySelector('#' + button.id) === button) this.selectBuildingDetailTab(button.dataset.buildingTab); });
      button.addEventListener('keydown', e => {
        if (!valid() || el.querySelector('#' + button.id) !== button || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation?.();
        const i = buttons.indexOf(button), next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        this.selectBuildingDetailTab(buttons[next].dataset.buildingTab, true);
      });
    }
    el.querySelectorAll('[data-building-jump]').forEach(button => button.addEventListener('click', () => { if (valid() && el.contains(button)) this.selectBuildingDetailTab(button.dataset.buildingJump, true); }));
    this.selectBuildingDetailTab(this._buildingDetailTab, false, false);
  },
  buildingActivityMarkup: function (b) {
    const activity = typeof G.buildingActivity === 'function' ? G.buildingActivity(b) : null;
    return activity ? `<details class="building-help activity-help" data-building-activity-help><summary>状态说明</summary><div class="row" data-building-activity>${this.escHtml(activity.label)} · ${this.escHtml(activity.detail)}</div></details>` : '';
  },
  buildingStatusChipsData: function (b) {
    const fire = G.houseFireSummary?.(b), activity = G.buildingActivity?.(b);
    const phase = fire?.active ? '火灾中' : fire?.ruin ? '烧毁废墟' : b.type === 'mineralpit' ? '废矿坑' : b.type === 'graveremnant' ? '墓地遗址' : b.state === 'site' ? b.sitePaused ? '施工暂停' : '施工中' : '已建成';
    const labels = { working: '现场加工', paused: '已暂停', fetching: '取料中', returning: '返工坊途中', hauling: '搬运中', unstaffed: '无人值岗', hosting: '接待中', blocked: '条件受阻', idle: '空闲', vacant: '空置', home: '住户在家', away: '住户在外' };
    return { phase, activity: activity ? labels[activity.state] || activity.label : '', warning: !!fire?.active || !!fire?.ruin || activity?.state === 'blocked' };
  },
  buildingStatusChipsMarkup: function (b) {
    const data = this.buildingStatusChipsData(b);
    return `<div class="detail-status-chips" aria-label="建筑状态"><span class="detail-chip${data.warning ? ' is-warning' : ''}" data-building-phase>${this.escHtml(data.phase)}</span><span class="detail-chip${data.activity ? '' : ' hidden'}" data-building-current-activity>${this.escHtml(data.activity)}</span></div>`;
  },
  refreshBuildingStatusChips: function (b) {
    const data = this.buildingStatusChipsData(b), phase = this.el.info.querySelector?.('[data-building-phase]'), activity = this.el.info.querySelector?.('[data-building-current-activity]');
    if (phase) { if (phase.textContent !== data.phase) phase.textContent = data.phase; phase.classList.toggle('is-warning', data.warning); }
    if (activity) { if (activity.textContent !== data.activity) activity.textContent = data.activity; activity.classList.toggle('hidden', !data.activity); }
  },
  refreshBuildingActivity: function (b) {
    this.refreshBuildingStatusChips(b);
    const row = this.el.info.querySelector?.('[data-building-activity]');
    if (!row) return;
    const activity = typeof G.buildingActivity === 'function' ? G.buildingActivity(b) : null;
    const text = activity ? `${activity.label} · ${activity.detail}` : '';
    if (row.textContent !== text) row.textContent = text;
    row.classList.toggle('hidden', !activity);
    this.el.info.querySelector?.('[data-building-activity-help]')?.classList.toggle('hidden', !activity);
  },
  renderInfo: function (force) {
    if (!G.sel) return;
    const w = G.world, el = this.el.info;
    // Keep a keyboard user's active control stable across timed refreshes.
    const active = document.activeElement;
    const hadFocus = active && el.contains && el.contains(active);
    const selected = G.sel.kind === 'b' ? w.bmap[G.sel.id] : w.cmap[G.sel.id];
    if (!selected) { this.hideInfo(); return; }
    const sameSelection = this._infoWorld === w && this._infoGame === G.game && this._infoElement === el && this._infoSelection === selected;
    for (const kind of ['fire-rules', 'fire-rebuild']) {
      const panel = el.querySelector && el.querySelector(`[data-${kind}-panel]`);
      if (panel && (!sameSelection || !this.fireActionValid(selected, panel._fireContext, null, true))) this.resetFireAction(panel);
    }
    const supplyPanel = el.querySelector?.('[data-supply-mode-panel]');
    if (supplyPanel && (!sameSelection || !this.supplyModeControlValid(selected, supplyPanel._supplyContext, null, true))) { this.resetSupplyConfirmation(supplyPanel); this.resetClothingConfirmation(supplyPanel); this.resetToolModeConfirmation(supplyPanel); }
    const fishingPanel = el.querySelector?.('[data-fishing-panel]');
    if (fishingPanel && (!sameSelection || !this.fishingControlValid(selected, fishingPanel._fishingContext, null, true))) this.resetFishingConfirmation(fishingPanel);
    const homeFire = G.sel.kind === 'b' ? this.homeFireInfoData(selected) : null;
    const firePresentationChanged = sameSelection && (!!homeFire !== !!el.querySelector?.('[data-home-fire-panel]') || (homeFire && this._infoBuildType !== selected.type));
    if (firePresentationChanged) force = true;
    const mineralPanel = el.querySelector && el.querySelector('[data-mineral-removal-panel]');
    if (mineralPanel && !sameSelection) this.resetMineralRemoval(mineralPanel);
    else if (mineralPanel) this.refreshMineralRemoval(selected);
    const tunnelPanel = el.querySelector?.('[data-tunnel-removal-panel]');
    if (tunnelPanel && !sameSelection) this.resetTunnelRemoval(tunnelPanel);
    else if (tunnelPanel) this.refreshTunnelRemoval(selected);
    const tradePanel = sameSelection && selected.type === 'tradingpost' && el.querySelector && el.querySelector('[data-economy="tradingpost"]');
    const merchantChanged = tradePanel && tradePanel._merchant !== selected.merchant;
    // A new boat gets new callbacks. Keep drafts, but never reuse a previous
    // merchant's pay/order button or carry its keyboard focus onto a new deal.
    const tradeDraft = merchantChanged ? Object.fromEntries(['trade-target-resource', 'trade-target-quantity', 'trade-good', 'trade-buy-quantity', 'trade-payment', 'trade-order-good', 'trade-order-quantity', 'auto-trade-enabled', 'auto-trade-good', 'auto-trade-quantity', 'auto-trade-payment', 'auto-trade-price'].map(id => [id, el.querySelector('#' + id)?.value])) : null;
    const autoTradeOpen = merchantChanged && el.querySelector('[data-auto-trade]')?.open;
    if (merchantChanged) force = true;
    // Workforce facts must update before every specialized panel's early return.
    if (sameSelection && G.sel.kind === 'b' && this._infoBuildState === selected.state) this.refreshWorkforceInfo(selected);
    // The shared read-only activity facts must also bypass every early return.
    if (sameSelection && G.sel.kind === 'b') { this.refreshBuildingActivity(selected); this.refreshBuildingOverview(selected); }
    if (sameSelection && G.sel.kind === 'b' && selected.type === 'tunnel' && this._infoBuildState === selected.state) {
      const refreshed = this.refreshTunnelInfo(selected);
      if (!force && selected.state === 'ok' && refreshed) return;
    }
    if (!force && sameSelection && G.sel.kind === 'b' && this._infoBuildState === 'site' && selected.state === 'site' && this._infoBuildType === selected.type && this.refreshSiteInfo(selected)) return;
    if (!force && sameSelection && selected.type === 'market' && this._infoBuildState === selected.state && this.refreshMarketSupplyInfo(selected)) return;
    if (!force && sameSelection && G.sel.kind === 'b' && this._infoBuildState === selected.state && this._infoBuildType === selected.type && this.refreshHomeInfo(selected)) return;
    // Update only fuel text, never replace this panel's focused buttons. A new
    // selection or a site finishing construction still gets its own full panel.
    if (!force && sameSelection && homeFire?.summary.ruin && this._infoBuildType === selected.type && this._infoBuildState === selected.state && this.refreshHomeFireInfo(selected)) return;
    if (!force && sameSelection && selected.state === 'ok' && this._townHallInfoState === selected.state && this.refreshTownHallInfo(selected)) return;
    if (!force && sameSelection && selected.type === 'hunting' && this._infoBuildState === 'ok' && selected.state === 'ok' && this.refreshHuntingInfo(selected)) return;
    if (!force && sameSelection && selected.type === 'dock' && this._infoBuildState === 'ok' && selected.state === 'ok' && this.refreshFishingInfo(selected)) return;
    if (!force && sameSelection && selected.type === 'chapel' && selected.state === 'ok' && this._infoBuildState === 'ok' && this.refreshChapelInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._tavernInfoState === selected.state && this.refreshTavernInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._tailorInfoState === selected.state && this.refreshTailorInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._farmInfoState === selected.state && this.refreshFarmInfo(selected)) return;
    if(sameSelection&&selected.state==='ok'&&this._schoolInfoState===selected.state&&this.refreshSchoolInfo(selected))return;
    if (!merchantChanged && sameSelection && selected.state === 'ok' && this._economyInfoState === selected.state && this.refreshEconomyInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._medicalInfoState === selected.state && this.refreshMedicalInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._resourceChainInfoState === selected.state && this.refreshResourceChainInfo(selected)) return;
    if(sameSelection&&G.sel.kind==='b'&&selected.type==='stockpile'&&selected.state==='ok'&&this._infoBuildState==='ok'){this.refreshStockpileInfo(selected);return;}
    if(sameSelection&&G.sel.kind==='b'&&selected.type==='cemetery'&&selected.state==='ok'&&this._infoBuildState==='ok'){this.refreshCemeteryInfo(selected);return;}
    if(sameSelection&&G.sel.kind==='b'&&selected.type==='graveremnant'){this.refreshGraveRemnantInfo(selected);return;}
    if (sameSelection && selected.type === 'woodcutter' && this._fuelInfoState === selected.state && this.refreshFuelInfo(selected)) return;
    if (hadFocus && !force && sameSelection && selected.type !== 'woodcutter' &&
        !(selected.type === 'farm' && selected.state === 'ok' && G.farmSummary) && (G.sel.kind === 'c' || (this._infoBuildState === selected.state && this._infoBuildType === selected.type))) {
      if (G.sel.kind === 'c') { this.refreshCitizenSupplyInfo(selected); this.refreshCitizenHealth(selected); this.refreshCitizenLeisure(selected); this.refreshCitizenClothing(selected); this.refreshStudentInfo(selected); }
      // Patch changing site facts in place without stealing keyboard focus.
      if (G.sel.kind === 'b' && selected.state === 'site') {
        const data = this.siteInfoData(selected);
        for (const [key, selector] of [['status', '[data-site-status]'], ['workers', '[data-site-workers]'], ['refund', '[data-info-refund]']]) {
          const node = el.querySelector(selector);
          if (node) node.textContent = data[key];
        }
      }
      return;
    }
    const detailScroll = sameSelection ? el.scrollTop : 0;
    const bodyScroll = sameSelection ? el.querySelector?.('[data-detail-scroll]')?.scrollTop || 0 : 0;
    const detailOpen = sameSelection && this._infoBuildType === selected.type ? new Set(Array.from(el.querySelectorAll('details')).filter(node => node.open).map(node => node.dataset.detailDisclosure || node.querySelector?.('summary')?.textContent)) : new Set();
    const destructiveActionChanged = sameSelection && this._infoBuildState === 'site' && selected.state !== 'site' && active && ['info-demolish', 'construction-pause', 'construction-resume','construction-priority','construction-normal'].includes(active.id);
    const workforceInput = sameSelection && this._infoBuildState === selected.state && el.querySelector && el.querySelector('#worker-limit-input');
    const workforceDraft = workforceInput ? workforceInput.value : null;
    const merchantActionChanged = merchantChanged && active && ['trade-execute', 'trade-order-confirm', 'trade-order-cancel'].includes(active.id);
    const autoTradeActionChanged = merchantChanged && active && ['auto-trade-confirm', 'auto-trade-cancel'].includes(active.id);
    const focusSelector = (!sameSelection && hadFocus) || destructiveActionChanged || (firePresentationChanged && hadFocus) ? '#info-close' : merchantActionChanged ? '#trade-good' : autoTradeActionChanged ? '#auto-trade-apply' : hadFocus ? (active.id ? '#' + active.id : active.dataset.tl ? '[data-tl="' + active.dataset.tl + '"]' : active.dataset.fl ? '[data-fl="' + active.dataset.fl + '"]' : active.dataset.k ? '[data-k="' + active.dataset.k + '"]' : null) : null;
    this._infoWorld = w;
    this._infoGame = G.game;
    this._infoElement = el;
    this._infoSelection = selected;
    this._infoBuildState = selected.state;
    this._infoBuildType = selected.type;
    el.classList.add('detail-inspector');
    el.classList.toggle('citizen-inspector', G.sel.kind === 'c');
    el.classList.toggle('building-inspector', G.sel.kind === 'b');
    if (G.sel.kind === 'b') {
      const b = w.bmap[G.sel.id];
      if (!b) { this.hideInfo(); return; }
      const def = G.buildingDefinition ? G.buildingDefinition(b) : G.BDEF[b.type];
      const fuelData = b.type === 'woodcutter' ? this.fuelInfoData(b) : null;
      const siteData = b.state === 'site' ? this.siteInfoData(b) : null;
      const medicalData = this.medicalInfoData(b);
      const chainData = this.resourceChainInfoData(b);
      const hallData = this.townHallInfoData(b), marketData = this.marketSupplyInfoData(b);
      const tavernData = this.tavernInfoData(b);
      const chapelData = this.chapelInfoData(b);
      const tailorData = this.tailorInfoData(b);
      const farmData = this.farmInfoData(b);
      const schoolData=this.schoolInfoData(b);
      const cemeteryData=b.type==='cemetery'&&b.state==='ok'?this.cemeteryInfoData(b):null;
      const tunnelData = this.tunnelInfoData(b);
      const pit = b.type === 'mineralpit', remnant=b.type==='graveremnant', mineral = G.mineralSummary && G.mineralSummary(b);
      const fireData = this.homeFireInfoData(b), ruin = !!fireData?.summary.ruin;
      const rebuildData = this.fireRebuildInfoData(b);
      const workforceData = pit || remnant || ruin ? null : this.workforceInfoData(b);
      const homeData = this.homeInfoData(b), upgradeData = this.houseUpgradeInfoData(b);
      let status;
      if (fireData) status = fireData.data.status;
      else if (b.type === 'well' && b.state === 'ok') status = '水井可供救援取水 · 无需安排工人';
      else if (pit) status = '永久废矿坑：不可复垦、不可建造、不可通行，也不能拆除。';
      else if (fuelData) status = fuelData.status;
      else if (siteData) status = siteData.status;
      else if (tunnelData) status = '隧道已贯通 · 土路速度 · 无常驻岗位';
      else if (b.type==='hunting') status=G.huntingSummary(b,{reachability:false}).reason;
      else if(cemeteryData)status=cemeteryData.status;
      else if(remnant)status=G.graveRemnantSummary(b).status;
      else if(schoolData)status=schoolData.status;
      else if (medicalData) status = medicalData.status;
      else if (chainData) status = chainData.status;
      else if (hallData) status = hallData.data.status;
      else if (marketData) status = marketData.status;
      else if (tavernData) status = tavernData.data.status;
      else if (chapelData) status = chapelData.status;
      else if (tailorData) status = tailorData.data.status;
      else if (farmData) status = farmData.data.status;
      else if (G.productionLimited(b) && G.buildingGoalStatus(b)) status = G.buildingGoalStatus(b);
      else if (homeData) status = homeData.status;
      else if (['tradingpost', 'pasture', 'orchard'].includes(b.type)) status = this.economyStatus(b);
      else if (b.type === 'boarding') status = `入住 ${G.boardingFamilies(w, b).length} / ${G.LIFE.boardingCap} 家`;
      else if (b.type === 'farm') {
        status = !b.sownAll ? '待播种（春）' : b.growth < 1 ? `生长中 ${Math.floor(b.growth * 100)}%` : (b.harvestDone ? '已收获' : '待收获（秋）');
      } else if (G.toolLimited(b)) {
        status = '工具已达上限，暂停生产';
      } else if (def.jobs > 0 && !G.jobCanProduce(b)) {
        status = '停工：' + (b.type === 'blacksmith' ? '缺铁或木材' : b.type === 'woodcutter' ? '缺木材' : b.type === 'mine' ? '仓库已满' : b.type === 'tailor' ? (G.game.res.clothes >= G.storageCap() ? '衣物仓容已满' : '缺皮革或羊毛') : (b.warnText || '工作圈内暂无可用资源'));
      } else status = (b.noWork || (b.warnText && !b.workers.length)) ? `停工：${b.warnText || '无法工作'}` : (def.jobs > 0 && !b.workers.length ? '等待可用工人' : '运作中');
      let workers = '';
      if ((def.jobs > 0 || b.state === 'site') && !schoolData && !chapelData) {
        const names = b.workers.map(id => w.cmap[id]).filter(Boolean).map(c => this.escHtml(c.name)).join('、');
        workers = `<div class="row">${medicalData ? b.type === 'hospital' ? '医师' : '采药员' : tavernData ? '酿酒工（需 18 岁以上且健康）' : '工人'}：<span${b.type === 'dock' && b.state === 'ok' ? ' data-fishing-workers' : ''}${b.type === 'hunting' && b.state === 'ok' ? ' data-hunting-workers' : ''}${marketData ? ' data-market-workers' : ''}${siteData ? ' data-site-workers' : ''}${fuelData ? ' data-fuel="workers"' : ''}${medicalData ? ' data-medical="workers"' : ''}${chainData ? ' data-resource-chain-live="workers"' : ''}${tavernData ? ' data-tavern="workers"' : ''}${tailorData ? ' data-tailor="workers"' : ''}${farmData ? ' data-farm="workers"' : ''}${b.state === 'ok' && ['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-workers' : ''}>${names || (b.state === 'site' ? '等待建筑工人' : '无')}</span></div>`;
      }
      let extra = '', overviewExtra = '', inventoryExtra = '', managementExtra = '';
      if(remnant)overviewExtra=this.graveRemnantInfoMarkup(b);
      if (pit) overviewExtra = `<div class="row" data-mineral-pit-source>原址：${this.escHtml(G.BDEF[mineral?.source]?.name || '矿点')} · 永久占地 3×3；没有岗位和产出。</div><div class="row desc" data-mineral-pit-reserve>拆除时丢弃的剩余矿藏：${Number(mineral?.remaining) || 0} 储量单位，永久不可恢复。</div>`;
      if (homeData) overviewExtra = `<div class="row" data-home-residents>${this.escHtml(homeData.residents)}</div>`;
      if(homeData)inventoryExtra+=this.heatingInfoMarkup(b) + this.householdSupplyInfoMarkup(b);
      if (upgradeData) managementExtra += this.houseUpgradeInfoMarkup(upgradeData);
      if (fireData) overviewExtra += this.homeFireInfoMarkup(fireData);
      if (rebuildData) managementExtra += this.fireActionMarkup('fire-rebuild', rebuildData);
      if (b.type === 'well' && b.state === 'ok') overviewExtra += '<p class="row desc" data-well-purpose>救援者需沿可达通路走到井边取水，再携水返回住宅。水井无常驻岗位，不生成全镇水库存；也可从可达河岸取水。请靠近住房布置并保留通路。</p>';
      if (b.type === 'school' && !schoolData) {
        const n = w.citizens.filter(cc => cc.school === b.id).length;
        extra = `<div class="row">学生：${n} / ${G.LIFE.schoolCap}</div>`;
      }
      if (b.type === 'forester') {
        extra = `<div class="row tog-row">
          <button class="mini-tog${b.doCut ? '' : ' off'}" data-k="doCut">砍伐：${b.doCut ? '开' : '关'}</button>
          <button class="mini-tog${b.doPlant ? '' : ' off'}" data-k="doPlant">补种：${b.doPlant ? '开' : '关'}</button>
        </div>`;
      }
      if (fuelData) { // Per-building stock cutoff, independent of heating demand.
        const step = G.PROD.woodcutter.fuelStep;
        extra = `<div class="row tog-row">
          <span data-fuel="target">${fuelData.target}</span>
          <button class="mini-tog" data-fl="${-step}" title="降低本屋目标 ${step}" aria-label="降低本屋燃料目标 ${step}">−</button>
          <button class="mini-tog" data-fl="${step}" title="提高本屋目标 ${step}" aria-label="提高本屋燃料目标 ${step}">＋</button>
        </div>
        <div class="row" data-fuel="stock">${fuelData.stock}</div>
        <div class="row" data-fuel="batches">${this.escHtml(fuelData.batches)}</div>
        <div class="row desc">实际领2原木回屋，3.5小时产6柴（受教育8）。远途搬运会降低实际供暖产能，道路/近堆料场缩短往返；原料与这批成柴遇满仓保留，读档或取消加工会退回未用原木。</div>
        <div class="row" data-fuel="heat">${fuelData.heat}</div>
        <div class="row" data-fuel="gap">${fuelData.gap}</div>
        <div class="row desc">目标不是取暖需求。库存达到目标只阻止本屋接新批次；调低可给建设留木，但不会预留建材。已接批次仍可能耗木，其他伐木屋按各自目标继续。住房变化和户外受冻仍须留意。</div>`;
      }
      if (chainData) {
        extra += this.resourceChainInfoMarkup(b, chainData);
        inventoryExtra += `<section class="building-stock"><h3>库存与批次</h3>${['inputs','stock','batches','logistics'].filter(key => chainData[key]).map(key => `<p class="row" data-resource-chain-live="${key}">${this.escHtml(chainData[key])}</p>`).join('')}</section>`;
      }
      if (hallData) managementExtra += this.townHallInfoMarkup(b, hallData);
      if (marketData) { inventoryExtra += this.marketSupplyInfoMarkup(b); managementExtra += this.supplyModeInfoMarkup(b); }
      if (b.type === 'dock' && b.state === 'ok') extra += this.fishingInfoMarkup(b);
      if (b.type === 'hunting' && b.state === 'ok') extra += this.huntingInfoMarkup(b);
      if (tavernData) extra += this.tavernInfoMarkup(tavernData);
      if (chapelData) extra += this.chapelInfoMarkup(chapelData);
      if (tailorData) extra += this.tailorInfoMarkup(tailorData);
      if (farmData) extra += this.farmInfoMarkup(farmData);
      if(schoolData)extra+=this.schoolInfoMarkup(b);
      if(cemeteryData)extra+=this.cemeteryInfoMarkup(cemeteryData);
      if (tunnelData) overviewExtra += this.tunnelInfoMarkup(tunnelData);
      if(b.type==='stockpile'&&b.state==='ok')inventoryExtra+=this.stockpileInfoMarkup(b);
      if (b.state === 'ok') extra += this.economyInfoMarkup(b);
      if (medicalData) extra += this.medicalInfoMarkup(b, medicalData);
      const outputs = { gatherer: ['vegetables'], hunting: ['meat', 'leather'], dock: ['meat'], farm: ['grain'], orchard: ['vegetables'], pasture: ['meat', 'wool'], tailor: ['clothes'], herbalist: ['herbs'] };
      if(b.type==='pasture')outputs.pasture=G.productionOutputsOf(b).filter(k=>k!=='food');
      if(b.type==='orchard')outputs.orchard=G.productionOutputsOf(b).filter(k=>k!=='food');
      const produced = (chainData || tailorData || farmData ? [] : outputs[b.type] || []).filter(type => G.RES[type]);
      if (produced.length) extra += `<div class="row resource-output"${b.type==='pasture'?' data-pasture-output':b.type==='orchard'?' data-orchard-output':''}>产出：${produced.map(type => `${this.resourceIcon(type)}${G.RES[type].name}`).join(' · ')}</div>`;
      if (b.type === 'tailor' && !tailorData) extra += `<div class="row">原料库存：皮革 ${Math.floor(G.game.res.leather || 0)} · 羊毛 ${Math.floor(G.game.res.wool || 0)}</div><div class="row">成衣库存：${Math.floor(G.game.res.clothes || 0)}</div>`;
      if (b.type !== 'woodcutter' && !medicalData && !chainData && !tavernData && !chapelData && !tailorData && !farmData && G.buildingGoalStatus(b)) extra += `<div class="row desc"${['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-goals' : ''}>${this.escHtml(G.buildingGoalStatus(b))}</div>`;
      if (['gatherer', 'forester'].includes(b.type)) {
        const trees = G.treesInRadius(w, b.x, b.y, G.PROD[b.type].radius, false);
        const mature = trees.filter(t => G.treeStage(t) >= 2).length;
        extra += `<div class="row">工作圈：${trees.length} 棵树 · 成熟 ${mature}（砍伐、建造清林会影响产出）</div>`;
      }
      if (b.type === 'farm' && b.farm && !farmData) {
        extra += `<div class="row">播种 ${b.farm.filter(f => f.sown).length}/${b.farm.length} · 收获 ${b.farm.filter(f => f.harvested).length}/${b.farm.length}</div>`;
      }
      managementExtra += `        ${pit||remnant ? '' : `<div class="row desc" data-info-refund${fuelData ? ' data-fuel="refund"' : ''}>${ruin ? '清理烧毁废墟退还 0 材料；不能回收原屋材料。' : fireData?.summary.active ? '火灾进行中，暂不能拆除；关闭新增火灾也不会停止当前损伤。' : fuelData ? fuelData.refund : siteData ? siteData.refund : '已开工：拆除退还一半已付建材，已砍树不恢复'}</div>
        ${this.mineralRemovalMarkup(b)}${this.cemeteryRemovalMarkup(b)}${this.tunnelRemovalMarkup(b)}`}`;
      const managementAction = pit || remnant ? '' : `<footer class="detail-actions${this._buildingDetailTab === 'management' ? '' : ' hidden'}" data-building-actions="management"><button type="button" id="info-demolish" class="danger"${fireData?.summary.active ? ' disabled' : ''}>${b.type === 'roadwork' ? '取消剩余铺路' : b.state === 'site' ? '取消工地' : ruin ? '清理废墟（无返料）' : b.type==='cemetery'?'拆围栏…':b.type==='tunnel'?'拆除隧道…':'拆除建筑'}</button></footer>`;
      const hasWork = def.jobs > 0 || b.state === 'site' || schoolData || chapelData;
      const work = hasWork ? workers + this.workforceInfoMarkup(b, workforceData) : '';
      if (!hasWork && workforceData) managementExtra += `<details class="building-help"><summary>岗位与全镇人力</summary>${this.workforceInfoMarkup(b, workforceData)}</details>`;
      if (siteData) inventoryExtra = this.siteInfoMarkup(siteData) + inventoryExtra;
      if (b.type === 'storage' && b.state === 'ok') inventoryExtra += `<h3>全镇公共库存</h3><p class="desc">以下为全镇共用数据，不代表这座仓库独有的现货；在途货未入库不计。</p><dl class="building-facts" data-building-public-stock></dl>`;
      if (fuelData) {
        extra = extra.replace(/<div class="row" data-fuel="(stock|batches|heat|gap)">[\s\S]*?<\/div>/g, markup => { inventoryExtra += markup; return ''; });
      }

      const groups = [
        ['overview', '概览', this.buildingOverviewMarkup(b, def, workforceData) + overviewExtra],
        ['production', b.state === 'site' ? '施工与工人' : b.type === 'tradingpost' ? '贸易与工人' : ['school','chapel','hospital'].includes(b.type) ? '服务与工人' : '生产与工人', work + extra],
        ['inventory', '库存与运输', inventoryExtra],
        ['management', upgradeData ? '升级与管理' : '管理', managementExtra],
      ].filter(group => group[2].trim());
      if (!sameSelection || !groups.some(group => group[0] === this._buildingDetailTab)) this._buildingDetailTab = 'overview';
      el.innerHTML = `
        <div class="info-head"><div class="detail-heading"><span class="detail-title">${this.icon ? this.icon(b.type) : ''}<span>${this.escHtml(def.name)}管理</span></span>${this.buildingStatusChipsMarkup(b)}</div><button type="button" id="info-close" aria-label="关闭建筑详情">${this.icon ? this.icon('close') : '×'}</button></div>
        <nav class="building-detail-tabs" aria-label="建筑详情栏目">${groups.map(([key, label]) => `<button type="button" id="building-tab-${key}" data-building-tab="${key}" aria-controls="building-panel-${key}" aria-pressed="${this._buildingDetailTab === key}">${label}</button>`).join('')}</nav>
        <div class="detail-scroll" data-detail-scroll>
        <div class="row building-status"${b.type === 'dock' && b.state === 'ok' ? ' data-fishing-status' : ''}${b.type === 'hunting' && b.state === 'ok' ? ' data-hunting-status' : ''}${siteData ? ' data-site-status' : ''}${homeData ? ' data-home-status' : ''}${fuelData ? ' data-fuel="status"' : ''}${medicalData ? ' data-medical="status"' : ''}${chainData ? ' data-resource-chain-live="status"' : ''}${hallData ? ' data-townhall="status"' : ''}${marketData ? ' data-market-supply="status"' : ''}${tavernData ? ' data-tavern="status"' : ''}${chapelData ? ' data-chapel="status"' : ''}${tailorData ? ' data-tailor="status"' : ''}${farmData ? ' data-farm="status"' : ''}${cemeteryData?' data-cemetery="status"':''}${schoolData?' data-school="status"':''}${b.state === 'ok' && ['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-status' : ''}>${this.escHtml(status)}</div>

        ${this.buildingActivityMarkup(b)}<p class="building-alert hidden" data-building-alert role="status"></p>
        ${groups.map(([key, label, markup]) => `<section id="building-panel-${key}" data-building-panel="${key}" class="building-detail-panel${this._buildingDetailTab === key ? '' : ' hidden'}" aria-labelledby="building-tab-${key}">${markup}</section>`).join('')}</div>${managementAction}`;
      this.initBuildingDetailNavigation(b);
      this.refreshBuildingOverview(b);
      if (fuelData) this._fuelInfoState = b.state;
      this._economyInfoState = b.state;
      this._medicalInfoState = b.state;
      this._resourceChainInfoState = b.state;
      this._townHallInfoState = b.state;
      this._tavernInfoState = b.state;
      this._tailorInfoState = b.state;
      this._farmInfoState = b.state;
      this._schoolInfoState=b.state;
      this.initWorkforceInfo(b);
      if(homeData)this.initHeatingInfo(b);
      if (upgradeData) this.initHouseUpgradeInfo(b);
      const workforceField = el.querySelector && el.querySelector('#worker-limit-input');
      if (workforceField && workforceDraft !== null) workforceField.value = workforceDraft;
      if (hallData || (b.type === 'dock' && b.state === 'ok')) this.initFishingInfo(b);
      if (hallData || marketData) this.initSupplyModeInfo(b);
      if (hallData) { this.initFireAction(b, 'fire-rules'); this.refreshTownHallInfo(b); }
      if (rebuildData) this.initFireAction(b, 'fire-rebuild');
      if (tavernData) this.initTavernInfo(b);
      if (tailorData) this.initTailorInfo(b);
      if (farmData) this.initFarmInfo(b);
      if(schoolData)this.refreshSchoolStudents(b);
      if (medicalData) this.refreshMedicalPatients(b);
      if (chainData) this.initResourceChainInfo(b);
      this.initMineralRemoval(b);
      this.initCemeteryRemoval(b);
      this.initTunnelRemoval(b);
      if (b.state === 'ok') this.initEconomyInfo(b);
      if (tradeDraft) {
        for (const [id, value] of Object.entries(tradeDraft)) {
          const node = el.querySelector('#' + id);
          if (node && value !== undefined && (id !== 'trade-order-good' || G.merchantProfile(b)?.goods.includes(value))) node.value = value;
        }
        const autoPanel = el.querySelector('[data-auto-trade]');
        if (autoPanel) autoPanel.open = !!autoTradeOpen;
        this.refreshEconomyInfo(b);
      }
    } else {
      const c = w.cmap[G.sel.id];
      if (!c) { this.hideInfo(); return; }
      const status = this.citizenStatus(c);
      const jobB = c.job != null ? w.bmap[c.job] : null;
      const jobName = jobB ? G.BDEF[jobB.type].name : (c.student ? '学堂学生' : (c.adult ? '无业' : '儿童'));
      const fam = G.familyOf(c), supplyHome = G.supplyFamilyTarget && G.supplyFamilyTarget(fam, false);
      el.innerHTML = `
        <div class="info-head"><span class="detail-title">${this.icon ? this.icon('citizen') : ''}<span>${this.escHtml(c.name)}</span></span><button type="button" id="info-close" aria-label="关闭居民详情">${this.icon ? this.icon('close') : '×'}</button></div>
        <div class="detail-scroll" data-detail-scroll>
        ${this.citizenSurvivalMarkup(c)}
        <div class="row" data-citizen-role>${c.sex === 'm' ? '男' : '女'} · ${Math.floor(c.age)} 岁 · ${c.student ? '学生' : c.adult ? '成人' : '儿童'}</div>
        <div class="row">职业：<span data-citizen-job>${jobName}</span> · <span data-citizen-status>${this.escHtml(status)}</span></div>
        ${c.carry ? `<div class="row">随身：${this.cargoText(c.carry)}（${Number.isInteger(c.carry.constructionId)?'建材已出库、尚未投入施工':c.carry.smithInput?'铁匠原料已出库、尚未消耗':'未入库'}）</div>` : ''}
        <div class="row">家庭：${fam ? (fam.houseId != null ? '有房' : '无房') : '单身'}</div>
        <p class="row" data-citizen-meal>${this.escHtml(G.householdMealStatus?.(c)||'')}</p><div data-citizen-household-supply>${supplyHome ? this.householdSupplyInfoMarkup(supplyHome) : ''}</div>
        ${this.studentInfoMarkup(c)}
        <details class="building-help citizen-help"><summary>衣物与工具</summary>${this.citizenClothingMarkup(c)}</details>
        <details class="building-help citizen-help"><summary>健康与饮食</summary>
        <div class="row${Number.isFinite(c.dietVariety) ? '' : ' hidden'}" data-citizen-diet>${this.escHtml(this.citizenDietText(c))}</div>
        ${this.citizenHealthMarkup(c)}</details>
        <details class="building-help citizen-help"><summary>幸福与休闲</summary>${this.citizenLeisureMarkup(c)}</details></div>`;
      const supplyHolder = el.querySelector?.('[data-citizen-household-supply]');
      if (supplyHolder) supplyHolder._supplyTarget = supplyHome;
      this.initStudentInfo(c);
    }
    for (const disclosure of el.querySelectorAll('details')) if (detailOpen.has(disclosure.dataset.detailDisclosure || disclosure.querySelector?.('summary')?.textContent)) {
      disclosure.open = true;
      if (disclosure.dataset.supplyEmpty !== undefined) disclosure.classList.remove('hidden');
    }
    el.scrollTop = detailScroll;
    const scrollBody = el.querySelector?.('[data-detail-scroll]'); if (scrollBody) scrollBody.scrollTop = bodyScroll;
    document.getElementById('info-close').addEventListener('click', () => this.hideInfo());
    el.querySelectorAll('.mini-tog').forEach(btn => btn.addEventListener('click', () => {
      if (!G.sel || G.sel.kind !== 'b' || G.world !== w || w.bmap[G.sel.id] !== selected) return;
      const bb = w.bmap[G.sel.id];
      if (!bb) return;
      if (btn.dataset.tl) {
        const old = G.toolLimitOf(bb);
        bb.toolLimit = G.clamp(old + Number(btn.dataset.tl), 0, G.PROD.blacksmith.toolMax);
        if (bb.toolLimit !== old) delete bb.productionPaused;
        G.updateProductionGoals();
        bb.noWork = false;
        this.renderInfo(true);
        return;
      }
      if (btn.dataset.fl) { // 伐木屋燃料上限 ±50
        const P = G.PROD.woodcutter;
        const old = G.fuelLimitOf(bb);
        bb.fuelLimit = G.clamp(old + Number(btn.dataset.fl), 0, P.fuelMax);
        if (bb.fuelLimit !== old) delete bb.productionPaused;
        G.updateProductionGoals();
        bb.noWork = false; // 清掉停工标记，下次派活时按新上限重新评估
        this.renderInfo(true);
        return;
      }
      bb[btn.dataset.k] = !bb[btn.dataset.k];
      bb.noWork = false;
      this.renderInfo(true);
    }));
    if (focusSelector && el.querySelector) { const next = el.querySelector(focusSelector); if (next) next.focus(); }
    const dem = document.getElementById('info-demolish');
    const renderedState = selected.state, renderedType = selected.type, renderedGame = G.game;
    let roadCancelInterrupted = false;
    if (dem && renderedType === 'roadwork') {
      const capture = () => { roadCancelInterrupted = false; };
      for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) dem.addEventListener(name, capture);
      dem.addEventListener('keydown', e => {
        if (!['Enter', ' '].includes(e.key)) return;
        if (e.repeat) { e.preventDefault(); roadCancelInterrupted = true; } else capture();
      });
      dem._roadCancelInterrupt = () => { roadCancelInterrupted = true; };
      for (const name of ['pointercancel', 'touchcancel', 'blur']) dem.addEventListener(name, dem._roadCancelInterrupt);
      if (!this._roadCancelBlurBound) {
        this._roadCancelBlurBound = true;
        window.addEventListener('blur', () => this.el.info?.querySelector?.('#info-demolish')?._roadCancelInterrupt?.());
      }
    }
    if (dem) dem.addEventListener('click', e => {
      if (renderedType === 'roadwork' && (roadCancelInterrupted || e?.detail > 1)) return;
      // A stale cancel-site button must never remove a newly completed building.
      if (!G.sel || G.sel.kind !== 'b' || G.world !== w || G.game !== renderedGame || this.el.info !== el ||
          w.bmap[G.sel.id] !== selected || selected.state !== renderedState || selected.type !== renderedType ||
          dem.disabled || el.querySelector('#info-demolish') !== dem || (el.classList.contains && el.classList.contains('hidden')) ||
          (G.hasOpenModal && G.hasOpenModal())) {
        this.renderInfo();
        return;
      }
      G.removeBuilding(selected);
    });
  },
  economyStatus: function (b) {
    if (G.productionLimited(b) && G.buildingGoalStatus(b)) return G.buildingGoalStatus(b);
    if (b.type === 'tradingpost') return b.merchant && b.merchant.leaveDay > G.game.day ? '商船停靠，可交易' : b.workers.length ? '等待商船，商人按目标搬运备货' : '等待商人岗位分配';
    if (b.type === 'pasture') return G.pastureSummary(b).status;
    if(b.type==='orchard')return G.orchardSummary(b).status;
    return '';
  },

  economyInfoMarkup: function (b) {
    if (b.type === 'tradingpost' && G.TRADE_VALUES && G.TRADE_GOODS && G.setTradeTarget && G.executeTrade) {
      const payments = Object.keys(G.TRADE_VALUES).map(type => `<option value="${type}"${type === 'firewood' ? ' selected' : ''}>${G.RES[type].name}（价值 ${G.TRADE_VALUES[type]}）</option>`).join('');
      const goods = Object.keys(G.TRADE_GOODS).map(type => `<option value="${type}">${this.escHtml(G.TRADE_GOODS[type].name)}</option>`).join('');
      const profile = G.merchantProfile ? G.merchantProfile(b) : null;
      const orderGoods = profile ? profile.goods.map(type => `<option value="${type}">${this.escHtml(G.TRADE_GOODS[type].name)}</option>`).join('') : '<option value="">等待商船停靠</option>';
      return `<section class="economy-details" data-economy="tradingpost">
        <p class="row" data-economy-live="merchant"></p><p class="row" data-economy-live="merchant-payments"></p><p class="row" data-economy-live="trade-capacity"></p>
        <details class="trade-inventory"><summary>查看待售库存与目标</summary><p data-economy-live="inventory"></p></details>
        <details class="building-task"><summary>备货与搬回</summary><form id="trade-target-form" class="economy-form">
          <h3>① 备货 / 搬回</h3>
          <label for="trade-target-resource">资源</label><select id="trade-target-resource">${payments}</select>
          <p data-economy-live="target-stock"></p>
          <label for="trade-target-quantity">待售目标（0–2000）</label><input id="trade-target-quantity" type="number" min="0" max="2000" step="1" value="${Number(b.tradeTargets && b.tradeTargets.firewood) || 0}" inputmode="numeric">
          <div class="economy-actions"><button type="submit">应用待售目标</button><button type="button" id="trade-return-stock">设为 0 搬回</button></div>
          <p class="desc">商人从仓库搬货，不会凭空增加库存。所有待售物资共享本站容量，居民不能使用；调低目标后由商人运回仓库。</p>
        </form></details>
        <details class="building-task"><summary>与当前商船交易</summary><form id="trade-exchange-form" class="economy-form">
          <h3>② 与商船交易</h3>
          <label for="trade-good">购买</label><select id="trade-good">${goods}</select>
          <label for="trade-buy-quantity">数量</label><input id="trade-buy-quantity" type="number" min="1" max="400" step="1" value="1" inputmode="numeric">
          <label for="trade-payment">用一种待售物资支付</label><select id="trade-payment">${payments}</select>
          <p data-economy-live="quote" class="trade-quote" role="status" aria-live="polite"></p>
          <button type="submit" id="trade-execute">确认交易</button>
          <p class="desc">付款数量向上取整，不找零。买入普通物资先进入本站库存，低于现存数量的待售目标会让商人搬回；肉类与鸡蛋可分别买卖，鸡蛋价值2，肉类价值1；羊、牛或鸡购入后进入各自待安置数量，到同种牧场放入。旧通用果树、苹果、梨、卷心菜与早熟豆类种子分别买 1 次永久解锁，不能复购，不是库存物品，也不占贸易站或仓库容量。苹果、梨种子各2500，购买后到果园明确选择以后种植品种；旧通用果树继续产蔬菜，不解锁苹果或梨。卷心菜和早熟豆类解锁后到农田选择种植，产出都计入蔬菜。</p>
        </form></details>
        <details class="building-task"><summary>下次到货订单</summary><form id="trade-order-form" class="economy-form">
          <h3>③ 向这位商人订货</h3>
          <p data-economy-live="merchant-order"></p>
          <p data-economy-live="merchant-orders"></p>
          <label for="trade-order-good">下次由同一商人带来</label><select id="trade-order-good">${orderGoods}</select>
          <label for="trade-order-quantity">订货数量</label><input id="trade-order-quantity" type="number" min="1" max="400" step="1" value="1" inputmode="numeric" aria-describedby="trade-order-note">
          <p data-economy-live="order-quote" role="status" aria-live="polite"></p>
          <div class="economy-actions"><button type="submit" id="trade-order-confirm">确认一次订货</button><button type="button" id="trade-order-cancel">取消待到货订单</button></div>
          <p class="desc" id="trade-order-note">订单本身无需预付款，不会自动交易。每站每位商人只保留一份一次性订单；只能在该商人停靠时替换或取消。订单在同一商人下次到达时带来并清除，下一艘船可能是别的商人。到货单价为原价 × 1.25 向下取整，须手动支付购买（另行启用下方自动购买时会按规则检查）；其他货物仍按普通价。未买货物会随船离开。</p>
        </form></details>
        ${this.autoTradeInfoMarkup(b)}
        <p class="economy-message" data-economy-message role="status" aria-live="polite"></p>
      </section>`;
    }
    if (b.type === 'pasture' && G.stockPasture && G.setPastureTarget) return `<section class="economy-details" data-economy="pasture">
      <p class="row" data-economy-live="pasture-area"></p><p class="desc" data-economy-live="pasture-capacity-rule"></p><p class="desc" data-economy-live="pasture-cattle-warning"></p>
      <p class="row" data-economy-live="animals"></p><p class="row" data-economy-live="pasture-production"></p><p class="row" data-economy-live="pasture-stock"></p><p class="desc" data-economy-live="pasture-logistics"></p>
      <details class="building-task"><summary>牧场疫病设置</summary>${this.pasturePestsMarkup()}</details>
      <details class="building-task"><summary>选择牲畜种类</summary><form id="pasture-type-form" class="economy-form"><h3>空场选择物种</h3><label for="pasture-type">羊、牛或鸡（不能混养）</label><select id="pasture-type"><option value="sheep"${G.pastureTypeOf(b)==='sheep'?' selected':''}>羊：肉、羊毛</option><option value="cattle"${G.pastureTypeOf(b)==='cattle'?' selected':''}>牛：肉、皮革</option><option value="chicken"${G.pastureTypeOf(b)==='chicken'?' selected':''}>鸡：鸡蛋、肉</option></select><button type="submit" id="pasture-type-apply">应用物种</button><p data-economy-live="pasture-switch"></p></form></details>
      <details class="building-task"><summary>放入已购牲畜</summary><form id="pasture-stock-form" class="economy-form"><h3>放入已购同种牲畜</h3><p data-economy-live="sheep-bank"></p>
        <label for="pasture-stock-quantity">放入数量</label><input id="pasture-stock-quantity" type="number" min="1" max="${G.pastureCapacity(b, G.pastureTypeOf(b))}" step="1" value="2" inputmode="numeric"><button type="submit" id="pasture-stock">放入牧场</button></form></details>
      <details class="building-task"><summary>繁殖与保留数量</summary><form id="pasture-target-form" class="economy-form"><h3>繁殖与保留数量</h3><label for="pasture-target-quantity" data-economy-live="pasture-target-range"></label><input id="pasture-target-quantity" type="number" min="2" max="${G.pastureCapacity(b, G.pastureTypeOf(b))}" step="1" value="${Number(b.animalTarget) || 8}" inputmode="numeric"><button type="submit">应用保留数量</button>
        <p class="desc" data-economy-live="pasture-rule"></p><p class="desc">至少2只/头同种牲畜且牧人实际照料才繁殖。保留数只控制超额屠宰。新建固定6×6牧场采用原版容量；已建面积牧场保留各自容量；鸡蛋独立库存，与肉类同属一个营养组。产物逐批实背送仓后才可使用，库存满则保留；牧场内待送产物未搬空不能拆场。</p></form></details>
      <details class="building-task"><summary>分群扩场</summary><section data-pasture-split><h3>分群扩场</h3>
        <label for="pasture-split-target">同种空牧场（确认时检查通路）</label><select id="pasture-split-target"></select>
        <p class="desc" data-pasture-split-status></p>
        <div class="economy-actions"><button type="button" id="pasture-split-start">查看分群方案</button></div>
        <div class="hidden" data-pasture-split-confirm role="group" aria-label="确认牲畜分群"><p class="desc" data-pasture-split-quote></p><div class="economy-actions"><button type="button" id="pasture-split-confirm">确认分群</button><button type="button" id="pasture-split-cancel">取消</button></div></div>
        <p class="desc">满10只/头后可分出一半到同种空场。沿用按畜群数量直接安置的规则，不模拟逐头赶路；两场必须连通。保留量与工人不自动调整，新场需牧人实际照料。已产鸡蛋、未成蛋进度、羊毛、肉皮和在途货留原场。</p>
      </section>
      </details><details class="building-task"><summary>整群搬空</summary>${this.pastureEmptyMarkup()}</details>
      <p class="economy-message" data-economy-message role="status" aria-live="polite"></p>
    </section>`;
    if(b.type==='orchard')return `<section class="economy-details" data-economy="orchard">
      <p data-economy-live="orchard-area"></p><p class="desc" data-economy-live="orchard-area-rule"></p><p data-economy-live="orchard-age"></p><p data-economy-live="orchard-harvest"></p><p data-economy-live="orchard-renewal"></p>
      <p data-economy-live="orchard-types"></p><p data-economy-live="orchard-stock"></p><p data-economy-live="orchard-logistics"></p>
      <details class="building-task"><summary>以后种植品种</summary><form id="orchard-type-form" class="economy-form"><label for="orchard-type">以后空位种植品种</label><select id="orchard-type">${Object.entries(G.ORCHARD_TYPES).map(([type, def]) => `<option value="${type}"${G.orchardTypeOf(b) === type ? ' selected' : ''}${!G.game.unlocks?.[def.unlock] ? ' disabled' : ''}>${this.escHtml(def.name)} → ${G.RES[def.output].name}${!G.game.unlocks?.[def.unlock] ? '（尚未解锁）' : ''}</option>`).join('')}</select><div class="economy-actions"><button type="submit" id="orchard-type-apply">应用以后种植品种</button><button type="button" id="orchard-type-cancel">取消未应用选择</button></div><p data-economy-live="orchard-selection"></p></form></details>
      <details class="building-task"><summary>补种设置</summary><form id="orchard-replant-form" class="economy-form"><label for="orchard-replant">空位补种</label><select id="orchard-replant"><option value="on"${b.orchardReplant!==false?' selected':''}>允许农夫补种</option><option value="off"${b.orchardReplant===false?' selected':''}>暂停新补种</option></select><button type="submit">应用补种设置</button></form></details>
      <details class="building-help"><summary>果树生长与品种规则</summary>      <p class="desc">苹果和梨种子各2500，分别购买一次永久解锁；购买后仍需在此明确应用，只改变以后新接的种植任务。旧通用果树种子仅解锁旧通用树，继续产蔬菜，不赠苹果、梨或新种子。已有树的品种、年龄、待采果实和已接任务/在途货不改换；买新果种不必先买通用种子。</p>
      <p class="desc">苹果与梨独立存量、贸易和生产目标；实际送仓后可食用或酿酒。营养都归蔬菜组，与肉类（含鸡蛋）、主食合为三组，不增加第四组。</p>
      <p class="desc">每株由农夫实际到达后种植、照料或采收。秋季先采果，再种空位和养幼树；暂停补种只影响新任务，已开始的单株工作照常完成。4年有效养护成熟，每株每秋最多20果，搬运后才入库；满仓携果保留，冬季未采果损失。</p>
      <p class="desc">树龄达到12–20年时按株错峰枯尽，届时该株未采果实一起损失（不计为已产出）；一年内将枯尽会预警，应优先采收。补种重新养4年。本作适配寿命，不是原版精确数值。旧成熟园从4岁迁移，至少还有8年宽限；不影响已有在途果实。</p>
      </details><details class="building-help"><summary>逐株树龄与产量</summary><p class="desc" data-economy-live="orchard-trees" style="white-space:pre-line"></p></details><p class="economy-message" data-economy-message role="status" aria-live="polite"></p>
    </section>`;
    return '';
  },

  initEconomyInfo: function (b) {
    const el = this.el.info, w = G.world, g = G.game, buildingType = b.type;
    const panel = el.querySelector && el.querySelector('[data-economy]');
    if (!panel) return;
    const valid = node => G.world === w && G.game === g && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel && G.sel.kind === 'b' && G.sel.id === b.id && w.bmap[b.id] === b && b.type === buildingType && b.state === 'ok' &&
      el.querySelector('[data-economy]') === panel && (!node || !node.id || el.querySelector('#' + node.id) === node);
    const message = text => { const node = el.querySelector('[data-economy-message]'); if (node) node.textContent = text; };
    const onSubmit = (id, callback) => {
      const form = el.querySelector('#' + id); if (form) form.addEventListener('submit', e => { e.preventDefault(); if (!valid(form) || (G.hasOpenModal && G.hasOpenModal())) return; callback(); this.refreshEconomyInfo(b); });
    };
    if (b.type === 'tradingpost') {
      const renderedMerchant = b.merchant;
      panel._merchant = renderedMerchant;
      const sameMerchant = () => {
        if (b.merchant === renderedMerchant) return true;
        this.renderInfo(true);
        return false;
      };
      const target = el.querySelector('#trade-target-resource'), quantity = el.querySelector('#trade-target-quantity');
      target.addEventListener('change', () => { if (!valid(target)) return; quantity.value = Number(b.tradeTargets && b.tradeTargets[target.value]) || 0; this.refreshEconomyInfo(b); });
      onSubmit('trade-target-form', () => {
        const qty = quantity.value.trim() === '' ? NaN : Number(quantity.value);
        message(G.setTradeTarget(b, target.value, qty) ? `${G.RES[target.value].name}待售目标已设为 ${qty}，由商人搬运。` : '请输入 0–2000 的整数。');
      });
      const returnStock = el.querySelector('#trade-return-stock');
      returnStock.addEventListener('click', () => {
        if (!valid(returnStock) || (G.hasOpenModal && G.hasOpenModal())) return;
        if (G.setTradeTarget(b, target.value, 0)) { quantity.value = '0'; message(`${G.RES[target.value].name}目标已设为 0，商人会把本站余货搬回仓库。`); }
        this.refreshEconomyInfo(b);
      });
      for (const id of ['trade-good', 'trade-buy-quantity', 'trade-payment']) {
        const input = el.querySelector('#' + id);
        input.addEventListener('input', () => { if (valid(input)) this.refreshEconomyInfo(b); });
      }
      onSubmit('trade-exchange-form', () => {
        if (!sameMerchant()) return;
        const quote = this.tradeQuote(b);
        if (!quote.ok) { message(quote.reason); return; }
        const result = G.executeTrade(b, quote.good, quote.qty, quote.payment, renderedMerchant);
        const seed = G.seedUnlockKey ? G.seedUnlockKey(quote.good) : quote.good === 'orchardSeed' ? 'orchard' : null;
        const orchardType = Object.values(G.ORCHARD_TYPES).find(type => type.unlock === seed);
        message(result.ok ? `已购买${G.TRADE_GOODS[quote.good].name} × ${quote.qty}，支付${G.RES[quote.payment].name} × ${result.paid}。${G.isLivestockType(quote.good) ? `到${G.TRADE_GOODS[quote.good].name}牧场放入，不能混养。` : orchardType ? `已永久解锁${orchardType.name}，请到果园明确选择以后种植品种；已有树和在途果实保留。种子不占仓位。` : seed && G.CROPS[seed] ? `所有农田已永久解锁${G.CROPS[seed].name}，请到农田选择；本季已开始的作物保留，改选留到下一春。种子不占仓位。` : '物资已到本站，等待商人按目标搬回仓库。'}` : result.reason || '交易未完成。');
        this.refreshHUD();
      });
      for (const id of ['trade-order-good', 'trade-order-quantity']) {
        const input = el.querySelector('#' + id);
        input.addEventListener('input', () => { if (valid(input)) this.refreshEconomyInfo(b); });
      }
      onSubmit('trade-order-form', () => {
        if (!sameMerchant()) return;
        const quote = this.merchantOrderQuote(b);
        if (!quote.ok) { message(quote.reason); return; }
        const result = G.orderMerchantGoods(b, quote.good, quote.qty, renderedMerchant);
        message(result.ok ? `已向${G.merchantProfile(b).name}订${G.TRADE_GOODS[quote.good].name} × ${quote.qty}，无需预付款；由同一商人下次带来，${b.autoTrade?.enabled ? '到货后可手动交易；已启用的自动购买会另按规则检查。' : '到货后需手动交易。'}` : result.reason || '订货未完成。');
      });
      const cancelOrder = el.querySelector('#trade-order-cancel');
      cancelOrder.addEventListener('click', () => {
        if (!valid(cancelOrder) || (G.hasOpenModal && G.hasOpenModal()) || !sameMerchant()) return;
        const result = G.cancelMerchantOrder(b, renderedMerchant);
        message(result.ok ? '已取消这位商人的待到货订单；未扣除任何待售物资。' : result.reason || '没有可取消的订单。');
        this.refreshEconomyInfo(b);
      });
      this.initAutoTradeInfo(b);
    }
    if(b.type==='orchard') {
      onSubmit('orchard-replant-form',()=>{const value=el.querySelector('#orchard-replant').value;message(['on','off'].includes(value)&&G.setOrchardReplant(b,value==='on')?value==='on'?'允许新补种；需农夫到空树位劳动。':'已暂停新补种；现果、养护与已开始的工作继续。':'补种设置无效');});
      const form = el.querySelector('#orchard-type-form'), select = el.querySelector('#orchard-type');
      const cancel = el.querySelector('#orchard-type-cancel'), apply = el.querySelector('#orchard-type-apply');
      for (const node of [form, select, cancel, apply]) node.addEventListener('keydown', e => {
        if (e.repeat && ['Enter', ' '].includes(e.key)) e.preventDefault();
      });
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (e.repeat || !valid(form) || !valid(select) || !valid(apply) || panel.querySelector('#orchard-type-form') !== form || panel.querySelector('#orchard-type') !== select || panel.querySelector('#orchard-type-apply') !== apply || G.hasOpenModal?.()) return;
        const type = select.value;
        if (type === G.orchardTypeOf(b)) { message('以后种植品种已是此选择；已有果树继续。'); return; }
        message(G.setOrchardType(b, type) ? `以后新接种植任务使用${G.ORCHARD_TYPES[type].name}；已有果树、已接任务和在途果实保留。` : '品种未更改，请先在贸易站购买对应种子并选择已解锁品种。');
        this.refreshEconomyInfo(b);
      });
      cancel.addEventListener('click', e => {
        if (e.detail > 1 || !valid(cancel) || !valid(select) || panel.querySelector('#orchard-type-cancel') !== cancel || panel.querySelector('#orchard-type') !== select || G.hasOpenModal?.()) return;
        select.value = G.orchardTypeOf(b); select.focus(); message('已取消未应用的种植品种选择。');
      });
    }
    if (b.type === 'pasture') {
      onSubmit('pasture-type-form',()=>{const type=el.querySelector('#pasture-type').value;message(G.setPastureType(b,type)?`牧场物种已设为${G.LIVESTOCK[type].name}；下一次放入只接收该物种。`:G.pastureSwitchReason(b)||'物种选择无效');});
      onSubmit('pasture-stock-form', () => {
        const qty = Number(el.querySelector('#pasture-stock-quantity').value);
        const d=G.pastureSummary(b),unit=d.type==='chicken'?'只':'头';message(G.stockPasture(b, qty, d.type) ? `已放入 ${qty} ${unit}${d.name}。` : G.pasturePestSummary&&G.pasturePestSummary(b).active ? '本场正在染疫，不能继续放入牲畜；请先整群搬空到同种备用场。' : `无法放入：请检查整数数量、待安置${d.name}数及${d.cap}${unit}容量。`);
      });
      onSubmit('pasture-target-form', () => {
        const qty = Number(el.querySelector('#pasture-target-quantity').value);
        message(G.setPastureTarget(b, qty) ? `保留数量已设为 ${qty} ${G.pastureTypeOf(b)==='chicken'?'只':'头'}，超出部分由牧人屠宰。` : `请输入 2–${G.pastureSummary(b).cap} 的整数。`);
      });
      this.initPastureSplit(b);
      this.initPasturePests(b);
      this.initPastureEmpty(b);
    }
    this.refreshEconomyInfo(b);
  },

  resetPastureConfirmations: function () {
    const el = this.el.info; if (!el?.querySelector) return null;
    let focus = null;
    for (const [kind, field, action] of [['pests', '_pestEnable', 'toggle'], ['empty', '_emptyQuote', 'start']]) {
      const panel = el.querySelector(`[data-pasture-${kind}]`); if (!panel) continue;
      const box = panel.querySelector(`[data-pasture-${kind}-confirm]`), start = panel.querySelector(`#pasture-${kind}-${action}`);
      if (box?.contains(document.activeElement)) focus = start;
      panel[field] = null; box?.classList.add('hidden'); start?.setAttribute('aria-expanded', 'false');
    }
    return focus;
  },
  pasturePestsMarkup: function () {
    if (!G.pasturePestSummary || !G.pasturePestsToggleQuote || !G.setPasturePests) return '';
    const p = G.PASTURE_PESTS;
    return `<section data-pasture-pests><h3>可选牧场疫病</h3>
      <p class="row" data-pasture-pests-status></p><p class="row" data-pasture-pests-field role="status" aria-live="polite"></p>
      <div class="economy-actions"><button type="button" id="pasture-pests-toggle" aria-describedby="pasture-pests-note" aria-expanded="false">开启全镇牧场疫病…</button></div>
      <p class="desc" id="pasture-pests-note">独立于农田虫害的可选全镇规则，新局和旧档默认关闭。开启后有${p.graceDays}天宽限；之后按每场每天${p.baseChance * 100}%的基础概率检查染疫，全镇最多${p.maxActive}座牧场同时染疫。感染预警${p.warningDays}天后，每天最多病死${p.lossPerDay}只/头，病死不产肉、皮或蛋。染疫活畜不能通过拆场消除，也不能继续放入新畜；整群搬空可清除源场疫病。关闭会清除活动疫病，已病死牲畜不返还。</p>
      <div class="hidden" data-pasture-pests-confirm role="group" aria-label="确认开启全镇牧场疫病">
        <p class="desc" data-pasture-pests-quote></p><div class="economy-actions"><button type="button" id="pasture-pests-confirm">确认全镇开启</button><button type="button" id="pasture-pests-cancel">保持关闭</button></div>
      </div>
    </section>`;
  },
  pastureEmptyMarkup: function () {
    if (!G.pastureEmptyFacts || !G.pastureEmptyQuote || !G.emptyPasture) return '';
    return `<section data-pasture-empty><h3>整群搬空</h3>
      <label for="pasture-empty-target">同种备用空牧场（确认时检查通路与容量）</label><select id="pasture-empty-target"></select>
      <p class="desc" data-pasture-empty-status></p><div class="economy-actions"><button type="button" id="pasture-empty-start" aria-expanded="false">查看整群搬空方案</button></div>
      <div class="hidden" data-pasture-empty-confirm role="group" aria-label="确认整群搬空"><p class="desc" data-pasture-empty-quote></p><div class="economy-actions"><button type="button" id="pasture-empty-confirm">确认整群搬空</button><button type="button" id="pasture-empty-cancel">取消</button></div></div>
      <p class="desc">有1只/头即可整群搬空；这与满10只/头才能分群是独立操作。目标须是另一座同种已建成、空置、容量足够且可达的牧场；没有合适目标时请先建同种备用场。源场归零后清除疫病，目标需重新实际照料。按畜群数量直接安置，不模拟逐头赶路；不移动已产鸡蛋、未成蛋进度、羊毛、肉皮、携货和工人。两场保留量不变，超过目标保留量时会正常屠宰。</p>
    </section>`;
  },
  pastureActionValid: function (b, el, w, g, panel, selector, controls) {
    return G.world === w && G.game === g && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel?.kind === 'b' && G.sel.id === b.id && w.bmap[b.id] === b && b.type === 'pasture' && b.state === 'ok' &&
      el.querySelector(selector) === panel && controls.every(([id, node]) => panel.querySelector(id) === node) &&
      !(G.hasOpenModal && G.hasOpenModal());
  },
  refreshPasturePests: function (b) {
    const el = this.el.info, panel = el.querySelector('[data-pasture-pests]');
    if (!panel || !G.pasturePestSummary) return;
    const toggle = panel.querySelector('#pasture-pests-toggle'), box = panel.querySelector('[data-pasture-pests-confirm]');
    const p = G.pasturePestSummary(b), pending = panel._pestEnable;
    const set = (selector, text) => { const node = panel.querySelector(selector); if (node && node.textContent !== text) node.textContent = text; };
    set('[data-pasture-pests-status]', p.enabled ? `全镇牧场疫病：已开启${p.graceLeft > 0 ? ` · 宽限还剩 ${p.graceLeft} 天` : ''}` : '全镇牧场疫病：已关闭');
    set('[data-pasture-pests-field]', `本场疫病：${p.status}${p.active ? ` · 本次已病死 ${p.lost} ${G.pastureTypeOf(b) === 'chicken' ? '只' : '头'}。请用下方整群搬空；染疫活畜不能拆除或继续放入新畜。` : ''}`);
    const demolish = el.querySelector('#info-demolish');
    if (demolish) { demolish.disabled = !!p.active; demolish.title = p.active ? '染疫活畜不能拆除，请先整群搬空到同种备用场。' : ''; }
    const label = p.enabled ? '关闭全镇牧场疫病' : '开启全镇牧场疫病…';
    if (toggle.textContent !== label) toggle.textContent = label;
    if (pending) {
      const q = G.pasturePestsToggleQuote(true);
      if (!panel._pestValid() || pending.settings !== G.game.pasturePests || p.enabled || !q.ok || pending.key !== q.key) {
        const focused = box.contains(document.activeElement), valid = panel._pestValid();
        panel._pestEnable = null; box.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false');
        if (valid) {
          const msg = el.querySelector('[data-economy-message]');
          if (msg) msg.textContent = '日期、畜群或疫病设置已变，请重新查看开启风险。';
          if (focused && toggle.focus) toggle.focus();
        }
      }
    }
  },
  initPasturePests: function (b) {
    const el = this.el.info, w = G.world, g = G.game, panel = el.querySelector('[data-pasture-pests]');
    if (!panel) return;
    const toggle = panel.querySelector('#pasture-pests-toggle'), confirm = panel.querySelector('#pasture-pests-confirm'), cancel = panel.querySelector('#pasture-pests-cancel');
    const box = panel.querySelector('[data-pasture-pests-confirm]'), quote = panel.querySelector('[data-pasture-pests-quote]'), msg = el.querySelector('[data-economy-message]');
    const reset = () => { panel._pestEnable = null; box.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false'); };
    panel._detailReset = reset;
    const controls = [['#pasture-pests-toggle', toggle], ['#pasture-pests-confirm', confirm], ['#pasture-pests-cancel', cancel]];
    const valid = () => this.pastureActionValid(b, el, w, g, panel, '[data-pasture-pests]', controls);
    panel._pestValid = valid; reset();
    // Holding a key must not follow focus from the risk preview into confirmation.
    for (const button of [toggle, confirm, cancel]) button.addEventListener('keydown', e => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
    toggle.addEventListener('click', e => {
      if (!valid() || e.detail > 1) { reset(); return; }
      const enabled = !G.pasturePestSummary(b).enabled, q = G.pasturePestsToggleQuote(enabled);
      reset();
      if (!q.ok) { if (msg) msg.textContent = q.reason; return; }
      if (!enabled) {
        const accepted = G.setPasturePests(false, q.key, g);
        if (msg) msg.textContent = accepted ? `已关闭全镇牧场疫病，清除${q.active}座牧场的活动疫病；已病死牲畜不返还，已有产物和携货保留。` : '设置已变，请重新查看后操作。';
        this.refreshEconomyInfo(b); return;
      }
      const p = G.PASTURE_PESTS;
      panel._pestEnable = { key: q.key, settings: g.pasturePests };
      quote.textContent = `确认给全镇所有牧场开启疫病？先有${q.graceDays}天宽限，之后按每场每天${p.baseChance * 100}%的基础概率检查染疫，最多${p.maxActive}场同时活动。染疫预警${p.warningDays}天后每天最多病死${p.lossPerDay}只/头，病死不产肉、皮或蛋，损失不返还。需同种可达备用空场才能整群搬空消疫；目标容量须足够，保留量不自动提高，超过时会正常屠宰。这些天数、损失和上限为本作适配数值。`;
      box.classList.remove('hidden'); toggle.setAttribute('aria-expanded', 'true'); if (confirm.focus) confirm.focus();
    });
    cancel.addEventListener('click', () => { reset(); if (valid() && toggle.focus) toggle.focus(); });
    confirm.addEventListener('click', e => {
      const pending = panel._pestEnable;
      if (!valid() || !pending || pending.settings !== g.pasturePests || e.detail > 1) { reset(); return; }
      const q = G.pasturePestsToggleQuote(true); reset();
      const accepted = q.ok && q.key === pending.key && G.setPasturePests(true, pending.key, g);
      if (msg) msg.textContent = accepted ? `已开启全镇牧场疫病，先有${q.graceDays}天宽限；请准备同种备用空场应对染疫。` : '日期、畜群或疫病设置已变，请重新查看开启风险。';
      this.refreshEconomyInfo(b); if (toggle.focus) toggle.focus();
    });
  },
  refreshPastureEmpty: function (b) {
    const el = this.el.info, panel = el.querySelector('[data-pasture-empty]');
    if (!panel || !G.pastureEmptyFacts) return;
    const select = panel.querySelector('#pasture-empty-target'), start = panel.querySelector('#pasture-empty-start'), box = panel.querySelector('[data-pasture-empty-confirm]'), status = panel.querySelector('[data-pasture-empty-status]');
    const options = this.pastureSplitOptions(b), signature = options.map(x => x.id + ':' + G.pastureTypeOf(x)).join(',');
    if (panel._emptyOptions !== signature) {
      const previous = select.value;
      select.innerHTML = options.length ? options.map(x => `<option value="${x.id}">牧场 #${x.id}（${x.x},${x.y}）</option>`).join('') : '<option value="">没有同种已建成空场</option>';
      select.value = options.some(x => String(x.id) === previous) ? previous : options.length ? String(options[0].id) : '';
      panel._emptyOptions = signature;
    }
    const target = G.world.bmap[Number(select.value)], q = G.pastureEmptyFacts(b, target), unit = G.pastureTypeOf(b) === 'chicken' ? '只' : '头';
    start.disabled = !q.ok;
    const text = q.ok ? `本场${q.qty}${unit}全部搬出，源场留下0${unit}并清除疫病。目标保留${q.targetTarget}${unit}，超过时会正常屠宰；查看和确认时检查通路。` : `${q.reason}。${b.animals > 0 ? '请准备同种已建成、容量足够且可达的备用空场。' : ''}`;
    if (status.textContent !== text) status.textContent = text;
    const pending = panel._emptyQuote;
    if (pending && (!panel._emptyValid() || pending.target !== target || !q.ok || pending.key !== q.key)) {
      const focused = box.contains(document.activeElement), valid = panel._emptyValid();
      panel._emptyQuote = null; box.classList.add('hidden'); start.setAttribute('aria-expanded', 'false');
      if (valid) {
        const msg = el.querySelector('[data-economy-message]');
        if (msg) msg.textContent = '畜群、日期、疫病或通路已变，请重新查看整群搬空方案。';
        const focus = q.ok ? start : el.querySelector('#info-close'); if (focused && focus?.focus) focus.focus();
      }
    }
  },
  initPastureEmpty: function (b) {
    const el = this.el.info, w = G.world, g = G.game, panel = el.querySelector('[data-pasture-empty]');
    if (!panel) return;
    const select = panel.querySelector('#pasture-empty-target'), start = panel.querySelector('#pasture-empty-start'), confirm = panel.querySelector('#pasture-empty-confirm'), cancel = panel.querySelector('#pasture-empty-cancel');
    const box = panel.querySelector('[data-pasture-empty-confirm]'), quote = panel.querySelector('[data-pasture-empty-quote]'), msg = el.querySelector('[data-economy-message]');
    const reset = () => { panel._emptyQuote = null; box.classList.add('hidden'); start.setAttribute('aria-expanded', 'false'); };
    panel._detailReset = reset;
    const controls = [['#pasture-empty-target', select], ['#pasture-empty-start', start], ['#pasture-empty-confirm', confirm], ['#pasture-empty-cancel', cancel]];
    const valid = () => this.pastureActionValid(b, el, w, g, panel, '[data-pasture-empty]', controls);
    panel._emptyValid = valid; reset();
    for (const button of [start, confirm, cancel]) button.addEventListener('keydown', e => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
    select.addEventListener('change', () => { reset(); if (valid()) this.refreshPastureEmpty(b); });
    start.addEventListener('click', e => {
      if (!valid() || e.detail > 1) { reset(); return; }
      const target = w.bmap[Number(select.value)], q = G.pastureEmptyQuote(b, target); reset();
      if (!q.ok) { if (msg) msg.textContent = `${q.reason}；请准备同种已建成、容量足够且可达的备用空场。`; return; }
      const unit = q.type === 'chicken' ? '只' : '头'; panel._emptyQuote = { key: q.key, target };
      quote.textContent = `将全部${q.qty}${unit}${G.LIVESTOCK[q.type].name}直接安置到牧场 #${target.id}（${target.x},${target.y}），本场归零并清除疫病；不模拟逐头赶路。总数量不增加，繁殖进度守恒。目标保留量仍为${q.targetTarget}${unit}${q.qty > q.targetTarget ? `，搬入后超出${q.qty - q.targetTarget}${unit}，会由牧人正常屠宰` : '，以后超额仍会正常屠宰'}；需重新实际照料。已产鸡蛋、未成蛋进度、羊毛、肉皮、携货和工人均不随畜群搬移，携货继续沿原任务送仓。`;
      box.classList.remove('hidden'); start.setAttribute('aria-expanded', 'true'); if (confirm.focus) confirm.focus();
    });
    cancel.addEventListener('click', () => { reset(); if (valid() && start.focus) start.focus(); });
    confirm.addEventListener('click', e => {
      const pending = panel._emptyQuote;
      if (!valid() || !pending || e.detail > 1) { reset(); return; }
      const target = w.bmap[Number(select.value)], q = G.pastureEmptyQuote(b, target); reset();
      const result = pending.target === target && q.ok && pending.key === q.key ? G.emptyPasture(b, target, pending.key) : { ok: false, reason: '畜群、日期、疫病或通路已变，请重新查看整群搬空方案。' };
      if (msg) msg.textContent = result.ok ? `已将全部${result.qty}${result.type === 'chicken' ? '只' : '头'}${G.LIVESTOCK[result.type].name}搬入牧场 #${target.id}，源场归零并清除疫病；请检查目标保留量与用工，已有产物和携货不随畜群搬移。` : result.reason;
      this.refreshEconomyInfo(b);
      const focus = start.disabled ? el.querySelector('#info-close') : start; if (focus?.focus) focus.focus();
    });
  },

  pastureSplitOptions:function(b){return G.world.buildings.filter(x=>x!==b&&x.type==='pasture'&&x.state==='ok'&&G.pastureTypeOf(x)===G.pastureTypeOf(b)&&!(x.animals>0));},
  refreshPastureSplit:function(b){
    const el=this.el.info,panel=el.querySelector('[data-pasture-split]');if(!panel)return;
    const select=panel.querySelector('#pasture-split-target'),start=panel.querySelector('#pasture-split-start'),box=panel.querySelector('[data-pasture-split-confirm]'),status=panel.querySelector('[data-pasture-split-status]');if(!select||!start||!box||!status)return;
    const options=this.pastureSplitOptions(b),signature=options.map(x=>x.id+':'+G.pastureTypeOf(x)).join(',');
    if(panel._splitOptions!==signature){const previous=select.value;select.innerHTML=options.length?options.map(x=>`<option value="${x.id}">牧场 #${x.id}（${x.x},${x.y}）</option>`).join(''):'<option value="">没有同种已建成空场</option>';select.value=options.some(x=>String(x.id)===previous)?previous:options.length?String(options[0].id):'';panel._splitOptions=signature;}
    const target=G.world.bmap[Number(select.value)],q=G.pastureSplitFacts(b,target);start.disabled=!q.ok;
    const unit=G.pastureTypeOf(b)==='chicken'?'只':'头';
    status.textContent=q.ok?`本场${q.sourceCount}${unit}，可分${q.qty}${unit}，留下${q.left}${unit}种畜。新场按现有保留量${target.animalTarget||8}${unit}运行；实际连通性在查看与确认时检查。`:q.reason;
    if(panel._splitQuote&&(!q.ok||q.key!==panel._splitQuote.key||(G.hasOpenModal&&G.hasOpenModal()))){panel._splitQuote=null;box.classList.add('hidden');const msg=el.querySelector('[data-economy-message]');if(msg&&!(G.hasOpenModal&&G.hasOpenModal()))msg.textContent='畜群、保留量或通路已变，请重新查看分群方案。';if(box.contains&&box.contains(document.activeElement)&&!(G.hasOpenModal&&G.hasOpenModal())){const focus=q.ok?start:el.querySelector('#info-close');if(focus&&focus.focus)focus.focus();}}
  },
  initPastureSplit:function(b){
    const el=this.el.info,w=G.world,g=G.game,panel=el.querySelector('[data-pasture-split]');if(!panel)return;
    const select=panel.querySelector('#pasture-split-target'),start=panel.querySelector('#pasture-split-start'),confirm=panel.querySelector('#pasture-split-confirm'),cancel=panel.querySelector('#pasture-split-cancel'),box=panel.querySelector('[data-pasture-split-confirm]'),quote=panel.querySelector('[data-pasture-split-quote]'),msg=el.querySelector('[data-economy-message]');
    if(!select||!start||!confirm||!cancel||!box||!quote)return;
    const reset=()=>{panel._splitQuote=null;box.classList.add('hidden');};panel._detailReset=reset;reset();
    const valid=()=>G.world===w&&G.game===g&&this.el.info===el&&!el.classList.contains('hidden')&&G.sel?.kind==='b'&&G.sel.id===b.id&&w.bmap[b.id]===b&&b.state==='ok'&&el.querySelector('[data-pasture-split]')===panel&&!(G.hasOpenModal&&G.hasOpenModal());
    select.addEventListener('change',()=>{reset();if(valid())this.refreshPastureSplit(b);});
    start.addEventListener('click',e=>{if(!valid()||e.detail>1){reset();return;}const target=w.bmap[Number(select.value)],q=G.pastureSplitQuote(b,target);if(!q.ok){reset();if(msg)msg.textContent=q.reason;return;}panel._splitQuote={key:q.key,target};const unit=q.type==='chicken'?'只':'头';quote.textContent=`将${q.qty}${unit}${G.LIVESTOCK[q.type].name}直接分入牧场 #${target.id}（${target.x},${target.y}），本场留下${q.left}${unit}。总数量不增加，繁殖进度守恒；不移动鸡蛋、未成蛋进度、羊毛、肉皮、携货和工人。目标保留量${target.animalTarget||8}${unit}，超过时会由牧人正常屠宰。新场须实际照料才继续繁殖。`;box.classList.remove('hidden');if(confirm.focus)confirm.focus();});
    cancel.addEventListener('click',()=>{reset();if(valid()&&start.focus)start.focus();});
    confirm.addEventListener('click',e=>{if(!valid()||!panel._splitQuote||e.detail>1){reset();return;}const pending=panel._splitQuote;reset();const result=G.splitPasture(b,pending.target,pending.key);if(msg)msg.textContent=result.ok?`已分${result.qty}${result.type==='chicken'?'只':'头'}${G.LIVESTOCK[result.type].name}到另一牧场；请分别检查保留量和用工。`:result.reason;this.refreshEconomyInfo(b);const close=el.querySelector('#info-close');if(result.ok&&close&&close.focus)close.focus();});
  },

  autoTradeInfoMarkup: function (b) {
    if (!G.autoTradeSummary || !G.autoTradeConfigReason || !G.setAutoTrade) return '';
    const rule = G.autoTradeSummary(b).rule;
    const options = (catalog, selected, label) => Object.keys(catalog).map(key => `<option value="${key}"${key === selected ? ' selected' : ''}>${this.escHtml(label(key))}</option>`).join('');
    return `<p class="row" data-auto-trade-status role="status" aria-live="polite"></p>
      <p class="row" data-auto-trade-receipt></p>
      <details class="trade-inventory" data-auto-trade>
        <summary id="auto-trade-summary">④ 自动购买设置（默认关闭）</summary>
        <form id="auto-trade-form" class="economy-form">
          <p class="desc">本站只保留一条规则。编辑草稿不会改变已应用规则；数量上限只限每船自动购买，手动交易仍可另买，自行选货、数量和付款物资。</p>
          <label for="auto-trade-enabled">规则状态</label><select id="auto-trade-enabled"><option value="off"${!rule.enabled ? ' selected' : ''}>关闭</option><option value="on"${rule.enabled ? ' selected' : ''}>启用：仅未来商船到达时</option></select>
          <label for="auto-trade-good">购买一种货物</label><select id="auto-trade-good">${options(G.TRADE_GOODS, rule.good, key => G.TRADE_GOODS[key].name + '（每船上限 ' + G.TRADE_GOODS[key].stock + '）')}</select>
          <label for="auto-trade-quantity">每船自动购买数量（整批）</label><input id="auto-trade-quantity" type="number" min="1" max="${G.TRADE_GOODS[rule.good].stock}" step="1" value="${rule.qty}" inputmode="numeric">
          <label for="auto-trade-payment">只用本站一种库存支付</label><select id="auto-trade-payment">${options(G.TRADE_VALUES, rule.payment, key => G.RES[key].name + '（价值 ' + G.TRADE_VALUES[key] + '）')}</select>
          <label for="auto-trade-price">最高货物单价（1–1000000 整数价值）</label><input id="auto-trade-price" type="number" min="1" max="1000000" step="1" value="${rule.maxPrice}" inputmode="numeric">
          <p data-auto-trade-draft class="trade-quote" role="status" aria-live="polite"></p>
          <div class="economy-actions"><button type="submit" id="auto-trade-apply">查看启用方案</button><button type="button" id="auto-trade-disable">关闭已应用规则</button></div>
          <div data-auto-trade-confirm class="hidden">
            <p data-auto-trade-terms role="status" aria-live="polite"></p>
            <div class="economy-actions"><button type="button" id="auto-trade-confirm" disabled>确认应用，仅未来商船生效</button><button type="button" id="auto-trade-cancel">取消应用</button></div>
          </div>
          <p class="desc">只在未来每艘船到达时检查一次，当前停靠船不补买，离港不执行。按含订货溢价的实际单价检查；超价、缺货、拒收付款、库存或容量不足时跳过整批，不分批、不重试。只扣已搬入本站的游戏库存，不动全镇库存或在途货。普通买入物资占本站容量（含在途占位），种子永久解锁，牲畜进入待安置数量。工人上限 0 会停止备货与运回，但自动规则仍可用现有站内库存成交；要停止自动成交请关闭规则。</p>
        </form>
      </details>`;
  },

  autoTradeDraft: function () {
    const el = this.el.info, find = id => el.querySelector('#auto-trade-' + id);
    const state = find('enabled')?.value;
    if (!['off', 'on'].includes(state)) return { ok: false, reason: '请选择启用或关闭。' };
    const number = id => { const value = find(id)?.value; return value && value.trim() !== '' ? Number(value) : NaN; };
    const rule = { enabled: state === 'on', good: find('good')?.value, qty: number('quantity'), payment: find('payment')?.value, maxPrice: number('price') };
    const reason = G.autoTradeConfigReason(rule);
    return { ok: !reason, reason, rule, key: JSON.stringify(rule) };
  },

  autoTradeTerms: function (rule) {
    const cap = G.TRADE_GOODS[rule.good].stock, paymentValue = G.TRADE_VALUES[rule.payment];
    const maximum = Math.ceil(rule.maxPrice * rule.qty / paymentValue);
    return `仅未来商船到达时：每船整批购买${G.TRADE_GOODS[rule.good].name} × ${rule.qty}（货物每船上限 ${cap}），最高单价 ${rule.maxPrice}，只用本站${G.RES[rule.payment].name}库存支付。每船最多支付 ${maximum} ${G.RES[rule.payment].name}（${rule.maxPrice} × ${rule.qty} ÷ ${paymentValue}，向上取整）；实际按到货单价结算。只使用已搬入本站的游戏库存，不动全镇库存或在途货。当前停靠船不会补买；不足整批或其他条件不符就跳过，本船不再重试。`;
  },

  refreshAutoTradeInfo: function (b) {
    const el = this.el.info, panel = el.querySelector('[data-auto-trade]');
    if (!panel) return;
    const set = (selector, text) => { const node = el.querySelector(selector); if (node && node.textContent !== text) node.textContent = text; };
    const summary = G.autoTradeSummary(b), rule = summary.rule, last = summary.last, draft = this.autoTradeDraft();
    set('[data-auto-trade-status]', rule.enabled ? `已应用：自动购买已启用，每船${G.TRADE_GOODS[rule.good].name} × ${rule.qty}，最高单价 ${rule.maxPrice}，最多支付本站${G.RES[rule.payment].name} × ${summary.maxPayment}。仅未来到达时生效，当前船不补买。` : '已应用：自动购买已关闭。不会自动扣库存；手动交易和订货仍可使用。');
    if (last) {
      const date = `第 ${last.day + 1} 天（历史回执）`, merchant = G.MERCHANTS[last.merchantId]?.name || '商船';
      const goods = `${G.TRADE_GOODS[last.good]?.name || last.good} × ${last.qty}`, payment = G.RES[last.payment]?.name || last.payment;
      set('[data-auto-trade-receipt]', `最近自动购买：${date}，${merchant}，当时规则${goods}，${last.ok ? `已成交，单价 ${last.unitPrice}，支付${payment} × ${last.paid}` : `当时拟用${payment}支付，已跳过，未扣库存：${last.reason}`}。此为当时结果，修改或关闭规则不会改写。`);
    } else set('[data-auto-trade-receipt]', '最近自动购买：尚无到访执行记录。当前船不会因启用或修改规则而补买。');
    const qty = panel.querySelector('#auto-trade-quantity');
    if (qty) qty.max = String(G.TRADE_GOODS[draft.rule?.good]?.stock || 1);
    set('[data-auto-trade-draft]', draft.ok ? `${draft.rule.enabled ? '待确认的草稿' : '关闭状态草稿'}：${this.autoTradeTerms(draft.rule)}` : draft.reason);
    const apply = panel.querySelector('#auto-trade-apply'), disable = panel.querySelector('#auto-trade-disable');
    apply.disabled = !draft.ok;
    apply.textContent = draft.ok && !draft.rule.enabled ? '保存关闭的规则' : rule.enabled ? '查看更改方案' : '查看启用方案';
    disable.disabled = !rule.enabled;
    if (panel._autoTradePending && (!draft.ok || draft.key !== panel._autoTradePending.key || JSON.stringify(rule) !== panel._autoTradePending.applied || !panel._autoTradeValid())) panel._autoTradeReset();
  },

  initAutoTradeInfo: function (b) {
    const el = this.el.info, w = G.world, game = G.game, panel = el.querySelector('[data-auto-trade]');
    if (!panel) return;
    const economy = el.querySelector('[data-economy="tradingpost"]'), merchant = b.merchant;
    const find = id => panel.querySelector('#auto-trade-' + id), form = find('form'), apply = find('apply'), confirm = find('confirm'), cancel = find('cancel'), disable = find('disable');
    const box = panel.querySelector('[data-auto-trade-confirm]');
    const message = text => { const node = el.querySelector('[data-economy-message]'); if (node) node.textContent = text; };
    const valid = () => G.world === w && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel?.kind === 'b' && G.sel.id === b.id && w.bmap[b.id] === b && b.type === 'tradingpost' && b.state === 'ok' &&
      el.querySelector('[data-auto-trade]') === panel && el.querySelector('[data-economy="tradingpost"]') === economy && b.merchant === merchant && !(G.hasOpenModal && G.hasOpenModal());
    const reset = () => {
      panel._autoTradePending = null; box.classList.add('hidden'); confirm.disabled = true;
      if (box.contains(document.activeElement) && valid()) { const target = panel.open ? apply : find('summary'); if (target && target.focus) target.focus(); }
    };
    panel._autoTradeReset = reset; panel._autoTradeValid = valid; reset();
    const guard = () => { if (valid()) return true; reset(); return false; };
    const save = rule => {
      const result = G.setAutoTrade(b, rule, game);
      message(result.ok ? rule.enabled ? '自动购买规则已应用，仅未来到达的商船生效；当前船不会补买，未扣库存。' : '自动购买已关闭；只更改规则，未扣库存，也不退回已完成的交易。' : result.reason || '规则未应用。');
      this.refreshAutoTradeInfo(b);
      return result.ok;
    };
    for (const id of ['enabled', 'good', 'quantity', 'payment', 'price']) {
      const node = find(id);
      for (const event of ['input', 'change']) node.addEventListener(event, () => { reset(); if (guard()) this.refreshAutoTradeInfo(b); });
    }
    panel.addEventListener('toggle', () => { if (!panel.open) reset(); });
    form.addEventListener('submit', e => {
      e.preventDefault(); if (!guard()) return;
      reset(); const draft = this.autoTradeDraft();
      if (!draft.ok) { message(draft.reason); this.refreshAutoTradeInfo(b); return; }
      if (!draft.rule.enabled) { save(draft.rule); return; }
      panel._autoTradePending = { key: draft.key, applied: JSON.stringify(G.autoTradeSummary(b).rule), rule: { ...draft.rule } };
      panel.querySelector('[data-auto-trade-terms]').textContent = '确认应用：' + this.autoTradeTerms(draft.rule);
      box.classList.remove('hidden'); confirm.disabled = false; if (confirm.focus) confirm.focus();
    });
    confirm.addEventListener('click', e => {
      if (!guard() || e.detail > 1) { reset(); return; }
      const pending = panel._autoTradePending, draft = this.autoTradeDraft();
      reset();
      if (!pending || !draft.ok || pending.key !== draft.key || pending.applied !== JSON.stringify(G.autoTradeSummary(b).rule)) return;
      save(pending.rule);
    });
    cancel.addEventListener('click', () => { reset(); if (guard() && apply.focus) apply.focus(); });
    disable.addEventListener('click', () => {
      if (!guard()) return;
      reset(); const rule = G.autoTradeSummary(b).rule;
      if (rule.enabled && save({ ...rule, enabled: false })) { find('enabled').value = 'off'; this.refreshAutoTradeInfo(b); }
    });
  },

  tradeQuote: function (b) {
    const el = this.el.info;
    const find = id => el.querySelector ? el.querySelector('#' + id) : document.getElementById(id);
    const goodEl = find('trade-good'), quantity = find('trade-buy-quantity'), paymentEl = find('trade-payment');
    if (!goodEl || !quantity || !paymentEl) return { ok: false, reason: '请选择交易内容。' };
    const good = goodEl.value, payment = paymentEl.value, qty = Number(quantity.value), offer = G.TRADE_GOODS[good], value = G.TRADE_VALUES[payment];
    if (!offer || !value || !Number.isInteger(qty) || qty <= 0) return { ok: false, reason: '请输入正整数购买数量。' };
    const quote = G.tradeQuote(b, good, qty, payment), unitPrice = quote.unitPrice;
    const cost = Math.ceil(unitPrice * qty / value), available = b.tradeInventory && b.tradeInventory[payment] || 0;
    const merchant = b.merchant && b.merchant.leaveDay > G.game.day;
    const stock = merchant ? b.merchant.stock[good] || 0 : 0;
    const seed = G.seedUnlockKey ? G.seedUnlockKey(good) : good === 'orchardSeed' ? 'orchard' : null;
    const premium = merchant && b.merchant.orderedGood === good ? `；本次订货价：原价 ${offer.price} × 1.25 向下取整` : '';
    const text = `购买${offer.name} × ${qty}，实际支付${G.RES[payment].name} × ${cost}（单价 ${unitPrice}${premium}，付款价值 ${value}/件）。\n商船存货 ${stock} · 本站可支付 ${Math.floor(available)}。` + (seed ? '\n种子仅购 1 份永久解锁，不可复购，不占仓位。' : '') + (quote.reason ? '\n' + quote.reason : '');
    return { ...quote, text };
  },

  merchantOrderQuote: function (b) {
    const el = this.el.info, good = el.querySelector('#trade-order-good')?.value;
    const quantity = el.querySelector('#trade-order-quantity'), qty = quantity && quantity.value.trim() !== '' ? Number(quantity.value) : NaN;
    const offer = Object.hasOwn(G.TRADE_GOODS, good) ? G.TRADE_GOODS[good] : null, profile = G.merchantProfile(b);
    if (!b.merchant || b.merchant.leaveDay <= G.game.day) return { ok: false, reason: '商船尚未停靠；请等要订货的商人到访。' };
    if (!offer || !profile.goods.includes(good)) return { ok: false, reason: '请选择这位商人目录中的货物。' };
    if (!Number.isInteger(qty) || qty < 1 || qty > offer.stock) return { ok: false, reason: `请输入 1–${offer.stock} 的整数订货数量。` };
    const seedReason = G.seedTradeReason(good, qty);
    if (seedReason) return { ok: false, reason: seedReason };
    const unitPrice = Math.floor(offer.price * 1.25);
    return { ok: true, good, qty, unitPrice, text: `${profile.name}下次回访将带来${offer.name} × ${qty}，订货单价 ${unitPrice}（原价 ${offer.price} × 1.25 向下取整）。无需预付款；${b.autoTrade?.enabled ? '到货后可手动交易，已启用的自动购买会另按规则检查。' : '到货后手动交易。'}` };
  },

  refreshEconomyInfo: function (b) {
    const el = this.el.info;
    if (!['tradingpost', 'pasture', 'orchard'].includes(b.type) || b.state !== 'ok' || !el.querySelector || !el.querySelector(`[data-economy="${b.type}"]`)) return false;
    const set = (selector, text) => { const node = el.querySelector(selector); if (node && node.textContent !== text) node.textContent = text; };
    set('[data-economy-status]', this.economyStatus(b));
    set('[data-economy-goals]', G.buildingGoalStatus(b));
    set('[data-economy-workers]', b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、') || '无');
    if (b.type === 'tradingpost') {
      const panel = el.querySelector('[data-economy="tradingpost"]');
      if (panel._merchant !== b.merchant) return false;
      const merchant = b.merchant && b.merchant.leaveDay > G.game.day;
      const profile = G.merchantProfile(b), order = G.merchantOrderSummary(b);
      set('[data-economy-live="merchant"]', merchant ? `${profile.name}停靠中，将在 ${b.merchant.leaveDay - G.game.day} 天后离开。` : `下一艘商船约 ${Math.max(0, (b.nextMerchantDay || G.game.day) - G.game.day)} 天后到达；不一定是已订货的商人。`);
      const accepted = Object.keys(G.TRADE_VALUES).filter(type => G.merchantAccepts(b, type)).map(type => G.RES[type].name).join('、');
      set('[data-economy-live="merchant-payments"]', merchant ? `收购：${accepted}。${profile.acceptsFood ? '接受肉类、鸡蛋、蔬菜、主食、苹果、梨付款。' : '拒收食物：肉类、鸡蛋、蔬菜、主食、苹果、梨。'}` : '各商人有不同目录与收购物资；订货要等同一商人回访。');
      const inventory = b.tradeInventory || {}, targets = b.tradeTargets || {};
      const stored = G.tradeStored ? G.tradeStored(b) : Object.values(inventory).reduce((sum, value) => sum + value, 0);
      set('[data-economy-live="trade-capacity"]', `已入站 ${Math.floor(stored)} + 在途占位 ${G.tradeIncoming(b)} / ${G.TRADE_CAPACITY || 2000} · 可用空位 ${G.tradeFreeSpace(b)}（各资源共享；在途货尚不可交易）`);
      const lines = Object.keys(G.TRADE_VALUES).map(type => `${G.RES[type].name}：待售 ${Math.floor(inventory[type] || 0)} / 目标 ${targets[type] || 0}`);
      set('[data-economy-live="inventory"]', lines.join('\n'));
      const type = el.querySelector('#trade-target-resource').value;
      set('[data-economy-live="target-stock"]', `全镇可用 ${Math.floor(G.game.res[type] || 0)} · 本站待售 ${Math.floor(inventory[type] || 0)} · 已应用目标 ${targets[type] || 0}`);
      const quote = this.tradeQuote(b);
      set('[data-economy-live="quote"]', quote.text || quote.reason);
      const buy = el.querySelector('#trade-execute'); buy.disabled = !quote.ok;
      buy.textContent = quote.ok ? `确认支付 ${quote.cost} ${G.RES[quote.payment].name}` : '确认交易';
      for (const option of el.querySelector('#trade-good').querySelectorAll('option')) {
        const good = option.value, stock = merchant ? b.merchant.stock[good] || 0 : 0;
        const text = `${G.TRADE_GOODS[good].name}（单价 ${G.merchantPrice(b, good)}${merchant && order.arrivedGood === good ? ' · 订货价' : ''} · 本船 ${stock}）`;
        if (option.textContent !== text) option.textContent = text;
      }
      for (const option of el.querySelector('#trade-payment').querySelectorAll('option')) option.disabled = !!merchant && !G.merchantAccepts(b, option.value);
      const pending = merchant && order.pending;
      const returnText = merchant && Number.isFinite(order.returnDay) ? `同一商人预计约 ${Math.max(0, order.returnDay - G.game.day)} 天后回访（下一艘船可能不同）。` : '';
      set('[data-economy-live="merchant-order"]', merchant ? (pending ? `待到货：${G.TRADE_GOODS[pending.good].name} × ${pending.qty}。` : '这位商人暂无待到货订单。') + returnText + (order.arrivedGood ? `本次已带到${G.TRADE_GOODS[order.arrivedGood].name}，订单已清除；${b.autoTrade?.enabled ? '自动购买结果见下方历史回执，剩余货物可手动确认购买。' : '购买仍需手动确认。'}` : '') : '商人未停靠，暂不能订货、替换或取消订单。');
      const otherOrders = (order.pendingOrders || []).filter(item => !merchant || item.merchantId !== order.merchantId);
      set('[data-economy-live="merchant-orders"]', otherOrders.length ? '等待其他商人回访：' + otherOrders.map(item => `${item.name} · ${G.TRADE_GOODS[item.good].name} × ${item.qty}（订货单价 ${item.unitPrice}）`).join('；') + '。须等该商人停靠后才能修改。' : '');
      const orderQuote = this.merchantOrderQuote(b), confirm = el.querySelector('#trade-order-confirm'), cancel = el.querySelector('#trade-order-cancel');
      set('[data-economy-live="order-quote"]', orderQuote.text || orderQuote.reason);
      confirm.disabled = !orderQuote.ok; confirm.textContent = pending ? '确认替换一次订货' : '确认一次订货';
      cancel.disabled = !pending;
      const orderGood = el.querySelector('#trade-order-good'), orderQuantity = el.querySelector('#trade-order-quantity');
      orderGood.disabled = !merchant; orderQuantity.disabled = !merchant;
      orderQuantity.max = String(G.TRADE_GOODS[orderGood.value]?.stock || 400);
      this.refreshAutoTradeInfo(b);
    } else if (b.type === 'pasture') {
      const d=G.pastureSummary(b),bank=G.game.livestock,unit=d.type==='chicken'?'只':'头';
      const dimensions = d.dimensions || [b.w, b.h], area = d.area ?? b.w * b.h;
      set('[data-economy-live="pasture-area"]', `牧场 ${dimensions[0]}×${dimensions[1]} · ${area}格 · 本场牧人上限 ${G.workerMaximumOf(b)} 人（上限不保证配足）`);
      set('[data-economy-live="pasture-capacity-rule"]', d.capacityRule === 'area' ? `原版面积密度：牛20格/头、羊16格/头、鸡6格/只，容量向下取整。本场最多羊 ${G.pastureCapacity(b, 'sheep')} 头 / 牛 ${G.pastureCapacity(b, 'cattle')} 头 / 鸡 ${G.pastureCapacity(b, 'chicken')} 只，不能混养。` : '固定6×6牧场容量：羊12头 / 牛10头 / 鸡24只，默认保留8只/头；容量、建材与用工沿用旧版。');
      set('[data-economy-live="pasture-cattle-warning"]', d.capacityRule === 'area' && d.type === 'cattle' && d.cap === 2 ? '本场最多2头牛，只适合保种或转场；保留量最低2头，无法靠繁殖产生超额屠宰的肉和皮革。' : '');
      set('[data-economy-live="animals"]', `${d.name}群 ${d.animals}/${d.cap} ${unit} · 当前保留 ${d.target} ${unit}`);
      const products=d.type==='chicken'?`场内待取鸡蛋 ${Math.floor(d.eggs||0)} / ${G.CHICKEN.eggCap} · 未成蛋进度 ${Math.floor((d.eggProgress||0)*100)}% · 已屠宰待送：肉 ${d.meat}`:d.type==='sheep'?`待剪羊毛 ${Math.floor(d.wool)}`:`已屠宰待送：肉 ${d.meat} · 皮革 ${d.leather}`;
      set('[data-economy-live="pasture-production"]', `繁殖进度 ${Math.floor(d.growth*100)}% · ${products}`);
      const eggTarget=G.productionGoalOf('eggs');
      set('[data-economy-live="pasture-stock"]', d.type==='chicken'?`公共库存：鸡蛋 ${this.supplyNumber(G.game.res.eggs||0)} · 肉类 ${this.supplyNumber(G.game.res.meat||0)}（不含场内与在途）；鸡蛋目标 ${eggTarget===null?'继承原规则':eggTarget}，${G.goalPaused('eggs')?'已达鸡蛋或总食物目标，暂停新产蛋':'受鸡蛋与总食物目标限制'}。`:'');
      const cargo=G.world.citizens.filter(c=>!c.dead&&c.carry?.pastureId===b.id).map(c=>`${c.name}：${G.RES[c.carry.type].name} ${this.supplyNumber(c.carry.qty)}，${G.cargoWaitReason(c)||'实背送仓途中'}`);
      set('[data-economy-live="pasture-logistics"]', (d.type==='chicken'?`鸡蛋每批最多取${G.CHICKEN.haul}枚，由牧人实背送仓；满仓保留场内与随身已有鸡蛋。鸡肉计入肉类库存。`:'牧场产物逐批实背送仓。') + (cargo.length?' 当前在途：'+cargo.join('；')+'（未入库，尚不可用）。':' 当前无在途产物。'));
      set('[data-economy-live="sheep-bank"]', `已购待安置：羊 ${bank.sheep||0} · 牛 ${bank.cattle||0} · 鸡 ${bank.chicken||0}。本场只接收${d.name}。`);
      set('[data-economy-live="pasture-switch"]', d.switchReason||`当前${d.name}场；空场且原任务与产物已清空时可改种类。`);
      set('[data-economy-live="pasture-rule"]', d.rule);
      set('[data-economy-live="pasture-target-range"]', `保留 2–${d.cap} ${unit}（已有设置 ${d.target}）`);
      el.querySelector('#pasture-stock').disabled=d.bank<=0||d.animals>=d.cap||!!(G.pasturePestSummary&&G.pasturePestSummary(b).active);
      el.querySelector('#pasture-type-apply').disabled=!!d.switchReason;
      el.querySelector('#pasture-stock-quantity').max=String(d.cap);el.querySelector('#pasture-target-quantity').max=String(d.cap);
      this.refreshPastureSplit(b);
      this.refreshPasturePests(b);
      this.refreshPastureEmpty(b);
      const output=el.querySelector('[data-pasture-output]');if(output){const html='产出：'+G.productionOutputsOf(b).filter(k=>k!=='food').map(k=>`${this.resourceIcon(k)}${G.RES[k].name}`).join(' · ');if(output.innerHTML!==html)output.innerHTML=html;}
    } else {
      const d=G.orchardSummary(b), types=G.ORCHARD_TYPES, chosen=types[G.orchardTypeOf(b)], trees=b.orchardTrees||[];
      const layout=G.orchardLayout(b);
      set('[data-economy-live="orchard-area"]',`果园 ${b.w}×${b.h} · ${b.w*b.h}格 · ${layout.count}树位 · 农夫上限可设0–${G.workerMaximumOf(b)}人${layout.legacy?'（固定容量）':''}`);
      set('[data-economy-live="orchard-area-rule"]',layout.legacy?'固定6×6果园：9株、3×3树位、2岗位和12木/36工时；已有果园不会重新排树。':`已建面积果园：东西${layout.columns}列，每2格一树；南北${layout.rows}行，每3格一行。成本按周长、工时按面积、岗位最多3人为本作适配；大园仍受实际劳动和秋收搬运限制。`);

      set('[data-economy-live="orchard-age"]',`种子：${Object.values(types).map(type => `${type.name}${G.game.unlocks?.[type.unlock]?'已永久解锁':'尚未购买'}`).join(' · ')} · 空位 ${d.empty} / 幼树 ${d.young} / 成树 ${d.mature}（共${G.orchardTreeCount(b)}位）`);
      const composition=Object.entries(types).map(([type,def])=>{const planted=trees.filter(t=>t.planted&&G.orchardTreeType(t)===type);return `${def.name} ${planted.length}株 · 待采${G.RES[def.output].name} ${this.supplyNumber(planted.reduce((n,t)=>n+(t.fruit||0),0))}`;}).join('；');
      set('[data-economy-live="orchard-types"]',`现有果树：${composition}`);
      set('[data-economy-live="orchard-selection"]',`已应用以后种植：${chosen.name} → ${G.RES[chosen.output].name}${G.game.unlocks?.[chosen.unlock]?'':'（尚未解锁，需买对应种子或选择已解锁品种）'}。仅作用于以后新接的空位种植任务。`);
      set('[data-economy-live="orchard-harvest"]',`本季未采果实合计 ${this.supplyNumber(d.fruit)}；品种明细见下方现有果树，实际采收/送仓才记产出/入库。${d.status}`);
      set('[data-economy-live="orchard-stock"]',`公共库存：${['vegetables','apples','pears'].map(type=>`${G.RES[type].name} ${this.supplyNumber(G.game.res[type])}`).join(' · ')}（不含树上待采与携果）；三种物品各有独立目标，并受总食物目标限制。`);
      const cargo=G.world.citizens.filter(c=>!c.dead&&c.carry?.orchardId===b.id).map(c=>`${c.name}：${G.RES[c.carry.type].name} ${this.supplyNumber(c.carry.qty)}，${G.cargoWaitReason(c)||'送仓途中'}`);
      set('[data-economy-live="orchard-logistics"]',cargo.length?'已采在途：'+cargo.join('；')+'；尚未入库，满仓保留。':'暂无已采在途果实。');
      for(const option of el.querySelector('#orchard-type').querySelectorAll('option')){const def=types[option.value],unlocked=!!G.game.unlocks?.[def.unlock];option.disabled=!unlocked;const text=`${def.name} → ${G.RES[def.output].name}${unlocked?'':'（尚未解锁）'}`;if(option.textContent!==text)option.textContent=text;}
      set('[data-economy-live="orchard-renewal"]',`已应用补种：${b.orchardReplant?'允许':'暂停'} · 一年内将枯尽 ${d.soon} 株${Number.isFinite(d.nextDeath)?' · 最短还差 '+d.nextDeath+' 树龄日':''}；空位没有产量。`);
      set('[data-economy-live="orchard-trees"]',trees.map((t,i)=>`第${i+1}株：${t.planted?`${types[G.orchardTreeType(t)].name} · 树龄 ${(t.age/G.YEAR_DAYS).toFixed(1)} 年 / 寿命 ${G.orchardLifetime(i)/G.YEAR_DAYS} 年 · ${t.age<G.ORCHARD.matureDays?'尚需 '+(G.ORCHARD.matureDays-t.age)+' 有效养护日':'成熟'} · 待采${G.RES[G.orchardOutput(t)].name} ${this.supplyNumber(t.fruit)}`:'空位，待种植'}`).join('\n'));
      const output=el.querySelector('[data-orchard-output]');if(output){const html='产出：'+G.productionOutputsOf(b).filter(k=>k!=='food').map(k=>`${this.resourceIcon(k)}${G.RES[k].name}`).join(' · ');if(output.innerHTML!==html)output.innerHTML=html;}
    }
    return true;
  },

  /* 定时刷新打开的面板 */
  tickInfo: function (dt) {
    if (G.sel && !this.el.info.classList.contains('hidden')) {
      this.infoT -= dt;
      if (this.infoT <= 0) { this.infoT = 0.5; this.renderInfo(); }
    }
  },

  // Build once: refreshing stocks never replaces focused inputs or their draft.
  initProductionGoals: function () {
    const rows=document.getElementById('production-goal-rows');
    if(!rows||rows._goalsBound)return;rows._goalsBound=true;
    const bind=(button,action)=>{
      if(!button)return;let armed=null,blocked=false;
      const capture=()=>{armed=this._productionGoalSession;blocked=!this.productionGoalSessionCurrent();};
      for(const event of ['pointerdown','mousedown','touchstart'])button.addEventListener(event,capture);
      button.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){if(e.repeat){blocked=true;e.preventDefault();}else capture();}});
      for(const event of ['pointercancel','touchcancel'])button.addEventListener(event,()=>{blocked=true;});
      button.addEventListener('click',e=>{
        if(blocked||e.detail>1||!this.productionGoalSessionCurrent()||(armed&&armed!==this._productionGoalSession))return;
        armed=null;action();
      });
    };
    rows.innerHTML=G.RES_KEYS.map(type=>`<tr class="production-goal-row" data-goal-row="${type}">
      <th scope="row"><label id="goal-label-${type}" for="goal-input-${type}">${this.resourceIcon(type)}${type==='food'?'总食物':G.RES[type].name}</label>${type==='food'?'<small>六种食物之和</small>':''}</th>
      <td><strong id="goal-stock-value-${type}"></strong><small id="goal-public-${type}"></small></td>
      <td><div class="goal-controls"><input id="goal-input-${type}" type="number" inputmode="numeric" min="0" max="${G.PRODUCTION_GOAL_MAX}" step="1" placeholder="继承" aria-describedby="production-goals-draft-help goal-applied-${type} goal-status-${type}">
      <button type="button" class="goal-inherit" data-goal="${type}" data-inherit="true" aria-label="将${G.RES[type].name}草稿设为继承原规则">继承</button></div><small id="goal-applied-${type}"></small></td>
      <td><strong id="goal-gap-${type}"></strong><small id="goal-gap-note-${type}"></small></td></tr>
      <tr class="goal-detail-row"><td colspan="4"><details><summary tabindex="0">${type==='food'?'总食物':G.RES[type].name} · 规则与库存口径</summary><p id="goal-stock-${type}"></p><p id="goal-status-${type}"></p></details></td></tr>`).join('');
    rows.querySelectorAll('button').forEach(button=>bind(button,()=>{
      if(!this.productionGoalSessionCurrent())return;
      const input=document.getElementById('goal-input-'+button.dataset.goal);
      input.value='';input.setAttribute('aria-invalid','false');
      this.productionGoalDraftChanged('继承仅写入草稿；点击“应用全部草稿”后生效。');
    }));
    rows.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{
      if(!this.productionGoalSessionCurrent())return;
      input.setAttribute('aria-invalid','false');this.productionGoalDraftChanged();
    }));
    document.getElementById('btn-production-goals').addEventListener('click',()=>this.showProductionGoals());
    document.getElementById('production-goals-close').addEventListener('click',()=>this.closeProductionGoals());
    bind(document.getElementById('production-goals-apply'),()=>this.applyProductionGoalDraft());
    bind(document.getElementById('production-goals-reset'),()=>{
      if(!this.productionGoalSessionCurrent())return;
      this.resetProductionGoalDraft();this.productionGoalDraftChanged('已撤销未应用的草稿，恢复为当前已应用目标。');
    });
    for(const mode of ['balanced','winter','stockpile'])bind(document.getElementById('goal-preset-'+mode),()=>this.stageProductionGoalRecommendation(mode));
  },
  productionGoalSessionCurrent: function () {
    const s=this._productionGoalSession,modal=document.getElementById('production-goals');
    return !!s&&s.game===G.game&&s.world===G.world&&modal&&!modal.classList.contains('hidden')&&(!G.topModal||G.topModal()===modal);
  },
  resetProductionGoalDraft: function () {
    for(const type of G.RES_KEYS){
      const input=document.getElementById('goal-input-'+type);
      input.value=String(G.productionGoalOf(type)??'');input.setAttribute('aria-invalid','false');
    }
    const notes=document.getElementById('goal-preset-notes');if(notes)notes.textContent='选择建议会填写部分草稿。检查数值后，仍需点击“应用全部草稿”。';
    this._productionGoalRecommendation=null;
  },
  productionGoalDraftChanged: function (message) {
    document.getElementById('production-goals-message').textContent=message||'草稿尚未应用；库存缺口按草稿计算。';
    this.refreshProductionGoals();
  },
  readProductionGoalDraft: function () {
    const values={},errors=[];
    for(const type of G.RES_KEYS){
      const input=document.getElementById('goal-input-'+type),raw=input.value.trim();
      const value=raw===''?null:Number(raw);
      const valid=!input.validity?.badInput&&(value===null||(/^\d+$/.test(raw)&&Number.isSafeInteger(value)&&value<=G.PRODUCTION_GOAL_MAX));
      if(!valid)errors.push(type);else values[type]=value;
    }
    return {values,errors};
  },
  applyProductionGoalDraft: function () {
    if(!this.productionGoalSessionCurrent())return false;
    // Validate every row before calling even the first engine setter.
    const draft=this.readProductionGoalDraft();
    for(const type of G.RES_KEYS)document.getElementById('goal-input-'+type).setAttribute('aria-invalid',draft.errors.includes(type)?'true':'false');
    if(draft.errors.length){
      document.getElementById('production-goals-message').textContent=`未应用任何目标：${draft.errors.map(k=>G.RES[k].name).join('、')}请输入0至${G.PRODUCTION_GOAL_MAX}的有效数字整数，或完整清空以继承原规则。`;
      document.getElementById('goal-input-'+draft.errors[0]).focus();return false;
    }
    let changes=0;
    for(const type of G.RES_KEYS)if(G.productionGoalOf(type)!==draft.values[type]){G.setProductionGoal(type,draft.values[type]);changes++;}
    document.getElementById('production-goals-message').textContent=changes?`已应用${changes}项全镇目标。本屋上限未改动；已接批次仍会完成。`:'草稿与已应用目标一致，无需更改。';
    this.refreshProductionGoals();if(G.sel)this.renderInfo(true);return true;
  },
  stageProductionGoalRecommendation: function (mode) {
    if(!this.productionGoalSessionCurrent()||!G.recommendProductionGoals)return;
    const context=G.goalRecommendationContext(),draft=this.readProductionGoalDraft();
    context.specificGoals=Object.fromEntries(G.FOOD_KEYS.map(k=>[k,draft.values[k]??null]));
    const suggestion=G.recommendProductionGoals(mode,context);if(!suggestion)return;
    const lowered=Object.entries(suggestion.values).filter(([k,v])=>Number.isInteger(draft.values[k])&&draft.values[k]>v);
    if(lowered.length)suggestion.warnings.push('建议调低草稿：'+lowered.map(([k,v])=>`${G.RES[k].name} ${draft.values[k]} → ${v}`).join('、')+'；应用后可能提前停产，如需原储备请保留或调高。');
    for(const [type,value] of Object.entries(suggestion.values)){
      const input=document.getElementById('goal-input-'+type);input.value=String(value);input.setAttribute('aria-invalid','false');
    }
    this._productionGoalRecommendation=suggestion;
    const names=Object.keys(suggestion.values).map(k=>G.RES[k].name).join('、');
    const notes=document.getElementById('goal-preset-notes');
    if(notes)notes.textContent=[`${suggestion.label} · 填写时估算，不自动应用。${names?'填写：'+names+'。':''}`,...suggestion.notes,...suggestion.warnings,'这些是可调整的储备建议，不保证够吃或安全过冬；请检查人手、生产链、运输和每屋上限。'].join('\n');
    this.productionGoalDraftChanged(names?`${suggestion.label}已填入草稿；检查后点击“应用全部草稿”。`:'没有可填写的建议；原草稿保留。');
  },
  showProductionGoals: function () {
    const modal=document.getElementById('production-goals');
    if(!modal.classList.contains('hidden')||(G.hasOpenModal&&G.hasOpenModal()))return;
    this._productionGoalSession={game:G.game,world:G.world,paused:G.game.paused};G.game.paused=true;
    this.resetProductionGoalDraft();document.getElementById('production-goals-message').textContent='';
    modal.classList.remove('hidden');this.refreshProductionGoals();this.enterDialog('production-goals');this.refreshHUD();
  },
  closeProductionGoals: function () {
    const modal=document.getElementById('production-goals');if(modal.classList.contains('hidden'))return;
    const s=this._productionGoalSession;modal.classList.add('hidden');this._productionGoalSession=null;this._productionGoalRecommendation=null;
    if(s&&s.game===G.game&&s.world===G.world&&!G.game.over)G.game.paused=!!s.paused;
    this.leaveDialog('production-goals');this.refreshHUD();
  },
  refreshProductionGoals: function () {
    const modal = document.getElementById('production-goals');
    if (!modal || modal.classList.contains('hidden')) return;
    const physical = G.supplyEnabled?.(), supplies = physical ? G.supplyInventory().available : null;
    for (const type of G.RES_KEYS) {
      const cap=G.storageCap(type);
      const stock = document.getElementById('goal-stock-' + type), status = document.getElementById('goal-status-' + type);
      if (!stock || !status) continue;
      const target = G.productionGoalOf(type);
      const foodClass = (G.FOOD_KEYS || []).includes(type);
      const tool = type === 'tools' || type === 'steelTools';
      const distributedGoal = physical && (type === 'food' || foodClass || type === 'firewood' || G.clothingSupplyEnabled?.() && G.CLOTHING_KEYS.includes(type));
      const measured=distributedGoal?(type==='food'?G.supplyFood(supplies):supplies[type]):tool&&G.personalToolsEnabled()?G.toolReserveCount(type):G.game.res[type];
      const set=(id,text)=>{const el=document.getElementById(id+'-'+type);if(el)el.textContent=text;};
      set('goal-stock-value',this.supplyNumber(measured));
      set('goal-public',distributedGoal||tool&&G.personalToolsEnabled()?`公共 ${this.supplyNumber(G.game.res[type])}`:'当前库存');
      set('goal-applied',target===null?'已应用：继承原规则':`已应用：${target}`);
      const input=document.getElementById('goal-input-'+type);
      if(input){
        const raw=input.value.trim(),value=raw===''?null:Number(raw);
        const valid=!input.validity?.badInput&&(value===null||(/^\d+$/.test(raw)&&Number.isSafeInteger(value)&&value<=G.PRODUCTION_GOAL_MAX));
        set('goal-gap',!valid||value===null?'—':this.supplyNumber(Math.max(0,value-measured)));
        set('goal-gap-note',!valid?'无效草稿':value===null?'继承规则':value===0?'停止新生产':value>measured?'距草稿目标':'库存已达草稿');
      }
      stock.textContent = `${physical ? '公共库存' : '库存'} ${Math.floor(G.game.res[type])} · ${foodClass ? '与其他食物共享总仓容 ' + cap + '（总食物 ' + Math.floor(G.game.res.food) + '）' : '硬仓容 ' + (tool ? '不限' : cap)}`;
      if(tool&&G.personalToolsEnabled())stock.textContent+=`；目标计量 ${this.supplyNumber(G.toolReserveCount(type))}（全新备用 + 旧半用，不含已装备）`;
      if (distributedGoal) stock.textContent += `；目标计量 ${this.supplyNumber(type === 'food' ? G.supplyFood(supplies) : supplies[type])}（公共 + 市场/住处/配送在途/待回收，不含火情封存；逐户现货才可使用）`;
      status.textContent = target === null ? '未设置全镇目标，继承原规则' :
        `已应用目标 ${target} · ${target === 0 ? '关闭新自动生产' : `恢复线 ≤${G.productionResumeAt(target)} · ${G.goalPaused(type) ? '达标暂停' : '可生产'}`}`;
      if (target !== null && !tool && target > cap) status.textContent += type === 'eggs' ? '；目标高于公共仓容，场内与随身已有鸡蛋保留，需仓库腾位后送入' : ['apples','pears'].includes(type) ? '；目标高于公共仓容，随身已有果实保留，需仓库腾位后送入；树上未采果仍受冬损与枯尽影响' : distributedGoal ? '；目标高于公共仓容，但已配送存量也计入目标；公共仓满仍需腾位，未保护的普通交货可能损失' : '；目标高于仓容，需扩建仓库；' + (type === 'ale' ? '余麦酒保留随身，等待空间' : ['stone', 'iron', 'coal'].includes(type) ? '余矿保留随身，等待空间' : '满仓交货仍可能损失');
      if (type === 'firewood' || tool) status.textContent += '；各屋原目标保留，实际按全镇与本屋较低值执行（见建筑详情）';
      if (tool) status.textContent += '；只限制正在生产本类工具的铁匠，另一类工具有独立目标';
      if (type === 'food') status.textContent += '；总量目标与各食物物品独立目标同时生效，总量达标会暂停食物新生产';
      if (foodClass) status.textContent += '；同时受总食物目标限制，本物品达标不拦停其他食物物品';
      if (['apples', 'pears'].includes(type)) status.textContent += '；独立果品目标，已有树上待采与随身果实不转换品种；随身果实满仓保留；营养归蔬菜组，仍为三组';
      if (type === 'eggs') status.textContent += '；鸡蛋独立目标只暂停新产蛋，已有场内与随身鸡蛋保留并可继续送仓；与肉类同属一个营养组';
      if ((type === 'food' || foodClass) && target !== null) status.textContent += ['food','vegetables','grain'].includes(type) ? '；已开始的整田继续播种和收获，过低目标可能断粮' : '；过低目标可能断粮';
      if (type === 'firewood' && target !== null) status.textContent += '；过低目标可能挨冻';
      if (type === 'leather') status.textContent += '；仅控制狩猎的新批次皮革副产物，猎人是否继续产肉由肉类和总食物目标控制';
      if (type === 'clothes' || type === 'warmCoats') status.textContent += '；两类衣物目标独立，仅暂停生产本类的新批次；本类衣物仓满也会暂停裁缝，已接批次保留';
      if (type === 'ale') status.textContent += '；只控制麦酒新酿造，仍受酒馆储粮保护；麦酒不计入食物，不能充饥';
    }
  },

  /* Two-stage, world-bound new-game choices; the draft never resets the village. */
  initNewGameSettings: function () {
    const modal=document.getElementById('new-game-settings');if(!modal||modal._startBound)return;
    modal._startBound=true;
    document.getElementById('new-game-title-icon').innerHTML=this.icon('sprout');
    const current=s=>!!s&&this._startSession===s&&s.world===G.world&&s.game===G.game&&
      document.getElementById('new-game-settings')===modal&&!modal.classList.contains('hidden')&&G.topModal()===modal;
    const bind=(id,action)=>{
      const button=document.getElementById(id);if(!button)return;
      let armed=null,held=false,interrupted=false;
      const capture=source=>{const s=this._startSession;interrupted=false;armed=current(s)?{session:s,rev:s.rev,phase:s.phase,source,used:false}:null;};
      for(const name of(window.PointerEvent?['pointerdown']:['mousedown','touchstart']))button.addEventListener(name,e=>{
        if(e.button!==undefined&&e.button!==0)return;if(e.type==='mousedown'&&armed?.source==='touchstart')return;held=false;capture(e.type);
      });
      button.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;
        if(e.repeat||held){e.preventDefault();interrupted=true;return;}held=true;capture('keyboard');});
      button.addEventListener('keyup',e=>{if(['Enter',' '].includes(e.key))held=false;});
      for(const name of ['pointercancel','touchcancel'])button.addEventListener(name,()=>{armed=null;held=false;interrupted=true;});
      window.addEventListener('blur',()=>{armed=null;held=false;interrupted=true;});
      button.addEventListener('focus',()=>{if(armed&&armed.session!==this._startSession){armed=null;held=false;interrupted=false;}});
      button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();
        const s=this._startSession,a=armed;
        if(interrupted||e.detail>1||button.disabled||document.getElementById(id)!==button||!modal.contains(button)||!current(s))return;
        if(a&&(a.used||a.session!==s||a.rev!==s.rev||a.phase!==s.phase))return;
        if(!a&&e.detail===0&&document.activeElement!==button)return;
        if(a)a.used=true;
        action(s);this.refreshNewGameSettings();
      });
    };
    const seed=document.getElementById('new-game-seed');
    seed?.addEventListener('input',()=>{if(current(this._startSession))this.invalidateStartDraft();});
    seed?.addEventListener('change',()=>{if(current(this._startSession))this.invalidateStartDraft();});
    for(const preset of ['classic','hard'])bind('new-game-preset-'+preset,s=>{s.preset=preset;this.invalidateStartDraft();});
    for(const terrain of ['classic','mountain'])bind('new-game-terrain-'+terrain,s=>{s.terrain=terrain;this.invalidateStartDraft();});
    for(const mapSize of G.MAP_SIZES)bind('new-game-size-'+mapSize,s=>{s.mapSize=mapSize;this.invalidateStartDraft();});
    bind('new-game-random',()=>{seed.value=String(Math.floor(Math.random()*0x100000000));this.invalidateStartDraft('随机数只用于本次草稿，当前村未改变。');});
    bind('new-game-reuse',s=>{seed.value=String(s.world.seed);this.invalidateStartDraft('已复用当前地图种子；开局配置仍按下方选择。');});
    bind('new-game-review-button',s=>{
      if(s.phase!=='edit')return;const q=G.startConfigQuote({seed:seed.value,preset:s.preset,terrain:s.terrain,mapSize:s.mapSize});
      if(!q.ok){s.message=q.reason;return;}
      s.intent={world:s.world,game:s.game,key:q.key,config:{...q.config}};s.phase='review';s.rev++;s.message='请核对新村参数和旧进度处理，再单独确认。';
      this.refreshNewGameSettings();document.getElementById('new-game-body').scrollTop=0;document.getElementById('new-game-confirm')?.focus();
    });
    bind('new-game-back',()=>{this.invalidateStartDraft('已返回修改，尚未创建新村。');document.getElementById('new-game-body').scrollTop=0;seed?.focus();});
    bind('new-game-confirm',s=>{
      if(s.phase!=='review'||!s.intent)return;
      const q=G.startConfigQuote({seed:seed.value,preset:s.preset,terrain:s.terrain,mapSize:s.mapSize});
      if(!q.ok||q.key!==s.intent.key){this.invalidateStartDraft('参数已变，请重新检查开局。');return;}
      let result;try{result=G.confirmNewGame(s.intent);}catch(error){result={ok:false,reason:error.message||'新村生成失败'};}
      if(result.ok)this.closeNewGameSettings(true);
      else this.invalidateStartDraft((result.reason||'新村未创建')+'；当前村保留，请重新检查。');
    });
    bind('new-game-export',()=>{
      this.invalidateStartDraft();
      try{G.exportSaveFile();this._startSession.message='已请求浏览器下载当前村，请自行核对文件已保存；未创建新村，需要重新检查并确认。';}
      catch(error){this._startSession.message='导出未完成：'+(error.message||'未知错误')+'；当前村未更改。';}
    });
    bind('new-game-close',()=>this.closeNewGameSettings());
    window.addEventListener('blur',()=>{if(current(this._startSession))this.invalidateStartDraft('窗口已失焦，最终确认已取消；回来后重新检查开局。');});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&current(this._startSession))this.invalidateStartDraft('页面已隐藏，最终确认已取消。');});
  },
  invalidateStartDraft: function(message='') {
    const s=this._startSession;if(!s)return;s.rev++;s.phase='edit';s.intent=null;s.message=message;this.refreshNewGameSettings();
  },
  showNewGameSettings: function () {
    const modal=document.getElementById('new-game-settings');if(!modal||!G.world||!G.startConfigQuote)return;
    const front=G.topModal();if(front&&front!==this.el.over&&front!==modal)return;
    if(!modal.classList.contains('hidden'))return;
    this.initNewGameSettings();
    const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    this._startSession={world:G.world,game:G.game,paused:!!G.game.paused,preset:'classic',terrain:'classic',mapSize:128,phase:'edit',rev:0,intent:null,message:''};
    G.game.paused=true;document.getElementById('new-game-seed').value=String(Math.floor(Math.random()*0x100000000));
    for(const preset of ['classic','hard']){
      const p=G.startConfigQuote({seed:0,preset}).presetSummary,card=document.getElementById('new-game-preset-'+preset);
      card.innerHTML=`<strong>${esc(p.name)}</strong><span>${p.families}家庭 · ${p.population}人（${p.adults}成人 / ${p.children}儿童）</span><span>${['food','tools'].map(k=>`${this.resourceIcon(k)}${G.RES[k].name} ${p.resources[k]}`).join(' · ')}</span><span>${esc(p.seedNote)}</span>`;
    }
    for(const id of ['new-game-details','new-game-help'])document.getElementById(id).open=false;
    document.getElementById('new-game-body').scrollTop=0;
    modal.classList.remove('hidden');this.refreshNewGameSettings();this.enterDialog('new-game-settings');
    document.getElementById('new-game-seed').focus();this.refreshHUD();
  },
  closeNewGameSettings: function (started=false) {
    const modal=document.getElementById('new-game-settings'),s=this._startSession;
    if(!modal||modal.classList.contains('hidden'))return;
    modal.classList.add('hidden');this._startSession=null;
    if(!started&&s&&s.world===G.world&&s.game===G.game&&!G.game.over)G.game.paused=s.paused;
    if(started){if(this._dialogFocus)delete this._dialogFocus['new-game-settings'];G.keys={};}
    else this.leaveDialog('new-game-settings');
    this.refreshHUD();
  },
  refreshNewGameSettings: function () {
    const modal=document.getElementById('new-game-settings'),s=this._startSession;
    if(!modal||modal.classList.contains('hidden')||!s)return;
    const seed=document.getElementById('new-game-seed'),review=document.getElementById('new-game-review'),check=document.getElementById('new-game-review-button'),confirm=document.getElementById('new-game-confirm');
    // Preserve controls, focused elements, expanded help and the body's scroll position on HUD refresh.
    const write=(id,value)=>{const el=document.getElementById(id);if(el&&el.textContent!==value)el.textContent=value;};
    const phase=reviewing=>{
      document.getElementById('new-game-edit').classList.toggle('hidden',reviewing);
      review.classList.toggle('hidden',!reviewing);check.classList.toggle('hidden',reviewing);
      for(const id of ['new-game-confirm','new-game-back','new-game-warning'])document.getElementById(id).classList.toggle('hidden',!reviewing);
      write('new-game-step',reviewing?'2 / 2 · 检查并确认':'1 / 2 · 选择开局');
    };
    if(s.world!==G.world||s.game!==G.game){s.phase='edit';s.intent=null;phase(false);check.disabled=confirm.disabled=true;write('new-game-status','当前村已改变，此设置已过期；请取消后重新打开。');return;}
    const recorded=G.game.startConfig,known=recorded&&G.startConfigQuote(recorded),currentName=known?.ok?known.presetSummary.name:'旧档未记录开局配置（不根据现存资源猜测）';
    write('new-game-current',`当前村：种子 ${G.world.seed} · ${G.world.N}×${G.world.N} · ${currentName} · ${G.world.mapVersion===2?'山地':'原地形'}`);
    for(const preset of ['classic','hard'])document.getElementById('new-game-preset-'+preset).setAttribute('aria-pressed',String(s.preset===preset));
    for(const terrain of ['classic','mountain'])document.getElementById('new-game-terrain-'+terrain)?.setAttribute('aria-pressed',String(s.terrain===terrain));
    for(const size of G.MAP_SIZES)document.getElementById('new-game-size-'+size)?.setAttribute('aria-pressed',String(s.mapSize===size));
    const terrainName=s.terrain==='mountain'?'山地（开局保障谷地）':'原地形';
    const terrainNote=s.terrain==='mountain'?'山体通常不能步行或建造；可在道路分类规划直线隧道，实运施工完工后通行。开局谷地保障住房用地、可达水岸与有限原料，仍需自行采运施工；没有额外库存或住房。128格山地使用 v2 地形存档，192格使用 v3；旧版本不能读取相应新格式。':'原地形与镇址保持；新村附近分别保证至少3处可达石头和3处铁矿，工人仍须采运。新经典村使用v4地形存档，旧程序不能读取；已存村庄不补矿。';
    const q=G.startConfigQuote({seed:seed.value,preset:s.preset,terrain:s.terrain,mapSize:s.mapSize});
    seed.setAttribute('aria-invalid',String(!q.ok));
    if(q.ok){const p=q.presetSummary;
      write('new-game-preview',`已选：${p.name} · ${terrainName} · ${q.mapSizeSummary.name} · ${p.population}人`);
      write('new-game-summary',`新村预览：种子 ${q.config.seed} · ${p.name} · ${terrainName} · ${q.mapSizeSummary.name}\n${q.mapSizeSummary.note}\n${p.families}家庭 / ${p.population}人（${p.adults}成人、${p.children}儿童）；仅有储物车，住房需自行建设\n${['wood','stone','iron','food','firewood','tools'].map(k=>`${G.RES[k].name} ${p.resources[k]}`).join(' · ')}\n${p.seedNote}\n${p.equipmentNote} ${p.adaptationNote}\n${terrainNote}`);
    }else{write('new-game-preview',q.reason);write('new-game-summary',q.reason);}
    const reviewing=s.phase==='review'&&!!s.intent&&q.ok&&s.intent.key===q.key;
    phase(reviewing);check.disabled=!q.ok;confirm.disabled=!reviewing;
    if(reviewing)write('new-game-confirm-summary',`地图种子 ${s.intent.config.seed}\n${q.presetSummary.name} · ${terrainName} · ${q.mapSizeSummary.name}\n${q.presetSummary.families}家庭 / ${q.presetSummary.population}人 · 仅有储物车，住房需自行建设\n${q.presetSummary.seedNote}`);
    write('new-game-status',s.message||(!q.ok?q.reason:'当前村已暂停。先检查开局，再单独确认。'));
  },

  enterDialog: function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    const supplyPanel = this.el.info && this.el.info.querySelector?.('[data-supply-mode-panel]');
    if (supplyPanel) { this.resetSupplyConfirmation(supplyPanel, '确认已取消，请关闭弹窗后重新预览。'); this.resetClothingConfirmation(supplyPanel, '确认已取消，请关闭弹窗后重新预览。'); this.resetToolModeConfirmation(supplyPanel, '确认已取消，请关闭弹窗后重新预览。'); }
    const mineralPanel = this.el.info && this.el.info.querySelector && this.el.info.querySelector('[data-mineral-removal-panel]');
    if (mineralPanel) this.resetMineralRemoval(mineralPanel, '拆除确认已取消，请关闭弹窗后重新查看。');
    const tunnelPanel = this.el.info?.querySelector?.('[data-tunnel-removal-panel]');
    if (tunnelPanel) this.resetTunnelRemoval(tunnelPanel, '拆除确认已取消，请关闭弹窗后重新查看。');
    const pastureFocus = this.resetPastureConfirmations();
    this._dialogFocus = this._dialogFocus || {};
    this._dialogFocus[id] = pastureFocus || document.activeElement;
    if (el.setAttribute) { el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); }
    const first = el.querySelector && el.querySelector('textarea, input:not([type="file"]), button:not([disabled]), select, [tabindex="0"]');
    if (first && first.focus) first.focus();
    if (G.keys) G.keys = {};
  },
  leaveDialog: function (id) {
    const prior = this._dialogFocus && this._dialogFocus[id];
    if (prior && prior.isConnected !== false && prior.focus) prior.focus();
    if (this._dialogFocus) delete this._dialogFocus[id];
    if (G.keys) G.keys = {};
  },

  toggleHelp: function (force) {
    const h = this.el.help;
    const show = force !== undefined ? force : h.classList.contains('hidden');
    const wasHidden = h.classList.contains('hidden');
    if (show && wasHidden) { this._helpPaused = G.game.paused; G.game.paused = true; }
    h.classList.toggle('hidden', !show);
    if (show && wasHidden) this.enterDialog('help');
    if (!show && !wasHidden) this.leaveDialog('help');
    if (!show && !wasHidden && !G.game.over) G.game.paused = !!this._helpPaused;
    if (G.keys) G.keys = {};
    this.refreshHUD();
  },

  /* ---------- 错误记录面板（window.__errs，index.html 注入） ---------- */
  closeErrs: function () {
    document.getElementById('errs').classList.add('hidden');
    if (!G.game.over) G.game.paused = !!this._errsPaused;
    this.leaveDialog('errs'); this.refreshHUD();
  },
  showErrs: function () {
    if (!document.getElementById('errs').classList.contains('hidden')) return;
    this._errsPaused = G.game.paused; G.game.paused = true;
    document.getElementById('err-list').textContent =
      window.__errs.length ? window.__errs.join('\n') : '（当前没有记录到脚本错误）';
    document.getElementById('errs').classList.remove('hidden');
    this.enterDialog('errs'); this.refreshHUD();
  },

  /* ---------- 存档管理面板 ---------- */
  SLOTS: [
    { key: G.SAVE_KEY, name: '手动档' },
    { key: G.AUTOSAVE_KEY, name: '自动档' },
  ],
  showSaves: function () {
    if (!document.getElementById('saves').classList.contains('hidden')) return;
    // 打开面板时暂停，关闭时恢复
    this._resumePaused = G.game.paused;
    G.game.paused = true;
    document.getElementById('saves').classList.remove('hidden');
    this.renderSaves();
    this.enterDialog('saves');
  },
  closeSaves: function () {
    document.getElementById('saves').classList.add('hidden');
    this.leaveDialog('saves');
    if (!G.game.over) G.game.paused = !!this._resumePaused;
    G.ui.refreshHUD();
  },
  readRawSave: function (key) {
    try { return localStorage.getItem(key); } catch (e) { this.storageReadFailed = true; return null; }
  },
  readSave: function (key) {
    try { return JSON.parse(this.readRawSave(key)); } catch (e) { return null; }
  },
  saveTimeStr: function (d) {
    if (!d || !d.savedAt) return '存档时间未知';
    const t = new Date(d.savedAt);
    const pad = (n) => (n < 10 ? '0' : '') + n;
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  },
  saveGameStr: function (d) {
    if (!d || !d.game || !d.game.res || !['year','day','season'].every(k => Number.isFinite(d.game[k])) || !Number.isFinite(d.game.res.food)) return '格式不完整，可导出原文备份';
    const g = d.game;
    const pop = d.citizens ? d.citizens.length : 0;
    return `第 ${g.year} 年·${G.SEASON_NAMES[g.season]} 第 ${(g.day % G.SEASON_DAYS) + 1} 天 · 人口 ${pop} · 食物 ${Math.floor(g.res.food)}`;
  },
  renderSaves: function () {
    this.storageReadFailed = false;
    const list = document.getElementById('save-list');
    document.getElementById('saves-hint').textContent =
      G.autosaveBlocked ? '⚠ 原自动档损坏且已保护：当前临时局不会自动覆盖它。请先导出原文，载入有效档，或手动保存当前局；明确开新局才恢复正常自动存档。' : '自动档在每个季节更替、每 90 秒、离开页面时自动写入；打开游戏时自动恢复自动档。';
    let html = '';
    let any = false;
    for (const slot of this.SLOTS) {
      const d = this.readSave(slot.key);
      const raw = this.readRawSave(slot.key);
      if (raw != null) {
        any = true;
        html += `<div class="save-row">
          <span class="sav-name">${slot.name}</span>
          <span class="sav-info">${d ? this.saveTimeStr(d) : '损坏的 JSON（已保留原文）'}<small>${d ? this.saveGameStr(d) : '可导出后恢复'}</small></span>
          <button data-act="load" data-key="${slot.key}" ${d ? '' : 'disabled'}>载入</button>
          <button data-act="export" data-key="${slot.key}">导出原文</button>
          <button class="del" data-act="del" data-key="${slot.key}">删除</button>
        </div>`;
      } else {
        html += `<div class="save-row">
          <span class="sav-name">${slot.name}</span>
          <span class="sav-info save-empty">空 — 尚无存档</span>
          <button data-act="del" data-key="${slot.key}" disabled style="opacity:.4;cursor:default">删除</button>
        </div>`;
      }
    }
    if (this.storageReadFailed) document.getElementById('saves-hint').textContent = '浏览器本机存储不可用；仍可导出当前局为文件，或导入已有存档。';
    list.innerHTML = html;
    list.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (btn.dataset.act === 'export') {
          const raw = this.readRawSave(key);
          if (raw == null) return;
          const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = key + '-backup.json';
          a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else if (btn.dataset.act === 'load') {
          this.closeSaves();
          G.loadGame(key);
        } else if (btn.dataset.act === 'del') {
          try { localStorage.removeItem(key); } catch (e) { this.toast('本机存储不可用，未删除存档', 'warn'); }
          this.renderSaves();
        }
      });
    });
    // 全部清空（至少有一个存档时才显示）
    const clearBtn = document.getElementById('saves-clear');
    clearBtn.classList.toggle('hidden', !any);
    clearBtn.onclick = () => {
      if (!confirm('确定清空全部存档（手动档 + 自动档）？\n当前对局不受影响，但刷新后将无法恢复进度。')) return;
      try { for (const slot of this.SLOTS) localStorage.removeItem(slot.key); }
      catch (e) { this.toast('本机存储不可用，清理未完成', 'warn'); this.renderSaves(); return; }
      G.ui.toast('🗑 已清空全部存档', 'warn');
      this.renderSaves();
    };
    document.getElementById('save-now').onclick = () => {
      G.saveGame(G.SAVE_KEY);
      this.renderSaves();
    };
    // 服务器存档区 + 存档文件导出/导入
    this.renderServerSaves();
    document.getElementById('save-export').onclick = () => G.exportSaveFile();
    const imp = document.getElementById('save-import-file');
    document.getElementById('save-import').onclick = () => imp.click();
    imp.onchange = () => {
      const f = imp.files && imp.files[0];
      imp.value = '';
      G.importSaveFile(f);
    };
  },

  /* ---------- 服务器存档区（server.py /api/saves；探测不可用时给出提示） ---------- */
  escHtml: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  },
  refreshSavesIfOpen: function () {
    const dlg = document.getElementById('saves');
    if (dlg && !dlg.classList.contains('hidden')) this.renderSaves();
  },
  renderServerSaves: function () {
    const box = document.getElementById('server-saves');
    if (!box) return;
    if (G.serverSaves.available === false) {
      box.innerHTML = `<div class="server-saves-hint">🖥 服务器存档不可用（用 <code>python3 server.py</code> 启动即启用，
        按当前浏览器身份隔离）。本机存档不受影响；跨浏览器或设备请导出/导入 JSON 存档文件。</div>`;
      return;
    }
    fetch('/api/saves').then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(j => {
        if (!j || !j.ok) throw new Error('bad');
        const saves = j.saves || [];
        let html = `<div class="server-saves-head">
          <span>🖥 服务器存档 <small>仅当前浏览器身份可见（含自动档）</small></span>
          <span class="server-save-new">
            <input id="server-save-name" maxlength="40" placeholder="存档名，如：第二个冬天">
            <button id="server-save-now">💾 存到服务器</button>
          </span></div>
          <div class="server-saves-hint">浏览器 Cookie 用于识别你的存档；清除 Cookie 后将无法访问原服务器存档。跨浏览器或设备请导出/导入 JSON 存档文件。</div>`;
        html += saves.map(s => {
          const sum = s.summary && s.summary.savedAt
            ? this.saveGameStr({ game: s.summary, citizens: { length: s.summary.pop || 0 } }) : '';
          const name = this.escHtml(s.name);
          return `<div class="save-row server">
            <span class="sav-name">${name}</span>
            <span class="sav-info">${sum ? this.saveTimeStr(s.summary) + `<small>${sum}</small>` : '摘要不可读'}<small>${Math.max(1, Math.round(s.size / 1024))} KB</small></span>
            <button data-srv="load" data-name="${name}">载入</button>
            <button class="del" data-srv="del" data-name="${name}">删除</button>
          </div>`;
        }).join('') || '<div class="save-row"><span class="sav-info save-empty">服务器暂无存档</span></div>';
        box.innerHTML = html;
        const input = document.getElementById('server-save-name');
        document.getElementById('server-save-now').onclick = () => {
          const name = (input.value || '').trim();
          if (!name) { G.ui.toast('请先填写存档名', 'warn'); input.focus(); return; }
          G.saveToServer(name)
            .then(() => this.renderServerSaves())
            .catch(() => {});
        };
        box.querySelectorAll('button[data-srv]').forEach(btn => {
          btn.addEventListener('click', () => {
            const name = btn.dataset.name;
            if (btn.dataset.srv === 'load') {
              G.loadFromServer(name).catch(e => G.ui.toast('载入失败：' + e.message, 'bad'));
            } else if (confirm(`确定删除服务器存档「${name}」？`)) {
              G.deleteServerSave(name)
                .then(() => this.renderServerSaves())
                .catch(e => G.ui.toast('删除失败：' + e.message, 'bad'));
            }
          });
        });
      })
      .catch(() => {
        G.serverSaves.available = false;
        this.renderServerSaves();
      });
  },

  gameOver: function () {
    const g = G.game;
    localStorage.removeItem(G.AUTOSAVE_KEY); // 死档不自动恢复，下次启动开新局
    G.deleteServerSaveQuiet('autosave');     // 服务器自动档同步清理
    this.el.overText.innerHTML =
      `你的小镇在<strong>第 ${g.year} 年</strong>消亡了。<br><br>` +
      `存续 ${Math.floor(g.day / G.SEASON_DAYS)} 个季度 · 出生 ${g.stats.born} 人 · 死亡 ${g.stats.died} 人<br>` +
      (Object.keys(g.stats.deadReasons).map(k => `${this.escHtml(k)} ×${Number(g.stats.deadReasons[k]) || 0}`).join(' · ')) +
      `<br><small style="opacity:.6">版本 ${G.VERSION} · 反馈时提到它可帮我对号入座</small>`;
    this.el.over.classList.remove('hidden');
  },
};

/* Observation only: no pathfinding, task assignment, or inventory mutation here. */
G.harvestFeedback = function () {
  const w = G.world;
  const trees = new Set([...(w.marked || [])].filter(i => w.treeIdx && w.treeIdx[i] >= 0));
  const rocks = new Set([...(w.markedRocks || [])].filter(i => w.rock && w.rock[i]));
  const active = new Set(), paused = new Set();
  const h = { trees: trees.size, rocks: rocks.size, total: trees.size + rocks.size, active: 0, paused: 0, queued: 0,
    laborers: 0, haulers: 0, waitingCarriers: 0, blockedMineralCarriers: 0, blockedMineralMarks: 0, carry: {}, reason: '' };
  for (const i of rocks) {const type=w.rock[i]===2?'iron':'stone';if(G.game.res[type]>=G.storageCap(type))h.blockedMineralMarks++;}
  for (const k of G.RES_KEYS) h.carry[k] = 0;
  let adults = 0, builders = 0, foodWorkers = 0, otherWorkers = 0;
  const claim = t => {
    if (!t) return null;
    const i = t.tree ? t.tree.y * w.N + t.tree.x : t.ty * w.N + t.tx;
    if ((t.kind === 'chop' || t.kind === 'clearSite') && trees.has(i) && (!t.tree || w.trees[w.treeIdx[i]] === t.tree)) return 't' + i;
    if (t.kind === 'clearrock' && rocks.has(i)) return 'r' + i;
    return null;
  };
  for (const c of w.citizens) {
    if (c.dead) continue;
    const current = claim(c.task), held = claim(c.pausedTask);
    if (current) active.add(current);
    if (held) paused.add(held);
    if (c.adult) {
      adults++;
      if (c.job == null) h.laborers++;
      else {
        const b = w.bmap[c.job];
        if (b && b.state === 'site') builders++;
        else if (b && ['gatherer', 'hunting', 'dock', 'farm', 'orchard', 'pasture'].includes(b.type)) foodWorkers++;
        else otherWorkers++;
      }
    }
    if (c.carry && G.RES_KEYS.includes(c.carry.type) && Number.isFinite(c.carry.qty) && c.carry.qty > 0) {
      h.carry[c.carry.type] += c.carry.qty;
      if (G.isMineralCargo(c) && G.game.res[c.carry.type] >= G.storageCap(c.carry.type) && c.state !== 'haul') h.blockedMineralCarriers++;
      if (c.state === 'haul') h.haulers++;
      else h.waitingCarriers++;
    }
  }
  for (const key of active) paused.delete(key);
  h.active = active.size; h.paused = paused.size;
  h.queued = Math.max(0, h.total - h.active - h.paused);
  if (h.total && G.isRestTime()) h.reason = '夜间休息，已认领任务天亮继续。';
  else if (h.total && h.blockedMineralMarks === h.total && !h.active && !h.paused) h.reason = '石铁仓位已满，标记等待空间；使用库存或建成新仓库后继续。';
  else if (h.queued && !h.active && !h.paused) {
    if (!adults) h.reason = '暂无可工作的成人。';
    else if (!h.laborers) h.reason = `暂无散工：工地 ${builders} 人 · 食物岗 ${foodWorkers} 人 · 其他 ${otherWorkers} 人。${G.game.foodUrgent ? '粮食偏紧时优先保粮。' : '减少并行工地可减轻争用。'}`;
    else h.reason = '标记尚未接单：散工可能正搬货或等待调度；持续无进展时检查通路。';
  }
  return h;
};

/* Same inclusive square bounds as treesInRadius, also used by the map overlay. */
G.foodForestBounds = function (w) {
  return w.buildings.filter(b => b.state === 'ok' && ['gatherer', 'hunting'].includes(b.type)).map(b => {
    const r = G.PROD[b.type].radius;
    return [Math.max(0, b.x - r), Math.max(0, b.y - r), Math.min(w.N, b.x + r + 1), Math.min(w.N, b.y + r + 1)];
  });
};

/* Placement facts use exactly the same origin and square work bounds as production. */
G.placementInfo = function (type, x, y) {
  const w = G.world, def = G.BDEF[type], p = G.PROD[type] || {};
  const check = G.canPlace(w, type, x, y);
  const affordable = Object.keys(def.cost).every(k => G.game.res[k] >= def.cost[k]);
  const result = { ok: check.ok && affordable, affordable, radius: type === 'market' ? G.SUPPLY.marketRadius : p.radius || p.waterR || 0, warning: false };
  result.bounds = [Math.max(0,x-result.radius), Math.max(0,y-result.radius), Math.min(w.N,x+result.radius+1), Math.min(w.N,y+result.radius+1)];
  const lines = [`${def.name} · ${!check.ok ? '不能建：' + check.reason : !affordable ? '材料不足' : '可建造'}`];
  lines.push('材料（现有/需要）：' + (Object.keys(def.cost).map(k => `${G.RES[k].name} ${Math.floor(G.game.res[k])}/${def.cost[k]}`).join(' · ') || '无需建材，仍需施工'));
  if (Object.keys(def.cost).length) lines.push('确认只创建工地，不预扣/预留库存；工人沿路到仓领料，实运送齐后才施工。');
  if (p.radius) {
    const trees = G.treesInRadius(w, x, y, p.radius, false).filter(t => !(t.x >= x && t.x < x + def.w && t.y >= y && t.y < y + def.h));
    result.trees = trees.length; result.mature = trees.filter(t => G.treeStage(t) >= 2).length;
    lines.push(`工作范围 ±${p.radius} 格（方形，建筑原点） · 占地清场后 ${result.trees} 棵树 / 成熟 ${result.mature}`);
    if (['gatherer', 'herbalist'].includes(type)) {
      const n = type !== 'gatherer' ? result.mature : result.trees;
      if (n < p.needTrees) { result.warning = true; lines.push(`⚠ 可建但当前无法生产：至少需 ${p.needTrees} 棵${type !== 'gatherer' ? '成熟' : ''}树`); }
      else if (result.mature < p.fullForest) { result.warning = true; lines.push(`△ 林量偏低：产量随成熟林增加，充足参考 ${p.fullForest} 棵`); }
    }
    if (type === 'forester') lines.push('砍伐会降低重叠食物林产量；可在建筑面板关闭砍伐育林。');
  }
  if(type==='hunting'){
    const h=G.huntingSummary({type,x,y,w:def.w,h:def.h,state:'ok',workers:[]});result.hunting=h;
    lines.push(`鹿群：圈内 ${h.count} 只 · 未被追踪 ${h.free} 只 · 当前门外可达 ${h.reachable} 只（排除拟建占地）`);
    lines.push(`最多2名猎人共用每 ${G.HUNTING.cooldownDays} 天一次猎杀；实际追踪、劳动和肉皮送仓后才有库存。`);
    lines.push('林木是栖地参考，不按树数直接发肉。鹿会补入，不啃食作物；数量会随活动和猎杀变化。');
    if(!h.reachable){result.warning=true;lines.push('⚠ 当前没有可达且未被追踪的鹿；建成后须等待鹿群或改善通路。');}
  }
  if (type === 'dock') {
    const fish = G.fishingPlacementSummary(x, y); result.fishing = fish; result.water = fish.raw;
    lines.push(`全镇渔业：${fish.rule === 'shared' ? '共享可用水域' : '经典水域（旧档保留）'} · 工作范围 ±${p.waterR} 格（方形，建筑原点） · 满产参考 ${p.fullWater} 格`);
    lines.push(`水域：原始 ${fish.raw} · 桥占 ${fish.blocked} · 可用 ${fish.free} · 重叠共享 ${fish.sharedTiles} · 共享口径有效 ${G.ui.fishingNumber(fish.effective)} 格`);
    lines.push(`新屋下一批估计 ${fish.catch} 肉类（基础 ${fish.baseCatch}，已计当前工具规则）；假定本屋完工并配渔民，其他渔屋按当前实际在岗估算。`);
    if (fish.affected.length) lines.push('相邻在岗渔屋基础每批（未计工具）：' + fish.affected.map(row => `#${row.id} ${row.before} → ${row.after}`).join('；'));
    else lines.push('当前没有受此处新增在岗渔屋影响的邻屋。');
    lines.push(fish.rule === 'shared' ? '桥梁工地即占水；0人/0上限/工地不竞争，休息和搬运仍计。只影响之后新接批次，当前任务与携货不变。' : '当前经典规则仍按原始水域计产，新建不会自动切换；可在渔屋或市政厅详情查看全镇一次性启用确认。');
    lines.push('这是单批估计，不是年度或入库保证；教育影响工时，真实行走、劳动、送仓仍须完成。');
    if ((fish.rule === 'shared' ? fish.effective : fish.raw) < p.fullWater) { result.warning = true; lines.push(fish.catch === 0 ? '⚠ 无可捕鱼水域，无法接新捕鱼批次' : '△ 有效水域不足满产参考，单次渔获较低'); }
  }
  if(type==='market')lines.push(`占地 3×3 · 服务范围 ±${G.SUPPLY.marketRadius} 格（方形，建筑原点） · 最多 1 名货商；货商搬 ${G.SUPPLY.vendorCarry}，家庭成人搬 ${G.SUPPLY.homeCarry}。近仓直接采购可能更快；市场只转运，不生产粮柴，自动供给模式下需先确认整村切换。`);
  if(type==='stockpile')lines.push('完工后：仅木/石/铁/煤/柴各增加250公共仓容，零常驻工人；不是独立地方库存。');
  if (type === 'chapel') {
    lines.push(`最多 1 名牧师 · 服务容量 ${G.CHAPEL.capacity} 人 · 当前预约最多 ${G.CHAPEL.visitorCapacity} 人（含在途，本作适配）。`);
    lines.push('居民与健康牧师必须沿可达通路实际到场；无需仓库供给、食物或麦酒。请保留建筑出入口。');
  } else if (check.ok) {
    const outputs=G.productionOutputsOf({type});
    const route = G.storageRoute(x,y,outputs.length?outputs:null);
    if (route) lines.push(`当前地形可达仓：约 ${route.path.length} 步；道路更快，完工后须保留出入口。`);
    else { result.warning = true; lines.push(type === 'market' ? '⚠ 当前找不到可达仓库，货商无法从公共库存补货' : '⚠ 当前找不到可达仓库，产物无法正常入库'); }
  } else lines.push('物流：地块合法后显示可达仓；近仓且通路畅通，搬运更快。');
  let clearing = 0;
  for (let yy = Math.max(0,y); yy < Math.min(w.N,y+def.h); yy++) for (let xx = Math.max(0,x); xx < Math.min(w.N,x+def.w); xx++) if (w.treeIdx[yy*w.N+xx] >= 0) clearing++;
  if (clearing) lines.push(`清场 ${clearing} 棵树：工人逐棵砍伐并搬运，完成后才施工；取消保留未砍树。`);
  lines.push('工人自动分配：食品优先；工地过多会争用散工。');
  result.text = lines.join('\n');
  return result;
};

