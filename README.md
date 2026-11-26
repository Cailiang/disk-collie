# Memento

A local desktop workspace for making space: large files, verified duplicates, an interactive disk map, cache cleanup, privacy, and application removal. Process management and the user-configured AI Agent remain first-class tools.

[简体中文](README_ZH.md) · [Architecture and comparison](docs/CROSS_PLATFORM_REBUILD.md) · [Development](docs/LOCAL_AGENT_DEVELOPMENT.md) · [Packaging](docs/RELEASING.md)

## The workspace

- **Overview:** an explainable health score from available CPU/GPU/memory/storage/battery readings, real CPU/memory sample charts and storage capacity cards. Cards open descending CPU/memory process lists or large files. Cumulative and daily cleanup charts show successful work; permanent cleanup and Trash remain distinct. The score reflects current load/capacity, not hardware diagnosis.
- **Smart cleanup:** explicit cache/developer/log rules for each OS; no automatic selections. Cache removal is permanent and requires confirmation.
- **Large files:** size, name and file-type filters over a compact native index. Scans the system drive, including hidden folders and home Library / AppData by default; a visible option can exclude them. Personal files move to the system Trash after review.
- **Duplicates:** expandable type → duplicate group → copy hierarchy; size → samples → complete BLAKE3 hashes. Defaults to files ≥10 MiB, which is also the minimum; scans the system drive with hidden folders and home app data included by default. Hard links and cloud placeholders are excluded. At least one copy must remain, and contents are checked again before removal.
- **Space explorer:** expandable directory tree on the left, treemap on the right, and breadcrumbs. Scans the system drive, including Users on macOS. Folder picking is removed. The compact index has no two-million-item cutoff. Back to parent is explicit; items too small to label in the proportional treemap remain available in a smaller-item list.
- **Privacy:** expandable browser → profile → record → path hierarchy, including existing SQLite sidecars. Browsers must be closed. Passwords, cookies and personal documents are excluded.
- **Application manager (Utilities):** actual OS logos, local sizes and last-use metadata, name/size/usage sorting, update/unused filters, Open, Check updates, Update and Ask AI. System apps are hidden by default; missing usage is shown as unknown. macOS uninstall details show paths, sizes, rebuildable/personal-data labels and expandable children. Related data is optional; the complete app is required, and selected parent/child paths are deduplicated. Updates reuse Homebrew Cask, App Store and Sparkle adapters. Windows/Linux use system tools for package management.
- **Processes:** user-only and CPU descending by default, actual icons, sortable headers, scope/search/pause and inline actions with tooltips. CPU/memory >40% is orange; >65% is red. Interacting freezes row positions. macOS app-helper termination targets its owning app and verifies exit, protecting system/self processes and reused PIDs.
- **AI assistant:** your own provider and model; deterministic evidence, registered actions, an explicit confirmation plan and encrypted local credentials. No hosted Memento backend.
- **Activity / Settings:** a persistent cleanup record, existing Agent conversations and maintenance ledger, theme, language, providers and application updates.

Useful cleanup/privacy explanations live behind small transparent Help glyphs; Overview, Applications, Processes, History and Space explorer omit redundant help. Data pages use compact toolbars and rows. Results, filters and selections stay available across page and AI navigation. Storage scans and mutations queue across pages, with scoped waiting/cancellation. Each file/directory row offers Show in folder and Ask AI. Asking opens a background task panel while retaining the source; buttons show progress/success and unread results stay visible. Missing providers pause tasks until saved. Results and setup retain a direct return to the original page, including scroll. Tasks support cancellation and retry; the task panel is session-local and completed conversations persist in history. Cleanup animates actual processed-item progress and returns to the remaining results, removing only confirmed successes.

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
