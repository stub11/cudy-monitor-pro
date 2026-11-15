'use strict';
// Unknown-platform/network fixtures: never infer WAN from ambiguous routes.
// With many devices the user's explicit manual selection must stay visible.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function run(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof updateNetworkTabs==='function');
  const outcome=await page.evaluate(()=>{
   const saved={allNetwork,networkIface,networkManual,wanIface,wanRouteStatus,
    networkTabSignature,networkHistorySerial,networkLivePoints,networkLiveIface,
    netPoints,netHistoryFetch};
   try{
    const names=Array.from({length:24},(_,i)=>'vlan'+String(i).padStart(2,'0'));
    allNetwork=names.map(name=>({name,rx:0,tx:0}));
    wanIface='';wanRouteStatus='ambiguous';networkIface='';networkManual=false;
    networkTabSignature='';
    updateNetworkTabs();
    const initial=Array.from(document.querySelectorAll('#nettabs [data-iface]')).map(el=>el.dataset.iface);
    const noGuess=networkIface===''&&initial.length===16&&
      /не найден или неоднозначен/.test(document.querySelector('#wan-mode-hint').textContent);
    // Select the last initially visible device, then replace it by an
    // out-of-window manual selection with the same fixture as user choice.
    networkIface='vlan23';networkManual=true;networkTabSignature='';
    updateNetworkTabs();
    const visible=Array.from(document.querySelectorAll('#nettabs [data-iface]')).map(el=>el.dataset.iface);
    const chosen=document.querySelector('#nettabs [data-iface="vlan23"]');
    const retained=visible.length===16&&!!chosen&&chosen.classList.contains('nettab-active')&&
      networkIface==='vlan23'&&networkManual;
    // If the manual device disappears entirely, selection must reset to
    // unselected rather than silently using another VLAN as a guessed WAN.
    allNetwork=allNetwork.filter(n=>n.name!=='vlan23');
    networkTabSignature='';
    updateNetworkTabs();
    const reset=networkIface===''&&!networkManual;
    return {noGuess,retained,reset};
   }finally{
    allNetwork=saved.allNetwork;networkIface=saved.networkIface;
    networkManual=saved.networkManual;wanIface=saved.wanIface;
    wanRouteStatus=saved.wanRouteStatus;networkTabSignature='';
    networkHistorySerial++;
    networkLivePoints=saved.networkLivePoints;networkLiveIface=saved.networkLiveIface;
    netPoints=saved.netPoints;netHistoryFetch=saved.netHistoryFetch;
    updateNetworkTabs();renderNetworkChart();
   }
  });
  assert.ok(outcome.noGuess,label+': ambiguous WAN must remain unselected');
  assert.ok(outcome.retained,label+': selected 24th interface must stay visible among 16 tabs');
  assert.ok(outcome.reset,label+': vanished manual interface must reset without guessing another');
  console.log('PASS '+label+' ambiguous WAN and selected interface retention');
 }finally{await browser.close();}
}
(async()=>{await run(chromium,'Chromium');await run(webkit,'WebKit');})()
 .catch(err=>{console.error(err);process.exitCode=1;});
