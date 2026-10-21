# Nixstore decisions

## Milestone 1 — 2026-10-21

### Styling spike: native StyleX-shaped API

Completed within the one-hour time box, before building UI. Ran `@stylexjs/babel-plugin` 0.19.1 alongside `babel-preset-solid` 1.9.15, targeting `@gpuix/solid` with `generate: 'universal'`. The compiler accepts the combination, but its output passes only `className: 'xrkmrrc x1awj2ng'` to the native host and emits CSS in Babel metadata. GPUIX has no CSS selector engine, DOM, or stylesheet loader. Successful compilation therefore does not apply styles.

The actual compiler output is preserved in [docs/stylex-spike-output.txt](docs/stylex-spike-output.txt). Spike-only packages were installed in `/tmp/nixstore-stylex-spike`, not added to this application.

Use `src/ui/styles.ts`: typed `create`, conditional `props` with last-wins merging, `defineVars`, and `createTheme`. Values are native `StyleDesc` objects. Interaction properties merge independently; tokens resolve to literal native values, not CSS variables. Light and dark themes are implemented. Every component style comes from a typed `create` block. This is the fallback explicitly allowed by the brief, not a complete StyleX implementation: no CSS shorthands, CSS selectors, media queries, or compiler optimization.

References: https://stylexjs.com/docs/api/javascript/create/ and https://stylexjs.com/docs/api/javascript/props/; https://gpuix.dev/llms-full.txt and https://gpuix.dev/guides/solid.

### Exact dependency versions and Effect API drift

GPUIX native and Solid: 0.11.0. Solid: 1.9.15. Effect and platform-bun: 4.0.0-beta.107. Exact versions and the Bun lockfile are recorded in the project.

Deviation from the brief's API example: the pinned Effect beta exports `Context.Service`, not `ServiceMap.Service`. This is the v4 service API, not v3 `Context.Tag`. The current main-branch service migration guide also specifies `Context.Service`. Use the installed beta's `effect/unstable/*` paths where required by that release; main has since removed `unstable` from paths. Do not copy main-only imports into this beta.

An override pins the transitive `@effect/platform-node-shared` to 4.0.0-beta.107. Its upstream caret range otherwise resolved to stable 4.0.5, which targets a different Effect surface and produced a peer warning. No extra direct runtime dependency was added.

References: https://github.com/Effect-TS/effect/blob/main/MIGRATION.md, https://github.com/Effect-TS/effect/blob/main/migration/services.md, https://github.com/Effect-TS/effect/blob/main/migration/runtime.md, and the installed beta's declarations.

### Milestone boundary

This milestone implements the native foundation, not package management. Source cards explicitly say connection checks arrive next. Search accepts text but explicitly says the catalog is not connected. Installed, Updates, and Activity are named placeholders. No sample package inventory, installation controls, or fake package successes appear. Appearance is session-local pending persistent settings in milestone 5.

The app composes platform-bun filesystem/process services and its HTTP client in a scoped ManagedRuntime. The Foundation service exercises service injection, a typed error channel, and an abortable, timed bridge to Solid. Shell/Privilege services, package manager implementations, and actual discovery remain in later milestones. Domain types are initial contracts; the operation state machine implementation belongs to milestone 4.

### Verification scope

Use GPUIX native automation directly, since this app has no browser surface. Tests exercise GPUI's windowless renderer plus a real background native window. Screenshots capture GPUI content; system-drawn traffic lights and the desktop vibrancy backdrop are outside the capture. Intel execution, VoiceOver behavior, compiled binaries, signing, notarization, and updater integration are not validated in milestone 1.

The user approved TypeScript and @types/bun as development-only dependencies. Added exact versions typescript 7.0.2 and @types/bun 1.4.3, with `bun run typecheck`. The initial full project typecheck passed without errors. Runtime dependencies remain unchanged.

## Milestones 2–7 — continued autonomously

The user replaced review pauses with autonomous verification and continuation, then explicitly requested skipping release signing. No additional application dependencies were introduced. TypeScript and @types/bun remain the only approved development dependencies. cargo-packager 0.11.8 was installed as the packaging tool already specified in the brief.

### Catalog data and offline storage

Homebrew comes directly from `https://formulae.brew.sh/api/formula.json` and `/api/cask.json`. The live normalized snapshot contained 15,420 entries before merging. Disabled packages are excluded.

The proposed `https://channels.nixos.org/nixpkgs-unstable/packages.json` returned HTTP 404. A sample `nix-env -qa --json --meta --file` expression successfully exposed Darwin platforms and mainProgram, but a full evaluation exceeded its ten-minute deadline. `nix search` also traverses a large evaluation graph, emits extensive evaluation logs, and does not supply the desired platform metadata. Neither is used to build the shipping index.

