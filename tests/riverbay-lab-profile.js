'use strict';
/* Deterministic synchronous instrumentation contracts, not browser/GPU evidence. */
const assert = require('node:assert/strict');
const { install } = require('../tools/riverbay-lab/app.js');

function harness({ extraGroundDraw = false } = {}) {
  let time = 0;
  const G = { _gcv: {}, needGround: true };
  const calls = { builds: 0, draws: 0, frames: 0 };
  G.ctx = { drawImage(image) {
    assert.equal(this, G.ctx, 'drawImage receiver is preserved');
    calls.draws++;
    time += image === G._gcv ? 19 : 7;
    return 'drawn';
  } };
  G.buildGround = function () {
    assert.equal(this, G);
    calls.builds++;
    time += 5;
    this.needGround = false;
    return 'built';
  };
  G.frame = function (dt) {
    assert.equal(this, G);
    assert.equal(dt, 0);
    calls.frames++;
    if (this.needGround) this.buildGround();
    time += 3;
    this.ctx.drawImage(this._gcv, 0, 0);
    if (extraGroundDraw) this.ctx.drawImage(this._gcv, 0, 0);
    this.ctx.drawImage({}, 0, 0);
    time += 11;
    return 'frame-result';
  };
  const profile = install(G, { engine: 'deterministic fake clock, not a rendering engine', now: () => time, limit: 3 });
  return { G, calls, profile, advance(ms) { time += ms; } };
}

let passed = 0;
function test(name, run) { run(); passed++; console.log('ok ' + name); }

test('first and warm frames split build, ground drawImage and remaining synchronous work', () => {
  const { G, profile } = harness();
  assert.equal(G.frame(0), 'frame-result');
  const first = profile.latestFrame();
  assert.equal(first.firstFrameForProfiler, true);
  assert.equal(first.completed, true);
  assert.equal(first.timingValid, true);
  assert.equal(first.frameSyncMs, 45);
  assert.equal(first.buildGroundSubmitMs, 5);
  assert.equal(first.firstGroundDrawImageCallMs, 19);
  assert.equal(first.firstGroundDrawStartOffsetMs, 8);
  assert.equal(first.remainingFrameSyncMs, 21, 'non-ground image calls remain in frame remainder');
  assert.equal(first.cacheState, 'ground-rebuild');
  G.frame(0);
  const warm = profile.latestFrame();
  assert.equal(warm.firstFrameForProfiler, false);
  assert.equal(warm.groundBuildCalls, 0);
  assert.equal(warm.buildGroundSubmitMs, 0, 'warm frame must not reuse previous build timing');
  assert.equal(warm.cacheState, 'no-ground-build');
  assert.equal(warm.frameSyncMs, 40);
});

test('reinstall is idempotent and context wrappers cannot accumulate', () => {
  const { G, profile, calls } = harness();
  const wrappedFrame = G.frame, wrappedBuild = G.buildGround;
  G.frame(0);
  const wrappedDraw = G.ctx.drawImage;
  for (let i = 0; i < 5; i++) {
    assert.equal(install(G, { engine: profile.engine }), profile);
    G.frame(0);
    assert.equal(G.frame, wrappedFrame);
    assert.equal(G.buildGround, wrappedBuild);
    assert.equal(G.ctx.drawImage, wrappedDraw);
    assert.equal(profile.latestFrame().groundDrawCalls, 1);
  }
  assert.equal(calls.frames, 6);
  assert.equal(calls.builds, 1);
  assert.equal(calls.draws, 12);
  assert.equal(profile.report().frameCount, 6);
  assert.equal(profile.report().frames.length, 3, 'retention is bounded');
  assert.throws(() => install(G, { engine: 'mislabelled engine' }), /different engine/);
});

test('reports are detached snapshots and multiple ground calls are not double-counted', () => {
  const { G, profile } = harness({ extraGroundDraw: true });
  G.frame(0);
  const first = profile.latestFrame();
  assert.equal(first.groundDrawCalls, 2);
  assert.equal(first.firstGroundDrawImageCallMs, 19);
  assert.equal(first.groundDrawImageCallsMs, 38);
  assert.equal(first.remainingFrameSyncMs, 21);
  first.buildGroundSubmitMs = 999;
  const report = profile.report();
  report.frames[0].frameSyncMs = 999;
  assert.equal(profile.latestFrame().buildGroundSubmitMs, 5);
  assert.equal(profile.latestFrame().frameSyncMs, 64);
  assert.match(report.timingScope, /No GPU\/raster completion/);
  assert.equal(report.schemaVersion, 1);
});

