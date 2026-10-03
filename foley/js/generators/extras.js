/* Game-foley extras: bones, undead voices, breaking wood, coins & loot, armor movement, eating & drinking, war horns.
   All built on the physical helpers in core/materials.js and the vocal-tract model in generators/body.js. */
(function () {
  const DSP = Foley.DSP, P = Foley.P, R = Foley.registerGenerator;
  const M = Foley.Materials;

  /* ================= BONES ================= */
  R({
    id: 'bones', name: 'Bones', category: 'Impacts', icon: '🦴',
    params: [
      P.sel('type', 'Type', ['rattle', 'clatter', 'clack', 'jaw-chatter', 'skeleton-walk', 'wind-chime'], 'rattle'),
      P.r('size', 'Bone size', 0, 1, 0.5), P.r('length', 'Length', 0.2, 6, 1.3, 's'), P.r('count', 'Count / density', 0, 1, 0.5),
      P.r('dry', 'Dryness', 0, 1, 0.7), P.r('tempo', 'Walk tempo', 60, 180, 100, 'BPM'),
    ],
    duration(p) { return p.type === 'clack' ? 0.8 : p.type === 'skeleton-walk' ? p.length + 0.8 : p.length + 0.6; },
    build(ctx, out, p, rng, t0) {
      const L = p.length, sz = 0.6 + p.size * 1.2;
      const shared = M.banks(ctx, out, rng, 'bone', 'bone', sz, 4);
      const damp = (1 - p.dry) * 0.4;
      const clack = (t, amp, szMul, opts) => M.strike(ctx, out, rng, t, M.BONE.bone, Object.assign({
        size: sz * (szMul || 1) * rng.range(0.85, 1.2), force: 0.35 + amp * 0.55, hardness: 0.8, amp, shared, double: 0.25, damp,
      }, opts || {}));
      if (p.type === 'clack') { clack(t0, 0.9, 1, { double: 0.5 }); return; }
      if (p.type === 'rattle') { // a fistful of bones shaken: dense chattering clusters
        const rate = 8 + p.count * 26; let t = t0;
        while (t < t0 + L) {
          const u = (t - t0) / L; const env = 1 - u * 0.35;
          const n = 1 + Math.floor(rng.next() * 2.4);
          for (let i = 0; i < n; i++) clack(t + rng.next() * 0.02, rng.range(0.25, 0.65) * env, rng.range(0.7, 1.2), { double: 0.15 });
          t += (1 / rate) * rng.range(0.35, 1.7);
        }
        return;
      }
      if (p.type === 'clatter') { // a skeleton (or a bag of bones) hitting the floor: front-loaded cascade, then settle
        clack(t0, 1, 1.5, { force: 0.9, double: 0.4 }); clack(t0 + rng.range(0.02, 0.05), 0.8, 1.3, { force: 0.8 });
        const n = Math.round(6 + p.count * 26);
        for (let i = 0; i < n; i++) {
          const u = Math.pow(rng.next(), 0.55); const t = t0 + 0.03 + u * L * 0.85;
          clack(t, rng.range(0.2, 0.7) * (1 - u * 0.6), rng.range(0.6, 1.3), { double: 0.35 });
        }
        for (let i = 0; i < 3; i++) clack(t0 + L * rng.range(0.85, 1), rng.range(0.1, 0.25), rng.range(0.6, 1), { double: 0.6 }); // last pieces rocking to rest
        return;
      }
      if (p.type === 'jaw-chatter') { // teeth: fast periodic pairs of tiny hard clacks
        const rate = 9 + p.count * 9; let t = t0;
        while (t < t0 + L) {
          const u = (t - t0) / L; const env = Math.min(1, u * 12) * Math.min(1, (1 - u) * 6);
          clack(t, 0.55 * env, 0.5, { hardness: 0.92, double: 0 });
          clack(t + rng.range(0.01, 0.018), 0.35 * env, 0.45, { hardness: 0.92, double: 0 });
          t += (1 / rate) * rng.range(0.85, 1.15);
        }
        return;
      }
      if (p.type === 'skeleton-walk') { // footfall clusters + a dry drag scrape between steps
        const gap = 60 / p.tempo; const steps = Math.max(2, Math.round(L / gap));
        for (let s = 0; s < steps; s++) {
          const t = t0 + s * gap * rng.range(0.97, 1.03);
          const n = 2 + Math.floor(rng.next() * 3);
          for (let i = 0; i < n; i++) clack(t + rng.next() * 0.07, rng.range(0.3, 0.8) * (i === 0 ? 1 : 0.6), rng.range(0.7, 1.25), {});
          if (rng.next() < 0.7) { // bone dragging over the ground
            const dl = gap * rng.range(0.3, 0.55); const td = t + gap * 0.35;
            const buf = M.frictionBuffer(ctx, rng, dl, { rateFn: u => 70 + 60 * Math.sin(u * Math.PI), ampFn: u => Math.sin(Math.min(1, u) * Math.PI), jitter: 0.4, widthMs: 1.3, noise: 0.35, noiseColor: 0.18, grit: 60, gritAmp: 0.4, gritHz: 2600, gritSize: sz });
            const src = ctx.createBufferSource(); src.buffer = buf; src.start(td); src.stop(td + dl + 0.05);
            DSP.chain(src, DSP.filter(ctx, 'bandpass', 1300, 0.8), DSP.gain(ctx, 0.5), shared[Math.floor(rng.next() * shared.length)].input);
          }
        }
        return;
      }
      // wind-chime: hanging bones knocking gently in the wind — sparse, soft, ringing
      let t = t0 + rng.next() * 0.1;
      while (t < t0 + L) {
        clack(t, rng.range(0.15, 0.4), rng.range(0.7, 1.4), { hardness: 0.55, force: 0.3, double: 0.4, damp: 0 });
        if (rng.next() < 0.4) clack(t + rng.range(0.03, 0.09), rng.range(0.1, 0.25), rng.range(0.7, 1.3), { hardness: 0.5, force: 0.25, damp: 0 });
        t += rng.range(0.13, 0.6) * (1.6 - p.count);
      }
    },
  });

  /* ================= GHOUL / UNDEAD VOICE ================= */
  R({
    id: 'ghoul', name: 'Ghoul Voice', category: 'Bodily', icon: '🧟',
    params: [
      P.sel('type', 'Type', ['moan', 'groan', 'wail', 'hiss', 'death-rattle', 'zombie'], 'moan'),
      P.r('length', 'Length', 0.4, 6, 2, 's'), P.r('pitch', 'Pitch', 0.4, 2, 1), P.r('size', 'Throat size', 0.6, 2.2, 1.5),
      P.r('rasp', 'Rasp', 0, 1, 0.6), P.r('crack', 'Crack / fry', 0, 1, 0.6), P.r('breath', 'Breath', 0, 1, 0.5),
    ],
    duration(p) { return p.length + 0.9; },
    build(ctx, out, p, rng, t0) {
      const V = Foley.Voice, L = p.length, k = p.pitch, size = p.size;
      const rough = 0.3 + p.rasp * 0.55, fry = p.crack * 0.85, breath = p.breath * 0.5;
      const wob = a => rng.range(1 - a, 1 + a);
      if (p.type === 'moan') { // long hollow "ooooh" that sags and cracks
        const f0 = 84 * k;
        V.syllable(ctx, out, rng, t0, L, {
          f0: [[0, f0 * 0.92 * wob(0.05)], [0.25, f0 * 1.1 * wob(0.06)], [0.5, f0 * 0.94 * wob(0.05)], [0.75, f0 * 1.02 * wob(0.05)], [1, f0 * 0.68]],
          vowel: 'u', vowel2: 'uh', morphAt: 0.45, amp: 0.85, attack: L * 0.22, decayFrac: 0.9, sustain: 0.8, release: L * 0.3,
          rough, fry, breath, size, nasal: 0.25,
        });
        return;
      }
      if (p.type === 'groan') { // shorter, effortful: rises under strain, collapses
        const f0 = 92 * k;
        V.syllable(ctx, out, rng, t0, L, {
          f0: [[0, f0 * 0.82], [0.22, f0 * 1.3 * wob(0.06)], [0.55, f0 * 1.12 * wob(0.05)], [1, f0 * 0.58]],
          vowel: 'uh', vowel2: 'o', morphAt: 0.5, amp: 0.9, attack: L * 0.12, decayFrac: 0.85, sustain: 0.75, release: L * 0.25,
          rough: rough + 0.1, fry, breath, size, nasal: 0.2,
        });
        V.breathBurst(ctx, out, rng, t0 + L * 0.88, L * 0.35, { vowel: 'uh', vowel2: 'u', amp: 0.15 + p.breath * 0.3, attack: 0.04, color: 'pink', size, curve: 'lin' }); // dying exhale
        return;
      }
      if (p.type === 'wail') { // high keening cry
        const f0 = 205 * k;
        V.syllable(ctx, out, rng, t0, L, {
          f0: [[0, f0 * 0.78], [0.18, f0 * 1.06 * wob(0.04)], [0.45, f0 * 0.98 * wob(0.05)], [0.7, f0 * 1.05 * wob(0.04)], [1, f0 * 0.6]],
          vowel: 'a', vowel2: 'e', morphAt: 0.35, amp: 0.8, attack: L * 0.18, decayFrac: 0.9, sustain: 0.85, release: L * 0.35,
          rough: rough * 0.7, fry: fry * 0.35, breath: breath + 0.15, size: size * 0.85, nasal: 0.35,
        });
        return;
      }
      if (p.type === 'hiss') { // breathy open-mouthed threat hiss
        V.breathBurst(ctx, out, rng, t0, L, { vowel: 'i', vowel2: 'e', amp: 0.5 + p.breath * 0.3, attack: L * 0.18, color: 'white', size: size * 0.8, curve: 'lin', hiss: 0.35 + p.rasp * 0.3, hissFreq: 4200 / Math.sqrt(size) });
        if (p.crack > 0.15) V.syllable(ctx, out, rng, t0 + L * 0.15, L * 0.6, { f0: [[0, 70 * k], [1, 55 * k]], vowel: 'i', amp: 0.16 * p.crack, attack: L * 0.2, sustain: 0.7, release: L * 0.25, rough: 0.8, fry: 1, breath: 0.2, size }); // fried undertone
        return;
      }
      if (p.type === 'death-rattle') { // fluttering exhale through a slack throat
        const rate = 15 + p.crack * 14;
        const buf = M.frictionBuffer(ctx, rng, L, { rateFn: u => rate * (1 - u * 0.25), ampFn: u => Math.min(1, u * 6) * Math.pow(1 - u * 0.75, 1.2), jitter: 0.35, widthMs: 7, noise: 0.9, noiseColor: 0.1, grit: 0 });
        const src = ctx.createBufferSource(); src.buffer = buf; src.start(t0); src.stop(t0 + L + 0.05);
        const tr = V.tract(ctx, out, size, 0.4); tr.setVowel(t0, 'uh', 0); tr.setVowel(t0 + L * 0.5, 'o', L * 0.35);
        const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: L * 0.12, d: L * 0.8, s: 0.4, r: L * 0.2, peak: 0.8 + p.breath * 0.4, curve: 'lin' });
        DSP.chain(src, g, tr.input);
        V.syllable(ctx, out, rng, t0 + L * 0.08, L * 0.7, { f0: [[0, 62 * k], [1, 42 * k]], vowel: 'uh', amp: 0.3, attack: L * 0.2, sustain: 0.6, release: L * 0.3, rough: 0.75, fry: 1, breath: 0.2, size }); // weak voiced remnant
        return;
      }
      // zombie: flat dumb "uhhhhh", heavy fry, cut off by a glottal stop
      const f0 = 78 * k;
      V.syllable(ctx, out, rng, t0, L, {
        f0: [[0, f0 * 0.95], [0.3, f0 * 1.04 * wob(0.04)], [0.8, f0 * 0.97], [1, f0 * 0.82]],
        vowel: 'uh', amp: 0.9, attack: L * 0.09, decayFrac: 0.95, sustain: 0.85, release: 0.07,
        rough: rough + 0.05, fry: Math.max(0.35, fry), breath, size, nasal: 0.5,
      });
      Foley.Materials.contact(ctx, rng, t0 + L + 0.02, { widthMs: 4, amp: 0.25, grain: 0.4, grainHz: 900 }).connect(out); // glottal stop "uh-"
    },
  });

  /* ================= WOOD BREAK ================= */
  R({
    id: 'woodbreak', name: 'Wood Break', category: 'Impacts', icon: '🪵',
    params: [
      P.sel('type', 'Type', ['smash', 'crack', 'collapse'], 'smash'),
      P.r('size', 'Size', 0, 1, 0.5), P.r('force', 'Force', 0, 1, 0.8), P.r('splinter', 'Splinters', 0, 1, 0.6),
      P.r('pieces', 'Pieces', 0, 1, 0.5), P.r('tension', 'Pre-crack strain', 0, 1, 0.3),
    ],
    duration(p) { return 2 + p.size + (p.type === 'collapse' ? 0.8 : 0); },
    build(ctx, out, p, rng, t0) {
      const sz = 0.8 + p.size * 1.0;
      const shared = M.woodBanks(ctx, out, rng, 'plank', sz, 3);
      const sticks = M.woodBanks(ctx, out, rng, 'stick', sz * 0.9, 3);
      const split = (t, force, amp) => { // the actual fibre failure: hard strike + tearing rip + splinter cloud
        M.woodHit(ctx, out, rng, t, { kind: p.size > 0.7 ? 'beam' : 'plank', size: sz, force, hardness: 0.9, amp, double: 0.2, damp: 0.15 });
        const rl = 0.06 + p.splinter * 0.09;
        const rip = M.frictionBuffer(ctx, rng, rl, { rateFn: u => 500 + 900 * (1 - u), ampFn: u => Math.pow(1 - u, 0.7), jitter: 0.5, widthMs: 0.5, noise: 0.55, noiseColor: 0.25, grit: 900, gritAmp: 0.6, gritHz: 2800, gritSize: sz });
        const rs = ctx.createBufferSource(); rs.buffer = rip; rs.start(t); rs.stop(t + rl + 0.03);
        DSP.chain(rs, DSP.filter(ctx, 'bandpass', 2100 / Math.sqrt(sz), 0.7), DSP.gain(ctx, amp * (0.4 + p.splinter * 0.5)), out);
        if (p.splinter > 0) M.pings(ctx, out, rng, t, 0.12 + p.splinter * 0.2, { count: Math.round(6 + p.splinter * 24), hz: 3100 / Math.sqrt(sz), spread: 0.55, lenMin: 0.002, lenMax: 0.007, amp: p.splinter * 0.4, front: 2.2, lp: 6500 });
      };
      const debris = (t, n, ampMul) => { // broken pieces clattering down
        for (let i = 0; i < n; i++) {
          const u = Math.pow(rng.next(), 0.7); const td = t + 0.04 + u * (0.35 + p.pieces * 0.55);
          const stick = rng.next() < 0.45;
          M.woodHit(ctx, out, rng, td, { kind: stick ? 'stick' : 'plank', size: (stick ? 0.8 : 1) * sz * rng.range(0.7, 1.15), force: rng.range(0.25, 0.6) * (1 - u * 0.5), hardness: 0.6, amp: (0.25 + rng.next() * 0.4) * (1 - u * 0.55) * ampMul, double: 0.6, shared: stick ? sticks : shared });
        }
      };
      const strain = (t, dur, amt) => { if (amt > 0.03) M.creak(ctx, out, rng, t, dur, { kind: p.size > 0.6 ? 'beam' : 'plank', size: sz * 1.2, amp: amt * 0.75, pitch: 1.25, stutter: 0.75, tension: 0.85 }); };
      if (p.type === 'crack') { // strain up to a single sharp split, one or two pieces
        strain(t0, 0.45, Math.max(0.35, p.tension)); split(t0 + 0.45, p.force, 1);
        debris(t0 + 0.45, 1 + Math.round(p.pieces * 3), 0.7);
        return;
      }
      if (p.type === 'smash') { // an impact does the breaking
        strain(t0, 0.25, p.tension * 0.7); const tc = t0 + (p.tension > 0.05 ? 0.25 : 0);
        M.woodHit(ctx, out, rng, tc, { kind: 'hollow', size: sz * 1.1, force: p.force, hardness: 0.7, amp: 0.9, double: 0.3 }); // the crate face taking the blow
        split(tc + rng.range(0.008, 0.02), p.force, 1);
        if (p.force > 0.6 && rng.next() < 0.7) split(tc + rng.range(0.05, 0.1), p.force * 0.7, 0.6);
        debris(tc + 0.05, 2 + Math.round(p.pieces * 6), 1);
        return;
      }
      // collapse: a structure giving way — repeated strain-and-split, then a rain of pieces and a floor thud
      strain(t0, 0.55, Math.max(0.5, p.tension));
      let t = t0 + 0.5;
      for (let i = 0; i < 3; i++) { split(t, p.force * (0.7 + i * 0.15), 0.7 + i * 0.15); strain(t + 0.05, 0.3, 0.35); t += rng.range(0.22, 0.4); }
      M.woodHit(ctx, out, rng, t, { kind: 'floor', size: sz * 1.6, force: 1, hardness: 0.5, amp: 1.1, double: 0.4 });
      debris(t, 4 + Math.round(p.pieces * 9), 1);
    },
  });

  /* ================= COINS / LOOT ================= */
  R({
    id: 'loot', name: 'Coins & Loot', category: 'Impacts', icon: '💰',
    params: [
      P.sel('type', 'Type', ['pickup', 'pouch', 'spill', 'rummage'], 'pickup'),
      P.r('coins', 'Coins', 0, 1, 0.5), P.r('size', 'Coin size', 0, 1, 0.4), P.r('length', 'Length', 0.15, 4, 1, 's'), P.r('leather', 'Pouch leather', 0, 1, 0.5),
    ],
    duration(p) { return p.type === 'pickup' ? 0.7 : p.length + 0.9; },
    build(ctx, out, p, rng, t0) {
      const cz = 0.3 + p.size * 0.45; // coin "size" — METAL.link scaled small and bright
      const shared = M.banks(ctx, out, rng, 'metal', 'link', cz, 4);
      const clink = (t, amp) => M.strike(ctx, out, rng, t, M.METAL.link, { size: cz * rng.range(0.8, 1.25), force: 0.3 + amp * 0.5, hardness: 0.85, amp: amp * 0.8, shared, double: 0.3, damp: 0.35 });
      const jingle = (t, dur, n, ampMul, front) => { for (let i = 0; i < n; i++) { const u = front ? Math.pow(rng.next(), 1.8) : rng.next(); clink(t + u * dur, rng.range(0.25, 0.8) * (1 - u * (front ? 0.55 : 0.2)) * ampMul); } };
      const thap = (t, amp) => M.softHit(ctx, out, rng, t, { kind: 'leather', size: 0.9, force: 0.5, amp: amp * p.leather, double: 0.2 }); // the pouch itself
      const rustle = (t, dur, amp) => { // hand / leather friction
        if (p.leather <= 0.02) return;
        const buf = M.frictionBuffer(ctx, rng, dur, { rateFn: u => 330 * (0.6 + Math.sin(u * Math.PI)), ampFn: u => Math.sin(Math.min(1, u) * Math.PI), jitter: 0.5, widthMs: 0.9, noise: 0.6, noiseColor: 0.1, grit: 0 });
        const s = ctx.createBufferSource(); s.buffer = buf; s.start(t); s.stop(t + dur + 0.04);
        DSP.chain(s, DSP.filter(ctx, 'bandpass', 1150, 0.7), DSP.gain(ctx, amp * p.leather), out);
      };
      if (p.type === 'pickup') { thap(t0, 0.5); jingle(t0, 0.13, Math.round(5 + p.coins * 7), 1, true); clink(t0 + rng.range(0.16, 0.24), 0.3); return; }
      if (p.type === 'pouch') { // shakes: leather thap + a burst of clinks per shake
        const shakes = Math.max(2, Math.round(p.length * 2.6));
        for (let s = 0; s < shakes; s++) {
          const t = t0 + s * (p.length / shakes) * rng.range(0.92, 1.08);
          thap(t, rng.range(0.4, 0.7)); rustle(t, 0.16, 0.35);
          jingle(t + 0.01, 0.11, Math.round(4 + p.coins * 10), rng.range(0.7, 1), true);
        }
        return;
      }
      if (p.type === 'spill') { // pouring treasure: dense front-loaded cascade that settles to single clinks
        rustle(t0, 0.3, 0.4);
        const n = Math.round(14 + p.coins * 46);
        for (let i = 0; i < n; i++) { const u = Math.pow(rng.next(), 0.5); clink(t0 + 0.05 + u * p.length * 0.8, rng.range(0.3, 0.85) * (1 - u * 0.55)); }
        for (let i = 0; i < 4; i++) clink(t0 + p.length * rng.range(0.82, 1), rng.range(0.12, 0.3)); // stragglers spinning to rest
        return;
      }
      // rummage: continuous digging through the pouch
      rustle(t0, p.length, 0.55);
      let t = t0 + 0.05;
      while (t < t0 + p.length) { jingle(t, 0.09, Math.round(2 + p.coins * 6), rng.range(0.35, 0.7), false); if (rng.next() < 0.4) thap(t + 0.02, 0.3); t += rng.range(0.12, 0.35); }
    },
  });

  /* ================= ARMOR MOVEMENT ================= */
  R({
    id: 'armor', name: 'Armor Movement', category: 'Movement', icon: '🛡️',
    params: [
      P.sel('type', 'Type', ['step', 'walk', 'run', 'shift', 'settle'], 'walk'),
      P.r('coverage', 'Mail → plate', 0, 1, 0.5), P.r('weight', 'Weight', 0, 1, 0.6), P.r('steps', 'Steps', 1, 8, 4), P.r('tempo', 'Tempo', 60, 220, 110, 'BPM'),
    ],
    duration(p) {
      const gap = 60 / p.tempo * (p.type === 'run' ? 0.62 : 1);
      return (p.type === 'walk' || p.type === 'run') ? Math.round(p.steps) * gap + 0.8 : 1.2;
    },
    build(ctx, out, p, rng, t0) {
      const mail = (t, dur, amp) => { // chainmail: thousands of tiny ring contacts — friction micro-pulses + bright grains
        const buf = M.frictionBuffer(ctx, rng, dur, { rateFn: u => 620, ampFn: u => Math.min(1, u * 14) * Math.pow(1 - u, 1.3), jitter: 0.5, widthMs: 0.35, noise: 0.5, noiseColor: 0.3, grit: 0 });
        const s = ctx.createBufferSource(); s.buffer = buf; s.start(t); s.stop(t + dur + 0.04);
        const f1 = DSP.filter(ctx, 'bandpass', 4800, 0.9), f2 = DSP.filter(ctx, 'bandpass', 2700, 1.1);
        const g = DSP.gain(ctx, amp * (1 - p.coverage * 0.45)); s.connect(f1); s.connect(f2); f1.connect(g); f2.connect(g); g.connect(out);
        DSP.grains(ctx, out, rng, t, { count: Math.round(14 * dur * 10), spread: dur, len: 0.005, freq: 5600, freqVar: 0.4, Q: 6, amp: amp * 0.22 * (1 - p.coverage * 0.4), decayShape: 1 });
      };
      const plate = (t, amp) => M.metalHit(ctx, out, rng, t, { kind: 'thin', size: rng.range(0.45, 0.8), force: 0.3 + amp * 0.4, hardness: 0.6, amp: amp * (0.25 + p.coverage * 0.6), double: 0.4, damp: 0.6 }); // strapped plates: heavily damped clinks
      const step = (t, amp) => {
        DSP.hit(ctx, out, rng, t, { thumpAmp: (0.35 + p.weight * 0.6) * amp, thumpFreq: 58 * rng.range(0.9, 1.1), thumpDecay: 0.06 + p.weight * 0.05, thumpSweep: 2.5, noiseAmp: 0.18 * amp, noiseColor: 'pink', noiseFreq: 700, noiseQ: 0.8, noiseDecay: 0.03, ring: [], ringAmp: 0, ringDecay: 0.1, drive: 0.1 });
        mail(Math.max(0, t - 0.01), 0.14 + p.weight * 0.05, amp * 0.9);
        const nc = 1 + Math.round(rng.next() * (1 + p.coverage * 1.5));
        for (let i = 0; i < nc; i++) plate(t + rng.range(0.004, 0.05), amp * rng.range(0.5, 1));
      };
      if (p.type === 'step') { step(t0, 1); return; }
      if (p.type === 'walk' || p.type === 'run') {
        const gap = 60 / p.tempo * (p.type === 'run' ? 0.62 : 1); const n = Math.round(p.steps);
        for (let s = 0; s < n; s++) {
          const t = t0 + s * gap * rng.range(0.97, 1.03); step(t, rng.range(0.8, 1));
          if (p.type === 'run' && rng.next() < 0.5) mail(t + gap * 0.5, 0.1, 0.4); // gear bouncing between strides
        }
        return;
      }
      if (p.type === 'shift') { mail(t0, 0.45, 0.8); plate(t0 + rng.range(0.06, 0.14), 0.7); plate(t0 + rng.range(0.2, 0.34), 0.5); return; }
      // settle: dropping into a chair / coming to a halt — one heavy compound clank
      step(t0, 1.1); mail(t0 + 0.06, 0.35, 0.9);
      for (let i = 0; i < 3; i++) plate(t0 + 0.05 + i * rng.range(0.05, 0.09), 0.9 - i * 0.2);
    },
  });

  /* ================= EAT / DRINK ================= */
  R({
    id: 'consume', name: 'Eat & Drink', category: 'Bodily', icon: '🍽️',
    params: [
      P.sel('type', 'Type', ['glug', 'drink', 'gulp', 'bite', 'chew', 'slurp', 'ahh'], 'drink'),
      P.r('count', 'Count', 1, 8, 3), P.r('rate', 'Rate', 1, 6, 2.6, 'Hz'), P.r('size', 'Size', 0.5, 2, 1), P.r('wet', 'Wetness', 0, 1, 0.5), P.r('crunch', 'Crunchiness', 0, 1, 0.7),
    ],
    duration(p) {
      const n = Math.round(p.count);
      if (p.type === 'glug') return n / p.rate + 0.8;
      if (p.type === 'drink') return n / p.rate + 1.8;
      if (p.type === 'chew') return n * 0.45 + 0.7;
      return { gulp: 0.8, bite: 0.9, slurp: 1.5, ahh: 1.4 }[p.type] || 1;
    },
    build(ctx, out, p, rng, t0) {
      const V = Foley.Voice, size = p.size, kk = 1 / Math.sqrt(size);
      const glugOne = (t, amp) => { // one big rhythmic bottle bubble: Minnaert chirp + neck formant + small-bubble cloud + slosh
        const f = 135 / size * rng.range(0.9, 1.1);
        const o = DSP.osc(ctx, 'sine', f, t, 0.14); DSP.sweep(o.frequency, t, f, t + 0.1, f * 1.65);
        const og = DSP.gain(ctx, 0); DSP.env(og.gain, t, { a: 0.004, d: 0.085, peak: 0.6 * amp, r: 0.01 }); DSP.chain(o, og, out);
        const n = DSP.noise(ctx, rng, t, 0.12); const nf = DSP.filter(ctx, 'bandpass', 330 / size, 3);
        const ng = DSP.gain(ctx, 0); DSP.env(ng.gain, t, { a: 0.005, d: 0.09, peak: 0.3 * amp, r: 0.01 }); DSP.chain(n, nf, ng, out);
        const cloud = M.bubbleBuffer(ctx, rng, 0.14, { rate: 320, rMin: 0.0014, rMax: 0.005, amp: 0.3 * amp, chirp: 0.7, env: u => 1 - u * 0.5 });
        const cs = ctx.createBufferSource(); cs.buffer = cloud; cs.start(t + 0.01); cs.stop(t + 0.16); DSP.chain(cs, DSP.gain(ctx, 1), out);
        if (p.wet > 0) { const sn = DSP.noise(ctx, rng, t, 0.14, 'pink'); const sf = DSP.filter(ctx, 'lowpass', 650, 0.8); const sg = DSP.gain(ctx, 0); DSP.env(sg.gain, t, { a: 0.01, d: 0.11, peak: 0.22 * p.wet * amp, r: 0.02 }); DSP.chain(sn, sf, sg, out); }
      };
      const gulp = (t, amp) => { // swallow: throat click + short descending nasal blip + squelch
        M.contact(ctx, rng, t, { widthMs: 3, amp: 0.3 * amp, grain: 0.5, grainHz: 1100 }).connect(out);
        V.syllable(ctx, out, rng, t + 0.015, 0.2, { f0: [[0, 145 * kk], [1, 82 * kk]], vowel: 'o', vowel2: 'u', morphAt: 0.3, amp: 0.55 * amp, attack: 0.012, sustain: 0.5, release: 0.06, rough: 0.2, nasal: 0.5, size });
        V.wet(ctx, out, rng, t + 0.02, 0.16, 0.5 + p.wet * 0.6, size);
      };
      const bite = (t, amp, bright) => { // crunch: snap + dense ping cloud + soft flesh knock underneath
        M.softHit(ctx, out, rng, t, { kind: 'flesh', size: 0.8, force: 0.6, amp: 0.5 * amp, double: 0 });
        const dur = 0.1 + p.crunch * 0.12;
        M.pings(ctx, out, rng, t, dur, { count: Math.round(18 + p.crunch * 55), hz: (2100 + p.crunch * 900) * bright, spread: 0.6, lenMin: 0.0015, lenMax: 0.006, amp: (0.35 + p.crunch * 0.35) * amp, front: 2.6, lp: 5600 * bright });
        if (p.wet > 0.25) V.wet(ctx, out, rng, t + 0.03, 0.12, (p.wet - 0.25) * 0.8, size);
      };
      if (p.type === 'glug' || p.type === 'drink') {
        const n = Math.round(p.count); let t = t0;
        for (let i = 0; i < n; i++) { glugOne(t, 0.8 + rng.next() * 0.2); t += (1 / p.rate) * rng.range(0.9, 1.1); }
        if (p.type === 'drink') {
          gulp(t + 0.12, 1);
          V.breathBurst(ctx, out, rng, t + 0.55, 0.5, { vowel: 'a', amp: 0.3, attack: 0.06, color: 'pink', size, curve: 'lin' });
          V.syllable(ctx, out, rng, t + 0.55, 0.45, { f0: [[0, 150 * kk], [1, 105 * kk]], vowel: 'a', vowel2: 'uh', morphAt: 0.5, amp: 0.4, attack: 0.05, sustain: 0.7, release: 0.18, rough: 0.15, breath: 0.4, size }); // satisfied "ahh"
        }
        return;
      }
      if (p.type === 'gulp') { gulp(t0, 1); return; }
      if (p.type === 'bite') { bite(t0, 1, 1); if (rng.next() < 0.6) bite(t0 + rng.range(0.12, 0.2), 0.45, 0.9); return; }
      if (p.type === 'chew') {
        const n = Math.round(p.count); let t = t0;
        for (let i = 0; i < n; i++) { bite(t, (i % 2 ? 0.55 : 0.75) * rng.range(0.85, 1), 0.75); t += 0.42 * rng.range(0.9, 1.1); }
        if (p.wet > 0.4) gulp(t + 0.1, 0.7);
        return;
      }
      if (p.type === 'slurp') { // drawing liquid in: rising tight-lipped noise + bubble sputter + lip smack
        const dur = 0.9;
        const n = DSP.noise(ctx, rng, t0, dur); const f = DSP.filter(ctx, 'bandpass', 650, 2.5); DSP.sweep(f.frequency, t0, 650, t0 + dur, 2300);
        const g = DSP.gain(ctx, 0); DSP.env(g.gain, t0, { a: dur * 0.35, d: dur * 0.55, s: 0.8, r: 0.06, peak: 0.5, curve: 'lin' }); DSP.chain(n, f, g, out);
        const sput = M.bubbleBuffer(ctx, rng, dur, { rate: 200 + p.wet * 260, rMin: 0.001, rMax: 0.0032, amp: 0.4, chirp: 0.8, env: u => 0.4 + u * 0.6 });
        const ss = ctx.createBufferSource(); ss.buffer = sput; ss.start(t0); ss.stop(t0 + dur + 0.05); ss.connect(out);
        M.softHit(ctx, out, rng, t0 + dur + 0.06, { kind: 'leather', size: 0.5, force: 0.4, amp: 0.35, double: 0.6 }); // lip smack
        if (p.wet > 0.3) gulp(t0 + dur + 0.18, 0.8);
        return;
      }
      // ahh: the post-drink satisfaction on its own
      V.breathBurst(ctx, out, rng, t0, 0.55, { vowel: 'a', amp: 0.35, attack: 0.07, color: 'pink', size, curve: 'lin' });
      V.syllable(ctx, out, rng, t0 + 0.02, 0.6, { f0: [[0, 155 * kk], [0.4, 135 * kk], [1, 100 * kk]], vowel: 'a', vowel2: 'uh', morphAt: 0.55, amp: 0.45, attack: 0.06, sustain: 0.75, release: 0.25, rough: 0.15, breath: 0.45, size });
    },
  });

  /* ================= WAR HORN ================= */
  R({
    id: 'horn', name: 'War Horn', category: 'Tonal', icon: '📯',
    params: [
      P.sel('type', 'Type', ['call', 'blast', 'foghorn', 'cracked'], 'call'),
      P.r('note', 'Pitch', 55, 440, 155, 'Hz'), P.r('length', 'Length', 0.4, 6, 1.8, 's'), P.r('size', 'Horn size', 0.6, 2.5, 1.3),
      P.r('rough', 'Rough / breathy', 0, 1, 0.4), P.r('vibrato', 'Vibrato', 0, 1, 0.25),
    ],
    duration(p) { return p.length + (p.type === 'foghorn' ? 1.6 : 1.1); },
    build(ctx, out, p, rng, t0) {
      const fog = p.type === 'foghorn';
      const f0 = (fog ? Math.min(p.note, 95) : p.note) * rng.range(0.995, 1.005);
      const L = p.length, att = fog ? 0.32 : 0.09, rel = fog ? 0.55 : 0.24, dur = L + rel + 0.4;
      const rough = p.rough + (p.type === 'cracked' ? 0.3 : 0);
      // brass-like source: detuned saws whose brightness follows the blowing pressure
      const o1 = DSP.osc(ctx, 'sawtooth', f0, t0, dur), o2 = DSP.osc(ctx, 'sawtooth', f0 * 1.002, t0, dur);
      o2.detune.setValueAtTime(7, t0);
      [o1, o2].forEach(o => { // attack scoop up to pitch, falling release
        o.frequency.setValueAtTime(f0 * 0.86, t0); o.frequency.exponentialRampToValueAtTime(f0, t0 + att * 1.3);
        o.frequency.setValueAtTime(f0, t0 + L); o.frequency.exponentialRampToValueAtTime(f0 * 0.87, t0 + L + rel * 0.85);
      });
      const jn = DSP.noise(ctx, rng, t0, dur, 'brown'); const jg = DSP.gain(ctx, 12 + rough * 38); jn.connect(jg); jg.connect(o1.detune); jg.connect(o2.detune); // unstable lips
      if (p.vibrato > 0) { const vo = DSP.osc(ctx, 'sine', 5.2, t0, dur); const vg = DSP.gain(ctx, 0); vg.gain.setValueAtTime(0, t0); vg.gain.linearRampToValueAtTime(p.vibrato * 14, t0 + att + L * 0.3); vo.connect(vg); vg.connect(o1.detune); vg.connect(o2.detune); }
      if (p.type === 'cracked') { const tc = t0 + L * rng.range(0.35, 0.55); const cd = rng.range(0.06, 0.12); [o1, o2].forEach(o => { o.detune.setValueAtTime(0, t0); o.detune.setValueAtTime(rng.range(380, 480), tc); o.detune.setValueAtTime(0, tc + cd); }); }
      const vg2 = DSP.gain(ctx, 0); const peak = p.type === 'blast' ? 0.62 : 0.52;
      vg2.gain.setValueAtTime(0, t0); vg2.gain.linearRampToValueAtTime(peak * 0.9, t0 + att);
      vg2.gain.linearRampToValueAtTime(peak * (p.type === 'blast' ? 1.15 : 1.05), t0 + att + (L - att) * 0.7);
      vg2.gain.linearRampToValueAtTime(peak * 0.85, t0 + L); vg2.gain.linearRampToValueAtTime(0.0001, t0 + L + rel);
      const lpF = DSP.filter(ctx, 'lowpass', 400, 0.8); const bright = Math.min(6800, f0 * (fog ? 7 : 11) + 1400) * (p.type === 'blast' ? 1.2 : 1);
      lpF.frequency.setValueAtTime(400, t0); lpF.frequency.linearRampToValueAtTime(bright, t0 + att + 0.14);
      lpF.frequency.setValueAtTime(bright, t0 + L); lpF.frequency.linearRampToValueAtTime(500, t0 + L + rel);
      const sh = DSP.shaper(ctx, 0.28 + rough * 0.2, 'soft');
      const mix = DSP.gain(ctx, 1); o1.connect(vg2); if (!fog) o2.connect(vg2); DSP.chain(vg2, lpF, sh, mix);
      if (fog) { const os = DSP.osc(ctx, 'sine', f0 * 0.5, t0, dur); const osg = DSP.gain(ctx, 0); DSP.env(osg.gain, t0, { a: att, d: L, s: 0.9, r: rel, peak: 0.35, curve: 'lin' }); DSP.chain(os, osg, mix); }
      // the horn body: direct bell blare + hollow-metal resonator
      DSP.chain(mix, DSP.gain(ctx, 0.5), out);
      const body = M.bank(ctx, M.metalModes('hollow', p.size * 1.5, rng, 0.3), 0.8, 0.25);
      DSP.chain(mix, DSP.gain(ctx, 0.9), body.input); DSP.chain(body.output, DSP.filter(ctx, 'lowpass', 7000, 0.6), out);
      // breath through the mouthpiece
      const bn = DSP.noise(ctx, rng, t0, dur, 'pink'); const bf = DSP.filter(ctx, 'bandpass', Math.min(6000, f0 * 5), 1.1); const bg = DSP.gain(ctx, 0);
      DSP.env(bg.gain, t0, { a: att, d: L, s: 0.8, r: rel, peak: 0.1 + rough * 0.22, curve: 'lin' }); DSP.chain(bn, bf, bg, mix);
    },
  });
})();
