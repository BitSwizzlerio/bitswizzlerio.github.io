/* BitSwizzler.io back-link for the Foley Fun lab page.
   Lives only in the website copy (tools/sync-foley.ps1 never overwrites it).
   Waits for Foley to build its top bar, then prepends a small link to the studio site. */
(function () {
  function inject() {
    var brand = document.querySelector('.topbar .brand');
    if (!brand || document.querySelector('.site-home')) return !!brand;
    var a = document.createElement('a');
    a.className = 'site-home';
    a.href = '../';
    a.title = 'Back to BitSwizzler.io';
    a.innerHTML = '<span class="site-home-arrow">&#9664;</span> Bit<b>Swizzler</b>.io';
    var css = document.createElement('style');
    css.textContent =
      '.site-home{display:inline-flex;align-items:center;gap:6px;margin-right:12px;padding-right:12px;' +
      'border-right:1px solid var(--line,#2e333d);color:#FFD400;text-decoration:none;font-weight:700;' +
      'font-size:13px;letter-spacing:.04em;white-space:nowrap;opacity:.9;transition:opacity .15s}' +
      '.site-home b{color:#fff;font-weight:700}.site-home:hover{opacity:1;text-shadow:0 0 10px rgba(255,212,0,.5)}' +
      '.site-home-arrow{font-size:9px;opacity:.7}';
    document.head.appendChild(css);
    brand.parentNode.insertBefore(a, brand);
    return true;
  }
  if (inject()) return;
  var tries = 0;
  var t = setInterval(function () { if (inject() || ++tries > 100) clearInterval(t); }, 50);
})();
