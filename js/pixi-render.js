'use strict';
/* PixiJS scene backend. Ordinary image draws become native GPU sprites.
 * Canvas keeps the existing vector/clip/shadow semantics, cached in small
 * per-object texture segments. The complete scene is never flattened to an image.
 * This backend is loaded only by pixi.html; simulation and hit testing are shared.
 */
G.createPixiRenderer = async function (canvas) {
  const app = new PIXI.Application();
  await app.init({ canvas, preference: 'webgl', width: innerWidth, height: innerHeight,
    resolution: Math.min(2, devicePixelRatio || 1), autoDensity: true,
    antialias: true, background: '#14181d', autoStart: false,
    // Existing DOM input owns the camera and building tools. Disable Pixi's
    // parallel hit testing/default prevention (EventSystem v8 eventFeatures).
    eventMode: 'none', eventFeatures: { move: false, globalMove: false, click: false, wheel: false } });
  app.stop(); // main.js owns the only simulation/render loop.

  const ground = new PIXI.Container(), objects = new PIXI.Container();
  const under = new PIXI.Sprite(), over = new PIXI.Sprite();
  app.stage.addChild(ground, under, objects, over);
  const surface = document.createElement('canvas');
  const context = surface.getContext('2d');
  const layers = [under, over].map(sprite => {
    const image = document.createElement('canvas');
    const texture = PIXI.Texture.from(image);
    sprite.texture = texture;
    return { image, texture, sprite };
  });
  const imageTextures = new Map(), crops = new Map(), entries = new Map(), scratch = new Map();
  const ids = new WeakMap(), patternKeys = new WeakMap();
  let nextId = 1, frameId = 0, world = null, groundChanged = true;
  const id = object => { if (!ids.has(object)) ids.set(object, nextId++); return ids.get(object); };
  const stats = { backend: 'PixiJS ' + PIXI.VERSION + ' / WebGL', frames: 0,
    objects: 0, nativeImages: 0, rasterSegments: 0, rasterUploads: 0, groundUploads: 0 };

  function destroyEntry(entry) {
    for (const node of entry.nodes) if (node.raster) node.texture.destroy(true);
    entry.container.destroy({ children: true });
  }
  function clearGround() {
    for (const sprite of ground.removeChildren()) {
      sprite.texture.destroy(true); sprite.destroy();
    }
  }
  function clearSurface() {
    context.save(); context.resetTransform();
    context.clearRect(0, 0, surface.width, surface.height); context.restore();
  }
  function uploadLayer(index) {
    const layer = layers[index];
    if (layer.image.width !== surface.width || layer.image.height !== surface.height) {
      layer.image.width = surface.width; layer.image.height = surface.height;
      layer.texture.source.resize(surface.width, surface.height);
    }
    const c = layer.image.getContext('2d');
    c.clearRect(0, 0, surface.width, surface.height); c.drawImage(surface, 0, 0);
    layer.texture.source.update();
    layer.sprite.width = canvas.clientWidth; layer.sprite.height = canvas.clientHeight;
    clearSurface();
  }
  function imageTexture(image, crop) {
    if (!imageTextures.has(image)) imageTextures.set(image, PIXI.Texture.from(image));
    const texture = imageTextures.get(image);
    if (!crop) return texture;
    const key = id(image) + ':' + crop.join(',');
    if (!crops.has(key)) crops.set(key, new PIXI.Texture({ source: texture.source,
      frame: new PIXI.Rectangle(...crop) }));
    return crops.get(key);
  }
  function nodeAt(entry, raster) {
    const index = entry.cursor++;
    let node = entry.nodes[index];
    if (node && node.raster !== raster) {
      if (node.raster) node.texture.destroy(true);
      node.sprite.destroy(); node = null;
    }
    if (!node) {
      const sprite = new PIXI.Sprite();
      entry.container.addChildAt(sprite, index);
      node = entry.nodes[index] = { sprite, raster, signature: null };
      if (raster) {
        node.image = document.createElement('canvas');
        node.texture = PIXI.Texture.from(node.image);
        sprite.texture = node.texture;
      }
    }
    node.sprite.visible = true;
    return node;
  }

  // Bounds concern only Canvas vector/shadow fragments. Native images have
  // their actual source bounds and are not clipped by this scratch surface.
  function itemBounds(it) {
    let point, width = 80, height = 96, top = 64;
    if (it.k === 1 || it.k === 10) {
      const b = it.b || { ...G.BDEF[it.pending.type], x: it.pending.ox, y: it.pending.oy };
      point = G.T2S(b.x + b.w / 2, b.y + b.h / 2);
      width = Math.ceil((b.w + b.h) * 40 + 64);
      height = Math.ceil((b.w + b.h) * 48 + 160); top = height - 72;
    } else if (it.k === 2) point = G.T2S(it.c.x, it.c.y);
    else if (it.k === 7) { const p = G.deerDisplayPoint(it.deer); point = G.T2S(p.x, p.y); }
    else if (it.k === 9) point = G.T2S(it.p.x, it.p.y);
    else {
      const p = it.t || it.f || it.pile || it;
      point = G.T2S(p.x, p.y);
      if (it.k === 8) { height = G.MOUNTAIN_MAX_RISE + 64; top = height - 40; }
      if (it.kind === 'sheepShelter') { width = 160; height = 176; top = 144; }
    }
    return { x: point[0], y: point[1], width, height, left: width / 2, top };
  }
  function itemKey(it) {
    if (it.k === 11) return 'decoration:' + it.id;
    if (it.k === 0) return 'tree:' + it.t.i;
    if (it.k === 1) return 'building:' + it.b.id;
    if (it.k === 2) return 'citizen:' + it.c.id;
    if (it.k === 7) return 'deer:' + it.deer.id;
    if (it.k === 10) return 'pending';
    if (it.k === 4) return 'crop:' + it.b.id + ':' + it.f.x + ':' + it.f.y;
    if (it.k === 5 && it.n !== undefined) return 'animal:' + it.b.id + ':' + it.n;
    if (it.k === 6) return 'pile:' + id(it.pile);
    return [it.k, it.kind, it.b?.id, it.x ?? it.p?.x, it.y ?? it.p?.y, it.first].join(':');
  }

  function paintItem(entry, bounds, draw) {
    const r = G.dpr, w = Math.ceil(bounds.width * r), h = Math.ceil(bounds.height * r);
    // Share scratch surfaces by size; only changed cached segments own bitmaps.
    const sizeKey = w + ':' + h;
    let c = scratch.get(sizeKey);
    if (!c) {
      const image = document.createElement('canvas'); image.width = w; image.height = h;
      c = image.getContext('2d'); scratch.set(sizeKey, c);
    }
    c.reset();
    c.setTransform(r, 0, 0, r, (bounds.left - bounds.x) * r, (bounds.top - bounds.y) * r);
    let path = [], clips = [], stack = [], operations = [];
    const matrix = () => { const m = c.getTransform(); return [m.a, m.b, m.c, m.d, m.e, m.f]; };
    const valueKey = value => value && typeof value === 'object' ? patternKeys.get(value) || id(value) : value;
    const style = () => [c.globalAlpha, c.globalCompositeOperation, valueKey(c.fillStyle), valueKey(c.strokeStyle),
      c.lineWidth, c.lineCap, c.lineJoin, c.miterLimit, c.getLineDash(), c.lineDashOffset,
      c.shadowColor, c.shadowBlur, c.shadowOffsetX, c.shadowOffsetY, c.font, c.textAlign, c.textBaseline, c.filter];
    function flush() {
      if (!operations.length) return;
      const node = nodeAt(entry, true), signature = JSON.stringify([w, h, operations]);
      if (node.signature !== signature) {
        if (node.image.width !== w || node.image.height !== h) {
          node.image.width = w; node.image.height = h; node.texture.source.resize(w, h);
        }
        const out = node.image.getContext('2d'); out.clearRect(0, 0, w, h); out.drawImage(c.canvas, 0, 0);
        node.texture.source.update(); node.signature = signature; stats.rasterUploads++;
      }
      node.sprite.position.set(-bounds.left, -bounds.top);
      node.sprite.width = bounds.width; node.sprite.height = bounds.height;
      node.sprite.alpha = 1; stats.rasterSegments++;
      c.save(); c.resetTransform(); c.clearRect(0, 0, w, h); c.restore(); operations = [];
    }
    const pathMethods = new Set(['moveTo', 'lineTo', 'rect', 'roundRect', 'arc', 'arcTo', 'ellipse', 'bezierCurveTo', 'quadraticCurveTo', 'closePath']);
    const paints = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'clearRect']);
    const proxy = new Proxy(c, {
      get(target, key) {
        if (key === 'drawImage') return (...args) => {
          const shadow = c.shadowColor !== 'rgba(0, 0, 0, 0)' && c.shadowColor !== 'transparent';
          if (clips.length || shadow || c.globalCompositeOperation !== 'source-over' || c.filter !== 'none') {
            operations.push(['image', id(args[0]), args.slice(1), matrix(), style(), clips]);
            c.drawImage(...args); return;
          }
          flush();
          const [image, ...a] = args;
          let sx = 0, sy = 0, sw = image.width, sh = image.height, dx, dy, dw, dh;
          if (a.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a;
          else if (a.length === 4) [dx, dy, dw, dh] = a;
          else { [dx, dy] = a; dw = sw; dh = sh; }
          const node = nodeAt(entry, false), m = c.getTransform();
          node.sprite.texture = imageTexture(image, a.length === 8 ? [sx, sy, sw, sh] : null);
          node.sprite.setFromMatrix(new PIXI.Matrix(m.a * dw / sw / r, m.b * dw / sw / r,
            m.c * dh / sh / r, m.d * dh / sh / r,
            (m.a * dx + m.c * dy + m.e) / r - bounds.left,
            (m.b * dx + m.d * dy + m.f) / r - bounds.top));
          node.sprite.alpha = c.globalAlpha; stats.nativeImages++;
        };
        if (key === 'save') return () => { stack.push(clips.slice()); c.save(); };
        if (key === 'restore') return () => { clips = stack.pop() || []; c.restore(); };
        if (key === 'beginPath') return () => { path = []; c.beginPath(); };
        if (key === 'clip') return (...args) => { clips = [...clips, [path.slice(), args]]; c.clip(...args); };
        if (key === 'createPattern') return (image, repetition) => {
          const pattern = c.createPattern(image, repetition);
          if (pattern) patternKeys.set(pattern, 'pattern:' + id(image) + ':' + repetition);
          return pattern;
        };
        if (pathMethods.has(key)) return (...args) => { path.push([key, args, matrix()]); return c[key](...args); };
        if (paints.has(key)) return (...args) => {
          operations.push([key, args, path.slice(), matrix(), style(), clips]); return c[key](...args);
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) {
        // Canvas shadow offsets ignore transforms; keep their screen-pixel size.
        target[key] = key === 'shadowOffsetX' || key === 'shadowOffsetY' ? value / G.cam.z : value;
        return true;
      },
    });
    draw(proxy); flush();
    for (let i = entry.cursor; i < entry.nodes.length; i++) entry.nodes[i].sprite.visible = false;
  }

  const backend = {
    app, context, stats,
    resize(width, height) {
      app.renderer.resize(width, height);
      surface.width = Math.floor(width * G.dpr); surface.height = Math.floor(height * G.dpr);
    },
    beginFrame(changed) {
      frameId++; groundChanged = changed;
      stats.nativeImages = stats.rasterSegments = stats.rasterUploads = 0;
      if (world !== G.world) {
        for (const entry of entries.values()) destroyEntry(entry);
        entries.clear(); clearGround(); world = G.world; groundChanged = true;
      }
      clearSurface();
      for (const entry of entries.values()) entry.container.visible = false;
      ground.position.set(G.cam.x, G.cam.y); ground.scale.set(G.cam.z);
      objects.position.copyFrom(ground.position); objects.scale.copyFrom(ground.scale);
    },
    drawGround() {
      if (!groundChanged && ground.children.length) return;
      clearGround();
      // Small textures respect GPUs whose maximum texture width is 4096,
      // including large maps; no full-map GPU texture is assumed.
      const image = G._gcv, chunk = 2048;
      for (let y = 0; y < image.height; y += chunk) for (let x = 0; x < image.width; x += chunk) {
        const tile = document.createElement('canvas');
        tile.width = Math.min(chunk, image.width - x); tile.height = Math.min(chunk, image.height - y);
        tile.getContext('2d').drawImage(image, x, y, tile.width, tile.height, 0, 0, tile.width, tile.height);
        const sprite = new PIXI.Sprite(PIXI.Texture.from(tile));
        sprite.position.set(x / G.groundScale - G.groundOX, y / G.groundScale - G.groundOY);
        sprite.scale.set(1 / G.groundScale); ground.addChild(sprite);
      }
      stats.groundUploads++;
    },
    beginItems() { uploadLayer(0); },
    prepareArt() { G.pixiArt.refresh(); },
    addDecorations(items, bounds) { G.pixiArt.addItems(items, bounds); },
    drawItem(it, now, homes) {
      const key = itemKey(it);
      let entry = entries.get(key);
      if (!entry) {
        entry = { container: new PIXI.Container(), nodes: [], cursor: 0, seen: frameId };
        entries.set(key, entry); objects.addChild(entry.container);
      }
      const bounds = itemBounds(it);
      entry.container.position.set(bounds.x, bounds.y); entry.container.visible = true;
      entry.container.zIndex = backend.paintIndex++;
      entry.cursor = 0; entry.seen = frameId;
      paintItem(entry, bounds, ctx => it.k === 11 ? G.pixiArt.draw(ctx, it) : G.drawSceneItem(ctx, it, now, homes));
    },
    paintIndex: 0,
    finish() {
      uploadLayer(1); objects.sortChildren();
      // Reclaim offscreen and removed objects; image textures remain shared.
      for (const [key, entry] of entries) if (entry.seen !== frameId) {
        destroyEntry(entry); entries.delete(key);
      }
      stats.objects = entries.size; stats.frames++;
      app.render(); backend.paintIndex = 0;
    },
  };
  return backend;
};
