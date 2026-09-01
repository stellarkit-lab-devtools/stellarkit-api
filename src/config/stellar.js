require("dotenv").config();
const { Horizon, rpc, xdr } = require("@stellar/stellar-sdk");
const {
  makeAccountNotFoundError,
  makeHorizonTimeoutError,
  isHorizonTimeoutError,
} = require("../utils/errors");

const NETWORK = process.env.STELLAR_NETWORK || "testnet";

const HORIZON_URLS = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

const horizonUrl =
  process.env.HORIZON_URL || HORIZON_URLS[NETWORK] || HORIZON_URLS.testnet;

const server = new Horizon.Server(horizonUrl);

// Horizon JS SDK exposes GET / as Server#root. StellarKit calls this
// serverInfo() so routes and tests can mock a single, named method.
if (typeof server.serverInfo !== "function") {
  server.serverInfo = function serverInfo() {
    return server.root();
  };
}

// Soroban RPC has no free SDF-hosted mainnet endpoint, so there is no mainnet
// default — SOROBAN_RPC_URL must be set to use the /soroban/* routes on mainnet.
const SOROBAN_RPC_URLS = {
  testnet: "https://soroban-testnet.stellar.org",
};

const sorobanRpcUrl = process.env.SOROBAN_RPC_URL || SOROBAN_RPC_URLS[NETWORK];
const sorobanServer = sorobanRpcUrl ? new rpc.Server(sorobanRpcUrl) : null;

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
    // Re-throw Horizon 404 as a structured AccountNotFound error
    if (err.response && err.response.status === 404) {
      throw makeAccountNotFoundError(publicKey, NETWORK);
    }

    // If it's already our custom error, re-throw as-is
    if (err.status) {
      throw err;
    }

    if (isHorizonTimeoutError(err)) {
      throw makeHorizonTimeoutError();
    }

    // For other network/connection errors, throw 500
    const serverErr = new Error("Unable to reach Stellar Horizon. Please try again.");
    serverErr.status = 500;
    throw serverErr;
  }
}

async function fetchContract(contractId) {
  if (!sorobanServer) {
    const err = new Error("Soroban RPC is not configured");
    err.status = 500;
    throw err;
  }

  try {
    const contractData = await sorobanServer.getContractData(
      contractId,
      xdr.ScVal.scvLedgerKeyContractInstance()
    );

    const contractDataEntry = xdr.ContractDataEntry.fromXDR(
      contractData.xdr,
      "base64"
    );
    const instance = contractDataEntry.val().contractInstance();
    const executable = instance.executable();
    const wasmHash = executable.wasm()
      ? executable.wasm().toString("hex")
      : null;
    const deployer = instance.deployer()
      ? instance.deployer().toString()
      : null;
    const deployedLedger = contractData.lastModifiedLedgerSeq;

    let expiryLedger = null;
    let currentLedger = null;
    if (wasmHash) {
      const hashBuffer = Buffer.from(wasmHash, "hex");
      const contractCodeKey = xdr.LedgerKey.contractCode(
        new xdr.LedgerKeyContractCode({ hash: hashBuffer })
      );
      const ledgerEntries = await sorobanServer.getLedgerEntries([
        contractCodeKey,
      ]);
      if (ledgerEntries && ledgerEntries.latestLedger) {
        currentLedger = ledgerEntries.latestLedger;
      }
      const entry =
        ledgerEntries && ledgerEntries.entries && ledgerEntries.entries[0];
      if (entry) {
        const ledgerEntry = xdr.LedgerEntry.fromXDR(entry.xdr, "base64");
        const ttl = ledgerEntry.ext().v1().ttl();
        expiryLedger = ledgerEntry.lastModifiedLedgerSeq() + ttl;
      }
    }

    const isExpired =
      currentLedger != null && expiryLedger != null && currentLedger >= expiryLedger;

    let deployedAt = null;
    if (deployedLedger) {
      try {
        const ledger = await server.ledgers().ledger(deployedLedger).call();
        deployedAt = ledger.closed_at;
      } catch (e) {
        deployedAt = null;
      }
    }

    return {
      contractId,
      wasmHash,
      deployer,
      deployedLedger,
      deployedAt,
      isExpired,
      expiryLedger,
    };
  } catch (err) {
    if (
      err.status === 404 ||
      err.code === -32602 ||
      (err.message && err.message.toLowerCase().includes("not found"))
    ) {
      const notFound = new Error(`Contract ${contractId} not found`);
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }
}

module.exports = {
  fetchContract,
  server,
  horizonUrl,
  NETWORK,
  NETWORKS: HORIZON_URLS,
  fetchAccountCreation,
  sorobanServer,
  sorobanRpcUrl,
};
