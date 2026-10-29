# Reflex Run — Reaction Time Trainer

A fast-paced, endless browser reaction game. Targets pop up one after another at random spots on the screen — tap each one as fast as you can. Levels never run out: each one is a little faster, tighter and smaller than the last. You have **5 lives** and earn them back with clean play. The game is tuned so a **skilled run lasts about 10 minutes**.

Plain HTML, CSS and JavaScript. No build step, no dependencies, no backend.

## How to play

1. Press **Play**. A quick **3-2-1-GO** countdown starts the run.
2. A glowing target appears. **Tap or click it** before the ring around it closes.
3. As soon as you hit it, the next target appears after a short random delay.
4. Each level is a fresh random batch of **4–6 targets**. Clear it and the next level starts right away, faster than before.
5. There is **no final level**. The run keeps going until you've lost all **5 lives**.

### Lives

You start with **5 lives**. Any miss costs one. Clear **3 levels in a row with zero misses** and you get a life back, up to the maximum of 5. The level banner shows **+1 ♥** when that happens. Any miss resets the clean-level streak. If you're already at 5 lives, the streak still resets, so you can't bank regens.

### What costs a life

| Miss | When |
|------|------|
| **Miss** | You tap empty space while a target is showing (the target stays up, so you can still hit it) |
| **Too early** | You tap while no target is showing (no guessing!) |
| **Too slow** | The ring closes before you hit the target |

### The speed ramp (logarithmic)

Difficulty follows a slow **logarithmic** curve instead of an exponential decay. The early levels tighten quickly, and after that the game keeps getting harder for a long time in smaller and smaller steps:

```
value = max(FLOOR, BASE − K × ln(1 + (level − 1)))      // level is 1-based, so level 1 = BASE
```

| | Level 1 (`BASE`) | `K` | Floor | Floor reached | ≈ time (skilled) |
|---|---|---|---|---|---|
| Gap between targets (min) | 250 ms | 31 | 90 ms | level ~176 | ~9:05 |
| Gap between targets (max) | 450 ms | 56 | 160 ms | level ~179 | ~9:15 |
| Target lifetime | 900 ms | 107 | 340 ms | level ~189 | ~9:45 |
| Target size | 70 px | 6 | 38 px | level ~209 | ~10:40 |

Here's a skilled run, by time:

| Time | Level | Gap | Lifetime | Size |
|---|---|---|---|---|
| 1 min | ~15 | 166–298 ms | 610 ms | 54 px |
| 3 min | ~51 | 128–230 ms | 479 ms | 46 px |
| 5 min | ~89 | 111–199 ms | 420 ms | 43 px |
| 8 min | ~151 | 94–169 ms | 363 ms | 40 px |
| 10 min | ~194 | 90–160 ms | 340 ms | 38 px |

Levels are short (4–6 targets plus a brief banner, about 3 seconds each), so a 10-minute run reaches roughly level 190–200. The floors are brutal but still humanly possible. Once you're there, the score multiplier keeps climbing, and the run usually ends within a minute or two as misses start to outpace regens. Within each level, every target's gap, lifetime (±8%) and size (±8%) are randomized, and positions are random with a minimum jump distance from the previous target. No two runs are the same.

The HUD's **Speed** shows how much faster one full appear-and-expire cycle (lifetime + average gap) is than on level 1. It goes from 1.0× up to about 2.7× at the floors.

#### Why ~10 minutes?

These constants come from a Monte Carlo simulation of a skilled player. In the model, reaction time is about `150 + 0.3 × lifetime + 0.8 × (70 − size)` ms ± 35 ms, so the player speeds up as targets get shorter-lived. Off-target slips are rare and become a little more likely as targets shrink. Early taps never happen. The simulation counts wall-clock time for gaps, reactions, level banners and the countdown. With 5 lives and a regen every 3 clean levels, the median skilled run lasts about **10:00**, with the 10th to 90th percentile at about 8:45 to 12:00. Lives usually stay at 5 until around minute 8, then drain once the floors arrive.

### Scoring

- Each hit scores `max(50, 1000 − reaction ms)` points, multiplied by the level multiplier `1 + 0.05 × (level − 1)`: ×1.0 at level 1, ×6 at level 101, ×10.9 at level 199, with no cap.
- Misses don't cost points. They cost lives.

### Stats

- **During the run:** level, speed (× level 1), lives (♥♥♥♥♥), last reaction time (colour-coded), score, elapsed run time (`m:ss.t`) and a progress bar for the current level.
- **At the end:** time survived, level reached, score, a rating based on survival time, total time, average reaction, fastest tap, hits, misses (broken down by type, plus lives regained), accuracy %, average reaction per level, and every tap's reaction time.
- **Best time** (longest survival), **best level** and **best score** are saved in your browser's `localStorage` under the key `reflex-run:best:v3`. Bests saved under the old 3-life exponential ramp are ignored. The start screen shows all three. On the end screen, a **New best** badge appears and each record you beat is highlighted. Use **Reset best** on the start screen to clear them.

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
- `K`: logarithmic slope for each value. A bigger `K` makes a steeper ramp and reaches the floor sooner. The floor arrives at level ≈ `exp((BASE − FLOOR) / K)`.
- `FLOOR`: the hardest the game will ever get.
- `LIVES`: maximum (and starting) lives.
- `REGEN_EVERY`: how many consecutive clean levels earn a life back.
- `BANNER_MS`: pause between levels (it counts towards run length).

`generateLevel()` sets the number of targets per level (`randInt(4, 6)`), and `levelParams()` sets the score multiplier.

## Browser support

Any current Chrome, Edge, Firefox or Safari (desktop and mobile). The game uses Pointer Events, CSS custom properties, `localStorage` and (optionally) the Web Audio API. If `localStorage` is unavailable (for example in some private modes), the game still works but won't save best scores.

## Deploy

This repo includes a `package.json` and `railway.json` so Railway can serve the static site with `serve` on `$PORT`.

```bash
npm install
npm start
```

