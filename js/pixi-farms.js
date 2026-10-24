'use strict';
// Independent-entry farm dressing; crop state and scene ordering stay shared.
(() => {
  const soilKey = 'pixi-farm-earth-v5';
  function farmOutline(ctx, b, inner) {
    const corners = [[b.x, b.y], [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    const normals = [[0, 1], [-1, 0], [0, -1], [1, 0]], corner = .06 + inner;
    ctx.beginPath();
    for (let side = 0; side < 4; side++) {
      const a = corners[side], z = corners[(side + 1) % 4];
      const steps = Math.ceil((side % 2 ? b.h : b.w) * 4);
      for (let i = 0; i < steps; i++) {
        const inset = i ? .02 + inner + G.h2(G.world.seed + 967 + side, b.x + i, b.y) * .04 : corner;
        let x = a[0] + (z[0] - a[0]) * i / steps + normals[side][0] * inset;
        let y = a[1] + (z[1] - a[1]) * i / steps + normals[side][1] * inset;
        if (side % 2) y = Math.max(b.y + corner, Math.min(b.y + b.h - corner, y));
        else x = Math.max(b.x + corner, Math.min(b.x + b.w - corner, x));
        if (!side && !i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  }

  const drawFarmGround = G.drawFarmGround;
  G.drawFarmGround = function (ctx, b, bounds) {
    const image = G.SPR.get(soilKey);
    if (G.PAL[G.game.season].snow || !image?.width || !ctx.createPattern)
      return drawFarmGround(ctx, b, bounds);

    const x0 = Math.max(b.x, bounds?.tx0 ?? b.x);
    const y0 = Math.max(b.y, bounds?.ty0 ?? b.y);
    const x1 = Math.min(b.x + b.w, (bounds?.tx1 ?? b.x + b.w - 1) + 1);
    const y1 = Math.min(b.y + b.h, (bounds?.ty1 ?? b.y + b.h - 1) + 1);
    if (x1 <= x0 || y1 <= y0) return;

    const earth = ctx.createPattern(image, 'repeat');
    if (!earth?.setTransform) return drawFarmGround(ctx, b, bounds);
    earth.setTransform({ a: 4 / image.width, b: 0, c: 0, d: 4 / image.height, e: 0, f: 0 });
    ctx.save();
    // Eight painted furrows per four cells meet the roots at y=.25/.75.
    // Both narrow edge layers follow the real field, never the camera bounds.
    ctx.transform(32, 16, -32, 16, 0, 0);
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    const alpha = ctx.globalAlpha;
    ctx.fillStyle = earth; ctx.globalAlpha = alpha * .4;
    farmOutline(ctx, b, 0); ctx.fill();
    ctx.globalAlpha = alpha;
    farmOutline(ctx, b, .04); ctx.fill(); ctx.clip();
    // Keep the soil outline clip while returning to screen-space cell overlays.
    ctx.transform(1 / 64, -1 / 64, 1 / 32, 1 / 32, 0, 0);

    for (const f of b.farm) {
      if (f.x < x0 || f.x >= x1 || f.y < y0 || f.y >= y1) continue;
      const [sx, sy] = G.T2S(f.x, f.y);
      if (f.pestLost || f.harvested) {
        G.diamondPath(ctx, sx, sy);
        ctx.fillStyle = f.pestLost ? 'rgba(81,72,60,.58)' : 'rgba(92,69,44,.25)';
        ctx.fill();
      }
      if (f.pestLost) {
        ctx.save(); ctx.strokeStyle = '#4e4231'; ctx.lineWidth = 1.8;
        for (const [dx, dy] of [[-13, 8], [9, 17], [2, 5]]) {
          ctx.beginPath(); ctx.moveTo(sx + dx - 4, sy + dy + 2);
          ctx.lineTo(sx + dx + 3, sy + dy - 2); ctx.lineTo(sx + dx + 5, sy + dy - 7); ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  };

  // Soil belongs to the ground pass. These transparent plants contain no
  // painted plinth, and their measured roots sit on the same two furrows.
  const stages = [
    { name: 'stage0', root: [782, 976], top: 52, height: 7 },
    { name: 'stage1', root: [792, 986], top: 65, height: 14 },
    { name: 'stage2', root: [809, 992], top: 50, height: 24 },
    { name: 'ripe', root: [788, 1013], top: 23, height: 28 },
  ];
  const drawCrop = G.drawFarmCrop;
  G.drawFarmCrop = function (ctx, b, f) {
    if (!f.sown || f.harvested || G.farmCropOf(b) !== 'wheat') return drawCrop(ctx, b, f);
    const stage = stages[b.growth >= 1 ? 3 : b.growth >= .66 ? 2 : b.growth >= .33 ? 1 : 0];
    const image = G.SPR.get('pixi-wheat-' + stage.name);
    if (!image?.width) return drawCrop(ctx, b, f);
    let n = 0;
    for (const y of [.25, .75]) for (const x of [.18, .5, .82]) {
      const variation = G.h2(G.world.seed + 941 + n++, f.x, f.y);
      const [sx, sy] = G.T2S(f.x + x, f.y + y);
      const scale = stage.height * (.94 + variation * .12) / (stage.root[1] - stage.top);
      ctx.save(); ctx.translate(sx, sy); ctx.scale(variation < .5 ? -scale : scale, scale);
      ctx.drawImage(image, -stage.root[0], -stage.root[1]); ctx.restore();
    }
  };
  G.pixiFarms = {
    ready: Promise.all(stages.map(stage => ['pixi-wheat-' + stage.name, 'wheat-' + stage.name + '-v2.png'])
      .concat([[soilKey, 'farm-earth-v5.png']]).map(([key, file]) => new Promise(resolve => {
      const image = new Image(); image.decoding = 'async';
      image.onload = () => { G.SPR.map.set(key, image); resolve(); };
      image.onerror = () => { G.SPR.failed.push(key); resolve(); };
      image.src = 'assets/pixi/' + file;
    }))),
  };
})();
