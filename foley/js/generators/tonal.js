/* Tonal / musical / sci-fi / designed sounds. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  R({
    id: 'pickup', name: 'Coin / Pickup', category: 'Tonal', icon: '🪙',
    params: [P.sel('style', 'Style', ['coin', 'gem', 'powerup', 'levelup', 'heal', 'key', '1up'], 'coin'), P.r('root', 'Root', 200, 2000, 988, 'Hz'), P.r('speed', 'Speed', 0.03, 0.25, 0.08, 's'), P.r('notes', 'Notes', 1, 12, 2), P.sel('wave', 'Wave', ['square', 'triangle', 'sine', 'sawtooth'], 'square'), P.r('decay', 'Decay', 0.05, 1.5, 0.35, 's'), P.r('shimmer', 'Shimmer', 0, 1, 0.3)],
    duration(p) { return Math.round(p.notes) * p.speed + p.decay + 0.3; },
    build(ctx, out, p, rng, t0) {
      const pat = { coin: [0, 5], gem: [0, 4, 7, 12], powerup: [0, 4, 7, 12, 16, 19, 24], levelup: [0, 4, 7, 12, 7, 12, 16, 19, 24], heal: [0, 7, 12, 19], key: [0, 12, 7, 12], '1up': [0, 4, 7, 12, 9, 14] }[p.style];
      const n = Math.round(p.notes);
      for (let i = 0; i < n; i++) {
        const t = t0 + i * p.speed; const semi = pat[i % pat.length] + 12 * Math.floor(i / pat.length) * (p.style === 'powerup' ? 0 : 1);
        const f = p.root * DSP.semis(semi);
        const last = i === n - 1; const d = last ? p.decay : p.speed * 1.2;
        const o = DSP.osc(ctx, p.wave, f, t, d + 0.05); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.002, d: d, peak: 0.35, r: 0.02 });
        const lp = DSP.filter(ctx, 'lowpass', 7000, 0.7); DSP.chain(o, lp, g, out);
        if (p.shimmer > 0 && last) { for (let k = 2; k <= 4; k++) { const o2 = DSP.osc(ctx, 'sine', f * k, t, d); const g2 = DSP.gain(ctx, 0); DSP.env(g2.gain, t, { a: 0.01 * k, d: d * 0.8, peak: p.shimmer * 0.15 / k }); DSP.chain(o2, g2, out); } }
      }
    },
  });

  R({
    id: 'magic', name: 'Magic / Spell', category: 'Tonal', icon: '✨',
    params: [P.sel('type', 'Type', ['sparkle', 'cast', 'heal', 'dark', 'teleport', 'shield', 'buff', 'curse'], 'sparkle'), P.r('length', 'Length', 0.2, 3, 1, 's'), P.r('pitch', 'Pitch', 0.5, 2, 1), P.r('density', 'Density', 0, 1, 0.6), P.r('sweep', 'Sweep', -1, 1, 0.5), P.r('noise', 'Air', 0, 1, 0.3)],
    duration(p) { return p.length + 0.6; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, k = p.pitch; const dark = p.type === 'dark' || p.type === 'curse';
      const scale = dark ? [0, 1, 3, 6, 7, 10, 13] : (p.type === 'heal' || p.type === 'buff') ? [0, 4, 7, 11, 12, 16, 19] : [0, 2, 4, 7, 9, 12, 14, 16, 19];
      const base = (dark ? 220 : 440) * k;
      const c = Math.round(4 + p.density * 40 * L);
      for (let i = 0; i < c; i++) {
        const u = i / c; const t = t0 + u * L * rng.range(0.9, 1.05);
        const semi = rng.pick(scale) + 12 * Math.floor(DSP.lerp(0, 2.5, u * p.sweep + (p.sweep < 0 ? -p.sweep : 0)));
        const f = base * DSP.semis(semi);
        const o = DSP.osc(ctx, dark ? 'triangle' : 'sine', f, t, 0.4); if (p.type === 'teleport') DSP.sweep(o.frequency, t, f, t + 0.3, f * 2);
        const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.005, d: rng.range(0.1, 0.4), peak: rng.range(0.08, 0.25) * (dark ? 1.3 : 1) }); DSP.chain(o, g, out);
      }
      const n = DSP.noise(ctx, rng, t0, L, 'white'); const f = DSP.filter(ctx, 'bandpass', 3000 * k, 2);
      const f0 = (p.sweep >= 0 ? 800 : 6000) * k, f1 = (p.sweep >= 0 ? 6000 : 800) * k; DSP.sweep(f.frequency, t0, f0, t0 + L, f1);
      const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: L * 0.3, d: L * 0.6, peak: p.noise * 0.5, r: 0.1, curve: 'lin' }); DSP.chain(n, f, g, out);
      if (p.type === 'cast' || p.type === 'shield' || p.type === 'teleport' || dark) {
        const s = DSP.stack(ctx, dark ? 'sawtooth' : 'triangle', base * 0.5, t0, L, 4, 20, rng); const lp = DSP.filter(ctx, 'lowpass', 800 * k, 4);
        DSP.sweep(lp.frequency, t0, p.type === 'teleport' ? 300 : 800 * k, t0 + L, p.type === 'teleport' ? 6000 : 2500 * k);
        s.oscs.forEach(o => { if (p.type === 'teleport') DSP.sweep(o.frequency, t0, base * 0.5, t0 + L, base * 2); });
        const sg = DSP.gain(ctx, 0); DSP.env(sg.gain, t0, { a: L * 0.2, d: L * 0.3, s: 0.6, hold: L * 0.2, r: L * 0.3, peak: 0.3, curve: 'lin' }); DSP.chain(s.node, lp, sg, out);
      }
      if (p.type === 'shield' || p.type === 'buff') { const t = t0 + L * 0.6; DSP.hit(ctx, out, rng, t, { thumpAmp: 0.3, thumpFreq: 200 * k, thumpDecay: 0.1, noiseAmp: 0.2, noiseFreq: 4000, noiseQ: 1, noiseDecay: 0.08, ring: [base * 2, base * 3, base * 4.5], ringAmp: 0.4, ringDecay: 0.6 }); }
    },
  });

  R({
    id: 'alarm', name: 'Alarm / Siren', category: 'Tonal', icon: '🚨',
    params: [P.sel('type', 'Type', ['siren', 'alarm', 'beep', 'klaxon', 'warning', 'countdown'], 'alarm'), P.r('freq', 'Frequency', 200, 3000, 880, 'Hz'), P.r('rate', 'Rate', 0.5, 20, 4, 'Hz'), P.r('length', 'Length', 0.2, 6, 1.5, 's'), P.sel('wave', 'Wave', ['square', 'sawtooth', 'triangle', 'sine'], 'square'), P.r('depth', 'Sweep depth', 0, 1, 0.5)],
    duration(p) { return p.length + 0.3; },
    build(ctx, out, p, rng, t0) {
      const L = p.length;
      const o = DSP.osc(ctx, p.wave, p.freq, t0, L); const lp = DSP.filter(ctx, 'lowpass', 4000, 1); const g = DSP.gain(ctx, 0);
      const cycles = Math.max(1, Math.round(L * p.rate));
      if (p.type === 'siren') { o.frequency.setValueAtTime(p.freq, t0); for (let i = 1; i <= cycles * 2; i++) o.frequency.exponentialRampToValueAtTime(i % 2 ? p.freq * (1 + p.depth) : p.freq, t0 + (i / (cycles * 2)) * L); DSP.env(g.gain, t0, { a: 0.05, d: 0.01, s: 1, hold: L - 0.15, r: 0.1, peak: 0.35, curve: 'lin' }); }
      else if (p.type === 'klaxon') { const m = DSP.osc(ctx, 'sawtooth', 50, t0, L); const mg = DSP.gain(ctx, p.freq * 0.3 * p.depth); DSP.chain(m, mg, o.frequency); g.gain.setValueAtTime(0, t0); for (let i = 0; i < cycles; i++) { const t = t0 + (i / cycles) * L, d = L / cycles; g.gain.linearRampToValueAtTime(0.35, t + 0.02); g.gain.setValueAtTime(0.35, t + d * 0.6); g.gain.linearRampToValueAtTime(0, t + d * 0.65); } }
      else if (p.type === 'warning') { g.gain.setValueAtTime(0, t0); for (let i = 0; i < cycles; i++) { const t = t0 + (i / cycles) * L, d = L / cycles; o.frequency.setValueAtTime(i % 2 ? p.freq * (1 + p.depth * 0.5) : p.freq, t); g.gain.linearRampToValueAtTime(0.35, t + 0.01); g.gain.setValueAtTime(0.35, t + d * 0.5); g.gain.linearRampToValueAtTime(0, t + d * 0.55); } }
      else if (p.type === 'countdown') { g.gain.setValueAtTime(0, t0); for (let i = 0; i < cycles; i++) { const t = t0 + (i / cycles) * L; const last = i === cycles - 1; o.frequency.setValueAtTime(last ? p.freq * 2 : p.freq, t); g.gain.linearRampToValueAtTime(0.35, t + 0.005); g.gain.setValueAtTime(0.35, t + (last ? 0.4 : 0.08)); g.gain.linearRampToValueAtTime(0, t + (last ? 0.5 : 0.1)); } }
      else { g.gain.setValueAtTime(0, t0); for (let i = 0; i < cycles; i++) { const t = t0 + (i / cycles) * L, d = L / cycles; if (p.type === 'alarm') o.frequency.setValueAtTime(i % 2 ? p.freq * (1 + p.depth * 0.5) : p.freq, t); g.gain.linearRampToValueAtTime(0.35, t + 0.005); g.gain.setValueAtTime(0.35, t + d * (p.type === 'beep' ? 0.3 : 0.5)); g.gain.linearRampToValueAtTime(0, t + d * (p.type === 'beep' ? 0.35 : 0.55)); } }
      DSP.chain(o, lp, g, out);
    },
  });

  R({
    id: 'engine', name: 'Engine / Motor', category: 'Tonal', icon: '🏎️',
    params: [P.sel('type', 'Type', ['car', 'motorcycle', 'jet', 'electric', 'helicopter', 'spaceship', 'drone'], 'car'), P.r('rpm', 'RPM', 0, 1, 0.4), P.r('length', 'Length', 0.5, 10, 3, 's'), P.r('rev', 'Rev (sweep)', -1, 1, 0), P.r('rough', 'Roughness', 0, 1, 0.4), P.sel('model', 'Engine model', [{ value: 'combustion', label: 'combustion (cylinder pulses)' }, { value: 'legacy', label: 'legacy (oscillator stack)' }], 'combustion'), P.tog('loop', 'Seamless loop', true)],
    duration(p) { return p.length + (p.loop && (p.type === 'car' || p.type === 'motorcycle') && p.model !== 'legacy' ? 0.45 : 0.2); },
    build(ctx, out, p, rng, t0) {
      const L = p.length;
      const cfg = { car: { f: 35, wave: 'sawtooth', h: [1, 2, 3, 4, 6], lp: 900 }, motorcycle: { f: 45, wave: 'square', h: [1, 2, 3, 5], lp: 1500 }, jet: { f: 90, wave: 'sawtooth', h: [1, 1.5, 2.2, 4], lp: 3000 }, electric: { f: 120, wave: 'sine', h: [1, 2, 4, 8], lp: 6000 }, helicopter: { f: 12, wave: 'sawtooth', h: [1, 2, 3], lp: 500 }, spaceship: { f: 55, wave: 'triangle', h: [1, 1.01, 2, 3.01], lp: 1200 }, drone: { f: 200, wave: 'square', h: [1, 1.02, 2], lp: 4000 } }[p.type];
      const f0 = cfg.f * (0.6 + p.rpm * 2.5); const f1 = f0 * Math.pow(2, p.rev * 1.5);
      const sum = DSP.gain(ctx, 0.25); const lp = DSP.filter(ctx, 'lowpass', cfg.lp * (0.5 + p.rpm), 1.5); DSP.sweep(lp.frequency, t0, cfg.lp * (0.5 + p.rpm), t0 + L, cfg.lp * (0.5 + p.rpm) * (p.loop ? 1 : Math.pow(2, p.rev))); // loops can't glide
      const sh = DSP.shaper(ctx, 0.3 + p.rough * 0.5, 'soft'); const g = DSP.gain(ctx, 0);
      if (p.loop) { g.gain.setValueAtTime(1, t0); g.gain.setValueAtTime(1, t0 + L); } else DSP.env(g.gain, t0, { a: 0.3, d: 0.1, s: 1, hold: L - 0.7, r: 0.3, peak: 1, curve: 'lin' });
      DSP.chain(sum, lp, sh, g, out);
      if ((p.type === 'car' || p.type === 'motorcycle') && p.model !== 'legacy') {
        // combustion engine: a cylinder-firing pulse train (each firing = raised-cosine pressure pulse + exhaust puff)
        // through an exhaust pipe body, plus intake hiss. Firing rate = f0 × cylinders/2 (four-stroke), gliding with rev.
        // In loop mode the train runs steady-state through the whole render (no rev glide, no timing jitter) so the
        // pad's smart-seam crossfade can find a phase-aligned wrap point.
        const cyl = p.type === 'car' ? 4 : 2; const sr = ctx.sampleRate; const Lr = p.loop ? L + 0.4 : L; const n = Math.ceil((Lr + 0.05) * sr); const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
        const fEnd = p.loop ? f0 : f1; let pos = 0, cnt = 0;
        while (pos < n && cnt++ < 200000) { const i = Math.round(pos); const u = i / (L * sr); const rate = f0 * Math.pow(fEnd / f0, Math.min(1, u)) * cyl / 2; const per = Math.max(8, sr / rate); const a = rng.range(0.7, 1) * (1 + p.rough * rng.range(-0.5, 0.5)); const w = Math.max(4, Math.round(per * (0.25 + p.rough * 0.15))); for (let q = 0; q < w && i + q < n; q++) d[i + q] += a * (0.5 - 0.5 * Math.cos(2 * Math.PI * q / w)); for (let q = 0; q < per * 0.5 && i + q < n; q++) d[i + q] += (rng.next() * 2 - 1) * 0.25 * a * Math.exp(-q / (per * 0.15)); pos += per * (p.loop ? 1 : rng.range(1 - p.rough * 0.08, 1 + p.rough * 0.08)); }
        const s = ctx.createBufferSource(); s.buffer = buf; s.start(t0); s.stop(t0 + Lr + 0.05);
        const pipe = Foley.Materials.bank(ctx, Foley.Materials.metalModes('hollow', p.type === 'car' ? 2.6 : 1.9, rng, 0.3), 0.8, 0.45); s.connect(pipe.input); pipe.output.connect(sum);
        DSP.chain(s, DSP.filter(ctx, 'lowpass', 600 + p.rpm * 900, 1), DSP.gain(ctx, 0.9), sum); // raw exhaust pressure
        DSP.chain(s, DSP.filter(ctx, 'peaking', 180 * (0.8 + p.rpm), 1.5, 8), DSP.filter(ctx, 'lowpass', 400, 1), DSP.gain(ctx, 0.5), sum); // block resonance
      } else cfg.h.forEach((h, i) => { const o = DSP.osc(ctx, cfg.wave, f0 * h, t0, L); DSP.sweep(o.frequency, t0, f0 * h, t0 + L, f1 * h); const og = DSP.gain(ctx, 0.6 / (i + 1)); DSP.chain(o, og, sum); if (p.type === 'helicopter' || p.rough > 0.5) { const m = DSP.osc(ctx, 'sine', f0 * rng.range(0.9, 1.1), t0, L); const mg = DSP.gain(ctx, f0 * h * 0.1 * p.rough); DSP.chain(m, mg, o.frequency); } });
      if (p.type === 'helicopter') { const n = DSP.noise(ctx, rng, t0, L, 'pink'); const nf = DSP.filter(ctx, 'lowpass', 800, 1); const ng = DSP.gain(ctx, 0); const beats = Math.round(L * f0); ng.gain.setValueAtTime(0.1, t0); for (let i = 0; i < beats; i++) { const t = t0 + i / f0; ng.gain.linearRampToValueAtTime(1, t + 0.01); ng.gain.linearRampToValueAtTime(0.1, t + 0.5 / f0); } DSP.chain(n, nf, ng, sum); }
      const n2 = DSP.noise(ctx, rng, t0, L, 'pink'); const n2f = DSP.filter(ctx, p.type === 'jet' ? 'highpass' : 'lowpass', p.type === 'jet' ? 1500 : 400, 0.7); const n2g = DSP.gain(ctx, p.type === 'jet' ? 0.5 + p.rpm * 0.5 : 0.15 * p.rough); DSP.chain(n2, n2f, n2g, sum);
    },
  });

  R({
    id: 'heartbeat', name: 'Heartbeat', category: 'Tonal', icon: '❤️',
    params: [P.r('bpm', 'BPM', 40, 180, 72), P.r('beats', 'Beats', 1, 16, 4), P.r('tension', 'Tension', 0, 1, 0.3), P.r('depth', 'Depth', 0, 1, 0.6)],
    duration(p) { return Math.round(p.beats) * 60 / p.bpm + 0.5; },
    build(ctx, out, p, rng, t0) {
      const n = Math.round(p.beats); const beat = 60 / p.bpm;
      for (let i = 0; i < n; i++) {
        const t = t0 + i * beat;
        const thump = (tt, a, fr) => { const o = DSP.osc(ctx, 'sine', fr * 2, tt, 0.3); DSP.sweep(o.frequency, tt, fr * 2, tt + 0.08, fr); const g = DSP.gain(ctx, 0); DSP.env(g.gain, tt, { a: 0.01, d: 0.12 + p.depth * 0.1, peak: a, r: 0.05 }); const lp = DSP.filter(ctx, 'lowpass', 150 + p.tension * 300, 1); DSP.chain(o, lp, g, out); const nz = DSP.noise(ctx, rng, tt, 0.1, 'brown'); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, tt, { a: 0.005, d: 0.06, peak: a * 0.5 * p.tension }); DSP.chain(nz, ng, out); };
        thump(t, 0.9, 50 - p.depth * 15); thump(t + beat * 0.28, 0.6, 45 - p.depth * 15);
      }
    },
  });

  R({
    id: 'drone', name: 'Drone / Pad', category: 'Tonal', icon: '🌌',
    params: [P.r('freq', 'Root', 30, 500, 110, 'Hz'), P.r('length', 'Length', 0.5, 12, 4, 's'), P.sel('wave', 'Wave', ['sawtooth', 'triangle', 'square', 'sine'], 'sawtooth'), P.r('voices', 'Voices', 1, 8, 4), P.r('detune', 'Detune', 0, 60, 12, 'ct'), P.r('cutoff', 'Cutoff', 100, 8000, 800, 'Hz'), P.r('lfo', 'LFO rate', 0, 8, 0.5, 'Hz'), P.r('lfoDepth', 'LFO depth', 0, 1, 0.4), P.sel('mood', 'Chord', ['unison', 'fifth', 'minor', 'major', 'sus', 'dark'], 'fifth'), P.tog('loop', 'Seamless loop', true)],
    duration(p) { return p.length + 0.3; },
    build(ctx, out, p, rng, t0) {
      const L = p.length; const chord = { unison: [0], fifth: [0, 7], minor: [0, 3, 7], major: [0, 4, 7], sus: [0, 5, 7], dark: [0, 1, 6] }[p.mood];
      const lp = DSP.filter(ctx, 'lowpass', p.cutoff, 3); const g = DSP.gain(ctx, 0);
      if (p.loop) { g.gain.setValueAtTime(0.4, t0); g.gain.setValueAtTime(0.4, t0 + L); } else DSP.env(g.gain, t0, { a: L * 0.25, d: 0.1, s: 1, hold: L * 0.4, r: L * 0.3, peak: 0.4, curve: 'lin' });
      DSP.chain(lp, g, out);
      if (p.lfo > 0 && p.lfoDepth > 0) { const l = DSP.osc(ctx, 'sine', p.lfo, t0, L); const lg = DSP.gain(ctx, p.cutoff * p.lfoDepth * 0.8); DSP.chain(l, lg, lp.frequency); }
      chord.forEach(semi => { const s = DSP.stack(ctx, p.wave, p.freq * DSP.semis(semi), t0, L, Math.round(p.voices), p.detune, rng); const sg = DSP.gain(ctx, 1 / chord.length); DSP.chain(s.node, sg, lp); });
      const sub = DSP.osc(ctx, 'sine', p.freq * 0.5, t0, L); const subg = DSP.gain(ctx, 0.3); DSP.chain(sub, subg, lp);
    },
  });

  R({
    id: 'riser', name: 'Riser / Stinger', category: 'Tonal', icon: '📈',
    params: [P.sel('type', 'Type', ['riser', 'downer', 'stinger', 'impact-hit', 'reverse-cymbal'], 'riser'), P.r('length', 'Length', 0.3, 6, 2, 's'), P.r('pitch', 'Pitch', 0.5, 2, 1), P.r('noise', 'Noise', 0, 1, 0.6), P.r('tone', 'Tone', 0, 1, 0.5)],
    duration(p) { return p.length + 1; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, k = p.pitch, up = p.type !== 'downer';
      if (p.type === 'stinger' || p.type === 'impact-hit') {
        DSP.hit(ctx, out, rng, t0, { thumpAmp: 1.2, thumpFreq: 45 * k, thumpDecay: 0.6, thumpSweep: 4, noiseAmp: 0.8, noiseColor: 'pink', noiseFreq: 800, noiseQ: 0.5, noiseDecay: 0.3, ring: [110 * k, 165 * k, 220 * k], ringAmp: p.tone * 0.5, ringDecay: 1.2, drive: 0.3 });
        const n = DSP.noise(ctx, rng, t0, L, 'brown'); const f = DSP.filter(ctx, 'lowpass', 500, 1); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.01, d: L, peak: 1.2 }); DSP.chain(n, f, g, out);
        if (p.type === 'stinger') { const s = DSP.stack(ctx, 'sawtooth', 55 * k, t0, L, 5, 25, rng); const lp = DSP.filter(ctx, 'lowpass', 2000, 2); DSP.sweep(lp.frequency, t0, 3000, t0 + L, 200); const sg = DSP.gain(ctx, 0); DSP.env(sg.gain, t0, { a: 0.01, d: L, peak: p.tone * 0.5 }); DSP.chain(s.node, lp, sg, out); }
        return;
      }
      const n = DSP.noise(ctx, rng, t0, L, 'white'); const f = DSP.filter(ctx, 'bandpass', 1000, 1.5);
      DSP.sweep(f.frequency, t0, up ? 200 * k : 8000 * k, t0 + L, up ? 8000 * k : 200 * k);
      const g = DSP.gain(ctx, 0); g.gain.setValueAtTime(0.0005, t0); g.gain.exponentialRampToValueAtTime(p.noise * 0.8, t0 + L * (up ? 0.97 : 0.1)); g.gain.exponentialRampToValueAtTime(0.0005, t0 + L);
      DSP.chain(n, f, g, out);
      if (p.tone > 0 && p.type !== 'reverse-cymbal') { const s = DSP.stack(ctx, 'sawtooth', 110 * k, t0, L, 4, 20, rng); s.oscs.forEach(o => DSP.sweep(o.frequency, t0, up ? 110 * k : 440 * k, t0 + L, up ? 440 * k : 110 * k)); const lp = DSP.filter(ctx, 'lowpass', 1500, 2); DSP.sweep(lp.frequency, t0, up ? 300 : 5000, t0 + L, up ? 5000 : 300); const sg = DSP.gain(ctx, 0); sg.gain.setValueAtTime(0.0005, t0); sg.gain.exponentialRampToValueAtTime(p.tone * 0.4, t0 + L * (up ? 0.95 : 0.1)); sg.gain.exponentialRampToValueAtTime(0.0005, t0 + L); DSP.chain(s.node, lp, sg, out); const tr = Math.round(L * 12); for (let i = 0; i < tr; i++) { const t = t0 + (i / tr) * L; const cl = DSP.noise(ctx, rng, t, 0.02); const cg = DSP.gain(ctx, 0); DSP.env(cg.gain, t, { a: 0.001, d: 0.01, peak: 0.15 * (up ? i / tr : 1 - i / tr) }); DSP.chain(cl, DSP.filter(ctx, 'highpass', 3000), cg, out); } }
      if (p.type === 'reverse-cymbal') { [3200, 4700, 6100, 8300].forEach(fr => { const o = DSP.osc(ctx, 'sine', fr * k, t0, L); const og = DSP.gain(ctx, 0); og.gain.setValueAtTime(0.0005, t0); og.gain.exponentialRampToValueAtTime(0.1 * p.tone, t0 + L * 0.97); og.gain.exponentialRampToValueAtTime(0.0005, t0 + L); DSP.chain(o, og, out); }); }
    },
  });
})();
