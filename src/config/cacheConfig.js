/**
 * Per-endpoint cache TTL configuration.
 *
 * Each value is read from a dedicated environment variable (in milliseconds)
 * and converted to seconds for use with node-cache. A sensible default is
 * provided for every endpoint so the server works out-of-the-box without any
 * env configuration.
 *
 * Environment variables (all in milliseconds):
 *   CACHE_TTL_NETWORK_STATUS_MS  — /network-status            (default: 5 000 ms)
 *   CACHE_TTL_FEE_ESTIMATE_MS    — /fee-estimate & surge-status (default: 5 000 ms)
 *   CACHE_TTL_BASE_FEE_MS        — /network/base-fee          (default: 5 000 ms)
 *   CACHE_TTL_VALIDATORS_MS      — /network/validators        (default: 300 000 ms)
 *   CACHE_TTL_ASSET_MS           — /asset/:code/:issuer       (default: 30 000 ms)
 *   CACHE_TTL_ASSET_PRICE_MS     — /asset price endpoint      (default: 5 000 ms)
 *   CACHE_TTL_CLAIMABLE_BALANCES_MS — /account/:id/claimable-balances (default: 20 000 ms)
 *   CACHE_TTL_EFFECTS_MS         — /account/:id/effects          (default: 30 000 ms)
 *
 * The legacy CACHE_TTL_MS variable is still respected as a global fallback so
 * existing deployments are not broken.
 */

function msToSeconds(ms, defaultMs) {
  const parsed = parseInt(ms, 10);
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs) / 1000;
}

const globalFallbackMs = parseInt(process.env.CACHE_TTL_MS, 10) || 5000;

const cacheTTL = {
  /** /network-status — one ledger close interval */
  networkStatus: msToSeconds(
    process.env.CACHE_TTL_NETWORK_STATUS_MS,
    globalFallbackMs
  ),

  /** /fee-estimate and /fee-estimate/surge-status */
  feeEstimate: msToSeconds(
    process.env.CACHE_TTL_FEE_ESTIMATE_MS,
    globalFallbackMs
  ),

  /** /network/base-fee */
  baseFee: msToSeconds(
    process.env.CACHE_TTL_BASE_FEE_MS,
    globalFallbackMs
  ),

  /** /network/validators — changes rarely, longer TTL by default */
  validators: msToSeconds(
    process.env.CACHE_TTL_VALIDATORS_MS,
    300000
  ),

  /** /asset/:code/:issuer */
  asset: msToSeconds(
    process.env.CACHE_TTL_ASSET_MS,
    30000
  ),

  /** asset price endpoint */
  assetPrice: msToSeconds(
    process.env.CACHE_TTL_ASSET_PRICE_MS,
    globalFallbackMs
  ),

  /** /account/:id/claimable-balances — changes only on create/claim */
  claimableBalances: msToSeconds(
    process.env.CACHE_TTL_CLAIMABLE_BALANCES_MS,
    20000
  ),

  /** /account/:id/effects — historical ledger effects, immutable once written */
  effects: msToSeconds(
    process.env.CACHE_TTL_EFFECTS_MS,
    30000
  ),
};

module.exports = cacheTTL;
