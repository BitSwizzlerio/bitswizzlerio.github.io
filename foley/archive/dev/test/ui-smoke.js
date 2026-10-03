/* UI smoke test body, evaluated inside the app page. Must return a Promise<string> of PASS/FAIL lines.
   Shared by run-headless.js (Edge/Chrome via CDP) and run-firefox.js (Firefox via Marionette). */
module.exports = `new Promise(async (resolve) => {
  const errs = []; window.onerror = (m, s, l) => errs.push(m + ' @' + s + ':' + l);
  window.addEventListener('unhandledrejection', e => errs.push('unhandled: ' + (e.reason && e.reason.message || e.reason)));
  const oe = console.error; console.error = (...a) => { errs.push(a.map(String).join(' ')); oe(...a); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = []; const ok = (c, m) => out.push((c ? 'PASS ' : 'FAIL ') + m);
  try {
    await wait(300);
    const S = Foley.Store, E = Foley.Engine;
    ok(document.querySelectorAll('.pad:not(.add)').length === S.state.pads.length && S.state.pads.length > 0, 'board renders ' + S.state.pads.length + ' pads');
    ok(document.querySelector('#inspector .layer'), 'inspector shows layer editor');
    ok(document.querySelectorAll('#inspector input[type=range]').length > 10, 'param sliders present');
    const keyed = S.state.pads.filter(p => p.key); for (const p of keyed) { document.dispatchEvent(new KeyboardEvent('keydown', { key: p.key, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { key: p.key, bubbles: true })); }
    await wait(2500);
    ok(E.ctx && E.ctx.state !== 'closed', 'audio context created by key trigger');
    ok(E.cache.size >= keyed.length, 'renders cached (' + E.cache.size + ' for ' + keyed.length + ' keyed pads)');
    const pads = document.querySelectorAll('.pad:not(.add)'); pads[3].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0 }));
    await wait(200); ok(S.state.selected === S.state.pads[3].id, 'click selects pad');
    ok(pads[3].classList.contains('selected') && document.querySelectorAll('.pad.selected').length === 1, 'selection highlight moves to the clicked pad');
    pads[5].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0 })); await wait(150);
    ok(pads[5].classList.contains('selected') && !pads[3].classList.contains('selected'), 'highlight moves again on the next click');
    pads[3].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0 })); await wait(150);
    const before = JSON.stringify(S.selected().layers[0].params);
    const sl = document.querySelector('#inspector .layer input[type=range]'); sl.value = sl.max; sl.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(50); ok(JSON.stringify(S.selected().layers[0].params) !== before || S.selected().layers[0].gain === +sl.max, 'slider edit updates state');
    const n0 = S.selected().layers.length; document.querySelector('#addGen').value = 'whoosh';
    [...document.querySelectorAll('#inspector button')].find(b => b.textContent.includes('Add layer')).click(); await wait(100);
    ok(S.selected().layers.length === n0 + 1 && S.selected().layers[n0].gen === 'whoosh', 'add layer');
    const gsel = document.querySelector('#inspector select[id^=gen_]'); gsel.value = 'laser'; gsel.dispatchEvent(new Event('change', { bubbles: true })); await wait(100);
    ok(S.selected().layers[0].gen === 'laser', 'change generator');
    const padCount = S.state.pads.length;
    [...document.querySelectorAll('.toolbar button')].find(b => b.textContent.includes('New Pad')).click(); await wait(100);
    ok(!document.querySelector('#modal').classList.contains('hidden'), 'new-pad dialog opens');
    document.querySelector('.gen-card').click(); await wait(300);
    ok(S.state.pads.length === padCount + 1, 'new pad added from dialog');
    const newId = S.state.selected;
    ok(document.querySelector('.pad[data-id="' + newId + '"]'), 'new pad shown on board');
    // delete the NEW pad through the real UI: inspector button -> immediate removal + Undo toast (native confirm() must NOT be used)
    window.confirm = () => { throw new Error('native confirm() called'); };
    const delBtn = [...document.querySelectorAll('#inspector button')].find(b => b.textContent === 'Delete pad');
    ok(!!delBtn, 'delete button present for new pad');
    delBtn.click(); await wait(120);
    ok(S.state.pads.length === padCount && !S.state.pads.find(p => p.id === newId), 'delete pad removes from state immediately');
    ok(!document.querySelector('.pad[data-id="' + newId + '"]'), 'deleted pad removed from board');
    const undoBtn = document.querySelector('.toast .toast-action'); ok(!!undoBtn && undoBtn.textContent === 'Undo', 'delete shows Undo toast');
    undoBtn.click(); await wait(100); ok(S.state.pads.length === padCount + 1 && S.state.pads.find(p => p.id === newId), 'toast Undo restores pad');
    // pad ✕ button
    const xBtn = document.querySelector('.pad[data-id="' + newId + '"] .pad-x'); ok(!!xBtn, 'pad has ✕ remove button');
    for (const t of ['mousedown', 'mouseup', 'click']) xBtn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 })); await wait(100);
    ok(S.state.pads.length === padCount && !S.state.pads.find(p => p.id === newId), 'pad ✕ removes pad');
    S.undo(); await wait(50); ok(S.state.pads.length === padCount + 1, 'undo restores pad'); S.redo(); await wait(50); ok(S.state.pads.length === padCount, 'redo re-deletes');
    // Delete key removes the selected pad; Ctrl+Z restores
    const selBefore = S.state.selected;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); await wait(100);
    ok(S.state.pads.length === padCount - 1 && !S.state.pads.find(p => p.id === selBefore), 'Delete key removes selected pad');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await wait(100);
    ok(S.state.pads.length === padCount, 'Ctrl+Z restores it');
    // multi-select: ctrl+click two pads, shift+click range, selection bar, bulk delete, undo, clear bank
    const padEls = () => document.querySelectorAll('.pad:not(.add)');
    padEls()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0 })); await wait(50);
    padEls()[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0, ctrlKey: true })); await wait(80);
    ok(S.state.multi.size === 2 && document.querySelectorAll('.pad.multi').length === 2, 'Ctrl+click builds a multi-selection (' + S.state.multi.size + ')');
    ok(!!document.querySelector('#selbar') && /2 pads selected/.test(document.querySelector('#selbar').textContent), 'selection bar appears with count');
    padEls()[4].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0, shiftKey: true })); await wait(80);
    ok(S.state.multi.size === 5, 'Shift+click extends selection as a range (' + S.state.multi.size + ')');
    padEls()[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0, ctrlKey: true })); await wait(80);
    ok(S.state.multi.size === 4 && !S.state.multi.has(S.state.pads[1].id), 'Ctrl+click toggles a pad back out');
    const before4 = S.state.pads.length; document.querySelector('#selDelete').click(); await wait(120);
    ok(S.state.pads.length === before4 - 4 && S.state.multi.size === 0 && !document.querySelector('#selbar'), 'selection bar Delete removes all selected pads');
    ok(/Removed 4 pads/.test((document.querySelector('.toast') || {}).textContent || ''), 'bulk delete toast reports count');
    document.querySelector('.toast .toast-action').click(); await wait(100); ok(S.state.pads.length === before4, 'Undo restores all 4');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })); await wait(80);
    ok(S.state.multi.size === S.state.pads.length, 'Ctrl+A selects all');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(80);
    ok(S.state.multi.size === 0, 'Escape clears the selection');
    document.querySelector('#clearBankBtn').click(); await wait(120);
    ok(!!document.querySelector('#confirmOk'), 'Clear bank asks for confirmation');
    document.querySelector('#confirmOk').click(); await wait(120);
    ok(S.state.pads.length === 0 && document.querySelectorAll('.pad:not(.add)').length === 0, 'Clear bank empties the board');
    S.undo(); await wait(100); ok(S.state.pads.length === before4, 'undo restores the bank');
    // context menu: real mouse sequence (mousedown -> mouseup -> click) on each item, like a real user
    const realClick = elm => { for (const t of ['mousedown', 'mouseup', 'click']) elm.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 })); };
    const openMenu = async () => { const padEl = document.querySelector('.pad:not(.add)'); padEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })); await wait(50); return document.querySelector('.ctx'); };
    const menuItem = txt => [...document.querySelectorAll('.ctx div')].find(d => d.textContent.startsWith(txt));
    ok(!!(await openMenu()), 'context menu opens on right-click');
    const firstName = S.state.pads[0].name; realClick(menuItem('Duplicate')); await wait(120);
    ok(S.state.pads.length === padCount + 1 && S.state.pads[1].name === firstName + ' copy' && !document.querySelector('.ctx'), 'context menu: Duplicate works with real mouse events');
    await openMenu(); realClick(menuItem('Copy pad JSON')); await wait(120);
    ok(!document.querySelector('.ctx'), 'context menu: Copy JSON closes menu');
    await openMenu(); realClick(menuItem('Delete')); await wait(120);
    ok(S.state.pads.length === padCount, 'delete via context menu (real mouse events)');
    // clicking outside closes the menu; Escape closes it
    await openMenu(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); await wait(30); ok(!document.querySelector('.ctx'), 'context menu closes on outside mousedown');
    await openMenu(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(30); ok(!document.querySelector('.ctx'), 'context menu closes on Escape');
    // looping: loop pad toggles via key; preview loop button; edits swap buffer live; stopAll clears
    const lp = S.state.pads.find(p => p.key); S.update(s => { lp.loop = true; }, 'all'); await wait(100);
    ok(document.querySelector('.pad[data-id="' + lp.id + '"] .pad-loop'), 'loop badge shown on loop pad');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: lp.key, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { key: lp.key, bubbles: true })); await wait(600);
    ok(E.isLooping(lp.id), 'key trigger starts loop on loop pad');
    ok(document.querySelector('.pad[data-id="' + lp.id + '"]').classList.contains('looping'), 'looping pad gets pulsing class');
    ok(/1 loop/.test(document.querySelector('#stopBtn').textContent), 'Stop button shows loop count');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: lp.key, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { key: lp.key, bubbles: true })); await wait(200);
    ok(!E.isLooping(lp.id), 'key trigger again stops loop');
    S.select(lp.id); await wait(500);
    const loopBtn = document.querySelector('#loopBtn'); loopBtn.click(); await wait(100);
    ok(E.isLooping(lp.id) && /Stop loop/.test(loopBtn.textContent), 'preview Loop button starts loop');
    const srcBefore = E.loops.get(lp.id);
    S.update(s => { S.selected().fx.pitch = 3; }, 'none'); await wait(900);
    ok(E.isLooping(lp.id) && E.loops.get(lp.id) !== srcBefore, 'editing a looping pad swaps in the new render live');
    const lp2 = S.state.pads.filter(p => p.key)[1]; S.update(s => { lp2.loop = true; }, 'all'); await wait(100);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: lp2.key, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { key: lp2.key, bubbles: true })); await wait(600);
    ok(E.loops.size === 2, 'two pads can loop simultaneously');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(150);
    ok(E.loops.size === 0 && !document.querySelector('.pad.looping'), 'Escape stops all loops and clears indicators');
    S.update(s => { lp.loop = false; lp2.loop = false; }, 'all'); await wait(100);
    // A/B compare: snap, tweak, diff count, play A/B, flip, restore
    S.select(lp.id); await wait(600);
    ok(!!document.querySelector('#abSnap') && !document.querySelector('#abPlayA'), 'A/B row present, no snapshot yet');
    document.querySelector('#abSnap').click(); await wait(600);
    ok(Foley.UI.ab && Foley.UI.ab.padId === lp.id && Foley.UI.ab.buffer && Foley.UI.ab.buffer.length > 0, 'Snap A stores state + rendered buffer');
    ok(!!document.querySelector('#abPlayA') && /no changes/.test(document.querySelector('#abInfo').textContent) && document.querySelector('#abRestore').disabled, 'A/B controls appear; diff = 0; Restore disabled');
    const gainBefore = S.selected().fx.gain;
    S.update(s => { S.selected().fx.gain = gainBefore + 3; S.selected().layers[0].gain = -6; }, 'none'); await wait(700);
    ok(/2 changes since A/.test(document.querySelector('#abInfo').textContent) && !document.querySelector('#abRestore').disabled, 'diff counter tracks edits (2 changes)');
    const vBefore = E.voices.size; document.querySelector('#abPlayA').click(); await wait(50); ok(E.voices.size > vBefore, 'Play A starts a voice');
    document.querySelector('#abFlip').click(); await wait(50); ok(E.voices.size >= vBefore + 2, 'Flip schedules A then B');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true })); await wait(50); ok(E.voices.size >= vBefore + 3, 'Shift+A plays A (does not trigger pad key a)');
    document.querySelector('#abRestore').click(); await wait(600);
    ok(S.selected().fx.gain === gainBefore && S.selected().layers[0].gain === 0 && /no changes/.test(document.querySelector('#abInfo').textContent), 'Restore A puts the snapshot back');
    S.undo(); await wait(300); ok(S.selected().fx.gain === gainBefore + 3, 'Restore A is undoable'); S.redo(); await wait(300);
    E.stopAll();
    // slider drag must survive: a param change must NOT rebuild the inspector (the input under the pointer stays the same node)
    { const sl = document.querySelector('#inspector .layer input[type=range]'); const before = sl; sl.value = (+sl.min + +sl.max) / 2; sl.dispatchEvent(new Event('input', { bubbles: true })); await wait(30); sl.value = +sl.max; sl.dispatchEvent(new Event('input', { bubbles: true })); await wait(30);
      ok(document.contains(before) && document.querySelector('#inspector .layer input[type=range]') === before, 'slider stays the same DOM node across input events (drag-safe)'); }
    // touch: tap triggers + selects; long-press opens the menu; pointerup before 500 ms does not
    { const pads = document.querySelectorAll('.pad:not(.add)'); const target = pads[2]; const id = target.getAttribute('data-id'); const c0 = E.cache.size; const pe = (type, extra) => new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 7, button: 0, clientX: 120, clientY: 160 }, extra || {}));
      target.dispatchEvent(pe('pointerdown')); await wait(120); target.dispatchEvent(pe('pointerup')); await wait(400);
      ok(S.state.selected === id && !document.querySelector('.ctx'), 'touch tap selects + triggers pad without opening the menu');
      target.dispatchEvent(pe('pointerdown')); await wait(650);
      ok(!!document.querySelector('.ctx'), 'touch long-press opens the pad menu'); target.dispatchEvent(pe('pointerup')); await wait(50); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); await wait(50); ok(!document.querySelector('.ctx'), 'touch outside closes the menu'); }
    // bank library: save, list, load, rename, delete (IndexedDB or localStorage fallback)
    { const name = 'smoke-bank-' + Date.now(); const padsNow = S.state.pads.length; await Foley.Library.save(name, JSON.parse(S.exportBank())); const rows = await Foley.Library.list(); ok(rows.some(r => r.name === name && r.pads === padsNow), 'library save + list (' + Foley.Library.backend + ')');
      const data = await Foley.Library.load(name); ok(data && data.pads.length === padsNow, 'library load returns the bank'); await Foley.Library.rename(name, name + '-b'); ok((await Foley.Library.list()).some(r => r.name === name + '-b') && !(await Foley.Library.exists(name)), 'library rename'); await Foley.Library.remove(name + '-b'); ok(!(await Foley.Library.exists(name + '-b')), 'library delete');
      document.querySelector('#saveBtn').click(); await wait(300); const pi = document.querySelector('#promptInput'); if (pi) { pi.value = name + '-ui'; document.querySelector('#promptOk').click(); await wait(300); } ok(await Foley.Library.exists(S.state.bankName), 'Save button stores the current bank (' + S.state.bankName + ')'); ok(/saved/.test(document.querySelector('#dirty').textContent), 'saved indicator shown');
      S.update(s => { S.selected().fx.gain = 1; }, 'none'); await wait(100); ok(/unsaved/.test(document.querySelector('#dirty').textContent), 'unsaved indicator after an edit');
      document.querySelector('#banksBtn').click(); await wait(300); ok(document.querySelectorAll('.bank-row').length >= 1, 'Banks dialog lists saved banks'); [...document.querySelectorAll('#modal button')].find(b => b.textContent === 'Close').click(); await wait(100); await Foley.Library.remove(S.state.bankName); }
    // export format prefs + OGG encode path
    { const fmt = document.querySelector('#fmtSel'); fmt.value = 'ogg'; fmt.dispatchEvent(new Event('change', { bubbles: true })); ok(Foley.UI.prefs().format === 'ogg', 'export format pref persists');
      Foley.Ogg.baseUrl = ''; try { const r = await Foley.UI.encodeForExport(Foley.UI.previewBuffer, S.selected()); ok(r.ext === '.ogg' && r.blob.size > 200 && r.blob.type === 'audio/ogg', 'OGG export produces an audio/ogg blob (' + r.blob.size + ' bytes)'); } catch (e) { ok(false, 'OGG export threw: ' + e.message); }
      fmt.value = 'wav16'; fmt.dispatchEvent(new Event('change', { bubbles: true })); }
    // workflow tranche: solo, repeat, layer FX, timeline drag, copy/paste FX, batch ops, presets, macros, MIDI, tabs
    { S.select(S.state.pads[0].id); await wait(400); const pad = S.selected(); const l0 = pad.layers[0];
      [...document.querySelectorAll('#inspector .layer-head button')].find(b => b.textContent === 'S').click(); await wait(80); ok(S.selected().layers[0].solo === true && document.querySelector('.layer-head button.solo'), 'layer solo toggles'); [...document.querySelectorAll('#inspector .layer-head button')].find(b => b.textContent === 'S').click(); await wait(80);
      const durBefore = E.layerDuration(S.selected().layers[0]); S.update(s => { S.selected().layers[0].repeat = 4; S.selected().layers[0].every = 0.3; }, 'select'); await wait(100);
      ok(E.layerDuration(S.selected().layers[0]) > durBefore + 0.8 && document.querySelectorAll('#timeline .tl-block.ghost').length === 3, 'layer repeat extends duration and shows 3 ghost blocks on the timeline');
      const b1 = await E.render(S.selected(), 1); S.update(s => { S.selected().layers[0].repeat = 1; }, 'select'); await wait(100); const b0 = await E.render(S.selected(), 1); ok(b1.duration > b0.duration + 0.5, 'repeated layer renders longer (' + b0.duration.toFixed(2) + ' -> ' + b1.duration.toFixed(2) + 's)');
      S.update(s => { S.selected().layers[0].lp = 800; }, 'none'); await wait(700); const lpb = Foley.UI.brightness(Foley.UI.previewBuffer); S.update(s => { S.selected().layers[0].lp = 20000; }, 'none'); await wait(700); const lpa = Foley.UI.brightness(Foley.UI.previewBuffer); ok(lpb < lpa, 'per-layer low-pass darkens the render (' + lpb.toFixed(4) + ' < ' + lpa.toFixed(4) + ')');
      // timeline drag: pointer-drag the first block to the right -> offset increases
      const blk = document.querySelector('#timeline .tl-block'); const tl = document.querySelector('#timeline').getBoundingClientRect(); const r0 = blk.getBoundingClientRect(); const pe = (t, x) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, pointerId: 3, button: 0, clientX: x, clientY: r0.top + 5 });
      blk.dispatchEvent(pe('pointerdown', r0.left + 5)); blk.dispatchEvent(pe('pointermove', r0.left + 5 + tl.width * 0.25)); blk.dispatchEvent(pe('pointerup', r0.left + 5 + tl.width * 0.25)); await wait(150);
      ok(S.selected().layers[0].offset > 0.05, 'dragging a timeline block sets the layer offset (' + S.selected().layers[0].offset + 's)'); S.update(s => { S.selected().layers[0].offset = 0; }, 'select'); await wait(100);
      // copy / paste FX between pads
      S.update(s => { S.selected().fx.reverb = 0.42; }, 'select'); await wait(100); document.querySelector('#copyFx').click(); await wait(50); S.select(S.state.pads[1].id); await wait(200); document.querySelector('#pasteFx').click(); await wait(100); ok(Math.abs(S.selected().fx.reverb - 0.42) < 1e-6, 'Copy FX / Paste FX between pads');
      // batch ops on a multi-selection: paste FX to all, re-seed all
      S.state.multi = new Set([S.state.pads[2].id, S.state.pads[3].id]); S.emit('pads'); await wait(100); document.querySelector('#selPasteFx').click(); await wait(100); ok(Math.abs(S.state.pads[2].fx.reverb - 0.42) < 1e-6 && Math.abs(S.state.pads[3].fx.reverb - 0.42) < 1e-6, 'selection bar Paste FX applies to all selected');
      const seeds = [S.state.pads[2].seed, S.state.pads[3].seed]; S.state.multi = new Set([S.state.pads[2].id, S.state.pads[3].id]); S.emit('pads'); await wait(60); document.querySelector('#selReseed').click(); await wait(100); ok(S.state.pads[2].seed !== seeds[0] || S.state.pads[3].seed !== seeds[1], 'selection bar Re-seed changes seeds'); S.clearMulti();
      // generator presets in the new-pad dialog
      [...document.querySelectorAll('.toolbar button')].find(b => b.textContent.includes('New Pad')).click(); await wait(100); const preset = [...document.querySelectorAll('.gen-preset')].find(x => x.textContent === 'Anvil'); ok(!!preset, 'generator presets shown in the dialog'); const pc = S.state.pads.length; preset.click(); await wait(300);
      ok(S.state.pads.length === pc + 1 && S.selected().name === 'Anvil' && S.selected().layers[0].params.material === 'metal', 'preset creates a pre-configured pad'); S.deletePad(S.selected().id); await wait(100);
      // macros: add one, assign a target, move the knob -> param follows
      S.select(S.state.pads[0].id); await wait(300); document.querySelector('#addMacro').click(); await wait(100); ok(S.selected().macros.length === 1, 'macro added');
      [...document.querySelectorAll('#inspector .macro button')].find(b => b.textContent.includes('assign')).click(); await wait(100); const mp = document.querySelector('#mtParam'); ok(!!mp && mp.options.length > 0, 'macro assign dialog lists range params'); const pid = mp.value; document.querySelector('#mtMin').value = 0; document.querySelector('#mtMax').value = 1; document.querySelector('#mtOk').click(); await wait(100);
      ok(S.selected().macros[0].targets.length === 1 && S.selected().macros[0].targets[0].param === pid, 'macro target assigned'); const ms = document.querySelector('#inspector .macro input[type=range]'); ms.value = 0.9; ms.dispatchEvent(new Event('input', { bubbles: true })); await wait(100);
      ok(Math.abs(S.selected().layers[0].params[pid] - 0.9) < 1e-6, 'moving the macro knob drives the assigned param'); S.update(s => { S.selected().macros = []; }, 'select'); await wait(100);
      // MIDI: note-on triggers the Nth pad with velocity-tiered intensity; mod wheel sets intensity
      const before = E.voices.size; const r = Foley.Midi.handle([0x90, 37, 110]); await r; await wait(150); ok(Foley.Midi.lastNote && Foley.Midi.lastNote.pad === S.state.pads[1].id && Foley.Midi.lastNote.intensity === 0.9 && E.voices.size >= before, 'MIDI note 37 triggers pad 2 at intensity tier 0.9');
      Foley.Midi.handle([0xb0, 1, 64]); await wait(50); ok(Math.abs(S.selected().intensity - 0.5) < 0.02, 'MIDI mod wheel sets selected pad intensity'); E.stopAll();
      // bank tabs: open a second tab, switch, move a pad across, close
      const n0 = S.state.pads.length; const name0 = S.state.bankName; document.querySelector('#tabAdd').click(); await wait(100); document.querySelector('#promptInput').value = 'Tab B'; document.querySelector('#promptOk').click(); await wait(300);
      ok(S.tabs.length === 2 && S.tabIndex === 1 && S.state.bankName === 'Tab B' && S.state.pads.length === 0 && document.querySelectorAll('.tab').length === 2, 'new tab opens an empty bank');
      document.querySelectorAll('.tab')[0].click(); await wait(300); ok(S.tabIndex === 0 && S.state.bankName === name0 && S.state.pads.length === n0, 'switching back restores the first bank');
      const lastPad = S.state.pads[S.state.pads.length - 1]; S.movePadsToTab([lastPad.id], 1); await wait(200); ok(S.state.pads.length === n0 - 1 && S.tabs[1].pads.length === 1, 'pad moved to the other tab'); S.switchTab(1); await wait(200); ok(S.state.pads.length === 1, 'moved pad shows in the other tab');
      S.movePadsToTab([S.state.pads[0].id], 0); await wait(200); S.switchTab(0); await wait(200); ok(S.state.pads.length === n0, 'pad moved back'); S.closeTab(1); await wait(300); ok(S.tabs.length === 1 && S.tabIndex === 0 && S.state.bankName === name0, 'closing the tab returns to the first bank'); S.select(lp.id); await wait(300); }
    // intensity macro, tiers button, meters, new FX controls
    ok(!!document.querySelector('#intensitySl') && !!document.querySelector('#tiersBtn'), 'intensity slider + Tiers button present');
    { const sl = document.querySelector('#intensitySl'); sl.value = 0.9; sl.dispatchEvent(new Event('input', { bubbles: true })); await wait(900); ok(Math.abs(S.selected().intensity - 0.9) < 1e-6 && Foley.UI.previewBuffer, 'intensity slider updates pad + re-renders'); sl.value = 0.5; sl.dispatchEvent(new Event('input', { bubbles: true })); await wait(300); }
    ok(!!document.querySelector('#brightVal') && !!document.querySelector('#loudVal') && /LU/.test(document.querySelector('#loudVal').textContent), 'brightness + loudness meters shown');
    ok(!!document.querySelector('#reverbTypeSel') && !!document.querySelector('#normModeSel'), 'Room and Normalize selectors present');
    // crossfade checkbox + body resonator controls
    S.select(lp.id); await wait(100);
    const xf = document.querySelector('#loopFadeChk'); ok(!!xf && !xf.checked, 'crossfade checkbox present and off by default');
    xf.click(); await wait(100); ok(S.selected().fx.loopFade === 150, 'crossfade checkbox enables loopFade (150 ms)');
    ok(!!document.querySelector('#inspector input[type=range][min="5"][max="1000"]'), 'crossfade fade slider appears when enabled');
    document.querySelector('#loopFadeChk').click(); await wait(100); ok(S.selected().fx.loopFade === 0, 'crossfade checkbox disables loopFade');
    const bs = document.querySelector('#bodySel'); ok(!!bs && bs.value === 'none', 'body selector present, none by default');
    bs.value = 'hollow-metal'; bs.dispatchEvent(new Event('change', { bubbles: true })); await wait(900);
    ok(S.selected().fx.body === 'hollow-metal' && Foley.UI.previewBuffer && Foley.UI.previewBuffer.length > 0, 'body select applies and preview re-renders');
    const bsel2 = document.querySelector('#bodySel'); bsel2.value = 'none'; bsel2.dispatchEvent(new Event('change', { bubbles: true })); await wait(100);
    // fx edit + preview render + export encode
    S.update(s => { S.selected().fx.reverb = 0.3; }, 'none'); await wait(800);
    ok(Foley.UI.previewBuffer && Foley.UI.previewBuffer.length > 0, 'preview rendered after FX edit');
    const json = S.exportBank(); const o = JSON.parse(json); ok(o.pads.length === S.state.pads.length, 'bank export JSON');
    S.importBank(json, true); await wait(50); ok(S.state.pads.length === 2 * o.pads.length, 'bank import merge');
    S.loadFactory('Starter Kit'); await wait(300); ok(S.state.pads.length === Foley.Factory['Starter Kit'].length, 'factory bank load (' + S.state.pads.length + ' pads)');
    ok(localStorage.getItem('foley.bank.v1') && JSON.parse(localStorage.getItem('foley.bank.v1')).pads.length === S.state.pads.length, 'localStorage persistence');
    await wait(800);
  } catch (e) { out.push('FAIL exception in smoke test: ' + (e && e.stack || e)); }
  out.push('UI errors=' + errs.length); errs.forEach(e => out.push('  ERR ' + e));
  resolve(out.join('\\n'));
})`;
