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

module.exports = {
  HORIZON_TIMEOUT_MESSAGE,
  HORIZON_TIMEOUT_SUGGESTION,
  isHorizonTimeoutError,
  makeHorizonTimeoutError,
  makeAccountNotFoundError,
  makeAssetNotFoundError,
};
