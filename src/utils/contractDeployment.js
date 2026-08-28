const { horizonUrl } = require("../config/stellar");
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
    const opsUrl = `${horizonUrl}/operations?contract=${encodeURIComponent(contractId)}&order=asc&limit=50`;
    const opsResponse = await fetch(opsUrl);
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

    const txResponse = await fetch(`${horizonUrl}/transactions/${deployOp.transaction_hash}`);
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
  } catch {
    return { deployer: null, deployedAt: null, deployedLedger: null };
  }
}

module.exports = { fetchContractDeployment };
