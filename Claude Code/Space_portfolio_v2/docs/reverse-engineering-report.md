# Reverse-engineering report: aahana-surya.github.io (analysed with REA)

Date: 2026-10-25. Target: `https://aahana-surya.github.io/` (repo `aahana-surya/aahana-surya.github.io`, last commit
`c0c2eb5`, 2026-10-16). Tool: REA (`morluto/rea`, npm `rea-agents` 6.8.0, released the same day).
Output of the recreation: this folder (`index.html`, `css/`, `js/`, `assets/`), filled with Omkar Gadakh's CV content.

## 0. Summary

- **REA is not a site builder.** It is a TypeScript MCP server and CLI that gives a coding agent *evidence* about shipped
  software (binaries, JS/Electron apps, APKs, websites). For a website, "recreating it with REA" means: REA captures
  and explains the target, the agent writes the new site, then REA drives both sites through the same scripted browser
  scenario so they can be compared.
- **The target is a hand-written static site.** One `index.html` (2,373 lines) holds the markup plus three inline
  scripts; one stylesheet (`main site/styles.css`, 1,602 lines) holds all styling. There is no framework, no bundler,
  no package.json for the site, no source maps and no backend. The only runtime library is **three.js 0.160.0**,
  loaded from jsDelivr through an **import map**. Fonts come from **Google Fonts**. Hosting is **GitHub Pages**.
- **Everything moves on one `requestAnimationFrame` loop.** A classic script owns page state (scroll progress, launch
  progress, pointer) and every DOM effect. A module script owns the WebGL scene and is called from that loop once per
  frame. CSS custom properties (`--p`, `--hero-out`) carry scroll state into the stylesheet.
- **The signature trick** is in Projects: each project "planet" is a real lit three.js sphere, drawn in an
  orthographic scene where one unit is one CSS pixel. Every frame, the script reads an invisible placeholder's
  `getBoundingClientRect()` and moves the sphere onto it. CSS owns the layout and WebGL owns the shading.
- **Since the source is public, most findings below are verified against source**, not inferred. REA's job here was to
  confirm the runtime picture (resources, origins, endpoints, listeners), to drive the browser, and to verify the
  recreation.

### Evidence legend

| Tag | Meaning |
|---|---|
| **[V-src]** | Verified by reading the target's source (cloned from GitHub at `c0c2eb5`) |
| **[V-run]** | Verified at runtime: local mirror or live site in a browser, HTTP responses |
| **[V-rea]** | Reported by an REA tool (Evidence IDs in Appendix A) |
| **[I]** | Inference: consistent with the evidence, not proven by it |
| **[?]** | Unknown: the artefacts cannot settle it |

---

## 1. REA repository inspection

### 1.1 What it is [V-src on `morluto/rea` at `5d42839`]

| Aspect | Finding |
|---|---|
| Package | `rea-agents` 6.8.0, MIT. Bins `rea` and `rea-agents` (`scripts/rea.mjs`) |
| Runtime | Node `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1` (raised in 6.8.0). This Mac has Node 26.5.0: npm prints `EBADENGINE`, but every command used here ran correctly |
| Code | TypeScript, Zod schemas in `src/domain/`, Playwright driver in `src/browser/`, docs per capability in `docs/` |
| Interfaces | Every capability is both an MCP tool and a CLI command. Each returns an **Evidence** record: content-addressed `evidence_id`, provenance, a normalized result, completeness and limitations |
| Setup | `npx rea-agents setup` registers the MCP server and a workflow skill with Claude Code and other agents. Not run here: the CLI was enough and setup edits agent config |

### 1.2 Web tools and how each was used

| CLI command | What it does | Used |
|---|---|---|
| `list-browser-targets` | Lists page targets of a loopback CDP browser | Yes |
| `inspect-web-page` | Passive capture: DOM shape, accessibility tree, scripts, resources, network, console, storage keys | Yes, twice (same-origin, then with CDN origins allowed) |
| `analyze-web-bundle` | Static analysis of captured scripts: chunk graph, routes, endpoints, source maps | Yes (needs the macOS fix in 1.3) |
| `inspect-web-event-listeners` | Listener types and source positions on the first CSS match | Yes, for 3 interactive components |
| `capture-web-screenshot` | One viewport PNG as a self-verifying artifact | Yes |
| `capture-browser-scenario` | Launches its own Chrome via Playwright and runs a declarative action list (`goto`, `click`, `fill`, `press`, `select_option`, `wait_for`, `request`, `wait_for_timeout`) with screenshots/DOM/console per step | Yes, the main tool: 10 scenarios across both sites |
| `compare-web-screenshots`, `compare-web-captures` | Pixel or DOM/network diff of two captures | Not useful here: the two sites have different content by design, so a pixel diff only says "everything changed" |
| `export-web-scripts`, `analyze-javascript-application`, `recover-javascript-sources` | De-bundling and app graphs | Not needed: the source is readable |

Design constraints worth knowing: the CDP tools are **passive** (no navigation, no input, no `Runtime.evaluate`), so
interaction goes through `capture-browser-scenario`. Scenarios have **no hover or scroll action**: hover states were
reached by focusing elements with `press` (the CSS styles `:hover` and `:focus-visible` together), and sections by
clicking nav links. The scenario `environment` defaults to `reduced_motion: "reduce"`; set `"no-preference"` to see
the real animation. It sets viewport size but does not emulate touch, so `(hover: hover)` rules still apply at phone
width.

### 1.3 Running REA on this Mac

