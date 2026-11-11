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


    // Missing totals are unavailable readings, NOT an actual zero-percent load.
    await page.route('**/api/status', async route => {
      const response = await route.fetch();
      const snapshot = await response.json();
      snapshot.mem_total = 0;
      snapshot.mem_used = 0;
      snapshot.disk_total = 0;
      snapshot.disk_used = 0;
      await route.fulfill({ response, body: JSON.stringify(snapshot) });
    });
    await page.evaluate(() => poll());
    await page.waitForFunction(() => document.querySelector('#mem').textContent === 'Нет данных' &&
      document.querySelector('#disk').textContent === 'Нет данных');
    assert.equal(await page.locator('#memringvalue').textContent(), '—',
      label + ' no RAM sensor reading must not be 0%');
    assert.equal(await page.locator('#diskringvalue').textContent(), '—',
      label + ' no disk total must not be 0%');
    assert.match(await page.locator('#storageinfo').textContent(), /Нет данных о накопителе/u);
    assert.match(await page.locator('#memorybreakdown').textContent(), /Данные RAM недоступны/u);
    await page.unroute('**/api/status');
    // CI runners may have no attached storage. Explicitly restore synthetic
    // known totals instead of assuming their disk mount is available.
    await page.route('**/api/status', async route => {
      const response = await route.fetch();
      const snapshot = await response.json();
      snapshot.mem_total = 512;
      snapshot.mem_used = 256;
      snapshot.disk_total = 1024;
      snapshot.disk_used = 512;
      await route.fulfill({ response, body: JSON.stringify(snapshot) });
    });
    await page.evaluate(() => poll());
    await page.waitForFunction(() => document.querySelector('#mem').textContent === '50.0%' &&
      document.querySelector('#disk').textContent === '50.0%');
    await page.unroute('**/api/status');

    // A Keenetic Ported system log must never be presented as OpenWrt, and
    // an unsupported logread must not be mistaken for a genuinely empty log.
    assert.match(await page.locator('#logsource option[value="system"]').textContent(),
      /Системный журнал/u);
    assert.doesNotMatch(await page.locator('#logsource option[value="system"]').textContent(),
      /OpenWrt/u);
    await page.route('**/api/logs?source=system', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({source:'system',max_events:80,redacted:true,available:false,events:[]})
    }));
    await page.evaluate(() => openPage('logs'));
    if (options.isMobile) {
      const sourceBounds = await page.locator('#logsource').evaluate(node => {
        const r = node.getBoundingClientRect();
        return { left:r.left, right:r.right, viewport:window.innerWidth, height:r.height };
      });
      assert.ok(sourceBounds.left >= 0 && sourceBounds.right <= sourceBounds.viewport + 2 &&
        sourceBounds.height >= 44, label + ' log source must fit mobile width and touch target');
    }
    await page.locator('#logsource').selectOption('system');
    await page.waitForFunction(() => document.querySelector('#logrows')
      .textContent.includes('Системный журнал недоступен'));
    assert.equal(await page.locator('#exportlogs').isDisabled(), true,
      label + ' unsupported log cannot export an apparently valid empty report');
    await page.unroute('**/api/logs?source=system');
    await page.route('**/api/logs?source=system', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({source:'system',max_events:80,redacted:true,available:true,events:[]})
    }));
    await page.locator('#refreshlogs').click();
    await page.waitForFunction(() => document.querySelector('#logrows')
      .textContent.includes('записей пока нет'));
    assert.equal(await page.locator('#exportlogs').isDisabled(), false,
      label + ' genuinely empty available log remains exportable');
    await page.unroute('**/api/logs?source=system');
    assert.equal(await page.locator('#logclisessionsrow').isVisible(), true,
      label + ' option to show ndmc sessions must be available in system log');
    await page.route('**/api/logs?source=system&include_cli_sessions=1', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({source:'system',max_events:80,redacted:true,available:true,
        events:[[0,'I [Nov 11 14:27:20] ndm: Core::Session: client disconnected.']]})
    }));
    await page.locator('#logclisessions').check();
    await page.waitForFunction(() => document.querySelector('#logrows')
      .textContent.includes('Core::Session: client disconnected'));
    assert.match(await page.locator('#lognotice').textContent(), /служебные подключения показаны/u);
    await page.locator('#logclisessions').uncheck();
    await page.unroute('**/api/logs?source=system&include_cli_sessions=1');
    await page.locator('#logsource').selectOption('monitor');
    assert.equal(await page.locator('#logclisessionsrow').isVisible(), false,
      label + ' ndmc-only toggle must not appear for monitor events');

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

    // A revoked/changed access key must never leave an apparently live dashboard.
    await page.route('**/api/status', route => route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({error: 'unauthorized'})
    }));
    await page.evaluate(() => poll());
    await page.waitForFunction(() => document.querySelector('#online')
      .textContent.includes('Требуется ключ') &&
      document.body.classList.contains('telemetry-stale'));
    assert.equal(await page.locator('#online').getAttribute('class'), 'bad',
      label + ' access denied must show warning status, not healthy status');
    assert.match(await page.locator('#healthsummary').textContent(), /устарели/u);
    assert.match(await page.locator('#networkgraph').textContent(), /Нет доступа/u);
    assert.match(await page.locator('#netpagegraph').textContent(), /Нет доступа/u);
    await page.unroute('**/api/status');
    await page.evaluate(() => poll());
    await page.waitForFunction(() => document.querySelector('#online')
      .textContent.includes('Работает') &&
      !document.body.classList.contains('telemetry-stale'));

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
