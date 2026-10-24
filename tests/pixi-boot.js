'use strict';
// Boot contracts only: real save parsing and browser rendering have separate checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/pixi-boot.js'), 'utf8');
const serverNames = ['probeServerSaves', 'saveToServer', 'loadFromServer', 'deleteServerSave', 'deleteServerSaveQuiet'];

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function boot({ primary = false, search = '', stored = {}, replay, edition = true } = {}) {
  const gates = Object.fromEntries(['renderer', 'art', 'ground', 'farms'].map(name => [name, deferred()]));
  const storage = new Map(Object.entries(stored)), before = [...storage];
  const calls = { init: [], fetch: [], errors: [], events: [] };
  const serverMethods = Object.fromEntries(serverNames.map(name => [name, () => name]));
  const renderer = {}, canvas = {}, label = edition ? {} : null;
  const startup = {
    remove() { calls.events.push('startup-remove'); },
    setAttribute() {}, querySelector() { return {}; },
  };
  let ready;
  const G = {
    SAVE_KEY: 'banish_save_v1', AUTOSAVE_KEY: 'banish_autosave_v1',
    RECOVERY_SAVE_KEY: 'banish_autosave_v1_recovery',
    serverSaves: { available: true }, ...serverMethods,
    pixiArt: { ready: gates.art.promise }, pixiGround: { ready: gates.ground.promise },
    pixiFarms: { ready: gates.farms.promise },
    game: { paused: false }, cam: { x: 0, y: 0, z: 1 }, world: { start: { x: 64, y: 64 } },
    ui: { refreshHUD() {}, toast() {} },
    T2S(x, y) { return [(x - y) * 32, (x + y) * 16]; },
    createPixiRenderer(target) {
      assert.equal(target, canvas); calls.events.push('renderer'); return gates.renderer.promise;
    },
    init() {
      assert.equal(G.pixi, renderer);
      calls.events.push('init');
      calls.init.push({
        keys: [G.SAVE_KEY, G.AUTOSAVE_KEY, G.RECOVERY_SAVE_KEY],
        initialSave: G.initialSave, autoRaw: storage.get(G.AUTOSAVE_KEY),
        serverAvailable: G.serverSaves.available,
        serverMethods: Object.fromEntries(serverNames.map(name => [name, G[name]])),
      });
    },
  };
  const villages = new Map();
  const context = {
    G, BANISH_PIXI_PRIMARY: primary, __REPLAY_SAVE: replay,
    URLSearchParams, location: { search }, innerWidth: 1200, innerHeight: 800,
    console: { error(error) { calls.errors.push(error); } },
    Event: class { constructor(type) { this.type = type; } },
    addEventListener(type, callback) {
      assert.equal(type, 'DOMContentLoaded'); assert.equal(ready, undefined); ready = callback;
    },
    dispatchEvent(event) { calls.events.push(event.type); },
    document: {
      getElementById(id) { return id === 'game' ? canvas : id === 'pixi-startup' ? startup : null; },
      querySelector(selector) { assert.equal(selector, '#pixi-edition small'); return label; },
    },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem() { throw new Error('Boot must not rewrite stored saves'); },
      removeItem() { throw new Error('Boot must not remove stored saves'); },
    },
    async fetch(url) {
      calls.fetch.push(url);
      const data = { template: url }; villages.set(url, data);
      return { ok: true, async json() { return data; } };
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'js/pixi-boot.js' });
  assert.equal(typeof ready, 'function');
  const done = ready();
  return {
    G, calls, serverMethods, villages, gates,
    async finish() {
      gates.renderer.resolve(renderer);
      for (const name of ['art', 'ground', 'farms']) gates[name].resolve();
      await done;
      assert.deepEqual(calls.errors, []);
      assert.equal(calls.init.length, 1);
      assert.deepEqual(calls.events, ['renderer', 'init', 'banish-ready', 'startup-remove']);
      assert.deepEqual([...storage], before);
      return calls.init[0];
    },
    releaseRenderer() { gates.renderer.resolve(renderer); },
  };
}

