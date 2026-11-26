# Memento Local Agent Development

This document describes the retained AI runtime and deterministic maintenance internals. The current storage product, platform matrix and UI contract are documented in [Cross-platform rebuild](CROSS_PLATFORM_REBUILD.md).

## 1. Product Baseline

The repository is self-contained. The production Renderer under `src/renderer/src/` (the new storage/process workspace plus retained Agent/settings modules), current project documentation, component tests, and the four-viewport UI smoke test together define the UI contract. Changes to layout, copy, density, responsive behavior, or interaction must update the affected implementation, documentation, and automated coverage in the same change; no sibling prototype repository is required.

The old Renderer, hosted AI analysis, Memento Server, OAuth flow, AI Gateway protocol, and Gateway examples are not compatibility surfaces. The rebuild reuses only deterministic local capabilities that remain useful: scanning, storage cleanup, Homebrew cleanup, background-service handling, app inventory, terminal fixes, path validation, and operation registries.

## 2. Runtime Architecture

```text
React Renderer
  Home / Cleanup / Large files / Duplicates / Space explorer / Privacy
  Applications / Processes / Terminal
  AI assistant / Activity / Settings
               |
               | typed, narrow IPC
               v
Electron Main Process
  LocalAgentRuntime ---- Vercel AI SDK ToolLoopAgent
          |                         |
          |                         `---- user-configured model endpoint
          |
          +---- AgentStore ---- node:sqlite + AES-256-GCM
          |        `---- unified maintenance ledger
          |
          `---- current scan snapshot
                 +---- registered cleanup actions
                 +---- registered terminal fixes
                 `---- registered reveal/app targets
```

The Renderer has no database handle, API key, filesystem target, or arbitrary command capability. The preload exposes only typed operations from `MementoApi`. The main process owns provider creation, decryption, scanning, operation validation, execution, and persistence.

The Electron version pinned in `package.json` supplies Node 24 and the built-in `node:sqlite` module. No native database dependency or post-install rebuild is required.

## 3. SQLite and Secrets

`AgentStore` opens `<userData>/memento.sqlite`, enables WAL and foreign keys, and applies migrations through `PRAGMA user_version`.

The current database schema version is 4. Its core tables are:

| Table | Purpose |
| --- | --- |
| `ai_providers` | Provider type, URL, model, encrypted API key, default and connection state |
| `app_settings` | Language, theme, login behavior, menu-bar behavior, and ignored items |
| `agent_runs` | Conversation ID, language, prompt, provider snapshot, status, response, focused entities, structured presentation, plan, results, and error |
| `tool_calls` | Structured input and output for each Agent tool call |
| `maintenance_runs` | Source, scan/Agent correlation, aggregate status, and timestamps for every maintenance session |
| `maintenance_operations` | Per-operation kind, estimate/actual bytes, recovery mode, result, stable error code, and private local recovery reference |

A legacy `app-settings.json` file is read once when the SQLite settings row does not exist. Values pass through `normalizeAppSettings` before insertion. Schema migration 3 separates Antigravity from the generic Google provider type; migration 4 creates the Agent-independent maintenance ledger. History-list IPC exposes whether recovery is available but never returns the private Trash or backup path.

API keys use this format:

1. Generate `<userData>/agent-master.key` with 32 random bytes and mode `0600`.
2. Generate a fresh 12-byte IV for every save.
3. Encrypt with AES-256-GCM.
4. Store IV, authentication tag, and ciphertext in separate BLOB columns.
5. Return only `keyPresent` and a four-character `keyHint` to the Renderer.

Changing only a provider's display name preserves its tested connection state. Changing type, URL, model, or key returns it to `untested`.

The Settings editor keeps the current provider draft while the model list or connection test refreshes the provider registry. A newly typed key is sent to the test request immediately, but is only encrypted and persisted after the user clicks Save. After a successful save, the key field is cleared and its masked hint changes to the new key suffix; leaving the field blank on a later save preserves that encrypted key. Failed tests also leave the draft key and the saved key unchanged.

