# BitSwizzler.io — studio site

Static site: no build step. **Serve it over HTTP** — double-click `serve.bat` (or run `python -m http.server 8000`) and open <http://localhost:8000>.

> Opening `index.html` directly from disk (`file://`) works for everything *except* the 3D models: browsers block `fetch()` on local files, so `<model-viewer>` can't load the `.glb`s. The viewers show a notice instead. Once the site is on bitswizzler.io this is a non-issue.

## Structure

```
index.html          landing page: hero, five games, showcase teaser
showcase.html       showcase page: 3D models, drawings, digital art
css/style.css       theme, angled sections, reveals, carousel, galleries, lightbox
js/main.js          carousel, scroll reveals, video autoplay, model-viewer progress, lightbox
foley/              Foley Fun — procedural SFX lab, synced from D:\Coding_Expirements\foley (see below)
collisionlab/       CollisionLab — LÖVE project compiled to WebAssembly with love.js (see below)
serve.bat           local preview server (needed for the 3D models)
assets/images/      image_01–06.png → hero carousel key art (2560×1200)
assets/videos/      game1–5.mp4   → gameplay clips (placeholders, 10 s each)
assets/models/      *.glb → 3D models; *_web.glb are the decimated + Draco copies the pages load
assets/drawings/    charcoal & pencil photos/scans → Drawings gallery
assets/digital/     digital paintings → Digital gallery
```

## Swapping placeholders

- **Hero slides** – replace `assets/images/image_NN.png` and update the `background-image` URLs in the `.carousel` block of `index.html`. Add/remove `.slide` divs freely; dots are generated automatically. Change `data-interval` on `.carousel` for slide timing.
- **Videos** – overwrite `assets/videos/gameN.mp4` (keep ≤ 20 s, H.264, no audio needed). Each `<video>` has a `poster` attribute pointing at the matching slide image.
- **Text** – every heading, tagline, paragraph and tag list is inline in `index.html`.
- **Showcase galleries** – each piece is a `<figure>` in `showcase.html`. Set the `<a href>` to the full-size image (opens in the lightbox), the `<img src>` to the same or a smaller thumbnail, and `data-title` / `data-medium` for the caption. Add or remove figures freely; the masonry layout reflows and keeps each image's own aspect ratio. Keep files under ~500 KB for the grid (e.g. `Escher_web.jpg` is a 1600 px copy of the 2.2 MB scan).
- **Store links** – search for `store.steampowered.com` and `itch.io` and replace with your real store URLs.

## 3D models

The three showcase viewers use Google's [`<model-viewer>`](https://modelviewer.dev/) web component (loaded from a CDN in `<head>`) with **glTF binary (`.glb`)** files in `assets/models/`. The included bucket, teddy and robot are generated test models with full PBR texture sets (base colour, metallic/roughness, normal).

To swap in your own: export from Blender (File → Export → glTF 2.0, format *glTF Binary*) or any DCC that writes glTF, drop the `.glb` in `assets/models/`, and change the `src` on the matching `<model-viewer>` in `index.html`. Useful attributes already set on each viewer: `camera-controls`, `auto-rotate`, `environment-image="neutral"`, `shadow-intensity`, `exposure`. See the model-viewer docs for camera framing (`camera-orbit`, `camera-target`) and custom HDR lighting (`environment-image="path.hdr"`).

Keep models under ~5 MB and ~200 k triangles each; textures at 1K–2K are plenty at this display size.

Each viewer has a **Wire** button (top-right, off by default) that overlays a yellow wireframe. `<model-viewer>` has no wireframe option, so `js/main.js` reaches into its internal three.js scene via a symbol-keyed property — this works with the pinned model-viewer 4.0.0; if you ever bump the version, check the button still works (it hides itself if the hook is missing).

Vertex-colour builds: `tools/grogg_ao.py` (toad skin + AO) and `tools/skull_ao.py` are the templates — copy one and change the palette block for new sculpts.

**Heavy sculpts** (`Monster.glb`, `TheEvidence.glb` are 0.9–1.7 M tris) won't run well in a browser, so the pages load decimated, Draco-compressed copies (`*_web.glb`, ~150 k tris, well under 1 MB). Each has its own build script in `tools/` — rerun after re-exporting a source model (`BLENDER` = `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python`):