Selected the official public `search.nixos.org` Elasticsearch index. The app reads the website's current public schema/read-only access configuration, pins one concrete index for a refresh, and paginates in batches of 3,000 with `search_after`. It filters `package_platforms` to both `aarch64-darwin` and `x86_64-darwin`, then filters by the current Mac in search. There are strict response, page, cache, and timeout limits. The live index produced 122,620 valid Darwin entries and the merged catalog contained 132,546 packages (later identifier validation removed a small number of questionable names). Firefox and ripgrep were verified with both sources and distinct versions.

This is a public website backend, not a guaranteed stable API. Schema changes fail visibly and preserve the last complete snapshot; its read-only credentials are already public in website JavaScript and are discovered at runtime rather than treated as private user credentials. No user secret or private service access is required. Index metadata is generated for Linux and describes Darwin support through meta.platforms; a particular Darwin package may still fail to build. Actual Nix preflight remains authoritative.

Chose atomic JSON snapshots with in-memory search, avoiding a SQL driver dependency. Current snapshots are approximately 5 MB Homebrew and 43 MB Nix. Refresh is daily in the background, source-specific and independently cancellable; each source's previous snapshot survives refresh errors. Search results use a 60-row native virtual-list window, not 130,000 mounted components.

Merging is deliberately conservative: normalized exact package keys, not fuzzy display names or homepage domains that might combine different products. Unmatched aliases remain separate rather than concealing versions. Casks are classified as GUI; Nix uses available app/desktop metadata and mainProgram/description heuristics. Classification can be imperfect. Native macOS icons/categories are not consistently provided. Detail views asynchronously fetch a bounded homepage favicon with a letter-avatar fallback; search rows always have generated avatars. Icons never gate search or package actions.

### Processes, commands, and privileges

All UI effects go through Effect services and the ManagedRuntime controller. Shell uses platform-bun's ChildProcessSpawner, explicit absolute executables, argv arrays, an explicit GUI environment, ignored stdin, concurrent stdout/stderr drains, scoped process cleanup, a two-second kill escalation, timeouts, and bounded captured output. Progress is exposed as Streams with a bounded sliding buffer; Activity stores a 64 KiB log tail per operation and at most 100 operations.

Identifier validation rejects leading options, whitespace, path traversal, shell metacharacters, and NUL bytes. Equivalent commands are escaped for display/copy; they are not fed back into a shell. AppleScript privilege elevation is the unavoidable shell boundary, with every argument and environment value independently quoted. The only downloaded scripts executed are the fixed official installers after explicit in-app confirmation.

Deviation from the brief's blanket `--json` expectation: Nix 2.31.6 supports JSON profile listing, but `profile history --json` fails as an unrecognized flag, and mutation/preflight output is not a stable JSON progress feed. Inventory uses JSON; history and operation progress use bounded plain logs. A real disposable-profile lifecycle verified install, execution, upgrade, removal, rollback to generation 1, and removal again. `profile install` is currently a supported deprecated alias of `profile add`, retained to match the requested imperative interface.

Nix preflight uses `nix build --dry-run` for installs and profile upgrade dry-run for updates; it distinguishes known fetch/build summaries. Unknown responses remain explicitly unknown. Cache availability can change between preflight and install. Nix update candidates are comparisons with saved catalog versions, clearly labeled as such; arbitrary non-nixpkgs flake update semantics are not fully resolved by this catalog. Upgrade execution follows the entry's original profile source.

Homebrew never runs as root. Cask/admin installer prompts use SUDO_ASKPASS with a system AppleScript hidden-password dialog. The password flows directly from that helper to sudo, never into JS state, saved files, or Activity logs. Nix setup uses `osascript ... with administrator privileges`. Privileged installers do not offer fine-grained progress while inside Apple's synchronous administrator call, and cancellation of the parent prompt cannot guarantee reversal of changes already performed by an external installer. A cancelled/failed operation instructs the user to refresh inventory and check partial changes.

Fresh inventory and conflict checks run inside a serialized operation slot. App-installed and detected packages are distinguished in Installed. nix-darwin/Home Manager detection warns prominently; referenced packages discovered in system/home profiles are read-only. Detection is best effort, not a parser for arbitrary user configurations. It never changes declared configuration files.

### App links, onboarding, and settings

After successful Nix mutations, the app scans profile output Applications/share/applications directories and updates only owned symlinks in `~/Applications/Nix Apps`. Existing unowned files/links are preserved; stale owned links are removed by recorded target identity. Settings offers relinking, GC of unreferenced store paths, history loading, and generation rollback with disclosure. Nix immutable-store behavior is explained before installation.

