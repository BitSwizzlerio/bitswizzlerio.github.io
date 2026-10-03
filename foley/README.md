# Foley Fun

A procedural foley / sound-effect generation system and soundboard for game audio.
Everything is synthesized in the browser with the Web Audio API — no samples, no
runtime dependencies (the optional OGG encoder is a vendored script), no build step to run the app. The only build is
the one-command bundling of the Starter Kit's JSON pads, and that is only needed when you change the kit.

## Run

Open `index.html` directly in Chrome/Edge/Firefox, or serve the folder:

```
npx serve .          # or: python -m http.server 8080
```

## Concepts

| Term | Meaning |
|---|---|
| **Generator** | A parametric synthesis model (footstep, explosion, UI blip, rain …). 50 built in, grouped by category. |
| **Layer** | One generator instance with params, gain, pan and time offset. |
| **Pad** | A soundboard slot: 1+ layers mixed, then run through the **Post FX** chain. Bound to a keyboard key. |
| **Variations** | Each pad renders *N* seeded variants; triggering picks one (random / round-robin) and adds pitch, gain and pan jitter. |
| **Bank** | The whole board. Auto-saved to `localStorage`, exportable as `*.foley.json`. |

## Features

- 36 generators: footsteps (12 surfaces, gaits), skitter (9 creature types × 7 surfaces, gait/motion modes), whoosh, jump, land, cloth, impact (8 materials), punch, glass, blade,
  door, chain (rattle, drag, drop, hoist/lower, clink, swing, drawbridge lower/raise over wood), squish/gore, mechanical, UI click/tone/typing/swipe, explosion, gunshot (6 weapons), laser, bow, reload,
  rain, wind, thunder, fire, water, ice/glacier (dispersive chirp cracks, fracture spread, groan, calving, creak, shatter, freeze), creatures, coin/pickup, magic, alarm, engine, heartbeat, drone, riser/stinger,
  static/interference (radio, TV, geiger, dial-up), electric arc/spark (tesla, welding, short circuit), zap/shock
  (taser, bug zapper, lightning strike, EMP), electric hum (mains, fluorescent, transformer, forcefield, power up/down),
  scrape/drag (stick-slip friction of brick/stone/boulder/concrete/wood/metal on pavement/rock/dirt/wood, with motion
  profiles and snags), rock (impact, throw-land, tumble, rockslide, boulder roll, grind, crack, crumble, skip), earth
  (dig, shovel dump, dirt/gravel/sand pours, rubble settle, landslide, ground crack, quake, stomp, burrow, mud slop).
  The Rock & Earth family drives modal resonator banks (object body × ground body) with stick-slip pulse trains and grit.
  Bodily: fart (10 styles incl. wet, machine-gun, squeaker, trumpet), burp (8 incl. monster, satisfied), sneeze (8 incl.
  triple, cartoon, cat, suppressed), yawn/sigh/groan/snore, laugh (chuckle, giggle, laugh, belly, witch cackle, goblin
  chuckle/cackle, evil laugh, snicker, nervous, guffaw). Voiced sounds use a small vocal-tract model — glottal pulse with
  jitter/roughness through F1–F3 formant filters plus breath noise — so pitch, body size and vowel are all parameters.
- Deterministic seeded rendering — same params + seed = identical file, forever.
- Post FX per pad: pitch, gain, HP/LP, drive (soft/hard/fold), bit-crush + downsample, reverb, delay, reverse, normalize, fade.
- **Body / Resonator** (optional, off by default): a modal resonator bank — 12 physical bodies (wood plank, hollow metal,
  ceramic, stone slab, plastic shell, glass, cardboard box, drum, bell, pipe, bottle, cartoon boing) with amount, size and
  damping. Each mode is a high-Q bandpass (decay ≈ Q/πf). `none` bypasses it bit-for-bit.
