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
    return `<span class="res-icon" role="img" aria-label="${r.name}" title="${r.name}"><span aria-hidden="true">${r.icon}</span><img src="assets/icons/${r.iconAsset}.png" alt="" onerror="this.remove()"></span>`;
  },

  resourceCost: function (cost, html) {
    return Object.keys(cost).map(type => html
      ? `<span class="res-cost">${this.resourceIcon(type)}<span>${cost[type]}</span></span>`
      : `${G.RES[type].name}×${cost[type]}`).join(' ') || '免费';
  },

  // Read-only citizen feedback. Idle is a scheduler state, not proof of a deadlock.
  citizenStatus: function (c) {
    const b = c.job != null ? G.world.bmap[c.job] : null;
    if (c.state === 'rest') {
      if (G.citizenIndoorHome && G.citizenIndoorHome(c)) return '屋内休息';
      return G.homeOf(c) ? '户外休息（未入屋）' : '露宿（无住房）';
    }
    if (c.state === 'work') {
      const labels = { clearSite: '清理工地', chop: '砍伐', clearrock: '清矿', build: '建造中', sow: '播种', harvest: '收获', plant: '补种', firewood: '加工柴火' };
      return c.task ? (labels[c.task.kind] || '工作中') : '等待下一项任务';
    }
    if (c.state === 'walk' || c.state === 'haul') {
      if (c.carry) return `搬运${G.RES[c.carry.type].name}（${c.state === 'haul' ? '送仓' : '途中'}）`;
      if (c.walkKind === 'home') return '回家途中';
      if (c.walkKind === 'wander') return '闲逛';
      if (c.task && c.task.kind === 'firewood' && c.task.phase === 'fetch') return '前往仓库取原木';
      return '前往工作点';
    }
    if (c.carry) return '等待送仓（需可达仓库）';
    if (c.student) return '就读中';
    if (!b) return c.age >= G.ADULT_AGE ? '散工待命' : '玩耍休息';
    if (b.state === 'site') return '等待下一项施工任务';
    if (b.type === 'school') return '教学中';
    if (G.productionLimited(b) && G.buildingGoalStatus(b)) return G.buildingGoalStatus(b);
    if (G.fuelLimited(b)) return '暂停生产（柴火已达目标）';
    if (G.toolLimited(b)) return '暂停生产（工具已达目标）';
    if (b.type === 'woodcutter' && G.game.res.wood < G.PROD.woodcutter.logsIn) return '等待原木';
    if (b.type === 'blacksmith' && !G.jobCanProduce(b)) return '等待铁或原木';
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
    this.el.resRow.innerHTML = G.RES_KEYS.map(k =>
      `<span class="res" id="res-${k}" title="${G.RES[k].name}">${this.resourceIcon(k)}<b>0</b>${k === 'food' ? '<i id="net-food"></i>' : ''}</span>`
    ).join('');

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

    // 建造菜单（有切图图标的工具把精灵图叠在 emoji 上，图加载失败自动回退 emoji）
    const TOOL_ICONS = {
      stonehouse: 'tool_stonehouse', boarding: 'tool_boarding', mine: 'tool_mine',
      blacksmith: 'tool_blacksmith', hunting: 'tool_hunting',
      house: 'tool_house', storage: 'tool_storage', gatherer: 'tool_gatherer',
      forester: 'tool_forester', woodcutter: 'tool_woodcutter', dock: 'tool_dock',
      school: 'tool_school', farm: 'tool_farm', road: 'tool_road', demolish: 'tool_demolish',
    };
    const icImg = (n) => n ? `<img class="icimg" src="assets/icons/${n}.png" alt="" onerror="this.remove()">` : '';
    const toolTip = (t) => {
      if (t === 'demolish') return '拆除：点击建筑或道路移除；树木请用砍伐，岩石和铁矿请用采石采铁';
      if (t === 'quarry') return '采石采铁：点击或拖拽沿线标记矿石；灰色岩石产石头，锈色铁矿产铁，散工开采后搬运入库';
      const d = G.BDEF[t];
      const cost = this.resourceCost(d.cost, false);
      const jobs = d.jobs ? ` · 岗位×${d.jobs}` : '';
      return `${d.name}（${cost}${jobs}）— ${d.desc}`;
    };
    this.el.toolbar.innerHTML = G.TOOLBAR.map(t => {
      if (t === 'demolish')
        return `<button class="tb" data-tool="demolish" title="${toolTip(t)}"><span class="ic">🚫${icImg(TOOL_ICONS.demolish)}</span><span class="lb">拆除</span></button>`;
      if (t === 'quarry')
        return `<button class="tb" data-tool="quarry" title="${toolTip(t)}"><span class="ic" aria-hidden="true">⛏</span><span class="lb">采石采铁</span><span class="cost">灰石 · 锈铁</span></button>`;
      if (t === 'fell')
        return `<button class="tb" data-tool="fell" title="标记砍伐：点击或拖拽沿线标记树木，散工前来砍倒再搬运入库；未受教育 2 原木、受教育 3 原木"><span class="ic">🪚</span><span class="lb">砍伐</span><span class="cost">免费</span></button>`;
      const d = G.BDEF[t];
      const cost = this.resourceCost(d.cost, true);
      return `<button class="tb" data-tool="${t}" title="${toolTip(t)}"><span class="ic">${d.icon}${icImg(TOOL_ICONS[t])}</span><span class="lb">${d.name}</span><span class="cost">${cost}</span></button>`;
    }).join('');
    this.el.toolbar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (G.hasOpenModal && G.hasOpenModal()) return;
        const k = btn.dataset.tool;
        const active = !!G.tool && (G.tool.kind === k || (G.tool.kind === 'build' && G.tool.type === k));
        G.setTool(active ? null : k); // 再点一次取消
      });
    });
    this.initHarvestControls();
    this.initProductionGoals();

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
  },

  setToolActive: function () {
    this.el.toolbar.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
    if (G.tool) {
      const t = G.tool.kind === 'build' ? G.tool.type : G.tool.kind;
      const btn = this.el.toolbar.querySelector(`[data-tool="${t}"]`);
      if (btn) btn.classList.add('active');
    }
    this.refreshHarvestControls();
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
        const tool = G.tool ? (G.tool.kind === 'build' ? G.tool.type : G.tool.kind) : this._harvestTool;
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
    for (const k of G.RES_KEYS) {
      const el = document.getElementById('res-' + k);
      if (el) {
        el.querySelector('b').textContent = Math.floor(g.res[k]);
        const cap = G.storageCap();
        el.title = `${G.RES[k].name}：${Math.floor(g.res[k])}${k === 'tools' ? '（工具不限仓储）' : ' / ' + cap}`;
        if (hauling.carry[k]) el.title += ` · 另有 ${hauling.carry[k]} 随身待入库（尚不可用）`;
        if (k === 'food' && G.world.citizens.length) el.title += ` · 可供 ${(g.res.food / (G.world.citizens.length * G.LIFE.eatPerDay)).toFixed(1)} 天（不计新产出）`;
        if (k === 'tools') {
          const adults = G.world.citizens.filter(c => c.adult).length;
          if (adults) el.title += ` · 当前成人约可用 ${Math.floor(g.res.tools * G.LIFE.toolLifeDays / adults)} 天；铁匠需木材与铁矿`;
        }
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
      (homeless ? ` <span class="warn-txt">无房${homeless}家</span>` : '');
    const errBtn = document.getElementById('btn-err');
    if (errBtn) errBtn.classList.toggle('hidden', !window.__errs.length);
    this.el.speed.querySelectorAll('button').forEach(btn => {
      const v = btn.dataset.v;
      btn.classList.toggle('active', v === 'pause' ? g.paused : (!g.paused && g.speed === +v));
    });
  },

  refreshGuide: function () {
    const el = this.el.guide;
    if (!el || !G.world) return;
    const g = G.game, w = G.world;
    const days = w.citizens.length ? g.res.food / (w.citizens.length * G.LIFE.eatPerDay) : 0;
    const untilWinter = (G.SEASON_DAYS * 3 - g.day % G.YEAR_DAYS + G.YEAR_DAYS) % G.YEAR_DAYS;
    const food = w.buildings.some(b => ['gatherer', 'dock'].includes(b.type) && b.state === 'ok');
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
      : '④ 维持粮柴与工具，预留矿井的10铁保持续矿源，再办学并为下一代留空房。';
    const progress = harvest.total ? `\n采运标记：待领 ${harvest.queued} · 执行 ${harvest.active} · 夜间保留 ${harvest.paused}${harvest.reason ? '；' + harvest.reason : ''}` : '';
    el.textContent = (G.autosaveBlocked ? '⚠ 原自动档已保护：临时局不自动保存，请打开存档管理备份/手动保存。\n' : '') + `粮食约 ${days.toFixed(1)} 天（不计新产出） · ${G.isWinter() ? '寒冬中' : '距入冬 ' + untilWinter + ' 天'} · ${g.paused ? '已暂停' : '运行中'}\n${stage}${risks.length ? '\n⚠ ' + risks.join(' ') : ''}${progress}`;
  },

  refreshHarvest: function () {
    if (this.refreshHarvestControls) this.refreshHarvestControls();
    const el = this.el.placement;
    if (!el || !G.world) return;
    this._placementKey = null;
    const h = G.harvestFeedback(), fell = G.tool.kind === 'fell';
    const cargo = G.RES_KEYS.filter(k => h.carry[k]).map(k => `${G.RES[k].name} ${h.carry[k]}`).join(' · ');
    const lines = [fell ? '砍伐：点击或拖拽沿线标记树木' : '采石采铁：点击或拖拽沿线标记；灰色岩石产石头，锈色铁矿产铁',
      `标记：树 ${h.trees} · 矿 ${h.rocks}；待领 ${h.queued} · 执行 ${h.active}（含赶路） · 夜间保留 ${h.paused}`,
      `散工 ${h.laborers} 人（含执行、搬运）；每 2 游戏小时自动调度。`];
    if (!fell) {
      const { tx, ty } = G.hover, w = G.world;
      const mineral = tx >= 0 && ty >= 0 && tx < w.N && ty < w.N ? w.rock[ty * w.N + tx] : 0;
      if (mineral) lines.push(`指向：${mineral === 2 ? '铁矿 → 铁' : '岩石 → 石头'}；开采后搬运入库。`);
      else lines.push('指向地块没有可采矿石；本工具只标记岩石和铁矿。');
    }
    if (cargo) lines.push(`随身待入库：${cargo}；搬运 ${h.haulers} 人 / 待送 ${h.waitingCarriers} 人（不计入库存）。`);
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
  renderInfo: function (force) {
    if (!G.sel) return;
    const w = G.world, el = this.el.info;
    // Keep a keyboard user's active control stable across timed refreshes.
    const active = document.activeElement;
    const hadFocus = active && el.contains && el.contains(active);
    const selected = G.sel.kind === 'b' ? w.bmap[G.sel.id] : w.cmap[G.sel.id];
    if (!selected) { this.hideInfo(); return; }
    const sameSelection = this._infoWorld === w && this._infoSelection === selected;
    // Update only fuel text, never replace this panel's focused buttons. A new
    // selection or a site finishing construction still gets its own full panel.
    if (sameSelection && selected.type === 'woodcutter' && this._fuelInfoState === selected.state && this.refreshFuelInfo(selected)) return;
    if (hadFocus && !force && sameSelection && selected.type !== 'woodcutter' && this._infoBuildState === selected.state) {
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
    this._infoSelection = selected;
    this._infoBuildState = selected.state;
    if (G.sel.kind === 'b') {
      const b = w.bmap[G.sel.id];
      if (!b) { this.hideInfo(); return; }
      const def = G.BDEF[b.type];
      const fuelData = b.type === 'woodcutter' ? this.fuelInfoData(b) : null;
      const siteData = b.state === 'site' ? this.siteInfoData(b) : null;
      let status;
      if (fuelData) status = fuelData.status;
      else if (siteData) status = siteData.status;
      else if (G.productionLimited(b) && G.buildingGoalStatus(b)) status = G.buildingGoalStatus(b);
      else if (b.type === 'house' || b.type === 'stonehouse') status = b.family != null ? '有人居住' : '空置';
      else if (b.type === 'boarding') status = `入住 ${G.boardingFamilies(w, b).length} / ${G.LIFE.boardingCap} 家`;
      else if (b.type === 'farm') {
        status = !b.sownAll ? '待播种（春）' : b.growth < 1 ? `生长中 ${Math.floor(b.growth * 100)}%` : (b.harvestDone ? '已收获' : '待收获（秋）');
      } else if (G.toolLimited(b)) {
        status = '工具已达上限，暂停生产';
      } else if (def.jobs > 0 && !G.jobCanProduce(b)) {
        status = '停工：' + (b.type === 'blacksmith' ? '缺铁或木材' : b.type === 'woodcutter' ? '缺木材' : b.type === 'mine' ? '仓库已满' : '工作圈内暂无可用资源');
      } else status = (b.noWork || (b.warnText && !b.workers.length)) ? `停工：${b.warnText || '无法工作'}` : (def.jobs > 0 && !b.workers.length ? '等待可用工人' : '运作中');
      let workers = '';
      if (def.jobs > 0 || b.state === 'site') {
        const names = b.workers.map(id => w.cmap[id]).filter(Boolean).map(c => this.escHtml(c.name)).join('、');
        workers = `<div class="row">工人：<span${siteData ? ' data-site-workers' : ''}${fuelData ? ' data-fuel="workers"' : ''}>${names || (b.state === 'site' ? '等待建筑工人' : '无')}</span></div>`;
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
      if (b.type === 'blacksmith') {
        extra = `<div class="row tog-row">
          <span>工具上限：<b>${G.toolLimitOf(b)}</b>（库存 ${Math.floor(G.game.res.tools)}）</span>
          <button class="mini-tog" data-tl="-10" title="降低上限 10">−</button>
          <button class="mini-tog" data-tl="10" title="提高上限 10">＋</button>
        </div>`;
      }
      if (b.type !== 'woodcutter' && G.buildingGoalStatus(b)) extra += `<div class="row desc">${this.escHtml(G.buildingGoalStatus(b))}</div>`;
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
        <div class="row"${siteData ? ' data-site-status' : ''}${fuelData ? ' data-fuel="status"' : ''}>${this.escHtml(status)}</div>
        ${workers}${extra}
        <div class="row desc">${def.desc}</div>
        <div class="row desc" data-info-refund${fuelData ? ' data-fuel="refund"' : ''}>${fuelData ? fuelData.refund : siteData ? siteData.refund : '已开工：拆除退还一半已付建材，已砍树不恢复'}</div>
        <button id="info-demolish" class="danger">${b.state === 'site' ? '取消工地' : '拆除'}</button>`;
      if (fuelData) this._fuelInfoState = b.state;
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
        <div class="row">职业：${jobName} · ${this.escHtml(status)}</div>
        ${c.carry ? `<div class="row">随身：${G.RES[c.carry.type].name} ${Number(c.carry.qty)}（未入库）</div>` : ''}
        <div class="row">家庭：${fam ? (fam.houseId != null ? '有房' : '无房') : '单身'}</div>
        <div class="row">学识：${c.student ? '🎓 就读中' : c.educated ? '📖 受过教育' : '未受教育'}</div>
        <div class="row">饥饿 ${'▕'.repeat(Math.min(4, c.hunger)) || '无'} · 受冻 ${c.cold > 1 ? '是' : '无'}</div>`;
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
      const step = type === 'food' ? 100 : type === 'tools' ? 10 : 50;
      return `<section class="production-goal-row" aria-labelledby="goal-label-${type}">
        <label id="goal-label-${type}" for="goal-input-${type}">${this.resourceIcon(type)}${G.RES[type].name}</label>
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
      stock.textContent = `库存 ${Math.floor(G.game.res[type])} · 硬仓容 ${type === 'tools' ? '不限' : cap}`;
      status.textContent = target === null ? '未设置全镇目标，继承原规则' :
        `已应用目标 ${target} · ${target === 0 ? '关闭新自动生产' : `恢复线 ≤${G.productionResumeAt(target)} · ${G.goalPaused(type) ? '达标暂停' : '可生产'}`}`;
      if (target !== null && type !== 'tools' && target > cap) status.textContent += '；目标高于仓容，需扩建仓库；满仓交货仍可能损失';
      if (type === 'firewood' || type === 'tools') status.textContent += '；各屋原目标保留，实际按全镇与本屋较低值执行（见建筑详情）';
      if (type === 'food' && target !== null) status.textContent += '；已开始的整田继续播种和收获，过低目标可能断粮';
      if (type === 'firewood' && target !== null) status.textContent += '；过低目标可能挨冻';
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
    laborers: 0, haulers: 0, waitingCarriers: 0, carry: {}, reason: '' };
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
        else if (b && ['gatherer', 'hunting', 'dock', 'farm'].includes(b.type)) foodWorkers++;
        else otherWorkers++;
      }
    }
    if (c.carry && G.RES_KEYS.includes(c.carry.type) && Number.isFinite(c.carry.qty) && c.carry.qty > 0) {
      h.carry[c.carry.type] += c.carry.qty;
      if (c.state === 'haul') h.haulers++;
      else h.waitingCarriers++;
    }
  }
  for (const key of active) paused.delete(key);
  h.active = active.size; h.paused = paused.size;
  h.queued = Math.max(0, h.total - h.active - h.paused);
  if (h.total && G.isRestTime()) h.reason = '夜间休息，已认领任务天亮继续。';
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
    if (type === 'gatherer' || type === 'hunting') {
      const n = type === 'hunting' ? result.mature : result.trees;
      if (n < p.needTrees) { result.warning = true; lines.push(`⚠ 可建但当前无法生产：至少需 ${p.needTrees} 棵${type === 'hunting' ? '成熟' : ''}树`); }
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
