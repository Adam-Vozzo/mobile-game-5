# Make the Cat Dizzy! 🐱

A Pokémon Ranger–style web game built in vanilla JavaScript. Draw loops around
mischievous cats with your laser pointer to capture them — the more loops you
chain together, the higher your combo and score.

Plays on phones, tablets, and desktop. No build step, no dependencies, no
backend — it's a single static page that runs anywhere.

**[▶ Play it live](https://adam-vozzo.github.io/mobile-game-5/)**

---

## How to play

You are a cat ranger armed with a laser pointer. Cats roam each scene, and
you capture them by **circling them with the laser**.

- **Touch / mouse**: press and hold to draw, release to stop. Each closed loop
  around a cat counts as one capture loop.
- Different cats need a different number of loops — a kitten falls in one,
  while a Persian Royale boss may need seven.
- Build combos by capturing cats in quick succession. At **combo ×10** the
  screen erupts into **HYPERDRIVE**.
- Don't break your line — clearing a level without breaking gives a flawless
  streak bonus.

### Capture mechanics

| Mechanic       | Effect                                                    |
| -------------- | --------------------------------------------------------- |
| Closed loop    | Captures any cat fully enclosed                           |
| Multi‑capture  | Two cats in one loop = **DOUBLE LOOP**, three = **TRIPLE** |
| Perfect loop   | A nicely circular loop earns a **+150 PERFECT** bonus     |
| Hot zones      | ×2 / ×3 / ×5 patches multiply score for catches inside    |
| Catnip         | Softens cats and makes them easier to capture             |
| Treats         | Lure cats to a spot — drop one, then circle them all      |
| Boss roar      | Breaks your line across half the screen; back off briefly |
| Combo ×10      | Enters **HYPERDRIVE** — screen-wide visual overdrive      |

### Controls

| Input                | Action                          |
| -------------------- | ------------------------------- |
| Touch / mouse drag   | Draw the laser trail            |
| `P` or `Esc`         | Pause / resume                  |
| `M`                  | Mute / unmute                   |
| Pause button (top)   | Pause on mobile                 |
| Trophy button (top)  | Open achievement viewer         |
| Paw button (bottom)  | Open the **Catdex** collection  |

---

## Features

- **Seven scenes**: Living Room, Garden, Kitchen, Bedroom, Attic, Cat Café,
  and a pulsing Boss Arena — each with its own art and accent palette.
- **17+ cat types** including bosses (Maine Boss, Sphynx Phantom, Persian
  Royale) tracked in a personal **Catdex**.
- **Procedural music & SFX** generated at runtime via the Web Audio API — no
  audio files shipped.
- **Per-scene weather** for atmosphere.
- **Achievements** with sliding popup notifications.
- **Daily challenge** mode.
- **Ranger ranks** that promote as you catch more cats.
- **Tutorial** for first-time players.
- **Cinematic capture** flourishes, screen shake, particles, ghost trails,
  shockwaves, hitstop, and slow-mo juice.
- **Bouncing yarn balls** that bias cat wander and grant a bonus on nearby
  capture.
- **Hot zones** and **easter eggs** scattered across runs.
- **Settings** panel with sound, motion, and gameplay toggles.
- All progress (best score, max level, Catdex, achievements, streak) is
  persisted to `localStorage`.

---

## Project layout

```
.
├── index.html              Entry point
├── style.css               Layout, HUD, overlays
├── game.js                 Core game loop, rendering, scenes, cats, laser,
│                           capture detection, scoring, audio synth
├── src/
│   ├── achievements.js         Unlock conditions + popup rendering
│   ├── achievement-viewer.js   Trophy button & viewer modal
│   ├── catdex.js               Cat type registry + collection viewer
│   ├── cinematic.js            Capture flourishes
│   ├── daily.js                Daily challenge seed & modifiers
│   ├── easter-eggs.js          Hidden surprises
│   ├── hotzones.js             Score multiplier patches
│   ├── music.js                Procedural music (Web Audio)
│   ├── settings.js             Settings menu
│   ├── tutorial.js             First-time-player walkthrough
│   ├── weather.js              Per-scene ambient weather
│   └── yarn.js                 Bouncing yarn balls
├── .github/workflows/pages.yml GitHub Pages deploy workflow
└── .nojekyll                   Disables Jekyll on GitHub Pages
```

`game.js` exposes a `window.MTCD` hook API that the modules in `src/` plug
into (`MTCD.HOOKS`, `MTCD.FX`, `MTCD.audio`). Each module is loaded as its
own `<script>` tag in `index.html`, so adding a new feature is as simple as
dropping a file into `src/` and adding a script tag.

---

## Running locally

The game is plain HTML/JS/CSS — there's no build step. Any static file
server works.

```bash
# Python (built-in)
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000>.

> Opening `index.html` directly via `file://` mostly works, but some browsers
> block parts of the Web Audio API until a user gesture, and a couple of
> modules expect same-origin paths. Serving over HTTP avoids those edge
> cases.

### Browser support

Modern evergreen browsers (Chrome, Safari, Firefox, Edge). The game uses
`<canvas>`, the Web Audio API, and `localStorage`. On iOS, audio is resumed
on the first tap to comply with autoplay policies.

---

## Deployment

The repo deploys to **GitHub Pages** via
[`.github/workflows/pages.yml`](.github/workflows/pages.yml). Any push to
`main` rebuilds the site by uploading the repository contents as a Pages
artifact and deploying it — no build step, just static files.

To deploy your own fork:

1. Fork the repo on GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow runs and publishes to
   `https://<your-username>.github.io/mobile-game-5/`.

---

## Development notes

- The render loop is wrapped so that thrown exceptions don't kill the whole
  game — a defensive measure after a few `null`-deref bugs around mid-tick
  state changes.
- Most tunable values (combo windows, capture radii, particle counts, scene
  ordering) live as constants near the top of `game.js`.
- `localStorage` keys are all prefixed with `mtcd_` (e.g. `mtcd_best`,
  `mtcd_streak`, `mtcd_catdex`, `mtcd_achievements`, `mtcd_tutorial_done`).
  Clear them in your browser devtools to reset progress.
- `window.G` is exposed on purpose so you can poke the live game state from
  the console.

---

## License

No license file is included. All rights reserved by the author unless and
until a license is added.
