'use strict';
// Presentation-only modes. Tools, construction rules and saves remain owned by the game.
window.addEventListener(window.BANISH_PIXI ? 'banish-ready' : 'DOMContentLoaded', () => {
  const ui = G.ui, hud = document.getElementById('hud');
  const toolbar = document.getElementById('toolbar');
  const dock = document.getElementById('town-dock');
  const build = document.getElementById('open-build');
  const manage = document.getElementById('open-town');
  const town = document.getElementById('town-controls');
  const close = document.getElementById('close-build');
  const pause = document.getElementById('quick-pause');
  let mode = 'explore';
  function setMode(next, restore = false) {
    mode = next;
    hud.dataset.mode = mode;
    toolbar.hidden = mode !== 'build';
    dock.hidden = mode === 'detail';
    build.setAttribute('aria-expanded', String(mode === 'build'));
    close.hidden = mode !== 'build';
    if (mode !== 'explore') toggleTown(false);
    if (restore) build.focus({preventScroll:true});
  }
  function toggleTown(open, restore = false) {
    town.hidden = !open;
    manage.setAttribute('aria-expanded', String(open));
    if (restore) manage.focus({preventScroll:true});
  }
  build.addEventListener('click', () => {
    if (G.hasOpenModal?.()) return;
    if (mode === 'build') { G.setTool(null); ui.backToCategories(); setMode('explore', true); }
    else { ui.hideInfo(); ui.backToCategories(); setMode('build'); toolbar.querySelector('[data-category]')?.focus({preventScroll:true}); }
  });
  close.addEventListener('click', () => {
    if (G.hasOpenModal?.()) return;
    G.setTool(null); ui.backToCategories(); setMode('explore', true);
  });
  manage.addEventListener('click', () => {
    if (G.hasOpenModal?.()) return;
    if (mode === 'build') { G.setTool(null); ui.backToCategories(); setMode('explore'); }
    toggleTown(town.hidden);
    if (!town.hidden) town.querySelector('button')?.focus({preventScroll:true});
  });
  document.getElementById('close-town').addEventListener('click', () => toggleTown(false, true));
  pause.addEventListener('click', () => {
    if (G.hasOpenModal?.()) return;
    G.game.paused = !G.game.paused;
    ui.refreshHUD();
  });
  // Preserve all existing event handlers while moving secondary controls out of the HUD.
  town.querySelector('.town-controls-body').append(document.getElementById('speed'), document.getElementById('sys'));
  for (const button of document.querySelectorAll('#sys button')) {
    const label = document.createElement('span');
    label.textContent = button.getAttribute('aria-label');
    button.append(label);
  }
  const originalShow = ui.showInfo;
  ui.showInfo = function (...args) {
    G.setTool(null);
    originalShow.apply(this, args);
    if (!this.el.info.classList.contains('hidden')) setMode('detail');
  };
  const originalHide = ui.hideInfo;
  ui.hideInfo = function (...args) {
    const hadFocus = this.el.info.contains(document.activeElement);
    originalHide.apply(this, args);
    if (mode === 'detail') setMode('explore', hadFocus);
  };
  const originalActive = ui.setToolActive;
  ui.setToolActive = function (...args) {
    originalActive.apply(this, args);
    if (G.tool) { this.hideInfo(); setMode('build'); }
    hud.classList.toggle('is-placing', !!G.tool);
  };
  const originalHUD = ui.refreshHUD;
  ui.refreshHUD = function (...args) {
    originalHUD.apply(this, args);
    pause.textContent = G.game.paused ? '▶ 继续' : 'Ⅱ 暂停';
    pause.setAttribute('aria-pressed', String(G.game.paused));
  };
  // Existing capture listeners handle resource/category levels first.
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.repeat || G.hasOpenModal?.() || G.isEditingTarget?.(e.target)) return;
    if (!town.hidden) { toggleTown(false, true); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (mode === 'build' && !G.tool && !ui.menuCategory) {
      setMode('explore', true); e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  setMode('explore');
  ui.refreshHUD();
});
