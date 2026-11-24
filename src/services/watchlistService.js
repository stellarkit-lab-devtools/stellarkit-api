/**
 * Watchlist lookup service.
 *
 * Checks whether a Stellar account appears on any community-maintained
 * watchlist. No external watchlist source is configured yet, so every
 * account is reported as not listed. Keeping the lookup behind this module
 * lets GET /account/:id/watchlist-status plug in real sources later without
 * changing the route, and lets tests mock the lookup.
 */

/**
 * @param {string} accountId - Stellar account ID (G...)
 * @returns {Promise<{ onWatchlist: boolean, sources: string[], reason: string|null }>}
 */
async function checkWatchlist(accountId) { // eslint-disable-line no-unused-vars
  return {
    onWatchlist: false,
    sources: [],
    reason: null,
  };
}

module.exports = { checkWatchlist };
