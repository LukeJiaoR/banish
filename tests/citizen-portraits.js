'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {loadGame} = require('./helpers/playability'), root = path.resolve(__dirname, '..'), G = loadGame(root);
G.newGame(17);
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), {G, console});
const ui = G.ui, c = G.world.citizens[0], before = JSON.stringify(G.serializeGame());
for (const [age, sex, expected] of [[0,'f','child-girl'],[9.99,'m','child-boy'],[10,'f','adult-woman'],[59.99,'m','adult-man'],[60,'f','elder-woman'],[90,'m','elder-man']]) {
  const person = {...c, age, sex}; const key = ui.citizenPortraitKey(person);
  assert.match(key,new RegExp('^'+expected+'-0[12]$')); if(age<10||age>=60)assert.equal(key,expected+'-01'); assert(fs.existsSync(path.join(root, 'assets/portraits', key+'.png')));
  for (const job of [null, 10, 200]) assert.equal(ui.citizenPortraitKey({...person, job, student: true}), key);
}
for (const bad of [{id:null},{id:NaN},{sex:null},{sex:'unknown'},{age:null},{age:NaN},{age:-1}]) assert.equal(ui.citizenPortraitKey({...c,...bad}),null);
assert.match(ui.citizenRoleText({}),/性别未知 · 年龄未知 · 身份未知/);
for(let i=0;i<100;i++) ui.citizenPortraitMarkup(c);
assert.equal(JSON.stringify(G.serializeGame()),before);
assert.equal(ui.citizenPortraitKey(JSON.parse(JSON.stringify(c))),ui.citizenPortraitKey(c));
console.log('PASS: six stages, boundaries, missing data, stable id/job/load mapping, zero serialized mutation');

const seen=new Set();for(let id=1;id<=100;id++){
 const p={...c,id,age:30,sex:'m'},key=ui.citizenPortraitKey(p);seen.add(key);
 assert.equal(key,ui.citizenPortraitKey({...p,age:59.99,job:999}));
 assert.equal(key.replace('man','woman'),ui.citizenPortraitKey({...p,sex:'f'}));
 assert.equal(key,ui.citizenPortraitKey(JSON.parse(JSON.stringify(p))));
 assert.equal(ui.citizenPortraitKey({...p,age:8}),'child-boy-01');
 assert.equal(ui.citizenPortraitKey({...p,age:60}),'elder-man-01');
}assert.equal(seen.size,2);console.log('PASS: both adult families, shared family across sex, explicit missing-stage fallback, 100 stable ids');
