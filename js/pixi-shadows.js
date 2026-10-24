'use strict';
// Fixed-camera shadow proxies for the independent art. Roof vertices are
// [image x, image y, vertical height], measured in source pixels. Ground
// vertices have height zero: ground depth is never flattened into height.
(() => {
  const light = [1.05, .525]; // Baked upper-left sun; projected screen +X,+Y.
  const cast = ([x, y, z = 0]) => [x + light[0] * z, y + (1 + light[1]) * z];
  const models = {
    'courtyard-house-v2-matte': [
      // Main house and left wing leave the open courtyard empty.
      [[660,565],[1090,738],[1340,636],[910,463],
        [640,325,230],[1085,502,230],[1360,380,230],[915,205,230],
        [680,78,450],[1210,286,450]],
      [[245,610],[445,708],[675,600],[475,503],
        [225,402,205],[450,500,205],[700,395,205],[475,297,205],
        [338,344,310],[580,246,310]],
      [[435,742],[645,825],[670,812],[460,730],
        [435,582,160],[645,665,160],[670,652,160],[460,570,160]],
      [[850,940],[1100,820],[1080,790],[830,910],
        [850,790,150],[1100,670,150],[1080,640,150],[830,760,150]],
    ],
    'house-a-v2-square-empty': [
      [[278,700],[768,960],[1260,700],[768,460],
        [215,385,350],[768,130,350],[1322,375,350],[768,575,350],[768,95,630]],
    ],
    'granary-v2': [
      [[405,675],[847,838],[1208,675],[767,512],
        [330,378,260],[850,585,260],[1280,378,260],[760,171,260],[794,98,545]],
    ],
    'well-v2': [
      // The roof is a surface; the open sides must not become solid walls.
      [[490,305,280],[882,486,280],[1112,365,280],[720,184,280],
        [655,145,445],[990,287,445]],
      [[600,635],[630,645],[630,355,280],[600,345,280]],
      [[970,753],[1000,763],[1000,473,280],[970,463,280]],
    ],
    'smithy-v2': [
      [[670,645],[1115,797],[1365,682],[920,530],
        [650,395,250],[1082,528,250],[1390,410,250],[960,270,250],
        [680,110,425],[1195,330,425],
        [1108,210,520],[1157,175,520],[1220,198,520],[1165,238,520]],
      [[225,670],[414,768],[790,630],[600,535],
        [155,432,235],[442,516,235],[823,380,235],[536,294,235],
        [290,365,325],[660,262,325]],
    ],
    'woodcutter-a-idle': [
      [[200,240,250],[590,390,250],[860,290,250],[470,140,250],
        [420,45,400],[740,220,400]],
      [[250,465],[280,477],[280,247,230],[250,235,230]],
      [[580,580],[615,595],[615,390,205],[580,375,205]],
      [[815,480],[850,492],[850,292,200],[815,280,200]],
    ],
  };
  models['house-a-v2-square-occupied'] = models['house-a-v2-square-empty'];
  models['house-square-v3-empty'] = models['house-a-v2-square-empty'];
  models['house-square-v3-occupied'] = models['house-a-v2-square-empty'];
  models['woodcutter-a-processing-v2'] = models['woodcutter-a-idle'];

  function hull(points) {
    const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const lower = [], upper = [];
    for (const p of sorted) {
      while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
      lower.push(p);
    }
    for (const p of sorted.slice().reverse()) {
      while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  function treePolygons(name) {
    const spec = G.A_ART[name];
    if (!spec?.height || !name.startsWith('tree-a-')) return null;
    const [ax, ay] = spec.anchor, h = spec.height;
    const spread = name.includes('sapling') ? .42 : name.includes('young') ? .65 : 1;
    const willow = name.includes('willow');
    // Ellipsoid crown clusters, in the ground plane with a separate height.
    // This approximates crown volume, rather than projecting painted leaves,
    // the trunk and hidden ground pixels as one vertical sheet.
    const lobes = willow ? [
      [-.36,0,.43,.25,.13,.18],[-.16,-.04,.69,.25,.13,.17],
      [.04,-.04,.82,.21,.12,.14],[.31,0,.62,.27,.14,.18],[.40,.06,.35,.24,.13,.18],
    ] : [
      [-.40,-.04,.42,.28,.13,.13],[-.19,-.04,.68,.30,.14,.15],
      [.07,-.02,.82,.24,.11,.12],[.32,.02,.60,.28,.13,.14],[.43,.04,.34,.24,.12,.13],
    ];
    const wood = [], crown = [];
    const root = [ax, ay], fork = [ax + light[0] * h * .40, ay + light[1] * h * .40];
    function branch(a, b, width) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[1] - a[1]) / length * width, dy = (a[0] - b[0]) / length * width;
      wood.push([[a[0]+dx,a[1]+dy],[b[0]+dx,b[1]+dy],[b[0]-dx,b[1]-dy],[a[0]-dx,a[1]-dy]]);
    }
    branch(root, fork, h * .018);
    for (const [x,y,z,rx,ry,rz] of lobes) {
      const cx = ax + (x * spread + light[0] * z) * h;
      const cy = ay + (y * spread + light[1] * z) * h;
      branch(fork, [cx,cy], h * .008);
      if (name.endsWith('-winter')) continue;
      // Project an ellipsoid onto the ground. Eigenvectors of A*A^T give
      // the ellipse axes, retaining crown depth as well as vertical radius.
      const a = (rx * spread) ** 2 + (light[0] * rz) ** 2;
      const b = light[0] * light[1] * rz ** 2;
      const d = (ry * spread) ** 2 + (light[1] * rz) ** 2;
      const delta = Math.hypot(a - d, 2 * b), angle = Math.atan2(2 * b, a - d) / 2;
      const r1 = Math.sqrt((a + d + delta) / 2) * h, r2 = Math.sqrt((a + d - delta) / 2) * h;
      const co = Math.cos(angle), si = Math.sin(angle), ellipse = [];
      for (let i = 0; i < 32; i++) {
        const t = i * Math.PI / 16, u = Math.cos(t) * r1, v = Math.sin(t) * r2;
        ellipse.push([cx + u * co - v * si, cy + u * si + v * co]);
      }
      crown.push(ellipse);
    }
    return { wood, crown, height: h };
  }

  G.createPixiShadowLayer = function () {
    const container = new PIXI.Container(), cache = new Map();
    // Composite opaque masks first, then attenuate once. One sun must not
    // make overlapping trees/buildings twice as dark.
    container.filters = [new PIXI.AlphaFilter({ alpha: .32 })];

    function mask(image) {
      const name = image.src?.split('/').pop()?.replace(/\.png$/, '');
      if (cache.has(name)) return cache.get(name);
      const building = models[name]?.map(volume => hull(volume.map(cast)));
      const tree = building ? null : treePolygons(name);
      const polygons = building || (tree && tree.wood.concat(tree.crown));
      if (!polygons) { cache.set(name, null); return null; }
      const points = polygons.flat(), span = G.A_ART[name]?.span || G.A_ART[name]?.height || image.width;
      const blur = span * .009, crownBlur = tree?.crown.length ? tree.height * .025 : blur;
      const pad = Math.max(blur, crownBlur) * 3;
      const x = Math.floor(Math.min(...points.map(p => p[0])) - pad);
      const y = Math.floor(Math.min(...points.map(p => p[1])) - pad);
      const width = Math.ceil(Math.max(...points.map(p => p[0])) + pad - x);
      const height = Math.ceil(Math.max(...points.map(p => p[1])) + pad - y);
      const scale = Math.min(1, 512 / Math.max(width, height));
      const solid = document.createElement('canvas'), soft = document.createElement('canvas');
      solid.width = soft.width = Math.ceil(width * scale);
      solid.height = soft.height = Math.ceil(height * scale);
      const c = solid.getContext('2d'), out = soft.getContext('2d');
      // High crowns have a softer penumbra; keep roots and branches tight.
      // Both groups still share one cached mask before the layer's alpha.
      const groups = tree ? [[tree.crown, crownBlur], [tree.wood, blur]] : [[polygons, blur]];
      for (const [group, radius] of groups) {
        if (!group.length) continue;
        c.resetTransform(); c.clearRect(0, 0, solid.width, solid.height);
        c.setTransform(scale, 0, 0, scale, -x * scale, -y * scale); c.fillStyle = '#182722';
        for (const polygon of group) {
          c.beginPath(); c.moveTo(...polygon[0]);
          for (const p of polygon.slice(1)) c.lineTo(...p);
          c.closePath(); c.fill();
        }
        out.filter = 'blur(' + radius * scale + 'px)'; out.drawImage(solid, 0, 0);
      }
      const texture = PIXI.Texture.from(soft);
      texture.source.autoGenerateMipmaps = true;
      const result = { texture, x, y, scale };
      cache.set(name, result); return result;
    }

    return {
      container,
      beginFrame() {
        container.position.set(G.cam.x, G.cam.y); container.scale.set(G.cam.z);
        // Pixi transforms filterArea from this container's local coordinates.
        container.filterArea = new PIXI.Rectangle(-G.cam.x / G.cam.z, -G.cam.y / G.cam.z,
          innerWidth / G.cam.z, innerHeight / G.cam.z);
      },
      draw(entry, it, bounds) {
        if (it.k !== 0 && !(it.k === 1 && it.b.state === 'ok' && !it.b.houseFire)) return false;
        const source = entry.nodes.find(n => !n.raster && n.sprite.visible && n.image instanceof HTMLImageElement && mask(n.image));
        if (!source) return false;
        const data = mask(source.image), m = source.matrix;
        if (!entry.shadow) { entry.shadow = new PIXI.Sprite(); container.addChild(entry.shadow); }
        entry.shadow.texture = data.texture;
        entry.shadow.setFromMatrix(new PIXI.Matrix(m.a / data.scale, m.b / data.scale,
          m.c / data.scale, m.d / data.scale,
          bounds.x + m.tx + m.a * data.x + m.c * data.y,
          bounds.y + m.ty + m.b * data.x + m.d * data.y));
        entry.shadow.alpha = source.sprite.alpha; entry.shadow.visible = true;
        return true;
      },
    };
  };
})();