```bash
# a throwaway debug Chrome (Chrome 136+ ignores the debug port on the default profile)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 \
  --user-data-dir="$SCRATCH/chrome-profile" --no-first-run http://127.0.0.1:8801/

npx -y rea-agents@6.8.0 list-browser-targets http://127.0.0.1:9222 --format json
npx -y rea-agents@6.8.0 inspect-web-page http://127.0.0.1:9222 <TARGET_ID> --observation-ms 1500 \
  --allowed-origins http://127.0.0.1:8801 --allowed-origins https://cdn.jsdelivr.net \
  --allowed-origins https://fonts.googleapis.com --allowed-origins https://fonts.gstatic.com --format json

# analyze-web-bundle runs scripts through an isolated analyzer that needs REA's macOS helper compiled.
# The system Command Line Tools here are broken, so point REA at the user Swift toolchain:
export REA_DARWIN_SWIFTC_PATH=$HOME/Library/Developer/Toolchains/swift-6.0.3-RELEASE.xctoolchain/usr/bin/swiftc
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk
npx -y rea-agents@6.8.0 analyze-web-bundle http://127.0.0.1:9222 <TARGET_ID> --allowed-origins ... --format json

npx -y rea-agents@6.8.0 inspect-web-event-listeners http://127.0.0.1:9222 <TARGET_ID> '#cloud-stage' --format json
npx -y rea-agents@6.8.0 capture-browser-scenario ./scenario.json --format json > capture.json
```

Gotchas hit in this session:

- `--allowed-origins` is repeated once per origin. A JSON array string is rejected with `invalid_value`.
- Without the two variables, `analyze-web-bundle` returns `worker_failure` for every script but still exits 0
  ([V-rea], first run in Appendix A). Check `route_inventory.sources[].status`.
- Scenario screenshots are inline base64 PNGs in the Evidence JSON (a desktop run with 14 steps is about 30 MB).
  I pulled them out with a 30-line Python script kept outside the project.

### 1.4 What REA reported about the target [V-rea]

- **Scripts:** 3 inline scripts on the page origin (32,446 B classic, 44,097 B module, 276 B classic) plus 11 three.js
  modules from `cdn.jsdelivr.net/npm/three@0.160.0/` (`three.module.js` 1,272,972 B uncompressed, 255,043 B with
  Brotli [V-run]; EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass, Pass, MaskPass, CopyShader,
  LuminosityHighPassShader, OutputShader).
- **Import graph:** 24 static import edges, all resolving to the jsDelivr three.js tree through the import map.
- **Routes: 0. Endpoints: 0.** The 21 low-confidence "endpoint candidates" are WebGL extension names inside three.js
  (`OES_vertex_array_object`, `ANGLE_instanced_arrays`, ...), matched by a generic `extensions.get(...)` detector.
  **No source maps, no WebMCP declarations.**
- **Storage:** no localStorage, sessionStorage, IndexedDB or Cache Storage keys. **Console:** empty during capture.
- **Resources:** stylesheet, Google Fonts CSS and three WOFF2 files (Instrument Serif, Inter Tight, JetBrains Mono),
  the portrait JPEG (111,709 B) and the first constellation plate (`orion.png`, 142,190 B).
- **Listeners** (line numbers match the source exactly):
  - `#cloud-stage`: `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `pointerleave` (source lines 1104 to 1121).
  - `#const-stage`: the same five plus `keydown` (source lines 984 to 998).
  - `.planet-card`: `pointerenter`, `pointerleave`, `focusin`, `focusout` (source lines 2033 to 2036, the module script).

---

## 2. Tech stack

| Layer | Choice | Evidence |
|---|---|---|
| Markup | Hand-written HTML5, all content static in `index.html` | [V-src] |
| Styling | One hand-written CSS file with custom properties, `clamp()` type scale, grid/flex; no preprocessor, no Tailwind, no CSS-in-JS | [V-src] |
| Scripting | Vanilla ES2020+ in inline `<script>` tags; no framework, no build step | [V-src] [V-rea] |
| 3D | three.js 0.160.0 + `examples/jsm` post-processing, via `<script type="importmap">` from jsDelivr | [V-src] [V-rea] |
| Animation | No animation library. CSS transitions/keyframes plus hand-written lerps in one rAF loop | [V-src] |
| Smooth scroll | Custom wheel-driven inertia (not Lenis), writes the real `window.scrollTo` | [V-src] |
| Fonts | Google Fonts: Instrument Serif 400 + italic, Inter Tight 300/400/500, JetBrains Mono 300/400 | [V-src] [V-rea] |
| Hosting | GitHub Pages user site (`server: GitHub.com`, Fastly/Varnish, `cache-control: max-age=600`) | [V-run] |
| Deploy | No `.github/workflows`, so most likely "deploy from branch" on `main` | [I] |
| Backend / APIs | None. No fetch/XHR/WebSocket, no forms, no analytics | [V-src] [V-rea] |
| Third-party snippets | Social-button styling credited "From Uiverse.io by Valeron-T"; GitHub and LinkedIn icon paths match Font Awesome | [V-src] / [I] for Font Awesome |

## 3. Project structure [V-src]

