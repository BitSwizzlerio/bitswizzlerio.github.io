/* Runs the UI smoke test (and engine self-test) in headless Firefox via Marionette (no npm deps).
   Usage: node test/run-firefox.js [path-to-firefox] */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const SMOKE = require('./ui-smoke.js');
const STAGES = (process.env.FOLEY_STAGES || 'engine,smoke,real').split(',');
const T0 = Date.now(); const stamp = () => '[' + ((Date.now() - T0) / 1000).toFixed(0) + 's]';

const candidates = [process.argv[2], 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', 'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe', '/usr/bin/firefox', '/Applications/Firefox.app/Contents/MacOS/firefox'].filter(Boolean);
const firefox = candidates.find(p => fs.existsSync(p));
if (!firefox) { console.error('No Firefox found'); process.exit(2); }

const port = 2828 + Math.floor(Math.random() * 1000);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'foley-ff-'));
fs.writeFileSync(path.join(profile, 'user.js'), [
  'user_pref("marionette.port", ' + port + ');',
  'user_pref("media.autoplay.default", 0);', 'user_pref("media.autoplay.blocking_policy", 0);',
  'user_pref("dom.disable_open_during_load", false);', 'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);', 'user_pref("toolkit.telemetry.enabled", false);',
  'user_pref("app.update.enabled", false);', 'user_pref("remote.log.level", "Error");',
].join('\n'));
const proc = spawn(firefox, ['--headless', '--marionette', '--no-remote', '-profile', profile, 'about:blank'], { stdio: 'ignore' });
/* Firefox on Windows is a launcher stub that spawns the real browser, so proc.kill() alone leaves an orphan.
   Ask Marionette to quit, then kill the whole process tree, then remove the temp profile. */
let quitFn = null;
const cleanup = async () => {
  try { if (quitFn) await Promise.race([quitFn(), new Promise(r => setTimeout(r, 3000))]); } catch (e) { }
  try { proc.kill(); } catch (e) { }
  if (process.platform === 'win32') { try { require('child_process').execSync('taskkill /T /F /PID ' + proc.pid, { stdio: 'ignore' }); } catch (e) { } try { require('child_process').execSync('wmic process where "CommandLine like \'%' + path.basename(profile) + '%\'" call terminate', { stdio: 'ignore' }); } catch (e) { } }
  await new Promise(r => setTimeout(r, 800));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
};
const exit = async code => { clearTimeout(timer); await cleanup(); process.exit(code); };
const timer = setTimeout(() => { console.error('TIMEOUT ' + stamp()); exit(1); }, 600000);
process.on('SIGINT', () => exit(130)); process.on('SIGTERM', () => exit(143));

