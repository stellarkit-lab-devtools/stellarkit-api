/**
 * Per-endpoint cache TTL configuration.
 *
 * Each value is read from a dedicated environment variable (in milliseconds)
 * and converted to seconds for use with node-cache. A sensible default is
 * provided for every endpoint so the server works out-of-the-box without any
 * env configuration.
 *
 * Environment variables (all in milliseconds):
 *   CACHE_TTL_NETWORK_STATUS_MS  — /network-status            (default: 10 000 ms)
 *   CACHE_TTL_FEE_ESTIMATE_MS    — /fee-estimate & surge-status (default: 5 000 ms)
 *   CACHE_TTL_BASE_FEE_MS        — /network/base-fee          (default: 5 000 ms)
 *   CACHE_TTL_VALIDATORS_MS      — /network/validators        (default: 300 000 ms)
 *   CACHE_TTL_ASSET_MS           — /asset/:code/:issuer       (default: 30 000 ms)
 *   CACHE_TTL_ASSET_PRICE_MS     — /asset price endpoint      (default: 5 000 ms)
 *   CACHE_TTL_CLAIMABLE_BALANCES_MS — /account/:id/claimable-balances (default: 20 000 ms)
 *   CACHE_TTL_EFFECTS_MS         — /account/:id/effects          (default: 30 000 ms)
 *   CACHE_TTL_SIGNING_KEYS_MS   — /account/:id/signing-keys     (default: 20 000 ms)
 *   CACHE_TTL_FREEZE_CHECK_MS   — /account/:id/freeze-status     (default: 30 000 ms)
 *   CACHE_TTL_BALANCES_BY_SPONSOR_MS — /claimable-balances/by-sponsor (default: 30 000 ms)
 *   CACHE_TTL_FREEZE_CHECK_MS   — /account/:id/freeze-status     (default: 30 000 ms)
 *   CACHE_TTL_SIGNING_KEYS_MS   — /account/:id/signing-keys      (default: 20 000 ms)
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
  /** /network-status — live Horizon root payload, 10 s default */
  networkStatus: msToSeconds(
    process.env.CACHE_TTL_NETWORK_STATUS_MS,
    parseInt(process.env.CACHE_TTL_MS, 10) || 10000
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

  /** /account/:id/pool-positions — changes only when joining or exiting a liquidity pool */
  poolPositions: msToSeconds(
    process.env.CACHE_TTL_POOL_POSITIONS_MS,
    15000
  ),

  /** /account/:id/transaction-count — changes only on new submissions */
  transactionCount: msToSeconds(
    process.env.CACHE_TTL_TX_COUNT_MS,
    20000
  ),

  /** /dex/top-markets — trade aggregation window, refresh every 60 s by default */
  topMarkets: msToSeconds(
    process.env.CACHE_TTL_TOP_MARKETS_MS,
    60000
  ),

  /** /dex/arbitrage — market conditions change rapidly, short TTL by default */
  arbitrage: msToSeconds(
    process.env.CACHE_TTL_ARBITRAGE_MS,
    5000
  ),

  /** /account/:id/sequence — changes only when account submits a transaction */
  sequence: msToSeconds(
    process.env.CACHE_TTL_SEQUENCE_MS,
    20000
  ),

  /** /network/fee-percentiles */
  feePercentiles: msToSeconds(
    process.env.CACHE_TTL_FEE_PERCENTILES_MS,
    globalFallbackMs
  ),

  /** /account/:id/asset-balance/:code/:issuer — single trustline balance lookup */
  assetBalance: msToSeconds(
    process.env.CACHE_TTL_ASSET_BALANCE_MS,
    10000
  ),

  /** /account/:id/trades — trade history per account */
  trades: msToSeconds(
    process.env.CACHE_TTL_TRADES_MS,
    globalFallbackMs
  ),

  /** /liquidity-pools/:id/trades — pool trade history */
  poolTrades: msToSeconds(
    process.env.CACHE_TTL_POOL_TRADES_MS,
    globalFallbackMs
  ),

  /** /account/:id/freeze-status — changes only when issuer modifies auth flags */
  freezeCheck: msToSeconds(
    process.env.CACHE_TTL_FREEZE_CHECK_MS,
    30000
  ),

  /** /account/:id/signing-keys — changes only when account modifies signers */
  signingKeys: msToSeconds(
    process.env.CACHE_TTL_SIGNING_KEYS_MS,
    20000
  ),

  /** /soroban/contract/:id/storage — instance storage changes only on invoke */
  contractStorage: msToSeconds(
    process.env.CACHE_TTL_CONTRACT_STORAGE_MS,
    15000
  ),

  /** /soroban/contract/:id/functions — contract ABI is immutable per WASM hash */
  contractFunctions: msToSeconds(
    process.env.CACHE_TTL_CONTRACT_FUNCTIONS_MS,
    60000
  ),
};

module.exports = cacheTTL;