Settings persists source preference, appearance, catalog refresh policy, source skips, and advanced command visibility. Package updates are explicitly initiated in Updates; no unattended package upgrades run. Source discovery and store health are rechecked on startup, including after macOS updates. Setup downloads the official Determinate or Homebrew installer, shows logs and a visible administrator flow, then verifies absolute-path discovery. Repair preserves an already healthy Nix installation and offers rerunning the official installer for a missing/broken store. Fresh setup and admin-required cask flows are tested using fake layers; they have not been exercised against a clean Mac or by reinstalling this machine's working tools.

### UI regression found during verification

Mixed children in a GPUI `<text>` such as `{name} · {version}` painted as separate block text runs. This produced the user's screenshot: stacked source/version labels overflowing fixed rows. Added a shared Text component that resolves and joins all text fragments into a single native run. Explicit 20/16/14-pixel row line heights keep all three label lines inside 92-pixel rows. Bounded root/main containers also prevent focus navigation from shifting the whole window. There are no inline component style objects.

Added regression tests for the reported labels at 900px and 1120px in light/dark modes. Native verification records actual painted text bounds and rejects row overflow, opens the real command disclosure and cancels it, visits every screen, and verifies root position, Cmd+K, appearance changes, and the bounded result window. Screenshots were viewed, not just saved. An older test window was closed so it would not keep displaying stale code. Full VoiceOver testing has not been performed; interactive primitives provide roles/labels and keyboard navigation.

### Compiled build and unsigned packaging

The documented two-pass Bun bundle/compile path failed in this environment: the compiled binary tried to autoload development bunfig preloads, and the generated NAPI createRequire loader did not embed the addon. Fixed the build with a static build-only import of the exact current-architecture GPUIX native addon and a single Bun.build compile pass, with development bunfig/dotenv autoloading disabled. Source, production bundle, and the standalone executable all use the same Solid universal renderer. No application Rust code was added.

Generated a native icon using system AppKit, built its iconset with sips/iconutil, and passed the resulting .icns to cargo-packager. cargo-packager 0.11.8 needs an explicit `name` field here; otherwise its config name discovery attempted to cd into the JSON file and failed. The final unsigned .app/DMG are local artifacts only. Signing and notarization were skipped at the user's instruction.

The local Bun executable's Mach-O minimum OS is 27.0 (GPUIX's addon is 11.0). Packaging reads the actual binary requirement instead of claiming the static 13.0 baseline from the template. Earlier macOS support requires a compatible Bun runtime and actual validation. Apple Silicon was verified. The Intel/Apple Silicon workflow is prepared with documented GitHub runner labels, but not executed: this directory has no configured Git repository/remote. No PR, release, or public deployment was created.

checkUpdate is behind an Effect service with timeouts, explicit update installation, signature verification, and a restart message. src/release-config.json has empty repository/public-key fields for this unsigned build; Settings reports the lack of a configured release feed. No unsigned updater payload is accepted. A real signed GitHub Releases update, tarball architecture selection, and notarized distribution remain unverified; docs/RELEASE.md explains the remaining release procedure.

### Final compatibility and verification pass

The last Homebrew normalization pass found 150 Linux-required formula records in the public API. These are excluded, and cask `depends_on.arch` constraints (including published variations) now restrict Darwin architecture choices. A regression test covers both cases. The final live Homebrew snapshot contained 15,273 entries, with 132,426 unified catalog entries. Source buttons describe architecture availability; the manager's preflight remains responsible for OS-version and other install requirements.

Final unit/type verification: `bun run typecheck` and 24 tests pass (147 assertions). Packaged-app automation verifies both appearances, inline labels inside fixed row bounds, navigation without root scrolling, real cached Firefox/ripgrep results, actual command disclosure followed by cancellation, and every main screen. The unsigned DMG is verified with hdiutil, and the packaged executable matches the compiled build. Real Nix lifecycle evidence is in `artifacts/nix-lifecycle.json`; screenshot/layout evidence is in `artifacts/`. Homebrew writes, administrator password prompts, fresh-machine onboarding, Intel execution, and public-release updates remain fake-layer-tested or unverified as described above, not represented as live integration successes.


## User-supplied app icon

Replaced the generated N icon with the user-supplied transparent WebP, preserved as assets/icon-source.webp. The image is square and is resized without cropping or adding a background. scripts/icon.ts uses system sips/iconutil to generate the PNG and complete macOS .icns size set. Rebuilt the unsigned app and DMG with the new icon.
