/* Single-seed opening diagnostic. The pre-0.3.3 policy is frozen in
 * helpers/original-opening.js; full acceptance is tests/playability.js --assert.
 * Usage: node tests/opening.js [seed] [years]
 */
'use strict';
const path = require('node:path');
const { run } = require('./helpers/playability');
const seed = Number(process.argv[2] || 1), years = Number(process.argv[3] || 3);
if (!Number.isInteger(seed) || seed < 1 || !Number.isInteger(years) || years < 1 || years > 20) throw Error('Expected seed>=1 and years1..20');
const r = run(path.join(__dirname, '..'), seed, 'normal', years);
console.log(`开局诊断：种子${seed}，${years}年，真实建造与搬运，非真人试玩`);
for (const s of r.snapshots) console.log(`d${s.day}: 人口${s.pop} 食${s.food} 柴${s.firewood} 木${s.wood} 工具${s.tools} 死亡${s.deaths}`);
console.log(`结局：人口${r.population} 出生${r.born} 死亡${r.died} 死因${JSON.stringify(r.causes)}`);
console.log('各冬最低储备：' + JSON.stringify(r.winterMinima));
console.log('建造序列：' + r.buildLog.join(' '));
console.log('完整验收：node tests/playability.js --assert');
