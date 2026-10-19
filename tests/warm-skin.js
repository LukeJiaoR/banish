'use strict';
// Static presentation contracts, not rendered-browser acceptance.
const fs=require('node:fs'),assert=require('node:assert/strict');
const css=fs.readFileSync('styles/warm-skin.css','utf8');
const html=fs.readFileSync('index.html','utf8');
assert(html.indexOf('styles/warm-skin.css')>html.indexOf('styles/navigation.css'));
assert(!css.includes('!important'),'skin must not escalate the legacy cascade with important');
assert(!/filter\s*:|url\(/.test(css),'preserve original art and avoid texture/network dependencies');
assert.match(css,/#toolbar #toolbar-categories \{ display:flex; overflow-x:auto/);
assert.match(css,/#hud #toolbar \.tb:active[\s\S]*transform:none; box-shadow:inset/);
assert.match(css,/#toolbar \.tb\.is-short \.material-badge \{ background:#8b3e2c/);
assert.match(css,/@media\(max-height:600px\)/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(css,/:focus-visible/);
function luminance(h){const c=h.match(/\w\w/g).map(n=>parseInt(n,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
for(const [fg,bg] of [['503a24','ead5ab'],['715336','ead5ab'],['f2e5ce','514235'],['dcc9a7','594735'],['fff3df','8b3e2c']]){
 const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 assert(ratio>=4.5,`${fg}/${bg} contrast ${ratio}`); console.log(`contrast #${fg}/#${bg}: ${ratio.toFixed(2)}:1`);
}
console.log('Warm skin static contracts passed; no browser/layout acceptance claimed.');
