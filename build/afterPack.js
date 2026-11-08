'use strict';
/**
 * After packaging:
 *  1. puts the icon and the version information in the .exe
 *     (electron-builder normally does it with rcedit/wine, unavailable here: we use resedit, pure JavaScript);
 *  2. flips Electron "fuses" (switches inside the .exe) to remove what the app does not need.
 * On macOS only step 2 applies (the icon and Info.plist are handled by electron-builder), and it runs
 * BEFORE electron-builder signs the app, so the signature covers the flipped Electron.
 */
const fs = require('fs');
const path = require('path');

/**
 * Same switches on every system, except cookie encryption.
 * EasyTube stores no cookies, so encrypting them protects nothing. On Windows it is silent (system key store),
 * but on macOS Chromium then creates an "EasyTube Safe Storage" key in the user's Keychain, and macOS asks for
 * the Keychain password (again after every update of an app that is not signed by an Apple certificate).
 * That alarming prompt for nothing is worse than no encryption, so it stays off on macOS.
 */
function fuseConfig(FuseVersion, FuseV1Options, cookieEncryption) {
  return {
    version: FuseVersion.V1,
    // No NODE_OPTIONS and no --inspect: nobody can inject code into EasyTube through the environment.
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Cookie encryption on disk: on for Windows, off for macOS (see above).
    [FuseV1Options.EnableCookieEncryption]: cookieEncryption,
    // Deliberately KEPT: EasyTube started with ELECTRON_RUN_AS_NODE=1 acts as the JavaScript
    // runtime that yt-dlp needs for YouTube (see lib/engine.js, probeJsRuntime).
    [FuseV1Options.RunAsNode]: true,
  };
}

/**
 * On Windows electron-builder keeps Electron's LICENSE and LICENSES.chromium.html next to the .exe; on macOS it
 * copies only Electron.app and drops them. They are required by the MIT / BSD licenses, so they are put in the
 * app's `licenses` folder (reachable from Settings > About) under the same names as in the Windows install.
 * Looked for next to Electron.app in `electronDist` when set, otherwise in node_modules/electron/dist.
 */
function copyElectronLicenses(context, appPath) {
  const cfg = context.packager.config || {};
  const dirs = [typeof cfg.electronDist === 'string' ? cfg.electronDist : null,
    path.join(context.packager.projectDir, 'node_modules', 'electron', 'dist')].filter(Boolean);
  const dest = path.join(appPath, 'Contents', 'Resources', 'licenses');
  fs.mkdirSync(dest, { recursive: true });
  const files = [['LICENSE', 'LICENSE.electron.txt'], ['LICENSES.chromium.html', 'LICENSES.chromium.html']];
  for (const [from, to] of files) {
    const src = dirs.map((d) => path.join(d, from)).find((f) => fs.existsSync(f));
    if (!src) throw new Error(`${from} of Electron not found (looked in: ${dirs.join(', ')}). Run \`npm install\` so node_modules/electron/dist exists.`);
    fs.copyFileSync(src, path.join(dest, to));
  }
  console.log('  • Electron and Chromium license texts copied to Contents/Resources/licenses');
}

async function afterPackMac(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  copyElectronLicenses(context, appPath);
  await flipFuses(appPath, fuseConfig(FuseVersion, FuseV1Options, false));
  console.log('  • Electron fuses flipped on the macOS app (NODE_OPTIONS off, --inspect off, cookie encryption off: no Keychain prompt, RunAsNode kept)');
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') return afterPackMac(context);
  if (context.electronPlatformName !== 'win32') return undefined;
  const ResEdit = require('resedit');
  const productName = context.packager.appInfo.productName;
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  const icoPath = path.join(__dirname, 'icon.ico');
  const version = context.packager.appInfo.version;

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);

  // Icône
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    target.id,
    target.lang,
    iconFile.icons.map((i) => i.data),
  );

  // Informations de version
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [maj, min, pat] = version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(maj, min, pat, 0, 1033);
  vi.setProductVersion(maj, min, pat, 0, 1033);
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      FileDescription: productName,
      ProductName: productName,
      CompanyName: productName,
      LegalCopyright: 'Copyright (c) 2026 The EasyTube contributors. MIT License.',
      OriginalFilename: `${productName}.exe`,
      InternalName: productName,
    },
  );
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • icon and version applied to ${path.basename(exePath)}`);

  // Fuses are flipped AFTER the resources are rewritten (they are plain bytes inside the .exe).
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  await flipFuses(exePath, fuseConfig(FuseVersion, FuseV1Options, true));
  console.log('  • Electron fuses flipped (NODE_OPTIONS off, --inspect off, cookie encryption on, RunAsNode kept)');
  return undefined;
};
