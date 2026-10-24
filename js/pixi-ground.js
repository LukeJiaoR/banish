'use strict';
// Independent-entry ground dressing. The road grid remains the simulation's
// source of truth; only its cached presentation is replaced here.
(() => {
  const textureKey = 'pixi-path-earth-v2';
  const patterns = new WeakMap();
  const groundTile = G.drawGroundTile;
  const drawCoast = G.coastPresentation.draw;
  const coastActive = G.coastPresentation.active;
  const fillTerrain = G.fillTerrainSurface;
  const soil = '#c5b083';
  const snowy = () => G.game.season === 3;
  const summer = () => G.game.season === 1;

  G.fillTerrainSurface = function (c, name, x, y) {
    if (name === 'meadow_summer') {
      const image = G.SPR.get(name);
      if (image?.width && c.createPattern) {
        let entries = G.terrainPatterns.get(c);
        if (!entries) { entries = new Map(); G.terrainPatterns.set(c, entries); }
        let entry = entries.get(name);
        if (!entry || entry.image !== image) {
          const pattern = c.createPattern(image, 'repeat');
          // Grass blades need to survive the ground cache's downsampling.
          // Keep this shared pattern so the coast uses the identical density.
          if (pattern?.setTransform) pattern.setTransform({ a: 16 * 64 / image.width, b: 0, c: 0, d: 16 * 64 / image.height, e: 0, f: 0 });
          entry = { image, pattern }; entries.set(name, entry);
        }
      }
    }
    return fillTerrain(c, name, x, y);
  };

  function material(c) {
    const image = G.SPR.get(textureKey);
    if (!image?.width || !c.createPattern) return soil;
    const repeat = summer() ? 12 : 4;
    let entry = patterns.get(c);
    if (!entry || entry.image !== image || entry.repeat !== repeat) {
      const pattern = c.createPattern(image, 'repeat');
      // Source gravel was compressed below one cache pixel at four cells.
      if (pattern?.setTransform) pattern.setTransform({ a: repeat / image.width, b: 0, c: 0, d: repeat / image.height, e: 0, f: 0 });
      entry = { image, pattern, repeat }; patterns.set(c, entry);
    }
    return entry.pattern || soil;
  }

  const dirt = (w, x, y) => x >= 0 && y >= 0 && x < w.N && y < w.N &&
    w.road[y * w.N + x] === 1 && w.water[y * w.N + x] !== 1 &&
    !w.rock[y * w.N + x] && !w.mountain[y * w.N + x];

  G.drawGroundTile = function (c, w, pal, x, y) {
    if (snowy() || !dirt(w, x, y)) return groundTile(c, w, pal, x, y);
    // Lay opaque meadow first. The continuous road pass below supplies the
    // material once, so old square road tiles cannot show through its edges.
    if (!G.fillTerrainSurface(c, 'meadow_' + G.TEX_SEASON[G.game.season], x, y)) {
      G.diamondPath(c, ...G.T2S(x, y));
      c.fillStyle = pal.grass; c.fill(); c.strokeStyle = pal.grass; c.lineWidth = 1; c.stroke();
    }
  };

  function allowedSurface(c, w, bounds) {
    c.beginPath(); c.rect(0, 0, w.N, w.N);
    for (let y = bounds.y0; y <= bounds.y1; y++) for (let x = bounds.x0; x <= bounds.x1; x++) {
      const i = y * w.N + x;
      if (w.water[i] === 1 || w.rock[i] || w.mountain[i] || w.road[i] === 2) c.rect(x, y, 1, 1);
    }
    // One compound mask avoids alpha seams at the edges of individual tiles.
    c.clip('evenodd');
  }

  function yardPath(c, b, w) {
    const noise = n => G.h2(w.seed + 821 + n * 2, b.x, b.y);
    const x = b.x - .34 - noise(0) * .25, y = b.y - .34 - noise(1) * .25;
    const right = b.x + b.w + .34 + noise(2) * .25, bottom = b.y + b.h + .34 + noise(3) * .25;
    const width = right - x, height = bottom - y, r = .48;
    const rim = [[x + r, y], [x + width * .48, y - .09], [right - r, y + .04],
      [right, y + r], [right + .07, y + height * .56], [right - .03, bottom - r],
      [right - r, bottom], [x + width * .43, bottom + .10], [x + r, bottom - .03],
      [x, bottom - r], [x - .08, y + height * .45], [x + .03, y + r]];
    const points = rim.map(([px, py], i) => [px + (noise(i + 4) - .5) * .16, py + (noise(i + 16) - .5) * .16]);
    const mid = (a, z) => [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2];
    // A few seed-fixed bends soften the footprint without adding a second mask
    // or changing where the building and its road access actually stand.
    c.moveTo(...mid(points[points.length - 1], points[0]));
    for (let i = 0; i < points.length; i++) c.quadraticCurveTo(...points[i], ...mid(points[i], points[(i + 1) % points.length]));
    c.closePath();
  }

  function yards(c, w, bounds, earth) {
    c.beginPath(); let count = 0;
    for (const b of w.buildings) {
      if (['farm', 'pasture', 'orchard', 'cemetery', 'dock', 'bridge', 'tunnel', 'roadwork'].includes(b.type)) continue;
      if (b.x + b.w + 1 < bounds.x0 || b.y + b.h + 1 < bounds.y0 || b.x - 1 > bounds.x1 + 1 || b.y - 1 > bounds.y1 + 1) continue;
      yardPath(c, b, w); count++;
    }
    if (!count) return;
    c.lineJoin = 'round'; c.strokeStyle = 'rgba(185,158,108,.04)'; c.lineWidth = .78; c.stroke();
    c.strokeStyle = 'rgba(185,158,108,.09)'; c.lineWidth = .42; c.stroke();
    c.fillStyle = 'rgba(195,170,119,.18)'; c.fill();
    c.save(); c.globalAlpha = .40; c.fillStyle = earth; c.fill(); c.restore();
  }

  function roads(c, w, bounds, earth) {
    const x0 = Math.max(0, bounds.x0 - 1), y0 = Math.max(0, bounds.y0 - 1);
    const x1 = Math.min(w.N - 1, bounds.x1 + 1), y1 = Math.min(w.N - 1, bounds.y1 + 1);
    const center = (x, y) => [x + .5 + (G.h2(w.seed + 827, x, y) - .5) * .11,
      y + .5 + (G.h2(w.seed + 829, x, y) - .5) * .11];
    c.beginPath(); let count = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!dirt(w, x, y)) continue;
      const p = center(x, y); count++;
      // A tiny round-capped segment also covers an isolated road cell.
      c.moveTo(...p); c.lineTo(p[0] + .001, p[1]);
      for (const [dx, dy] of [[1, 0], [0, 1]]) if (dirt(w, x + dx, y + dy)) {
        c.moveTo(...p); c.lineTo(...center(x + dx, y + dy));
      }
    }
    if (!count) return;
    c.lineCap = c.lineJoin = 'round';
    c.save();
    const bands = summer() ? [[1.04, earth, .06], [.90, earth, .16], [.78, earth, .32], [.64, earth, .88]] :
      [[1.10, 'rgba(183,153,101,.045)', 1], [.99, 'rgba(183,153,101,.085)', 1],
        [.88, 'rgba(193,167,119,.17)', 1], [.78, 'rgba(193,167,119,.22)', 1], [.66, earth, .86]];
    for (const [width, color, alpha] of bands) {
      c.globalAlpha = alpha; c.lineWidth = width; c.strokeStyle = color; c.stroke();
    }
    c.restore();
  }

  G.coastPresentation.draw = function (c, w, bounds) {
    drawCoast(c, w, bounds);
    if (snowy()) return;
    c.save(); c.transform(32, 16, -32, 16, 0, 0);
    allowedSurface(c, w, bounds);
    const earth = material(c);
    // Summer buildings meet the real meadow/road surface, without a repeated
    // surrounding soil plinth. Their sprite bases and contact shadows own it.
    if (!summer()) yards(c, w, bounds, earth);
    roads(c, w, bounds, earth);
    c.restore();
  };
  // Dry maps need the same existing clipped repair pass as river maps, since
  // road shoulders span neighboring cells. Winter retains the original path.
  G.coastPresentation.active = (c, w) => !snowy() || coastActive(c, w);

  G.pixiGround = {
    ready: new Promise(resolve => {
      const image = new Image(); image.decoding = 'async';
      image.onload = () => { G.SPR.map.set(textureKey, image); G.needGround = true; resolve(); };
      image.onerror = () => { G.SPR.failed.push(textureKey); resolve(); };
      image.src = 'assets/pixi/path-earth-v2.png';
    }),
  };
})();
