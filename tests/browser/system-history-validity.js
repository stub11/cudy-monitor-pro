'use strict';
const assert = require('node:assert/strict');
const {chromium,webkit} = require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function run(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof fetchHistory==='function');
  const result=await page.evaluate(async()=>{
    const originalFetch=window.fetch;
    const saved={historyPoints,historyDataSignature,historyFetchSerial};
    try{
      const malformed=[
        [100,40,55,48],[100,90,20,30],[99,10,10,10],
        [101,-1,60,48],[102,NaN,70,48],[103,60,120,48],
        [104,62,72,null],[105,20,40,300],[106,30,50,50],
        ['107',45,70,40],[108,null,null,null],[109,30,50,51,2],
        [110,70,45,49]
      ];
      window.fetch=(url,opts)=>typeof url==='string'&&url==='/api/history'
       ?Promise.resolve({ok:true,json:async()=>({points:malformed})})
       :originalFetch(url,opts);
      historyFetchSerial++;
      historyDataSignature='';
      await fetchHistory();
      const filtered=historyPoints.map(x=>x.slice());
      const hasChart=!!document.querySelector('#graph svg');
      const nodes=document.querySelectorAll('#graph svg polyline').length;
      return {filtered,hasChart,nodes};
    }finally{
      window.fetch=originalFetch;
      historyFetchSerial++;
      historyPoints=saved.historyPoints;
      historyDataSignature=saved.historyDataSignature;
      drawHistory();
    }
  });
  assert.deepEqual(result.filtered,[
    [100,40,55,48],
    [101,null,60,48],
    [102,null,70,48],
    [103,60,null,48],
    [104,62,72,null],
    [105,20,40,null],
    [106,30,50,50],
    [110,70,45,49]
  ],label+' must normalize malformed and reversed samples');
  assert.ok(result.hasChart && result.nodes>0,label+' must render remaining valid series');
  console.log('PASS '+label+' CPU/RAM/temperature history validation');
 }finally{await browser.close();}
}
(async()=>{await run(chromium,'Chromium');await run(webkit,'WebKit');})().catch(e=>{console.error(e);process.exitCode=1;});
