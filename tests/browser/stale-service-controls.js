'use strict';
// Simulated failure/recovery: don't offer service control using stale status.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function run(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof poll==='function'&&!pollBusy);
  const result=await page.evaluate(async()=>{
    const originalFetch=window.fetch;
    const status=await originalFetch('/api/status',{cache:'no-store'}).then(r=>r.json());
    const fake={...status,service_actions_enabled:true,services:[
      {name:'D2K',detected:true,installed:true,pid:812,ram_mb:12.4,cpu_pct:2.0,uptime_sec:7200},
      {name:'DoQ',detected:false,installed:true,pid:null}
    ]};
    let mode='ok';
    window.fetch=(url,opts)=>url==='/api/status'?
      Promise.resolve(mode==='unauthorized'?{ok:false,status:401}:
        mode==='offline'?Promise.reject(new Error('network offline')):
        {ok:true,status:200,json:async()=>fake}):originalFetch(url,opts);
    try{
      await poll();
      const button=document.querySelector('#servicerows [data-service]');
      const initial=!!button&&!button.disabled;
      mode='unauthorized';await poll();
      const unauthorized={stale:document.body.classList.contains('telemetry-stale'),
       disabled:button?.disabled,warning:document.querySelector('#servicestale')?.textContent,
       stateText:document.querySelector('#servicebrief')?.textContent};
      await controlService('d2k','restart');
      const blocked=document.querySelector('#serviceactionstatus').textContent;
      mode='offline';await poll();
      const offline=button?.disabled&&document.body.classList.contains('telemetry-stale');
      mode='ok';await poll();
      const reconnected=!document.body.classList.contains('telemetry-stale')&&
       !document.querySelector('#servicerows [data-service]')?.disabled;
      return {initial,unauthorized,blocked,offline,reconnected};
    }finally{window.fetch=originalFetch;}
  });
  assert.ok(result.initial,label+' verified connectivity enables actions');
  assert.ok(result.unauthorized.stale&&result.unauthorized.disabled,
    label+' 401 stales data and disables control');
  assert.match(result.unauthorized.warning,/устарели/,label+' stale warning visible');
  assert.match(result.blocked,/Нет подтверждённой связи/,label+' direct action is refused');
  assert.ok(result.offline,label+' disconnected state also disables controls');
  assert.ok(result.reconnected,label+' successful status restores controls');
  console.log('PASS '+label+' stale/401/reconnect service controls');
 }finally{await browser.close();}
}
(async()=>{await run(chromium,'Chromium');await run(webkit,'WebKit');})()
 .catch(err=>{console.error(err);process.exitCode=1;});
