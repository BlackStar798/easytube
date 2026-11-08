# Building EasyTube

## Requirements

- **Node.js 22 or newer** and npm
- Internet access for `npm install` (Electron) and for downloading yt-dlp and FFmpeg (~85 MB archive on Windows)
- Around **2 GB** of free disk space for the build
- Windows build: any system (Linux works, without Wine). **macOS build: a Mac is required** (see [section 5](#5-build-for-macos)): code signing and the `.dmg` use macOS-only tools (`codesign`, `hdiutil`).

## 1. Run it in development

```bash
npm install
npm run fetch-binaries
npm start
```

`npm run fetch-binaries` fills `resources/bin` (Windows programs; not stored in the repository, ~250 MB):

| File | Comes from |
|---|---|
| `yt-dlp.exe` | the latest official yt-dlp release, checked against its published SHA-256 |
| `ffmpeg.exe`, `ffprobe.exe` | the FFmpeg 6.1.1 "essentials" build by Gyan Doshi (GitHub release asset). The archive and both files are checked against SHA-256 values pinned in `scripts/fetch-binaries.js`, so a changed download is rejected |

Options: `--force` downloads yt-dlp again; `--ffmpeg-zip <file.zip>` uses an archive you already downloaded (same checks, Windows only); `--out <folder>` writes somewhere else;
`--target win32|darwin` and `--arch arm64|x64` choose the system the binaries are for (default: the system you run on; on macOS the output folder is `resources/bin-mac-<arch>`, see section 5).
It works the same on Windows, Linux and macOS: the script only downloads and unpacks the programs for the chosen target.

Other checks:

```bash
npm run check            # translation files: same keys, same placeholders, nothing missing
npm test                 # automated tests (Node's built-in test runner, no extra dependency)
node --check main.js     # quick syntax check (same for the other .js files)
```

## 2. Build the app folder

```bash
npx electron-builder --win --x64 --dir
```

This creates `dist/win-unpacked/` (`EasyTube.exe` + resources, including `resources/bin` and `resources/licenses`).
`build/afterPack.js` then (1) sets the icon and the version information of `EasyTube.exe` (so the build works from Linux too, without Wine) and (2) hardens Electron by flipping its *fuses*: `NODE_OPTIONS` and the `--inspect` flags are ignored, cookie storage is encrypted.
`RunAsNode` stays **on** on purpose: EasyTube starts itself with `ELECTRON_RUN_AS_NODE=1` as the JavaScript runtime yt-dlp needs for YouTube (see `lib/engine.js`, `probeJsRuntime`). Read the fuses of a build with:

```bash
node node_modules/@electron/fuses/dist/bin.js read --app dist/win-unpacked/EasyTube.exe
```

> `npm run dist` runs electron-builder's *own* installer. The project's installer is the hand-written NSIS script `installer.nsi` (custom pages, English text, About page, update-in-place, "uninstall never empties a shared folder" logic), built as in step 3.

## 3. Build the installer

You need NSIS 3 (`makensis`) and the NSIS plugin folder that electron-builder downloads on first use
(the `plugins/x86-unicode` folder inside its `nsis-resources` cache; it provides `WinShell`, used for notification names).

```bash
makensis -DRESDIR=<path to nsis-resources/.../plugins/x86-unicode> installer.nsi
```

Result: `dist/EasyTube-Setup-<version>.exe`.

On Linux, with electron-builder's cached NSIS, everything (steps 2 and 3, then the zip) is scripted:

```bash
bash scripts/build-release.sh
```

## 4. Release `.zip`

```bash
python3 release/make_release.py
```

Requirements: the first entry of `release/changelog.json`, `version` in `package.json` and `APPVERSION` in `installer.nsi` must all match.
The script writes `dist/README.txt` (French + English, with the full changelog) and `dist/EasyTube-Setup-<version>.zip`, and prints the **SHA-256** of the installer.
Set `EASYTUBE_REF=<folder>` to also keep a `SHA256-<version>.txt` copy of that checksum there.

## 5. Build for macOS

Build on a Mac (Apple Silicon for the `arm64` build). Nothing else than Node.js 22+ is needed (Xcode command line tools are not required for the build itself).

```bash
npm install
npm run fetch-binaries   # → resources/bin-mac-arm64: yt-dlp (yt-dlp_macos asset, SHA-256 checked), ffmpeg, ffprobe
npm test
npm run dist:mac         # electron-builder --mac --arm64
```

Result in `dist/`: `EasyTube-<version>-mac-arm64.dmg` (drag-to-Applications window with the project's background and the EasyTube icon, on the disk and on the file: `build/afterAllArtifactBuild.js`) and, unpacked, `dist/mac-arm64/EasyTube.app`.
The window is 660 × 400 points: `build/dmg-background.png` (660 × 400, 72 dpi) and `build/dmg-background@2x.png` (1320 × 800, 144 dpi) must keep exactly these sizes, because electron-builder takes the window size from the background image. Finder's title bar hides about 30 points at the bottom, so keep text out of that strip.
The release `.zip` (DMG + bilingual `README.txt`) is then made with `python3 release/make_release.py --mac --min-macos 13.0` (see [RELEASING.md](RELEASING.md)).
Intel build: `node scripts/fetch-binaries.js --arch x64` then `npx electron-builder --mac --x64` (only if you pinned x64 FFmpeg hashes, see below).

How the macOS build differs:

- **Signature**: ad-hoc (`identity: "-"`). Apple Silicon refuses unsigned code, an ad-hoc signature is the minimum. It is **not notarized**: on other Macs, Gatekeeper asks for **System Settings → Privacy & Security → Open Anyway** the first time (a Mac that builds the app itself does not show this, the file is not quarantined). A paid Apple Developer ID would allow a signed, notarized build (see [RELEASING.md](RELEASING.md)).
- **Fuses and licenses**: `build/afterPack.js` copies Electron's and Chromium's license texts into `EasyTube.app/Contents/Resources/licenses` (electron-builder drops them on macOS; they are read from `node_modules/electron/dist`), then flips the same fuses as on Windows, except **cookie encryption, which stays off on macOS**: EasyTube stores no cookies, and with it on, macOS shows an "EasyTube Safe Storage" Keychain password prompt at launch. This happens before electron-builder signs the app. `RunAsNode` stays on for the same reason as on Windows (JavaScript runtime for yt-dlp).
- **Binaries**: `mac.extraResources` copies `resources/bin-mac-<arch>` to `EasyTube.app/Contents/Resources/bin`. yt-dlp is copied at first launch to `~/Library/Application Support/EasyTube/bin` (the app bundle itself is never modified, which would break its signature) and its quarantine attribute is removed.
- **FFmpeg**: `scripts/fetch-binaries.js` has a `MAC_FFMPEG` table with the pinned URL and SHA-256 of each file per architecture. To refresh it: `FFMPEG_FFMPEG_URL=<url> FFMPEG_FFPROBE_URL=<url> node scripts/fetch-binaries.js --target darwin --arch arm64 --print-hashes`, check the printed values against the publisher's checksums, then paste them in the table.
- **Menu and shortcuts**: the macOS menu bar (`buildMacMenu` in `main.js`) is required for `⌘C`, `⌘V`, `⌘Q`; shortcuts shown in the interface use `⌘` (`.mac` keys in `locales/*.json`).
- **Safari cookies** (Settings → Advanced) need *Full Disk Access* for EasyTube; the app explains this when it fails.

CI: `.github/workflows/build-mac.yml` builds and checks the app on a GitHub macOS runner (manual run or on a `v*` tag).

## Good to know

- The installer is **not code-signed**. SmartScreen and some antivirus programs may warn about it (false positive).
- yt-dlp is copied at first launch to `<install folder>\data\bin`, so it can update itself without administrator rights.
- Installing over an older EasyTube **updates it in place**: program files are replaced, the `data` folder (settings, history, yt-dlp copy) is kept. Uninstalling asks whether to keep `data`.
- `EasyTube.exe` is also used as the JavaScript runtime for yt-dlp (`ELECTRON_RUN_AS_NODE=1`). A startup test checks it; if it fails (or an antivirus blocks it), EasyTube falls back to yt-dlp's default behaviour. Settings → Advanced → *Use EasyTube's built-in helper for YouTube* turns it off.
- Installing never needs administrator rights (`RequestExecutionLevel user`, installed under `%LOCALAPPDATA%\Programs` by default).
- `resources/bin` binaries are GPL programs: see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before redistributing a build.
