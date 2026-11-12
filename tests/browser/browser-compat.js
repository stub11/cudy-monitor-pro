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


    // If the history endpoint is still empty but live WAN rates exist, the
    // graph must recover from genuine /api/status observations, not remain
    // stuck at 'Накапливаем измерения' indefinitely.
    const liveFallback = await page.evaluate(() => {
      const original = {allNetwork,networkIface,networkLiveIface,networkLivePoints,netPoints};
      // Model successive status polls deterministically instead of depending on
      // two synchronous samples landing in different real milliseconds.
      const realNow = Date.now;
      let testNow = realNow();
      Date.now = () => (testNow += 2000);
      try {
        allNetwork=[{name:'eth2.30',rx:125000,tx:50000}];
        networkIface='eth2.30';networkLiveIface='';networkLivePoints=[];netPoints=[];
        updateNetworkLiveSample();
        const first=document.querySelector('#networkgraph').textContent;
        allNetwork=[{name:'eth2.30',rx:140000,tx:52000}];
        updateNetworkLiveSample();
        const second=document.querySelector('#networkgraph').querySelector('svg');
        networkIface='br0';allNetwork=[{name:'br0',rx:1000,tx:1000}];
        updateNetworkLiveSample();
        const reset=networkLiveIface==='br0'&&networkLivePoints.length===1;
        return {first,hasSvg:!!second,reset};
      } finally {
        Date.now = realNow;
        allNetwork=original.allNetwork;
        networkIface=original.networkIface;
        networkLiveIface=original.networkLiveIface;
        networkLivePoints=original.networkLivePoints;
        netPoints=original.netPoints;
        renderNetworkChart();
      }
    });
    assert.match(liveFallback.first,/Накапливаем измерения/u);
    assert.ok(liveFallback.hasSvg,label+' must draw real WAN live samples');
    assert.ok(liveFallback.reset,label+' must not mix different interfaces');

    // Concurrent requests can complete out of order. An older success OR
    // failure must not replace the latest WAN graph or its status.
    const orderedHistory = await page.evaluate(async () => {
      const oldFetch=window.fetch, oldIface=networkIface, oldPoints=netPoints;
      const pending=[];
      try {
        window.fetch=(url,opts)=>{
          if(typeof url==='string'&&url.startsWith('/api/network-history?')){
            return new Promise((resolve,reject)=>pending.push({resolve,reject}));
          }
          return oldFetch(url,opts);
        };
        networkIface='wan-test';netPoints=[];
        const old=fetchNetworkHistory();
        const latest=fetchNetworkHistory();
        if(pending.length!==2)throw Error('expected two concurrent WAN requests');
        pending[1].resolve({ok:true,json:async()=>({points:[[101,222,333],[102,444,555]]})});
        await latest;
        const afterLatest=netPoints.map(p=>p.slice());
        pending[0].resolve({ok:true,json:async()=>({points:[[1,1,1],[2,2,2]]})});
        await old;
        const keptLatest=JSON.stringify(netPoints)===JSON.stringify(afterLatest);
        const olderFailure=fetchNetworkHistory();
        const newerSuccess=fetchNetworkHistory();
        pending[3].resolve({ok:true,json:async()=>({points:[[103,666,777],[104,888,999]]})});
        await newerSuccess;
        pending[2].reject(Error('stale network failure'));
        await olderFailure;
        return {keptLatest,keptAfterFailure:netPoints[0]?.[1]===666};
      } finally {
        networkHistorySerial++;
        window.fetch=oldFetch;networkIface=oldIface;netPoints=oldPoints;
        renderNetworkChart();
      }
    });
    assert.ok(orderedHistory.keptLatest,label+' must ignore an older WAN history response');
    assert.ok(orderedHistory.keptAfterFailure,label+' must ignore an older WAN history error');

    // A network outage must not join the previous live chart with new samples.
    // A delayed response for the same WAN must also remain discarded.
    const outageHistory = await page.evaluate(async () => {
      const saved={networkIface,networkLiveIface,networkLivePoints,netPoints,netHistoryFetch,networkHistorySerial,allNetwork};
      const oldFetch=window.fetch;
      const wasStale=document.body.classList.contains('telemetry-stale');
      let resolveHistory;
      try {
        document.body.classList.remove('telemetry-stale');
        networkIface='eth2.30';networkLiveIface='eth2.30';
        networkLivePoints=[[100,24000,1200],[102,40000,1800]];
        netPoints=[[100,24000,1200],[102,40000,1800]];
        window.fetch=(url,opts)=>typeof url==='string'&&url.startsWith('/api/network-history?')
          ?new Promise(resolve=>{resolveHistory=resolve;})
          :oldFetch(url,opts);
        const waiting=fetchNetworkHistory();
        if(!resolveHistory)throw Error('history request did not start');
        document.body.classList.add('telemetry-stale');
        invalidateNetworkTelemetry();
        const erased=networkLivePoints.length===0&&netPoints.length===0&&networkLiveIface==='';
        document.body.classList.remove('telemetry-stale');
        networkIface='eth2.30';
        resolveHistory({ok:true,json:async()=>({points:[[100,99999,99999],[102,99999,99999]]})});
        await waiting;
        const ignored=netPoints.length===0;
        allNetwork=[{name:'eth2.30',rx:18000,tx:4000}];
        updateNetworkLiveSample();
        const restarted=networkLiveIface==='eth2.30'&&networkLivePoints.length===1;
        return {erased,ignored,restarted};
      } finally {
        networkHistorySerial++;
        window.fetch=oldFetch;
        networkIface=saved.networkIface;networkLiveIface=saved.networkLiveIface;
        networkLivePoints=saved.networkLivePoints;netPoints=saved.netPoints;
        netHistoryFetch=saved.netHistoryFetch;allNetwork=saved.allNetwork;
        if(wasStale)document.body.classList.add('telemetry-stale');
        else document.body.classList.remove('telemetry-stale');
        renderNetworkChart();
      }
    });
    assert.ok(outageHistory.erased,label+' must discard pre-outage WAN samples');
    assert.ok(outageHistory.ignored,label+' must discard in-flight same-WAN pre-outage response');
    assert.ok(outageHistory.restarted,label+' must restart live samples without bridging outage');

    // A kernel counter reset may clear the SERVER history while the browser
    // still has the same WAN selected. Do not merge the old live samples into
    // this new measurement epoch. An ordinary full rolling window is stable.
    const epochReset = await page.evaluate(async () => {
      const saved={networkIface,networkLiveIface,networkLivePoints,netPoints,networkHistorySerial};
      const oldFetch=window.fetch;
      try {
        networkIface='wan-reset-test';
        networkLiveIface='wan-reset-test';
        netPoints=[[10,120,20],[12,150,30],[14,180,40]];
        networkLivePoints=[[100,999,333],[102,999,333]];
        window.fetch=(url,opts)=>typeof url==='string'&&url.startsWith('/api/network-history?')
          ?Promise.resolve({ok:true,json:async()=>({points:[[110,0,0]]})})
          :oldFetch(url,opts);
        await fetchNetworkHistory();
        const cleared=networkLivePoints.length===0&&networkLiveIface===''&&
          netPoints.length===1&&netPoints[0][0]===110;
        networkLiveIface='wan-reset-test';
        networkLivePoints=[[120,25,15],[122,35,16]];
        netPoints=Array.from({length:150},(_,i)=>[200+i,i+1,i+2]);
        window.fetch=(url,opts)=>typeof url==='string'&&url.startsWith('/api/network-history?')
          ?Promise.resolve({ok:true,json:async()=>({points:Array.from({length:150},(_,i)=>[202+i,i+1,i+2])})})
          :oldFetch(url,opts);
        await fetchNetworkHistory();
        const rollingPreserved=networkLivePoints.length===2&&networkLiveIface==='wan-reset-test';
        netPoints=[[400,10,5],[402,20,10]];
        networkLiveIface='wan-reset-test';networkLivePoints=[[400,10,5],[402,20,10]];
        window.fetch=(url,opts)=>typeof url==='string'&&url.startsWith('/api/network-history?')
          ?Promise.resolve({ok:true,json:async()=>({points:[[2,0,0],[4,1,1]]})})
          :oldFetch(url,opts);
        await fetchNetworkHistory();
        const restartedClock=networkLivePoints.length===0&&networkLiveIface===''&&netPoints[0]?.[0]===2;
        return {cleared,rollingPreserved,restartedClock};
      } finally {
        networkHistorySerial++;
        window.fetch=oldFetch;
        networkIface=saved.networkIface;networkLiveIface=saved.networkLiveIface;
        networkLivePoints=saved.networkLivePoints;netPoints=saved.netPoints;
        renderNetworkChart();
      }
    });
    assert.ok(epochReset.cleared,label+' must reset live graph after shorter server history');
    assert.ok(epochReset.rollingPreserved,label+' must preserve live data for rolling server history');
    assert.ok(epochReset.restartedClock,label+' must clear live data when monitor sample clock restarts');

    // Polls every two seconds must not replace unchanged service buttons.
    // Replacing the button loses keyboard focus while users navigate.
    const stableServices = await page.evaluate(async () => {
      const live = await fetch('/api/status', {cache:'no-store'}).then(r=>r.json());
      const selectedPage=document.querySelector('.page:not(.hidden)')?.id||'overview';
      openPage('services');
      try {
        const fixture=[{name:'D2K',detected:true,installed:true},{name:'DoQ',detected:false,installed:true}];
        renderServiceState(fixture,true);
        const before=document.querySelector('#servicerows [data-service]');
        if(!before)throw Error('expected service action button');
        before.focus();
        renderServiceState(fixture.map(s=>({...s})),true);
        const sameNode=document.querySelector('#servicerows [data-service]')===before;
        const focusKept=document.activeElement===before;
        const chips=document.querySelector('#servicebadges').firstElementChild;
        renderServiceState(fixture.map(s=>({...s})),true);
        const chipsStable=document.querySelector('#servicebadges').firstElementChild===chips;
        renderServiceState([{name:'D2K',detected:false,installed:true},{name:'DoQ',detected:false,installed:true}],true);
        const changed=document.querySelector('#servicerows [data-service]')!==before;
        serviceActionPending=true;
        renderServiceState([{name:'D2K',detected:false,installed:true},{name:'DoQ',detected:false,installed:true}],true);
        const disabled=[...document.querySelectorAll('#servicerows [data-service]')].every(b=>b.disabled);
        return {sameNode,focusKept,chipsStable,changed,disabled};
      } finally {
        serviceActionPending=false;
        serviceRowsSignature='';
        renderServiceState(live.services||[],live.service_actions_enabled===true);
        openPage(selectedPage);
      }
    });
    assert.ok(stableServices.sameNode&&stableServices.focusKept,
      label+' must preserve focused service controls across identical polls');
    assert.ok(stableServices.chipsStable,label+' must preserve service chips across identical polls');
    assert.ok(stableServices.changed,label+' must redraw controls when service state changes');
    assert.ok(stableServices.disabled,label+' must disable existing controls during an action');

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

    // Native OpenWrt must never be mislabeled as KeeneticOS or show ndmc controls.
    await page.waitForFunction(() => document.querySelector('#online')
      .textContent.includes('Работает'));
    assert.match(await page.locator('#systemlogoption').textContent(), /logread/u);
    assert.doesNotMatch(await page.locator('#systemlogoption').textContent(), /KeeneticOS|ndmc/u);
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
    assert.equal(await page.locator('#logclisessionsrow').isVisible(), false,
      label + ' OpenWrt should not expose KeeneticOS session toggles');
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
    // Simulate the Entware status on the same browser. Model must not be
    // inferred from a hardcoded OpenWrt label or vice versa.
    await page.route('**/api/status', async route => {
      const response = await route.fetch();
      const snapshot = await response.json();
      snapshot.update_mode = 'entware';
      snapshot.platform = 'Linux / Entware';
      await route.fulfill({ response, body: JSON.stringify(snapshot) });
    });
    await page.evaluate(() => poll());
    await page.waitForFunction(() => logPlatform === 'entware');
    assert.match(await page.locator('#systemlogoption').textContent(), /ndmc.*logread/u);
    assert.equal(await page.locator('#logclisessionsrow').isVisible(), true,
      label + ' ndmc option must appear only on Entware system log');
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
    await page.unroute('**/api/status');
    await page.evaluate(() => poll());
    await page.waitForFunction(() => logPlatform === 'openwrt');
    assert.match(await page.locator('#systemlogoption').textContent(), /logread/u);
    assert.doesNotMatch(await page.locator('#systemlogoption').textContent(), /ndmc|KeeneticOS/u);

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
