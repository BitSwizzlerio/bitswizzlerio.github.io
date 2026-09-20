/* Bodily sounds: farts, burps, sneezes, yawns, laughs, cackles, goblin chuckles.
   Voiced sounds use a small vocal-tract model: glottal pulse (sawtooth + jitter/shimmer) -> formant filters (F1..F3)
   with breath noise through the same tract. Gassy sounds use flapping pulse trains + wet squelch resonances. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  const VOWELS = { a: [700, 1200, 2600], e: [550, 1900, 2600], i: [300, 2300, 3000], o: [450, 900, 2400], u: [350, 700, 2400], ae: [650, 1700, 2500], uh: [600, 1100, 2500], n: [300, 1400, 2500] };
  const BW = [90, 120, 160]; // formant bandwidths (Hz)

  /* Vocal tract: returns { input, out } — feed glottal source + breath noise to input. formant morph via setVowel(t, vowel, ramp). */
  function tract(ctx, out, size, nasal) {
    const input = DSP.gain(ctx, 1); const sum = DSP.gain(ctx, 1); sum.connect(out);
    const fs = [];
    for (let i = 0; i < 3; i++) { const f = DSP.filter(ctx, 'bandpass', VOWELS.a[i] / size, VOWELS.a[i] / BW[i]); const g = DSP.gain(ctx, [1, 0.55, 0.3][i]); DSP.chain(input, f, g, sum); fs.push(f); }
    if (nasal) { const nf = DSP.filter(ctx, 'bandpass', 1000 / size, 4); DSP.chain(input, nf, DSP.gain(ctx, nasal * 0.6), sum); }
    const hp = DSP.filter(ctx, 'highpass', 3500 / size, 0.7); DSP.chain(input, hp, DSP.gain(ctx, 0.08), sum); // brightness leak
    return { input, setVowel(t, v, ramp) { const fr = VOWELS[v] || VOWELS.a; fs.forEach((f, i) => { const target = fr[i] / size; if (ramp > 0) { f.frequency.setValueAtTime(f.frequency.value, t); f.frequency.exponentialRampToValueAtTime(target, t + ramp); } else f.frequency.setValueAtTime(target, t); }); }, formants: fs };
  }
  /* Glottal source with pitch contour [[u, hz], ...], roughness (jitter + AM), returns gain node to envelope. */
  function glottis(ctx, rng, t0, dur, contour, rough, wave) {
    const o = DSP.osc(ctx, wave || 'sawtooth', contour[0][1], t0, dur);
    o.frequency.setValueAtTime(contour[0][1], t0);
    for (let i = 1; i < contour.length; i++) o.frequency.exponentialRampToValueAtTime(Math.max(20, contour[i][1]), t0 + contour[i][0] * dur);
    // jitter: slow random pitch wander + fast roughness
    const jn = DSP.noise(ctx, rng, t0, dur, 'brown'); const jg = DSP.gain(ctx, 40 + rough * 400); DSP.chain(jn, jg, o.detune);
    if (rough > 0.3) { const rn = DSP.noise(ctx, rng, t0, dur, 'white'); const rf = DSP.filter(ctx, 'lowpass', 60 + rough * 120, 1); const rg = DSP.gain(ctx, rough * 1200); DSP.chain(rn, rf, rg, o.detune); }
    const lp = DSP.filter(ctx, 'lowpass', 2500, 0.5); // glottal spectral tilt
    const g = DSP.gain(ctx, 0); DSP.chain(o, lp, g);
    if (rough > 0.5) { const am = DSP.osc(ctx, 'square', 25 + rng.next() * 30, t0, dur); const amg = DSP.gain(ctx, (rough - 0.5) * 0.8); const base = DSP.gain(ctx, 1); DSP.chain(am, amg, base.gain); g.connect(base); return { node: base, env: g }; }
    return { node: g, env: g };
  }
  /* One voiced syllable through a tract. o: { f0:[[u,hz]], vowel, vowel2, amp, attack, decay, rough, breath, size, nasal, wave } */
  function syllable(ctx, out, rng, t0, dur, o) {
    const tr = tract(ctx, out, o.size || 1, o.nasal || 0);
    tr.setVowel(t0, o.vowel || 'a', 0); if (o.vowel2) tr.setVowel(t0 + dur * (o.morphAt || 0.4), o.vowel2, dur * 0.4);
    const gl = glottis(ctx, rng, t0, dur + 0.05, o.f0, o.rough || 0, o.wave);
    DSP.env(gl.env.gain, t0, { a: o.attack || 0.02, d: dur * (o.decayFrac || 0.7), s: o.sustain === undefined ? 0.5 : o.sustain, hold: 0, r: o.release || dur * 0.3, peak: (o.amp || 0.8) * 0.9, curve: 'lin' });
    gl.node.connect(tr.input);
    if (o.breath > 0) { const n = DSP.noise(ctx, rng, t0, dur + 0.05, 'pink'); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, t0, { a: o.attack || 0.02, d: dur * 0.7, s: 0.4, r: dur * 0.3, peak: o.breath * 0.8, curve: 'lin' }); DSP.chain(n, ng, tr.input); }
    return tr;
  }
  /* Unvoiced aspiration burst through a tract (for h-, ch-, sniff). */
  function breathBurst(ctx, out, rng, t0, dur, o) {
    const tr = tract(ctx, out, o.size || 1, 0); tr.setVowel(t0, o.vowel || 'a', 0); if (o.vowel2) tr.setVowel(t0 + dur * 0.3, o.vowel2, dur * 0.5);
    const n = DSP.noise(ctx, rng, t0, dur + 0.05, o.color || 'white'); const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, t0, { a: o.attack || 0.01, d: dur, peak: (o.amp || 0.6) * 1.5, r: 0.03, curve: o.curve || 'exp' }); DSP.chain(n, ng, tr.input);
    if (o.hiss) { const h = DSP.noise(ctx, rng, t0, dur); const hf = DSP.filter(ctx, 'bandpass', o.hissFreq || 5000, 1); const hg = DSP.gain(ctx, 0); DSP.env(hg.gain, t0, { a: o.attack || 0.01, d: dur * 0.6, peak: o.hiss, r: 0.03 }); DSP.chain(h, hf, hg, out); }
  }
  /* Wet gurgle/squelch layer (for wet farts, burps, sniffles). */
  function wet(ctx, out, rng, t0, dur, amt, size) {
    if (amt <= 0) return;
    const n = DSP.noise(ctx, rng, t0, dur); const f = DSP.filter(ctx, 'bandpass', 700 / size, 7 + amt * 8); f.frequency.setValueAtTime(1200 / size, t0);
    const seg = Math.max(3, Math.round(dur * 14)); for (let i = 1; i <= seg; i++) f.frequency.exponentialRampToValueAtTime(rng.range(250, 1500) / size, t0 + (i / seg) * dur);
    const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.01, d: dur, peak: amt * 0.6, r: 0.03 }); DSP.chain(n, f, g, out);
    const c = Math.round(amt * 14 * dur); for (let i = 0; i < c; i++) { const t = t0 + rng.next() * dur; const fr = rng.range(250, 900) / size; const o = DSP.osc(ctx, 'sine', fr, t, 0.05); DSP.sweep(o.frequency, t, fr, t + 0.04, fr * 1.6); const og = DSP.gain(ctx, 0); DSP.env(og.gain, t, { a: 0.002, d: 0.035, peak: 0.12 * amt }); DSP.chain(o, og, out); }
  }

  /* Expose the vocal-tract model for other generators (creature vocals, etc.). */
  Foley.Voice = { VOWELS, tract, glottis, syllable, breathBurst, wet };

  /* ================= FART ================= */
  R({
    id: 'fart', name: 'Fart', category: 'Bodily', icon: '💨',
    params: [
      P.sel('type', 'Type', ['classic', 'short', 'long', 'squeaky', 'wet', 'machine-gun', 'bass', 'whistle', 'squeaker-toy', 'trumpet'], 'classic'),
      P.r('length', 'Length', 0.1, 4, 0.7, 's'), P.r('pitch', 'Pitch', 0.4, 2.5, 1), P.r('pressure', 'Pressure', 0, 1, 0.6), P.r('wetness', 'Wetness', 0, 1, 0.25), P.r('flutter', 'Flutter', 0, 1, 0.5), P.r('bend', 'Pitch bend', -1, 1, -0.3),
    ],
    duration(p) { return p.length + 0.4; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, k = p.pitch, pr = p.pressure;
      const body = DSP.filter(ctx, 'lowpass', 900 * k + pr * 600, 1.2); const drv = DSP.shaper(ctx, 0.25 + pr * 0.3, 'soft'); DSP.chain(body, drv, out);
      // cheek/pants resonance
      const res = DSP.filter(ctx, 'bandpass', 220 * k, 3); DSP.chain(res, DSP.gain(ctx, 0.8), out);
      const ampEnv = (g, peak) => { const segs = Math.max(3, Math.round(L * (6 + p.flutter * 20))); g.gain.setValueAtTime(0.0005, t0); g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.03, L * 0.2)); for (let i = 2; i < segs; i++) g.gain.linearRampToValueAtTime(peak * rng.range(1 - p.flutter * 0.8, 1) * (p.type === 'long' ? 1 - (i / segs) * 0.5 : 1), t0 + (i / segs) * L); g.gain.linearRampToValueAtTime(0, t0 + L); };
      const flap = (rate0, rate1, amp) => { // flapping pulse train, rate glides with bend/pressure
        const sr = ctx.sampleRate, n = Math.ceil((L + 0.05) * sr); const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
        let i = 0, cnt = 0; while (i < n && cnt++ < 20000) { const u = i / (L * sr); const rate = DSP.lerp(rate0, rate1, Math.min(1, u)) * rng.range(1 - p.flutter * 0.3, 1 + p.flutter * 0.3); const per = Math.max(3, Math.round(sr / rate)); const len = Math.max(2, Math.round(per * 0.5)); const a = rng.range(0.6, 1); for (let q = 0; q < len && i + q < n; q++) d[i + q] = a * Math.sin(Math.PI * q / len) * (q < len * 0.3 ? 1 : 0.5); i += per; }
        const src = ctx.createBufferSource(); src.buffer = buf; src.start(t0); src.stop(t0 + L + 0.05); const g = DSP.gain(ctx, 0); ampEnv(g, amp); DSP.chain(src, g, body); DSP.chain(src, g, res);
      };
      const r0 = 38 * k * (0.7 + pr * 0.6), r1 = r0 * Math.pow(2, p.bend * 0.8);
      switch (p.type) {
        case 'classic': flap(r0, r1, 1); break;
        case 'short': flap(r0 * 1.3, r0 * 0.9, 1.1); break;
        case 'long': flap(r0, r1 * 0.7, 0.9); break;
        case 'bass': flap(r0 * 0.55, r1 * 0.5, 1.3); body.frequency.value = 400 * k; break;
        case 'machine-gun': { const bursts = Math.max(2, Math.round(L * 9)); for (let i = 0; i < bursts; i++) { const t = t0 + (i / bursts) * L; const bl = (L / bursts) * rng.range(0.4, 0.7); const sr = ctx.sampleRate, n = Math.ceil((bl + 0.02) * sr); const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0); let q = 0; while (q < n) { const per = Math.max(3, Math.round(sr / (r0 * rng.range(0.8, 1.3)))); for (let j = 0; j < per * 0.5 && q + j < n; j++) d[q + j] = Math.sin(Math.PI * j / (per * 0.5)); q += per; } const src = ctx.createBufferSource(); src.buffer = buf; src.start(t); src.stop(t + bl + 0.02); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: 0.005, d: bl, peak: rng.range(0.7, 1.1), r: 0.01, curve: 'lin' }); DSP.chain(src, g, body); DSP.chain(src, g, res); } break; }
        case 'squeaky': case 'squeaker-toy': { const f = (p.type === 'squeaky' ? 900 : 1500) * k; const o = DSP.osc(ctx, 'sawtooth', f, t0, L); o.frequency.setValueAtTime(f, t0); const seg = Math.max(2, Math.round(L * 8)); for (let i = 1; i <= seg; i++) o.frequency.exponentialRampToValueAtTime(f * Math.pow(2, p.bend * (i / seg)) * rng.range(0.85, 1.2), t0 + (i / seg) * L); const v = DSP.osc(ctx, 'sine', 12 + p.flutter * 25, t0, L); DSP.chain(v, DSP.gain(ctx, 60 + p.flutter * 300), o.detune); const bp = DSP.filter(ctx, 'bandpass', f * 1.2, 2); const g = DSP.gain(ctx, 0); ampEnv(g, 0.6); DSP.chain(o, bp, g, out); const n = DSP.noise(ctx, rng, t0, L); const nf = DSP.filter(ctx, 'bandpass', f * 2, 3); const ng = DSP.gain(ctx, 0); ampEnv(ng, 0.25); DSP.chain(n, nf, ng, out); if (p.type === 'squeaky') flap(r0 * 1.2, r1, 0.5); break; }
        case 'whistle': { flap(r0, r1, 0.7); const f = 1800 * k; const o = DSP.osc(ctx, 'sine', f, t0, L); DSP.sweep(o.frequency, t0, f, t0 + L, f * Math.pow(2, p.bend * 0.6)); const v = DSP.osc(ctx, 'sine', 6, t0, L); DSP.chain(v, DSP.gain(ctx, 40), o.detune); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: L * 0.2, d: L * 0.5, s: 0.5, r: L * 0.3, peak: 0.35, curve: 'lin' }); DSP.chain(o, g, out); break; }
        case 'trumpet': { flap(r0 * 1.5, r1 * 1.4, 0.9); const o = DSP.osc(ctx, 'sawtooth', 180 * k, t0, L); DSP.sweep(o.frequency, t0, 150 * k, t0 + L * 0.3, 190 * k); o.frequency.exponentialRampToValueAtTime(140 * k * Math.pow(2, p.bend * 0.5), t0 + L); const f = DSP.filter(ctx, 'bandpass', 700 * k, 2.5); const g = DSP.gain(ctx, 0); ampEnv(g, 0.5); DSP.chain(o, f, DSP.shaper(ctx, 0.5, 'soft'), g, out); break; }
      }
      wet(ctx, out, rng, t0, L, p.wetness * (p.type === 'wet' ? 1.6 : 1), 1 / k);
      if (p.type === 'wet') { flap(r0 * 0.9, r1 * 0.8, 0.8); const n = DSP.noise(ctx, rng, t0, L, 'pink'); const f = DSP.filter(ctx, 'lowpass', 1200 * k, 1); const g = DSP.gain(ctx, 0); ampEnv(g, 0.5); DSP.chain(n, f, g, out); }
      // low pressure thump at onset
      const th = DSP.osc(ctx, 'sine', 80 * k, t0, 0.15); DSP.sweep(th.frequency, t0, 110 * k, t0 + 0.08, 50 * k); const tg = DSP.gain(ctx, 0); DSP.env(tg.gain, t0, { a: 0.003, d: 0.1, peak: 0.4 * pr }); DSP.chain(th, tg, out);
    },
  });

  /* ================= BURP ================= */
  R({
    id: 'burp', name: 'Burp', category: 'Bodily', icon: '🫧',
    params: [
      P.sel('type', 'Type', ['classic', 'short', 'long', 'growl', 'squeaky', 'satisfied', 'monster', 'bubbly'], 'classic'),
      P.r('length', 'Length', 0.1, 4, 0.6, 's'), P.r('pitch', 'Pitch', 0.4, 2.5, 1), P.r('rough', 'Roughness', 0, 1, 0.7), P.r('wetness', 'Wetness', 0, 1, 0.3), P.r('size', 'Body size', 0.6, 1.8, 1),
    ],
    duration(p) { return p.length + 0.4; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, k = p.pitch, size = p.size;
      const f0 = (p.type === 'squeaky' ? 260 : p.type === 'monster' ? 45 : 85) * k / Math.sqrt(size);
      const contour = { classic: [[0, f0 * 1.3], [0.15, f0 * 0.9], [0.6, f0 * 1.0], [1, f0 * 0.6]], short: [[0, f0 * 1.4], [0.5, f0], [1, f0 * 0.7]], long: [[0, f0 * 1.2], [0.2, f0], [0.5, f0 * 0.85], [0.8, f0 * 0.9], [1, f0 * 0.5]], growl: [[0, f0 * 0.8], [0.3, f0 * 0.7], [1, f0 * 0.5]], squeaky: [[0, f0 * 0.8], [0.3, f0 * 1.3], [1, f0 * 1.1]], satisfied: [[0, f0 * 1.5], [0.3, f0 * 1.1], [0.7, f0 * 0.9], [1, f0 * 0.55]], monster: [[0, f0 * 1.2], [0.4, f0 * 0.8], [1, f0 * 0.6]], bubbly: [[0, f0 * 1.1], [0.5, f0 * 0.9], [1, f0 * 0.8]] }[p.type];
      const vow = { classic: ['uh', 'a'], short: ['uh', 'a'], long: ['o', 'a'], growl: ['uh', 'o'], squeaky: ['e', 'i'], satisfied: ['a', 'o'], monster: ['o', 'uh'], bubbly: ['u', 'o'] }[p.type];
      const rough = Math.min(1, p.rough + (p.type === 'growl' || p.type === 'monster' ? 0.25 : 0));
      const tr = syllable(ctx, out, rng, t0, L, { f0: contour, vowel: vow[0], vowel2: vow[1], morphAt: 0.3, amp: 1, attack: 0.02, decayFrac: 0.6, sustain: 0.6, release: L * 0.35, rough, breath: 0.15 + rough * 0.2, size: size * (p.type === 'squeaky' ? 0.85 : 1), nasal: 0.2, wave: 'sawtooth' });
      // sub-harmonic rasp (gastric): flap-like AM at ~ f0/2
      const sub = DSP.osc(ctx, 'sawtooth', f0 * 0.5, t0, L); const sn = DSP.noise(ctx, rng, t0, L, 'brown'); DSP.chain(sn, DSP.gain(ctx, 300 * rough), sub.detune); const sf = DSP.filter(ctx, 'lowpass', 500 / size, 2); const sg = DSP.gain(ctx, 0); DSP.env(sg.gain, t0, { a: 0.03, d: L * 0.6, s: 0.5, r: L * 0.3, peak: 0.35 * rough * (p.type === 'monster' ? 2 : 1), curve: 'lin' }); DSP.chain(sub, sf, DSP.shaper(ctx, 0.5, 'soft'), sg, out);
      wet(ctx, out, rng, t0, L, p.wetness * (p.type === 'bubbly' ? 2 : 1), size);
      if (p.type === 'monster') { const r = DSP.noise(ctx, rng, t0, L, 'brown'); const rf = DSP.filter(ctx, 'lowpass', 120, 1); const rg = DSP.gain(ctx, 0); DSP.env(rg.gain, t0, { a: 0.05, d: L * 0.7, s: 0.4, r: L * 0.3, peak: 1.2, curve: 'lin' }); DSP.chain(r, rf, rg, out); }
      if (p.type === 'satisfied') { const t = t0 + L; breathBurst(ctx, out, rng, t, 0.35, { vowel: 'a', amp: 0.35, attack: 0.05, size, color: 'pink' }); } // "...ahh"
      // onset pop
      DSP.hit(ctx, out, rng, t0, { thumpAmp: 0.3, thumpFreq: 120 * k / size, thumpDecay: 0.04, noiseAmp: 0.3, noiseColor: 'pink', noiseFreq: 900 / size, noiseQ: 1, noiseDecay: 0.03 });
    },
  });

  /* ================= SNEEZE ================= */
  R({
    id: 'sneeze', name: 'Sneeze', category: 'Bodily', icon: '🤧',
    params: [
      P.sel('type', 'Type', ['big', 'small', 'cute', 'suppressed', 'triple', 'cartoon', 'cat', 'wet'], 'big'),
      P.r('pitch', 'Pitch', 0.5, 2.5, 1), P.r('buildup', 'Build-up', 0, 1, 0.6), P.r('power', 'Power', 0, 1, 0.7), P.r('wetness', 'Wetness', 0, 1, 0.2), P.r('size', 'Body size', 0.6, 1.6, 1),
    ],
    duration(p) { return 0.5 + p.buildup * 1.2 + (p.type === 'triple' ? 1.2 : 0) + 0.6; },
    build(ctx, out, p, rng, t0) {
      const k = p.pitch, size = p.size; const f0 = 200 * k / Math.sqrt(size);
      const one = (t, powerMul, withBuild) => {
        let tc = t;
        if (withBuild && p.buildup > 0) { // "ah... ah... AH-"
          const n = 1 + Math.round(p.buildup * 2); let tt = t;
          for (let i = 0; i < n; i++) { const d = 0.18 + i * 0.08; const rise = 1 + i * 0.25; syllable(ctx, out, rng, tt, d, { f0: [[0, f0 * 0.9 * rise], [1, f0 * 1.15 * rise]], vowel: 'a', amp: 0.55 + i * 0.25, attack: 0.05, decayFrac: 0.5, sustain: 0.7, release: 0.08, rough: 0.15, breath: 0.5 + i * 0.1, size }); tt += d + rng.range(0.15, 0.35) * (1 - i * 0.2); }
          tc = tt;
        }
        // the "-CHOO": sharp burst, ch-noise, then vowel tail
        const pw = p.power * powerMul;
        // burst is deliberately modest in peak (the tract's high-Q formants spike on impulses) so the vocal tail isn't buried by normalization
        breathBurst(ctx, out, rng, tc, 0.14, { vowel: 'i', vowel2: 'u', amp: 0.35 * (0.5 + pw), attack: 0.006, size, hiss: 0.45 * (0.5 + pw), hissFreq: 4500 * k });
        DSP.hit(ctx, out, rng, tc, { thumpAmp: 0.35 * pw, thumpFreq: 90 * k, thumpDecay: 0.06, noiseAmp: 0.4, noiseType: 'highpass', noiseFreq: 2500, noiseQ: 0.5, noiseDecay: 0.035 });
        const tailF0 = f0 * (p.type === 'cute' ? 1.5 : p.type === 'cat' ? 2 : 1.6);
        syllable(ctx, out, rng, tc + 0.04, 0.3 + pw * 0.18, { f0: [[0, tailF0], [0.3, tailF0 * 0.85], [1, tailF0 * 0.45]], vowel: 'u', vowel2: 'o', morphAt: 0.3, amp: 1 + pw * 0.5, attack: 0.008, decayFrac: 0.5, sustain: 0.45, release: 0.18, rough: 0.2 + pw * 0.3, breath: 0.7, size });
        wet(ctx, out, rng, tc, 0.4, p.wetness * (p.type === 'wet' ? 2 : 1), size);
        if (p.type === 'cat') { const h = DSP.noise(ctx, rng, tc, 0.15); const hf = DSP.filter(ctx, 'bandpass', 6000, 1.5); const hg = DSP.gain(ctx, 0); DSP.env(hg.gain, tc, { a: 0.003, d: 0.1, peak: 0.8 }); DSP.chain(h, hf, hg, out); }
        if (p.type === 'wet') { const t2 = tc + 0.45; breathBurst(ctx, out, rng, t2, 0.3, { vowel: 'n', amp: 0.35, attack: 0.03, color: 'pink', size, hiss: 0.3, hissFreq: 3000 }); wet(ctx, out, rng, t2, 0.3, 1.2, size); } // sniffle
        return tc + 0.45;
      };
      if (p.type === 'small' || p.type === 'cute') one(t0, p.type === 'cute' ? 0.5 : 0.6, true);
      else if (p.type === 'suppressed') { // build-up then a stifled "mmf!"
        const tc = one(t0, 0.15, true) - 0.45; const m = syllable(ctx, out, rng, tc, 0.25, { f0: [[0, f0 * 1.4], [1, f0 * 0.7]], vowel: 'n', amp: 0.9, attack: 0.005, decayFrac: 0.4, sustain: 0.3, release: 0.1, rough: 0.4, breath: 0.2, size, nasal: 1 });
      }
      else if (p.type === 'triple') { let t = t0; for (let i = 0; i < 3; i++) { t = one(t, 0.6 + i * 0.25, i === 0) + rng.range(0.15, 0.3); } }
      else if (p.type === 'cartoon') { // exaggerated: long rising "aaaah" then huge "CHOO" with a slide-whistle tail
        const rise = 0.6 + p.buildup * 0.8; syllable(ctx, out, rng, t0, rise, { f0: [[0, f0 * 0.8], [1, f0 * 2.2]], vowel: 'a', amp: 0.8, attack: 0.1, decayFrac: 0.9, sustain: 1, release: 0.05, rough: 0.2, breath: 0.4, size });
        const tc = t0 + rise + 0.05; one(tc, 1.3, false);
        const o = DSP.osc(ctx, 'sine', 1800 * k, tc + 0.08, 0.5); DSP.sweep(o.frequency, tc + 0.08, 1800 * k, tc + 0.55, 300 * k); const g = DSP.gain(ctx, 0); DSP.env(g.gain, tc + 0.08, { a: 0.01, d: 0.45, peak: 0.3 }); DSP.chain(o, g, out);
      }
      else one(t0, 1, true);
    },
  });

  /* ================= YAWN ================= */
  R({
    id: 'yawn', name: 'Yawn / Sigh', category: 'Bodily', icon: '🥱',
    params: [
      P.sel('type', 'Type', ['yawn', 'big-yawn', 'sleepy', 'squeaky-yawn', 'sigh', 'groan', 'stretch', 'snore'], 'yawn'),
      P.r('length', 'Length', 0.5, 5, 1.8, 's'), P.r('pitch', 'Pitch', 0.5, 2.5, 1), P.r('breath', 'Breathiness', 0, 1, 0.5), P.r('size', 'Body size', 0.6, 1.8, 1), P.r('count', 'Cycles (snore)', 1, 8, 3),
    ],
    duration(p) { return (p.type === 'snore' ? Math.round(p.count) * 2.2 : p.length) + 0.6; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, k = p.pitch, size = p.size; const f0 = 150 * k / Math.sqrt(size);
      if (p.type === 'snore') {
        const n = Math.round(p.count);
        for (let i = 0; i < n; i++) {
          const t = t0 + i * 2.2 * rng.range(0.95, 1.05); const inh = 0.9 * rng.range(0.8, 1.2);
          // inhale: rough uvular flutter through a nasal tract
          const tr = tract(ctx, out, size, 1); tr.setVowel(t, 'o', 0); tr.setVowel(t + inh * 0.5, 'a', inh * 0.5);
          const sr = ctx.sampleRate, nn = Math.ceil((inh + 0.05) * sr); const buf = ctx.createBuffer(1, nn, sr); const d = buf.getChannelData(0); let q = 0; while (q < nn) { const per = Math.max(4, Math.round(sr / (28 * k * rng.range(0.7, 1.4)))); for (let j = 0; j < per * 0.4 && q + j < nn; j++) d[q + j] = Math.sin(Math.PI * j / (per * 0.4)) * rng.range(0.6, 1); q += per; }
          const src = ctx.createBufferSource(); src.buffer = buf; src.start(t); src.stop(t + inh + 0.05); const g = DSP.gain(ctx, 0); DSP.env(g.gain, t, { a: inh * 0.3, d: inh * 0.4, s: 0.6, r: inh * 0.3, peak: 1.2, curve: 'lin' }); DSP.chain(src, g, tr.input);
          const bn = DSP.noise(ctx, rng, t, inh, 'pink'); const bg = DSP.gain(ctx, 0); DSP.env(bg.gain, t, { a: inh * 0.3, d: inh * 0.4, s: 0.6, r: inh * 0.3, peak: 0.5 + p.breath * 0.5, curve: 'lin' }); DSP.chain(bn, bg, tr.input);
          // exhale: soft breathy "phhh"
          const te = t + inh + 0.15; breathBurst(ctx, out, rng, te, 0.8, { vowel: 'u', amp: 0.25 + p.breath * 0.3, attack: 0.15, color: 'pink', size, curve: 'lin' });
          if (rng.next() < 0.4) { const o = DSP.osc(ctx, 'sine', 1500 * k, te + 0.1, 0.4); const og = DSP.gain(ctx, 0); DSP.env(og.gain, te + 0.1, { a: 0.1, d: 0.3, peak: 0.05 }); DSP.chain(o, og, out); } // lip whistle
        }
        return;
      }
      const cfg = {
        yawn:          { f0: [[0, f0 * 0.9], [0.35, f0 * 1.35], [0.7, f0 * 1.1], [1, f0 * 0.7]], v: ['a', 'o'], amp: 0.7, rough: 0.15, wave: 'sawtooth' },
        'big-yawn':    { f0: [[0, f0 * 0.8], [0.4, f0 * 1.6], [0.75, f0 * 1.2], [1, f0 * 0.6]], v: ['a', 'o'], amp: 0.9, rough: 0.25, wave: 'sawtooth' },
        sleepy:        { f0: [[0, f0 * 0.85], [0.5, f0 * 1.05], [1, f0 * 0.65]], v: ['uh', 'o'], amp: 0.5, rough: 0.2, wave: 'sawtooth' },
        'squeaky-yawn':{ f0: [[0, f0 * 1.2], [0.4, f0 * 2.6], [0.6, f0 * 2.2], [1, f0 * 0.9]], v: ['e', 'a'], amp: 0.7, rough: 0.3, wave: 'sawtooth' },
        sigh:          { f0: [[0, f0 * 1.3], [0.2, f0 * 1.1], [1, f0 * 0.6]], v: ['a', 'uh'], amp: 0.45, rough: 0.1, wave: 'triangle' },
        groan:         { f0: [[0, f0 * 0.8], [0.3, f0 * 0.75], [1, f0 * 0.55]], v: ['uh', 'o'], amp: 0.8, rough: 0.6, wave: 'sawtooth' },
        stretch:       { f0: [[0, f0 * 0.9], [0.6, f0 * 1.5], [0.85, f0 * 1.6], [1, f0 * 0.8]], v: ['n', 'a'], amp: 0.75, rough: 0.35, wave: 'sawtooth' },
      }[p.type];
      const tr = syllable(ctx, out, rng, t0, L, { f0: cfg.f0, vowel: cfg.v[0], vowel2: cfg.v[1], morphAt: 0.55, amp: cfg.amp, attack: L * 0.2, decayFrac: 0.55, sustain: 0.8, release: L * 0.35, rough: cfg.rough, breath: p.breath * (p.type === 'sigh' ? 1.6 : 0.9), size, nasal: p.type === 'stretch' ? 0.8 : 0.15, wave: cfg.wave });
      // inhale before it (breathy, rising)
      if (p.type !== 'sigh' && p.type !== 'groan') { const ti = t0 - 0; breathBurst(ctx, out, rng, t0, L * 0.3, { vowel: 'a', amp: 0.25 + p.breath * 0.3, attack: L * 0.15, color: 'pink', size, curve: 'lin' }); }
      // exhale tail
      breathBurst(ctx, out, rng, t0 + L * 0.85, L * 0.35, { vowel: 'uh', vowel2: 'u', amp: 0.2 + p.breath * 0.35, attack: 0.05, color: 'pink', size, curve: 'lin' });
      if (p.type === 'stretch') { const t = t0 + L * 0.9; syllable(ctx, out, rng, t, 0.25, { f0: [[0, f0 * 1.3], [1, f0 * 0.8]], vowel: 'a', amp: 0.5, attack: 0.02, rough: 0.2, breath: 0.4, size }); } // "...ah"
    },
  });

  /* ================= LAUGH ================= */
  R({
    id: 'laugh', name: 'Laugh / Cackle / Chuckle', category: 'Bodily', icon: '😂',
    params: [
      P.sel('type', 'Type', ['chuckle', 'giggle', 'laugh', 'belly-laugh', 'cackle', 'goblin-chuckle', 'goblin-cackle', 'evil-laugh', 'snicker', 'nervous', 'guffaw'], 'laugh'),
      P.r('syllables', 'Syllables', 1, 16, 5), P.r('rate', 'Rate', 2, 12, 5, 'Hz'), P.r('pitch', 'Pitch', 0.4, 3, 1), P.r('rough', 'Roughness', 0, 1, 0.3), P.r('breath', 'Breathiness', 0, 1, 0.4), P.r('size', 'Body size', 0.5, 2, 1), P.r('irregular', 'Irregularity', 0, 1, 0.3),
      P.r('inhale', 'Inhale at end', 0, 1, 0),
    ],
    duration(p) { return Math.round(p.syllables) / p.rate + 1.2; },
    build(ctx, out, p, rng, t0) {
      const n = Math.round(p.syllables), k = p.pitch, size = p.size;
      const T = {
        chuckle:        { f0: 120, v: ['uh', 'uh'], amp: 0.55, rough: 0.2, breath: 0.5, nasal: 0.3, syl: 0.55, contour: 'flat', drift: -0.1, wave: 'sawtooth' },
        giggle:         { f0: 300, v: ['i', 'i'], amp: 0.5, rough: 0.1, breath: 0.5, nasal: 0.2, syl: 0.4, contour: 'up', drift: 0.15, wave: 'triangle' },
        laugh:          { f0: 190, v: ['a', 'a'], amp: 0.75, rough: 0.2, breath: 0.45, nasal: 0.1, syl: 0.5, contour: 'down', drift: -0.25, wave: 'sawtooth' },
        'belly-laugh':  { f0: 130, v: ['o', 'a'], amp: 0.95, rough: 0.3, breath: 0.35, nasal: 0.1, syl: 0.6, contour: 'down', drift: -0.2, wave: 'sawtooth' },
        cackle:         { f0: 330, v: ['e', 'i'], amp: 0.8, rough: 0.55, breath: 0.3, nasal: 0.5, syl: 0.45, contour: 'peak', drift: 0.1, wave: 'sawtooth' },
        'goblin-chuckle': { f0: 170, v: ['e', 'uh'], amp: 0.7, rough: 0.7, breath: 0.35, nasal: 0.9, syl: 0.5, contour: 'flat', drift: -0.05, wave: 'sawtooth', snort: 0.5 },
        'goblin-cackle':  { f0: 260, v: ['ae', 'i'], amp: 0.85, rough: 0.8, breath: 0.3, nasal: 1, syl: 0.42, contour: 'peak', drift: 0.2, wave: 'sawtooth', snort: 0.7 },
        'evil-laugh':   { f0: 110, v: ['o', 'a'], amp: 0.95, rough: 0.45, breath: 0.25, nasal: 0.2, syl: 0.7, contour: 'down', drift: -0.35, wave: 'sawtooth', mwah: true },
        snicker:        { f0: 200, v: ['n', 'i'], amp: 0.45, rough: 0.35, breath: 0.6, nasal: 1, syl: 0.35, contour: 'flat', drift: 0, wave: 'sawtooth' },
        nervous:        { f0: 240, v: ['e', 'e'], amp: 0.5, rough: 0.25, breath: 0.6, nasal: 0.4, syl: 0.4, contour: 'up', drift: 0.1, wave: 'sawtooth' },
        guffaw:         { f0: 150, v: ['a', 'o'], amp: 1, rough: 0.4, breath: 0.4, nasal: 0.1, syl: 0.7, contour: 'down', drift: -0.3, wave: 'sawtooth' },
      }[p.type];
      const base = T.f0 * k / Math.sqrt(size); const rough = Math.min(1, T.rough + p.rough * 0.6);
      let t = t0; const per = 1 / p.rate;
      const irregular = p.irregular + (p.type.startsWith('goblin') || p.type === 'cackle' ? 0.25 : 0);
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) : 0;
        const dur = per * T.syl * rng.range(1 - irregular * 0.4, 1 + irregular * 0.6) * (T.mwah && i === 0 ? 2.2 : 1);
        const pitchMul = Math.pow(2, T.drift * u) * rng.range(1 - irregular * 0.12, 1 + irregular * 0.12) * (T.mwah && i === 0 ? 0.85 : 1);
        const f = base * pitchMul;
        const c = { flat: [[0, f * 1.05], [1, f * 0.95]], up: [[0, f * 0.9], [1, f * 1.2]], down: [[0, f * 1.25], [0.3, f * 1.05], [1, f * 0.85]], peak: [[0, f * 0.9], [0.3, f * 1.4], [1, f * 0.95]] }[T.contour];
        const amp = T.amp * (1 - u * 0.35) * rng.range(0.75, 1.05) * (T.mwah && i === 0 ? 1.1 : 1);
        // aspirated onset "h"
        breathBurst(ctx, out, rng, t, dur * 0.35, { vowel: T.v[0], amp: 0.3 * (0.5 + T.breath + p.breath), attack: 0.005, size, hiss: 0.15 * (T.breath + p.breath) });
        syllable(ctx, out, rng, t + dur * 0.12, dur, { f0: c, vowel: T.v[0], vowel2: T.v[1], morphAt: 0.5, amp, attack: 0.015, decayFrac: 0.6, sustain: 0.45, release: dur * 0.35, rough, breath: (T.breath + p.breath) * 0.4, size, nasal: T.nasal, wave: T.wave });
        if (T.snort && rng.next() < T.snort * 0.35) { const ts = t + dur * 0.5; const sn = DSP.noise(ctx, rng, ts, 0.12, 'pink'); const sf = DSP.filter(ctx, 'bandpass', 1400 / size, 2.5); sf.frequency.setValueAtTime(900 / size, ts); sf.frequency.exponentialRampToValueAtTime(2200 / size, ts + 0.1); const sg = DSP.gain(ctx, 0); DSP.env(sg.gain, ts, { a: 0.01, d: 0.1, peak: 0.5, r: 0.02 }); DSP.chain(sn, sf, sg, out); }
        t += per * rng.range(1 - irregular * 0.35, 1 + irregular * 0.5);
      }
      // optional soft breath-in after the last syllable (off by default; no hiss, no wheeze)
      if (p.inhale > 0) { const ti = t + 0.08; const d = 0.25 + p.inhale * 0.3; breathBurst(ctx, out, rng, ti, d, { vowel: 'uh', vowel2: 'a', amp: p.inhale * 0.18 * (0.6 + p.breath * 0.4), attack: d * 0.5, color: 'pink', size, curve: 'lin' }); }
      if (T.mwah) { const ta = t + 0.3; syllable(ctx, out, rng, ta, 0.6, { f0: [[0, base * 1.1], [0.5, base * 0.9], [1, base * 0.6]], vowel: 'a', vowel2: 'o', amp: 0.7, attack: 0.05, decayFrac: 0.6, sustain: 0.5, release: 0.25, rough: rough, breath: 0.3, size, nasal: 0.1 }); } // closing "haaa"
    },
  });
})();
