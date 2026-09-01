const { rpcUrl } = require("../config/stellar");
const { xdr, StrKey } = require("@stellar/stellar-sdk");


/**
 * Fetches deployment metadata for a Soroban contract from the Stellar RPC.
 *
 * @param {string} contractId - Soroban contract address (C...)
 * @returns {Promise<{ contractId: string, wasmHash: string|null, deployer: string|null, deployedLedger: number|null, deployedAt: string|null, isExpired: boolean, expiryLedger: number|null }>}
 */
async function fetchContractDeployment(contractId) {
  let contractIdBytes;
  try {
    contractIdBytes = StrKey.decodeContractId(contractId);
  } catch (e) {
    const error = new Error(`Invalid contract ID: ${contractId}`);
    error.status = 404;
    throw error;
  }
  const contractIdHex = contractIdBytes.toString("hex");

  const instanceScVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("ContractInstance")]);
  const contractDataKeyB64 = instanceScVal.toXDR("base64");

  const rpc = async (method, params) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await response.json();
    if (json.error) {
      const error = new Error(json.error.message);
      error.status = 404;
      throw error;
    }
    return json.result;
  };

  // 1. Get the contract instance via getContractData
  const contractDataResult = await rpc("getContractData", {
    contractId: contractIdHex,
    key: contractDataKeyB64,
    durability: "persistent",
  });

  if (!contractDataResult || !contractDataResult.xdr) {
    const notFound = new Error(`Contract ${contractId} not found`);
    notFound.status = 404;
    throw notFound;
  }

  const contractDataLedgerEntry = xdr.LedgerEntry.fromXDR(contractDataResult.xdr, "base64");
  const contractDataEntry = contractDataLedgerEntry.data().contractData();
  const instance = contractDataEntry.val().instance();
  const wasmHash = Buffer.from(instance.executable().wasm().wasmHash()).toString("hex");
  const deployedLedgerFromData = typeof contractDataResult.lastModifiedLedgerSeq === "number" ? contractDataResult.lastModifiedLedgerSeq : null;

  // 2. Get the TTL/ledger entry via getLedgerEntries
  const scAddress = xdr.ScAddress.scAddressTypeContract().setContractId(contractIdBytes);
  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: scAddress,
      key: instanceScVal,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
  const ledgerResult = await rpc("getLedgerEntries", {
    keys: [ledgerKey.toXDR("base64")],
  });
  const entries = ledgerResult?.entries;
  if (!entries || entries.length === 0) {
    const notFound = new Error(`Contract ${contractId} not found`);
    notFound.status = 404;
    throw notFound;
  }
  const entry = entries[0];
  const deployedLedger = typeof entry.lastModifiedLedgerSeq === "number" ? entry.lastModifiedLedgerSeq : deployedLedgerFromData;
  const expiryLedger = typeof entry.liveUntilLedgerSeq === "number" ? entry.liveUntilLedgerSeq : null;

  // 3. Get the latest ledger
  const latest = await rpc("getLatestLedger", {});
  const currentLedger = typeof latest.sequence === "number" ? latest.sequence : null;

  return {
    contractId,
    wasmHash,
    deployer: null,
    deployedLedger,
    deployedAt: null,
    isExpired: currentLedger !== null && expiryLedger !== null && currentLedger > expiryLedger,
    expiryLedger,
  };
}

module.exports = { fetchContractDeployment };
