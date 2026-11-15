'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function run(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof redactExportLine==='function');
  const output=await page.evaluate(()=>redactExportLine(
   'client=192.168.2.1 peer=10.0.0.5 mac=aa:bb:cc:dd:ee:ff '+
   'mac2=12-34-56-78-90-ab token=abc123 password:xyz secret=opensesame '+
   'Authorization: Bearer abc.def.ghi Authorization: Basic ZGVtbw== status=failed'
  ));
  assert.ok(!output.includes('192.168.2.1')&&!output.includes('10.0.0.5'),label+' IPv4 masked');
  assert.ok(!/aa:bb:cc:dd:ee:ff|12-34-56-78-90-ab/i.test(output),label+' MAC masked');
  assert.ok(!/abc123|xyz|opensesame|abc.def.ghi|ZGVtbw==/.test(output),label+' credentials masked');
  assert.ok(output.includes('status=failed'),label+' diagnostic details kept');
  console.log('PASS '+label+' safe exported log lines');
 }finally{await browser.close();}
}
(async()=>{await run(chromium,'Chromium');await run(webkit,'WebKit');})().catch(e=>{console.error(e);process.exitCode=1;});
