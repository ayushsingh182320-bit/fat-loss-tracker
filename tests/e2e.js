// End-to-end test: node tests/e2e.js  (needs Playwright + Chromium)
// Serves the repo at /fat-loss-tracker/ like GitHub Pages, then exercises the app online and offline.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = '/fat-loss-tracker/';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const SHOTS = process.env.SHOTS_DIR || null;

let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + detail));
  if (!cond) failures++;
}

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith(BASE)) { res.writeHead(404); return res.end(); }
    p = p.slice(BASE.length) || 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
  let server = await startServer();
  const URL0 = `http://127.0.0.1:${server.address().port}${BASE}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const page = await context.newPage();
  const foreign = [];
  page.on('request', (r) => { if (!r.url().startsWith(URL0) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) foreign.push(r.url()); });
  page.on('pageerror', (e) => check('no page errors', false, e.message));

  await page.goto(URL0);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the SW
  check('service worker controls page', await page.evaluate(() => !!navigator.serviceWorker.controller), 'no controller');

  const cell = (table, k) => page.locator(`#${table} td[data-k="${k}"]`).innerText();
  const T = await page.evaluate(() => FLT.todayIso());
  const D = (n) => page.evaluate((n) => FLT.addDays(FLT.todayIso(), n), n);
  const fmtDate = (iso) => { const d = new Date(iso + 'T00:00:00'); return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] + ' ' + d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]; };

  async function logDay(iso, f) {
    await page.fill('#fDate', iso);
    await page.dispatchEvent('#fDate', 'change');
    for (const [id, v] of Object.entries(f)) if (id !== 'workout') await page.fill('#' + id, String(v));
    if (f.workout !== undefined) await page.click(f.workout ? '#fWorkoutYes' : '#fWorkoutNo');
    await page.click('#saveDay');
  }

  // --- Empty state
  check('empty 7-day message', (await page.innerText('#avgNum')) === 'No logged days in the last 7 days', await page.innerText('#avgNum'));

  // --- Settings defaults + BMR
  check('BMR 1617.4 (77 kg, 25%)', (await cell('todayTable', 'BMR')) === '1617.4', await cell('todayTable', 'BMR'));
  await page.click('#openSettings');
  const ro = await page.locator('#settingsView .ro').allInnerTexts();
  check('height read-only "170 cm (5 ft 7 in)"', ro[0] === '170 cm (5 ft 7 in)', ro[0]);
  check('sex read-only Male', ro[1] === 'Male', ro[1]);
  check('height has no input', (await page.locator('#settingsView input[type=text]').count()) === 6, 'input count');
  check('defaults: age 25, baseline 300, kcal/step 0.05, workout 180',
    (await page.inputValue('#sAge')) === '25' && (await page.inputValue('#sBaseline')) === '300' &&
    (await page.inputValue('#sKcalPerStep')) === '0.05' && (await page.inputValue('#sWorkoutKcal')) === '180', 'defaults');
  check('settings BMR preview', (await page.innerText('#sBmrPreview')).includes('57.8 kg · BMR 1617.4'), await page.innerText('#sBmrPreview'));
  await page.click('#closeSettings');

  // --- Today: 10,000 steps, workout yes, 1900 eaten (check live values before saving)
  await page.fill('#fCalories', '1900');
  await page.fill('#fSteps', '10000');
  await page.click('#fWorkoutYes');
  check('live steps kcal 500', (await cell('liveTable', 'Steps kcal')) === '500', await cell('liveTable', 'Steps kcal'));
  check('live workout kcal 180', (await cell('liveTable', 'Workout kcal')) === '180', await cell('liveTable', 'Workout kcal'));
  check('live maintenance 2597.4', (await cell('liveTable', 'Maintenance')) === '2597.4', await cell('liveTable', 'Maintenance'));
  check('live deficit 697.4', (await cell('liveTable', 'Deficit')) === '697.4', await cell('liveTable', 'Deficit'));
  await page.click('#saveDay');
  check('save toast', (await page.innerText('#toast')).startsWith('Saved'), await page.innerText('#toast'));
  check('today table deficit 697.4', (await cell('todayTable', 'Deficit')) === '697.4', await cell('todayTable', 'Deficit'));
  check('hero shows 697 green', (await page.innerText('#todayNum')) === '697' && (await page.getAttribute('#todayNum', 'class')).includes('good'), await page.innerText('#todayNum'));

  // --- Blank calories are not zero
  await page.fill('#fCalories', '');
  check('blank calories -> not counted', (await page.innerText('#liveHead')).includes('not counted') && (await cell('liveTable', 'Deficit')) === '—', await page.innerText('#liveHead'));
  await page.fill('#fCalories', '1900');

  // --- 7-day window: 5 logged, 2 missing (T-3, T-6). Maintenance without steps/workout = 1917.4
  await logDay(await D(-1), { fCalories: 1500 });   // 417.4
  await logDay(await D(-2), { fCalories: 2000 });   // -82.6
  await logDay(await D(-4), { fCalories: 1400 });   // 517.4
  await logDay(await D(-5), { fCalories: 1800 });   // 117.4
  await logDay(await D(-7), { fCalories: 100 });    // outside window, must be ignored
  await logDay(await D(-3), { fSteps: 8000, fProtein: 150 }); // steps/protein only: NOT logged
  const m6 = fmtDate(await D(-6)), m3 = fmtDate(await D(-3));
  let flag = await page.innerText('#avgFlag');
  check('flag "5-day average" names 2 missing dates', flag === `5-day average. 2 days missing: ${m6}, ${m3}.`, flag);
  check('5-day avg = 333 (yellow)', (await page.innerText('#avgNum')) === '333' && (await page.getAttribute('#avgNum', 'class')).includes('mid'), await page.innerText('#avgNum'));

  await logDay(await D(-3), { fCalories: 1000 });   // 1917.4 + 8000*0.05 - 1000 = 1317.4
  flag = await page.innerText('#avgFlag');
  check('flag becomes "6-day average", 1 missing', flag === `6-day average. 1 day missing: ${m6}.`, flag);
  // (697.4+417.4-82.6+517.4+117.4+1317.4)/6 = 497.4 -> 497 yellow
  check('6-day avg = 497', (await page.innerText('#avgNum')) === '497', await page.innerText('#avgNum'));
  check('protein stored, not in calc', await page.evaluate((d) => JSON.parse(localStorage.flt_days)[d].proteinG === 150, await D(-3)), 'protein');
  check('average not stored', await page.evaluate(() => !/avg|average/i.test(localStorage.flt_days + localStorage.getItem('flt_settings'))), 'found avg');

  // --- Overrides apply to that day only
  await logDay(await D(-1), { fCalories: 1500, fSteps: 10000, workout: true, fStepsOverride: 250, fWorkoutOverride: 300 });
  check('override day steps kcal 250', (await cell('liveTable', 'Steps kcal')) === '250', await cell('liveTable', 'Steps kcal'));
  check('override day workout kcal 300', (await cell('liveTable', 'Workout kcal')) === '300', await cell('liveTable', 'Workout kcal'));
  check('today unchanged (500 / 180)', (await cell('todayTable', 'Steps kcal')) === '500' && (await cell('todayTable', 'Workout kcal')) === '180', 'today changed');
  await page.fill('#fDate', await D(-1)); await page.dispatchEvent('#fDate', 'change');
  check('editing past day reloads its values', (await page.inputValue('#fStepsOverride')) === '250' && (await page.getAttribute('#fWorkoutYes', 'aria-pressed')) === 'true', 'reload');

  // --- Settings change recalculates immediately
  await page.click('#openSettings');
  await page.fill('#sWeight', '80');
  await page.click('#settingsForm button[type=submit]');
  check('weight 80 -> BMR 1666', (await cell('todayTable', 'BMR')) === '1666', await cell('todayTable', 'BMR'));
  await page.click('#openSettings');
  await page.fill('#sWeight', '77');
  await page.fill('#sBodyFat', 'abc');
  await page.click('#settingsForm button[type=submit]');
  check('invalid setting rejected', !(await page.isHidden('#settingsView')), 'saved invalid');
  await page.fill('#sBodyFat', '25');
  await page.click('#settingsForm button[type=submit]');
  check('BMR back to 1617.4', (await cell('todayTable', 'BMR')) === '1617.4', await cell('todayTable', 'BMR'));

  // --- Surplus colour
  await logDay(T, { fCalories: 3000, fSteps: 10000, workout: true });
  check('surplus shows −403 red', (await page.innerText('#todayNum')) === '−403' && (await page.getAttribute('#todayNum', 'class')).includes('bad') && (await page.innerText('#todayUnit')).toLowerCase() === 'kcal surplus', await page.innerText('#todayNum'));
  await logDay(T, { fCalories: 1900, fSteps: 10000, workout: true });

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'main.png'), fullPage: true });

  // --- Export / import round trip
  await page.click('#openSettings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check('export has settings + days', exported.settings.weightKg === 77 && Object.keys(exported.days).length === 7, JSON.stringify(Object.keys(exported.days)));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'settings.png'), fullPage: true });
  await page.evaluate(() => { localStorage.setItem('flt_days', '{}'); });
  page.once('dialog', (d) => d.accept());
  await page.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.waitForFunction(() => document.getElementById('avgFlag').textContent.startsWith('6-day'));
  check('import restores data', (await page.innerText('#todayNum')) === '697', await page.innerText('#todayNum'));
  page.once('dialog', (d) => d.dismiss());
  await page.click('#openSettings');
  await page.setInputFiles('#importFile', { name: 'e.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ settings: {}, days: {} })) });
  await page.waitForTimeout(300);
  check('cancelled import keeps data', (await page.evaluate(() => Object.keys(JSON.parse(localStorage.flt_days)).length)) === 7, 'data replaced');
  await page.click('#closeSettings');

  // --- OFFLINE: network disabled AND server stopped, then hard reload + fresh tab
  const cached = await page.evaluate(async () => (await (await caches.open('flt-v1')).keys()).map((r) => new URL(r.url).pathname));
  check('cache holds all 7 entries', cached.length === 7, cached.join(', '));
  await new Promise((r) => server.close(r));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  check('offline reload renders hero', (await page.innerText('#todayNum')) === '697', await page.innerText('#todayNum'));
  check('offline reload renders flag', (await page.innerText('#avgFlag')).startsWith('6-day average'), await page.innerText('#avgFlag'));
  check('offline: CSS applied', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(0, 0, 0)', 'css');
  await logDay(await D(-6), { fCalories: 1917.4 });
  check('offline save works -> All 7 days logged', (await page.innerText('#avgFlag')) === 'All 7 days logged.', await page.innerText('#avgFlag'));
  const p2 = await context.newPage();
  const resp = await p2.goto(URL0);
  check('offline fresh launch served by SW', resp && resp.fromServiceWorker(), 'not from SW');
  check('offline fresh launch renders', (await p2.innerText('#todayNum')) === '697', await p2.innerText('#todayNum'));
  const iconOk = await p2.evaluate(async () => (await fetch('icon-512.png')).ok && (await fetch('manifest.json')).ok);
  check('offline icons + manifest', iconOk, 'missing');

  check('no requests outside the app origin', foreign.length === 0, foreign.join(', '));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
