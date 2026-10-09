#!/usr/bin/env node
'use strict';
// Deterministic real-economy acceptance matrix. See docs/playability.md.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run } = require('./helpers/playability');
const strategyHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'helpers/playability.js'))).update(fs.readFileSync(path.join(__dirname, 'helpers/original-opening.js'))).digest('hex');
const args = process.argv.slice(2);
function arg(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const root = path.resolve(arg('--root', path.join(__dirname, '..')));
const years = Number(arg('--years', 5));
const seeds = arg('--seeds', '1,2,3,4,5,6,7,8').split(',').map(Number);
const strategies = arg('--strategies', 'normal,original,neglect,no-fuel,overexpand').split(',');
const allowed = ['normal', 'original', 'neglect', 'no-fuel', 'overexpand', 'fuel200', 'adaptive-mining'];
if (!Number.isInteger(years) || years < 1 || years > 20 || seeds.some(s => !Number.isInteger(s) || s < 1) || strategies.some(s => !allowed.includes(s))) throw Error('Invalid years/seeds/strategies');
const tuning = {};
if (arg('--gatherer-yield', null) !== null) {
  tuning.gathererYield = Number(arg('--gatherer-yield', null));
  if (!Number.isInteger(tuning.gathererYield) || tuning.gathererYield < 1 || tuning.gathererYield > 10) throw Error('Invalid --gatherer-yield');
}
const results = [];
for (const strategy of strategies) for (const seed of seeds) {
  const r = run(root, seed, strategy, years, null, tuning);
  results.push(r);
  console.log(`${strategy.padEnd(10)} seed=${seed} day=${r.day} pop=${r.population} born=${r.born} died=${r.died} cause=${JSON.stringify(r.causes)} food=${r.resources.food} fuel=${r.resources.firewood} tools=${r.resources.tools} wood=${r.resources.wood} hungryDays=${r.shortages.hungryCitizenDays} toolDays=${r.shortages.toolDays}`);
}
const checks = [];
function check(name, pass) { checks.push({ name, pass: Boolean(pass) }); }
for (const r of results) {
  if (r.strategy === 'normal' || r.strategy === 'adaptive-mining') {
    check(`${r.strategy} seed${r.seed}: survives requested horizon`, r.day === years * 48 && r.population >= 15);
    check(`${r.strategy} seed${r.seed}: no first-winter deaths`, !r.deaths.some(d => d.day <= 48));
    check(`${r.strategy} seed${r.seed}: no starvation`, !(r.causes['饿死'] > 0));
    check(`${r.strategy} seed${r.seed}: at most two cold deaths over five years`, (r.causes['冻死'] || 0) <= Math.ceil(years * 0.4));
    check(`${r.strategy} seed${r.seed}: three food days at finish`, r.resources.food >= r.population * 100 / 48 * 3);
    check(`${r.strategy} seed${r.seed}: tools maintained`, r.resources.tools > 0 && r.shortages.toolDays <= 2);
  }
  if (r.strategy === 'neglect') check(`neglect seed${r.seed}: initial food does not make survival free`, r.population === 0 && r.day <= 24 && r.causes['饿死'] === 15);
  if (r.strategy === 'no-fuel' && years >= 2) check(`no-fuel seed${r.seed}: cold remains consequential`, (r.causes['冻死'] || 0) > 0);
}
if (years >= 3) {
  const paired = results.filter(r => r.strategy === 'overexpand').map(r => [r, results.find(n => n.strategy === 'normal' && n.seed === r.seed)]).filter(([, n]) => n);
  if (paired.length) check('overexpansion causes more deaths in a majority of paired seeds', paired.filter(([r, n]) => r.died > n.died).length > paired.length / 2);
}
const failures = checks.filter(c => !c.pass);
console.log(`Acceptance: ${checks.length - failures.length}/${checks.length} checks passed${args.includes('--assert') ? '' : ' (report-only; use --assert to fail the command)'}`);
for (const c of failures) console.log(`  FAIL ${c.name}`);
const file = arg('--json', null);
if (file) fs.writeFileSync(file, JSON.stringify({ root, years, seeds, strategies, tuning, strategyHash, sourceHash: results[0] && results[0].sourceHash, checks, results }, null, 2) + '\n');
if (args.includes('--assert') && failures.length) process.exitCode = 1;
