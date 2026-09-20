/* Rock & Earth: friction scrapes (brick on pavement), rock impacts/tumbles/rolls, digging, pours, landslides.
   Built on stick-slip excitation + modal resonator banks (object body × ground body) + grit crackle. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  /* ---- Modal bodies: [freq, decay, gain]. Objects are hand/arm-sized, grounds are slabs. ---- */
  const OBJECTS = { // masonry bodies come from the physical model (core/materials.js): dense, inharmonic, heavily damped
    brick:    Foley.Materials.masonryTable('brick'),
    stone:    Foley.Materials.masonryTable('stone'),
    boulder:  Foley.Materials.masonryTable('boulder'),
    concrete: Foley.Materials.masonryTable('concrete'),
    wood:     Foley.Materials.woodTable('plank', 0.8),   // physical wood model (core/materials.js)
    metal:    [[700, 0.8, 1], [1600, 0.6, 0.6], [2900, 0.5, 0.4], [4200, 0.3, 0.25]],
    pebble:   Foley.Materials.masonryTable('stone', 0.4),
  };
  const GROUNDS = {
    pavement: Foley.Materials.masonryTable('pavement', 1.1),
    rock:     Foley.Materials.masonryTable('bedrock', 1.1),
    dirt:     [[60, 0.12, 1], [120, 0.08, 0.5]],
    gravel:   [[90, 0.1, 1], [200, 0.07, 0.4]],
    wood:     Foley.Materials.woodTable('floor', 1.2),
  };
  /* Parallel bank of high-Q bandpasses. Returns { input, output }. size scales frequency (bigger = lower). */
  function bank(ctx, modes, size, damp, level) {
    size = size || 1; damp = damp || 0; level = level === undefined ? 1 : level;
    const input = DSP.gain(ctx, 1), output = DSP.gain(ctx, level);
    modes.forEach(([f0, dec, g]) => {
      if (!isFinite(f0) || !isFinite(dec)) return;
      const f = DSP.clamp(f0 / size, 20, 18000), decay = dec * size * (1 - damp * 0.9) + 0.004;
      const Q = DSP.clamp(decay * Math.PI * f, 2, 1200);
      // makeup for narrow bands, but tilted so short high modes don't dominate (decay-weighted rather than pure Q)
      DSP.chain(input, DSP.filter(ctx, 'bandpass', f, Q), DSP.gain(ctx, g * Math.min(6, 0.8 + Math.sqrt(Q) * 0.22) * Math.pow(Math.min(1, 1500 / f), 0.5)), output);
    });
    return { input, output };
  }
  /* Grit: sparse resonant "pings" — each grain of sand/stone is a tiny inharmonic modal hit (3 partials, fast decay),
     not a click through a bandpass. Rendered in JS; density follows densFn(u) (events per second). */
  function grit(ctx, out, rng, t0, L, densFn, freq, amp, o) {
    o = o || {}; const sr = ctx.sampleRate, n = Math.ceil((L + 0.05) * sr); const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
    const lenMin = o.lenMin || 0.003, lenMax = o.lenMax || 0.011; const spread = o.spread || 0.5; const cap = 20000; let count = 0;
    for (let i = 0; i < n && count < cap; i++) {
      const u = Math.min(1, i / (L * sr)); if (rng.next() >= densFn(u) / sr) continue; count++;
      const f = freq * rng.range(1 - spread, 1 + spread * 0.8); const len = Math.round(sr * rng.range(lenMin, lenMax)); const a = amp * rng.range(0.25, 1) * (o.envFn ? o.envFn(u) : 1);
      const r2 = rng.range(1.45, 1.75), r3 = rng.range(2.2, 2.9); const ph = rng.next() * 6.28;
      for (let q = 0; q < len && i + q < n; q++) { const e = Math.exp(-q / (len * 0.35)); const w = 2 * Math.PI * q / sr; d[i + q] += a * e * (Math.sin(ph + w * f) + 0.5 * Math.sin(w * f * r2) * Math.exp(-q / (len * 0.2)) + 0.3 * Math.sin(w * f * r3) * Math.exp(-q / (len * 0.12))); }
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.start(t0); src.stop(t0 + L + 0.05);
    DSP.chain(src, DSP.filter(ctx, 'lowpass', o.lp || 5000, 0.6), DSP.gain(ctx, 0.9), out);
  }
  /* A single rock/ground impact through both bodies. */
  function rockHit(ctx, out, rng, t, o) {
    const obj = OBJECTS[o.obj] || OBJECTS.stone, gnd = GROUNDS[o.ground] || GROUNDS.rock; const size = o.size || 1, a = o.amp === undefined ? 1 : o.amp;
    // excitation: a real contact pulse (hardness sets width) + a little surface grain, instead of a white-noise burst
    const exc = Foley.Materials.contact(ctx, rng, t, { widthMs: (0.25 + (1 - (o.hardness === undefined ? 0.8 : o.hardness)) * 1.2) * (0.6 + size * 0.5), amp: a * 1.4, grain: 0.45, grainHz: 3500 });
    if (o.shared) { // reuse pre-built banks (one biquad set per render instead of per hit)
      const set = o.shared[Math.floor(rng.next() * o.shared.length)];
      DSP.chain(exc, DSP.gain(ctx, 0.9 * a), set.ob.input); DSP.chain(exc, DSP.gain(ctx, 0.8 * a * (o.groundMix === undefined ? 1 : o.groundMix)), set.gb.input);
    } else {
      const ob = bank(ctx, obj, size * rng.range(0.92, 1.08), o.damp || 0, 0.9 * a); const gb = bank(ctx, gnd, size, 0.2, 0.8 * a * (o.groundMix === undefined ? 1 : o.groundMix));
      exc.connect(ob.input); exc.connect(gb.input); ob.output.connect(out); gb.output.connect(out);
    }
    DSP.hit(ctx, out, rng, t, { thumpAmp: a * (0.3 + size * 0.5), thumpFreq: 70 / Math.sqrt(size), thumpDecay: 0.05 + size * 0.06, thumpSweep: 2.5, noiseAmp: a * 0.2, noiseColor: 'pink', noiseType: 'lowpass', noiseFreq: 1200 / size, noiseQ: 0.7, noiseDecay: 0.012 + size * 0.01 });
    if (o.debris) { const dl = 0.15 + o.debris * 0.3; grit(ctx, out, rng, t + 0.01, dl, u => (30 + o.debris * 80) / dl * (1 - u * 0.7), 1800 / size, a * 0.5 * o.debris, { lenMin: 0.004, lenMax: 0.014 }); }
  }
  /* A few shared object+ground bank pairs at different sizes, for scenes with many hits. */
  function sharedBanks(ctx, out, objName, gndName, size, n) {
    const sets = []; for (let i = 0; i < (n || 3); i++) { const sz = size * (0.6 + i * 0.35); const ob = bank(ctx, OBJECTS[objName] || OBJECTS.stone, sz, 0.1, 1); const gb = bank(ctx, GROUNDS[gndName] || GROUNDS.rock, sz, 0.2, 1); ob.output.connect(out); gb.output.connect(out); sets.push({ ob, gb }); }
    return sets;
  }
  /* Granular pour of particles (dirt / gravel / sand / rubble). */
  function pour(ctx, out, rng, t0, L, o) {
    const mat = o.material || 'gravel'; const env = o.env || (u => 1); const size = o.size || 1; const amp = o.amp || 0.5; const dens = o.density || 1;
    const tilt = DSP.filter(ctx, 'lowpass', mat === 'sand' ? 6000 : 4500, 0.6); tilt.connect(out); // pours are never white
    if (mat === 'gravel' || mat === 'pebbles' || mat === 'rubble') {
      // stony particles: resonant mini-modal pings (grit) + for rubble, the odd real rock through the pebble body
      const cfg = { gravel: { rate: 110, hz: 1500, lenMin: 0.004, lenMax: 0.012 }, pebbles: { rate: 150, hz: 2300, lenMin: 0.003, lenMax: 0.009 }, rubble: { rate: 40, hz: 600, lenMin: 0.008, lenMax: 0.025 } }[mat];
      grit(ctx, tilt, rng, t0, L, u => cfg.rate * dens * env(u), cfg.hz / size, amp * 1.1, { lenMin: cfg.lenMin, lenMax: cfg.lenMax, spread: 0.55, lp: 5000 });
      if (mat === 'rubble') { const banks = sharedBanks(ctx, tilt, 'concrete', 'gravel', size, 2); const nb = Math.min(40, Math.round(8 * L * dens)); for (let i = 0; i < nb; i++) { const u = rng.next(); const e = env(u); if (rng.next() > e) continue; rockHit(ctx, tilt, rng, t0 + u * L, { obj: 'concrete', ground: 'gravel', size: size * rng.range(0.5, 1.1), amp: amp * 0.7 * e * rng.range(0.3, 1), groundMix: 0.5, shared: banks, hardness: 0.6 }); } }
      if (mat === 'gravel' || mat === 'pebbles') { const banks = sharedBanks(ctx, tilt, 'stone', 'gravel', size * 0.5, 2); const nb = Math.min(60, Math.round((mat === 'gravel' ? 14 : 20) * L * dens)); for (let i = 0; i < nb; i++) { const u = rng.next(); const e = env(u); if (rng.next() > e) continue; rockHit(ctx, tilt, rng, t0 + u * L, { obj: 'pebble', ground: 'gravel', size: size * 0.5 * rng.range(0.6, 1.2), amp: amp * 0.35 * e * rng.range(0.3, 1), groundMix: 0.3, shared: banks, hardness: 0.8 }); } }
    } else {
      // soil / sand: dark, dense noise grains through a few low bands, plus the soft continuous shhh
      const cfg = mat === 'sand' ? { rate: 250, freq: 2200, Q: 0.8, len: 0.006, color: 'pink' } : { rate: 160, freq: 800, Q: 0.7, len: 0.02, color: 'pink' };
      const count = Math.min(700, Math.round(cfg.rate * L * dens));
      const bands = []; for (let k = 0; k < 6; k++) { const bf = DSP.filter(ctx, 'bandpass', cfg.freq * (0.6 + 0.9 * (k / 5)) * rng.range(0.95, 1.05) / size, cfg.Q); bf.connect(tilt); bands.push(bf); }
      for (let i = 0; i < count; i++) { const u = rng.next(); const e = env(u); if (e < 0.02 || rng.next() > e) continue; const t = t0 + u * L; const a = amp * rng.range(0.3, 1) * e; const n = DSP.noise(ctx, rng, t, cfg.len + 0.02, cfg.color); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.0005, d: cfg.len * rng.range(0.6, 1.5), peak: a }); DSP.chain(n, g, bands[Math.floor(rng.next() * bands.length)]); }
      const n = DSP.noise(ctx, rng, t0, L, 'pink'); const f = DSP.filter(ctx, 'bandpass', mat === 'sand' ? 2600 : 700, 0.7); const g = DSP.gain(ctx, 0); const seg = 12; g.gain.setValueAtTime(0.0005, t0); for (let i = 1; i <= seg; i++) g.gain.linearRampToValueAtTime(amp * 0.5 * env(i / seg) * dens, t0 + (i / seg) * L); g.gain.linearRampToValueAtTime(0, t0 + L); DSP.chain(n, f, g, tilt);
      if (mat === 'sand') grit(ctx, tilt, rng, t0, L, u => 60 * dens * env(u), 3000 / size, amp * 0.35, { lenMin: 0.002, lenMax: 0.005, spread: 0.5, lp: 6000 }); // the occasional larger grain
      else grit(ctx, tilt, rng, t0, L, u => 25 * dens * env(u), 1200 / size, amp * 0.45, { lenMin: 0.004, lenMax: 0.012, lp: 4000 }); // small stones in the soil
    }
  }

  /* ================= SCRAPE / FRICTION ================= */
  R({
    id: 'scrape', name: 'Scrape / Drag (friction)', category: 'Rock & Earth', icon: '🧱',
    params: [
      P.sel('pairing', 'Materials', [{ value: 'brick/pavement', label: 'brick on pavement' }, { value: 'stone/rock', label: 'stone on rock' }, { value: 'boulder/rock', label: 'boulder on rock' }, { value: 'concrete/pavement', label: 'concrete block on pavement' }, { value: 'stone/dirt', label: 'stone on dirt' }, { value: 'wood/pavement', label: 'wood on pavement' }, { value: 'metal/pavement', label: 'metal on pavement' }, { value: 'brick/wood', label: 'brick on wood floor' }], 'brick/pavement'),
      P.r('length', 'Length', 0.2, 8, 1.5, 's'), P.r('weight', 'Weight', 0, 1, 0.5), P.r('pressure', 'Pressure', 0, 1, 0.6), P.r('speed', 'Speed', 0, 1, 0.5),
      P.r('roughness', 'Grit / roughness', 0, 1, 0.6), P.sel('motion', 'Motion', ['steady', 'push', 'shove', 'stutter', 'start-stop', 'slow-down'], 'push'), P.r('catch', 'Snag / catch', 0, 1, 0.3), P.r('pan', 'Pan travel', -1, 1, 0.3),
    ],
    duration(p) { return p.length + 0.6; },
    build(ctx, out, p, rng, t0) {
      const [objName, gndName] = p.pairing.split('/'); const obj = OBJECTS[objName], gnd = GROUNDS[gndName];
      const L = p.length, W = p.weight, Pr = p.pressure, Sp = p.speed;
      const size = 0.8 + W * 0.7;
      const pan = DSP.pan(ctx, 0); pan.pan.setValueAtTime(-p.pan, t0); pan.pan.linearRampToValueAtTime(p.pan, t0 + L); pan.connect(out);
      const bus = DSP.gain(ctx, 1); bus.connect(pan);
      // speed profile 0..1 over the drag
      const prof = { steady: u => 1, push: u => Math.min(1, u * 4) * (1 - Math.max(0, u - 0.8) * 4), shove: u => u < 0.15 ? u / 0.15 : Math.max(0, 1 - (u - 0.15) / 0.6), stutter: u => 0.35 + 0.65 * (Math.sin(u * L * rng.range(9, 15)) > 0.1 ? 1 : 0.15), 'start-stop': u => (Math.floor(u * 3) % 2 === 0) ? Math.min(1, ((u * 3) % 1) * 5) : 0, 'slow-down': u => 1 - u * 0.95 }[p.motion];
      const speedAt = u => DSP.clamp(prof(u) * (0.3 + Sp * 0.9), 0, 1.2);
      // stick-slip rate: heavier/higher pressure = lower chatter rate; speed raises it
      const baseRate = { brick: 110, stone: 150, boulder: 45, concrete: 90, wood: 130, metal: 220 }[objName] * (1.3 - Pr * 0.6) / Math.sqrt(size);
      // ONE coupled excitation (core/materials.js): raised-cosine slip pulses, friction noise gated by the slip envelope,
      // and resonant grit pings gated the same way — the crunch breathes with the chatter instead of sitting beside it.
      const buf = Foley.Materials.frictionBuffer(ctx, rng, L, {
        rateFn: u => baseRate * (0.4 + speedAt(u) * 1.2), ampFn: u => speedAt(u) * (0.5 + Pr * 0.8), jitter: 0.3 + p.roughness * 0.4,
        widthMs: (0.8 + Pr * 1.8) * (0.7 + size * 0.4), noise: 0.4 + Pr * 0.35,
        grit: (120 + p.roughness * 1100) * (0.5 + Pr * 0.5), gritAmp: 0.22 + p.roughness * 0.28, gritHz: 2300, gritSize: size,
      });
      const src = ctx.createBufferSource(); src.buffer = buf; src.start(t0); src.stop(t0 + L + 0.05);
      const excG = DSP.gain(ctx, 0.9 + W * 0.4); src.connect(excG);
      // "grind" formant follows speed (subtly); then everything goes through the two bodies — no naked path to the output
      const formant = DSP.filter(ctx, 'peaking', 650, 1.1, 9); formant.frequency.setValueAtTime(450, t0);
      const segs = Math.round(L * 12); for (let i = 1; i <= segs; i++) formant.frequency.linearRampToValueAtTime(DSP.clamp(350 + speedAt(i / segs) * 700 / size, 100, 3000), t0 + (i / segs) * L);
      const shaped = DSP.gain(ctx, 1); DSP.chain(excG, formant, shaped);
      const ob = bank(ctx, obj, size, 0.15 + Pr * 0.25, 1.0); const gb = bank(ctx, gnd, 1 + W * 0.5, 0.3, 0.8 + W * 0.6);
      shaped.connect(ob.input); shaped.connect(gb.input);
      // spectral tilt (mid-heavy, rolled-off top) + slow "grip" modulation so the texture isn't statistically flat
      const tilt = DSP.filter(ctx, 'lowpass', 3800 - Pr * 700, 0.75); const tilt2 = DSP.filter(ctx, 'lowpass', 5200, 0.6); // ~24 dB/oct above ~4 kHz
      const grip = DSP.gain(ctx, 0.8); const gn = DSP.noise(ctx, rng, t0, L, 'brown'); const gf = DSP.filter(ctx, 'lowpass', 1.5 + p.roughness * 2, 0.7); DSP.chain(gn, gf, DSP.gain(ctx, 0.35), grip.gain);
      ob.output.connect(tilt); gb.output.connect(tilt); DSP.chain(tilt, tilt2, DSP.shaper(ctx, 0.1 + Pr * 0.12, 'soft'), grip, bus);
      // low-frequency weight rumble
      const rum = DSP.noise(ctx, rng, t0, L, 'brown'); const rf = DSP.filter(ctx, 'lowpass', 120 + W * 100, 1); const rg = DSP.gain(ctx, 0); rg.gain.setValueAtTime(0.0005, t0); for (let i = 1; i <= segs; i++) rg.gain.linearRampToValueAtTime(W * 1.1 * speedAt(i / segs), t0 + (i / segs) * L); rg.gain.linearRampToValueAtTime(0, t0 + L); DSP.chain(rum, rf, rg, bus);
      // snags: the edge catches — a thud through the bodies and a burst of grit
      if (p.catch > 0) { const n = Math.round(p.catch * 5 * Math.min(L, 3)); for (let i = 0; i < n; i++) { const u = rng.range(0.1, 0.95); if (speedAt(u) < 0.2) continue; rockHit(ctx, bus, rng, t0 + u * L, { obj: objName, ground: gndName, size, amp: 0.3 + p.catch * 0.4, debris: p.roughness * 0.5, groundMix: 0.8, hardness: 0.6 }); } }
      // stop event: settle thud when the drag ends with speed, or a soft set-down otherwise
      if (p.motion === 'shove' || p.motion === 'steady' || p.motion === 'stutter') rockHit(ctx, bus, rng, t0 + L * (p.motion === 'shove' ? 0.75 : 1), { obj: objName, ground: gndName, size, amp: 0.3 + W * 0.4, debris: 0.3, groundMix: 1, hardness: 0.5 });
    },
  });

  /* ================= ROCK ================= */
  R({
    id: 'rock', name: 'Rock', category: 'Rock & Earth', icon: '🪨',
    params: [
      P.sel('type', 'Type', ['impact', 'throw-land', 'tumble', 'rockslide', 'boulder-roll', 'grind', 'crack', 'crumble', 'skip'], 'impact'),
      P.sel('object', 'Rock', Object.keys(OBJECTS).filter(k => k !== 'wood' && k !== 'metal'), 'stone'), P.sel('ground', 'Ground', Object.keys(GROUNDS), 'rock'),
      P.r('size', 'Size', 0, 1, 0.5), P.r('length', 'Length', 0.2, 8, 1.5, 's'), P.r('count', 'Count / density', 0, 1, 0.5), P.r('debris', 'Debris', 0, 1, 0.5), P.r('distance', 'Distance', 0, 1, 0), P.tog('loop', 'Seamless loop (grind/roll)', false),
    ],
    duration(p) { return p.length + 0.8 + p.size; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, sz = 0.5 + p.size * 1.6;
      const lp = DSP.filter(ctx, 'lowpass', 9000 - p.distance * 7500, 0.55); lp.connect(out);
      const o = { obj: p.object, ground: p.ground, size: sz, debris: p.debris };
      switch (p.type) {
        case 'impact': rockHit(ctx, lp, rng, t0, Object.assign({}, o, { amp: 1 })); if (p.count > 0.3) { const n = Math.round(p.count * 3); for (let i = 0; i < n; i++) rockHit(ctx, lp, rng, t0 + rng.range(0.06, 0.25) * (i + 1), Object.assign({}, o, { amp: rng.range(0.15, 0.45) * (1 - i * 0.25), size: sz * rng.range(0.7, 1) })); } break;
        case 'throw-land': { const n = DSP.noise(ctx, rng, t0, 0.35); const f = DSP.filter(ctx, 'bandpass', 1800 / sz, 3); DSP.sweep(f.frequency, t0, 1200 / sz, t0 + 0.3, 3000 / sz); const g = DSP.gain(ctx, 0); g.gain.setValueAtTime(0.0005, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.2); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.32); DSP.chain(n, f, g, lp); rockHit(ctx, lp, rng, t0 + 0.32, Object.assign({}, o, { amp: 1 })); for (let i = 0; i < 2 + Math.round(p.count * 3); i++) rockHit(ctx, lp, rng, t0 + 0.32 + 0.08 * Math.pow(i + 1, 1.5), Object.assign({}, o, { amp: 0.4 / (i + 1), size: sz * 0.8 })); break; }
        case 'tumble': case 'rockslide': {
          const big = p.type === 'rockslide'; const n = Math.min(120, Math.round((6 + p.count * 30) * (big ? 2 : 1) * Math.max(0.5, L / 1.5)));
          const shared = sharedBanks(ctx, lp, p.object, p.ground, sz, 3);
          for (let i = 0; i < n; i++) { const u = big ? Math.pow(rng.next(), 0.7) : rng.next(); const t = t0 + u * L; const a = (big ? 0.5 + 0.5 * Math.sin(u * Math.PI) : 0.8 * (1 - u * 0.5)) * rng.range(0.3, 1); rockHit(ctx, lp, rng, t, { obj: p.object, ground: p.ground, size: sz * rng.range(0.5, 1.3), amp: a, debris: 0, groundMix: 0.6, shared }); }
          pour(ctx, lp, rng, t0, L, { material: big ? 'rubble' : 'gravel', density: 0.5 + p.debris, amp: 0.4 + p.debris * 0.4, size: sz, env: big ? u => Math.sin(u * Math.PI) : u => 1 - u * 0.6 });
          if (big) { const r = DSP.noise(ctx, rng, t0, L + 0.5, 'brown'); const rf = DSP.filter(ctx, 'lowpass', 180, 1); const rg = DSP.gain(ctx, 0); DSP.env(rg.gain, t0, { a: L * 0.25, d: L * 0.5, s: 0.5, hold: 0, r: L * 0.3, peak: 1.5 * (0.5 + p.size), curve: 'lin' }); DSP.chain(r, rf, rg, lp); pour(ctx, lp, rng, t0, L, { material: 'dirt', density: 0.8, amp: 0.5, env: u => Math.sin(u * Math.PI) }); }
          break;
        }
        case 'boulder-roll': {
          // periodic rumble: a bump each revolution (rate from size), rolling grit, low body
          const rev = 1.2 / sz * (0.6 + p.count * 0.8); const per = 1 / rev; let t = 0; const gb = bank(ctx, GROUNDS[p.ground], 1.5, 0.3, 1); gb.output.connect(lp); const ob = bank(ctx, OBJECTS.boulder, sz, 0.3, 0.8); ob.output.connect(lp);
          while (t < L) { const n = DSP.noise(ctx, rng, t0 + t, 0.15, 'pink'); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0 + t, { a: 0.01, d: 0.1 + sz * 0.05, peak: 0.6 * rng.range(0.6, 1) }); n.connect(g); g.connect(gb.input); g.connect(ob.input); if (rng.next() < 0.4) DSP.hit(ctx, lp, rng, t0 + t + rng.range(0, per * 0.5), { thumpAmp: 0.4, thumpFreq: 50 / Math.sqrt(sz), thumpDecay: 0.08, noiseAmp: 0.2, noiseFreq: 900 / sz, noiseQ: 1, noiseDecay: 0.03 }); t += per * rng.range(0.85, 1.15); }
          const r = DSP.noise(ctx, rng, t0, L, 'brown'); const rf = DSP.filter(ctx, 'lowpass', 90 + sz * 40, 1.5); const lfo = DSP.osc(ctx, 'sine', rev, t0, L); const lg = DSP.gain(ctx, 40); DSP.chain(lfo, lg, rf.frequency); const rg = DSP.gain(ctx, 0); if (p.loop) { rg.gain.setValueAtTime(1.2 * sz, t0); rg.gain.setValueAtTime(1.2 * sz, t0 + L); } else DSP.env(rg.gain, t0, { a: 0.2, d: 0.1, s: 1, hold: L - 0.6, r: 0.3, peak: 1.2 * sz, curve: 'lin' }); DSP.chain(r, rf, rg, lp);
          grit(ctx, lp, rng, t0, L, u => 200 + p.debris * 800, 1700 / sz, 0.45, { lenMin: 0.004, lenMax: 0.014 });
          break;
        }
        case 'grind': {
          // millstone-style grind: same coupled friction excitation as the scrape generator, slow rotation wobble,
          // everything through the stone + ground bodies (no naked path), mid-heavy tilt and slow grip modulation
          const rot = 0.4 + p.count * 1.4; // rotations per second
          const wob = u => 0.75 + 0.25 * Math.sin(u * L * rot * 2 * Math.PI) * Math.sin(u * L * rot * 0.37 * 2 * Math.PI + 1);
          const gbuf = Foley.Materials.frictionBuffer(ctx, rng, L, {
            rateFn: u => 55 / Math.sqrt(sz) * (0.8 + p.count * 0.6) * wob(u), ampFn: u => wob(u), jitter: 0.3,
            widthMs: 1.4 * (0.7 + sz * 0.4), noise: 0.6, grit: 250 + p.debris * 900, gritAmp: 0.3 + p.debris * 0.25, gritHz: 2300, gritSize: sz,
          });
          const gs = ctx.createBufferSource(); gs.buffer = gbuf; gs.start(t0); gs.stop(t0 + L + 0.05);
          const eg = DSP.gain(ctx, 0); if (p.loop) { eg.gain.setValueAtTime(1, t0); eg.gain.setValueAtTime(1, t0 + L); } else DSP.env(eg.gain, t0, { a: 0.15, d: 0.1, s: 1, hold: L - 0.5, r: 0.25, peak: 1, curve: 'lin' });
          const gform = DSP.filter(ctx, 'peaking', 550 / Math.sqrt(sz), 1.1, 9); const glfo = DSP.osc(ctx, 'sine', rot, t0, L); DSP.chain(glfo, DSP.gain(ctx, 180 / Math.sqrt(sz)), gform.frequency);
          DSP.chain(gs, gform, eg);
          const ob = bank(ctx, OBJECTS[p.object], sz, 0.35, 1); const gb = bank(ctx, GROUNDS[p.ground], 1.5, 0.4, 0.9); eg.connect(ob.input); eg.connect(gb.input);
          const gt1 = DSP.filter(ctx, 'lowpass', 3600, 0.75), gt2 = DSP.filter(ctx, 'lowpass', 5000, 0.6);
          const grip = DSP.gain(ctx, 0.8); const gn = DSP.noise(ctx, rng, t0, L, 'brown'); DSP.chain(gn, DSP.filter(ctx, 'lowpass', 1.2, 0.7), DSP.gain(ctx, 0.3), grip.gain);
          ob.output.connect(gt1); gb.output.connect(gt1); DSP.chain(gt1, gt2, DSP.shaper(ctx, 0.15, 'soft'), grip, lp);
          // low rotational rumble
          const rr = DSP.noise(ctx, rng, t0, L, 'brown'); const rf = DSP.filter(ctx, 'lowpass', 110 + sz * 30, 1.2); const rlfo = DSP.osc(ctx, 'sine', rot, t0, L); DSP.chain(rlfo, DSP.gain(ctx, 35), rf.frequency); const rg = DSP.gain(ctx, 0); if (p.loop) { rg.gain.setValueAtTime(0.8 * sz, t0); rg.gain.setValueAtTime(0.8 * sz, t0 + L); } else DSP.env(rg.gain, t0, { a: 0.2, d: 0.1, s: 1, hold: L - 0.6, r: 0.3, peak: 0.8 * sz, curve: 'lin' }); DSP.chain(rr, rf, rg, lp);
          break;
        }
        case 'crack': { // rock splitting: deep stress creak → sharp fracture → pieces settle
          const creak = DSP.osc(ctx, 'sawtooth', 60, t0, L * 0.5); const seg = Math.max(3, Math.round(L * 6)); creak.frequency.setValueAtTime(50, t0); for (let i = 1; i <= seg; i++) creak.frequency.linearRampToValueAtTime(rng.range(40, 140) / Math.sqrt(sz), t0 + (i / seg) * L * 0.5); const cf = DSP.filter(ctx, 'lowpass', 500, 5); const cg = DSP.gain(ctx, 0); cg.gain.setValueAtTime(0.0005, t0); for (let i = 1; i <= seg; i++) cg.gain.linearRampToValueAtTime(rng.next() < 0.3 ? 0.01 : rng.range(0.1, 0.35), t0 + (i / seg) * L * 0.5); cg.gain.linearRampToValueAtTime(0, t0 + L * 0.5 + 0.05); DSP.chain(creak, cf, DSP.shaper(ctx, 0.4, 'soft'), cg, lp);
          grit(ctx, lp, rng, t0, L * 0.5, u => 30 + u * u * 700, 1900 / sz, 0.5, { lenMin: 0.003, lenMax: 0.01 });
          const tc = t0 + L * 0.5; DSP.hit(ctx, lp, rng, tc, { thumpAmp: 1 + p.size, thumpFreq: 45 / Math.sqrt(sz), thumpDecay: 0.25 + p.size * 0.3, thumpSweep: 3, noiseAmp: 1.1, noiseType: 'highpass', noiseFreq: 1500, noiseQ: 0.5, noiseDecay: 0.04 + p.size * 0.03, drive: 0.2 });
          const ob = bank(ctx, OBJECTS[p.object], sz * 1.5, 0.1, 1.2); const nz = DSP.noise(ctx, rng, tc, 0.08); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, tc, { a: 0.0005, d: 0.03, peak: 1 }); nz.connect(ng); ng.connect(ob.input); ob.output.connect(lp);
          { const dl = L * 0.4 + 0.2; grit(ctx, lp, rng, tc + 0.01, dl, u => (40 + p.debris * 100) / dl * Math.pow(1 - u, 1.5), 1400 / sz, 0.6, { lenMin: 0.005, lenMax: 0.016 }); }
          for (let i = 0; i < 2 + Math.round(p.count * 4); i++) rockHit(ctx, lp, rng, tc + rng.range(0.1, L * 0.45 + 0.2), { obj: p.object, ground: p.ground, size: sz * rng.range(0.4, 0.9), amp: rng.range(0.2, 0.6), debris: 0.3 });
          break;
        }
        case 'crumble': pour(ctx, lp, rng, t0, L, { material: 'rubble', density: 0.5 + p.count, amp: 0.6, size: sz, env: u => Math.pow(1 - u, 0.7) }); pour(ctx, lp, rng, t0, L, { material: 'gravel', density: 0.5 + p.debris, amp: 0.4, size: sz, env: u => 1 - u * 0.7 }); pour(ctx, lp, rng, t0 + 0.05, L, { material: 'dirt', density: 0.6, amp: 0.35, env: u => 1 - u }); { const sh = sharedBanks(ctx, lp, p.object, p.ground, sz, 2); for (let i = 0; i < 2 + Math.round(p.count * 5); i++) rockHit(ctx, lp, rng, t0 + Math.pow(rng.next(), 1.5) * L, { obj: p.object, ground: p.ground, size: sz * rng.range(0.4, 1), amp: rng.range(0.2, 0.5), debris: 0.2, groundMix: 0.5, shared: sh }); } break;
        case 'skip': { let t = 0, gap = 0.28 / Math.sqrt(sz); for (let i = 0; i < 4 + Math.round(p.count * 6) && t < L; i++) { rockHit(ctx, lp, rng, t0 + t, { obj: 'pebble', ground: p.ground, size: sz * 0.6, amp: 0.7 * (1 - i * 0.08), debris: 0.1, groundMix: 0.7 }); t += gap; gap *= 0.78; } break; }
      }
    },
  });

  /* ================= EARTH ================= */
  R({
    id: 'earth', name: 'Earth / Dirt', category: 'Rock & Earth', icon: '🌍',
    params: [
      P.sel('type', 'Type', ['dig', 'shovel-dump', 'dirt-pour', 'gravel-pour', 'sand-pour', 'rubble-settle', 'landslide', 'ground-crack', 'quake', 'stomp', 'burrow', 'mud-slop'], 'dig'),
      P.r('length', 'Length', 0.2, 10, 1.2, 's'), P.r('size', 'Size / mass', 0, 1, 0.5), P.r('wet', 'Wetness', 0, 1, 0.2), P.r('grit', 'Grit / stones', 0, 1, 0.5), P.r('depth', 'Low end', 0, 1, 0.5), P.tog('loop', 'Seamless loop (quake/pours)', false),
    ],
    duration(p) { return p.length + 1 + p.size; },
    build(ctx, outRaw, p, rng, t0) {
      const L = p.length, sz = 0.6 + p.size * 1.4;
      const out = DSP.filter(ctx, 'lowpass', 7500, 0.6); out.connect(outRaw); // earth is never bright
      const thud = (t, a) => DSP.hit(ctx, out, rng, t, { thumpAmp: a * (0.6 + p.depth * 0.8), thumpFreq: 55 / Math.sqrt(sz), thumpDecay: 0.08 + p.size * 0.15, thumpSweep: 2.2, noiseAmp: a * 0.5, noiseColor: 'pink', noiseType: 'lowpass', noiseFreq: 700, noiseQ: 0.7, noiseDecay: 0.06 + p.size * 0.05 });
      const wetLayer = (t, len, a) => { if (p.wet <= 0) return; const n = DSP.noise(ctx, rng, t, len); const f = DSP.filter(ctx, 'bandpass', 700, 4 + p.wet * 8); f.frequency.setValueAtTime(1300, t); const seg = Math.max(2, Math.round(len * 8)); for (let i = 1; i <= seg; i++) f.frequency.exponentialRampToValueAtTime(rng.range(250, 1400), t + (i / seg) * len); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.01, d: len, peak: a * p.wet * 0.7 }); DSP.chain(n, f, g, out); for (let i = 0; i < Math.round(p.wet * 6 * len); i++) { const tt = t + rng.next() * len; const fr = rng.range(300, 900); const o = DSP.osc(ctx, 'sine', fr, tt, 0.05); DSP.sweep(o.frequency, tt, fr, tt + 0.04, fr * 1.6); const og = DSP.gain(ctx, 0); DSP.env(og.gain, tt, { a: 0.002, d: 0.035, peak: 0.1 * p.wet }); DSP.chain(o, og, out); } };
      const rumble = (t, len, a, seamless) => { const n = DSP.noise(ctx, rng, t, len + 0.3, 'brown'); const f = DSP.filter(ctx, 'lowpass', 60 + p.depth * 120, 1.2); const g = DSP.gain(ctx, 0); if (seamless) { g.gain.setValueAtTime(a, t); const seg = Math.round(len * 3); for (let i = 1; i < seg; i++) g.gain.linearRampToValueAtTime(a * rng.range(0.6, 1.3), t + (i / seg) * len); g.gain.linearRampToValueAtTime(a, t + len); } else DSP.env(g.gain, t, { a: len * 0.2, d: len * 0.4, s: 0.6, hold: 0, r: len * 0.4, peak: a, curve: 'lin' }); DSP.chain(n, f, g, out); };
      const dirtMat = p.wet > 0.5 ? 'dirt' : (p.grit > 0.6 ? 'gravel' : 'dirt');
      switch (p.type) {
        case 'dig': { // blade thrust into soil: dark entry "shuk" (soil shearing), grit, soil shifting, lift
          const n = DSP.noise(ctx, rng, t0, 0.3, 'pink'); const f = DSP.filter(ctx, 'bandpass', 900, 0.9); DSP.sweep(f.frequency, t0, 1500, t0 + 0.22, 350); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.008, d: 0.22, peak: 0.9 }); DSP.chain(n, f, DSP.filter(ctx, 'lowpass', 3000, 0.7), g, out);
          { const bx = Foley.Materials.contact(ctx, rng, t0, { widthMs: 1.8, amp: 0.8, grain: 0.4, grainHz: 2200 }); const bb = Foley.Materials.bank(ctx, Foley.Materials.masonryModes('concrete', 1.6, rng, 0.3), 0.5, 0.5); bx.connect(bb.input); bb.output.connect(out); } // blade edge biting
          thud(t0, 0.7); grit(ctx, out, rng, t0, Math.min(L, 0.5), u => (150 + p.grit * 900) * (1 - u), 1700, 0.5 + p.grit * 0.3, { lenMin: 0.004, lenMax: 0.012 });
          pour(ctx, out, rng, t0 + 0.05, Math.min(L, 0.8), { material: dirtMat, density: 0.6 + p.grit * 0.4, amp: 0.5, size: sz, env: u => 1 - u * 0.7 });
          if (p.grit > 0.4) for (let i = 0; i < Math.round(p.grit * 4); i++) rockHit(ctx, out, rng, t0 + rng.range(0.02, 0.3), { obj: 'pebble', ground: 'dirt', size: sz * 0.8, amp: 0.3, groundMix: 0.3 });
          wetLayer(t0, Math.min(L, 0.6), 0.8);
          break;
        }
        case 'shovel-dump': pour(ctx, out, rng, t0, L, { material: dirtMat, density: 1.2, amp: 0.7, size: sz, env: u => Math.min(1, u * 5) * Math.pow(1 - u, 0.6) }); thud(t0 + 0.08, 0.5); if (p.grit > 0.2) pour(ctx, out, rng, t0 + 0.05, L, { material: 'pebbles', density: p.grit, amp: 0.4, env: u => Math.pow(1 - u, 0.8) }); wetLayer(t0 + 0.05, L * 0.6, 0.6); break;
        case 'dirt-pour': case 'gravel-pour': case 'sand-pour': { const mat = p.type.split('-')[0]; const env = p.loop ? (u => 1) : (u => Math.min(1, u * 6) * Math.min(1, (1 - u) * 6)); pour(ctx, out, rng, t0, L, { material: mat, density: 0.8 + p.size * 0.6, amp: 0.6, size: sz, env }); if (mat !== 'sand') pour(ctx, out, rng, t0, L, { material: mat === 'gravel' ? 'pebbles' : 'gravel', density: p.grit * 0.8, amp: 0.35, size: sz, env }); if (mat === 'gravel' || p.grit > 0.5) { const n = DSP.noise(ctx, rng, t0, L, 'pink'); const f = DSP.filter(ctx, 'bandpass', 500, 1); const g = DSP.gain(ctx, 0); if (p.loop) { g.gain.setValueAtTime(0.15, t0); g.gain.setValueAtTime(0.15, t0 + L); } else DSP.env(g.gain, t0, { a: L * 0.15, d: L * 0.2, s: 1, hold: L * 0.5, r: L * 0.15, peak: 0.15, curve: 'lin' }); DSP.chain(n, f, g, out); } break; }
        case 'rubble-settle': pour(ctx, out, rng, t0, L, { material: 'rubble', density: 0.8, amp: 0.7, size: sz, env: u => Math.pow(1 - u, 1.2) }); pour(ctx, out, rng, t0, L, { material: 'gravel', density: 0.7 + p.grit * 0.5, amp: 0.4, size: sz, env: u => 1 - u * 0.8 }); pour(ctx, out, rng, t0 + 0.1, L, { material: 'dirt', density: 0.5, amp: 0.4, env: u => Math.pow(1 - u, 0.5) }); { const sh = sharedBanks(ctx, out, 'concrete', 'gravel', sz, 2); for (let i = 0; i < 2 + Math.round(p.size * 4); i++) rockHit(ctx, out, rng, t0 + Math.pow(rng.next(), 2) * L * 0.6, { obj: 'concrete', ground: 'gravel', size: sz, amp: rng.range(0.3, 0.7), debris: 0.3, shared: sh }); } rumble(t0, L * 0.6, 0.6 * p.depth); break;
        case 'landslide': { rumble(t0, L, 1.6 * (0.5 + p.size)); pour(ctx, out, rng, t0, L, { material: 'rubble', density: 1.2, amp: 0.7, size: sz, env: u => Math.sin(u * Math.PI) }); pour(ctx, out, rng, t0, L, { material: 'gravel', density: 1.2, amp: 0.5, size: sz, env: u => Math.sin(u * Math.PI) }); pour(ctx, out, rng, t0, L, { material: 'dirt', density: 1, amp: 0.6, env: u => Math.sin(u * Math.PI) }); const n = Math.min(60, Math.round((8 + p.grit * 20) * Math.max(1, L / 2))); const shS = sharedBanks(ctx, out, 'stone', 'dirt', sz, 2), shB = sharedBanks(ctx, out, 'boulder', 'dirt', sz, 2); for (let i = 0; i < n; i++) { const u = rng.next(); const bld = rng.next() < 0.3; rockHit(ctx, out, rng, t0 + u * L, { obj: bld ? 'boulder' : 'stone', ground: 'dirt', size: sz * rng.range(0.5, 1.5), amp: (0.3 + 0.6 * Math.sin(u * Math.PI)) * rng.range(0.4, 1), debris: 0.3, groundMix: 0.7, shared: bld ? shB : shS }); } wetLayer(t0 + L * 0.3, L * 0.5, 0.5); break; }
        case 'ground-crack': { grit(ctx, out, rng, t0, L * 0.6, u => 40 + u * u * 900, 1600, 0.5, { lenMin: 0.004, lenMax: 0.012 }); const creak = DSP.osc(ctx, 'sawtooth', 45, t0, L * 0.6); const seg = Math.max(3, Math.round(L * 5)); creak.frequency.setValueAtTime(40, t0); for (let i = 1; i <= seg; i++) creak.frequency.linearRampToValueAtTime(rng.range(30, 110), t0 + (i / seg) * L * 0.6); const cg = DSP.gain(ctx, 0); cg.gain.setValueAtTime(0.0005, t0); for (let i = 1; i <= seg; i++) cg.gain.linearRampToValueAtTime(rng.next() < 0.3 ? 0.01 : rng.range(0.1, 0.4), t0 + (i / seg) * L * 0.6); cg.gain.linearRampToValueAtTime(0, t0 + L * 0.6 + 0.05); DSP.chain(creak, DSP.filter(ctx, 'lowpass', 400, 4), DSP.shaper(ctx, 0.4, 'soft'), cg, out); const tc = t0 + L * 0.6; DSP.hit(ctx, out, rng, tc, { thumpAmp: 1.3 + p.size, thumpFreq: 38, thumpDecay: 0.3 + p.size * 0.4, thumpSweep: 3, noiseAmp: 0.9, noiseType: 'highpass', noiseFreq: 1200, noiseQ: 0.5, noiseDecay: 0.05, drive: 0.2 }); rumble(tc, L * 0.4 + 0.5, 1.2 * (0.5 + p.depth)); pour(ctx, out, rng, tc, L * 0.4 + 0.3, { material: 'rubble', density: 0.8, amp: 0.6, size: sz, env: u => 1 - u }); pour(ctx, out, rng, tc, L * 0.4 + 0.3, { material: 'dirt', density: 0.8, amp: 0.5, env: u => 1 - u }); break; }
        case 'quake': { rumble(t0, L, 1.8 * (0.5 + p.size), p.loop); const n = DSP.noise(ctx, rng, t0, L, 'brown'); const f = DSP.filter(ctx, 'bandpass', 30 + p.depth * 30, 2); const lfo = DSP.osc(ctx, 'sine', rng.range(0.3, 0.9), t0, L); DSP.chain(lfo, DSP.gain(ctx, 15), f.frequency); const g = DSP.gain(ctx, 0); if (p.loop) { g.gain.setValueAtTime(2, t0); g.gain.setValueAtTime(2, t0 + L); } else DSP.env(g.gain, t0, { a: L * 0.2, d: L * 0.3, s: 0.8, hold: L * 0.2, r: L * 0.3, peak: 2, curve: 'lin' }); DSP.chain(n, f, g, out); const cnt = Math.round(L * (2 + p.grit * 6)); for (let i = 0; i < cnt; i++) { const t = t0 + rng.next() * L; if (rng.next() < 0.5) thud(t, rng.range(0.2, 0.6)); else pour(ctx, out, rng, t, rng.range(0.2, 0.6), { material: 'dirt', density: 0.5, amp: 0.3, env: u => 1 - u }); } if (p.grit > 0.3) grit(ctx, out, rng, t0, L, u => 20 + p.grit * 150, 1300, 0.35, { lenMin: 0.005, lenMax: 0.016 }); break; }
        case 'stomp': thud(t0, 1.1); pour(ctx, out, rng, t0 + 0.01, Math.min(L, 0.4), { material: dirtMat, density: 0.6 + p.grit * 0.6, amp: 0.5, size: sz, env: u => Math.pow(1 - u, 1.5) }); if (p.grit > 0.3) grit(ctx, out, rng, t0, 0.15, u => p.grit * 120 * (1 - u), 1600, 0.45, { lenMin: 0.004, lenMax: 0.012 }); wetLayer(t0, 0.3, 0.7); { const n = DSP.noise(ctx, rng, t0, 0.3, 'brown'); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.005, d: 0.2 + p.size * 0.2, peak: 1.2 * p.depth }); DSP.chain(n, DSP.filter(ctx, 'lowpass', 120, 1), g, out); } break;
        case 'burrow': { const seg = Math.round(L * 4); for (let i = 0; i < seg; i++) { const t = t0 + (i / seg) * L * rng.range(0.9, 1.05); const len = L / seg * rng.range(0.6, 1.2); const n = DSP.noise(ctx, rng, t, len, 'pink'); const f = DSP.filter(ctx, 'bandpass', 900, 1.2); DSP.sweep(f.frequency, t, 1500, t + len, 400); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: len * 0.3, d: len * 0.7, peak: 0.5, curve: 'lin' }); DSP.chain(n, f, g, out); pour(ctx, out, rng, t, len, { material: dirtMat, density: 0.7, amp: 0.45, size: sz, env: u => Math.sin(u * Math.PI) }); if (rng.next() < 0.5) thud(t + len * 0.5, 0.3); } grit(ctx, out, rng, t0, L, u => 100 + p.grit * 500, 1600, 0.4, { lenMin: 0.004, lenMax: 0.012 }); wetLayer(t0, L, 0.4); rumble(t0, L, 0.5 * p.depth); break; }
        case 'mud-slop': { const n = DSP.noise(ctx, rng, t0, L); const f = DSP.filter(ctx, 'bandpass', 600, 6); f.frequency.setValueAtTime(1400, t0); const seg = Math.max(3, Math.round(L * 10)); for (let i = 1; i <= seg; i++) f.frequency.exponentialRampToValueAtTime(rng.range(200, 1500), t0 + (i / seg) * L); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.01, d: L, peak: 0.6 + p.wet * 0.4, r: 0.05 }); DSP.chain(n, f, g, out); thud(t0, 0.7); for (let i = 0; i < Math.round(4 + p.wet * 14 * L); i++) { const t = t0 + rng.next() * L; const fr = rng.range(250, 1000); const o = DSP.osc(ctx, 'sine', fr, t, 0.06); DSP.sweep(o.frequency, t, fr, t + 0.05, fr * 1.7); const og = DSP.gain(ctx, 0); DSP.env(og.gain, t, { a: 0.002, d: 0.04, peak: 0.15 }); DSP.chain(o, og, out); } pour(ctx, out, rng, t0 + 0.05, L, { material: 'dirt', density: 0.5, amp: 0.3, env: u => 1 - u }); break; }
      }
    },
  });
})();
