/* Physical material models. Wood first: dense inharmonic modal bodies derived from beam/plate mode ratios,
   frequency-dependent damping, strike-position mode weighting, a real contact-pulse excitation, a low "thock"
   knock body, optional double contact, and per-hit randomisation so no two knocks are identical. */
window.Foley = window.Foley || {};
(function () {
  const DSP = Foley.DSP;
  const K = [4.730, 7.853, 10.996, 14.137, 17.279, 20.420, 23.562, 26.704]; // free-free beam eigenvalues
  const BEAM = K.map(k => (k * k) / (K[0] * K[0]));                             // 1, 2.76, 5.40, 8.93, 13.3, ...

  /* Wood kinds: f1 = fundamental at size 1, t1 = decay of the fundamental (s), slope = how fast highs die
     (decay ∝ (f1/f)^slope), aspect = width-mode family ratio, inh = inharmonic scatter, knock = low thock weight. */
  const WOOD = {
    plank:  { f1: 210, t1: 0.20, slope: 0.85, aspect: 1.9,  inh: 0.035, knock: 0.6, knockF: 130, grain: 0.35, nModes: 14 },
    beam:   { f1: 95,  t1: 0.32, slope: 0.9,  aspect: 2.4,  inh: 0.03,  knock: 0.9, knockF: 75,  grain: 0.3,  nModes: 14 },
    stick:  { f1: 520, t1: 0.09, slope: 0.7,  aspect: 3.1,  inh: 0.05,  knock: 0.2, knockF: 220, grain: 0.4,  nModes: 10 },
    panel:  { f1: 140, t1: 0.14, slope: 1.0,  aspect: 1.35, inh: 0.06,  knock: 0.7, knockF: 110, grain: 0.3,  nModes: 16 }, // door / thin sheet
    hollow: { f1: 160, t1: 0.26, slope: 0.75, aspect: 1.6,  inh: 0.04,  knock: 0.8, knockF: 95,  grain: 0.25, nModes: 14, cavity: 0.5 }, // crate / box
    floor:  { f1: 70,  t1: 0.16, slope: 1.1,  aspect: 1.5,  inh: 0.05,  knock: 1.0, knockF: 60,  grain: 0.4,  nModes: 12 }, // boards over joists, walked on
  };

  /* Masonry kinds: same generator, very heavy damping (brick/stone modes live 8–40 ms), denser, more inharmonic.
     'density' pushes extra modes between the beam ratios (blocks are 3-D, not slender). */
  const MASONRY = {
    brick:    { f1: 780, t1: 0.030, slope: 0.6, aspect: 1.45, inh: 0.08, knock: 0.5, knockF: 160, grain: 0.5, nModes: 14, density: 0.6, fmax: 9500 },
    stone:    { f1: 1050, t1: 0.040, slope: 0.6, aspect: 1.6,  inh: 0.10, knock: 0.35, knockF: 190, grain: 0.5, nModes: 14, density: 0.7, fmax: 10000 },
    concrete: { f1: 380, t1: 0.045, slope: 0.7, aspect: 1.5,  inh: 0.07, knock: 0.7, knockF: 110, grain: 0.45, nModes: 16, density: 0.6, fmax: 6000 },
    boulder:  { f1: 120, t1: 0.12,  slope: 0.8, aspect: 1.4,  inh: 0.06, knock: 1.0, knockF: 60,  grain: 0.35, nModes: 16, density: 0.5, fmax: 4000 },
    pavement: { f1: 65,  t1: 0.16,  slope: 0.9, aspect: 1.3,  inh: 0.05, knock: 1.0, knockF: 50,  grain: 0.3,  nModes: 14, density: 0.5, fmax: 2500 }, // slab: low, dull
    bedrock:  { f1: 90,  t1: 0.10,  slope: 0.9, aspect: 1.35, inh: 0.06, knock: 0.9, knockF: 65,  grain: 0.3,  nModes: 12, density: 0.5, fmax: 3000 },
  };

  /* Metal: long ringing, highs persist (low slope), dense modes; 'bend' = pitch drop on hard hits (sheet-metal nonlinearity). */
  const METAL = {
    plate:  { f1: 180, t1: 1.2, slope: 0.35, aspect: 1.55, inh: 0.06, knock: 0.3, knockF: 90,  grain: 0.15, nModes: 18, density: 0.5, fmax: 12000, bend: 0.04 },
    thin:   { f1: 320, t1: 0.5, slope: 0.45, aspect: 1.5,  inh: 0.07, knock: 0.3, knockF: 110, grain: 0.2,  nModes: 18, density: 0.6, fmax: 12000, bend: 0.07 },  // sheet metal
    bar:    { f1: 420, t1: 1.6, slope: 0.3,  aspect: 2.6,  inh: 0.03, knock: 0.2, knockF: 150, grain: 0.1,  nModes: 12, fmax: 12000, bend: 0.015 },
    hollow: { f1: 240, t1: 0.9, slope: 0.4,  aspect: 1.4,  inh: 0.05, knock: 0.5, knockF: 100, grain: 0.15, nModes: 16, density: 0.6, fmax: 10000, cavity: 0.4, bend: 0.03 }, // duct, can, pipe
    heavy:  { f1: 110, t1: 0.7, slope: 0.5,  aspect: 1.3,  inh: 0.04, knock: 0.9, knockF: 60,  grain: 0.15, nModes: 16, density: 0.5, fmax: 8000, bend: 0.01 },  // anvil, girder
    link:   { f1: 1900, t1: 0.12, slope: 0.4, aspect: 1.5, inh: 0.08, knock: 0.05, knockF: 300, grain: 0.2, nModes: 10, fmax: 14000, bend: 0.02 }, // chain link
    blade:  { f1: 700, t1: 1.4, slope: 0.25, aspect: 3.2,  inh: 0.02, knock: 0.1, knockF: 200, grain: 0.1,  nModes: 12, fmax: 14000, bend: 0.01 },
  };
  /* Glass / ceramic / plastic: brittle, very inharmonic (glass rings; ceramic shorter; plastic dead). */
  const GLASS = {
    pane:   { f1: 420, t1: 0.35, slope: 0.35, aspect: 1.5, inh: 0.09, knock: 0.2, knockF: 200, grain: 0.3, nModes: 16, density: 0.6, fmax: 14000 },
    bottle: { f1: 900, t1: 0.5,  slope: 0.4,  aspect: 1.7, inh: 0.06, knock: 0.15, knockF: 260, grain: 0.25, nModes: 12, fmax: 14000, cavity: 0.5 },
    shard:  { f1: 2400, t1: 0.15, slope: 0.4, aspect: 1.6, inh: 0.12, knock: 0.02, knockF: 500, grain: 0.3, nModes: 8, fmax: 16000 },
    ceramic:{ f1: 1400, t1: 0.25, slope: 0.5, aspect: 1.45, inh: 0.08, knock: 0.25, knockF: 220, grain: 0.35, nModes: 12, density: 0.5, fmax: 12000 }, // tile, mug
    plastic:{ f1: 380, t1: 0.07, slope: 0.8,  aspect: 1.5, inh: 0.07, knock: 0.5, knockF: 130, grain: 0.4, nModes: 12, density: 0.5, fmax: 7000 },   // shell, casing
  };

  /* Soft bodies: very damped low modes + a "skin" slap (velvet noise through a low-pass) + optional paper crinkle / bounce. */
  const SOFT = {
    flesh:     { f1: 85,  t1: 0.06, slope: 1.2, aspect: 1.3, inh: 0.12, knock: 1.0, knockF: 55,  grain: 0.05, nModes: 8,  density: 0.4, fmax: 1400, skin: 0.7, skinHz: 1400 },
    rubber:    { f1: 140, t1: 0.14, slope: 0.9, aspect: 1.4, inh: 0.08, knock: 0.8, knockF: 75,  grain: 0.05, nModes: 10, density: 0.4, fmax: 2500, skin: 0.35, skinHz: 900, bounce: 0.6 },
    cardboard: { f1: 120, t1: 0.05, slope: 1.1, aspect: 1.5, inh: 0.1,  knock: 0.7, knockF: 90,  grain: 0.2,  nModes: 10, density: 0.5, fmax: 3000, skin: 0.4, skinHz: 1800, cavity: 0.5, paper: 0.6 },
    leather:   { f1: 160, t1: 0.05, slope: 1.1, aspect: 1.4, inh: 0.1,  knock: 0.6, knockF: 80,  grain: 0.15, nModes: 8,  density: 0.4, fmax: 2500, skin: 0.6, skinHz: 1600 },
    body:      { f1: 60,  t1: 0.09, slope: 1.3, aspect: 1.3, inh: 0.12, knock: 1.2, knockF: 45,  grain: 0.05, nModes: 8,  density: 0.4, fmax: 900,  skin: 0.5, skinHz: 1000 }, // torso / body fall
  };

  /* Bone: hard dense organic — hardwood crossed with ceramic; the long bones are hollow tubes, so a clack has a woody
     knock, a faint cavity "tok" and a short dry decay. */
  const BONE = {
    bone:  { f1: 620, t1: 0.11, slope: 0.75, aspect: 2.3, inh: 0.06, knock: 0.35, knockF: 180, grain: 0.25, nModes: 10, density: 0.4, fmax: 6500, cavity: 0.35 },
    skull: { f1: 360, t1: 0.13, slope: 0.8,  aspect: 1.4, inh: 0.07, knock: 0.6,  knockF: 120, grain: 0.2,  nModes: 10, density: 0.5, fmax: 5000, cavity: 0.6 },
  };

  const M = Foley.Materials = {
    WOOD, MASONRY, METAL, GLASS, SOFT, BONE,
    /* Generic mode-table generator shared by all materials. */
    genModes(w, size, rng, pos) {
      size = size || 1; pos = pos === undefined ? 0.3 : pos;
      const f1 = w.f1 / size; const modes = []; const fmax = w.fmax || 9000;
      const beamRatio = i => BEAM[i] !== undefined ? BEAM[i] : BEAM[7] * (1 + (i - 7) * 0.9);
      const push = (ratio, fam, idx) => {
        const f = f1 * ratio * (1 + (rng ? rng.range(-w.inh, w.inh) : 0));
        if (!isFinite(f) || f > fmax || f < 25) return;
        const decay = Math.max(0.004, w.t1 * size * Math.pow(f1 / f, w.slope) * (rng ? rng.range(0.8, 1.2) : 1));
        const posW = Math.abs(Math.sin((idx + 1) * Math.PI * pos)) * 0.7 + 0.3;
        const tilt = Math.pow(f1 / f, 0.45);
        const gain = posW * tilt * (fam === 'width' ? 0.55 : fam === 'dense' ? 0.45 : 1) * (rng ? rng.range(0.7, 1.15) : 1);
        modes.push({ f, decay, gain });
      };
      const nBeam = Math.ceil(w.nModes * 0.6), nWidth = w.nModes - nBeam;
      for (let i = 0; i < nBeam; i++) push(beamRatio(i), 'length', i);
      for (let i = 0; i < nWidth; i++) push(w.aspect * beamRatio(i) * (i === 0 ? 1 : 0.92), 'width', i);
      if (w.density) for (let i = 0; i < nBeam - 1; i++) if ((rng ? rng.next() : 0.5) < w.density) push((beamRatio(i) + beamRatio(i + 1)) * 0.5 * (rng ? rng.range(0.9, 1.1) : 1), 'dense', i);
      if (w.cavity) modes.push({ f: f1 * 0.62, decay: w.t1 * 1.6 * size, gain: w.cavity });
      return modes.filter(m => isFinite(m.f) && isFinite(m.decay) && isFinite(m.gain));
    },
    masonryModes(kind, size, rng, pos) { return M.genModes(MASONRY[kind] || MASONRY.brick, size, rng, pos); },
    masonryTable(kind, size) { const rng = new Foley.PRNG(0x5AB1E + kind.length * 31); return M.masonryModes(kind, size || 1, rng, 0.3).map(m => [Math.round(m.f), +m.decay.toFixed(3), +m.gain.toFixed(3)]); },
    metalModes(kind, size, rng, pos) { return M.genModes(METAL[kind] || METAL.plate, size, rng, pos); },
    glassModes(kind, size, rng, pos) { return M.genModes(GLASS[kind] || GLASS.pane, size, rng, pos); },
    table(family, kind, size) { const spec = ({ wood: WOOD, masonry: MASONRY, metal: METAL, glass: GLASS, soft: SOFT, bone: BONE })[family][kind]; const rng = new Foley.PRNG(0xC0FFEE + family.length * 7 + kind.length * 31); return M.genModes(spec, size || 1, rng, 0.3).map(m => [Math.round(m.f), +m.decay.toFixed(3), +m.gain.toFixed(3)]); },

    /* Generic strike through any spec (used for metal/glass/ceramic/plastic). o: { size, force, hardness, amp, pos, double, damp, shared, bend }
       'bend': modes glide down from f*(1+bend*force) to f over ~25 ms on hard hits (sheet-metal / thin-plate nonlinearity). */
    strike(ctx, out, rng, t, spec, o) {
      o = o || {}; const size = o.size || 1, force = o.force === undefined ? 0.7 : o.force, hard = o.hardness === undefined ? 0.7 : o.hardness;
      const amp = (o.amp === undefined ? 1 : o.amp) * (0.4 + force * 0.8);
      const sum = DSP.gain(ctx, 1); const sat = DSP.shaper(ctx, 0.08 + force * 0.12, 'soft'); const lp = DSP.filter(ctx, 'lowpass', spec.fmax ? Math.min(16000, spec.fmax * 1.2) : 12000, 0.5); DSP.chain(sum, sat, lp, DSP.gain(ctx, 0.9), out);
      const widthMs = (0.15 + (1 - hard) * 1.5) * (0.6 + size * 0.5) * (1 - force * 0.35);
      const exc = M.contact(ctx, rng, t, { widthMs, amp: amp * 1.5, grain: (spec.grain || 0.2) * (0.5 + hard * 0.6), grainHz: 3000 + hard * 3000 });
      let bank;
      if (o.shared) { bank = o.shared[Math.floor(rng.next() * o.shared.length)]; DSP.chain(exc, DSP.gain(ctx, 0.9), bank.input); }
      else {
        const modes = M.genModes(spec, size, rng, o.pos === undefined ? rng.range(0.15, 0.45) : o.pos); bank = M.bank(ctx, modes, 1, o.damp || 0); exc.connect(bank.input); bank.output.connect(sum);
        const bend = (o.bend === undefined ? spec.bend || 0 : o.bend) * force; if (bend > 0.002) bank.filters.forEach(f => { const f0 = f.frequency.value; f.frequency.setValueAtTime(f0 * (1 + bend), t); f.frequency.exponentialRampToValueAtTime(f0, t + 0.02 + force * 0.03); });
      }
      if (spec.knock > 0) { const kf = (spec.knockF || 100) / Math.sqrt(size); const ko = DSP.osc(ctx, 'sine', kf * 1.8, t, 0.2); DSP.sweep(ko.frequency, t, kf * 1.8, t + 0.025, kf); const kg = DSP.gain(ctx, 0); DSP.env(kg.gain, t, { a: 0.0006, d: 0.02 + size * 0.04 + force * 0.02, peak: amp * spec.knock * (0.3 + force * 0.6), r: 0.01 }); DSP.chain(ko, kg, sum); }
      const dbl = o.double === undefined ? 0.3 : o.double;
      if (dbl > 0 && rng.next() < dbl) { const t2 = t + rng.range(0.005, 0.016); const e2 = M.contact(ctx, rng, t2, { widthMs: widthMs * 1.3, amp: amp * rng.range(0.25, 0.5), grain: (spec.grain || 0.2) * 0.5, grainHz: 3000 }); e2.connect(bank.input); }
      return sum;
    },
    metalHit(ctx, out, rng, t, o) { return M.strike(ctx, out, rng, t, METAL[(o && o.kind) || 'plate'], o); },
    /* Soft-body strike: damped modes + skin slap (+ paper crinkle for cardboard, + bounce for rubber). */
    softHit(ctx, out, rng, t, o) {
      o = o || {}; const spec = SOFT[o.kind || 'flesh']; const force = o.force === undefined ? 0.7 : o.force, size = o.size || 1, amp = (o.amp === undefined ? 1 : o.amp);
      const sum = M.strike(ctx, out, rng, t, spec, Object.assign({}, o, { hardness: o.hardness === undefined ? 0.25 : o.hardness, double: o.double === undefined ? (spec.bounce ? 0.7 : 0.15) : o.double }));
      // skin slap: the surface contact itself, a short low-passed velvet burst
      const sn = DSP.noise(ctx, rng, t, 0.04, 'velvet'); const sf = DSP.filter(ctx, 'lowpass', spec.skinHz / Math.sqrt(size) * (0.7 + force * 0.5), 0.8); const sg = DSP.gain(ctx, 0);
      DSP.env(sg.gain, t, { a: 0.0008, d: 0.008 + force * 0.012, peak: amp * spec.skin * (0.5 + force * 0.8), r: 0.005 }); DSP.chain(sn, sf, sg, out);
      if (spec.paper) { const pn = ctx.createBufferSource(); const sr = ctx.sampleRate; const n = Math.ceil(0.12 * sr); const b = ctx.createBuffer(1, n, sr); const d = b.getChannelData(0); for (let k = 0; k < Math.round(12 + force * 20); k++) { const i = Math.floor(Math.pow(rng.next(), 1.4) * n * 0.8); const f = rng.range(2000, 5000) / Math.sqrt(size); const len = Math.round(sr * rng.range(0.002, 0.006)); for (let q = 0; q < len && i + q < n; q++) d[i + q] += Math.sin(2 * Math.PI * f * q / sr) * Math.exp(-q / (len * 0.3)) * 0.5; } pn.buffer = b; pn.start(t); pn.stop(t + 0.13); DSP.chain(pn, DSP.filter(ctx, 'lowpass', 6000, 0.6), DSP.gain(ctx, amp * spec.paper * (0.4 + force * 0.6)), out); }
      return sum;
    },
    glassHit(ctx, out, rng, t, o) { return M.strike(ctx, out, rng, t, GLASS[(o && o.kind) || 'pane'], o); },
    banks(ctx, out, rng, family, kind, size, n) {
      const spec = ({ wood: WOOD, masonry: MASONRY, metal: METAL, glass: GLASS, soft: SOFT, bone: BONE })[family][kind]; const sets = [];
      for (let i = 0; i < (n || 3); i++) { const b = M.bank(ctx, M.genModes(spec, size * (0.85 + i * 0.15), rng, rng.range(0.15, 0.45)), 1, 0); b.output.connect(out); sets.push(b); }
      return sets;
    },
    /* Generate a mode table [{f, decay, gain}] for a wood kind. size: 1 = default object; pos: strike position 0..1. */
    woodModes(kind, size, rng, pos) {
      const w = WOOD[kind] || WOOD.plank; size = size || 1; pos = pos === undefined ? 0.3 : pos;
      const f1 = w.f1 / size; const modes = [];
      const push = (ratio, fam, idx) => {
        const f = f1 * ratio * (1 + (rng ? rng.range(-w.inh, w.inh) : 0));
        if (f > 9000 || f < 25) return;
        const decay = Math.max(0.004, w.t1 * size * Math.pow(f1 / f, w.slope) * (rng ? rng.range(0.8, 1.2) : 1));
        const posW = Math.abs(Math.sin((idx + 1) * Math.PI * pos)) * 0.7 + 0.3;         // strike position selects modes
        const tilt = Math.pow(f1 / f, 0.45);                                              // natural spectral tilt
        const gain = posW * tilt * (fam === 'width' ? 0.55 : 1) * (rng ? rng.range(0.7, 1.15) : 1);
        modes.push({ f, decay, gain });
      };
      const nBeam = Math.ceil(w.nModes * 0.6), nWidth = w.nModes - nBeam;
      for (let i = 0; i < nBeam; i++) push(BEAM[i] || (BEAM[7] * (1 + (i - 7) * 0.9)), 'length', i);
      for (let i = 0; i < nWidth; i++) push(w.aspect * (BEAM[i] || 1) * (i === 0 ? 1 : 0.92), 'width', i);
      if (w.cavity) modes.push({ f: f1 * 0.62, decay: w.t1 * 1.6 * size, gain: w.cavity });  // Helmholtz-ish cavity of a box
      return modes;
    },
    /* Resonator bank from a mode table. Returns { input, output }. */
    bank(ctx, modes, level, damp) {
      damp = damp || 0; const input = DSP.gain(ctx, 1), output = DSP.gain(ctx, level === undefined ? 1 : level); const filters = [];
      modes.forEach(m => { if (!isFinite(m.f) || !isFinite(m.decay)) return; const dec = Math.max(0.003, m.decay * (1 - damp * 0.9)); const Q = DSP.clamp(dec * Math.PI * m.f, 1.5, 900); const bp = DSP.filter(ctx, 'bandpass', m.f, Q); filters.push(bp); DSP.chain(input, bp, DSP.gain(ctx, m.gain * Math.min(9, 0.7 + Math.sqrt(Q) * 0.3) * Math.pow(Math.min(1, 2500 / m.f), 0.35)), output); });
      return { input, output, filters };
    },
    /* Contact pulse: raised-cosine of width ms (hardness), plus a little low-passed surface grain. */
    contact(ctx, rng, t, o) {
      const sr = ctx.sampleRate; const w = Math.max(0.15, o.widthMs) / 1000; const n = Math.max(4, Math.round(w * sr));
      const buf = ctx.createBuffer(1, n + 4, sr); const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
      const s = ctx.createBufferSource(); s.buffer = buf; s.start(t); s.stop(t + w + 0.01);
      const g = DSP.gain(ctx, o.amp || 1); s.connect(g);
      if (o.grain > 0) { const nz = DSP.noise(ctx, rng, t, 0.01); const lp = DSP.filter(ctx, 'lowpass', o.grainHz || 3500, 0.7); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, t, { a: 0.0003, d: 0.002 + w * 1.5, peak: (o.amp || 1) * o.grain * 0.5, r: 0.002 }); DSP.chain(nz, lp, ng, g); }
      return g;
    },
    /* A wood strike. o: { kind, size, force 0..1, hardness 0..1, pos, amp, double (prob), shared (bank set), damp } */
    woodHit(ctx, out, rng, t, o) {
      o = o || {}; const w = WOOD[o.kind] || WOOD.plank; const size = o.size || 1, force = o.force === undefined ? 0.7 : o.force, hard = o.hardness === undefined ? 0.5 : o.hardness;
      const amp = (o.amp === undefined ? 1 : o.amp) * (0.4 + force * 0.8);
      const sum = DSP.gain(ctx, 1); const sat = DSP.shaper(ctx, 0.12 + force * 0.15, 'soft'); DSP.chain(sum, sat, DSP.gain(ctx, 0.9), out);
      // excitation: harder strikes and harder strikers -> shorter contact
      const widthMs = (0.35 + (1 - hard) * 2.6) * (0.6 + size * 0.5) * (1 - force * 0.35);
      const exc = M.contact(ctx, rng, t, { widthMs, amp: amp * 1.6, grain: w.grain * (0.5 + hard * 0.7), grainHz: 2500 + hard * 3000 });
      const bank = o.shared ? o.shared[Math.floor(rng.next() * o.shared.length)] : M.bank(ctx, M.woodModes(o.kind, size, rng, o.pos === undefined ? rng.range(0.15, 0.45) : o.pos), 1, o.damp || 0);
      exc.connect(bank.input); if (!o.shared) bank.output.connect(sum);
      // low "thock" knock body: short, saturating, dominant at high force
      const kf = w.knockF / Math.sqrt(size); const ko = DSP.osc(ctx, 'sine', kf * 1.8, t, 0.2); DSP.sweep(ko.frequency, t, kf * 1.8, t + 0.03, kf);
      const kg = DSP.gain(ctx, 0); DSP.env(kg.gain, t, { a: 0.0008, d: 0.03 + size * 0.05 + force * 0.02, peak: amp * w.knock * (0.35 + force * 0.6), r: 0.01 }); DSP.chain(ko, kg, sum);
      const kn = DSP.noise(ctx, rng, t, 0.05, 'pink'); const kl = DSP.filter(ctx, 'lowpass', 700 / Math.sqrt(size), 1); const kng = DSP.gain(ctx, 0); DSP.env(kng.gain, t, { a: 0.0005, d: 0.015 + size * 0.01, peak: amp * w.knock * 0.5, r: 0.005 }); DSP.chain(kn, kl, kng, sum);
      // double contact (bounce)
      const dbl = o.double === undefined ? 0.35 : o.double;
      if (dbl > 0 && rng.next() < dbl) { const t2 = t + rng.range(0.005, 0.016); const e2 = M.contact(ctx, rng, t2, { widthMs: widthMs * 1.3, amp: amp * rng.range(0.25, 0.5), grain: w.grain * 0.5, grainHz: 3000 }); e2.connect(bank.input); }
      return sum;
    },
    /* Pre-build a few wood banks (different sizes / strike positions) for scenes with many hits. Outputs go to `out`. */
    woodBanks(ctx, out, rng, kind, size, n) {
      const sets = []; for (let i = 0; i < (n || 3); i++) { const b = M.bank(ctx, M.woodModes(kind, size * (0.85 + i * 0.15), rng, rng.range(0.15, 0.45)), 1, 0); b.output.connect(out); sets.push(b); }
      return sets;
    },
    /* Masonry strike (brick / stone / concrete / boulder on a ground body). o: { kind, ground, size, force, hardness, amp, shared:{ob,gb}[] , groundMix } */
    masonryHit(ctx, out, rng, t, o) {
      o = o || {}; const w = MASONRY[o.kind] || MASONRY.stone; const size = o.size || 1, force = o.force === undefined ? 0.7 : o.force, hard = o.hardness === undefined ? 0.8 : o.hardness;
      const amp = (o.amp === undefined ? 1 : o.amp) * (0.4 + force * 0.8);
      const sum = DSP.gain(ctx, 1); const sat = DSP.shaper(ctx, 0.1 + force * 0.15, 'soft'); const lp = DSP.filter(ctx, 'lowpass', 6500, 0.6); DSP.chain(sum, sat, lp, DSP.gain(ctx, 0.9), out);
      const widthMs = (0.2 + (1 - hard) * 1.2) * (0.6 + size * 0.5) * (1 - force * 0.35);
      const exc = M.contact(ctx, rng, t, { widthMs, amp: amp * 1.5, grain: w.grain * (0.5 + hard * 0.6), grainHz: 3000 + hard * 2500 });
      if (o.shared) { const set = o.shared[Math.floor(rng.next() * o.shared.length)]; DSP.chain(exc, DSP.gain(ctx, 0.9), set.ob.input); DSP.chain(exc, DSP.gain(ctx, 0.8 * (o.groundMix === undefined ? 1 : o.groundMix)), set.gb.input); }
      else {
        const ob = M.bank(ctx, M.masonryModes(o.kind, size, rng, rng.range(0.15, 0.45)), 1, o.damp || 0); exc.connect(ob.input); ob.output.connect(sum);
        if (o.ground) { const gb = M.bank(ctx, M.masonryModes(o.ground, size * 1.2, rng, rng.range(0.1, 0.4)), 0.8 * (o.groundMix === undefined ? 1 : o.groundMix), 0.2); exc.connect(gb.input); gb.output.connect(sum); }
      }
      const kf = w.knockF / Math.sqrt(size); const ko = DSP.osc(ctx, 'sine', kf * 2, t, 0.2); DSP.sweep(ko.frequency, t, kf * 2, t + 0.025, kf);
      const kg = DSP.gain(ctx, 0); DSP.env(kg.gain, t, { a: 0.0006, d: 0.025 + size * 0.05 + force * 0.02, peak: amp * w.knock * (0.3 + force * 0.6), r: 0.01 }); DSP.chain(ko, kg, sum);
      const kn = DSP.noise(ctx, rng, t, 0.05, 'pink'); const kl = DSP.filter(ctx, 'lowpass', 900 / Math.sqrt(size), 1); const kng = DSP.gain(ctx, 0); DSP.env(kng.gain, t, { a: 0.0004, d: 0.012 + size * 0.01, peak: amp * 0.5, r: 0.005 }); DSP.chain(kn, kl, kng, sum);
      return sum;
    },
    masonryBanks(ctx, out, rng, kind, ground, size, n) {
      const sets = []; for (let i = 0; i < (n || 3); i++) { const sz = size * (0.7 + i * 0.3); const ob = M.bank(ctx, M.masonryModes(kind, sz, rng, rng.range(0.15, 0.45)), 1, 0); const gb = M.bank(ctx, M.masonryModes(ground, sz * 1.2, rng, rng.range(0.1, 0.4)), 1, 0.2); ob.output.connect(out); gb.output.connect(out); sets.push({ ob, gb }); }
      return sets;
    },

    /* Friction excitation rendered in JS as ONE coupled signal: raised-cosine stick-slip pulses, friction noise
       multiplied by the slip envelope (so crunch breathes with the chatter), and resonant grit pings gated the same way.
       o: { rateFn(u)->Hz, ampFn(u)->0..1, widthMs, noise 0..1, grit density/s at full speed, gritAmp, gritHz, gritSize } */
    frictionBuffer(ctx, rng, L, o) {
      const sr = ctx.sampleRate, n = Math.ceil((L + 0.05) * sr); const d = new Float32Array(n); const env = new Float32Array(n);
      // 1) pulses + slip envelope
      let i = 0, cnt = 0; const wN = Math.max(4, Math.round((o.widthMs || 1.2) / 1000 * sr));
      while (i < n && cnt++ < 60000) {
        const u = Math.min(1, i / (L * sr)); const rate = Math.max(1, o.rateFn(u)); const a = o.ampFn(u);
        const per = sr / rate * rng.range(1 - (o.jitter || 0.35), 1 + (o.jitter || 0.35));
        if (a > 0.001) { const amp = a * rng.range(0.4, 1) * (rng.next() < 0.5 ? 1 : -1); const wl = Math.round(wN * rng.range(0.7, 1.4)); for (let k = 0; k < wl && i + k < n; k++) d[i + k] += amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / wl)); const el = Math.max(wl, Math.round(per * 0.6)); for (let k = 0; k < el && i + k < n; k++) env[i + k] = Math.max(env[i + k], Math.abs(amp) * Math.exp(-k / (el * 0.35))); }
        i += Math.max(2, Math.round(per));
      }
      // 2) friction noise gated by the slip envelope (pink-ish via one-pole smoothing)
      if (o.noise > 0) { let lp = 0, lp2 = 0; const c = o.noiseColor || 0.14; for (let k = 0; k < n; k++) { const w = rng.next() * 2 - 1; lp += (w - lp) * c; lp2 += (lp - lp2) * c; d[k] += lp2 * env[k] * o.noise * 4; } } // two-pole ≈ 1 kHz roll-off: friction noise is mid-heavy, not hiss
      // 3) resonant grit: short random-pitched pings, more likely where the envelope is high
      if (o.grit > 0) { const sz = o.gritSize || 1; const perS = o.grit / sr; for (let k = 0; k < n; k++) { if (env[k] > 0.05 && rng.next() < perS * env[k]) { const f = (o.gritHz || 3500) / sz * rng.range(0.5, 1.4); const len = Math.round(sr * rng.range(0.003, 0.009)); const a = (o.gritAmp || 0.5) * env[k] * rng.range(0.3, 1); const ph = rng.next() * 6.28; for (let q = 0; q < len && k + q < n; q++) d[k + q] += a * Math.sin(ph + 2 * Math.PI * f * q / sr) * Math.exp(-q / (len * 0.4)); } } }
      const buf = ctx.createBuffer(1, n, sr); buf.getChannelData(0).set(d); return buf;
    },
    /* Creak: stick-slip friction at a low, wandering rate (a hinge / rope / timber under load) through a wood body.
       o: { kind (wood kind, default 'beam'), size, amp, pitch (rate multiplier), stutter 0..1, tension 0..1 } */
    creak(ctx, out, rng, t, L, o) {
      o = o || {}; const size = o.size || 1.5, amp = o.amp === undefined ? 0.5 : o.amp, pitch = o.pitch || 1, stutter = o.stutter === undefined ? 0.5 : o.stutter, tension = o.tension === undefined ? 0.5 : o.tension;
      // slowly wandering slip rate (this is the creak's "pitch"), with stutters where it sticks
      const seg = Math.max(3, Math.round(L * (4 + stutter * 10))); const rates = []; for (let i = 0; i <= seg; i++) rates.push(rng.range(18, 90) * pitch * (0.7 + tension * 0.6));
      const holds = []; for (let i = 0; i <= seg; i++) holds.push(rng.next() < stutter * 0.45 ? 0.05 : rng.range(0.5, 1));
      const at = (arr, u) => { const x = u * seg; const i = Math.min(seg - 1, Math.floor(x)); return arr[i] * (1 - (x - i)) + arr[i + 1] * (x - i); };
      const buf = M.frictionBuffer(ctx, rng, L, { rateFn: u => at(rates, u), ampFn: u => at(holds, u) * Math.min(1, u * 8) * Math.min(1, (1 - u) * 6), jitter: 0.12 + stutter * 0.2, widthMs: 3.5 + (1 - tension) * 3, noise: 0.25, noiseColor: 0.08, grit: 0 });
      const src = ctx.createBufferSource(); src.buffer = buf; src.start(t); src.stop(t + L + 0.05);
      const body = M.bank(ctx, M.woodModes(o.kind || 'beam', size, rng, 0.25), 1, 0.35);
      const form = DSP.filter(ctx, 'peaking', 700 / Math.sqrt(size), 1.2, 8); // the "voice" of the creak
      const sum = DSP.gain(ctx, amp); DSP.chain(src, form, DSP.gain(ctx, 1.4), body.input); body.output.connect(sum); DSP.chain(src, form, DSP.gain(ctx, 0.25), sum);
      DSP.chain(sum, DSP.filter(ctx, 'lowpass', 3200, 0.7), DSP.shaper(ctx, 0.2, 'soft'), out);
      return sum;
    },
    /* Ping cloud: many tiny inharmonic 3-partial hits (grains of grit, debris, insect feet…), rendered in JS.
       o: { count, hz, spread, lenMin, lenMax, amp, front (>1 = front-loaded), env(u), times (explicit seconds, optional) } */
    pingBuffer(ctx, rng, L, o) {
      const sr = ctx.sampleRate, n = Math.ceil((L + 0.03) * sr); const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
      const env = o.env || (u => Math.pow(1 - u, 1.2)); const times = o.times; const count = times ? times.length : Math.min(6000, Math.round(o.count || 20));
      for (let g = 0; g < count; g++) {
        const u = times ? Math.min(1, times[g] / L) : Math.pow(rng.next(), 1 / (o.front || 1.4)); const i = Math.floor(u * L * sr);
        const f = (typeof o.hz === 'function' ? o.hz(g) : (o.hz || 2000)) * rng.range(1 - (o.spread || 0.5), 1 + (o.spread || 0.5) * 0.8);
        const len = Math.round(sr * rng.range(o.lenMin || 0.003, o.lenMax || 0.01)); const a = (typeof o.amp === 'function' ? o.amp(g) : (o.amp || 0.4)) * env(u) * rng.range(0.25, 1); const r2 = rng.range(1.4, 1.8), r3 = rng.range(2.1, 2.9); const ph = rng.next() * 6.28;
        for (let q = 0; q < len && i + q < n; q++) { const e = Math.exp(-q / (len * 0.35)); const w = 2 * Math.PI * q / sr; d[i + q] += a * e * (Math.sin(ph + w * f) + 0.5 * Math.sin(w * f * r2) * Math.exp(-q / (len * 0.2)) + 0.3 * Math.sin(w * f * r3) * Math.exp(-q / (len * 0.12))); }
      }
      return buf;
    },
    pings(ctx, out, rng, t0, L, o) { const b = M.pingBuffer(ctx, rng, L, o); const s = ctx.createBufferSource(); s.buffer = b; s.start(t0); s.stop(t0 + L + 0.03); DSP.chain(s, DSP.filter(ctx, 'lowpass', o.lp || 6000, 0.6), DSP.gain(ctx, 0.9), out); return s; },
    /* Bubble cloud (water): each bubble is a damped sinusoid at its Minnaert frequency f ≈ 3.26 / r (r in metres),
       rising slightly as it shrinks, with decay shortening with frequency. Rendered in JS into a stereo buffer.
       o: { rate (bubbles/s at env=1), rMin, rMax (metres), env(u)->0..1, amp, pan 0..1, chirp 0..1 } */
    bubbleBuffer(ctx, rng, L, o) {
      const sr = ctx.sampleRate, n = Math.ceil((L + 0.1) * sr); const Lc = new Float32Array(n), Rc = new Float32Array(n);
      const env = o.env || (u => 1); const rMin = o.rMin || 0.0008, rMax = o.rMax || 0.006; const total = Math.min(40000, Math.round((o.rate || 100) * L));
      for (let k = 0; k < total; k++) {
        const u = rng.next(); const e = env(u); if (e < 0.02 || rng.next() > e) continue;
        const r = rMin * Math.pow(rMax / rMin, Math.pow(rng.next(), 1.6)); // small bubbles are far more common
        const f = 3.26 / r; if (f > 12000) continue;
        const len = Math.round(sr * Math.min(0.12, 0.0015 + 20 / f + rng.range(0, 0.01))); const a = (o.amp || 0.4) * Math.pow(r / rMax, 0.35) * rng.range(0.4, 1) * e;
        const chirp = (o.chirp === undefined ? 0.5 : o.chirp) * rng.range(0.2, 1); const i = Math.floor(u * L * sr); const pan = rng.range(-1, 1) * (o.pan === undefined ? 0.6 : o.pan); const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
        let ph = rng.next() * 6.28; for (let q = 0; q < len && i + q < n; q++) { const t = q / sr; const fq = f * (1 + chirp * 0.5 * q / len); ph += 2 * Math.PI * fq / sr; const s = Math.sin(ph) * Math.exp(-t * (18 + f * 0.01)) * (q < 24 ? q / 24 : 1) * a; Lc[i + q] += s * gl; Rc[i + q] += s * gr; }
      }
      const buf = ctx.createBuffer(2, n, sr); buf.getChannelData(0).set(Lc); buf.getChannelData(1).set(Rc); return buf;
    },
    /* Static mode tables for the Body/Resonator FX block and other consumers (deterministic seed). */
    woodTable(kind, size) { const rng = new Foley.PRNG(0xB0D1E5 + kind.length); return M.woodModes(kind, size || 1, rng, 0.3).map(m => [Math.round(m.f), +m.decay.toFixed(3), +m.gain.toFixed(3)]); },
  };

  // Replace the hand-typed wood body with the physical one, and add more wood bodies.
  if (Foley.Engine && Foley.Engine.BODIES) {
    const B = Foley.Engine.BODIES;
    B['wood-plank'] = M.woodTable('plank'); B['wood-beam'] = M.woodTable('beam'); B['wood-panel'] = M.woodTable('panel'); B['wood-crate'] = M.woodTable('hollow'); B['wood-floor'] = M.woodTable('floor');
    B['stone-slab'] = M.masonryTable('pavement'); B['brick'] = M.masonryTable('brick'); B['stone'] = M.masonryTable('stone'); B['concrete'] = M.masonryTable('concrete'); B['boulder'] = M.masonryTable('boulder');
    B['hollow-metal'] = M.table('metal', 'hollow'); B['metal-plate'] = M.table('metal', 'plate'); B['sheet-metal'] = M.table('metal', 'thin'); B['metal-bar'] = M.table('metal', 'bar'); B['anvil'] = M.table('metal', 'heavy');
    B['glass'] = M.table('glass', 'pane'); B['glass-bottle'] = M.table('glass', 'bottle'); B['ceramic'] = M.table('glass', 'ceramic'); B['plastic-shell'] = M.table('glass', 'plastic');
  }
})();
