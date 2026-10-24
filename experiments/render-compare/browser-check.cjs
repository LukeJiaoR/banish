'use strict';
// Uses already-installed Playwright/Chromium. No install, deployment or fallback.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||'/tmp/banish-pixi-browser');fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.json':'application/json','.png':'image/png','.css':'text/css'};
const server=http.createServer((req,res)=>{
 let filename;try{filename=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}catch{res.writeHead(400).end();return;}
 if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{if(fs.statSync(filename).isDirectory())filename=path.join(filename,'index.html');res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(filename).pipe(res);}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
  const context=await browser.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:1});const page=await context.newPage(),errors=[],failed=[],logs=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()}));page.on('console',m=>logs.push({type:m.type(),text:m.text()}));
  let delivery='official pinned CDN with SRI';
  if(process.env.PIXI_VERIFIED_CACHE){
   const lock=JSON.parse(fs.readFileSync(path.join(__dirname,'pixi.lock.json'))),bytes=fs.readFileSync(process.env.PIXI_VERIFIED_CACHE);
   assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),lock.sha256,'Official bundle cache SHA256 mismatch');
   await page.route(lock.url,r=>r.fulfill({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:bytes}));
   delivery='SHA256-verified local copy of exact official CDN bundle; SRI still enforced';
  }
  await page.addInitScript(()=>{for(const method of ['getItem','setItem','removeItem','clear'])Storage.prototype[method]=function(){throw Error('Unexpected storage access');};});
  const url=`http://127.0.0.1:${server.address().port}/experiments/render-compare/`;
  await page.goto(url);await page.waitForFunction(()=>window.renderCompare?.ready||window.renderCompare?.error,null,{timeout:120000});
  assert.equal(await page.evaluate(()=>renderCompare.error),null);assert.equal(await page.evaluate(()=>renderCompare.ready),true);
  const metadata=await page.evaluate(()=>renderCompare.metadata);assert.equal(metadata.version,'8.22.0');assert.equal(metadata.pixi.backend,'WebGL');
  await page.screenshot({path:path.join(out,'comparison-ridge.png'),fullPage:true});
  for(const scenario of ['village','ridge','overview']) {
   await page.evaluate(s=>renderCompare.camera(s),scenario);
   for(const engine of ['canvas','pixi'])await page.locator('#'+engine).screenshot({path:path.join(out,scenario+'-'+engine+'.png')});
   await page.locator('#production-detail').evaluate(d=>d.open=true);await page.evaluate(()=>renderCompare.render());await page.locator('#production').screenshot({path:path.join(out,scenario+'-production.png')});await page.locator('#production-detail').evaluate(d=>d.open=false);
  }
  const benchmark=process.env.RUN_BENCHMARK==='1'?await page.evaluate(()=>renderCompare.benchmark({samples:60,warmup:15,repeats:2,scenarios:['village','ridge','pan-zoom']})):null;
  if(benchmark){assert.equal(benchmark.complete,true);assert.equal(benchmark.worldUnchanged,true);assert.equal(benchmark.sameCoverage,true);}
  const cancelled=await page.evaluate(async()=>{const promise=renderCompare.benchmark({samples:60,warmup:5,repeats:1,scenarios:['ridge']});setTimeout(()=>document.getElementById('cancel').click(),50);return promise;});assert.equal(cancelled.complete,false);
  await page.locator('#season').selectOption('3');await page.locator('#size').selectOption('192');await page.locator('#seed').fill('42');await page.locator('#rebuild').click();
  await page.waitForFunction(()=>renderCompare.metadata?.mapSize===192&&!document.getElementById('rebuild').disabled,null,{timeout:120000});assert.equal(await page.evaluate(()=>renderCompare.error),null);const winter=await page.evaluate(()=>renderCompare.metadata);
  await page.evaluate(()=>renderCompare.camera('ridge'));for(const engine of ['canvas','pixi'])await page.locator('#'+engine).screenshot({path:path.join(out,'winter192-'+engine+'.png')});
  await page.locator('#season').selectOption('1');await page.locator('#size').selectOption('128');await page.locator('#seed').fill('0');await page.locator('#rebuild').click();
  await page.waitForFunction(()=>renderCompare.metadata?.mapSize===128&&!document.getElementById('rebuild').disabled,null,{timeout:120000});
  const repeated=await page.evaluate(()=>renderCompare.metadata);assert.equal(repeated.worldSha256,metadata.worldSha256);assert.equal(repeated.sceneSha256,metadata.sceneSha256);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),browserVersion:browser.version(),delivery,metadata,winter,benchmark,checks:{rendered:true,productionReference:true,worldAndSceneRepeat:true,rebuild128To192To128:true,benchmarkCancellation:true,storageAccess:false},errors,failed,logs},null,2));console.log('PASS browser checks',out);
 } finally {await browser?.close();server.close();}
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(out,'failure.txt'),e.stack||String(e));process.exitCode=1;server.close();});
