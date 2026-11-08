'use strict';
/**
 * After every artifact is built (macOS only): put the EasyTube icon on the .dmg FILE itself,
 * so it does not show Finder's generic "disk image" icon.
 *
 * (The icon of the MOUNTED disk is a different thing: electron-builder already stores
 * build/icon.icns in the image as .VolumeIcon.icns.)
 *
 * The icon of a file lives in the file's extended attributes on the Mac that made it. It is
 * kept when the .dmg is zipped with Finder or `ditto -c -k --sequesterRsrc`, and lost by a
 * plain upload or by zip tools that ignore extended attributes: it is only cosmetic.
 * Uses JavaScript for Automation (osascript), which ships with macOS: nothing to install.
 * Never fails the build.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const JXA = `
ObjC.import('AppKit');
function run(argv) {
  var img = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
  if (!img || img.isNil()) return 'no-icon';
  return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(img, argv[1], 0) ? 'ok' : 'failed';
}`;

exports.default = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') return [];
  const icns = path.join(__dirname, 'icon.icns');
  for (const file of buildResult.artifactPaths || []) {
    if (!file.toLowerCase().endsWith('.dmg')) continue;
    try {
      const out = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA, icns, file], { encoding: 'utf8' }).trim();
      console.log(`  • icon on the .dmg file: ${out}  file=${path.basename(file)}`);
    } catch (e) {
      console.warn(`  • could not set the icon on ${path.basename(file)} (not important): ${e.message.split('\n')[0]}`);
    }
  }
  return [];
};