let passed = 0;
async function test(name, run) { await run(); passed++; console.log('ok ' + name); }
function keys(prefix) { return [prefix + '_save_v1', prefix + '_autosave_v1', prefix + '_autosave_v1_recovery']; }

async function run() {
  await test('primary waits for renderer and every art dependency, keeps saves/server API, and tolerates no edition label', async () => {
    const h = boot({ primary: true, search: '?scene=courtyard', edition: false });
    assert.equal(h.calls.init.length, 0);
    h.gates.art.resolve(); h.gates.ground.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.init.length, 0, 'renderer must finish before init');
    h.releaseRenderer();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.init.length, 0, 'farm assets must finish before init');
    const atInit = await h.finish();
    assert.deepEqual(atInit.keys, keys('banish'));
    assert.equal(atInit.initialSave, undefined);
    assert.equal(atInit.serverAvailable, true);
    for (const name of serverNames) assert.equal(atInit.serverMethods[name], h.serverMethods[name], name);
    assert.deepEqual(h.calls.fetch, []);
    assert.equal(h.G.game.paused, false, 'primary must keep the classic opening');
  });

  await test('primary presents the original autosave to init without injecting a village', async () => {
    const raw = '{"seed":42}', h = boot({ primary: true, stored: { banish_autosave_v1: raw, banish_save_v1: 'manual' } });
    const atInit = await h.finish();
    assert.deepEqual(atInit.keys, keys('banish'));
    assert.equal(atInit.autoRaw, raw);
    assert.equal(atInit.initialSave, undefined);
    assert.deepEqual(h.calls.fetch, []);
  });

  const previews = [
    { name: 'village', search: '', prefix: 'banish_pixi_village', template: 'river-village.json' },
    { name: 'courtyard', search: '?scene=courtyard', prefix: 'banish_pixi_courtyard', template: 'courtyard-village.json' },
    { name: 'classic', search: '?start=classic&scene=courtyard', prefix: 'banish_pixi', template: null },
  ];
  for (const preview of previews) {
    await test(`independent ${preview.name} retains its namespace and opening`, async () => {
      const h = boot({ search: preview.search, stored: { banish_autosave_v1: 'primary-save' } });
      const atInit = await h.finish();
      assert.deepEqual(atInit.keys, keys(preview.prefix));
      assert.equal(atInit.autoRaw, undefined);
      assert.equal(atInit.serverAvailable, false);
      for (const name of serverNames) assert.notEqual(atInit.serverMethods[name], h.serverMethods[name], name);
      if (preview.template) {
        const url = 'assets/pixi/' + preview.template;
        assert.deepEqual(h.calls.fetch, [url]);
        assert.equal(atInit.initialSave, h.villages.get(url));
      } else {
        assert.deepEqual(h.calls.fetch, []);
        assert.equal(atInit.initialSave, undefined);
      }
    });
    await test(`independent ${preview.name} autosave wins over a template`, async () => {
      const raw = '{"seed":73}', h = boot({ search: preview.search, stored: { [preview.prefix + '_autosave_v1']: raw } });
      const atInit = await h.finish();
      assert.deepEqual(atInit.keys, keys(preview.prefix));
      assert.equal(atInit.autoRaw, raw);
      assert.equal(atInit.initialSave, undefined);
      assert.deepEqual(h.calls.fetch, []);
    });
  }
  for (const preview of previews.filter(item => item.template)) {
    await test(`independent ${preview.name} replay is not replaced by a template`, async () => {
      const h = boot({ search: preview.search, replay: { seed: 91 } });
      const atInit = await h.finish();
      assert.equal(atInit.initialSave, undefined);
      assert.deepEqual(h.calls.fetch, []);
    });
  }
  console.log(`Pixi boot: ${passed} passed (VM behavior, not browser rendering)`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