```
BLENDER tools/monster_fix.py -- assets/models 150000     # weld verts, fix normals, decimate, double-sided
BLENDER tools/skull_ao.py    -- assets/models 150000     # decimate, bake AO into bone-tinted vertex colour
BLENDER tools/joule_web.py   -- assets/models 2048       # textures capped at 2K, WebP, Draco (14 MB -> 1.7 MB)
BLENDER tools/robot_steel.py -- assets/models 200000     # join+weld, decimate, steel PBR + baked AO vertex colour, Draco
BLENDER tools/optimize_models.py -- assets/models 150000 Name1 Name2   # generic: decimate + Draco only
```

`150000` is the target triangle count. Two gotchas learned the hard way: meshes exported as unwelded triangle soup must be welded (`remove_doubles`) *before* decimating or Decimate deletes faces instead of collapsing edges; and vertex colours are linear in glTF, so pick colours in sRGB and convert (see `skull_ao.py`). Draco decoding needs a decoder library — both pages point `model-viewer` at the copy on jsDelivr in `<head>`.

## Tweaking the look

Colours, fonts and the diagonal cut size (`--angle`) are CSS custom properties at the top of `css/style.css`. Each section's `data-dir="left|right"` sets which way its diagonal leans.

## Regenerating the test models

`tools/make_models.py` builds the bucket, teddy and robot procedurally in Blender (geometry + noise-based PBR textures) and exports GLB. Run it headless:

```
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python tools/make_models.py -- assets/models tools/tex
```

Append `bucket`, `teddy` or `robot` to rebuild just one. `--factory-startup` is required — the V-Ray add-on aborts headless Blender otherwise.

## Foley Fun (`/foley/`)

The procedural sound-effect board lives at `bitswizzler.io/foley/`. It is deliberately low-key: no nav entry, just a muted **Lab: Foley Fun** link in both footers, and its page carries `noindex`. Inside Foley, a small **◀ BitSwizzler.io** link is prepended to its top bar by `foley/site-link.js`.

The source project stays in `D:\Coding_Expirements\foley`. After changing it, resync:

```
powershell -ExecutionPolicy Bypass -File tools\sync-foley.ps1
```

The script mirrors `index.html`, `css/`, `js/`, `vendor/` (skipping `archive/`, `starter-kit/` JSON and the README), then re-applies the `noindex` meta and the `site-link.js` script tag to the copied `index.html`. `foley/site-link.js` itself is never overwritten.

## CollisionLab (`/collisionlab/`)

A LÖVE 11.x desktop project (`D:\Coding_Expirements\collisionlab`) running in the browser through
[love.js](https://github.com/Davidobot/love.js) (LÖVE compiled to WebAssembly). Linked from the same muted footer
**Lab:** line as Foley Fun; the page is `noindex`.

Rebuild after changing the Lua:

```
powershell -ExecutionPolicy Bypass -File tools\sync-collisionlab.ps1
```

The script zips the `*.lua` tree into `tools\build\collisionlab\game.love`, runs love.js in *compatibility* mode
(no SharedArrayBuffer, so it works on any static host — no special headers), and copies just the runtime
(`love.wasm` 4.7 MB, `love.js`, `game.js`, `game.data`) into `collisionlab/`. The wrapper page
`collisionlab/index.html` is hand-written (BitSwizzler styling, back-link, loading state, key legend) and is never
overwritten. Needs Node.js; love.js installs itself into `tools\node_modules` on the first run (`tools\package.json`).

Gotchas: `Esc` calls `love.event.quit()` in `main.lua`, which ends the WASM app — the page offers a **Restart** button.
The wrapper also `preventDefault()`s F1/F2/space/arrows so the browser doesn't intercept them. Fullscreen is done *inside* LÖVE (`F11` → `love.window.setFullscreen` in `main.lua`); the wrapper's button just sends an F11 key event. Driving fullscreen from the DOM or `Module.requestFullscreen` leaves LÖVE with a stale viewport (black/grey screen). Hosting must serve
`.wasm` as `application/wasm` (Python's server, GitHub Pages, Netlify, Cloudflare all do).
