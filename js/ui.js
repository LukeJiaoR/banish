'use strict';
/* ============================================================
 * ui.js —— HUD、建造菜单、信息面板、通知、存档界面
 * ============================================================ */

G.ui = {
  el: {},
  infoT: 0,

  init: function () {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), date: $('date'), pop: $('pop'),
      resRow: $('res-row'), speed: $('speed'),
      toolbar: $('toolbar'), info: $('info'), toasts: $('toasts'),
      over: $('over'), overText: $('over-text'), help: $('help'),
    };

    // 资源栏
    this.el.resRow.innerHTML = G.RES_KEYS.map(k =>
      `<span class="res" id="res-${k}" title="${G.RES[k].name}">${G.RES[k].icon}<b>0</b>${k === 'food' ? '<i id="net-food"></i>' : ''}</span>`
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
        const v = btn.dataset.v;
        if (v === 'pause') G.game.paused = !G.game.paused;
        else { G.game.paused = false; G.game.speed = +v; }
        this.refreshHUD();
      });
    });

    // 建造菜单
    const toolTip = (t) => {
      if (t === 'demolish') return '拆除：点击建筑 / 树木 / 道路将其移除';
      const d = G.BDEF[t];
      const cost = Object.keys(d.cost).map(k => `${G.RES[k].icon}×${d.cost[k]}`).join(' ') || '免费';
      const jobs = d.jobs ? ` · 岗位×${d.jobs}` : '';
      return `${d.name}（${cost}${jobs}）— ${d.desc}`;
    };
    this.el.toolbar.innerHTML = G.TOOLBAR.map(t => {
      if (t === 'demolish')
        return `<button class="tb" data-tool="demolish" title="${toolTip(t)}"><span class="ic">🚫</span><span class="lb">拆除</span></button>`;
      if (t === 'fell')
        return `<button class="tb" data-tool="fell" title="标记砍伐（原版 Cut Down Trees）：点击或拖选树木做标记，无业散工前来砍倒；未受教育 2 原木、受教育 3 原木入库"><span class="ic">🪚</span><span class="lb">砍伐</span><span class="cost">免费</span></button>`;
      const d = G.BDEF[t];
      const cost = Object.keys(d.cost).map(k => `${G.RES[k].icon}${d.cost[k]}`).join(' ') || '免费';
      return `<button class="tb" data-tool="${t}" title="${toolTip(t)}"><span class="ic">${d.icon}</span><span class="lb">${d.name}</span><span class="cost">${cost}</span></button>`;
    }).join('');
    this.el.toolbar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.tool;
        const active = !!G.tool && (G.tool.kind === k || (G.tool.kind === 'build' && G.tool.type === k));
        G.setTool(active ? null : k); // 再点一次取消
      });
    });

    // 顶栏按钮
    document.getElementById('btn-save').addEventListener('click', () => { G.saveGame(); });
    document.getElementById('btn-load').addEventListener('click', () => this.showSaves());
    document.getElementById('btn-new').addEventListener('click', () => { if (confirm('放弃当前进度，开创新家园？')) G.newGame(); });
    document.getElementById('btn-help').addEventListener('click', () => this.toggleHelp());
    document.getElementById('btn-err').addEventListener('click', () => this.showErrs());
    document.getElementById('errs-close').addEventListener('click', () => document.getElementById('errs').classList.add('hidden'));
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
    for (const k of G.RES_KEYS) {
      const el = document.getElementById('res-' + k);
      if (el) el.querySelector('b').textContent = Math.floor(g.res[k]);
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

  /* ---------- 信息面板 ---------- */
  showInfo: function (sel) {
    this.el.info.classList.remove('hidden');
    this.renderInfo();
  },
  hideInfo: function () {
    G.sel = null;
    this.el.info.classList.add('hidden');
  },
  renderInfo: function () {
    if (!G.sel) return;
    const w = G.world, el = this.el.info;
    if (G.sel.kind === 'b') {
      const b = w.bmap[G.sel.id];
      if (!b) { this.hideInfo(); return; }
      const def = G.BDEF[b.type];
      let status;
      if (b.state === 'site') status = `建造中 ${Math.floor(b.progress * 100)}%`;
      else if (b.type === 'house' || b.type === 'stonehouse') status = b.family != null ? '有人居住' : '空置';
      else if (b.type === 'boarding') status = `入住 ${G.boardingFamilies(w, b).length} / ${G.LIFE.boardingCap} 家`;
      else if (b.type === 'farm') {
        status = !b.sownAll ? '待播种（春）' : b.growth < 1 ? `生长中 ${Math.floor(b.growth * 100)}%` : (b.harvestDone ? '已收获' : '待收获（秋）');
      } else if (b.type === 'woodcutter' && G.fuelLimited(b)) {
        status = '停工：柴火已达上限';
      } else status = b.noWork ? `停工：${b.warnText || '无法工作'}` : '运作中';
      let workers = '';
      if (def.jobs > 0 || b.state === 'site') {
        const names = b.workers.map(id => w.cmap[id]).filter(Boolean).map(c => c.name).join('、');
        workers = `<div class="row">工人：<span>${names || (b.state === 'site' ? '等待建筑工人' : '无')}</span></div>`;
      }
      let extra = '';
      if ((b.type === 'house' || b.type === 'stonehouse') && b.family != null) {
        const fam = w.families.find(f => f.id === b.family);
        if (fam) extra = `<div class="row">住户：${fam.members.map(id => w.cmap[id]).filter(Boolean).map(c => `${c.name}(${Math.floor(c.age)}岁)`).join('、')}</div>`;
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
      if (b.type === 'woodcutter') { // 燃料上限（原版 Fuel Limit）：柴火库存达到上限即停产
        extra = `<div class="row tog-row">
          <span>燃料上限：<b>${G.fuelLimitOf(b)}</b>（库存 ${Math.floor(G.game.res.firewood)}）</span>
          <button class="mini-tog" data-fl="-50" title="降低上限 50">−</button>
          <button class="mini-tog" data-fl="50" title="提高上限 50">＋</button>
        </div>`;
      }
      el.innerHTML = `
        <div class="info-head"><span>${def.icon} ${def.name}</span><button id="info-close">✕</button></div>
        <div class="row">${status}</div>
        ${workers}${extra}
        <div class="row desc">${def.desc}</div>
        <button id="info-demolish" class="danger">拆除</button>`;
    } else {
      const c = w.cmap[G.sel.id];
      if (!c) { this.hideInfo(); return; }
      let status = '闲逛';
      if (c.state === 'rest') status = '睡觉';
      else if (c.state === 'work') status = c.task ? (c.task.kind === 'build' ? '建造中' : c.task.kind === 'sow' ? '播种' : c.task.kind === 'harvest' ? '收获' : '工作中') : '工作中';
      else if (c.state === 'walk' || c.state === 'haul') status = c.carry ? `搬运${G.RES[c.carry.type].name}` : (c.walkKind === 'home' ? '回家' : '赶路');
      const jobB = c.job != null ? w.bmap[c.job] : null;
      const jobName = jobB ? G.BDEF[jobB.type].name : (c.student ? '学堂学生' : (c.adult ? '无业' : '儿童'));
      const fam = G.familyOf(c);
      el.innerHTML = `
        <div class="info-head"><span>🧑 ${c.name}</span><button id="info-close">✕</button></div>
        <div class="row">${c.sex === 'm' ? '男' : '女'} · ${Math.floor(c.age)} 岁 · ${c.student ? '学生' : c.adult ? '成人' : '儿童'}</div>
        <div class="row">职业：${jobName} · ${status}</div>
        <div class="row">家庭：${fam ? (fam.houseId != null ? '有房' : '无房') : '单身'}</div>
        <div class="row">学识：${c.student ? '🎓 就读中' : c.educated ? '📖 受过教育' : '未受教育'}</div>
        <div class="row">饥饿 ${'▕'.repeat(Math.min(4, c.hunger)) || '无'} · 受冻 ${c.cold > 1 ? '是' : '无'}</div>`;
    }
    document.getElementById('info-close').addEventListener('click', () => this.hideInfo());
    el.querySelectorAll('.mini-tog').forEach(btn => btn.addEventListener('click', () => {
      const bb = w.bmap[G.sel.id];
      if (!bb) return;
      if (btn.dataset.fl) { // 伐木屋燃料上限 ±50
        const P = G.PROD.woodcutter;
        bb.fuelLimit = G.clamp(G.fuelLimitOf(bb) + Number(btn.dataset.fl), 0, P.fuelMax);
        bb.noWork = false; // 清掉停工标记，下次派活时按新上限重新评估
        this.renderInfo();
        return;
      }
      bb[btn.dataset.k] = !bb[btn.dataset.k];
      bb.noWork = false;
      this.renderInfo();
    }));
    const dem = document.getElementById('info-demolish');
    if (dem) dem.addEventListener('click', () => {
      const b = w.bmap[G.sel.id];
      if (b) G.removeBuilding(b);
    });
  },
  /* 定时刷新打开的面板 */
  tickInfo: function (dt) {
    if (G.sel && !this.el.info.classList.contains('hidden')) {
      this.infoT -= dt;
      if (this.infoT <= 0) { this.infoT = 0.5; this.renderInfo(); }
    }
  },

  toggleHelp: function (force) {
    const h = this.el.help;
    const show = force !== undefined ? force : h.classList.contains('hidden');
    h.classList.toggle('hidden', !show);
  },

  /* ---------- 错误记录面板（window.__errs，index.html 注入） ---------- */
  showErrs: function () {
    document.getElementById('err-list').textContent =
      window.__errs.length ? window.__errs.join('\n') : '（当前没有记录到脚本错误）';
    document.getElementById('errs').classList.remove('hidden');
  },

  /* ---------- 存档管理面板 ---------- */
  SLOTS: [
    { key: G.SAVE_KEY, name: '手动档' },
    { key: G.AUTOSAVE_KEY, name: '自动档' },
  ],
  showSaves: function () {
    // 打开面板时暂停，关闭时恢复
    this._resumePaused = G.game.paused;
    G.game.paused = true;
    document.getElementById('saves').classList.remove('hidden');
    this.renderSaves();
  },
  closeSaves: function () {
    document.getElementById('saves').classList.add('hidden');
    if (!G.game.over) G.game.paused = !!this._resumePaused;
    G.ui.refreshHUD();
  },
  readSave: function (key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  },
  saveTimeStr: function (d) {
    if (!d || !d.savedAt) return '存档时间未知';
    const t = new Date(d.savedAt);
    const pad = (n) => (n < 10 ? '0' : '') + n;
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  },
  saveGameStr: function (d) {
    if (!d || !d.game) return '';
    const g = d.game;
    const pop = d.citizens ? d.citizens.length : 0;
    return `第 ${g.year} 年·${G.SEASON_NAMES[g.season]} 第 ${(g.day % G.SEASON_DAYS) + 1} 天 · 人口 ${pop} · 食物 ${Math.floor(g.res.food)}`;
  },
  renderSaves: function () {
    const list = document.getElementById('save-list');
    document.getElementById('saves-hint').textContent =
      '自动档在每个季节更替、每 90 秒、离开页面时自动写入；打开游戏时自动恢复自动档。';
    let html = '';
    let any = false;
    for (const slot of this.SLOTS) {
      const d = this.readSave(slot.key);
      if (d) {
        any = true;
        html += `<div class="save-row">
          <span class="sav-name">${slot.name}</span>
          <span class="sav-info">${this.saveTimeStr(d)}<small>${this.saveGameStr(d)}</small></span>
          <button data-act="load" data-key="${slot.key}">载入</button>
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
    list.innerHTML = html;
    list.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (btn.dataset.act === 'load') {
          this.closeSaves();
          G.loadGame(key);
        } else if (btn.dataset.act === 'del') {
          localStorage.removeItem(key);
          this.renderSaves();
        }
      });
    });
    // 全部清空（至少有一个存档时才显示）
    const clearBtn = document.getElementById('saves-clear');
    clearBtn.classList.toggle('hidden', !any);
    clearBtn.onclick = () => {
      if (!confirm('确定清空全部存档（手动档 + 自动档）？\n当前对局不受影响，但刷新后将无法恢复进度。')) return;
      for (const slot of this.SLOTS) localStorage.removeItem(slot.key);
      G.ui.toast('🗑 已清空全部存档', 'warn');
      this.renderSaves();
    };
    document.getElementById('save-now').onclick = () => {
      G.saveGame(G.SAVE_KEY);
      this.renderSaves();
    };
  },

  gameOver: function () {
    const g = G.game;
    localStorage.removeItem(G.AUTOSAVE_KEY); // 死档不自动恢复，下次启动开新局
    this.el.overText.innerHTML =
      `你的小镇在<strong>第 ${g.year} 年</strong>消亡了。<br><br>` +
      `存续 ${Math.floor(g.day / G.SEASON_DAYS)} 个季度 · 出生 ${g.stats.born} 人 · 死亡 ${g.stats.died} 人<br>` +
      (Object.keys(g.stats.deadReasons).map(k => `${k} ×${g.stats.deadReasons[k]}`).join(' · '));
    this.el.over.classList.remove('hidden');
  },
};
