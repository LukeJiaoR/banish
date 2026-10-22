'use strict';
/* Assigned-VM browser acceptance with synthetic homes, not survival evidence.
 * Run: node tests/winter-heating-browser.cjs [output-directory]
 * A browser launch denial is a blocker, never a reason to relax permissions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||'/tmp/banish-winter-heating-browser'),port=Number(process.env.BANISH_QA_PORT||8648);let server,browser;
(async()=>{
 fs.mkdirSync(output,{recursive:true});server=spawn('python3',['dev-server.py',String(port)],{cwd:root,stdio:'ignore'});await new Promise(r=>setTimeout(r,500));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const results=[];
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.G?.world);
  await page.evaluate(()=>{G.game.paused=true;G.onboarding?.dismiss();});await page.locator('#open-town').click();await page.locator('#btn-new').click();await page.locator('#new-game-climate-harsh').click();await page.locator('#new-game-seed').fill('17');await page.locator('#new-game-review-button').click();assert.match(await page.locator('#new-game-confirm-summary').textContent(),/v6.*旧程序无法读取/);await page.locator('#new-game-confirm').click();await page.waitForFunction(()=>G.world.seed===17&&G.game.heatRules?.v===1);
  const expected=await page.evaluate(()=>{
   G.game.paused=true;G.onboarding?.dismiss();G.ui.setMode?.('map');const w=G.world;let b;
   for(let y=3;y<w.N-10&&!b;y++)for(let x=3;x<w.N-10&&!b;x++)if(G.canPlace(w,'house',x,y).ok)b=G.addBuilding('house',x,y,{instant:true,free:true}).b;
   if(!b)throw Error('No legal synthetic home');const f=w.families[0];if(f.houseId&&w.bmap[f.houseId])w.bmap[f.houseId].family=null;f.houseId=b.id;b.family=f.id;
   G.game.day=35;G.game.season=2;G.game.year=1;G.advanceCropClimate();G.advanceHomeHeating();G.game.townLedger=G.newTownLedger(G.game);G.game.industryLedger=G.newIndustryLedger(G.game);G.game.res.firewood=100;G.game.h=23.9;G.game.paused=false;G.advanceSim(.2);G.game.paused=true;
   G.sel={kind:'b',id:b.id};G.ui.showInfo();G.ui.refreshHUD();return {need:b.lastHeating.need,wood:b.lastHeating.wood,temperature:G.climateWeather().temperature,full:G.homeHeatingWinterBudget(b)};
  });
  const panel=page.locator('[data-heating-panel]');await panel.scrollIntoViewIfNeeded();assert.match(await page.locator('[data-heating="home"]').textContent(),new RegExp(`今日气温 ${expected.temperature}°C`));assert((await page.locator('[data-heating="home"]').textContent()).includes(expected.need.toFixed(2)));assert((await page.locator('[data-heating="receipt"]').textContent()).includes(expected.wood.toFixed(2)));
  const field=page.locator('#heating-reserve');await field.focus();await field.fill('31');await page.evaluate(()=>{for(let i=0;i<5;i++)G.ui.renderInfo();});assert(await field.evaluate(el=>el===document.activeElement));assert.equal(await field.inputValue(),'31');await page.screenshot({path:path.join(output,`${viewport.width}-winter-heating.png`)});
  assert.deepEqual(errors,[]);results.push({viewport,newGameV6:true,liveHeatingText:true,focus:true,scope:'Synthetic occupied home; no whole-village survival claim'});await context.close();
 }
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.kill();});