## 4. Provider Registry

`provider-factory.ts` maps saved types to official AI SDK providers:

| Stored type | Factory |
| --- | --- |
| `openai-compatible` | `createOpenAICompatible` |
| `openai` | `createOpenAI` |
| `anthropic` | `createAnthropic` |
| `antigravity` | `createGoogleGenerativeAI` with Sub2API compatibility |
| `google` | `createGoogleGenerativeAI` |

Provider input is normalized and validated in the main process. URLs accept only HTTP or HTTPS. Root URLs receive the provider's conventional API prefix, so an OpenAI-compatible `https://code.tczor.cn` becomes `https://code.tczor.cn/v1`; pasted `/models`, `/responses`, `/chat/completions`, or `/messages` endpoints are reduced to their reusable API base.

`local-ai-config-import.ts` discovers configured API access in `~/.claude/settings.json`, `~/.codex/auth.json` plus `config.toml`, `~/.gemini/.env`, and `~/.grok/config.toml`. After structural validation, it checks all candidates in parallel against the provider's read-only model-list endpoint with the same authentication scheme used by Memento and an eight-second timeout. A candidate is accepted only when the service authorizes the request and its exact configured model appears in the Agent-capable catalog. ChatGPT/Gemini OAuth state and Grok browser-session tokens are deliberately ignored because the provider adapters cannot safely treat them as API keys. Malformed, incomplete, unauthorized, unreachable, and unavailable-model sources count as rejected and never cross IPC. Local rescans prune deterministic `local-config-*` rows that no longer pass validation and promote the most recently updated remaining provider if the removed row was the default. `AgentStore` records `local_ai_config_import_v2` after the first validated automatic attempt, causing existing installations to revalidate the earlier untested imports once after upgrading.

CC Switch is an optional one-time copy source. On the first launch where a readable database contains complete provider rows, the main process asks whether to import them; the answer is stored in SQLite so the prompt is never repeated. `cc-switch-import.ts` checks the Tauri store for an `app_config_dir_override`, then falls back to `~/.cc-switch/cc-switch.db`. It opens the database read-only and reads only structurally complete Claude, Codex, and Gemini rows. The shared `provider-import.ts` validator then checks all candidates in parallel against the same authenticated, read-only model catalog and eight-second timeout used for local configuration discovery; the exact configured model must appear in the Agent-capable catalog. Settings keeps an explicit “Copy CC Switch configurations” action for a later retry. Each copied row is saved in Memento's encrypted provider store and can be edited freely; Memento never watches, prunes, writes back to, or synchronizes the CC Switch database. Imported plaintext remains in the main process and is immediately normalized and encrypted with AES-256-GCM. The import result reports detected, copied, rejected, and a compatibility-only zero removed count.

An explicit later copy retains the deterministic imported ID, so a validated source row can overwrite edits to its corresponding Memento copy. Rows missing from CC Switch or rejected by validation remain in Memento. Installations with existing `cc-switch-*` providers record the prompt as already completed instead of prompting again.

The Renderer presents named providers instead of an API-protocol selector. Official protocols, endpoints, and Memento-tested recommended models come from the built-in catalog; model selection, manual model IDs, and custom endpoints use progressive disclosure under Advanced settings. Recommendations may change with a Memento release, but an existing saved model is never replaced automatically.

After a URL and credential are available, the Renderer debounces a typed model-discovery IPC call. The main process reuses an existing encrypted key when the field is blank, requests the provider's `/models` endpoint with the correct authentication scheme, and de-duplicates IDs. Capability metadata is preferred when an endpoint supplies it; otherwise known image, audio, realtime, embedding, moderation, and internal-only model families are excluded by conservative ID rules. Discovery augments the Advanced model list without choosing the endpoint's first model. The response includes the resolved base URL and excluded count so the UI can explain why a mixed catalog contains fewer Agent-selectable models. Requests time out after 15 seconds. Failed HTTP responses retain the request URL without credential query parameters and a bounded server message; all errors are sanitized before crossing IPC and rendered in a wrapping, selectable alert instead of the compact status chip.

