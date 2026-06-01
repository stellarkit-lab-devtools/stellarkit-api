require("dotenv").config();
const { Horizon } = require("@stellar/stellar-sdk");

const NETWORK = process.env.STELLAR_NETWORK || "testnet";

const HORIZON_URLS = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

const horizonUrl =
  process.env.HORIZON_URL || HORIZON_URLS[NETWORK] || HORIZON_URLS.testnet;

const server = new Horizon.Server(horizonUrl);

/**
 * Fetches the account's first funding transaction from Horizon.
 * Returns the ledger sequence and creation timestamp.
 *
 * @param {string} publicKey - Stellar public key (G...)
 * @returns {Promise<{ledger: number, timestamp: string}>} Ledger and ISO timestamp
 * @throws {Error} On Horizon errors (404, network errors, etc.)
 */
async function fetchAccountCreation(publicKey) {
  try {
    const txResponse = await server
      .transactions()
      .forAccount(publicKey)
      .order("asc")
      .limit(1)
      .call();

    if (!txResponse.records || txResponse.records.length === 0) {
      const err = new Error("Account has no transaction history.");
      err.status = 404;
      throw err;
    }

    const firstTx = txResponse.records[0];

    return {
      ledger: firstTx.ledger_attr,
      timestamp: firstTx.created_at,
    };
  } catch (err) {
    // Re-throw Horizon 404 as our own 404
    if (err.response && err.response.status === 404) {
      const notFoundErr = new Error("Account not found on Stellar network.");
      notFoundErr.status = 404;
      throw notFoundErr;
    }

    // If it's already our custom error, re-throw as-is
    if (err.status) {
      throw err;
    }

    // For network/connection errors, throw 500
    const serverErr = new Error("Unable to reach Stellar Horizon. Please try again.");
    serverErr.status = 500;
    throw serverErr;
  }
}

module.exports = {
  server,
  horizonUrl,
  NETWORK,
  NETWORKS: HORIZON_URLS,
  fetchAccountCreation,
};
