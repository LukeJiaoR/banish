'use strict';
// Art direction for the independent entry only. Shared source images, explicit
// source-space pivots and deterministic low props; no simulation or save edits.
G.A_ART = Object.freeze({ ...G.A_ART,
  'pixi-courtyard': { source: [1536, 1024], anchor: [800, 978], span: 1280 },
  'pixi-river-garden': { source: [1536, 1024], anchor: [780, 923], span: 1350 },
});
const originalHouseArtName = G.houseArtName;
G.houseArtName = function (b) {
  const original = originalHouseArtName(b);
  return original && G.SPR.get('pixi-courtyard') ? 'pixi-courtyard' : original;
};
const originalPreview = G.drawPendingBuildingPreview;
G.drawPendingBuildingPreview = function (ctx, pending) {
  const name = G.pixiArt.previewNames[pending.type], def = G.BDEF[pending.type];
  if (!name || !G.SPR.get(name)) return originalPreview(ctx, pending);
  const [x, y] = G.T2S(pending.ox + def.w, pending.oy + def.h);
  ctx.save(); ctx.globalAlpha = .65;
  G.drawCalibratedArt(ctx, name, x, y, (def.w + def.h) * 32); ctx.restore();
};
const drawCoast = G.coastPresentation.draw;
G.coastPresentation.draw = function (c, w, bounds) {
  drawCoast(c, w, bounds);
  if (G.game.season === 3) return;
  // Bake continuous ground decals once, inside the cache's existing repair
  // clip. Individual tile clips would leave antialiased seams between washes.
  c.save(); c.beginPath();
  const [left, top] = G.T2S(0, 0);
  c.rect(left - w.N * 32 - 40, top - 40, w.N * 64 + 80, w.N * 32 + 80);
  for (let y = bounds.y0; y <= bounds.y1; y++) for (let x = bounds.x0; x <= bounds.x1; x++) {
    const i = y * w.N + x;
    if (w.water[i] !== 1 && !w.road[i] && !w.rock[i] && !w.mountain[i]) continue;
    const [sx, sy] = G.T2S(x, y);
    c.moveTo(sx, sy); c.lineTo(sx + 32, sy + 16); c.lineTo(sx, sy + 32); c.lineTo(sx - 32, sy + 16); c.closePath();
  }
  c.clip('evenodd');
  for (const b of w.buildings) {
    if (['farm', 'dock', 'bridge', 'tunnel', 'roadwork'].includes(b.type)) continue;
    const [cx, cy] = G.T2S(b.x + b.w / 2, b.y + b.h / 2), r = (b.w + b.h) * 20 + 48;
    c.save(); c.translate(cx, cy); c.scale(1, .5);
    const wash = c.createRadialGradient(0, 0, r * .35, 0, 0, r);
    wash.addColorStop(0, 'rgba(212,184,126,.65)'); wash.addColorStop(1, 'rgba(212,184,126,0)');
    c.fillStyle = wash; c.fillRect(-r, -r, r * 2, r * 2); c.restore();
  }
  c.restore();
};

G.pixiArt = {
  paths: { house: 'assets/pixi/courtyard-house-v1.png', storage: 'assets/a-style/storage-a-v2.png', woodcutter: 'assets/a-style/woodcutter-a-idle.png', blacksmith: 'assets/a-style/blacksmith-a-idle.png', tailor: 'assets/a-style/tailor-a-idle.png' },
  previewNames: { house: 'pixi-courtyard', woodcutter: 'woodcutter-a-idle', blacksmith: 'blacksmith-a-idle', tailor: 'tailor-a-idle', tavern: 'tavern' },
  ready: Promise.all([['pixi-courtyard', 'courtyard-house-v1.png'], ['pixi-river-garden', 'river-garden-v1.png']].map(([key, file]) => new Promise(resolve => {
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
        if (w.water[i] === 1 || h > .85) continue;
        const wet = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([dx, dy]) => w.water[(y + dy) * w.N + x + dx] === 1);
        if (wet) this.banks.push({ id: 'bank-' + i, x: x + .5 + wet[0] * .22, y: y + .5 + wet[1] * .22, cell: i, size: 56 + h * 24 });
      }
    }
    const props = this.banks.slice();
    for (const b of w.buildings) if (b.state === 'ok' && b.type === 'house') {
      props.push({ id: 'garden-' + b.id, x: b.x + b.w + .45, y: b.y + b.h - .25, size: 46 });
    }
    for (const p of props) {
      if (p.x < bounds.tx0 || p.y < bounds.ty0 || p.x > bounds.tx1 || p.y > bounds.ty1) continue;
      const i = p.cell ?? Math.floor(p.y) * w.N + Math.floor(p.x);
      if (w.water[i] === 1 || w.bgrid[i] >= 0 || w.road[i] || w.treeIdx[i] >= 0 || w.rock[i]) continue;
      items.push({ ...p, k: 11, d: p.x + p.y + .03 });
    }
  },
  draw(ctx, p) {
    const [x, y] = G.T2S(p.x, p.y);
    G.drawCalibratedArt(ctx, 'pixi-river-garden', x, y, p.size);
  },
};