Official `generativelanguage.googleapis.com` endpoints use native Gemini `/v1beta` routes and `x-goog-api-key` authentication. The dedicated `antigravity` type normalizes a host root to `/antigravity/v1beta`, uses the same header and Gemini model catalog shape, and remains implemented by `createGoogleGenerativeAI`; no separate Antigravity SDK is required. Database migration 3 converts saved `google` rows containing an `/antigravity` path, and the CC Switch importer applies the same classification. Model-discovery URLs never contain credentials.

The connection test creates a two-step `ToolLoopAgent` run with a strict `connection_probe` tool. Standard providers require the first tool call; Antigravity uses `auto`, and the strict declaration makes the Google adapter serialize the Sub2API-compatible Gemini 3 `VALIDATED` mode instead of permissive `AUTO` or forced `ANY`. The instruction still directs the model to call the probe, the callback must actually execute, and the follow-up step disables tools while verifying `functionResponse` continuation. Gemini 3 models use standardized `reasoning: low`, which maps to `thinkingLevel: LOW`; `MINIMAL` is intentionally avoided because Gemini 3.1 Pro variants reject it. The probe allows 2,048 output tokens, 60 seconds overall, and 45 seconds per provider request. A text-only first response remains a failed test.

## 4.1 Update Checks

Memento checks the stable GitHub release tag after startup and every hour. If that version is newer than the installed app, `electron-updater` downloads the native package in the background; an equal or older legacy release is reported as up to date without requesting updater metadata that it may not contain. `update-checker.ts` keeps the typed `idle`, `checking`, `available`, `downloading`, `downloaded`, `installing`, `up-to-date`, `error`, and `unsupported` Renderer states deterministic. The sidebar exposes progress beside the version number and enables its compact Update button only after the package is ready. Clicking it invokes a dedicated IPC handler that marks the process as quitting before calling `quitAndInstall`, so the optional close-to-tray window handler cannot intercept the updater's required shutdown. There is no native notification, floating notice, or external Release-page handoff. Settings retains a compact manual retry and an accessible live status. Development builds and unsupported Linux package formats do not attempt an update.

## 4.2 Release Automation

`.github/workflows/release.yml` validates metadata and builds macOS, Windows and Linux for x64/arm64. The collector expects 19 assets: eight installers, six updater payloads/blockmaps, four manifests and SHA256SUMS.txt with eight installer hashes. The new native sidecar is built for each package architecture; see [Release process](RELEASING.md).

Tag-triggered runs create or safely update the bilingual GitHub Release from `RELEASE_NOTES.md`. Manual dispatches run the same validation and build matrix but intentionally stop at temporary Actions artifacts. macOS builds import the project Developer ID certificate into an isolated temporary keychain, sign and notarize the app, produce both DMG and ZIP targets, then separately sign, notarize, staple, and verify the final DMG. The signed app inside the ZIP is the payload used by Squirrel.Mac. The end-to-end operator checklist is in [Release process](RELEASING.md).

## 4.3 Retained Agent Application Update Discovery

Installed-application updates are discovered during the application scan, separately from Memento's own hourly updater. `scanner.ts` checks Homebrew Cask, Mac App Store, and application-provided Sparkle feeds concurrently, then selects an eligible Homebrew result, an App Store result, or a Sparkle result in that order. Receipt-backed applications use the App Store result when available and can still use Sparkle when the store reports no valid update.

| Source | Detection | Installation |
| --- | --- | --- |
| Homebrew Cask | Cask metadata matched to a non-receipt-backed app and checked against its installed version | Homebrew update in Memento |
| Mac App Store | `mas` results when available plus Apple lookup for receipt-backed apps; lookup checks Bundle ID, newer version, macOS product type, and OS compatibility | `mas` in Memento when installed; otherwise open the App Store |
| Sparkle | Appcast items compared by marketing version, then build number when marketing versions match | A supported HTTPS package is verified and installed in Memento; otherwise use the app's updater |
| DuckDuckGo fallback | Official `duckduckgo/apple-browsers` macOS release tags when the appcast yields no newer item or fails | External updater only; GitHub assets are not downloaded by this fallback |

