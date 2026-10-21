# Nixstore

A native macOS software store for nixpkgs, Homebrew formulae, and Homebrew casks. Built with GPUIX 0.11.0, Solid 1.9, Effect v4 beta, and Bun. It uses native GPUI widgets, not a web view.

Discover searches online as you type using the official Homebrew JSON API and Nix package search index. Cached catalogs remain available when a source cannot be reached, with a visible fallback message. Package details show available sources and versions, choose casks for Mac apps and Nix for CLI tools by default, and disclose exact commands before any package change. Installed, Updates, Activity, History, Settings, and source setup/repair are implemented. Settings and bounded operation history persist locally.

## Run

```sh
bun install --frozen-lockfile
bun run dev
```

`bun --hot` remounts the UI and resets signals. Use `GPUIX_BACKGROUND=1 bun start` to keep the native window from taking focus during automated runs. Use ⌘K to focus search; controls support Tab, Enter, and Space. No Edit menu is installed.

Catalog downloads begin in the background when their daily caches are missing or stale, unless that source is skipped or background refresh is off. Refresh either source manually in Discover. Nix itself is needed for Nix package changes, not for searching its catalog.

## Verify

```sh
bun run typecheck
bun test
bun run verify:catalog
NIXSTORE_VERIFY_SOURCE=nix bun run verify:catalog
bun run build:compile
NIXSTORE_BINARY=dist/nixstore bun run verify:native
bun run verify:nix
```

The unit suite uses fake service layers and the real windowless GPUI renderer. Regression checks cover overlapping text and row boundaries at 900px and 1120px with the system theme. The process tests use harmless system executables to test argv isolation, timeouts, and bounded output.

`verify:catalog` fetches live metadata and caches it. `verify:native` launches a real background window, searches real cached packages, checks source details and command confirmation (then cancels), visits each screen, tests ⌘K, and records row bounds. Screenshots and JSON verification artifacts are in `artifacts/`.

`verify:nix` performs a real install/run/upgrade/remove/rollback/remove lifecycle for `hello` in a disposable temporary profile. It downloads store paths if needed, deletes its temporary profile afterward, and does not change the user's profile. Homebrew's live read path is verified; its write operations and fresh-machine installers are tested with fakes, not by changing this Mac's existing setup.

## Build an app and DMG

```sh
cargo install cargo-packager --version 0.11.8 --locked
bun run package
```

Outputs: `bundle/Nixstore.app` and an architecture-specific DMG in `bundle/`. No Rust toolchain is needed to develop or compile Nixstore itself; cargo-packager is the separate packaging utility selected in the brief.

Every push publishes an **unsigned prerelease** with Apple Silicon DMGs, zipped apps, and SHA-256 checksums at [GitHub Releases](https://github.com/osbyrne/nix-store/releases). See the [build workflow](https://github.com/osbyrne/nix-store/actions/workflows/build.yml).

The current local artifact is **unsigned**, with signing and notarization skipped at the user's request. This machine's Bun runtime requires macOS 27.0; the packaging script records the actual binary minimum in Info.plist. Intel Macs are not supported because GPUIX 0.11.0 only publishes an arm64 macOS binary. See [release instructions](docs/RELEASE.md) for supported release preparation, signatures, notarization, GitHub Releases assets, and update configuration.

`checkUpdate` is wired through an Effect service. The unsigned development build has no configured release repository/public key and reports that clearly in Settings. It does not download unverifiable updates.

## Architecture

- `src/services/Platform.ts`: scoped Bun-backed processes, HTTP, atomic JSON storage, privileges, and explicit GUI environment.
- `src/services/Discovery.ts`: absolute-path discovery, Nix store health, declarative configuration detection.
- `src/services/Catalog.ts`: Homebrew JSON API, Darwin-filtered public Nix index, online search, cached fallback, source policy.
- `src/services/Managers.ts`: Nix/Brew read and write commands, Nix preflight, history, rollback, GC, owned app links.
- `src/services/Operations.ts`: serialized operations, conflict checks, progress streams, visible cask administrator prompts.
- `src/services/Onboarding.ts`: official installers, skip preferences, verification, repair.
- `src/app/`: scoped ManagedRuntime and lifecycle-aware Solid bridge/controller.
- `src/ui/`: native UI, typed style blocks, themes, text-run normalization, and bounded virtual lists.

Saved data lives in `~/Library/Application Support/Nixstore`. `NIXSTORE_DATA_DIR` overrides it for isolated verification. Only app-owned symlinks in `~/Applications/Nix Apps` are removed or updated. Declarative configurations remain outside the app's management model.

[DECISIONS.md](DECISIONS.md) records source research, deviations, API constraints, verification results, and remaining limitations.
