/* Weapons & combat. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  R({
    id: 'explosion', name: 'Explosion', category: 'Weapons', icon: '🧨',
    params: [P.r('size', 'Size', 0, 1, 0.6), P.r('distance', 'Distance', 0, 1, 0.2), P.r('debris', 'Debris', 0, 1, 0.5), P.r('crackle', 'Crackle', 0, 1, 0.3), P.r('tail', 'Tail', 0.2, 4, 1.2, 's'), P.r('drive', 'Drive', 0, 1, 0.4), P.tog('sub', 'Sub drop', true)],
    duration(p) { return p.tail + 0.8 + p.size; },
    build(ctx, out, p, rng, t0) {
      const dist = p.distance; const size = p.size;
      const lp = DSP.filter(ctx, 'lowpass', 12000 - dist * 11000, 0.5);
      const drive = DSP.shaper(ctx, p.drive * (1 - dist * 0.5), 'soft'); DSP.chain(lp, drive, out);
      const t = t0 + dist * 0.05;
      // Initial crack
      if (dist < 0.8) DSP.hit(ctx, lp, rng, t, { thumpAmp: 0, noiseAmp: 1.2 * (1 - dist), noiseFreq: 3000, noiseType: 'highpass', noiseQ: 0.5, noiseDecay: 0.03 });
      // Boom body
      const n = DSP.noise(ctx, rng, t, p.tail + 0.5, 'brown');
      const bf = DSP.filter(ctx, 'lowpass', 400 + size * 300, 0.7); DSP.sweep(bf.frequency, t, 1500 - dist * 800, t + p.tail, 60);
      const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.005 + dist * 0.05, d: p.tail * (0.5 + size * 0.6), peak: 2.5 + size, r: 0.2 });
      DSP.chain(n, bf, g, lp);
      const n2 = DSP.noise(ctx, rng, t, 0.5, 'white');
      const mf = DSP.filter(ctx, 'bandpass', 800, 0.6); const g2 = DSP.gain(ctx, 0); DSP.env(g2.gain, t, { a: 0.003, d: 0.2 + size * 0.3, peak: 0.9 * (1 - dist * 0.6) }); DSP.chain(n2, mf, g2, lp);
      if (p.sub) { const o = DSP.osc(ctx, 'sine', 120, t, 0.8 + size); DSP.sweep(o.frequency, t, 90 + size * 60, t + 0.5 + size * 0.5, 28); const sg = DSP.gain(ctx, 0); DSP.env(sg.gain, t, { a: 0.005, d: 0.4 + size * 0.6, peak: 1 + size * 0.6, r: 0.1 }); DSP.chain(o, sg, lp); }
      if (p.debris > 0) { // debris: stone/metal fragments landing (resonant pings + a few real rock hits), not noise grains
        Foley.Materials.pings(ctx, lp, rng, t + 0.15, p.tail * 0.8, { count: Math.round(p.debris * 60 * (1 - dist * 0.5)), hz: 1400, spread: 0.7, lenMin: 0.006, lenMax: 0.02, amp: p.debris * 0.55, front: 1.2, lp: 5000 });
        const bk = Foley.Materials.banks(ctx, lp, rng, 'masonry', 'stone', 0.8, 2); const nb = Math.round(p.debris * 8 * (1 - dist * 0.5)); for (let i = 0; i < nb; i++) Foley.Materials.strike(ctx, lp, rng, t + 0.2 + Math.pow(rng.next(), 1.3) * p.tail * 0.7, Foley.Materials.MASONRY.stone, { size: rng.range(0.5, 1.2), force: rng.range(0.3, 0.8), hardness: 0.7, amp: p.debris * 0.35 * rng.range(0.4, 1), shared: bk, double: 0.3 });
      }
      if (p.crackle > 0) { const c = DSP.noise(ctx, rng, t + 0.05, p.tail, 'crackle'); const cf = DSP.filter(ctx, 'highpass', 2000, 0.5); const cg = DSP.gain(ctx, 0); DSP.env(cg.gain, t + 0.05, { a: 0.01, d: p.tail * 0.8, peak: p.crackle * 2.5 * (1 - dist * 0.6) }); DSP.chain(c, cf, cg, lp); }
    },
  });

  R({
    id: 'gunshot', name: 'Gunshot', category: 'Weapons', icon: '🔫',
    params: [P.sel('type', 'Weapon', ['pistol', 'rifle', 'shotgun', 'smg', 'cannon', 'silenced'], 'pistol'), P.r('distance', 'Distance', 0, 1, 0.1), P.r('shots', 'Shots', 1, 10, 1), P.r('rate', 'Fire rate', 3, 20, 10, 'Hz'), P.r('mech', 'Mechanism', 0, 1, 0.4), P.r('tail', 'Tail', 0.1, 2, 0.5, 's')],
    duration(p) { return Math.round(p.shots) / p.rate + p.tail + 0.5; },
    build(ctx, out, p, rng, t0) {
      const w = { pistol: { crack: 1, body: 0.6, low: 90, len: 0.12 }, rifle: { crack: 1.3, body: 0.9, low: 70, len: 0.2 }, shotgun: { crack: 0.9, body: 1.4, low: 55, len: 0.28 }, smg: { crack: 0.8, body: 0.5, low: 110, len: 0.09 }, cannon: { crack: 0.6, body: 2, low: 40, len: 0.6 }, silenced: { crack: 0.25, body: 0.35, low: 150, len: 0.06 } }[p.type];
      const dist = p.distance;
      const lp = DSP.filter(ctx, 'lowpass', 14000 - dist * 12500, 0.5); const drv = DSP.shaper(ctx, 0.35 * (1 - dist), 'soft'); DSP.chain(lp, drv, out);
      const n = Math.round(p.shots);
      for (let i = 0; i < n; i++) {
        const t = t0 + i / p.rate * rng.range(0.98, 1.02);
        const cr = DSP.noise(ctx, rng, t, 0.05); const cf = DSP.filter(ctx, 'highpass', 1500, 0.5); const cg = DSP.gain(ctx, 0); DSP.env(cg.gain, t, { a: 0.0005, d: 0.012 + w.len * 0.05, peak: w.crack * (1 - dist * 0.7) }); DSP.chain(cr, cf, cg, lp);
        const b = DSP.noise(ctx, rng, t, w.len + 0.3, 'pink'); const bf = DSP.filter(ctx, 'lowpass', 900, 0.8); DSP.sweep(bf.frequency, t, 2500, t + w.len, 200); const bg = DSP.gain(ctx, 0); DSP.env(bg.gain, t, { a: 0.001, d: w.len, peak: w.body, r: 0.05 }); DSP.chain(b, bf, bg, lp);
        const o = DSP.osc(ctx, 'sine', w.low * 2.5, t, w.len + 0.1); DSP.sweep(o.frequency, t, w.low * 2.5, t + w.len * 0.6, w.low); const og = DSP.gain(ctx, 0); DSP.env(og.gain, t, { a: 0.001, d: w.len * 0.8, peak: w.body * 0.9 }); DSP.chain(o, og, lp);
        if (p.mech > 0 && p.type !== 'cannon') { const mt = t + 0.04 + rng.range(0, 0.02); Foley.Materials.metalHit(ctx, lp, rng, mt, { kind: 'thin', size: 0.45, force: 0.6, hardness: 0.9, amp: p.mech * 0.5, double: 0.5, damp: 0.5 }); if (rng.next() < 0.7) Foley.Materials.metalHit(ctx, lp, rng, mt + rng.range(0.03, 0.07), { kind: 'link', size: 0.5, force: 0.4, hardness: 0.9, amp: p.mech * 0.25, double: 0.3, damp: 0.3 }); } // bolt / slide + casing
        if (i === n - 1 && dist < 0.9) { const tl = DSP.noise(ctx, rng, t, p.tail + 0.2, 'brown'); const tf = DSP.filter(ctx, 'lowpass', 500, 0.7); const tg = DSP.gain(ctx, 0); DSP.env(tg.gain, t + 0.02, { a: 0.01, d: p.tail, peak: 0.5 * w.body * (0.4 + dist) }); DSP.chain(tl, tf, tg, lp); }
      }
    },
  });

  R({
    id: 'laser', name: 'Laser / Zap', category: 'Weapons', icon: '🔫',
    params: [P.sel('style', 'Style', ['pew', 'zap', 'beam', 'charge', 'blaster', 'electric'], 'pew'), P.r('start', 'Start freq', 100, 6000, 1800, 'Hz'), P.r('end', 'End freq', 50, 6000, 300, 'Hz'), P.r('length', 'Length', 0.05, 2, 0.25, 's'), P.sel('wave', 'Wave', ['sawtooth', 'square', 'sine', 'triangle'], 'sawtooth'), P.r('fm', 'FM amount', 0, 1, 0.3), P.r('noise', 'Noise', 0, 1, 0.2)],
    duration(p) { return p.length + 0.3; },
    build(ctx, out, p, rng, t0) {
      const L = p.length; let f0 = p.start, f1 = p.end;
      if (p.style === 'charge') { f0 = p.end; f1 = p.start; }
      const o = DSP.osc(ctx, p.wave, f0, t0, L);
      if (p.style === 'beam') { o.frequency.setValueAtTime(f0, t0); o.frequency.linearRampToValueAtTime(f0 * 1.05, t0 + L); }
      else DSP.sweep(o.frequency, t0, f0, t0 + L, f1);
      if (p.fm > 0) { const m = DSP.osc(ctx, 'sine', p.style === 'electric' ? 60 : f0 * 0.5, t0, L); const mg = DSP.gain(ctx, f0 * p.fm * (p.style === 'electric' ? 2 : 0.8)); DSP.chain(m, mg, o.frequency); }
      const lp = DSP.filter(ctx, 'lowpass', 6000, 2); DSP.sweep(lp.frequency, t0, 8000, t0 + L, p.style === 'charge' ? 9000 : 1200);
      const g = DSP.gain(ctx, 0);
      if (p.style === 'charge') { g.gain.setValueAtTime(0.0005, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + L); g.gain.exponentialRampToValueAtTime(0.0005, t0 + L + 0.05); }
      else if (p.style === 'beam') DSP.env(g.gain, t0, { a: 0.01, d: 0.02, s: 0.8, hold: L - 0.05, r: 0.03, peak: 0.45 });
      else DSP.env(g.gain, t0, { a: 0.002, d: L, peak: 0.5, r: 0.03 });
      DSP.chain(o, lp, g, out);
      if (p.style === 'blaster' || p.style === 'zap') { const o2 = DSP.osc(ctx, 'square', f0 * 1.5, t0, L * 0.5); DSP.sweep(o2.frequency, t0, f0 * 1.5, t0 + L * 0.5, f1 * 0.5); const g2 = DSP.gain(ctx, 0); DSP.env(g2.gain, t0, { a: 0.001, d: L * 0.4, peak: 0.25 }); DSP.chain(o2, g2, out); }
      if (p.noise > 0 || p.style === 'electric') { const n = DSP.noise(ctx, rng, t0, L, p.style === 'electric' ? 'crackle' : 'white'); const nf = DSP.filter(ctx, 'bandpass', f0, 3); DSP.sweep(nf.frequency, t0, f0, t0 + L, f1); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, t0, { a: 0.002, d: L, peak: (p.style === 'electric' ? 2 : 0.4) * Math.max(p.noise, p.style === 'electric' ? 0.5 : 0) }); DSP.chain(n, nf, ng, out); }
    },
  });

  R({
    id: 'bow', name: 'Bow / Projectile', category: 'Weapons', icon: '🏹',
    params: [P.sel('type', 'Type', ['bow-release', 'arrow-flyby', 'arrow-hit', 'throw', 'crossbow'], 'bow-release'), P.r('tension', 'Tension', 0, 1, 0.6), P.r('length', 'Length', 0.1, 1, 0.35, 's')],
    duration(p) { return p.length + 0.6; },
    build(ctx, out, p, rng, t0) {
      const L = p.length;
      if (p.type === 'bow-release' || p.type === 'crossbow') {
        const f = 120 + p.tension * 250;
        const o = DSP.osc(ctx, 'triangle', f, t0, 0.4); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.001, d: 0.15 + p.tension * 0.15, peak: 0.6 }); DSP.chain(o, g, out);
        const o2 = DSP.osc(ctx, 'sine', f * 2.1, t0, 0.2); const g2 = DSP.gain(ctx, 0); DSP.env(g2.gain, t0, { a: 0.001, d: 0.06, peak: 0.3 }); DSP.chain(o2, g2, out);
        DSP.hit(ctx, out, rng, t0, { thumpAmp: p.type === 'crossbow' ? 0.6 : 0.3, thumpFreq: 100, thumpDecay: 0.06, noiseAmp: 0.4, noiseFreq: 2200, noiseQ: 1, noiseDecay: 0.03, ring: p.type === 'crossbow' ? [600, 1100] : [], ringAmp: 0.2, ringDecay: 0.1 });
        const n = DSP.noise(ctx, rng, t0 + 0.01, L); const nf = DSP.filter(ctx, 'bandpass', 3000, 2); DSP.sweep(nf.frequency, t0 + 0.01, 4000, t0 + L, 1200); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, t0 + 0.01, { a: 0.01, d: L, peak: 0.3 }); DSP.chain(n, nf, ng, out);
      } else if (p.type === 'arrow-flyby' || p.type === 'throw') {
        const n = DSP.noise(ctx, rng, t0, L); const f = DSP.filter(ctx, 'bandpass', 2500, 4 + p.tension * 8); DSP.sweep(f.frequency, t0, 1500, t0 + L, 4500); const g = DSP.gain(ctx, 0); g.gain.setValueAtTime(0.0005, t0); g.gain.exponentialRampToValueAtTime(0.7, t0 + L * 0.5); g.gain.exponentialRampToValueAtTime(0.0005, t0 + L); const pan = DSP.pan(ctx, -0.8); pan.pan.linearRampToValueAtTime(0.8, t0 + L); DSP.chain(n, f, g, pan, out);
        if (p.type === 'arrow-flyby') { const o = DSP.osc(ctx, 'sine', 2000, t0, L); DSP.sweep(o.frequency, t0, 2400, t0 + L, 1600); const g2 = DSP.gain(ctx, 0); g2.gain.setValueAtTime(0.0005, t0); g2.gain.exponentialRampToValueAtTime(0.1, t0 + L * 0.5); g2.gain.exponentialRampToValueAtTime(0.0005, t0 + L); DSP.chain(o, g2, out); }
      } else {
        DSP.hit(ctx, out, rng, t0, { thumpAmp: 0.5, thumpFreq: 120, thumpDecay: 0.05, noiseAmp: 0.6, noiseFreq: 1800, noiseQ: 1.2, noiseDecay: 0.03, ring: [450, 900, 1600], ringAmp: 0.2, ringDecay: 0.15 });
        const o = DSP.osc(ctx, 'sine', 900, t0 + 0.01, 0.4); const m = DSP.osc(ctx, 'sine', 40 + p.tension * 30, t0, 0.4); const mg = DSP.gain(ctx, 300); DSP.chain(m, mg, o.frequency); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0 + 0.01, { a: 0.002, d: 0.25 + p.tension * 0.2, peak: 0.35 }); DSP.chain(o, g, out);
      }
    },
  });

  R({
    id: 'reload', name: 'Reload / Gun Mech', category: 'Weapons', icon: '🔩',
    params: [P.sel('type', 'Type', ['mag-out', 'mag-in', 'slide', 'cock', 'full-reload', 'empty-click'], 'full-reload'), P.r('size', 'Size', 0, 1, 0.5), P.r('speed', 'Speed', 0.5, 2, 1)],
    duration(p) { return (p.type === 'full-reload' ? 1.4 : 0.4) / p.speed + 0.3; },
    build(ctx, out, p, rng, t0) {
      const base = 1.4 - p.size * 0.8; const sp = 1 / p.speed;
      const click = (t, a, f) => DSP.hit(ctx, out, rng, t, { thumpAmp: 0.25 * a, thumpFreq: 220 * base, thumpDecay: 0.015, noiseAmp: 0.5 * a, noiseFreq: f * base, noiseQ: 2, noiseDecay: 0.015, ring: [1700 * base, 2900 * base, 4200 * base], ringAmp: 0.3 * a, ringDecay: 0.06 });
      const slide = (t, L, up) => { const n = DSP.noise(ctx, rng, t, L); const f = DSP.filter(ctx, 'bandpass', 1500 * base, 2.5); DSP.sweep(f.frequency, t, (up ? 900 : 2200) * base, t + L, (up ? 2200 : 900) * base); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.01, d: L, peak: 0.3, curve: 'lin' }); DSP.chain(n, f, g, out); };
      const thud = (t, a) => DSP.hit(ctx, out, rng, t, { thumpAmp: 0.5 * a, thumpFreq: 110 * base, thumpDecay: 0.04, noiseAmp: 0.4 * a, noiseFreq: 1200 * base, noiseQ: 1, noiseDecay: 0.03, ring: [800 * base, 1400 * base], ringAmp: 0.2 * a, ringDecay: 0.1 });
      const seq = { 'mag-out': [['c', 0, 0.8, 3000], ['s', 0.03, 0.12, false], ['t', 0.2, 0.5]], 'mag-in': [['s', 0, 0.1, true], ['t', 0.1, 1], ['c', 0.12, 0.6, 2500]], slide: [['s', 0, 0.15, false], ['c', 0.16, 1, 3200], ['s', 0.2, 0.08, true], ['t', 0.28, 0.8]], cock: [['c', 0, 0.7, 2800], ['s', 0.02, 0.1, false], ['t', 0.15, 0.9], ['c', 0.16, 0.9, 3400]], 'empty-click': [['c', 0, 1, 3600], ['c', 0.05, 0.5, 2800]], 'full-reload': [['c', 0, 0.8, 3000], ['s', 0.03, 0.12, false], ['t', 0.2, 0.5], ['s', 0.6, 0.1, true], ['t', 0.7, 1], ['c', 0.72, 0.6, 2500], ['s', 0.95, 0.15, false], ['c', 1.1, 1, 3200], ['s', 1.14, 0.08, true], ['t', 1.22, 0.8]] }[p.type];
      seq.forEach(e => { const t = t0 + e[1] * sp; if (e[0] === 'c') click(t, e[2], e[3]); else if (e[0] === 's') slide(t, e[2] * sp, e[3]); else thud(t, e[2]); });
    },
  });
})();
