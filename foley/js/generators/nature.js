/* Nature, weather, elements, ambiences. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  R({
    id: 'rain', name: 'Rain', category: 'Nature', icon: '🌧️',
    params: [P.r('length', 'Length', 0.5, 10, 3, 's'), P.r('density', 'Density', 0, 1, 0.5), P.r('drops', 'Distinct drops', 0, 1, 0.4), P.r('bright', 'Brightness', 0, 1, 0.5), P.sel('surface', 'Surface', ['ground', 'window', 'roof', 'leaves', 'water'], 'ground'), P.tog('loop', 'Seamless loop', true)],
    duration(p) { return p.length + 0.1; },
    build(ctx, out, p, rng, t0) {
      // Rain IS the drops: thousands of impacts rendered in JS, each a surface-specific event (plip / ping / thud / tick),
      // with a distance split — near drops stay distinct, far ones fuse (quieter, low-passed) into the "bed". No noise floor.
      const L = p.length, sr = ctx.sampleRate, n = Math.ceil((L + 0.06) * sr);
      const Lc = new Float32Array(n), Rc = new Float32Array(n);
      const total = Math.min(60000, Math.round(L * (600 + p.density * 3400)));
      const surf = p.surface; const bright = p.bright;
      const envAt = u => p.loop ? 1 : Math.min(1, u * 3.3) * Math.min(1, (1 - u) * 3.3);
      for (let k = 0; k < total; k++) {
        const u = rng.next(); const e = envAt(u); if (rng.next() > e) continue;
        const i = Math.floor(u * L * sr); const dist = Math.pow(rng.next(), 0.5);            // 0 near .. 1 far (most drops are far)
        const near = 1 - dist; const a0 = (0.03 + near * near * 0.6) * (0.5 + p.drops * 0.7) * rng.range(0.4, 1);
        const lpc = 0.08 + near * 0.9 * (0.4 + bright * 0.6);                                     // per-drop one-pole: far = dull
        const pan = rng.range(-1, 1) * (0.3 + near * 0.7); const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
        let len, gen;
        if (surf === 'water') { const f = rng.range(500, 2200) * (0.7 + bright * 0.5); len = Math.round(sr * rng.range(0.012, 0.045)); gen = q => Math.sin(2 * Math.PI * f * (1 + 0.8 * q / len) * q / sr) * Math.exp(-q / (len * 0.4)); }          // bubble plip: rising sine
        else if (surf === 'leaves') { len = Math.round(sr * rng.range(0.004, 0.012)); let s = 0; gen = q => { s += ((rng.next() * 2 - 1) - s) * 0.25; return s * 2 * Math.exp(-q / (len * 0.3)); }; }                                                       // soft thud
        else if (surf === 'window') { const f = rng.range(3500, 8000) * (0.8 + bright * 0.4); len = Math.round(sr * rng.range(0.001, 0.004)); gen = q => (Math.sin(2 * Math.PI * f * q / sr) + 0.5 * Math.sin(2 * Math.PI * f * 1.6 * q / sr)) * Math.exp(-q / (len * 0.3)); } // sharp tick
        else if (surf === 'roof') { const f = rng.range(900, 2600) * (0.8 + bright * 0.4); len = Math.round(sr * rng.range(0.006, 0.02)); const r2 = rng.range(1.5, 2.2); gen = q => (Math.sin(2 * Math.PI * f * q / sr) * Math.exp(-q / (len * 0.35)) + 0.6 * Math.sin(2 * Math.PI * f * r2 * q / sr) * Math.exp(-q / (len * 0.15))); } // metal/tile ping
        else { const f = rng.range(1300, 3600) * (0.8 + bright * 0.5); len = Math.round(sr * rng.range(0.004, 0.012)); const r2 = rng.range(1.5, 2.4); gen = q => (Math.sin(2 * Math.PI * f * q / sr) * Math.exp(-q / (len * 0.3)) + 0.4 * Math.sin(2 * Math.PI * f * r2 * q / sr) * Math.exp(-q / (len * 0.12))); } // ground: damped ping (wet ground is duller than it looks)
        let lp = 0; for (let q = 0; q < len && i + q < n; q++) { const s = gen(q); lp += (s - lp) * lpc; const v = lp * a0; Lc[i + q] += v * gl; Rc[i + q] += v * gr; }
      }
      if (p.loop) { const F = Math.min(Math.floor(n * 0.05), Math.floor(sr * 0.25)); const N = Math.ceil(L * sr); for (let i = 0; i < F; i++) { const a = i / F; Lc[i] = Lc[i] * a + Lc[N - F + i] * (1 - a); Rc[i] = Rc[i] * a + Rc[N - F + i] * (1 - a); Lc[N - F + i] *= (1 - a); Rc[N - F + i] *= (1 - a); } }
      let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(Lc[i]), Math.abs(Rc[i])); const norm = peak > 0 ? 0.8 / peak : 1;
      const buf = ctx.createBuffer(2, n, sr); const cl = buf.getChannelData(0), cr = buf.getChannelData(1); for (let i = 0; i < n; i++) { cl[i] = Lc[i] * norm; cr[i] = Rc[i] * norm; }
      const s = ctx.createBufferSource(); s.buffer = buf; s.start(t0); s.stop(t0 + L + 0.05);
      const tilt = DSP.filter(ctx, 'lowpass', 3800 + bright * 6000, 0.55); const g = DSP.gain(ctx, 0.15 + p.density * 0.35);
      DSP.chain(s, tilt, g, out);
      if (surf === 'water') { const w = DSP.noise(ctx, rng, t0, L, 'pink'); const wf = DSP.filter(ctx, 'lowpass', 900, 0.7); const wg = DSP.gain(ctx, 0); if (p.loop) { wg.gain.setValueAtTime(0.08 * p.density, t0); wg.gain.setValueAtTime(0.08 * p.density, t0 + L); } else DSP.env(wg.gain, t0, { a: L * 0.3, d: L * 0.2, s: 1, hold: L * 0.2, r: L * 0.3, peak: 0.08 * p.density, curve: 'lin' }); DSP.chain(w, wf, wg, out); } // water surface wash
    },
  });

  R({
    id: 'wind', name: 'Wind', category: 'Nature', icon: '🌬️',
    params: [P.r('length', 'Length', 0.5, 12, 4, 's'), P.r('strength', 'Strength', 0, 1, 0.5), P.r('gusts', 'Gustiness', 0, 1, 0.5), P.r('howl', 'Howl', 0, 1, 0.3), P.r('freq', 'Tone', 100, 2000, 500, 'Hz'), P.r('foliage', 'Foliage rustle', 0, 1, 0.3), P.tog('loop', 'Seamless loop', true)],
    duration(p) { return p.length + 0.1; },
    build(ctx, out, p, rng, t0) {
      // Turbulence with coherence: one gust envelope (speed) drives several correlated resonant bands whose centre
      // frequency scales with speed (Strouhal), a whistle whose pitch tracks speed, and foliage rustle gated by the gusts.
      const L = p.length; const segs = Math.max(3, Math.round(L * (1.5 + p.gusts * 3)));
      const pts = []; for (let i = 0; i <= segs; i++) pts.push(rng.range(1 - p.gusts * 0.85, 1 + p.gusts * 0.7)); if (p.loop) pts[segs] = pts[0];
      const speedAt = u => { const x = u * segs; const i = Math.min(segs - 1, Math.floor(x)); const f = x - i; const s = pts[i] * (1 - f) + pts[i + 1] * f; return Math.max(0.05, s * (0.25 + p.strength * 0.75)); };
      const ramp = (param, fn, exp) => { param.setValueAtTime(fn(0), t0); for (let i = 1; i <= segs * 2; i++) { const u = i / (segs * 2); const v = fn(u); if (exp) param.exponentialRampToValueAtTime(Math.max(1e-4, v), t0 + u * L); else param.linearRampToValueAtTime(v, t0 + u * L); } };
      // decorrelated stereo: independent noise per side (shared envelopes), lows stay centred
      const srcL = DSP.noise(ctx, rng, t0, L, 'pink'), srcR = DSP.noise(ctx, rng, t0, L, 'pink'); const src2 = DSP.noise(ctx, rng, t0, L, 'velvet');
      const master = DSP.gain(ctx, 1); const tilt = DSP.filter(ctx, 'lowpass', 2200 + p.strength * 5000, 0.5); DSP.chain(master, tilt, out);
      const fadeG = DSP.gain(ctx, 1); if (!p.loop) DSP.env(fadeG.gain, t0, { a: L * 0.15, d: 0.05, s: 1, hold: L * 0.55, r: L * 0.3, peak: 1, curve: 'lin' }); fadeG.connect(master);
      const panL = DSP.pan(ctx, -0.75), panR = DSP.pan(ctx, 0.75); panL.connect(fadeG); panR.connect(fadeG);
      // correlated flow bands (ratios fixed, all follow speed); each band exists on both sides with its own noise
      [[0.45, 0.9, 0.7], [1, 1, 1.2], [1.9, 0.5, 1.6], [3.4, 0.25, 2.2]].forEach(([r, a, q]) => {
        [[srcL, r < 1 ? fadeG : panL], [srcR, r < 1 ? fadeG : panR]].forEach(([src, dest], side) => {
          const f = DSP.filter(ctx, 'bandpass', p.freq * r, q + p.howl * 2); ramp(f.frequency, u => DSP.clamp(p.freq * r * (0.55 + speedAt(u) * 0.9) * (side ? 1.03 : 0.97), 40, 16000), true);
          const g = DSP.gain(ctx, 0); ramp(g.gain, u => a * Math.pow(speedAt(u), 1.6) * (r < 1 ? 0.45 : 0.7), false);
          DSP.chain(src, f, g, dest); if (r >= 1.9) DSP.chain(src2, f, DSP.gain(ctx, 0.12), g);
        });
      });
      // Aeolian whistle: pitch ∝ speed, only audible in strong gusts
      if (p.howl > 0) { const o = DSP.osc(ctx, 'sine', p.freq * 1.5, t0, L); ramp(o.frequency, u => p.freq * 1.5 * (0.6 + speedAt(u) * 0.9), true); const v = DSP.osc(ctx, 'sine', 4.5, t0, L); DSP.chain(v, DSP.gain(ctx, 12), o.detune); const hg = DSP.gain(ctx, 0); ramp(hg.gain, u => p.howl * 0.28 * Math.pow(Math.max(0, speedAt(u) - 0.35) / 0.65, 2.5), false); DSP.chain(o, hg, fadeG); }
      // foliage: velvet rustle through leaf bands, gated by the gust envelope (breathes with the wind)
      if (p.foliage > 0) { const rn = DSP.noise(ctx, rng, t0, L, 'velvet'); const rf = DSP.filter(ctx, 'bandpass', 3200, 0.9); const rg = DSP.gain(ctx, 0); ramp(rg.gain, u => p.foliage * 0.35 * Math.pow(speedAt(u), 2.2), false); DSP.chain(rn, rf, DSP.filter(ctx, 'lowpass', 7000, 0.5), rg, fadeG); }
      // low pressure body
      const lb = DSP.noise(ctx, rng, t0, L, 'brown'); const lf = DSP.filter(ctx, 'lowpass', 140, 1); const lg = DSP.gain(ctx, 0); ramp(lg.gain, u => 0.5 * Math.pow(speedAt(u), 1.4) * (0.4 + p.strength), false); DSP.chain(lb, lf, lg, fadeG);
    },
  });

  R({
    id: 'thunder', name: 'Thunder', category: 'Nature', icon: '⛈️',
    params: [P.r('distance', 'Distance', 0, 1, 0.4), P.r('length', 'Rumble length', 0.5, 6, 2.5, 's'), P.r('crack', 'Crack', 0, 1, 0.6), P.r('rolls', 'Rolls', 0, 8, 3)],
    duration(p) { return p.length + 1; },
    build(ctx, out, p, rng, t0) {
      const d = p.distance, L = p.length;
      const t = t0;
      if (p.crack > 0 && d < 0.7) { const c = DSP.noise(ctx, rng, t, 0.3); const cf = DSP.filter(ctx, 'highpass', 800, 0.5); const cg = DSP.gain(ctx, 0); DSP.env(cg.gain, t, { a: 0.002, d: 0.15, peak: p.crack * (1 - d) * 1.5 }); DSP.chain(c, cf, cg, out); const cr = DSP.noise(ctx, rng, t, 0.4, 'crackle'); const crg = DSP.gain(ctx, 0); DSP.env(crg.gain, t, { a: 0.002, d: 0.3, peak: p.crack * (1 - d) * 2 }); DSP.chain(cr, crg, out); }
      const n = DSP.noise(ctx, rng, t, L + 0.5, 'brown');
      const f = DSP.filter(ctx, 'lowpass', 400 - d * 250, 1);
      const g = DSP.gain(ctx, 0);
      g.gain.setValueAtTime(0.0005, t); g.gain.exponentialRampToValueAtTime(2 + (1 - d) * 2, t + 0.05 + d * 0.5);
      const rolls = Math.round(p.rolls);
      for (let i = 1; i <= rolls; i++) { const tt = t + (i / (rolls + 1)) * L; g.gain.exponentialRampToValueAtTime(rng.range(0.5, 3) * (1 - i / (rolls + 2)), tt); f.frequency.exponentialRampToValueAtTime(rng.range(100, 500) * (1 - d * 0.6), tt); }
      g.gain.exponentialRampToValueAtTime(0.0005, t + L + 0.4);
      DSP.chain(n, f, g, out);
      const o = DSP.osc(ctx, 'sine', 45, t, L); DSP.sweep(o.frequency, t, 60, t + L, 30); const og = DSP.gain(ctx, 0); DSP.env(og.gain, t, { a: 0.1 + d * 0.4, d: L * 0.8, peak: 0.8, r: 0.3 }); DSP.chain(o, og, out);
    },
  });

  R({
    id: 'fire', name: 'Fire', category: 'Nature', icon: '🔥',
    params: [P.r('length', 'Length', 0.5, 10, 3, 's'), P.r('size', 'Size', 0, 1, 0.5), P.r('crackle', 'Crackle', 0, 1, 0.6), P.r('roar', 'Roar', 0, 1, 0.4), P.tog('loop', 'Seamless loop', true), P.tog('torch', 'Torch flutter', false)],
    duration(p) { return p.length + 0.1; },
    build(ctx, out, p, rng, t0) {
      const L = p.length;
      // roar: turbulent combustion, decorrelated left/right (independent brown noise per side, shared flutter envelope)
      const g = DSP.gain(ctx, 0); g.connect(out);
      const base = p.roar * (0.6 + p.size * 0.8);
      g.gain.setValueAtTime(p.loop ? base : 0.0005, t0);
      const segs = Math.round(L * (p.torch ? 12 : 4));
      for (let i = 1; i < segs; i++) g.gain.linearRampToValueAtTime(base * rng.range(0.5, 1.3), t0 + (i / segs) * L);
      g.gain.linearRampToValueAtTime(p.loop ? base : 0, t0 + L);
      [-0.6, 0.6].forEach(side => { const n = DSP.noise(ctx, rng, t0, L, 'brown'); const f = DSP.filter(ctx, 'lowpass', (300 + p.size * 600) * (side < 0 ? 0.95 : 1.05), 0.8); DSP.chain(n, f, DSP.pan(ctx, side), g); });
      { const n = DSP.noise(ctx, rng, t0, L, 'brown'); const f = DSP.filter(ctx, 'lowpass', 120, 1); DSP.chain(n, f, DSP.gain(ctx, 0.7), g); } // centred low body
      [-0.7, 0.7].forEach(side => { const hiss = DSP.noise(ctx, rng, t0, L, 'pink'); const hf = DSP.filter(ctx, 'highpass', 3000, 0.5); const hg = DSP.gain(ctx, 0.06 + p.size * 0.08); DSP.chain(hiss, hf, hg, DSP.pan(ctx, side), out); });
      // crackle: real events — resin pops are tiny wood-stick hits with a steam hiss, plus fine ember ticks
      const count = Math.min(400, Math.round(p.crackle * 22 * L * (0.5 + p.size)));
      const sticks = Foley.Materials.woodBanks(ctx, out, rng, 'stick', 0.55, 3);
      for (let i = 0; i < count; i++) {
        const t = t0 + rng.next() * L; const big = rng.next() < 0.25;
        if (big) { Foley.Materials.woodHit(ctx, out, rng, t, { kind: 'stick', size: rng.range(0.4, 0.8), force: rng.range(0.5, 1), hardness: 0.9, amp: rng.range(0.25, 0.6), shared: sticks, double: 0 }); const h = DSP.noise(ctx, rng, t, 0.06, 'velvet'); const hf = DSP.filter(ctx, 'bandpass', rng.range(2500, 5000), 2); const hg = DSP.gain(ctx, 0); DSP.env(hg.gain, t + 0.002, { a: 0.002, d: rng.range(0.01, 0.04), peak: 0.25 }); DSP.chain(h, hf, hg, out); }
        else { const f = rng.range(2200, 6500); const len = rng.range(0.002, 0.007); const o = DSP.osc(ctx, 'sine', f, t, len + 0.01); const o2 = DSP.osc(ctx, 'sine', f * rng.range(1.5, 2.3), t, len); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.0004, d: len, peak: rng.range(0.08, 0.3) }); const g2 = DSP.gain(ctx, 0); DSP.env(g2.gain, t, { a: 0.0004, d: len * 0.4, peak: rng.range(0.04, 0.15) }); DSP.chain(o, g, out); DSP.chain(o2, g2, out); }
      }
    },
  });

  R({
    id: 'water', name: 'Water', category: 'Nature', icon: '💧',
    params: [P.sel('type', 'Type', ['splash', 'drip', 'bubbles', 'stream', 'pour', 'dive'], 'splash'), P.r('size', 'Size', 0, 1, 0.5), P.r('length', 'Length', 0.1, 6, 0.8, 's'), P.r('detail', 'Detail', 0, 1, 0.5)],
    duration(p) { return p.length + 0.4; },
    build(ctx, out, p, rng, t0) {
      // Water is bubbles: a Minnaert-resonance bubble cloud (core/materials.js) is the sound; the only noise is
      // low turbulence under it. Bigger "size" = bigger bubbles (lower) and more of them.
      const L = p.length, sz = 0.5 + p.size;
      const cloud = (t, len, o) => { const b = Foley.Materials.bubbleBuffer(ctx, rng, len, Object.assign({ rMin: 0.0007 * sz, rMax: 0.005 * sz, pan: 0.7 }, o)); const s = ctx.createBufferSource(); s.buffer = b; s.start(t); s.stop(t + len + 0.1); const g = DSP.gain(ctx, o.gain === undefined ? 1 : o.gain); DSP.chain(s, DSP.filter(ctx, 'lowpass', 9000, 0.5), g, out); return g; };
      const turb = (t, len, amp, hz, envFn) => { const n = DSP.noise(ctx, rng, t, len, 'pink'); const f = DSP.filter(ctx, 'lowpass', hz, 0.7); const g = DSP.gain(ctx, 0); if (envFn) envFn(g.gain, t, len, amp); else DSP.env(g.gain, t, { a: 0.01, d: len, peak: amp }); DSP.chain(n, f, g, out); };
      const det = 0.4 + p.detail * 1.2;
      if (p.type === 'splash' || p.type === 'dive') {
        // entry: cavity thud + turbulence burst, then a dense bubble cloud that thins out as the surface closes
        DSP.hit(ctx, out, rng, t0, { thumpAmp: 0.5 * p.size, thumpFreq: 70 / Math.sqrt(sz), thumpDecay: 0.12, noiseAmp: 0.35, noiseColor: 'pink', noiseType: 'lowpass', noiseFreq: 1500, noiseQ: 0.6, noiseDecay: 0.05 + p.size * 0.06 });
        turb(t0, L, 0.4 + p.size * 0.3, 2500, (g, t, len, a) => { DSP.env(g, t, { a: p.type === 'dive' ? 0.06 : 0.008, d: len * 0.8, peak: a }); });
        cloud(t0 + (p.type === 'dive' ? 0.03 : 0.005), L, { rate: 900 * det * (0.5 + p.size), env: u => Math.pow(1 - u, 1.3) * Math.min(1, u * 12 + 0.2), amp: 0.5, chirp: 0.6 });
        cloud(t0 + 0.05, L, { rate: 60 * det, rMin: 0.003 * sz, rMax: 0.012 * sz, env: u => Math.pow(1 - u, 0.8), amp: 0.5, chirp: 0.4 }); // a few big "bloops"
      } else if (p.type === 'drip') {
        const c = Math.max(1, Math.round(L * 3 * p.detail)); for (let i = 0; i < c; i++) { const t = t0 + (i === 0 ? 0 : rng.next() * L); cloud(t, 0.25, { rate: 24, rMin: 0.002 * sz, rMax: 0.0045 * sz, env: u => u < 0.15 ? 1 : 0.15 * Math.pow(1 - u, 2), amp: 0.9, chirp: 0.8 }); DSP.hit(ctx, out, rng, t, { thumpAmp: 0, noiseAmp: 0.18, noiseColor: 'pink', noiseType: 'lowpass', noiseFreq: 2500, noiseQ: 0.7, noiseDecay: 0.012 }); }
      } else if (p.type === 'bubbles') {
        cloud(t0, L, { rate: (8 + p.detail * 30), rMin: 0.002 * sz, rMax: 0.011 * sz, amp: 0.8, chirp: 0.7, env: u => 1 });
        turb(t0, L, 0.06, 600, (g, t, len, a) => { g.setValueAtTime(a, t); g.setValueAtTime(a, t + len); });
      } else { // stream / pour: continuous bubble cloud + low turbulence; pour swells in and tails off
        const envFn = p.type === 'pour' ? (u => Math.min(1, u * 5) * Math.min(1, (1 - u) * 5)) : (u => 1);
        cloud(t0, L, { rate: 500 * det, rMin: 0.0006 * sz, rMax: 0.004 * sz, env: envFn, amp: 0.45, chirp: 0.5 });
        cloud(t0, L, { rate: 20 * det, rMin: 0.003 * sz, rMax: 0.009 * sz, env: envFn, amp: 0.4, chirp: 0.5 });
        turb(t0, L, 0.28, 1200 * (0.6 + p.size * 0.5), (g, t, len, a) => { if (p.type === 'pour') DSP.env(g, t, { a: len * 0.2, d: len * 0.3, s: 0.8, hold: len * 0.3, r: len * 0.2, peak: a, curve: 'lin' }); else { g.setValueAtTime(a, t); g.setValueAtTime(a, t + len); } });
      }
    },
  });

  /* ---- Ice: dispersive cracks (downward chirps), glacial groans, fracture propagation, calving ---- */
  R({
    id: 'ice', name: 'Ice / Glacier', category: 'Nature', icon: '🧊',
    params: [
      P.sel('type', 'Type', ['crack', 'fracture-spread', 'groan', 'glacier', 'calving', 'creak', 'shatter', 'freeze'], 'crack'),
      P.r('length', 'Length', 0.2, 10, 2, 's'), P.r('thickness', 'Thickness', 0, 1, 0.7), P.r('size', 'Body size', 0, 1, 0.6),
      P.r('chirp', 'Chirp (dispersion)', 0, 1, 0.7), P.r('crackle', 'Crackle', 0, 1, 0.5), P.r('groan', 'Groan', 0, 1, 0.4), P.r('distance', 'Distance', 0, 1, 0.2), P.tog('loop', 'Seamless loop', false),
    ],
    duration(p) { return p.length + 1.5 + p.size; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, th = p.thickness, sz = p.size, d = p.distance;
      const lp = DSP.filter(ctx, 'lowpass', 14000 - d * 11000, 0.5); lp.connect(out);
      const groanBus = DSP.gain(ctx, 1); groanBus.connect(lp);

      /* One dispersive crack: a downward sine chirp (high freqs travel faster in an ice plate) + a sharp transient + a short body ring. */
      const crack = (t, amp, big) => {
        const f0 = (big ? 2600 : 4200) * (1.4 - th * 0.7) * rng.range(0.8, 1.25);
        const f1 = f0 * (0.06 + (1 - p.chirp) * 0.5);
        const len = (big ? 0.35 : 0.18) * (0.5 + p.chirp) * (0.7 + th * 0.6) * rng.range(0.8, 1.3);
        const o = DSP.osc(ctx, 'sine', f0, t, len + 0.05);
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + len * 0.25); o.frequency.exponentialRampToValueAtTime(f1, t + len);
        const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.002, d: len, peak: amp * 0.6 * p.chirp, r: 0.02 });
        DSP.chain(o, g, lp);
        // second, slightly detuned chirp for the "laser" shimmer
        const o2 = DSP.osc(ctx, 'sine', f0 * 1.5, t + 0.004, len); o2.frequency.setValueAtTime(f0 * 1.5, t + 0.004); o2.frequency.exponentialRampToValueAtTime(f1 * 1.2, t + len * 0.7);
        const g2 = DSP.gain(ctx, 0); DSP.env(g2.gain, t + 0.004, { a: 0.002, d: len * 0.6, peak: amp * 0.25 * p.chirp }); DSP.chain(o2, g2, lp);
        // transient snap + plate body ring
        DSP.hit(ctx, lp, rng, t, { thumpAmp: amp * (0.3 + th * 0.6) * (big ? 1.4 : 0.8), thumpFreq: (big ? 55 : 90) * (1.5 - th * 0.7), thumpDecay: 0.06 + th * 0.2, thumpSweep: 2.5, noiseAmp: amp * 0.9, noiseType: 'highpass', noiseFreq: 1800, noiseQ: 0.6, noiseDecay: 0.012 + (big ? 0.03 : 0.01), ring: [180, 290, 470].map(f => f * (1.6 - th * 0.8) * rng.range(0.97, 1.03)), ringAmp: amp * 0.25 * th, ringDecay: 0.2 + th * 0.5 + sz * 0.4 });
      };
      /* Propagating fracture: a run of small crackles travelling away (panned) with a descending trend. */
      const propagate = (t, len, amp, dir) => {
        const pan = DSP.pan(ctx, 0); pan.pan.setValueAtTime(-dir * 0.2, t); pan.pan.linearRampToValueAtTime(dir * 0.9, t + len); pan.connect(lp);
        const n = Math.round(len * (12 + p.crackle * 40)); let tt = 0;
        for (let i = 0; i < n; i++) { tt += (len / n) * rng.range(0.3, 1.7); if (tt > len) break; const u = tt / len; const a = amp * (1 - u * 0.6) * rng.range(0.3, 1); if (rng.next() < 0.18 * p.chirp) crack(t + tt, a * 0.6, false); DSP.hit(ctx, pan, rng, t + tt, { thumpAmp: 0, noiseAmp: a, noiseFreq: (2500 - u * 1200) * (1.4 - th * 0.6), noiseQ: 2.5, noiseDecay: rng.range(0.006, 0.02), ring: [rng.range(700, 1600) * (1.5 - th * 0.6)], ringAmp: a * 0.3, ringDecay: 0.05 }); }
      };
      /* Deep glacial groan: detuned low oscillators with slow random pitch wander, through a resonant filter. */
      const groan = (t, len, amp) => {
        const f0 = (28 + (1 - th) * 30) * (1.3 - sz * 0.5);
        const s = DSP.stack(ctx, 'sawtooth', f0, t, len, 3, 9, rng);
        const seg = Math.max(2, Math.round(len * 2));
        s.oscs.forEach(o => { o.frequency.setValueAtTime(f0, t); for (let i = 1; i <= seg; i++) o.frequency.exponentialRampToValueAtTime(f0 * rng.range(0.75, 1.5), t + (i / seg) * len); });
        const f = DSP.filter(ctx, 'lowpass', 180 + sz * 120, 6); f.frequency.setValueAtTime(140, t); for (let i = 1; i <= seg; i++) f.frequency.exponentialRampToValueAtTime(rng.range(90, 320) * (1 + sz * 0.5), t + (i / seg) * len);
        const sh = DSP.shaper(ctx, 0.35, 'soft'); const g = DSP.gain(ctx, 0);
        if (p.loop && (p.type === 'glacier' || p.type === 'groan' || p.type === 'freeze')) { g.gain.setValueAtTime(amp, t); for (let i = 1; i < seg; i++) g.gain.linearRampToValueAtTime(amp * rng.range(0.5, 1.2), t + (i / seg) * len); g.gain.linearRampToValueAtTime(amp, t + len); }
        else DSP.env(g.gain, t, { a: len * 0.15, d: len * 0.3, s: 0.7, hold: len * 0.25, r: len * 0.3, peak: amp, curve: 'lin' });
        DSP.chain(s.node, f, sh, g, groanBus);
        // overtone "singing" of the ice sheet
        const o = DSP.osc(ctx, 'sine', f0 * 7.3, t, len); o.frequency.setValueAtTime(f0 * 7.3, t); for (let i = 1; i <= seg; i++) o.frequency.exponentialRampToValueAtTime(f0 * rng.range(5.5, 9.5), t + (i / seg) * len);
        const og = DSP.gain(ctx, 0); DSP.env(og.gain, t, { a: len * 0.3, d: len * 0.3, s: 0.5, hold: len * 0.1, r: len * 0.3, peak: amp * 0.12, curve: 'lin' }); DSP.chain(o, og, groanBus);
        // sub rumble
        const n = DSP.noise(ctx, rng, t, len, 'brown'); const nf = DSP.filter(ctx, 'lowpass', 90, 1); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, t, { a: len * 0.2, d: len * 0.3, s: 0.8, hold: len * 0.2, r: len * 0.3, peak: amp * 0.8 * sz, curve: 'lin' }); DSP.chain(n, nf, ng, groanBus);
      };

      switch (p.type) {
        case 'crack': {
          crack(t0, 1, th > 0.5);
          if (p.crackle > 0) propagate(t0 + 0.03, Math.min(L, 0.4 + p.crackle * 0.8), p.crackle * 0.6, rng.next() < 0.5 ? 1 : -1);
          if (p.groan > 0) groan(t0 + 0.05, Math.min(L, 1.2), p.groan * 0.5);
          break;
        }
        case 'fracture-spread': {
          crack(t0, 0.8, th > 0.5);
          let t = 0.05; let n = 0;
          while (t < L && n++ < 24) { const dir = rng.next() < 0.5 ? 1 : -1; const len = rng.range(0.3, 1) * (0.5 + p.crackle); propagate(t0 + t, len, 0.5 * (1 - t / L * 0.5), dir); if (rng.next() < 0.6) crack(t0 + t + rng.range(0.05, len), rng.range(0.4, 0.9) * (1 - t / L * 0.4), rng.next() < th); t += len * rng.range(0.4, 1.1); }
          if (p.groan > 0) groan(t0, L, p.groan * 0.45);
          break;
        }
        case 'groan': groan(t0, L, 0.9 * (0.4 + p.groan)); if (p.crackle > 0) { const n = Math.round(L * 3 * p.crackle); for (let i = 0; i < n; i++) crack(t0 + rng.next() * L, rng.range(0.1, 0.35), false); } break;
        case 'glacier': { // long evolving ambience: groans, sparse deep cracks, distant booms
          groan(t0, L, 0.7 * (0.4 + p.groan));
          const n = Math.round(L * (0.6 + p.crackle * 2));
          for (let i = 0; i < n; i++) { const t = t0 + rng.next() * L * 0.95; if (rng.next() < 0.5) crack(t, rng.range(0.2, 0.7), true); else DSP.hit(ctx, lp, rng, t, { thumpAmp: rng.range(0.3, 0.9), thumpFreq: 40, thumpDecay: 0.3 + sz * 0.4, thumpSweep: 2, noiseAmp: 0.3, noiseColor: 'brown', noiseType: 'lowpass', noiseFreq: 300, noiseQ: 0.7, noiseDecay: 0.25 }); }
          if (p.crackle > 0) propagate(t0 + L * rng.range(0.2, 0.6), Math.min(1.5, L * 0.3), p.crackle * 0.4, 1);
          break;
        }
        case 'calving': { // slow tearing creak → cascade of cracks → massive collapse boom → debris + water/slush
          const tear = Math.min(L * 0.45, 2.5);
          groan(t0, tear + 0.5, 0.8);
          const nt = Math.round(tear * 8); for (let i = 0; i < nt; i++) { const u = i / nt; const t = t0 + u * u * tear; crack(t, 0.3 + u * 0.7, u > 0.5); }
          propagate(t0 + tear * 0.5, tear * 0.5, 0.7, 1);
          const tb = t0 + tear;
          DSP.hit(ctx, lp, rng, tb, { thumpAmp: 1.6 + sz, thumpFreq: 32, thumpDecay: 0.7 + sz * 0.6, thumpSweep: 3.5, noiseAmp: 1.2, noiseColor: 'brown', noiseType: 'lowpass', noiseFreq: 500, noiseQ: 0.7, noiseDecay: 0.6 + sz * 0.5, drive: 0.25 });
          const rb = DSP.noise(ctx, rng, tb, L - tear + 1, 'brown'); const rf = DSP.filter(ctx, 'lowpass', 220, 1); const rg = DSP.gain(ctx, 0); DSP.env(rg.gain, tb, { a: 0.05, d: L - tear + 0.8, peak: 1.5 * (0.5 + sz), r: 0.3 }); DSP.chain(rb, rf, rg, lp);
          DSP.grains(ctx, lp, rng, tb + 0.05, { count: Math.round(30 + p.crackle * 60), spread: Math.max(0.8, L - tear), len: 0.03, lenVar: 0.8, freq: 1200 * (1.4 - th * 0.5), freqVar: 0.8, Q: 1.2, amp: 0.7, color: 'pink', decayShape: 1.3 });
          const nc = Math.round(6 + p.crackle * 10); for (let i = 0; i < nc; i++) crack(tb + 0.1 + rng.next() * Math.max(0.8, L - tear), rng.range(0.2, 0.6), rng.next() < 0.3);
          // slush / water surge
          const w = DSP.noise(ctx, rng, tb + 0.3, L - tear + 1); const wf = DSP.filter(ctx, 'bandpass', 900, 0.6); const wg = DSP.gain(ctx, 0); DSP.env(wg.gain, tb + 0.3, { a: 0.4, d: L - tear + 0.5, peak: 0.5 * sz, r: 0.3 }); DSP.chain(w, wf, wg, lp);
          break;
        }
        case 'creak': { // slow stressed creaking with tiny ticks, building to (maybe) a crack
          const o = DSP.osc(ctx, 'sawtooth', 90, t0, L); const seg = Math.max(3, Math.round(L * 10)); o.frequency.setValueAtTime(70, t0);
          for (let i = 1; i <= seg; i++) o.frequency.linearRampToValueAtTime(rng.range(45, 160) * (1.4 - th * 0.6), t0 + (i / seg) * L);
          const f = DSP.filter(ctx, 'lowpass', 700, 6); const g = DSP.gain(ctx, 0); g.gain.setValueAtTime(0.0005, t0);
          for (let i = 1; i <= seg; i++) g.gain.linearRampToValueAtTime(rng.next() < 0.35 ? 0.01 : rng.range(0.12, 0.4), t0 + (i / seg) * L); g.gain.linearRampToValueAtTime(0, t0 + L);
          DSP.chain(o, f, DSP.shaper(ctx, 0.4, 'soft'), g, lp);
          DSP.grains(ctx, lp, rng, t0, { count: Math.round(L * 25 * (0.3 + p.crackle)), spread: L, len: 0.006, freq: 3500 * (1.4 - th * 0.5), freqVar: 0.5, Q: 4, amp: 0.3, decayShape: 1 });
          if (p.groan > 0) groan(t0, L, p.groan * 0.4);
          if (p.chirp > 0.3 && rng.next() < 0.7) crack(t0 + L * rng.range(0.7, 0.95), 0.8, th > 0.5);
          break;
        }
        case 'shatter': { // thin-to-thick ice breaking under a foot/impact: crunch + many tiny chirps + splash
          DSP.hit(ctx, lp, rng, t0, { thumpAmp: 0.5 + th * 0.5, thumpFreq: 90, thumpDecay: 0.08 + th * 0.1, noiseAmp: 0.8, noiseFreq: 2500, noiseQ: 0.8, noiseDecay: 0.05 });
          DSP.grains(ctx, lp, rng, t0, { count: Math.round(20 + p.crackle * 50), spread: Math.min(L, 0.6), len: 0.012, freq: 4500 * (1.4 - th * 0.5), freqVar: 0.6, Q: 3, amp: 0.6, decayShape: 1.6 });
          const n = Math.round(6 + p.chirp * 14); for (let i = 0; i < n; i++) crack(t0 + 0.01 + Math.pow(rng.next(), 1.5) * Math.min(L, 0.6), rng.range(0.15, 0.45), false);
          if (th < 0.5) { const w = DSP.noise(ctx, rng, t0 + 0.05, 0.6); const wf = DSP.filter(ctx, 'lowpass', 2500, 0.8); DSP.sweep(wf.frequency, t0 + 0.05, 3500, t0 + 0.6, 500); const wg = DSP.gain(ctx, 0); DSP.env(wg.gain, t0 + 0.05, { a: 0.02, d: 0.5, peak: 0.5 * (1 - th) }); DSP.chain(w, wf, wg, lp); }
          break;
        }
        case 'freeze': { // ice forming / spreading: rising tingling crackle with a thin high shimmer
          const n = Math.round(L * (15 + p.crackle * 60)); for (let i = 0; i < n; i++) { const u = rng.next(); const t = t0 + u * L; const a = 0.15 + u * 0.3; DSP.hit(ctx, lp, rng, t, { thumpAmp: 0, noiseAmp: a, noiseFreq: rng.range(4000, 9000), noiseQ: 6, noiseDecay: rng.range(0.004, 0.015), ring: [rng.range(3000, 8000)], ringAmp: a * 0.5, ringDecay: 0.04 }); }
          [5200, 6900, 8400].forEach(fr => { const o = DSP.osc(ctx, 'sine', fr, t0, L); const og = DSP.gain(ctx, 0); if (p.loop) { og.gain.setValueAtTime(0.03, t0); og.gain.setValueAtTime(0.03, t0 + L); } else DSP.env(og.gain, t0, { a: L * 0.5, d: L * 0.2, s: 0.8, hold: 0, r: L * 0.3, peak: 0.04, curve: 'lin' }); DSP.chain(o, og, lp); });
          if (p.groan > 0) groan(t0, L, p.groan * 0.3);
          if (p.chirp > 0) { const nc = Math.round(L * 1.5 * p.chirp); for (let i = 0; i < nc; i++) crack(t0 + rng.next() * L, rng.range(0.15, 0.4), false); }
          break;
        }
      }
    },
  });

  R({
    id: 'creature', name: 'Creature / Bird', category: 'Nature', icon: '🐦',
    params: [P.sel('type', 'Type', ['chirp', 'tweet', 'owl', 'growl', 'roar', 'insect', 'frog', 'screech'], 'chirp'), P.r('pitch', 'Pitch', 0.4, 2.5, 1), P.r('count', 'Repeats', 1, 8, 3), P.r('rate', 'Rate', 1, 20, 6, 'Hz'), P.r('length', 'Note length', 0.02, 1.5, 0.08, 's')],
    duration(p) { return Math.round(p.count) / p.rate + p.length + 0.4; },
    build(ctx, out, p, rng, t0) {
      const n = Math.round(p.count), k = p.pitch; const V = Foley.Voice;
      for (let i = 0; i < n; i++) {
        const t = t0 + i / p.rate * rng.range(0.9, 1.1); const L = p.length * rng.range(0.8, 1.2);
        // mammal / monster vocalisations go through the vocal-tract model (glottal pulse -> formants -> breath)
        if (p.type === 'growl' || p.type === 'roar') {
          const roar = p.type === 'roar'; const size = (roar ? 2.2 : 1.7) / Math.sqrt(k); const f0 = (roar ? 110 : 70) * k; const LL = L * (roar ? 8 : 5);
          V.syllable(ctx, out, rng, t, LL, { f0: roar ? [[0, f0 * 0.8], [0.25, f0 * 1.45], [0.7, f0 * 1.2], [1, f0 * 0.7]] : [[0, f0 * 0.9], [0.5, f0 * 1.1], [1, f0 * 0.75]], vowel: roar ? 'a' : 'uh', vowel2: roar ? 'o' : 'o', morphAt: 0.5, amp: roar ? 1.1 : 0.85, attack: roar ? 0.04 : 0.08, decayFrac: 0.5, sustain: 0.75, release: LL * 0.3, rough: roar ? 0.75 : 0.9, breath: roar ? 0.35 : 0.3, size, nasal: 0.2, wave: 'sawtooth' });
          const sub = DSP.noise(ctx, rng, t, LL, 'brown'); const sf = DSP.filter(ctx, 'lowpass', 140 * k, 1); const sg = DSP.gain(ctx, 0); DSP.env(sg.gain, t, { a: 0.05, d: LL * 0.5, s: 0.6, r: LL * 0.3, peak: roar ? 0.9 : 0.6, curve: 'lin' }); DSP.chain(sub, sf, sg, out); // chest rumble
          continue;
        }
        if (p.type === 'owl') { const f0 = 380 * k; V.syllable(ctx, out, rng, t, L * 4, { f0: [[0, f0 * 0.95], [0.5, f0 * 0.9], [1, f0 * 0.82]], vowel: 'u', vowel2: 'o', morphAt: 0.6, amp: 0.7, attack: 0.04, decayFrac: 0.6, sustain: 0.8, release: L * 1.2, rough: 0.08, breath: 0.35, size: 1.1, nasal: 0.1, wave: 'triangle' }); continue; }
        if (p.type === 'frog') { const f0 = 250 * k; V.syllable(ctx, out, rng, t, L * 3, { f0: [[0, f0 * 0.9], [0.4, f0 * 1.05], [1, f0 * 0.85]], vowel: 'o', vowel2: 'uh', amp: 0.8, attack: 0.02, decayFrac: 0.6, sustain: 0.7, release: L * 0.8, rough: 0.85, breath: 0.15, size: 0.85, nasal: 0.5, wave: 'sawtooth' }); continue; }
        if (p.type === 'chirp' || p.type === 'tweet' || p.type === 'screech') {
          const f0 = (p.type === 'screech' ? 1800 : 3000) * k * rng.range(0.85, 1.15);
          const o = DSP.osc(ctx, 'sine', f0, t, L); o.frequency.setValueAtTime(f0, t);
          if (p.type === 'chirp') o.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + L);
          else if (p.type === 'tweet') { o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + L * 0.4); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + L); }
          else { const m = DSP.osc(ctx, 'sine', 30, t, L); const mg = DSP.gain(ctx, f0 * 0.15); DSP.chain(m, mg, o.frequency); o.frequency.exponentialRampToValueAtTime(f0 * 1.3, t + L); }
          const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.005, d: L, peak: 0.4, curve: 'lin' });
          const sh = p.type === 'screech' ? DSP.shaper(ctx, 0.5, 'soft') : DSP.gain(ctx, 1); DSP.chain(o, sh, g, out);
        } else if (p.type === 'insect') {
          const o = DSP.osc(ctx, 'square', 4200 * k, t, L); const m = DSP.osc(ctx, 'square', 60 * k, t, L); const mg = DSP.gain(ctx, 0); DSP.env(mg.gain, t, { a: 0.005, d: L, peak: 0.15, curve: 'lin' }); DSP.chain(o, mg, out); const am = DSP.gain(ctx, 0.5); DSP.chain(m, am, mg.gain);
        }
      }
    },
  });
})();
