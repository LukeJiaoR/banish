'use strict';
/* Real Chromium acceptance runner. Requires Playwright and a launchable browser.
 * Never substitutes a DOM mock/native canvas result for browser evidence.
 * node tests/ui-ux-browser.cjs --list
 * node tests/ui-ux-browser.cjs --out /tmp/banish-ui-browser --reference /path/to/selected-a.png
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
const refIndex=process.argv.indexOf('--reference'),reference=refIndex>=0?process.argv[refIndex+1]:null;
if(refIndex>=0){assert(reference,'--reference requires a PNG path');assert.equal(path.extname(reference).toLowerCase(),'.png');assert(fs.statSync(path.resolve(reference)).isFile(),'Reference must be a file');}
const port=Number(process.env.BANISH_QA_PORT||8638),url=`http://127.0.0.1:${port}/`;
const checks=[],screenshots=[];let browser,server;
const sourceFiles=['index.html','style.css',...fs.readdirSync(path.join(root,'js')).filter(f=>f.endsWith('.js')).map(f=>'js/'+f),...fs.readdirSync(path.join(root,'styles')).filter(f=>f.endsWith('.css')).map(f=>'styles/'+f)];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const {chromium}=require('playwright');
async function inside(page,selector){
  const box=await page.locator(selector).boundingBox();assert(box,`${selector} must be visible`);
  const v=page.viewportSize();assert(box.x>=-1&&box.y>=-1&&box.x+box.width<=v.width+1&&box.y+box.height<=v.height+1,`${selector} outside ${JSON.stringify(v)}: ${JSON.stringify(box)}`);
}
async function captured(page,name){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(im=>im.decode().catch(()=>{})));});await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});screenshots.push(name+'.png');}
async function click(page,selector){
  const node=page.locator(selector);await node.scrollIntoViewIfNeeded();
  // Normal Playwright clicks enforce visibility, enabled state and hit-testing.
  // Never force clicks or invoke DOM click() to conceal an inaccessible control.
  await node.click();
}
async function management(page){
  if(!await page.locator('#town-controls').isVisible())await click(page,'#open-town');
  assert.equal(await page.locator('#open-town').getAttribute('aria-expanded'),'true');
}
async function withinWorkspace(page,selector){
  await page.locator(selector).scrollIntoViewIfNeeded();
  await inside(page,selector);
  const box=await page.locator(selector).boundingBox(),tray=await page.locator('#toolbar').boundingBox();
  assert(tray&&box.x>=tray.x-1&&box.y>=tray.y-1&&box.x+box.width<=tray.x+tray.width+1&&box.y+box.height<=tray.y+tray.height+1,selector+' must stay inside the build workspace');
  if(page.viewportSize().width>760)assert(tray.x>=page.viewportSize().width/2,'desktop next step must stay on the right');
}
async function catalog(page,id){
  await click(page,'#open-build');await inside(page,'#toolbar');
  const groups=await page.evaluate(()=>G.ui.toolGroups.map(g=>({id:g.id,tools:[...g.tools]})));
  const expected=await page.evaluate(()=>[...Object.keys(G.BDEF).filter(t=>!G.BDEF[t].unbuildable),'fell','quarry','demolish'].sort());
  const actual=await page.locator('#toolbar [data-tool]').evaluateAll(nodes=>nodes.map(n=>n.dataset.tool).sort());
  assert.equal(actual.length,34);assert.equal(new Set(actual).size,34);assert.deepEqual(actual,expected);
  const visited=[];
  for(const group of groups){
    await click(page,`[data-category="${group.id}"]`);
    await captured(page,id+'-catalog-'+group.id+'-first');
    for(const type of group.tools){
      const selector=`[data-tool="${type}"]`;
      await click(page,selector);await page.locator(selector).scrollIntoViewIfNeeded();await withinWorkspace(page,selector);
      assert(await page.locator(selector+' .lb').isVisible(),type+' needs a visible name');
      const surfaces={road:'dirt',stoneroad:'stone',bridge:'bridge',tunnel:'tunnel'};
      const wanted=surfaces[type]?{kind:'road',surface:surfaces[type]}:['fell','quarry','demolish'].includes(type)?{kind:type}:{kind:'build',type};
      assert.deepEqual(await page.evaluate(()=>G.tool&&JSON.parse(JSON.stringify(G.tool))),wanted);
      assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');
      await page.locator('#jade-build-title').scrollIntoViewIfNeeded();await withinWorkspace(page,'#jade-build-title');
      await click(page,'#toolbar-cancel');assert.equal(await page.evaluate(()=>G.tool),null);
      assert(await page.locator(selector).evaluate(n=>n===document.activeElement));visited.push(type);
    }
    await page.locator(`[data-tool="${group.tools.at(-1)}"]`).scrollIntoViewIfNeeded();
    await captured(page,id+'-catalog-'+group.id+'-last');
    await click(page,'#toolbar-back');
  }
  assert.deepEqual(visited.sort(),expected);
  await click(page,'#close-build');
  return visited;
}
async function mapSite(page){
  // Find a valid site in the actual generated world; do not clear terrain or
  // replace placement APIs. Camera setup only makes the chosen tile reachable.
  const point=await page.evaluate(()=>{
    const def=G.BDEF.house,w=G.world;
    const sites=[];for(let y=2;y<w.N-def.h-2;y++)for(let x=2;x<w.N-def.w-2;x++)sites.push({x,y});
    sites.sort((a,b)=>(a.x-w.start.x)**2+(a.y-w.start.y)**2-((b.x-w.start.x)**2+(b.y-w.start.y)**2));
    for(const {x,y}of sites){
      if(!G.canPlace(w,'house',x,y).ok)continue;
      const tx=x+((def.w-1)>>1),ty=y+((def.h-1)>>1);
      const canvas=document.getElementById('game'),rect=canvas.getBoundingClientRect();
      const [sx,sy]=G.T2S(tx+.5,ty+.5);
      let target;
      // Small landscape/reflow viewports may put the guide over the preferred
      // point. Select real uncovered canvas, never hide overlays to make a test pass.
      for(let py=80;py<rect.height-8&&!target;py+=12)for(let px=12;px<rect.width-8;px+=12){
        if(document.elementFromPoint(rect.x+px,rect.y+py)===canvas){target={x:px,y:py};break;}
      }
      if(!target)throw new Error('No uncovered canvas point available for placement');
      G.cam.x=target.x-sx*G.cam.z;G.cam.y=target.y-sy*G.cam.z;
      return {tx,ty,x:rect.x+target.x,y:rect.y+target.y};
    }
    throw new Error('Generated world has no valid house site');
  });
  await page.waitForFunction(p=>document.elementFromPoint(p.x,p.y)?.id==='game',point);
  await page.mouse.click(point.x,point.y);
  await page.waitForFunction(p=>G.currentBuildingPlacement()?.tx===p.tx&&G.currentBuildingPlacement()?.ty===p.ty,point);
  return point;
}
async function noOverlap(page,a,b){const x=await page.locator(a).boundingBox(),y=await page.locator(b).boundingBox();if(x&&y)assert(x.x+x.width<=y.x+1||y.x+y.width<=x.x+1||x.y+x.height<=y.y+1||y.y+y.height<=x.y+1,`${a} overlaps ${b}`);}
async function scenario(c){
  const context=await browser.newContext({viewport:c.viewport,deviceScaleFactor:c.zoom});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Local QA has no feedback/save service. Do not submit or upload test data.
  await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
  const id=`${c.width}x${c.height}-z${c.zoom}`,firstScreenshot=screenshots.length;
  try{
    await page.goto(url);await page.waitForFunction(()=>window.G?.world&&G.ui?.el?.toolbar&&G.SPR?.ready);
    assert.deepEqual(await page.evaluate(()=>G.SPR.failed),[],'sprite loading must finish without missing art');
    if(await page.locator('#help').isVisible())await page.locator('#help-close').click();
    await page.evaluate(()=>{G.game.paused=true;G.ui.refreshHUD();});
    await inside(page,'#topbar');assert.equal(await page.locator('#toolbar').isVisible(),false);
    assert.deepEqual(await page.locator('#core-resources .res').evaluateAll(nodes=>nodes.map(n=>n.dataset.resource)),['food','wood','stone']);
    const savedStocks=await page.evaluate(()=>{const old={...G.game.res};for(const key of G.RES_KEYS)G.game.res[key]=0;G.ui.refreshHUD();return old;});
    for(const key of ['food','wood','stone']){assert(await page.locator('#res-'+key).isVisible());assert.equal((await page.locator('#res-'+key+' b').textContent()).trim(),'0');}
    await captured(page,id+'-hud');
    await click(page,'#resource-more');await inside(page,'#resource-more');await inside(page,'#secondary-resources');
    const keys=await page.evaluate(()=>G.RES_KEYS);
    for(const key of keys){
      const node=page.locator('#res-'+key);assert.equal(await node.count(),1);
      await node.scrollIntoViewIfNeeded();await inside(page,'#res-'+key);
      assert(await node.isVisible());assert.equal((await node.locator('b').textContent()).trim(),'0');
    }
    for(const key of ['iron','tools','firewood'])assert.equal(await page.locator('#secondary-resources #res-'+key).count(),1);
    await captured(page,id+'-resources-more');
    await page.evaluate(stocks=>{Object.assign(G.game.res,stocks);G.ui.refreshHUD();},savedStocks);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#resource-more').getAttribute('aria-expanded'),'false');
    assert(await page.locator('#resource-more').evaluate(n=>n===document.activeElement));
    await management(page);await click(page,'#btn-new');await inside(page,'#new-game-close');await inside(page,'#new-game-review-button');
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
    await management(page);await click(page,'#btn-new');await page.locator('#new-game-seed').fill('419');await click(page,'#new-game-preset-classic');
    await page.locator('#new-game-review-button').click();
    await page.evaluate(()=>{const original=G.confirmNewGame;window.__qaNewGameCalls=0;G.confirmNewGame=function(...args){window.__qaNewGameCalls++;return original.apply(this,args);};});
    await page.locator('#new-game-confirm').dblclick();
    await page.waitForFunction(()=>document.getElementById('new-game-settings').classList.contains('hidden'));
    assert.equal(await page.evaluate(()=>G.world.seed),419);assert.equal(await page.evaluate(()=>window.__qaNewGameCalls),1);
    await page.evaluate(()=>{G.game.paused=true;G.ui.refreshHUD();});
    await management(page);await click(page,'#btn-production-goals');assert.equal(await page.locator('[id^="goal-input-"]').count(),20);
    await inside(page,'#production-goals-apply');await inside(page,'#production-goals-close');
    const targets=await page.evaluate(()=>JSON.stringify(G.game.productionGoals));
    await page.locator('#goal-preset-winter').click();assert.equal(await page.evaluate(()=>JSON.stringify(G.game.productionGoals)),targets);
    await page.locator('#goal-input-tools').fill('0');await page.locator('#production-goals-apply').click();
    assert.equal(await page.evaluate(()=>G.productionGoalOf('tools')),0);
    await captured(page,id+'-goals');await page.keyboard.press('Escape');
    await click(page,'#close-town');
    const visitedTools=await catalog(page,id);
    await click(page,'#open-build');await click(page,'[data-category="homes"]');await click(page,'[data-tool="house"]');
    assert.equal(await page.evaluate(()=>G.tool?.type),'house');
    assert.equal(await page.locator('#jade-build-confirm').isEnabled(),false);
    const beforePlacement=await page.evaluate(()=>G.world.buildings.length);
    await page.evaluate(()=>{G.game.res.wood=0;G.ui.refreshHUD();});
    await mapSite(page);
    assert.equal(await page.locator('#jade-build-confirm').isEnabled(),false);
    assert.match(await page.locator('#jade-build-benefit').textContent(),/木材不足/);
    await withinWorkspace(page,'#jade-build-title');await withinWorkspace(page,'#jade-build-confirm');
    await captured(page,id+'-build-blocked');
    await click(page,'#jade-build-title');
    await page.locator('#jade-build-description').scrollIntoViewIfNeeded();
    assert(await page.locator('#jade-build-description').isVisible());
    await withinWorkspace(page,'#placement-panel');await captured(page,id+'-build-details');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#jade-build-title').getAttribute('aria-expanded'),'false');
    assert(await page.evaluate(()=>!!G.currentBuildingPlacement()));
    await page.evaluate(()=>{for(const [key,qty]of Object.entries(G.BDEF.house.cost))G.game.res[key]=Math.max(G.game.res[key],qty);G.ui.refreshHUD();});
    assert(await page.locator('#jade-build-confirm').isEnabled());
    await withinWorkspace(page,'#jade-build-confirm');await withinWorkspace(page,'#toolbar-cancel');
    await noOverlap(page,'#toolbar-group-homes','#jade-build-actions');
    await captured(page,id+'-build-valid');
    await click(page,'#jade-build-confirm');
    assert.equal(await page.evaluate(()=>G.world.buildings.length),beforePlacement+1);
    assert.equal(await page.evaluate(()=>G.currentBuildingPlacement()),null);
    assert.equal(await page.locator('#jade-build-confirm').isEnabled(),false);
    await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>G.world.buildings.length),beforePlacement+1);
    await captured(page,id+'-build-confirmed');
    await mapSite(page);assert(await page.evaluate(()=>!!G.currentBuildingPlacement()));
    await click(page,'#toolbar-cancel');assert.equal(await page.evaluate(()=>G.currentBuildingPlacement()),null);
    assert.equal(await page.evaluate(()=>G.world.buildings.length),beforePlacement+1);
    await click(page,'#toolbar-back');await click(page,'#close-build');
    await page.evaluate(()=>{const b=G.world.buildings.find(x=>x.type==='storage')||G.world.buildings[0];G.sel={kind:'b',id:b.id};G.ui.showInfo();});
    await inside(page,'#info-close');await inside(page,'#topbar');assert.equal(await page.locator('#toolbar').isVisible(),false);await noOverlap(page,'#info','#toolbar');await captured(page,id+'-building');
    await page.locator('#info-close').click();
    await page.evaluate(()=>{G.sel={kind:'c',id:G.world.citizens[0].id};G.ui.showInfo();});
    await inside(page,'#info-close');await captured(page,id+'-citizen');
    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__errs),[]);
    checks.push({...c,status:'passed',visitedTools,screenshots:screenshots.slice(firstScreenshot)});
  }catch(e){await captured(page,id+'-failure').catch(()=>{});checks.push({...c,status:'failed',error:e.stack,screenshots:screenshots.slice(firstScreenshot)});throw e;}
  finally{await context.close();}
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  server=spawn('python3',['dev-server.py',String(port)],{cwd:root,stdio:'ignore'});
  let serverError;server.on('error',e=>{serverError=e;});
  let ready=false;
  for(let n=0;n<30;n++){
    if(serverError)throw serverError;
    if(server.exitCode!==null)throw new Error('QA server exited; refusing another process on the same port');
    try{const r=await fetch(url);if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert(ready,'QA server did not become ready');
  for(const file of sourceFiles){const response=await fetch(url+file);assert(response.ok,'Missing served source: '+file);assert.equal(require('node:crypto').createHash('sha256').update(await response.text()).digest('hex'),sourceHashes[file],'Served checkout mismatch: '+file);}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  for(const c of matrix)await scenario(c);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)server.kill();
  fs.mkdirSync(output,{recursive:true});
  let referenceError;
  if(reference)try{fs.copyFileSync(path.resolve(reference),path.join(output,'selected-a.png'));}catch(e){referenceError=e.message;process.exitCode=1;}
  // Persist results even when optional reference copying fails.
  const report={timestamp:new Date().toISOString(),sourceHashes,browserStarted:!!browser,referenceError,visualAcceptance:'Requires human inspection against selected A; automated assertions are not visual approval',zoomMethod:'equivalent CSS viewport and DPR; manual browser zoom also required',checks};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
  const escape=value=>String(value).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  fs.writeFileSync(path.join(output,'visual-review.html'),'<!doctype html><meta charset="utf-8"><title>Banish UI review</title><style>body{font:16px system-ui;background:#eee;padding:24px}img{max-width:100%;height:auto}section{margin:24px 0;padding:16px;background:white}</style><h1>Actual browser captures: manual A comparison required</h1><p>Check compact HUD, guide chip, right-side desktop selection/actions, readable names, all catalog rows, clipping, and mobile details. The catalog intentionally shares the right workspace. Source hashes are in results.json. No screenshot means no browser evidence.</p>'+(reference&&!referenceError?'<section><h2>Selected A reference</h2><img src="selected-a.png"></section>':'<p>No reference supplied. Pass --reference /path/to/selected-a.png to include the chosen reference without modifying it.</p>')+screenshots.map(file=>'<section><h2>'+escape(file)+'</h2><img src="'+escape(file)+'"></section>').join(''));

});