```
index.html                 the live page (markup + 3 inline scripts)
main site/styles.css       the live stylesheet ("main site" has a space, so URLs carry %20)
main site/img/1732426591910.jpeg     portrait
main site/img/constellations/*.png   5 Urania's Mirror plates (78 to 142 KB each), used as CSS masks
reports/                   the 4 downloadable reports (DOCX, PNG, 2 PDFs)
index-2d.html, main site/styles-2d.css   previous Bootstrap 5.3.3 version: unlinked, still deployed
main site/img/{drumkit,qr,todolist,weather-app,wordle,worldcup}.png   used only by index-2d (~2.5 MB)
drumkit/, wordle/, weather-app/, qr-code-generator/   older mini-projects
weather-app/node_modules/.cache/   1.5 MB build cache, committed and deployed
.DS_Store, .vscode/        editor files, committed
```

History: a "3d website created" commit on 2026-09-13 replaced the Bootstrap site; Reports came the same day; the
newest project card came on 2026-10-16.

## 4. Runtime architecture [V-src]

**Layers (z-index):** `#sky-canvas` fixed at -2 (WebGL), `#sky-fallback` at -2 (CSS gradients, shown only with
`.no-webgl`), `.vignette` fixed at -1, page content, header 200, scroll rail 250, preloader 9999, reticle 10000,
cursor dot 10001, skip link 10002.

**Two scripts, one loop.** The classic script defines `state = { scrollY, progress, launchT, clutter, mouseX, mouseY }`
and a `tick()` that, every frame:

1. writes `--p` (page progress 0..1) and `--hero-out` (how far the hero has receded) on `<html>`;
2. computes `clutter`, which fades nebulae and distant planets out before the Skills section;
3. moves the hero satellite, the constellation stars and the skills sphere, and sweeps reveals;
4. calls `skyUpdate(state)` if the three.js module has announced itself.

The module script ends with `window.__skyUpdate = ...` and fires a `sky-ready` event; a third tiny classic script
wires that event to the loop. Module scripts execute after classic ones, so the page works first and the scene joins
when the CDN delivers. If `__skyUpdate` is still missing after 6.5 s, `.no-webgl` switches on the CSS fallback, and
the loader never waits more than 6 s.

**Gating.** `prefers-reduced-motion` and `(hover: hover) and (pointer: fine)` are read once at start. Fine pointer
enables smooth scroll, the reticle and porthole tilt; reduced motion disables smooth scroll, the rocket, the camera
flight and post-processing.

## 5. Section by section

### 5.1 Launch preloader [V-src, V-run]
- The overlay is transparent: the countdown (name, a 1px rule that fills, "Systems check", a two-digit counter) sits
  on top of the canvas, where the rocket stands on a ridge silhouette under a blue horizon glow.
- Real progress: `loaded` gains a third each for `document.fonts.ready`, all `<img>` loaded, and `sky-ready`; a 6 s
  timeout forces 100. The shown value eases 8% per frame toward it, and the counter text is that value capped at 99.
- At 99.5 it waits 220 ms, then runs a 2,600 ms launch: status "Ignition", then "Liftoff" after 12%; the rocket
  climbs on `y = -80 + t^1.8 * 900` with a slight roll; flames stretch; the camera shakes during the first 40%; the
  ground fades out (`1 - 2.6t`); stars brighten; Earth fades in between 35% and 90%; satellites between 50% and 100%.
- At 50% the overlay fades (0.9 s), `body.loading` is removed (content fades in over 1.1 s) and the hero letters start,
  so the two motions overlap.

### 5.2 Cursor [V-src]
A 5px dot follows the pointer with no lag. Four corner brackets (the reticle) chase it with a 0.34 lerp; when the
pointer is over any `a` or `button`, the reticle re-reads that element's rect every frame and wraps it with 8px of
padding. Hidden for touch (`hover: none`), and the system cursor is hidden only after the first pointer move.

### 5.3 Header and scroll rail [V-src]
Fixed header with a top-down dark gradient. Mono uppercase links at 0.66rem with an underline that scales in from the
left and out to the right. A 2px rail across the top has `width: calc(var(--p) * 100%)` with a blue-to-white gradient.
In-page links are intercepted and routed through the inertia scroller.

### 5.4 Hero [V-src]
- `.hero-pin` is 155vh tall with a 100vh sticky stage inside; the extra 55vh is the scroll budget for the exit.
- `--hero-out` drives `translateZ(340px * out)` under `perspective: 1200px`, so the name flies toward the viewer while
  `opacity: 1 - 1.2 * out` fades it.
- The name is split into letter spans with `transition-delay: i * 45ms`; each starts at
  `translate3d(0, .5em, -260px) rotateX(-55deg)` and settles with `cubic-bezier(.16, 1, .3, 1)`.
- An SVG satellite orbits the name on an ellipse (56% of width, 62% of height) with a period of about 30 s. Scale,
  brightness and `z-index` follow its depth, so it passes behind the letters on the far side.
- A pulsing green dot in the "Personal portfolio" pill and a falling line in the "Scroll" cue are CSS keyframes.

### 5.5 About [V-src]
- Porthole: a circular photo inside a 3px gradient bezel with layered shadows, a glass glare and vignette as
  `::after`, and a hairline arc (`stroke-dasharray: 62 240`) spinning once per 26 s. The arc rotates the `<circle>`,
  not the `<svg>`, because a rotating square box grows 1.41x and widened the page on phones (the source comment says so).
- With a fine pointer the porthole tilts up to ±6.5° toward the pointer.
- A "crew record": key/value rows with mono keys, a blue colon, hover tint and a 0.5rem indent.
- Social buttons: 58px squares with two clipped corners, an inset glow and a light sweep on hover.

### 5.6 Projects: the planet system [V-src]
- Cards sit in a 3-column grid (2 at ≤1040px, 1 at ≤760px) with staggered top margins so the row reads as an orbit.
  Margins, not transforms, because `.reveal` owns `transform`.
