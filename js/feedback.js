'use strict';
/* ============================================================
 * feedback.js —— 匿名试玩反馈（无需注册）
 * 顶栏 📮 打开弹窗：一句话反馈 + 可选昵称 + 当前存档快照，
 * POST 到同源 api/feedback（server.py 落盘为 JSONL）。
 * file:// 或接口不可用时降级为复制文本发给开发者。
 * ============================================================ */

G.feedback = {
  PID_KEY: 'banish_pid_v1',
  NAME_KEY: 'banish_fb_name_v1',

  init: function () {
    document.getElementById('btn-fb').addEventListener('click', () => this.open());
    document.getElementById('fb-close').addEventListener('click', () => this.close());
    document.getElementById('fb-send').addEventListener('click', () => this.send());
    document.getElementById('fb-fallback-text').addEventListener('click', function () { this.select(); });
    let name = '';
    try { name = localStorage.getItem(this.NAME_KEY) || ''; } catch (e) {}
    document.getElementById('fb-name').value = name;
  },

  /* 稳定匿名 ID：首次反馈时生成，用于把同一玩家的多条反馈串起来，不含个人信息 */
  pid: function () {
    try {
      let v = localStorage.getItem(this.PID_KEY);
      if (!v) {
        v = 'p-' + Math.random().toString(16).slice(2, 10);
        localStorage.setItem(this.PID_KEY, v);
      }
      return v;
    } catch (e) { return 'p-anon'; }
  },

  open: function () {
    if (!G.world) return;
    const box = document.getElementById('fb');
    if (!box.classList.contains('hidden')) return;
    document.getElementById('fb-fallback').classList.add('hidden');
    const st = document.getElementById('fb-status');
    st.textContent = '';
    st.className = 'fb-status';
    document.getElementById('fb-send').disabled = false;
    this._resumePaused = G.game.paused;
    G.game.paused = true;
    box.classList.remove('hidden');
    document.getElementById('fb-text').focus();
  },

  close: function () {
    document.getElementById('fb').classList.add('hidden');
    if (!G.game.over) G.game.paused = !!this._resumePaused;
    G.ui.refreshHUD();
  },

  /* 当前对局进度摘要（不进存档，纯给开发者看） */
  progress: function () {
    if (!G.world || !G.game) return null;
    const g = G.game;
    return {
      year: g.year, season: G.SEASON_NAMES[g.season], day: g.day,
      pop: G.world.citizens.length,
      res: G.RES_KEYS.reduce((o, k) => (o[k] = Math.floor(g.res[k]), o), {}),
      foodNet: Math.round(g.foodNet || 0),
      born: g.stats.born, died: g.stats.died, over: !!g.over,
    };
  },

  payload: function () {
    let name = document.getElementById('fb-name').value.trim().slice(0, 20);
    try { localStorage.setItem(this.NAME_KEY, name); } catch (e) {}
    const p = {
      pid: this.pid(), name, text: document.getElementById('fb-text').value.trim().slice(0, 2000),
      t: Date.now(),
      ua: navigator.userAgent, lang: navigator.language,
      screen: window.innerWidth + 'x' + window.innerHeight,
      progress: this.progress(),
      save: null, errs: (window.__errs || []).slice(-20),
    };
    if (document.getElementById('fb-attach').checked && G.world) {
      try { p.save = G.serializeGame(); } catch (e) { p.saveErr = String((e && e.message) || e); }
    }
    let body = JSON.stringify(p);
    if (body.length > 700000) { p.save = null; p.saveDropped = true; body = JSON.stringify(p); }
    return body;
  },

  send: function () {
    const ta = document.getElementById('fb-text');
    const st = document.getElementById('fb-status');
    if (!ta.value.trim()) {
      st.textContent = '先写一句话吧：哪里不对劲？';
      st.className = 'fb-status err';
      ta.focus();
      return;
    }
    const btn = document.getElementById('fb-send');
    btn.disabled = true;
    st.textContent = '发送中…';
    st.className = 'fb-status';
    const body = this.payload();
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
    fetch('api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctl ? ctl.signal : undefined,
    }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(() => {
      if (timer) clearTimeout(timer);
      this.close();
      G.ui.toast('📮 反馈已发送，谢谢！', 'good');
    }).catch(() => {
      if (timer) clearTimeout(timer);
      btn.disabled = false;
      st.textContent = '发送失败（可能未通过服务器打开）。复制下面内容发给开发者即可：';
      st.className = 'fb-status err';
      document.getElementById('fb-fallback').classList.remove('hidden');
      document.getElementById('fb-fallback-text').value = body;
    });
  },
};
