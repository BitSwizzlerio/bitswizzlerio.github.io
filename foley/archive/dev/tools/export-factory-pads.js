/* One-off / re-runnable: export pads from the archived legacy factory banks (archive/presets-legacy.js) as
   individual JSON files (the same format as the app's "Copy pad JSON") into starter-kit/pads/.
   Usage: node tools/export-factory-pads.js            (writes only files that do not exist yet)
          node tools/export-factory-pads.js --force    (overwrites) */
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..'); const OUT = path.join(ROOT, 'starter-kit', 'pads');
global.window = global; global.document = { addEventListener() { } };
['js/core/prng.js', 'js/core/dsp.js', 'js/core/registry.js', 'js/core/engine.js', 'js/core/materials.js', 'js/generators/movement.js', 'js/generators/impacts.js', 'js/generators/ui.js', 'js/generators/weapons.js', 'js/generators/nature.js', 'js/generators/tonal.js', 'js/generators/electric.js', 'js/generators/earth.js', 'js/generators/body.js', 'js/generators/granular.js', 'js/app/store.js', 'archive/presets-legacy.js'].forEach(f => require(path.join(ROOT, f)));

/* [bank, pad name, output file name, optional rename] */
const WANT = [
  // Starter Kit originals (minus Run Stone and Stinger)
  ...['Step Gravel', 'Step Wood', 'Jump', 'Land', 'Sword Clash', 'Punch', 'Explosion', 'Pistol', 'Laser Pew', 'Coin', 'Power Up', 'UI Click', 'UI Confirm', 'UI Error', 'Magic Sparkle', 'Glass Shatter', 'Rain Loop', 'Fire Loop', 'Thunder', 'Splash', 'Heartbeat'].map(n => ['Starter Kit', n]),
  // all of UI & Menus
  ...['Hover', 'Click Soft', 'Click Crisp', 'Click Mech', 'Bubble', 'Confirm', 'Cancel', 'Error', 'Notify', 'Popup', 'Swipe', 'Swipe Back', 'Typing', 'Typewriter', 'Lock', 'Switch', 'Level Up', 'Heal'].map(n => ['UI & Menus', n]),
  // all of Retro 8-bit (prefixed so they don't collide with the Starter Kit's Jump / Coin / Power Up / Error)
  ...['Jump', 'Coin', '1-Up', 'Laser', 'Explode', 'Hit', 'Blip', 'Error', 'Power Up', 'Alarm', 'Engine', 'Text'].map(n => ['Retro 8-bit', n, null, '8-bit ' + n]),
  // Mechanisms picks
  ...['Chain Hoist', 'Chain Lower', 'Drawbridge Lower', 'Drawbridge Raise', 'Door Slam', 'Door Creak'].map(n => ['Mechanisms', n]),
  ['Creatures', 'Spider on Wood'],
  ...['Radio Static', 'TV Static', 'Geiger'].map(n => ['Electric', n]),
  ['Combat', 'Arrow Flyby'],
];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const force = process.argv.includes('--force'); let written = 0, skipped = 0;
for (const [bank, name, file, rename] of WANT) {
  const src = (Foley.Factory[bank] || []).find(p => p.name === name); if (!src) { console.error('MISSING ' + bank + '/' + name); process.exitCode = 1; continue; }
  const pad = Foley.Store.migratePad(JSON.parse(JSON.stringify(src))); delete pad._rr; pad.key = ''; if (rename) pad.name = rename;
  const out = path.join(OUT, (file || slug(pad.name)) + '.json');
  if (fs.existsSync(out) && !force) { skipped++; continue; }
  fs.writeFileSync(out, JSON.stringify({ format: 'foley-bank', version: 1, bankName: pad.name, source: bank + '/' + name, pads: [pad] }, null, 2)); written++;
}
console.log('exported ' + written + ' pad files to starter-kit/pads (' + skipped + ' already existed)');
