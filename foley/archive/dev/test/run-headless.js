/* Runs test/selftest.html in headless Edge/Chrome via the DevTools protocol (no npm deps).
   Usage: node test/run-headless.js [path-to-browser] */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const SMOKE = require('./ui-smoke.js');

const candidates = [process.argv[2],
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) { console.error('No browser found'); process.exit(2); }

const url = 'file:///' + path.resolve(__dirname, 'selftest.html').replace(/\\/g, '/');
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + path.join(require('os').tmpdir(), 'foley-headless-' + process.pid), 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const out = proc.stdio[3], inp = proc.stdio[4];
let id = 0; const pending = new Map(); let buf = '';
const send = (method, params, sessionId) => new Promise((res, rej) => { const m = { id: ++id, method, params: params || {} }; if (sessionId) m.sessionId = sessionId; pending.set(m.id, { res, rej }); out.write(JSON.stringify(m) + '\0'); });
const eventWaiters = [];
const waitEvent = (method, sessionId) => new Promise(res => eventWaiters.push({ method, sessionId, res }));
inp.on('data', d => { buf += d.toString(); let i; while ((i = buf.indexOf('\0')) >= 0) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); } else if (msg.method) { for (let k = eventWaiters.length - 1; k >= 0; k--) { const w = eventWaiters[k]; if (w.method === msg.method && w.sessionId === msg.sessionId) { eventWaiters.splice(k, 1); w.res(msg.params); } } } } });
/* Open a page and resolve with its session once fully loaded (avoids evaluating in a context that navigation destroys). */
async function openPage(pageUrl) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  const loaded = waitEvent('Page.loadEventFired', sessionId);
  await send('Page.navigate', { url: pageUrl }, sessionId);
  await loaded;
  return sessionId;
}
const timer = setTimeout(() => { console.error('TIMEOUT'); proc.kill(); process.exit(1); }, 600000);

(async () => {
  try {
    const sessionId = await openPage(url);
    const r = await send('Runtime.evaluate', { expression: "new Promise(r=>{const i=setInterval(()=>{if(document.title.startsWith('DONE')){clearInterval(i);r(document.getElementById('out').textContent)}},200)})", awaitPromise: true, returnByValue: true, timeout: 560000 }, sessionId);
    console.log(r.result.value.split('\n').filter(l => !l.startsWith('GOLDEN ')).join('\n'));
    const failed = /fail=(\d+)/.exec(r.result.value); const errs = /consoleErrors=(\d+)/.exec(r.result.value);
    let bad = (failed && +failed[1] > 0) || (errs && +errs[1] > 0);
    { const gl = r.result.value.split('\n').find(l => l.startsWith('GOLDEN ')); if (gl) { const res = require('./golden.js').compare('edge', JSON.parse(gl.slice(7))); console.log('\n--- Golden metrics ---\n' + res.lines.join('\n')); if (!res.ok) bad = true; } }

    // ---- UI smoke test on the real app ----
    const appUrl = 'file:///' + path.resolve(__dirname, '..', '..', '..', 'index.html').replace(/\\/g, '/');
    const s2 = await openPage(appUrl);
    const ui = await send('Runtime.evaluate', { expression: SMOKE, awaitPromise: true, returnByValue: true, timeout: 120000 }, s2);
    console.log('\n--- UI smoke ---\n' + ui.result.value);
    if (/FAIL/.test(ui.result.value) || !/UI errors=0/.test(ui.result.value)) bad = true;
    // ---- REAL touch events through the DevTools protocol (Input.dispatchTouchEvent) ----
    const touch = [];
    try {
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }, s2);
      await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, s2); await new Promise(r => setTimeout(r, 200));
      const rect = (await send('Runtime.evaluate', { expression: "(() => { const el = document.querySelectorAll('.pad:not(.add)')[1]; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, id: el.getAttribute('data-id') }); })()", returnByValue: true }, s2)).result.value;
      const { x, y, id } = JSON.parse(rect);
      const evalJs = async js => (await send('Runtime.evaluate', { expression: js, returnByValue: true }, s2)).result.value;
      const probe = await evalJs("(() => { const e = document.elementFromPoint(" + x + ", " + y + "); const m = document.querySelector('#modal'); return JSON.stringify({ at: e ? (e.tagName + '.' + e.className) : null, modalHidden: m.classList.contains('hidden'), vw: innerWidth, vh: innerHeight, sx: scrollX, sy: scrollY, dpr: devicePixelRatio, x: " + x + ", y: " + y + " }); })()");
      touch.push('INFO touch probe ' + probe);
      await evalJs("window.__stopAll = () => Foley.Engine.stopAll(); Foley.Engine.stopAll(); window.__evt = []; ['pointerdown','pointerup','pointercancel','pointerleave','touchstart','touchend','touchcancel','contextmenu','dragstart','click'].forEach(t => document.querySelectorAll('.pad:not(.add)')[1].addEventListener(t, e => window.__evt.push(t + (e.pointerType ? ':' + e.pointerType : '')))); true");
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }, s2); await new Promise(r => setTimeout(r, 100));
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s2); await new Promise(r => setTimeout(r, 500));
      const sel = await evalJs("Foley.Store.state.selected"); const menu = await evalJs("!!document.querySelector('.ctx')"); const evlog = await evalJs("window.__evt.join(' ')");
      touch.push((sel === id && !menu ? 'PASS' : 'FAIL') + ' real touch tap selects/triggers pad (menu open=' + menu + ') events: ' + evlog);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }, s2); await new Promise(r => setTimeout(r, 700));
      const menu2 = await evalJs("!!document.querySelector('.ctx')"); touch.push((menu2 ? 'PASS' : 'FAIL') + ' real touch long-press opens menu');
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s2); await new Promise(r => setTimeout(r, 100));
      await evalJs("Foley.UI.closeMenu(); true");
      // real touch drag on a slider: value must follow the finger
      const sr = JSON.parse(await evalJs("(() => { const el = document.querySelector('#inspector .layer input[type=range]'); const r = el.getBoundingClientRect(); el.scrollIntoView(); const r2 = el.getBoundingClientRect(); return JSON.stringify({ x0: r2.left + 4, x1: r2.left + r2.width - 4, y: r2.top + r2.height / 2, min: +el.min, max: +el.max }); })()"));
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sr.x0, y: sr.y, id: 2 }] }, s2); await new Promise(r => setTimeout(r, 60));
      for (let k = 1; k <= 8; k++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sr.x0 + (sr.x1 - sr.x0) * k / 8, y: sr.y, id: 2 }] }, s2); await new Promise(r => setTimeout(r, 40)); }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s2); await new Promise(r => setTimeout(r, 200));
      const v = await evalJs("+document.querySelector('#inspector .layer input[type=range]').value");
      touch.push((v >= sr.min + (sr.max - sr.min) * 0.85 ? 'PASS' : 'FAIL') + ' real touch drag moves a slider to its end (' + v + ' of ' + sr.max + ')');
    } catch (e) { touch.push('FAIL real touch sequence threw: ' + e.message); }
    console.log('\n--- Real touch (CDP) ---\n' + touch.join('\n'));
    if (touch.some(l => /^FAIL/.test(l))) bad = true;
    clearTimeout(timer); proc.kill();
    process.exit(bad ? 1 : 0);
  } catch (e) { console.error(e); clearTimeout(timer); proc.kill(); process.exit(1); }
})();
