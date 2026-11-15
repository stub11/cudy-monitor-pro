'use strict';
const assert = require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
async function verify(engine,label){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  const clock=page.locator('#localclock');
  const interval=page.locator('#refreshstatus');
  await clock.waitFor();
  assert.match(await clock.textContent(),/^\d{2}:\d{2}:\d{2}$/,label+' should show a formatted local clock');
  assert.equal(await interval.textContent(),'2 с',label+' default polling badge');
  const first=await clock.textContent();
  await page.waitForTimeout(1250);
  const second=await clock.textContent();
  assert.notEqual(second,first,label+' clock should advance without status poll');
  // The selector is on the Settings route; use actual navigation first.
  const toggle=page.locator('#menutoggle');
  if(await toggle.isVisible())await toggle.click();
  await page.locator('nav button[data-page="settings"]').click();
  await page.locator('#pollseconds').selectOption('5');
  assert.equal(await interval.textContent(),'5 с',label+' badge updates immediately');
  const values=await page.evaluate(()=>{
   const clock=document.querySelector('#localclock');
   const badge=document.querySelector('#refreshstatus');
   return {clockWidth:clock.getBoundingClientRect().width,badgeWidth:badge.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  });
  assert.ok(values.clockWidth>=78,label+' clock width reserved to avoid jitter');
  assert.ok(values.badgeWidth>=43,label+' badge width reserved to avoid jitter');
  assert.ok(values.overflow<=2,label+' must not cause mobile horizontal overflow');
  console.log('PASS '+label+' header clock and refresh interval');
 }finally{await browser.close();}
}
(async()=>{await verify(chromium,'Chromium');await verify(webkit,'WebKit');})().catch(e=>{console.error(e);process.exitCode=1;});
