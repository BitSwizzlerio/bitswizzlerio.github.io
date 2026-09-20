/* Electricity: static, interference, arcs, sparks, zaps, hum, short circuits. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  /* Sparse, randomly-spaced crackle impulses with a bandpass — the core of arcs and sparks. */
  function arcCrackle(ctx, out, rng, t0, L, o) {
    const rate = o.rate || 300, amp = o.amp === undefined ? 0.6 : o.amp, freq = o.freq || 4000, Q = o.Q || 1.5, envShape = o.envShape || 'flat';
    const n = ctx.createBufferSource(); const buf = ctx.createBuffer(1, Math.ceil((L + 0.05) * ctx.sampleRate), ctx.sampleRate); const d = buf.getChannelData(0);
    const per = ctx.sampleRate / rate; let next = 0;
    for (let i = 0; i < d.length; i++) {
      if (i >= next) { const len = 1 + rng.int(0, 6); const a = rng.range(0.4, 1) * (rng.next() < 0.5 ? -1 : 1); for (let k = 0; k < len && i + k < d.length; k++) d[i + k] = a * (1 - k / len); next = i + per * rng.range(0.2, 1.8); }
    }
    n.buffer = buf; n.start(t0); n.stop(t0 + L + 0.05);
    const f = DSP.filter(ctx, 'bandpass', freq, Q); const g = DSP.gain(ctx, 0);
    if (envShape === 'flat') { g.gain.setValueAtTime(amp, t0); g.gain.setValueAtTime(amp, t0 + L - 0.005); g.gain.linearRampToValueAtTime(0, t0 + L); }
    else DSP.env(g.gain, t0, { a: 0.002, d: L, peak: amp });
    DSP.chain(n, f, g, out);
    return f;
  }

  R({
    id: 'static', name: 'Static / Interference', category: 'Electric', icon: '📻',
    params: [
      P.sel('type', 'Type', ['radio', 'tv', 'interference', 'geiger', 'hiss', 'dialup'], 'radio'),
      P.r('length', 'Length', 0.2, 10, 2, 's'), P.r('density', 'Density', 0, 1, 0.6), P.r('bright', 'Brightness', 0, 1, 0.5),
      P.r('tone', 'Tone bleed', 0, 1, 0.2), P.r('tuning', 'Tuning drift', 0, 1, 0.3), P.tog('loop', 'Seamless loop', true),
    ],
    duration(p) { return p.length + 0.1; },
    build(ctx, out, p, rng, t0) {
      const L = p.length;
      const edge = (g, v) => { if (p.loop) { g.gain.setValueAtTime(v, t0); g.gain.setValueAtTime(v, t0 + L); } else DSP.env(g.gain, t0, { a: 0.05, d: 0.05, s: 1, hold: L - 0.2, r: 0.1, peak: v, curve: 'lin' }); };
      if (p.type === 'geiger') { arcCrackle(ctx, out, rng, t0, L, { rate: 5 + p.density * 120, amp: 0.9, freq: 2500 + p.bright * 4000, Q: 4 }); return; }
      // broadband bed
      const n = DSP.noise(ctx, rng, t0, L, p.type === 'hiss' ? 'pink' : 'white');
      const f = DSP.filter(ctx, p.type === 'tv' ? 'highpass' : 'bandpass', p.type === 'tv' ? 2000 + p.bright * 6000 : 800 + p.bright * 3500, p.type === 'interference' ? 2 : 0.5);
      const g = DSP.gain(ctx, 0); edge(g, 0.15 + p.density * 0.45);
      if (p.tuning > 0 && p.type !== 'hiss') { const segs = 3 + Math.round(p.tuning * 10 * L); f.frequency.setValueAtTime(f.frequency.value, t0); for (let i = 1; i <= segs; i++) f.frequency.exponentialRampToValueAtTime(f.frequency.value * rng.range(1 - p.tuning * 0.6, 1 + p.tuning * 0.9), t0 + (i / segs) * L); }
      DSP.chain(n, f, g, out);
      // amplitude flutter (bursts) for radio/interference
      if (p.type === 'radio' || p.type === 'interference' || p.type === 'dialup') { const segs = Math.round(L * (8 + p.density * 30)); g.gain.setValueAtTime(g.gain.value, t0); for (let i = 1; i < segs; i++) g.gain.linearRampToValueAtTime((0.15 + p.density * 0.45) * rng.range(0.2, 1.4), t0 + (i / segs) * L); g.gain.linearRampToValueAtTime(p.loop ? 0.15 + p.density * 0.45 : 0, t0 + L); }
      // crackle pops
      arcCrackle(ctx, out, rng, t0, L, { rate: 10 + p.density * 200, amp: 0.25 + p.density * 0.4, freq: 3000 + p.bright * 3000, Q: 1 });
      // tone bleed / carrier whine
      if (p.tone > 0 || p.type === 'dialup') {
        const carriers = p.type === 'dialup' ? [1200, 2100, 2400, 980] : [rng.range(600, 2400)];
        carriers.forEach((fr, i) => {
          const o = DSP.osc(ctx, p.type === 'dialup' ? 'square' : 'sine', fr, t0, L);
          const og = DSP.gain(ctx, 0); const v = (p.type === 'dialup' ? 0.12 : p.tone * 0.15) / (i + 1);
          const segs = Math.round(L * 6); og.gain.setValueAtTime(p.loop ? v : 0, t0);
          for (let k = 1; k < segs; k++) { og.gain.linearRampToValueAtTime(rng.next() < 0.5 ? 0.001 : v * rng.range(0.4, 1), t0 + (k / segs) * L); if (p.type === 'dialup') o.frequency.setValueAtTime(rng.pick(carriers) * rng.pick([0.5, 1, 2]), t0 + (k / segs) * L); else o.frequency.exponentialRampToValueAtTime(fr * rng.range(0.7, 1.4), t0 + (k / segs) * L); }
          og.gain.linearRampToValueAtTime(p.loop ? v : 0, t0 + L); DSP.chain(o, og, out);
        });
      }
      if (p.type === 'tv') { const o = DSP.osc(ctx, 'sine', 15734, t0, L); const og = DSP.gain(ctx, 0); edge(og, 0.03 * p.bright); DSP.chain(o, og, out); const hum = DSP.osc(ctx, 'sawtooth', 60, t0, L); const hg = DSP.gain(ctx, 0); edge(hg, 0.05 * p.tone); DSP.chain(hum, DSP.filter(ctx, 'lowpass', 400), hg, out); }
    },
  });

  R({
    id: 'arc', name: 'Electric Arc / Spark', category: 'Electric', icon: '⚡',
    params: [
      P.sel('type', 'Type', ['arc', 'spark', 'tesla', 'welding', 'short-circuit', 'fizzle'], 'arc'),
      P.r('length', 'Length', 0.05, 5, 0.6, 's'), P.r('intensity', 'Intensity', 0, 1, 0.6), P.r('pitch', 'Pitch', 0.3, 3, 1),
      P.r('hum', 'Mains hum', 0, 1, 0.3), P.r('sizzle', 'Sizzle', 0, 1, 0.4), P.r('pops', 'Big pops', 0, 1, 0.3),
    ],
    duration(p) { return p.length + 0.5; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, k = p.pitch, I = p.intensity;
      const drv = DSP.shaper(ctx, 0.3 + I * 0.5, 'hard'); const hp = DSP.filter(ctx, 'highpass', 150, 0.7); DSP.chain(drv, hp, out);
      // dense crackle core
      const rate = { arc: 800, spark: 400, tesla: 1500, welding: 2500, 'short-circuit': 600, fizzle: 300 }[p.type] * (0.5 + I);
      const decay = p.type === 'spark' || p.type === 'fizzle';
      arcCrackle(ctx, drv, rng, t0, L, { rate, amp: 0.5 + I * 0.5, freq: 3500 * k, Q: 0.8, envShape: decay ? 'decay' : 'flat' });
      arcCrackle(ctx, drv, rng, t0, L, { rate: rate * 0.25, amp: 0.4 + I * 0.4, freq: 1200 * k, Q: 1.5, envShape: decay ? 'decay' : 'flat' });
      // sizzle hiss
      if (p.sizzle > 0) { const n = DSP.noise(ctx, rng, t0, L); const f = DSP.filter(ctx, 'highpass', 5000 * k, 0.5); const g = DSP.gain(ctx, 0); if (decay) DSP.env(g.gain, t0, { a: 0.002, d: L, peak: p.sizzle * 0.5 }); else { const segs = Math.round(L * 20); g.gain.setValueAtTime(0.001, t0); for (let i = 1; i < segs; i++) g.gain.linearRampToValueAtTime(p.sizzle * 0.5 * rng.range(0.2, 1), t0 + (i / segs) * L); g.gain.linearRampToValueAtTime(0, t0 + L); } DSP.chain(n, f, g, drv); }
      // mains hum + harmonics (tesla gets a screaming carrier)
      if (p.hum > 0) {
        const base = p.type === 'tesla' ? 240 * k : 60;
        [1, 2, 3, 5, 7].forEach((h, i) => { const o = DSP.osc(ctx, i === 0 ? 'sawtooth' : 'square', base * h, t0, L); const g = DSP.gain(ctx, 0); const v = p.hum * 0.25 / (i + 1); const segs = Math.round(L * 15); g.gain.setValueAtTime(0.001, t0); for (let s = 1; s < segs; s++) g.gain.linearRampToValueAtTime(v * rng.range(0.4, 1.2), t0 + (s / segs) * L); g.gain.linearRampToValueAtTime(0, t0 + L); if (p.type === 'tesla') { const m = DSP.osc(ctx, 'sawtooth', rng.range(20, 60), t0, L); const mg = DSP.gain(ctx, base * h * 0.15); DSP.chain(m, mg, o.frequency); } DSP.chain(o, DSP.filter(ctx, 'lowpass', 3000, 1), g, drv); });
      }
      // big pops / discharges
      if (p.pops > 0) {
        const c = p.type === 'spark' ? 1 : Math.max(1, Math.round(p.pops * 8 * L));
        for (let i = 0; i < c; i++) {
          const t = i === 0 && (decay || p.type === 'short-circuit') ? t0 : t0 + rng.next() * L * 0.9;
          DSP.hit(ctx, drv, rng, t, { thumpAmp: 0.4 * p.pops, thumpFreq: 180 * k, thumpDecay: 0.03, thumpSweep: 4, noiseAmp: 0.9, noiseType: 'highpass', noiseFreq: 2000 * k, noiseQ: 0.5, noiseDecay: 0.02 + p.pops * 0.05 });
          const o = DSP.osc(ctx, 'sawtooth', 3000 * k, t, 0.12); DSP.sweep(o.frequency, t, 4000 * k, t + 0.08, 300 * k); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.001, d: 0.06, peak: 0.35 * p.pops }); DSP.chain(o, g, drv);
        }
      }
      if (p.type === 'short-circuit') { const t = t0 + L * 0.6; const o = DSP.osc(ctx, 'square', 120, t, L * 0.4); DSP.sweep(o.frequency, t, 120, t + L * 0.4, 30); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.01, d: L * 0.4, peak: 0.4, curve: 'lin' }); DSP.chain(o, DSP.filter(ctx, 'lowpass', 800), g, out); }
      if (p.type === 'fizzle') { const o = DSP.osc(ctx, 'sine', 900 * k, t0, L); DSP.sweep(o.frequency, t0, 900 * k, t0 + L, 150 * k); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.005, d: L, peak: 0.25 }); DSP.chain(o, g, out); }
    },
  });

  R({
    id: 'zap', name: 'Zap / Shock', category: 'Electric', icon: '🔌',
    params: [
      P.sel('type', 'Type', ['zap', 'shock', 'taser', 'bug-zapper', 'lightning-strike', 'emp', 'sci-fi-zap'], 'zap'),
      P.r('length', 'Length', 0.03, 2, 0.25, 's'), P.r('pitch', 'Pitch', 0.3, 3, 1), P.r('buzz', 'Buzz', 0, 1, 0.6), P.r('crackle', 'Crackle', 0, 1, 0.6), P.r('bass', 'Bass thump', 0, 1, 0.3), P.r('rate', 'Pulse rate', 5, 120, 30, 'Hz'),
    ],
    duration(p) { return p.length + 0.6; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, k = p.pitch;
      const drv = DSP.shaper(ctx, 0.5, 'hard'); drv.connect(out);
      const decayEnv = (g, peak, len) => DSP.env(g.gain, t0, { a: 0.001, d: len, peak });
      if (p.type === 'lightning-strike' || p.type === 'emp') {
        // huge crack → decaying crackle → sub rumble
        const c = DSP.noise(ctx, rng, t0, 0.15); const cg = DSP.gain(ctx, 0); decayEnv(cg, 1.5, 0.06); DSP.chain(c, DSP.filter(ctx, 'highpass', 1200, 0.5), cg, drv);
        arcCrackle(ctx, drv, rng, t0, L, { rate: 900, amp: 0.9 * p.crackle, freq: 3000 * k, Q: 0.8, envShape: 'decay' });
        arcCrackle(ctx, drv, rng, t0, L * 1.5, { rate: 150, amp: 0.7 * p.crackle, freq: 900 * k, Q: 1.5, envShape: 'decay' });
        if (p.type === 'emp') { const o = DSP.osc(ctx, 'sawtooth', 2500 * k, t0, L); DSP.sweep(o.frequency, t0, 2500 * k, t0 + L, 40); const g = DSP.gain(ctx, 0); decayEnv(g, 0.5, L); DSP.chain(o, DSP.filter(ctx, 'lowpass', 6000, 3), g, drv); }
        if (p.bass > 0) { const o = DSP.osc(ctx, 'sine', 90, t0, L + 0.5); DSP.sweep(o.frequency, t0, 110, t0 + 0.4, 35); const g = DSP.gain(ctx, 0); decayEnv(g, p.bass * 1.2, L + 0.4); DSP.chain(o, g, out); const n = DSP.noise(ctx, rng, t0, L + 0.5, 'brown'); const ng = DSP.gain(ctx, 0); decayEnv(ng, p.bass * 1.5, L + 0.4); DSP.chain(n, DSP.filter(ctx, 'lowpass', 250), ng, out); }
        return;
      }
      // buzzing carrier: square/saw with pulse AM at `rate`
      if (p.buzz > 0) {
        const f0 = { zap: 1400, shock: 700, taser: 900, 'bug-zapper': 2200, 'sci-fi-zap': 1800 }[p.type] * k;
        const o = DSP.osc(ctx, p.type === 'sci-fi-zap' ? 'sawtooth' : 'square', f0, t0, L);
        if (p.type === 'zap' || p.type === 'sci-fi-zap') DSP.sweep(o.frequency, t0, f0 * 1.5, t0 + L, f0 * 0.25);
        else { const m = DSP.osc(ctx, 'sawtooth', rng.range(30, 90), t0, L); const mg = DSP.gain(ctx, f0 * 0.3); DSP.chain(m, mg, o.frequency); }
        const g = DSP.gain(ctx, 0);
        if (p.type === 'zap' || p.type === 'sci-fi-zap') decayEnv(g, p.buzz * 0.5, L);
        else { const per = 1 / p.rate; const n = Math.floor(L / per); g.gain.setValueAtTime(0, t0); for (let i = 0; i < n; i++) { const t = t0 + i * per; g.gain.linearRampToValueAtTime(p.buzz * 0.5 * rng.range(0.6, 1), t + 0.002); g.gain.setValueAtTime(p.buzz * 0.5 * rng.range(0.6, 1), t + per * 0.5); g.gain.linearRampToValueAtTime(0.001, t + per * 0.6); } g.gain.linearRampToValueAtTime(0, t0 + L); }
        DSP.chain(o, DSP.filter(ctx, 'lowpass', 7000 * k, 2), g, drv);
        if (p.type === 'sci-fi-zap') { const o2 = DSP.osc(ctx, 'square', f0 * 2.01, t0, L); DSP.sweep(o2.frequency, t0, f0 * 3, t0 + L, f0 * 0.5); const g2 = DSP.gain(ctx, 0); decayEnv(g2, p.buzz * 0.25, L * 0.6); DSP.chain(o2, g2, drv); }
      }
      // crackle
      if (p.crackle > 0) { arcCrackle(ctx, drv, rng, t0, L, { rate: 400 + p.crackle * 1200, amp: p.crackle * 0.8, freq: 4000 * k, Q: 0.8, envShape: p.type === 'zap' || p.type === 'sci-fi-zap' ? 'decay' : 'flat' }); const n = DSP.noise(ctx, rng, t0, L); const ng = DSP.gain(ctx, 0); decayEnv(ng, p.crackle * 0.3, L); DSP.chain(n, DSP.filter(ctx, 'bandpass', 5000 * k, 1), ng, drv); }
      // initial snap
      DSP.hit(ctx, drv, rng, t0, { thumpAmp: p.bass * 0.6, thumpFreq: 120 * k, thumpDecay: 0.05, thumpSweep: 4, noiseAmp: 0.8, noiseType: 'highpass', noiseFreq: 2500 * k, noiseQ: 0.5, noiseDecay: 0.015 });
      if (p.type === 'bug-zapper') { const t = t0 + L * 0.5; DSP.hit(ctx, drv, rng, t, { thumpAmp: 0.2, thumpFreq: 200, thumpDecay: 0.02, noiseAmp: 1, noiseType: 'highpass', noiseFreq: 3000, noiseQ: 0.5, noiseDecay: 0.03 }); }
    },
  });

  R({
    id: 'hum', name: 'Electric Hum / Buzz', category: 'Electric', icon: '💡',
    params: [
      P.sel('type', 'Type', ['mains-hum', 'fluorescent', 'transformer', 'neon', 'forcefield', 'servo', 'power-up', 'power-down'], 'mains-hum'),
      P.r('length', 'Length', 0.2, 10, 3, 's'), P.r('freq', 'Base freq', 30, 400, 60, 'Hz'), P.r('harmonics', 'Harmonics', 0, 1, 0.5), P.r('buzz', 'Buzz (dirt)', 0, 1, 0.3), P.r('flicker', 'Flicker', 0, 1, 0.2), P.tog('loop', 'Seamless loop', true),
    ],
    duration(p) { return p.length + 0.3; },
    build(ctx, out, p, rng, t0) {
      const L = p.length; const sweep = p.type === 'power-up' ? 1 : p.type === 'power-down' ? -1 : 0;
      const bus = DSP.gain(ctx, 1); const sh = DSP.shaper(ctx, p.buzz * 0.6, 'soft'); const lp = DSP.filter(ctx, 'lowpass', 1500 + p.harmonics * 5000, 1); const g = DSP.gain(ctx, 0);
      DSP.chain(bus, sh, lp, g, out);
      if (sweep > 0) { g.gain.setValueAtTime(0.001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + L * 0.8); g.gain.setValueAtTime(0.5, t0 + L - 0.02); g.gain.linearRampToValueAtTime(0, t0 + L); }
      else if (sweep < 0) { g.gain.setValueAtTime(0.5, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + L); }
      else if (p.loop) { g.gain.setValueAtTime(0.45, t0); g.gain.setValueAtTime(0.45, t0 + L); }
      else DSP.env(g.gain, t0, { a: 0.05, d: 0.05, s: 1, hold: L - 0.3, r: 0.2, peak: 0.45, curve: 'lin' });
      if (p.flicker > 0) { const segs = Math.round(L * (6 + p.flicker * 40)); const base = g.gain.value || 0.45; const v0 = sweep ? null : base; if (v0 !== null) { g.gain.setValueAtTime(v0, t0); for (let i = 1; i < segs; i++) g.gain.linearRampToValueAtTime(rng.next() < p.flicker * 0.4 ? v0 * 0.05 : v0 * rng.range(0.7, 1.1), t0 + (i / segs) * L); g.gain.linearRampToValueAtTime(p.loop ? v0 : 0, t0 + L); } }
      const mul = { 'mains-hum': 1, fluorescent: 2, transformer: 1, neon: 2, forcefield: 1.5, servo: 4, 'power-up': 1, 'power-down': 1 }[p.type];
      const f0 = p.freq * mul; const f1 = sweep > 0 ? f0 * 4 : sweep < 0 ? f0 * 0.2 : f0;
      const hs = p.type === 'transformer' ? [1, 2, 3, 4, 5, 6, 7, 8] : p.type === 'fluorescent' || p.type === 'neon' ? [1, 2, 4, 8, 16] : p.type === 'forcefield' ? [1, 1.01, 2, 2.02, 3.5] : [1, 2, 3, 5];
      hs.forEach((h, i) => { const o = DSP.osc(ctx, p.type === 'servo' || p.type === 'forcefield' ? 'sawtooth' : i === 0 ? 'sine' : 'square', f0 * h, t0, L); if (sweep) DSP.sweep(o.frequency, t0, f0 * h, t0 + L * 0.8, f1 * h); const og = DSP.gain(ctx, (i === 0 ? 0.5 : 0.3 * p.harmonics) / Math.pow(i + 1, 0.7)); DSP.chain(o, og, bus); });
      if (p.type === 'fluorescent' || p.type === 'neon' || p.buzz > 0.5) { const n = DSP.noise(ctx, rng, t0, L, 'pink'); const nf = DSP.filter(ctx, 'bandpass', 4500, 1.5); const ng = DSP.gain(ctx, 0.15 * Math.max(p.buzz, p.type === 'fluorescent' ? 0.6 : 0.3)); DSP.chain(n, nf, ng, bus); arcCrackle(ctx, bus, rng, t0, L, { rate: 20 + p.buzz * 100, amp: 0.25 + p.buzz * 0.3, freq: 5000, Q: 2 }); }
      if (p.type === 'forcefield') { const l = DSP.osc(ctx, 'sine', 0.8 + p.flicker * 4, t0, L); const lg = DSP.gain(ctx, 800); DSP.chain(l, lg, lp.frequency); const n = DSP.noise(ctx, rng, t0, L, 'pink'); const nf = DSP.filter(ctx, 'bandpass', 2500, 4); const nl = DSP.osc(ctx, 'sine', 3.1, t0, L); const nlg = DSP.gain(ctx, 1500); DSP.chain(nl, nlg, nf.frequency); DSP.chain(n, nf, DSP.gain(ctx, 0.2), bus); }
      if (p.type === 'servo') { const segs = Math.round(L * 5); const o = DSP.osc(ctx, 'triangle', f0 * 0.5, t0, L); o.frequency.setValueAtTime(f0 * 0.5, t0); for (let i = 1; i <= segs; i++) o.frequency.linearRampToValueAtTime(f0 * 0.5 * rng.range(0.6, 1.6), t0 + (i / segs) * L); DSP.chain(o, DSP.gain(ctx, 0.3), bus); }
      if (p.type === 'power-down') { const t = t0 + L * 0.85; DSP.hit(ctx, out, rng, t, { thumpAmp: 0.3, thumpFreq: 80, thumpDecay: 0.08, noiseAmp: 0.3, noiseFreq: 1500, noiseQ: 1, noiseDecay: 0.04, ring: [900, 1500], ringAmp: 0.15, ringDecay: 0.1 }); }
      if (p.type === 'power-up') { const t = t0 + L * 0.8; DSP.hit(ctx, out, rng, t, { thumpAmp: 0.2, thumpFreq: 150, thumpDecay: 0.05, noiseAmp: 0.4, noiseType: 'highpass', noiseFreq: 3000, noiseQ: 0.5, noiseDecay: 0.05 }); }
    },
  });
})();
