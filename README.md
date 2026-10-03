# BitSwizzler.io — studio site

Static site: no build step for the pages themselves. **Serve it over HTTP** — double-click `serve.bat` (or run `py -m http.server 8000`) and open <http://localhost:8000>.

> Opening `index.html` directly from disk (`file://`) works for everything *except* the 3D models and CollisionLab: browsers block `fetch()` on local files, so `<model-viewer>` can't load the `.glb`s and love.js can't load its runtime. On bitswizzler.io this is a non-issue.

Live on GitHub Pages from this repo; `.gitignore` keeps asset masters out, so pushing is the whole deploy.

## Structure

```
index.html          landing page: hero carousel, five games, showcase teaser
showcase.html       showcase page: 3D models, drawings, digital art
css/style.css       theme, angled sections, reveals, carousel, galleries, lightbox
js/main.js          carousel, scroll reveals, video autoplay, model-viewer, lightbox, masonry
foley/              Foley Fun — procedural SFX board (plain JS, edit in place; see below)
collisionlab/       CollisionLab — LÖVE lab compiled to WebAssembly; Lua source in collisionlab/src
assets/images/      image_01–08_web.webp → hero carousel (the .png beside them are the masters)
assets/videos/      game1–5.mp4 → 18 s 720p loops (gameN_full.mp4 are the untrimmed masters)
assets/models/      *_web.glb → the models the pages load (the plain .glb are the masters)
assets/drawings/    charcoal, pencil and ink photos/scans → Drawings gallery
assets/digital/     digital paintings, sculpture, vector → Digital gallery
tools/              build scripts (Blender model pipeline, CollisionLab web build, deploy staging)
serve.bat           local preview server
```

## Swapping content

- **Hero slides** – add a 2560×1200 PNG to `assets/images/`, convert it to a 1920 px WebP (`magick image_09.png -resize 1920x -strip -quality 82 image_09_web.webp`), and add a `.slide` div pointing at the WebP in the `.carousel` block of `index.html`. Dots are generated automatically.
- **Videos** – keep **H.264 High/Main, yuv420p, faststart**, ≤ 20 s. In Kdenlive use the stock **MP4-H264/AAC** preset (Generic group), not the Hardware Accelerated ones — those produced a 4:4:4 file browsers refuse to play. Keep the long capture as `gameN_full.mp4` and trim with `ffmpeg -ss <start> -i gameN_full.mp4 -t 18 -vf scale=1280:720 -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -preset slow -af "loudnorm=I=-18:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.79:level=false,afade=t=in:d=0.25,afade=t=out:st=17.5:d=0.5" -c:a aac -b:a 128k -ac 2 -movflags +faststart gameN.mp4`. The audio filters even out loudness between games and fade the ends so the loop doesn't click. Current starts: game1 6 s, game2 6 s, game3 4 s, game4 8 s. `game5.mp4` is a generated placeholder with no audio, so its section has no sound button; when a real clip replaces it, copy the `<button class="sound-toggle">` from another section back in.
- **Text** – every heading, tagline, paragraph and tag list is inline in `index.html` / `showcase.html`.
- **Showcase galleries** – each piece is a `<figure>` in `showcase.html`: `<a href>` = full-size image (opens in the lightbox), `<img src>` = same or a thumbnail with its real `width`/`height`, and `data-title` / `data-medium` for the caption. Keep files under ~500 KB (e.g. `Escher_web.jpg` is a 1600 px copy of the 2.2 MB scan).
- **Store buttons** – a live link is `<a class="btn btn-steam" href="…">`. For a game that isn't there yet, drop the `href` and add `soon` plus `data-soon="Q2 2027"` (or `TBD`, `Not on Steam`, `In Development`…) to stamp the tape on it.
- **Browser caching** – replaced files keep their URLs, so hard-refresh (`Ctrl+Shift+R`) before deciding something didn't update. When you edit `css/style.css` or `js/main.js`, bump the `?v=` on their tags in **both** pages: a browser that pairs new HTML with a stale cached `main.js` can break outright (it did once — every sound button stopped working).

## 3D models

The showcase viewers use Google's [`<model-viewer>`](https://modelviewer.dev/) (loaded from jsDelivr in `<head>`) with Draco-compressed **`.glb`** files. Only the Joule viewers carry the **Wire** button (a wireframe overlay); `js/main.js` reaches into model-viewer's internal three.js scene for it, which works with the pinned model-viewer 4.0.0 — re-check it if you ever bump the version.

Heavy sculpts won't run well in a browser, so the pages load decimated, Draco-compressed copies (`*_web.glb`, ~150 k tris, well under 1 MB). Each has a build script in `tools/` — rerun after re-exporting a master (`BLENDER` = `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python`; `--factory-startup` is required, the V-Ray add-on aborts headless Blender otherwise):

