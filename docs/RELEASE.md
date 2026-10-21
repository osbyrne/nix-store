# macOS packaging and release

Builds are unsigned development prereleases. The user explicitly requested skipping release signing and notarization. Every push (any branch or tag) and manual workflow dispatch builds and publishes a GitHub prerelease. In-app updates remain disabled until a verification public key and signed updater assets are configured.

## Local app and DMG

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
cargo install cargo-packager --version 0.11.8 --locked
bun run package
NIXSTORE_BINARY=bundle/Nixstore.app/Contents/MacOS/nixstore bun run verify:native
```

The last verification requires downloaded catalogs; use the app to refresh them or `bun run verify:catalog` and `NIXSTORE_VERIFY_SOURCE=nix bun run verify:catalog` first. Native automation always sets `GPUIX_BACKGROUND=1`. It never confirms an install.

The packager needs `assets/Nixstore.icns`. The supplied original image is preserved in `assets/icon-source.webp`. Run `bun run icon` to convert it to the 1024-pixel PNG and all standard/Retina icon sizes with system sips/iconutil, preserving transparency.

`scripts/build.ts --compile` uses Bun's compile API and the GPUIX Solid compiler. A build-only static native-addon import fixes NAPI's opaque dynamic loader, allowing Bun to embed the addon. Development bunfig and dotenv autoloading are disabled in the executable. There is no Rust application, web view, or native renderer compilation; cargo is needed only for the chosen packaging tool.

The packaging script inspects the actual executable's Mach-O minimum macOS version and puts that value into the generated app configuration. This machine's Bun 1.4.3 executable reports **macOS 27.0**; the local app therefore requires macOS 27.0. The GPUIX addon itself reports 11.0. Do not change Info.plist to claim compatibility with an older OS without testing a Bun runtime built for it.

[`.github/workflows/build.yml`](../.github/workflows/build.yml) builds Apple Silicon and Intel apps on `macos-26` and `macos-26-intel`. Both builds must pass typecheck, tests, and packaging before publication. Releases contain architecture-specific DMGs and zipped apps plus `SHA256SUMS.txt`. The release notes record the actual minimum macOS version for each architecture.

Each run creates a unique `build-<run-id>-<attempt>` tag at the exact pushed commit and publishes a prerelease at https://github.com/osbyrne/nix-store/releases. The automatically generated tag uses `GITHUB_TOKEN` and does not trigger another build. No signing or notarization secrets are required. Bun's required ad hoc executable signature may remain; these builds have no Developer ID distribution signature or notarization.

## Future signed public release

These steps are documented for later; none have been performed for the unsigned build.

1. Install a Developer ID Application certificate and its private key in the build machine's keychain. The current Apple Development identity is insufficient for Developer ID distribution.
2. Store notarization credentials securely with `xcrun notarytool store-credentials nixstore-notary`. Use Keychain or CI secret storage; never put credentials in project files.
3. Generate an updater signing key with `cargo packager signer generate`. Keep the private key in secure CI secrets and put only the public key in `src/release-config.json`. Set its `repository` to the public `OWNER/REPO` GitHub repository.
4. Build each architecture on the matching Mac runner. Sign the native addon before embedding if library validation is enforced. Sign the final app with Developer ID, hardened runtime, timestamp, and `assets/entitlements.plist`. The app intentionally has no App Sandbox entitlement because it invokes package managers.
5. Verify the code signature, zip the app, and notarize it:

```sh
codesign --verify --deep --strict --verbose=2 bundle/Nixstore.app
ditto -c -k --keepParent bundle/Nixstore.app bundle/Nixstore-notarize.zip
xcrun notarytool submit bundle/Nixstore-notarize.zip --keychain-profile nixstore-notary --wait
xcrun stapler staple bundle/Nixstore.app
spctl --assess --type execute --verbose=2 bundle/Nixstore.app
```

6. Recreate the DMG from the stapled app, notarize/staple that DMG too, and reverify its contents. Do not reuse a DMG built before app signing/notarization.
7. Create a GitHub release. cargo-packager with `CARGO_PACKAGER_SIGN_PRIVATE_KEY` and `CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD` emits `Nixstore.app.tar.gz` and its sibling `.sig`. Upload those **plus** the DMG. The updater consumes the signed tarball; the DMG alone cannot serve updates. Ensure the tarball contains the final stapled app. Follow cargo-packager's signing configuration so the tarball is generated after Apple signing, not before.
8. Test `checkUpdate` against the actual release and install the update from a previously packaged app. Restart after installation; the native updater does not relaunch. Repeat on Intel and Apple Silicon before calling either release supported.

For universal GitHub release feeds, put architectures in updater asset names (for example `Nixstore_aarch64.app.tar.gz` and `Nixstore_x86_64.app.tar.gz`) and use the updater's documented target/arch endpoint substitution or architecture-specific endpoints. Do not upload two identically named tarballs and overwrite one architecture. This selection has not been integration-tested against a live release.

References: https://gpuix.dev/llms-full.txt, https://docs.rs/cargo-packager/latest/cargo_packager/, and https://docs.github.com/en/actions/reference/runners/github-hosted-runners.