- **Wood material model** (`js/core/materials.js`): plank, beam, stick, panel (door), hollow (crate), floor. 10–16 modes
  generated from free-free beam eigenvalues (1 : 2.76 : 5.40 : 8.93 …) plus a width-mode family, inharmonic scatter,
  decay ∝ (f1/f)^slope so highs die first, strike-position mode weighting, a raised-cosine contact pulse whose width is
  the hardness (short = mallet, long = sole), surface grain, a saturating low "thock", optional double contact, and
  per-hit randomisation. Used by impact (wood), footstep/land (wood floor), door (knock/slam), drawbridge planks, the
  scrape wood pairing, and the Body FX bodies `wood-plank / wood-beam / wood-panel / wood-crate / wood-floor`.
- **Masonry material model** (same module): brick, stone, concrete, boulder, pavement slab, bedrock — dense inharmonic
  modes with very heavy damping (8–40 ms), used by rock impacts, the scrape bodies and the Body FX bodies
  `brick / stone / concrete / boulder / stone-slab`. The scrape/drag generator renders its excitation as one coupled
  signal (`Materials.frictionBuffer`): raised-cosine stick-slip pulses, friction noise multiplied by the slip envelope,
  and resonant grit pings gated the same way; everything passes through the object and ground bodies (no naked pulse
  path), then a speed-tracking grind formant, a 5 kHz tilt and a slow "grip" modulation.
- **Metal / glass / ceramic / plastic material models** (same module): metal plate, sheet, bar, hollow (duct/can/pipe),
  heavy (anvil), chain link, blade; glass pane, bottle, shard, ceramic, plastic. Long-ringing metal keeps its highs
  (low damping slope) and gets a pitch-drop on hard hits (sheet-metal nonlinearity). Used by impacts, glass shatter
  (real shard strikes), swords, chains, footsteps on metal/tile, and Body FX bodies.
- **Surfaces & weather as crowds of real events** (no filtered-noise beds): footsteps on gravel (pebble bed + stone
  pings + real pebbles + bedding crump), snow (crystal fractures + compaction), sand, leaves, grass (blade swishes),
  stone/tile/metal (material models); rain rendered as thousands of surface-specific drop impacts with a near/far split
  (plip on water, ping on stone, thud on leaves, tick on glass, ring on roofs); wind as coherent turbulence (correlated
  bands whose centre tracks gust speed, a speed-tracking Aeolian whistle, gust-gated foliage rustle); whoosh as three
  co-sweeping bands; cloth as fibre friction; fire pops as tiny wood-stick strikes with steam hiss.
- **Noise primitives**: velvet, blue and grey noise join white/pink/brown/crackle (velvet is the default excitation).
- **Mix tools**: loudness normalization (K-weighted, gated, LUFS-style; −18 LU default for new/factory pads, Retro 8-bit
  and previously saved pads keep peak), a **Distance** macro (air absorption + level + reflections + width), six
  generated **room** types (hall, small room, stairwell, cave, outdoor, plate), a **transient shaper**, an **Intensity**
  macro with soft/medium/hard **tier export**, and **Brightness / Loudness meters** under the waveform.
- **Soft bodies, bubbles, creatures, engines, rattle**: flesh/rubber/cardboard/leather/body soft-body models (damped modes +
  skin slap + paper crinkle/bounce) behind impacts, punches and landings; water rendered as Minnaert bubble clouds
  (splash, drip, stream, pour, dive, bubbles); growl/roar/owl/frog on the vocal-tract model; combustion engines as
  cylinder-firing pulse trains through an exhaust body (`model: legacy` keeps the old oscillator stack — Retro's Engine
  pad is pinned to it); skitters as resonant taps; explosion debris and gun mechanisms as material strikes; wind and fire
  beds rendered decorrelated left/right; a **Rattle** Post-FX block (loose parts that chatter above a threshold).
- **Golden-metrics regression** (`archive/dev/test/golden.js`, `archive/dev/test/golden-<browser>.json`): every factory pad's duration, loudness,
  brightness, spectral centroid and crest are baselined per browser; any drift beyond tolerance fails the run and is
  listed pad by pad. Re-baseline deliberately with `FOLEY_UPDATE_GOLDEN=1`.
- **Space** (Post FX): six early-reflection taps (2–40 ms, decaying and darkening) that put a dry hit in a room without a
  reverb tail. Cheap; try 0.2–0.4 on any impact.
