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

/**
 * Builds the OrderBookEmpty error body for DEX endpoints when no active
 * order book exists for a trading pair.
 *
 * @param {string} sellAsset - Sell-side asset code (e.g. "XLM")
 * @param {string} buyAsset - Buy-side asset code (e.g. "USDC")
 * @returns {{type: "OrderBookEmpty", message: string, suggestion: string}}
 */
function makeOrderBookEmptyError(sellAsset, buyAsset) {
  return {
    type: "OrderBookEmpty",
    message: `No active order book found for ${sellAsset}/${buyAsset}.`,
    suggestion:
      "Verify both assets exist on the Stellar network and that there are active offers for this pair.",
  };
}

module.exports = { makeAccountNotFoundError, makeOrderBookEmptyError };
