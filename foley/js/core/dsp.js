/* DSP helper library used by all generators. Every function schedules Web Audio
   nodes on an (Offline)AudioContext; nothing here depends on realtime. */
window.Foley = window.Foley || {};
const DSP = Foley.DSP = {
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  lerp(a, b, t) { return a + (b - a) * t; },
  db(v) { return Math.pow(10, v / 20); },
  semis(n) { return Math.pow(2, n / 12); },

  /* ---- Noise sources -------------------------------------------------- */
  noiseBuffer(ctx, rng, seconds, color) {
    color = color || 'white';
    const n = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (color === 'white') {
      for (let i = 0; i < n; i++) d[i] = rng.next() * 2 - 1;
    } else if (color === 'pink') { // Paul Kellet refined method
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = rng.next() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (color === 'brown') {
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = (last + 0.02 * (rng.next() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    } else if (color === 'crackle') { // sparse impulses
      for (let i = 0; i < n; i++) d[i] = rng.next() < 0.002 ? (rng.next() * 2 - 1) : 0;
    } else if (color === 'velvet') { // velvet noise: sparse ±1 impulses (~2500/s) — a smoother, more natural excitation than white
      const per = Math.max(2, Math.round(ctx.sampleRate / 2500)); for (let i = 0; i < n; i += per) { const k = i + Math.floor(rng.next() * per); if (k < n) d[k] = rng.next() < 0.5 ? 1 : -1; }
      for (let i = 0; i < n; i++) d[i] *= 2.2;
    } else if (color === 'blue') { // differentiated white: rising +3 dB/oct
      let last = 0; for (let i = 0; i < n; i++) { const w = rng.next() * 2 - 1; d[i] = (w - last) * 0.5; last = w; }
    } else if (color === 'grey') { // pink with a mid dip — perceptually flat-ish
      let b0 = 0, b1 = 0, hp = 0; for (let i = 0; i < n; i++) { const w = rng.next() * 2 - 1; b0 = 0.997 * b0 + 0.03 * w; b1 = 0.95 * b1 + 0.05 * w; hp = 0.9 * hp + 0.1 * w; d[i] = (b0 + b1 * 0.5 + (w - hp) * 0.35) * 1.5; }
    }
    return buf;
  },
  noise(ctx, rng, t0, dur, color, rate) {
    rate = rate || 1;
    const src = ctx.createBufferSource();
    src.buffer = DSP.noiseBuffer(ctx, rng, dur * rate + 0.05, color);
    src.playbackRate.value = rate;
    src.start(t0); src.stop(t0 + dur + 0.05);
    return src;
  },

  /* ---- Oscillators ---------------------------------------------------- */
  osc(ctx, type, freq, t0, dur) {
    const o = ctx.createOscillator();
    o.type = ['sine', 'square', 'sawtooth', 'triangle'].includes(type) ? type : 'sine';
    o.frequency.setValueAtTime(DSP.clamp(freq, 1, 20000), t0);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return o;
  },
  /* Sweep a param from v0 (at t0) to v1 (at t1). */
  sweep(param, t0, v0, t1, v1, exp) {
    if (exp === undefined) exp = true;
    v0 = Math.max(0.0001, v0); v1 = Math.max(0.0001, v1);
    param.setValueAtTime(v0, t0);
    if (exp) param.exponentialRampToValueAtTime(v1, Math.max(t1, t0 + 0.001));
    else param.linearRampToValueAtTime(v1, Math.max(t1, t0 + 0.001));
  },
  /* Detuned stack of oscillators into a gain */
  stack(ctx, type, freq, t0, dur, count, detuneCents, rng) {
    count = count || 3; detuneCents = detuneCents === undefined ? 12 : detuneCents;
    const g = ctx.createGain(); g.gain.value = 1 / Math.sqrt(count);
    const oscs = [];
    for (let i = 0; i < count; i++) {
      const o = DSP.osc(ctx, type, freq, t0, dur);
      const spread = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2;
      o.detune.value = spread * detuneCents + (rng ? rng.range(-2, 2) : 0);
      o.connect(g); oscs.push(o);
    }
    return { node: g, oscs };
  },

  /* ---- Envelopes ------------------------------------------------------ */
  /* AD/ADSR on any AudioParam. Percussive by default (exponential decay). Returns end time. */
  env(param, t0, o) {
    o = o || {};
    const a = o.a === undefined ? 0.002 : o.a, d = o.d === undefined ? 0.1 : o.d, s = o.s || 0,
      r = o.r === undefined ? 0.05 : o.r, hold = o.hold || 0, peak = o.peak === undefined ? 1 : o.peak,
      floor = o.floor || 0.0005, curve = o.curve || 'exp';
    param.cancelScheduledValues(t0);
    param.setValueAtTime(floor, t0);
    param.linearRampToValueAtTime(Math.max(floor, peak), t0 + Math.max(a, 0.0005));
    const sus = Math.max(floor, peak * s);
    const tD = t0 + Math.max(a, 0.0005) + Math.max(d, 0.001);
    if (curve === 'exp') param.exponentialRampToValueAtTime(sus, tD);
    else param.linearRampToValueAtTime(sus, tD);
    const tR = tD + hold;
    param.setValueAtTime(sus, tR);
    if (curve === 'exp') param.exponentialRampToValueAtTime(floor, tR + Math.max(r, 0.001));
    else param.linearRampToValueAtTime(0, tR + Math.max(r, 0.001));
    return tR + r;
  },
  gain(ctx, v) { const g = ctx.createGain(); g.gain.value = v === undefined ? 1 : v; return g; },
  filter(ctx, type, freq, Q, gain) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = DSP.clamp(freq, 10, 20000); f.Q.value = Q === undefined ? 1 : Q; f.gain.value = gain || 0;
    return f;
  },
  pan(ctx, v) { const p = ctx.createStereoPanner(); p.pan.value = DSP.clamp(v || 0, -1, 1); return p; },
  chain() { const n = arguments; for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; },

  /* ---- Waveshaping ---------------------------------------------------- */
  shaperCurve(amount, kind, n) {
    kind = kind || 'soft'; n = n || 2048;
    const c = new Float32Array(n);
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      if (kind === 'soft') c[i] = Math.tanh(x * (1 + k * 10)) / Math.tanh(1 + k * 10);
      else if (kind === 'hard') c[i] = DSP.clamp(x * (1 + k * 10), -1, 1);
      else if (kind === 'fold') { let y = x * (1 + k * 4); let guard = 0; while ((y > 1 || y < -1) && guard++ < 20) y = y > 1 ? 2 - y : -2 - y; c[i] = y; }
      else c[i] = x;
    }
    return c;
  },
  shaper(ctx, amount, kind) {
    const s = ctx.createWaveShaper(); s.curve = DSP.shaperCurve(amount, kind); s.oversample = '2x'; return s;
  },

  /* ---- Composite building blocks -------------------------------------- */
  /* A generic percussive "hit": low thump + filtered noise burst + optional ring partials. */
  hit(ctx, out, rng, t0, o) {
    o = o || {};
    const thumpAmp = o.thumpAmp === undefined ? 0.5 : o.thumpAmp, thumpFreq = o.thumpFreq || 90, thumpDecay = o.thumpDecay || 0.12, thumpSweep = o.thumpSweep || 2.2,
      noiseAmp = o.noiseAmp === undefined ? 0.5 : o.noiseAmp, noiseColor = o.noiseColor || 'white', noiseType = o.noiseType || 'bandpass',
      noiseFreq = o.noiseFreq || 1500, noiseQ = o.noiseQ || 0.8, noiseAttack = o.noiseAttack || 0.001, noiseDecay = o.noiseDecay || 0.08,
      ring = o.ring || [], ringAmp = o.ringAmp || 0, ringDecay = o.ringDecay || 0.3, drive = o.drive || 0;
    const sum = DSP.gain(ctx, 1);
    if (thumpAmp > 0) {
      const osc = DSP.osc(ctx, 'sine', thumpFreq * thumpSweep, t0, thumpDecay + 0.1);
      DSP.sweep(osc.frequency, t0, thumpFreq * thumpSweep, t0 + thumpDecay * 0.5, thumpFreq);
      const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.001, d: thumpDecay, peak: thumpAmp, r: 0.02 });
      DSP.chain(osc, g, sum);
    }
    if (noiseAmp > 0) {
      const n = DSP.noise(ctx, rng, t0, noiseDecay + 0.1, noiseColor);
      const f = DSP.filter(ctx, noiseType, noiseFreq, noiseQ);
      const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: noiseAttack, d: noiseDecay, peak: noiseAmp, r: 0.01 });
      DSP.chain(n, f, g, sum);
    }
    if (ringAmp > 0 && ring.length) {
      ring.forEach((fr, i) => {
        const o2 = DSP.osc(ctx, 'sine', fr, t0, ringDecay + 0.1);
        const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: 0.001, d: ringDecay * rng.range(0.7, 1.1), peak: ringAmp / (i + 1), r: 0.02 });
        DSP.chain(o2, g, sum);
      });
    }
    if (drive > 0) DSP.chain(sum, DSP.shaper(ctx, drive, 'soft'), out); else sum.connect(out);
    return sum;
  },
  /* Cluster of short noise grains (gravel, crunch, debris, shatter). */
  grains(ctx, out, rng, t0, o) {
    o = o || {};
    const count = o.count || 20, spread = o.spread || 0.15, len = o.len || 0.012, lenVar = o.lenVar === undefined ? 0.6 : o.lenVar,
      amp = o.amp === undefined ? 0.4 : o.amp, freq = o.freq || 2500, freqVar = o.freqVar === undefined ? 0.5 : o.freqVar,
      Q = o.Q || 1.5, type = o.type || 'bandpass', color = o.color || 'white', decayShape = o.decayShape || 1.5;
    for (let i = 0; i < count; i++) {
      const u = Math.pow(rng.next(), 1 / decayShape); // front-loaded
      const t = t0 + u * spread;
      const l = len * rng.range(1 - lenVar, 1 + lenVar);
      const n = DSP.noise(ctx, rng, t, l + 0.02, color);
      const f = DSP.filter(ctx, type, freq * rng.range(1 - freqVar, 1 + freqVar), Q);
      const g = DSP.gain(ctx, 0);
      DSP.env(g.gain, t, { a: 0.0005, d: l, peak: amp * (1 - u * 0.6) * rng.range(0.5, 1), r: 0.005 });
      DSP.chain(n, f, g, out);
    }
  },
};
