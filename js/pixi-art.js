'use strict';
// Art direction for the independent entry only. Shared source images, explicit
// source-space pivots and deterministic low props; no simulation or save edits.
G.A_ART = Object.freeze({ ...G.A_ART,
  'pixi-courtyard': { source: [1536, 1024], anchor: [800, 991], span: 1280 },
  'pixi-river-garden': { source: [1536, 1024], anchor: [780, 923], span: 1350 },
  'pixi-granary': { source: [1536, 1024], anchor: [788, 990], span: 1240 },
  'pixi-well': { source: [1536, 1024], anchor: [777, 938], span: 768 },
  'pixi-smithy': { source: [1536, 1024], anchor: [775, 945], span: 1360 },
  'pixi-house-empty': G.A_ART['house-a-v2-square-empty'],
  'pixi-house-occupied': G.A_ART['house-a-v2-square-occupied'],
});
// Painted roofs may overhang their logical plots; all four assets share a
// doorway/eave scale instead of making every sprite fill its entire canvas.
const villageArt = {
  house: { key: 'pixi-courtyard', file: 'courtyard-house-v2-matte.png', width: 144 },
  storage: { key: 'pixi-granary', file: 'granary-v2.png', width: 152 },
  well: { key: 'pixi-well', file: 'well-v2.png', width: 64 },
  blacksmith: { key: 'pixi-smithy', file: 'smithy-v2.png', width: 168 },
};
const smallHouseArt = {
  'house-a-v2-square-empty': { key: 'pixi-house-empty', file: 'house-square-v3-empty.png' },
  'house-a-v2-square-occupied': { key: 'pixi-house-occupied', file: 'house-square-v3-occupied.png' },
};
function plotArt(type, x, y, building) {
  // Reuse the existing small hip-roof dwelling for two of the starter plots.
  // The home/away variant still follows the actual household's presence.
  if (type === 'house' && (x + y) % 3 === 1) {
    const key = building ? G.houseArtName(building) : 'house-a-v2-square-empty';
    const matte = smallHouseArt[key];
    if (matte && G.SPR.get(matte.key)) return { key: matte.key, width: 112 };
    if (key && G.SPR.get(key)) return { key, width: 112 };
  }
  return villageArt[type];
}
const originalBuilding = G.drawBuilding;
G.drawBuilding = function (ctx, b, time) {
  const art = plotArt(b.type, b.x, b.y, b);
  if (art && b.state === 'ok' && !b.houseFire) {
    const [x, y] = G.T2S(b.x + b.w, b.y + b.h);
    if (G.drawCalibratedArt(ctx, art.key, x, y, art.width)) {
      delete b._chimney;
      const state = G.renderBuildingActivity(b);
      const processing = (b.workers || []).some(id => G.buildingProcessingWorker(b, G.world.cmap[id]));
      if (state) G.drawBuildingStateMarker(ctx, state, x + 7, y + 5, processing && !G.game.paused);
      return;
    }
  }
  return originalBuilding(ctx, b, time);
};
const originalPreview = G.drawPendingBuildingPreview;
G.drawPendingBuildingPreview = function (ctx, pending) {
  const art = plotArt(pending.type, pending.ox, pending.oy), def = G.BDEF[pending.type];
  if (!art || !G.SPR.get(art.key)) return originalPreview(ctx, pending);
  const [x, y] = G.T2S(pending.ox + def.w, pending.oy + def.h);
  ctx.save(); ctx.globalAlpha = .65;
  G.drawCalibratedArt(ctx, art.key, x, y, art.width); ctx.restore();
};
const originalCitizen = G.drawCitizen;
G.drawCitizen = function (ctx, citizen, time, homes) {
  const [x, sy] = G.T2S(citizen.x, citizen.y);
  const y = sy + 16 - (G.bridgeAt(G.world, Math.round(citizen.x), Math.round(citizen.y))?.state === 'ok' ? 8 : 0);
  ctx.save(); ctx.translate(x, y); ctx.scale(1.2, 1.2); ctx.translate(-x, -y);
  originalCitizen(ctx, citizen, time, homes); ctx.restore();
};