function connect(attempt) {
  attempt = attempt || 0;
  const sock = net.connect(port, '127.0.0.1');
  sock.once('error', () => { if (attempt > 60) { console.error('Could not connect to Marionette'); exit(1); } else setTimeout(() => connect(attempt + 1), 500); });
  sock.once('connect', () => run(sock));
}
function run(sock) {
  /* Marionette frames are "<byteLength>:<json>" — the length is in UTF-8 BYTES, so parse on Buffers, not strings,
     or any non-ASCII character (✕, curly quotes in Firefox error text) desyncs the stream and the client hangs. */
  let buf = Buffer.alloc(0); let id = 0; const pending = new Map(); let hello = false;
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const c = buf.indexOf(0x3a); if (c < 0) return; // ':'
      const len = parseInt(buf.slice(0, c).toString('ascii'), 10); if (!(len >= 0)) { console.error('bad frame'); return; }
      if (buf.length < c + 1 + len) return;
      const body = buf.slice(c + 1, c + 1 + len).toString('utf8'); buf = buf.slice(c + 1 + len);
      let msg; try { msg = JSON.parse(body); } catch (e) { console.error('frame parse error: ' + e.message); continue; }
      if (!hello) { hello = true; start(); continue; }
      if (Array.isArray(msg) && msg[0] === 1) { const p = pending.get(msg[1]); if (!p) continue; pending.delete(msg[1]); if (msg[2]) p.rej(new Error(JSON.stringify(msg[2]))); else p.res(msg[3]); }
    }
  });
  const send = (cmd, params) => new Promise((res, rej) => { const m = JSON.stringify([0, ++id, cmd, params || {}]); pending.set(id, { res, rej }); sock.write(Buffer.byteLength(m, 'utf8') + ':' + m); });
  const fileUrl = f => 'file:///' + path.resolve(__dirname, f).replace(/\\/g, '/');
  async function start() {
    quitFn = () => send('Marionette:Quit', { flags: ['eForceQuit'] });
    try {
      console.log(stamp() + ' connected to Marionette on port ' + port);
      await send('WebDriver:NewSession', { capabilities: {} });
      console.log(stamp() + ' session created');
      await send('WebDriver:SetTimeouts', { script: 800000, pageLoad: 60000 });
      let bad = false;
      // 1) engine self-test
      if (STAGES.includes('engine')) {
        await send('WebDriver:Navigate', { url: fileUrl('selftest.html') });
        const r1 = await send('WebDriver:ExecuteAsyncScript', { script: "const cb = arguments[arguments.length-1]; const i = setInterval(() => { if (document.title.startsWith('DONE')) { clearInterval(i); cb(document.getElementById('out').textContent); } }, 200);", args: [] });
        const t1 = r1.value; const lines = t1.split('\n');
        console.log('--- Firefox engine self-test ---'); console.log(lines.filter(l => !/^PASS/.test(l) && !/^GOLDEN /.test(l)).join('\n'));
        console.log('(' + lines.filter(l => /^PASS/.test(l)).length + ' PASS lines omitted) ' + stamp());
        bad = bad || !/fail=0/.test(t1) || !/consoleErrors=0/.test(t1);
        { const gl = lines.find(l => l.startsWith('GOLDEN ')); if (gl) { const res = require('./golden.js').compare('firefox', JSON.parse(gl.slice(7))); console.log('--- Golden metrics ---\n' + res.lines.join('\n')); if (!res.ok) bad = true; } }
      }
      // 2) UI smoke
      if (STAGES.includes('smoke')) {
        await send('WebDriver:Navigate', { url: fileUrl('../../../index.html') });
        const r2 = await send('WebDriver:ExecuteAsyncScript', { script: 'const cb = arguments[arguments.length-1]; (' + SMOKE + ').then(cb, e => cb("FAIL smoke threw: " + e));', args: [] });
        console.log('\n--- Firefox UI smoke ---\n' + r2.value + '\n' + stamp());
        if (/FAIL/.test(r2.value) || !/UI errors=0/.test(r2.value)) bad = true;
      }
      if (!STAGES.includes('real')) { await exit(bad ? 1 : 0); return; }
      // 3) REAL clicks through WebDriver (fails if an element is obscured / not interactable): new pad -> Delete pad -> confirm
      const click = async (css) => { const { value } = await send('WebDriver:FindElement', { using: 'css selector', value: css }); const ref = value[Object.keys(value)[0]]; await send('WebDriver:ElementClick', { id: ref }); };
      const evalJs = async (js) => (await send('WebDriver:ExecuteScript', { script: 'return (' + js + ')', args: [] })).value;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const real = [];
      try {
        await send('WebDriver:Navigate', { url: fileUrl('../../../index.html') }); await sleep(500);
        const n0 = await evalJs('Foley.Store.state.pads.length');
        // click the "+ New Pad" toolbar button then the first generator card
        { const { value } = await send('WebDriver:FindElement', { using: 'xpath', value: "//button[contains(., 'New Pad')]" }); await send('WebDriver:ElementClick', { id: value[Object.keys(value)[0]] }); } await sleep(200); await click('.gen-card'); await sleep(400);
        const n1 = await evalJs('Foley.Store.state.pads.length'); real.push((n1 === n0 + 1 ? 'PASS' : 'FAIL') + ' real click: new pad created (' + n0 + ' -> ' + n1 + ')');
        const newId = await evalJs('Foley.Store.state.selected');
        await evalJs('(document.querySelector("#inspector").scrollTop = 1e6, true)');
        await click('#inspector .row.foot button.danger'); await sleep(250);
        const n2 = await evalJs('Foley.Store.state.pads.length'); const gone = await evalJs('!Foley.Store.state.pads.find(p => p.id === "' + newId + '") && !document.querySelector(".pad[data-id=\\"' + newId + '\\"]")');
        real.push((n2 === n0 && gone ? 'PASS' : 'FAIL') + ' real click: Delete pad removes immediately (' + n1 + ' -> ' + n2 + ')');
        const hasUndo = await evalJs('!!document.querySelector(".toast .toast-action")'); real.push((hasUndo ? 'PASS' : 'FAIL') + ' real click: Undo toast shown');
        await click('.toast .toast-action'); await sleep(200);
        const n2b = await evalJs('Foley.Store.state.pads.length'); real.push((n2b === n1 ? 'PASS' : 'FAIL') + ' real click: toast Undo restores pad (' + n2 + ' -> ' + n2b + ')');
        // pad ✕ via real hover+click (centre it first: toasts live at the bottom and can briefly overlap the last row)
        await evalJs("(document.querySelector('.pad[data-id=\"" + newId + "\"]').scrollIntoView({ block: 'center' }), true)"); await sleep(450);
        await click('.pad[data-id="' + newId + '"] .pad-x'); await sleep(200);
        const n2c = await evalJs('Foley.Store.state.pads.length'); real.push((n2c === n0 ? 'PASS' : 'FAIL') + ' real click: pad ✕ removes pad (' + n2b + ' -> ' + n2c + ')');
        // keyboard still works after a mouse-confirmed modal (listener leak regression)
        const cacheBefore = await evalJs('Foley.Engine.voices.size >= 0 && Foley.Store.state.pads[0].key');
        await send('WebDriver:ExecuteScript', { script: 'document.dispatchEvent(new KeyboardEvent("keydown", { key: arguments[0], bubbles: true }))', args: [cacheBefore] }); await sleep(600);
        const flashed = await evalJs('Foley.Engine.ctx !== null');
        real.push((flashed ? 'PASS' : 'FAIL') + ' keyboard trigger still works after modal');
        // Delete key removes selected pad; Ctrl+Z restores
        const n3 = await evalJs('Foley.Store.state.pads.length');
        await send('WebDriver:ExecuteScript', { script: 'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }))', args: [] }); await sleep(150);
        const n4 = await evalJs('Foley.Store.state.pads.length'); real.push((n4 === n3 - 1 ? 'PASS' : 'FAIL') + ' Delete key removes selected pad');
        await send('WebDriver:ExecuteScript', { script: 'document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))', args: [] }); await sleep(150);
        const n5 = await evalJs('Foley.Store.state.pads.length'); real.push((n5 === n3 ? 'PASS' : 'FAIL') + ' Ctrl+Z restores it');
        // real ctrl+click multi-select of two pads, then selection-bar delete (scroll the board to the top first: earlier clicks scrolled it)
        await evalJs('(document.querySelector("#board").scrollTop = 0, true)'); await sleep(100);
        const p0 = (await send('WebDriver:FindElement', { using: 'css selector', value: '.pad:not(.add):nth-child(1)' })).value; const p1 = (await send('WebDriver:FindElement', { using: 'css selector', value: '.pad:not(.add):nth-child(2)' })).value;
        const ref = v => ({ 'element-6066-11e4-a52e-4f735466cecf': v[Object.keys(v)[0]] });
        await send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: ref(p0), x: 0, y: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] }); await sleep(120);
        await send('WebDriver:PerformActions', { actions: [{ type: 'key', id: 'kb', actions: [{ type: 'keyDown', value: '' }] }, { type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: ref(p1), x: 0, y: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
        await send('WebDriver:PerformActions', { actions: [{ type: 'key', id: 'kb', actions: [{ type: 'keyUp', value: '' }] }] }); await sleep(150);
        const multi = await evalJs('Foley.Store.state.multi.size'); real.push((multi === 2 ? 'PASS' : 'FAIL') + ' real Ctrl+click selects two pads (' + multi + ')');
        const n6a = await evalJs('Foley.Store.state.pads.length'); await click('#selDelete'); await sleep(200);
        const n6b = await evalJs('Foley.Store.state.pads.length'); real.push((n6b === n6a - 2 ? 'PASS' : 'FAIL') + ' real click on selection-bar Delete removes both (' + n6a + ' -> ' + n6b + ')');
        await click('.toast .toast-action'); await sleep(200); const n6c = await evalJs('Foley.Store.state.pads.length'); real.push((n6c === n6a ? 'PASS' : 'FAIL') + ' Undo restores both');
        // context menu via WebDriver: right-click a pad with a real pointer action, then real-click "Duplicate"
        await evalJs('(document.querySelector("#board").scrollTop = 0, true)'); await sleep(100);
        const n6 = await evalJs('Foley.Store.state.pads.length');
        const padRef = (await send('WebDriver:FindElement', { using: 'css selector', value: '.pad:not(.add)' })).value; const padId = padRef[Object.keys(padRef)[0]];
        await send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: { 'element-6066-11e4-a52e-4f735466cecf': padId }, x: 0, y: 0 }, { type: 'pointerDown', button: 2 }, { type: 'pointerUp', button: 2 }] }] });
        await sleep(150);
        const menuOpen = await evalJs('!!document.querySelector(".ctx")'); real.push((menuOpen ? 'PASS' : 'FAIL') + ' real right-click opens context menu');
        await click('.ctx div:nth-child(1)'); await sleep(200);
        const n7 = await evalJs('Foley.Store.state.pads.length'); const closed = await evalJs('!document.querySelector(".ctx")');
        real.push((n7 === n6 + 1 && closed ? 'PASS' : 'FAIL') + ' real click on context-menu Duplicate (' + n6 + ' -> ' + n7 + ', menu closed=' + closed + ')');
        // real right-click -> Delete -> confirm (board re-rendered after Duplicate, so re-find the pad element)
        const padRef2 = (await send('WebDriver:FindElement', { using: 'css selector', value: '.pad:not(.add)' })).value; const padId2 = padRef2[Object.keys(padRef2)[0]];
        await send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: { 'element-6066-11e4-a52e-4f735466cecf': padId2 }, x: 0, y: 0 }, { type: 'pointerDown', button: 2 }, { type: 'pointerUp', button: 2 }] }] });
        await sleep(150); await click('.ctx div.danger'); await sleep(250);
        const n8 = await evalJs('Foley.Store.state.pads.length'); real.push((n8 === n7 - 1 ? 'PASS' : 'FAIL') + ' real click on context-menu Delete (' + n7 + ' -> ' + n8 + ')');
        // real TOUCH via WebDriver pointer actions (pointerType 'touch'): tap, long-press, and a slider drag
        await evalJs('(document.querySelector("#board").scrollTop = 0, true)'); await sleep(100);
        await evalJs('(Foley.Engine.stopAll(), Foley.UI.closeMenu(), true)');
        const tp = (await send('WebDriver:FindElement', { using: 'css selector', value: '.pad:not(.add):nth-child(3)' })).value; const tpId = tp[Object.keys(tp)[0]]; const tpData = await evalJs('document.querySelectorAll(".pad:not(.add)")[2].getAttribute("data-id")');
        const touchTap = (elId, holdMs) => send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', origin: { 'element-6066-11e4-a52e-4f735466cecf': elId }, x: 0, y: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: holdMs }, { type: 'pointerUp', button: 0 }] }] });
        await touchTap(tpId, 80); await sleep(500);
        const tsel = await evalJs('Foley.Store.state.selected'); const tmenu = await evalJs('!!document.querySelector(".ctx")');
        real.push((tsel === tpData && !tmenu ? 'PASS' : 'FAIL') + ' real touch tap selects/triggers pad (menu open=' + tmenu + ')');
        await touchTap(tpId, 700); await sleep(150);
        const tmenu2 = await evalJs('!!document.querySelector(".ctx")'); real.push((tmenu2 ? 'PASS' : 'FAIL') + ' real touch long-press opens menu'); await evalJs('(Foley.UI.closeMenu(), true)');
        await evalJs('(window.scrollTo(0, 0), document.querySelector("#inspector").scrollTop = 0, document.querySelector("#inspector .layer input[type=range]").scrollIntoView({ block: "center", inline: "nearest" }), true)'); await sleep(150);
        const slRef = (await send('WebDriver:FindElement', { using: 'css selector', value: '#inspector .layer input[type=range]' })).value; const slId = slRef[Object.keys(slRef)[0]];
        const slInfo = JSON.parse(await evalJs('(() => { const el = document.querySelector("#inspector .layer input[type=range]"); const r = el.getBoundingClientRect(); return JSON.stringify({ w: r.width, min: +el.min, max: +el.max }); })()'));
        const half = Math.floor(slInfo.w / 2) - 4; const moves = []; for (let k = 1; k <= 8; k++) moves.push({ type: 'pointerMove', duration: 30, origin: { 'element-6066-11e4-a52e-4f735466cecf': slId }, x: Math.round(-half + (2 * half) * k / 8), y: 0 });
        await send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'finger2', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', origin: { 'element-6066-11e4-a52e-4f735466cecf': slId }, x: -half, y: 0 }, { type: 'pointerDown', button: 0 }].concat(moves, [{ type: 'pointerUp', button: 0 }]) }] }); await sleep(200);
        const slv = await evalJs('+document.querySelector("#inspector .layer input[type=range]").value');
        real.push((slv >= slInfo.min + (slInfo.max - slInfo.min) * 0.85 ? 'PASS' : 'FAIL') + ' real touch drag moves a slider to its end (' + slv + ' of ' + slInfo.max + ')');
        // real MOUSE drag on a slider (the reported bug): press at the left, drag right, value must follow
        await send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: { 'element-6066-11e4-a52e-4f735466cecf': slId }, x: -half, y: 0 }, { type: 'pointerDown', button: 0 }].concat(moves.map(m => Object.assign({}, m)), [{ type: 'pointerUp', button: 0 }]) }] }); await sleep(200);
        const slv2 = await evalJs('+document.querySelector("#inspector .layer input[type=range]").value');
        real.push((slv2 >= slInfo.min + (slInfo.max - slInfo.min) * 0.85 ? 'PASS' : 'FAIL') + ' real mouse drag moves a slider to its end (' + slv2 + ' of ' + slInfo.max + ')');
      } catch (e) { real.push('FAIL real-click sequence threw: ' + e.message); }
      console.log('\n--- Firefox real clicks (WebDriver) ---\n' + real.join('\n') + '\n' + stamp());
      if (real.some(l => /^FAIL/.test(l))) bad = true;
      await exit(bad ? 1 : 0);
    } catch (e) { console.error(e); await exit(1); }
  }
}
connect();
