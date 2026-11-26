# Memento

A local desktop workspace for making space: large files, verified duplicates, an interactive disk map, cache cleanup, privacy, and application removal. Process management and the user-configured AI Agent remain first-class tools.

[简体中文](README_ZH.md) · [Architecture and comparison](docs/CROSS_PLATFORM_REBUILD.md) · [Development](docs/LOCAL_AGENT_DEVELOPMENT.md) · [Packaging](docs/RELEASING.md)

## The workspace

- **Overview:** a compact health gauge (green ≥80, amber 50–79, red <50) beside one device panel. CPU uses live samples, memory a segmented bar and storage a ring; the panel expands GPU, battery/power and network data. Metrics enter descending process lists or large files. Cumulative/daily charts count all successful cleanup bytes together, with item/session totals and no repeated recent list. Scores reflect available load/capacity readings, not hardware diagnosis.
- **Smart cleanup:** explicit cache/developer/log rules for each OS; no automatic selections. Cache removal is permanent and requires confirmation.
- **Large files:** size, name and file-type filters over a compact native index. Scans ordinary files on the system drive; system locations, application data, credential directories and Trash are always excluded. Hidden personal directories can be included explicitly. Personal files move to the system Trash after review.
- **Duplicates:** expandable type → duplicate group → copy hierarchy; size → samples → complete BLAKE3 hashes. Defaults to files ≥10 MiB, which is also the minimum; scans the system drive with system locations, application data, credential directories and Trash always excluded; hidden personal directories are optional. Copies can be selected across groups and reviewed in one bottom action; every group retains a verified survivor before the batch starts. Hard links and cloud placeholders are excluded. At least one copy must remain, and contents are checked again before removal.
- **Space explorer:** expandable directory tree on the left, treemap on the right, and breadcrumbs. Scans the system drive, including Users on macOS, with hidden folders and application data excluded by default. The displayed totals reflect that scope; inclusion is optional. Folder picking is removed. The compact index has no two-million-item cutoff. Back to parent is explicit. The chart shows Top 10 + Other; Other opens subsequent groups, including paginated children. A minimum display area preserves ellipsized names and exact byte labels; the tooltip explains that tile geometry is adjusted for readability. Personal file rows offer reviewed Trash actions; protected system/application files are visibly read-only. Successful removals update every retained index and directory chart after success.
- **Privacy:** Browser activity / Browser accounts / Application activity / System activity → app (OS icon) → profile → record → paths. Supported Chromium profiles and Safari history/cookies, recent-item registries and scoped app logs are discovered locally. SQLite sidecars are grouped. Browsers must close first; cookie/session effects appear in confirmation. Passwords, bookmarks and original documents are excluded; selections start empty.
- **Application manager (Utilities):** a startup-warmed, persisted local inventory with actual OS logos, sizes and last-use metadata, bidirectional name/last-use/size column sorting, update/unused filters, Open, Check updates, Update and Ask AI. User/System tabs keep their lists separate; User is the default and System offers no uninstall action; missing usage is shown as unknown. macOS uninstall details show paths, sizes, rebuildable/personal-data labels and expandable children. Related data is optional; an app stays removable when no extra data is found or size measurement fails; the complete app is required, and selected parent/child paths are deduplicated. Updates reuse Homebrew Cask, App Store and Sparkle adapters. Windows/Linux use system tools for package management.
- **Processes:** user-only and CPU descending by default, actual icons, sortable headers, scope/search/pause and inline actions with tooltips. CPU/memory >40% is orange; >65% is red. Interacting freezes row positions. macOS app-helper termination targets its owning app and verifies exit, protecting system/self processes and reused PIDs.
- **AI assistant:** your own provider and model; deterministic evidence, registered actions, an explicit confirmation plan and encrypted local credentials. No hosted Memento backend.
- **Activity / Settings:** cleanup records share the embedded `memento.sqlite` database with encrypted providers, custom app settings, AI conversations and the maintenance ledger. Legacy cleanup JSON is imported once without duplicating records.

