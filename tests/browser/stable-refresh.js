'use strict';
// Regression: unchanged telemetry must not recreate service/core/process nodes,
// which causes focus loss and visible dashboard jitter on two-second polling.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const base = process.env.CUDY_BROWSER_TEST_URL || 'http://127.0.0.1:18247';
async function check(engine, name) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await page.goto(base+'/', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => typeof renderCoreUsage === 'function' &&
      typeof renderProcesses === 'function' && typeof renderServiceState === 'function');
    const result = await page.evaluate(() => {
      const old = {processes:allProcesses,sort:processSort,coreSignature:coreNodeSignature,
        serviceSignature:serviceRowsSignature};
      try {
        const cores = [{id:0,usage:17},{id:1,usage:32}];
        coreNodeSignature = '';
        renderCoreUsage(cores, 1200);
        const initialCore = document.querySelector('#coreusage .core-row');
        renderCoreUsage([{id:0,usage:24},{id:1,usage:39}], 1200);
        const coreStable = initialCore === document.querySelector('#coreusage .core-row');
        allProcesses = [{pid:812,name:'test-one',cpu:2,mem:5},
          {pid:813,name:'test-two',cpu:1,mem:4}];
        processSort='cpu';
        renderProcesses();
        const initialProcess = document.querySelector('#procrows tr');
        allProcesses = [{pid:812,name:'test-one',cpu:3,mem:5},
          {pid:813,name:'test-two',cpu:2,mem:4}];
        renderProcesses();
        const processStable = initialProcess === document.querySelector('#procrows tr');
        serviceRowsSignature = '';
        const services=[{name:'D2K',detected:true,installed:true},
          {name:'DoQ',detected:false,installed:true}];
        renderServiceState(services,false);
        const initialService = document.querySelector('#servicerows .service-row');
        renderServiceState(services,false);
        const serviceStable = initialService === document.querySelector('#servicerows .service-row');
        return {coreStable,processStable,serviceStable};
      } finally {
        allProcesses=old.processes;processSort=old.sort;
        coreNodeSignature='';serviceRowsSignature='';
        // Restore real telemetry on the next scheduled poll.
      }
    });
    assert.ok(result.coreStable,name+': core meters must retain DOM identities');
    assert.ok(result.processStable,name+': unchanged PID rows must retain DOM identities');
    assert.ok(result.serviceStable,name+': unchanged services must retain DOM identities');
    console.log('PASS stable-refresh '+name);
    await page.close();
  } finally { await browser.close(); }
}
(async()=>{await check(chromium,'Chromium');await check(webkit,'WebKit');})()
  .catch(err=>{console.error(err);process.exitCode=1;});