- Each card holds an invisible `.planet-slot` (`--size` 132 to 170px). The module script builds, per slot, a lit
  sphere with a **procedural Canvas 2D texture keyed to that project's own app palette** (radial "mottle" blobs,
  latitude bands for gas giants, craters with a sun-side rim, an elliptical storm, polar caps; every stamp is drawn
  three times at x-W, x, x+W so the texture wraps), plus an optional ring (`--ring` read from the card's inline style,
  with a striped canvas texture and UVs remapped along the radius) and an optional textured moon on a tilted orbit.
- These spheres live in `projScene` with an orthographic camera sized to the viewport in CSS pixels. Each frame
  `syncWorlds()` reads the slot's rect, places the group at its centre, scales it to the slot radius (+9% on hover,
  eased 12% per frame), spins it, and hides it when it is more than 240px off screen.
- Hover readout, all CSS: a 30px vertical line drops (0.36 s), a rule grows across (0.45 s, 0.22 s delay), then
  the description and CTA fade up (0.4 s delay). On touch the readout is always shown. It is `:hover` only: keyboard
  focus grows the sphere (the JS listens to `focusin`) but never opens the text.
- `.no-webgl` gives each slot a flat radial-gradient disc in `--fallback` with a `--glow` shadow.

### 5.7 Reports: the "Deep Space Network" panel [V-src]
- A blurred translucent panel with a header (tag, hairline, blinking LED, "Signal lock · 04 packets").
- Each row is a 5-column grid: id, title/abstract (the only flexible column), signal trace, meta (signal meter and
  format) and CTA, so the instrument columns line up whatever the title length.
- The trace is an SVG polyline from a seeded linear congruential generator, so each row's noise is stable across
  reloads. It is drawn twice end to end in an SVG twice the container width and slid by -50% in a 3.4 s loop
  (1.3 s on hover), which loops with no seam. Edges fade with a CSS mask.
- The signal meter is two `repeating-linear-gradient` layers with the same 4px-on/3px-off ticks; the lit layer's width
  is `--sig` from the row's inline style.
- The abstract opens with `grid-template-rows: 0fr → 1fr` (no guessed max-height). Below 1040px the trace column is
  dropped; below 700px the meta and CTA wrap under the title. On touch, abstracts and CTAs are always shown.

### 5.8 Experience: swipeable constellations [V-src]
- Five formations (Orion, Cassiopeia, Ursa Major, Perseus, Leo) with star positions normalised to 0..1 and stretched
  to fill a 4:3 box fitted inside the stage. Five of each pattern's stars carry the five roles; the rest are drawn as
  faint companions. Behind them, the matching plate from Sidney Hall's *Urania's Mirror* (1825, public domain) is a
  white block masked by the line art (`mask-image: var(--art)`), cross-faded by fading out, swapping the mask after
  220 ms and fading back, because masks cannot transition.
- Stars are DOM elements with a 44px hit button; labels are placed by a **greedy collision search** (beside the star on
  the outer side first, then nudged up and down, then above or below; first spot inside the stage with zero overlap,
  else the least overlap). A dashed leader line joins a label that had to move far from its star.
- Star positions ease 9% per frame toward the new formation, and the SVG lines follow every frame.
- Change formation with the arrows, the dots (7px of ink, 32px hit area), arrow keys on the focused stage, or a
  horizontal swipe over 55px (vertical drags are left to the page; `touch-action: pan-y`).
- Stage aspect: 16:9 (max 560px), 4:3 at ≤900px, 5:7 at ≤760px with smaller labels.

### 5.9 Skills: the tag sphere [V-src]
- 39 tags in 4 colour-coded categories, sized by `data-weight` (0.9, 0.7, 0.56rem).
- Points on a Fibonacci sphere; each frame they are rotated (Y then X) and perspective-projected with focal length
  1.9r, so near tags are larger; opacity is `0.12 + 0.88 * depth²` and `z-index` follows depth. The radius is clamped
  to 1.2r on both axes because perspective can push a projected point to about 1.175r (the comment derives it).
- Idle spin, drag to rotate (0.005 rad per px) with inertia that relaxes back to the idle speed; rendering pauses off
  screen (IntersectionObserver). Filter pills dim non-matching tags to 10% and glow the matches.
- Below a 560px stage width the sphere becomes a flat wrapped list.

### 5.10 Background scene [V-src]
- **Sky:** a fullscreen quad shader: two-colour vertical gradient that darkens with progress, a horizon glow, a
  three-sine ridge silhouette (removed after launch) and faint noise against banding.
- **Stars:** 7,000 points (2,600 on phones) in a cylinder 3,000 units deep, 14% blue and 8% warm tints, additive.
  **Dust:** 600 near points that fade in with progress and travel with the camera. **Nebulae:** 5 huge additive
  sprites that drift.
- **Earth:** a sphere (radius 900, 192×128 segments) at (0, -1150, -700) with a **1024×512 texture computed pixel by
  pixel in JS** (value-noise fBm for height, a second noise for biome, latitude ice caps, feathered coasts) and a
  separate cloud shell; a Moon; three box satellites.
- **Camera:** flies forward `-progress * 1800` units, with pointer parallax (±42/±28, eased 4.5% per frame).
- **Distant planets:** 5 spheres with faint wireframe overlays, held at a fixed distance ahead of the moving camera
  (otherwise the flight would run into them), faded in at set progress points. **Meteors:** 4 lines after 30%.
