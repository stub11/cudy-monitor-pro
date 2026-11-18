'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function verify(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof renderPlatformBadge==='function'&&!pollBusy);
  const result=await page.evaluate(async()=>{
   const original=window.fetch;
   const status=await original('/api/status').then(r=>r.json());
   const snapshots=[];
   const sample=[
    {...status,platform:'OpenWrt',update_mode:'native_apk',architecture:'MIPSEL',model:'netis N6'},
    {...status,platform:'OpenWrt',update_mode:'native_apk',architecture:'ARM64',model:'Cudy'},
    {...status,platform:'KeeneticOS',update_mode:'entware',architecture:'ARM64',model:'Cudy'},
    {...status,platform:'OpenWrt',update_mode:'native_apk',architecture:'',model:'netis N6'}
   ];
   try{
    for(const payload of sample){
     window.fetch=(url,opts)=>url==='/api/status'
      ?Promise.resolve({ok:true,status:200,json:async()=>payload})
      :original(url,opts);
     await poll();
     snapshots.push({
      platform:document.querySelector('#sidebarplatform')?.textContent,
      package:document.querySelector('#sidebarpackage')?.textContent,
      model:document.querySelector('#routermodel')?.textContent
     });
    }
   }finally{window.fetch=original;}
   return {snapshots,actualArch:status.architecture};
  });
  assert.match(result.snapshots[0].platform,/OpenWrt/,label+' netis platform');
  assert.equal(result.snapshots[0].package,'APK · MIPSEL',label+' MIPSEL not ARM64');
  assert.equal(result.snapshots[0].model,'netis N6',label+' live model');
  assert.equal(result.snapshots[1].package,'APK · ARM64',label+' ARM64 OpenWrt');
  assert.equal(result.snapshots[2].package,'Entware · ARM64',label+' KeeneticOS Entware');
  assert.match(result.snapshots[2].platform,/KeeneticOS/);
  assert.equal(result.snapshots[3].package,'APK · архитектура не определена',label+' no guessed arch');
  assert.ok(typeof result.actualArch==='string'&&result.actualArch.length>0,label+' backend architecture present');
  console.log('PASS '+label+' dynamic platform + architecture labels');
 }finally{await browser.close();}
}
(async()=>{await verify(chromium,'Chromium');await verify(webkit,'WebKit');})()
 .catch(e=>{console.error(e);process.exitCode=1;});
