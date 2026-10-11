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
      if (c.task && c.task.kind === 'firewood' && c.task.b && c.task.b.type === 'tailor') return c.task.phase === 'fetch' ? '核对仓库衣料（完成时才扣原料）' : `制作${G.RES[c.task.yield && c.task.yield.type || 'clothes'].name}`;
      if (c.task && c.task.kind === 'brew') return c.task.phase === 'fetch' ? '取主食酿酒' : '加工麦酒';
      if (c.task && c.task.kind === 'host') return '酒馆在岗接待';
      if (c.task && c.task.kind === 'clinic') return b && b.type === 'herbalist' ? '采药屋值守' : '诊所值守';
      if (c.task && c.task.kind === 'trade') return c.task.phase === 'return' ? '退回待售库存' : '装卸贸易物资';
      const labels = { clearSite: '清理工地', chop: '砍伐', clearrock: '清矿', build: '建造中', sow: '播种', harvest: '收获', plant: '补种', firewood: '加工柴火' };
      return c.task ? (labels[c.task.kind] || (b && b.type === 'tailor' ? '制作衣物' : b && b.type === 'orchard' ? '果园劳作' : b && b.type === 'pasture' ? '照料羊群' : '工作中')) : '等待下一项任务';
    }
    if (c.state === 'walk' || c.state === 'haul') {
      if (c.carry) return c.carry.brewIngredient ? `搬运酿酒主食（${c.state === 'haul' ? '退回仓库' : '送往酒馆'}）` : `搬运${G.RES[c.carry.type].name}（${c.state === 'haul' ? '送仓' : '途中'}）`;
      if (c.walkKind === 'home') return '回家途中';
      if (c.walkKind === 'wander') return '闲逛';
      if (c.task && c.task.kind === 'firewood' && c.task.b && c.task.b.type === 'tailor') return c.task.phase === 'fetch' ? '前往仓库核对衣料（完成时才扣原料）' : `返回裁缝铺制作${G.RES[c.task.yield && c.task.yield.type || 'clothes'].name}`;
      if (c.task && c.task.kind === 'firewood' && c.task.phase === 'fetch') return c.task.consume && G.RES[c.task.consume.type] ? `前往仓库取${G.RES[c.task.consume.type].name}` : '前往仓库取原木';
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
    if (b.type === 'pasture' && !(b.animals > 0)) return '等待放入羊群';
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
    return `当前已入住住房：整冬约需 ${heat.fullWinter} 柴火` +
      (heat.winter ? `；本冬此后约需 ${Math.ceil(heat.futureWinter)}（还剩 ${heat.futureDays} 次扣除）` : '');
  },

  fuelInfoData: function (b) {
    const heat = this.heatDemand(), stock = G.game.res.firewood;
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
      heat: this.heatDemandText(heat),
      gap: stock < need ? `柴火库存比${heat.winter ? '本冬后续' : '整冬'}取暖估算少约 ${Math.ceil(need - stock)}。` : '取暖估算会随住房入住情况变化。',
      status,
      workers: b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、') ||
        (b.state === 'site' ? '等待建筑工人' : '无'),
      refund: b.state === 'site' && !b.constructionStarted && b.progress === 0 && b.workLeft >= b.totalWork
        ? '未开工：取消退还全部已付建材，保留树木' : '已开工：拆除退还一半已付建材，已砍树不恢复',
    };
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
      { id: 'services', name: '城镇服务', icon: '🏘️', hint: '储运 · 教育 · 医疗 · 迁入', tools: ['storage', 'school', 'herbalist', 'hospital', 'tradingpost', 'townhall'] },
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
      blacksmith: 'tool_blacksmith', hunting: 'tool_hunting', house: 'tool_house', storage: 'tool_storage',
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
      status.textContent = t ? `当前：${names[t] || G.BDEF[t].name} · ${t === 'demolish' ? '点击建筑或道路立即拆除' : ['fell', 'quarry'].includes(t) ? '框选范围后确认标记' : ['road','stoneroad','bridge'].includes(t) ? '选起终点后预览并确认' : '点击地图放置，可连续建造'} · Esc / 右键取消` :
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
        const cap = G.storageCap();
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
    if (g.season >= 2 && g.res.firewood < remainingHeat) risks.push(`柴火不足：现有 ${Math.floor(g.res.firewood)} / ${heat.winter ? '本冬此后' : '整冬'}约需 ${Math.ceil(remainingHeat)}，伐木屋需原木。`);
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
  },
  siteInfoData: function (b) {
    const w = G.world, trees = G.siteTrees ? G.siteTrees(b).length : 0;
    return {
      status: trees ? `清理工地：还需砍 ${trees} 棵树（工人搬运入仓）` : `建造中 ${Math.floor(b.progress * 100)}%`,
      workers: b.workers.map(id => w.cmap[id]).filter(Boolean).map(c => c.name).join('、') || '等待建筑工人',
      refund: !b.constructionStarted && b.progress === 0 && b.workLeft >= b.totalWork ? '未开工：取消退还全部已付建材，保留树木' : '已开工：拆除退还一半已付建材，已砍树不恢复'
    };
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
      historyTitle: `最近 60 天账本 · 已记录 ${rows.length} 天`,
      historySummary: rows.length ? `第 ${rows[0].d}–${rows[rows.length - 1].d} 天：出生 ${born} · 死亡 ${died}；人口 ${rows[0].pop} → ${rows[rows.length - 1].pop}` : '尚无每日记录；结束第一天后开始记账。',
      historyRows: rows.map(row => `第 ${row.d} 天 · 人口 ${Number(row.pop) || 0} · 出生 ${Number(row.born) || 0} · 死亡 ${Number(row.died) || 0} · ${[['food','粮'],['firewood','柴'],['wood','木'],['stone','石'],['iron','铁']].map(([key,label]) => label + (Number.isFinite(row[key]) ? row[key] : '—')).join(' / ')}`).join('\n'),
    };
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
      <details class="townhall-ledger"><summary data-townhall="historyTitle">${this.escHtml(data.historyTitle)}</summary>
        <p data-townhall="historySummary">${this.escHtml(data.historySummary)}</p>
        <div class="townhall-ledger-rows" data-townhall="historyRows">${this.escHtml(data.historyRows)}</div>
        <p class="desc">仅保留实际记录的最近 60 天；出生、死亡与迁入分别计数，人口变化不等于出生减死亡。</p>
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
  tailorInfoData: function (b) {
    if (b.type !== 'tailor' || b.state !== 'ok' || !G.tailorSummary) return null;
    const s = G.tailorSummary(b), warm = s.recipe === 'warm', g = G.game;
    const names = b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、');
    const phases = { fetch: '前往仓库核料', work: '回铺 / 制作', haul: '待送仓', paused: '暂停保留' };
    const batches = s.batches.map(batch => {
      const carrier = typeof batch.carrier === 'object' && batch.carrier ? batch.carrier.name :
        batch.carrier;
      return `${G.RES[batch.type].name} ${batch.qty}（${phases[batch.phase] || '已接批次'}${carrier ? ' · ' + carrier : ''}）`;
    });
    const targets = ['clothes', 'warmCoats'].map(type => {
      const target = G.productionGoalOf(type);
      return `${G.RES[type].name} ${target === null ? '未设置' : target === 0 ? '0（关闭新生产）' : target + (G.goalPaused(type) ? '（达标暂停）' : '（可生产）')}`;
    });
    return { summary: s, data: {
      status: `新批次：${s.canProduce ? b.noWork && b.warnText ? '等待：' + b.warnText : !names ? '等待可用工人' : '可制作' : s.reason || '暂不能制作'}`,
      workers: names || '无',
      production: `当前产出：${G.RES[s.output].name}`,
      recipe: `每批：${warm ? '2 皮革 + 2 羊毛' : '2 皮革或 2 羊毛（自动优先皮革）'} → 1 ${G.RES[s.output].name}（受教育 2）；基础劳动 8 小时`,
      materials: '新批次用料：' + s.materials.map(item => `${item.qty} ${G.RES[item.type].name}`).join(' + ') + '（未预留，完成时复核）',
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
      ${Object.keys(facts.data).filter(key => !['status', 'workers'].includes(key)).map(key => `<p class="row" data-tailor="${key}">${this.escHtml(facts.data[key])}</p>`).join('')}
      <p class="economy-message" data-tailor-message role="status" aria-live="polite"></p>
      <p class="desc">工人先走到可达仓库核对衣料，再回裁缝铺制作。原料暂留全镇库存，制作完成时才一次扣齐全部原料；此前不预扣，也没有随身衣料。取消或读档重开未完成批次不扣原料。成衣搬运入库后才可领取。</p>
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
    return true;
  },
  initTailorInfo: function (b) {
    const el = this.el.info, w = G.world, g = G.game;
    const panel = el.querySelector && el.querySelector('[data-tailor-panel]');
    const select = panel && panel.querySelector('#coat-recipe');
    if (!select || !G.setCoatRecipe) return;
    select.addEventListener('change', () => {
      if (G.world !== w || G.game !== g || this.el.info !== el || el.classList.contains('hidden') || !G.sel ||
          G.sel.kind !== 'b' || G.sel.id !== b.id || w.bmap[b.id] !== b || b.state !== 'ok' ||
          el.querySelector('[data-tailor-panel]') !== panel || el.querySelector('#coat-recipe') !== select ||
          (G.hasOpenModal && G.hasOpenModal())) return;
      const accepted = G.setCoatRecipe(b, select.value);
      // Setters can reject a stale or invalid selection without replacing its node.
      select.value = G.tailorRecipeOf(b);
      this.refreshTailorInfo(b);
      const message = el.querySelector('[data-tailor-message]');
      if (message) message.textContent = accepted ? '配方已应用于新批次；已有批次和在途衣物保留。' : '配方未更改，请检查裁缝铺并重新选择。';
    });
    this.refreshTailorInfo(b);
  },
  resourceChainInfoData: function (b) {
    if (b.state !== 'ok' || !['mine', 'stonequarry', 'blacksmith'].includes(b.type)) return null;
    const smith = b.type === 'blacksmith', outputs = G.productionOutputsOf(b);
    const output = smith ? G.blacksmithOutput(b) : null;
    const mode = b.type === 'mine' ? G.mineModeOf(b) : null;
    const names = outputs.map(type => G.RES[type].name).join(' · ');
    const workers = b.workers.map(id => G.world.cmap[id]).filter(Boolean);
    const goal = G.buildingGoalStatus(b);
    let status;
    if (G.productionLimited(b) && goal) status = goal;
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
        batches.push(`${G.RES[task.yield.type].name} ${task.yield.qty}`);
      }
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
      data.inputs = '原料库存：' + recipe.map(item => `${G.RES[item.type].name} ${Math.floor(G.game.res[item.type] || 0)}`).join(' · ');
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
      ${['production', 'recipe', 'inputs', 'stock'].filter(key => data[key]).map(key => `<div class="row" data-resource-chain-live="${key}">${this.escHtml(data[key])}</div>`).join('')}
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
      memory: days > 0 ? `休闲记忆：约余 ${days.toFixed(1)} 天${s ? ` · 幸福目标 +${s.leisureBonus}` : ''}` : '休闲记忆：暂无（酒馆仅接待 18 岁以上居民）',
      work: `幸福带来的劳动效率：+${(bonus * 100).toFixed(1)}%（仅 0～+5%，无负惩罚）`,
      basis: `三类饮食（肉类、蔬菜、主食）是幸福基础${s ? `，当前饮食基础 ${s.dietBase.toFixed(1)} / 5` : ''}；休闲可补到 5，饥饿会降低幸福目标。完成休闲即时 +0.4（上限 5）；日终向目标最多变化 0.1。`,
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
    // Update only fuel text, never replace this panel's focused buttons. A new
    // selection or a site finishing construction still gets its own full panel.
    if (sameSelection && selected.state === 'ok' && this._townHallInfoState === selected.state && this.refreshTownHallInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._tavernInfoState === selected.state && this.refreshTavernInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._tailorInfoState === selected.state && this.refreshTailorInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._economyInfoState === selected.state && this.refreshEconomyInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._medicalInfoState === selected.state && this.refreshMedicalInfo(selected)) return;
    if (sameSelection && selected.state === 'ok' && this._resourceChainInfoState === selected.state && this.refreshResourceChainInfo(selected)) return;
    if (sameSelection && selected.type === 'woodcutter' && this._fuelInfoState === selected.state && this.refreshFuelInfo(selected)) return;
    if (hadFocus && !force && sameSelection && selected.type !== 'woodcutter' && (G.sel.kind === 'c' || this._infoBuildState === selected.state)) {
      if (G.sel.kind === 'c') { this.refreshCitizenLeisure(selected); this.refreshCitizenClothing(selected); }
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
    const destructiveActionChanged = sameSelection && this._infoBuildState === 'site' && selected.state !== 'site' && active && active.id === 'info-demolish';
    const focusSelector = destructiveActionChanged ? '#info-close' : hadFocus ? (active.id ? '#' + active.id : active.dataset.tl ? '[data-tl="' + active.dataset.tl + '"]' : active.dataset.fl ? '[data-fl="' + active.dataset.fl + '"]' : active.dataset.k ? '[data-k="' + active.dataset.k + '"]' : null) : null;
    this._infoWorld = w;
    this._infoGame = G.game;
    this._infoElement = el;
    this._infoSelection = selected;
    this._infoBuildState = selected.state;
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
      let status;
      if (fuelData) status = fuelData.status;
      else if (siteData) status = siteData.status;
      else if (medicalData) status = medicalData.status;
      else if (chainData) status = chainData.status;
      else if (hallData) status = hallData.data.status;
      else if (tavernData) status = tavernData.data.status;
      else if (tailorData) status = tailorData.data.status;
      else if (G.productionLimited(b) && G.buildingGoalStatus(b)) status = G.buildingGoalStatus(b);
      else if (b.type === 'house' || b.type === 'stonehouse') status = b.family != null ? '有人居住' : '空置';
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
      if (def.jobs > 0 || b.state === 'site') {
        const names = b.workers.map(id => w.cmap[id]).filter(Boolean).map(c => this.escHtml(c.name)).join('、');
        workers = `<div class="row">${medicalData ? b.type === 'hospital' ? '医师' : '采药员' : tavernData ? '酿酒工（需 18 岁以上且健康）' : '工人'}：<span${siteData ? ' data-site-workers' : ''}${fuelData ? ' data-fuel="workers"' : ''}${medicalData ? ' data-medical="workers"' : ''}${chainData ? ' data-resource-chain-live="workers"' : ''}${tavernData ? ' data-tavern="workers"' : ''}${tailorData ? ' data-tailor="workers"' : ''}${b.state === 'ok' && ['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-workers' : ''}>${names || (b.state === 'site' ? '等待建筑工人' : '无')}</span></div>`;
      }
      let extra = '';
      if ((b.type === 'house' || b.type === 'stonehouse') && b.family != null) {
        const fam = w.families.find(f => f.id === b.family);
        if (fam) extra = `<div class="row">住户：${fam.members.map(id => w.cmap[id]).filter(Boolean).map(c => `${this.escHtml(c.name)}(${Math.floor(c.age)}岁)`).join('、')}</div>`;
      }
      if (b.type === 'school') {
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
        <div class="row" data-fuel="heat">${fuelData.heat}</div>
        <div class="row" data-fuel="gap">${fuelData.gap}</div>
        <div class="row desc">目标不是取暖需求。库存达到目标只阻止本屋接新批次；调低可给建设留木，但不会预留建材。已接批次仍可能耗木，其他伐木屋按各自目标继续。住房变化和户外受冻仍须留意。</div>`;
      }
      if (chainData) extra += this.resourceChainInfoMarkup(b, chainData);
      if (hallData) extra += this.townHallInfoMarkup(b, hallData);
      if (tavernData) extra += this.tavernInfoMarkup(tavernData);
      if (tailorData) extra += this.tailorInfoMarkup(tailorData);
      if (b.state === 'ok') extra += this.economyInfoMarkup(b);
      if (medicalData) extra += this.medicalInfoMarkup(b, medicalData);
      const outputs = { gatherer: ['vegetables'], hunting: ['meat', 'leather'], dock: ['meat'], farm: ['grain'], orchard: ['vegetables'], pasture: ['meat', 'wool'], tailor: ['clothes'], herbalist: ['herbs'] };
      const produced = (chainData || tailorData ? [] : outputs[b.type] || []).filter(type => G.RES[type]);
      if (produced.length) extra += `<div class="row resource-output">产出：${produced.map(type => `${this.resourceIcon(type)}${G.RES[type].name}`).join(' · ')}</div>`;
      if (b.type === 'tailor' && !tailorData) extra += `<div class="row">原料库存：皮革 ${Math.floor(G.game.res.leather || 0)} · 羊毛 ${Math.floor(G.game.res.wool || 0)}</div><div class="row">成衣库存：${Math.floor(G.game.res.clothes || 0)}</div>`;
      if (b.type !== 'woodcutter' && !medicalData && !chainData && !tavernData && !tailorData && G.buildingGoalStatus(b)) extra += `<div class="row desc"${['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-goals' : ''}>${this.escHtml(G.buildingGoalStatus(b))}</div>`;
      if (['gatherer', 'hunting', 'forester'].includes(b.type)) {
        const trees = G.treesInRadius(w, b.x, b.y, G.PROD[b.type].radius, false);
        const mature = trees.filter(t => G.treeStage(t) >= 2).length;
        extra += `<div class="row">工作圈：${trees.length} 棵树 · 成熟 ${mature}（砍伐、建造清林会影响产出）</div>`;
      }
      if (b.type === 'farm' && b.farm) {
        extra += `<div class="row">播种 ${b.farm.filter(f => f.sown).length}/${b.farm.length} · 收获 ${b.farm.filter(f => f.harvested).length}/${b.farm.length}</div>`;
      }
      el.innerHTML = `
        <div class="info-head"><span>${def.icon} ${def.name}</span><button id="info-close">✕</button></div>
        <div class="row"${siteData ? ' data-site-status' : ''}${fuelData ? ' data-fuel="status"' : ''}${medicalData ? ' data-medical="status"' : ''}${chainData ? ' data-resource-chain-live="status"' : ''}${hallData ? ' data-townhall="status"' : ''}${tavernData ? ' data-tavern="status"' : ''}${tailorData ? ' data-tailor="status"' : ''}${b.state === 'ok' && ['tradingpost', 'pasture', 'orchard'].includes(b.type) ? ' data-economy-status' : ''}>${this.escHtml(status)}</div>
        ${workers}${extra}
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
      if (hallData) this.refreshTownHallInfo(b);
      if (tavernData) this.initTavernInfo(b);
      if (tailorData) this.initTailorInfo(b);
      if (medicalData) this.refreshMedicalPatients(b);
      if (chainData) this.initResourceChainInfo(b);
      if (b.state === 'ok') this.initEconomyInfo(b);
    } else {
      const c = w.cmap[G.sel.id];
      if (!c) { this.hideInfo(); return; }
      const status = this.citizenStatus(c);
      const jobB = c.job != null ? w.bmap[c.job] : null;
      const jobName = jobB ? G.BDEF[jobB.type].name : (c.student ? '学堂学生' : (c.adult ? '无业' : '儿童'));
      const fam = G.familyOf(c);
      el.innerHTML = `
        <div class="info-head"><span>🧑 ${this.escHtml(c.name)}</span><button id="info-close">✕</button></div>
        <div class="row">${c.sex === 'm' ? '男' : '女'} · ${Math.floor(c.age)} 岁 · ${c.student ? '学生' : c.adult ? '成人' : '儿童'}</div>
        <div class="row">职业：${jobName} · <span data-citizen-status>${this.escHtml(status)}</span></div>
        ${c.carry ? `<div class="row">随身：${G.RES[c.carry.type].name} ${Number(c.carry.qty)}（未入库）</div>` : ''}
        <div class="row">家庭：${fam ? (fam.houseId != null ? '有房' : '无房') : '单身'}</div>
        <div class="row">学识：${c.student ? '🎓 就读中' : c.educated ? '📖 受过教育' : '未受教育'}</div>
        <div class="row">饥饿 ${'▕'.repeat(Math.min(4, c.hunger)) || '无'} · 受冻 ${c.cold > 1 ? '是' : '无'}</div>
        ${this.citizenClothingMarkup(c)}
        ${Number.isFinite(c.dietVariety) ? `<div class="row">最近饮食：${Math.max(0, Math.min(3, c.dietVariety))} / 3 类${Number.isFinite(c.dietScore) ? ' · 长期均衡 ' + c.dietScore.toFixed(1) + '/3' : ''}</div>` : ''}
        ${this.citizenHealthMarkup(c)}
        ${this.citizenLeisureMarkup(c)}`;
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
    const renderedState = selected.state;
    if (dem) dem.addEventListener('click', () => {
      // A stale cancel-site button must never remove a newly completed building.
      if (!G.sel || G.sel.kind !== 'b' || G.world !== w || w.bmap[G.sel.id] !== selected || selected.state !== renderedState) {
        this.renderInfo();
        return;
      }
      G.removeBuilding(selected);
    });
  },
  economyStatus: function (b) {
    if (G.productionLimited(b) && G.buildingGoalStatus(b)) return G.buildingGoalStatus(b);
    if (b.type === 'tradingpost') return b.merchant && b.merchant.leaveDay > G.game.day ? '商船停靠，可交易' : b.workers.length ? '等待商船，商人按目标搬运备货' : '等待商人岗位分配';
    if (b.type === 'pasture') return !b.animals ? '空牧场：贸易买羊后放入' : b.animals < 2 ? '需至少 2 只羊才能繁殖' : b.workers.length ? '羊群饲养中' : '等待牧人照料';
    if (b.type === 'orchard') {
      if (!(G.game.unlocks && G.game.unlocks.orchard)) return '需从贸易站购买果树种子';
      if ((b.orchardAge || 0) < G.YEAR_DAYS * 4) return '幼树养护中，约 4 年成熟';
      return G.game.season === 2 ? b.orchardYield > 0 ? '秋季收获中' : '本季果实已收完' : '果树已成熟，等待秋季';
    }
    return '';
  },

  economyInfoMarkup: function (b) {
    if (b.type === 'tradingpost' && G.TRADE_VALUES && G.TRADE_GOODS && G.setTradeTarget && G.executeTrade) {
      const payments = Object.keys(G.TRADE_VALUES).map(type => `<option value="${type}"${type === 'firewood' ? ' selected' : ''}>${G.RES[type].name}（价值 ${G.TRADE_VALUES[type]}）</option>`).join('');
      const goods = Object.keys(G.TRADE_GOODS).map(type => `<option value="${type}">${this.escHtml(G.TRADE_GOODS[type].name)}（单价 ${G.TRADE_GOODS[type].price}）</option>`).join('');
      return `<section class="economy-details" data-economy="tradingpost">
        <p class="row" data-economy-live="merchant"></p><p class="row" data-economy-live="trade-capacity"></p>
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
          <p class="desc">付款数量向上取整，不找零。买入普通物资先进入本站库存，低于现存数量的待售目标会让商人搬回；羊购入后去牧场放入，果树种子购买一次永久解锁。</p>
        </form>
        <p class="economy-message" data-economy-message role="status" aria-live="polite"></p>
      </section>`;
    }
    if (b.type === 'pasture' && G.stockPasture && G.setPastureTarget) return `<section class="economy-details" data-economy="pasture">
      <p class="row" data-economy-live="animals"></p><p class="row" data-economy-live="pasture-production"></p>
      <form id="pasture-stock-form" class="economy-form"><h3>放入购入的羊</h3><p data-economy-live="sheep-bank"></p>
        <label for="pasture-stock-quantity">放入数量</label><input id="pasture-stock-quantity" type="number" min="1" max="12" step="1" value="2" inputmode="numeric"><button type="submit" id="pasture-stock">放入牧场</button></form>
      <form id="pasture-target-form" class="economy-form"><h3>羊群保留数量</h3><label for="pasture-target-quantity">保留 2–12 只</label><input id="pasture-target-quantity" type="number" min="2" max="12" step="1" value="${Number(b.animalTarget) || 8}" inputmode="numeric"><button type="submit">应用保留数量</button>
        <p class="desc">至少两只且有人照料才会繁殖。超过保留数量的羊由牧人屠宰产肉，羊毛需剪取并送仓。</p></form>
      <p class="economy-message" data-economy-message role="status" aria-live="polite"></p>
    </section>`;
    if (b.type === 'orchard') return `<section class="economy-details" data-economy="orchard"><p data-economy-live="orchard-age"></p><p data-economy-live="orchard-harvest"></p><p class="desc">种子永久解锁后，工人照料幼树约 4 年才结果。秋季采收，果实归入蔬菜；冬季未收果实损失。</p></section>`;
    return '';
  },

  initEconomyInfo: function (b) {
    const el = this.el.info, w = G.world;
    if (!el.querySelector || !el.querySelector('[data-economy]')) return;
    const valid = () => G.world === w && G.sel && G.sel.kind === 'b' && G.sel.id === b.id && w.bmap[b.id] === b && b.state === 'ok';
    const message = text => { const node = el.querySelector('[data-economy-message]'); if (node) node.textContent = text; };
    const onSubmit = (id, callback) => {
      const form = document.getElementById(id); if (form) form.addEventListener('submit', e => { e.preventDefault(); if (!valid() || (G.hasOpenModal && G.hasOpenModal())) return; callback(); this.refreshEconomyInfo(b); });
    };
    if (b.type === 'tradingpost') {
      const target = document.getElementById('trade-target-resource'), quantity = document.getElementById('trade-target-quantity');
      target.addEventListener('change', () => { if (!valid()) return; quantity.value = Number(b.tradeTargets && b.tradeTargets[target.value]) || 0; this.refreshEconomyInfo(b); });
      onSubmit('trade-target-form', () => {
        const qty = quantity.value.trim() === '' ? NaN : Number(quantity.value);
        message(G.setTradeTarget(b, target.value, qty) ? `${G.RES[target.value].name}待售目标已设为 ${qty}，由商人搬运。` : '请输入 0–2000 的整数。');
      });
      document.getElementById('trade-return-stock').addEventListener('click', () => {
        if (!valid() || (G.hasOpenModal && G.hasOpenModal())) return;
        if (G.setTradeTarget(b, target.value, 0)) { quantity.value = '0'; message(`${G.RES[target.value].name}目标已设为 0，商人会把本站余货搬回仓库。`); }
        this.refreshEconomyInfo(b);
      });
      for (const id of ['trade-good', 'trade-buy-quantity', 'trade-payment']) document.getElementById(id).addEventListener('input', () => { if (valid()) this.refreshEconomyInfo(b); });
      onSubmit('trade-exchange-form', () => {
        const quote = this.tradeQuote(b);
        if (!quote.ok) { message(quote.reason); return; }
        const result = G.executeTrade(b, quote.good, quote.qty, quote.payment);
        message(result.ok ? `已购买${G.TRADE_GOODS[quote.good].name} × ${quote.qty}，支付${G.RES[quote.payment].name} × ${result.paid}。${quote.good === 'sheep' ? '到羊牧场放入羊群。' : quote.good === 'orchardSeed' ? '所有果园已永久解锁种植。' : '物资已到本站，等待商人按目标搬回仓库。'}` : result.reason || '交易未完成。');
        this.refreshHUD();
      });
    }
    if (b.type === 'pasture') {
      onSubmit('pasture-stock-form', () => {
        const qty = Number(document.getElementById('pasture-stock-quantity').value);
        message(G.stockPasture(b, qty) ? `已放入 ${qty} 只羊。` : '无法放入：请检查整数数量、已购羊数及牧场 12 只容量。');
      });
      onSubmit('pasture-target-form', () => {
        const qty = Number(document.getElementById('pasture-target-quantity').value);
        message(G.setPastureTarget(b, qty) ? `保留数量已设为 ${qty} 只，超出部分由牧人屠宰。` : '请输入 2–12 的整数。');
      });
    }
    this.refreshEconomyInfo(b);
  },

  tradeQuote: function (b) {
    const goodEl = document.getElementById('trade-good'), quantity = document.getElementById('trade-buy-quantity'), paymentEl = document.getElementById('trade-payment');
    if (!goodEl || !quantity || !paymentEl) return { ok: false, reason: '请选择交易内容。' };
    const good = goodEl.value, payment = paymentEl.value, qty = Number(quantity.value), offer = G.TRADE_GOODS[good], value = G.TRADE_VALUES[payment];
    if (!offer || !value || !Number.isInteger(qty) || qty <= 0) return { ok: false, reason: '请输入正整数购买数量。' };
    const cost = Math.ceil(offer.price * qty / value), available = b.tradeInventory && b.tradeInventory[payment] || 0;
    const merchant = b.merchant && b.merchant.leaveDay > G.game.day;
    const stock = merchant ? b.merchant.stock[good] || 0 : 0;
    let reason = !merchant ? '商船尚未停靠。' : good === 'orchardSeed' && G.game.unlocks && G.game.unlocks.orchard ? '果树种子已永久解锁。' : qty > stock ? `商船只有 ${stock} 件，数量不足。` : available < cost ? `本站待售${G.RES[payment].name}不足，还需 ${Math.ceil(cost - available)}。` : '';
    if (!reason && good !== 'sheep' && good !== 'orchardSeed' && G.tradeStored && G.TRADE_CAPACITY && G.tradeStored(b) - cost + qty > G.TRADE_CAPACITY) reason = '交易后会超过本站共享容量，请先腾出空间。';
    const text = `购买${offer.name} × ${qty}，实际支付${G.RES[payment].name} × ${cost}（单价 ${offer.price}，付款价值 ${value}/件）。\n商船存货 ${stock} · 本站可支付 ${Math.floor(available)}。` + (reason ? '\n' + reason : '');
    return { ok: !reason, good, payment, qty, cost, reason, text };
  },

  refreshEconomyInfo: function (b) {
    const el = this.el.info;
    if (!['tradingpost', 'pasture', 'orchard'].includes(b.type) || b.state !== 'ok' || !el.querySelector || !el.querySelector(`[data-economy="${b.type}"]`)) return false;
    const set = (selector, text) => { const node = el.querySelector(selector); if (node && node.textContent !== text) node.textContent = text; };
    set('[data-economy-status]', this.economyStatus(b));
    set('[data-economy-goals]', G.buildingGoalStatus(b));
    set('[data-economy-workers]', b.workers.map(id => G.world.cmap[id]).filter(Boolean).map(c => c.name).join('、') || '无');
    if (b.type === 'tradingpost') {
      const merchant = b.merchant && b.merchant.leaveDay > G.game.day;
      set('[data-economy-live="merchant"]', merchant ? `商船将在 ${b.merchant.leaveDay - G.game.day} 天后离开。` : `下一艘商船约 ${Math.max(0, (b.nextMerchantDay || G.game.day) - G.game.day)} 天后到达。`);
      const inventory = b.tradeInventory || {}, targets = b.tradeTargets || {};
      const stored = G.tradeStored ? G.tradeStored(b) : Object.values(inventory).reduce((sum, value) => sum + value, 0);
      set('[data-economy-live="trade-capacity"]', `待售总量 ${Math.floor(stored)} / ${G.TRADE_CAPACITY || 2000}（各资源共享，货物价值用于以物易物）`);
      const lines = Object.keys(G.TRADE_VALUES).map(type => `${G.RES[type].name}：待售 ${Math.floor(inventory[type] || 0)} / 目标 ${targets[type] || 0}`);
      set('[data-economy-live="inventory"]', lines.join('\n'));
      const type = document.getElementById('trade-target-resource').value;
      set('[data-economy-live="target-stock"]', `全镇可用 ${Math.floor(G.game.res[type] || 0)} · 本站待售 ${Math.floor(inventory[type] || 0)} · 已应用目标 ${targets[type] || 0}`);
      const quote = this.tradeQuote(b);
      set('[data-economy-live="quote"]', quote.text || quote.reason);
      const buy = document.getElementById('trade-execute'); buy.disabled = !quote.ok;
      buy.textContent = quote.ok ? `确认支付 ${quote.cost} ${G.RES[quote.payment].name}` : '确认交易';
    } else if (b.type === 'pasture') {
      const bank = G.game.livestock && G.game.livestock.sheep || 0;
      set('[data-economy-live="animals"]', `羊群 ${b.animals || 0} / 12 只 · 当前保留 ${b.animalTarget || 8} 只`);
      set('[data-economy-live="pasture-production"]', `待剪羊毛 ${Math.floor(b.woolReady || 0)} · 下一只羊繁殖进度 ${Math.floor((b.animalGrowth || 0) * 100)}%`);
      set('[data-economy-live="sheep-bank"]', `已购入、待安置的羊：${bank} 只。`);
      document.getElementById('pasture-stock').disabled = bank <= 0 || b.animals >= 12;
    } else {
      const unlocked = G.game.unlocks && G.game.unlocks.orchard, age = b.orchardAge || 0;
      set('[data-economy-live="orchard-age"]', `果树种子：${unlocked ? '已永久解锁' : '尚未购买'} · 已养护 ${(age / G.YEAR_DAYS).toFixed(1)} / 4 年`);
      set('[data-economy-live="orchard-harvest"]', age < G.YEAR_DAYS * 4 ? `尚需 ${G.YEAR_DAYS * 4 - age} 天有效照料才成熟。` : `本季待采果实 ${Math.floor(b.orchardYield || 0)}（计入蔬菜，搬运后才入库）。`);
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
    const cap = G.storageCap();
    for (const type of G.RES_KEYS) {
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
  const cap = G.storageCap();
  for (const i of rocks) if (G.game.res[w.rock[i] === 2 ? 'iron' : 'stone'] >= cap) h.blockedMineralMarks++;
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
      if (G.isMineralCargo(c) && G.game.res[c.carry.type] >= cap && c.state !== 'haul') h.blockedMineralCarriers++;
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
  if (check.ok) {
    const route = G.storageRoute(x, y);
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
