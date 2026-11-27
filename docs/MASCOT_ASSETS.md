# Memento border collie and scan games

The approved identity is a left-facing, upright-eared border collie with a confident eye and mischievous smile. `docs/assets/collie-approved.png` preserves the user-selected image. Its clean traced silhouette lives in `src/renderer/src/assets/mascot/collie-mark.svg`, using `currentColor` so all UI branding follows the active theme. The game dog uses the same head; its in-game head faces its travel direction.

| Source | Purpose |
| --- | --- |
| `docs/assets/collie-approved.png` | Approved concept image, retained as the identity reference |
| `src/renderer/src/assets/mascot/collie-mark.svg` | Themeable vector tracing of the approved left-facing logo |
| `src/renderer/src/CollieMark.tsx` / `CollieMark.css` | Sidebar and advisor mark |
| `scripts/generate-icon.mjs` | PNG/ICNS exports and startup markup synchronization |
| `src/renderer/src/scan-game.ts` | Deterministic physics, seeded object generation, collision and scoring |
| `src/renderer/src/ScanGame.tsx` / `ScanGame.css` | SVG game rendering, keyboard/touch input, pause and local best scores |
| `scripts/scan-games-smoke.mjs` | Interactive game coverage, included in the four-viewport UI suite |

`npm run icon` exports the canonical SVG to `build/icon.png` and `build/icon.icns` on macOS, and synchronizes the startup mark. The native icon uses the default theme's `#355e49` ink on a light tile; runtime marks and game art inherit the active theme. The approved image was traced with Potrace 1.16 (`--flat --turdsize 8 --opttolerance 0.4`) after a BMP export with macOS `sips`. The tracing preserves the selected eye, smile and silhouette rather than redrawing a different dog.

## One-button games

Scanning offers three selectable games:

- **Hurdle run / 越障快跑:** jump over logs, scoring distance. A collision ends the round.
- **Frisbee catch / 接飞盘:** time a jump to catch each airborne disc for ten points. Three misses end the round.
- **Pond hop / 荷塘跳跃:** jump across water gaps to the next bank, scoring distance. Landing in a gap ends the round.

Space starts a round, jumps, resumes a paused round or retries after a loss. Click/tap does the same. Holding Space does not repeat jumps. Switching games starts a fresh ready state, with separate best scores retained locally under `memento.scan-games.best.v1`. The current score is saved when a round ends, the mode changes or the scan view unmounts.

Games are opt-in and do not autoplay. Offscreen workspaces, hidden documents and window blur pause a running round; Space resumes it. Editable controls, other buttons and modal dialogs retain their normal keyboard behavior. Reduced motion removes decorative scrolling/gait motion; manually started play remains available. A smaller viewBox keeps the character readable in narrow windows.

The game clock never claims to be scan progress. Native scan progress and cancellation stay above the game. Scan completion immediately replaces the game with retained results. Advisor evidence preparation uses its normal status indicator. The former passive story component, timelines and story tests have been removed.

Browser preview accepts `?demoScanMs=90000` for long-running UI verification only. It cannot delay native Electron scans. Physics tests verify playable jumps, catches, collisions, misses, frame-rate consistency and retry/pause behavior. Browser tests cover actual Space input, held-key isolation, the three game modes, scoring, theme inheritance, reduced motion, hidden-view pause, input/modal isolation, cancellation, narrow bounds and immediate scan completion.
