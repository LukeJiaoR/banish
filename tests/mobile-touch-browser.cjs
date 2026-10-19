'use strict';
/* 真实 Chrome 的移动端画面与触控验收。
 *
 * 边界：使用本机 Google Chrome（真实浏览器引擎）+ 移动视口/DPR/触摸事件模拟，
 * 不等同于真机（无 iOS Safari 合成、无刘海安全区、无真实手指抖动）。报告须写明这一点。
 *
 *   node tests/mobile-touch-browser.cjs                 # 全部设备
 *   node tests/mobile-touch-browser.cjs --device iphone-13
 *   node tests/mobile-touch-browser.cjs --out docs/mobile-acceptance
 *
 * 依赖：playwright-core + 本机 Chrome（channel:'chrome'）。页面由本进程内的
 * 静态服务器提供，不触碰用户的部署服务，也不提交反馈/存档。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(root, argOf('--out', 'docs/mobile-acceptance'));
const PORT = Number(process.env.BANISH_MOBILE_PORT || 8677);

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';

const DEVICES = [
  { name: 'iphone-13', label: 'iPhone 13 竖屏', width: 390, height: 844, dpr: 3, ua: IOS_UA },
  { name: 'iphone-se', label: 'iPhone SE 竖屏', width: 375, height: 667, dpr: 2, ua: IOS_UA },
  { name: 'android-360', label: 'Android 360×640', width: 360, height: 640, dpr: 2, ua: ANDROID_UA },
  { name: 'landscape', label: 'iPhone 13 横屏', width: 844, height: 390, dpr: 3, ua: IOS_UA, layoutOnly: true },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
const PUBLIC_DIRS = new Set(['js', 'assets', 'styles', 'art']);

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'index.html';
    if (rel === 'favicon.ico') { res.writeHead(204); res.end(); return; }
    if (rel.startsWith('api/')) {
      // 存档/反馈接口不属于本次验收范围，按“无存档”应答，避免 404 噪声与副作用。
      const body = rel === 'api/saves' ? '{"ok":true,"saves":[]}' : '{"ok":true}';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }
    const first = rel.split('/')[0];
    const allowed = rel === 'index.html' || rel === 'style.css' || PUBLIC_DIRS.has(first);
    const file = path.resolve(root, rel);
    if (!allowed || !file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

/* ---------- 触摸工具 ---------- */
function touchApi(page) {
  const cdp = page.context().newCDPSession(page);
  const point = (x, y) => ({ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 });
  return {
    async swipe(from, to, { steps = 14, pause = 16 } = {}) {
      const s = await cdp;
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from.x, from.y)] });
      for (let i = 1; i <= steps; i++) {
        const x = from.x + (to.x - from.x) * i / steps;
        const y = from.y + (to.y - from.y) * i / steps;
        await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x, y)] });
        await page.waitForTimeout(pause);
      }
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async longPress(at, ms = 700) {
      const s = await cdp;
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(at.x, at.y)] });
      await page.waitForTimeout(ms);
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async dispose() { try { (await cdp).detach(); } catch { /* 已关闭 */ } },
  };
}

const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

async function tapLocator(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  assert(box, `${selector} 不可见，无法点按`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function visibleInside(page, selector, label) {
  const box = await page.locator(selector).first().boundingBox();
  const v = page.viewportSize();
  assert(box, `${label || selector} 不可见`);
  assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= v.width + 1 && box.y + box.height <= v.height + 1,
    `${label || selector} 超出视口 ${JSON.stringify(v)}：${JSON.stringify(box)}`);
}

/* 可点目标：只统计可见、非零面积、不是画布的元素 */
async function tapTargets(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('button, [role="button"], summary, select, input, a')) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1) continue;
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
      if (!el.closest('#hud') && !el.closest('.overlay') && !el.closest('dialog')) continue;
      out.push({
        id: el.id || null,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18),
        w: Math.round(r.width), h: Math.round(r.height),
        font: cs.fontSize,
      });
    }
    return out;
  });
}

/* 找到真正落在画布上的点：手机上建造面板/预览卡会盖住大片地图，
   点按必须打在用户实际能看到地图的位置，否则测的就不是画布手势。 */
