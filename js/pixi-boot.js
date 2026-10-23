'use strict';
// A separate entry point and storage namespace: importing/exporting a file is
// the explicit way to transfer a town between Canvas and Pixi editions.
window.addEventListener('DOMContentLoaded', async () => {
  const startup = document.getElementById('pixi-startup');
  try {
    const classic = new URLSearchParams(location.search).get('start') === 'classic';
    const prefix = classic ? 'banish_pixi' : 'banish_pixi_village';
    G.SAVE_KEY = prefix + '_save_v1';
    G.AUTOSAVE_KEY = prefix + '_autosave_v1';
    G.RECOVERY_SAVE_KEY = G.AUTOSAVE_KEY + '_recovery';
    G.serverSaves.available = false;
    G.probeServerSaves = () => { G.serverSaves.available = false; };
    G.saveToServer = G.loadFromServer = G.deleteServerSave = () => Promise.reject(new Error('PixiJS 独立版使用本机存档与文件导入导出'));
    G.deleteServerSaveQuiet = () => {};
    G.pixi = await G.createPixiRenderer(document.getElementById('game'));
    await G.pixiArt.ready;
    let startingVillage = false;
    if (!classic && !localStorage.getItem(G.AUTOSAVE_KEY) && !window.__REPLAY_SAVE) {
      const response = await fetch('assets/pixi/river-village.json');
      if (!response.ok) throw new Error('样板村读取失败（HTTP ' + response.status + '）');
      G.initialSave = await response.json(); startingVillage = true;
    }
    G.init();
    if (!classic) {
      G.game.paused = true;
      G.cam.z = 1.1;
      const [x, y] = G.T2S(G.world.start.x, G.world.start.y);
      G.cam.x = innerWidth / 2 - x * G.cam.z;
      G.cam.y = innerHeight * .57 - y * G.cam.z;
      G.ui.refreshHUD();
      if (startingVillage) G.ui.toast('青玉 · 河湾村：15位居民、已建院落与农田。点击右上角继续经营。', 'good');
    }
    document.querySelector('#pixi-edition small').textContent = classic ? '经典开局 · 独立存档' : '青玉样板村 · 独立存档';
    window.dispatchEvent(new Event('banish-ready'));
    startup.remove();
  } catch (error) {
    console.error(error);
    startup.setAttribute('role', 'alert');
    startup.querySelector('p').textContent = '启动失败：' + error.message + '。请刷新重试；详细原因可在浏览器控制台查看。';
  }
});
