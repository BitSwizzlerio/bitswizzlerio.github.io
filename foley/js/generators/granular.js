/* Granular texture engine: a cloud of tiny windowed grains cut from a synthetic source, rendered sample-by-sample
   in JS (so density is unbounded and cheap), then shaped by a cloud envelope and a sweepable filter. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;

  function sourceBuffer(ctx, rng, type, hz) {
    const sr = ctx.sampleRate, n = sr; const d = new Float32Array(n);
    switch (type) {
      case 'white': for (let i = 0; i < n; i++) d[i] = rng.next() * 2 - 1; break;
      case 'pink': { let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < n; i++) { const w = rng.next() * 2 - 1; b0 = 0.997 * b0 + 0.029591 * w; b1 = 0.985 * b1 + 0.032534 * w; b2 = 0.95 * b2 + 0.048056 * w; d[i] = (b0 + b1 + b2 + w * 0.1848) * 1.2; } break; }
      case 'brown': { let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * (rng.next() * 2 - 1)) / 1.02; d[i] = l * 3.5; } break; }
      case 'sine': for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * hz * i / sr); break;
      case 'saw': for (let i = 0; i < n; i++) d[i] = 2 * ((i * hz / sr) % 1) - 1; break;
      case 'square': for (let i = 0; i < n; i++) d[i] = ((i * hz / sr) % 1) < 0.5 ? 1 : -1; break;
      case 'impulse': for (let i = 0; i < 64; i++) d[i] = (1 - i / 64) * (i % 2 ? -1 : 1) * (i < 8 ? 1 : 0.3); break;
      case 'chirp': for (let i = 0; i < 2400; i++) { const u = i / 2400; d[i] = Math.sin(2 * Math.PI * hz * 4 * (1 - u * 0.8) * i / sr) * (1 - u); } break;
      case 'crackle': for (let i = 0; i < n; i++) d[i] = rng.next() < 0.004 ? rng.next() * 2 - 1 : 0; break;
      case 'ring': for (let i = 0; i < 4000; i++) d[i] = Math.sin(2 * Math.PI * hz * i / sr) * Math.exp(-i / 900) + 0.5 * Math.sin(2 * Math.PI * hz * 2.76 * i / sr) * Math.exp(-i / 500); break;
    }
    return d;
  }
  function window(shape, u) { // u in 0..1
    switch (shape) {
      case 'hann': return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
      case 'expo': return Math.exp(-u * 6) * Math.min(1, u * 40);
      case 'reverse': return Math.exp(-(1 - u) * 6) * Math.min(1, (1 - u) * 40);
      case 'tukey': return u < 0.1 ? u / 0.1 : u > 0.9 ? (1 - u) / 0.1 : 1;
      case 'click': return u < 0.05 ? 1 : Math.exp(-(u - 0.05) * 30);
    }
    return 1;
  }

  R({
    id: 'granular', name: 'Granular Texture', category: 'Textures', icon: '🌫️',
    params: [
      P.sel('source', 'Grain source', ['white', 'pink', 'brown', 'crackle', 'sine', 'saw', 'square', 'impulse', 'chirp', 'ring'], 'white'),
      P.r('length', 'Length', 0.2, 12, 3, 's'), P.r('density', 'Density', 1, 3000, 200, '/s'), P.r('grain', 'Grain size', 1, 400, 25, 'ms'), P.r('grainVar', 'Size jitter', 0, 1, 0.5),
      P.sel('shape', 'Grain window', ['hann', 'expo', 'reverse', 'tukey', 'click'], 'hann'),
      P.r('pitch', 'Pitch / rate', 20, 4000, 440, 'Hz'), P.r('spread', 'Pitch spread', 0, 36, 6, 'st'), P.r('rateJitter', 'Rate jitter', 0, 1, 0.3),
      P.r('pan', 'Stereo spread', 0, 1, 0.6), P.r('ampVar', 'Amp jitter', 0, 1, 0.6),
      P.sel('cloud', 'Cloud envelope', ['flat', 'swell', 'decay', 'pulse', 'gusts', 'rise-fall'], 'flat'), P.r('pulseRate', 'Pulse / gust rate', 0.2, 20, 3, 'Hz'),
      P.sel('filter', 'Filter', ['none', 'lowpass', 'highpass', 'bandpass'], 'none'), P.r('cutoff', 'Cutoff', 60, 16000, 3000, 'Hz'), P.r('sweep', 'Cutoff sweep (oct)', -4, 4, 0), P.r('reso', 'Resonance', 0.3, 12, 1),
      P.r('drive', 'Drive', 0, 1, 0), P.tog('loop', 'Seamless loop', true),
    ],
    duration(p) { return p.length + 0.3; },
    build(ctx, out, p, rng, t0) {
      const sr = ctx.sampleRate, L = p.length, n = Math.ceil(L * sr);
      const src = sourceBuffer(ctx, rng, p.source, p.pitch); const srcLen = src.length;
      const oneShot = p.source === 'impulse' || p.source === 'chirp' || p.source === 'ring';
      const baseRate = oneShot || p.source === 'sine' || p.source === 'saw' || p.source === 'square' ? 1 : p.pitch / 440; // noise: rate scales spectrum
      const L0 = new Float32Array(n), R0 = new Float32Array(n);
      // budget: cap total grain-samples (~25M ≈ 0.5 s of JS) — beyond this extra grains are inaudible anyway
      const avgGrain = (p.grain / 1000) * sr * (1 + p.grainVar * 0.3);
      const count = Math.min(60000, Math.round(p.density * L), Math.floor(25e6 / avgGrain));
      // cloud envelope
      const cloudAt = u => { const t = u * L; switch (p.cloud) { case 'swell': return Math.pow(u, 1.5); case 'decay': return Math.pow(1 - u, 1.5); case 'pulse': return ((t * p.pulseRate) % 1) < 0.45 ? 1 : 0.08; case 'gusts': return 0.35 + 0.65 * Math.max(0, Math.sin(t * p.pulseRate * 2 + 1.3) * Math.sin(t * p.pulseRate * 0.37)); case 'rise-fall': return Math.sin(u * Math.PI); } return 1; };
      for (let g = 0; g < count; g++) {
        const u = rng.next(); const ce = cloudAt(u); if (ce < 0.02 || rng.next() > ce) continue;
        const start = Math.floor(u * n);
        const len = Math.max(8, Math.round((p.grain / 1000) * sr * rng.range(1 - p.grainVar * 0.9, 1 + p.grainVar * 1.5)));
        const rate = baseRate * Math.pow(2, rng.range(-p.spread, p.spread) / 12) * rng.range(1 - p.rateJitter * 0.5, 1 + p.rateJitter * 0.5);
        const amp = 0.5 * rng.range(1 - p.ampVar, 1) * ce;
        const panv = rng.range(-1, 1) * p.pan; const gl = Math.cos((panv + 1) * Math.PI / 4), gr = Math.sin((panv + 1) * Math.PI / 4);
        let pos = oneShot ? 0 : rng.next() * (srcLen - 1);
        for (let i = 0; i < len; i++) { const idx = start + i; if (idx >= n) break; const w = window(p.shape, i / len) * amp; const ip = pos | 0; const fr = pos - ip; const s = (src[ip % srcLen] * (1 - fr) + src[(ip + 1) % srcLen] * fr) * w; L0[idx] += s * gl; R0[idx] += s * gr; pos += rate; if (oneShot && pos >= srcLen) break; }
      }
      // seamless loop: wrap the last 5% into the head so the texture loops without a seam
      if (p.loop) { const F = Math.min(Math.floor(n * 0.05), Math.floor(sr * 0.25)); for (let i = 0; i < F; i++) { const a = i / F; L0[i] = L0[i] * a + L0[n - F + i] * (1 - a); R0[i] = R0[i] * a + R0[n - F + i] * (1 - a); L0[n - F + i] *= (1 - a); R0[n - F + i] *= (1 - a); } }
      let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L0[i]), Math.abs(R0[i])); const norm = peak > 0 ? 0.8 / peak : 1;
      const buf = ctx.createBuffer(2, n, sr); const cl = buf.getChannelData(0), cr = buf.getChannelData(1); for (let i = 0; i < n; i++) { cl[i] = L0[i] * norm; cr[i] = R0[i] * norm; }
      const s = ctx.createBufferSource(); s.buffer = buf; s.start(t0); s.stop(t0 + L + 0.02);
      let node = s;
      if (p.filter !== 'none') { const f = DSP.filter(ctx, p.filter, p.cutoff, p.reso); if (p.sweep !== 0) DSP.sweep(f.frequency, t0, p.cutoff, t0 + L, DSP.clamp(p.cutoff * Math.pow(2, p.sweep), 20, 18000)); s.connect(f); node = f; }
      if (p.drive > 0) { const sh = DSP.shaper(ctx, p.drive, 'soft'); node.connect(sh); node = sh; }
      const g = DSP.gain(ctx, 0);
      if (p.loop) { g.gain.setValueAtTime(1, t0); g.gain.setValueAtTime(1, t0 + L); } else DSP.env(g.gain, t0, { a: 0.01, d: 0.01, s: 1, hold: L - 0.05, r: 0.03, peak: 1, curve: 'lin' });
      node.connect(g); g.connect(out);
    },
  });
})();