async function canvasPoint(page, prefer = { x: 0.5, y: 0.42 }) {
  const v = page.viewportSize();
  const hit = await page.evaluate(({ px, py }) => {
    const pick = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el && (el.id === 'game' || el.tagName === 'CANVAS');
    };
    const start = { x: Math.round(px * innerWidth), y: Math.round(py * innerHeight) };
    if (pick(start.x, start.y)) return start;
    for (let r = 20; r < Math.max(innerWidth, innerHeight); r += 14) {
      for (let a = 0; a < 360; a += 20) {
        const x = Math.round(start.x + r * Math.cos(a * Math.PI / 180));
        const y = Math.round(start.y + r * Math.sin(a * Math.PI / 180));
        if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) continue;
        if (pick(x, y)) return { x, y };
      }
    }
    return null;
  }, { px: prefer.x, py: prefer.y });
  assert(hit, `找不到可点按的画布区域（视口 ${v.width}×${v.height}）`);
  return hit;
}

/* 画布在视口内的可用比例：网格采样，命中的点即为未被 HUD 遮挡 */
async function openMapRatio(page) {
  return page.evaluate(() => {
    let hit = 0, total = 0;
    for (let y = 4; y < innerHeight; y += 12) {
      for (let x = 4; x < innerWidth; x += 12) {
        total++;
        const el = document.elementFromPoint(x, y);
        if (el && (el.id === 'game' || el.tagName === 'CANVAS')) hit++;
      }
    }
    return Math.round(hit / total * 100);
  });
}

