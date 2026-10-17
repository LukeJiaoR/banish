'use strict';
/* Browser-controller contracts only. These deterministic VM mocks do not
 * validate browser Canvas, layout, pointer handling, or device performance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../tools/riverbay-lab/app.js'), 'utf8');
const defaults = { waterV2: false, shore: false, lowFrequency: false, clutter: false };
const settleMicrotasks = () => new Promise(resolve => setImmediate(resolve));

function harness({ ready = true, failed = [], decodeError = null, sceneFailures = [] } = {}) {
  let now = 1000, nextHandle = 1, options = { ...defaults };
  const rafs = new Map(), timers = new Map(), elements = new Map();
  const calls = { createScene: 0, install: 0, render: 0, pose: [], cancelled: [], viewportReads: 0, queries: 0, controlWrites: 0, init: 0, saves: 0 };
  const drawing = { drawImage() {} };
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id,
      get clientWidth() { calls.viewportReads++; return 800; },
      get clientHeight() { calls.viewportReads++; return 600; },
      getContext() { return drawing; },
      checked: false, attributes: {}, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      getAttribute(name) { return this.attributes[name] ?? null; },
      setAttribute(name, value) { calls.controlWrites++; this.attributes[name] = value; },
    });
    return elements.get(id);
  };
  const presetButtons = ['original', 'water', 'shore', 'study'].map(name => {
    const button = element('preset-' + name);
    button.dataset = { preset: name };
    button.attributes['aria-pressed'] = String(name === 'original');
    return button;
  });
  const scene = { failures: sceneFailures, kind: 'mock authored visual fixture' };
  const context = {
    console,
    performance: { now: () => now },
    devicePixelRatio: 3,
    Image: class { async decode() { if (decodeError) throw new Error(decodeError); } },
    document: { getElementById: element, querySelectorAll: () => { calls.queries++; return presetButtons; } },
    requestAnimationFrame(fn) { const id = nextHandle++; rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { calls.cancelled.push(id); rafs.delete(id); },
    setTimeout(fn, delay) { const id = nextHandle++; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {},
    __errs: [],
    G: {
      SPR: { ready, failed: [...failed] },
      cam: { z: 1 }, _gcv: { width: 1448, height: 751 },
      T2S: (x, y) => [(x - y) * 32, (x + y) * 16],
      init() { calls.init++; },
      autosave() { calls.saves++; },
      buildGround() {},
      frame() { calls.render++; this.ctx.drawImage(this._gcv, 0, 0); },
    },
    RiverbayScene: {
      createScene() { calls.createScene++; return scene; },
      pose(value, time) { assert.equal(value, scene); calls.pose.push(time); },
    },
    RiverbayTerrain: {
      install() {
        calls.install++;
        return {
          getOptions: () => ({ ...options }),
          setOptions(next) { options = { ...options, ...next }; },
          metrics: { lastTileDraws: 0, lastBuildMs: 0 },
        };
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  const startup = vm.runInContext(source, context, { filename: 'tools/riverbay-lab/app.js' });
  return {
    context, calls, rafs, timers, element, startup,
    setMotion(checked) { element('motion').onchange({ target: { checked } }); },
    stepFrame() {
      now += 16;
      // Like a browser frame, callbacks queued during this dispatch wait until
      // the next frame. A cancelled callback is never dispatched.
      for (const id of [...rafs.keys()]) {
        const fn = rafs.get(id);
        if (!fn) continue;
        rafs.delete(id);
        fn(now);
      }
    },
    advanceTimer(ms) {
      now += ms;
      for (const id of [...timers.keys()]) {
        const timer = timers.get(id);
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

function assertNotReady(h) {
  assert.notEqual(h.context.__riverbayReady, true);
  assert.equal(h.context.riverbayLab, undefined);
  assert.equal(h.calls.install, 0);
  assert.equal(h.calls.render, 0);
  assert.equal(h.rafs.size, 0);
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log('ok ' + name);
}

(async () => {
  await test('startup keeps candidate features and motion off', async () => {
    const h = harness();
    await h.startup;
    assert.equal(h.context.__riverbayReady, true);
    assert.deepEqual(h.context.riverbayLab.terrain.getOptions(), defaults);
    assert.equal(h.calls.createScene, 1);
    assert.equal(h.calls.install, 1);
    assert.equal(h.calls.render, 1);
    assert.equal(h.calls.pose.length, 0);
    h.context.G.autosave();
    assert.equal(h.calls.init, 0);
    assert.equal(h.calls.saves, 0);
    assert.equal(h.rafs.size, 0);
    assert.equal(h.context.G.dpr, 2, 'controller caps the backing-store DPR');
    assert.equal(h.element('lab').width, 1600);
    assert.equal(h.element('lab').height, 1200);
  });

  await test('rapid motion toggles retain exactly one animation chain', async () => {
    const h = harness();
    await h.startup;
    for (let i = 0; i < 50; i++) {
      h.setMotion(true);
      assert.equal(h.rafs.size, 1);
      h.setMotion(false);
      assert.equal(h.rafs.size, 0, 'pause cancels the pending callback');
      h.setMotion(true);
      assert.equal(h.rafs.size, 1, 'restart cannot retain an old callback');
    }
    h.setMotion(true);
    assert.equal(h.rafs.size, 1, 'repeated on events cannot duplicate the chain');
    for (let frame = 0; frame < 12; frame++) {
      const renders = h.calls.render, poses = h.calls.pose.length;
      h.stepFrame();
      assert.equal(h.calls.render, renders + 1);
      assert.equal(h.calls.pose.length, poses + 1);
      assert.equal(h.rafs.size, 1);
    }
    h.setMotion(false);
    const renders = h.calls.render, poses = h.calls.pose.length;
    h.stepFrame();
    assert.equal(h.calls.render, renders);
    assert.equal(h.calls.pose.length, poses);
    assert.equal(h.rafs.size, 0);
    h.setMotion(true);
    h.stepFrame();
    assert.equal(h.calls.render, renders + 1);
    assert.equal(h.rafs.size, 1);
    assert.ok(h.calls.cancelled.length > 0);
  });

  await test('failed original assets reject startup instead of reporting ready', async () => {
    const h = harness({ failed: ['house', 'tree_mature'] });
    await assert.rejects(h.startup, /原素材加载失败: house, tree_mature/);
    assertNotReady(h);
    assert.equal(h.calls.createScene, 0);
  });

  await test('a late original-asset failure is checked after loading settles', async () => {
    const h = harness({ ready: false });
    const rejected = assert.rejects(h.startup, /原素材加载失败: water_open/);
    await settleMicrotasks();
    assert.equal(h.timers.size, 1);
    h.context.G.SPR.ready = true;
    h.context.G.SPR.failed.push('water_open');
    h.advanceTimer(30);
    await rejected;
    assertNotReady(h);
  });

  await test('original-asset timeout cannot report ready', async () => {
    const h = harness({ ready: false });
    const rejected = assert.rejects(h.startup, /原素材加载超时/);
    await settleMicrotasks();
    assert.equal(h.timers.size, 1);
    h.advanceTimer(15001);
    await rejected;
    assertNotReady(h);
  });

  await test('candidate texture decode failure cannot report ready', async () => {
    const h = harness({ decodeError: 'candidate texture unavailable' });
    await assert.rejects(h.startup, /candidate texture unavailable/);
    assertNotReady(h);
    assert.equal(h.calls.createScene, 0);
  });

  await test('invalid authored fixtures cannot report ready', async () => {
    const h = harness({ sceneFailures: [{ type: 'house', reason: 'blocked fixture' }] });
    await assert.rejects(h.startup, /blocked fixture/);
    assertNotReady(h);
    assert.equal(h.calls.createScene, 1);
  });

  await test('controller reports scoped timings and avoids redundant layout and control queries', async () => {
    const h = harness();
    await h.startup;
    assert.equal(h.calls.viewportReads, 2, 'resize reads each viewport dimension once');
    assert.equal(h.calls.queries, 1, 'preset elements are looked up once');
    const lab = h.context.riverbayLab;
    lab.setOptions({ waterV2: true });
    lab.center();
    lab.render();
    assert.equal(h.calls.viewportReads, 2, 'controller reuses dimensions until resize');
    assert.equal(h.calls.queries, 1);
    assert.equal(h.element('waterV2').checked, true);
    lab.resize();
    assert.equal(h.calls.viewportReads, 4);
    const profile = lab.metrics().profile;
    assert.equal(profile.engine, 'browser Canvas 2D');
    assert.match(profile.timingScope, /No GPU\/raster completion/);
    assert.equal(profile.frames.length, 4);
    assert.equal(profile.operations.length, 4, 'nested render is part of setOptions or resize');
    const changed = profile.operations.find(value => value.label === 'setOptions');
    assert.equal(changed.completed, true);
    assert.equal(changed.timingValid, true);
    assert.deepEqual(Object.keys(changed.sections).sort(), ['controlsUpdateSyncMs', 'optionsMutationSyncMs', 'statsUpdateSyncMs']);
    assert.equal(changed.frameSequences.length, 1);
    assert.equal(profile.frames[1].groundDrawCalls, 1);
    assert.equal(profile.frames[1].firstGroundDrawImageCallMs, 0);
  });

  await test('repeated presets keep selected controls correct without redundant attribute writes', async () => {
    const h = harness();
    await h.startup;
    const waterButton = h.element('preset-water');
    waterButton.listeners.click();
    assert.equal(waterButton.getAttribute('aria-pressed'), 'true');
    assert.equal(h.element('preset-original').getAttribute('aria-pressed'), 'false');
    assert.equal(h.element('waterV2').checked, true);
    const writes = h.calls.controlWrites;
    waterButton.listeners.click();
    assert.equal(h.calls.controlWrites, writes);
    h.element('clutter').listeners.change({ target: { checked: true } });
    assert.equal(h.element('clutter').checked, true);
    for (const name of ['original', 'water', 'shore', 'study']) assert.equal(h.element('preset-' + name).getAttribute('aria-pressed'), 'false');
    assert.equal(h.rafs.size, 0);
  });

  console.log(`River-bay app: ${passed} VM controller contracts passed (not browser acceptance).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