- **Seamless loops**: a loop pad is cut at its *musical* length (the layers' `length` + offsets/repeats — decay tails of
  bodies/reverb/space fold into the head instead of dangling), then a **smart seam** searches the last ~40 ms for the wrap
  point best correlated with the head before crossfading, so periodic sounds (engines, hums, rolls) don't beat or dip at
  the seam. The test suite measures seam-vs-body level on Car Idle, Helicopter, Mains Hum, Rain Loop and Boulder Roll.
- **Crossfade loop** (checkbox next to "Loop pad"): overlaps the render's tail into its head with an equal-power curve so
  any pad loops sample-continuously; a pure post-process step, baked into exported WAVs.
- Layer tools: randomize, mutate, reset, duplicate, mute, reorder.
- A/B compare: Snap A freezes a pad's design + audio; keep editing (B), audition ▶A/▶B (Shift+A/B) or ⇄ back to back,
  see A ghosted behind the waveform and a count of changed parameters, Restore A (undoable).
- Granular texture engine (`granular`): a JS-rendered grain cloud — 10 grain sources (noise colours, crackle, sine/saw/square,
  impulse, chirp, ring), density up to 3000/s, grain size/jitter, 5 windows, pitch spread, stereo spread, cloud envelopes
  (flat/swell/decay/pulse/gusts/rise-fall), sweepable filter, drive, seamless loop. Textures bank has 14 starting points.
- Seamless-loop mode on ambiences (rain, wind, fire, engine, drone, static, hum, ice).
- Loop playback on the board: tick "Loop pad" and the pad's click/key toggles a click-free loop (several can run at once as
  beds; looping pads pulse; Stop/Esc clears them). The ∞ Loop preview button / Shift+L loops any pad's previewed variation,
  and edits to a looping pad are swapped in live.
- Keyboard triggering with velocity-free humanize; drag to reorder pads; undo/redo.
- Fast pad removal: hover ✕ on a pad, Delete/Backspace, or the ⋯ menu — immediate, with an Undo toast. Multi-select with
  Ctrl+click (toggle), Shift+click (range) and Ctrl+A; a selection bar deletes/duplicates the set. "Clear bank" wipes all
  (confirmed, undoable). No `X` key shortcut — letter keys stay free for pad triggers.
- Export: single WAV, all variations, or the entire bank (48 kHz / 16-bit stereo). Bank JSON import/export/merge; copy a single pad as JSON to share.
- One factory bank — the **Starter Kit** (73 pads) — built from `starter-kit/pads/*.json`; the former themed banks are
  archived in `archive/presets-legacy.js` and any of their pads can be exported back out as JSON.

## The Starter Kit (the one factory bank)

The shipped bank is built from **`starter-kit/pads/*.json`** — one file per pad, in exactly the format the app's
*Copy pad JSON* / *Export Bank* produce, so a pad can be tweaked in the app, exported, dropped into the folder and rebuilt:

```
node archive/dev/tools/build-starter.js   # bundles starter-kit/pads/*.json -> js/app/starter-kit.js (order from starter-kit/manifest.json)
```

Browsers can't fetch JSON next to a `file://` page, which is why the kit is bundled into a script rather than read at
runtime. `starter-kit/manifest.json` sets the kit name and pad order; unlisted files are appended alphabetically; trigger
keys are assigned in order (36 keys). The former factory banks live in `archive/presets-legacy.js`;
`node archive/dev/tools/export-factory-pads.js` can pull any of their pads out as JSON again.

Development tooling (test runners, golden baselines, build/export scripts) lives under `archive/dev/` so the project
root stays clean; it runs from there unchanged.

## Workflow

- **Layers**: mute / **solo**, per-layer high-pass / low-pass / drive, and **Repeat × every × jitter** (a layer can fire N
  times with timing jitter — walks, drips, combos). A **timeline strip** above the layers shows each layer's block;
  drag a block to set its offset (repeats appear as ghosts).
