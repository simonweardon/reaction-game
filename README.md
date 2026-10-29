# Reflex Run — Reaction Time Trainer

A fast-paced, endless browser reaction game. Targets pop up one after another at random spots on the screen — tap each one as fast as you can. Levels never run out: each one is faster, tighter and smaller than the last, and you have **3 lives**.

Plain HTML, CSS and JavaScript. No build step, no dependencies, no backend.

## How to play

1. Press **Play**. A quick **3-2-1-GO** countdown starts the run.
2. A glowing target appears. **Tap or click it** before the ring around it closes.
3. As soon as you hit it, the next target appears after a short random delay.
4. Each level is a fresh random batch of **4–6 targets**. Clear it and the next level starts right away, faster than before.
5. There is **no final level**. The run keeps going until you've lost all **3 lives**.

### What costs a life

Any miss costs one life:

| Miss | When |
|------|------|
| **Miss** | You tap empty space while a target is showing (the target stays up, so you can still hit it) |
| **Too early** | You tap while no target is showing (no guessing!) |
| **Too slow** | The ring closes before you hit the target |

### The speed ramp

Level 1 is already snappy, and every level after it scales the previous values exponentially:

| | Level 1 | Per level | Floor |
|---|---|---|---|
| Gap between targets | 250–450 ms | × 0.89 | 80–140 ms |
| Target lifetime | 900 ms | × 0.90 | 320 ms |
| Target size | 70 px | × 0.94 | 36 px |

All three hit their floors at around level 11–12, so from there on the game is as fast as it gets: brutal, but still humanly possible. Within each level, every target's gap, lifetime (±8%) and size (±8%) are randomized, and positions are random with a minimum jump distance from the previous target. No two runs are the same.

The HUD's **Speed** shows how much faster a full appear-and-expire cycle is than on level 1. It goes from 1.0× up to about 2.9× at the floor.

### Scoring

- Each hit scores `max(50, 1000 − reaction ms)` points, multiplied by the level multiplier: `1 + 0.2 × (level − 1)`, so ×1.0, ×1.2, ×1.4 and so on, with no cap.
- Misses don't cost points. They cost lives.

### Stats

- **During the run:** level, speed (× level 1), lives (♥♥♥), last reaction time (colour-coded), score, elapsed time and a progress bar for the current level.
- **At the end:** level reached, score, total time, average reaction, fastest tap, hits, misses (broken down by type), accuracy %, average reaction per level, and every tap's reaction time.
- **Best level** and **best score** are saved in your browser's `localStorage` (key `reflex-run:best:v2`, so old 5-stage bests are ignored). The start screen shows both. On the end screen, a **New best** badge appears and the record you beat is highlighted. Use **Reset best** on the start screen to clear both.

### Controls

- **Touch or mouse.** Taps register on touch-down, so there's no click delay on mobile.
- **Enter / Space**: start a run from the menu or end screen.
- **Esc** or the **×** button: quit the current run.
- **Sound** toggle on the start screen (the setting is saved).
- If you switch tabs or apps during a run, the run is abandoned, because the timing would no longer mean anything.

## How to run

### Option 1: open the file

Double-click `index.html`, or open it in any modern browser. That's all you need.

### Option 2: serve it statically

```bash
# Python 3
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000>.

### Option 3: GitHub Pages

`index.html` is at the root of the repo, so Pages works as-is:

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick your branch (e.g. `main`) and the **`/ (root)`** folder, then save.
4. Your game will be live at `https://<user>.github.io/<repo>/`.

All asset paths are relative, so the game also works from a project sub-path.

## Project structure

```
index.html   # markup for the start, game and end screens
style.css    # dark UI, target and feedback animations, responsive layout
game.js      # level generation, game loop, input, scoring, persistence, sound
README.md
.gitignore
```

### Tuning difficulty

Open `game.js` and edit the constants at the top:

- `BASE`: level 1 delay range, lifetime and size.
- `DECAY`: per-level multipliers (smaller = steeper ramp).
- `FLOOR`: the hardest the game will ever get.
- `LIVES`: lives per run.

`generateLevel()` sets the number of targets per level (`randInt(4, 6)`), and `levelParams()` sets the score multiplier.

## Browser support

Any current Chrome, Edge, Firefox or Safari (desktop and mobile). The game uses Pointer Events, CSS custom properties, `localStorage` and (optionally) the Web Audio API. If `localStorage` is unavailable (for example in some private modes), the game still works but won't save best scores.

## Deploy

This repo includes a `package.json` and `railway.json` so Railway can serve the static site with `serve` on `$PORT`.

```bash
npm install
npm start
```

