'use strict';
/* Contextual first-winter coach. Read-only observations; no simulation or save migrations. */
G.onboarding = (() => {
  const preferenceKey = 'banish-coach-dismissed-v1';
  const sessions = new WeakMap();
  let highlighted = null, initialized = false;
  const byId = id => document.getElementById(id);
  const session = () => {
    if (!G.world) return null;
    if (!sessions.has(G.world)) sessions.set(G.world, { active: false });
    return sessions.get(G.world);
  };
  const staffed = b => b.state === 'ok' && !b.sitePaused && (b.workers || []).some(id => {
    const c = G.world.cmap[id]; return c && !c.dead && c.job === b.id;
  }) && (!G.workerLimitOf || G.workerLimitOf(b) > 0);
  function toolStep(tool, category, text, detail, stage) {
    const active = G.tool && (G.tool.kind === tool || G.tool.kind === 'build' && G.tool.type === tool);
    if (active) return { stage, text, detail, target: ['fell', 'quarry'].includes(tool) ? '#harvest-confirm' : '#placement-info' };
    const build = byId('open-build');
    if (build && build.getAttribute('aria-expanded') !== 'true')
      return { stage, text: '点「建造」', detail, target: '#open-build' };
    if (G.ui.menuCategory !== category)
      return { stage, text: `选择「${{food:'食物生产',industry:'资源与加工',homes:'住房',land:'道路与采运'}[category]}」`, detail, target: `[data-category="${category}"]` };
    return { stage, text: `选择「${G.BDEF[tool]?.name || (tool === 'fell' ? '砍伐' : '采石采铁')}」`, detail, target: `[data-tool="${tool}"]` };
  }
  function buildingStep(b, stage) {
    const view = text => ({ stage, text, detail: '点「查看」检查现场；引导不会代你调岗或施工。', buildingId: b.id });
    if (b.state === 'site') {
      if (b.sitePaused) return view('工地已暂停：查看并恢复施工');
      const s = G.constructionSummary(b);
      const missing = s.materials.find(m => m.missing > (G.game.res[m.type] || 0));
      if (missing && ['wood','stone','iron'].includes(missing.type)) {
        const tool = missing.type === 'wood' ? 'fell' : 'quarry';
        const feedback = G.harvestFeedback();
        const pending = tool === 'fell' ? feedback.trees : [...(G.world.markedRocks || [])].filter(i => G.world.rock[i] === (missing.type === 'iron' ? 2 : 1)).length;
        if (!pending && !(feedback.carry?.[missing.type] > 0))
          return toolStep(tool, 'land', tool === 'fell' ? '框选食物林外的树，确认标记' : `框选${missing.type === 'iron' ? '锈色铁矿' : '灰色岩石'}，确认标记`, `工地已放好；补${G.RES[missing.type].name}，送到现场后才能施工。`, stage);
        if (G.game.paused) return { stage, text:'点「继续」，让工人采运', detail:'标记和随身货物仍在；送达才可用于施工。', target:'#quick-pause' };
        return view(`等待${G.RES[missing.type].name}采运；可查看工地`);
      }
      if (G.game.paused) return { stage, text: '点「继续」，让工人施工', detail: '工地已放好；材料到场、施工完成才算建成。', target: '#quick-pause' };
      return view(s.phase === 'clearing' ? '工人正清场，查看进度' : s.phase === 'materials' ? '等待建材送到工地' : '等待工人完成施工');
    }
    if (!staffed(b)) {
      if (G.game.paused) return { stage, text: '点「继续」，等待分配工人', detail: '建筑已完工；有工人接岗才推进。', target: '#quick-pause' };
      return view('查看建筑，检查用工与停工原因');
    }
    return null;
  }
  function next() {
    const w = G.world;
    if (!w || !G.game || G.game.over) return null;
    const foodTypes = ['gatherer','dock','hunting','farm','orchard','pasture'];
    const food = w.buildings.filter(b => foodTypes.includes(b.type) && ['site','ok'].includes(b.state) &&
      (b.type !== 'farm' || G.cropUnlocked(G.farmCropOf(b))));
    // A built, staffed orchard without fruit or pasture without animals is not a food source yet.
    const usableFood = b => staffed(b) && (b.type !== 'pasture' || (b.animals || 0) > 0) &&
      (b.type !== 'orchard' || (b.orchardTrees || []).some(t => t.planted && t.age >= G.ORCHARD.matureDays));
    if (!food.some(usableFood)) {
      const candidates = food.filter(b => ['gatherer','dock','hunting','farm'].includes(b.type));
      const b = candidates.find(b => b.state === 'ok') || candidates.find(b => !b.sitePaused) || candidates[0];
      return b ? buildingStep(b, '1 · 持续食物') : toolStep('gatherer','food','在近仓成熟森林旁放下采集小屋','先放工地；缺材料也可以规划。','1 · 持续食物');
    }
    const fuel = w.buildings.filter(b => b.type === 'woodcutter' && ['site','ok'].includes(b.state));
    if (!fuel.some(staffed)) return fuel.length ? buildingStep(fuel.find(b => b.state === 'ok') || fuel.find(b => !b.sitePaused) || fuel[0], '2 · 备柴') :
      toolStep('woodcutter','industry','在仓库附近放下伐木屋','原木运到伐木屋，才能劈成柴火。','2 · 备柴');
    const homeless = w.families.filter(f => f.members.some(id => w.cmap[id] && !w.cmap[id].dead) && f.houseId == null);
    if (homeless.length) {
      const site = w.buildings.find(b => ['house','stonehouse','boarding'].includes(b.type) && b.state === 'site');
      if (site) return buildingStep(site, '3 · 安家');
      const homes = w.buildings.filter(b => ['house','stonehouse','boarding'].includes(b.type) && b.state === 'ok');
      const vacant = homes.find(b => !b.houseFire && (b.type === 'boarding' ? G.boardingFamilies(w,b).length < G.LIFE.boardingCap : b.family == null));
      if (vacant && G.game.paused) return {stage:'3 · 安家',text:'点「继续」，等待家庭入住',detail:`还有 ${homeless.length} 家无房；已有空屋。`,target:'#quick-pause'};
      if (vacant)
        return { stage:'3 · 安家',text:'等待家庭入住；查看住房安排',detail:`还有 ${homeless.length} 家无房。`, buildingId:vacant.id };
      return toolStep('house','homes','在仓库附近放下一间木屋',`还有 ${homeless.length} 家无房；逐间补齐。`,'3 · 安家');
    }
    return { stage:'基础路线已建立', text:'食物、伐木和住房已安排', detail:'这不代表已安全过冬；继续留意生存清单。', complete:true };
  }
  function clearHighlight() {
    highlighted?.classList.remove('coach-target'); highlighted = null;
  }
  function refresh() {
    const panel = byId('dynamic-coach');
    if (!panel) return;
    const s = session();
    const visible = !!s?.active && !G.hasOpenModal?.() && !G.game?.over;
    panel.hidden = !visible; byId('survival-guide')?.classList.toggle('coach-running', visible); clearHighlight();
    if (!visible) return;
    const step = next();
    if (!step) { panel.hidden = true; return; }
    s.step = step;
    for (const [id, value] of [['coach-stage',step.stage],['coach-text',step.text],['coach-detail',step.detail]]) {
      const node = byId(id); if (node.textContent !== value) node.textContent = value;
    }
    const action = byId('coach-action');
    // Keep mounted controls and keyboard focus stable across every simulation refresh.
    action.textContent = step.complete ? '收起引导' : step.buildingId != null ? '查看' : '提示';
    byId('coach-skip').textContent = step.complete ? '以后再看' : '跳过引导';
    if (step.target && !G.isEditingTarget?.(document.activeElement)) {
      const target = document.querySelector(step.target);
      if (target && target.getClientRects().length) { highlighted = target; target.classList.add('coach-target'); }
    }
  }
  function start() { const s = session(); if (s) { s.active = true; refresh(); } }
  function dismiss() {
    const s = session(); if (s) s.active = false;
    try { localStorage.setItem(preferenceKey, '1'); } catch (_) { /* Session still dismisses. */ }
    clearHighlight(); refresh();
  }
  function newTown(options) {
    let dismissed = false;
    try { dismissed = localStorage.getItem(preferenceKey) === '1'; } catch (_) {}
    // Recovery/temporary worlds and loaded saves never auto-start a tutorial.
    if (!options?.preserveSaves && !dismissed) start();
  }
  function init() {
    if (initialized || !byId('dynamic-coach')) return;
    initialized = true;
    byId('coach-skip')?.addEventListener('click', dismiss);
    byId('coach-replay')?.addEventListener('click', () => { G.ui.toggleHelp(false); start(); });
    byId('coach-action')?.addEventListener('click', () => {
      if (G.hasOpenModal?.()) return;
      const step = next();
      if (step?.complete) return dismiss();
      if (step?.buildingId == null) { const detail=byId('coach-explanation'); if(detail) detail.open=!detail.open; return; }
      if (!G.world.bmap[step.buildingId]) return;
      G.sel = {kind:'b',id:step.buildingId}; G.ui.showInfo(G.sel);
    });
    refresh();
  }
  return { next, refresh, start, dismiss, newTown, init };
})();
