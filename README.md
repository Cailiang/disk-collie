# Memento

A local desktop workspace for making space: large files, verified duplicates, an interactive disk map, cache cleanup, privacy, and application removal. Process management and the user-configured AI Agent remain first-class tools.

[简体中文](README_ZH.md) · [Architecture and comparison](docs/CROSS_PLATFORM_REBUILD.md) · [Development](docs/LOCAL_AGENT_DEVELOPMENT.md) · [Packaging](docs/RELEASING.md)

## The workspace

- **Overview:** available disk space, direct task entry points, completed cleanup totals and recent activity. Trash totals are shown separately from permanently cleaned caches.
- **Smart cleanup:** explicit cache/developer/log rules for each OS; no automatic selections. Cache removal is permanent and requires confirmation.
- **Large files:** size, name and file-type filters over a compact native index. Default personal scans skip hidden subfolders and home Library / AppData; a visible option includes them. Personal files move to the system Trash after review.
- **Duplicates:** expandable type → duplicate group → copy hierarchy; size → samples → complete BLAKE3 hashes. Defaults to files ≥200 KB; hidden folders and home app data can be included. Hard links and cloud placeholders are excluded. At least one copy must remain, and contents are checked again before removal.
- **Space explorer:** expandable directory tree on the left, treemap on the right, and breadcrumbs. Defaults to the system drive, including Users on macOS. The compact index has no two-million-item cutoff; coverage details are available through Help.
- **Privacy:** expandable browser → profile → record → path hierarchy, including existing SQLite sidecars. Browsers must be closed. Passwords, cookies and personal documents are excluded.
- **Applications:** application logos and inline expandable macOS bundle / related-file groups, optional associated data, protected system apps; Windows/Linux hand off package removal to the OS uninstaller/package manager.
- **Processes:** application icons, sortable name/PID/CPU/memory headers, user/system filters, search, pause and inline actions for copy, quit/force-quit and AI explanation.
- **AI assistant:** your own provider and model; deterministic evidence, registered actions, an explicit confirmation plan and encrypted local credentials. No hosted Memento backend.
- **Activity / Settings:** a persistent cleanup record, existing Agent conversations and maintenance ledger, theme, language, providers and application updates.

Explanations live behind clickable Help controls; data pages use compact toolbars and rows.

## Stack and platforms

Electron + React + TypeScript provide the shell and existing model integrations. An independently implemented Rust sidecar owns read-only indexing, metadata aggregation, duplicate verification and portable system inspection. macOS uses `getattrlistbulk` with a standard traversal fallback; Windows/Linux use bounded parallel native traversal. Directory and large-file queries reuse the same index and are paginated.

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

The Renderer sends IDs, never mutation paths or shell commands. The main process checks selection scope, generation, registered identity and path components again. Personal files and app bundles go to Trash; narrowly scoped caches/history are permanently removed only after a separate confirmation. System/app-data directories are protected in the large-file browser. Cleanup records report processed bytes as estimates; they do not claim newly available disk space. Local scans do not upload file contents. Asking the AI sends the existing compact maintenance context to your configured provider.

Memento remains MIT licensed. MangoDisk was studied as a GPL-3.0 reference; its source and assets were not incorporated.
