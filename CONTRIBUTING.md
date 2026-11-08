# Contributing to EasyTube

Thanks for wanting to help! Bug reports, translations, ideas and pull requests are all welcome.

## Reporting a bug

Open an issue and tell us:
- your EasyTube version (**Settings → About**) and your Windows or macOS version (the **Copy diagnostics** button in About gives all of it);
- the link type or site (you do not need to share a private link);
- what you expected, and what happened (a screenshot of the error screen helps; its "Technical details" section is useful too).

Many failures come from the website changing, not from EasyTube. Try **Settings → Check for updates** first: a newer yt-dlp often fixes it.

## Running the app

```bash
npm install
npm run fetch-binaries   # yt-dlp + FFmpeg/FFprobe for your system (resources/bin on Windows, resources/bin-mac-<arch> on a Mac)
npm start
npm test                 # automated tests (Node 22+, nothing to install)
npm run check            # translation files
```

Full build instructions (installer included): [docs/BUILDING.md](docs/BUILDING.md).

## How the code is organized

| Path | What it does |
|---|---|
| `main.js` | Electron main process: window, settings, history, IPC handlers, notifications |
| `preload.js` | The only bridge between the window and the main process (`window.api`) |
| `lib/engine.js` | Runs yt-dlp (analyze, download, progress parsing, friendly error codes, JavaScript-runtime test). No Electron dependency |
| `lib/validate.js` | Checks everything that comes from the window (settings, download options) before it is saved or reaches yt-dlp |
| `lib/updater.js` | Updates yt-dlp from the official release, SHA-256 verified |
| `lib/appupdate.js` | "Is there a newer EasyTube?" (reads the latest release number, installs nothing) |
| `renderer/` | The interface: `index.html`, `style.css`, `app.js`, bundled font |
| `locales/` | `en.json` and `fr.json` (all texts) |
| `tests/` | Automated tests (`node:test`), with a fake yt-dlp in `tests/fixtures/` |
| `installer.nsi`, `build/` | Windows installer script, its images, `icon.icns` and the `.dmg` background for macOS, and `afterPack.js` (icon, version info, Electron fuses) |
| `release/` | Changelog and the script that builds the release `.zip` + `README.txt` |
| `licenses/` | License texts shipped with the app |

Security basics to keep: the window has `contextIsolation` and `sandbox` on, a strict Content-Security-Policy, and no Node access. New features that need the system go through a **validated** IPC handler in `main.js` (and `lib/validate.js` for the values), never through a looser window. The window is treated as untrusted: unknown settings and out-of-list values are dropped.

## Translations

All visible text lives in `locales/en.json` and `locales/fr.json`.
- Add every new key to **both** files, with the same `{placeholders}`.
- In the HTML use `data-i18n="key"` (or `data-i18n-attr="aria-label:key"`); in the code use `t('key')`.
- Run `npm run check` before sending a change: it fails if a key is missing, empty, or used but not defined.

To add a language: copy `en.json` to `xx.json`, translate it, add the code to `LANGS` in `main.js` and a button to the language switch in `renderer/index.html`.

## Pull requests

- Keep a change focused on one thing, and describe how you tested it.
- Run `npm test` and `npm run check`; add a test when you change `lib/`.
- Do not break what already works: try a video download, an audio download, a cancel, both languages and the smallest window size (900 × 660).
- Visual changes: attach a screenshot.
- By contributing, you agree that your contribution is released under the project's [MIT License](LICENSE).
- Platform code: anything that touches paths, processes, windows or shortcuts must keep working on **both Windows and macOS** (`process.platform` checks live in `main.js` and `lib/engine.js`; macOS texts use `.mac` keys in `locales/*.json`). If you can only test on one, say so in the pull request.
- Do not commit binaries (`resources/bin/*.exe`, `resources/bin-mac-*/`, `dist/`): they are rebuilt by the scripts.

## Releases (maintainers)

See **[docs/RELEASING.md](docs/RELEASING.md)**: version bump, changelog entry, build, verification checklist, publication.