```
BLENDER tools/monster_fix.py  -- assets/models 150000   # weld verts, fix normals, decimate, double-sided
BLENDER tools/skull_ao.py     -- assets/models 150000   # decimate, bake AO into bone-tinted vertex colour
BLENDER tools/grogg_ao.py     -- assets/models 150000   # decimate, toad-skin tint + baked AO
BLENDER tools/robot_steel.py  -- assets/models 200000   # join+weld, decimate, steel PBR + baked AO
BLENDER tools/joule_web.py    -- assets/models 2048     # textures capped at 2K, WebP, Draco
BLENDER tools/optimize_models.py -- assets/models 150000 Name1 Name2   # generic: decimate + Draco only
```

Two gotchas learned the hard way: meshes exported as unwelded triangle soup must be welded (`remove_doubles`) *before* decimating, or Decimate deletes faces instead of collapsing edges; and vertex colours are linear in glTF, so pick colours in sRGB and convert (see `skull_ao.py`).

`Grogg.glb` and `Monster.glb` have no Blender source anywhere on the drive — they are the only masters, keep them. `tools/make_models.py` is the original placeholder generator and **writes `assets/models/robot.glb`**, which is now the real robot master — don't run it.

## Tweaking the look

Colours, fonts and the diagonal cut size (`--angle`) are CSS custom properties at the top of `css/style.css`. Each section's `data-dir="left|right"` sets which way its diagonal leans.

## The labs

Both labs live in this repo and are edited here. They're deliberately low-key: no nav entry, just the muted **Lab:** line in both footers, and each page carries `noindex`.

### Foley Fun (`/foley/`)

Plain HTML/CSS/JS with no build step — edit the files in `foley/` directly. When you change any JS or CSS, bump the `?v=` cache-buster on every tag in `foley/index.html` so visitors don't get a stale mix. `foley/README.md` documents the app itself; `foley/starter-kit/` (the factory pads as JSON) and `foley/archive/dev/` (rebuild tool and regression tests) are its development sources.

Mobile: on screens under 900 px wide (or under 500 px tall) the toolbar folds behind **☰**, the pad grid tightens, and the inspector sits under the board (portrait) or beside it (landscape). On touch, a tap plays a pad and a long-press opens its menu; a swipe that turns into a scroll never plays anything.

### CollisionLab (`/collisionlab/`)

A LÖVE 11.x program running in the browser through [love.js](https://github.com/Davidobot/love.js). The Lua lives in **`collisionlab/src`**; after changing it, rebuild the web runtime:

```
powershell -ExecutionPolicy Bypass -File tools\build-collisionlab.ps1
```

The script zips `collisionlab/src` into a `.love`, runs love.js in *compatibility* mode (works on any static host, no special headers) and copies the runtime (`love.wasm`, `love.js`, `game.js`, `game.data`) into `collisionlab/`. The wrapper `collisionlab/index.html` is hand-written and never overwritten. Needs Node.js; love.js installs itself into `tools\node_modules` on first run. To try a change on the desktop first, run `love collisionlab/src`.

How it adapts to phones:

- `conf.lua` makes the window **resizable from creation**. In the browser that is what makes the canvas render at the size of its CSS box (and follow it on rotation) — otherwise love.js renders a fixed 1280×780 and the browser shrinks it to unreadable on a phone.
- `shared/shell.lua` lays the screen out: the original desktop layout at 1000×600 and up; below that, world beside a narrower panel (landscape) or world above the panel (portrait). The narrowphase world view fits the shapes into small views with a camera transform; on desktop at 1280+ it is the identity, so shapes sit exactly where they always have.
- On touch screens (the wrapper passes `--touch`; any touch also switches it on) and on any compact screen, the panel opens with a **toolbar** whose buttons press the same keys as the keyboard shortcuts. One finger drags, two fingers **twist** to rotate (narrowphase) or **pinch** to change the cell size (broadphase), and dragging scrolls the info panel and the field notes.

Gotchas: `Esc` calls `love.event.quit()`, which ends the WASM app — the wrapper offers **Restart**. Fullscreen goes through LÖVE (`F11` → `love.window.setFullscreen`); the wrapper's button sends F11 and is hidden where the browser can't fullscreen a canvas (iPhone). Hosting must serve `.wasm` as `application/wasm` (GitHub Pages does).

## Deploying elsewhere

`tools\build-deploy.ps1` stages exactly what the site serves into `dist\` (masters, lab sources and tooling left out) and checks every referenced file is present — for drag-and-drop hosts such as Cloudflare Pages or Netlify.