- **Post-processing** (only at ≥900px and without reduced motion): sky pass, scene pass, project-worlds pass,
  `UnrealBloomPass(0.62, 0.62, 0.72)`, a grade pass (cool shadows, slight S-curve, vignette, film grain from a
  sine-free hash so it doesn't streak) and `OutputPass`. Otherwise the three scenes render straight to the canvas.

## 6. Design tokens [V-src]

**Colour**

| Token | Value | Use |
|---|---|---|
| `--void` | `#05070f` | page background |
| `--ink-00 / 10 / 40 / 60 / 80` | `#ffffff`, `#eef1f6`, `#a7afbd`, `#848e9f`, `#4a5464` | text, from headline to faint ids |
| `--accent` | `#8fcaff` | the one accent (labels, focus ring, LED, reticle) |
| `--accent-deep` | `#3b86ff` | selection, rail start, hover fills |
| `--line` / `--line-strong` | white at 10% / 18% | hairlines |
| category colours | `#8fcaff`, `#b39dff`, `#6ee7d5`, `#ffc98f` | skill tags and filter dots |
| sky | `#04060e → #101c3d` near, `#020309 → #070a18` far | WebGL gradient |

**Type:** Instrument Serif for display (hero `clamp(3.2rem, 13vw, 11rem)`, h2 `clamp(2.6rem, 7.5vw, 6rem)`, line-height
0.92 to 0.94, tracking -0.02em); Inter Tight for reading; JetBrains Mono for every small uppercase label (0.58 to
0.74rem, tracking 0.12 to 0.34em). The CSS asks for mono weights 600 and 700, but only 300 and 400 are loaded, so the
browser synthesises the bold [V-src].

**Motion:** one easing, `--ease-out: cubic-bezier(.16, 1, .3, 1)`; reveals 1 s opacity + 1.2 s transform from
`translate3d(0, 42px, -60px)` with 0.1 s steps via `data-delay`; hovers 0.3 to 0.45 s.

**Layout:** sections max 1240px, padding `clamp(5rem, 11vh, 8rem) clamp(1.2rem, 5vw, 3.5rem)`; `html { overflow-x: clip }`
(not `hidden`, which would break `position: sticky`).

## 7. Animation inventory [V-src]

| Effect | Mechanism | Timing |
|---|---|---|
| Preloader title rise | CSS keyframes | 1.1 s, 0.25 s delay |
| Launch | JS on rAF | 2.6 s |
| Hero letters | CSS transitions, staggered delays | 0.7 s opacity, 1 s transform, +45 ms per letter |
| Hero exit | CSS transform from `--hero-out` | scroll-linked |
| Satellite orbit | JS per frame | ~30 s period |
| Pulse dot, scroll cue, LED, porthole arc | CSS keyframes | 1.8 s, 2.1 s, 2.4 s, 26 s |
| Reveals | class added by a per-frame sweep at 88% of viewport height | 1 to 1.2 s |
| Reticle, porthole tilt | JS lerp 0.34 / CSS 0.6 s | per frame |
| Planet readout | CSS transition chain | 0.36 s, 0.45 s, 0.4 s |
| Signal traces | CSS keyframes on SVG | 3.4 s loop, 1.3 s on hover |
| Constellation change | JS lerp 0.09, mask cross-fade | ~0.5 s |
| Skills sphere | JS per frame | continuous |
| Scene: Earth spin, clouds, nebula drift, meteors, exhaust | JS per frame | fixed per-frame steps |

## 8. Responsive behaviour [V-src, V-run at 1440×900 and 390×844]

| Breakpoint | Changes |
|---|---|
| ≤1040px | planets 2 columns; signal trace column removed |
| ≤900px | About stacks; nav tighter; constellation stage 4:3 |
| ≤760px | hero 150vh; planets 1 column, slot capped at 38vw (rings reach 2.15x radius); constellation 5:7 with smaller labels; record rows stack; skills stage 380px; scene uses fewer stars and dust |
| ≤700px | report rows wrap meta and CTA under the title |
| ≤560px | nav and logo shrink to 0.5 to 0.55rem |
| ≤360px | logo hidden, nav spreads full width |
| skills stage < 560px | sphere becomes a wrapped list |
| `hover: none` | no custom cursor; planet readouts and report abstracts always visible |
| reduced motion | all CSS motion ~0; reveals and letters shown; hero not pinned; no rocket, flight or post-processing |
| no WebGL | CSS gradient sky and flat planet discs |

## 9. Issues found in the target

| # | Finding | Evidence |
|---|---|---|
| 1 | Animation speed depends on refresh rate: the scene adds `time += 0.016` and fixed per-frame steps, and lerps are per frame, so a 120 Hz display runs Earth spin, meteors, nebula drift and exhaust at twice the speed | [V-src] |
| 2 | The Earth texture is a synchronous 1024×512 per-pixel JS loop (several fBm noise calls per pixel) at module start, on the main thread while the countdown is animating | [V-src]; size of the stall not measured [?] |
| 3 | Deep links do nothing: `body.loading { overflow: hidden; height: 100vh }` blocks the browser's jump to `#projects`, and nothing scrolls there after loading | [V-run] (REA scenario on `/#projects` stays on the hero) |
| 4 | Wheel events are always `preventDefault`ed and replaced by a 9%-per-frame lerp; native trackpad momentum is lost | [V-src] |
| 5 | No favicon link, so `/favicon.ico` 404s | [V-run] |
| 6 | Mono 600/700 used but not loaded (faux bold) | [V-src] |
| 7 | Dead weight deployed: `index-2d.html` + Bootstrap CSS, ~2.5 MB of screenshots only it uses, a 1.5 MB `node_modules/.cache`, `.DS_Store`; dead CSS (`.planet-ring`, `.split-line`, `.eyebrow`, `.hero-lead`) | [V-src] |
| 8 | Star buttons are labelled with the organisation only; role and dates are not announced | [V-src] |
| 9 | Planet readouts never open for keyboard users (`:hover` only) | [V-src] |

---

## 10. How to recreate it with REA (the workflow used here)

1. **Read the tool, not the marketing.** Clone `morluto/rea`, read `docs/browser-observation.md` and
   `docs/browser-scenario-contract.md`, and list commands with `npx -y rea-agents@6.8.0 --help`.
2. **Mirror the target locally** when the source is public (`git clone`, then
   `python3 -I -m http.server 8801 --directory <clone>`), so captures are repeatable and off the live site.
3. **Passive evidence** on a debug Chrome: `list-browser-targets` → `inspect-web-page` (allow the CDN and font
   origins) → `analyze-web-bundle` (with the macOS variables) → `inspect-web-event-listeners` on each interactive
   component. This answers "what loads, from where, what talks to a server, what listens to input".
4. **Scripted visual evidence:** one `capture-browser-scenario` JSON per viewport that waits through the launch and
   clicks each nav link, with `after_each_step: ["screenshot"]` and `events: ["console", "page-errors"]`, and
   `reduced_motion: "no-preference"`.
5. **Write the new site** (the agent's job; REA does not generate code).
6. **Verify with the same scenario**: copy the JSON, change only the port and any renamed selector, and run it against
   the new site. Review the screenshots side by side with the target's, and treat any console error or page error as
   a failure. Add focused scenarios for states the nav run misses: `press` on an element to trigger focus states,
   `click` on filters and arrows, a `reduced_motion: "reduce"` run, and a deep-link `start_url`.

### 10.1 What was built

Same stack as the target (static HTML, one CSS file, vanilla JS modules, three.js 0.160.0 from jsDelivr through an
import map, Google Fonts), so it deploys to GitHub Pages as is. The code is new, not copied: the target repo has **no
licence**, so its code is all-rights-reserved by default. The design vocabulary (layers, tokens, interactions) follows
the analysis above.

| Area | Target | This build |
|---|---|---|
| Files | everything inline in `index.html` | `index.html`, `css/styles.css`, `js/main.js` (page + loop), `js/sky.js` (scene) |
| Planet surfaces | Canvas 2D textures; Earth computed per pixel in JS at load | project worlds: one GLSL planet shader (terran / rocky / gas) with 3D noise per fragment, no main-thread texture work. Earth: NASA imagery (see 10.5) |
| Timing | per-frame constants | everything scaled by frame time (`dt`), same speed at 60 and 120 Hz |
| Constellations | hand-normalised positions, 4:3 box, engraved plates | positions computed at runtime from real RA/Dec (J2000), fitted to the whole stage with stretch capped at 1.6x; no plates (the target's processed plates were not reused) |
| Deep links | ignored | after the launch, scrolls to `location.hash` |
| About record | `div` rows | `dl`/`dt`/`dd` |
| Star buttons | organisation only | organisation, role and dates in `aria-label` |
| Planet readout | `:hover` only | `:hover` and `:focus-visible` |
| Fonts | mono 300/400 | mono 300/400/600/700 (no faux bold) |
| Favicon | 404 | inline SVG |
| Content | Aahana's | Omkar's CV (see 10.2) |

### 10.2 Content sources and decisions

- **Primary source: `~/Desktop/omkar_gadakh_cv.pdf`** (the academic CV). The Applied AI resume was used only for
  things the CV does not contradict: the "Applied AI engineer" tag and Docker, SQL and Hugging Face Spaces in Skills.
  Where the two disagree, the CV wins: RAG Hit@5 0.61 → 0.74 (not "25% context precision"), Atlas 97% vs 36% cited
  URLs resolving (not "95% citation reachability, 9.2/10"), NutriNet 148/150 vs 145/150 (not "98.47%").
- **Excluded on purpose:** phone number, referee name and email, LeetCode. GPA is 8.42/10.
- **Links** come from the hyperlinks embedded in the CV PDF and the public repos on `github.com/omkar00004`.
- **Portrait:** first a crop of the 3D avatar from the GitHub profile README; since 2026-10-26 the user's own photo
  (white background flood-filled from the edges to transparent, edge softened, square crop), `assets/portrait.webp`
  (18 KB), used in the About porthole and the Contact avatar.
- **Experience has 4 stars**, not 5: the two roles (Diebold Nixdorf, GDG Nashik) and the two honours (MET Enthusia 2026
  Title Winner, ICSSCC 2026 presentation). The CV gives no months for the honours, so they show "2026".
- **"Reports" became "Research"**: two publications plus the two study write-ups (Tainted Evidence, RAG evaluation).

### 10.3 Verification

- `node scripts/check.mjs`: passes (no phone or referee details, no "9.55", no em dashes, no text left over from the
  target, `rel="noopener"` on every new-tab link; 20 links).
- REA scenarios on the new site (Appendix A): desktop 1440×900 through every section, phone 390×844, focus states
  (planet readout, research abstract), skill filter, constellation switch, reduced motion, deep link `/#projects`.
  Final runs logged **0 console errors and 0 page errors** (the first run found the favicon 404, now fixed).
- Bugs found and fixed through those screenshots: the Earth's ice cap was oversized and faced the camera (blown out
  by bloom); the rim light used the camera axis instead of the per-pixel view direction (the whole Earth glowed);
  phone constellation labels crowded in a 4:3 box.

### 10.4 Not verified

- Real touch devices (REA scenarios cannot emulate touch, so `(hover: none)` rules were checked only by reading CSS).
- Safari and Firefox; GPU cost on low-end phones; the no-WebGL fallback (code path only).
- Live link targets were taken from the CV and the GitHub API, not clicked through one by one.

### 10.5 Additions after the first build (not in the target)

| Addition | How it works | Verified |
|---|---|---|
| Real Earth | NASA Blue Marble NG surface (4096×2048 WebP on desktop, 2048 on phones), Black Marble 2016 city lights, Blue Marble clouds, and an ocean mask derived from the surface map (blue leads red). One shader: soft terminator, sun glint on water only, drifting clouds, city lights on the night side, haze toward the limb; plus a back-face atmosphere shell for the blue horizon. Turned so India and Sri Lanka sit at the visible limb. The launch waits for these textures (`sky-loaded`) so the Earth never shows blank | REA screenshot, desktop and phone |
| Floating Roadster | The Falcon Heavy payload (2018). First a code-built car; now the real "2011 Tesla Roadster 2.5 Sport" by Ddiaz Design (CC BY-NC-SA 4.0), downloaded by the user. Made open-top with a glTF-Transform script that drops triangles by position (hardtop panel, side glass, roof trim, headliner), checked by rendering it in a scratch viewer through REA scenarios; then resized to 1024 px WebP textures and meshopt-compressed (8 MB to 0.95 MB). Loaded with `GLTFLoader` + `MeshoptDecoder`; transmission glass becomes plain transparent glass (no extra render pass); the paint reflects a small generated environment (black space, blue Earth below, the sun); materials are transparent only while fading. Starman (torso, helmet, visor, one hand on the wheel, one arm on the door) is drawn in the model's own metre units in the left-hand seat, placed using seat measurements from the interior mesh | REA screenshots, desktop 2× and phone, 0 console errors |
| Sketchfab model | The linked "Tesla in space" by tashtego is not downloadable and has no licence, so it was never put in the WebGL scene; for a while it sat in a "Payload" panel in Contact through Sketchfab's official embed, with the hero car scrolling to it. **Removed at the user's request**, together with the car's click target; the floating car is now decoration only | Contact re-captured without it, 0 console errors |
| Contact + rocket | Laid out after the user's reference: a large headline ("Let's launch something together"), five numbered questions as a launch countdown (T-05 to T-01; each turns green once validly filled, via `:has()`), a round "Send message" button sitting on the last line with an orbit ring, and a side column (avatar, email, location, socials). No phone number or résumé link, because both CVs carry private details. Submit plays a launch: the rocket icon in the button straightens, grows, shakes at ignition and accelerates off the top of the screen trailing smoke (rAF path + Web Animations puffs; skipped for reduced motion). Delivery: Web3Forms JSON POST with the user's access key; a honeypot field drops simple bots | REA scenarios at 1440×900 and 390×844 on a scratch copy with `fetch` stubbed, so no real message was sent |

**Launch smoothness (2026-10-26).** Measured with a frame-time probe injected into scratch copies (every frame over
34 ms in the first 12 s), at 1440×900 @2×, two runs each, through REA scenarios:

| | Long frames | Worst | When |
|---|---|---|---|
| Before | 7 to 10 | 333 / 833 ms | 2.8 to 4.4 s, i.e. during liftoff (freezes of 250 to 833 ms) |
| After | 4 | 217 ms | all within the first 0.9 s (countdown just starting); none during or after liftoff |

Causes and fixes: shaders for the Earth and the car's ~19 materials compiled the first time they were drawn, and the
4K Earth and car textures uploaded at that moment, both mid-launch. Now a warm-up during the countdown decodes and
uploads every texture (one per frame) and compiles every program with `compileAsync`, with hidden objects shown only
while the scene is walked and with the composer's render target bound, so the variants match what is drawn later;
the countdown waits for it (`sky-loaded`). The car's fade-in toggled `transparent`, which forces new shader variants at
full opacity, so it now glides in from the right instead. Render resolution is capped at 1.5× (frames per 12 s:
590 to 637 before, about 690 after). The car's reflected sun was dimmed (60 to 14) because it bloomed into a red haze.

The footer credit became a small "Credits" toggle (`<details>`); the car licence requires attribution, and a link to it
is enough. The NASA line was dropped (NASA imagery needs no credit).

REA gotchas met while testing these: `fill` takes `{"source": "literal", "value": "..."}`, not a bare string; some
runs ended with `cleanup_incomplete` (browser close timed out after 30 s) although every step ran, and the
screenshots are still inside the error envelope's partial observation. The Sketchfab viewer logs a permissions-policy
warning unless the iframe allows `accelerometer; gyroscope`.

---

## Appendix A: REA Evidence IDs

| Run | Evidence ID |
|---|---|
| `list-browser-targets` (target mirror) | `ev_e553650a4fa653c0eae815d8a196d91899b77b49fa44fb9ade39267174b8f8fa` |
| `inspect-web-page`, same origin, with accessibility/console/storage | `ev_c56a61022fb45475226169fa162df844305ff58304677068dc390c8541e39e45` |
| `inspect-web-page`, CDN and font origins allowed | `ev_7416d7d108d1859563b38f75046e754a69a71f6864a110c1e507c6c318bed33f` |
| `analyze-web-bundle` without the macOS fix (all `worker_failure`) | `ev_e774ba20600c0c587733fc19e1ab221677e806cc8ae95f6a222d0dc331b7ce8b` |
| `analyze-web-bundle` with the fix (14 scripts, 24 edges, 0 routes, 0 endpoints) | `ev_3186948f0942e39b39f0659b17646871254cf2e70b2b4d235c11848db5ccca65` |
| `capture-web-screenshot` | `ev_ec8122492f88acfc09d0dd04452eabb5e6cb606c10babcb2fc26bd3a9f05ce57` |
| listeners `#cloud-stage` | `ev_2a60d1933d283db3167b4226632e707ab0cc330a2d505cf3f68b1225d5e1e55d` |
| listeners `#const-stage` | `ev_fde79addbc9af201fc4eeb8b7e08c3a2ea0d49c40f00d979bf3d349d9a7bac4f` |
| listeners `.planet-card` | `ev_1dc007a2b36a397c7cbdb223dfb81641f791f7963cd71496cd6c378b3d6860c4` |
| scenario: target, desktop | `ev_3e872de3d80d3ada490b4fc3826164b9da1a5c98acff927ef0d7e4dcc1779207` |
| scenario: target, phone | `ev_592049b583ea987e8cae24fb50f173ca125d1a7400b57024bff6cba984923923` |
| scenario: target, deep link `/#projects` | `ev_bae9ac5da4d44185b967b38afba1c481569c7570ce5cff8ca43a59b5bf302c43` |
| scenario: new site, desktop (final) | `ev_5a8ca1c2fbbf5eb52ea762a6dc29682eb36a7c3e7937078edfa8e19e4db3c6dd` |
| scenario: new site, phone (final) | `ev_4b022fb7e6c5d7ff6b811cd3cd382b680967567e755765280c47c981051f393a` |
| scenario: new site, focus / filter / constellation | `ev_7e61cf78334a722f55dbbad2214e8323cc559042308dcd1f200394a9d91f1f30` |
| scenario: new site, reduced motion | `ev_5ef2d8d440448c93ccee022654a332c2c4dcebb722cb1c437534c292c3cd370d` |
| scenario: new site, deep link `/#projects` | `ev_f6f61648758943f0b968f377f10e19c743e94558d649ec00812586966c414aaf` |
| scenario: roadster in the hero (first version) | `ev_fb8498237eb8b185de7d2ca9a7f9462405b0fc4a4d493bfec3b331a031e98d70` |
| scenario: NASA Earth | `ev_3c199e0e2819b0c2de0cac45459d5470d0dd69191a6b7b683e285f3d663384e0` |
| scenario: final desktop, all sections + 3D viewer | `ev_7b819bef265a9af1238f6bb59d602f9ccd60289a05ecb6e51272070864030bb0` |
| scenario: final phone, all sections | `ev_0ec12722696cd56a4aeddb0bceb8db9f499024be71e6491b1a6a9d5bc9284784` |
| scenario: countdown contact + launch, desktop (stubbed fetch) | `ev_554e8263317030bbb7e2c78b3cf79c32c8ee4bd4d56cdf5ae81ccbb56b0c4f15` |
| scenario: countdown contact + launch, phone (stubbed fetch) | `ev_a9b0ea2e90bc9a6e363538da7b54d9891135dc78f03ee990c143f57b6a299ebc` |
| scenario: real site at `/#contact`, 0 console errors | `ev_c9c243d991874356f44586df8a05bc7b1461bd0616be2ca2c5390dda3c9292ce` |
| scenario: model viewer, roof parts highlighted | `ev_b502ff2092ec872f89e7c118ff62adbde2f809acb6fd0c8485dc974571433590` |
| scenario: Starman seat calibration (scratch copy) | `ev_b968d70d83e91c0aae797e46a32020f412c9d7048f50ee047d7b4be6745f89b0` |
| scenario: real Roadster in the hero, desktop 2× | `ev_990d16632c5d79fe726099786e228921c31c358b785d78e51079924ea37b4cfc` |
| scenario: real Roadster in the hero, phone 2× | `ev_000aa7430fc97c6b63f397aa0cc66ae484d30093d47952456dbe0a1980efbc35` |
| scenario: Contact without the Payload panel, desktop | `ev_9661923914ff5ad9bd7cf64b71186f46095d33aa088921eaf9fc9561c13773a4` |
| scenario: Contact without the Payload panel, phone | `ev_75b34b8557b031f79ac6202fa55dfe25d4eee57d825e1a91e850a65cb9f7a377` |
| perf probe, before (2 runs) | `ev_5a05faaafa29847b084435060717e3651a4f4c373a6c8eb77e27faa6b8972f49`, `ev_af552988f8a8a24f76abfbca2c91d427b76b78231c2b6e3251f61cba812847b0` |
| perf probe, after (2 runs) | `ev_b77d3161cb9d51d36593a880f3d08942732e99b7ee56a3a18cca40ac18fbeef9`, `ev_974fa64c46f2d3143394e48740771bfdc1c96c56e1b5025585389f5331bebb4c` |
| scenario: car glide-in and Credits toggle | `ev_946625f9033cb014121f98a9112e6c82ba70b9a450c8e023002115cee24b8628` |

Evidence JSON and screenshots were written to this session's scratchpad, not to the project, because the target's
screenshots contain another person's photo and details.
