# Omkar Gadakh: space portfolio

A static, single-page portfolio: a rocket launch as the loading screen, then Earth orbit and deep space in WebGL
(three.js 0.160.0 from jsDelivr), with projects as planets, papers on a "deep space network" panel, experience on real
constellations and skills on a draggable sphere. No build step and no backend.

How the design was reverse-engineered with REA: [docs/reverse-engineering-report.md](docs/reverse-engineering-report.md).

## Run locally

```bash
python3 -m http.server 8802 --bind 127.0.0.1
```

Then open http://127.0.0.1:8802/. ES modules don't load from `file://`, so a server is needed.

## Edit content

- Text, links and skills: `index.html`.
- Experience stars and constellations: `JOBS` and `FORMATIONS` at the top of the experience block in `js/main.js`.
- Planet looks per project: `WORLDS` in `js/sky.js`, keyed by each card's `data-world`.
- Portrait: `assets/portrait.webp`.

Before publishing, run the content check (no phone number or referee details, GPA 8.42, no em dashes):

```bash
node scripts/check.mjs
```

## Contact form

The countdown form (T-05 to T-01) sends through [Web3Forms](https://web3forms.com) (free, no server) to the inbox
registered for `WEB3FORMS_KEY` in `js/main.js`. The key is meant to be public: it can only deliver to that inbox. To
test the rocket without sending real mail, serve a copy whose `main.js` starts by stubbing `window.fetch`.

## Credits

- Earth imagery: NASA Visible Earth, Blue Marble Next Generation (surface), Black Marble 2016 (city lights) and
  Blue Marble clouds. Public domain (no on-site credit required). Converted to WebP in `assets/earth/`; the ocean mask is derived from the surface map.
- Floating car: `assets/models/roadster.glb` is based on ["2011 Tesla Roadster 2.5 Sport"](https://sketchfab.com/3d-models/2011-tesla-roadster-25-sport-7f225b841ad44d948b195361b7bc632e)
  by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed
  [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Changes: roof, side glass, roof trim and
  headliner removed to make it open-top like the 2018 payload; textures resized to 1024 px WebP; meshopt-compressed
  (8 MB to 0.95 MB). This modified model is shared under the same licence, and the site credits it behind the footer's "Credits" toggle (keep that toggle).
  Keep the site non-commercial while it uses this model. Starman is drawn in code (`js/sky.js`).

## Deploy

Push this folder to a GitHub repo and enable Pages ("Deploy from a branch", root). Any static host works.
