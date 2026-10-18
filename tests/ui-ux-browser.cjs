'use strict';
/* Real Chromium acceptance runner. Requires Playwright and a launchable browser.
 * Never substitutes a DOM mock/native canvas result for browser evidence.
 * node tests/ui-ux-browser.cjs --list
 * node tests/ui-ux-browser.cjs --out /tmp/banish-ui-browser
 * Zoom cases use equivalent CSS viewport + DPR for layout coverage. Also run
 * manual desktop 125/150% browser zoom as described in docs/ui-ux-acceptance.md.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sizes=[[1440,900],[1024,640],[1280,600],[390,844],[844,390]];
const matrix=sizes.flatMap(([width,height])=>[1,1.25,1.5].map(zoom=>({width,height,zoom,
  viewport:{width:Math.round(width/zoom),height:Math.round(height/zoom)}})));
if(process.argv.includes('--list')){console.log(JSON.stringify(matrix,null,2));process.exit(0);}
const outIndex=process.argv.indexOf('--out');
const output=path.resolve(outIndex>=0&&process.argv[outIndex+1]?process.argv[outIndex+1]:'/tmp/banish-ui-browser');
const port=Number(process.env.BANISH_QA_PORT||8638),url=`http://127.0.0.1:${port}/`;
const checks=[];let browser,server;
const {chromium}=require('playwright');
async function inside(page,selector){
  const box=await page.locator(selector).boundingBox();assert(box,`${selector} must be visible`);
  const v=page.viewportSize();assert(box.x>=-1&&box.y>=-1&&box.x+box.width<=v.width+1&&box.y+box.height<=v.height+1,`${selector} outside ${JSON.stringify(v)}: ${JSON.stringify(box)}`);
}
async function captured(page,name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});}
async function noOverlap(page,a,b){const x=await page.locator(a).boundingBox(),y=await page.locator(b).boundingBox();if(x&&y)assert(x.x+x.width<=y.x+1||y.x+y.width<=x.x+1||x.y+x.height<=y.y+1||y.y+y.height<=x.y+1,`${a} overlaps ${b}`);}
async function scenario(c){
  const context=await browser.newContext({viewport:c.viewport,deviceScaleFactor:c.zoom});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Local QA has no feedback/save service. Do not submit or upload test data.
  await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
  const id=`${c.width}x${c.height}-z${c.zoom}`;
  try{
    await page.goto(url);await page.waitForFunction(()=>window.G?.world&&G.ui?.el?.toolbar);
    if(await page.locator('#help').isVisible())await page.locator('#help-close').click();
    await page.evaluate(()=>{G.game.paused=true;G.ui.refreshHUD();});
    await inside(page,'#topbar');await inside(page,'#toolbar');
    assert.equal(await page.locator('#core-resources .res').count(),6);
    await captured(page,id+'-hud');
    await page.locator('#resource-more').click();await inside(page,'#resource-more');await inside(page,'#secondary-resources');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#resource-more').getAttribute('aria-expanded'),'false');
    assert(await page.locator('#resource-more').evaluate(n=>n===document.activeElement));
    await page.locator('#btn-new').click();await inside(page,'#new-game-close');await inside(page,'#new-game-review-button');
    await page.locator('#new-game-seed').fill('0');await page.locator('#new-game-preset-hard').click();
    await page.locator('#new-game-size-192').click();await page.locator('#new-game-seed').focus();
    await page.keyboard.press('Shift+Tab');assert(await page.locator('#new-game-settings').evaluate(n=>n.contains(document.activeElement)));
    await captured(page,id+'-new-edit');
    await page.locator('#new-game-review-button').click();await inside(page,'#new-game-warning');await inside(page,'#new-game-confirm');await inside(page,'#new-game-close');
    assert.match(await page.locator('#new-game-warning').textContent(),/未保存进度.*自动档/);
    await captured(page,id+'-new-review');
    await page.locator('#new-game-back').click();assert.equal(await page.locator('#new-game-seed').inputValue(),'0');
    const old=await page.evaluate(()=>JSON.stringify(G.serializeGame()));await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>JSON.stringify(G.serializeGame())),old);
    await page.locator('#btn-new').click();await page.locator('#new-game-seed').fill('419');
    await page.locator('#new-game-review-button').click();
    await page.evaluate(()=>{const original=G.confirmNewGame;window.__qaNewGameCalls=0;G.confirmNewGame=function(...args){window.__qaNewGameCalls++;return original.apply(this,args);};});
    await page.locator('#new-game-confirm').dblclick();
    await page.waitForFunction(()=>document.getElementById('new-game-settings').classList.contains('hidden'));
    assert.equal(await page.evaluate(()=>G.world.seed),419);assert.equal(await page.evaluate(()=>window.__qaNewGameCalls),1);
    await page.evaluate(()=>{G.game.paused=true;G.ui.refreshHUD();});
    await page.locator('#btn-production-goals').click();assert.equal(await page.locator('[id^="goal-input-"]').count(),20);
    await inside(page,'#production-goals-apply');await inside(page,'#production-goals-close');
    const targets=await page.evaluate(()=>JSON.stringify(G.game.productionGoals));
    await page.locator('#goal-preset-winter').click();assert.equal(await page.evaluate(()=>JSON.stringify(G.game.productionGoals)),targets);
    await page.locator('#goal-input-tools').fill('0');await page.locator('#production-goals-apply').click();
    assert.equal(await page.evaluate(()=>G.productionGoalOf('tools')),0);
    await captured(page,id+'-goals');await page.keyboard.press('Escape');
    await page.evaluate(()=>{G.game.res.wood=0;G.ui.refreshHUD();});
    await page.locator('[data-category="homes"]').click();await page.locator('[data-tool="house"]').click();
    assert.equal(await page.evaluate(()=>G.tool?.type),'house');
    await page.evaluate(()=>{G.hover={tx:G.world.start.x+3,ty:G.world.start.y+3};G.ui.refreshPlacement('house',G.hover.tx,G.hover.ty);});
    await inside(page,'#toolbar');await noOverlap(page,'#placement-panel','#toolbar');await captured(page,id+'-build');
    await page.locator('#toolbar-cancel').click();await page.locator('#toolbar-back').click();
    await page.evaluate(()=>{const b=G.world.buildings.find(x=>x.type==='storage')||G.world.buildings[0];G.sel={kind:'b',id:b.id};G.ui.showInfo();});
    await inside(page,'#info-close');await noOverlap(page,'#info','#toolbar');await captured(page,id+'-building');
    await page.locator('#info-close').click();
    await page.evaluate(()=>{G.sel={kind:'c',id:G.world.citizens[0].id};G.ui.showInfo();});
    await inside(page,'#info-close');await captured(page,id+'-citizen');
    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__errs),[]);
    checks.push({...c,status:'passed',screenshots:7});
  }catch(e){checks.push({...c,status:'failed',error:e.stack});await captured(page,id+'-failure').catch(()=>{});throw e;}
  finally{await context.close();}
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  server=spawn('python3',['dev-server.py',String(port)],{cwd:root,stdio:'ignore'});
  for(let n=0;n<30;n++){try{const r=await fetch(url);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  for(const c of matrix)await scenario(c);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)server.kill();
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({timestamp:new Date().toISOString(),browserStarted:!!browser,zoomMethod:'equivalent CSS viewport and DPR; manual browser zoom also required',checks},null,2));
});
