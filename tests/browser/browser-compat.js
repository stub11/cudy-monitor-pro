'use strict';
// Browser-engine compatibility regression for Cudy Monitor Pro.
// Chromium covers Brave's Chromium engine; WebKit approximates Safari, not iOS hardware.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const base = process.env.CUDY_BROWSER_TEST_URL || 'http://127.0.0.1:18247';

async function checkBrowser(engine, label, options = {}) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext(options);
  const page = await context.newPage();
  try {
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.fetch === 'function' &&
      !!document.querySelector('#authenable'), null, { timeout: 10000 });
    assert.equal((await context.request.get(base + '/api/auth/status')).status(), 200);
    // Mobile overview stays readable with detailed memory text and no stray dot.
    if (options.isMobile) {
      await page.waitForFunction(() => document.querySelector('#online').textContent.includes('Работает'));
      const subtitle = await page.locator('#viewsubtitle').textContent();
      assert.doesNotMatch(subtitle, /Entware\\s*·\\s*Entware/i,
        label + ' should not duplicate the platform name');
      const separator = await page.evaluate(() => {
        const online = document.querySelector('#online');
        const seen = document.querySelector('#lastseen');
        let n = online.nextSibling, gap = '';
        while (n && n !== seen) { if (n.nodeType === 3) gap += n.textContent; n = n.nextSibling; }
        return gap;
      });
      assert.equal(separator.trim(), '', label + ' must not show stray status separator');
      await page.evaluate(() => {
        document.querySelector('#memcomparison').textContent =
          'Без кэша (≈htop): 203.0 МиБ · доступно 244.3 МиБ';
      });
      const tiles = await page.locator('.kpi-grid .kpi').evaluateAll(nodes =>
        nodes.map(n => ({ scroll: n.scrollWidth, width: n.clientWidth,
          text: n.textContent.trim().length, visible: n.getBoundingClientRect().height > 0 })));
      assert.ok(tiles.every(x => x.visible && x.text > 0 && x.scroll <= x.width + 2),
        label + ' long KPI text should wrap within each tile');
    }


    // Repro from Cudy OTA report: UI must not falsely claim 1.2.10 is
    // up to date when GitHub shows 1.2.11 and API claims unavailable.
    await page.route('**/api/update/check', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ latest: '1.2.11', current: '1.2.10', available: false })
    }));
    await page.evaluate(() => document.querySelector('nav button[data-page="updates"]').click());
    await page.locator('#checkupdate').click();
    await page.waitForFunction(() => document.querySelector('#updatestatus')
      .textContent.includes('Несогласованные данные обновления'));
    assert.equal(await page.locator('#applyupdate').isDisabled(), true,
      label + ' contradictory updater metadata must never enable installation');
    assert.match(await page.locator('#updatestatus').textContent(), /1\.2\.10.*1\.2\.11/u);
    await page.route('**/api/update/check', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        latest: '1.2.11', current: '1.2.11', running: '1.2.10',
        available: false, restart_required: true
      })
    }));
    await page.locator('#checkupdate').click();
    await page.waitForFunction(() => document.querySelector('#updatestatus')
      .textContent.includes('Версии файла монитора и работающего процесса различаются'));
    assert.equal(await page.locator('#applyupdate').isDisabled(), true,
      label + ' native package mismatch must prevent another upgrade');
    assert.match(await page.locator('#updatestatus').textContent(), /установлен 1\.2\.11.*запущен 1\.2\.10/u);
    await page.unroute('**/api/update/check');

    // Keep the synthetic test status stable even if the dashboard polls while
    // WebKit is processing the mocked update check. Do not relax OTA safeguards.
    await page.route('**/api/status', async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.version = '1.2.12';
      await route.fulfill({ response, body: JSON.stringify(data) });
    });
    await page.evaluate(() => { document.querySelector('#sidebarversion').textContent = '1.2.12'; });

    // A successful 202 Accepted only starts an OTA. The UI must wait for
    // the running daemon's exact target version before claiming success.
    await page.route('**/api/update/check', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        latest: '1.2.13', current: '1.2.12', running: '1.2.12',
        available: true, restart_required: false
      })
    }));
    await page.locator('#checkupdate').click();
    try {
      await page.waitForFunction(() => !document.querySelector('#applyupdate').disabled,
        null, { timeout: 12000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        status: document.querySelector('#updatestatus').textContent,
        runningVersion: document.querySelector('#sidebarversion').textContent,
      }));
      throw new Error(label + ' synthetic OTA check blocked: ' +
        JSON.stringify(diagnostic) + '; ' + error.message);
    }
    await page.route('**/api/update/apply', route => route.fulfill({
      status: 202, contentType: 'application/json',
      body: JSON.stringify({status:'started'})
    }));
    await page.route('**/api/status', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({version:'1.2.13'})
    }));
    await page.locator('#applyupdate').click();
    await page.waitForFunction(() => document.querySelector('#updatestatus')
      .textContent.includes('Обновление подтверждено: запущена версия 1.2.13'), null,
      {timeout: 12000});
    assert.equal(await page.locator('#applyupdate').isDisabled(),true,
      label+' update must not be re-enabled without rechecking metadata');
    await page.unroute('**/api/status');
    await page.unroute('**/api/update/apply');
    await page.unroute('**/api/update/check');

    // Simulate privacy-focused browsers which omit Origin on same-origin POSTs.
    await page.route('**/api/auth/enable', route => {
      const headers = { ...route.request().headers() };
      delete headers.origin;
      return route.continue({ headers });
    });
    await page.evaluate(() => document.querySelector('nav button[data-page="settings"]').click());
    await page.locator('#authenable').click();
    await page.waitForFunction(() => document.querySelector('#authstate').textContent === 'Включена');
    const key = await page.evaluate(() => sessionStorage.getItem('cm-access-key'));
    assert.match(key, /^[0-9a-f]{64}$/, label + ' key is 256 bits');
    assert.equal((await context.request.get(base + '/api/status')).status(), 401,
      label + ' blocks unauthenticated telemetry');

    // Authenticated wrapper sends token, and should work on both browser engines.
    const ok = await page.evaluate(async () => (await fetch('/api/status')).status);
    assert.equal(ok, 200, label + ' authenticated access');
    // Browser-side update action must pass same-origin checks even without Origin.
    await page.route('**/api/update/apply', route => {
      const headers = { ...route.request().headers() };
      delete headers.origin;
      return route.continue({ headers });
    });
    const apply = await page.evaluate(async () => {
      const r = await fetch('/api/update/apply', {
        method: 'POST', headers: { 'X-Monitor-Action': 'apply' }
      });
      return { status: r.status, data: await r.json() };
    });
    // No updater is installed on the isolated CI test host, so valid requests
    // are rejected for that reason rather than a false Origin mismatch.
    assert.equal(apply.status, 503, label + ' browser update reached updater guard');
    assert.notEqual(apply.data.error, 'origin mismatch');

    await page.route('**/api/auth/disable', route => {
      const headers = { ...route.request().headers() };
      delete headers.origin;
      return route.continue({ headers });
    });
    await page.locator('#authdisable').click();
    await page.waitForFunction(() => document.querySelector('#authstate').textContent === 'Выключена');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cm-access-key')), null);
    assert.equal((await context.request.get(base + '/api/status')).status(), 200);
    console.log('PASS ' + label + ': enable, access key, update origin, disable');
  } finally {
    await context.close();
    await browser.close();
  }
}

(async () => {
  await checkBrowser(chromium, 'Chromium (Brave engine)', { viewport: { width: 1366, height: 768 } });
  await checkBrowser(webkit, 'WebKit (Safari engine)', {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
