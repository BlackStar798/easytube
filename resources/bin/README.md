# resources/bin

This folder is filled by `npm run fetch-binaries` and is **not** stored in the repository (about 250 MB):

- `yt-dlp.exe`: official yt-dlp release (SHA-256 verified)
- `ffmpeg.exe` and `ffprobe.exe`: taken from the official FFmpeg 6.1.1 "essentials" build by Gyan Doshi (the archive and both files are checked against SHA-256 values pinned in `scripts/fetch-binaries.js`)

For macOS the same script fills `resources/bin-mac-<arch>` (`arm64` or `x64`, also not stored in the repository):

- `yt-dlp`: the official `yt-dlp_macos` release file (SHA-256 verified)
- `ffmpeg` and `ffprobe`: taken from the FFmpeg 9.0.2 static builds by Martin Riedl (<https://ffmpeg.martin-riedl.de>), checked against SHA-256 values pinned in `scripts/fetch-binaries.js`

See `docs/BUILDING.md`. The licenses of these programs are listed in `THIRD_PARTY_NOTICES.md`.
