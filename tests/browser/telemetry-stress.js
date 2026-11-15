'use strict';
// Fast-forward 300 polling cycles (a nominal 10 min at 2s refresh).
// This is an accelerated DOM/integrity regression, not a 10-minute soak.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function verify(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof poll==='function'&&!pollBusy&&typeof renderServiceState==='function');
  const result=await page.evaluate(async()=>{
   const nativeFetch=window.fetch;
   const source=await nativeFetch('/api/status',{cache:'no-store'}).then(r=>r.json());
   const status={...source,wan_iface:'wan-test',wan_route_status:'main_ipv4_route',
    network:[{name:'wan-test',rx:1000,tx:500},{name:'br-lan',rx:2000,tx:500}],
    cores:[{id:0,usage:25},{id:1,usage:40}],
    processes:[{pid:812,name:'test-one',cpu:2,mem:4},{pid:813,name:'test-two',cpu:1,mem:3}],
    services:[{name:'D2K',detected:true,installed:true,pid:812,processes:1,ram_mb:8.5,cpu_pct:1.5,uptime_sec:7200},
      {name:'DoQ',detected:false,installed:true,pid:null,processes:0}]};
   let mode='ok',requests=0,outages=0;
   window.fetch=(url,opts)=>{
    const path=typeof url==='string'?url:String(url);
    if(path==='/api/status'){
     requests++;
     if(mode==='offline')return Promise.reject(new Error('synthetic offline'));
     if(mode==='401')return Promise.resolve({ok:false,status:401});
     return Promise.resolve({ok:true,status:200,json:async()=>status});
    }
    if(path==='/api/history')return Promise.resolve({ok:true,status:200,json:async()=>({points:[[100,25,50,40],[110,30,55,41]]})});
    if(path.startsWith('/api/network-history?'))return Promise.resolve({ok:true,status:200,json:async()=>({points:[[100,1000,500],[102,1100,600]]})});
    return nativeFetch(url,opts);
   };
   try{
    await poll();
    const initial=document.querySelector('#servicerows .service-row');
    const initialCore=document.querySelector('#coreusage .core-row');
    const initialProc=document.querySelector('#procrows tr');
    const initialCount=document.querySelectorAll('*').length;
    let staleValid=true;
    for(let i=0;i<300;i++){
     mode=i%43===0?'offline':i%41===0?'401':'ok';
     if(mode!=='ok')outages++;
     status.cpu=(i%71)+1;
     status.services[0].cpu_pct=i%12;
     status.services[0].ram_mb=8+(i%7)/10;
     await poll();
     const stale=document.body.classList.contains('telemetry-stale');
     if(stale!==(mode!=='ok'))staleValid=false;
     if(stale&&Array.from(document.querySelectorAll('#servicerows [data-service]')).some(b=>!b.disabled))staleValid=false;
    }
    mode='ok';await poll();
    return {requests,outages,staleValid,
     recovered:!document.body.classList.contains('telemetry-stale')&&document.querySelector('#online')?.textContent.includes('Работает'),
     coresStable:initialCore===document.querySelector('#coreusage .core-row'),
     procsStable:initialProc===document.querySelector('#procrows tr'),
     serviceStable:initial===document.querySelector('#servicerows .service-row'),
     before:initialCount,after:document.querySelectorAll('*').length,
     networkHistorySize:netPoints.length,networkLiveSize:networkLivePoints.length,
     processCache:processRowNodes.size,
     widthOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    };
   }finally{window.fetch=nativeFetch;}
  });
  assert.equal(errors.length,0,label+' page errors '+errors.join('; '));
  assert.equal(result.requests,302,label+' 1 initial + 300 + 1 final status requests');
  assert.ok(result.outages>10,label+' covers multiple outages');
  assert.ok(result.staleValid&&result.recovered,label+' all failures marked stale and recovery works');
  assert.ok(result.coresStable&&result.procsStable&&result.serviceStable,label+' stable DOM identities');
  assert.ok(result.after<=result.before+20,label+' bounded DOM size '+JSON.stringify(result));
  assert.ok(result.networkHistorySize<=150&&result.networkLiveSize<=150,label+' network history stays bounded');
  assert.ok(result.processCache<=2,label+' process cache stays bounded');
  assert.ok(result.widthOverflow<=2,label+' no horizontal overflow');
  console.log('PASS '+label+' accelerated 300-poll (nominal 10-min) telemetry stress');
 }finally{await browser.close();}
}
(async()=>{await verify(chromium,'Chromium');await verify(webkit,'WebKit');})().catch(e=>{console.error(e);process.exitCode=1;});
