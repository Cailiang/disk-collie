# Memento border collie and scan games

The approved identity is a left-facing, upright-eared border collie with a confident eye and mischievous smile. `docs/assets/collie-approved.png` preserves the user-selected image. Its clean traced silhouette lives in `src/renderer/src/assets/mascot/collie-mark.svg`, using `currentColor` so all UI branding follows the active theme. The game dog uses the same head; its in-game head faces its travel direction.

| Source | Purpose |
| --- | --- |
| `docs/assets/collie-approved.png` | Approved concept image, retained as the identity reference |
| `src/renderer/src/assets/mascot/collie-mark.svg` | Themeable vector tracing of the approved left-facing logo |
| `src/renderer/src/CollieMark.tsx` / `CollieMark.css` | Sidebar and advisor mark |
| `scripts/generate-icon.mjs` | PNG/ICNS exports and startup markup synchronization |
| `src/renderer/src/scan-game.ts` | Deterministic physics, seeded object generation, collision and scoring |
| `src/renderer/src/GameScenery.tsx` | Four scrolling landscapes, layered parallax and a day/night cycle |
| `scripts/scan-game-player.mjs` | Long-play browser checks using actual Space input against rendered objects |
| `src/renderer/src/ScanGame.tsx` / `ScanGame.css` | SVG game rendering, keyboard/touch input, pause and local best scores |
| `scripts/scan-games-smoke.mjs` | Interactive game coverage, included in the four-viewport UI suite |

`npm run icon` exports the canonical SVG to `build/icon.png` and `build/icon.icns` on macOS, and synchronizes the startup mark. The native icon uses the default theme's `#355e49` ink on a light tile; runtime marks and game art inherit the active theme. The approved image was traced with Potrace 1.16 (`--flat --turdsize 8 --opttolerance 0.4`) after a BMP export with macOS `sips`. The tracing preserves the selected eye, smile and silhouette rather than redrawing a different dog.

## One-button games

Scanning offers three selectable games:

- **Hurdle run / 越障快跑:** jump over stumps, rock piles, paired cones, hedges, hurdles, double/triple logs, rolling balls and low birds. High birds can pass overhead while the dog stays grounded. Optional bone treats add points. A collision ends the round.
- **Frisbee catch / 接飞盘:** catch flat, low, high, curved and paired formations. Low discs allow a grounded catch; lofted discs and catch streaks add bonus points. Missing a whole formation uses one of three chances; a partly caught pair is not counted twice.
- **Pond hop / 荷塘跳跃:** cross streams, wider water, broken bridges, closely spaced stone channels and multi-jump islands. Full group spans and landing/reaction gaps are reserved before spawning. Landing in a gap ends the round.

Since 1.0.22, a shuffled bag prevents repetitive obstacle sequences. New patterns unlock as distance increases, including three-log clusters later in a round; object dimensions, heights and grouping affect jump timing. The UI starts each new game/mode with fresh randomness, while explicit seeds make physics checks repeatable. Speed rises gradually to a cap. Optional treats and frisbee streaks add score goals.

The route crosses meadow, pine woods, river valley and village panoramas. Clouds, distant hills, trees/buildings and ground details scroll at different speeds; terrain crossfades every 1,900 distance units. A separate 11,800-unit day/dusk/night/dawn cycle changes the sun, moon, stars and theme-colored sky tint. The local game never switches the application theme. Reduced motion freezes decorative parallax, gait and windmills; manually initiated gameplay and route progression remain available.

Space starts a round, jumps, resumes a paused round or retries after a loss. Click/tap does the same. Holding Space does not repeat jumps. Switching games starts a fresh ready state, with separate best scores retained locally under `memento.scan-games.best.v1`. The current score is saved when a round ends, the mode changes or the scan view unmounts.

Games are opt-in and do not autoplay. Offscreen workspaces, hidden documents and window blur pause a running round; Space resumes it. Editable controls, other buttons and modal dialogs retain their normal keyboard behavior. Reduced motion removes decorative scrolling/gait motion; manually started play remains available. A smaller viewBox keeps the character readable in narrow windows.

The game clock never claims to be scan progress. Native scan progress and cancellation stay above the game. Scan completion immediately replaces the game with retained results. Advisor evidence preparation uses its normal status indicator. The former passive story component, timelines and story tests have been removed.

Browser preview accepts `?demoScanMs=90000` for long-running UI verification only. It cannot delay native Electron scans. Physics tests run each mode for two minutes across six seeds without invincibility, verify every obstacle/formation and all four landscapes/light phases, and check spacing, collisions, overhead birds, scoring, frame-rate consistency and pause/retry. Browser tests cover actual Space input, held-key isolation, the three game modes, scoring, theme inheritance, reduced motion, hidden-view pause, input/modal isolation, cancellation, narrow bounds and immediate scan completion. Browser long-play checks use real Space presses against DOM-rendered hazards for 58 seconds of running and 45 seconds each of frisbee/pond play. The browser clock is paused between explicit advances so screenshots cannot consume reaction time. No game state is modified to survive the checks.
