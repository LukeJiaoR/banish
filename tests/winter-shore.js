'use strict';
// Original-asset winter coastline checks. Native Canvas is optional, never a
// browser/mobile acceptance claim. No simulation tick or user save is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
global.window = global;
for (const name of ['core', 'defs', 'map', 'sim', 'sprites', 'render']) require('../js/' + name);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function recordingContext() {
  const calls = [];
  return new Proxy({ calls, createPattern: image => ({ image }), globalAlpha: 1 }, {
    get: (o, k) => k in o ? o[k] : (...args) => calls.push([k, ...args]),
    set: (o, k, v) => { o[k] = v; calls.push(['set', k, v]); return true; }
  });
}
function fixture() {
  const w = G.emptyWorld(7, 0, 12);
  for (let y = 0; y < w.N; y++) for (let x = 0; x < w.N; x++)
    w.water[y * w.N + x] = x >= 6 ? 1 : x === 5 ? 2 : 0;
  return w;
}
const iceName = 'water_winter';
const icePath = path.join(__dirname, '../assets/tiles/water_winter.png');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
test('the original alpha-edged ice asset is byte-identical', () => {
  assert.equal(hash(fs.readFileSync(icePath)), 'a732499384e56964404c751d3ae349902344a66a10c6cc134132e27413c78466');
});
global.document = { createElement() { const ctx = recordingContext(); return { getContext: () => ctx }; } };
test('winter atlas retains the original diamond projection on an opaque 64x32 backing', () => {
  const c = recordingContext(), ice = { width: 86, height: 83 };
  G.SPR.map.set(iceName, ice); G.game = { season: 3 };
  assert(G.coastPresentation.fillWinterWater(c, 6, 5, G.PAL[3]));
  const atlas = c.calls.find(v => v[0] === 'set' && v[1] === 'fillStyle' && v[2]?.image)?.[2].image;
  assert.equal(atlas.width, 64); assert.equal(atlas.height, 32);
  const calls = atlas.getContext('2d').calls;
  assert.deepEqual(calls[0], ['set', 'fillStyle', G.PAL[3].water]);
  assert.deepEqual(calls[1], ['fillRect', 0, 0, 64, 32]);
  const stamps = calls.filter(v => v[0] === 'drawImage'); assert(stamps.length > 0);
  assert(stamps.every(v => v[1] === ice && v[4] === 65 && v[5] === 33));
  assert(!c.calls.some(v => v[0] === 'transform'));
});
test('winter coast requires ice, never silently substitutes summer open water', () => {
  const w = fixture(), c = recordingContext(); G.game = { season: 3 };
  G.SPR.map.set('meadow_winter', { width: 512, height: 512 });
  G.SPR.map.set('water_open', { width: 512, height: 512 });
  G.SPR.map.delete(iceName); assert.equal(G.coastPresentation.active(c, w), false);
  assert.equal(G.coastPresentation.fillWinterWater(c, 6, 5, G.PAL[3]), false);
  G.SPR.map.set(iceName, { width: 86, height: 83 }); assert(G.coastPresentation.active(c, w));
  const unavailable = recordingContext(); unavailable.createPattern = () => null;
  assert.equal(G.coastPresentation.active(unavailable, w), false);
});
async function nativePixels() {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  global.document = { createElement: () => createCanvas(1, 1) };
  G.ui = { toast() {} };
  for (const season of G.TEX_SEASON) for (const [prefix, dir] of [['meadow_', 'terrain-v2'], ['sand_', 'tiles'], ['road_', 'tiles'], ['water_', 'tiles']]) {
    const name = prefix + season;
    G.SPR.map.set(name, await loadImage(path.join(__dirname, '../assets', dir, name + '.png')));
  }
  G.SPR.map.set('water_open', await loadImage(path.join(__dirname, '../assets/terrain-v2/water_open.png')));
  const pixels = () => G._gcv.getContext('2d').getImageData(0, 0, G._gcv.width, G._gcv.height).data;
  test('native atlas preserves original ice projection across repeat seams', () => {
    const original = createCanvas(256, 128).getContext('2d');
    const tiled = createCanvas(256, 128).getContext('2d');
    original.fillStyle = G.PAL[3].water; original.fillRect(0, 0, 256, 128);
    tiled.fillStyle = G.PAL[3].water; tiled.fillRect(0, 0, 256, 128);
    for (let sum = -2; sum <= 8; sum++) for (let x = -6; x <= 12; x++) {
      const y = sum - x, [sx, sy] = G.T2S(x, y);
      G.fillTexDiamond(original, iceName, sx, sy);
      G.coastPresentation.fillWinterWater(tiled, x, y, G.PAL[3]);
    }
    const a = original.getImageData(0, 0, 256, 128).data, b = tiled.getImageData(0, 0, 256, 128).data;
    let total = 0, seam = 0, count = 0;
    for (let y = 2; y < 126; y++) for (let x = 2; x < 254; x++) {
      for (let ch = 0; ch < 3; ch++) {
        const delta = Math.abs(a[(y * 256 + x) * 4 + ch] - b[(y * 256 + x) * 4 + ch]);
        total += delta;
        if (x % 64 < 2 || y % 32 < 2) { seam += delta; count++; }
      }
    }
    console.log('projection mean', total / (252 * 124 * 3), 'seam', seam / count);
    // The cached stamp is resampled once more; bound that difference rather than
    // claiming bit-identical legacy antialiasing. Repeat seams must not amplify it.
    assert(total / (252 * 124 * 3) < 5, 'original projection must remain visually equivalent');
    assert(seam / count < total / (252 * 124 * 3) + .5, 'repeat boundaries must not amplify ice seams');
  });
  test('fully transparent ice still yields opaque winter water inside the curved coast', () => {
    const original = G.SPR.get(iceName), blank = createCanvas(86, 83);
    try {
      G.SPR.map.set(iceName, blank); G.game = { season: 3 };
      const w = fixture(), c = createCanvas(900, 500).getContext('2d');
      c.fillStyle = '#ff00ff'; c.fillRect(0, 0, 900, 500); c.translate(430, 40);
      G.coastPresentation.draw(c, w, { x0: 0, y0: 0, x1: 11, y1: 11 });
      const [x, y] = G.T2S(7.5, 5.5);
      assert.deepEqual(Array.from(c.getImageData(x + 430, y + 40, 1, 1).data), [127, 163, 189, 255]);
    } finally { G.SPR.map.set(iceName, original); }
  });
  test('actual season-change callback restores identical summer pixels after winter, with no stale ice mask', () => {
    for (const scale of [.5, .68, 1]) {
      G.world = fixture(); G.game = G.newGameState(); G.game.season = 1;
      G.groundScale = scale; G.needGround = true; G.groundDirty.clear(); G.buildGround();
      const summer = hash(pixels()), topology = G.coastPresentation.topology(G.world), state = JSON.stringify(G.world);
      G.markGroundDirty(4, 5); G.game.season = 3; G.onSeasonChange(1, 3);
      assert(G.needGround); assert.equal(G.groundDirty.size, 0); G.buildGround();
      const fullWinter = Buffer.from(pixels()), winter = hash(fullWinter); assert.notEqual(winter, summer);
      G.markGroundDirty(4, 5); G.buildGround(); const repairedPixels = pixels(), repaired = hash(repairedPixels);
      let error = 0; for (let i = 0; i < fullWinter.length; i++) error += Math.abs(fullWinter[i] - repairedPixels[i]);
      assert(error / fullWinter.length < .08, `winter full/dirty mean ${error / fullWinter.length}`);
      for (let i = 0; i < 3; i++) { G.markGroundDirty(4, 5); G.buildGround(); assert.equal(hash(pixels()), repaired); }
      G.game.season = 1; G.onSeasonChange(3, 1); G.buildGround(); assert.equal(hash(pixels()), summer);
      assert.equal(G.coastPresentation.topology(G.world), topology); assert.equal(JSON.stringify(G.world), state);
      assert.equal(G.SPR.get(iceName).width, 86);
    }
  });
  test('replacing a loaded ice image invalidates its cached pattern and restoring it restores pixels', () => {
    G.world = fixture(); G.game = { season: 3 }; G.groundScale = .68; G.needGround = true; G.buildGround();
    const original = G.SPR.get(iceName), before = hash(pixels()), replacement = createCanvas(86, 83);
    replacement.getContext('2d').fillStyle = '#6e93b0'; replacement.getContext('2d').fillRect(0, 0, 86, 83);
    try { G.SPR.map.set(iceName, replacement); G.needGround = true; G.buildGround(); assert.notEqual(hash(pixels()), before); }
    finally { G.SPR.map.set(iceName, original); }
    G.needGround = true; G.buildGround(); assert.equal(hash(pixels()), before);
  });
}
(async () => { if (process.argv.includes('--pixels')) await nativePixels(); console.log(`Winter shore: ${passed} groups passed${process.argv.includes('--pixels') ? ' including native Canvas pixels' : ''}`); })().catch(e => { console.error(e); process.exitCode = 1; });
