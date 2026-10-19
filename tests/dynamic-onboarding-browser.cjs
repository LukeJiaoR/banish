'use strict';
// Local Chromium interaction checks. Does not claim a complete simulated winter.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
 const context=await browser.newContext({viewport});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto(process.env.BANISH_QA_URL||'http://127.0.0.1:8642/');await page.waitForFunction(()=>window.G?.world);
 await page.evaluate(()=>{G.game.paused=true;G.ui.refreshHUD();});
 assert.equal(await page.locator('#help').isVisible(),false);
 assert.equal(await page.locator('#dynamic-coach').isVisible(),true);
 assert.equal(await page.locator('#coach-text').textContent(),'点「建造」');
 await page.locator('#open-build').click();await page.waitForFunction(()=>document.getElementById('coach-text').textContent.includes('食物生产'));
 await page.locator('[data-category="food"]').click();await page.waitForFunction(()=>document.getElementById('coach-text').textContent.includes('采集'));
 await page.locator('[data-tool="gatherer"]').click();await page.waitForFunction(()=>document.getElementById('coach-text').textContent.includes('放下'));
 const before=await page.evaluate(()=>({tool:G.tool.type,paused:G.game.paused,world:G.world.buildings.length}));
 await page.locator('#coach-action').click();assert(await page.locator('#coach-explanation').evaluate(n=>n.open));
 await page.locator('#coach-action').focus();await page.evaluate(()=>{for(let i=0;i<6;i++)G.ui.refreshHUD();});
 assert(await page.locator('#coach-action').evaluate(n=>n===document.activeElement));
 const after=await page.evaluate(()=>({tool:G.tool.type,paused:G.game.paused,world:G.world.buildings.length}));assert.deepEqual(after,before);
 const box=await page.locator('#dynamic-coach').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1);
 await page.screenshot({path:`/tmp/banish-coach-${viewport.width}.png`});
 await page.locator('#coach-skip').click();assert.equal(await page.locator('#dynamic-coach').isVisible(),false);assert.equal(await page.evaluate(()=>G.tool.type),'gatherer');
 // Existing help action is the explicit replay entry; its modal pause is preserved.
 await page.evaluate(()=>G.ui.toggleHelp(true));await page.locator('#coach-replay').click();assert(await page.locator('#dynamic-coach').isVisible());assert.equal(await page.locator('#help').isVisible(),false);
 await page.evaluate(()=>G.onboarding.dismiss());await page.reload();await page.waitForFunction(()=>window.G?.world);assert.equal(await page.locator('#dynamic-coach').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('PASS contextual coach desktop/mobile interaction',viewport.width);await context.close();
}} finally {await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
