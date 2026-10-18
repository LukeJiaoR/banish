'use strict';
/* Candidate river-bay rendering contracts. This test loads the lab explicitly;
 * the shipped entrypoint and production render sources remain unchanged.
 * Zero-dependency recording checks are mandatory. Optional native pixel checks
 * run with `node --expose-gc tests/riverbay-lab.js --pixels` when
 * @napi-rs/canvas is available. Explicit GC keeps native pixel buffers bounded. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const CAP = 16000000;

function recordingContext(limit = Infinity) {
  const calls = [];
  const record = entry => { if (calls.length < limit) calls.push(entry); };
  const target = { calls, canvas: null };
  const context = new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      if (key === 'createImageData') return (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
      if (key === 'createPattern') return (image, repeat) => {
        record([key, image, repeat]);
        return { image, repeat };
      };
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => {
        const gradient = { addColorStop(...stop) { record(['addColorStop', ...stop]); } };
        record([key, ...args]);
        return gradient;
      };
      return (...args) => record([key, ...args]);
    },
    set(object, key, value) {
      object[key] = value;
      if (key !== 'canvas') record(['set', key, value]);
      return true;
    },
  });
  return context;
}

function harness(options = {}) {
  const canvases = [], allocations = [], timers = new Map();
  let nextTimer = 1;
  const context = {
    console, performance,
    document: {
      createElement(name) {
        assert.equal(name, 'canvas', 'terrain may only allocate canvas elements');
        let width = 300, height = 150;
        const canvas = options.createCanvas ? options.createCanvas(width, height) : {};
        const draw = options.createCanvas ? canvas.getContext('2d') : recordingContext(options.recordLimit);
        if (!options.createCanvas) {
          Object.defineProperties(canvas, {
            width: { get: () => width, set(value) { width = value; track(); } },
            height: { get: () => height, set(value) { height = value; track(); } },
          });
          canvas.getContext = () => draw;
          draw.canvas = canvas;
        }
        function track() {
          allocations.push([width, height]);
          assert.ok(width * height <= CAP, `unsafe canvas allocation ${width} × ${height}`);
        }
        canvases.push(canvas);
        return canvas;
      },
    },
    addEventListener() {},
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  if (options.Path2D) context.Path2D = options.Path2D;
  context.window = context;
  vm.createContext(context);
  function load(relative) {
    vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), context, { filename: relative });
  }
  for (const name of ['core', 'defs', 'map', 'sim', 'sprites', 'render']) load(`js/${name}.js`);
  const G = context.G;
  G.game = G.newGameState();
  G.game.season = 1;
  G.game.h = 12;
  G.game.paused = true;
  G.ui = { refreshPlacement() {} };
  G.cv = { clientWidth: 390, clientHeight: 844 };
  G.ctx = recordingContext();
  G.dpr = 1;
  G.world = fixture(G, options.N || 24, options.seed === undefined ? 65 : options.seed);
  const production = { drawGroundTile: G.drawGroundTile, buildGround: G.buildGround,
    markGroundDirty: G.markGroundDirty, tileBlocked: G.tileBlocked, findPath: G.findPath,
    genWorld: G.genWorld, setRoad: G.setRoad };
  return { G, context, production, load, canvases, allocations, timers, native: !!options.createCanvas };
}

function install(h, options = h.native ? {} : { waterImage: { width: 512, height: 512 } }) {
  h.load('tools/riverbay-lab/terrain.js');
  assert.equal(typeof h.context.RiverbayTerrain.install, 'function');
  const lab = h.context.RiverbayTerrain.install(h.G, options);
  for (const name of ['setOptions', 'getOptions', 'invalidateTopology', 'getCoastlines'])
    assert.equal(typeof lab[name], 'function', `${name} is public`);
  assert.ok(lab.metrics && typeof lab.metrics === 'object');
  return lab;
}

function fixture(G, N = 24, seed = 65) {
  const world = G.emptyWorld(seed, 1, N);
  for (let y = 0; y < N; y++) {
    const bank = Math.floor(N * .5 + Math.sin(y * .48) * 2);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      world.water[i] = x >= bank ? 1 : x === bank - 1 ? 2 : 0;
    }
  }
  world.rock[2 * N + 2] = 1;
  world.rock[3 * N + 2] = 2;
  world.road[5 * N + 3] = 1;
  world.road[5 * N + 4] = 2;
  world.roadCount = 2;
  return world;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function stateSnapshot(G) {
  return JSON.stringify({ world: G.world, game: G.game }, (_key, value) => {
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (Object.prototype.toString.call(value) === '[object Set]') return Array.from(value);
    if (Object.prototype.toString.call(value) === '[object Map]') return Array.from(value.entries());
    return value;
  });
}
function collisionSnapshot(G) {
  const out = [];
  for (let y = -1; y <= G.world.N; y++) for (let x = -1; x <= G.world.N; x++)
    out.push(!!G.tileBlocked(G.world, x, y));
  return out;
}
function digest(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok ' + name);
}

const allOptions = { waterV2: true, shore: true, lowFrequency: true, clutter: true };
// Keep the original four-toggle candidate as its own compatibility preset.
const variedOptions = { ...allOptions, shoreVariation: true };
const noOptions = { waterV2: false, shore: false, lowFrequency: false, clutter: false, shoreVariation: false };

function commandDigest(calls) {
  return digest(JSON.stringify(calls, (key, value) => key === 'canvas' ? undefined : value));
}

function recordingRender(options, season = 1, edit) {
  const h = harness({ N: 16 }), G = h.G, lab = install(h);
  G.game.season = season;
  lab.setOptions(options); G.buildGround();
  const full = commandDigest(G._gcv.getContext('2d').calls);
  if (!edit) return { h, lab, full };
  const calls = G._gcv.getContext('2d').calls;
  calls.length = 0;
  edit(G); G.buildGround();
  return { h, lab, full, partial: commandDigest(calls) };
}

function expectedShoreEdges(world, includeMapBoundary = false) {
  const edges = new Set();
  function edge(a, b) { return [a.join(','), b.join(',')].sort().join('|'); }
  for (let y = 0; y < world.N; y++) for (let x = 0; x < world.N; x++) {
    if (world.water[y * world.N + x] !== 1) continue;
    const neighbors = [[x, y - 1, [x, y], [x + 1, y]],
      [x + 1, y, [x + 1, y], [x + 1, y + 1]],
      [x, y + 1, [x, y + 1], [x + 1, y + 1]],
      [x - 1, y, [x, y], [x, y + 1]]];
    for (const [nx, ny, a, b] of neighbors) {
      const outside = nx < 0 || ny < 0 || nx >= world.N || ny >= world.N;
      if (outside && !includeMapBoundary) continue;
      if (outside || world.water[ny * world.N + nx] !== 1) edges.add(edge(a, b));
    }
  }
  return edges;
}

function polygonArea(points) {
  return points.reduce((area, a, i) => {
    const b = points[(i + 1) % points.length];
    return area + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
}

function insidePolygons(lines, x, y) {
  let inside = false;
  for (const { points } of lines) for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function maskFixtures() {
  return [
    ['dry map', () => false, 0],
    ['all-water map', () => true, 1],
    ['interior pond', (x, y) => x >= 3 && x <= 8 && y >= 2 && y <= 9, 1],
    ['edge-open water with island', (x, y) => x >= 2 && !(x >= 5 && x <= 7 && y >= 4 && y <= 7), 2],
    ['diagonal-only ponds', (x, y) => x === 4 && y === 4 || x === 5 && y === 5, 2],
    ['four edge exits', (x, y) => x === 5 || y === 5, 1],
    ['one-cell winding channel', (x, y) => y === 3 && x >= 2 && x <= 9 || x === 9 && y >= 3 && y <= 7 || y === 7 && x >= 2 && x <= 9 || x === 2 && y >= 7 && y <= 10, 1],
    ['diagonal touching land holes', (x, y) => !(x === 5 && y === 5 || x === 6 && y === 6)],
    ['checkerboard point contacts', (x, y) => (x + y) % 2 === 0, 72],
  ];
}

function setMask(world, shape) {
  for (let y = 0; y < world.N; y++) for (let x = 0; x < world.N; x++)
    world.water[y * world.N + x] = shape(x, y) ? 1 : (x + y) % 3 === 0 ? 2 : 0;
}

// Inspect the paths actually sent to Canvas.clip, not only the topology helper.
// Quadratic segments are flattened only for the independent containment oracle.
function recordedCurveMasks(calls) {
  let commands = [];
  const masks = [];
  for (const call of calls) {
    if (call[0] === 'beginPath') commands = [];
    else if (['moveTo', 'lineTo', 'quadraticCurveTo', 'closePath'].includes(call[0])) commands.push(call);
    else if (call[0] === 'clip' && commands.some(c => c[0] === 'quadraticCurveTo')) {
      const lines = [];
      let current;
      for (const [op, ...args] of commands) {
        if (op === 'moveTo') { current = { points: [args], closed: false }; lines.push(current); }
        else if (op === 'lineTo') current.points.push(args);
        else if (op === 'closePath') current.closed = true;
        else {
          const a = current.points.at(-1), [cx, cy, x, y] = args;
          for (let step = 1; step <= 16; step++) {
            const t = step / 16, u = 1 - t;
            current.points.push([u * u * a[0] + 2 * u * t * cx + t * t * x,
              u * u * a[1] + 2 * u * t * cy + t * t * y]);
          }
        }
      }
      masks.push({ rule: call[1], lines });
    }
  }
  return masks;
}

// Read the geometry actually submitted to gradient Canvas.fill calls. A pure
// profile or centerline test cannot catch cancellation in overlapping offsets.
function recordedGradientFills(calls) {
  const fills = [], stack = [];
  let style, lines = [], current;
  for (const [op, ...args] of calls) {
    if (op === 'save') stack.push(style);
    else if (op === 'restore') style = stack.pop();
    else if (op === 'set' && args[0] === 'fillStyle') style = args[1];
    else if (op === 'beginPath') { lines = []; current = null; }
    else if (op === 'moveTo') { current = { points: [args], closed: false }; lines.push(current); }
    else if (op === 'lineTo' && current) current.points.push(args);
    else if (op === 'closePath' && current) current.closed = true;
    else if (op === 'fill' && typeof style?.addColorStop === 'function') {
      const submitted = args[0]?.commands;
      let pathLines = lines;
      if (submitted) {
        pathLines = []; let pathLine;
        for (const [verb, ...points] of submitted) {
          if (verb === 'moveTo') { pathLine = { points: [points], closed: false }; pathLines.push(pathLine); }
          else if (verb === 'lineTo') pathLine.points.push(points);
          else if (verb === 'closePath') pathLine.closed = true;
          else assert.fail(`unexpected cached path operation: ${verb}`);
        }
      }
      fills.push({ rule: (submitted ? args[1] : args[0]) || 'nonzero', lines: pathLines });
    }
  }
  return fills;
}

// Keep recorder gradient objects unchanged so legacy command hashes stay strict.
// Stops are associated with their actual createLinearGradient call in draw order.
function recordedLinearGradients(calls) {
  const gradients = [];
  let current;
  for (const [op, ...args] of calls) {
    if (op === 'createLinearGradient') { current = { coordinates: args, stops: [] }; gradients.push(current); }
    else if (op === 'createRadialGradient') current = null;
    else if (op === 'addColorStop' && current) current.stops.push(args);
  }
  return gradients;
}

function rgba(color) {
  const channels = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(color);
  assert.ok(channels, `expected an explicit rgba shoreline stop, got ${color}`);
  return channels.slice(1).map(Number);
}

// Minimal Path2D substitute: exercises the fast-path contract without a native
// graphics dependency and keeps the submitted triangle commands inspectable.
function recordingPath2D() {
  const instances = [];
  class RecordedPath {
    constructor(source) { this.commands = source ? source.commands.map(command => command.slice()) : []; instances.push(this); }
    moveTo(...args) { this.commands.push(['moveTo', ...args]); }
    lineTo(...args) { this.commands.push(['lineTo', ...args]); }
    closePath() { this.commands.push(['closePath']); }
    addPath(source) { this.commands.push(...source.commands.map(command => command.slice())); }
  }
  return { Path2D: RecordedPath, instances };
}

function windingAt(lines, x, y) {
  let winding = 0;
  for (const { points } of lines) for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const side = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
    if (a[1] <= y && b[1] > y && side > 0) winding++;
    else if (a[1] > y && b[1] <= y && side < 0) winding--;
  }
  return winding;
}

function actualShoreEdges(lines) {
  const edges = new Set();
  for (const line of lines) {
    const points = plain(line.points);
    assert.ok(points.length >= 2, 'coastline has at least two points');
    for (const p of points) assert.ok(p.length === 2 && p.every(Number.isFinite), 'finite tile-space points');
    const chain = points.slice();
    if (line.closed && JSON.stringify(chain[0]) !== JSON.stringify(chain.at(-1))) chain.push(chain[0]);
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1], b = chain[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      assert.ok((dx === 0) !== (dy === 0), 'each source coast segment is an unbroken cardinal boundary');
      const length = Math.abs(dx || dy);
      assert.ok(Number.isInteger(length), 'source coast vertices lie on exact tile boundaries');
      for (let step = 0; step < length; step++) {
        const p = [a[0] + Math.sign(dx) * step, a[1] + Math.sign(dy) * step];
        const q = [p[0] + Math.sign(dx), p[1] + Math.sign(dy)];
        const key = [p.join(','), q.join(',')].sort().join('|');
        assert.ok(!edges.has(key), 'coast boundary must not be drawn twice');
        edges.add(key);
      }
    }
  }
  return edges;
}

function contracts() {
  test('production entrypoint does not load the river-bay candidate', () => {
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(!index.includes('riverbay-lab'), 'lab is opt-in through its own page');
    for (const name of ['core', 'map', 'sim', 'sprites', 'render', 'main'])
      assert.ok(!fs.readFileSync(path.join(root, `js/${name}.js`), 'utf8').includes('RiverbayTerrain'));
  });

  test('installation is opt-in and preserves simulation, collision, and navigation functions', () => {
    const h = harness(), G = h.G;
    const before = stateSnapshot(G), blocked = collisionSnapshot(G);
    const lab = install(h);
    assert.deepEqual(plain(lab.getOptions()), noOptions);
    assert.equal(stateSnapshot(G), before);
    assert.deepEqual(collisionSnapshot(G), blocked);
    for (const name of ['tileBlocked', 'findPath', 'genWorld', 'setRoad'])
      assert.equal(G[name], h.production[name], `${name} is unchanged`);
  });

  test('repeated switches never edit the world, consume RNG, or alter paths', () => {
    const h = harness(), G = h.G, lab = install(h);
    const blocked = collisionSnapshot(G), route = JSON.stringify(G.findPath(G.world, 1, 1, 3, 14));
    const before = stateSnapshot(G);
    G.rng = () => { throw new Error('candidate must not consume simulation RNG'); };
    vm.runInContext('Math.random = () => { throw new Error("candidate must not consume ambient RNG"); };', h.context);
    for (let turn = 0; turn < 3; turn++) {
      lab.setOptions(allOptions); G.buildGround();
      lab.getCoastlines();
      lab.setOptions(noOptions); G.buildGround();
    }
    assert.equal(stateSnapshot(G), before);
    assert.deepEqual(collisionSnapshot(G), blocked);
    assert.equal(JSON.stringify(G.findPath(G.world, 1, 1, 3, 14)), route);
  });

  test('unchanged options and warm camera frames do not rebuild cached ground', () => {
    const h = harness({ recordLimit: 0 }), G = h.G, lab = install(h);
    lab.setOptions(allOptions); G.buildGround();
    const builds = lab.metrics.fullBuilds + lab.metrics.partialBuilds;
    const cache = G._gcv, canvases = h.canvases.length;
    lab.setOptions(allOptions);
    assert.equal(G.needGround, false, 'no-op settings do not dirty the cache');
    for (const z of [.25, .5, .55, 1, 2]) for (const dpr of [1, 2, 3]) {
      G.cam.z = z; G.cam.x += 11; G.cam.y -= 5; G.dpr = dpr; G.frame(0);
    }
    assert.equal(lab.metrics.fullBuilds + lab.metrics.partialBuilds, builds);
    assert.equal(G._gcv, cache);
    assert.equal(h.canvases.length, canvases, 'camera movement allocates no surfaces');
  });

  test('interior shoreline, islands, diagonal contacts, and edge-open banks retain every boundary once', () => {
    const h = harness(), G = h.G, lab = install(h);
    const shapes = [
      (x, y) => x >= 5 && x <= 11 && y >= 4 && y <= 13,
      (x, y) => x >= 3 && x <= 17 && y >= 3 && y <= 18 && !(x >= 7 && x <= 10 && y >= 8 && y <= 11),
      (x, y) => (x === 6 && y === 6) || (x === 7 && y === 7),
      (x, y) => x >= 11 + Math.floor(Math.sin(y * .5) * 2),
    ];
    for (const shape of shapes) {
      for (let y = 0; y < G.world.N; y++) for (let x = 0; x < G.world.N; x++)
        G.world.water[y * G.world.N + x] = shape(x, y) ? 1 : 0;
      lab.invalidateTopology();
      const lines = lab.getCoastlines();
      assert.deepEqual([...actualShoreEdges(lines)].sort(), [...expectedShoreEdges(G.world)].sort());
      if (shape !== shapes.at(-1)) assert.ok(lines.every(line => line.closed), 'interior shorelines close without gaps');
      assert.equal(lines.length, shape === shapes[0] || shape === shapes[3] ? 1 : 2,
        'an island or diagonal-only contact remains a separate contour');
      for (const line of lines) assert.deepEqual(plain(line.bounds), {
        x0: Math.min(...line.points.map(point => point[0])), y0: Math.min(...line.points.map(point => point[1])),
        x1: Math.max(...line.points.map(point => point[0])), y1: Math.max(...line.points.map(point => point[1])),
      }, 'coast bounds accurately support local filtering');
    }
  });

  test('closed water polygons preserve map exits, holes, narrow channels, and point contacts', () => {
    const h = harness({ N: 12 }), lab = install(h), world = h.G.world;
    const waterPolygons = h.context.RiverbayTerrain.waterPolygons;
    assert.equal(typeof waterPolygons, 'function', 'full-water polygon topology is exported');
    for (const [name, shape, count] of maskFixtures()) {
      setMask(world, shape);
      const before = stateSnapshot(h.G), lines = waterPolygons(world);
      assert.equal(stateSnapshot(h.G), before, `${name}: tracing is read-only`);
      assert.ok(lines.every(line => line.closed), `${name}: fill contours must all close`);
      if (count !== undefined) assert.equal(lines.length, count, `${name}: component/contour count`);
      assert.deepEqual([...actualShoreEdges(lines)].sort(), [...expectedShoreEdges(world, true)].sort(), `${name}: every full boundary appears exactly once`);
      assert.equal(lines.reduce((sum, line) => sum + polygonArea(line.points), 0),
        world.water.filter(value => value === 1).length, `${name}: outer winding minus holes conserves water area`);
      for (const line of lines) for (const [x, y] of line.points)
        assert.ok(x >= 0 && x <= world.N && y >= 0 && y <= world.N, `${name}: bounded map coordinates`);
      for (let y = 0; y < world.N; y++) for (let x = 0; x < world.N; x++)
        assert.equal(insidePolygons(lines, x + .5, y + .5), world.water[y * world.N + x] === 1, `${name}: correct water/land parity at ${x},${y}`);
      assert.equal(JSON.stringify(waterPolygons(world)), JSON.stringify(lines), `${name}: deterministic ordering`);
      lab.invalidateTopology();
      assert.deepEqual([...actualShoreEdges(lab.getCoastlines())].sort(), [...expectedShoreEdges(world)].sort(), `${name}: public coastline remains interior-only`);
    }
  });

  test('renderer uses shared closed curved masks and inverse land parity instead of tile water clips', () => {
    for (const [name, shape] of maskFixtures().slice(2)) {
      const h = harness({ N: 12 }), G = h.G, lab = install(h);
      setMask(G.world, shape);
      lab.setOptions({ shore: true }); G.buildGround();
      const masks = recordedCurveMasks(G._gcv.getContext('2d').calls);
      assert.equal(masks.length, 2, `${name}: one continuous land mask and one water mask`);
      for (const mask of masks) {
        assert.equal(mask.rule, 'evenodd', `${name}: island holes use even-odd parity`);
        assert.ok(mask.lines.every(line => line.closed), `${name}: every rendered mask contour closes`);
      }
      const water = masks.find(mask => mask.lines.length === h.context.RiverbayTerrain.waterPolygons(G.world).length);
      const land = masks.find(mask => mask !== water);
      assert.ok(water && land, `${name}: masks contain topology loops, not per-tile diamonds`);
      assert.equal(land.lines.length, water.lines.length + 1, `${name}: inverse land adds only the world outline`);
      assert.deepEqual(land.lines.slice(1), water.lines, `${name}: water and land share identical curved geometry`);
      for (let y = 0; y < G.world.N; y++) for (let x = 0; x < G.world.N; x++) {
        const wet = G.world.water[y * G.world.N + x] === 1, center = G.T2S(x + .5, y + .5);
        assert.equal(insidePolygons(water.lines, ...center), wet, `${name}: smoothed mask preserves cell center ${x},${y}`);
        assert.equal(insidePolygons(land.lines, ...center), !wet, `${name}: land mask complements water at ${x},${y}`);
        if (!wet) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) if (x + dx < G.world.N && y + dy < G.world.N && G.world.water[(y + dy) * G.world.N + x + dx] === 1)
          assert.ok(insidePolygons(water.lines, ...G.T2S(x + .5 + dx / 2, y + .5 + dy / 2)), `${name}: narrow channel remains joined at ${x},${y}`);
      }
    }
  });

  test('low-frequency color overlays preserve every original tile and meadow draw', () => {
    const h = harness({ N: 12 }), G = h.G, tiles = [], meadows = [];
    const originalTile = G.drawGroundTile, originalSurface = G.fillTerrainSurface;
    G.drawGroundTile = function (c, w, pal, x, y) { tiles.push([x, y]); return originalTile(c, w, pal, x, y); };
    G.fillTerrainSurface = function (c, name, x, y) { if (name === 'meadow_summer') meadows.push([x, y]); return originalSurface(c, name, x, y); };
    G.SPR.map.set('meadow_summer', { width: 512, height: 512 });
    const lab = install(h);
    lab.setOptions({ lowFrequency: true }); G.buildGround();
    assert.equal(tiles.length, G.world.N ** 2, 'overlay does not replace any original ground tile');
    assert.equal(new Set(tiles.map(p => p.join(','))).size, G.world.N ** 2, 'each original tile is drawn once');
    const eligible = [];
    for (let y = 0; y < G.world.N; y++) for (let x = 0; x < G.world.N; x++)
      if (!G.world.water[y * G.world.N + x] && !G.world.road[y * G.world.N + x]) eligible.push([x, y]);
    assert.deepEqual(meadows.sort(), eligible.sort(), 'original detailed meadow is retained under color variation');
    const calls = G._gcv.getContext('2d').calls;
    const broadTransforms = calls.filter(call => call[0] === 'transform' && call.slice(1).join(',') === '8,4,-8,4,0,0');
    assert.equal(broadTransforms.length, 1, 'one broad color overlay avoids per-tile alpha accumulation');
    assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'globalAlpha' && call[2] > 0 && call[2] <= .3), 'broad overlay leaves at least 70% of original detail');
  });

  test('coastline caching is deterministic and invalidates only when requested', () => {
    const h = harness(), lab = install(h);
    const first = JSON.stringify(lab.getCoastlines()), builds = lab.metrics.topologyBuilds;
    assert.equal(JSON.stringify(lab.getCoastlines()), first);
    assert.equal(lab.metrics.topologyBuilds, builds);
    lab.setOptions(allOptions); h.G.buildGround();
    assert.equal(JSON.stringify(lab.getCoastlines()), first);
    lab.invalidateTopology();
    assert.equal(h.G.needGround, true);
    assert.equal(JSON.stringify(lab.getCoastlines()), first);
    assert.equal(lab.metrics.topologyBuilds, builds + 1);
  });

  test('settings and topology snapshots cannot leak mutable internal state', () => {
    const h = harness(), lab = install(h);
    const options = lab.getOptions(); options.shore = true;
    assert.equal(lab.getOptions().shore, false);
    const initial = JSON.stringify(lab.getCoastlines()), copy = lab.getCoastlines();
    copy[0].points[0][0] += 100;
    assert.equal(JSON.stringify(lab.getCoastlines()), initial);
    for (const invalid of [{ shore: 1 }, { unexpected: true }])
      assert.throws(() => lab.setOptions(invalid), /Invalid riverbay option/);
    assert.deepEqual(plain(lab.getOptions()), noOptions);
  });

  test('same seed and same options produce identical drawing commands', () => {
    function render() {
      const h = harness({ N: 16 }), lab = install(h);
      lab.setOptions(allOptions); h.G.buildGround();
      return JSON.stringify(h.G._gcv.getContext('2d').calls, (key, value) => key === 'canvas' ? undefined : value);
    }
    assert.equal(digest(render()), digest(render()));
  });

  test('shore variation defaults off and preserves the 2857b94 four-toggle drawing path', () => {
    // Captured from 2857b94 (also unchanged at 55761be), using only the
    // zero-dependency recorder. No native rasterizer/version assumptions.
    const legacy = [
      'c3af2f2c47dada18405ad748c38241c1207468f2eca98596601e27406df79fff',
      'a33614ae2132dc17728548b4082dfa62a466e5824e75c7ec1350cbc847140554',
      '7997b2932cc3c4a0cf08f2cd3dd3cbaaffca01490cbe1e6e0ed2c5bdbe57ee70',
      '8b7b56c0f8f6c3428fbc203d8d7d08a0bd8e0ca7fb47c91760103360688887f0',
    ];
    for (let season = 0; season < 4; season++) {
      const implicit = recordingRender(allOptions, season);
      const explicit = recordingRender({ ...allOptions, shoreVariation: false }, season);
      assert.equal(implicit.lab.getOptions().shoreVariation, false);
      assert.equal(implicit.h.context.RiverbayTerrain.defaults.shoreVariation, false);
      assert.equal(implicit.full, legacy[season], `season ${season}: unchanged legacy commands`);
      assert.equal(explicit.full, implicit.full, `season ${season}: explicit false equals omitted toggle`);
    }
  });

  test('shore variation is a full and dirty-render no-op without shore or during winter', () => {
    const edit = G => { G.world.road[8 * G.world.N + 3] = 1; G.markGroundDirty(3, 8); };
    for (const [options, season] of [[noOptions, 1], [{ ...allOptions, shore: false }, 1], [allOptions, 3]]) {
      const off = recordingRender({ ...options, shoreVariation: false }, season, edit);
      const on = recordingRender({ ...options, shoreVariation: true }, season, edit);
      assert.equal(on.full, off.full, `season ${season}, shore=${options.shore}: full visual no-op`);
      assert.equal(on.partial, off.partial, `season ${season}, shore=${options.shore}: dirty visual no-op`);
    }
    const baseline = recordingRender(allOptions), first = recordingRender(variedOptions), second = recordingRender(variedOptions);
    assert.notEqual(first.full, baseline.full, 'enabled variation exercises a different shoreline drawing path');
    assert.equal(first.full, second.full, 'enabled variation is deterministic');
    assert.deepEqual(recordedCurveMasks(first.h.G._gcv.getContext('2d').calls),
      recordedCurveMasks(baseline.h.G._gcv.getContext('2d').calls), 'variation does not change shared water/land masks');
  });

  test('shore variation leaves simulation, topology, collision, and RNG untouched', () => {
    const h = harness({ N: 16 }), G = h.G, lab = install(h);
    const blocked = collisionSnapshot(G), coast = JSON.stringify(lab.getCoastlines());
    const topologyBuilds = lab.metrics.topologyBuilds;
    const route = JSON.stringify(G.findPath(G.world, 1, 1, 3, 14));
    const before = stateSnapshot(G);
    G.rng = () => { throw new Error('variation must not consume simulation RNG'); };
    vm.runInContext('Math.random = () => { throw new Error("variation must not consume ambient RNG"); };', h.context);
    for (let repeat = 0; repeat < 3; repeat++) {
      lab.setOptions(variedOptions); G.buildGround();
      lab.setOptions({ shoreVariation: false }); G.buildGround();
    }
    assert.equal(stateSnapshot(G), before);
    assert.deepEqual(collisionSnapshot(G), blocked);
    assert.equal(JSON.stringify(G.findPath(G.world, 1, 1, 3, 14)), route);
    assert.equal(JSON.stringify(lab.getCoastlines()), coast);
    assert.equal(lab.metrics.topologyBuilds, topologyBuilds, 'style switches reuse topology');
    for (const invalid of [null, 0, 1, 'true', {}])
      assert.throws(() => lab.setOptions({ shoreVariation: invalid }), /Invalid riverbay option/);
    const options = lab.getOptions(); options.shoreVariation = true;
    assert.equal(lab.getOptions().shoreVariation, false, 'settings snapshots stay isolated');
  });

  test('shore width and color profiles are bounded, continuous, seeded, and fixed in world coordinates', () => {
    const h = harness({ N: 16 }), G = h.G, lab = install(h);
    const profile = h.context.RiverbayTerrain.shoreVariationProfile;
    assert.equal(typeof profile, 'function', 'the actual rendering profile is inspectable');
    const limits = { wetWidth: [8, 14, .15], shallowWidth: [8, 18, .15], tint: [0, 1, .015] };
    const points = [];
    for (let y = -64; y <= 64; y += 4) for (let x = -64; x <= 64; x += 4) points.push([x, y]);
    for (const seed of [0, 65, 66, 4294967295]) {
      const seen = { wetWidth: [], shallowWidth: [], tint: [] };
      for (const [x, y] of points) {
        const a = profile(seed, x, y);
        assert.deepEqual(plain(profile(seed, x, y)), plain(a), 'identical inputs reproduce exactly');
        const phase = ((seed >>> 0) % 4096) / 4096 * Math.PI * 2;
        const reach = .5 + .3 * Math.sin((x * .82 + y * .32) * Math.PI * 2 / 26 + phase)
          + .2 * Math.sin((y * .7 - x * .28) * Math.PI * 2 / 22 - phase * .4);
        assert.ok(Math.abs(a.wetWidth - (8 + 6 * reach)) < 1e-12, 'wet core retains its readable 8-pixel minimum');
        assert.ok(Math.abs(a.shallowWidth - (8 + 10 * (.65 * reach + .35 * (1 - a.tint)))) < 1e-12,
          'shallow width combines the broad reach and world tint with the intended weights');
        for (const [key, [min, max, slope]] of Object.entries(limits)) {
          assert.ok(Number.isFinite(a[key]) && a[key] >= min && a[key] <= max,
            `seed=${seed}, ${x},${y}: ${key}=${a[key]} outside ${min}..${max}`);
          seen[key].push(a[key]);
          // Inputs are tile-space world coordinates; 1/32 tile is roughly one
          // projected world pixel. Also straddle exact integer tile boundaries.
          for (const step of [1 / 32, .000001]) for (const [dx, dy] of [[step, 0], [0, step], [-step, 0], [0, -step]]) {
            const b = profile(seed, x + dx, y + dy);
            assert.ok(Math.abs(b[key] - a[key]) <= slope * 32 * step + 1e-10,
              `${key}: low-frequency field cannot jump at world/tile boundaries`);
          }
        }
      }
      assert.ok(Math.max(...seen.wetWidth) - Math.min(...seen.wetWidth) > 3, 'wet band actually varies in width');
      assert.ok(Math.max(...seen.shallowWidth) - Math.min(...seen.shallowWidth) > 3, 'shallow band actually varies in width');
      assert.ok(Math.max(...seen.tint) - Math.min(...seen.tint) > .2, 'world color field actually varies');
    }
    const values = seed => points.map(([x, y]) => plain(profile(seed, x, y)));
    const expected = values(65);
    assert.notDeepEqual(values(66), expected, 'seed chooses a distinct field');
    lab.setOptions(variedOptions); G.buildGround();
    for (const [z, dpr, x, y] of [[.25, 1, -200, 100], [.55, 3, 700, -310], [2, 2, 0, 0]]) {
      G.cam.z = z; G.cam.x = x; G.cam.y = y; G.dpr = dpr;
      assert.deepEqual(values(65), expected, 'pan, zoom, and DPR cannot move the world field');
    }
    G.groundScale = .25; G.needGround = true; G.buildGround();
    assert.deepEqual(values(65), expected, 'cache raster scale cannot move the world field');
    const snapshot = profile(65, 0, 0); snapshot.wetWidth = -100; snapshot.tint = -100;
    assert.deepEqual(plain(profile(65, 0, 0)), expected[points.findIndex(([x, y]) => x === 0 && y === 0)],
      'profile results do not expose mutable state');
  });

  test('period-14 shoreline tint and dense stop sampling cannot alias on a 32-tile world', () => {
    const h = harness({ N: 32 }), lab = install(h);
    const { shoreVariationProfile: profile, shoreColorStops: colorStops } = h.context.RiverbayTerrain;
    assert.equal(typeof colorStops, 'function', 'the actual color-stop sampler is inspectable');
    for (const seed of [0, 65, 66, 4095, 4294967295]) {
      const phase = ((seed >>> 0) % 4096) / 4096 * Math.PI * 2;
      for (const [x, y] of [[0, 0], [1.25, 5.5], [9, 23], [31.5, 31.5], [-7, 12]]) {
        const tint = profile(seed, x, y).tint;
        assert.ok(Math.abs(tint - (.5 + .5 * Math.sin((x + y) * Math.PI * 2 / 14 + phase * .5))) < 1e-12,
          'the rendered tint uses the intended 14-tile x+y period');
        assert.ok(Math.abs(profile(seed, x + 14, y).tint - tint) < 1e-12, 'one world period repeats');
        assert.ok(Math.abs(profile(seed, x, y + 7).tint + tint - 1) < 1e-12, 'half a period reaches the opposite tint');
        assert.ok(Math.abs(profile(seed, x + 3, y - 3).tint - tint) < 1e-12, 'equal x+y shares one tint');
      }
      for (const N of [12, 32, 128, 192, 256]) {
        const stops = plain(colorStops(seed, N));
        assert.deepEqual(stops, plain(colorStops(seed, N, 14)), 'explicit and default color periods agree');
        assert.equal(stops[0].offset, 0, 'the gradient begins at the world origin');
        assert.equal(stops.at(-1).offset, 1, 'the gradient reaches the opposite world corner');
        assert.ok(stops.length >= Math.ceil(2 * N / (14 / 8)) + 1, 'at least eight intervals sample every tint cycle');
        for (let i = 0; i < stops.length; i++) {
          const { offset, tint } = stops[i], sum = 2 * N * offset;
          assert.ok(Number.isFinite(offset) && offset >= 0 && offset <= 1 && Number.isFinite(tint) && tint >= 0 && tint <= 1);
          assert.ok(Math.abs(tint - profile(seed, sum / 2, sum / 2).tint) < 1e-12,
            'every color stop samples its actual projected world coordinate');
          if (!i) continue;
          const previous = stops[i - 1], gap = (offset - previous.offset) * 2 * N;
          assert.ok(gap > 0 && gap <= 14 / 8 + 1e-12, 'world-space stop spacing cannot undersample the color wave');
          for (const t of [.25, .5, .75]) {
            const at = previous.offset + (offset - previous.offset) * t;
            const interpolated = previous.tint + (tint - previous.tint) * t;
            assert.ok(Math.abs(interpolated - profile(seed, N * at, N * at).tint) < .04,
              'linear gradient interpolation retains the intended tint wave between stops');
          }
        }
        assert.ok(Math.max(...stops.map(stop => stop.tint)) - Math.min(...stops.map(stop => stop.tint)) > .95,
          `N=${N}: sampled stops retain almost the full tint range`);
        const saved = JSON.stringify(stops);
        const snapshot = colorStops(seed, N); snapshot[0].offset = -1; snapshot[0].tint = -1; snapshot.pop();
        assert.equal(JSON.stringify(colorStops(seed, N)), saved, 'color-stop results cannot mutate later renders');
      }
    }
    assert.deepEqual(plain(lab.getOptions()), noOptions, 'inspectable helpers do not enable rendering');
  });

  test('actual shoreline gradients follow world x+y with readable cores and darker wet inner edges', () => {
    const h = harness({ N: 32, seed: 65 }), G = h.G, lab = install(h);
    lab.setOptions({ shore: true, shoreVariation: true }); G.buildGround();
    const gradients = recordedLinearGradients(G._gcv.getContext('2d').calls);
    const expected = plain(h.context.RiverbayTerrain.shoreColorStops(G.world.seed, G.world.N));
    assert.equal(gradients.length, 6, 'three land and three water gradients are actually painted');
    const alphas = [.14, .48, .30, .12, .45, .24];
    const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    for (let layer = 0; layer < gradients.length; layer++) {
      const gradient = gradients[layer], water = layer >= 3;
      assert.deepEqual(gradient.coordinates, [...G.T2S(0, 0), ...G.T2S(G.world.N, G.world.N)],
        'the vertical projected gradient measures x+y, independent of x-y');
      assert.deepEqual(gradient.stops.map(stop => stop[0]), expected.map(stop => stop.offset),
        'Canvas receives the dense world-coordinate stops rather than a sparse approximation');
      const cool = water ? [94, 142, 151] : [127, 136, 100];
      const warm = water ? [133, 166, 155] : [165, 150, 110];
      for (let i = 0; i < expected.length; i++) {
        const color = rgba(gradient.stops[i][1]);
        assert.equal(color[3], alphas[layer], `layer ${layer}: readable alpha is explicit in every stop`);
        if (layer % 3 !== 2) assert.deepEqual(color.slice(0, 3), cool.map((v, j) => Math.round(v + (warm[j] - v) * expected[i].tint)),
          'outer and core colors use the tint from their actual world position');
        else {
          const core = rgba(gradients[layer - 1].stops[i][1]);
          assert.ok(luminance(color) <= luminance(core) - 15,
            'inner wet color is meaningfully darker than the core RGB, beyond an alpha-only change');
        }
      }
      const [x0, y0, x1, y1] = gradient.coordinates;
      for (const [x, y] of [[0, 16], [8, 8], [16, 0], [4, 28], [16, 16], [28, 4]]) {
        const [sx, sy] = G.T2S(x, y);
        const offset = ((sx - x0) * (x1 - x0) + (sy - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2);
        assert.ok(Math.abs(offset - (x + y) / (2 * G.world.N)) < 1e-12,
          'Canvas projection assigns matching offsets to all points with equal x+y');
      }
    }
    const baseline = plain(gradients);
    for (const [zoom, dpr, scale] of [[.25, 1, .25], [.55, 3, .5], [2, 2, 1]]) {
      G.cam.z = zoom; G.cam.x += 173; G.cam.y -= 89; G.dpr = dpr; G.groundScale = scale;
      G._gcv.getContext('2d').calls.length = 0; G.needGround = true; G.buildGround();
      assert.deepEqual(plain(recordedLinearGradients(G._gcv.getContext('2d').calls)), baseline,
        'camera, DPR, and raster scale cannot move or resample the world gradient');
    }
  });

  test('varied bands sample the shared curved mask with stable closed seams and exact map exits', () => {
    function segmentDistance(x, y, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length2)) : 0;
      return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
    }
    const pointSet = points => points.map(point => point.map(n => n.toFixed(9)).join(',')).sort();
    for (const [name, shape] of maskFixtures().slice(2)) {
      const h = harness({ N: 12 }), G = h.G, lab = install(h);
      const { sampleCurve, smoothRoute, shoreVariationProfile: profile } = h.context.RiverbayTerrain;
      assert.equal(typeof sampleCurve, 'function');
      assert.equal(typeof smoothRoute, 'function');
      setMask(G.world, shape); lab.setOptions({ shore: true, shoreVariation: true }); G.buildGround();
      const masks = recordedCurveMasks(G._gcv.getContext('2d').calls);
      const water = masks.find(mask => mask.lines.length === h.context.RiverbayTerrain.waterPolygons(G.world).length);
      assert.ok(water, `${name}: actual curved water clip exists`);
      const segments = water.lines.flatMap(line => line.points.map((p, i) => [p, line.points[(i + 1) % line.points.length]]));
      for (const coast of lab.getCoastlines()) {
        const route = smoothRoute(coast, G.world.N), before = JSON.stringify(route);
        const sampled = sampleCurve(route, G.world.N), points = plain(sampled.points);
        assert.equal(JSON.stringify(route), before, `${name}: sampling is read-only`);
        assert.equal(sampled.closed, coast.closed);
        assert.ok(points.length >= 2 && points.every(p => p.length === 2 && p.every(Number.isFinite)));
        assert.deepEqual(plain(sampleCurve(route, G.world.N)), plain(sampled), `${name}: sampling is deterministic`);
        for (const p of points) {
          const screen = G.T2S(...p);
          assert.ok(segments.some(([a, b]) => segmentDistance(...screen, a, b) <= .12),
            `${name}: band point follows the actual shared quadratic mask`);
        }
        for (let i = 0; i < points.length - Number(!sampled.closed); i++) {
          const a = points[i], b = points[(i + 1) % points.length];
          const sa = G.T2S(...a), sb = G.T2S(...b), distance = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
          assert.ok(distance > 0 && distance <= 18.01, `${name}: no duplicate or disconnected band samples`);
          const pa = profile(G.world.seed, ...a), pb = profile(G.world.seed, ...b);
          for (const key of ['wetWidth', 'shallowWidth'])
            assert.ok(Math.abs(pa[key] - pb[key]) <= .15 * distance + 1e-9,
              `${name}: ${key} stays continuous, including the closing seam`);
          assert.ok(Math.abs(pa.tint - pb.tint) <= .015 * distance + 1e-9,
            `${name}: color remains continuous across the closing seam`);
        }
        if (sampled.closed) {
          assert.notDeepEqual(points[0], points.at(-1), `${name}: closing point is not duplicated`);
          const rotated = { ...route, points: [...route.points.slice(1), route.points[0]] };
          assert.deepEqual(pointSet(plain(sampleCurve(rotated, G.world.N).points)), pointSet(points),
            `${name}: moving the closed contour seam cannot change band geometry`);
        } else {
          assert.deepEqual(points[0], plain(coast.points[0]), `${name}: open map entry is exact`);
          assert.deepEqual(points.at(-1), plain(coast.points.at(-1)), `${name}: open map exit is exact`);
        }
        const expected = JSON.stringify(sampled);
        G.cam.x += 173; G.cam.y -= 257; G.cam.z = .25; G.dpr = 3;
        assert.equal(JSON.stringify(sampleCurve(route, G.world.N)), expected, 'camera and DPR do not move sampled world points');
      }
    }
  });

  test('gradient band fills union folded offsets without holes in tiny ponds, land holes, or narrow channels', () => {
    const fixtures = [
      ['one-cell pond', (x, y) => x === 5 && y === 5, true, [[5, 5]]],
      ['one-cell land hole', (x, y) => x !== 5 || y !== 5, false, [[5, 5]]],
      ['one-cell bent channel', (x, y) => x === 5 && y >= 2 && y <= 9 || y === 9 && x >= 5 && x <= 9,
        true, [[5, 2], [5, 4], [5, 6], [5, 8], [5, 9], [7, 9], [9, 9]]],
    ];
    for (const [name, shape, wet, tiles] of fixtures) {
      const h = harness({ N: 12, seed: 65 }), G = h.G, lab = install(h);
      G.world.road.fill(0); G.world.rock.fill(0); setMask(G.world, shape);
      lab.setOptions({ shore: true, shoreVariation: true }); G.buildGround();
      const calls = G._gcv.getContext('2d').calls, fills = recordedGradientFills(calls);
      assert.equal(fills.length, 6, `${name}: three land and three water layers each use one union fill`);
      for (const fill of fills) {
        assert.equal(fill.rule, 'nonzero', `${name}: overlapping pieces use nonzero union`);
        assert.ok(fill.lines.length > 0);
        for (const line of fill.lines) {
          assert.ok(line.closed && line.points.length === 3, `${name}: fill contains closed local triangles`);
          assert.ok(polygonArea(line.points) > 0, `${name}: folded offsets never introduce opposite winding`);
        }
      }
      const masks = recordedCurveMasks(calls);
      const water = masks.find(mask => mask.lines.length === h.context.RiverbayTerrain.waterPolygons(G.world).length);
      const land = masks.find(mask => mask !== water), mask = wet ? water : land;
      assert.ok(mask, `${name}: the rendered side mask exists`);
      const { sampleCurve, smoothRoute, shoreVariationProfile: profile } = h.context.RiverbayTerrain;
      const samples = lab.getCoastlines().map(route => sampleCurve(smoothRoute(route, G.world.N), G.world.N));
      const minWidth = Math.min(...samples.flatMap(route => route.points.map(p => profile(G.world.seed, ...p)[wet ? 'shallowWidth' : 'wetWidth'])));
      const segments = samples.flatMap(route => {
        const p = route.points.map(point => G.T2S(...point));
        return p.slice(0, p.length - Number(!route.closed)).map((a, i) => [a, p[(i + 1) % p.length]]);
      });
      const distance = (x, y) => Math.min(...segments.map(([a, b]) => {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      }));
      const layers = fills.slice(wet ? 3 : 0, wet ? 6 : 3), widths = [minWidth * 1.2 + 2, minWidth, minWidth * .46];
      const checked = [0, 0, 0];
      for (const [tx, ty] of tiles) for (const dx of [-6, -3, 0, 3, 6]) for (const dy of [-6, -3, 0, 3, 6]) {
        const [cx, cy] = G.T2S(tx + .5, ty + .5), x = cx + dx, y = cy + dy;
        if (!insidePolygons(mask.lines, x, y)) continue;
        for (let layer = 0; layer < layers.length; layer++) {
          // Stay safely inside the nominal band, away from raster/normal
          // approximation edges. This still includes the old cancelled center.
          if (distance(x, y) >= widths[layer] - .75) continue;
          assert.ok(windingAt(layers[layer].lines, x, y) > 0,
            `${name}: layer ${layer} must cover ${x},${y}, distance=${distance(x, y)}, width>=${widths[layer]}`);
          checked[layer]++;
        }
      }
      assert.ok(checked.every(count => count > 0), `${name}: every layer exercised inside its band`);
      if (name === 'one-cell pond') {
        const center = G.T2S(5.5, 5.5);
        assert.deepEqual(plain(center), [0, 176]);
        assert.ok(distance(...center) < 6 && minWidth > 13, 'fixture retains the offset-folding regression geometry');
        for (const layer of [0, 1]) assert.ok(windingAt(layers[layer].lines, ...center) > 0,
          'pond center must not cancel when shallow width exceeds its radius');
      }
    }
  });

  test('open shoreline round caps cover oblique map-exit wedges on all four edges', () => {
    const exits = [
      ['top', (x, _y) => x >= 2, [2, 0], [2.5, .25]],
      ['bottom', (x, _y) => x <= 9, [10, 12], [9.5, 11.75]],
      ['left', (_x, y) => y >= 2, [0, 2], [.25, 2.5]],
      ['right', (_x, y) => y <= 9, [12, 10], [11.75, 9.5]],
    ];
    for (const [name, shape, endpoint, probe] of exits) {
      const h = harness({ N: 12, seed: 65 }), G = h.G, lab = install(h);
      G.world.road.fill(0); G.world.rock.fill(0); setMask(G.world, shape);
      lab.setOptions({ shore: true, shoreVariation: true }); G.buildGround();
      const calls = G._gcv.getContext('2d').calls, fills = recordedGradientFills(calls);
      assert.equal(fills.length, 6, `${name}: caps are included in existing single layer fills`);
      const masks = recordedCurveMasks(calls);
      const water = masks.find(mask => mask.lines.length === h.context.RiverbayTerrain.waterPolygons(G.world).length);
      const start = G.T2S(...endpoint), point = G.T2S(...probe), dx = point[0] - start[0], dy = point[1] - start[1];
      const distance = Math.hypot(dx, dy);
      const width = h.context.RiverbayTerrain.shoreVariationProfile(G.world.seed, ...endpoint).shallowWidth;
      assert.ok(insidePolygons(water.lines, ...point), `${name}: wedge probe is inside the actual water mask`);
      assert.ok(distance > 14.4 && distance < 14.5 && distance < width * 1.2 + 2,
        `${name}: regression probe lies inside the nominal outer cap`);
      assert.ok(windingAt(fills[3].lines, ...point) > 0, `${name}: outer shallow layer covers the old butt-cap wedge`);
      for (const [layer, radius] of [width * 1.2 + 2, width, width * .46].entries()) {
        const q = [start[0] + dx / distance * radius * .8, start[1] + dy / distance * radius * .8];
        assert.ok(insidePolygons(water.lines, ...q), `${name}: layer ${layer} probe stays in the shared mask`);
        assert.ok(windingAt(fills[layer + 3].lines, ...q) > 0,
          `${name}: layer ${layer} has no uncovered map-boundary wedge`);
      }
    }
  });

  test('cached triangle fallback and Path2D submit identical single-union layer geometry', () => {
    for (const [name, shape] of maskFixtures().slice(2)) {
      const outputs = [];
      for (const nativePath of [false, true]) {
        const recorder = recordingPath2D();
        const h = harness({ N: 12, Path2D: nativePath ? recorder.Path2D : undefined }), G = h.G, lab = install(h);
        setMask(G.world, shape); lab.setOptions({ shore: true, shoreVariation: true }); G.buildGround();
        const calls = G._gcv.getContext('2d').calls, fills = recordedGradientFills(calls);
        assert.equal(fills.length, 6, `${name}: cached routes still union into one fill for each side/layer`);
        assert.ok(fills.every(fill => fill.rule === 'nonzero'), 'cached paths preserve consistently wound triangle unions');
        const routes = lab.getCoastlines().length;
        assert.equal(lab.metrics.variationGeometryBuilds, routes, 'shared route sampling is built once for both sides');
        assert.equal(lab.metrics.variationPathBuilds, routes * 6, 'each route builds exactly six side/layer command sets');
        assert.equal(lab.metrics.variationCombinedPathBuilds, nativePath ? 6 : 0,
          'only Path2D builds combined paths, once per side/layer');
        if (nativePath) {
          assert.equal(recorder.instances.length, 6, 'Path2D allocates only one combined path per side/layer');
          assert.equal(calls.filter(call => call[0] === 'fill' && call[1] instanceof recorder.Path2D).length, 6,
            'the Canvas fast path receives all six actual cached Path2D objects');
        }
        outputs.push({ fills: plain(fills), gradients: plain(recordedLinearGradients(calls)) });
      }
      assert.deepEqual(outputs[1], outputs[0], `${name}: Path2D and command fallback submit the same geometry and colors`);
    }
  });

  test('shore geometry and layer paths reuse warm caches and invalidate with their topology', () => {
    for (const nativePath of [false, true]) {
      const recorder = recordingPath2D();
      const h = harness({ N: 24, Path2D: nativePath ? recorder.Path2D : undefined }), G = h.G, lab = install(h);
      setMask(G.world, (x, y) => x === 3 && y === 3 || x === 20 && y === 20);
      lab.setOptions({ shore: true, shoreVariation: true }); G.buildGround();
      let geometry = 2, layers = 12;
      assert.equal(lab.getCoastlines().length, 2, 'fixture exercises independently cached routes');
      const assertGeometry = message => {
        assert.equal(lab.metrics.variationGeometryBuilds, geometry, `${message}: route geometry builds`);
        assert.equal(lab.metrics.variationPathBuilds, layers, `${message}: side/layer command builds`);
      };
      assertGeometry('first render');
      const calls = G._gcv.getContext('2d').calls;
      const submittedPaths = () => calls.filter(call => call[0] === 'fill' && call[1] instanceof recorder.Path2D).map(call => call[1]);
      const initialPaths = submittedPaths(), initialCommands = nativePath ? initialPaths.map(p => JSON.stringify(p.commands)) : [];
      const initialCombined = lab.metrics.variationCombinedPathBuilds;
      for (let turn = 0; turn < 2; turn++) {
        calls.length = 0; G.needGround = true; G.buildGround();
        assertGeometry('repeated full render');
        assert.equal(lab.metrics.variationCombinedPathBuilds, initialCombined);
        if (nativePath) submittedPaths().forEach((path, i) => assert.equal(path, initialPaths[i], 'a repeated full render reuses identical Path2D objects'));
      }
      const full = lab.metrics.fullBuilds, partial = lab.metrics.partialBuilds;
      for (const zoom of [.25, .55, 1, 2]) { G.cam.z = zoom; G.cam.x += 17; G.cam.y -= 31; G.dpr = 3; G.frame(0); }
      assert.equal(lab.metrics.fullBuilds, full); assert.equal(lab.metrics.partialBuilds, partial);
      assertGeometry('warm camera frames');
      G.world.road[3 * G.world.N + 2] = 1;
      calls.length = 0; G.markGroundDirty(2, 3); G.buildGround();
      assert.equal(lab.metrics.partialBuilds, partial + 1, 'a road edit stays a local repair');
      assertGeometry('first local road repair');
      const localPaths = submittedPaths(), localCombined = lab.metrics.variationCombinedPathBuilds;
      for (let repeat = 0; repeat < 3; repeat++) {
        calls.length = 0; G.markGroundDirty(2, 3); G.buildGround();
        assertGeometry('repeated local repair');
        assert.equal(lab.metrics.variationCombinedPathBuilds, localCombined, 'the same selected route set reuses combined paths');
        if (nativePath) submittedPaths().forEach((path, i) => assert.equal(path, localPaths[i], 'local repair reuses its exact Path2D object'));
      }
      lab.setOptions({ shoreVariation: false }); G.buildGround();
      assertGeometry('switch off');
      calls.length = 0; lab.setOptions({ shoreVariation: true }); G.buildGround();
      assertGeometry('switch back on');
      if (nativePath) submittedPaths().forEach((path, i) => assert.equal(path, initialPaths[i], 'style switches reuse the original full-route paths'));
      for (const scale of [.25, .5, 1]) {
        G.groundScale = scale; G.needGround = true; G.buildGround();
        assertGeometry('raster-scale change');
      }
      G.game.season = 2; G.needGround = true; G.buildGround();
      assertGeometry('nonwinter season change');
      if (nativePath) assert.deepEqual(initialPaths.map(p => JSON.stringify(p.commands)), initialCommands,
        'repair, scale, season, and toggles cannot mutate cached triangle commands');
      calls.length = 0; lab.invalidateTopology(); G.buildGround(); geometry += 2; layers += 12;
      assertGeometry('explicit topology invalidation');
      if (nativePath) for (const path of submittedPaths()) assert.ok(!initialPaths.includes(path), 'invalidation cannot retain a stale combined Path2D');
      G.world = fixture(G, 24, 66); G.markGroundDirty(4, 4); G.buildGround();
      const routes = lab.getCoastlines().length; geometry += routes; layers += routes * 6;
      assertGeometry('replacement seeded world');
      const pathsAfterReplacement = lab.metrics.variationCombinedPathBuilds;
      G.needGround = true; G.buildGround(); assertGeometry('replacement warm render');
      assert.equal(lab.metrics.variationCombinedPathBuilds, pathsAfterReplacement);
      if (!nativePath) assert.equal(lab.metrics.variationCombinedPathBuilds, 0, 'command fallback never depends on Path2D');
    }
  });

  test('variation switches, warm frames, and local edits retain cache invalidation rules', () => {
    const h = harness({ N: 24, recordLimit: 0 }), G = h.G, lab = install(h);
    lab.setOptions(allOptions); G.buildGround();
    const cache = G._gcv, canvases = h.canvases.length, topology = lab.metrics.topologyBuilds;
    const material = lab.metrics.materialBuilds;
    let full = lab.metrics.fullBuilds;
    lab.setOptions({ shoreVariation: true });
    assert.equal(G.needGround, true, 'an effective style change invalidates ground once');
    G.buildGround();
    assert.equal(lab.metrics.fullBuilds, ++full);
    assert.equal(G._gcv, cache);
    lab.setOptions({ shoreVariation: true });
    assert.equal(G.needGround, false, 'setting an unchanged variation flag is a no-op');
    const partial = lab.metrics.partialBuilds;
    for (const z of [.25, .5, .55, 1, 2]) for (const dpr of [1, 2, 3]) {
      G.cam.z = z; G.cam.x += 11; G.cam.y -= 5; G.dpr = dpr; G.frame(0);
    }
    assert.equal(lab.metrics.fullBuilds, full);
    assert.equal(lab.metrics.partialBuilds, partial);
    G.world.road[12 * G.world.N + 10] = 1; G.markGroundDirty(10, 12); G.buildGround();
    assert.equal(lab.metrics.fullBuilds, full);
    assert.equal(lab.metrics.partialBuilds, partial + 1);
    assert.ok(lab.metrics.lastTileDraws > 0 && lab.metrics.lastTileDraws < G.world.N ** 2);
    assert.equal(G._gcv, cache);
    assert.equal(h.canvases.length, canvases, 'width/color variation allocates no extra surface');
    assert.equal(lab.metrics.topologyBuilds, topology);
    assert.equal(lab.metrics.materialBuilds, material);
    lab.setOptions({ shoreVariation: false }); G.buildGround();
    assert.equal(lab.metrics.fullBuilds, ++full);
    const assertFull = (change, message) => {
      change(); G.markGroundDirty(4, 4); G.buildGround();
      assert.equal(lab.metrics.fullBuilds, ++full, message);
      assert.equal(lab.metrics.lastTileDraws, G.world.N ** 2);
      assert.equal(G._gcv, cache);
    };
    lab.setOptions({ shoreVariation: true }); G.buildGround(); full++;
    assertFull(() => { G.world = fixture(G, 24, 66); }, 'variation rejects a stale world cache');
    assertFull(() => { G.groundScale += 1e-8; }, 'variation rejects a stale fractional scale');
    assertFull(() => { G.world.water[4 * G.world.N + 4] = 1; lab.invalidateTopology(); }, 'variation honors explicit topology changes');
  });

  test('dirty repairs remain local and reuse the full-world cache', () => {
    const h = harness({ N: 128, recordLimit: 0 }), G = h.G, lab = install(h);
    lab.setOptions(allOptions); G.buildGround();
    const cache = G._gcv, builds = lab.metrics.fullBuilds, partials = lab.metrics.partialBuilds;
    const allocations = h.allocations.length;
    G.world.road[64 * 128 + 20] = 1; G.markGroundDirty(20, 64); G.buildGround();
    assert.equal(G._gcv, cache);
    assert.equal(lab.metrics.fullBuilds, builds, 'dirty road does not trigger a full rebuild');
    assert.equal(lab.metrics.partialBuilds, partials + 1);
    assert.ok(lab.metrics.lastTileDraws > 0 && lab.metrics.lastTileDraws < 128 * 128 / 10,
      `dirty repair must be bounded, got ${lab.metrics.lastTileDraws} tiles`);
    assert.equal(h.allocations.length, allocations, 'local repairs never resize the cache');
    assert.equal(G.groundDirty.size, 0);
  });

  test('new worlds, scale changes, and explicit topology edits force safe full rebuilds', () => {
    const h = harness({ recordLimit: 0 }), G = h.G, lab = install(h);
    lab.setOptions(allOptions); G.buildGround();
    const cache = G._gcv;
    const assertFull = (action, reason) => {
      const full = lab.metrics.fullBuilds;
      action(); G.markGroundDirty(4, 4); G.buildGround();
      assert.equal(lab.metrics.fullBuilds, full + 1, reason);
      assert.equal(lab.metrics.lastTileDraws, G.world.N ** 2);
      assert.equal(G._gcv, cache, 'full invalidations reuse the allocated ground surface');
      assert.equal(G._groundWorld, G.world);
      assert.equal(G._groundScale, G.groundScale);
    };
    const topology = lab.metrics.topologyBuilds, material = lab.metrics.materialBuilds;
    assertFull(() => { G.world = fixture(G, 24, 66); }, 'a same-sized replacement world cannot use stale terrain');
    assert.equal(lab.metrics.topologyBuilds, topology + 1);
    assert.equal(lab.metrics.materialBuilds, material + 1);
    assertFull(() => { G.groundScale += 1e-8; }, 'fractional scale changes repaint even when dimensions round identically');
    assertFull(() => {
      G.world.water[8 * G.world.N + 4] = 1;
      lab.invalidateTopology();
    }, 'explicit mask edits rebuild the shoreline and cache');
    assert.deepEqual([...actualShoreEdges(lab.getCoastlines())].sort(), [...expectedShoreEdges(G.world)].sort());
  });

  test('128/192/256 candidates preserve the 16-million-pixel ground budget and one large cache', () => {
    for (const N of [128, 192, 256]) {
      const h = harness({ N, recordLimit: 0 }), G = h.G, lab = install(h);
      lab.setOptions(allOptions); G.groundScale = 1; G.buildGround();
      assert.ok(G._gcv.width * G._gcv.height <= CAP);
      assert.equal(G._groundWorld, G.world);
      assert.equal(G._groundScale, G.groundScale);
      assert.equal(h.canvases.filter(canvas => canvas.width * canvas.height > 512 * 512).length, 1,
        'materials may be small but a second full-world cache is prohibited');
      const cache = G._gcv;
      lab.setOptions(noOptions); G.buildGround();
      assert.equal(G._gcv, cache, 'switching off reuses the same ground cache');
    }
  });

  test('128/192/256 varied shores retain the 16-million-pixel budget and one large cache', () => {
    for (const N of [128, 192, 256]) {
      const h = harness({ N, recordLimit: 0 }), G = h.G, lab = install(h);
      lab.setOptions(variedOptions); G.groundScale = 1; G.buildGround();
      assert.ok(G._gcv.width * G._gcv.height <= CAP);
      assert.equal(G._groundWorld, G.world);
      assert.equal(G._groundScale, G.groundScale);
      assert.equal(h.canvases.filter(canvas => canvas.width * canvas.height > 512 * 512).length, 1);
      const cache = G._gcv, allocations = h.allocations.length, full = lab.metrics.fullBuilds;
      G.world.road[Math.floor(N / 2) * N + 20] = 1;
      G.markGroundDirty(20, Math.floor(N / 2)); G.buildGround();
      assert.equal(lab.metrics.fullBuilds, full);
      assert.ok(lab.metrics.lastTileDraws > 0 && lab.metrics.lastTileDraws < N * N / 10);
      assert.equal(h.allocations.length, allocations);
      lab.setOptions(noOptions); G.buildGround();
      assert.equal(G._gcv, cache);
    }
  });
}

async function pixels() {
  let createCanvas, loadImage, Path2D;
  try { ({ createCanvas, loadImage, Path2D } = require('@napi-rs/canvas')); }
  catch (error) { throw new Error('--pixels requires optional @napi-rs/canvas', { cause: error }); }
  const waterImage = await loadImage(path.join(root, 'tools/riverbay-lab/water-open-candidate-v2.png'));
  const meadowImage = await loadImage(path.join(root, 'assets/terrain-v2/meadow_summer.png'));
  const originalWaterImage = await loadImage(path.join(root, 'assets/terrain-v2/water_open.png'));
  const bitmap = G => Buffer.from(G._gcv.getContext('2d').getImageData(0, 0, G._gcv.width, G._gcv.height).data);
  test('native Path2D and cached command fallback render byte-identical shores and dirty repairs', () => {
    assert.equal(typeof Path2D, 'function', 'native pixel checks include the browser-style Path2D fast path');
    const fixtures = [['open shore', 16, null], ['checkerboard point contacts', 12, (x, y) => (x + y) % 2 === 0]];
    for (const [name, N, shape] of fixtures) for (const scale of [.25, .55, 1]) {
      const outputs = [];
      for (const nativePath of [false, true]) {
        const h = harness({ createCanvas, N, Path2D: nativePath ? Path2D : undefined }), G = h.G;
        if (shape) setMask(G.world, shape);
        G.SPR.map.set('meadow_summer', meadowImage); G.SPR.map.set('water_open', originalWaterImage);
        const lab = install(h, { waterImage }); lab.setOptions(variedOptions); G.groundScale = scale; G.buildGround();
        const snapshots = [digest(bitmap(G))];
        const x = Array.from(G.world.water.slice(8 * G.world.N, 9 * G.world.N)).indexOf(2);
        assert.ok(x >= 0, `${name}: dirty parity fixture has a shore tile`);
        for (const value of [1, 2, 0]) {
          G.world.road[8 * G.world.N + x] = value; G.markGroundDirty(x, 8); G.buildGround(); snapshots.push(digest(bitmap(G)));
          G.markGroundDirty(x, 8); G.buildGround();
          assert.equal(digest(bitmap(G)), snapshots.at(-1), 'both cache paths keep dirty repeats byte-stable');
        }
        outputs.push(snapshots);
        for (const canvas of h.canvases) { canvas.width = 1; canvas.height = 1; }
        global.gc?.();
      }
      assert.deepEqual(outputs[1], outputs[0], `${name}, scale=${scale}: native and fallback pixels must agree after full and partial builds`);
    }
  });
  global.gc?.();
  test('all-off pixels and switch round-trips exactly match the textured production renderer', () => {
    const h = harness({ createCanvas, N: 16 }), G = h.G;
    G.SPR.map.set('meadow_summer', meadowImage); G.SPR.map.set('water_open', originalWaterImage);
    G.buildGround(); const baseline = bitmap(G);
    const lab = install(h, { waterImage }); G.needGround = true; G.buildGround();
    assert.equal(digest(bitmap(G)), digest(baseline));
    for (let repeat = 0; repeat < 2; repeat++) {
      lab.setOptions(allOptions); G.buildGround();
      lab.setOptions(noOptions); G.buildGround();
      assert.equal(digest(bitmap(G)), digest(baseline), 'switching the candidate off restores exact original pixels');
      assert.equal(G.SPR.get('water_open'), originalWaterImage, 'candidate water never replaces the original asset');
    }
    for (const canvas of h.canvases) { canvas.width = 1; canvas.height = 1; }
  });
  global.gc?.();
  test('low-frequency overlays retain the real meadow texture detail signal', () => {
    const h = harness({ createCanvas, N: 12 }), G = h.G;
    G.world.water.fill(0); G.world.road.fill(0); G.world.rock.fill(0);
    G.SPR.map.set('meadow_summer', meadowImage); G.groundScale = 1;
    G.buildGround(); const baseline = bitmap(G);
    const lab = install(h, { waterImage }); lab.setOptions({ lowFrequency: true }); G.buildGround();
    const candidate = bitmap(G), W = G._gcv.width, H = G._gcv.height;
    let baseEnergy = 0, candidateEnergy = 0, dot = 0, baseSquare = 0, candidateSquare = 0, samples = 0, changed = 0;
    const light = (pixels, i) => .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
    for (let py = 0; py < H - 1; py++) for (let px = 0; px < W - 1; px++) {
      const sx = px + .5 - G.groundOX, sy = py + .5 - G.groundOY;
      const x = sx / 64 + sy / 32, y = sy / 32 - sx / 64;
      if (x < 2 || y < 2 || x >= G.world.N - 2 || y >= G.world.N - 2) continue;
      const i = (py * W + px) * 4;
      changed += Number(candidate[i] !== baseline[i] || candidate[i + 1] !== baseline[i + 1] || candidate[i + 2] !== baseline[i + 2]);
      for (const offset of [4, W * 4]) {
        const a = light(baseline, i + offset) - light(baseline, i), b = light(candidate, i + offset) - light(candidate, i);
        baseEnergy += Math.abs(a); candidateEnergy += Math.abs(b); dot += a * b;
        baseSquare += a * a; candidateSquare += b * b; samples++;
      }
    }
    const ratio = candidateEnergy / baseEnergy, correlation = dot / Math.sqrt(baseSquare * candidateSquare);
    assert.ok(samples > 10000 && baseEnergy / samples > .1, 'actual meadow image contributes measurable fine detail');
    assert.ok(changed > samples / 8, 'broad overlay visibly changes the meadow color field');
    assert.ok(ratio >= .65 && ratio <= 1.1, `original fine-detail energy is retained: ratio=${ratio}`);
    assert.ok(correlation >= .9, `fine detail remains aligned with the original meadow: correlation=${correlation}`);
    console.log(`  meadow detail: energy ratio=${ratio.toFixed(3)}, gradient correlation=${correlation.toFixed(3)}`);
    for (const canvas of h.canvases) { canvas.width = 1; canvas.height = 1; }
  });
  global.gc?.();
  function auditShoreProtection(options) {
    const h = harness({ createCanvas, N: 16 }), G = h.G;
    G.SPR.map.set('meadow_summer', meadowImage); G.SPR.map.set('water_open', originalWaterImage);
    const protectedTiles = [];
    for (const [y, property, value] of [[3, 'road', 1], [7, 'road', 2], [11, 'rock', 2]]) {
      const x = Array.from(G.world.water.slice(y * G.world.N, (y + 1) * G.world.N)).indexOf(2);
      G.world[property][y * G.world.N + x] = value; protectedTiles.push([x, y]);
    }
    G.groundScale = 1; G.buildGround(); const baseline = bitmap(G);
    const lab = install(h, { waterImage }); lab.setOptions(options); G.buildGround();
    const candidate = bitmap(G), W = G._gcv.width;
    for (const [x, y] of protectedTiles) for (let u = .2; u <= .8; u += .1) for (let v = .2; v <= .8; v += .1) {
      const [sx, sy] = G.T2S(x + u, y + v), px = Math.round(sx + G.groundOX), py = Math.round(sy + G.groundOY), i = (py * W + px) * 4;
      assert.deepEqual(candidate.subarray(i, i + 4), baseline.subarray(i, i + 4), `shore must not repaint road/rock interior at ${x},${y}`);
    }
    const segments = [];
    for (const line of lab.getCoastlines()) {
      const points = line.points.map(point => G.T2S(...point));
      for (let i = 0; i < points.length - Number(!line.closed); i++) segments.push([points[i], points[(i + 1) % points.length]]);
    }
    function distanceSquared(x, y, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
      return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2;
    }
    let changed = 0;
    for (let i = 0; i < candidate.length; i += 4) {
      if (candidate[i] === baseline[i] && candidate[i + 1] === baseline[i + 1] && candidate[i + 2] === baseline[i + 2] && candidate[i + 3] === baseline[i + 3]) continue;
      changed++;
      const x = i / 4 % W + .5 - G.groundOX, y = Math.floor(i / 4 / W) + .5 - G.groundOY;
      assert.ok(segments.some(([a, b]) => distanceSquared(x, y, a, b) <= 80 ** 2), 'shore edits are confined to a bounded continuous coast ribbon');
    }
    assert.ok(changed > 100, 'fixture exercises actual shoreline reconstruction');
    for (const canvas of h.canvases) { canvas.width = 1; canvas.height = 1; }
  }
  test('shore reconstruction stays in its coast ribbon and preserves road and rock interiors',
    () => auditShoreProtection({ shore: true }));
  global.gc?.();
  test('varied wet/shallow bands stay in the coast ribbon and preserve road and rock interiors',
    () => auditShoreProtection({ shore: true, shoreVariation: true }));
  global.gc?.();
  function auditDirtyRepairs(options, label) {
    let auditedChanges = 0, worstOutsideCount = 0, worstOutsideDelta = 0, worstInsideDelta = 0, worstInsideMean = 0;
    for (const scale of [.25, .5, 1]) {
      const h = harness({ createCanvas, N: 16 }), G = h.G, lab = install(h, { waterImage });
      G.SPR.map.set('meadow_summer', meadowImage); G.SPR.map.set('water_open', originalWaterImage);
      lab.setOptions(options); G.groundScale = scale; G.buildGround();
      const bankAt = y => Array.from(G.world.water.slice(y * G.world.N, (y + 1) * G.world.N)).indexOf(2);
      const changes = [
        [3, 8, 'road', 1], [3, 8, 'road', 2], [3, 8, 'road', 0],
        [2, 2, 'rock', 0], [2, 3, 'rock', 0],
        [5, 11, 'road', 1], [5, 11, 'road', 0],
        [0, 0, 'road', 1], [0, 0, 'road', 0],
        [1, 15, 'road', 1], [1, 15, 'road', 0],
        [bankAt(8), 8, 'road', 1], [bankAt(8), 8, 'road', 2], [bankAt(8), 8, 'road', 0],
        [bankAt(1), 1, 'rock', 1], [bankAt(1), 1, 'rock', 2], [bankAt(1), 1, 'rock', 0],
      ];
      for (const [x, y, property, value] of changes) {
        const previous = bitmap(G);
        G.world[property][y * G.world.N + x] = value;
        G.markGroundDirty(x, y); G.buildGround();
        const partial = bitmap(G);
        // Clearing the integer pixel repair rectangle must make a second repair
        // exactly idempotent, even though Skia's clipped/unclipped raster paths
        // can differ by a few channels at anti-aliased edges.
        for (let repeat = 0; repeat < 3; repeat++) {
          G.markGroundDirty(x, y); G.buildGround();
          assert.equal(digest(bitmap(G)), digest(partial), 'repeated repair must not darken or grow an alpha halo');
        }
        G.needGround = true; G.buildGround();
        const complete = bitmap(G), W = G._gcv.width;
        G.needGround = true; G.buildGround();
        assert.equal(digest(bitmap(G)), digest(complete), 'a repeated full render is byte-stable');
        const [sx, sy] = G.T2S(x, y);
        const r = { x0: Math.max(0, Math.floor((sx - 80 + G.groundOX) * scale)),
          x1: Math.min(W, Math.ceil((sx + 80 + G.groundOX) * scale)),
          y0: Math.max(0, Math.floor((sy - 48 + G.groundOY) * scale)),
          y1: Math.min(G._gcv.height, Math.ceil((sy + 80 + G.groundOY) * scale)) };
        let changed = 0, max = 0, total = 0, outsideChanged = 0, outsideMax = 0;
        for (let i = 0; i < partial.length; i += 4) {
          const px = i / 4 % W, py = Math.floor(i / 4 / W);
          const inRepair = px >= r.x0 && px < r.x1 && py >= r.y0 && py < r.y1;
          if (!inRepair) for (let channel = 0; channel < 4; channel++)
            assert.equal(partial[i + channel], previous[i + channel], 'dirty repair must leave distant cached pixels byte-identical');
          let delta = 0;
          for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(partial[i + channel] - complete[i + channel]));
          if (!delta) continue;
          if (!inRepair) {
            // The actual repair remains byte-identical outside its rectangle
            // (asserted against previous above). Changing a hole in the full
            // compound protection clip can reround a handful of distant
            // shoreline/ribbon AA samples in the independently rebuilt full
            // reference. This is bounded separately from interior tolerance.
            outsideChanged++; outsideMax = Math.max(outsideMax, delta);
            assert.ok(delta <= 2, `scale=${scale}, ${property}(${x},${y})=${value}: remote full-reference AA delta=${delta} at ${px},${py}`);
            continue;
          }
          changed++; max = Math.max(max, delta); total += delta;
        }
        const area = (r.x1 - r.x0) * (r.y1 - r.y0);
        const diagnostic = `scale=${scale}, ${property}(${x},${y})=${value}: ${changed} pixels, max=${max}, mean=${total / area}`;
        assert.ok(max <= 32 && changed <= area * .12 && total / area <= .25, diagnostic);
        assert.ok(outsideChanged <= 16, `${diagnostic}, too many remote full-reference AA samples: ${outsideChanged}`);
        auditedChanges++; worstOutsideCount = Math.max(worstOutsideCount, outsideChanged);
        worstOutsideDelta = Math.max(worstOutsideDelta, outsideMax); worstInsideDelta = Math.max(worstInsideDelta, max);
        worstInsideMean = Math.max(worstInsideMean, total / area);
        global.gc?.();
      }
      for (const canvas of h.canvases) { canvas.width = 1; canvas.height = 1; }
      global.gc?.();
    }
    console.log(`  ${label} repair audit: ${auditedChanges} edits, ${auditedChanges * 3} byte-stable repeats; actual outside changes=0; full-reference outside max=${worstOutsideCount} pixels/${worstOutsideDelta} levels; inside max=${worstInsideDelta}, mean<=${worstInsideMean.toFixed(4)}`);
  }
  test('candidate dirty road/rock repairs stay within raster tolerance and never accumulate alpha',
    () => auditDirtyRepairs(allOptions, 'legacy'));
  global.gc?.();
  test('varied-shore dirty repairs leave actual outside pixels exact and never accumulate alpha',
    () => auditDirtyRepairs(variedOptions, 'variation'));
}

if (require.main === module) {
  (async () => {
    contracts();
    if (process.argv.includes('--pixels')) await pixels();
    console.log(`River-bay lab: ${passed} contract groups passed${process.argv.includes('--pixels') ? ' (including native pixels)' : ''}.`);
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { harness, install, fixture, recordingContext, stateSnapshot, collisionSnapshot, plain, digest };
