/* Boot */
document.addEventListener('DOMContentLoaded', () => {
  const S = Foley.Store;
  if (!S.loadTabs() && !S.load()) { S.state.bankName = 'Starter Kit'; S.state.pads = JSON.parse(JSON.stringify(Foley.Factory['Starter Kit'])).map(S.migratePad); S.state.pads.forEach(p => { if (!p.key) p.key = S.nextFreeKey(); }); S.state.selected = S.state.pads[0].id; S.save(); }
  S.ensureTabs();
  Foley.UI.init();
  // Unlock audio on first gesture
  const unlock = () => { Foley.Engine.ensure(); document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); };
  document.addEventListener('pointerdown', unlock); document.addEventListener('keydown', unlock);
});
