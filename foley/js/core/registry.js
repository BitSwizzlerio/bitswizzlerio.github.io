/* Generator registry. A generator = { id, name, category, icon, params[], duration(p), build(ctx, out, p, rng, t0) } */
window.Foley = window.Foley || {};
Foley.generators = {};
Foley.generatorList = [];
Foley.registerGenerator = function (def) {
  def.params = def.params || [];
  def.params.forEach(p => {
    if (p.type === undefined) p.type = 'range';
    if (p.step === undefined) p.step = p.type === 'range' ? ((p.max - p.min) / 200) : 1;
  });
  Foley.generators[def.id] = def;
  Foley.generatorList.push(def);
};
Foley.defaultParams = function (genId) {
  const g = Foley.generators[genId]; const p = {};
  if (!g) return p;
  g.params.forEach(pr => p[pr.id] = pr.default);
  return p;
};
Foley.randomParams = function (genId, rng, amount) {
  amount = amount === undefined ? 1 : amount;
  const g = Foley.generators[genId]; const p = {};
  g.params.forEach(pr => {
    if (pr.type === 'select') p[pr.id] = rng.next() < amount ? rng.pick(pr.options).value : pr.default;
    else if (pr.type === 'toggle') p[pr.id] = rng.next() < amount ? rng.next() < 0.5 : pr.default;
    else p[pr.id] = Foley.DSP.lerp(pr.default, rng.range(pr.min, pr.max), amount);
  });
  return p;
};
/* Convenience param builders */
Foley.P = {
  r(id, name, min, max, def, unit) { return { id, name, type: 'range', min, max, default: def, unit: unit || '' }; },
  sel(id, name, options, def) { return { id, name, type: 'select', options: options.map(o => typeof o === 'string' ? { value: o, label: o } : o), default: def === undefined ? options[0].value || options[0] : def }; },
  tog(id, name, def) { return { id, name, type: 'toggle', default: !!def }; },
};
