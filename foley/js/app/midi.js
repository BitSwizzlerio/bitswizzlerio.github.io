/* Web MIDI: note-on triggers pads (C2 = 36 = first pad, chromatic upward) with velocity mapped to Intensity.
   Velocity is quantised to 5 tiers so renders cache; CC1 (mod wheel) sets the selected pad's Intensity live.
   Foley.Midi.handle(bytes) is the transport-independent entry point (also used by the tests). */
window.Foley = window.Foley || {};
(function () {
  const S = () => Foley.Store, E = () => Foley.Engine;
  const Midi = Foley.Midi = {
    access: null, enabled: false, lastNote: null, onChange: null,
    supported() { return !!(navigator.requestMIDIAccess); },
    async enable() {
      if (Midi.enabled) return true;
      if (!Midi.supported()) throw new Error('Web MIDI is not available in this browser (Chrome/Edge support it; Firefox needs the site permission).');
      Midi.access = await navigator.requestMIDIAccess({ sysex: false });
      const bind = () => { Midi.access.inputs.forEach(inp => { inp.onmidimessage = m => Midi.handle(m.data); }); };
      bind(); Midi.access.onstatechange = bind; Midi.enabled = true; if (Midi.onChange) Midi.onChange(); return true;
    },
    disable() { if (Midi.access) Midi.access.inputs.forEach(inp => { inp.onmidimessage = null; }); Midi.enabled = false; if (Midi.onChange) Midi.onChange(); },
    inputs() { return Midi.access ? [...Midi.access.inputs.values()].map(i => i.name) : []; },
    tier(vel) { const v = vel / 127; return [0.1, 0.3, 0.5, 0.7, 0.9].reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a); },
    handle(data) {
      const st = data[0] & 0xf0, d1 = data[1], d2 = data[2];
      if (st === 0x90 && d2 > 0) { // note on
        const pads = S().state.pads; if (!pads.length) return null;
        const pad = pads[((d1 - 36) % pads.length + pads.length) % pads.length];
        const inten = Midi.tier(d2); Midi.lastNote = { note: d1, vel: d2, pad: pad.id, intensity: inten };
        const p = Object.assign({}, pad, { intensity: inten }); // render with this tier's intensity (cached per tier)
        E().ensure(); if (Foley.UI) Foley.UI.flash(pad.id);
        return E().trigger(p);
      }
      if (st === 0xb0 && d1 === 1) { const p = S().selected(); if (p) S().update(s => { p.intensity = +(d2 / 127).toFixed(2); }, 'none'); return null; } // mod wheel → intensity
      return null;
    },
  };
})();
