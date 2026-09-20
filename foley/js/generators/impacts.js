/* Impacts, hits, breakage, mechanical foley. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  R({
    id: 'impact', name: 'Impact', category: 'Impacts', icon: '💥',
    params: [
      P.sel('material', 'Material', ['wood', 'metal', 'stone', 'flesh', 'rubber', 'plastic', 'cardboard', 'glass'], 'wood'),
      P.r('size', 'Size', 0, 1, 0.5), P.r('force', 'Force', 0, 1, 0.7), P.r('tone', 'Tone / ring', 0, 1, 0.4), P.r('debris', 'Debris', 0, 1, 0.2), P.r('drive', 'Crunch', 0, 1, 0),
    ],
    duration(p) { return 0.5 + p.size * 0.6 + p.tone * 0.5; },
    build(ctx, out, p, rng, t0) {
      const m = {
        wood: { tf: 110, nf: 1400, nq: 1.5, ring: [380, 760, 1150], rd: 0.18, nc: 'white' },
        metal: { tf: 120, nf: 2500, nq: 1.2, ring: [720, 1130, 1820, 2600, 3900], rd: 0.9, nc: 'white' },
        stone: { tf: 85, nf: 2200, nq: 0.9, ring: [1600, 2900], rd: 0.06, nc: 'white' },
        flesh: { tf: 70, nf: 500, nq: 0.6, ring: [], rd: 0.05, nc: 'pink' },
        rubber: { tf: 95, nf: 350, nq: 2, ring: [180], rd: 0.12, nc: 'pink' },
        plastic: { tf: 140, nf: 1800, nq: 2.5, ring: [900, 1500], rd: 0.09, nc: 'white' },
        cardboard: { tf: 80, nf: 600, nq: 1, ring: [], rd: 0.05, nc: 'pink' },
        glass: { tf: 200, nf: 4000, nq: 3, ring: [2100, 3400, 5200, 7000], rd: 0.5, nc: 'white' },
      }[p.material];
      const sz = 1.6 - p.size * 1.1; // size scales pitch down
      const Mt = Foley.Materials;
      if (p.material === 'metal' || p.material === 'glass' || p.material === 'stone') { // physical models (core/materials.js)
        const hard = 0.35 + p.tone * 0.5, dbl = 0.25 + p.force * 0.3;
        if (p.material === 'metal') Mt.metalHit(ctx, out, rng, t0, { kind: p.size < 0.3 ? 'thin' : p.size < 0.7 ? 'plate' : 'heavy', size: 0.7 + p.size * 0.9, force: p.force, hardness: hard, amp: 1, double: dbl, damp: (1 - p.tone) * 0.7 });
        else if (p.material === 'glass') Mt.glassHit(ctx, out, rng, t0, { kind: p.size < 0.35 ? 'shard' : p.size < 0.75 ? 'pane' : 'bottle', size: 0.7 + p.size * 0.8, force: p.force, hardness: hard, amp: 1, double: dbl * 0.6, damp: (1 - p.tone) * 0.6 });
        else Mt.masonryHit(ctx, out, rng, t0, { kind: p.size < 0.35 ? 'stone' : p.size < 0.75 ? 'concrete' : 'boulder', ground: 'bedrock', size: 0.7 + p.size * 0.9, force: p.force, hardness: hard, amp: 1, groundMix: 0.4 + p.size * 0.5, damp: (1 - p.tone) * 0.5 });
        if (p.debris > 0) { const dl = 0.12 + p.debris * 0.35; const hz = p.material === 'glass' ? 4500 : p.material === 'metal' ? 2800 : 1800; DSP.grains(ctx, out, rng, t0 + 0.02, { count: Math.round(3 + p.debris * 14), spread: dl, len: 0.008, freq: hz * sz, freqVar: 0.5, Q: 4, amp: p.debris * 0.22, color: 'velvet' }); }
        return;
      }
      if (p.material === 'flesh' || p.material === 'rubber' || p.material === 'cardboard') { // soft-body models
        Mt.softHit(ctx, out, rng, t0, { kind: p.material, size: 0.7 + p.size * 0.9, force: p.force, hardness: 0.15 + p.tone * 0.4, amp: 1, damp: (1 - p.tone) * 0.4 });
        if (p.debris > 0 && p.material === 'cardboard') Mt.pings(ctx, out, rng, t0 + 0.02, 0.1 + p.debris * 0.3, { count: Math.round(4 + p.debris * 16), hz: 3200 * sz, spread: 0.5, lenMin: 0.002, lenMax: 0.006, amp: p.debris * 0.25 });
        return;
      }
      if (p.material === 'wood') { // physical wood model (see core/materials.js)
        const kind = p.size < 0.3 ? 'stick' : p.size < 0.72 ? 'plank' : 'beam';
        Foley.Materials.woodHit(ctx, out, rng, t0, { kind, size: 0.7 + p.size * 0.9, force: p.force, hardness: 0.35 + p.tone * 0.5, amp: 1, double: 0.3 + p.force * 0.3, damp: (1 - p.tone) * 0.5 });
        if (p.drive > 0) { /* crunch is folded into the model's saturation; extra grit via debris below */ }
        if (p.debris > 0) DSP.grains(ctx, out, rng, t0 + 0.02, { count: Math.round(3 + p.debris * 16), spread: 0.1 + p.debris * 0.3, len: 0.008, freq: 2200 * sz, freqVar: 0.6, Q: 1.5, amp: p.debris * 0.3, color: 'pink' });
        return;
      }
      DSP.hit(ctx, out, rng, t0, {
        thumpAmp: 0.4 + p.force * 0.6 + p.size * 0.3, thumpFreq: m.tf * sz * rng.range(0.95, 1.05), thumpDecay: 0.06 + p.size * 0.25, thumpSweep: 2 + p.force * 2,
        noiseAmp: 0.3 + p.force * 0.5, noiseColor: m.nc, noiseFreq: m.nf * sz, noiseQ: m.nq, noiseDecay: 0.03 + p.size * 0.1 + p.force * 0.03,
        ring: m.ring.map(f => f * sz * rng.range(0.98, 1.02)), ringAmp: p.tone * 0.5, ringDecay: m.rd * (0.5 + p.size), drive: p.drive,
      });
      if (p.debris > 0) DSP.grains(ctx, out, rng, t0 + 0.02, { count: Math.round(4 + p.debris * 30), spread: 0.15 + p.debris * 0.4, len: 0.01, freq: m.nf * 1.5, freqVar: 0.6, Q: 2, amp: p.debris * 0.4 });
    },
  });

  R({
    id: 'punch', name: 'Punch / Hit', category: 'Impacts', icon: '👊',
    params: [P.r('force', 'Force', 0, 1, 0.7), P.r('weight', 'Weight', 0, 1, 0.5), P.r('snap', 'Snap', 0, 1, 0.5), P.r('whoosh', 'Pre-whoosh', 0, 1, 0.4), P.r('crunch', 'Crunch', 0, 1, 0.2), P.tog('wet', 'Wet', false)],
    duration(p) { return 0.45; },
    build(ctx, out, p, rng, t0) {
      const t = t0 + p.whoosh * 0.12;
      if (p.whoosh > 0) { const n = DSP.noise(ctx, rng, t0, 0.15); const f = DSP.filter(ctx, 'bandpass', 900, 2); DSP.sweep(f.frequency, t0, 500, t, 2200); const g = DSP.gain(ctx, 0); g.gain.setValueAtTime(0.0005, t0); g.gain.exponentialRampToValueAtTime(p.whoosh * 0.35, t - 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.02); DSP.chain(n, f, g, out); }
      // fist into flesh: soft-body strike (skin slap + damped body modes) with a low thump that scales with weight
      Foley.Materials.softHit(ctx, out, rng, t, { kind: p.weight > 0.6 ? 'body' : 'flesh', size: 0.8 + p.weight * 0.8, force: p.force, hardness: 0.2 + p.snap * 0.5, amp: 1, double: 0.1 });
      DSP.hit(ctx, out, rng, t, { thumpAmp: 0.4 + p.force * 0.5, thumpFreq: 55 + (1 - p.weight) * 45, thumpDecay: 0.08 + p.weight * 0.12, thumpSweep: 3.5, noiseAmp: 0, drive: p.force * 0.4 });
      if (p.crunch > 0) Foley.Materials.pings(ctx, out, rng, t, 0.08, { count: Math.round(3 + p.crunch * 12), hz: 1900, spread: 0.5, lenMin: 0.003, lenMax: 0.009, amp: p.crunch * 0.6, front: 2, lp: 5000 }); // bone / cartilage
      if (p.wet) { const n = DSP.noise(ctx, rng, t, 0.25); const f = DSP.filter(ctx, 'bandpass', 600, 5); DSP.sweep(f.frequency, t, 1500, t + 0.2, 250); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.005, d: 0.18, peak: 0.4 }); DSP.chain(n, f, g, out); }
    },
  });

  R({
    id: 'glass', name: 'Glass Shatter', category: 'Impacts', icon: '🪟',
    params: [P.r('size', 'Pane size', 0, 1, 0.5), P.r('shards', 'Shards', 5, 120, 40), P.r('spread', 'Scatter time', 0.1, 2, 0.6, 's'), P.r('ring', 'Ring', 0, 1, 0.5), P.r('impact', 'Impact', 0, 1, 0.5)],
    duration(p) { return p.spread + 0.6; },
    build(ctx, out, p, rng, t0) {
      const base = 1.8 - p.size; const Mt = Foley.Materials;
      // the pane breaks: a glass-pane strike (physical model) with its ring cut short by the fracture
      Mt.glassHit(ctx, out, rng, t0, { kind: 'pane', size: 0.8 + p.size * 1.2, force: 0.6 + p.impact * 0.4, hardness: 0.9, amp: 1, double: 0, damp: 0.5 - p.ring * 0.4 });
      DSP.hit(ctx, out, rng, t0, { thumpAmp: p.impact * 0.5, thumpFreq: 150, thumpDecay: 0.05, noiseAmp: 0.35, noiseColor: 'velvet', noiseType: 'highpass', noiseFreq: 3000, noiseQ: 0.5, noiseDecay: 0.03 });
      // shards: real glass shard strikes (shared banks) landing over the scatter time, plus fine glass-dust pings
      const n = Math.min(60, Math.round(p.shards)); const banks = Mt.banks(ctx, out, rng, 'glass', 'shard', 1 / base, 4);
      for (let i = 0; i < n; i++) {
        const u = Math.pow(rng.next(), 0.6), t = t0 + 0.01 + u * p.spread;
        Mt.strike(ctx, out, rng, t, Mt.GLASS.shard, { size: rng.range(0.6, 1.6) / base, force: rng.range(0.3, 0.9), hardness: 0.9, amp: rng.range(0.15, 0.5) * (1 - u * 0.5), shared: banks, double: 0.4 });
      }
      DSP.grains(ctx, out, rng, t0 + 0.01, { count: Math.round(p.shards * 1.5), spread: p.spread, len: 0.005, freq: 7000 * base, freqVar: 0.4, Q: 6, amp: 0.15, color: 'velvet', decayShape: 1.4 });
    },
  });

  R({
    id: 'sword', name: 'Blade / Metal Ring', category: 'Impacts', icon: '⚔️',
    params: [P.sel('type', 'Type', ['clash', 'draw', 'sheath', 'ring', 'parry'], 'clash'), P.r('pitch', 'Pitch', 0.5, 2, 1), P.r('decay', 'Decay', 0.1, 2, 0.6, 's'), P.r('bright', 'Brightness', 0, 1, 0.6), P.r('scrape', 'Scrape', 0, 1, 0.3)],
    duration(p) { return p.decay + 0.5; },
    build(ctx, out, p, rng, t0) {
      const Mt = Foley.Materials; const bsz = 1 / p.pitch;
      const ringAmp = { clash: 1, draw: 0.3, sheath: 0.45, ring: 1.1, parry: 0.9 }[p.type];
      // the blade is a physical metal bar (long ring, highs persist); decay/brightness set damping
      if (p.type !== 'draw') { Mt.metalHit(ctx, out, rng, t0, { kind: 'blade', size: bsz, force: p.type === 'ring' ? 0.5 : 0.9, hardness: 0.6 + p.bright * 0.4, amp: ringAmp, double: p.type === 'clash' ? 0.5 : 0.1, damp: DSP.clamp(1 - p.decay / 2, 0, 0.9) * (1 - p.bright * 0.4) }); if (p.type === 'clash') Mt.metalHit(ctx, out, rng, t0 + rng.range(0.003, 0.012), { kind: 'blade', size: bsz * rng.range(0.85, 1.15), force: 0.8, hardness: 0.9, amp: ringAmp * 0.6, double: 0, damp: DSP.clamp(1 - p.decay / 2, 0, 0.9) }); }
      if (p.type === 'draw' || p.type === 'sheath' || p.scrape > 0) {
        const L = p.type === 'draw' ? 0.5 : p.type === 'sheath' ? 0.3 : 0.15;
        const n = DSP.noise(ctx, rng, t0, L);
        const f = DSP.filter(ctx, 'bandpass', 4000 * p.pitch, 3); DSP.sweep(f.frequency, t0, 2500 * p.pitch, t0 + L, (p.type === 'sheath' ? 2000 : 7000) * p.pitch);
        const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.02, d: L, peak: (p.type === 'clash' ? p.scrape : 0.5) * 0.4, curve: 'lin' });
        DSP.chain(n, f, g, out);
        const ringT = p.type === 'draw' ? t0 + L * 0.9 : t0;
        if (p.type === 'draw') Mt.metalHit(ctx, out, rng, ringT, { kind: 'blade', size: bsz * 0.8, force: 0.35, hardness: 0.9, amp: 0.35, double: 0, damp: DSP.clamp(1 - p.decay / 2, 0, 0.9) }); // the tip leaving the scabbard rings the blade
      }
    },
  });

  R({
    id: 'door', name: 'Door / Creak', category: 'Impacts', icon: '🚪',
    params: [P.sel('type', 'Type', ['creak', 'slam', 'knock', 'latch', 'open-close'], 'creak'), P.r('length', 'Creak length', 0.2, 3, 1.2, 's'), P.r('pitch', 'Pitch', 0.5, 2, 1), P.r('stutter', 'Stutter', 0, 1, 0.5), P.r('weight', 'Weight', 0, 1, 0.5)],
    duration(p) { return p.type === 'creak' || p.type === 'open-close' ? p.length + 0.6 : 0.8; },
    build(ctx, out, p, rng, t0) {
      const creak = (t, L) => { // hinge friction (stick-slip) through the door panel body
        Foley.Materials.creak(ctx, out, rng, t, L, { kind: 'panel', size: 1.4 / p.pitch, amp: 0.9, pitch: p.pitch * 1.3, stutter: p.stutter, tension: 0.4 + p.weight * 0.5 });
      };
      const slam = (t, a) => { Foley.Materials.woodHit(ctx, out, rng, t, { kind: 'panel', size: 1.5 + p.weight * 0.8, force: 0.8 + p.weight * 0.2, hardness: 0.3, amp: a, double: 0.5, pos: 0.2 }); DSP.hit(ctx, out, rng, t, { thumpAmp: (0.5 + p.weight * 0.6) * a, thumpFreq: 55, thumpDecay: 0.15 + p.weight * 0.15, thumpSweep: 3, noiseAmp: 0.25 * a, noiseColor: 'pink', noiseFreq: 700, noiseQ: 1, noiseDecay: 0.06 }); };
      const latch = (t, a) => { DSP.hit(ctx, out, rng, t, { thumpAmp: 0.2 * a, thumpFreq: 200, thumpDecay: 0.02, noiseAmp: 0.5 * a, noiseFreq: 3000, noiseQ: 3, noiseDecay: 0.02, ring: [1900, 3100, 4700], ringAmp: 0.25 * a, ringDecay: 0.08 }); DSP.hit(ctx, out, rng, t + 0.04, { thumpAmp: 0.15 * a, thumpFreq: 150, thumpDecay: 0.03, noiseAmp: 0.3 * a, noiseFreq: 2200, noiseQ: 2, noiseDecay: 0.02, ring: [1500, 2600], ringAmp: 0.15 * a, ringDecay: 0.06 }); };
      if (p.type === 'creak') creak(t0, p.length);
      else if (p.type === 'slam') slam(t0, 1);
      else if (p.type === 'latch') latch(t0, 1);
      else if (p.type === 'knock') { const n = 2 + Math.round(p.stutter * 3); const banks = Foley.Materials.woodBanks(ctx, out, rng, 'panel', 1.2 / p.pitch, 2); for (let i = 0; i < n; i++) Foley.Materials.woodHit(ctx, out, rng, t0 + i * rng.range(0.16, 0.22), { kind: 'panel', size: 1.2 / p.pitch, force: 0.5 + p.weight * 0.4, hardness: 0.55, amp: rng.range(0.8, 1), double: 0.2, shared: banks }); }
      else { latch(t0, 0.8); creak(t0 + 0.12, p.length); slam(t0 + p.length + 0.2, 0.7); }
    },
  });

  R({
    id: 'squish', name: 'Squish / Gore', category: 'Impacts', icon: '🩸',
    params: [P.r('wetness', 'Wetness', 0, 1, 0.7), P.r('size', 'Size', 0, 1, 0.5), P.r('length', 'Length', 0.1, 1.5, 0.4, 's'), P.r('bubbles', 'Bubbles', 0, 1, 0.4), P.r('crunch', 'Bone crunch', 0, 1, 0.2)],
    duration(p) { return p.length + 0.3; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, base = 1.5 - p.size;
      DSP.hit(ctx, out, rng, t0, { thumpAmp: 0.4 + p.size * 0.4, thumpFreq: 60 * base, thumpDecay: 0.1, noiseAmp: 0.4, noiseColor: 'pink', noiseFreq: 400 * base, noiseQ: 1, noiseDecay: 0.08 });
      const n = DSP.noise(ctx, rng, t0, L);
      const f = DSP.filter(ctx, 'bandpass', 800 * base, 6 + p.wetness * 10);
      f.frequency.setValueAtTime(1500 * base, t0);
      const segs = 4 + Math.round(p.wetness * 8);
      for (let i = 1; i <= segs; i++) f.frequency.exponentialRampToValueAtTime(rng.range(200, 1600) * base, t0 + (i / segs) * L);
      const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.005, d: L, peak: 0.3 + p.wetness * 0.4, r: 0.05 });
      DSP.chain(n, f, g, out);
      if (p.bubbles > 0) { const c = Math.round(p.bubbles * 12 * L * 2); for (let i = 0; i < c; i++) { const t = t0 + rng.range(0.02, L); const fr = rng.range(300, 1200) * base; const o = DSP.osc(ctx, 'sine', fr, t, 0.06); DSP.sweep(o.frequency, t, fr, t + 0.05, fr * 1.5); const bg = DSP.gain(ctx, 0); DSP.env(bg.gain, t, { a: 0.002, d: 0.04, peak: 0.12 }); DSP.chain(o, bg, out); } }
      if (p.crunch > 0) DSP.grains(ctx, out, rng, t0, { count: Math.round(3 + p.crunch * 14), spread: 0.12, len: 0.012, freq: 1800, freqVar: 0.5, Q: 1, amp: p.crunch * 0.5, color: 'pink', decayShape: 2 });
    },
  });

  /* ---- Chains ---------------------------------------------------------------- */
  /* One chain link: short metallic clink = inharmonic ring partials + click transient. */
  /* One chain link: a physical metal 'link' strike (dense inharmonic ring, pitch-drop on hard hits). o.shared reuses banks. */
  function link(ctx, out, rng, t, o) {
    const sz = o.size, amp = o.amp, damp = o.damp || 0;
    Foley.Materials.metalHit(ctx, out, rng, t, { kind: 'link', size: (0.6 + sz * 0.9) * rng.range(0.85, 1.15), force: 0.4 + amp * 0.5, hardness: 0.85, amp: amp * 0.8, double: 0.15, damp: damp * 0.8, shared: o.shared });
  }
  /* A cluster of links jostling together (shares a few link bodies so long rattles stay cheap). */
  function rattle(ctx, out, rng, t0, L, o) {
    let rate = o.rate; const size = o.size, amp = o.amp, damp = o.damp || 0, env = o.env || (() => 1);
    const est = rate * L * 1.4; if (est > 180) rate *= 180 / est; // keep node count bounded for long/fast rattles
    const shared = Foley.Materials.banks(ctx, out, rng, 'metal', 'link', 0.6 + size * 0.9, 4);
    let t = 0; let n = 0; const max = 220;
    while (t < L && n < max) {
      t += (1 / rate) * rng.range(0.3, 1.7); if (t >= L) break;
      const k = rng.next() < 0.35 ? rng.int(2, 4) : 1;
      for (let i = 0; i < k; i++, n++) link(ctx, out, rng, t0 + t + i * rng.range(0.003, 0.012), { size, amp: amp * env(t / L) * rng.range(0.35, 1), damp, shared });
    }
  }
  /* Wood interactions used by drawbridge: creaking timbers and plank thumps. */
  /* Timber creak: stick-slip friction through a wood beam body (core/materials.js), not a synth sawtooth. */
  function woodCreak(ctx, out, rng, t, L, amp, pitch) {
    Foley.Materials.creak(ctx, out, rng, t, L, { kind: 'beam', size: 1.8 / (pitch || 1), amp: amp * 1.6, pitch: pitch || 1, stutter: 0.5, tension: 0.6 });
  }
  function woodThump(ctx, out, rng, t, amp, big) {
    Foley.Materials.woodHit(ctx, out, rng, t, { kind: big ? 'beam' : 'plank', size: big ? 2.2 : 1.3, force: big ? 1 : 0.6, hardness: 0.4, amp: amp * (big ? 1.3 : 0.8), double: big ? 0.6 : 0.3 });
    if (big) DSP.hit(ctx, out, rng, t, { thumpAmp: amp * 0.9, thumpFreq: 45, thumpDecay: 0.35, thumpSweep: 3, noiseAmp: 0.25 * amp, noiseColor: 'brown', noiseType: 'lowpass', noiseFreq: 300, noiseQ: 0.7, noiseDecay: 0.15 });
  }

  R({
    id: 'chain', name: 'Chain', category: 'Impacts', icon: '⛓️',
    params: [
      P.sel('type', 'Type', ['rattle', 'drag', 'drop', 'hoist', 'lower', 'clink', 'swing', 'drawbridge-lower', 'drawbridge-raise'], 'rattle'),
      P.r('length', 'Length', 0.2, 8, 1.5, 's'), P.r('size', 'Link size', 0, 1, 0.5), P.r('speed', 'Speed', 0, 1, 0.5),
      P.r('damp', 'Damping (rust/rope)', 0, 1, 0.2), P.r('wood', 'Wood', 0, 1, 0.5), P.r('mechanism', 'Winch / gear', 0, 1, 0.4), P.r('impact', 'End impact', 0, 1, 0.7),
    ],
    duration(p) { return p.length + (p.type.startsWith('drawbridge') || p.type === 'drop' ? 1.5 : 0.5); },
    build(ctx, out, p, rng, t0) {
      const L = p.length, sz = p.size, damp = p.damp;
      const rateBase = 14 + p.speed * 40 - sz * 8;
      if (p.type === 'rattle') rattle(ctx, out, rng, t0, L, { rate: rateBase, size: sz, amp: 0.8, damp, env: u => 1 - u * 0.5 });
      else if (p.type === 'clink') { const n = 1 + Math.round(p.speed * 4); for (let i = 0; i < n; i++) link(ctx, out, rng, t0 + i * rng.range(0.08, 0.2), { size: sz, amp: 0.9 * rng.range(0.6, 1), damp }); }
      else if (p.type === 'swing') { const per = 0.5 + (1 - p.speed) * 1.2; let t = 0; while (t < L) { rattle(ctx, out, rng, t0 + t, Math.min(0.25, L - t), { rate: rateBase, size: sz, amp: 0.6, damp, env: u => 1 - u }); t += per * rng.range(0.9, 1.1); } }
      else if (p.type === 'drag') {
        rattle(ctx, out, rng, t0, L, { rate: rateBase * 1.3, size: sz, amp: 0.55, damp: damp + 0.2 });
        const n = DSP.noise(ctx, rng, t0, L, 'pink'); const f = DSP.filter(ctx, 'bandpass', 1500 * (1.5 - sz), 1.2); const g = DSP.gain(ctx, 0); const seg = Math.round(L * 8); g.gain.setValueAtTime(0.0005, t0); for (let i = 1; i < seg; i++) g.gain.linearRampToValueAtTime(rng.range(0.1, 0.35), t0 + (i / seg) * L); g.gain.linearRampToValueAtTime(0, t0 + L); DSP.chain(n, f, g, out);
      }
      else if (p.type === 'drop') {
        // chain pile falling: accelerating rattle → heavy crash of links → settle
        const fall = Math.min(L, 0.6); rattle(ctx, out, rng, t0, fall, { rate: rateBase, size: sz, amp: 0.5, damp, env: u => 0.3 + u });
        const tc = t0 + fall; DSP.hit(ctx, out, rng, tc, { thumpAmp: 0.6 * p.impact, thumpFreq: 80, thumpDecay: 0.12, noiseAmp: 0.6, noiseFreq: 2500, noiseQ: 0.8, noiseDecay: 0.05 });
        rattle(ctx, out, rng, tc, Math.max(0.3, L - fall), { rate: rateBase * 3, size: sz, amp: 1, damp, env: u => Math.pow(1 - u, 1.8) });
      }
      else if (p.type === 'hoist' || p.type === 'lower') {
        // rhythmic links passing over a pulley/winch, with gear clicks
        const per = 1 / Math.min(3 + p.speed * 9, 120 / L); let t = 0;
        const lb = Foley.Materials.banks(ctx, out, rng, 'metal', 'link', 0.6 + sz * 0.9, 3); while (t < L) { link(ctx, out, rng, t0 + t, { size: sz, amp: 0.7, damp, shared: lb }); if (rng.next() < 0.5) link(ctx, out, rng, t0 + t + rng.range(0.02, 0.06), { size: sz, amp: 0.35, damp, shared: lb }); if (p.mechanism > 0) DSP.hit(ctx, out, rng, t0 + t + per * 0.5, { thumpAmp: 0.15 * p.mechanism, thumpFreq: 160, thumpDecay: 0.02, noiseAmp: 0.4 * p.mechanism, noiseFreq: 3200, noiseQ: 3, noiseDecay: 0.01, ring: [2100, 3300], ringAmp: 0.15 * p.mechanism, ringDecay: 0.04 }); t += per * rng.range(0.9, 1.1); }
        if (p.wood > 0) woodCreak(ctx, out, rng, t0, L, p.wood * 0.25, 1);
        if (p.type === 'hoist' && p.impact > 0) DSP.hit(ctx, out, rng, t0 + L, { thumpAmp: 0.5 * p.impact, thumpFreq: 120, thumpDecay: 0.05, noiseAmp: 0.4, noiseFreq: 2000, noiseQ: 1.5, noiseDecay: 0.03, ring: [900, 1500, 2400], ringAmp: 0.3 * p.impact, ringDecay: 0.2 });
        if (p.type === 'lower' && p.impact > 0) woodThump(ctx, out, rng, t0 + L, p.impact * 0.8, false);
      }
      else { // drawbridge: chain over wood beams + winch + timber creaks, ending in a boom (lower) or lock (raise)
        const lower = p.type === 'drawbridge-lower';
        const spd = lower ? u => 0.6 + u * 1.2 : u => 1.1 - u * 0.4; // lowering accelerates under gravity
        const bus = DSP.gain(ctx, 1); bus.connect(out); const lb2 = Foley.Materials.banks(ctx, bus, rng, 'metal', 'link', 0.6 + sz * 0.9, 3);
        let t = 0; let n = 0;
        const linkRate = Math.min(4 + p.speed * 8, 160 / L); // budget: ~160 primary links max
        while (t < L * 0.95 && n < 400) {
          const u = t / L; const per = 1 / (linkRate * spd(u));
          link(ctx, bus, rng, t0 + t, { size: Math.min(1, sz + 0.2), amp: 0.7, damp: damp + 0.1, shared: lb2 }); n++;
          if (rng.next() < 0.6) { link(ctx, bus, rng, t0 + t + rng.range(0.015, 0.05), { size: sz, amp: 0.4, damp, shared: lb2 }); n++; }
          if (p.wood > 0 && rng.next() < 0.55) woodThump(ctx, bus, rng, t0 + t + rng.range(0.005, 0.03), p.wood * 0.5 * rng.range(0.4, 1), false); // chain slapping the deck planks
          if (p.mechanism > 0) DSP.hit(ctx, bus, rng, t0 + t + per * 0.5, { thumpAmp: 0.2 * p.mechanism, thumpFreq: 140, thumpDecay: 0.025, noiseAmp: 0.35 * p.mechanism, noiseFreq: 2600, noiseQ: 3, noiseDecay: 0.012, ring: [1800, 2900], ringAmp: 0.15 * p.mechanism, ringDecay: 0.05 });
          t += per * rng.range(0.9, 1.1);
        }
        if (p.wood > 0) { const creaks = 1 + Math.round(L / 1.2); for (let i = 0; i < creaks; i++) woodCreak(ctx, bus, rng, t0 + rng.next() * L * 0.8, rng.range(0.4, 1.2), p.wood * 0.35, rng.range(0.6, 1.1)); }
        // low rumble of the deck under tension
        const rn = DSP.noise(ctx, rng, t0, L, 'brown'); const rf = DSP.filter(ctx, 'lowpass', 180, 1); const rg = DSP.gain(ctx, 0); DSP.env(rg.gain, t0, { a: 0.1, d: 0.1, s: 1, hold: L - 0.4, r: 0.3, peak: 0.6 * p.wood, curve: 'lin' }); DSP.chain(rn, rf, rg, bus);
        const te = t0 + L;
        if (lower) { // BOOM: deck slams down, chain settles, timbers groan
          woodThump(ctx, out, rng, te, p.impact * 1.3, true);
          DSP.hit(ctx, out, rng, te, { thumpAmp: 1.2 * p.impact, thumpFreq: 40, thumpDecay: 0.5, thumpSweep: 3, noiseAmp: 0.7 * p.impact, noiseColor: 'brown', noiseType: 'lowpass', noiseFreq: 400, noiseQ: 0.7, noiseDecay: 0.35 });
          DSP.grains(ctx, out, rng, te + 0.02, { count: 20, spread: 0.5, len: 0.02, freq: 1500, freqVar: 0.6, Q: 1, amp: 0.4 * p.impact, color: 'pink' });
          rattle(ctx, out, rng, te + 0.05, 0.7, { rate: rateBase * 2, size: sz, amp: 0.8, damp, env: u => Math.pow(1 - u, 2) });
          woodCreak(ctx, out, rng, te + 0.15, 0.8, p.wood * 0.3, 0.7);
        } else { // raise: chain goes taut, latch/lock clunk, final settle
          DSP.hit(ctx, out, rng, te, { thumpAmp: 0.6 * p.impact, thumpFreq: 90, thumpDecay: 0.1, noiseAmp: 0.4, noiseFreq: 1800, noiseQ: 1.5, noiseDecay: 0.04, ring: [700, 1200, 1900], ringAmp: 0.35 * p.impact, ringDecay: 0.3 });
          DSP.hit(ctx, out, rng, te + 0.18, { thumpAmp: 0.5 * p.impact, thumpFreq: 110, thumpDecay: 0.06, noiseAmp: 0.5, noiseFreq: 2400, noiseQ: 2, noiseDecay: 0.03, ring: [1100, 1900, 3100], ringAmp: 0.4 * p.impact, ringDecay: 0.25 });
          rattle(ctx, out, rng, te + 0.2, 0.4, { rate: rateBase, size: sz, amp: 0.4, damp, env: u => 1 - u });
          if (p.wood > 0) woodCreak(ctx, out, rng, te + 0.05, 0.6, p.wood * 0.3, 0.8);
        }
      }
    },
  });

  R({
    id: 'mech', name: 'Mechanical / Switch', category: 'Impacts', icon: '⚙️',
    params: [P.sel('type', 'Type', ['switch', 'lever', 'button', 'gear', 'ratchet', 'lock'], 'switch'), P.r('size', 'Size', 0, 1, 0.4), P.r('count', 'Repeats', 1, 12, 1), P.r('rate', 'Rate', 2, 30, 8, 'Hz'), P.r('metal', 'Metallic', 0, 1, 0.5)],
    duration(p) { return Math.round(p.count) / p.rate + 0.5; },
    build(ctx, out, p, rng, t0) {
      const base = 1.5 - p.size;
      const n = Math.round(p.count);
      for (let i = 0; i < n; i++) {
        const t = t0 + i / p.rate;
        if (p.type === 'switch' || p.type === 'button') {
          DSP.hit(ctx, out, rng, t, { thumpAmp: 0.25, thumpFreq: 220 * base, thumpDecay: 0.015, noiseAmp: 0.6, noiseFreq: 3200 * base, noiseQ: 2, noiseDecay: 0.012, ring: [1800 * base, 2700 * base], ringAmp: p.metal * 0.3, ringDecay: 0.05 });
          if (p.type === 'switch') DSP.hit(ctx, out, rng, t + 0.03, { thumpAmp: 0.2, thumpFreq: 180 * base, thumpDecay: 0.015, noiseAmp: 0.45, noiseFreq: 2600 * base, noiseQ: 2, noiseDecay: 0.012, ring: [1500 * base], ringAmp: p.metal * 0.25, ringDecay: 0.05 });
        } else if (p.type === 'lever') {
          const nz = DSP.noise(ctx, rng, t, 0.2); const f = DSP.filter(ctx, 'bandpass', 1200 * base, 3); DSP.sweep(f.frequency, t, 800 * base, t + 0.18, 2000 * base); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.01, d: 0.16, peak: 0.25, curve: 'lin' }); DSP.chain(nz, f, g, out);
          DSP.hit(ctx, out, rng, t + 0.18, { thumpAmp: 0.4, thumpFreq: 140 * base, thumpDecay: 0.03, noiseAmp: 0.5, noiseFreq: 2000 * base, noiseQ: 1.5, noiseDecay: 0.02, ring: [900 * base, 1600 * base, 2500 * base], ringAmp: p.metal * 0.4, ringDecay: 0.15 });
        } else if (p.type === 'gear' || p.type === 'ratchet') {
          DSP.hit(ctx, out, rng, t, { thumpAmp: 0.12, thumpFreq: 300 * base, thumpDecay: 0.01, noiseAmp: 0.5, noiseFreq: 4000 * base, noiseQ: 3, noiseDecay: 0.008, ring: [2400 * base * rng.range(0.95, 1.05)], ringAmp: p.metal * 0.2, ringDecay: 0.03 });
        } else { // lock
          DSP.hit(ctx, out, rng, t, { thumpAmp: 0.35, thumpFreq: 160 * base, thumpDecay: 0.03, noiseAmp: 0.5, noiseFreq: 2500 * base, noiseQ: 2, noiseDecay: 0.02, ring: [1100 * base, 1900 * base, 3300 * base], ringAmp: p.metal * 0.45, ringDecay: 0.2 });
          DSP.hit(ctx, out, rng, t + 0.09, { thumpAmp: 0.5, thumpFreq: 110 * base, thumpDecay: 0.05, noiseAmp: 0.4, noiseFreq: 1600 * base, noiseQ: 1.5, noiseDecay: 0.03, ring: [700 * base, 1300 * base], ringAmp: p.metal * 0.4, ringDecay: 0.25 });
        }
      }
    },
  });
})();