test('outer setOptions timing includes controls, layout read, frame and UI costs once', () => {
  const { G, profile, advance } = harness();
  profile.operation('setOptions', () => {
    profile.section('controlsUpdateSyncMs', () => advance(4));
    profile.section('viewportReadSyncMs', () => advance(6));
    profile.operation('render', () => {
      G.frame(0);
      profile.section('statsUpdateSyncMs', () => advance(2));
    });
    advance(1);
  });
  const report = profile.report(), op = report.operations[0];
  assert.equal(report.operations.length, 1);
  assert.equal(op.label, 'setOptions');
  assert.equal(op.totalSyncMs, 58);
  assert.equal(op.frameSyncMs, 45);
  assert.equal(op.otherSyncMs, 1);
  assert.deepEqual(op.sections, { controlsUpdateSyncMs: 4, viewportReadSyncMs: 6, statsUpdateSyncMs: 2 });
  assert.deepEqual(op.frameSequences, [1]);
  assert.equal(op.completed, true);
});

test('thrown draws keep the error and incomplete timing sample, then allow recovery', () => {
  let time = 0, fail = true;
  const boom = new Error('draw failed');
  const G = { _gcv: {}, ctx: { drawImage() { time += 3; if (fail) throw boom; } }, buildGround() {}, frame() { this.ctx.drawImage(this._gcv); } };
  const profile = install(G, { engine: 'error fixture', now: () => time });
  assert.throws(() => profile.operation('render', () => G.frame(0)), error => error === boom);
  assert.equal(profile.latestFrame().completed, false);
  assert.equal(profile.latestFrame().firstGroundDrawImageCallMs, 3);
  assert.equal(profile.report().operations[0].completed, false);
  fail = false;
  G.frame(0);
  assert.equal(profile.latestFrame().completed, true);
});

test('invalid clocks and missing draws remain explicit rather than becoming fake zeroes', () => {
  const G = { ctx: { drawImage() {} }, buildGround() {}, frame() {} };
  const profile = install(G, { engine: 'invalid-clock fixture', now: () => NaN });
  profile.operation('render', () => G.frame(0));
  const frame = profile.latestFrame();
  assert.equal(frame.timingValid, false);
  assert.equal(frame.frameSyncMs, null);
  assert.equal(frame.remainingFrameSyncMs, null);
  assert.equal(frame.firstGroundDrawImageCallMs, null);
  assert.equal(frame.groundDrawCalls, 0);
  assert.equal(profile.report().operations[0].timingValid, false);
  assert.equal(profile.report().operations[0].totalSyncMs, null);
  assert.throws(() => install({}), /explicit engine/);
});

test('replaced wrapped functions fail visibly instead of reporting a successful profile', () => {
  const first = harness();
  first.G.buildGround = () => {};
  assert.equal(first.profile.report().instrumentationCurrent, false);
  assert.throws(() => first.G.frame(0), /buildGround was replaced/);
  assert.equal(first.profile.latestFrame().completed, false);
  const second = harness();
  second.G.frame(0);
  second.G.ctx.drawImage = () => {};
  assert.equal(second.profile.report().instrumentationCurrent, false);
  assert.throws(() => second.G.frame(0), /drawImage was replaced/);
  assert.equal(second.profile.latestFrame().completed, false);
});

test('a new destination canvas is instrumented without changing the original method result', () => {
  const { G, profile, advance } = harness();
  G.frame(0);
  G.ctx = { drawImage(image) { assert.equal(this, G.ctx); advance(image === G._gcv ? 13 : 2); return 'replacement result'; } };
  G.frame(0);
  assert.equal(profile.latestFrame().firstGroundDrawImageCallMs, 13);
  assert.equal(profile.latestFrame().remainingFrameSyncMs, 16);
  assert.equal(G.ctx.drawImage({}), 'replacement result');
});

console.log(`River-bay profiler: ${passed} synchronous contracts passed (not browser acceptance).`);