const results = [];
function record(device, name, ok, detail) {
  results.push({ device: device.name, check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${device.name.padEnd(11)} ${name}${detail ? '  ' + detail : ''}`);
}

async function runDevice(browser, device) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: device.ua,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() === 404) errors.push('404 ' + r.url()); });
  const touch = touchApi(page);
  const view = page.viewportSize();
  const shots = [];
  const shot = async (suffix) => {
    const file = path.join(OUT, `${device.name}-${suffix}.png`);
    await page.screenshot({ path: file });
    shots.push(path.basename(file));
  };

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.G?.world && G.ui?.el?.toolbar, null, { timeout: 20000 });
    if (await page.locator('#help').isVisible()) await tapLocator(page, '#help-close');
    await page.evaluate(() => { G.game.paused = true; G.ui.refreshHUD(); });
    await page.waitForTimeout(250);
    await shot('1-load');

    /* 1. 页面不允许横向溢出 */
    const overflow = await page.evaluate(() => ({
      scroll: document.scrollingElement.scrollWidth,
      inner: window.innerWidth,
      body: document.body.getBoundingClientRect().width,
    }));
    record(device, '无横向溢出', overflow.scroll <= overflow.inner + 1,
      `scrollWidth=${overflow.scroll} innerWidth=${overflow.inner}`);

    /* 2. 布局视口与画布尺寸必须等于设备宽度（防止 shrink-to-fit 把画布撑成 2 倍） */
    const metrics = await page.evaluate(() => {
      const cv = document.getElementById('game');
      const r = cv.getBoundingClientRect();
      return {
        innerWidth, innerHeight,
        canvasCss: [Math.round(r.width), Math.round(r.height)],
        bitmap: [cv.width, cv.height],
        dpr: window.devicePixelRatio,
      };
    });
    const canvasExact = Math.abs(metrics.canvasCss[0] - device.width) <= 1 &&
      Math.abs(metrics.canvasCss[1] - device.height) <= 1 &&
      Math.abs(metrics.innerWidth - device.width) <= 1;
    record(device, '画布/视口未被放大', canvasExact,
      `innerWidth=${metrics.innerWidth} 画布CSS=${metrics.canvasCss.join('×')} 位图=${metrics.bitmap.join('×')} dpr=${metrics.dpr}`);

    /* 3. 关键控件在视口内（建造栏此时应隐藏，展开后再查） */
    try {
      await visibleInside(page, '#topbar', '顶栏');
      await visibleInside(page, '#town-dock', '底部操作条');
      record(device, 'HUD 关键控件在视口内', true, '');
    } catch (e) {
      record(device, 'HUD 关键控件在视口内', false, e.message.split('\n')[0]);
    }

    /* 3. 触控目标尺寸 */
    const targets = await tapTargets(page);
    const small = targets.filter(t => t.w < 40 || t.h < 40);
    record(device, '主要触控目标 ≥40×40', small.length === 0,
      `${targets.length} 个可点元素，${small.length} 个偏小` +
      (small.length ? '：' + small.slice(0, 5).map(t => `${t.id || t.text}(${t.w}×${t.h})`).join('、') : ''));

    /* 4. 字体下限（正文 12px / 次要 11px，项目既有约定） */
    const tiny = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#hud button, #hud .res, #hud small, #hud span, #toolbar button')) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 11) bad.push({ t: (el.textContent || '').trim().slice(0, 12), fs });
      }
      return bad.slice(0, 6);
    });
    record(device, 'HUD 文字 ≥11px', tiny.length === 0,
      tiny.length ? '过小：' + tiny.map(t => `${t.t}${t.fs}px`).join('、') : '');

    if (device.layoutOnly) {
      /* 横屏只做布局证据 + 一次建造面板开合 */
      await tapLocator(page, '#open-build');
      await page.waitForTimeout(300);
      await visibleInside(page, '#toolbar', '横屏建造栏');
      await shot('2-landscape-build');
      await tapLocator(page, '#close-build');   // 建造模式下「建造」按钮本身会隐藏，只能走「返回地图」
      await page.waitForTimeout(250);
      await record(device, '横屏可开合建造栏', !(await page.locator('#toolbar').isVisible()), '');
    } else {
      /* 5. 触摸打开建造面板 */
      await tapLocator(page, '#open-build');
      await page.waitForTimeout(300);
      const panelOpen = await page.locator('#toolbar').isVisible();
      const categories = await page.locator('#toolbar [data-category]').count();
      record(device, '点按「建造」展开面板', panelOpen && categories > 0, `分类数=${categories}`);
      if (panelOpen) await visibleInside(page, '#toolbar', '建造栏');

      /* 6. 面板内触摸滚动 */
      const scrollBefore = await page.evaluate(() => {
        const t = document.getElementById('toolbar');
        return { top: t.scrollTop, scrollH: t.scrollHeight, clientH: t.clientHeight };
      });
      if (scrollBefore.scrollH > scrollBefore.clientH + 4) {
        const box = await page.locator('#toolbar').boundingBox();
        await touch.swipe({ x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 },
          { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 });
        await page.waitForTimeout(350);
        const after = await page.evaluate(() => document.getElementById('toolbar').scrollTop);
        record(device, '面板内单指滑动可滚动', after > scrollBefore.top + 8, `scrollTop ${scrollBefore.top}→${after}`);
        await page.evaluate(() => { document.getElementById('toolbar').scrollTop = 0; });
      } else {
        record(device, '面板内单指滑动可滚动', true, '内容未超出，跳过');
      }

      /* 7. 触摸选择分类与工具 */
      await tapLocator(page, '[data-category="food"]');
      await page.waitForTimeout(200);
      const toolVisible = await page.locator('[data-tool="gatherer"]').isVisible();
      if (toolVisible) {
        await tapLocator(page, '[data-tool="gatherer"]');
        await page.waitForTimeout(200);
        const tool = await page.evaluate(() => G.tool?.type);
        record(device, '触摸选中工具', tool === 'gatherer', `G.tool.type=${tool}`);
      } else {
        record(device, '触摸选中工具', false, '分类内找不到 gatherer');
      }
      await shot('2-build');

      /* 8. 触摸落点建房：必须在真实画布区域点按；落点太挤时换一处再试 */
      await page.evaluate(() => { G.game.paused = true; });
      const mapRatioBuild = await openMapRatio(page);
      const buildingsBefore = await page.evaluate(() => G.world.buildings.length);
      let placed = null;
      for (const p of [{ x: 0.5, y: 0.42 }, { x: 0.32, y: 0.6 }, { x: 0.68, y: 0.6 }, { x: 0.5, y: 0.3 }]) {
        const spot = await canvasPoint(page, p);
        await page.touchscreen.tap(spot.x, spot.y);
        await page.waitForTimeout(500);
        const state = await page.evaluate(() => ({
          n: G.world.buildings.length,
          toast: [...document.querySelectorAll('#toasts *')].map(n => n.textContent).filter(Boolean).slice(-1)[0] || '',
        }));
        placed = { spot, ...state };
        if (state.n > buildingsBefore) break;
      }
      record(device, '画布点按落下建筑', placed.n > buildingsBefore,
        `建筑 ${buildingsBefore}→${placed.n}（落点 ${placed.spot.x},${placed.spot.y}，可点地图 ${mapRatioBuild}%` +
        `${placed.toast ? '，最后提示：' + placed.toast : ''}）`);
      await shot('3-placed');

      /* 9. 退出建造模式，回到探索态测单指平移 */
      if (await page.locator('#close-build').isVisible()) {
        await tapLocator(page, '#close-build');
        await page.waitForTimeout(250);
      }
      const mapRatioExplore = await openMapRatio(page);
      const camBefore = await page.evaluate(() => ({ x: G.cam.x, y: G.cam.y }));
      const panFrom = await canvasPoint(page, { x: 0.5, y: 0.5 });
      await touch.swipe(panFrom, { x: panFrom.x - view.width * 0.3, y: panFrom.y + view.height * 0.15 }, { steps: 12 });
      await page.waitForTimeout(400);
      const camAfter = await page.evaluate(() => ({ x: G.cam.x, y: G.cam.y }));
      const moved = Math.abs(camAfter.x - camBefore.x) > 1 || Math.abs(camAfter.y - camBefore.y) > 1;
      record(device, '单指拖拽平移镜头', moved,
        `cam (${camBefore.x.toFixed(1)},${camBefore.y.toFixed(1)})→(${camAfter.x.toFixed(1)},${camAfter.y.toFixed(1)})，可点地图 ${mapRatioExplore}%`);
      record(device, '拖拽不误触选中', !(await page.locator('#info').isVisible()), '');

      /* 10. 双击不应触发浏览器缩放 */
      const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      const dbl = await canvasPoint(page, { x: 0.5, y: 0.4 });
      await page.touchscreen.tap(dbl.x, dbl.y);
      await page.waitForTimeout(90);
      await page.touchscreen.tap(dbl.x, dbl.y);
      await page.waitForTimeout(500);
      const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      record(device, '双击画布不缩放页面', scaleAfter < scaleBefore * 1.05,
        `visualViewport.scale ${scaleBefore}→${scaleAfter}`);

      /* 11. 顶栏「更多」与二级资源 */
      if (await page.locator('#resource-more').isVisible()) {
        await tapLocator(page, '#resource-more');
        await page.waitForTimeout(250);
        const moreOpen = await page.locator('#secondary-resources').isVisible();
        record(device, '顶栏「更多」可展开', moreOpen, '');
        await visibleInside(page, '#secondary-resources', '二级资源');
        await tapLocator(page, '#resource-more');
      } else {
        record(device, '顶栏「更多」可展开', false, '按钮不可见');
      }

      /* 12. 管理面板（短窗口 sheet）开合 */
      await tapLocator(page, '#open-town');
      await page.waitForTimeout(350);
      const townOpen = await page.locator('#town-controls').isVisible();
      if (townOpen) await visibleInside(page, '#town-controls', '管理面板');
      record(device, '管理面板可展开且不越界', townOpen, '');
      await shot('4-town');

      /* 13. 帮助弹层：入口已被收进管理面板 */
      const helpEntry = await page.locator('#btn-help').isVisible();
      record(device, '管理面板内可触达帮助入口', helpEntry, '');
      if (helpEntry) {
        await tapLocator(page, '#btn-help');
        await page.waitForTimeout(350);
        const helpOpen = await page.locator('#help').isVisible();
        record(device, '帮助弹层可打开', helpOpen, '');
        if (helpOpen) {
          await visibleInside(page, '#help', '帮助弹层');
          await shot('5-help');
          await tapLocator(page, '#help-close');
          await page.waitForTimeout(250);
          record(device, '帮助弹层可关闭', !(await page.locator('#help').isVisible()), '');
        }
      }
      if (townOpen && await page.locator('#town-controls').isVisible()) {
        await tapLocator(page, '#close-town');
        await page.waitForTimeout(250);
      }

      /* 14. 长按画布不选中文本 */
      const press = await canvasPoint(page, { x: 0.5, y: 0.45 });
      await touch.longPress(press, 650);
      await page.waitForTimeout(150);
      const longPress = await page.evaluate(() => String(getSelection()).trim());
      record(device, '长按画布不选中文本', longPress.length === 0, longPress ? `选中：${longPress.slice(0, 20)}` : '');
    }

    /* 15. 无脚本错误 */
    record(device, '无 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    record(device, '用例执行', false, e.message.split('\n')[0]);
    try { await shot('error'); } catch { /* 截图失败不影响结论 */ }
  } finally {
    await touch.dispose();
    fs.writeFileSync(path.join(OUT, `${device.name}-result.json`), JSON.stringify({
      device: { name: device.name, label: device.label, width: device.width, height: device.height, dpr: device.dpr },
      chrome: browser.version(),
      ua: device.ua,
      screenshots: shots,
      errors,
      checks: results.filter(r => r.device === device.name),
    }, null, 2));
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const only = argOf('--device', '');
  const devices = only ? DEVICES.filter(d => d.name === only) : DEVICES;
  assert(devices.length, `未知设备 ${only}`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  console.log(`Chrome ${browser.version()} · ${devices.length} 个设备 · 输出 ${OUT}`);
  try {
    for (const device of devices) await runDevice(browser, device);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({
    chrome: 'chrome-channel',
    generatedAt: new Date().toISOString(),
    viewports: DEVICES.map(d => ({ name: d.name, label: d.label, w: d.width, h: d.height, dpr: d.dpr })),
    total: results.length, passed: results.length - failed.length, failed: failed.length,
    results,
  }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} 通过，${failed.length} 项未通过`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
