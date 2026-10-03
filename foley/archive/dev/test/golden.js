/* Golden-metrics regression: every factory pad's fingerprint (duration, loudness, brightness, spectral centroid,
   crest factor) is recorded per browser in test/golden-<browser>.json. A later run flags any pad whose fingerprint
   drifts beyond tolerance — so a change to a shared generator can't silently alter unrelated pads.
   Update the baseline deliberately with FOLEY_UPDATE_GOLDEN=1 (or when no baseline exists yet). */
const fs = require('fs');
const path = require('path');

const TOL = { dur: 0.15, durMin: 0.06, lufs: 1.5, tiltLog: 0.5, centroid: 0.25, crest: 0.35 };

function compare(browser, current) {
  const file = path.join(__dirname, 'golden-' + browser + '.json');
  const update = process.env.FOLEY_UPDATE_GOLDEN === '1';
  const lines = []; let drift = 0, missing = 0, added = 0;
  if (!fs.existsSync(file) || update) {
    fs.writeFileSync(file, JSON.stringify(current, null, 1));
    lines.push((update ? 'UPDATED' : 'CREATED') + ' golden baseline ' + path.basename(file) + ' (' + Object.keys(current).length + ' pads)');
    return { lines, drift: 0, ok: true };
  }
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of Object.keys(current)) {
    const c = current[key], b = base[key];
    if (!b) { added++; lines.push('NEW   ' + key); continue; }
    const why = [];
    if (Math.abs(c.dur - b.dur) > Math.max(TOL.durMin, b.dur * TOL.dur)) why.push('dur ' + b.dur.toFixed(2) + '→' + c.dur.toFixed(2) + 's');
    if (Math.abs(c.lufs - b.lufs) > TOL.lufs) why.push('loudness ' + b.lufs.toFixed(1) + '→' + c.lufs.toFixed(1) + ' LU');
    if (Math.abs(Math.log10(c.tilt + 1e-4) - Math.log10(b.tilt + 1e-4)) > TOL.tiltLog) why.push('brightness ' + b.tilt.toFixed(3) + '→' + c.tilt.toFixed(3));
    if (Math.abs(c.centroid - b.centroid) > b.centroid * TOL.centroid) why.push('centroid ' + b.centroid.toFixed(0) + '→' + c.centroid.toFixed(0) + ' Hz');
    if (Math.abs(c.crest - b.crest) > b.crest * TOL.crest) why.push('crest ' + b.crest.toFixed(1) + '→' + c.crest.toFixed(1));
    if (why.length) { drift++; lines.push('DRIFT ' + key.padEnd(40) + why.join(', ')); }
  }
  for (const key of Object.keys(base)) if (!current[key]) { missing++; lines.push('GONE  ' + key); }
  lines.push('GOLDEN ' + browser + ': ' + Object.keys(current).length + ' pads, ' + drift + ' drifted, ' + added + ' new, ' + missing + ' gone' + (drift ? '  — intended? re-baseline with FOLEY_UPDATE_GOLDEN=1' : ''));
  return { lines, drift, ok: drift === 0 };
}
module.exports = { compare, TOL };
