'use strict';
// Stage-one acceptance gate: real browsers, all existing pages and approved sizes.
// This tests navigability/layout, NOT pixel-perfect similarity to 8237.png.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const base = process.env.CUDY_BROWSER_TEST_URL || 'http://127.0.0.1:18247';
const routes = ['overview','processes','services','network','storage','logs','settings','updates'];
const sizes = [[1536,1024],[1280,800],[768,1024],[390,844],[360,800]];

async function testEngine(engine, label) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const [width,height] of sizes) {
      const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
      const page = await context.newPage();
      try {
        await page.goto(base + '/', {waitUntil:'domcontentloaded'});
        await page.locator('#overview').waitFor();
        const metrics = await page.locator('#overview .kpi-grid .kpi').count();
        assert.equal(metrics,5,label+' '+width+'px: 5 approved KPI cards');
        for (const route of routes) {
          const button = page.locator('nav button[data-page="'+route+'"]');
          assert.equal(await button.count(),1,label+' '+route+': navigation button');
          // Mobile drawer may cover the nav until opened.
          const toggle = page.locator('#menutoggle');
          if (await toggle.isVisible()) {
            const expanded = await toggle.getAttribute('aria-expanded');
            if (expanded !== 'true') await toggle.click();
          }
          await button.click();
          await page.waitForTimeout(80);
          const check = await page.evaluate((route) => {
            const target = document.getElementById(route);
            const pages = [...document.querySelectorAll('section.page')];
            const visible = pages.filter(el => getComputedStyle(el).display !== 'none');
            const root = document.documentElement;
            return {
              shown: !!target && getComputedStyle(target).display !== 'none',
              visible:visible.map(el=>el.id),
              overflow:root.scrollWidth - root.clientWidth,
              title:document.querySelector('#viewtitle')?.textContent?.trim() || ''
            };
          },route);
          assert.ok(check.shown,label+' '+width+' '+route+': page must be shown');
          assert.deepEqual(check.visible,[route],label+' '+width+' '+route+': exactly one page');
          assert.ok(check.overflow <= 2,label+' '+width+' '+route+
            ': horizontal document overflow '+check.overflow+'px');
          assert.ok(check.title.length>0,label+' '+width+' '+route+': titled page');
        }
        process.stdout.write('PASS '+label+' '+width+'x'+height+' routes='+routes.length+'\n');
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
(async () => { await testEngine(chromium,'Chromium'); await testEngine(webkit,'WebKit'); })()
  .catch(e=>{console.error(e);process.exitCode=1;});
