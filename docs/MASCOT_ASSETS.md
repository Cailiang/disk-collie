# Memento line-art border collie

The current mascot is code-drawn SVG line art. It follows the active theme through `currentColor`, `--accent-soft` and `--surface`. No photographs, raster sprite sheets, remote assets or video downloads are used. A reference video is optional for future art direction; the shipped stories are authored directly in this repository.

| Source | Purpose |
| --- | --- |
| `src/renderer/src/assets/mascot/collie-mark.svg` | Canonical right-facing border collie profile: folded ear tip, forehead blaze, long muzzle and neck ruff |
| `src/renderer/src/CollieMark.tsx` | Inline themed sidebar and advisor mark |
| `src/renderer/src/collie-story.ts` | Four twenty-second timelines with continuous pose/prop interpolation |
| `src/renderer/src/MascotScene.tsx` | Articulated legs, tail, face and props; animation clock and story handoff |
| `src/renderer/src/MascotScene.css` | Main scan stage, responsive sizing and controls |
| `scripts/generate-icon.mjs` | Reproducible PNG/ICNS and startup exports from the SVG |

`npm run icon` runs on macOS and exports the SVG to `build/icon.png` and `build/icon.icns`. The native icon uses the default forest-green ink on a quiet light tile. Runtime UI marks inherit the selected theme. The same canonical profile paths are inserted into the pre-React startup markup; its color follows the startup theme. Since 1.0.20, branding uses a side profile with a folded ear tip, forehead blaze, long muzzle, playful tongue and neck ruff. The full-body scan-story artwork is separate.

Each story lasts 20,000 ms and contains at least eight distinct narrative phases:

- Ball: notice → sniff → play bow → nudge → chase → overshoot/skid → rediscover → retrieve → proud wag.
- Frisbee: listen → track → crouch → run-up → leap → catch → wobble on landing → bring back → ask for another throw.
- Tug: pick up rope → brace → pull harder → rope slips → flop → shake it off → happy rest.
- Basketball: paw tap → dribble → first shot → rim rebound → second chance → basket → victory dance.

After an ending, a different story starts automatically. Four stories rotate, with alternate staging direction on the next pass. This replaces the former one-second photographic loop. Next-story and pause/resume controls are available. Reduced motion presents a static pose, disables automatic playback and keeps manual story selection available. Offscreen workspaces suspend their animation clock; hidden documents do not advance poses. Scene time never claims to be scan progress, never delays a finished scan, and does not change cancellation or cleanup behavior.

Initial Deep cleanup/Privacy scanning displays the large stage in the available workspace instead of empty category counts and skeleton rows. File scanning also expands the stage and restores retained result controls after scanning. Actual progress and cancellation stay above the illustration.

Browser preview alone accepts `?demoScanMs=90000` for deterministic long-story QA. Production Electron work always uses real IPC duration; the preview parameter cannot delay native scans. UI coverage uses controlled browser time to verify continuous movement, the full twenty-second handoff, pause/resume, next story, theme changes, reduced motion and viewport bounds. Timeline tests validate story progression, smooth cue boundaries and bounded coordinates.