The DuckDuckGo fallback requires Bundle ID `com.duckduckgo.mobile.ios` and an HTTP(S) Sparkle feed URL. The appcast request has a five-second timeout; if no newer item is found, the fallback requests up to 100 official GitHub releases with an eight-second timeout and considers non-draft tags matching the macOS version/build format. The result retains the original Sparkle feed as its update token. Appcast marketing versions and build numbers come from `sparkle:shortVersionString` and `sparkle:version`, compared against `CFBundleShortVersionString` and `CFBundleVersion`.

Sparkle packages must pass Bundle ID, signing-team, and strict code-signature checks before atomic replacement. Application cards expose whether installation runs in Memento or opens an external updater. Apple lookup requests send bundle identities and store-selection parameters; application names, local paths, usage history, and receipt contents are excluded. Source failures leave the local inventory usable and may yield no update result, so an absent update badge alone does not prove the installed version is current.

## 5. Agent Run

`LocalAgentRuntime.start` requires a completed scan and the default Provider. It stores the run before making a model request and tracks cancellation with an `AbortController`. A new task creates a conversation ID; follow-up runs reuse it. The Renderer workspace is keyed by conversation ID and selects the latest run for each conversation, so another turn updates the existing tab instead of adding a tab for every run.

Before each request, the runtime loads up to eight recent turns from the same conversation and builds a bounded context containing each user request, short outcome, focused entities, pending plan IDs, and status. Direct entity names in the current request are resolved against the current scan. When a follow-up uses a reference such as “这个服务,” “this app,” or “it,” the latest non-empty focus is authoritative; inspection output is narrowed to that entity so unrelated findings cannot displace it. Focused service and storage inspection also carries exact-token correlated terminal findings. Safe literal `export *_HOME=/absolute/path` entries whose targets no longer exist become hash-bound `comment-lines` fixes; correlated fixable findings are appended to the same structured result as optional operations even if the model omits them from `present_results`.

State progression:

```text
preparing -> analyzing -> plan-ready -> awaiting-confirmation
          -> completed
          -> failed / cancelled
awaiting-confirmation -> executing -> verifying -> completed
```

The model can call these tools:

- `inspect_device`
- `inspect_storage`
- `inspect_background_services`
- `inspect_applications`
- `inspect_terminal`
- `present_results`
- `prepare_action_plan`

Inspection output includes stable finding IDs and is compact enough for model context. When one storage item is focused, `local-evidence.ts` derives identity tokens from that exact scan item and correlates them across storage, services, applications, allowlisted filesystem entry names, package receipts, shallow target children, and shell configuration references. Shell values that look like keys, tokens, secrets, passwords, or credentials are replaced with `[REDACTED]` before tool logging or provider requests. Evidence is labeled `confirmed-local`, `strong-signature`, or `unconfirmed`; no product ownership table is maintained. `present_results` accepts only stable IDs and resolves them against the current scan into a persisted `AgentPresentation`. The model supplies plain summary and section-title text; Memento supplies all item data and interactive operations. Arbitrary HTML is never accepted or rendered.

Every tool input and output is stored in `tool_calls`. API keys, raw file contents, and unrestricted filesystem access remain excluded. Runs are limited to twelve steps, 1,400 output tokens, and a two-minute timeout.

Application inspection covers `/Applications`, `~/Applications`, and `/System/Applications`. User and shared applications receive registered Trash operations; system applications remain read-only. The scanner resolves Simplified Chinese names from localized and development-region `InfoPlist.strings`, and exposes Bundle ID, executable, `LSBackgroundOnly`, and registered URL schemes so a per-app Agent request can distinguish ordinary apps, drivers, security helpers, and URL handlers from verified local metadata. Last-used dates follow the same strategy used by Mole: Memento first reads Spotlight's `kMDItemLastUsedDate`, then falls back to the `.app` bundle modification time when Spotlight has no value. The fallback is an activity estimate based on the last install/update change, so it fills the UI and unused-app sorting without pretending to be an exact launch event; invalid, pre-2001, and future dates are discarded.

