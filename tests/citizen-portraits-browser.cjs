'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||'/tmp/banish-portrait-evidence'),port=8663;let server,browser;
(async()=>{
 fs.mkdirSync(output,{recursive:true});server=spawn('python3',['dev-server.py',String(port)],{cwd:root,stdio:'ignore'});await new Promise(r=>setTimeout(r,500));
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const results=[];
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.G?.world);
  await page.evaluate(()=>{G.game.paused=true;G.onboarding?.dismiss();G.ui.setMode?.('map');});
  const stages=[];
  for(const [age,sex,key] of [[8,'f','child-girl'],[8,'m','child-boy'],[30,'f','adult-woman'],[30,'m','adult-man'],[70,'f','elder-woman'],[70,'m','elder-man']]){
   await page.evaluate(({age,sex})=>{const c=G.world.citizens[0];Object.assign(c,{age,sex,adult:age>=G.ADULT_AGE});G.sel={kind:'c',id:c.id};G.ui.showInfo();},{age,sex});
   const img=page.locator('[data-citizen-portrait] img');await img.evaluate(im=>im.decode());assert((await img.getAttribute('src')).includes(key));
   const pixels=await img.evaluate(im=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');ctx.drawImage(im,0,0,64,64);const a=ctx.getImageData(0,0,64,64).data;return {painted:Array.from(a).filter((_,i)=>i%4===3&&a[i]>0).length,clear:Array.from(a).filter((_,i)=>i%4===3&&a[i]===0).length};});assert(pixels.painted>1000);assert(pixels.clear>100);stages.push({key,...pixels});
   await page.screenshot({path:path.join(output,`${viewport.width}-${key}.png`)});
  }
  const unchanged=await page.evaluate(()=>{const c=G.world.citizens[0],save=JSON.stringify(G.serializeGame()),key=G.ui.citizenPortraitKey(c);for(let i=0;i<10;i++)G.ui.renderInfo();return save===JSON.stringify(G.serializeGame())&&key===G.ui.citizenPortraitKey(c);});assert(unchanged);
  await page.evaluate(()=>{G.world.citizens[0].age=59.99;G.ui.renderInfo();G.world.citizens[0].age=60;G.ui.renderInfo();});assert((await page.locator('[data-citizen-portrait] img').getAttribute('src')).includes('elder'));
  await page.evaluate(()=>{document.querySelector('[data-citizen-portrait] img').src='assets/portraits/missing.png';});await page.waitForFunction(()=>!document.querySelector('[data-citizen-portrait] img'));assert(await page.locator('[data-citizen-portrait] .portrait-fallback').isVisible());
  await page.evaluate(()=>{G.world.citizens[0].sex=null;G.ui.renderInfo(true);});assert.equal(await page.locator('[data-citizen-portrait] img').count(),0);assert((await page.locator('[data-citizen-role]').textContent()).includes('性别未知'));
  await page.locator('#info-close').click();assert(await page.locator('#info').evaluate(el=>el.classList.contains('hidden')));assert.deepEqual(errors,[]);results.push({viewport,stages,unchanged,missingImageFallback:true,missingDataFallback:true,close:true});await page.close();
 }
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.kill();});
