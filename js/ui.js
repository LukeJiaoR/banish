'use strict';
/* ============================================================
 * ui.js —— HUD、建造菜单、信息面板、通知、存档界面
 * ============================================================ */

G.ui = {
  el: {},
  infoT: 0,

  // Every stock display and HTML building cost uses the same resource registry.
  // Emoji are a shared image-load fallback only; text tooltips spell out names.
  resourceIcon: function (type) {
    const r = G.RES[type];
    return `<span class="res-icon" role="img" aria-label="${r.name}" title="${r.name}"><span aria-hidden="true">${r.icon}</span>${r.iconAsset ? `<img src="assets/icons/${r.iconAsset}.png" alt="" onerror="this.remove()">` : ''}</span>`;
  },

  resourceCost: function (cost, html) {
    return Object.keys(cost).map(type => html
      ? `<span class="res-cost">${this.resourceIcon(type)}<span>${cost[type]}</span></span>`
      : `${G.RES[type].name}×${cost[type]}`).join(' ') || '免费';
  },

  // Read-only citizen feedback. Idle is a scheduler state, not proof of a deadlock.
  citizenStatus: function (c) {
    const b = c.job != null ? G.world.bmap[c.job] : null;
    if (G.isArriving ? G.isArriving(c) : c.arrivalHallId != null) return '迁入途中：先步行到市政厅报到';
    if (c.task && c.task.kind === 'care' && G.medicalStatus) return G.medicalStatus(c);
    if(c.student&&G.studentSummary)return G.studentSummary(c).status;
    if(c.task?.kind==='teach')return c.state==='walk'?'教师步行到校':G.inSchool(c)?'教师已到校，实际授课':'教师尚未到校';
    if (c.task && c.task.kind === 'leisure' && c.state !== 'rest' && c.walkKind !== 'home') {
      if (c.state === 'walk') return '前往酒馆休闲（18 岁以上）';
      if (G.tavernStaff && !G.tavernStaff(c.task.b)) return '等待健康酿酒工到岗（最多等待 4 小时）';
      return c.state === 'work' ? `酒馆休闲中（尚需 ${Math.max(0, Number(c.task.workLeft) || 0).toFixed(1)} 小时服务）` : '等待酒馆服务';
    }
    if (c.state === 'rest') {
      if (G.citizenIndoorHome && G.citizenIndoorHome(c)) return '屋内休息';
      return G.homeOf(c) ? '户外休息（未入屋）' : '露宿（无住房）';
    }
    if (c.state === 'work') {
      if(c.task?.kind==='tailor')return c.task.phase==='fetch'?'在库领取整批衣料':`制作${G.RES[c.task.yield.type].name}（使用随身衣料）`;
      if(c.task?.kind==='fuel')return c.task.phase==='fetch'?'在库领取原木（整批出库）':'劈柴中（使用随身已取原木）';
      if(c.task?.kind==='smith')return c.task.phase==='fetch'?'在库取铁匠原料（整批出库）':`锻造${G.RES[c.task.yield.type].name}（使用随身已取原料）`;
      if (c.task && c.task.kind === 'brew') return c.task.phase === 'fetch' ? '取主食酿酒' : '加工麦酒';
      if (c.task && c.task.kind === 'host') return '酒馆在岗接待';
      if (c.task && c.task.kind === 'clinic') return b && b.type === 'herbalist' ? '采药屋值守' : '诊所值守';
      if (c.task && c.task.kind === 'trade') return c.task.phase === 'return' ? '退回待售库存' : '装卸贸易物资';
      if(c.task?.kind==='orchard')return ({plant:'种植果树',tend:'养护幼树',harvest:'采收果实'})[c.task.phase]+'（第'+(c.task.ti+1)+'株）';
      const labels = { clearSite: '清理工地', chop: '砍伐', clearrock: '清矿', build: '建造中', sow: '播种', harvest: '收获', plant: '补种', firewood: '加工柴火' };
      return c.task ? (labels[c.task.kind] || (b && b.type === 'tailor' ? '制作衣物' : b && b.type === 'orchard' ? '果园劳作' : b && b.type === 'pasture' ? `照料${G.LIVESTOCK[G.pastureTypeOf(b)].name}群` : '工作中')) : '等待下一项任务';
    }
    if (c.state === 'walk' || c.state === 'haul') {
      if(c.carry?.coatInput)return c.state==='haul'?'退回未使用衣料':c.walkKind==='home'?'带衣料回家休息':'携衣料返回裁缝铺';
      if(c.carry?.fuelInput)return c.state==='haul'?'退回未使用的原木':c.walkKind==='home'?'带原木回家休息':'携原木返回伐木屋';
      if(c.carry?.smithInput)return c.state==='haul'?'退回铁匠原料（已出库，未消耗）':c.walkKind==='home'?'带铁匠原料回家休息':c.task?.kind==='smith'?'携铁、木或煤返回铁匠铺':'铁匠原料待退仓';
      if (c.carry) return c.carry.brewIngredient ? `搬运酿酒主食（${c.state === 'haul' ? '退回仓库' : '送往酒馆'}）` : `搬运${G.RES[c.carry.type].name}（${c.state === 'haul' ? '送仓' : '途中'}）`;
      if (c.walkKind === 'home') return '回家途中';
      if (c.walkKind === 'wander') return '闲逛';
      if(c.task?.kind==='tailor')return c.task.phase==='fetch'?'前往通用仓取衣料（尚未扣料）':`返回裁缝铺制作${G.RES[c.task.yield.type].name}`;
      if (c.task && c.task.kind === 'firewood' && c.task.phase === 'fetch') return c.task.consume && G.RES[c.task.consume.type] ? `前往仓库取${G.RES[c.task.consume.type].name}` : '前往仓库取原木';
      if(c.task?.kind==='orchard')return ({plant:'前往空树位种植',tend:'前往幼树照料',harvest:'前往成熟果树采果'})[c.task.phase]+'（第'+(c.task.ti+1)+'株）';
      if(c.task?.kind==='fuel')return '前往堆料场或仓库取原木（尚未扣料）';
      if(c.task?.kind==='smith')return '前往堆料场或仓库取铁匠原料（尚未扣料）';
      if (c.task && c.task.kind === 'brew') return c.task.phase === 'fetch' ? '前往仓库取酿酒主食' : '前往酒馆加工麦酒';
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
    if (b.type === 'pasture' && !(b.animals > 0)) return '等待放入同种牲畜';
    if (b.type === 'orchard' && !(G.game.unlocks && G.game.unlocks.orchard)) return '等待贸易购入果树种子';
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
      status = trees ? `清理工地：还需砍 ${trees} 棵树（工人搬运入仓）` : `建造中 ${Math.floor(b.progress * 100)}%`;
    } else if (G.productionGoalOf('firewood') !== null && G.fuelLimited(b)) status = G.buildingGoalStatus(b);
    else if (G.fuelLimited(b)) status = '本屋暂停新批次：柴火库存已达本屋目标';
    else if (!G.jobCanProduce(b)) status = '本屋暂无新批次：缺原木';
    // A previous limit warning can outlive its cutoff after fuel is used up.
    else if (b.warnText !== '柴火已达上限' && (b.noWork || (b.warnText && !b.workers.length)))
      status = `停工：${b.warnText || '无法工作'}`;
    else status = b.workers.length ? '运作中' : '等待可用工人';
    return {
      target: `本屋燃料目标：${G.fuelLimitOf(b)}` + (G.productionGoalOf('firewood') !== null ? '；' + G.buildingGoalStatus(b) : ''),
      stock: `全镇库存：柴火 ${Math.floor(stock)} · 原木 ${Math.floor(G.game.res.wood)}`,
      batches:this.fuelBatchText(b),
      heat: this.heatDemandText(heat),
      gap: usable < need ? `${G.heatingPolicy?.().allowCoal?'可用燃料':'柴火库存'}比${heat.winter ? '本冬后续' : '整冬'}取暖估算少约 ${Math.ceil(need - usable)}。` : '取暖估算会随住房入住情况变化。',
      status,
      workers: b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、') ||
        (b.state === 'site' ? '等待建筑工人' : '无'),
      refund: b.state === 'site' && !b.constructionStarted && b.progress === 0 && b.workLeft >= b.totalWork
        ? '未开工：取消退还全部已付建材，保留树木' : '已开工：拆除退还一半已付建材，已砍树不恢复',
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

    // 资源栏
    const foodKeys = ['food', ...(G.FOOD_KEYS || [])].filter(k => G.RES_KEYS.includes(k));
    const resourceChip = k => `<span class="res${k === 'food' ? ' res-total' : ''}" id="res-${k}" title="${G.RES[k].name}">${this.resourceIcon(k)}<span class="res-label">${k === 'food' ? '总食物' : G.RES[k].name}</span><b>0</b>${k === 'food' ? '<i id="net-food"></i>' : ''}</span>`;
    this.el.resRow.innerHTML = `<div class="resource-group food-resources" aria-label="食物总量与分类">${foodKeys.map(resourceChip).join('')}</div>` +
      `<div class="resource-group materials-resources" aria-label="材料与用品">${G.RES_KEYS.filter(k => !foodKeys.includes(k)).map(resourceChip).join('')}</div>`;

    // 速度按钮（原版：暂停 / 1x / 2x / 5x）
    this.el.speed.innerHTML = [
      ['⏸', 'pause', '暂停 (空格)'],
      ['▶', 1, '正常速度 (1)'],
      ['⏩', 2, '二倍速 (2)'],
      ['⏭', 5, '五倍速 (3)'],
    ].map(([ic, v, tip]) =>
      `<button class="sp" data-v="${v}" title="${tip}">${ic}</button>`
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

    // 顶栏按钮
    document.getElementById('btn-save').addEventListener('click', () => { G.saveGame(); });
    document.getElementById('btn-load').addEventListener('click', () => this.showSaves());
    document.getElementById('btn-new').addEventListener('click', () => { if (confirm('放弃当前进度，开创新家园？')) G.newGame(); });
    document.getElementById('btn-help').addEventListener('click', () => this.toggleHelp());
    document.getElementById('btn-err').addEventListener('click', () => this.showErrs());
    document.getElementById('errs-close').addEventListener('click', () => this.closeErrs());
    document.getElementById('errs-clear').addEventListener('click', () => {
      window.__errs.length = 0;
      this.refreshHUD();
    });
    document.getElementById('help-close').addEventListener('click', () => this.toggleHelp(false));
    document.getElementById('over-restart').addEventListener('click', () => { this.el.over.classList.add('hidden'); G.newGame(); });
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
    const available = t => special.includes(t) || !!G.BDEF[t];
    this.toolGroups = [
      { id: 'homes', name: '住房', icon: '🏠', hint: '安家与过冬', tools: ['house', 'stonehouse', 'boarding'] },
      { id: 'food', name: '食物生产', icon: '🌾', hint: '肉类 · 蔬菜 · 主食', tools: ['gatherer', 'hunting', 'dock', 'farm', 'orchard', 'pasture'] },
      { id: 'industry', name: '资源与加工', icon: '⚒️', hint: '木石铁煤 · 工具 · 衣物 · 酿造', tools: ['forester', 'woodcutter', 'stonequarry', 'mine', 'blacksmith', 'tailor', 'tavern'] },
      { id: 'services', name: '城镇服务', icon: '🏘️', hint: '储运 · 教育 · 医疗 · 迁入 · 安葬', tools: ['storage', 'stockpile', 'school', 'herbalist', 'hospital', 'tradingpost', 'townhall', 'cemetery'] },
      { id: 'land', name: '道路与采运', icon: '🛣️', hint: '修路 · 采集 · 拆除', tools: ['road', 'stoneroad', 'bridge', 'fell', 'quarry', 'demolish'] },
    ].map(group => ({ ...group, tools: group.tools.filter(available) })).filter(group => group.tools.length);
    const registered = new Set(this.toolGroups.flatMap(group => group.tools));
    const extra = (G.TOOLBAR || []).filter(t => available(t) && !registered.has(t));
    if (extra.length) this.toolGroups.push({ id: 'other', name: '其他建筑', icon: '🔨', hint: '更多建造', tools: extra });
    this.menuCategory = null;
    this.el.toolbar.innerHTML = `
      <div class="toolbar-heading">
        <button type="button" id="toolbar-back" class="toolbar-nav hidden" title="返回分类，并取消当前工具与未确认预览">‹ 返回分类</button>
        <span id="toolbar-path">建造与管理</span>
        <button type="button" id="toolbar-cancel" class="toolbar-nav hidden" title="退出当前工具；已确认的采运任务会保留">取消工具</button>
      </div>
      <div id="toolbar-categories" class="toolbar-items" role="group" aria-label="一级功能分类">
        ${this.toolGroups.map(group => `<button type="button" class="tb tb-category" data-category="${group.id}" aria-controls="toolbar-group-${group.id}" aria-expanded="false"><span class="ic" aria-hidden="true">${group.icon}</span><span class="lb">${group.name} ›</span><span class="cost">${group.tools.length} 项 · ${group.hint}</span></button>`).join('')}
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
      const selected = G.tool && (G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind);
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

  toolButton: function (t) {
    const icons = { stonehouse: 'tool_stonehouse', boarding: 'tool_boarding', mine: 'tool_mine', stonequarry: 'tool_stonequarry',
      blacksmith: 'tool_blacksmith', hunting: 'tool_hunting', house: 'tool_house', storage: 'tool_storage', stockpile:'tool_stockpile',
      gatherer: 'tool_gatherer', forester: 'tool_forester', woodcutter: 'tool_woodcutter', dock: 'tool_dock',
      school: 'tool_school', herbalist: 'tool_herbalist', hospital: 'tool_hospital', townhall: 'tool_townhall', tavern: 'tool_tavern', farm: 'tool_farm', road: 'tool_road', stoneroad: 'tool_stoneroad', bridge: 'tool_bridge', demolish: 'tool_demolish' };
    const special = {
      demolish: { name: '拆除', icon: '🚫', cost: '建筑 · 道路', tip: '拆除：点击建筑或道路移除；树木请用砍伐，岩石和铁矿请用采石采铁' },
      quarry: { name: '采石采铁', icon: '⛏', cost: '灰石 · 锈铁', tip: '采石采铁：框选预览并确认矿石；灰色岩石产石头，锈色铁矿产铁，散工开采后搬运入库' },
      fell: { name: '砍伐', icon: '🪚', cost: '免费', tip: '标记砍伐：框选预览并确认树木，散工砍倒再搬运入库；未受教育 2 原木、受教育 3 原木' },
    };
    const def = G.BDEF[t], action = special[t];
    const name = action ? action.name : def.name, icon = action ? action.icon : def.icon;
    const cost = action ? action.cost : this.resourceCost(def.cost, true);
    const tip = action ? action.tip : t === 'road' ? '道路：点选或鼠标拖出起终点预览连通路线，确认后铺设；树木需先标记由工人清除' :
      `${def.name}（${this.resourceCost(def.cost, false)}${def.jobs ? ' · 岗位×' + def.jobs : ''}）— ${def.desc}`;
    const imagePath = icons[t] ? `assets/icons/${icons[t]}.png` : ['tailor', 'tradingpost', 'pasture', 'orchard'].includes(t) ? `assets/buildings/${t}.png` : null;
    const image = imagePath ? `<img class="icimg" src="${imagePath}" alt="" onerror="this.remove()">` : '';
    return `<button type="button" class="tb" data-tool="${t}" title="${this.escHtml(tip)}" aria-pressed="false"><span class="ic" aria-hidden="true">${icon}${image}</span><span class="lb">${name}</span><span class="cost">${cost}</span></button>`;
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
      const t = G.tool && (G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind);
      const names = { fell: '砍伐', quarry: '采石采铁', demolish: '拆除', road: '铺路' };
      status.textContent = t ? `当前：${names[t] || G.BDEF[t].name} · ${t === 'demolish' ? '点击建筑或道路立即拆除' : ['fell', 'quarry'].includes(t) ? '框选范围后确认标记' : ['road','stoneroad','bridge'].includes(t) ? '选起终点后预览并确认' : t==='farm'?'选两个角或拖出矩形，再确认开田' : '点击地图放置，可连续建造'} · Esc / 右键取消` :
        group ? '未选择工具。点击一项开始；返回分类可切换功能。' : '选择分类，再选择建筑或操作。';
    }
  },

  setToolActive: function () {
    this.el.toolbar.querySelectorAll('button').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tool && btn.setAttribute) btn.setAttribute('aria-pressed', 'false');
    });
    if (G.tool) {
      const t = G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind;
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
      const tool = G.tool ? (G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind) : this._harvestRangeTool;
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

  initRoadControls: function () {
    const confirm = document.getElementById('road-confirm'), cancel = document.getElementById('road-cancel');
    if (!confirm || !cancel) return;
    let armed = null, keyHeld = false;
    const capture = e => {
      if (e.type === 'mousedown' && armed && armed.source === 'touchstart') return;
      keyHeld = false;
      armed = confirm._roadIntent ? { ...confirm._roadIntent, source: e.type } : null;
    };
    for (const name of (window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'])) confirm.addEventListener(name, capture);
    confirm.addEventListener('keydown', e => {
      if (!['Enter', ' '].includes(e.key) || e.repeat) return;
      keyHeld = true;
      armed = confirm._roadIntent ? { ...confirm._roadIntent, source: 'keyboard' } : null;
    });
    confirm.addEventListener('keyup', e => { if (['Enter', ' '].includes(e.key)) keyHeld = false; });
    confirm.addEventListener('pointercancel', () => { armed = null; keyHeld = false; });
    confirm.addEventListener('touchcancel', () => { armed = null; keyHeld = false; });
    window.addEventListener('blur', () => { armed = null; keyHeld = false; });
    confirm.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const intent = armed || confirm._roadIntent;
      if (!keyHeld) armed = null;
      if (!intent) { this.refreshRoadControls(); return; }
      const result = G.confirmRoadPlan(intent);
      if (result.reason) this.toast(result.reason, 'warn');
      else if (result.bridge && result.ok) this.toast('木桥工地已确认；工人完工前不可通行', 'good');
      else if (result.placed != null) this.toast(`已铺设 ${result.placed} 格${result.surface==='stone'?'石路':'土路'}`, 'good');
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
      const stone=plan.surface==='stone', bridge=plan.surface==='bridge';
      const changed=stone?status.materials.stone:r.newTiles;
      message = bridge ? `木桥 ${r.path.length} 格 · 直线跨水\n桥头 (${plan.start.x},${plan.start.y}) → (${plan.end.x},${plan.end.y})\n材料：木材 ${status.materials.wood} / 石头 ${status.materials.stone} · 建造 ${r.path.length*3} 工时\n工人从岸边施工，完工前不可通行` :
        `路线 ${r.path.length} 格 · ${stone?'新铺/升级':'新铺'} ${changed} · 复用 ${r.path.length-changed} · 转弯 ${r.turns} 次\n${stone?'石路每格1石，合计 '+status.materials.stone+' 石':'土路材料消耗：0'} · 尚需清树 ${status.trees.length} 棵`;
      const missing=Object.entries(status.materials).filter(([k,q])=>G.game.res[k]<q).map(([k,q])=>`${G.RES[k].name}差${Math.ceil(q-G.game.res[k])}`);
      if(missing.length)message+='\n材料不足：'+missing.join(' · ');
      if (plan.message) message += '\n' + plan.message;
    }
    message += G.tool.surface==='bridge'?'\n点选/拖选两岸，终点吸附较长方向轴；需连续水面和清场桥头。Esc/右键退出。':'\n点选起终点，或鼠标拖出起终点、松开预览；再确认铺路。水面、建筑和矿石需绕行。Esc/右键退出。';
    if (text.textContent !== message) text.textContent = message;
    const waiting = status.ok && status.trees.length && !status.added.length;
    button._roadIntent = status.ok ? { plan, mode: status.bridge?'bridge':status.trees.length ? 'clear' : 'pave', trees: status.trees.map(p => p.y * G.world.N + p.x).join(',') } : null;
    button.textContent = status.ok && status.trees.length ? (waiting ? '等待工人清树' : '确认标记清树') : status.bridge?'确认建桥':'确认铺路';
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
        const tool = G.tool ? (G.tool.kind === 'build' ? G.tool.type : G.tool.kind==='road' ? (G.tool.surface==='bridge'?'bridge':G.tool.surface==='stone'?'stoneroad':'road') : G.tool.kind) : this._harvestTool;
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

  refreshHUD: function () {
    if (!G.world) return;
    const g = G.game;
    this.refreshGuide();
    this.refreshProductionGoals();
    const hauling = G.harvestFeedback();
    hauling.carry.food += (G.FOOD_KEYS || []).reduce((sum, type) => sum + (hauling.carry[type] || 0), 0);
    for (const k of G.RES_KEYS) {
      const el = document.getElementById('res-' + k);
      if (el) {
        el.querySelector('b').textContent = Math.floor(g.res[k]);
        const cap = G.storageCap(k);
        const foodClass = (G.FOOD_KEYS || []).includes(k);
        const tool = k === 'tools' || k === 'steelTools';
        el.title = `${G.RES[k].name}：${Math.floor(g.res[k])}${tool ? '（工具不限仓储）' : foodClass ? '（三类食物共享总食物仓容 ' + cap + '）' : ' / ' + cap}`;
        if (k === 'food' && G.FOOD_KEYS) el.title += ' · ' + G.FOOD_KEYS.map(type => `${G.RES[type].name} ${Math.floor(g.res[type] || 0)}`).join(' + ') + '（分类之和，不重复计入库存）';
        if (hauling.carry[k]) el.title += ` · 另有 ${hauling.carry[k]} 随身待入库（尚不可用）`;
        if (['stone', 'iron', 'coal'].includes(k) && hauling.carry[k] && g.res[k] >= cap) el.title += ' · 仓满保留余矿，使用库存或建成新仓库后送仓';
        if (k === 'food' && G.world.citizens.length) el.title += ` · 可供 ${(g.res.food / (G.world.citizens.length * G.LIFE.eatPerDay)).toFixed(1)} 天（不计新产出）`;
        if (tool) {
          const adults = G.world.citizens.filter(c => c.adult).length;
          el.title += ` · 单件寿命 ${k === 'steelTools' ? G.LIFE.steelToolLifeDays : G.LIFE.toolLifeDays} 成人天；两类工具生产效率相同，优先磨损钢工具`;
          if (adults) el.title += ` · 两类工具合计 ${Math.floor(G.toolStock())} 件，当前成人约可用 ${Math.floor(G.toolDaysLeft(adults))} 天（扣除已磨损，不计新产出）`;
          el.title += k === 'steelTools' ? '；钢工具需铁、原木与煤' : '；铁工具需铁与原木';
        }
        if (k === 'clothes' || k === 'warmCoats') {
          const unprotected = G.world.citizens.filter(c => !(c.clothingLeft > 0)).length;
          el.title += ` · ${unprotected} 人衣物已耗尽；${k === 'warmCoats' ? '暖衣需 2 皮革 + 2 羊毛，户外受冻降低 70%（较普通衣物再减半）' : '普通衣物需 2 皮革或 2 羊毛，户外受冻降低 40%'}；每件 ${G.YEAR_DAYS} 天，日终穿坏才优先领暖衣，再领普通衣物；不替代住房与柴火`;
        }
        if (k === 'herbs') el.title += ' · 采药屋在成熟林中采集，送仓后用于草药保健；诊所治疗不消耗草药';
        if (k === 'ale') el.title += ' · 麦酒不计入三类食物，不可充饥；仅供 18 岁以上居民到酒馆休闲，每次消耗 1 麦酒';
        if (k === 'ale' && hauling.carry[k] && g.res[k] >= cap) el.title += ' · 仓满保留麦酒，腾出空间后继续送仓';
        if (k === 'firewood') {
          el.title += ` · ${this.heatDemandText(this.heatDemand())}`;
        }
      }
    }
    const netEl = document.getElementById('net-food');
    if (netEl) {
      const net = Math.round(g.foodNet);
      netEl.textContent = net > 0 ? `+${net}` : (net < 0 ? `${net}` : '');
      netEl.className = net < 0 ? 'neg' : 'pos';
    }
    const hh = Math.floor(g.h);
    this.el.date.textContent = `${G.SEASON_ICONS[g.season]} 第 ${g.year} 年 · ${G.SEASON_NAMES[g.season]} 第 ${(g.day % G.SEASON_DAYS) + 1} 天 · ${G.isRestTime() ? '🌙' : '☀️'} ${String(hh).padStart(2, '0')}:00`;
    const w = G.world;
    const adults = w.citizens.filter(c => c.adult).length;
    const children = w.citizens.length - adults;
    const homeless = w.families.filter(f => f.houseId == null && f.members.length).length;
    this.el.pop.innerHTML = `👥 ${w.citizens.length} <small>(成人${adults}·儿童${children})</small>` +
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
    return `<span class="town-health${h.sick ? ' warn-txt' : ''}" title="全镇平均健康；三类食物搭配有助健康。草药库存 ${Math.floor(h.herbs || 0)}">健康 ${average}/5 · 患病 ${h.sick} · 治疗 ${h.treated}</span>`;
  },

  refreshGuide: function () {
    const el = this.el.guide;
    if (!el || !G.world) return;
    const g = G.game, w = G.world;
    const days = w.citizens.length ? g.res.food / (w.citizens.length * G.LIFE.eatPerDay) : 0;
    const untilWinter = (G.SEASON_DAYS * 3 - g.day % G.YEAR_DAYS + G.YEAR_DAYS) % G.YEAR_DAYS;
    const food = w.buildings.some(b => ['gatherer', 'dock', 'hunting', 'farm', 'orchard', 'pasture'].includes(b.type) && b.state === 'ok');
    const fuel = w.buildings.some(b => b.type === 'woodcutter' && b.state === 'ok');
    const homeless = w.families.filter(f => f.members.length && f.houseId == null).length;
    const heat = this.heatDemand();
    const remainingHeat = heat.winter ? heat.futureWinter : heat.fullWinter;
    const risks = [];
    const harvest = G.harvestFeedback();
    if (g.res.wood < 2) {
      if (harvest.carry.wood) risks.push(`木材库存耗尽：另有 ${harvest.carry.wood} 随身待入库，送达后才能使用。`);
      else if (harvest.trees) risks.push(`木材库存耗尽：${harvest.trees} 棵已标记，查看采运进度；砍倒后仍需送仓。`);
      else risks.push('木材耗尽：向更远可达森林标记砍伐，后续护林补种；避开食物林。');
    }
    if (g.season >= 2 && G.usableHeatingFuel() < remainingHeat) risks.push(G.heatingPolicy().allowCoal?`取暖燃料不足：可用 ${Math.floor(G.usableHeatingFuel())} 柴火当量 / ${heat.winter ? '本冬此后' : '整冬'}约需 ${Math.ceil(remainingHeat)}，伐木屋需原木；住房可设煤补柴。`:`柴火不足：现有 ${Math.floor(g.res.firewood)} / ${heat.winter ? '本冬此后' : '整冬'}约需 ${Math.ceil(remainingHeat)}，伐木屋需原木。`);
    const stage = !food ? '① 先保持续食物：在近仓森林建采集小屋；不要先连盖五屋耗尽木石。'
      : !fuel ? '② 近仓建伐木屋备柴；在食物林外标记砍伐和矿石，保留散工。'
      : homeless ? `③ 入冬前安家：还有 ${homeless} 家无房；逐步补住房和取暖柴。`
      : '④ 补齐肉、蔬菜、主食与衣物，再扩教育、医疗和贸易，为下一代留空房。';
    const foodKinds = (G.FOOD_KEYS || []).filter(type => g.res[type] > 0);
    const variety = G.FOOD_KEYS && foodKinds.length < G.FOOD_KEYS.length ? ` · 食物种类 ${foodKinds.length}/${G.FOOD_KEYS.length}` : '';
    const progress = harvest.total ? `\n采运标记：待领 ${harvest.queued} · 执行 ${harvest.active} · 夜间保留 ${harvest.paused}${harvest.reason ? '；' + harvest.reason : ''}` : '';
    el.textContent = (G.autosaveBlocked ? '⚠ 原自动档已保护：临时局不自动保存，请打开存档管理备份/手动保存。\n' : '') + `粮食约 ${days.toFixed(1)} 天（不计新产出）${variety} · ${G.isWinter() ? '寒冬中' : '距入冬 ' + untilWinter + ' 天'} · ${g.paused ? '已暂停' : '运行中'}\n${stage}${risks.length ? '\n⚠ ' + risks.join(' ') : ''}${progress}`;
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
    if (this.refreshHarvestRangeControls) this.refreshHarvestRangeControls(false);
    if (this.refreshHarvestControls) this.refreshHarvestControls();
    const el = this.el.placement;
    if (!el) return null;
    if (!type) { el.classList.add('hidden'); this._placementKey = null; return null; }
    // Avoid a path search on every animation frame; refresh moving terrain/resources regularly.
    const key = [type, x, y, G.world.seed, G.world.buildings.map(b => b.id).join(','), Math.floor(G.game.h * 2), G.game.day,
      ...G.RES_KEYS.map(k => Math.floor(G.game.res[k]))].join(':');
    if (key !== this._placementKey || this._placementWorld !== G.world) {
      this._placementWorld = G.world;
      this._placementKey = key;
      this._placement = G.placementInfo(type, x, y);
      el.textContent = this._placement.text;
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
    G.sel = null;
    this.el.info.classList.add('hidden');
    this._infoSelection = null; // Reopening mounts new controls; dismissed callbacks stay stale.
  },
  workforceInfoData: function (b) {
    if (!G.workforceSummary) return null;
    const s = G.workforceSummary(b), g = s.global;
    const data = {
      current: s.supported ? `当前占岗 ${s.current} 人 · 其中收尾 ${s.draining} 人` : '本建筑无需安排工人',
      limit: s.supported ? `已应用上限 ${s.limit} 人 · 原最大 ${s.maximum} 人` : '',
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
              if (message) message.textContent = priority?(desired?'已设为优先施工。当前工作段和携货先结清，不会凭空增加工人。':'已恢复普通顺序；不会取消已完成工段或扣取新建材。'):desired ? '工地已暂停。已完成工段和已付建材保留；携货者仍需送仓。' : '工地已恢复，等待建筑工人；不会再次扣除已付建材。';
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
    const w = G.world, trees = G.siteTrees ? G.siteTrees(b).length : 0;
    const upgrade = b.type === 'stonehouse' && b.upgradeFrom === 'house';
    const untouched = !b.constructionStarted && b.progress === 0 && b.workLeft >= b.totalWork;
    return {
      status: (b.sitePriority?'优先施工 · ':'') + (upgrade ? '木屋升级石屋 · ' : '') + (trees ? `清理工地：还需砍 ${trees} 棵树（工人搬运入仓）` : `建造中 ${Math.floor(b.progress * 100)}%`),
      workers: b.workers.map(id => w.cmap[id]).filter(Boolean).map(c => c.name).join('、') || '等待建筑工人',
      refund: upgrade ? `${untouched ? '未开工：取消退还全部' : '已开工：取消退还一半'}石屋已付建材（包含旧屋回收材料）。原木屋已拆除，取消升级不会还原木屋。`
        : untouched ? '未开工：取消退还全部已付建材，保留树木' : '已开工：拆除退还一半已付建材，已砍树不恢复'
    };
  },
  homeInfoData: function (b) {
    if (!['house', 'stonehouse','boarding'].includes(b.type) || b.state !== 'ok') return null;
    const families = G.world.families.filter(f => f.houseId === b.id);
    const residents = families.flatMap(f => f.members.map(id => G.world.cmap[id]).filter(c => c && !c.dead));
    return {
      status: b.type==='boarding'?`入住 ${families.length} / ${G.LIFE.boardingCap} 家`:residents.length ? '有人居住' : '空置',
      residents: residents.length ? `住户：${residents.map(c => `${c.name}(${Math.floor(c.age)}岁)`).join('、')}` : '住户：暂无',
    };
  },
  heatingInfoData:function(b){
    const s=G.homeHeatingSummary(b);if(!s)return null;
    const last=s.last;
    return {summary:s,data:{policy:`全镇策略：${s.allowCoal?'柴火不足时允许煤补足':'仅烧柴火，不动用煤'}；取暖保留煤底线 ${s.coalReserve}`,
      stock:`煤库存 ${s.coalStock.toFixed(2)} · 可用于取暖 ${s.coalAvailable.toFixed(2)} · 当前燃料约 ${s.fuel.toFixed(2)} 柴火当量`,
      home:`本屋${s.occupied?'已入住':'空置不耗燃料'}，冬季每日需要 ${s.perDay.toFixed(2)} 柴火当量。${G.isWinter()&&s.occupied&&s.unheated?'当前未供暖，住户仍会受冻。':''}`,
      receipt:last?`最近结算：第 ${last.day+1} 天，实际烧柴 ${last.wood.toFixed(2)}、煤 ${last.coal.toFixed(2)} / 需求 ${last.need.toFixed(2)} 柴火当量${last.wood+last.coal*s.ratio+1e-8<last.need?'（当时燃料未足）':''}`:'暂无本屋冬季取暖结算记录；旧档不编造用量',
      rule:'全镇先烧柴再用底线以上的煤补缺，1煤=2柴热量为本作适配。底线只约束取暖，钢工具/贸易仍能使用煤。修改仅影响下一次冬季日界扣料，不会立即暖屋；粮柴账本不包含煤耗。'}};
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
  houseUpgradeInfoData: function (b) {
    if (b.type !== 'house' || b.state !== 'ok' || !G.houseUpgradeQuote) return null;
    const quote = G.houseUpgradeQuote(b);
    const materials = values => ['wood', 'stone', 'iron'].map(key => `${G.RES[key].name} ${Number(values && values[key]) || 0}`).join(' · ');
    return { quote, data: {
      cost: `石屋完整建材：${materials(quote.cost)}`,
      salvage: `旧屋回收抵扣：${materials(quote.salvage)}（按原屋实际投入）`,
      due: `现在从库存补付：${materials(quote.due)}`,
      displaced: `开始后搬出：${quote.families} 户 / ${quote.people} 人；施工期间不能住在这里。`,
      housing: `全镇其余空屋 ${quote.freeHomes} 户 · 宿舍空位 ${quote.boardingSlots} 户。仅为全镇统计，未核实对住户是否可达，也不会预留床位。`,
      cold: `${quote.winter ? '⚠ 当前正值寒冬。' : '冬季风险：'}搬出后若无可达住处和柴火，住户可能受冻；即使全镇有空位也不能保证入住。`,
      fuel: `本作取暖：有人入住时，每屋每年约 ${quote.oldFuel} → ${quote.newFuel} 柴火（冬季集中消耗，省一半）。`,
      reason: quote.ok ? '建材和可达建筑工人满足开始条件，实际完工仍需施工。' : `暂不能升级：${quote.reason || '请检查建材和可用建筑工人。'}`,
    } };
  },
  houseUpgradeInfoMarkup: function (facts) {
    if (!facts) return '';
    return `<section class="economy-form house-upgrade-details" data-house-upgrade-panel aria-labelledby="house-upgrade-title">
      <h3 id="house-upgrade-title">木屋升级为石屋</h3>
      ${Object.keys(facts.data).map(key => `<p class="row" data-house-upgrade="${key}">${this.escHtml(facts.data[key])}</p>`).join('')}
      <p class="house-upgrade-warning">确认开始后立即拆除原木屋，住户搬出，原屋永久消失。取消升级工地也不会还原木屋。</p>
      <button type="button" id="house-upgrade-start" aria-expanded="false">查看升级确认</button>
      <div class="house-upgrade-confirm hidden" data-house-upgrade-confirm>
        <p>已了解上方最新建材、搬迁和受冻风险？确认后立即补付建材并拆除木屋，原址改建石屋。</p>
        <div class="economy-actions"><button type="button" id="house-upgrade-confirm" class="danger">确认拆木屋并升级</button><button type="button" id="house-upgrade-cancel">取消，保留木屋</button></div>
      </div>
      <p class="economy-message" data-house-upgrade-message role="status" aria-live="polite"></p>
    </section>`;
  },
  houseUpgradeControlValid: function (b, context, node, allowModal) {
    const { world, game, el, panel } = context;
    return G.world === world && G.game === game && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel && G.sel.kind === 'b' && G.sel.id === b.id && world.bmap[b.id] === b && b.type === 'house' && b.state === 'ok' &&
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
  cemeteryInfoData: function(b) {
    const s=G.cemeterySummary(b);if(!s)return null;
    return {status:s.status,capacity:`墓位：${s.used} / ${s.capacity} · 空余 ${s.free}`,expiry:s.nextDays===null?'暂无墓位占用':`最早约 ${s.nextDays} 天后释放墓位`,
      records:s.graves.length?s.graves.map(r=>`${r.name}（余 ${r.daysLeft} 天）`).join('、'):'墓位空置，建成不会追溯减免此前的哀伤',
      removal:s.canRemove?'空墓园可正常拆除，退还一半已付建材':'仍有未到期墓位，禁止拆除；不能拆建刷新容量'};
  },
  cemeteryInfoMarkup: function(data) {
    return `<section class="cemetery-info">${Object.keys(data).filter(k=>k!=='status').map(k=>`<div class="row desc" data-cemetery="${k}">${this.escHtml(data[k])}</div>`).join('')}</section>`;
  },
  refreshCemeteryInfo: function(b) {
    const data=this.cemeteryInfoData(b);if(!data||!this.el.info.querySelector)return;
    for(const k of Object.keys(data)){const node=this.el.info.querySelector(`[data-cemetery="${k}"]`);if(node&&node.textContent!==data[k])node.textContent=data[k];}
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
    for (const resource of ['food', 'firewood', 'meat', 'vegetables', 'grain']) {
      for (const metric of ['produced', 'received', 'used', 'withdrawn', 'discarded', 'delta', 'opening', 'closing']) {
        for (const period of ['recent', 'previous', 'current']) {
          const p = s && s[period], known = p && (period === 'current' || p.days > 0);
          data[`flow-${resource}-${period}-${metric}`] = number(known && p.totals[resource] ? p.totals[resource][metric] : NaN, metric === 'delta');
        }
        data[`flow-${resource}-difference-${metric}`] = number(comparable ? s.recent.totals[resource][metric] - s.previous.totals[resource][metric] : NaN, true);
      }
    }
    return data;
  },
  townLedgerInfoMarkup: function (data) {
    const text = key => `<span data-townhall="${key}">${this.escHtml(data[key])}</span>`;
    const metrics = resource => [['produced', '真实产出'], ['received', '实际入库'], ['used', resource === 'firewood' ? '住宅燃烧' : '居民食用'], ['withdrawn', '出库转运'], ['discarded', '仓满弃货'], ['delta', '库存净变']];
    const history = resource => `<div class="townledger-table-wrap" tabindex="0" role="region" aria-label="${G.RES[resource].name}历史流水表，可横向滚动"><table class="townledger-table">
      <caption>${G.RES[resource].name}${resource === 'food' ? '合计（三类相加）' : ''}</caption>
      <thead><tr><th scope="col">项目</th><th scope="col">近期</th><th scope="col">前期</th><th scope="col">差额</th></tr></thead>
      <tbody>${metrics(resource).map(([metric, label]) => `<tr><th scope="row">${label}</th>${['recent', 'previous', 'difference'].map(period => `<td>${text(`flow-${resource}-${period}-${metric}`)}</td>`).join('')}</tr>`).join('')}
        <tr class="townledger-stock"><th scope="row">期初库存</th><td>${text(`flow-${resource}-recent-opening`)}</td><td>${text(`flow-${resource}-previous-opening`)}</td><td>—</td></tr>
        <tr class="townledger-stock"><th scope="row">期末库存</th><td>${text(`flow-${resource}-recent-closing`)}</td><td>${text(`flow-${resource}-previous-closing`)}</td><td>—</td></tr>
      </tbody></table></div>`;
    const today = resources => `<div class="townledger-table-wrap" tabindex="0" role="region" aria-label="今日已记录流水表，可横向滚动"><table class="townledger-table">
      <thead><tr><th scope="col">今日已记录</th>${resources.map(resource => `<th scope="col">${G.RES[resource].name}</th>`).join('')}</tr></thead>
      <tbody>${[['produced', '真实产出'], ['received', '实际入库'], ['used', resources.includes('firewood') ? '居民食用 / 住宅燃烧' : '居民食用'], ['withdrawn', '出库转运'], ['discarded', '仓满弃货'], ['delta', '库存净变'], ['opening', '起点库存'], ['closing', '当前库存']].map(([metric, label]) => `<tr><th scope="row">${label}</th>${resources.map(resource => `<td>${text(`flow-${resource}-current-${metric}`)}</td>`).join('')}</tr>`).join('')}</tbody>
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
      <details data-townledger-food><summary>展开三类食物明细</summary>
        <p class="townledger-note">近期、前期和差额使用上方相同日期；食物合计仅为肉类、蔬菜、主食之和。</p>
        ${['meat', 'vegetables', 'grain'].map(history).join('')}${today(['meat', 'vegetables', 'grain'])}
      </details>
      <details data-townledger-help><summary>这些数字怎样记账？</summary>
        <p>真实产出只计实际制成或收获；实际入库只计仓库接收，包含贸易运回与酿酒退料，并非全是本地生产。</p>
        <p>居民食用、住宅燃烧只计实际吃掉或烧掉，未满足的需求不计入；缺粮缺柴仍须结合上方库存和需求判断。</p>
        <p>出库转运指贸易或酿酒取料，不等于已卖出或永久消耗。仓满弃货只计因仓满未保留的弃货，等待空位的保留货物不算损失。</p>
        <p>库存净变 = 实际入库 − 居民食用（或住宅燃烧）− 出库转运 = 期末库存 − 期初库存。真实产出与仓满弃货不加入这个库存等式。</p>
        <p>产出减入库不等于携带中的货物。数值为游戏物资单位，最多显示两位小数，非零微量显示 &lt;0.01；差额先按原始数值相减再显示。窗口为本作的 12 天，留存为 48 天。</p>
      </details>
    </details>`;
  },
  townChallengeInfoData:function(){
    const f=G.townChallengeFacts(),done=G.game.challenges?.completed||{};
    const status=key=>done[key]!==undefined?`已确认：第 ${done[key]} 天`:(f[key].ready?'当前已满足，待下次日界确认':'进行中');
    return {challengeSettlement:`安居村庄 · ${status('settlement')}：已入村 ${f.settlement.population}/30 人；有完工住房 ${f.settlement.homed}/${f.settlement.population} 人，还缺 ${f.settlement.population-f.settlement.homed} 人住处。`,
      challengeFood:!f.food.available?'一季多元生产：缺少流水统计，暂不能确认；不把未知产出当作零。':`一季多元生产 · ${status('food')}：最近完整记录 ${f.food.days}/12 日${f.food.days?`（第 ${f.food.fromDay}–${f.food.toDay} 天）`:''}；实际产出食物 ${f.food.produced.toFixed(1)} / 居民食用 ${f.food.used.toFixed(1)}；有实际产出的类别 ${f.food.groups}/3。${!f.food.contiguous?'需紧接今天的连续12个完整日。':''}`,
      challengeEducation:`教育传承 · ${status('education')}：受教育成人 ${f.education.educated}/3 人；已有课时且所属学堂完工的学生 ${f.education.students}/1 人。`};
  },
  townHallInfoData: function (b) {
    if (b.type !== 'townhall' || b.state !== 'ok' || !G.townHallSummary) return null;
    const s = G.townHallSummary(b), g = G.game, heat = this.heatDemand();
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
      food: `食物 ${Math.floor(g.res.food)} · 现有人口约够 ${days(s.foodDays)}（不计新产出）`,
      fuel: `柴火 ${Math.floor(g.res.firewood)} · ${this.heatDemandText(heat)}`,
      tools: `工具 ${Math.floor(G.toolStock())} 件 · 当前成人约可用 ${days(G.toolDaysLeft(s.adults))}（不计新产出）`,
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
      data.offerFood = `食物：新增约 ${Number(s.addedFoodPerDay).toFixed(1)} / 天；库存覆盖由 ${days(s.foodDays)} → ${days(s.foodDaysAfter)}，未计新增生产。`;
      data.offerFuel = `取暖：若每户新家庭住木屋，整冬估计新增 ${Math.ceil(s.addedFuelPerWinter)} 柴火；现有柴火 ${Math.floor(g.res.firewood)}。石屋、宿舍与实际入住情况会改变需求。`;
      data.offerMedical = `医疗：已任职健康医师 ${s.doctors} 人 · 草药 ${Math.floor(s.herbs || 0)}。${s.doctors ? '治疗仍需医师到岗、可达诊所及接诊名额。' : '目前没有医师，可自然康复，也可另配医师治疗。'}${offer.sickCount ? ` 本批有 ${offer.sickCount} 人患季节热病：会拖慢劳动，有近距传播风险，本批疾病不会直接致死。` : ' 本批未发现热病。'}`;
    }
    return { summary: s, data };
  },
  townHallInfoMarkup: function (b, facts) {
    const data = facts.data;
    return `<section class="townhall-details" data-townhall-panel>
      ${['population', 'housing', 'education', 'health', 'medical', 'food', 'fuel', 'tools', 'arriving', 'schedule', 'decisions'].map(key => `<p class="row" data-townhall="${key}">${this.escHtml(data[key])}</p>`).join('')}
      <div data-townhall-offer></div>
      <p class="economy-message" data-townhall-message role="status" aria-live="polite"></p>
      <details class="townhall-ledger" data-town-challenges><summary>发展挑战（本作适配）</summary>
        ${['challengeSettlement','challengeFood','challengeEducation'].map(key=>`<p class="row" data-townhall="${key}">${this.escHtml(data[key])}</p>`).join('')}
        <p class="desc">30名已入村居民都有完工住房；或连续12完整日肉/蔬菜/主食各有实际产出、合计不少于实际食用且有人食用；或3名受教成人与1名已有课时学生。三项独立，无资源奖励或效率加成，不是原版成就的精确条件。</p>
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
  tavernInfoData: function (b) {
    if (b.type !== 'tavern' || b.state !== 'ok' || !G.tavernSummary) return null;
    const s = G.tavernSummary(b), g = G.game;
    const names = b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、');
    const service = !s.onDuty ? '服务暂停：需健康酿酒工实际到岗' : s.ale < 1 ? '服务等待：需麦酒入库'
      : s.visitors >= s.capacity ? '休闲名额已满（含在途预约）' : '可接待：居民仍需步行到馆';
    const data = {
      status: `酿造：${s.canBrew ? '可接新批次' : s.reason || '暂不能接新批次'}`,
      workers: names || '无',
      service,
      visitors: `休闲名额：${s.visitors} / ${s.capacity}（含在途预约） · 全镇 18 岁以上 ${s.eligibleAdults} 人`,
      recipe: `每批：${s.batchGrain} 主食 → ${s.batchAle} 麦酒（受教育 4）；基础劳动 ${s.workHours} 小时`,
      stock: `全镇库存：主食 ${Math.floor(g.res.grain || 0)} · 总食物 ${Math.floor(g.res.food || 0)} · 麦酒 ${Math.floor(s.ale || 0)}`,
      reserve: `储粮保护：全村 ${s.reserveDays} 天食物（至少 ${Math.ceil(s.reserveFood)}）`,
      afterBatch: `取出本批 ${s.batchGrain} 主食后，总食物约 ${Math.floor(s.foodAfterBatch)}；仍须达到储粮保护线。`,
      goals: G.buildingGoalStatus(b) || '全镇麦酒目标：未设置，默认备30；可在资源目标面板调整',
    };
    return { summary: s, data };
  },
  tavernInfoMarkup: function (facts) {
    const data = facts.data;
    return `<section class="tavern-details" data-tavern-panel>
      ${['service', 'visitors', 'recipe', 'stock'].map(key => `<p class="row" data-tavern="${key}">${this.escHtml(data[key])}</p>`).join('')}
      <div class="tavern-reserve" role="group" aria-labelledby="tavern-reserve-label">
        <p id="tavern-reserve-label" data-tavern="reserve">${this.escHtml(data.reserve)}</p>
        <div class="tavern-actions"><button type="button" id="tavern-reserve-less" data-tavern-step="-4" aria-label="降低储粮保护 4 天" aria-describedby="tavern-reserve-note">−4 天</button>
          <button type="button" id="tavern-reserve-more" data-tavern-step="4" aria-label="提高储粮保护 4 天" aria-describedby="tavern-reserve-note">＋4 天</button></div>
        <p class="desc" id="tavern-reserve-note">可设 8–48 天，默认 12 天。按全村人数与每日食物消耗估算；人口和库存变化会改变可酿条件。</p>
      </div>
      <p class="row" data-tavern="afterBatch">${this.escHtml(data.afterBatch)}</p>
      <p class="row" data-tavern="goals">${this.escHtml(data.goals)}</p>
      <p class="economy-message" data-tavern-message role="status" aria-live="polite"></p>
      <p class="desc">工人从仓库取主食，送到酒馆加工，再把麦酒送仓。取粮、开酿与完成前均检查储粮；不足时优先退回未酿原粮，中断和存档不会吞掉原粮。</p>
      <p class="desc">仅酿主食麦酒；蔬菜不作果酒。麦酒不计入肉类、蔬菜、主食三类食物，也不能充饥。</p>
      <p class="desc">仅接待 18 岁以上居民，最多 4 人（含在途预约）。到馆累计服务 2 小时后，每人消耗 1 麦酒，留下 6 天休闲记忆。需健康酿酒工实际在岗；失去服务会等待或取消，夜间照常回家。</p>
      <p class="desc">三类饮食是幸福基础；休闲可把幸福补到 5。完成休闲即时 +0.4 幸福（上限 5），日终再向目标平滑变化。劳动效率仅获 0～+5% 正向加成，不因低幸福受到负惩罚。</p>
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
    const crop = crops[s.crop], choice = crops[s.choice];
    const workerNames = b.workers.map(id => G.world.cmap[id]).filter(c => c && !c.dead && c.job === b.id).map(c => c.name);
    const target = type => {
      const value = G.productionGoalOf(type);
      return `${G.RES[type].name} ${value === null ? '未设置' : value === 0 ? '0（关闭新一季）' : value + (G.goalPaused(type) ? '（达标暂停新一季）' : '（可开始新一季）')}`;
    };
    return { summary: s, pests, data: {
      status: s.status,
      workers: `${s.workers} 人${workerNames.length ? ' · ' + workerNames.join('、') : '（等待可用农夫）'}`,
      plot: `地块 ${b.w}×${b.h} · ${s.total}格 · 成熟满收理论 ${s.total*G.PROD.farm.perTile} 食物；实际受种收工时、工具、冬损和仓容影响`,
      current: `本季作物：${crop.name} → ${G.RES[s.output].name}`,
      choice: `下季 / 空田选择：${choice.name} → ${G.RES[s.choiceOutput].name}${s.pending ? '（下一春生效）' : '（与本季一致）'}`,
      reason: s.reason,
      seeds: `种子：小麦已解锁 · 卷心菜${s.unlocked.cabbage ? '已永久解锁' : '未解锁，需贸易购买卷心菜种子'}（永久解锁，不是库存物品，不占仓位）`,
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
        <p class="desc" id="farm-crop-note">春、夏尚未开始播种的空田立即应用；已接第一播种任务、已播种、生长或已收获的本季作物锁定，改选留到下一春。已背起的粮食不变。新局与旧农田默认小麦。</p>
      </div>
      ${Object.keys(facts.data).filter(key => !['status', 'workers'].includes(key)).map(key => `<p class="row" data-farm="${key}">${this.escHtml(facts.data[key])}</p>`).join('')}
      <div class="farm-pests-setting" data-farm-pests-setting>
        <p class="row" data-farm-pests-status>${this.escHtml(this.farmPestSettingText(facts.pests))}</p>
        <div class="economy-actions"><button type="button" id="farm-pests-toggle" aria-describedby="farm-pests-note" aria-expanded="false">${facts.pests.enabled ? '关闭全镇农田虫害' : '开启全镇农田虫害…'}</button></div>
        <p class="desc" id="farm-pests-note">可选全镇规则，新局和旧档默认关闭。仅影响农田未收作物，邻近同种作物田可互相传播；仓内库存和已背起的粮食不受影响；果园、牧场不受影响。关闭即停止新感染与后续损失、清除活动虫害，已损失作物不返还。</p>
        <div class="hidden" data-farm-pests-confirm role="group" aria-label="确认开启全镇农田虫害">
          <p class="desc">开启会影响全镇所有农田。本作适配：先有12天宽限；之后新感染先预警2天，再逐日损失未收作物。损失不会自动返还，仍可在此关闭。</p>
          <div class="economy-actions"><button type="button" id="farm-pests-confirm">确认全镇开启</button><button type="button" id="farm-pests-cancel">保持关闭</button></div>
        </div>
      </div>
      <div class="economy-actions"><button type="button" id="early-harvest-start">提前抢收</button></div>
      <p class="desc" data-early-harvest-status></p>
      <div class="hidden" data-early-harvest-confirm role="group" aria-label="确认提前抢收">
        <p class="desc" data-early-harvest-quote></p>
        <div class="economy-actions"><button type="button" id="early-harvest-confirm">确认本季抢收</button><button type="button" id="early-harvest-cancel">继续等待</button></div>
      </div>
      <p class="economy-message" data-farm-message role="status" aria-live="polite"></p>
      <p class="desc">全田播完才开始成长；默认秋季成熟后收获，也可确认提前抢收，按当时成熟度锁定较低产量并停止继续成长，本季不能复种。等待能提高成熟产量；若开启虫害，等候和收割期间仍可能损失未收格。冬季未收作物损失；农夫仍须收割并实际搬运入仓。</p>
      <p class="desc">食物仍分肉类、蔬菜、主食三类。小麦产主食，卷心菜产蔬菜；多种作物不额外增加饮食类别，也不产肉。</p>
    </section>`;
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
    const action = !p.rotationAvailable ? '卷心菜未解锁，须在贸易站购买种子后才能选择不同作物' :
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
    const reset=()=>{panel._harvestQuote=null;box.classList.add('hidden');};
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
      stock: `可用成衣：普通衣物 ${Math.floor(s.clothes || 0)} · 暖衣 ${Math.floor(s.warmCoats || 0)}（在途未入库不计）`,
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
  resourceChainInfoData: function (b) {
    if (b.state !== 'ok' || !['mine', 'stonequarry', 'blacksmith'].includes(b.type)) return null;
    const smith = b.type === 'blacksmith', outputs = G.productionOutputsOf(b);
    const output = smith ? G.blacksmithOutput(b) : null;
    const mode = b.type === 'mine' ? G.mineModeOf(b) : null;
    const names = outputs.map(type => G.RES[type].name).join(' · ');
    const workers = b.workers.map(id => G.world.cmap[id]).filter(Boolean);
    const goal = G.buildingGoalStatus(b);
    let status;
    if(smith&&workers.some(c=>[c.task,c.pausedTask].some(t=>t?.kind==='smith'&&t.phase==='process')))status='原料已整批出库，继续返屋或加工；公共原料库存只决定后续新批次';
    else if(smith&&workers.some(c=>c.carry?.smithInput))status='未消耗原料正在退仓；仓满或无通路时随身保留';
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
      data.lifetime = `寿命：铁工具 ${G.LIFE.toolLifeDays} / 钢工具 ${G.LIFE.steelToolLifeDays} 成人天；生产效率相同，优先磨损钢工具。工具不限仓储。`;
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
      ${['production', 'recipe', 'inputs', 'stock', 'logistics'].filter(key => data[key]).map(key => `<div class="row" data-resource-chain-live="${key}">${this.escHtml(data[key])}</div>`).join('')}
      ${smith ? `<div class="row tog-row resource-chain-target"><span data-resource-chain-live="target">${this.escHtml(data.target)}</span>
        <button type="button" class="mini-tog" data-tl="-10" title="降低当前产物的本屋目标 10" aria-label="降低本屋工具目标 10">−</button>
        <button type="button" class="mini-tog" data-tl="10" title="提高当前产物的本屋目标 10" aria-label="提高本屋工具目标 10">＋</button></div>` : ''}
      <div class="row" data-resource-chain-live="goals">${this.escHtml(data.goals)}</div>
      <div class="row" data-resource-chain-live="batches">${this.escHtml(data.batches)}</div>
      ${smith ? `<div class="row desc" data-resource-chain-live="lifetime">${this.escHtml(data.lifetime)}</div><div class="row desc">铁工具、钢工具各有独立的全镇目标。本屋目标随当前配方生效；已接批次仍可能完成并超过目标。</div>`
        : '<div class="row desc">无限矿源（当前原型）：不设矿量耗尽。开采后须搬运入仓才可使用；满仓余矿保留随身，腾出空间后继续送仓。</div>'}
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
    return true;
  },
  initResourceChainInfo: function (b) {
    const el = this.el.info, w = G.world;
    if (!el.querySelector || !el.querySelector('[data-resource-chain]')) return;
    const id = b.type === 'mine' ? 'mine-mode' : b.type === 'blacksmith' ? 'tool-recipe' : null;
    const select = id && el.querySelector('#' + id);
    if (!select) return;
    select.addEventListener('change', () => {
      if (G.world !== w || !G.sel || G.sel.kind !== 'b' || G.sel.id !== b.id || w.bmap[b.id] !== b || b.state !== 'ok' ||
          el.querySelector('#' + id) !== select || (G.hasOpenModal && G.hasOpenModal())) return;
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
  citizenHealthMarkup: function (c) {
    if (!G.healthOf || !G.medicalStatus) return '';
    const health = G.healthOf(c), sick = G.isSick(c), work = G.healthWorkMul(c);
    return `<div class="row${health < 3 ? ' warn-txt' : ''}">健康：${health.toFixed(1)} / 5${work > 1 ? ` · 劳作工时 ×${work.toFixed(2)}` : ''}</div>
      <div class="row${sick ? ' warn-txt' : ''}">疾病：${sick ? `患病第 ${Math.ceil(c.sickDays)} 天` : '无'}${!sick && c.immunityDays > 0 ? ` · 免疫约余 ${Math.ceil(c.immunityDays)} 天` : ''}</div>
      <div class="row">医疗：${this.escHtml(G.medicalStatus(c))}${c.herbCooldown > 0 ? ` · 草药调养间隔约余 ${Math.ceil(c.herbCooldown)} 天` : ''}</div>`;
  },
  citizenClothingData: function (c) {
    const type = G.clothingTypeOf ? G.clothingTypeOf(c) : c.clothingLeft > 0 ? 'basic' : 'none';
    const mul = G.clothingColdMul ? G.clothingColdMul(c) : type === 'none' ? 1 : .6;
    const left = Math.max(0, Number(c.clothingLeft) || 0);
    return {
      worn: `衣物：${type === 'warm' ? '暖衣' : type === 'basic' ? '普通衣物' : '已耗尽，等待成衣'}${type === 'none' ? '' : ' · 约剩 ' + Math.ceil(left) + ' 天'}`,
      cold: `户外受冻 ×${mul.toFixed(1)}${type === 'warm' ? '（降低 70%，比普通衣物再减半）' : type === 'basic' ? '（降低 40%）' : '（无衣物防寒）'}`,
      renewal: `日终磨损 1 天，穿坏才优先领暖衣，无则普通；每件 ${G.YEAR_DAYS} 天，不提前替换旧衣。`,
      shelter: '衣物不改变无柴冷屋受冻或烧柴暖屋恢复，仍需住房与柴火。',
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
    return {
      happiness: `幸福：${happiness.toFixed(1)} / 5${s ? ` · 当前目标 ${s.target.toFixed(1)} / 5` : ''}`,
      grief: G.griefLoss(c)>0?`亲属哀伤：${c.grief.name} · ${c.grief.buried?'已安葬，损失减轻':'当时没有可达空墓位'} · 当前幸福目标 −${c.grief.loss.toFixed(2)}，约 ${c.grief.days} 天恢复`:'亲属哀伤：无',
      memory: days > 0 ? `休闲记忆：约余 ${days.toFixed(1)} 天${s ? ` · 幸福目标 +${s.leisureBonus}` : ''}` : '休闲记忆：暂无（酒馆仅接待 18 岁以上居民）',
      work: `幸福带来的劳动效率：+${(bonus * 100).toFixed(1)}%（仅 0～+5%，无负惩罚）`,
      basis: `三类饮食（肉类、蔬菜、主食）是幸福基础${s ? `，当前饮食基础 ${s.dietBase.toFixed(1)} / 5` : ''}；休闲可补到 5，饥饿和亲属哀伤会降低幸福目标。完成休闲即时 +0.4（上限 5）；日终向目标最多变化 0.1。`,
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
  renderInfo: function (force) {
    if (!G.sel) return;
    const w = G.world, el = this.el.info;
    // Keep a keyboard user's active control stable across timed refreshes.
    const active = document.activeElement;
    const hadFocus = active && el.contains && el.contains(active);
    const selected = G.sel.kind === 'b' ? w.bmap[G.sel.id] : w.cmap[G.sel.id];
    if (!selected) { this.hideInfo(); return; }
    const sameSelection = this._infoWorld === w && this._infoGame === G.game && this._infoElement === el && this._infoSelection === selected;
    const tradePanel = sameSelection && selected.type === 'tradingpost' && el.querySelector && el.querySelector('[data-economy="tradingpost"]');
    const merchantChanged = tradePanel && tradePanel._merchant !== selected.merchant;
    // A new boat gets new callbacks. Keep drafts, but never reuse a previous
    // merchant's pay/order button or carry its keyboard focus onto a new deal.
    const tradeDraft = merchantChanged ? Object.fromEntries(['trade-target-resource', 'trade-target-quantity', 'trade-good', 'trade-buy-quantity', 'trade-payment', 'trade-order-good', 'trade-order-quantity'].map(id => [id, el.querySelector('#' + id)?.value])) : null;
    if (merchantChanged) force = true;
    // Workforce facts must update before every specialized panel's early return.
    if (sameSelection && G.sel.kind === 'b' && this._infoBuildState === selected.state) this.refreshWorkforceInfo(selected);
    if (!force && sameSelection && G.sel.kind === 'b' && this._infoBuildState === selected.state && this._infoBuildType === selected.type && this.refreshHomeInfo(selected)) return;
    // Update only fuel text, never replace this panel's focused buttons. A new
    // selection or a site finishing construction still gets its own full panel.
    if (sameSelection && selected.state === 'ok' && this._townHallInfoState === selected.state && this.refreshTownHallInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._tavernInfoState === selected.state && this.refreshTavernInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._tailorInfoState === selected.state && this.refreshTailorInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._farmInfoState === selected.state && this.refreshFarmInfo(selected)) return;
    if(sameSelection&&selected.state==='ok'&&this._schoolInfoState===selected.state&&this.refreshSchoolInfo(selected))return;
    if (!merchantChanged && sameSelection && selected.state === 'ok' && this._economyInfoState === selected.state && this.refreshEconomyInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._medicalInfoState === selected.state && this.refreshMedicalInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._resourceChainInfoState === selected.state && this.refreshResourceChainInfo(selected)) return;
    if(sameSelection&&G.sel.kind==='b'&&selected.type==='stockpile'&&selected.state==='ok'&&this._infoBuildState==='ok'){this.refreshStockpileInfo(selected);return;}
    if(sameSelection&&G.sel.kind==='b'&&selected.type==='cemetery'&&selected.state==='ok'&&this._infoBuildState==='ok'){this.refreshCemeteryInfo(selected);return;}
    if (sameSelection && selected.type === 'woodcutter' && this._fuelInfoState === selected.state && this.refreshFuelInfo(selected)) return;
    if (hadFocus && !force && sameSelection && selected.type !== 'woodcutter' &&
        !(selected.type === 'farm' && selected.state === 'ok' && G.farmSummary) && (G.sel.kind === 'c' || (this._infoBuildState === selected.state && this._infoBuildType === selected.type))) {
      if (G.sel.kind === 'c') { this.refreshCitizenLeisure(selected); this.refreshCitizenClothing(selected); this.refreshStudentInfo(selected); }
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
    const destructiveActionChanged = sameSelection && this._infoBuildState === 'site' && selected.state !== 'site' && active && ['info-demolish', 'construction-pause', 'construction-resume','construction-priority','construction-normal'].includes(active.id);
    const workforceInput = sameSelection && this._infoBuildState === selected.state && el.querySelector && el.querySelector('#worker-limit-input');
    const workforceDraft = workforceInput ? workforceInput.value : null;
    const merchantActionChanged = merchantChanged && active && ['trade-execute', 'trade-order-confirm', 'trade-order-cancel'].includes(active.id);
    const focusSelector = destructiveActionChanged ? '#info-close' : merchantActionChanged ? '#trade-good' : hadFocus ? (active.id ? '#' + active.id : active.dataset.tl ? '[data-tl="' + active.dataset.tl + '"]' : active.dataset.fl ? '[data-fl="' + active.dataset.fl + '"]' : active.dataset.k ? '[data-k="' + active.dataset.k + '"]' : null) : null;
    this._infoWorld = w;
    this._infoGame = G.game;
    this._infoElement = el;
    this._infoSelection = selected;
    this._infoBuildState = selected.state;
    this._infoBuildType = selected.type;
    if (G.sel.kind === 'b') {
      const b = w.bmap[G.sel.id];
      if (!b) { this.hideInfo(); return; }
      const def = G.BDEF[b.type];
      const fuelData = b.type === 'woodcutter' ? this.fuelInfoData(b) : null;
      const siteData = b.state === 'site' ? this.siteInfoData(b) : null;
      const medicalData = this.medicalInfoData(b);
      const chainData = this.resourceChainInfoData(b);
      const hallData = this.townHallInfoData(b);
      const tavernData = this.tavernInfoData(b);
      const tailorData = this.tailorInfoData(b);
      const farmData = this.farmInfoData(b);
      const schoolData=this.schoolInfoData(b);
      const cemeteryData=b.type==='cemetery'&&b.state==='ok'?this.cemeteryInfoData(b):null;
      const workforceData = this.workforceInfoData(b);
      const homeData = this.homeInfoData(b), upgradeData = this.houseUpgradeInfoData(b);
      let status;
      if (fuelData) status = fuelData.status;
      else if (siteData) status = siteData.status;
      else if(cemeteryData)status=cemeteryData.status;
      else if(schoolData)status=schoolData.status;
      else if (medicalData) status = medicalData.status;
      else if (chainData) status = chainData.status;
      else if (hallData) status = hallData.data.status;
      else if (tavernData) status = tavernData.data.status;
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
      if ((def.jobs > 0 || b.state === 'site') && !schoolData) {
        const names = b.workers.map(id => w.cmap[id]).filter(Boolean).map(c => this.escHtml(c.name)).join('、');
        workers = `<div class="row">${medicalData ? b.type === 'hospital' ? '医师' : '采药员' : tavernData ? '酿酒工（需 18 岁以上且健康）' : '工人'}：<span${siteData ? ' data-site-workers' : ''}${fuelData ? ' data-fuel="workers"' : ''}${medicalData ? ' data-medical="workers"' : ''}${chainData ? ' data-resource-chain-live="workers"' : ''}${tavernData ? ' data-tavern="workers"' : ''}${tailorData ? ' data-tailor="workers"' : ''}${farmData ? ' data-farm="workers"' : ''}${b.state === 'ok' && ['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-workers' : ''}>${names || (b.state === 'site' ? '等待建筑工人' : '无')}</span></div>`;
      }
      let extra = '';
      if (homeData) extra = `<div class="row" data-home-residents>${this.escHtml(homeData.residents)}</div>`;
      if(homeData)extra+=this.heatingInfoMarkup(b);
      if (upgradeData) extra += this.houseUpgradeInfoMarkup(upgradeData);
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
      if (chainData) extra += this.resourceChainInfoMarkup(b, chainData);
      if (hallData) extra += this.townHallInfoMarkup(b, hallData);
      if (tavernData) extra += this.tavernInfoMarkup(tavernData);
      if (tailorData) extra += this.tailorInfoMarkup(tailorData);
      if (farmData) extra += this.farmInfoMarkup(farmData);
      if(schoolData)extra+=this.schoolInfoMarkup(b);
      if(cemeteryData)extra+=this.cemeteryInfoMarkup(cemeteryData);
      if(b.type==='stockpile'&&b.state==='ok')extra+=this.stockpileInfoMarkup(b);
      if (b.state === 'ok') extra += this.economyInfoMarkup(b);
      if (medicalData) extra += this.medicalInfoMarkup(b, medicalData);
      const outputs = { gatherer: ['vegetables'], hunting: ['meat', 'leather'], dock: ['meat'], farm: ['grain'], orchard: ['vegetables'], pasture: ['meat', 'wool'], tailor: ['clothes'], herbalist: ['herbs'] };
      if(b.type==='pasture')outputs.pasture=G.productionOutputsOf(b).filter(k=>k!=='food');
      const produced = (chainData || tailorData || farmData ? [] : outputs[b.type] || []).filter(type => G.RES[type]);
      if (produced.length) extra += `<div class="row resource-output"${b.type==='pasture'?' data-pasture-output':''}>产出：${produced.map(type => `${this.resourceIcon(type)}${G.RES[type].name}`).join(' · ')}</div>`;
      if (b.type === 'tailor' && !tailorData) extra += `<div class="row">原料库存：皮革 ${Math.floor(G.game.res.leather || 0)} · 羊毛 ${Math.floor(G.game.res.wool || 0)}</div><div class="row">成衣库存：${Math.floor(G.game.res.clothes || 0)}</div>`;
      if (b.type !== 'woodcutter' && !medicalData && !chainData && !tavernData && !tailorData && !farmData && G.buildingGoalStatus(b)) extra += `<div class="row desc"${['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-goals' : ''}>${this.escHtml(G.buildingGoalStatus(b))}</div>`;
      if (['gatherer', 'hunting', 'forester'].includes(b.type)) {
        const trees = G.treesInRadius(w, b.x, b.y, G.PROD[b.type].radius, false);
        const mature = trees.filter(t => G.treeStage(t) >= 2).length;
        extra += `<div class="row">工作圈：${trees.length} 棵树 · 成熟 ${mature}（砍伐、建造清林会影响产出）</div>`;
      }
      if (b.type === 'farm' && b.farm && !farmData) {
        extra += `<div class="row">播种 ${b.farm.filter(f => f.sown).length}/${b.farm.length} · 收获 ${b.farm.filter(f => f.harvested).length}/${b.farm.length}</div>`;
      }
      el.innerHTML = `
        <div class="info-head"><span>${def.icon} ${def.name}</span><button id="info-close">✕</button></div>
        <div class="row"${siteData ? ' data-site-status' : ''}${homeData ? ' data-home-status' : ''}${fuelData ? ' data-fuel="status"' : ''}${medicalData ? ' data-medical="status"' : ''}${chainData ? ' data-resource-chain-live="status"' : ''}${hallData ? ' data-townhall="status"' : ''}${tavernData ? ' data-tavern="status"' : ''}${tailorData ? ' data-tailor="status"' : ''}${farmData ? ' data-farm="status"' : ''}${cemeteryData?' data-cemetery="status"':''}${schoolData?' data-school="status"':''}${b.state === 'ok' && ['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-status' : ''}>${this.escHtml(status)}</div>
        ${workers}${this.workforceInfoMarkup(b, workforceData)}${extra}
        <div class="row desc">${def.desc}</div>
        <div class="row desc" data-info-refund${fuelData ? ' data-fuel="refund"' : ''}>${fuelData ? fuelData.refund : siteData ? siteData.refund : '已开工：拆除退还一半已付建材，已砍树不恢复'}</div>
        <button id="info-demolish" class="danger">${b.state === 'site' ? '取消工地' : '拆除'}</button>`;
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
      if (hallData) this.refreshTownHallInfo(b);
      if (tavernData) this.initTavernInfo(b);
      if (tailorData) this.initTailorInfo(b);
      if (farmData) this.initFarmInfo(b);
      if(schoolData)this.refreshSchoolStudents(b);
      if (medicalData) this.refreshMedicalPatients(b);
      if (chainData) this.initResourceChainInfo(b);
      if (b.state === 'ok') this.initEconomyInfo(b);
      if (tradeDraft) {
        for (const [id, value] of Object.entries(tradeDraft)) {
          const node = el.querySelector('#' + id);
          if (node && value !== undefined && (id !== 'trade-order-good' || G.merchantProfile(b)?.goods.includes(value))) node.value = value;
        }
        this.refreshEconomyInfo(b);
      }
    } else {
      const c = w.cmap[G.sel.id];
      if (!c) { this.hideInfo(); return; }
      const status = this.citizenStatus(c);
      const jobB = c.job != null ? w.bmap[c.job] : null;
      const jobName = jobB ? G.BDEF[jobB.type].name : (c.student ? '学堂学生' : (c.adult ? '无业' : '儿童'));
      const fam = G.familyOf(c);
      el.innerHTML = `
        <div class="info-head"><span>🧑 ${this.escHtml(c.name)}</span><button id="info-close">✕</button></div>
        <div class="row" data-citizen-role>${c.sex === 'm' ? '男' : '女'} · ${Math.floor(c.age)} 岁 · ${c.student ? '学生' : c.adult ? '成人' : '儿童'}</div>
        <div class="row">职业：<span data-citizen-job>${jobName}</span> · <span data-citizen-status>${this.escHtml(status)}</span></div>
        ${c.carry ? `<div class="row">随身：${this.cargoText(c.carry)}（${c.carry.smithInput?'铁匠原料已出库、尚未消耗':'未入库'}）</div>` : ''}
        <div class="row">家庭：${fam ? (fam.houseId != null ? '有房' : '无房') : '单身'}</div>
        ${this.studentInfoMarkup(c)}
        <div class="row">饥饿 ${'▕'.repeat(Math.min(4, c.hunger)) || '无'} · 受冻 ${c.cold > 1 ? '是' : '无'}</div>
        ${this.citizenClothingMarkup(c)}
        ${Number.isFinite(c.dietVariety) ? `<div class="row">最近饮食：${Math.max(0, Math.min(3, c.dietVariety))} / 3 类${Number.isFinite(c.dietScore) ? ' · 长期均衡 ' + c.dietScore.toFixed(1) + '/3' : ''}</div>` : ''}
        ${this.citizenHealthMarkup(c)}
        ${this.citizenLeisureMarkup(c)}`;
      this.initStudentInfo(c);
    }
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
    if (dem) dem.addEventListener('click', () => {
      // A stale cancel-site button must never remove a newly completed building.
      if (!G.sel || G.sel.kind !== 'b' || G.world !== w || G.game !== renderedGame || this.el.info !== el ||
          w.bmap[G.sel.id] !== selected || selected.state !== renderedState || selected.type !== renderedType ||
          el.querySelector('#info-demolish') !== dem || (el.classList.contains && el.classList.contains('hidden')) ||
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
        <form id="trade-target-form" class="economy-form">
          <h3>① 备货 / 搬回</h3>
          <label for="trade-target-resource">资源</label><select id="trade-target-resource">${payments}</select>
          <p data-economy-live="target-stock"></p>
          <label for="trade-target-quantity">待售目标（0–2000）</label><input id="trade-target-quantity" type="number" min="0" max="2000" step="1" value="${Number(b.tradeTargets && b.tradeTargets.firewood) || 0}" inputmode="numeric">
          <div class="economy-actions"><button type="submit">应用待售目标</button><button type="button" id="trade-return-stock">设为 0 搬回</button></div>
          <p class="desc">商人从仓库搬货，不会凭空增加库存。所有待售物资共享本站容量，居民不能使用；调低目标后由商人运回仓库。</p>
        </form>
        <form id="trade-exchange-form" class="economy-form">
          <h3>② 与商船交易</h3>
          <label for="trade-good">购买</label><select id="trade-good">${goods}</select>
          <label for="trade-buy-quantity">数量</label><input id="trade-buy-quantity" type="number" min="1" max="400" step="1" value="1" inputmode="numeric">
          <label for="trade-payment">用一种待售物资支付</label><select id="trade-payment">${payments}</select>
          <p data-economy-live="quote" class="trade-quote" role="status" aria-live="polite"></p>
          <button type="submit" id="trade-execute">确认交易</button>
          <p class="desc">付款数量向上取整，不找零。买入普通物资先进入本站库存，低于现存数量的待售目标会让商人搬回；羊或牛购入后进入各自待安置数量，到同种牧场放入。果树种子与卷心菜种子各买 1 次永久解锁，不能复购，不是库存物品，也不占贸易站或仓库容量。卷心菜解锁后到农田选择种植，产出计入蔬菜。</p>
        </form>
        <form id="trade-order-form" class="economy-form">
          <h3>③ 向这位商人订货</h3>
          <p data-economy-live="merchant-order"></p>
          <p data-economy-live="merchant-orders"></p>
          <label for="trade-order-good">下次由同一商人带来</label><select id="trade-order-good">${orderGoods}</select>
          <label for="trade-order-quantity">订货数量</label><input id="trade-order-quantity" type="number" min="1" max="400" step="1" value="1" inputmode="numeric" aria-describedby="trade-order-note">
          <p data-economy-live="order-quote" role="status" aria-live="polite"></p>
          <div class="economy-actions"><button type="submit" id="trade-order-confirm">确认一次订货</button><button type="button" id="trade-order-cancel">取消待到货订单</button></div>
          <p class="desc" id="trade-order-note">无需预付款，不会自动交易。每站每位商人只保留一份一次性订单；只能在该商人停靠时替换或取消。订单在同一商人下次到达时带来并清除，下一艘船可能是别的商人。到货单价为原价 × 1.25 向下取整，须手动支付购买；其他货物仍按普通价。未买货物会随船离开。</p>
        </form>
        <p class="economy-message" data-economy-message role="status" aria-live="polite"></p>
      </section>`;
    }
    if (b.type === 'pasture' && G.stockPasture && G.setPastureTarget) return `<section class="economy-details" data-economy="pasture">
      <p class="row" data-economy-live="animals"></p><p class="row" data-economy-live="pasture-production"></p>
      <form id="pasture-type-form" class="economy-form"><h3>空场选择物种</h3><label for="pasture-type">羊或牛（不能混养）</label><select id="pasture-type"><option value="sheep"${G.pastureTypeOf(b)==='sheep'?' selected':''}>羊：肉、羊毛</option><option value="cattle"${G.pastureTypeOf(b)==='cattle'?' selected':''}>牛：肉、皮革</option></select><button type="submit" id="pasture-type-apply">应用物种</button><p data-economy-live="pasture-switch"></p></form>
      <form id="pasture-stock-form" class="economy-form"><h3>放入已购同种牲畜</h3><p data-economy-live="sheep-bank"></p>
        <label for="pasture-stock-quantity">放入数量</label><input id="pasture-stock-quantity" type="number" min="1" max="12" step="1" value="2" inputmode="numeric"><button type="submit" id="pasture-stock">放入牧场</button></form>
      <form id="pasture-target-form" class="economy-form"><h3>繁殖与保留数量</h3><label for="pasture-target-quantity" data-economy-live="pasture-target-range"></label><input id="pasture-target-quantity" type="number" min="2" max="12" step="1" value="${Number(b.animalTarget) || 8}" inputmode="numeric"><button type="submit">应用保留数量</button>
        <p class="desc" data-economy-live="pasture-rule"></p><p class="desc">至少两头同种牲畜且牧人实际照料才繁殖。保留数只控制超额屠宰。已屠宰产物逐批搬运，库存满则保留；牧场内待送产物未搬空不能拆场。</p></form>
      <section data-pasture-split><h3>分群扩场</h3>
        <label for="pasture-split-target">同种空牧场（确认时检查通路）</label><select id="pasture-split-target"></select>
        <p class="desc" data-pasture-split-status></p>
        <div class="economy-actions"><button type="button" id="pasture-split-start">查看分群方案</button></div>
        <div class="hidden" data-pasture-split-confirm role="group" aria-label="确认牲畜分群"><p class="desc" data-pasture-split-quote></p><div class="economy-actions"><button type="button" id="pasture-split-confirm">确认分群</button><button type="button" id="pasture-split-cancel">取消</button></div></div>
        <p class="desc">满10头后可分出一半到同种空场。沿用按畜群数量直接安置的规则，不模拟逐头赶路；两场必须连通。保留量与工人不自动调整，新场需牧人实际照料。已产羊毛、肉皮和在途货留原场。</p>
      </section>
      <p class="economy-message" data-economy-message role="status" aria-live="polite"></p>
    </section>`;
    if(b.type==='orchard')return `<section class="economy-details" data-economy="orchard">
      <p data-economy-live="orchard-age"></p><p data-economy-live="orchard-harvest"></p><p data-economy-live="orchard-renewal"></p>
      <form id="orchard-replant-form" class="economy-form"><label for="orchard-replant">空位补种</label><select id="orchard-replant"><option value="on"${b.orchardReplant!==false?' selected':''}>允许农夫补种</option><option value="off"${b.orchardReplant===false?' selected':''}>暂停新补种</option></select><button type="submit">应用补种设置</button></form>
      <p class="desc">每株由农夫实际到达后种植、照料或采收。秋季先采果，再种空位和养幼树；暂停补种只影响新任务，已开始的单株工作照常完成。4年有效养护成熟，每株每秋最多20果，搬运后才入库；满仓携果保留，冬季未采果损失。</p>
      <p class="desc">树龄达到12–20年时按株错峰枯尽，届时该株未采果实一起损失（不计为已产出）；一年内将枯尽会预警，应优先采收。补种重新养4年。本作适配寿命，不是原版精确数值。旧成熟园从4岁迁移，至少还有8年宽限；不影响已有在途果实。</p>
      <p class="desc" data-economy-live="orchard-trees" style="white-space:pre-line"></p><p class="economy-message" data-economy-message role="status" aria-live="polite"></p>
    </section>`;
    return '';
  },

  initEconomyInfo: function (b) {
    const el = this.el.info, w = G.world, g = G.game;
    const panel = el.querySelector && el.querySelector('[data-economy]');
    if (!panel) return;
    const valid = node => G.world === w && G.game === g && this.el.info === el && !el.classList.contains('hidden') &&
      G.sel && G.sel.kind === 'b' && G.sel.id === b.id && w.bmap[b.id] === b && b.state === 'ok' &&
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
        message(result.ok ? `已购买${G.TRADE_GOODS[quote.good].name} × ${quote.qty}，支付${G.RES[quote.payment].name} × ${result.paid}。${G.isLivestockType(quote.good) ? `到${G.TRADE_GOODS[quote.good].name}牧场放入，不能混养。` : seed === 'orchard' ? '所有果园已永久解锁种植，种子不占仓位。' : seed === 'cabbage' ? '所有农田已永久解锁卷心菜，请到农田选择；本季已开始的作物保留，改选留到下一春。种子不占仓位。' : '物资已到本站，等待商人按目标搬回仓库。'}` : result.reason || '交易未完成。');
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
        message(result.ok ? `已向${G.merchantProfile(b).name}订${G.TRADE_GOODS[quote.good].name} × ${quote.qty}，无需预付款；由同一商人下次带来，到货后需手动交易。` : result.reason || '订货未完成。');
      });
      const cancelOrder = el.querySelector('#trade-order-cancel');
      cancelOrder.addEventListener('click', () => {
        if (!valid(cancelOrder) || (G.hasOpenModal && G.hasOpenModal()) || !sameMerchant()) return;
        const result = G.cancelMerchantOrder(b, renderedMerchant);
        message(result.ok ? '已取消这位商人的待到货订单；未扣除任何待售物资。' : result.reason || '没有可取消的订单。');
        this.refreshEconomyInfo(b);
      });
    }
    if(b.type==='orchard')onSubmit('orchard-replant-form',()=>{const value=el.querySelector('#orchard-replant').value;message(['on','off'].includes(value)&&G.setOrchardReplant(b,value==='on')?value==='on'?'允许新补种；需农夫到空树位劳动。':'已暂停新补种；现果、养护与已开始的工作继续。':'补种设置无效');});
    if (b.type === 'pasture') {
      onSubmit('pasture-type-form',()=>{const type=el.querySelector('#pasture-type').value;message(G.setPastureType(b,type)?`牧场物种已设为${G.LIVESTOCK[type].name}；下一次放入只接收该物种。`:G.pastureSwitchReason(b)||'物种选择无效');});
      onSubmit('pasture-stock-form', () => {
        const qty = Number(el.querySelector('#pasture-stock-quantity').value);
        const d=G.pastureSummary(b);message(G.stockPasture(b, qty, d.type) ? `已放入 ${qty} 头${d.name}。` : `无法放入：请检查整数数量、待安置${d.name}数及${d.cap}头容量。`);
      });
      onSubmit('pasture-target-form', () => {
        const qty = Number(el.querySelector('#pasture-target-quantity').value);
        message(G.setPastureTarget(b, qty) ? `保留数量已设为 ${qty} 头，超出部分由牧人屠宰。` : `请输入 2–${G.pastureSummary(b).cap} 的整数。`);
      });
      this.initPastureSplit(b);
    }
    this.refreshEconomyInfo(b);
  },

  pastureSplitOptions:function(b){return G.world.buildings.filter(x=>x!==b&&x.type==='pasture'&&x.state==='ok'&&G.pastureTypeOf(x)===G.pastureTypeOf(b)&&!(x.animals>0));},
  refreshPastureSplit:function(b){
    const el=this.el.info,panel=el.querySelector('[data-pasture-split]');if(!panel)return;
    const select=panel.querySelector('#pasture-split-target'),start=panel.querySelector('#pasture-split-start'),box=panel.querySelector('[data-pasture-split-confirm]'),status=panel.querySelector('[data-pasture-split-status]');if(!select||!start||!box||!status)return;
    const options=this.pastureSplitOptions(b),signature=options.map(x=>x.id+':'+G.pastureTypeOf(x)).join(',');
    if(panel._splitOptions!==signature){const previous=select.value;select.innerHTML=options.length?options.map(x=>`<option value="${x.id}">牧场 #${x.id}（${x.x},${x.y}）</option>`).join(''):'<option value="">没有同种已建成空场</option>';select.value=options.some(x=>String(x.id)===previous)?previous:options.length?String(options[0].id):'';panel._splitOptions=signature;}
    const target=G.world.bmap[Number(select.value)],q=G.pastureSplitFacts(b,target);start.disabled=!q.ok;
    status.textContent=q.ok?`本场${q.sourceCount}头，可分${q.qty}头，留下${q.left}头种畜。新场按现有保留量${target.animalTarget||8}头运行；实际连通性在查看与确认时检查。`:q.reason;
    if(panel._splitQuote&&(!q.ok||q.key!==panel._splitQuote.key||(G.hasOpenModal&&G.hasOpenModal()))){panel._splitQuote=null;box.classList.add('hidden');const msg=el.querySelector('[data-economy-message]');if(msg&&!(G.hasOpenModal&&G.hasOpenModal()))msg.textContent='畜群、保留量或通路已变，请重新查看分群方案。';if(box.contains&&box.contains(document.activeElement)&&!(G.hasOpenModal&&G.hasOpenModal())){const focus=q.ok?start:el.querySelector('#info-close');if(focus&&focus.focus)focus.focus();}}
  },
  initPastureSplit:function(b){
    const el=this.el.info,w=G.world,g=G.game,panel=el.querySelector('[data-pasture-split]');if(!panel)return;
    const select=panel.querySelector('#pasture-split-target'),start=panel.querySelector('#pasture-split-start'),confirm=panel.querySelector('#pasture-split-confirm'),cancel=panel.querySelector('#pasture-split-cancel'),box=panel.querySelector('[data-pasture-split-confirm]'),quote=panel.querySelector('[data-pasture-split-quote]'),msg=el.querySelector('[data-economy-message]');
    if(!select||!start||!confirm||!cancel||!box||!quote)return;
    const reset=()=>{panel._splitQuote=null;box.classList.add('hidden');};reset();
    const valid=()=>G.world===w&&G.game===g&&this.el.info===el&&!el.classList.contains('hidden')&&G.sel?.kind==='b'&&G.sel.id===b.id&&w.bmap[b.id]===b&&b.state==='ok'&&el.querySelector('[data-pasture-split]')===panel&&!(G.hasOpenModal&&G.hasOpenModal());
    select.addEventListener('change',()=>{reset();if(valid())this.refreshPastureSplit(b);});
    start.addEventListener('click',e=>{if(!valid()||e.detail>1){reset();return;}const target=w.bmap[Number(select.value)],q=G.pastureSplitQuote(b,target);if(!q.ok){reset();if(msg)msg.textContent=q.reason;return;}panel._splitQuote={key:q.key,target};quote.textContent=`将${q.qty}头${G.LIVESTOCK[q.type].name}直接分入牧场 #${target.id}（${target.x},${target.y}），本场留下${q.left}头。总头数不增加，繁殖进度守恒；不移动羊毛、肉皮、携货和工人。目标保留量${target.animalTarget||8}头，超过时会由牧人正常屠宰。新场须实际照料才继续繁殖。`;box.classList.remove('hidden');if(confirm.focus)confirm.focus();});
    cancel.addEventListener('click',()=>{reset();if(valid()&&start.focus)start.focus();});
    confirm.addEventListener('click',e=>{if(!valid()||!panel._splitQuote||e.detail>1){reset();return;}const pending=panel._splitQuote;reset();const result=G.splitPasture(b,pending.target,pending.key);if(msg)msg.textContent=result.ok?`已分${result.qty}头${G.LIVESTOCK[result.type].name}到另一牧场；请分别检查保留量和用工。`:result.reason;this.refreshEconomyInfo(b);const close=el.querySelector('#info-close');if(result.ok&&close&&close.focus)close.focus();});
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
    return { ok: true, good, qty, unitPrice, text: `${profile.name}下次回访将带来${offer.name} × ${qty}，订货单价 ${unitPrice}（原价 ${offer.price} × 1.25 向下取整）。无需预付款；到货后手动交易。` };
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
      set('[data-economy-live="merchant-payments"]', merchant ? `收购：${accepted}。${profile.acceptsFood ? '接受三类食物付款。' : '拒收食物：肉类、蔬菜、主食。'}` : '各商人有不同目录与收购物资；订货要等同一商人回访。');
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
      set('[data-economy-live="merchant-order"]', merchant ? (pending ? `待到货：${G.TRADE_GOODS[pending.good].name} × ${pending.qty}。` : '这位商人暂无待到货订单。') + returnText + (order.arrivedGood ? `本次已带到${G.TRADE_GOODS[order.arrivedGood].name}，订单已清除；购买仍需手动确认。` : '') : '商人未停靠，暂不能订货、替换或取消订单。');
      const otherOrders = (order.pendingOrders || []).filter(item => !merchant || item.merchantId !== order.merchantId);
      set('[data-economy-live="merchant-orders"]', otherOrders.length ? '等待其他商人回访：' + otherOrders.map(item => `${item.name} · ${G.TRADE_GOODS[item.good].name} × ${item.qty}（订货单价 ${item.unitPrice}）`).join('；') + '。须等该商人停靠后才能修改。' : '');
      const orderQuote = this.merchantOrderQuote(b), confirm = el.querySelector('#trade-order-confirm'), cancel = el.querySelector('#trade-order-cancel');
      set('[data-economy-live="order-quote"]', orderQuote.text || orderQuote.reason);
      confirm.disabled = !orderQuote.ok; confirm.textContent = pending ? '确认替换一次订货' : '确认一次订货';
      cancel.disabled = !pending;
      const orderGood = el.querySelector('#trade-order-good'), orderQuantity = el.querySelector('#trade-order-quantity');
      orderGood.disabled = !merchant; orderQuantity.disabled = !merchant;
      orderQuantity.max = String(G.TRADE_GOODS[orderGood.value]?.stock || 400);
    } else if (b.type === 'pasture') {
      const d=G.pastureSummary(b),bank=G.game.livestock;
      set('[data-economy-live="animals"]', `${d.name}群 ${d.animals}/${d.cap} 头 · 当前保留 ${d.target} 头`);
      set('[data-economy-live="pasture-production"]', `繁殖进度 ${Math.floor(d.growth*100)}% · ${d.type==='sheep'?`待剪羊毛 ${Math.floor(d.wool)}`:`已屠宰待送：肉 ${d.meat} · 皮革 ${d.leather}`}`);
      set('[data-economy-live="sheep-bank"]', `已购待安置：羊 ${bank.sheep||0} · 牛 ${bank.cattle||0}。本场只接收${d.name}。`);
      set('[data-economy-live="pasture-switch"]', d.switchReason||`当前${d.name}场；空场且原任务与产物已清空时可改种类。`);
      set('[data-economy-live="pasture-rule"]', d.rule);
      set('[data-economy-live="pasture-target-range"]', `保留 2–${d.cap} 头（已有设置 ${d.target}）`);
      el.querySelector('#pasture-stock').disabled=d.bank<=0||d.animals>=d.cap;
      el.querySelector('#pasture-type-apply').disabled=!!d.switchReason;
      el.querySelector('#pasture-stock-quantity').max=String(d.cap);el.querySelector('#pasture-target-quantity').max=String(d.cap);
      this.refreshPastureSplit(b);
      const output=el.querySelector('[data-pasture-output]');if(output){const html='产出：'+G.productionOutputsOf(b).filter(k=>k!=='food').map(k=>`${this.resourceIcon(k)}${G.RES[k].name}`).join(' · ');if(output.innerHTML!==html)output.innerHTML=html;}
    } else {
      const d=G.orchardSummary(b),unlocked=G.game.unlocks?.orchard;
      set('[data-economy-live="orchard-age"]',`种子：${unlocked?'永久解锁':'尚未购买'} · 空位 ${d.empty} / 幼树 ${d.young} / 成树 ${d.mature}（共9位）`);
      set('[data-economy-live="orchard-harvest"]',`本季未采果实 ${Math.floor(d.fruit)}（蔬菜）；实际采收/送仓才记产出/入库。${d.status}`);
      set('[data-economy-live="orchard-renewal"]',`已应用补种：${b.orchardReplant?'允许':'暂停'} · 一年内将枯尽 ${d.soon} 株${Number.isFinite(d.nextDeath)?' · 最短还差 '+d.nextDeath+' 树龄日':''}；空位没有产量。`);
      set('[data-economy-live="orchard-trees"]',(b.orchardTrees||[]).map((t,i)=>`第${i+1}株：${t.planted?`树龄 ${(t.age/G.YEAR_DAYS).toFixed(1)} 年 / 寿命 ${G.orchardLifetime(i)/G.YEAR_DAYS} 年 · ${t.age<G.ORCHARD.matureDays?'尚需 '+(G.ORCHARD.matureDays-t.age)+' 有效养护日':'成熟'} · 待采 ${Math.floor(t.fruit)}`:'空位，待种植'}`).join('\n'));

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

  // Rows are built once. Refresh never replaces an input or changes a draft.
  initProductionGoals: function () {
    const rows = document.getElementById('production-goal-rows');
    rows.innerHTML = G.RES_KEYS.map(type => {
      const step = type === 'food' || (G.FOOD_KEYS || []).includes(type) ? 100 : ['tools', 'steelTools', 'clothes', 'warmCoats'].includes(type) ? 10 : 50;
      return `<section class="production-goal-row" aria-labelledby="goal-label-${type}">
        <label id="goal-label-${type}" for="goal-input-${type}">${this.resourceIcon(type)}${type === 'food' ? '总食物（肉类 + 蔬菜 + 主食）' : G.RES[type].name}</label>
        <p id="goal-stock-${type}"></p>
        <div class="goal-controls"><button type="button" data-goal="${type}" data-step="${-step}" aria-label="减少${G.RES[type].name}目标${step}">−${step}</button>
        <input id="goal-input-${type}" type="number" inputmode="numeric" min="0" max="${G.PRODUCTION_GOAL_MAX}" step="1" placeholder="未设置" aria-describedby="goal-status-${type}">
        <button type="button" data-goal="${type}" data-step="${step}" aria-label="增加${G.RES[type].name}目标${step}">＋${step}</button>
        <button type="button" data-goal="${type}" data-apply="true">应用</button>
        <button type="button" class="goal-inherit" data-goal="${type}" data-inherit="true">继承原规则</button></div>
        <p id="goal-status-${type}"></p></section>`;
    }).join('');
    rows.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      const type = button.dataset.goal, input = document.getElementById('goal-input-' + type);
      if (!button.dataset.inherit && input.validity && input.validity.badInput) {
        document.getElementById('production-goals-message').textContent = '请输入有效数字，或完整清空以继承原规则'; return;
      }
      if (button.dataset.inherit) {
        G.setProductionGoal(type, null); input.value = '';
        document.getElementById('production-goals-message').textContent = `${G.RES[type].name}已继承原规则`;
      } else if (button.dataset.step) {
        const current = input.value.trim() === '' ? (G.productionGoalOf(type) ?? Math.ceil(G.game.res[type])) : Number(input.value);
        if (!Number.isFinite(current)) { document.getElementById('production-goals-message').textContent = '请输入有限整数'; return; }
        input.value = String(G.clamp(Math.round(current) + Number(button.dataset.step), 0, G.PRODUCTION_GOAL_MAX));
        document.getElementById('production-goals-message').textContent = '数值尚未应用，点击“应用”生效';
      } else {
        const value = input.value.trim() === '' ? null : Number(input.value);
        if (!G.setProductionGoal(type, value)) {
          document.getElementById('production-goals-message').textContent = `请输入0至${G.PRODUCTION_GOAL_MAX}的整数，或清空以继承原规则`; return;
        }
        document.getElementById('production-goals-message').textContent = `${G.RES[type].name}目标已应用`;
      }
      this.refreshProductionGoals();
      if (G.sel) this.renderInfo(true);
    }));
    document.getElementById('btn-production-goals').addEventListener('click', () => this.showProductionGoals());
    document.getElementById('production-goals-close').addEventListener('click', () => this.closeProductionGoals());
  },
  showProductionGoals: function () {
    const modal = document.getElementById('production-goals');
    if (!modal.classList.contains('hidden')) return;
    if (G.hasOpenModal && G.hasOpenModal()) return;
    this._productionGoalsPaused = G.game.paused; G.game.paused = true;
    for (const type of G.RES_KEYS) document.getElementById('goal-input-' + type).value = G.productionGoalOf(type) ?? '';
    document.getElementById('production-goals-message').textContent = '';
    modal.classList.remove('hidden'); this.refreshProductionGoals(); this.enterDialog('production-goals'); this.refreshHUD();
  },
  closeProductionGoals: function () {
    const modal = document.getElementById('production-goals');
    if (modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    if (!G.game.over) G.game.paused = !!this._productionGoalsPaused;
    this.leaveDialog('production-goals'); this.refreshHUD();
  },
  refreshProductionGoals: function () {
    const modal = document.getElementById('production-goals');
    if (!modal || modal.classList.contains('hidden')) return;
    for (const type of G.RES_KEYS) {
      const cap=G.storageCap(type);
      const stock = document.getElementById('goal-stock-' + type), status = document.getElementById('goal-status-' + type);
      if (!stock || !status) continue;
      const target = G.productionGoalOf(type);
      const foodClass = (G.FOOD_KEYS || []).includes(type);
      const tool = type === 'tools' || type === 'steelTools';
      stock.textContent = `库存 ${Math.floor(G.game.res[type])} · ${foodClass ? '与其他食物共享总仓容 ' + cap + '（总食物 ' + Math.floor(G.game.res.food) + '）' : '硬仓容 ' + (tool ? '不限' : cap)}`;
      status.textContent = target === null ? '未设置全镇目标，继承原规则' :
        `已应用目标 ${target} · ${target === 0 ? '关闭新自动生产' : `恢复线 ≤${G.productionResumeAt(target)} · ${G.goalPaused(type) ? '达标暂停' : '可生产'}`}`;
      if (target !== null && !tool && target > cap) status.textContent += '；目标高于仓容，需扩建仓库；' + (type === 'ale' ? '余麦酒保留随身，等待空间' : ['stone', 'iron', 'coal'].includes(type) ? '余矿保留随身，等待空间' : '满仓交货仍可能损失');
      if (type === 'firewood' || tool) status.textContent += '；各屋原目标保留，实际按全镇与本屋较低值执行（见建筑详情）';
      if (tool) status.textContent += '；只限制正在生产本类工具的铁匠，另一类工具有独立目标';
      if (type === 'food') status.textContent += '；总量目标与三类各自目标同时生效，总量达标会暂停食物新生产';
      if (foodClass) status.textContent += '；同时受总食物目标限制，本类达标不拦停其他食物类别';
      if ((type === 'food' || foodClass) && target !== null) status.textContent += '；已开始的整田继续播种和收获，过低目标可能断粮';
      if (type === 'firewood' && target !== null) status.textContent += '；过低目标可能挨冻';
      if (type === 'leather') status.textContent += '；仅控制狩猎的新批次皮革副产物，猎人是否继续产肉由肉类和总食物目标控制';
      if (type === 'clothes' || type === 'warmCoats') status.textContent += '；两类衣物目标独立，仅暂停生产本类的新批次；本类衣物仓满也会暂停裁缝，已接批次保留';
      if (type === 'ale') status.textContent += '；只控制麦酒新酿造，仍受酒馆储粮保护；麦酒不计入三类食物，不能充饥';
    }
  },

  enterDialog: function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    this._dialogFocus = this._dialogFocus || {};
    this._dialogFocus[id] = document.activeElement;
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
  const result = { ok: check.ok && affordable, affordable, radius: p.radius || p.waterR || 0, warning: false };
  result.bounds = [Math.max(0,x-result.radius), Math.max(0,y-result.radius), Math.min(w.N,x+result.radius+1), Math.min(w.N,y+result.radius+1)];
  const lines = [`${def.name} · ${!check.ok ? '不能建：' + check.reason : !affordable ? '材料不足' : '可建造'}`];
  lines.push('材料（现有/需要）：' + (Object.keys(def.cost).map(k => `${G.RES[k].name} ${Math.floor(G.game.res[k])}/${def.cost[k]}`).join(' · ') || '无需建材，仍需施工'));
  if (p.radius) {
    const trees = G.treesInRadius(w, x, y, p.radius, false).filter(t => !(t.x >= x && t.x < x + def.w && t.y >= y && t.y < y + def.h));
    result.trees = trees.length; result.mature = trees.filter(t => G.treeStage(t) >= 2).length;
    lines.push(`工作范围 ±${p.radius} 格（方形，建筑原点） · 占地清场后 ${result.trees} 棵树 / 成熟 ${result.mature}`);
    if (['gatherer', 'hunting', 'herbalist'].includes(type)) {
      const n = type !== 'gatherer' ? result.mature : result.trees;
      if (n < p.needTrees) { result.warning = true; lines.push(`⚠ 可建但当前无法生产：至少需 ${p.needTrees} 棵${type !== 'gatherer' ? '成熟' : ''}树`); }
      else if (result.mature < p.fullForest) { result.warning = true; lines.push(`△ 林量偏低：产量随成熟林增加，充足参考 ${p.fullForest} 棵`); }
    }
    if (type === 'forester') lines.push('砍伐会降低重叠食物林产量；可在建筑面板关闭砍伐育林。');
  }
  if (type === 'dock') {
    result.water = G.countWaterInRadius(w, x, y, p.waterR);
    lines.push(`工作范围 ±${p.waterR} 格（方形） · 水域 ${result.water} 格 / 满产参考 ${p.fullWater}`);
    if (result.water < p.fullWater) { result.warning = true; lines.push('△ 可建但水域较少，单次渔获降低'); }
  }
  if(type==='stockpile')lines.push('完工后：仅木/石/铁/煤/柴各增加250公共仓容，零常驻工人；不是独立地方库存。');
  if (check.ok) {
    const outputs=G.productionOutputsOf({type});
    const route = G.storageRoute(x,y,outputs.length?outputs:null);
    if (route) lines.push(`当前地形可达仓：约 ${route.path.length} 步；道路更快，完工后须保留出入口。`);
    else { result.warning = true; lines.push('⚠ 当前找不到可达仓库，产物无法正常入库'); }
  } else lines.push('物流：地块合法后显示可达仓；近仓且通路畅通，搬运更快。');
  let clearing = 0;
  for (let yy = Math.max(0,y); yy < Math.min(w.N,y+def.h); yy++) for (let xx = Math.max(0,x); xx < Math.min(w.N,x+def.w); xx++) if (w.treeIdx[yy*w.N+xx] >= 0) clearing++;
  if (clearing) lines.push(`清场 ${clearing} 棵树：工人逐棵砍伐并搬运，完成后才施工；取消保留未砍树。`);
  lines.push('工人自动分配：食品优先；工地过多会争用散工。');
  result.text = lines.join('\n');
  return result;
};