The application language is authoritative rather than the language of the latest user prompt. English mode requires all user-visible Agent text in English even if the user writes Chinese. Main-process statuses, fallback responses, plan copy, validation errors, and provider-test results use the same setting. Changing language revokes the old scan snapshot and immediately performs a localized scan.

## 6. Plan and Execution Security

Every `ScanCandidate` carries `confidence`, stable `reasonCodes`, and `estimateQuality`. `finding-trust.ts` is the shared policy used by the scan result, Renderer summary, and sidebar count. Verified rebuildable targets with exact measurements become safe cleanup; strong local evidence becomes actionable; unmatched hidden Home and Application Support identities remain weak review clues. Weak clues never affect health score or safely reclaimable bytes. Scan results also include per-section and total timings plus localized diagnostics with stable codes such as `scan.storage.failed`.

`availablePlanItems` derives the only IDs a model may propose from the current scan's registered candidate operations, manageable app uninstall operations, and deterministic terminal fixes. Unknown operation IDs are rejected when a plan is prepared.

The Renderer may also add an operation from a structured result directly to the current plan. The `memento:agent:plans:add` handler resolves that ID through `availablePlanItems` for the current in-memory scan before persisting it. This is a UI shortcut into the same confirmation path, not a new execution path.

Before execution, `selectExecutablePlanItems` validates that:

- the run exists and is still `awaiting-confirmation`;
- the submitted Run ID matches;
- the item array is non-empty and contains at most 100 short string IDs;
- every ID belongs to the persisted plan;
- no successfully completed operation is submitted again;
- duplicate submitted IDs do not cause duplicate execution.

The existing action and terminal-fix registries then validate the IDs again against the current in-memory scan. Stale actions fail instead of falling back to model-provided paths or commands. Destructive filesystem and service changes retain their existing target allowlists and privilege boundaries.

Application uninstall first uses Electron's native macOS Trash API. If that API reports an unrelated privacy error and leaves the bundle in place, Memento falls back to a same-volume move into the current user's `~/.Trash`. The fallback revalidates that the target is a real, non-nested `.app` under `/Applications` or `~/Applications`, allocates a non-conflicting destination, and verifies both sides of the move. Only `EACCES` or `EPERM` enters the existing administrator authorization boundary; other filesystem failures remain visible and do not mark the action complete.

After Agent-plan execution, service actions, or terminal fixes, Memento performs a fresh scan. Registered actions and terminal fixes whose complete local capability payload remains unchanged inherit their prior opaque IDs; changed or missing targets receive no such reconciliation. Direct Storage cleanup is narrower: once the main process has validated and completed the registered action, the Renderer reconciles its operation ID and removes the exact originating candidate by stable candidate ID during an approximately three-second Run, Update, Done sequence; it does not block on a full scan. Per-operation results accumulate on the run, successful steps become non-selectable, and partial failure is reported as partial failure. Cancelling an active request aborts the provider call, while cancelling a waiting plan persists `cancelled` and clears the executable plan.

Cleanup scanning uses the following boundaries and a shared rule registry:

