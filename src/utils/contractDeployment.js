const { fetchHorizon } = require("../config/stellar");
const { toISOTimestamp } = require("./response");

const CREATE_FUNCTION_MARKERS = ["CreateContract", "UploadWasm"];

/**
 * Finds deployment metadata for a Soroban contract by scanning Horizon operations.
 *
 * @param {string} contractId - Soroban contract address (C...)
 * @returns {Promise<{ deployer: string|null, deployedAt: string|null, deployedLedger: number|null }>}
 */
async function fetchContractDeployment(contractId) {
  try {
    const opsResponse = await fetchHorizon(`/operations?contract=${encodeURIComponent(contractId)}&order=asc&limit=50`);
    if (!opsResponse.ok) {
      return { deployer: null, deployedAt: null, deployedLedger: null };
    }

    const opsData = await opsResponse.json();
    const records = opsData._embedded?.records || [];
    if (records.length === 0) {
      return { deployer: null, deployedAt: null, deployedLedger: null };
    }

    const deployOp =
      records.find(
        (op) =>
          op.type === "invoke_host_function" &&
          CREATE_FUNCTION_MARKERS.some((marker) => (op.function || "").includes(marker)),
      ) || records.find((op) => op.type === "invoke_host_function");

    if (!deployOp?.transaction_hash) {
      return { deployer: null, deployedAt: null, deployedLedger: null };
    }

    const txResponse = await fetchHorizon(`/transactions/${deployOp.transaction_hash}`);
    if (!txResponse.ok) {
      return {
        deployer: deployOp.source_account || null,
        deployedAt: toISOTimestamp(deployOp.created_at),
        deployedLedger: null,
      };
    }

    const tx = await txResponse.json();
    return {
      deployer: deployOp.source_account || null,
      deployedAt: toISOTimestamp(deployOp.created_at || tx.created_at),
      deployedLedger: typeof tx.ledger === "number" ? tx.ledger : null,
    };
  } catch (error) {
    if (error.type === "UpstreamUnavailable") throw error;
    return { deployer: null, deployedAt: null, deployedLedger: null };
  }
}

module.exports = { fetchContractDeployment };
