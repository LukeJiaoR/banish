'use strict';
// The primary entry keeps the game's existing saves and classic opening.
// Preview entries retain their own storage namespaces and authored villages.
window.addEventListener('DOMContentLoaded', async () => {
  const startup = document.getElementById('pixi-startup');
  try {
    const params = new URLSearchParams(location.search);
    const primary = !!window.BANISH_PIXI_PRIMARY;
    const classic = primary || params.get('start') === 'classic';
    const courtyard = !classic && params.get('scene') === 'courtyard';
    if (!primary) {
      const prefix = classic ? 'banish_pixi' : courtyard ? 'banish_pixi_courtyard' : 'banish_pixi_village';
      G.SAVE_KEY = prefix + '_save_v1';
      G.AUTOSAVE_KEY = prefix + '_autosave_v1';
      G.RECOVERY_SAVE_KEY = G.AUTOSAVE_KEY + '_recovery';
      G.serverSaves.available = false;
      G.probeServerSaves = () => { G.serverSaves.available = false; };
      G.saveToServer = G.loadFromServer = G.deleteServerSave = () => Promise.reject(new Error('PixiJS 独立版使用本机存档与文件导入导出'));
      G.deleteServerSaveQuiet = () => {};
    }
    G.pixi = await G.createPixiRenderer(document.getElementById('game'));
    await Promise.all([G.pixiArt.ready, G.pixiGround.ready, G.pixiFarms.ready]);
    let startingVillage = false;
    if (!classic && !localStorage.getItem(G.AUTOSAVE_KEY) && !window.__REPLAY_SAVE) {
      const response = await fetch('assets/pixi/' + (courtyard ? 'courtyard-village.json' : 'river-village.json'));
      if (!response.ok) throw new Error('样板村读取失败（HTTP ' + response.status + '）');
      G.initialSave = await response.json(); startingVillage = true;
    }
    G.init();
    if (!classic) {
      G.game.paused = true;
      G.cam.z = courtyard && innerWidth > 600 ? 1.4 : 1.1;
      const [x, y] = G.T2S(G.world.start.x, G.world.start.y);
      G.cam.x = innerWidth / 2 - x * G.cam.z;
      G.cam.y = innerHeight * (courtyard ? .50 : .57) - y * G.cam.z;
      G.ui.refreshHUD();
      if (startingVillage) G.ui.toast(courtyard ? '青玉 · 河畔院落：15位居民、土路与院落。点击右上角继续经营。' : '青玉 · 河湾村：15位居民、已建院落与农田。点击右上角继续经营。', 'good');
    }
    const edition = document.querySelector('#pixi-edition small');
    if (edition) edition.textContent = classic ? '经典开局 · 独立存档' : courtyard ? '河畔院落 · 独立存档' : '青玉样板村 · 独立存档';
    window.dispatchEvent(new Event('banish-ready'));
    startup.remove();
  } catch (error) {
    console.error(error);
    startup.setAttribute('role', 'alert');
    startup.querySelector('p').textContent = '启动失败：' + error.message + '。请刷新重试；详细原因可在浏览器控制台查看。';
  }
});
