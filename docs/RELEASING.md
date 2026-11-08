# Releasing EasyTube (maintainers)

A release is a `.zip` containing the installer and a bilingual `README.txt` with the whole changelog.
(The installer is shipped inside a zip because many chat/mail services refuse `.exe` attachments.)
Each platform has its own zip: `EasyTube-Setup-<version>.zip` (Windows) and `EasyTube-<version>-mac-arm64.zip` (macOS: the `.dmg` + the same kind of `README.txt`).
Both carry the **same version number** and the same changelog.

## Checklist

1. **Version**: bump `version` in `package.json` and `APPVERSION` in `installer.nsi` (same number; the macOS build reads `package.json`).
2. **Changelog**: add the new entry (`fr` and `en`) at the **top** of `release/changelog.json`.
   `release/make_release.py` stops if the first entry does not match the version.
3. **Binaries**: `npm run fetch-binaries -- --force` takes the latest yt-dlp. FFmpeg is pinned (see `scripts/fetch-binaries.js`);
   to upgrade it, change the URL and the three SHA-256 values there and update `THIRD_PARTY_NOTICES.md` and `licenses/README.txt`.
4. **Checks**: `npm run check` and `npm test` must pass (CI runs both on Windows and Linux).
5. **Build**: `bash scripts/build-release.sh` (Linux) or the steps of [BUILDING.md](BUILDING.md) (Windows).
   Optional: `EASYTUBE_REF=<folder>` keeps a `SHA256-<version>.txt` copy of the installer checksum.
6. **Verify the build** (do not skip, nothing below is covered by the automated tests):
   - fuses: `node node_modules/@electron/fuses/dist/bin.js read --app dist/win-unpacked/EasyTube.exe`
     (expected: `RunAsNode` Enabled, `EnableNodeOptionsEnvironmentVariable` Disabled, `EnableNodeCliInspectArguments` Disabled, `EnableCookieEncryption` Enabled);
   - on a **real Windows machine**: install, start, download a video and an audio file, cancel one, try a YouTube link (this exercises the JavaScript runtime), uninstall (answer *Keep* once, *Delete* once);
   - **update in place**: install the previous release, then the new one over it; settings and history must still be there;
   - scan `EasyTube-Setup-<version>.exe` on [VirusTotal](https://www.virustotal.com) and note the result.
7. **macOS build** (on a Mac, see [BUILDING.md](BUILDING.md#5-build-for-macos)): `npm run fetch-binaries`, `npm test`, `npm run dist:mac`, then verify (nothing below is covered by the automated tests):
   - `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/EasyTube.app` and `codesign -dv` (expected: ad-hoc signature);
   - fuses: `node node_modules/@electron/fuses/dist/bin.js read --app dist/mac-arm64/EasyTube.app` (same expected values as on Windows, except `EnableCookieEncryption`, which is **Disabled** on macOS on purpose: enabled, macOS asks for a Keychain password at launch);
   - launch the app **from a fresh build**: no Keychain or password prompt may appear (a Keychain prompt means the cookie-encryption fuse is on);
   - the bundled tools run: `EasyTube.app/Contents/Resources/bin/yt-dlp --version`, `ffmpeg -version`, `ffprobe -version`;
   - on a **real Mac**: open the `.dmg`, drag the app to *Applications*, first launch (with the quarantine attribute, as a downloaded file would have: `xattr -w com.apple.quarantine "0081;00000000;Safari;" EasyTube.app` → "Open Anyway" flow), download a video and an audio file, cancel one, try a YouTube link (JavaScript runtime), quit with `⌘Q`, check that `⌘V`, `⌘L`, `⌘↩` and `⌘,` work, switch the language, relaunch (settings and history kept in `~/Library/Application Support/EasyTube`);
   - make the zip **on the Mac**: `python3 release/make_release.py --mac --min-macos 13.0` (13.0 = `LSMinimumSystemVersion` in the app's `Info.plist`). On macOS the script zips with `ditto`, which keeps the EasyTube icon of the `.dmg` file; a zip made on another system works the same but the `.dmg` then shows Finder's generic icon (cosmetic);
   - `shasum -a 256` of the `.zip` for the release notes.
8. **Publish**: create a GitHub release, upload `EasyTube-Setup-<version>.zip` and `EasyTube-<version>-mac-arm64.zip`, paste the changelog entry and the **SHA-256** of each file.

### macOS signing and notarization

The macOS build is **ad-hoc signed and not notarized** (no Apple Developer account). Users must use *System Settings → Privacy & Security → Open Anyway* the first time; this is explained in the README and in the `.dmg` background.
To ship a build that opens without any warning, you need an Apple Developer ID (99 USD/year): set `mac.identity` to the certificate, enable `hardenedRuntime` with the entitlements Electron needs, and add notarization (`notarize` in electron-builder) with an app-specific password or API key kept in CI secrets, never in the repository. Nothing else in the project has to change.

## About the in-app update check

When `package.json` has a `repository` (`https://github.com/<owner>/<repo>`), EasyTube reads
`<repo>/releases/latest` (a redirect, no API key, no quota) at most every 12 hours and shows a banner if a newer version exists.
It never downloads or installs anything: the banner opens the release page. Without a `repository`, the feature stays off.
