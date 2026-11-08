# Third-party notices

EasyTube's own code is released under the [MIT License](LICENSE).
The Windows installer and the macOS disk image also contain programs and a font made by other people.
Each keeps its own license. EasyTube runs the programs as separate processes
(it never links to them) and delivers them unchanged.

> This is a plain-language summary, not legal advice. The full license texts
> are in the [`licenses/`](licenses/) folder, which is also installed with the app
> (Settings → About → *Open the licenses folder*).

## What ships in the installer (Windows) and the disk image (macOS)

| Component | Version in this release | License | Full text / details | Source code |
|---|---|---|---|---|
| **yt-dlp** (`yt-dlp.exe`) | downloaded from the official releases when the installer is built; can be updated inside the app | Source: **Unlicense**. The PyInstaller `.exe` bundles GPL-3.0+ code, so the combined work is **GPL-3.0-or-later** | [`Unlicense-yt-dlp.txt`](licenses/Unlicense-yt-dlp.txt), [`GPL-3.0.txt`](licenses/GPL-3.0.txt), [`yt-dlp-THIRD_PARTY_LICENSES.txt`](licenses/yt-dlp-THIRD_PARTY_LICENSES.txt) (Python, OpenSSL, requests, mutagen… bundled inside the `.exe`) | <https://github.com/yt-dlp/yt-dlp> |
| **FFmpeg** (`ffmpeg.exe`) | 6.1.1, "essentials" build by Gyan Doshi | **GPL-3.0** (built with `--enable-gpl --enable-version3`) | [`GPL-3.0.txt`](licenses/GPL-3.0.txt) | <https://github.com/FFmpeg/FFmpeg/commit/e38092ef93> · builds: <https://www.gyan.dev/ffmpeg/builds/> |
| **FFprobe** (`ffprobe.exe`) | 6.1.1, from the same "essentials" build as `ffmpeg.exe` | **GPL-3.0** | [`GPL-3.0.txt`](licenses/GPL-3.0.txt) | <https://github.com/FFmpeg/FFmpeg/commit/e38092ef93> |
| **yt-dlp** (`yt-dlp_macos`, macOS) | downloaded from the official releases when the disk image is built; can be updated inside the app | Source: **Unlicense**. The PyInstaller program bundles GPL-3.0+ code, so the combined work is **GPL-3.0-or-later** | same files as the Windows row | <https://github.com/yt-dlp/yt-dlp> |
| **FFmpeg** (`ffmpeg`, macOS) | 9.0.2, static release build by Martin Riedl | **GPL-3.0** (built with `--enable-gpl --enable-version3`) | [`GPL-3.0.txt`](licenses/GPL-3.0.txt) | <https://ffmpeg.martin-riedl.de> (the page lists the exact source and build options) · <https://github.com/FFmpeg/FFmpeg> |
| **FFprobe** (`ffprobe`, macOS) | 9.0.2, from the same Martin Riedl build | **GPL-3.0** | [`GPL-3.0.txt`](licenses/GPL-3.0.txt) | same as the macOS FFmpeg row |
| **Electron** | 45.2.3 | **MIT** | `LICENSE.electron.txt` (installed next to `EasyTube.exe`; in the app's `licenses` folder on macOS) | <https://github.com/electron/electron> |
| **Chromium** and its dependencies (inside Electron) | the version bundled with Electron 45.2.3 | BSD-style and others | `LICENSES.chromium.html` (installed next to `EasyTube.exe`; in the app's `licenses` folder on macOS) | <https://www.chromium.org/> |
| **Bricolage Grotesque** (font) | via `@fontsource-variable/bricolage-grotesque` 5.3.0 | **SIL OFL 1.1** — © 2022 The Bricolage Grotesque Project Authors | [`OFL-1.1-BricolageGrotesque.txt`](licenses/OFL-1.1-BricolageGrotesque.txt) | <https://github.com/ateliertriay/bricolage> |
| **NSIS** (installer engine) | 3.0.4.1 | zlib/libpng license | shipped inside `EasyTube-Setup-x.y.z.exe` | <https://nsis.sourceforge.io/> |

How the binaries reach the build (`npm run fetch-binaries`, see `scripts/fetch-binaries.js`):
- **Windows**: `ffmpeg.exe` and `ffprobe.exe` are taken, unchanged, from the official
  [FFmpeg 6.1.1 "essentials" build by Gyan Doshi](https://www.gyan.dev/ffmpeg/builds/)
  (archive and both files are checked against SHA-256 values written in the script),
  and `yt-dlp.exe` comes from the official yt-dlp releases (checked against the published SHA-256).
- **macOS**: `ffmpeg` and `ffprobe` are taken, unchanged, from the
  [FFmpeg 9.0.2 static builds by Martin Riedl](https://ffmpeg.martin-riedl.de) (one exact, dated download address per
  processor type; archive and files are checked against SHA-256 values written in the script),
  and `yt-dlp_macos` comes from the official yt-dlp releases (checked against the published SHA-256).

## Used only to build (not shipped)

`electron-builder` 26.18.0 (MIT, with its `dmgbuild` tool for the macOS disk image), `resedit` 3.1.0 (MIT), `@electron/fuses` 1.8.x (MIT).

## Source code offer for the GPL programs

The GPL programs above are delivered exactly as their authors published them.
Their corresponding source code is available at the addresses in the table.
If you cannot get it from there, open an issue on the EasyTube project page and
it will be provided.

## Trademarks

EasyTube is an independent project. It is not affiliated with, or endorsed by,
yt-dlp, FFmpeg, Electron, YouTube or any website it can download from.
All trademarks belong to their owners.