- `cleanup-rules.ts` is the single registry consumed by discovery and execution. It assigns stable System, Applications, Browsers, Developer, Logs, and Devices categories to exact rebuildable targets for macOS, browsers, Electron applications, AI clients, Xcode, simulators, and common package managers. Discovery cannot create executable paths that the cleanup validator would reject.
- Dynamic discovery measures every eligible direct child of `~/Library/Caches` and bounded `Caches` or `tmp` directories inside third-party Sandbox and Group Containers. It rejects Apple and credential-manager identities, non-direct descendants, files, symbolic links, and symbolic-link ancestors. Result caps are applied only after every eligible target is measured, retaining the largest useful candidates instead of whichever names happen to appear first.
- `home-hidden-cleanup.ts` inspects direct hidden Home directories, one directory level below `.config`, `.cache`, and `.local/share`, and first-level directories below `~/Library/Application Support` after application inventory completes. It protects shell, credential, package-manager, Apple platform, shared-data, and container roots; filters directories matching installed applications or command entries from `PATH`, Homebrew, and common user bin directories; excludes directories modified within 30 days; and caps the size-sorted result at 80 review clues. A missing identity match is evidence, not proof of orphan ownership. When a registered target exists, the Renderer exposes a separately confirmed `trash-home-artifact` action; the main process rechecks the registered real parent, directory type, and modification time before using native Trash, and never permanently deletes settings or data.
- `project-artifacts.ts` scans bounded developer roots such as `~/Projects`, `~/GitHub`, `~/src`, `~/Code`, `~/dev`, and `~/workspace` for projects marked by a manifest or `.git`. It recognizes direct rebuildable directories including `node_modules`, `target`, `.build`, `build`, `dist`, `out`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `coverage`, `.dart_tool`, and `DerivedData`. Recent outputs remain review-only, while directories containing nested repositories or deployment key material are skipped. `trash-project-artifact` validates the project root, direct artifact boundary, type, modification time, and protected entries before moving the directory to native Trash.
- Large direct directory children of `~/Library/Logs` are review-required permanent cleanup targets; their resolved paths are checked again before deletion.

Automatic Storage findings are directory-only. Personal files under Downloads, Desktop, and Movies and individual files such as Docker virtual disks are available through the separately initiated Disk browser. A disk-browser directory can be sent to Agent through an opaque registered node ID. The main process resolves that ID, creates a focused review candidate, and exposes a `trash-disk-usage` action only when the existing disk safety validator accepts the directory. Execution validates the same node and real path again, uses native Trash, invalidates only the removed subtree, and notifies the Renderer without starting another full disk scan.

History defaults to the unified maintenance ledger and keeps Agent conversations on a separate tab. Direct cleanup, application Trash, disk-browser Trash, terminal fixes, terminal restore, and Agent execution all append maintenance runs and per-operation results. Partial failures remain partial, recovery references stay local, and history deletion removes audit rows only: it never touches Trash items, backup files, or the original filesystem target. Agent-history bulk deletion remains a separate transactional path that cascades tool calls.

## 7. Ignored Items

Storage entries use their validated location as the ignored identity; background services use their service name; applications prefer Bundle ID and fall back to their validated path. The main process applies ignored items after every scan and removes matching entries from:

- visible scan candidates;
- registered cleanup actions;
- registered reveal targets;
- Agent inspection context.

Application ignore also removes the inventory row and any application finding that references its uninstall operation. Protected system apps have no uninstall operation but can still be hidden and restored.

The Renderer also removes a newly ignored row immediately. Restoring detection updates SQLite and triggers a fresh scan.

## 8. Renderer Contract

The app opens on the device overview with an explainable health score, real CPU/memory sample charts, storage navigation and cleanup value. Missing GPU/battery readings do not enter scoring. CPU/memory cards enter descending user-process lists; storage enters Large files. It does not start a full-home index or the old maintenance scan automatically. The grouped sidebar exposes Smart cleanup, Large files, Duplicates, Space explorer and Privacy under storage; Application manager, Processes, Terminal and AI are under Utilities. Storage history includes a disclosure for existing Agent conversations and the maintenance ledger. The new workspace is implemented in `StorageWorkspace.tsx`, `ProcessWorkspace.tsx`, `agent-ui/Shell.tsx` and `workspace.css`.