G.pixiArt = {
  paths: { ...Object.fromEntries(Object.entries(villageArt).map(([type, art]) => [type, 'assets/pixi/' + art.file])), woodcutter: 'assets/a-style/woodcutter-a-idle.png', tailor: 'assets/a-style/tailor-a-idle.png' },
  ready: Promise.all([...Object.values(villageArt), ...Object.values(smallHouseArt)].map(art => [art.key, art.file]).concat([['pixi-river-garden', 'river-garden-v1.png']]).map(([key, file]) => new Promise(resolve => {
    const image = new Image(); image.decoding = 'async';
    image.onload = () => { G.SPR.map.set(key, image); resolve(); };
    image.onerror = () => { G.SPR.failed.push(key); resolve(); };
    image.src = 'assets/pixi/' + file;
  }))),
  world: null,
  banks: [],
  groundSignature: '',
  refresh() {
    const signature = G.world.buildings.map(b => [b.id, b.type, b.x, b.y, b.w, b.h].join(':')).join('|');
    if (this.groundSignature !== signature) { this.groundSignature = signature; G.needGround = true; }
  },
  addItems(items, bounds) {
    if (G.game.season === 3 || !G.SPR.get('pixi-river-garden')) return;
    const w = G.world;
    if (this.world !== w) {
      this.world = w; this.banks = [];
      for (let y = 1; y < w.N - 1; y++) for (let x = 1; x < w.N - 1; x++) {
        const i = y * w.N + x, h = G.h2(w.seed + 701, x, y);
        if (w.water[i] === 1 || h > .67) continue;
        const wet = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([dx, dy]) => w.water[(y + dy) * w.N + x + dx] === 1);
        if (wet) this.banks.push({ id: 'bank-' + i, x: x + .5 + wet[0] * .22, y: y + .5 + wet[1] * .22, cell: i,
          art: h < .42 ? 'pixi-river-garden' : 'bank-sedge-a-v1', size: h < .42 ? 30 + h * 34 : 19 + h * 22 });
      }
    }
    const props = this.banks.slice();
    for (const b of w.buildings) if (b.state === 'ok' && b.type === 'house') {
      for (const [n, dx, dy] of [[0, .05, -.45], [1, b.w + .4, b.h - .6], [2, -.5, b.h + .3]])
        props.push({ id: 'garden-' + b.id + '-' + n, x: b.x + dx, y: b.y + dy,
          size: 23 + G.h2(w.seed + 881 + n, b.x, b.y) * 11, art: 'pixi-river-garden' });
      // Short rear fences sit within the occupied plot, so residents never
      // walk through a decorative barrier on an otherwise passable tile.
      const ax = b.x + .12, ay = b.y + .12, bx = b.x + b.w - .12;
      if (b.x >= bounds.tx0 && b.y >= bounds.ty0 && b.x <= bounds.tx1 && b.y <= bounds.ty1)
        items.push({ id: 'fence-' + b.id, k: 11, fence: true, x: (ax + bx) / 2, y: ay, ax, ay, bx, by: ay, d: (ax + bx) / 2 + ay });
    }
    for (const p of props) {
      if (p.x < bounds.tx0 || p.y < bounds.ty0 || p.x > bounds.tx1 || p.y > bounds.ty1) continue;
      const i = p.cell ?? Math.floor(p.y) * w.N + Math.floor(p.x);
      if (w.water[i] === 1 || w.bgrid[i] >= 0 || w.road[i] || w.treeIdx[i] >= 0 || w.rock[i]) continue;
      items.push({ ...p, k: 11, d: p.x + p.y + .03 });
    }
  },
  draw(ctx, p) {
    if (p.fence) return G.drawEconomyFieldPart(ctx, { ...p, kind: 'fence' });
    const [x, y] = G.T2S(p.x, p.y);
    if (p.art === 'bank-sedge-a-v1') G.sprDraw(ctx, p.art, x, y, { w: p.size });
    else G.drawCalibratedArt(ctx, p.art, x, y, p.size);
  },
};
