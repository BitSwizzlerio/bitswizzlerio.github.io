/* Movement & body foley: footsteps, jumps, landings, whooshes, cloth. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  /* Legacy per-surface recipe — only water and mud still use it (every other surface has a physical model below). */
  const SURFACES = {
    water: { thump: 0.2, tf: 80, td: 0.06, noise: 0.5, nf: 900, nq: 0.6, nd: 0.16, ncolor: 'white', grains: { count: 14, spread: 0.2, len: 0.02, freq: 1500, freqVar: 0.7, Q: 3, amp: 0.3 }, splash: true },
    mud: { thump: 0.3, tf: 55, td: 0.1, noise: 0.4, nf: 500, nq: 3, nd: 0.18, squelch: true },
  };


  /* ---- Physical surface events (replace filtered-noise bursts with crowds of tiny real events) ---- */
  /* Resonant grain pings rendered in JS: each grain is a tiny inharmonic 3-partial hit. */
  function pings(ctx, out, rng, t0, L, o) {
    const sr = ctx.sampleRate, n = Math.ceil((L + 0.03) * sr); const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
    const count = Math.min(4000, Math.round(o.count || 20)); const env = o.env || (u => Math.pow(1 - u, 1.2));
    for (let g = 0; g < count; g++) {
      const u = Math.pow(rng.next(), 1 / (o.front || 1.4)); const i = Math.floor(u * L * sr); const f = (o.hz || 2000) * rng.range(1 - (o.spread || 0.5), 1 + (o.spread || 0.5) * 0.8);
      const len = Math.round(sr * rng.range(o.lenMin || 0.003, o.lenMax || 0.01)); const a = (o.amp || 0.4) * env(u) * rng.range(0.25, 1); const r2 = rng.range(1.4, 1.8), r3 = rng.range(2.1, 2.9); const ph = rng.next() * 6.28;
      for (let q = 0; q < len && i + q < n; q++) { const e = Math.exp(-q / (len * 0.35)); const w = 2 * Math.PI * q / sr; d[i + q] += a * e * (Math.sin(ph + w * f) + 0.5 * Math.sin(w * f * r2) * Math.exp(-q / (len * 0.2)) + 0.3 * Math.sin(w * f * r3) * Math.exp(-q / (len * 0.12))); }
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.start(t0); src.stop(t0 + L + 0.03);
    DSP.chain(src, DSP.filter(ctx, 'lowpass', o.lp || 6000, 0.6), DSP.gain(ctx, 0.9), out);
  }
  /* Gated soft noise (velvet through a body band), amplitude follows env — for soil compaction, grass, sand, snow crump. */
  function crump(ctx, out, rng, t, L, o) {
    const n = DSP.noise(ctx, rng, t, L + 0.02, o.color || 'velvet'); const f = DSP.filter(ctx, o.type || 'lowpass', o.hz || 900, o.Q || 0.8); const g = DSP.gain(ctx, 0);
    DSP.env(g.gain, t, { a: o.a || 0.004, d: L, peak: o.amp || 0.4, r: 0.01, curve: o.curve || 'exp' }); DSP.chain(n, f, DSP.filter(ctx, 'lowpass', o.lp || 4000, 0.6), g, out);
  }
  const M = () => Foley.Materials;

  function step(ctx, out, p, rng, t) {
    const s = SURFACES[p.surface] || SURFACES.mud;
    const w = p.weight, hard = p.hardness, det = p.detail;
    const scale = 0.7 + w * 0.6;
    const sf = p.surface;
    if (sf === 'wood') { // physical floorboard model + shoe scuff
      M().woodHit(ctx, out, rng, t, { kind: 'floor', size: 1.1 + w * 0.6, force: 0.35 + w * 0.6, hardness: 0.25 + hard * 0.6, amp: 0.8 * scale, double: 0.25 + hard * 0.2, damp: 0.25 });
      crump(ctx, out, rng, t, 0.06, { color: 'pink', type: 'bandpass', hz: 1500 * rng.range(0.85, 1.15) * (0.8 + hard * 0.5), Q: 1.2, amp: 0.18 * (0.5 + hard * 0.7) * scale, lp: 5000 });
      return;
    }
    if (sf === 'gravel') { // heel contact into the pebble bed + a crowd of stone pings + a few real pebbles + bedding crump
      M().masonryHit(ctx, out, rng, t, { kind: 'stone', ground: 'pavement', size: 0.7, force: 0.3 + w * 0.6, hardness: 0.3 + hard * 0.6, amp: 0.35 * scale, groundMix: 0.5 });
      pings(ctx, out, rng, t, 0.16 + w * 0.06, { count: 14 + det * 30, hz: 1500 + hard * 700, spread: 0.6, lenMin: 0.004, lenMax: 0.013, amp: 0.4 * scale * (0.6 + hard * 0.6), front: 1.6, lp: 5500 });
      const bk = M().banks(ctx, out, rng, 'masonry', 'stone', 0.35, 2); const nb = 2 + Math.round(det * 4); for (let i = 0; i < nb; i++) M().strike(ctx, out, rng, t + Math.pow(rng.next(), 1.5) * 0.14, M().MASONRY.stone, { size: 0.35 * rng.range(0.7, 1.3), force: 0.5, hardness: 0.8, amp: 0.25 * scale * rng.range(0.4, 1), shared: bk, double: 0 });
      crump(ctx, out, rng, t, 0.09 + w * 0.05, { hz: 700, amp: 0.35 * scale, lp: 3000 });
      return;
    }
    if (sf === 'snow') { // thousands of crystals fracturing (dense quiet high pings) + a soft compaction "crump"
      pings(ctx, out, rng, t, 0.14 + w * 0.08, { count: 120 + det * 260, hz: 3200, spread: 0.55, lenMin: 0.0015, lenMax: 0.005, amp: 0.12 * scale, front: 1.2, lp: 7000 });
      crump(ctx, out, rng, t, 0.12 + w * 0.08, { hz: 500 + hard * 300, amp: 0.55 * scale, a: 0.008, lp: 2500, curve: 'lin' });
      DSP.hit(ctx, out, rng, t, { thumpAmp: 0.25 * scale, thumpFreq: 65, thumpDecay: 0.06, noiseAmp: 0 });
      return;
    }
    if (sf === 'sand') { // fine grains: dense soft pings + shhh, no stones
      pings(ctx, out, rng, t, 0.14 + w * 0.06, { count: 200 + det * 300, hz: 2600, spread: 0.6, lenMin: 0.0012, lenMax: 0.004, amp: 0.09 * scale, front: 1.3, lp: 6500 });
      crump(ctx, out, rng, t, 0.13 + w * 0.06, { color: 'pink', type: 'bandpass', hz: 1800, Q: 0.6, amp: 0.4 * scale, a: 0.006, lp: 5000 });
      DSP.hit(ctx, out, rng, t, { thumpAmp: 0.2 * scale, thumpFreq: 60, thumpDecay: 0.06, noiseAmp: 0 });
      return;
    }
    if (sf === 'leaves') { // dry leaves: brittle crackle (paper-like pings) + rustle
      pings(ctx, out, rng, t, 0.2 + det * 0.08, { count: 25 + det * 50, hz: 2400, spread: 0.6, lenMin: 0.004, lenMax: 0.011, amp: 0.3 * scale, front: 1.3, lp: 5500 });
      crump(ctx, out, rng, t, 0.16, { color: 'pink', type: 'bandpass', hz: 2000, Q: 0.8, amp: 0.25 * scale, a: 0.005, lp: 5000 });
      crump(ctx, out, rng, t, 0.1 + w * 0.05, { hz: 500, amp: 0.25 * scale, lp: 2000 }); // the mulch underneath
      DSP.hit(ctx, out, rng, t, { thumpAmp: 0.15 * scale, thumpFreq: 60, thumpDecay: 0.05, noiseAmp: 0 });
      return;
    }
    if (sf === 'grass') { // many blade-bend swishes rather than one hiss
      const nb = 6 + Math.round(det * 10); for (let i = 0; i < nb; i++) { const tt = t + Math.pow(rng.next(), 1.4) * 0.1; crump(ctx, out, rng, tt, rng.range(0.02, 0.05), { color: 'velvet', type: 'bandpass', hz: rng.range(1200, 3200), Q: 1.5, amp: 0.12 * scale, a: 0.004, lp: 5500 }); }
      crump(ctx, out, rng, t, 0.1 + w * 0.05, { hz: 600, amp: 0.3 * scale, lp: 2500 });
      DSP.hit(ctx, out, rng, t, { thumpAmp: 0.15 * scale, thumpFreq: 60, thumpDecay: 0.05, noiseAmp: 0 });
      return;
    }
    if (sf === 'stone' || sf === 'tile') { // masonry / ceramic model + shoe click
      if (sf === 'stone') M().masonryHit(ctx, out, rng, t, { kind: 'stone', ground: 'bedrock', size: 1.2, force: 0.3 + w * 0.6, hardness: 0.35 + hard * 0.6, amp: 0.7 * scale, groundMix: 0.9 });
      else M().strike(ctx, out, rng, t, M().GLASS.ceramic, { size: 1.6, force: 0.3 + w * 0.6, hardness: 0.4 + hard * 0.55, amp: 0.6 * scale, double: 0.2 + hard * 0.3 });
      crump(ctx, out, rng, t, 0.03, { color: 'velvet', type: 'bandpass', hz: 3000 + hard * 2000, Q: 1, amp: 0.2 * hard * scale, a: 0.001, lp: 8000 });
      return;
    }
    if (sf === 'metal') { // metal plate/grating
      M().metalHit(ctx, out, rng, t, { kind: 'plate', size: 1.4, force: 0.3 + w * 0.6, hardness: 0.3 + hard * 0.6, amp: 0.7 * scale, double: 0.3 + hard * 0.3, damp: 0.3 });
      crump(ctx, out, rng, t, 0.04, { color: 'velvet', type: 'bandpass', hz: 2500 + hard * 2000, Q: 1, amp: 0.18 * hard * scale, a: 0.001, lp: 8000 });
      return;
    }
    if (sf === 'dirt' || sf === 'carpet') {
      crump(ctx, out, rng, t, 0.09 + w * 0.06, { hz: sf === 'carpet' ? 500 : 800, amp: 0.45 * scale, lp: 3000 });
      if (sf === 'dirt') pings(ctx, out, rng, t, 0.1, { count: 6 + det * 12, hz: 1400, spread: 0.6, lenMin: 0.004, lenMax: 0.012, amp: 0.2 * scale, lp: 4000 });
      DSP.hit(ctx, out, rng, t, { thumpAmp: (0.35 + w * 0.3) * scale, thumpFreq: 60, thumpDecay: 0.07 + w * 0.05, noiseAmp: 0 });
      return;
    }
    DSP.hit(ctx, out, rng, t, {
      thumpAmp: s.thump * scale, thumpFreq: s.tf * (1.3 - w * 0.5) * rng.range(0.92, 1.08), thumpDecay: s.td * (0.8 + w * 0.6),
      noiseAmp: (s.noise || 0) * (0.6 + hard * 0.8), noiseColor: s.ncolor || 'white', noiseFreq: (s.nf || 1500) * rng.range(0.85, 1.15) * (0.8 + hard * 0.4), noiseQ: s.nq || 0.8, noiseDecay: (s.nd || 0.08) * rng.range(0.85, 1.15),
      ring: s.ring, ringAmp: (s.ringAmp || 0) * hard * 1.5, ringDecay: s.ringDecay,
    });
    if (s.grains) DSP.grains(ctx, out, rng, t, Object.assign({}, s.grains, { amp: s.grains.amp * (0.6 + hard * 0.6) * scale, count: Math.round(s.grains.count * (0.6 + p.detail * 0.8)) }));
    if (s.squelch) {
      const n = DSP.noise(ctx, rng, t, 0.3, 'white');
      const f = DSP.filter(ctx, 'bandpass', 900, 8); DSP.sweep(f.frequency, t, 1200, t + 0.25, 300);
      const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.01, d: 0.22, peak: 0.35 * scale, r: 0.02 });
      DSP.chain(n, f, g, out);
    }
    if (s.splash) {
      for (let i = 0; i < 4; i++) {
        const tt = t + rng.range(0.02, 0.15);
        const o = DSP.osc(ctx, 'sine', rng.range(500, 1400), tt, 0.08);
        DSP.sweep(o.frequency, tt, o.frequency.value, tt + 0.06, o.frequency.value * 1.8);
        const g = DSP.gain(ctx, 0); DSP.env(g.gain, tt, { a: 0.002, d: 0.05, peak: 0.12 });
        DSP.chain(o, g, out);
      }
    }
  }

  R({
    id: 'footstep', name: 'Footstep', category: 'Movement', icon: '👣',
    params: [
      P.sel('surface', 'Surface', Object.keys(SURFACES), 'gravel'),
      P.r('weight', 'Weight', 0, 1, 0.5), P.r('hardness', 'Shoe hardness', 0, 1, 0.5), P.r('detail', 'Detail', 0, 1, 0.5),
      P.sel('gait', 'Gait', ['single', 'heel-toe', 'walk', 'run', 'sneak'], 'heel-toe'),
      P.r('steps', 'Steps (walk/run)', 1, 8, 4), P.r('tempo', 'Tempo (BPM)', 60, 240, 110),
    ],
    duration(p) {
      if (p.gait === 'walk' || p.gait === 'run') return Math.round(p.steps) * 60 / p.tempo + 0.4;
      return 0.6;
    },
    build(ctx, out, p, rng, t0) {
      if (p.gait === 'single') step(ctx, out, p, rng, t0);
      else if (p.gait === 'heel-toe') { step(ctx, out, Object.assign({}, p, { weight: p.weight * 0.9 }), rng, t0); step(ctx, out, Object.assign({}, p, { weight: p.weight * 0.6, hardness: p.hardness * 0.8 }), rng, t0 + rng.range(0.06, 0.11)); }
      else if (p.gait === 'sneak') { step(ctx, out, Object.assign({}, p, { weight: p.weight * 0.4, hardness: p.hardness * 0.5 }), rng, t0); step(ctx, out, Object.assign({}, p, { weight: p.weight * 0.3, hardness: p.hardness * 0.4 }), rng, t0 + rng.range(0.12, 0.2)); }
      else {
        const n = Math.round(p.steps), beat = 60 / p.tempo;
        for (let i = 0; i < n; i++) {
          const t = t0 + i * beat * rng.range(0.96, 1.04);
          const wt = p.gait === 'run' ? p.weight * 1.2 : p.weight;
          step(ctx, out, Object.assign({}, p, { weight: Math.min(1, wt) }), rng, t);
          if (p.gait === 'run') step(ctx, out, Object.assign({}, p, { weight: wt * 0.4, hardness: p.hardness * 0.7 }), rng, t + 0.05);
          else step(ctx, out, Object.assign({}, p, { weight: wt * 0.55, hardness: p.hardness * 0.8 }), rng, t + rng.range(0.07, 0.12));
        }
      }
    },
  });

  R({
    id: 'whoosh', name: 'Whoosh / Swing', category: 'Movement', icon: '💨',
    params: [
      P.r('length', 'Length', 0.1, 1.5, 0.4, 's'), P.r('freq', 'Center freq', 200, 6000, 1200, 'Hz'), P.r('sweep', 'Sweep (oct)', -3, 3, 1),
      P.r('reso', 'Resonance', 0.3, 12, 2.5), P.r('body', 'Body (low)', 0, 1, 0.3), P.r('peak', 'Peak position', 0.05, 0.95, 0.35),
      P.sel('color', 'Noise', ['white', 'pink', 'brown'], 'white'), P.r('doppler', 'Pan sweep', -1, 1, 0),
    ],
    duration(p) { return p.length + 0.2; },
    build(ctx, out, p, rng, t0) {
      const L = p.length;
      // coherent turbulence: three bands at fixed ratios sweeping together (one flow, not one filter), velvet+pink source
      const n = DSP.noise(ctx, rng, t0, L, p.color === 'white' ? 'velvet' : p.color);
      const f0 = p.freq * Math.pow(2, -p.sweep / 2), f1 = p.freq * Math.pow(2, p.sweep / 2);
      const g = DSP.gain(ctx, 0);
      g.gain.setValueAtTime(0.0005, t0); g.gain.exponentialRampToValueAtTime(0.9, t0 + L * p.peak); g.gain.exponentialRampToValueAtTime(0.0005, t0 + L);
      const pan = DSP.pan(ctx, -p.doppler); pan.pan.linearRampToValueAtTime(p.doppler, t0 + L);
      [[1, 1], [1.62, 0.5], [2.45, 0.25]].forEach(([r, a]) => { const f = DSP.filter(ctx, 'bandpass', p.freq * r, p.reso * (0.8 + r * 0.2)); f.frequency.setValueAtTime(f0 * r, t0); f.frequency.exponentialRampToValueAtTime(Math.min(18000, f1 * r), t0 + L); DSP.chain(n, f, DSP.gain(ctx, a), g); });
      DSP.chain(g, DSP.filter(ctx, 'lowpass', 9000, 0.5), pan, out);
      if (p.body > 0) {
        const n2 = DSP.noise(ctx, rng, t0, L, 'brown');
        const lp = DSP.filter(ctx, 'lowpass', 300, 1);
        const g2 = DSP.gain(ctx, 0);
        g2.gain.setValueAtTime(0.0005, t0); g2.gain.exponentialRampToValueAtTime(p.body * 1.5, t0 + L * p.peak); g2.gain.exponentialRampToValueAtTime(0.0005, t0 + L);
        DSP.chain(n2, lp, g2, out);
      }
    },
  });

  R({
    id: 'jump', name: 'Jump / Boing', category: 'Movement', icon: '🦘',
    params: [
      P.r('start', 'Start pitch', 60, 1200, 220, 'Hz'), P.r('end', 'End pitch', 60, 2400, 660, 'Hz'), P.r('length', 'Length', 0.05, 1, 0.22, 's'),
      P.sel('wave', 'Wave', ['sine', 'triangle', 'square', 'sawtooth'], 'square'), P.r('wobble', 'Wobble', 0, 1, 0), P.r('breath', 'Air noise', 0, 1, 0.2),
    ],
    duration(p) { return p.length + 0.2; },
    build(ctx, out, p, rng, t0) {
      const o = DSP.osc(ctx, p.wave, p.start, t0, p.length);
      DSP.sweep(o.frequency, t0, p.start, t0 + p.length, p.end);
      if (p.wobble > 0) { const l = DSP.osc(ctx, 'sine', 18 + p.wobble * 20, t0, p.length); const lg = DSP.gain(ctx, p.wobble * 300); DSP.chain(l, lg, o.detune); }
      const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.005, d: p.length, peak: 0.5, r: 0.05, curve: 'lin' });
      const lp = DSP.filter(ctx, 'lowpass', 3000, 1); DSP.sweep(lp.frequency, t0, 1500, t0 + p.length, 6000);
      DSP.chain(o, lp, g, out);
      if (p.breath > 0) { const n = DSP.noise(ctx, rng, t0, p.length); const f = DSP.filter(ctx, 'bandpass', 2000, 1); DSP.sweep(f.frequency, t0, 800, t0 + p.length, 4000); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, t0, { a: 0.01, d: p.length, peak: p.breath * 0.3 }); DSP.chain(n, f, ng, out); }
    },
  });

  R({
    id: 'land', name: 'Land / Body fall', category: 'Movement', icon: '🫳',
    params: [
      P.r('weight', 'Weight', 0, 1, 0.6), P.sel('surface', 'Surface', ['ground', 'wood', 'metal', 'water', 'gravel'], 'ground'), P.r('tumble', 'Tumble hits', 0, 5, 0), P.r('cloth', 'Cloth rustle', 0, 1, 0.3),
    ],
    duration(p) { return 0.5 + p.tumble * 0.15; },
    build(ctx, out, p, rng, t0) {
      const w = p.weight;
      const sfc = { ground: { nf: 800, ring: [] }, wood: { nf: 1200, ring: [300, 620], ra: 0.15 }, metal: { nf: 2000, ring: [900, 1400, 2300], ra: 0.25 }, water: { nf: 700, ring: [] }, gravel: { nf: 2600, ring: [] } }[p.surface];
      const hits = 1 + Math.round(p.tumble);
      for (let i = 0; i < hits; i++) {
        const t = t0 + (i === 0 ? 0 : i * rng.range(0.08, 0.16));
        const a = i === 0 ? 1 : rng.range(0.3, 0.7);
        if (p.surface === 'wood') Foley.Materials.woodHit(ctx, out, rng, t, { kind: 'floor', size: 1.6 + w * 0.8, force: 0.5 + w * 0.5, hardness: 0.2, amp: a, double: 0.5, damp: 0.2 });
        DSP.hit(ctx, out, rng, t, { thumpAmp: (0.5 + w * 0.6) * a, thumpFreq: 55 + (1 - w) * 40, thumpDecay: 0.1 + w * 0.15, thumpSweep: 3, noiseAmp: (p.surface === 'wood' ? 0.15 : 0.35) * a, noiseColor: 'pink', noiseFreq: sfc.nf, noiseQ: 0.7, noiseDecay: 0.09, ring: p.surface === 'wood' ? [] : sfc.ring, ringAmp: (sfc.ra || 0) * a, ringDecay: 0.25 });
        if (p.surface === 'gravel') DSP.grains(ctx, out, rng, t, { count: 25, spread: 0.2, amp: 0.4 * a, freq: 3000 });
        if (p.surface === 'water') { const n = DSP.noise(ctx, rng, t, 0.4); const f = DSP.filter(ctx, 'lowpass', 2500, 0.8); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.01, d: 0.3, peak: 0.5 * a }); DSP.chain(n, f, g, out); }
        // the body itself: a soft-body "body" strike under every landing
        Foley.Materials.softHit(ctx, out, rng, t, { kind: 'body', size: 1.2 + w * 0.8, force: 0.4 + w * 0.6, hardness: 0.2, amp: a * 0.8, double: i === 0 ? 0.4 : 0.1 });
      }
      if (p.cloth > 0) { const n = DSP.noise(ctx, rng, t0, 0.3, 'pink'); const f = DSP.filter(ctx, 'bandpass', 2500, 0.8); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.005, d: 0.25, peak: p.cloth * 0.25 }); DSP.chain(n, f, g, out); }
    },
  });

  /* ---- Skittering: many small taps from many legs -------------------------- */
  const CRITTERS = {
    insect:    { legs: 6, tap: 0.004, freq: 4300, Q: 4, amp: 0.25, scrape: 0.15, thump: 0, chitter: 0.3 },
    spider:    { legs: 8, tap: 0.006, freq: 4500, Q: 3, amp: 0.35, scrape: 0.25, thump: 0.05, chitter: 0.1 },
    'giant-spider': { legs: 8, tap: 0.018, freq: 1800, Q: 2, amp: 0.7, scrape: 0.4, thump: 0.5, chitter: 0.2 },
    rat:       { legs: 4, tap: 0.010, freq: 2800, Q: 1.5, amp: 0.45, scrape: 0.35, thump: 0.15, chitter: 0.2 },
    crab:      { legs: 8, tap: 0.008, freq: 3800, Q: 6, amp: 0.5, scrape: 0.3, thump: 0.1, chitter: 0 },
    lizard:    { legs: 4, tap: 0.007, freq: 3200, Q: 2, amp: 0.3, scrape: 0.5, thump: 0.08, chitter: 0 },
    centipede: { legs: 30, tap: 0.003, freq: 3600, Q: 5, amp: 0.2, scrape: 0.2, thump: 0.02, chitter: 0 },
    'bird-claws': { legs: 2, tap: 0.009, freq: 4200, Q: 5, amp: 0.5, scrape: 0.2, thump: 0.1, chitter: 0 },
    swarm:     { legs: 40, tap: 0.004, freq: 4000, Q: 3, amp: 0.15, scrape: 0.1, thump: 0, chitter: 0.5 },
  };
  const SKITTER_SURFACES = {
    hard:   { fmul: 1.0, Qmul: 1.2, color: 'white', ring: true,  soft: 0 },
    wood:   { fmul: 0.7, Qmul: 1.0, color: 'white', ring: true,  soft: 0.2 },
    metal:  { fmul: 1.3, Qmul: 2.5, color: 'white', ring: true,  soft: 0, metal: true },
    leaves: { fmul: 0.9, Qmul: 0.6, color: 'white', ring: false, soft: 0.6, crunch: true },
    dirt:   { fmul: 0.6, Qmul: 0.5, color: 'pink',  ring: false, soft: 0.7 },
    wet:    { fmul: 0.8, Qmul: 1.5, color: 'white', ring: false, soft: 0.4, wet: true },
    paper:  { fmul: 1.1, Qmul: 0.7, color: 'pink',  ring: false, soft: 0.5, crunch: true },
  };
  R({
    id: 'skitter', name: 'Skitter / Creature Walk', category: 'Movement', icon: '🕷️',
    params: [
      P.sel('creature', 'Creature', Object.keys(CRITTERS), 'spider'),
      P.sel('surface', 'Surface', Object.keys(SKITTER_SURFACES), 'hard'),
      P.r('length', 'Length', 0.2, 8, 1.5, 's'), P.r('speed', 'Speed', 0, 1, 0.6), P.r('size', 'Size', 0, 1, 0.4),
      P.r('irregular', 'Irregularity', 0, 1, 0.5), P.r('claws', 'Claw scrape', 0, 1, 0.4), P.r('chitter', 'Chitter', 0, 1, 0.2),
      P.sel('motion', 'Motion', ['continuous', 'stop-go', 'approach', 'flee', 'burst'], 'continuous'),
      P.r('pan', 'Pan travel', -1, 1, 0), P.tog('loop', 'Seamless loop', false),
    ],
    duration(p) { return p.length + 0.3; },
    build(ctx, out, p, rng, t0) {
      const c = CRITTERS[p.creature], s = SKITTER_SURFACES[p.surface], L = p.length;
      const sz = 1.7 - p.size * 1.2;                       // >1 = smaller/higher, <1 = bigger/lower
      let stepRate = (4 + p.speed * 22) * (0.6 + Math.sqrt(c.legs) * 0.25) * (0.7 + sz * 0.3); // taps per second
      const est = stepRate * L * 2.2; if (est > 700) stepRate *= 700 / est; // cap node count so long/fast settings stay quick to render
      const bus = DSP.gain(ctx, 1); const pan = DSP.pan(ctx, -p.pan); pan.pan.linearRampToValueAtTime(p.pan, t0 + L); DSP.chain(bus, pan, out);
      // motion envelope
      const mg = DSP.gain(ctx, 1); mg.connect(bus);
      if (p.motion === 'approach') { mg.gain.setValueAtTime(0.05, t0); mg.gain.exponentialRampToValueAtTime(1, t0 + L); }
      else if (p.motion === 'flee') { mg.gain.setValueAtTime(1, t0); mg.gain.exponentialRampToValueAtTime(0.03, t0 + L); }
      // gait windows for stop-go / burst
      const windows = [];
      if (p.motion === 'stop-go') { let t = 0; while (t < L) { const run = rng.range(0.15, 0.6), pause = rng.range(0.1, 0.5); windows.push([t, Math.min(L, t + run)]); t += run + pause; } }
      else if (p.motion === 'burst') { windows.push([0, Math.min(L, rng.range(0.2, 0.5))]); }
      else windows.push([0, L]);
      const active = tt => windows.some(w => tt >= w[0] && tt < w[1]);
      // tone filter for metal ring
      const ringF = s.metal ? [2400, 3900, 5600].map(f => f * sz) : null;
      let t = 0; let legIdx = 0; const taps = [];
      while (t < L) {
        const per = 1 / stepRate;
        t += per * rng.range(1 - p.irregular * 0.7, 1 + p.irregular * 0.9);
        if (t >= L) break;
        if (!active(t)) continue;
        // occasional cluster of quick taps (multiple legs landing at once)
        const cluster = rng.next() < 0.25 + p.irregular * 0.3 ? rng.int(2, Math.min(5, Math.max(2, Math.round(c.legs / 2)))) : 1;
        for (let k = 0; k < cluster; k++) {
          const tt = t0 + t + k * rng.range(0.004, 0.02);
          legIdx++;
          const tapLen = c.tap * (0.6 + sz * 0.6) * rng.range(0.7, 1.4) + s.soft * 0.01;
          const f = c.freq * s.fmul * sz * rng.range(0.75, 1.3);
          const amp = c.amp * (0.5 + p.size * 0.8) * rng.range(0.4, 1) * (1 - s.soft * 0.5);
          taps.push({ t: tt - t0, f, amp: amp * (0.8 + s.soft * 0.4), len: Math.max(0.002, tapLen) }); // rendered as resonant pings below
          // tiny tonal tick on hard surfaces (tarsal click)
          if (s.ring && rng.next() < 0.6) { const o = DSP.osc(ctx, 'sine', f * rng.range(0.9, 1.1), tt, 0.02); const og = DSP.gain(ctx, 0); DSP.env(og.gain, tt, { a: 0.0003, d: tapLen * 0.8, peak: amp * 0.5 }); DSP.chain(o, og, mg); }
          if (ringF && rng.next() < 0.3) { const fr = rng.pick(ringF); const o = DSP.osc(ctx, 'sine', fr, tt, 0.1); const og = DSP.gain(ctx, 0); DSP.env(og.gain, tt, { a: 0.0005, d: 0.06, peak: amp * 0.3 }); DSP.chain(o, og, mg); }
          // body thump for heavier critters
          if (c.thump > 0 && rng.next() < 0.5) DSP.hit(ctx, mg, rng, tt, { thumpAmp: c.thump * (0.4 + p.size), thumpFreq: 140 * sz, thumpDecay: 0.03 + p.size * 0.04, thumpSweep: 2, noiseAmp: 0 });
          // claw scrape / drag
          if (p.claws > 0 && rng.next() < c.scrape * p.claws * 1.5) {
            const sl = rng.range(0.015, 0.06); const sn = DSP.noise(ctx, rng, tt, sl + 0.02, 'white');
            const sf = DSP.filter(ctx, 'bandpass', f * 0.7, 2); DSP.sweep(sf.frequency, tt, f * 0.5, tt + sl, f * 1.4);
            const sg = DSP.gain(ctx, 0); DSP.env(sg.gain, tt, { a: 0.003, d: sl, peak: amp * 0.6 * p.claws, curve: 'lin' }); DSP.chain(sn, sf, sg, mg);
          }
          // surface extras
          if (s.crunch && rng.next() < 0.35) DSP.grains(ctx, mg, rng, tt, { count: 3, spread: 0.02, len: 0.006, freq: 3500 * sz, freqVar: 0.4, Q: 1.5, amp: amp * 0.8 });
          if (s.wet && rng.next() < 0.4) { const fr = rng.range(600, 1500) * sz; const o = DSP.osc(ctx, 'sine', fr, tt, 0.03); DSP.sweep(o.frequency, tt, fr, tt + 0.025, fr * 1.7); const og = DSP.gain(ctx, 0); DSP.env(og.gain, tt, { a: 0.001, d: 0.02, peak: amp * 0.5 }); DSP.chain(o, og, mg); }
        }
      }
      // every foot-tap is a tiny inharmonic hit (3 partials, fast decay), not a noise burst — one JS-rendered buffer for all
      if (taps.length) { const ts = taps.slice(0, 4000); Foley.Materials.pings(ctx, mg, rng, t0, L + 0.05, { times: ts.map(x => x.t), hz: i => ts[i].f, amp: i => ts[i].amp * 1.3, spread: 0.15, lenMin: 0.002, lenMax: 0.006, env: u => 1, lp: s.soft > 0.4 ? 5000 : 8000 }); }
      // chittering / mandible clicks
      const chit = p.chitter * (0.3 + c.chitter);
      if (chit > 0) {
        const cnt = Math.min(40, Math.round(chit * 18 * L));
        for (let i = 0; i < cnt; i++) {
          const tt = t0 + rng.next() * L; if (!active(tt - t0)) continue;
          const burst = rng.int(3, 9); const rate = rng.range(40, 120);
          for (let k = 0; k < burst; k++) { const t2 = tt + k / rate; const o = DSP.osc(ctx, 'square', (2200 + rng.range(-400, 900)) * sz, t2, 0.01); const og = DSP.gain(ctx, 0); DSP.env(og.gain, t2, { a: 0.0005, d: 0.006, peak: 0.12 * chit }); DSP.chain(o, DSP.filter(ctx, 'bandpass', 3500 * sz, 2), og, mg); }
        }
      }
      // low body-mass rumble for giant critters / swarms
      if (p.size > 0.6 || p.creature === 'swarm') { const n = DSP.noise(ctx, rng, t0, L, 'pink'); const f = DSP.filter(ctx, p.creature === 'swarm' ? 'bandpass' : 'lowpass', p.creature === 'swarm' ? 5000 : 300, 0.7); const g = DSP.gain(ctx, 0); if (p.loop) { g.gain.setValueAtTime(0.1, t0); g.gain.setValueAtTime(0.1, t0 + L); } else DSP.env(g.gain, t0, { a: 0.1, d: 0.1, s: 1, hold: L - 0.4, r: 0.2, peak: p.creature === 'swarm' ? 0.12 : (p.size - 0.6) * 0.5, curve: 'lin' }); DSP.chain(n, f, g, mg); }
    },
  });

  R({
    id: 'cloth', name: 'Cloth / Rustle', category: 'Movement', icon: '🧥',
    params: [P.r('length', 'Length', 0.1, 2, 0.5, 's'), P.r('freq', 'Brightness', 500, 8000, 3000, 'Hz'), P.r('movement', 'Movement', 0, 1, 0.5), P.sel('material', 'Material', ['cotton', 'leather', 'nylon', 'chainmail'], 'cotton')],
    duration(p) { return p.length + 0.2; },
    build(ctx, out, p, rng, t0) {
      const L = p.length;
      // fibre-on-fibre friction: the coupled friction excitation with very fast micro-pulses, gated by the movement envelope
      const segs = 3 + Math.round(p.movement * 8); const pts = []; for (let i = 0; i <= segs; i++) pts.push(i === segs ? 0 : rng.range(0.15, 1));
      const moveAt = u => { const x = u * segs; const i = Math.min(segs - 1, Math.floor(x)); return DSP.lerp(pts[i], pts[i + 1], x - i); };
      const rate = { cotton: 900, leather: 350, nylon: 1500, chainmail: 600 }[p.material];
      const buf = Foley.Materials.frictionBuffer(ctx, rng, L, { rateFn: u => rate * (0.5 + moveAt(u)), ampFn: u => moveAt(u), jitter: 0.5, widthMs: p.material === 'leather' ? 0.9 : 0.35, noise: p.material === 'nylon' ? 0.8 : 0.5, noiseColor: p.material === 'leather' ? 0.1 : 0.22, grit: 0 });
      const src = ctx.createBufferSource(); src.buffer = buf; src.start(t0); src.stop(t0 + L + 0.05);
      const f = DSP.filter(ctx, 'bandpass', p.freq, p.material === 'leather' ? 0.6 : 0.9); const f2 = DSP.filter(ctx, 'bandpass', p.freq * 1.9, 1.2);
      const g = DSP.gain(ctx, 0.55); DSP.chain(src, f, g); DSP.chain(src, f2, DSP.gain(ctx, 0.3), g); DSP.chain(g, DSP.filter(ctx, 'lowpass', p.material === 'nylon' ? 9000 : 6000, 0.5), out);
      if (p.material === 'chainmail') DSP.grains(ctx, out, rng, t0, { count: Math.round(30 * L), spread: L, len: 0.006, freq: 5500, freqVar: 0.4, Q: 6, amp: 0.25, decayShape: 1 });
      if (p.material === 'leather') DSP.grains(ctx, out, rng, t0, { count: Math.round(6 * L), spread: L, len: 0.03, freq: 900, freqVar: 0.4, Q: 3, amp: 0.2, decayShape: 1, color: 'pink' });
    },
  });
})();
