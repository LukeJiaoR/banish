'use strict';
/* Local Chromium UI acceptance for the climate slice. Uses a synthetic farm
 * after real new-game confirmation; does not claim a whole-season playthrough.
 * Run: node tests/crop-climate-browser.cjs [output-directory]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || '/tmp/banish-crop-climate-browser');
const port = Number(process.env.BANISH_QA_PORT || 8647);
const checks = [];
let server, browser;
async function click(page, selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.locator(selector).click();
}
async function inside(page, selector) {
  const box = await page.locator(selector).boundingBox(), size = page.viewportSize();
  assert(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1,
    `${selector} must be within ${JSON.stringify(size)}: ${JSON.stringify(box)}`);
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  server = spawn('python3', ['dev-server.py', String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(resolve => setTimeout(resolve, 500));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => window.G?.world);
    await page.evaluate(() => { G.game.paused = true; G.onboarding?.dismiss(); G.ui.refreshHUD(); });
    const initial = await page.evaluate(() => ({ seed: G.world.seed, count: G.world.buildings.length, climate: G.game.climate.type }));
    await click(page, '#open-town'); await click(page, '#btn-new');
    assert.equal(await page.locator('#new-game-climate-fair').getAttribute('aria-pressed'), 'true');
    await click(page, '#new-game-climate-harsh');
    await inside(page, '#new-game-climate-harsh');
    assert.equal(await page.locator('#new-game-climate-harsh').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => ({ seed: G.world.seed, count: G.world.buildings.length, climate: G.game.climate.type })), initial);
    await page.screenshot({ path: path.join(output, `${viewport.width}-climate-choice.png`) });
    await page.locator('#new-game-seed').fill('17');
    await click(page, '#new-game-review-button'); await inside(page, '#new-game-confirm');
    assert.match(await page.locator('#new-game-confirm-summary').textContent(), /严寒 · Harsh/);
    assert.match(await page.locator('#new-game-confirm-summary').textContent(), /v5.*旧程序无法读取/);
    await page.screenshot({ path: path.join(output, `${viewport.width}-climate-review.png`) });
    await click(page, '#new-game-back'); await click(page, '#new-game-climate-mild');
    assert.equal(await page.locator('#new-game-confirm').isVisible(), false);
    await click(page, '#new-game-review-button'); await click(page, '#new-game-confirm');
    await page.waitForFunction(() => G.game.startConfig?.climate === 'mild' && G.world.seed === 17);
    assert.equal(await page.locator('#new-game-settings').isVisible(), false);
    const farm = await page.evaluate(() => {
      G.game.paused = true; G.onboarding?.dismiss(); G.ui.setMode?.('map');
      const w = G.world; let b;
      for (let y = 3; y < w.N - 10 && !b; y++) for (let x = 3; x < w.N - 10 && !b; x++) {
        if (G.canPlace(w, 'farm', x, y).ok) b = G.addBuilding('farm', x, y, { instant: true, free: true }).b;
      }
      if (!b) throw new Error('Synthetic browser farm cannot be placed');
      b.farm.forEach(tile => { tile.sown = true; }); b.sownAll = true; b.growth = .5;
      G.game.day = 30; G.game.season = 2; G.game.year = 1; G.game.climate.lastDay = G.game.day;
      G.damageFrostTiles(b, b.farm.slice(0, 3));
      G.sel = { kind: 'b', id: b.id }; G.ui.showInfo(); G.ui.refreshHUD();
      return { warning: G.farmClimateSummary(b).warning, temperature: G.climateWeather().temperature };
    });
    await page.locator('[data-farm="climate"]').scrollIntoViewIfNeeded();
    await inside(page, '[data-farm="climate"]');
    assert.equal(await page.locator('[data-farm="climate"]').evaluate(el => !!el.closest('details')), false);
    assert.match(await page.locator('[data-farm="progress"]').textContent(), /本季霜损 3\/64/);
    assert((await page.locator('[data-farm="climate"]').textContent()).includes(farm.warning));
    assert((await page.locator('#date').textContent()).includes(`今日 ${farm.temperature}°C`));
    const dateVisible = await page.locator('#date').isVisible();
    if (viewport.width > 760) { assert(dateVisible); await inside(page, '#date'); }
    await page.screenshot({ path: path.join(output, `${viewport.width}-farm-climate.png`) });
    await click(page, '#early-harvest-start');
    assert.match(await page.locator('[data-early-harvest-quote]').textContent(), /提前抢收不免霜/);
    await click(page, '#early-harvest-cancel');
    assert.equal(await page.evaluate(() => G.world.bmap[G.sel.id].earlyHarvestYield), undefined);
    const crop = page.locator('#farm-crop'); await crop.focus();
    await page.evaluate(() => { for (let i = 0; i < 5; i++) G.ui.renderInfo(); });
    assert.equal(await crop.evaluate(el => el === document.activeElement), true);
    assert.deepEqual(errors, []);
    checks.push({ viewport, newGame: 'passed', farm: 'passed', earlyHarvestCancel: 'passed', focus: 'passed', dateVisible,
      mobileDateNote: dateVisible ? null : 'Existing A/Jade layout hides the entire date on phones; farm temperature remains visible.' });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ checks, scope: 'Real Chromium interactions with synthetic farm state; no whole-season or manual browser-zoom claim.' }, null, 2));
  console.log(JSON.stringify(checks));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); if (server) server.kill();
});
