/* Render engine: pad definition -> AudioBuffer (offline), post-FX, playback, WAV encode. */
window.Foley = window.Foley || {};
(function () {
  const DSP = Foley.DSP;
  const SR = 48000;

  const Engine = Foley.Engine = {
    ctx: null, master: null, analyser: null, masterVolume: 0.8,
    cache: new Map(), // key -> Promise<AudioBuffer>

    ensure() {
      // iOS mutes Web Audio while the ringer switch is on silent unless the page declares itself a playback app
      // (Audio Session API, Safari 16.4+). Elsewhere the property doesn't exist and this is a no-op.
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') { try { navigator.audioSession.type = 'playback'; } catch (e) { } }
      if (!Engine.ctx) {
        Engine.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        Engine.master = Engine.ctx.createGain(); Engine.master.gain.value = Engine.masterVolume;
        Engine.analyser = Engine.ctx.createAnalyser(); Engine.analyser.fftSize = 1024;
        Engine.limiter = Engine.ctx.createDynamicsCompressor();
        Engine.limiter.threshold.value = -3; Engine.limiter.knee.value = 2; Engine.limiter.ratio.value = 12; Engine.limiter.attack.value = 0.002; Engine.limiter.release.value = 0.1;
        Engine.master.connect(Engine.limiter); Engine.limiter.connect(Engine.analyser); Engine.analyser.connect(Engine.ctx.destination);
      }
      if (Engine.ctx.state === 'suspended') Engine.ctx.resume();
      return Engine.ctx;
    },
    setMasterVolume(v) { Engine.masterVolume = v; if (Engine.master) Engine.master.gain.setTargetAtTime(v, Engine.ctx.currentTime, 0.02); },

    /* ---- Default FX block ------------------------------------------------ */
    defaultFx() {
      return {
        pitch: 0, hp: 20, lp: 20000, drive: 0, driveType: 'soft', bits: 16, downsample: 1,
        body: 'none', bodyAmount: 0.6, bodySize: 1, bodyDamp: 0.3,         // modal resonator ("Body")
        space: 0, spaceSize: 0.3,                                           // early reflections (a "somewhere" for dry hits)
        distance: 0,                                                        // macro: air absorption + level + reflections + width
        transAttack: 0, transSustain: 0,                                    // transient shaper
        rattle: 0, rattleHz: 2200, rattleThreshold: 0.35,                   // loose parts that chatter when the sound gets loud
        reverb: 0, reverbType: 'hall', reverbSize: 0.5, reverbDamp: 0.5, delay: 0, delayTime: 0.18, delayFeedback: 0.35,
        reverse: false, normalize: true, normMode: 'loudness', loudTarget: -18, fadeOut: 0.005, gain: 0,
        loopFade: 0,                                                        // ms of tail→head crossfade (0 = off)
      };
    },
    /* Intensity macro: pad.intensity 0..1 (0.5 = as designed) nudges force-like params of every layer toward min/max. */
    INTENSITY_PARAMS: ['force', 'weight', 'pressure', 'power', 'intensity', 'strength', 'density', 'debris', 'grit', 'crackle', 'hardness', 'rough', 'buildup', 'wetness'],
    applyIntensity(genId, params, intensity) {
      if (intensity === undefined || intensity === null || Math.abs(intensity - 0.5) < 1e-6) return params;
      const g = Foley.generators[genId]; if (!g) return params; const x = (intensity - 0.5) * 2; const out = Object.assign({}, params);
      g.params.forEach(pr => { if (pr.type !== 'range' || !Engine.INTENSITY_PARAMS.includes(pr.id)) return; const v = out[pr.id]; out[pr.id] = x > 0 ? DSP.lerp(v, pr.max, x * 0.7) : DSP.lerp(v, pr.min, -x * 0.7); });
      return out;
    },
    /* Early reflections: a handful of short taps (2–40 ms), decaying and darkening, to place a dry hit in a space. */
    earlyReflections(ctx, input, out, amount, size) {
      const taps = [[0.13, 0.75, -0.6], [0.29, 0.6, 0.5], [0.47, 0.5, -0.3], [0.68, 0.4, 0.7], [0.86, 0.32, -0.8], [1.0, 0.26, 0.2]];
      const maxT = 0.004 + size * 0.036; const sum = DSP.gain(ctx, amount * 0.9); sum.connect(out);
      taps.forEach(([u, g, pan]) => { const d = ctx.createDelay(0.1); d.delayTime.value = 0.0015 + u * maxT; const lp = DSP.filter(ctx, 'lowpass', 9000 - u * 5000, 0.5); DSP.chain(input, d, lp, DSP.gain(ctx, g), DSP.pan(ctx, pan * 0.5), sum); });
    },

    /* ---- Modal resonator bodies ("Body" FX block) ----------------------------
       Each body = list of modes [freqHz, decaySeconds, gain]. A mode is one high-Q bandpass
       (a 2-pole resonator: decay τ ≈ Q / (π f)). Frequencies are for a medium-sized object;
       bodySize scales them, bodyDamp shortens the decays. */
    BODIES: {
      none: null,
      'wood-plank':   [[220, 0.25, 1], [410, 0.18, 0.7], [690, 0.12, 0.5], [1150, 0.09, 0.35], [1800, 0.06, 0.25], [2700, 0.04, 0.15]],
      'hollow-metal': [[310, 1.2, 1], [720, 1.0, 0.8], [1180, 0.9, 0.7], [1660, 0.7, 0.5], [2400, 0.6, 0.45], [3300, 0.5, 0.35], [4700, 0.35, 0.25]],
      'ceramic':      [[1450, 0.5, 1], [2300, 0.4, 0.7], [3600, 0.35, 0.5], [5200, 0.25, 0.35], [7100, 0.2, 0.2]],
      'stone-slab':   [[95, 0.35, 1], [180, 0.3, 0.8], [320, 0.22, 0.6], [560, 0.15, 0.4], [1100, 0.08, 0.25], [2200, 0.05, 0.15]],
      'plastic-shell':[[380, 0.09, 1], [820, 0.07, 0.6], [1500, 0.05, 0.4], [2600, 0.04, 0.3]],
      'glass':        [[1900, 0.7, 1], [3050, 0.6, 0.7], [4400, 0.5, 0.5], [6100, 0.4, 0.35], [8200, 0.3, 0.25]],
      'cardboard-box':[[140, 0.08, 1], [260, 0.06, 0.6], [520, 0.04, 0.3]],
      'drum':         [[80, 0.5, 1], [128, 0.4, 0.6], [171, 0.35, 0.4], [214, 0.3, 0.3]],
      'bell':         [[260, 3, 0.7], [520, 2.5, 1], [624, 2, 0.5], [780, 1.8, 0.5], [1040, 1.4, 0.4], [1560, 1, 0.3]],
      'pipe':         [[150, 0.6, 1], [300, 0.5, 0.7], [450, 0.45, 0.5], [600, 0.4, 0.4], [750, 0.3, 0.3], [900, 0.25, 0.25]],
      'bottle':       [[180, 0.4, 1], [1800, 0.1, 0.2]],
      'cartoon-boing':[[140, 0.6, 1], [287, 0.5, 0.6], [441, 0.4, 0.4], [598, 0.3, 0.25]],
    },
    bodyModes(fx) {
      const m = Engine.BODIES[fx.body]; if (!m) return null;
      const size = DSP.clamp(fx.bodySize || 1, 0.25, 4), damp = DSP.clamp(fx.bodyDamp || 0, 0, 1);
      return m.map(([f, dec, g]) => ({ f: DSP.clamp(f / size, 20, 18000), decay: dec * size * (1 - damp * 0.92) + 0.005, g }));
    },
    /* Build the resonator bank on ctx. Returns { input, output }. */
    bodyBank(ctx, fx) {
      const modes = Engine.bodyModes(fx); if (!modes) return null;
      const input = DSP.gain(ctx, 1), output = DSP.gain(ctx, 1);
      modes.forEach(m => {
        const Q = DSP.clamp(m.decay * Math.PI * m.f, 2, 1500);
        const bp = DSP.filter(ctx, 'bandpass', m.f, Q);
        const makeup = Math.min(10, 0.8 + Math.sqrt(Q) * 0.35); // narrow bands pass little energy; compensate
        DSP.chain(input, bp, DSP.gain(ctx, m.g * makeup), output);
      });
      return { input, output, tail: Math.max.apply(null, modes.map(m => m.decay)) * 3 };
    },

    /* ---- Stage 1: synthesize layers ------------------------------------- */
    layerDuration(layer) {
      const g = Foley.generators[layer.gen]; if (!g) return 0.5;
      const p = Object.assign(Foley.defaultParams(layer.gen), layer.params);
      const one = (g.duration ? g.duration(p) : 1) * 1.0; const rep = Math.max(1, Math.round(layer.repeat || 1));
      return one + (layer.offset || 0) + (rep - 1) * (layer.every || 0.25) * (1 + (layer.jitter || 0) * 0.5);
    },
    /* Layers to render: solo wins over mute; a layer can repeat N times every `every` seconds with timing jitter. */
    activeLayers(pad) { const solo = pad.layers.some(l => l.solo); return pad.layers.filter(l => solo ? l.solo : !l.mute); },
    async synthesize(pad, seed) {
      const layers = Engine.activeLayers(pad);
      const dur = Math.max(0.05, ...layers.map(l => Engine.layerDuration(l) + 0.1));
      const length = Math.ceil(Math.min(dur, 20) * SR);
      const off = new OfflineAudioContext(2, length, SR);
      const bus = off.createGain(); bus.connect(off.destination);
      layers.forEach((layer, i) => {
        const g = Foley.generators[layer.gen]; if (!g) return;
        const p = Engine.applyIntensity(layer.gen, Object.assign(Foley.defaultParams(layer.gen), layer.params), pad.intensity);
        const rng = new Foley.PRNG((seed * 2654435761 + i * 97 + Foley.hashString(layer.gen)) >>> 0);
        const lg = DSP.gain(off, DSP.db(layer.gain || 0));
        let node = lg;
        if ((layer.hp || 20) > 20) node = DSP.chain(node, DSP.filter(off, 'highpass', layer.hp, 0.7));
        if ((layer.lp || 20000) < 20000) node = DSP.chain(node, DSP.filter(off, 'lowpass', layer.lp, 0.7));
        if (layer.drive > 0) node = DSP.chain(node, DSP.shaper(off, layer.drive, 'soft'), DSP.gain(off, 1 - layer.drive * 0.4));
        const pan = DSP.pan(off, layer.pan || 0);
        DSP.chain(node, pan, bus);
        const rep = Math.max(1, Math.min(64, Math.round(layer.repeat || 1))); let t = layer.offset || 0;
        for (let k = 0; k < rep; k++) {
          try { g.build(off, lg, p, k === 0 ? rng : rng.fork(), t); } catch (e) { console.error('Generator', layer.gen, 'failed', e); break; }
          t += (layer.every || 0.25) * rng.range(1 - (layer.jitter || 0) * 0.5, 1 + (layer.jitter || 0) * 0.5);
          if (t > 19.5) break;
        }
      });
      return off.startRendering();
    },

    /* Musical loop length of a pad: the layers' nominal `length` (plus offsets/repeats), not their decay tails. */
    loopLength(pad) {
      let L = 0;
      Engine.activeLayers(pad).forEach(l => { const g = Foley.generators[l.gen]; if (!g) return; const p = Object.assign(Foley.defaultParams(l.gen), l.params); const rep = Math.max(1, Math.round(l.repeat || 1)); const base = g.loopLength ? g.loopLength(p) : (typeof p.length === 'number' ? p.length : (g.duration ? g.duration(p) : 1)); L = Math.max(L, (l.offset || 0) + base + (rep - 1) * (l.every || 0.25)); });
      return L;
    },
    /* ---- Stage 2: post FX (offline) -------------------------------------- */
    async postFx(buffer, fx, loopLen) {
      fx = Object.assign(Engine.defaultFx(), fx || {});
      let src = buffer;
      if (fx.reverse) src = Engine.reverseBuffer(src);
      if (fx.bits < 16 || fx.downsample > 1) src = Engine.bitcrush(src, fx.bits, fx.downsample);
      const rate = DSP.semis(fx.pitch);
      const bodyModes = Engine.bodyModes(fx);
      const bodyTail = bodyModes && fx.bodyAmount > 0 ? Math.max.apply(null, bodyModes.map(m => m.decay)) * 3 : 0;
      const tail = (fx.reverb > 0 ? 0.3 + fx.reverbSize * 3 : 0) + (fx.delay > 0 ? fx.delayTime * 6 : 0) + bodyTail + (fx.space > 0 ? 0.06 : 0) + 0.05;
      const len = Math.ceil((src.duration / rate + tail) * SR);
      const off = new OfflineAudioContext(2, Math.min(len, SR * 30), SR);
      const s = off.createBufferSource(); s.buffer = src; s.playbackRate.value = rate;
      const hp = DSP.filter(off, 'highpass', fx.hp, 0.7);
      const lp = DSP.filter(off, 'lowpass', fx.lp, 0.7);
      let node = DSP.chain(s, hp, lp);
      if (fx.drive > 0) node = DSP.chain(node, DSP.shaper(off, fx.drive, fx.driveType), DSP.gain(off, 1 - fx.drive * 0.4));
      if (bodyModes && fx.bodyAmount > 0) { // "Body": equal-power dry/wet mix through the modal resonator bank
        const bank = Engine.bodyBank(off, fx); const a = DSP.clamp(fx.bodyAmount, 0, 1) * Math.PI / 2;
        const mix = DSP.gain(off, 1);
        DSP.chain(node, DSP.gain(off, Math.cos(a)), mix);
        DSP.chain(node, bank.input); DSP.chain(bank.output, DSP.gain(off, Math.sin(a)), mix);
        node = mix;
      }
      // Distance macro: air absorption, level, more early reflections, narrower image (width applied after render)
      const dist = DSP.clamp(fx.distance || 0, 0, 1);
      if (dist > 0) node = DSP.chain(node, DSP.filter(off, 'lowpass', 18000 * Math.pow(0.07, dist), 0.5), DSP.gain(off, DSP.db(-22 * dist)));
      const out = DSP.gain(off, DSP.db(fx.gain)); out.connect(off.destination);
      node.connect(out);
      const spaceAmt = Math.max(fx.space || 0, dist * 0.45);
      if (spaceAmt > 0) Engine.earlyReflections(off, node, out, spaceAmt, Math.max(fx.spaceSize || 0, dist * 0.8));
      if (fx.reverb > 0) {
        const conv = off.createConvolver(); conv.buffer = Engine.impulse(off, fx.reverbSize, fx.reverbDamp, fx.reverbType);
        DSP.chain(node, conv, DSP.gain(off, fx.reverb), out);
      }
      if (fx.delay > 0) {
        const d = off.createDelay(2); d.delayTime.value = fx.delayTime;
        const fb = DSP.gain(off, DSP.clamp(fx.delayFeedback, 0, 0.95));
        const damp = DSP.filter(off, 'lowpass', 4000);
        node.connect(d); DSP.chain(d, damp, fb, d); DSP.chain(d, DSP.gain(off, fx.delay), out);
      }
      s.start(0);
      let rendered = await off.startRendering();
      if (fx.rattle > 0) Engine.rattle(rendered, fx.rattle, fx.rattleHz || 2200, fx.rattleThreshold === undefined ? 0.35 : fx.rattleThreshold, new Foley.PRNG(0xA77 + Math.round((fx.rattleHz || 2200))));
      if (fx.transAttack || fx.transSustain) Engine.transientShape(rendered, fx.transAttack || 0, fx.transSustain || 0);
      if (dist > 0) Engine.narrow(rendered, dist * 0.7);
      if (fx.loopFade > 0 && loopLen > 0) {
        // Loop pads: cut at the musical loop length (decay tails of bodies/reverb/space are folded into the head by the
        // crossfade instead of being left as a silent-ish tail), then find the best seam and crossfade.
        const cut = Math.min(rendered.length, Math.round(loopLen / rate * SR)); if (cut > SR * 0.1) rendered = Engine.cutBuffer(rendered, cut);
        rendered = Engine.crossfadeLoop(rendered, fx.loopFade);
      } else {
        rendered = Engine.trim(rendered, fx.loopFade > 0 ? 0 : fx.fadeOut);
        if (fx.loopFade > 0) rendered = Engine.crossfadeLoop(rendered, fx.loopFade);
      }
      if (fx.normalize) { if ((fx.normMode || 'peak') === 'loudness') Engine.normalizeLoudness(rendered, fx.loudTarget === undefined ? -18 : fx.loudTarget, 0.95); else Engine.normalize(rendered, 0.95); }
      return rendered;
    },
    /* ---- Loudness (K-weighted RMS, gated — an LUFS-style measure) ---------------------------------- */
    loudness(b) {
      const sr = b.sampleRate, ch = b.numberOfChannels;
      // K-weighting: 2nd-order highpass ~60 Hz + high shelf +4 dB above ~1.5 kHz (coefficients for 48 kHz, close enough at 44.1)
      const hpB = [1.0, -2.0, 1.0], hpA = [1.0, -1.99004745483398, 0.99007225036621];
      const shB = [1.53512485958697, -2.69169618940638, 1.19839281085285], shA = [1.0, -1.69065929318241, 0.73248077421585];
      const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr); const powers = [];
      const filt = new Array(ch).fill(0).map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0, u1: 0, u2: 0, v1: 0, v2: 0 }));
      const n = b.length; const acc = new Float64Array(n);
      for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); const s = filt[c]; for (let i = 0; i < n; i++) { const x = d[i]; const u = shB[0] * x + shB[1] * s.x1 + shB[2] * s.x2 - shA[1] * s.u1 - shA[2] * s.u2; s.x2 = s.x1; s.x1 = x; s.u2 = s.u1; s.u1 = u; const y = hpB[0] * u + hpB[1] * s.v1 + hpB[2] * s.v2 - hpA[1] * s.y1 - hpA[2] * s.y2; s.v2 = s.v1; s.v1 = u; s.y2 = s.y1; s.y1 = y; acc[i] += y * y; } }
      if (n < blk) { let s = 0; for (let i = 0; i < n; i++) s += acc[i]; return { lufs: -0.691 + 10 * Math.log10(Math.max(1e-12, s / Math.max(1, n) / ch)), blocks: 1 }; }
      for (let start = 0; start + blk <= n; start += hop) { let s = 0; for (let i = start; i < start + blk; i++) s += acc[i]; powers.push(s / blk / ch); }
      const abs = powers.filter(p => -0.691 + 10 * Math.log10(p + 1e-12) > -70); if (!abs.length) return { lufs: -70, blocks: 0 };
      const mean1 = abs.reduce((a, p) => a + p, 0) / abs.length; const relGate = mean1 * Math.pow(10, -1); // -10 LU
      const rel = abs.filter(p => p > relGate); const mean2 = rel.reduce((a, p) => a + p, 0) / rel.length;
      return { lufs: -0.691 + 10 * Math.log10(mean2 + 1e-12), blocks: rel.length };
    },
    /* Gain to a target loudness; peaks above the ceiling get a soft knee (not a brickwall) so transients keep their shape. */
    normalizeLoudness(b, targetDb, ceiling) {
      const L = Engine.loudness(b).lufs; let g = Math.pow(10, (targetDb - L) / 20); if (!isFinite(g)) return;
      let peak = 0; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
      if (peak < 1e-6) return;
      const maxG = ceiling / peak * 2.2; if (g > maxG) g = maxG;               // allow up to ~7 dB into the knee, no more
      const th = ceiling * 0.7;
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { let v = d[i] * g; const a = Math.abs(v); if (a > th) v = Math.sign(v) * (th + (ceiling - th) * Math.tanh((a - th) / (ceiling - th))); d[i] = v; } }
    },
    /* Rattle: nonlinear "loose parts" — when the envelope exceeds a threshold, a chattering contact fires (short pings whose
       rate and level follow the excess). Gives crates, lids, vehicle panels and cheap doors their buzz. Rendered in place. */
    rattle(b, amount, hz, threshold, rng) {
      const sr = b.sampleRate; const ch = b.numberOfChannels; const n = b.length; const rel = Math.exp(-1 / (0.012 * sr)); let env = 0;
      const add = new Float32Array(n); let next = 0; let peak = 0; for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i])); } if (peak < 1e-6) return;
      const d0 = b.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const x = Math.abs(d0[i]) / peak; env = x > env ? x : env * rel;
        const ex = env - threshold; if (ex <= 0 || i < next) continue;
        const rate = 60 + ex * 900; next = i + Math.round(sr / rate * rng.range(0.5, 1.5));
        const f = hz * rng.range(0.7, 1.4); const len = Math.round(sr * rng.range(0.0015, 0.005)); const a = amount * ex * 1.8 * rng.range(0.4, 1); const ph = rng.next() * 6.28;
        for (let q = 0; q < len && i + q < n; q++) add[i + q] += a * Math.exp(-q / (len * 0.35)) * (Math.sin(ph + 2 * Math.PI * f * q / sr) + 0.5 * Math.sin(2 * Math.PI * f * 1.63 * q / sr));
      }
      for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] += add[i] * peak; }
    },
    /* Transient shaper: attack ±1 (accent/soften onsets), sustain ±1 (bloom/tighten tails). */
    transientShape(b, attack, sustain) {
      const sr = b.sampleRate; const aF = Math.exp(-1 / (0.0005 * sr)), rF = Math.exp(-1 / (0.02 * sr)), aS = Math.exp(-1 / (0.02 * sr)), rS = Math.exp(-1 / (0.2 * sr));
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); let fast = 0, slow = 0; for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); fast = x > fast ? aF * fast + (1 - aF) * x : rF * fast + (1 - rF) * x; slow = x > slow ? aS * slow + (1 - aS) * x : rS * slow + (1 - rS) * x; const tr = DSP.clamp((fast - slow) / (slow + 1e-4), 0, 3) / 3; const su = 1 - tr; const gn = DSP.clamp(1 + attack * tr * 2 + sustain * su * 1.2, 0.05, 4); d[i] *= gn; } }
    },
    /* Narrow the stereo image toward mono by amount 0..1 (mid/side). */
    narrow(b, amt) { if (b.numberOfChannels < 2 || amt <= 0) return; const l = b.getChannelData(0), r = b.getChannelData(1); const k = 1 - amt; for (let i = 0; i < l.length; i++) { const m = (l[i] + r[i]) * 0.5, s = (l[i] - r[i]) * 0.5 * k; l[i] = m + s; r[i] = m - s; } },
    /* Loop crossfade: overlap the last `ms` onto the first `ms` with an equal-power curve and drop the tail,
       so sample N-1 flows into sample 0. Pure post-process; generators and FX never know about it. */
    crossfadeLoop(b, ms) {
      const F = Math.min(Math.floor(ms / 1000 * b.sampleRate), Math.floor(b.length / 2));
      if (F < 2) return b;
      // Smart seam: a plain crossfade beats/dips when the signal is periodic (engines, rolls, hums) because tail and head
      // are not phase-aligned. Search the last ~40 ms of candidate end points for the one whose preceding F samples
      // correlate best with the head, and wrap there instead.
      let N = b.length; {
        const d = b.getChannelData(0); const W = Math.min(Math.floor(0.04 * b.sampleRate), Math.floor((N - F) / 2)); const step = 4; let best = N, bestC = -Infinity;
        const h0 = 0; for (let e = N; e >= N - W; e -= step) { let c = 0, ea = 0, eb = 0; const s0 = e - F; for (let i = 0; i < F; i += 2) { const a = d[h0 + i], v = d[s0 + i]; c += a * v; ea += a * a; eb += v * v; } const nc = c / Math.sqrt(Math.max(1e-12, ea * eb)); if (nc > bestC) { bestC = nc; best = e; } }
        for (let e = Math.min(N, best + step - 1); e >= Math.max(N - W, best - step + 1); e--) { let c = 0, ea = 0, eb = 0; const s0 = e - F; for (let i = 0; i < F; i += 2) { const a = d[i], v = d[s0 + i]; c += a * v; ea += a * a; eb += v * v; } const nc = c / Math.sqrt(Math.max(1e-12, ea * eb)); if (nc > bestC) { bestC = nc; best = e; } }
        N = best;
      }
      const outLen = N - F;
      const out = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: outLen, sampleRate: b.sampleRate });
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c), o = out.getChannelData(c);
        for (let i = 0; i < F; i++) { const th = (i / F) * Math.PI / 2; o[i] = d[i] * Math.sin(th) + d[outLen + i] * Math.cos(th); }
        for (let i = F; i < outLen; i++) o[i] = d[i];
      }
      return out;
    },
    /* Generated impulse responses. type: hall (default) | small-room | stairwell | cave | outdoor | plate */
    REVERB_TYPES: ['hall', 'small-room', 'stairwell', 'cave', 'outdoor', 'plate'],
    impulse(ctx, size, damp, type) {
      type = type || 'hall'; const sr = ctx.sampleRate;
      const T = { hall: { t: 0.2 + size * 3, early: 0.03, dens: 1, dark: 0, mod: 0 }, 'small-room': { t: 0.08 + size * 0.5, early: 0.012, dens: 1.2, dark: 0.2, mod: 0 }, stairwell: { t: 0.3 + size * 1.5, early: 0.06, dens: 0.6, dark: 0.1, flutter: 0.045 + size * 0.03 }, cave: { t: 0.5 + size * 4, early: 0.09, dens: 0.5, dark: 0.55, mod: 1 }, outdoor: { t: 0.05 + size * 0.25, early: 0.04, dens: 0.3, dark: 0.3, slap: true }, plate: { t: 0.3 + size * 2, early: 0.005, dens: 1.5, dark: -0.3, mod: 0.5 } }[type] || { t: 0.2 + size * 3, early: 0.03, dens: 1, dark: 0, mod: 0 };
      const n = Math.ceil(T.t * sr); const buf = ctx.createBuffer(2, n, sr); const rng = new Foley.PRNG(1234 + type.length);
      const dampK = DSP.clamp(0.1 + damp * 0.85 + T.dark * 0.3, 0.02, 0.97);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c); let lp = 0; const earlyN = Math.round(T.early * sr);
        const taps = []; for (let k = 0; k < Math.round(6 * T.dens); k++) taps.push([Math.round(rng.range(0.003, T.early) * sr), rng.range(0.3, 1) * (rng.next() < 0.5 ? -1 : 1)]);
        for (let i = 0; i < n; i++) {
          const u = i / n; const env = Math.pow(1 - u, 2 + damp * 3) * (i < earlyN ? 0.35 : 1);
          let w = (rng.next() * 2 - 1) * (rng.next() < T.dens * 0.6 + 0.2 ? 1 : 0.3); lp += (w - lp) * (1 - dampK);
          let v = lp * env * 0.8;
          if (T.mod) v *= 1 + 0.25 * T.mod * Math.sin(i / sr * 2 * Math.PI * (0.7 + c * 0.3));
          if (T.flutter && i % Math.round(T.flutter * sr) < 40) v += w * env * 0.6;                       // periodic slap echoes
          if (T.slap && i < earlyN) v = w * Math.pow(1 - i / earlyN, 3) * 0.6;                            // outdoor: mostly a slap
          d[i] = v;
        }
        taps.forEach(([ti, g]) => { if (ti < n) d[ti] += g * 0.5; });
      }
      return buf;
    },
    cutBuffer(b, len) { const out = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: len, sampleRate: b.sampleRate }); for (let c = 0; c < b.numberOfChannels; c++) out.getChannelData(c).set(b.getChannelData(c).subarray(0, len)); return out; },
    reverseBuffer(b) {
      const out = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: b.length, sampleRate: b.sampleRate });
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); const o = out.getChannelData(c); for (let i = 0; i < b.length; i++) o[i] = d[b.length - 1 - i]; }
      return out;
    },
    bitcrush(b, bits, down) {
      const out = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: b.length, sampleRate: b.sampleRate });
      const steps = Math.pow(2, bits) / 2;
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c); const o = out.getChannelData(c); let hold = 0;
        for (let i = 0; i < b.length; i++) {
          if (i % down === 0) hold = Math.round(d[i] * steps) / steps;
          o[i] = hold;
        }
      }
      return out;
    },
    trim(b, fade) {
      const thr = 0.0005; let end = 0;
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = b.length - 1; i > end; i--) if (Math.abs(d[i]) > thr) { end = i; break; } }
      end = Math.min(b.length, end + Math.ceil(0.01 * b.sampleRate) + 1);
      const out = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: Math.max(1, end), sampleRate: b.sampleRate });
      const f = Math.ceil((fade || 0.005) * b.sampleRate);
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c); const o = out.getChannelData(c);
        for (let i = 0; i < end; i++) { const k = end - i; o[i] = d[i] * (k < f ? k / f : 1); }
      }
      return out;
    },
    normalize(b, peakTarget) {
      let peak = 0;
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
      if (peak < 1e-6) return;
      const g = peakTarget / peak;
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
    },

    /* ---- Full render with cache ----------------------------------------- */
    padKey(pad, seed) { return JSON.stringify({ l: pad.layers, f: pad.fx, s: seed, i: pad.intensity === undefined ? 0.5 : pad.intensity }); },
    render(pad, seed) {
      const key = Engine.padKey(pad, seed);
      if (Engine.cache.has(key)) return Engine.cache.get(key);
      const p = Engine.synthesize(pad, seed).then(b => Engine.postFx(b, pad.fx, Engine.loopLength(pad)));
      Engine.cache.set(key, p);
      if (Engine.cache.size > 400) { const first = Engine.cache.keys().next().value; Engine.cache.delete(first); }
      p.catch(() => Engine.cache.delete(key));
      return p;
    },
    seedsFor(pad) {
      const n = Math.max(1, pad.variations || 1); const out = [];
      for (let i = 0; i < n; i++) out.push(((pad.seed || 1) + i * 7919) >>> 0);
      return out;
    },
    async renderAll(pad) { return Promise.all(Engine.seedsFor(pad).map(s => Engine.render(pad, s))); },

    /* ---- Playback ---------------------------------------------------------- */
    voices: new Set(),
    loops: new Map(),          // padId -> looping source
    onLoopChange: null,        // UI hook (padId)
    play(buffer, opts) {
      opts = opts || {};
      const ctx = Engine.ensure();
      const s = ctx.createBufferSource(); s.buffer = buffer;
      s.playbackRate.value = DSP.semis(opts.pitch || 0);
      if (opts.loop) s.loop = true;
      const g = DSP.gain(ctx, DSP.db(opts.gain || 0));
      const p = DSP.pan(ctx, opts.pan || 0);
      DSP.chain(s, g, p, Engine.master);
      s._gain = g;
      s.start(ctx.currentTime + (opts.delay || 0));
      Engine.voices.add(s); s.onended = () => Engine.voices.delete(s);
      return s;
    },
    /* Fade a voice out over `ms` then stop it (click-free stop for loops). */
    fadeStop(src, ms) {
      const ctx = Engine.ctx; if (!ctx || !src) return;
      const t = ctx.currentTime; const g = src._gain;
      try { if (g) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + (ms || 40) / 1000); } src.stop(t + (ms || 40) / 1000 + 0.005); } catch (e) { }
    },
    isLooping(padId) { return Engine.loops.has(padId); },
    startLoop(pad, buffer, opts) {
      Engine.stopLoop(pad.id, true);
      const src = Engine.play(buffer, Object.assign({}, opts || {}, { loop: true }));
      Engine.loops.set(pad.id, src);
      src.onended = () => { Engine.voices.delete(src); if (Engine.loops.get(pad.id) === src) { Engine.loops.delete(pad.id); if (Engine.onLoopChange) Engine.onLoopChange(pad.id); } };
      if (Engine.onLoopChange) Engine.onLoopChange(pad.id);
      return src;
    },
    stopLoop(padId, silent) {
      const src = Engine.loops.get(padId); if (!src) return false;
      Engine.loops.delete(padId); Engine.fadeStop(src, 60);
      if (!silent && Engine.onLoopChange) Engine.onLoopChange(padId);
      return true;
    },
    stopAllLoops() { [...Engine.loops.keys()].forEach(id => Engine.stopLoop(id)); },
    stopAll() { Engine.stopAllLoops(); Engine.voices.forEach(v => { try { v.stop(); } catch (e) { } }); Engine.voices.clear(); },
    /* Trigger a pad: pick a variation, apply humanize jitter. Looping pads toggle on/off. */
    async trigger(pad, rng) {
      rng = rng || new Foley.PRNG((Date.now() ^ (Math.random() * 1e9)) >>> 0);
      if (pad.loop && Engine.isLooping(pad.id)) { Engine.stopLoop(pad.id); return null; }
      const seeds = Engine.seedsFor(pad);
      const seed = pad.roundRobin ? seeds[(pad._rr = ((pad._rr || 0) + 1) % seeds.length)] : rng.pick(seeds);
      const buf = await Engine.render(pad, seed);
      const h = pad.humanize || {};
      const opts = {
        pitch: rng.range(-1, 1) * (h.pitch || 0),
        gain: -rng.next() * (h.gain || 0),
        pan: (pad.pan || 0) + rng.range(-1, 1) * (h.pan || 0),
      };
      return pad.loop ? Engine.startLoop(pad, buf, opts) : Engine.play(buf, opts);
    },

    /* ---- WAV encoding -------------------------------------------------------- */
    encodeWav(buffer, bitDepth) {
      bitDepth = bitDepth || 16;
      const ch = buffer.numberOfChannels, n = buffer.length, sr = buffer.sampleRate;
      const bytesPer = bitDepth / 8, dataLen = n * ch * bytesPer;
      const ab = new ArrayBuffer(44 + dataLen); const v = new DataView(ab);
      const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE'); w(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, bitDepth === 32 ? 3 : 1, true); v.setUint16(22, ch, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bytesPer, true); v.setUint16(32, ch * bytesPer, true); v.setUint16(34, bitDepth, true);
      w(36, 'data'); v.setUint32(40, dataLen, true);
      const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
      let o = 44;
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
        const x = Math.max(-1, Math.min(1, chans[c][i]));
        if (bitDepth === 16) { v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true); o += 2; }
        else if (bitDepth === 24) { const s = Math.round(x < 0 ? x * 8388608 : x * 8388607); v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3; }
        else { v.setFloat32(o, x, true); o += 4; }
      }
      return new Blob([ab], { type: 'audio/wav' });
    },
    download(blob, name) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
  };
})();
