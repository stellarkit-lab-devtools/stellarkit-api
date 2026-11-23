const HORIZON_TIMEOUT_MESSAGE =
  "The Stellar Horizon node did not respond in time.";
const HORIZON_TIMEOUT_SUGGESTION =
  "Try again in a few seconds. If the issue persists check the Stellar network status at https://status.stellar.org.";

/**
 * Returns true when an error indicates Horizon did not respond before the timeout.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isHorizonTimeoutError(err) {
  if (!err) return false;
  if (err.isHorizonTimeout) return true;
  // Horizon HTTP errors include response.data and are not timeouts
  if (err.response && err.response.data) return false;

  const code = err.code || (err.cause && err.cause.code);
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return true;
  if (err.name === "AbortError") return true;

  const msg = (err.message || "").toLowerCase();
  return msg.includes("timeout") || msg.includes("timed out");
}

/**
 * Creates a structured HorizonTimeout error for slow or unresponsive Horizon nodes.
 *
 * @returns {Error}
 */
function makeHorizonTimeoutError() {
  const err = new Error(HORIZON_TIMEOUT_MESSAGE);
  err.isHorizonTimeout = true;
  err.status = 504;
  return err;
}

/**
 * Creates a structured AccountNotFound error for Horizon 404 responses.
 *
 * @param {string} accountId - Stellar public key that was not found
 * @param {string} network - Network name ("testnet" or "mainnet")
 * @returns {Error}
 */
function makeAccountNotFoundError(accountId, network) {
  const err = new Error(
    `Account ${accountId} was not found on the Stellar ${network} network.`
  );
  err.isAccountNotFound = true;
  err.accountId = accountId;
  err.network = network;
  err.status = 404;
  return err;
}

function makeAssetNotFoundError(code, issuer, network) {
  const err = new Error(
    `Asset ${code}:${issuer} was not found on the Stellar ${network} network.`
  );
  err.isAssetNotFound = true;
  err.assetCode = code;
  err.assetIssuer = issuer;
  err.network = network;
  err.status = 404;
  return err;
}

/**
 * Creates a structured TrustlineNotFound error for when a specific asset
 * trustline does not exist on the given account.
 *
 * @param {string} address - Stellar account public key
 * @param {string} code - Asset code (e.g. "USDC")
 * @param {string} issuer - Asset issuer public key
 * @returns {Error}
 */
function makeTrustlineNotFoundError(address, code, issuer) {
  const err = new Error(
    `Account '${address}' does not hold a trustline for ${code}:${issuer}.`
  );
  err.isTrustlineNotFound = true;
  err.address = address;
  err.assetCode = code;
  err.assetIssuer = issuer;
  err.status = 404;
  return err;
}

/**
 * Creates a structured TomlFetchFailed error for when an issuer's
 * stellar.toml file cannot be fetched — due to a network error, a
 * missing file, or invalid TOML content.
 *
 * @param {string} issuer - Stellar public key of the asset issuer
 * @returns {Error}
 */
function makeTomlFetchFailedError(issuer) {
  const err = new Error(
    `Could not fetch stellar.toml for issuer '${issuer}'.`
  );
  err.isTomlFetchFailed = true;
  err.issuer = issuer;
  err.status = 502;
  return err;
}

/**
 * Builds the structured OrderBookEmpty error body returned by the DEX and
 * asset-price routes when Horizon reports no active order book for a pair.
 *
 * Unlike the other factories in this module this returns a plain object, not
 * an Error: the DEX routes embed it directly as the `error` field of a 404
 * response rather than passing it to the error handler.
 *
 * @param {string} sellAssetCode - Code of the asset being sold (base).
 * @param {string} buyAssetCode  - Code of the asset being bought (counter).
 * @returns {{ type: string, message: string, suggestion: string }}
 */
function makeOrderBookEmptyError(sellAssetCode, buyAssetCode) {
  return {
    type: "OrderBookEmpty",
    message: `No active order book found for ${sellAssetCode}/${buyAssetCode}.`,
    suggestion:
      "This pair has no active offers on the Stellar DEX. Check the asset codes and issuers, or try a more liquid pair such as XLM/USDC.",
  };
}

/**
 * Creates a structured LiquidityPoolNotFound error for Horizon 404 responses
 * on liquidity pool lookups.
 *
 * @param {string} poolId - The liquidity pool ID that was not found
 * @param {string} network - Network name ("testnet" or "mainnet")
 * @returns {Error}
 */
function makeLiquidityPoolNotFoundError(poolId, network) {
  const err = new Error(
    `Liquidity pool ${poolId} was not found on the Stellar ${network} network.`
  );
  err.isLiquidityPoolNotFound = true;
  err.poolId = poolId;
  err.network = network;
  err.status = 404;
  return err;
}

module.exports = {
  HORIZON_TIMEOUT_MESSAGE,
  HORIZON_TIMEOUT_SUGGESTION,
  isHorizonTimeoutError,
  makeHorizonTimeoutError,
  makeAccountNotFoundError,
  makeAssetNotFoundError,
  makeTrustlineNotFoundError,
  makeTomlFetchFailedError,
  makeOrderBookEmptyError,
  makeLiquidityPoolNotFoundError,
};