Operation outcomes and errors use a centered, persistent dialog instead of page-top alerts or transient toasts. Concurrent notices queue and deduplicate; acknowledgement or Escape closes them and restores focus. Scan progress remains inline.

Useful cleanup/privacy explanations live behind small transparent Help glyphs; Overview, Applications, Processes, History and Space explorer omit redundant help. Data pages use compact toolbars and rows. Results, filters and selections stay available across page and AI navigation. Large files, duplicates, cache and privacy use a shared bottom batch-action bar with count/size, clear selection and one confirmation. The AI task launcher lives in the top bar. Independent file/privacy work runs concurrently; same-scope jobs and all mutations remain ordered, with scoped cancellation and at most two heavy scans. Removals during scanning/hashing are reconciled before results are published. Scan labels distinguish storage analysis, large-file discovery and duplicate discovery. Each file/directory row offers Show in folder and Ask AI; personal-file rows in Space explorer also offer reviewed deletion. Asking opens a dismissible task panel anchored below the top bar while retaining the source; buttons show progress/success and unread results stay visible. Missing providers pause tasks until saved. Results and setup retain a direct return to the original page, including scroll. Tasks support cancellation and retry; the task panel is session-local and completed conversations persist in history. Cleanup animates actual processed-item progress and returns to the remaining results, removing only confirmed successes.

Application inventory starts in the background on launch. The list appears before recursive size measurement, is restored across launches and refreshed by install-directory watchers plus a five-minute check. Unchanged app sizes are reused. Refresh preserves stable IDs and valid file selections; restored cache entries must be live-registered before actions. macOS size measurement uses a separate worker and an eight-second per-bundle limit.

## Stack and platforms

Electron + React + TypeScript provide the shell and existing model integrations. An independently implemented Rust sidecar owns read-only indexing, metadata aggregation, duplicate verification and portable system inspection. macOS uses `getattrlistbulk` with a standard traversal fallback; Windows/Linux use bounded parallel native traversal. Each scan purpose retains its own session; directory and large-file queries reuse that session and are paginated. Successful removals reconcile all retained indexes without a new scan.

macOS, Windows and Linux adapters and x64/arm64 packaging are configured. macOS x64 is locally runtime tested. Windows native code is also cross-compile checked locally; Windows/Linux runtime verification is assigned to the three-OS CI workflow. macOS terminal/startup/service internals remain platform-specific. See the capability matrix and validation boundaries in the architecture document.

## Develop and verify

Requires Node ≥22.13, npm and Rust ≥1.88. Packaging needs the target platform toolchain; macOS packages require the project Developer ID.

```sh
npm ci
npm run dev
npm run dev:web -- --port 4178
npm test
npm run native:test
npm run build
npm run scan:smoke
npm run electron:smoke
npm run ui:smoke -- http://127.0.0.1:4178
```

The browser preview uses explicit demo data and is labeled **Demo workspace**. The packaged app always uses the local IPC/native engine; it never substitutes demo results on errors.

Language catalogs are in `src/shared/locales`. Add a catalog and register its locale in `src/shared/localization.ts`. The language selector and settings validation follow that registry. Catalog parity and interpolation are tested; missing keys fall back to English. Dates and numbers use `Intl`.

## File operations

The Renderer sends IDs, never mutation paths or shell commands. The main process checks selection scope, generation, registered identity and path components again. Personal files and app bundles go to Trash; narrowly scoped caches/history are permanently removed only after a separate confirmation. System/app-data directories are protected in the large-file browser. Cleanup records report processed bytes as estimates; they do not claim newly available disk space. Local scans do not upload file contents. Asking the AI sends the existing compact maintenance context and the selected file’s path, size and available modification time to your configured provider; this explanation does not read file contents.

Memento remains MIT licensed. MangoDisk was studied as a GPL-3.0 reference; its source and assets were not incorporated.