- **Macros**: user knobs — one slider drives several layer parameters, each with its own range (Macros section).
- **Copy FX / Paste FX** between pads; on a multi-selection the bar offers Paste FX, Re-seed and Intensity for all.
- **Generator presets** in the New Pad dialog (Anvil, Crate, Snow trudge, Dragon roar, Storm on roof…).
- **Bank tabs**: several banks open at once (tab strip above the board); + opens an empty bank, double-click renames,
  drag pads onto another tab to move them. The workspace (all tabs) is remembered across reloads.
- **MIDI** (🎹 button; Chrome/Edge): notes from C2 trigger pads in board order, velocity picks the Intensity tier
  (0.1 / 0.3 / 0.5 / 0.7 / 0.9, cached), the mod wheel sets the selected pad's Intensity.

## Saving, exporting, touch

- **Save (Ctrl+S)** stores the bank in the browser's IndexedDB library (localStorage fallback); **Banks…** lists, loads,
  renames, deletes and exports saved banks. The working board still auto-saves so a reload never loses it; an
  "● unsaved / ✓ saved" indicator sits next to the bank name. Clearing site data removes the library — Export Bank
  writes a JSON file you can keep anywhere.
- **Export format** (toolbar): WAV 16/24-bit or **OGG Vorbis** (vendored libvorbis, `vendor/libvorbis.js`, loaded lazily
  on first use; ~15× smaller than WAV; loop pads carry `LOOPSTART`/`LOOPLENGTH` comments), at 48 or 44.1 kHz, stereo or
  mono. Applies to single, per-variation, tier and Export-All downloads.
- **Touch**: pads use pointer events — tap to trigger, long-press for the menu; sliders drag with a finger. The test
  runners drive real touch events (CDP `Input.dispatchTouchEvent` in Edge, WebDriver touch pointer actions in Firefox).

## Testing

```
node archive/dev/test/run-headless.js   # Edge/Chrome via DevTools protocol; no npm packages
node archive/dev/test/run-firefox.js    # Firefox via Marionette; also performs real WebDriver clicks and touch
FOLEY_STAGES=smoke,real node archive/dev/test/run-firefox.js   # run only some stages: engine, smoke, real
```

Drives a headless browser over the DevTools protocol and (1) renders every generator with default and
randomized params, every factory pad, and the full FX chain, checking for exceptions, NaNs and silence;
(2) boots the real UI and exercises triggering, editing, layers, dialogs, undo/redo, import/export and
persistence. You can also open `archive/dev/test/selftest.html` in a normal browser tab.

Note on determinism: params + seed fully determine the synthesis graph, but Chrome's audio renderer is
not bit-exact between runs (≈1 float ULP drift), so re-rendering the same pad yields perceptually
identical, not byte-identical, files. Export once and keep the WAV if you need byte-stable assets.

## Adding a generator

Create a file in `js/generators/` (and add a `<script>` tag in `index.html`):

```js
Foley.registerGenerator({
  id: 'mysound', name: 'My Sound', category: 'Custom', icon: '🎵',
  params: [Foley.P.r('pitch', 'Pitch', 0.5, 2, 1), Foley.P.sel('mode', 'Mode', ['a', 'b'], 'a'), Foley.P.tog('extra', 'Extra', false)],
  duration(p) { return 0.5; },                 // seconds — sets the offline render length
  build(ctx, out, p, rng, t0) {                // ctx = OfflineAudioContext, out = layer gain node
    const DSP = Foley.DSP;
    DSP.hit(ctx, out, rng, t0, { thumpFreq: 100 * p.pitch });
  },
});
```

Use `rng` (seeded) rather than `Math.random()` so variations stay reproducible. `Foley.DSP` provides
noise sources (white/pink/brown/crackle), oscillator stacks, envelopes, filters, waveshapers, and the
composite `hit()` / `grains()` builders that most foley is made from.

## Layout

```
index.html
css/style.css
js/core/       prng, dsp helpers, generator registry, render/FX/playback/WAV engine
js/generators/ movement, impacts, ui, weapons, nature, tonal
js/app/        store (state/persistence/undo), factory presets, UI, boot
```
