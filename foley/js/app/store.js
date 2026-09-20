/* Application state: banks of pads, persistence, undo. */
window.Foley = window.Foley || {};
(function () {
  const LS_KEY = 'foley.bank.v1';
  const COLORS = ['#e05d5d', '#e0a24a', '#d9d25a', '#6fcf6f', '#4fc3c3', '#5b8fe0', '#9b6fe0', '#e06fb5', '#8a8a8a'];
  let uid = 1;
  const listeners = [];

  const Store = Foley.Store = {
    state: { bankName: 'Untitled Bank', pads: [], selected: null, filter: '', multi: new Set() },
    history: [], future: [],
    COLORS,

    newId() { return 'p' + (Date.now().toString(36)) + (uid++).toString(36); },
    makePad(opts) {
      opts = opts || {};
      const gen = opts.gen || 'impact';
      const g = Foley.generators[gen];
      return {
        id: Store.newId(), name: opts.name || (g ? g.name : 'Pad'), icon: opts.icon || (g ? g.icon : '🔊'),
        color: opts.color || COLORS[Store.state.pads.length % COLORS.length], key: opts.key || '',
        layers: opts.layers || [Store.makeLayer(gen, opts.params)],
        fx: Object.assign(Foley.Engine.defaultFx(), opts.fx || {}),
        seed: opts.seed || Math.floor(Math.random() * 1e6) + 1, variations: opts.variations || 4, roundRobin: !!opts.roundRobin, loop: !!opts.loop, intensity: opts.intensity === undefined ? 0.5 : opts.intensity,
        humanize: Object.assign({ pitch: 0.5, gain: 1.5, pan: 0 }, opts.humanize || {}), pan: opts.pan || 0, tags: opts.tags || '', macros: opts.macros || [],
      };
    },
    /* Apply a macro (user knob) value: each target param = lerp(min, max, v). */
    applyMacro(pad, macro, v) { macro.value = v; (macro.targets || []).forEach(t => { const L = pad.layers.find(l => l.id === t.layer); if (!L) return; L.params[t.param] = Foley.DSP.lerp(t.min, t.max, v); }); },
    makeLayer(gen, params) { return { id: Store.newId(), gen, params: Object.assign(Foley.defaultParams(gen), params || {}), gain: 0, pan: 0, offset: 0, mute: false, solo: false, open: true, repeat: 1, every: 0.25, jitter: 0.2, hp: 20, lp: 20000, drive: 0 }; },
    LAYER_DEFAULTS: { gain: 0, pan: 0, offset: 0, mute: false, solo: false, open: true, repeat: 1, every: 0.25, jitter: 0.2, hp: 20, lp: 20000, drive: 0 },

    on(cb) { listeners.push(cb); },
    emit(what) { listeners.forEach(cb => cb(what || 'all')); },
    /* Mutate state inside fn; records undo and persists. */
    update(fn, what, opts) {
      opts = opts || {};
      if (!opts.noHistory) { Store.history.push(JSON.stringify({ pads: Store.state.pads, bankName: Store.state.bankName })); if (Store.history.length > 60) Store.history.shift(); Store.future = []; }
      fn(Store.state);
      if (Store.state.multi.size) { const live = new Set(Store.state.pads.map(p => p.id)); Store.state.multi = new Set([...Store.state.multi].filter(id => live.has(id))); }
      Store.save(); if (Store.tabs.length) Store.saveTabs(); Store.emit(what);
    },
    undo() { if (!Store.history.length) return; Store.future.push(JSON.stringify({ pads: Store.state.pads, bankName: Store.state.bankName })); Store.applySnapshot(Store.history.pop()); },
    redo() { if (!Store.future.length) return; Store.history.push(JSON.stringify({ pads: Store.state.pads, bankName: Store.state.bankName })); Store.applySnapshot(Store.future.pop()); },
    applySnapshot(s) { const o = JSON.parse(s); Store.state.pads = o.pads; Store.state.bankName = o.bankName; Store.state.multi = new Set(); if (!Store.state.pads.find(p => p.id === Store.state.selected)) Store.state.selected = Store.state.pads[0] ? Store.state.pads[0].id : null; Store.save(); Store.emit('all'); },
    /* Multi-selection (not persisted) */
    toggleMulti(id) { const m = Store.state.multi; if (m.has(id)) m.delete(id); else m.add(id); if (!m.has(Store.state.selected) && m.size) Store.state.selected = id; Store.emit('pads'); },
    selectRange(toId) { const ids = Store.state.pads.map(p => p.id); const a = ids.indexOf(Store.state.selected), b = ids.indexOf(toId); if (a < 0 || b < 0) return; const [lo, hi] = a < b ? [a, b] : [b, a]; for (let i = lo; i <= hi; i++) Store.state.multi.add(ids[i]); Store.emit('pads'); },
    selectAll() { Store.state.multi = new Set(Store.state.pads.map(p => p.id)); Store.emit('pads'); },
    clearMulti() { if (!Store.state.multi.size) return; Store.state.multi = new Set(); Store.emit('pads'); },
    /* ids to act on: the multi-selection if any, else the selected pad */
    targetIds() { return Store.state.multi.size ? [...Store.state.multi] : (Store.state.selected ? [Store.state.selected] : []); },

    selected() { return Store.state.pads.find(p => p.id === Store.state.selected) || null; },
    select(id) { Store.state.selected = id; Store.emit('select'); },
    padByKey(k) { return Store.state.pads.find(p => p.key && p.key.toLowerCase() === k.toLowerCase()); },

    addPad(opts) { let pad; Store.update(s => { pad = Store.makePad(opts); if (!pad.key) pad.key = Store.nextFreeKey(); s.pads.push(pad); s.selected = pad.id; }, 'all'); return pad; },
    duplicatePad(id) { Store.duplicatePads([id]); },
    duplicatePads(ids) {
      Store.update(s => {
        const set = new Set(ids); const order = s.pads.filter(p => set.has(p.id)); let last = null;
        order.forEach(src => { const i = s.pads.indexOf(src); const c = JSON.parse(JSON.stringify(src)); c.id = Store.newId(); c.name += ' copy'; c.key = Store.nextFreeKey(); c.seed = Math.floor(Math.random() * 1e6) + 1; c.layers.forEach(l => l.id = Store.newId()); s.pads.splice(i + 1, 0, c); last = c; });
        if (last) s.selected = last.id; s.multi = new Set();
      }, 'all');
    },
    deletePad(id) { Store.deletePads([id]); },
    /* Delete several pads at once (one undo step). Selection moves to the nearest survivor. */
    deletePads(ids) {
      const set = new Set(ids); if (!set.size) return;
      ids.forEach(id => Foley.Engine.stopLoop(id));
      Store.update(s => {
        const firstIdx = s.pads.findIndex(p => set.has(p.id));
        s.pads = s.pads.filter(p => !set.has(p.id));
        if (set.has(s.selected) || !s.pads.find(p => p.id === s.selected)) s.selected = (s.pads[Math.min(firstIdx, s.pads.length - 1)] || {}).id || null;
        s.multi = new Set();
      }, 'all');
    },
    clearAll() { Foley.Engine.stopAll(); Store.update(s => { s.pads = []; s.selected = null; s.multi = new Set(); }, 'all'); },
    movePad(from, to) { Store.update(s => { const [p] = s.pads.splice(from, 1); s.pads.splice(to, 0, p); }, 'all'); },
    KEYS: '1234567890qwertyuiopasdfghjklzxcvbnm'.split(''),
    nextFreeKey() { const used = new Set(Store.state.pads.map(p => (p.key || '').toLowerCase())); return Store.KEYS.find(k => !used.has(k)) || ''; },

    save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ bankName: Store.state.bankName, pads: Store.state.pads, selected: Store.state.selected })); } catch (e) { } },
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY); if (!raw) return false;
        const o = JSON.parse(raw); if (!o.pads || !o.pads.length) return false;
        Store.state.bankName = o.bankName || 'Untitled Bank'; Store.state.pads = o.pads.map(Store.migratePad); Store.state.selected = o.selected;
        if (!Store.selected()) Store.state.selected = Store.state.pads[0].id;
        return true;
      } catch (e) { console.warn('load failed', e); return false; }
    },
    migratePad(p) {
      const d = Store.makePad({ gen: 'impact' });
      const hadNormMode = p.fx && p.fx.normMode !== undefined;
      p = Object.assign({}, d, p); p.fx = Object.assign(Foley.Engine.defaultFx(), p.fx || {}); p.humanize = Object.assign({ pitch: 0.5, gain: 1.5, pan: 0 }, p.humanize || {});
      if (!hadNormMode) p.fx.normMode = 'peak'; // pads saved before loudness normalization existed keep their old level behaviour
      if (p.intensity === undefined) p.intensity = 0.5;
      p.layers = (p.layers || []).filter(l => Foley.generators[l.gen]).map(l => Object.assign({ id: Store.newId() }, Store.LAYER_DEFAULTS, l, { params: Object.assign(Foley.defaultParams(l.gen), l.params || {}) }));
      if (!Array.isArray(p.macros)) p.macros = [];
      if (!p.layers.length) p.layers = [Store.makeLayer('impact')];
      return p;
    },
    exportBank() { return JSON.stringify({ format: 'foley-bank', version: 1, bankName: Store.state.bankName, pads: Store.state.pads }, null, 2); },
    importBank(json, merge) {
      const o = typeof json === 'string' ? JSON.parse(json) : json;
      if (!o || !Array.isArray(o.pads)) throw new Error('Not a Foley bank file');
      Store.update(s => {
        const pads = o.pads.map(Store.migratePad);
        if (merge) { pads.forEach(p => { p.id = Store.newId(); p.layers.forEach(l => l.id = Store.newId()); if (s.pads.find(q => q.key === p.key)) p.key = ''; s.pads.push(p); }); s.pads.forEach(p => { if (!p.key) p.key = Store.nextFreeKey(); }); }
        else { s.pads = pads; s.bankName = o.bankName || 'Imported Bank'; }
        s.selected = s.pads[0] ? s.pads[0].id : null;
      }, 'all');
    },
    loadFactory(name) { const bank = Foley.Factory[name || 'Starter Kit']; Store.importBank(JSON.parse(JSON.stringify({ bankName: name || 'Starter Kit', pads: bank })), false); },

    /* ---- Bank tabs: several banks open at once; the active one lives in state, the others are held here. ---- */
    tabs: [], tabIndex: 0, TABS_KEY: 'foley.tabs.v1',
    tabSnapshot() { return { bankName: Store.state.bankName, pads: JSON.parse(JSON.stringify(Store.state.pads)), selected: Store.state.selected }; },
    saveTabs() { try { const all = Store.tabs.map((t, i) => i === Store.tabIndex ? Store.tabSnapshot() : t); localStorage.setItem(Store.TABS_KEY, JSON.stringify({ tabs: all.map(t => ({ bankName: t.bankName, pads: t.pads, selected: t.selected })), index: Store.tabIndex })); } catch (e) { } },
    loadTabs() {
      try { const o = JSON.parse(localStorage.getItem(Store.TABS_KEY) || 'null'); if (o && Array.isArray(o.tabs) && o.tabs.length) { Store.tabs = o.tabs.map(t => ({ bankName: t.bankName || 'Untitled Bank', pads: (t.pads || []).map(Store.migratePad), selected: t.selected })); Store.tabIndex = Math.min(o.index || 0, Store.tabs.length - 1); const cur = Store.tabs[Store.tabIndex]; Store.state.bankName = cur.bankName; Store.state.pads = cur.pads; Store.state.selected = cur.selected; if (!Store.selected() && Store.state.pads[0]) Store.state.selected = Store.state.pads[0].id; return true; } } catch (e) { }
      return false;
    },
    ensureTabs() { if (!Store.tabs.length) { Store.tabs = [Store.tabSnapshot()]; Store.tabIndex = 0; } },
    switchTab(i) {
      Store.ensureTabs(); if (i === Store.tabIndex || i < 0 || i >= Store.tabs.length) return;
      Foley.Engine.stopAll(); Store.tabs[Store.tabIndex] = Store.tabSnapshot(); Store.tabIndex = i; const t = Store.tabs[i];
      Store.state.bankName = t.bankName; Store.state.pads = t.pads; Store.state.selected = t.selected; Store.state.multi = new Set();
      if (!Store.selected() && Store.state.pads[0]) Store.state.selected = Store.state.pads[0].id;
      Store.history = []; Store.future = []; Store.save(); Store.saveTabs(); Store.emit('all');
    },
    openTab(bankName, pads) { Store.ensureTabs(); Store.tabs[Store.tabIndex] = Store.tabSnapshot(); Store.tabs.push({ bankName: bankName || 'Untitled Bank', pads: (pads || []).map(Store.migratePad), selected: null }); Store.switchTab(Store.tabs.length - 1); },
    closeTab(i) {
      Store.ensureTabs(); if (Store.tabs.length <= 1) return;
      if (i === Store.tabIndex) { const next = i > 0 ? i - 1 : 1; Store.switchTab(next); Store.tabs.splice(i, 1); if (Store.tabIndex > i) Store.tabIndex--; }
      else { Store.tabs.splice(i, 1); if (Store.tabIndex > i) Store.tabIndex--; }
      Store.saveTabs(); Store.emit('all');
    },
    renameTab(i, name) { Store.ensureTabs(); if (i === Store.tabIndex) Store.update(s => s.bankName = name, 'none'); else { Store.tabs[i].bankName = name; Store.saveTabs(); Store.emit('pads'); } },
    /* Move pads (by id) from the active bank into another open tab. */
    movePadsToTab(ids, i) {
      Store.ensureTabs(); if (i === Store.tabIndex || !Store.tabs[i]) return; const set = new Set(ids); const moving = Store.state.pads.filter(p => set.has(p.id));
      if (!moving.length) return; const dest = Store.tabs[i]; moving.forEach(p => { const c = JSON.parse(JSON.stringify(p)); c.id = Store.newId(); c.layers.forEach(l => l.id = Store.newId()); if (dest.pads.some(q => q.key === c.key)) c.key = ''; dest.pads.push(c); });
      Store.deletePads(ids); Store.saveTabs();
    },
  };
})();
