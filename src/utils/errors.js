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

module.exports = { makeAccountNotFoundError, makeAssetNotFoundError };
