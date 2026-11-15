'use strict';
// A real wall-clock 10-minute browser soak on isolated GitHub Actions.
// Both browser engines run concurrently. No test fake clocks or 300 fast calls.
// All status readings come from the isolated CI server, never a home router.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
const durationMs=600_000;
const intervalMs=30_000;
async function observe(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const errors=[];let requests=0,failed=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',req=>{if(req.url().endsWith('/api/status'))requests++;});
  page.on('requestfailed',req=>{if(req.url().endsWith('/api/status'))failed++;});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#online')?.textContent.includes('Работает'),{timeout:30000});
  const initial=await page.evaluate(()=>({
   count:document.querySelectorAll('*').length,
   core:document.querySelector('#coreusage .core-row'),
   service:document.querySelector('#servicerows .service-row'),
   process:document.querySelector('#procrows tr')
  })).then(x=>({count:x.count})); // DOM nodes cannot be serialized across page.evaluate
  const start=Date.now();let min=Infinity,max=0,staleCount=0,layoutErrors=0,samples=0;
  while(Date.now()-start<durationMs){
   await page.waitForTimeout(intervalMs);
   const check=await page.evaluate(()=>({
    nodeCount:document.querySelectorAll('*').length,
    pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    stale:document.body.classList.contains('telemetry-stale'),
    active:document.querySelector('#online')?.textContent.includes('Работает'),
    liveHistory:networkLivePoints.length,
    netHistory:netPoints.length,
    processCache:processRowNodes.size,
    clock:document.querySelector('#localclock')?.textContent
   }));
   min=Math.min(min,check.nodeCount);max=Math.max(max,check.nodeCount);samples++;
   if(check.stale||!check.active)staleCount++;
   if(check.pageOverflow>2||check.liveHistory>150||check.netHistory>150||check.processCache>40)layoutErrors++;
   if(!/^\d{2}:\d{2}:\d{2}$/.test(check.clock||''))layoutErrors++;
  }
  const elapsed=Date.now()-start;
  assert.ok(elapsed>=durationMs,label+' wall-clock duration '+elapsed);
  assert.ok(requests>=240,label+' must naturally poll every 2s, observed '+requests);
  assert.equal(failed,0,label+' no failed status requests');
  assert.equal(errors.length,0,label+' browser errors: '+errors.join('; '));
  assert.equal(staleCount,0,label+' CI server stayed connected throughout');
  assert.equal(layoutErrors,0,label+' no overflow or unbounded caches');
  assert.ok(max-min<=50,label+' bounded steady-state DOM; min='+min+' max='+max);
  assert.ok(initial.count>100,label+' dashboard loaded');
  console.log('PASS '+label+' real-time soak: '+Math.round(elapsed/1000)+'s, '+requests+
    ' status requests, '+samples+' snapshots, DOM range '+min+'..'+max);
 }finally{await browser.close();}
}
Promise.all([observe(chromium,'Chromium'),observe(webkit,'WebKit')])
 .catch(e=>{console.error(e);process.exitCode=1;});
