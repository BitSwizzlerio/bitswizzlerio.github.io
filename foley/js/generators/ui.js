/* UI / interface sounds. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  R({
    id: 'uiclick', name: 'UI Click', category: 'UI', icon: '🖱️',
    params: [P.sel('style', 'Style', ['soft', 'crisp', 'mechanical', 'wooden', 'bubble', 'digital'], 'crisp'), P.r('pitch', 'Pitch', 0.3, 3, 1), P.r('length', 'Length', 0.005, 0.15, 0.03, 's'), P.tog('double', 'Double click', false)],
    duration(p) { return p.length + 0.2 + (p.double ? 0.1 : 0); },
    build(ctx, out, p, rng, t0) {
      const one = (t) => {
        const s = p.style, L = p.length, k = p.pitch;
        if (s === 'soft') DSP.hit(ctx, out, rng, t, { thumpAmp: 0.3, thumpFreq: 400 * k, thumpDecay: L, thumpSweep: 1.5, noiseAmp: 0.25, noiseColor: 'pink', noiseFreq: 2000 * k, noiseQ: 1, noiseDecay: L });
        else if (s === 'crisp') DSP.hit(ctx, out, rng, t, { thumpAmp: 0.2, thumpFreq: 800 * k, thumpDecay: L * 0.5, thumpSweep: 2, noiseAmp: 0.6, noiseFreq: 4500 * k, noiseQ: 1.5, noiseDecay: L });
        else if (s === 'mechanical') DSP.hit(ctx, out, rng, t, { thumpAmp: 0.3, thumpFreq: 250 * k, thumpDecay: L, noiseAmp: 0.5, noiseFreq: 3000 * k, noiseQ: 2, noiseDecay: L * 0.7, ring: [2200 * k, 3600 * k], ringAmp: 0.2, ringDecay: L * 2 });
        else if (s === 'wooden') DSP.hit(ctx, out, rng, t, { thumpAmp: 0.5, thumpFreq: 500 * k, thumpDecay: L * 1.5, thumpSweep: 1.4, noiseAmp: 0.3, noiseFreq: 1500 * k, noiseQ: 2, noiseDecay: L, ring: [900 * k, 1700 * k], ringAmp: 0.15, ringDecay: L * 2 });
        else if (s === 'bubble') { const o = DSP.osc(ctx, 'sine', 600 * k, t, L * 4); DSP.sweep(o.frequency, t, 500 * k, t + L * 3, 1400 * k); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.002, d: L * 3, peak: 0.5 }); DSP.chain(o, g, out); }
        else { const o = DSP.osc(ctx, 'square', 1800 * k, t, L * 2); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.001, d: L, peak: 0.25, curve: 'lin' }); const f = DSP.filter(ctx, 'lowpass', 6000, 1); DSP.chain(o, f, g, out); }
      };
      one(t0); if (p.double) one(t0 + 0.09);
    },
  });

  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11, 12], minor: [0, 2, 3, 5, 7, 8, 10, 12], pentatonic: [0, 2, 4, 7, 9, 12, 14, 16], chromatic: [0, 1, 2, 3, 4, 5, 6, 7], fifths: [0, 7, 12, 19, 24, 31], octaves: [0, 12, 24, 36] };
  R({
    id: 'uitone', name: 'UI Tone / Blip', category: 'UI', icon: '🔔',
    params: [
      P.sel('type', 'Type', ['confirm', 'cancel', 'error', 'hover', 'notify', 'select', 'back', 'popup'], 'confirm'),
      P.sel('wave', 'Wave', ['sine', 'triangle', 'square', 'sawtooth'], 'sine'), P.r('root', 'Root note', 200, 2000, 660, 'Hz'),
      P.r('notes', 'Notes', 1, 6, 2), P.r('speed', 'Speed', 0.02, 0.3, 0.07, 's'), P.r('decay', 'Decay', 0.03, 1, 0.18, 's'), P.r('bright', 'Brightness', 0, 1, 0.5), P.sel('scale', 'Scale', Object.keys(SCALES), 'major'),
    ],
    duration(p) { return Math.round(p.notes) * p.speed + p.decay + 0.3; },
    build(ctx, out, p, rng, t0) {
      const sc = SCALES[p.scale]; const n = Math.round(p.notes);
      const pattern = { confirm: i => sc[i * 2 % sc.length], cancel: i => sc[Math.max(0, 4 - i * 2)] , error: i => -sc[i % 2 ? 1 : 0] - 6, hover: () => 0, notify: i => sc[[0, 4, 2, 5][i % 4]], select: i => sc[(i + 2) % sc.length], back: i => sc[Math.max(0, 6 - i * 3)], popup: i => sc[[0, 7, 4, 7][i % 4]] }[p.type];
      for (let i = 0; i < n; i++) {
        const t = t0 + i * p.speed;
        const f = p.root * DSP.semis(pattern(i) + (p.type === 'error' ? -12 : 0));
        const wave = p.type === 'error' ? (p.wave === 'sine' ? 'square' : p.wave) : p.wave;
        const o = DSP.osc(ctx, wave, f, t, p.decay + 0.1);
        if (p.type === 'hover') DSP.sweep(o.frequency, t, f, t + p.decay, f * 1.6);
        if (p.type === 'error') { const l = DSP.osc(ctx, 'square', 35, t, p.decay); const lg = DSP.gain(ctx, f * 0.3); DSP.chain(l, lg, o.frequency); }
        const lp = DSP.filter(ctx, 'lowpass', 1200 + p.bright * 12000, 0.8);
        const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.003, d: p.decay, peak: 0.4, r: 0.02 });
        DSP.chain(o, lp, g, out);
        if (p.bright > 0.5) { const o2 = DSP.osc(ctx, 'sine', f * 2, t, p.decay); const g2 = DSP.gain(ctx, 0); DSP.env(g2.gain, t, { a: 0.003, d: p.decay * 0.5, peak: (p.bright - 0.5) * 0.4 }); DSP.chain(o2, g2, out); }
      }
    },
  });

  R({
    id: 'typing', name: 'Typing / Text', category: 'UI', icon: '⌨️',
    params: [P.r('count', 'Characters', 1, 40, 12), P.r('rate', 'Rate', 4, 40, 15, 'cps'), P.sel('style', 'Style', ['typewriter', 'keyboard', 'digital', 'terminal'], 'keyboard'), P.r('pitch', 'Pitch', 0.5, 2, 1), P.r('jitter', 'Timing jitter', 0, 1, 0.4)],
    duration(p) { return Math.round(p.count) / p.rate + 0.3; },
    build(ctx, out, p, rng, t0) {
      const n = Math.round(p.count); const k = p.pitch;
      for (let i = 0; i < n; i++) {
        const t = t0 + (i / p.rate) * rng.range(1 - p.jitter * 0.3, 1 + p.jitter * 0.3);
        if (p.style === 'typewriter') DSP.hit(ctx, out, rng, t, { thumpAmp: 0.35, thumpFreq: 200 * k, thumpDecay: 0.02, noiseAmp: 0.55, noiseFreq: 2500 * k * rng.range(0.9, 1.1), noiseQ: 1.5, noiseDecay: 0.02, ring: [1600 * k, 2900 * k], ringAmp: 0.25, ringDecay: 0.06 });
        else if (p.style === 'keyboard') DSP.hit(ctx, out, rng, t, { thumpAmp: 0.25, thumpFreq: 350 * k, thumpDecay: 0.015, noiseAmp: 0.5, noiseFreq: 3500 * k * rng.range(0.85, 1.15), noiseQ: 1.2, noiseDecay: 0.015 });
        else if (p.style === 'digital') { const o = DSP.osc(ctx, 'square', 1200 * k * rng.pick([1, 1.25, 1.5]), t, 0.03); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.001, d: 0.018, peak: 0.2, curve: 'lin' }); DSP.chain(o, g, out); }
        else { const o = DSP.osc(ctx, 'sine', 2400 * k, t, 0.015); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.001, d: 0.01, peak: 0.25 }); DSP.chain(o, g, out); }
      }
      if (p.style === 'typewriter') { const t = t0 + n / p.rate + 0.05; const o = DSP.osc(ctx, 'sine', 3200 * k, t, 0.6); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.002, d: 0.5, peak: 0.3 }); DSP.chain(o, g, out); }
    },
  });

  R({
    id: 'swipe', name: 'UI Swipe / Whip', category: 'UI', icon: '↔️',
    params: [P.r('length', 'Length', 0.05, 0.6, 0.18, 's'), P.r('start', 'Start freq', 200, 8000, 800, 'Hz'), P.r('end', 'End freq', 200, 12000, 4000, 'Hz'), P.r('tone', 'Tonal', 0, 1, 0.3), P.r('reso', 'Resonance', 0.5, 15, 4)],
    duration(p) { return p.length + 0.2; },
    build(ctx, out, p, rng, t0) {
      const L = p.length;
      const n = DSP.noise(ctx, rng, t0, L); const f = DSP.filter(ctx, 'bandpass', p.start, p.reso); DSP.sweep(f.frequency, t0, p.start, t0 + L, p.end);
      const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: L * 0.3, d: L * 0.7, peak: 0.6, curve: 'lin' }); DSP.chain(n, f, g, out);
      if (p.tone > 0) { const o = DSP.osc(ctx, 'sine', p.start, t0, L); DSP.sweep(o.frequency, t0, p.start, t0 + L, p.end); const g2 = DSP.gain(ctx, 0); DSP.env(g2.gain, t0, { a: L * 0.2, d: L * 0.8, peak: p.tone * 0.3, curve: 'lin' }); DSP.chain(o, g2, out); }
    },
  });
})();
