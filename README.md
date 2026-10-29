# Reflex Run — Reaction Time Trainer

A fast-paced browser reaction game. Targets pop up one after another at random spots on the screen — tap each one as fast as you can. Every run is a freshly generated course, and each stage is faster than the last.

Plain HTML, CSS and JavaScript. No build step, no dependencies, no backend.

## How to play

1. Press **Play**. A **3-2-1-GO** countdown starts the run.
2. A glowing target appears. **Tap or click it** before the ring around it closes.
3. As soon as you hit it, the next target appears after a short random delay.
4. Get through all **5 stages** (5, 6, 7, 8 and 9 targets — 35 in total). Each stage brings:
   - shorter, more random gaps between targets,
   - shorter target lifetimes,
   - smaller targets.

### What counts as a miss

| Miss | When |
|------|------|
| **Miss** | You tap empty space while a target is showing (the target stays up, so you can still hit it) |
| **Too early** | You tap while no target is showing (no guessing!) |
| **Too slow** | The ring closes before you hit the target |

### Scoring

- Each hit scores `max(50, 1000 − reaction ms)` points, multiplied by the stage multiplier (×1.0, ×1.25, ×1.5, ×1.75, ×2.0).
- Each miss costs `200 ×` the stage multiplier (the score never goes below 0).

### Stats

- **During the run:** stage, target number, last reaction time (colour-coded), misses, elapsed time, score and a progress bar.
- **At the end:** score, total time, average reaction, fastest tap, hits, misses (broken down by type), accuracy %, average per stage, and every tap's reaction time.
- **Best score** and **best average reaction** are saved in your browser's `localStorage`. A **New best!** badge shows when you beat either one. Use **Reset best** on the start screen to clear them.

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
game.js      # course generation, game loop, input, scoring, persistence, sound
README.md
.gitignore
```

### Tuning difficulty

Open `game.js` and edit `stageParams()` to change the number of targets per stage, the delay range, target lifetime and target size, all interpolated from stage 1 to stage 5. `STAGES` sets how many stages a course has.

## Browser support

Any current Chrome, Edge, Firefox or Safari (desktop and mobile). The game uses Pointer Events, CSS custom properties, `localStorage` and (optionally) the Web Audio API. If `localStorage` is unavailable (for example in some private modes), the game still works but won't save best scores.
