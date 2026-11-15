'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function test(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof saveSetting==='function' && !pollBusy);
  const storage=await page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    try{
      Storage.prototype.setItem=function(){throw new DOMException('Quota exceeded','QuotaExceededError');};
      const persisted=saveSetting('cudy_refresh','5');
      document.getElementById('pollseconds').value='5';
      document.getElementById('pollseconds').onchange();
      return {persisted,message:document.getElementById('settingsmessage').textContent,
        selector:document.getElementById('pollseconds').value,
        badge:document.getElementById('refreshstatus').textContent};
    }finally{Storage.prototype.setItem=original;}
  });
  assert.equal(storage.persisted,false,label+' no false storage success');
  assert.match(storage.message,/Не удалось сохранить/,label+' actual save error shown');
  assert.equal(storage.selector,'2',label+' restores persisted refresh interval');
  assert.equal(storage.badge,'2 с',label+' badge remains consistent');
  const sensor=await page.evaluate(async()=>{
    const original=window.fetch;
    const status=await original('/api/status').then(r=>r.json());
    try{
      window.fetch=(url,opts)=>url==='/api/status'
       ?Promise.resolve({ok:true,status:200,json:async()=>({...status,temps:[]})})
       :original(url,opts);
      await poll();
      return {temp:document.getElementById('temp').textContent,
        note:document.getElementById('tempnote').textContent,
        ringHidden:document.getElementById('tempring').classList.contains('sensor-unavailable'),
        kpis:document.querySelectorAll('#overview .kpi-grid .kpi').length};
    }finally{window.fetch=original;}
  });
  assert.equal(sensor.temp,'Нет датчика',label+' missing sensor is explicit');
  assert.equal(sensor.ringHidden,true,label+' meaningless temperature dial hidden');
  assert.equal(sensor.kpis,5,label+' approved KPI layout kept');
  const short=await browser.newPage({viewport:{width:1280,height:600}});
  await short.goto(base+'/',{waitUntil:'domcontentloaded'});
  const layout=await short.evaluate(()=>{
    const aside=document.querySelector('aside'),nav=aside.querySelector('nav');
    const status=aside.querySelector('.aside-status');
    return {navOverflow:getComputedStyle(nav).overflowY,
      asideHeight:aside.getBoundingClientRect().height,
      statusBottom:status.getBoundingClientRect().bottom,
      viewport:innerHeight};
  });
  assert.equal(layout.navOverflow,'auto',label+' short sidebar scrollable');
  assert.ok(layout.statusBottom<=layout.viewport+3,label+' status stays within short viewport');
  console.log('PASS '+label+' browser settings failures, missing temp and short sidebar');
 }finally{await browser.close();}
}
(async()=>{await test(chromium,'Chromium');await test(webkit,'WebKit');})().catch(e=>{console.error(e);process.exitCode=1;});
