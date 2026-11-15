'use strict';
// Screenshot evidence from an isolated GitHub runner, NOT a real router.
// No baseline source 8237.png is assumed to be available here.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.CUDY_SCREENSHOT_OUTPUT;
if(!root)throw Error('CUDY_SCREENSHOT_OUTPUT must point to GitHub runner temporary storage');
const base=process.env.CUDY_BROWSER_TEST_URL||'http://127.0.0.1:18247';
const viewports=[['desktop-1536',1536,1024],['desktop-1280',1280,800],
 ['tablet-768',768,1024],['mobile-390',390,844],['mobile-360',360,800]];
const routes=['overview','processes','services','network','storage','logs','settings','updates'];
async function run(){
 fs.mkdirSync(root,{recursive:true});
 const browser=await chromium.launch({headless:true});
 try{
  for(const [label,width,height] of viewports){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,
    reducedMotion:'reduce'});
   const page=await context.newPage();
   try{
    await page.goto(base+'/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#online')?.textContent?.includes('Работает'),
     null,{timeout:12000});
    for(const route of routes){
     if(await page.locator('#menutoggle').isVisible()){
      const open=await page.locator('#menutoggle').getAttribute('aria-expanded');
      if(open!=='true')await page.locator('#menutoggle').click();
     }
     await page.locator('nav button[data-page="'+route+'"]').click();
     await page.waitForTimeout(120);
     // Mark the evidence explicitly as synthetic, not a customer/router capture.
     await page.evaluate(()=>{
      const mark='cm-ci-screenshot-label';
      let node=document.getElementById(mark);
      if(!node){
       node=document.createElement('div');node.id=mark;
       node.style.cssText='position:fixed;bottom:6px;right:6px;z-index:99;'+
        'background:#101827df;color:#d2eaff;border:1px solid #52779b;'+
        'padding:5px 8px;border-radius:5px;font:11px system-ui;pointer-events:none';
       node.textContent='CI · тестовые данные · не реальный роутер';
       document.body.appendChild(node);
      }
     });
     const file=path.join(root,label+'-'+route+'.png');
     await page.screenshot({path:file,fullPage:true,animations:'disabled'});
     console.log('Screenshot',path.basename(file));
    }
   }finally{await context.close();}
  }
  fs.writeFileSync(path.join(root,'README.txt'),
   'Cudy Monitor Pro visual review screenshots\n'+
   'Generated from GitHub Actions isolated Linux runner, not a user router.\n'+
   'Screens: Chromium 5 viewport sizes x 8 routes (40 images).\n'+
   'Do not infer pixel-exact match against original 8237.png: original PNG not present in this repository.\n'+
   'Network, CPU, memory and model readings are CI test environment values only.\n','utf8');
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
