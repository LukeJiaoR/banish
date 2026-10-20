'use strict';
// Skin integration contracts; actual geometry and touch require browser review.
const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles/jade-skin.css','utf8');
assert(html.indexOf('styles/jade-skin.css')>html.indexOf('styles/mobile-occlusion.css'));
assert.match(css,/--ink:#183f43/);
assert.match(css,/--jade:#287e68/);
assert.match(css,/\.resource-warning\s*\{[^}]*background:[^}]*border-color:/);
assert.match(css,/\.resource-urgent\s*\{[^}]*background:[^}]*border-color:/);
assert.match(css,/#hud\.is-placing #toolbar \.tool-group \.tb:not\(\.active\)\s*\{ display:flex/);
assert.match(css,/@media\(min-width:761px\)/);
assert.match(css,/@media\(max-width:760px\) and \(max-height:680px\)/);
assert.match(css,/grid-row:2 \/ 4/,'short portrait pause shares the status rows');
assert.match(css,/#hud\.is-placing #placement-panel\s*\{[^}]*left:auto; width:340px/);
assert.match(css,/#hud #info\.detail-inspector\s*\{[^}]*max-height:min\(56dvh/);
for(const side of ['top','bottom','left','right'])assert(css.includes(`env(safe-area-inset-${side})`));
assert.match(css,/min-height:44px/);
assert.match(css,/focus-visible/);
for (const selector of ['#hud #save-status', '#hud #resource-more.has-urgent', '#info .building-detail-panel h3', '#info .house-upgrade-warning', '#guide-count', '#dynamic-coach #coach-action']) {
  assert(css.includes(selector), `jade contrast override missing: ${selector}`);
}
assert.match(css,/#hud \.dialog button:focus-visible/,'retained dark dialogs need their own bright focus treatment');
assert.doesNotMatch(css,/#game\s*\{/,'world art and camera must not be styled by the skin');
assert.doesNotMatch(css,/url\(/,'no reference screenshot or scene replacement is used');
console.log('PASS jade skin load order, responsive lanes, visible tool choices, warnings, focus, safe areas, and world-art isolation (not browser acceptance).');
