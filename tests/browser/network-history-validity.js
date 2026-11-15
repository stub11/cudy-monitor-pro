'use strict';
// Network history responses are external telemetry: malformed points must not
// create backwards axes or negative/infinite speed in the live SVG graph.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function verify(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof fetchNetworkHistory==='function');
  const outcome=await page.evaluate(async()=>{
   const oldFetch=window.fetch;
   const saved={networkIface,networkLiveIface,networkLivePoints,netPoints,
    networkHistoryHealthy,networkHistorySerial};
   try{
    networkIface='wan-test-validation';
    networkLiveIface='';
    networkLivePoints=[];
    netPoints=[];
    networkHistoryHealthy=false;
    const samples=[[100,90,30],[101,100,40],[101,150,60],
      [99,200,60],[102,-1,60],[103,Infinity,3],
      ['104',3,4],[105,200,50],null,[106,200,50,3],[107,310,70]];
    window.fetch=(url,options)=>typeof url==='string'&&url.startsWith('/api/network-history?')
      ?Promise.resolve({ok:true,json:async()=>({points:samples})})
      :oldFetch(url,options);
    await fetchNetworkHistory();
    const first=netPoints.map(p=>p.slice());
    const svg=document.querySelector('#networkgraph svg');
    const graph=document.querySelector('#networkgraph').textContent;
    window.fetch=(url,options)=>typeof url==='string'&&url.startsWith('/api/network-history?')
      ?Promise.resolve({ok:true,json:async()=>({points:[[110,-12,1],[111,NaN,1]]})})
      :oldFetch(url,options);
    await fetchNetworkHistory();
    const invalidFallback=networkHistoryHealthy===false&&netPoints.length===0;
    return {first,svg:!!svg,graph,invalidFallback};
   } finally{
    window.fetch=oldFetch;networkHistorySerial++;
    networkIface=saved.networkIface;networkLiveIface=saved.networkLiveIface;
    networkLivePoints=saved.networkLivePoints;netPoints=saved.netPoints;
    networkHistoryHealthy=saved.networkHistoryHealthy;
    renderNetworkChart();
   }
  });
  assert.deepEqual(outcome.first,[[100,90,30],[101,100,40],[105,200,50],[107,310,70]],
    label+' must reject duplicate/reversed clocks and invalid rates');
  assert.ok(outcome.svg,label+' should draw valid chronological series');
  assert.ok(outcome.invalidFallback,label+' must not call invalid history healthy');
  console.log('PASS '+label+' WAN response validation');
 }finally{await browser.close();}
}
(async()=>{await verify(chromium,'Chromium');await verify(webkit,'WebKit');})()
 .catch(e=>{console.error(e);process.exitCode=1;});
