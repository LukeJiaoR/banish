'use strict';
/* Structural CSS/markup safeguards only. These assertions do not compute the
 * cascade, measure overflow, hit-test controls or replace real browser QA. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html'), css = read('styles/desktop-workspace.css');
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(match => !match[1].trim().startsWith('@'))
  .map(match => ({selectors: match[1].trim(), body: match[2]}));
function rule(selector, property, value) {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*${value}\\s*(?:;|$)`);
  return rules.some(item => item.selectors.split(/,(?![^()]*\))/).some(part => part.trim() === selector)
    && pattern.test(item.body));
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok', name); }

test('workspace stylesheet loads once after every legacy skin', () => {
  const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(styles.filter(file => file.startsWith('styles/desktop-workspace.css')).length, 1);
  assert(styles.at(-2).startsWith('styles/desktop-workspace.css'));
  assert(styles.at(-1).startsWith('styles/harvest-map.css'));
  assert(styles.indexOf('style.css') < styles.findIndex(file => file.startsWith('styles/jade-layout.css')));
});

test('desktop header, catalog, status and actions occupy the same workspace', () => {
  assert(rule('#hud #toolbar #jade-build-header', 'display', 'contents'));
  assert(rule('#hud #toolbar #jade-build-header', 'position', 'static'));
  assert(rule('#hud #toolbar .toolbar-heading', 'display', 'flex'));
  assert(rule('#hud #toolbar .tool-group', 'display', 'grid'));
  assert(rule('#hud #toolbar #toolbar-state', 'position', 'static'));
  assert(rule('#hud #toolbar #toolbar-state', 'clip-path', 'none'));
  assert(rule('#hud #toolbar #jade-build-actions', 'grid-column', '1/-1'));
  assert(!rule('#hud #toolbar #jade-build-art', 'pointer-events', 'none'));
});

test('catalog scroll affordance and all tool names are restored', () => {
  assert(rule('#hud #toolbar .tool-group', 'overflow-y', 'auto'));
  assert(rule('#hud[data-mode=build] #toolbar .toolbar-items', 'overflow-y', 'auto'));
  assert(rule('#hud[data-mode=build] #toolbar .toolbar-items', 'overflow-x', 'hidden'));
  assert(rule('#hud #toolbar .tool-group', 'scrollbar-width', 'thin'));
  assert(rule('#hud #toolbar .toolbar-items::-webkit-scrollbar', 'display', 'block'));
  assert(rule('#hud #toolbar .tb:not(.tb-category) .lb', 'display', 'block'));
  assert(rule('#hud.is-placing #toolbar .tool-group', 'max-height', 'none'));
  assert(!rules.some(item => /\[data-(?:tool|category)=/.test(item.selectors) && /display\s*:\s*none/.test(item.body)));
});

test('responsive categories and management retain scrollable access without forcing hidden controls visible', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(min-width:\s*761px\)\s*and\s*\(max-height:\s*600px\)/);
  assert(rule('#hud #toolbar #toolbar-categories', 'display', 'grid'));
  assert(rule('#hud #toolbar', 'max-height', 'calc\\(100dvh - var\\(--hud-height\\) - 72px\\)'));
  assert(rule('#hud #toolbar', 'overflow-y', 'auto'));
  assert(rule('#hud #town-controls', 'overflow-y', 'auto'));
  assert(!clean.includes('!important'));
  assert.match(read('style.css'), /\.hidden\s*\{\s*display:\s*none\s*!important/);
  assert.match(read('styles/navigation.css'), /#hud \[hidden\]\s*\{\s*display:none!important/);
  for (const id of ['open-town', 'open-build', 'close-build', 'close-town',
    'btn-production-goals', 'btn-save', 'btn-load', 'btn-new', 'btn-fb', 'btn-help', 'btn-err']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
    assert(!rules.some(item => item.selectors.includes('#' + id) && /display\s*:\s*none/.test(item.body)), id);
  }
});

test('mobile expanded details stay in the scrolling tray instead of above its clipping box', () => {
  const mobile = css.slice(css.lastIndexOf('@media (max-width:760px)'));
  assert.match(mobile, /#hud #toolbar #jade-build-header\.jade-details-open #placement-panel\s*\{[^}]*position:static;inset:auto;width:auto;max-height:180px/);
});

console.log(`Desktop workspace: ${passed} structural contract groups passed (not cascade/geometry or browser acceptance).`);