New storage scanning uses the Rust sidecar through `StorageService`, independent of the retained macOS Agent evidence scanner. Native indexing is on demand and always starts at the system drive; folder picking is removed. Each scan purpose retains an independent session, and the Renderer keeps its page instance mounted so results, filters and selections survive navigation. Confirmed cleanup reconciles only successful paths across sessions, preserves stable IDs, updates the local activity ledger and returns to remaining results. Cleanup progress reports processed items and current paths. The homepage immediately updates total organized bytes (permanent cleanup plus Trash), the cumulative line and daily bars from that ledger. Focused cache/privacy scans happen when their page is opened. All new selections start empty. Application management hides system apps by default, resolves real logos and last-use metadata, and uses independently registered Open/Update IDs. Local inventory does not wait on network checks. Related application data is optional and directory children are authorized through inspected parents; uninstall requires the entire app and deduplicates selected descendants. Duplicate discovery has a 10 MiB minimum/default, while hidden/app-data inclusion starts checked. Space explorer exposes Back to parent and a smaller-item list without changing area proportions. Main-process operation validation remains authoritative. Every file/directory, cleanup/privacy path and app association offers Show in folder and Ask AI. File questions carry path/size/available modification time (no file-content read), use isolated conversations and retain a return to the source page. AI credentials and planning continue to use the existing runtime and store described above. Portable Agent evidence uses the new OS cache rules and application inventory; macOS-only service/terminal fixes are not presented as portable operations.

Storage work uses a scoped FIFO queue in main, including discovery and mutations. Progress includes its source scope, and cancellation removes only that scope's pending work or active read-only scan. Navigating to Privacy while a file scan runs shows a wait instead of an IPC busy error.

`AiTaskProvider` starts isolated explanations one at a time in the background. Source buttons show queued/running/ready states and accessible tooltips; the task panel tracks unread completion, cancellation and retry. Provider-less requests remain pending until configuration is saved. Setup and results carry source view/scroll and a direct return; process filters remain mounted. Task reminders are session-local; runs persist in normal history. Process defaults are user-only/CPU descending, with strict >40% orange / >65% red CPU/memory warnings. macOS process control targets the owning app for helper actions, validates identity/ownership and verifies real exit before reporting success; portable native control verifies disappearance too.

The new UI uses centralized locale catalogs and English fallback. The compatibility formatter for dynamic legacy maintenance diagnostics is retained. Theme, reduced motion, four viewport checks, keyboard navigation and modal focus are part of the product contract.

## 9. Adding a Capability

A new Agent capability must follow this order:

1. Add deterministic scanning and an explicit registered operation in the main process.
2. Define path, service, privilege, timeout, cancellation, and verification boundaries.
3. Add focused unit tests for valid and invalid targets.
4. Expose only compact structured data through a named Agent inspection tool.
5. Map the registered operation to an `AgentPlanItem`.
6. Keep execution behind the shared confirmation and plan-validation path.
7. Re-scan and report the actual result.
8. Update the relevant UI coverage and documentation with every visible interaction change.

Do not add `run_shell`, model-generated filesystem paths, model-generated service names, or a path that executes from free-form model text.

## 10. Verification and Release

Development requires Node.js 22.13 or newer so `node:sqlite` is available without an experimental flag. `package.json` and `package-lock.json` are the source of truth for the supported Electron, Vite, electron-vite, electron-builder, React plugin, and Vitest versions.

Run:

```bash
npm test
npm run typecheck
npm run build
npm run scan:smoke
npm run electron:smoke
npm run audit:runtime
git diff --check
```

Start `npm run dev:web -- --port 4178 --strictPort`, then `npm run ui:smoke -- http://127.0.0.1:4178`. The test captures twelve pages at four viewports and exercises storage confirmations, duplicate survivor protection, application data selection, process-to-AI navigation, English and dark mode. The Electron smoke uses the production main/preload/Renderer, real metrics/inventory, an isolated owned storage fixture and a real Trash operation; it also verifies encrypted provider-key editing against a loopback provider. Run `npm run native:test` and `npm run scan:smoke` for metadata, content verification and scanner evidence. Packaging and public release checks are in [Release process](RELEASING.md).
