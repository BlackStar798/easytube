'use strict';
/**
 * "Is there a newer EasyTube?" - a simple read of the latest release number on the project's
 * GitHub page (same method as the yt-dlp check: follow the /releases/latest redirect).
 * Nothing is downloaded or installed: the app only tells the user and opens the release page.
 * Dormant until package.json has a GitHub "repository" (see main.js: repoUrl()).
 */
const updater = require('./updater');

/**
 * @param {{repo: string, current: string, fetchImpl?: Function}} p  repo = "https://github.com/<owner>/<repo>"
 * @returns {Promise<{available: boolean, latest: string, url: string}>}
 */
async function checkApp({ repo, current, fetchImpl }) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('No repository configured');
  const { tag } = await updater.latestRelease(`${repo}/releases`, fetchImpl);
  const latest = tag.replace(/^v/i, '');
  return {
    available: /^\d+(\.\d+)*/.test(latest) && updater.compareVersions(latest, current) > 0,
    latest,
    url: `${repo}/releases/latest`,
  };
}

module.exports = { checkApp };
