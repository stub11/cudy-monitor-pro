'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function check(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof renderServiceState==='function');
  const result=await page.evaluate(()=>{
    const source=[
      {name:'D2K',detected:true,installed:true,pid:812,processes:1,ram_mb:18.2,cpu_pct:1.3,uptime_sec:7200},
      {name:'DoQ',detected:false,installed:true,pid:null,processes:0,ram_mb:0,cpu_pct:0,uptime_sec:null}
    ];
    renderServiceState(source,false);
    const a=document.querySelector('[data-service-metrics="D2K"]');
    const b=document.querySelector('[data-service-metrics="DoQ"]');
    const first=a?.textContent||'';
    source[0]={...source[0],ram_mb:19.7,cpu_pct:2.8,uptime_sec:10900};
    renderServiceState(source,false);
    return {
      first,second:a?.textContent||'',
      same:a===document.querySelector('[data-service-metrics="D2K"]'),
      missing:b?.textContent||'',
      noActions:document.querySelectorAll('[data-service]').length===0,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    };
  });
  assert.match(result.first,/PID 812.*CPU 1\.3%.*RAM 18\.2 МиБ.*Аптайм/,label+' process metrics');
  assert.match(result.second,/CPU 2\.8%.*RAM 19\.7 МиБ/,label+' changing metrics');
  assert.ok(result.same,label+' service DOM must not recreate on polls');
  assert.equal(result.missing,'Данные процесса недоступны',label+' not installed process is unavailable');
  assert.ok(result.noActions,label+' action controls disabled by default');
  assert.ok(result.overflow<=2,label+' no mobile document horizontal overflow');
  console.log('PASS '+label+' service telemetry card');
 }finally{await browser.close();}
}
(async()=>{await check(chromium,'Chromium');await check(webkit,'WebKit');})().catch(e=>{console.error(e);process.exitCode=1;});
