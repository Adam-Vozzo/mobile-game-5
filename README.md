# Make the Cat Dizzy!

A browser-based, mobile-friendly arcade game inspired by Pokémon Ranger. Draw
loops around roaming cats with your finger or mouse — close the loop to capture
them, build combos, climb the ranks, and unlock the Catdex.

The game is a static site: open `index.html` in any modern browser, or play it
deployed via GitHub Pages.

## Playing

- **Draw**: press and drag to extend a glowing line.
- **Capture**: close a loop around one or more cats to fill their capture
  meter. Bigger or rarer cats need more loops.
- **Combo**: capture cats in quick succession to multiply your score and
  trigger Hyperdrive at combo 10+.
- **Don't break the line**: lifting mid-draw breaks your streak and your
  flawless-run bonus.
- **Pause**: `P` or `Esc`, or the ⏸ button.

## Project layout

```
index.html              Entry point; loads the game and all feature modules.
style.css               HUD, overlays, buttons, panels.
game.js                 Core engine: canvas, input, cats, levels, scoring,
                        ranks, audio synth, particles, the main loop.
src/
  achievements.js       Medal system (11 achievements) with persistence.
  achievement-viewer.js Trophy button + panel for browsing achievements.
  catdex.js             Per-cat-type capture log and viewer.
  cinematic.js          "FINAL BLOW" capture cinematic for bosses / level end.
  daily.js              Daily Challenge mode (seeded by UTC date).
  easter-eggs.js        Small surprise interactions.
  hotzones.js           Pulsing bonus-multiplier zones on the field.
  music.js              Procedural ambient music (Web Audio synth).
  settings.js           Quick-settings panel (gear button) with sliders.
  tutorial.js           First-run tutorial overlay.
  weather.js            Per-scene atmospheric particles.
  yarn.js               Bouncing yarn-ball ambient field elements.
.github/workflows/
  pages.yml             Deploys the site to GitHub Pages on push to main.
```

Each module under `src/` is self-contained: it plugs in through the
`window.MTCD` hook API exposed by `game.js` and uses `localStorage` for its own
persistence, so modules can be added or removed without touching the engine.

## Persistence

Progress is stored locally in the browser under `localStorage` keys prefixed
with `mtcd_` (best score, streak, mute state, achievements, Catdex, settings,
tutorial-done flag, etc.). Clearing site data resets the game.

## Running locally

No build step. Either open `index.html` directly, or serve the directory with
any static server, for example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deployment

Pushes to `main` are published to GitHub Pages by `.github/workflows/pages.yml`,
which uploads the repository root as the site artifact. The `.nojekyll` file
disables Jekyll processing so files and folders starting with `_` are served
verbatim.
