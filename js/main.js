/* ============================================================
   BitSwizzler.io — main.js
   Hero carousel, scroll reveals, video autoplay-in-view,
   header hide/show, model-viewer progress.
   ============================================================ */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Footer year ---------- */
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- Header: hide on scroll down, show on scroll up ---------- */
  const header = document.querySelector('.site-header');
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    header.classList.toggle('scrolled', y > 40);
    // showcase page keeps the header pinned so the sticky category sub-nav sits under it
    if (!header.classList.contains('menu-open') && !document.body.classList.contains('page-showcase')) {
      header.classList.toggle('hidden', y > lastY && y > 200);
    }
    lastY = y;
  }, { passive: true });

  const toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = header.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    header.querySelectorAll('.nav a').forEach(a =>
      a.addEventListener('click', () => header.classList.remove('menu-open')));
  }

  /* ---------- Hero carousel ---------- */
  const carousel = document.querySelector('.carousel');
  if (carousel) {
    const slides = Array.from(carousel.querySelectorAll('.slide'));
    const dotsWrap = document.querySelector('.carousel-dots');
    const interval = Number(carousel.dataset.interval) || 5000;
    let index = 0, timer = null, paused = false;

    document.documentElement.style.setProperty('--dur', interval + 'ms');

    const dots = slides.map((_, i) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', 'Slide ' + (i + 1));
      b.addEventListener('click', () => go(i, true));
      dotsWrap.appendChild(b);
      return b;
    });

    function go(next, user) {
      next = (next + slides.length) % slides.length;
      if (next === index) return;
      const cur = slides[index];
      cur.classList.remove('is-active');
      cur.classList.add('is-leaving');
      setTimeout(() => cur.classList.remove('is-leaving'), 1200);
      slides[next].classList.add('is-active');
      dots[index].classList.remove('is-active');
      // restart the fill animation
      void dots[next].offsetWidth;
      dots[next].classList.add('is-active');
      index = next;
      if (user) restart();
    }
    function restart() {
      clearInterval(timer);
      if (!reduceMotion) timer = setInterval(() => { if (!paused) go(index + 1); }, interval);
    }

    dots[0].classList.add('is-active');
    restart();

    document.querySelector('.carousel-arrow.prev').addEventListener('click', () => go(index - 1, true));
    document.querySelector('.carousel-arrow.next').addEventListener('click', () => go(index + 1, true));

    const hero = document.querySelector('.hero');
    document.addEventListener('visibilitychange', () => paused = document.hidden);

    // keyboard + touch swipe
    document.addEventListener('keydown', e => {
      if (document.querySelector('.lightbox:not([hidden])')) return;
      if (e.key === 'ArrowLeft') go(index - 1, true);
      if (e.key === 'ArrowRight') go(index + 1, true);
    });
    let touchX = null;
    hero.addEventListener('touchstart', e => touchX = e.touches[0].clientX, { passive: true });
    hero.addEventListener('touchend', e => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1), true);
      touchX = null;
    });

    // subtle parallax on the hero content
    if (!reduceMotion) {
      const content = document.querySelector('.hero-content');
      window.addEventListener('scroll', () => {
        const y = window.scrollY;
        if (y < window.innerHeight) {
          content.style.transform = `translateY(calc(-1 * var(--angle) / 2 + ${y * 0.25}px))`;
          content.style.opacity = String(1 - y / (window.innerHeight * 0.8));
        }
      }, { passive: true });
    }
  }

  /* ---------- Reveal on scroll ---------- */
  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        revealObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

  /* ---------- Videos: play when in view, pause otherwise ---------- */
  const videos = Array.from(document.querySelectorAll('.video-frame video'));
  const videoObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      const v = e.target;
      if (e.isIntersecting) {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.4 });
  videos.forEach(v => videoObs.observe(v));

  document.querySelectorAll('.sound-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.parentElement.querySelector('video');
      // mute every other video so only one plays sound at a time
      videos.forEach(o => { if (o !== v) { o.muted = true; o.parentElement.querySelector('.sound-toggle').classList.remove('on'); } });
      v.muted = !v.muted;
      btn.classList.toggle('on', !v.muted);
      btn.textContent = v.muted ? '\u{1F508}' : '\u{1F50A}';
    });
  });

  /* ---------- 3D models (<model-viewer>) ----------
     Models are GLB files in assets/models/, rendered by the model-viewer web
     component loaded in <head>. It handles lazy loading, orbit controls and
     auto-rotate itself; this just drives the custom progress bar in each frame. */
  const fromDisk = location.protocol === 'file:';
  document.querySelectorAll('model-viewer').forEach(mv => {
    const bar = mv.querySelector('.model-progress .bar');
    if (fromDisk) {
      // Browsers block fetch() on file:// so the .glb can never load this way.
      const ph = mv.querySelector('.model-placeholder p');
      if (ph) ph.innerHTML = 'Models need a local server<br><small>run <code>serve.bat</code> and open <code>http://localhost:8000</code></small>';
      mv.removeAttribute('src');
      return;
    }
    mv.addEventListener('progress', e => {
      if (bar) bar.style.width = (e.detail.totalProgress * 100) + '%';
      if (e.detail.totalProgress >= 1) mv.querySelector('.model-progress')?.classList.add('done');
    });
    mv.addEventListener('error', () => {
      const ph = mv.querySelector('.model-placeholder p');
      if (ph) ph.innerHTML = 'Model failed to load<br><small>check <code>' + mv.getAttribute('src') + '</code></small>';
    });
  });

  /* ---------- Gallery lightbox (showcase.html) ---------- */
  const lb = document.querySelector('.lightbox');
  const galleryLinks = Array.from(document.querySelectorAll('.gallery figure a'));
  if (lb && galleryLinks.length) {
    const img = lb.querySelector('img'), cap = lb.querySelector('figcaption');
    let cur = 0;
    function show(i) {
      cur = (i + galleryLinks.length) % galleryLinks.length;
      const a = galleryLinks[cur];
      img.src = a.getAttribute('href');
      img.alt = a.dataset.title || '';
      cap.innerHTML = '<strong>' + (a.dataset.title || '') + '</strong>' + (a.dataset.medium || '');
      lb.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function close() { lb.hidden = true; document.body.style.overflow = ''; }
    galleryLinks.forEach((a, i) => a.addEventListener('click', e => { e.preventDefault(); show(i); }));
    lb.querySelector('.lb-close').addEventListener('click', close);
    lb.querySelector('.lb-prev').addEventListener('click', () => show(cur - 1));
    lb.querySelector('.lb-next').addEventListener('click', () => show(cur + 1));
    lb.addEventListener('click', e => { if (e.target === lb) close(); });
    document.addEventListener('keydown', e => {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(cur - 1);
      if (e.key === 'ArrowRight') show(cur + 1);
    });
  }

  /* ---------- Sub-nav: highlight the category in view ---------- */
  const subnav = document.querySelector('.subnav');
  if (subnav) {
    const links = Array.from(subnav.querySelectorAll('a'));
    const targets = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    const spy = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    targets.forEach(t => spy.observe(t));
  }

  /* ---------- Wireframe overlay toggle on <model-viewer> ----------
     model-viewer has no wireframe option, so this reaches its internal three.js
     scene (a symbol-keyed property; stable for the pinned 4.0.0 build) and adds a
     yellow wireframe clone over every mesh. Off by default; hidden if unavailable. */
  document.querySelectorAll('model-viewer').forEach(mv => {
    const btn = mv.querySelector('.wire-toggle');
    if (!btn) return;
    let wires = [], solids = [];
    const getScene = () => {
      const sym = Object.getOwnPropertySymbols(mv).find(s => s.description === 'scene');
      return sym ? mv[sym] : null;
    };
    const rerender = scene => {
      if (scene && typeof scene.queueRender === 'function') scene.queueRender();
      // also nudge a property so model-viewer schedules a frame even when idle
      const e = mv.exposure; mv.exposure = e + 0.0001; requestAnimationFrame(() => { mv.exposure = e; });
    };
    const build = scene => {
      scene.traverse(o => {
        if (!o.isMesh || o.userData.isWire) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        // only real glTF materials; skip model-viewer's internal shadow plane etc.
        if (!mats[0] || !(mats[0].isMeshStandardMaterial || mats[0].isMeshPhysicalMaterial)) return;
        const wm = mats[0].clone();
        wm.wireframe = true; wm.map = null; wm.normalMap = null; wm.roughnessMap = null; wm.metalnessMap = null;
        wm.emissiveMap = null; wm.vertexColors = false; wm.transparent = true; wm.opacity = .55;
        wm.metalness = 0; wm.roughness = 1;
        if (wm.color) wm.color.set(0xffd400);
        if (wm.emissive) { wm.emissive.set(0xffd400); wm.emissiveIntensity = .9; }
        const w = o.clone(); w.material = wm; w.userData.isWire = true;
        w.position.set(0, 0, 0); w.quaternion.set(0, 0, 0, 1); w.scale.set(1, 1, 1);
        w.visible = false; o.add(w); wires.push(w);
        mats.forEach(m => { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; solids.push(m); });
      });
    };
    btn.addEventListener('click', () => {
      const scene = getScene();
      if (!scene) { btn.hidden = true; return; }
      if (!wires.length) build(scene);
      if (!wires.length) { btn.hidden = true; return; }
      const on = btn.getAttribute('aria-pressed') !== 'true';
      wires.forEach(w => w.visible = on);
      solids.forEach(m => { m.polygonOffset = on; m.needsUpdate = true; });
      btn.setAttribute('aria-pressed', String(on));
      rerender(scene);
    });
    // a freshly loaded model replaces the scene graph: rebuild on next toggle
    mv.addEventListener('load', () => { wires = []; solids = []; btn.setAttribute('aria-pressed', 'false'); });
  });

  /* ---------- Masonry galleries: shortest-column packing ---------- */
  document.querySelectorAll('.gallery.masonry').forEach(gal => {
    const figs = Array.from(gal.querySelectorAll('figure'));
    if (!figs.length) return;
    const GAP = 20, MIN = 280, MAX_COLS = 3;
    let cols = 0;
    function pack() {
      const width = gal.clientWidth || gal.parentElement.clientWidth;
      const n = Math.max(1, Math.min(MAX_COLS, Math.floor((width + GAP) / (MIN + GAP))));
      if (n === cols) return;
      cols = n;
      figs.forEach(f => gal.appendChild(f));                       // flatten
      gal.querySelectorAll('.col').forEach(c => c.remove());
      const colEls = [], heights = [];
      for (let i = 0; i < n; i++) { const c = document.createElement('div'); c.className = 'col'; gal.appendChild(c); colEls.push(c); heights.push(0); }
      const colW = (width - GAP * (n - 1)) / n;
      figs.forEach(f => {
        const img = f.querySelector('img');
        const ratio = (img && img.getAttribute('width') && img.getAttribute('height')) ? img.getAttribute('height') / img.getAttribute('width') : 1;
        const est = colW * ratio + 56;                                 // image + caption
        let k = 0; for (let i = 1; i < n; i++) if (heights[i] < heights[k]) k = i;
        colEls[k].appendChild(f); heights[k] += est + GAP;
      });
      gal.classList.add('is-packed');
    }
    pack();
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(pack, 120); });
  });
})();
