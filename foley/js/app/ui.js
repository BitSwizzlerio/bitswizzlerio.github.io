/* Soundboard + inspector UI. Plain DOM, no framework. */
window.Foley = window.Foley || {};
(function () {
  const S = Foley.Store, E = Foley.Engine, DSP = Foley.DSP;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else if (k === 'html') e.innerHTML = attrs[k]; else if (attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    (children || []).forEach(c => { if (c === null || c === undefined) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  };
  const fmt = (v, p) => { if (p.type !== 'range') return v; const d = p.max - p.min; return (d >= 100 ? Math.round(v) : d >= 10 ? v.toFixed(1) : d >= 1 ? v.toFixed(2) : v.toFixed(3)) + (p.unit ? ' ' + p.unit : ''); };

  const UI = Foley.UI = {
    previewBuffer: null, previewSeedIdx: 0, renderToken: 0, activePads: new Map(),

    init() {
      document.body.appendChild(UI.buildShell());
      // 'none' = a parameter value changed: never rebuild the inspector for those (rebuilding the DOM under the pointer kills slider drags)
      S.on(what => { if (what === 'all' || what === 'pads') UI.renderBoard(); else if (what === 'select') UI.updateSelection(); if (what !== 'pads' && what !== 'none') UI.renderInspector(); UI.renderBankName(); UI.schedulePreview(); UI.updateDirty(); });
      E.onLoopChange = id => { document.querySelectorAll('.pad[data-id="' + id + '"]').forEach(e => e.classList.toggle('looping', E.isLooping(id))); const b = $('#loopBtn'); const p = S.selected(); if (b && p && p.id === id) { b.textContent = E.isLooping(id) ? '■ Stop loop' : '∞ Loop'; b.classList.toggle('on', E.isLooping(id)); } UI.updateLoopCount(); };
      UI.renderBoard(); UI.renderInspector(); UI.renderBankName(); UI.schedulePreview();
      UI.bindKeys(); UI.meterLoop();
      Foley.Midi.onChange = () => { const b = $('#midiBtn'); if (b) b.classList.toggle('on', Foley.Midi.enabled); };
      window.addEventListener('resize', () => UI.drawWave());
    },

    /* ---------------- shell ---------------- */
    buildShell() {
      return el('div', { class: 'app' }, [
        el('header', { class: 'topbar' }, [
          el('div', { class: 'brand' }, [el('span', { class: 'logo' }, ['🎛️']), el('span', {}, ['Foley Fun']), el('span', { class: 'sub' }, ['procedural game SFX board'])]),
          el('input', { id: 'bankName', class: 'bank-name', title: 'Bank name', onchange: e => S.update(s => s.bankName = e.target.value, 'none') }),
          el('span', { id: 'dirty', class: 'dirty', title: 'Unsaved changes (Ctrl+S saves to the browser library)' }, ['']),
          el('div', { class: 'spacer' }),
          el('div', { class: 'toolbar' }, [
            el('button', { class: 'primary', id: 'saveBtn', title: 'Save this bank in the browser library (Ctrl+S)', onclick: () => UI.saveBank() }, ['💾 Save']),
            el('button', { id: 'banksBtn', title: 'Your saved banks', onclick: () => UI.banksDialog() }, ['Banks…']),
            UI.select('factorySel', [{ value: '', label: 'Load factory bank…' }].concat(Object.keys(Foley.Factory).map(k => ({ value: k, label: k }))), '', async e => { const v = e.target.value; e.target.value = ''; if (!v) return; if (await UI.confirm('Replace the current bank with "' + v + '"? Save or export first if you want to keep it (Ctrl+Z also restores it).', 'Replace')) S.loadFactory(v); }),
            el('button', { onclick: () => UI.addPadDialog() }, ['+ New Pad']),
            el('button', { onclick: () => UI.importBank(false) }, ['Import']),
            el('button', { onclick: () => UI.exportBank() }, ['Export Bank']),
            UI.select('fmtSel', [{ value: 'wav16', label: 'WAV 16-bit' }, { value: 'wav24', label: 'WAV 24-bit' }, { value: 'ogg', label: 'OGG Vorbis' }], UI.prefs().format, e => UI.setPref('format', e.target.value)),
            UI.select('rateSel', [{ value: '48000', label: '48 kHz' }, { value: '44100', label: '44.1 kHz' }], String(UI.prefs().rate), e => UI.setPref('rate', +e.target.value)),
            UI.select('chanSel', [{ value: 'stereo', label: 'stereo' }, { value: 'mono', label: 'mono' }], UI.prefs().channels, e => UI.setPref('channels', e.target.value)),
            el('button', { onclick: () => UI.exportAllWav() }, ['Export All']),
            el('button', { class: 'ghost danger', id: 'clearBankBtn', title: 'Remove every pad (Ctrl+Z restores)', onclick: () => UI.clearBank() }, ['Clear bank']),
            el('button', { class: 'ghost', id: 'stopBtn', onclick: () => E.stopAll(), title: 'Stop all voices and loops (Esc)' }, ['■ Stop']),
            el('button', { class: 'ghost', id: 'midiBtn', title: 'MIDI in: notes from C2 trigger pads in order, velocity sets Intensity, mod wheel = selected pad Intensity', onclick: async () => { try { if (Foley.Midi.enabled) Foley.Midi.disable(); else { await Foley.Midi.enable(); UI.toast('MIDI on · inputs: ' + (Foley.Midi.inputs().join(', ') || 'none connected')); } } catch (e) { UI.toast(e.message); } } }, ['🎹 MIDI']),
            el('button', { class: 'ghost', onclick: () => UI.help() }, ['?']),
          ]),
          el('div', { class: 'master' }, [el('canvas', { id: 'meter', width: 60, height: 14 }), el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: E.masterVolume, title: 'Master volume', oninput: e => E.setMasterVolume(+e.target.value) })]),
        ]),
        el('main', { class: 'main' }, [
          el('section', { class: 'board-wrap' }, [
            el('div', { id: 'tabs', class: 'tabs' }),
            el('div', { class: 'board-tools' }, [
              el('input', { id: 'filter', placeholder: 'Filter pads…', oninput: e => { S.state.filter = e.target.value; UI.renderBoard(); } }),
              el('span', { class: 'hint' }, ['Click a pad or press its key · drag to reorder · Space = preview selected · Esc = stop · Ctrl+Z undo']),
            ]),
            el('div', { id: 'board', class: 'board' }),
          ]),
          el('aside', { id: 'inspector', class: 'inspector' }),
        ]),
        el('div', { id: 'modal', class: 'modal hidden' }),
      ]);
    },
    select(id, options, value, onchange) { const s = el('select', { id, onchange }); options.forEach(o => s.appendChild(el('option', { value: o.value }, [o.label]))); s.value = value; return s; },
    renderBankName() { const i = $('#bankName'); if (i && document.activeElement !== i) i.value = S.state.bankName; },

    /* ---------------- bank tabs ---------------- */
    renderTabs() {
      const wrap = $('#tabs'); if (!wrap) return; S.ensureTabs(); wrap.innerHTML = '';
      S.tabs.forEach((t, i) => {
        const active = i === S.tabIndex; const name = active ? S.state.bankName : t.bankName; const count = active ? S.state.pads.length : t.pads.length;
        const tab = el('div', { class: 'tab' + (active ? ' active' : ''), 'data-tab': i, title: active ? 'Current bank' : 'Switch to "' + name + '" · drop pads here to move them',
          onclick: e => { if (e.target.closest('.tab-x')) return; if (!active) S.switchTab(i); },
          ondblclick: async e => { const nn = await UI.prompt('Rename bank', name); if (nn) S.renameTab(i, nn); },
          ondragover: e => { if (!active) { e.preventDefault(); tab.classList.add('drop'); } }, ondragleave: () => tab.classList.remove('drop'),
          ondrop: e => { e.preventDefault(); tab.classList.remove('drop'); const idx = +e.dataTransfer.getData('text/plain'); const p = S.state.pads[idx]; if (!p) return; const ids = S.state.multi.has(p.id) ? [...S.state.multi] : [p.id]; S.movePadsToTab(ids, i); UI.toast('Moved ' + ids.length + ' pad' + (ids.length > 1 ? 's' : '') + ' to "' + name + '"'); },
        }, [el('span', { class: 'tab-name' }, [name]), el('span', { class: 'tab-count' }, [String(count)]), S.tabs.length > 1 ? el('span', { class: 'tab-x', title: 'Close tab', onclick: async e => { e.stopPropagation(); if (count && !await UI.confirm('Close "' + name + '"? Unsaved pads in it are discarded (save it to the library first if needed).', 'Close')) return; S.closeTab(i); } }, ['✕']) : null]);
        wrap.appendChild(tab);
      });
      wrap.appendChild(el('button', { class: 'tab-add', id: 'tabAdd', title: 'Open a new empty bank in a tab', onclick: async () => { const nn = await UI.prompt('New bank name', 'Bank ' + (S.tabs.length + 1)); if (nn) S.openTab(nn, []); } }, ['+']));
    },

    /* ---------------- board ---------------- */
    renderBoard() {
      UI.renderTabs();
      const board = $('#board'); board.innerHTML = '';
      const f = (S.state.filter || '').toLowerCase();
      S.state.pads.forEach((p, idx) => {
        if (f && !(p.name + ' ' + p.tags + ' ' + p.layers.map(l => l.gen).join(' ')).toLowerCase().includes(f)) return;
        const inMulti = S.state.multi.has(p.id);
        // Not draggable by default: a touch-hold on a draggable element becomes a drag gesture in Chromium and cancels the
        // pointer. Dragging is enabled when a MOUSE pointer hovers the pad (mouse users hover before they drag).
        const padEl = el('div', { class: 'pad' + (p.id === S.state.selected ? ' selected' : '') + (inMulti ? ' multi' : '') + (E.isLooping(p.id) ? ' looping' : ''), 'data-id': p.id, style: '--c:' + p.color,
          onpointerenter: e => { padEl.draggable = e.pointerType === 'mouse'; },
          // Pointer events cover mouse, pen and touch. Touch: tap = trigger, long-press = options menu.
          onpointerdown: e => {
            if (e.pointerType !== 'mouse') padEl.draggable = false;
            if (e.button !== 0 && e.pointerType === 'mouse') return; if (e.target.closest('.pad-menu') || e.target.closest('.pad-x')) return;
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); if (!S.state.multi.size && S.state.selected && S.state.selected !== p.id) S.state.multi.add(S.state.selected); S.toggleMulti(p.id); return; }
            if (e.shiftKey) { e.preventDefault(); S.selectRange(p.id); return; }
            if (S.state.multi.size) S.clearMulti();
            if (e.pointerType === 'touch' || e.pointerType === 'pen') {
              e.preventDefault(); // no synthetic mouse events / no scroll-drag from a pad
              const x = e.clientX, y = e.clientY; let fired = false;
              UI._lp = setTimeout(() => { fired = true; UI._lp = null; UI.padMenu(p, x, y); }, 500);
              const cancel = () => { if (UI._lp) { clearTimeout(UI._lp); UI._lp = null; if (!fired) { UI.triggerPad(p); S.select(p.id); } } padEl.removeEventListener('pointerup', cancel); padEl.removeEventListener('pointercancel', cancel); padEl.removeEventListener('pointerleave', cancel); };
              padEl.addEventListener('pointerup', cancel); padEl.addEventListener('pointercancel', cancel); padEl.addEventListener('pointerleave', cancel);
              return;
            }
            UI.triggerPad(p); S.select(p.id);
          },
          oncontextmenu: e => { e.preventDefault(); UI.padMenu(p, e.clientX, e.clientY); },
          ondragstart: e => { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; },
          ondragover: e => { e.preventDefault(); padEl.classList.add('drop'); }, ondragleave: () => padEl.classList.remove('drop'),
          ondrop: e => { e.preventDefault(); padEl.classList.remove('drop'); const from = +e.dataTransfer.getData('text/plain'); if (!isNaN(from) && from !== idx) S.movePad(from, idx); },
        }, [
          el('div', { class: 'pad-top' }, [el('span', { class: 'pad-key' }, [p.key ? p.key.toUpperCase() : '']), p.loop ? el('span', { class: 'pad-loop', title: 'Loop pad: click/key toggles playback' }, ['∞']) : null, el('span', { class: 'pad-menu', title: 'Options', onclick: e => { e.stopPropagation(); UI.padMenu(p, e.clientX, e.clientY); } }, ['⋯']), el('span', { class: 'pad-x', title: 'Remove pad (Undo available)', onmousedown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); UI.deletePad(p); } }, ['✕'])]),
          el('div', { class: 'pad-icon' }, [p.icon]),
          el('div', { class: 'pad-name' }, [p.name]),
          el('div', { class: 'pad-sub' }, [p.layers.length + (p.layers.length === 1 ? ' layer' : ' layers') + ' · ' + (p.variations || 1) + 'v' + (p.loop ? ' · loop' : '')]),
        ]);
        board.appendChild(padEl);
      });
      board.appendChild(el('div', { class: 'pad add', onclick: () => UI.addPadDialog() }, [el('div', { class: 'pad-icon' }, ['+']), el('div', { class: 'pad-name' }, ['Add pad'])]));
      UI.updateLoopCount(); UI.renderSelectionBar();
    },
    /* Bulk-action bar shown while several pads are selected. */
    renderSelectionBar() {
      let bar = $('#selbar'); const n = S.state.multi.size;
      if (!n) { if (bar) bar.remove(); return; }
      if (!bar) { bar = el('div', { id: 'selbar', class: 'selbar' }); $('.board-wrap').insertBefore(bar, $('#board')); }
      bar.innerHTML = '';
      bar.append(
        el('span', { class: 'selcount' }, [n + ' pad' + (n > 1 ? 's' : '') + ' selected']),
        el('button', { class: 'danger', id: 'selDelete', onclick: () => UI.deleteSelected() }, ['🗑 Delete ' + n]),
        el('button', { onclick: () => S.duplicatePads([...S.state.multi]) }, ['Duplicate']),
        el('button', { id: 'selPasteFx', disabled: !UI.fxClipboard, title: 'Paste the copied FX onto every selected pad', onclick: () => { if (!UI.fxClipboard) return; const ids = new Set(S.state.multi); S.update(s => s.pads.forEach(p => { if (ids.has(p.id)) p.fx = JSON.parse(JSON.stringify(UI.fxClipboard)); }), 'all'); UI.toast('FX pasted onto ' + ids.size + ' pads'); } }, ['Paste FX']),
        el('button', { id: 'selReseed', title: 'New random seeds for every selected pad', onclick: () => { const ids = new Set(S.state.multi); S.update(s => s.pads.forEach(p => { if (ids.has(p.id)) p.seed = Math.floor(Math.random() * 1e6) + 1; }), 'all'); } }, ['🎲 Re-seed']),
        el('button', { id: 'selIntensity', title: 'Set Intensity on every selected pad', onclick: async () => { const v = await UI.prompt('Intensity for ' + S.state.multi.size + ' pads (0–1)', '0.5'); const x = parseFloat(v); if (isNaN(x)) return; const ids = new Set(S.state.multi); S.update(s => s.pads.forEach(p => { if (ids.has(p.id)) p.intensity = DSP.clamp(x, 0, 1); }), 'all'); } }, ['Intensity…']),
        el('button', { onclick: () => S.selectAll() }, ['Select all']),
        el('button', { onclick: () => UI.invertSelection() }, ['Invert']),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint' }, ['Ctrl+click toggles · Shift+click ranges · Ctrl+A all · Delete key removes']),
        el('button', { class: 'ghost', onclick: () => S.clearMulti() }, ['✕ Clear selection']),
      );
    },
    invertSelection() { const m = S.state.multi; S.state.multi = new Set(S.state.pads.map(p => p.id).filter(id => !m.has(id))); S.emit('pads'); },
    updateLoopCount() { const b = $('#stopBtn'); if (!b) return; const n = E.loops.size; b.textContent = n ? '■ Stop (' + n + ' loop' + (n > 1 ? 's' : '') + ')' : '■ Stop'; b.classList.toggle('on', n > 0); },
    /* Move the .selected highlight without rebuilding the board. */
    updateSelection() { document.querySelectorAll('.pad[data-id]').forEach(e => e.classList.toggle('selected', e.getAttribute('data-id') === S.state.selected)); },
    flash(id) { const e = document.querySelector('.pad[data-id="' + id + '"]'); if (!e) return; e.classList.add('hit'); setTimeout(() => e.classList.remove('hit'), 150); },
    async triggerPad(p) { E.ensure(); UI.flash(p.id); try { await E.trigger(p); } catch (e) { console.error(e); UI.toast('Render error: ' + e.message); } },
    padMenu(p, x, y) {
      UI.closeMenu();
      const m = el('div', { class: 'ctx', style: 'left:' + x + 'px;top:' + y + 'px' }, [
        el('div', { onclick: () => { S.duplicatePad(p.id); UI.closeMenu(); } }, ['Duplicate']),
        el('div', { onclick: () => { UI.exportPadWav(p); UI.closeMenu(); } }, ['Export WAV (all variations)']),
        el('div', { onclick: () => { UI.copyPadJson(p); UI.closeMenu(); } }, ['Copy pad JSON']),
        el('div', { class: 'danger', onclick: () => { UI.closeMenu(); if (S.state.multi.has(p.id)) UI.deleteSelected(); else UI.deletePad(p); } }, [S.state.multi.has(p.id) && S.state.multi.size > 1 ? 'Delete ' + S.state.multi.size + ' selected' : 'Delete']),
      ]);
      document.body.appendChild(m); UI._menu = m;
      // keep the menu on-screen if it would overflow the viewport
      const r = m.getBoundingClientRect(); if (r.right > innerWidth) m.style.left = Math.max(0, innerWidth - r.width - 4) + 'px'; if (r.bottom > innerHeight) m.style.top = Math.max(0, innerHeight - r.height - 4) + 'px';
      if (!UI._menuCloser) {
        // Close on any mousedown OUTSIDE the menu. (Mousedown inside must not close it, or the click never lands.)
        UI._menuCloser = e => { if (UI._menu && !UI._menu.contains(e.target)) UI.closeMenu(); };
        document.addEventListener('pointerdown', UI._menuCloser, true);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') UI.closeMenu(); }, true);
        window.addEventListener('blur', () => UI.closeMenu());
      }
    },
    closeMenu() { if (UI._menu) { UI._menu.remove(); UI._menu = null; } },
    /* Deletes are immediate; the toast offers Undo (and Ctrl+Z always works). */
    deletePad(p) { S.deletePad(p.id); UI.toast('Removed "' + p.name + '"', { action: 'Undo', onAction: () => S.undo() }); },
    deleteSelected() {
      const ids = S.targetIds(); if (!ids.length) return;
      const names = ids.map(id => (S.state.pads.find(p => p.id === id) || {}).name).filter(Boolean);
      S.deletePads(ids);
      UI.toast('Removed ' + (ids.length === 1 ? '"' + names[0] + '"' : ids.length + ' pads'), { action: 'Undo', onAction: () => S.undo() });
    },
    async clearBank() {
      if (!S.state.pads.length) return;
      if (await UI.confirm('Remove all ' + S.state.pads.length + ' pads from "' + S.state.bankName + '"? Ctrl+Z restores them.', 'Clear bank')) { S.clearAll(); UI.toast('Bank cleared', { action: 'Undo', onAction: () => S.undo() }); }
    },

    /* ---------------- inspector ---------------- */
    renderInspector() {
      const ins = $('#inspector'); const p = S.selected();
      const scroll = ins.scrollTop; ins.innerHTML = '';
      if (!p) { ins.appendChild(el('div', { class: 'empty' }, ['Select a pad, or add one.'])); return; }
      const upd = (fn, what) => S.update(s => fn(S.selected()), what || 'pads');
      // Header
      ins.appendChild(el('div', { class: 'ins-head' }, [
        el('input', { class: 'icon-in', value: p.icon, title: 'Icon (emoji)', onchange: e => upd(q => q.icon = e.target.value || '🔊') }),
        el('input', { class: 'name-in', value: p.name, onchange: e => upd(q => q.name = e.target.value) }),
        el('input', { class: 'key-in', value: p.key, maxlength: 1, title: 'Trigger key', onchange: e => upd(q => q.key = e.target.value.toLowerCase()) }),
        el('input', { type: 'color', value: p.color, title: 'Color', onchange: e => upd(q => q.color = e.target.value) }),
      ]));
      // Preview
      const prev = el('div', { class: 'preview' }, [
        el('canvas', { id: 'wave', height: 90 }),
        el('div', { class: 'row' }, [
          el('button', { class: 'primary', onclick: () => UI.playPreview() }, ['▶ Play']),
          el('button', { id: 'loopBtn', class: E.isLooping(p.id) ? 'on' : '', title: 'Loop the previewed variation (L)', onclick: () => UI.toggleLoopPreview() }, [E.isLooping(p.id) ? '■ Stop loop' : '∞ Loop']),
          el('button', { onclick: () => UI.previewSeedIdx = (UI.previewSeedIdx + 1) % Math.max(1, p.variations), title: 'Cycle which variation the preview shows' , onmouseup: () => { UI.schedulePreview(); } }, ['Var ▸']),
          el('span', { id: 'prevInfo', class: 'hint' }, ['']),
          el('div', { class: 'spacer' }),
          el('button', { onclick: () => UI.exportPadWav(p, true) }, ['WAV']),
          el('button', { onclick: () => UI.exportPadWav(p, false) }, ['WAV ×' + (p.variations || 1)]),
        ]),
        el('div', { class: 'row meters', id: 'meters' }),
        UI.abRow(p),
      ]);
      ins.appendChild(prev);
      if (UI.previewBuffer) UI.updateMeters(UI.previewBuffer);
      // Variation / humanize
      ins.appendChild(UI.section('Variation & Humanize', [
        UI.rowSlider('Variations', p.variations, 1, 12, 1, v => upd(q => q.variations = Math.round(v)), v => Math.round(v) + ''),
        el('div', { class: 'row' }, [
          el('label', {}, ['Seed']), el('input', { type: 'number', value: p.seed, class: 'num', onchange: e => upd(q => q.seed = +e.target.value || 1) }),
          el('button', { onclick: () => upd(q => q.seed = Math.floor(Math.random() * 1e6) + 1) }, ['🎲 Reseed']),
          el('label', { class: 'chk' }, [el('input', { type: 'checkbox', checked: p.roundRobin, onchange: e => upd(q => q.roundRobin = e.target.checked) }), 'Round robin']),
        ]),
        el('div', { class: 'row' }, [
          el('label', { class: 'chk', title: 'When on, triggering this pad (click or key) starts it looping; triggering again stops it.' }, [el('input', { type: 'checkbox', checked: !!p.loop, onchange: e => { if (!e.target.checked) E.stopLoop(p.id); upd(q => q.loop = e.target.checked, 'all'); } }), 'Loop pad (click/key toggles)']),
        ]),
        el('div', { class: 'row' }, [
          el('label', { class: 'chk', title: 'Crossfade the tail into the head of the rendered sound so it loops without a click. Baked into exports too.' }, [el('input', { type: 'checkbox', id: 'loopFadeChk', checked: p.fx.loopFade > 0, onchange: e => upd(q => q.fx.loopFade = e.target.checked ? 150 : 0, 'select') }), 'Crossfade loop']),
          p.fx.loopFade > 0 ? UI.rowSlider('Fade', p.fx.loopFade, 5, 1000, 5, v => upd(q => q.fx.loopFade = v, 'none'), v => Math.round(v) + ' ms') : el('span', { class: 'hint' }, ['Tip: ambiences also have a "Seamless loop" param; use both for click-free beds.']),
        ]),
        el('div', { class: 'row slider' }, [el('label', { title: 'Macro: nudges force / weight / pressure / density-type params of every layer toward soft (0) or hard (1). 0.5 = as designed.' }, ['Intensity']),
          el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: p.intensity === undefined ? 0.5 : p.intensity, id: 'intensitySl', oninput: e => { const v = +e.target.value; $('#intensityVal').textContent = v.toFixed(2); upd(q => q.intensity = v, 'none'); } }),
          el('span', { class: 'val', id: 'intensityVal' }, [(p.intensity === undefined ? 0.5 : p.intensity).toFixed(2)]),
          el('button', { class: 'mini', id: 'tiersBtn', title: 'Export soft / medium / hard WAV sets (intensity 0.2 / 0.5 / 0.85) for dynamic mixing', onclick: () => UI.exportTiers(p) }, ['Tiers ⤓'])]),
        UI.rowSlider('Pitch jitter', p.humanize.pitch, 0, 12, 0.1, v => upd(q => q.humanize.pitch = v, 'none'), v => v.toFixed(1) + ' st'),
        UI.rowSlider('Gain jitter', p.humanize.gain, 0, 12, 0.1, v => upd(q => q.humanize.gain = v, 'none'), v => v.toFixed(1) + ' dB'),
        UI.rowSlider('Pan jitter', p.humanize.pan, 0, 1, 0.01, v => upd(q => q.humanize.pan = v, 'none'), v => v.toFixed(2)),
        UI.rowSlider('Pan', p.pan, -1, 1, 0.01, v => upd(q => q.pan = v, 'none'), v => v.toFixed(2)),
      ], true));
      // Layers (+ timeline strip: drag a block to change its offset; repeats show as ghosts)
      const layersSec = UI.section('Layers', [], true);
      layersSec.appendChild(UI.timeline(p));
      p.layers.forEach((l, li) => layersSec.appendChild(UI.layerEditor(p, l, li)));
      layersSec.appendChild(el('div', { class: 'row' }, [
        UI.genPicker('addGen', 'impact'),
        el('button', { onclick: () => { const g = $('#addGen').value; upd(q => q.layers.push(S.makeLayer(g))); } }, ['+ Add layer']),
      ]));
      ins.appendChild(layersSec);
      // Macros (user knobs), Body (modal resonator), FX
      ins.appendChild(UI.macroEditor(p));
      ins.appendChild(UI.bodyEditor(p));
      ins.appendChild(UI.fxEditor(p));
      // Danger zone
      ins.appendChild(el('div', { class: 'row foot' }, [
        el('button', { onclick: () => S.duplicatePad(p.id) }, ['Duplicate']),
        el('button', { onclick: () => UI.copyPadJson(p) }, ['Copy JSON']),
        el('div', { class: 'spacer' }),
        el('button', { class: 'danger', onclick: () => UI.deletePad(p) }, ['Delete pad']),
      ]));
      ins.scrollTop = scroll;
      UI.drawWave();
    },
    /* ---------------- A/B compare ----------------
       "Snap A" freezes the pad's current design (params + rendered audio). Keep editing — that's B.
       ▶A / ▶B audition either; ⇄ plays them back to back; "Restore A" puts the snapshot back (undoable). */
    ab: null, // { padId, state: {layers, fx, seed, variations}, buffer, seedIdx, label }
    abRow(p) {
      const ab = UI.ab && UI.ab.padId === p.id ? UI.ab : null;
      const diff = ab ? UI.abDiff(ab.state, p) : 0;
      return el('div', { class: 'row ab' + (ab ? ' has' : ''), id: 'abRow' }, [
        el('span', { class: 'ab-label' }, ['A/B']),
        el('button', { id: 'abSnap', title: 'Snapshot the current design as A', onclick: () => UI.abSnap() }, [ab ? '📌 Re-snap A' : '📌 Snap A']),
        ab ? el('button', { id: 'abPlayA', class: 'ab-a', title: 'Play A (Shift+A)', onclick: () => UI.abPlay('A') }, ['▶ A']) : null,
        ab ? el('button', { id: 'abPlayB', class: 'ab-b', title: 'Play B = current (Shift+B / Space)', onclick: () => UI.abPlay('B') }, ['▶ B']) : null,
        ab ? el('button', { id: 'abFlip', title: 'Play A then B back to back', onclick: () => UI.abFlip() }, ['⇄ A→B']) : null,
        ab ? el('button', { id: 'abRestore', title: 'Restore the A design onto this pad (undoable)', onclick: () => UI.abRestore(), disabled: diff === 0 }, ['↩ Restore A']) : null,
        ab ? el('span', { id: 'abInfo', class: 'hint' }, [diff === 0 ? 'B = A (no changes yet)' : diff + ' change' + (diff > 1 ? 's' : '') + ' since A']) : el('span', { class: 'hint' }, ['Snap A, tweak, then compare']),
        ab ? el('button', { class: 'ghost mini', title: 'Forget A', onclick: () => { UI.ab = null; UI.renderInspector(); } }, ['✕']) : null,
      ]);
    },
    abState(p) { return JSON.parse(JSON.stringify({ layers: p.layers, fx: p.fx, seed: p.seed, variations: p.variations })); },
    abDiff(a, p) {
      const b = UI.abState(p); let n = 0;
      const walk = (x, y) => { if (x === y) return; if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) { n++; return; } const keys = new Set([...Object.keys(x), ...Object.keys(y)]); keys.forEach(k => { if (k === 'id' || k === 'open') return; walk(x[k], y[k]); }); };
      walk(a, b); return n;
    },
    async abSnap() {
      const p = S.selected(); if (!p) return;
      const seeds = E.seedsFor(p); const seed = seeds[UI.previewSeedIdx % seeds.length];
      const buffer = await E.render(p, seed);
      UI.ab = { padId: p.id, state: UI.abState(p), buffer, seedIdx: UI.previewSeedIdx, label: p.name };
      UI.renderInspector(); UI.toast('Snapshot A taken — tweak away, then ▶A / ▶B');
    },
    abPlay(which) {
      const p = S.selected(); if (!p) return; E.ensure();
      if (which === 'A') { if (UI.ab && UI.ab.padId === p.id) E.play(UI.ab.buffer, { pan: p.pan || 0 }); }
      else UI.playPreview();
      const b = $(which === 'A' ? '#abPlayA' : '#abPlayB'); if (b) { b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), 250); }
    },
    abFlip() {
      const p = S.selected(); if (!p || !UI.ab || UI.ab.padId !== p.id || !UI.previewBuffer) return; E.ensure();
      E.play(UI.ab.buffer, { pan: p.pan || 0 }); const gap = Math.min(UI.ab.buffer.duration, 4) + 0.15;
      E.play(UI.previewBuffer, { pan: p.pan || 0, delay: gap });
      const a = $('#abPlayA'), b = $('#abPlayB'); if (a) { a.classList.add('lit'); setTimeout(() => a.classList.remove('lit'), gap * 1000); } if (b) setTimeout(() => { b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), 300); }, gap * 1000);
    },
    abRestore() {
      const p = S.selected(); if (!p || !UI.ab || UI.ab.padId !== p.id) return;
      const st = JSON.parse(JSON.stringify(UI.ab.state));
      S.update(s => { const q = S.selected(); q.layers = st.layers; q.fx = st.fx; q.seed = st.seed; q.variations = st.variations; }, 'select');
      UI.toast('Restored A', { action: 'Undo', onAction: () => S.undo() });
    },
    abUpdateInfo() { const p = S.selected(); const info = $('#abInfo'); if (!p || !info || !UI.ab || UI.ab.padId !== p.id) return; const d = UI.abDiff(UI.ab.state, p); info.textContent = d === 0 ? 'B = A (no changes yet)' : d + ' change' + (d > 1 ? 's' : '') + ' since A'; const r = $('#abRestore'); if (r) r.disabled = d === 0; },
    /* ---------------- timeline strip ---------------- */
    timeline(p) {
      const total = Math.max(0.3, ...p.layers.map(l => E.layerDuration(l))) + 0.1;
      const strip = el('div', { class: 'timeline', id: 'timeline', title: 'Drag a block to change that layer\'s offset. Ghost blocks are repeats.' });
      const ticks = el('div', { class: 'tl-ticks' }); for (let t = 0; t < total; t += total > 4 ? 1 : total > 1.5 ? 0.5 : 0.1) ticks.appendChild(el('span', { class: 'tl-tick', style: 'left:' + (t / total * 100) + '%' }, [t.toFixed(total > 1.5 ? 1 : 2)])); strip.appendChild(ticks);
      p.layers.forEach(l => {
        const g = Foley.generators[l.gen]; const one = (g && g.duration ? g.duration(Object.assign(Foley.defaultParams(l.gen), l.params)) : 1); const rep = Math.max(1, Math.round(l.repeat || 1));
        const row = el('div', { class: 'tl-row' + (l.mute ? ' muted' : '') + (l.solo ? ' solo' : '') });
        for (let k = 0; k < rep; k++) { const start = (l.offset || 0) + k * (l.every || 0.25); if (start > total) break; row.appendChild(el('div', { class: 'tl-block' + (k ? ' ghost' : ''), style: 'left:' + (start / total * 100) + '%;width:' + Math.max(1.2, Math.min(one, total - start) / total * 100) + '%;--c:' + p.color, 'data-layer': l.id }, [k ? '' : (g ? g.icon + ' ' + g.name : l.gen)])); }
        const block = row.firstChild && row.querySelector('.tl-block');
        if (block) {
          block.addEventListener('pointerdown', e => {
            if (e.button !== 0 && e.pointerType === 'mouse') return; e.preventDefault(); try { block.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers have no capture */ }
            const rect = strip.getBoundingClientRect(); const x0 = e.clientX; const off0 = l.offset || 0;
            const move = ev => { const dt = (ev.clientX - x0) / rect.width * total; const v = DSP.clamp(off0 + dt, 0, 3); block.style.left = (v / total * 100) + '%'; block._v = v; };
            const up = ev => { block.removeEventListener('pointermove', move); block.removeEventListener('pointerup', up); block.removeEventListener('pointercancel', up); if (block._v !== undefined && Math.abs(block._v - off0) > 0.001) S.update(s => { const L = S.selected().layers.find(x => x.id === l.id); if (L) L.offset = +block._v.toFixed(3); }, 'select'); };
            block.addEventListener('pointermove', move); block.addEventListener('pointerup', up); block.addEventListener('pointercancel', up);
          });
        }
        strip.appendChild(row);
      });
      return strip;
    },
    /* ---------------- macro knobs ---------------- */
    macroEditor(p) {
      const upd = (fn, what) => S.update(s => fn(S.selected()), what || 'none');
      const macros = p.macros || [];
      const rows = macros.map((m, mi) => {
        const targets = (m.targets || []).map((t, ti) => { const L = p.layers.find(x => x.id === t.layer); const g = L && Foley.generators[L.gen]; const pr = g && g.params.find(x => x.id === t.param); return el('div', { class: 'row macro-target' }, [el('span', { class: 'hint' }, [(g ? g.icon + ' ' : '') + (pr ? pr.name : t.param) + '  ' + (+t.min).toFixed(2) + ' → ' + (+t.max).toFixed(2)]), el('div', { class: 'spacer' }), el('button', { class: 'mini danger', onclick: () => upd(q => q.macros[mi].targets.splice(ti, 1), 'select') }, ['✕'])]); });
        return el('div', { class: 'macro' }, [
          el('div', { class: 'row slider' }, [el('input', { class: 'macro-name', value: m.name, onchange: e => upd(q => q.macros[mi].name = e.target.value) }), el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: m.value === undefined ? 0.5 : m.value, oninput: e => upd(q => S.applyMacro(q, q.macros[mi], +e.target.value)) }), el('span', { class: 'val' }, [(m.value === undefined ? 0.5 : m.value).toFixed(2)]), el('button', { class: 'mini danger', title: 'Remove macro', onclick: () => upd(q => q.macros.splice(mi, 1), 'select') }, ['✕'])]),
          ...targets,
          el('div', { class: 'row' }, [el('button', { class: 'mini', onclick: () => UI.addMacroTarget(p, mi) }, ['+ assign a parameter'])]),
        ]);
      });
      return UI.section('Macros (user knobs)' + (macros.length ? ' · ' + macros.length : ''), rows.concat([el('div', { class: 'row' }, [el('button', { id: 'addMacro', onclick: () => upd(q => q.macros.push({ name: 'Macro ' + (q.macros.length + 1), value: 0.5, targets: [] }), 'select') }, ['+ New macro']), el('span', { class: 'hint' }, ['One knob → several layer params, each with its own range.'])])]), macros.length > 0);
    },
    addMacroTarget(p, mi) {
      const layerSel = UI.select('mtLayer', p.layers.map(l => ({ value: l.id, label: (Foley.generators[l.gen] || {}).name || l.gen })), p.layers[0] && p.layers[0].id);
      const paramSel = el('select', { id: 'mtParam' }); const minIn = el('input', { type: 'number', id: 'mtMin', class: 'num', step: 'any' }), maxIn = el('input', { type: 'number', id: 'mtMax', class: 'num', step: 'any' });
      const fill = () => { const L = p.layers.find(x => x.id === layerSel.value); const g = L && Foley.generators[L.gen]; paramSel.innerHTML = ''; if (!g) return; g.params.filter(x => x.type === 'range').forEach(x => paramSel.appendChild(el('option', { value: x.id }, [x.name]))); const setRange = () => { const pr = g.params.find(x => x.id === paramSel.value); if (pr) { minIn.value = pr.min; maxIn.value = pr.max; } }; paramSel.onchange = setRange; setRange(); };
      layerSel.onchange = fill; fill();
      UI.modal('Assign a parameter to the macro', [el('div', { class: 'row' }, [el('label', {}, ['Layer']), layerSel]), el('div', { class: 'row' }, [el('label', {}, ['Parameter']), paramSel]), el('div', { class: 'row' }, [el('label', {}, ['Range']), minIn, el('span', {}, ['→']), maxIn])], close => [el('div', { class: 'spacer' }), el('button', { onclick: close }, ['Cancel']), el('button', { class: 'primary', id: 'mtOk', onclick: () => { S.update(s => S.selected().macros[mi].targets.push({ layer: layerSel.value, param: paramSel.value, min: +minIn.value, max: +maxIn.value }), 'select'); close(); } }, ['Assign'])]);
    },
    section(title, children, open) {
      const body = el('div', { class: 'sec-body' }, children);
      const sec = el('div', { class: 'sec' + (open ? ' open' : '') }, [el('div', { class: 'sec-head', onclick: () => sec.classList.toggle('open') }, [el('span', { class: 'tri' }, ['▸']), title]), body]);
      sec.appendChild = body.appendChild.bind(body);
      return sec;
    },
    rowSlider(label, value, min, max, step, onchange, format) {
      const out = el('span', { class: 'val' }, [format ? format(value) : String(value)]);
      const inp = el('input', { type: 'range', min, max, step, value, oninput: e => { const v = +e.target.value; out.textContent = format ? format(v) : String(v); onchange(v); }, ondblclick: () => { } });
      return el('div', { class: 'row slider' }, [el('label', { title: label }, [label]), inp, out]);
    },
    genPicker(id, value) {
      const s = el('select', { id });
      const cats = {}; Foley.generatorList.forEach(g => (cats[g.category] = cats[g.category] || []).push(g));
      Object.keys(cats).forEach(c => { const og = el('optgroup', { label: c }); cats[c].forEach(g => og.appendChild(el('option', { value: g.id }, [g.icon + ' ' + g.name]))); s.appendChild(og); });
      s.value = value; return s;
    },
    layerEditor(p, l, li) {
      const g = Foley.generators[l.gen];
      const upd = (fn, what) => S.update(s => { const q = S.selected(); const L = q.layers.find(x => x.id === l.id); if (L) fn(L, q); }, what || 'none');
      const head = el('div', { class: 'layer-head', onclick: e => { if (e.target.tagName === 'DIV' || e.target.tagName === 'SPAN') upd(L => L.open = !L.open, 'select'); } }, [
        el('span', { class: 'tri' }, [l.open ? '▾' : '▸']),
        el('span', { class: 'layer-title' }, [g.icon + ' ' + g.name]),
        el('div', { class: 'spacer' }),
        el('button', { class: 'mini' + (l.mute ? ' on' : ''), title: 'Mute', onclick: e => { e.stopPropagation(); upd(L => L.mute = !L.mute, 'select'); } }, ['M']),
        el('button', { class: 'mini' + (l.solo ? ' solo' : ''), title: 'Solo (hear only soloed layers)', onclick: e => { e.stopPropagation(); upd(L => L.solo = !L.solo, 'select'); } }, ['S']),
        el('button', { class: 'mini', title: 'Randomize all params', onclick: e => { e.stopPropagation(); upd(L => L.params = Foley.randomParams(L.gen, new Foley.PRNG(Math.random() * 1e9), 1), 'select'); } }, ['🎲']),
        el('button', { class: 'mini', title: 'Mutate (small random nudge)', onclick: e => { e.stopPropagation(); upd(L => { const r = Foley.randomParams(L.gen, new Foley.PRNG(Math.random() * 1e9), 1); Foley.generators[L.gen].params.forEach(pr => { if (pr.type === 'range') L.params[pr.id] = DSP.clamp(DSP.lerp(L.params[pr.id], r[pr.id], 0.15), pr.min, pr.max); }); }, 'select'); } }, ['〰']),
        el('button', { class: 'mini', title: 'Reset to defaults', onclick: e => { e.stopPropagation(); upd(L => L.params = Foley.defaultParams(L.gen), 'select'); } }, ['↺']),
        el('button', { class: 'mini', title: 'Move up', onclick: e => { e.stopPropagation(); if (li > 0) upd((L, q) => { q.layers.splice(li, 1); q.layers.splice(li - 1, 0, L); }, 'select'); } }, ['↑']),
        el('button', { class: 'mini', title: 'Duplicate layer', onclick: e => { e.stopPropagation(); upd((L, q) => { const c = JSON.parse(JSON.stringify(L)); c.id = S.newId(); q.layers.splice(li + 1, 0, c); }, 'select'); } }, ['⧉']),
        el('button', { class: 'mini danger', title: 'Remove layer', onclick: async e => { e.stopPropagation(); if (p.layers.length > 1 || await UI.confirm('Remove the only layer? The pad will be silent until you add one.', 'Remove')) upd((L, q) => q.layers.splice(q.layers.indexOf(L), 1), 'select'); } }, ['✕']),
      ]);
      const body = el('div', { class: 'layer-body' });
      if (l.open) {
        body.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Generator']), (() => { const s = UI.genPicker('gen_' + l.id, l.gen); s.onchange = e => upd(L => { L.gen = e.target.value; L.params = Foley.defaultParams(L.gen); }, 'select'); return s; })()]));
        body.appendChild(UI.rowSlider('Gain', l.gain, -36, 12, 0.5, v => upd(L => L.gain = v), v => v.toFixed(1) + ' dB'));
        body.appendChild(UI.rowSlider('Pan', l.pan, -1, 1, 0.01, v => upd(L => L.pan = v), v => v.toFixed(2)));
        body.appendChild(UI.rowSlider('Offset', l.offset, 0, 3, 0.005, v => upd(L => L.offset = v), v => v.toFixed(3) + ' s'));
        body.appendChild(UI.rowSlider('Repeat', l.repeat || 1, 1, 32, 1, v => upd(L => L.repeat = Math.round(v)), v => Math.round(v) + '×'));
        if ((l.repeat || 1) > 1) { body.appendChild(UI.rowSlider('Every', l.every || 0.25, 0.02, 3, 0.005, v => upd(L => L.every = v), v => v.toFixed(3) + ' s')); body.appendChild(UI.rowSlider('Timing jitter', l.jitter || 0, 0, 1, 0.01, v => upd(L => L.jitter = v), v => v.toFixed(2))); }
        body.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Layer FX']), el('span', { class: 'hint' }, ['high-pass / low-pass / drive on this layer only'])]));
        body.appendChild(UI.rowSlider('  High-pass', l.hp || 20, 20, 5000, 1, v => upd(L => L.hp = v), v => Math.round(v) + ' Hz'));
        body.appendChild(UI.rowSlider('  Low-pass', l.lp || 20000, 200, 20000, 1, v => upd(L => L.lp = v), v => Math.round(v) + ' Hz'));
        body.appendChild(UI.rowSlider('  Drive', l.drive || 0, 0, 1, 0.01, v => upd(L => L.drive = v), v => v.toFixed(2)));
        body.appendChild(el('hr'));
        g.params.forEach(pr => {
          const v = l.params[pr.id] === undefined ? pr.default : l.params[pr.id];
          if (pr.type === 'range') body.appendChild(UI.rowSlider(pr.name, v, pr.min, pr.max, pr.step, x => upd(L => L.params[pr.id] = x), x => fmt(x, pr)));
          else if (pr.type === 'select') body.appendChild(el('div', { class: 'row' }, [el('label', {}, [pr.name]), UI.select('', pr.options, v, e => upd(L => L.params[pr.id] = e.target.value, 'select'))]));
          else body.appendChild(el('div', { class: 'row' }, [el('label', {}, [pr.name]), el('label', { class: 'chk' }, [el('input', { type: 'checkbox', checked: !!v, onchange: e => upd(L => L.params[pr.id] = e.target.checked) }), ''])]));
        });
      }
      return el('div', { class: 'layer' + (l.mute ? ' muted' : '') }, [head, body]);
    },
    /* "Body": optional modal resonator bank (physical body the sound is heard through). 'none' = bypass. */
    bodyEditor(p) {
      const upd = (fn, what) => S.update(s => fn(S.selected().fx), what || 'none');
      const fx = p.fx; const on = fx.body && fx.body !== 'none';
      const bodies = Object.keys(E.BODIES).map(k => ({ value: k, label: k === 'none' ? 'none (off)' : k.replace(/-/g, ' ') }));
      const sec = UI.section('Body / Resonator' + (on ? ' · ' + fx.body : ' · off'), [
        el('div', { class: 'row' }, [el('label', {}, ['Body']), UI.select('bodySel', bodies, fx.body || 'none', e => upd(f => f.body = e.target.value, 'select'))]),
        UI.rowSlider('Amount', fx.bodyAmount, 0, 1, 0.01, v => upd(f => f.bodyAmount = v), v => Math.round(v * 100) + '%'),
        UI.rowSlider('Size', fx.bodySize, 0.25, 4, 0.01, v => upd(f => f.bodySize = v), v => v.toFixed(2) + '×'),
        UI.rowSlider('Damping', fx.bodyDamp, 0, 1, 0.01, v => upd(f => f.bodyDamp = v), v => v.toFixed(2)),
        el('div', { class: 'hint' }, ['A bank of resonant modes (wood, metal, stone, glass, bell…) the sound rings through. Off = unchanged. Size lowers/raises the modes; damping shortens their ring.']),
      ], on);
      return sec;
    },
    fxEditor(p) {
      const upd = (fn) => S.update(s => fn(S.selected().fx), 'none');
      const fx = p.fx;
      const sec = UI.section('Post FX', [
        UI.rowSlider('Pitch', fx.pitch, -24, 24, 0.5, v => upd(f => f.pitch = v), v => v.toFixed(1) + ' st'),
        UI.rowSlider('Gain', fx.gain, -24, 24, 0.5, v => upd(f => f.gain = v), v => v.toFixed(1) + ' dB'),
        UI.rowSlider('High-pass', fx.hp, 20, 5000, 1, v => upd(f => f.hp = v), v => Math.round(v) + ' Hz'),
        UI.rowSlider('Low-pass', fx.lp, 200, 20000, 1, v => upd(f => f.lp = v), v => Math.round(v) + ' Hz'),
        UI.rowSlider('Drive', fx.drive, 0, 1, 0.01, v => upd(f => f.drive = v), v => v.toFixed(2)),
        el('div', { class: 'row' }, [el('label', {}, ['Drive type']), UI.select('', ['soft', 'hard', 'fold'].map(x => ({ value: x, label: x })), fx.driveType, e => upd(f => f.driveType = e.target.value))]),
        UI.rowSlider('Bit depth', fx.bits, 2, 16, 1, v => upd(f => f.bits = Math.round(v)), v => Math.round(v) + ' bit'),
        UI.rowSlider('Downsample', fx.downsample, 1, 32, 1, v => upd(f => f.downsample = Math.round(v)), v => '÷' + Math.round(v)),
        UI.rowSlider('Distance', fx.distance || 0, 0, 1, 0.01, v => upd(f => f.distance = v), v => v.toFixed(2)),
        UI.rowSlider('Rattle', fx.rattle || 0, 0, 1, 0.01, v => upd(f => f.rattle = v), v => v.toFixed(2)),
        (fx.rattle > 0) ? UI.rowSlider('Rattle pitch', fx.rattleHz || 2200, 300, 8000, 10, v => upd(f => f.rattleHz = v), v => Math.round(v) + ' Hz') : null,
        (fx.rattle > 0) ? UI.rowSlider('Rattle threshold', fx.rattleThreshold === undefined ? 0.35 : fx.rattleThreshold, 0.05, 0.95, 0.01, v => upd(f => f.rattleThreshold = v), v => v.toFixed(2)) : null,
        UI.rowSlider('Transient attack', fx.transAttack || 0, -1, 1, 0.01, v => upd(f => f.transAttack = v), v => (v > 0 ? '+' : '') + v.toFixed(2)),
        UI.rowSlider('Transient sustain', fx.transSustain || 0, -1, 1, 0.01, v => upd(f => f.transSustain = v), v => (v > 0 ? '+' : '') + v.toFixed(2)),
        UI.rowSlider('Space (early refl.)', fx.space, 0, 1, 0.01, v => upd(f => f.space = v), v => v.toFixed(2)),
        UI.rowSlider('Space size', fx.spaceSize, 0, 1, 0.01, v => upd(f => f.spaceSize = v), v => v.toFixed(2)),
        el('div', { class: 'row' }, [el('label', {}, ['Room']), UI.select('reverbTypeSel', E.REVERB_TYPES.map(x => ({ value: x, label: x })), fx.reverbType || 'hall', e => upd(f => f.reverbType = e.target.value))]),
        UI.rowSlider('Reverb', fx.reverb, 0, 1, 0.01, v => upd(f => f.reverb = v), v => v.toFixed(2)),
        UI.rowSlider('Reverb size', fx.reverbSize, 0, 1, 0.01, v => upd(f => f.reverbSize = v), v => v.toFixed(2)),
        UI.rowSlider('Reverb damp', fx.reverbDamp, 0, 1, 0.01, v => upd(f => f.reverbDamp = v), v => v.toFixed(2)),
        UI.rowSlider('Delay', fx.delay, 0, 1, 0.01, v => upd(f => f.delay = v), v => v.toFixed(2)),
        UI.rowSlider('Delay time', fx.delayTime, 0.02, 1, 0.005, v => upd(f => f.delayTime = v), v => v.toFixed(3) + ' s'),
        UI.rowSlider('Delay feedback', fx.delayFeedback, 0, 0.95, 0.01, v => upd(f => f.delayFeedback = v), v => v.toFixed(2)),
        UI.rowSlider('Fade out', fx.fadeOut, 0, 0.5, 0.001, v => upd(f => f.fadeOut = v), v => (v * 1000).toFixed(0) + ' ms'),
        el('div', { class: 'row' }, [el('label', {}, ['Normalize']), UI.select('normModeSel', [{ value: 'loudness', label: 'loudness (LUFS-style, even levels)' }, { value: 'peak', label: 'peak (legacy)' }, { value: 'off', label: 'off' }], fx.normalize === false ? 'off' : (fx.normMode || 'peak'), e => upd(f => { if (e.target.value === 'off') f.normalize = false; else { f.normalize = true; f.normMode = e.target.value; } }, 'select'))]),
        (fx.normalize !== false && (fx.normMode || 'peak') === 'loudness') ? UI.rowSlider('Loudness target', fx.loudTarget === undefined ? -18 : fx.loudTarget, -30, -8, 0.5, v => upd(f => f.loudTarget = v), v => v.toFixed(1) + ' LU') : null,
        el('div', { class: 'row' }, [
          el('label', { class: 'chk' }, [el('input', { type: 'checkbox', checked: fx.reverse, onchange: e => upd(f => f.reverse = e.target.checked) }), 'Reverse']),
          el('div', { class: 'spacer' }),
          el('button', { id: 'copyFx', title: 'Copy this pad\'s FX (incl. Body) to paste onto other pads', onclick: () => { UI.fxClipboard = JSON.parse(JSON.stringify(S.selected().fx)); UI.toast('FX copied'); } }, ['Copy FX']),
          el('button', { id: 'pasteFx', disabled: !UI.fxClipboard, title: 'Paste copied FX onto this pad', onclick: () => { if (UI.fxClipboard) S.update(s => S.selected().fx = JSON.parse(JSON.stringify(UI.fxClipboard)), 'select'); } }, ['Paste FX']),
          el('button', { onclick: () => S.update(s => S.selected().fx = E.defaultFx(), 'select') }, ['Reset FX']),
        ]),
      ], false);
      return sec;
    },

    /* ---------------- preview render ---------------- */
    schedulePreview() {
      clearTimeout(UI._prevT);
      UI._prevT = setTimeout(async () => {
        const p = S.selected(); if (!p) return;
        const token = ++UI.renderToken;
        const seeds = E.seedsFor(p); const seed = seeds[UI.previewSeedIdx % seeds.length];
        const info = $('#prevInfo'); if (info) info.textContent = 'rendering…';
        const t = performance.now();
        try {
          const buf = await E.render(p, seed);
          if (token !== UI.renderToken) return;
          const changed = UI.previewBuffer !== buf;
          UI.previewBuffer = buf; UI.drawWave(); UI.abUpdateInfo();
          // live update: if this pad is looping, swap in the freshly rendered buffer
          if (changed && E.isLooping(p.id)) E.startLoop(p, buf, { pan: p.pan || 0 });
          if (info) info.textContent = 'var ' + ((UI.previewSeedIdx % seeds.length) + 1) + '/' + seeds.length + ' · ' + buf.duration.toFixed(2) + 's · ' + (performance.now() - t).toFixed(0) + 'ms';
          UI.updateMeters(buf);
          E.renderAll(p); // warm the rest in background
        } catch (e) { console.error(e); if (info) info.textContent = 'error: ' + e.message; }
      }, 80);
    },
    /* Brightness (spectral tilt: energy >5 kHz vs 300–2000 Hz body band, Goertzel on a few frames) and loudness meters. */
    brightness(b) {
      const d = b.getChannelData(0); const sr = b.sampleRate; const N = 2048; if (d.length < N) return 0;
      const frames = 6; const hop = Math.floor((d.length - N) / frames); let lo = 0, hi = 0;
      const bins = []; for (let f = 350; f <= 2000; f += 150) bins.push([f, 0]); for (let f = 5200; f <= 11000; f += 400) bins.push([f, 1]);
      for (let fi = 0; fi < frames; fi++) { const s0 = fi * hop; for (const [fr, isHi] of bins) { const w = 2 * Math.PI * fr / sr; const c = 2 * Math.cos(w); let q0 = 0, q1 = 0, q2 = 0; for (let n = 0; n < N; n++) { const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N); q0 = c * q1 - q2 + d[s0 + n] * win; q2 = q1; q1 = q0; } const pw = q1 * q1 + q2 * q2 - c * q1 * q2; if (isHi) hi += pw; else lo += pw; } }
      return hi / Math.max(1e-9, lo);
    },
    updateMeters(buf) {
      const m = $('#meters'); if (!m || !buf) return;
      const br = UI.brightness(buf); const L = E.loudness(buf).lufs;
      const cls = br < 0.05 ? 'dark' : br < 0.4 ? 'natural' : br < 2 ? 'bright' : 'harsh';
      const pct = DSP.clamp((Math.log10(br + 1e-4) + 4) / 6, 0, 1) * 100;
      m.innerHTML = ''; m.append(
        el('span', { class: 'meter-label' }, ['Brightness']), el('span', { class: 'meter-bar', title: '>5 kHz energy ÷ 300–2000 Hz body band = ' + br.toFixed(3) + ' (' + cls + '). Very high = filtered-noise / "static" character.' }, [el('span', { class: 'meter-fill ' + cls, style: 'width:' + pct.toFixed(0) + '%' })]), el('span', { class: 'meter-val ' + cls, id: 'brightVal' }, [cls + ' ' + br.toFixed(3)]),
        el('span', { class: 'meter-label' }, ['Loudness']), el('span', { class: 'meter-val', id: 'loudVal', title: 'K-weighted, gated (LUFS-style)' }, [L.toFixed(1) + ' LU']));
    },
    playPreview() { E.ensure(); if (UI.previewBuffer) E.play(UI.previewBuffer, { pan: S.selected() ? S.selected().pan : 0 }); },
    /* Export soft / medium / hard sets for dynamic mixing (intensity 0.2 / 0.5 / 0.85 × all variations). */
    async exportTiers(p) {
      const tiers = [['soft', 0.2], ['med', 0.5], ['hard', 0.85]]; let n = 0;
      try {
        for (const [name, inten] of tiers) { const q = Object.assign({}, p, { intensity: inten }); const seeds = E.seedsFor(q); for (let i = 0; i < seeds.length; i++) { const b = await E.render(q, seeds[i]); E.download(E.encodeWav(b), UI.safeName(p.name) + '_' + name + (seeds.length > 1 ? '_' + String(i + 1).padStart(2, '0') : '') + '.wav'); n++; await new Promise(r => setTimeout(r, 120)); } }
        UI.toast('Exported ' + n + ' tier files (soft / med / hard)');
      } catch (e) { UI.toast('Tier export failed: ' + e.message); }
    },
    toggleLoopPreview() { const p = S.selected(); if (!p) return; E.ensure(); if (E.isLooping(p.id)) E.stopLoop(p.id); else if (UI.previewBuffer) E.startLoop(p, UI.previewBuffer, { pan: p.pan || 0 }); },
    drawWave() {
      const c = $('#wave'); if (!c) return;
      const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = 90 * devicePixelRatio;
      const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(0, 0, W, H);
      const b = UI.previewBuffer; if (!b) return;
      const p = S.selected(); const color = p ? p.color : '#5b8fe0';
      const drawBuf = (buf, style, span) => {
        const d0 = buf.getChannelData(0), d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0;
        const px = Math.max(1, Math.round(W * Math.min(1, buf.duration / span))); const step = Math.max(1, Math.floor(buf.length / px));
        g.strokeStyle = style; g.lineWidth = 1; g.beginPath();
        for (let x = 0; x < px; x++) {
          let mn = 1, mx = -1; const i0 = Math.floor(x / px * buf.length);
          for (let i = i0; i < i0 + step && i < buf.length; i++) { const v = (d0[i] + d1[i]) * 0.5; if (v < mn) mn = v; if (v > mx) mx = v; }
          g.moveTo(x, H / 2 - mx * H / 2); g.lineTo(x, H / 2 - mn * H / 2 + 1);
        }
        g.stroke();
      };
      const ab = UI.ab && p && UI.ab.padId === p.id ? UI.ab.buffer : null;
      const span = Math.max(b.duration, ab ? ab.duration : 0);
      if (ab) drawBuf(ab, 'rgba(255,255,255,0.22)', span); // A ghosted behind B
      drawBuf(b, color, span);
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.font = (10 * devicePixelRatio) + 'px system-ui'; g.fillText(b.duration.toFixed(3) + ' s' + (ab ? '  ·  A: ' + ab.duration.toFixed(3) + ' s (grey)' : ''), 4 * devicePixelRatio, 12 * devicePixelRatio);
    },
    meterLoop() {
      const c = $('#meter'); const g = c.getContext('2d'); const data = new Float32Array(1024);
      const tick = () => {
        requestAnimationFrame(tick);
        g.clearRect(0, 0, c.width, c.height);
        if (!E.analyser) return;
        E.analyser.getFloatTimeDomainData(data); let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        const db = 20 * Math.log10(peak + 1e-6); const w = DSP.clamp((db + 48) / 48, 0, 1) * c.width;
        g.fillStyle = db > -1 ? '#e05d5d' : db > -8 ? '#e0a24a' : '#6fcf6f'; g.fillRect(0, 0, w, c.height);
      };
      tick();
    },

    /* ---------------- keyboard ---------------- */
    bindKeys() {
      const held = new Set();
      document.addEventListener('keydown', e => {
        const tag = (e.target.tagName || '').toLowerCase();
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); UI.saveBank(); return; } // Ctrl+S saves even from inside inputs
        if (tag === 'input' || tag === 'select' || tag === 'textarea') { if (e.key === 'Escape') e.target.blur(); return; }
        if (e.ctrlKey || e.metaKey) { if (e.key === 'z') { e.preventDefault(); e.shiftKey ? S.redo() : S.undo(); } else if (e.key === 'y') { e.preventDefault(); S.redo(); } else if (e.key === 'a') { e.preventDefault(); S.selectAll(); } else if (e.key === 's') { e.preventDefault(); UI.saveBank(); } return; }
        if (e.key === 'Escape') { if (S.state.multi.size) S.clearMulti(); E.stopAll(); return; }
        if (e.key === ' ') { e.preventDefault(); UI.playPreview(); return; }
        if (e.shiftKey && (e.key === 'A' || e.key === 'B')) { e.preventDefault(); UI.abPlay(e.key); return; }
        if (e.key === 'L' || (e.key === 'l' && !S.padByKey('l'))) { UI.toggleLoopPreview(); return; }
        if ((e.key === 'Delete' || e.key === 'Backspace') && S.targetIds().length) { e.preventDefault(); UI.deleteSelected(); return; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const i = S.state.pads.findIndex(p => p.id === S.state.selected); const n = S.state.pads[(i + (e.key === 'ArrowRight' ? 1 : -1) + S.state.pads.length) % S.state.pads.length]; if (n) S.select(n.id); return; }
        if (e.repeat || held.has(e.key)) return;
        const p = S.padByKey(e.key); if (p) { held.add(e.key); UI.triggerPad(p); if (e.shiftKey) S.select(p.id); }
      });
      document.addEventListener('keyup', e => held.delete(e.key));
    },

    /* ---------------- dialogs ---------------- */
    modal(title, body, actions) {
      const m = $('#modal'); m.innerHTML = ''; m.classList.remove('hidden');
      const close = () => m.classList.add('hidden');
      m.appendChild(el('div', { class: 'modal-box' }, [el('div', { class: 'modal-head' }, [el('span', {}, [title]), el('button', { class: 'ghost', onclick: close }, ['✕'])]), el('div', { class: 'modal-body' }, body), el('div', { class: 'modal-foot' }, actions ? actions(close) : [])]));
      m.onclick = e => { if (e.target === m) close(); };
      return close;
    },
    /* In-app confirm (native confirm() is blocked in embedded browsers/webviews). Resolves true/false. */
    confirm(msg, okLabel) {
      return new Promise(resolve => {
        let done = false; let closeModal = null;
        const finish = (v) => { if (done) return; done = true; document.removeEventListener('keydown', key, true); if (closeModal) closeModal(); resolve(v); };
        const key = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
        closeModal = UI.modal('Confirm', [el('p', { class: 'confirm-msg' }, [msg])], () => [
          el('div', { class: 'spacer' }),
          el('button', { id: 'confirmCancel', type: 'button', onclick: () => finish(false) }, ['Cancel']),
          el('button', { class: 'primary', id: 'confirmOk', type: 'button', onclick: () => finish(true) }, [okLabel || 'OK']),
        ]);
        const m = $('#modal'); m.onclick = e => { if (e.target === m) finish(false); };
        document.addEventListener('keydown', key, true);
        setTimeout(() => { const b = $('#confirmOk'); if (b) b.focus(); }, 0);
      });
    },
    /* Generator presets: named starting points shown under each generator card. */
    GEN_PRESETS: {
      impact: [['Cardboard box', { material: 'cardboard', size: 0.5, force: 0.6 }], ['Anvil', { material: 'metal', size: 0.9, force: 0.9, tone: 0.8 }], ['Crate', { material: 'wood', size: 0.7, force: 0.7 }], ['Stone block', { material: 'stone', size: 0.6, force: 0.8 }], ['Bottle', { material: 'glass', size: 0.8, force: 0.5, tone: 0.7 }]],
      footstep: [['Gravel walk', { surface: 'gravel', gait: 'walk', steps: 4 }], ['Snow trudge', { surface: 'snow', gait: 'walk', weight: 0.8, tempo: 90 }], ['Boots on wood', { surface: 'wood', hardness: 0.8 }], ['Sneak on tile', { surface: 'tile', gait: 'sneak' }]],
      water: [['Big splash', { type: 'splash', size: 0.9 }], ['Drip', { type: 'drip', length: 0.4 }], ['Stream', { type: 'stream', length: 4 }], ['Boiling', { type: 'bubbles', length: 2, detail: 0.8 }]],
      laugh: [['Goblin', { type: 'goblin-chuckle', size: 0.75 }], ['Witch', { type: 'cackle', pitch: 1.1 }], ['Villain', { type: 'evil-laugh', size: 1.4 }]],
      creature: [['Wolf growl', { type: 'growl', count: 1, length: 0.3 }], ['Dragon roar', { type: 'roar', count: 1, length: 0.4, pitch: 0.7 }], ['Owl', { type: 'owl', count: 2, rate: 1.5, length: 0.12 }]],
      scrape: [['Brick on pavement', { pairing: 'brick/pavement', motion: 'push' }], ['Boulder drag', { pairing: 'boulder/rock', weight: 1, motion: 'stutter' }]],
      chain: [['Rattle', { type: 'rattle' }], ['Drawbridge', { type: 'drawbridge-lower', length: 3.5, wood: 0.7 }]],
      engine: [['Car idle', { type: 'car', rpm: 0.2 }], ['Motorcycle rev', { type: 'motorcycle', rpm: 0.5, rev: 0.6, rough: 0.6 }]],
      rain: [['Light on leaves', { surface: 'leaves', density: 0.3 }], ['Storm on roof', { surface: 'roof', density: 0.9, drops: 0.7 }]],
      wind: [['Breeze', { strength: 0.3, foliage: 0.4 }], ['Howling gale', { strength: 0.9, gusts: 0.7, howl: 0.7 }]],
      granular: [['Gravel cloud', { source: 'white', density: 120, grain: 12, filter: 'bandpass', cutoff: 3200 }], ['Glass shimmer', { source: 'ring', pitch: 2200, density: 40, grain: 120 }]],
    },
    addPadDialog() {
      const cats = {}; Foley.generatorList.forEach(g => (cats[g.category] = cats[g.category] || []).push(g));
      const body = [];
      Object.keys(cats).forEach(c => {
        body.push(el('h4', {}, [c]));
        body.push(el('div', { class: 'gen-grid' }, cats[c].map(g => el('div', { class: 'gen-card', onclick: () => { close(); S.addPad({ gen: g.id }); } }, [el('div', { class: 'gi' }, [g.icon]), el('div', {}, [g.name]), el('div', { class: 'hint' }, [g.params.length + ' params']),
          UI.GEN_PRESETS[g.id] ? el('div', { class: 'gen-presets' }, UI.GEN_PRESETS[g.id].map(([nm, pr]) => el('span', { class: 'gen-preset', title: 'Start from: ' + nm, onclick: e => { e.stopPropagation(); close(); S.addPad({ gen: g.id, name: nm, params: pr }); } }, [nm]))) : null]))));
      });
      const close = UI.modal('New pad — choose a generator (or a preset)', body);
    },
    help() {
      UI.modal('Foley Fun — help', [el('div', { class: 'help', html: `
        <p><b>Pads</b> are sounds. Each pad stacks one or more <b>layers</b> (procedural generators) and runs the mix through a <b>Post FX</b> chain. Everything is synthesized from parameters + a seed, so nothing is sampled and every pad is fully editable.</p>
        <p><b>Variations</b>: each pad pre-renders N seeded variants; triggering picks one at random (or round-robin) and applies pitch/gain/pan jitter, so repeated footsteps and hits never sound identical.</p>
        <ul>
          <li><b>Click / key</b> a pad to trigger it. Shift+key selects without changing selection focus rules.</li>
          <li><b>Space</b> previews the selected pad's current variation. <b>Esc</b> stops all voices and loops.</li>
          <li><b>A/B compare</b>: press <b>Snap A</b> to freeze the current design, keep tweaking (that's B), then <b>▶A</b> / <b>▶B</b> (Shift+A / Shift+B) or <b>⇄ A→B</b> to hear them back to back. A is ghosted in grey behind the waveform; the counter shows how many parameters changed. <b>Restore A</b> puts the snapshot back (undoable).</li>
          <li><b>Looping</b>: tick "Loop pad" in the inspector — then clicking the pad (or its key) starts it looping and clicking again stops it. Looping pads pulse on the board. The <b>∞ Loop</b> preview button (or <b>Shift+L</b>) loops the previewed variation of any pad; edits to a looping pad are heard live. Several pads can loop at once (ambient beds); "Stop" shows how many are running.</li>
          <li><b>Drag</b> pads to reorder. Right-click for options. <b>Ctrl+Z / Ctrl+Y</b> undo/redo.</li>
          <li><b>Removing pads</b>: hover a pad and hit its <b>✕</b>, press <b>Delete</b>/<b>Backspace</b>, or use the ⋯ menu — removal is immediate with an <b>Undo</b> button in the toast. <b>Ctrl+click</b> toggles pads into a multi-selection, <b>Shift+click</b> selects a range, <b>Ctrl+A</b> selects all; a bar appears to delete or duplicate them all at once. <b>Clear bank</b> in the toolbar wipes everything (undoable).</li>
          <li><b>WAV</b> exports the previewed variation; <b>WAV ×N</b> exports every variation. Export All WAV renders the entire bank.</li>
          <li><b>Save (Ctrl+S)</b> keeps the bank in this browser's library (IndexedDB); <b>Banks…</b> lists, loads, renames, deletes and exports saved banks. The working board also auto-saves so a reload never loses it. <b>Export/Import Bank</b> writes/reads a JSON file you can keep anywhere.</li>
          <li><b>Export format</b> (toolbar): WAV 16/24-bit or <b>OGG Vorbis</b> (encoder loads on first use, ~15× smaller than WAV, loop pads carry LOOPSTART/LOOPLENGTH tags), at 48 or 44.1 kHz, stereo or mono.</li>
          <li><b>Touch</b>: tap a pad to trigger, long-press for its menu; sliders and buttons work with touch.</li>
          <li>Layer header buttons: M mute · 🎲 randomize · 〰 mutate slightly · ↺ reset · ⧉ duplicate.</li>
          <li>Loops: Rain/Wind/Fire/Engine/Drone have a "Seamless loop" toggle so the exported WAV loops cleanly in-engine. <b>Crossfade loop</b> (next to Loop pad) additionally overlaps the tail into the head of <i>any</i> pad's render so it loops click-free — it's baked into the exported WAV.</li>
          <li><b>Intensity</b> (Variation section): a macro that pushes force/weight/pressure/density-type params of every layer toward soft (0) or hard (1); 0.5 is the pad as designed. <b>Tiers ⤓</b> exports soft/medium/hard WAV sets for dynamic mixing.</li>
          <li><b>Meters</b> under the waveform: <b>Brightness</b> is energy above 5 kHz relative to the 300–2000 Hz body band — "harsh" usually means filtered-noise character; <b>Loudness</b> is a K-weighted LUFS-style reading. New pads normalize to a loudness target (−18 LU) rather than peak, so clicks and drones sit evenly.</li>
          <li><b>Distance</b> (Post FX): one knob for air absorption, level, extra early reflections and a narrower image. <b>Room</b> picks the reverb character (hall, small room, stairwell, cave, outdoor, plate). <b>Transient attack/sustain</b> shape onsets and tails.</li>
          <li><b>Body / Resonator</b>: an optional bank of physical resonant modes (wood plank, hollow metal, stone slab, glass, bell, pipe…) the sound rings through. "none" bypasses it completely; Amount blends dry/wet, Size shifts the modes, Damping shortens the ring.</li>
        </ul>
        <p>Files are 48 kHz stereo 16-bit WAV. Drop them straight into Unity / Unreal / Godot.</p>` })]);
    },
    toast(msg, opts) {
      opts = opts || {};
      if (UI._toast) { UI._toast.remove(); UI._toast = null; }
      const t = el('div', { class: 'toast' }, [el('span', {}, [msg])]);
      const hide = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); if (UI._toast === t) UI._toast = null; };
      if (opts.action) t.appendChild(el('button', { class: 'toast-action', onclick: () => { hide(); opts.onAction && opts.onAction(); } }, [opts.action]));
      document.body.appendChild(t); UI._toast = t; setTimeout(() => t.classList.add('show'), 10);
      setTimeout(hide, opts.action ? 6000 : 2600);
    },

    /* ---------------- export/import ---------------- */
    safeName(s) { return (s || 'sound').replace(/[^a-z0-9_\-]+/gi, '_').replace(/^_+|_+$/g, '') || 'sound'; },
    /* Export preferences (format / rate / channels), persisted in localStorage. */
    prefs() { try { return Object.assign({ format: 'wav16', rate: 48000, channels: 'stereo', oggQuality: 0.4 }, JSON.parse(localStorage.getItem('foley.prefs') || '{}')); } catch (e) { return { format: 'wav16', rate: 48000, channels: 'stereo', oggQuality: 0.4 }; } },
    setPref(k, v) { const p = UI.prefs(); p[k] = v; try { localStorage.setItem('foley.prefs', JSON.stringify(p)); } catch (e) { } },
    /* Encode a rendered buffer per the export prefs. Returns { blob, ext }. tags go into OGG comments (LOOPSTART/LOOPLENGTH for loop pads). */
    async encodeForExport(buffer, pad) {
      const pr = UI.prefs();
      const conv = await Foley.Ogg.convert(buffer, pr.rate, pr.channels === 'mono' ? 1 : buffer.numberOfChannels);
      if (pr.format === 'ogg') {
        const tags = { TITLE: pad ? pad.name : 'sound' }; if (pad && pad.loop) { tags.LOOPSTART = '0'; tags.LOOPLENGTH = String(conv.length); }
        if (!window.FoleyVorbis) UI.toast('Loading OGG encoder…');
        return { blob: await Foley.Ogg.encode(conv, pr.oggQuality, tags), ext: '.ogg' };
      }
      return { blob: E.encodeWav(conv, pr.format === 'wav24' ? 24 : 16), ext: '.wav' };
    },
    async exportPadWav(p, onlyPreview) {
      try {
        if (onlyPreview && UI.previewBuffer && p.id === S.state.selected) { const r = await UI.encodeForExport(UI.previewBuffer, p); E.download(r.blob, UI.safeName(p.name) + r.ext); UI.toast('Exported ' + UI.safeName(p.name) + r.ext); return; }
        const seeds = E.seedsFor(p); let ext = '';
        for (let i = 0; i < seeds.length; i++) { const b = await E.render(p, seeds[i]); const r = await UI.encodeForExport(b, p); ext = r.ext; E.download(r.blob, UI.safeName(p.name) + (seeds.length > 1 ? '_' + String(i + 1).padStart(2, '0') : '') + r.ext); await new Promise(r => setTimeout(r, 120)); }
        UI.toast('Exported ' + seeds.length + ' ' + ext.slice(1).toUpperCase() + ' file(s)');
      } catch (e) { UI.toast('Export failed: ' + e.message); }
    },
    async exportAllWav() {
      const pads = S.state.pads; if (!pads.length) return;
      const total = pads.reduce((n, p) => n + E.seedsFor(p).length, 0); const pr = UI.prefs();
      if (!await UI.confirm('Render and download ' + total + ' ' + (pr.format === 'ogg' ? 'OGG' : 'WAV') + ' files (' + (pr.rate / 1000) + ' kHz ' + pr.channels + ')? Your browser may ask to allow multiple downloads.', 'Export')) return;
      let n = 0;
      try { for (const p of pads) { const seeds = E.seedsFor(p); for (let i = 0; i < seeds.length; i++) { const b = await E.render(p, seeds[i]); const r = await UI.encodeForExport(b, p); E.download(r.blob, UI.safeName(S.state.bankName) + '_' + UI.safeName(p.name) + (seeds.length > 1 ? '_' + String(i + 1).padStart(2, '0') : '') + r.ext); n++; await new Promise(r => setTimeout(r, 150)); } } UI.toast('Exported ' + n + ' files'); }
      catch (e) { UI.toast('Export failed after ' + n + ' files: ' + e.message); }
    },

    /* ---------------- bank library (IndexedDB) ---------------- */
    _savedSnapshot: null,
    bankSnapshot() { return JSON.stringify({ bankName: S.state.bankName, pads: S.state.pads }); },
    updateDirty() { const d = $('#dirty'); if (!d) return; const dirty = UI._savedSnapshot !== null && UI._savedSnapshot !== UI.bankSnapshot(); d.textContent = dirty ? '● unsaved' : (UI._savedSnapshot ? '✓ saved' : ''); d.classList.toggle('on', dirty); },
    async saveBank(asName) {
      let name = asName || S.state.bankName;
      if (!name || /^untitled bank$/i.test(name) || asName === '') { name = await UI.prompt('Save bank as', S.state.bankName === 'Untitled Bank' ? '' : S.state.bankName); if (!name) return; }
      if (name !== S.state.bankName) S.update(s => s.bankName = name, 'none');
      try { const data = JSON.parse(S.exportBank()); await Foley.Library.save(name, data); UI._savedSnapshot = UI.bankSnapshot(); UI.updateDirty(); Foley.Library.persist(); UI.toast('Saved "' + name + '" in this browser (' + Foley.Library.backend + ')'); }
      catch (e) { UI.toast('Save failed: ' + e.message); }
    },
    async banksDialog() {
      const rows = await Foley.Library.list(); const usage = await Foley.Library.usage();
      const body = [];
      if (!rows.length) body.push(el('p', { class: 'hint' }, ['No saved banks yet. Press Save (Ctrl+S) to keep the current board in this browser.']));
      const table = el('div', { class: 'bank-list' });
      rows.forEach(r => table.appendChild(el('div', { class: 'bank-row' + (r.name === S.state.bankName ? ' current' : '') }, [
        el('div', { class: 'bank-info' }, [el('div', { class: 'bank-title' }, [r.name]), el('div', { class: 'hint' }, [r.pads + ' pads · ' + new Date(r.updated).toLocaleString()])]),
        el('button', { class: 'primary', onclick: async () => { if (UI._savedSnapshot !== UI.bankSnapshot() && S.state.pads.length && !await UI.confirm('Load "' + r.name + '"? Unsaved changes to the current board will be replaced (Ctrl+Z restores).', 'Load')) return; try { const data = await Foley.Library.load(r.name); S.importBank(data, false); UI._savedSnapshot = UI.bankSnapshot(); UI.updateDirty(); close(); UI.toast('Loaded "' + r.name + '"'); } catch (e) { UI.toast('Load failed: ' + e.message); } } }, ['Load']),
        el('button', { onclick: async () => { const data = await Foley.Library.load(r.name); E.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), UI.safeName(r.name) + '.foley.json'); } }, ['Export']),
        el('button', { onclick: async () => { const nn = await UI.prompt('Rename bank', r.name); if (!nn || nn === r.name) return; await Foley.Library.rename(r.name, nn); if (S.state.bankName === r.name) S.update(s => s.bankName = nn, 'none'); close(); UI.banksDialog(); } }, ['Rename']),
        el('button', { class: 'danger', onclick: async () => { if (!await UI.confirm('Delete saved bank "' + r.name + '" from this browser?', 'Delete')) return; await Foley.Library.remove(r.name); close(); UI.banksDialog(); } }, ['Delete']),
      ])));
      body.push(table);
      body.push(el('p', { class: 'hint' }, ['Stored in this browser\'s ' + (Foley.Library.backend === 'idb' ? 'IndexedDB' : 'localStorage') + (usage ? ' · ' + (usage.used / 1048576).toFixed(1) + ' MB used of ' + (usage.quota / 1048576).toFixed(0) + ' MB' : '') + '. Clearing site data removes them — use Export Bank for a file you can keep elsewhere.']));
      const close = UI.modal('Saved banks', body, c => [el('button', { onclick: () => { c(); UI.saveBank(''); } }, ['Save current as…']), el('div', { class: 'spacer' }), el('button', { class: 'primary', onclick: c }, ['Close'])]);
    },
    /* In-app text prompt (native prompt() is blocked in embedded browsers). */
    prompt(title, initial) {
      return new Promise(resolve => {
        let done = false; let closeModal = null; const finish = v => { if (done) return; done = true; document.removeEventListener('keydown', key, true); if (closeModal) closeModal(); resolve(v); };
        const inp = el('input', { id: 'promptInput', value: initial || '', style: 'width:100%' });
        const key = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(inp.value.trim() || null); } else if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
        closeModal = UI.modal(title, [inp], () => [el('div', { class: 'spacer' }), el('button', { onclick: () => finish(null) }, ['Cancel']), el('button', { class: 'primary', id: 'promptOk', onclick: () => finish(inp.value.trim() || null) }, ['OK'])]);
        const m = $('#modal'); m.onclick = e => { if (e.target === m) finish(null); };
        document.addEventListener('keydown', key, true); setTimeout(() => { inp.focus(); inp.select(); }, 0);
      });
    },
    exportBank() { E.download(new Blob([S.exportBank()], { type: 'application/json' }), UI.safeName(S.state.bankName) + '.foley.json'); },
    importBank() {
      const inp = el('input', { type: 'file', accept: '.json,application/json' });
      inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { const txt = await f.text(); const merge = S.state.pads.length > 0 && await UI.confirm('Merge the imported pads into the current bank? Cancel replaces the current bank instead.', 'Merge'); S.importBank(txt, merge); UI.toast('Imported'); } catch (e) { UI.toast('Import failed: ' + e.message); } };
      inp.click();
    },
    async copyPadJson(p) {
      const text = JSON.stringify({ format: 'foley-bank', version: 1, bankName: p.name, pads: [p] }, null, 2);
      let copied = false;
      try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch (e) { /* clipboard blocked (file://, permissions) — fall through */ }
      if (!copied) { try { const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' }); ta.value = text; document.body.appendChild(ta); ta.select(); copied = document.execCommand('copy'); ta.remove(); } catch (e) { copied = false; } }
      if (copied) UI.toast('Pad JSON copied — paste into a file and Import to share');
      else UI.modal('Pad JSON — copy manually', [el('textarea', { class: 'json-out', readonly: true }, [text])], close => [el('div', { class: 'spacer' }), el('button', { onclick: () => { E.download(new Blob([text], { type: 'application/json' }), UI.safeName(p.name) + '.foley.json'); close(); } }, ['Download .json']), el('button', { class: 'primary', onclick: close }, ['Close'])]);
    },
  };
})();
