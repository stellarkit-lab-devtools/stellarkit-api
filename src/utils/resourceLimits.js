const { xdr } = require("@stellar/stellar-sdk");

// Only request settings understood by this SDK. Omitted ledger entries remain null.
const SETTINGS = [
  ["configSettingContractComputeV0", "compute", "contractCompute", ["ledgerMaxInstructions", "txMaxInstructions", "txMemoryLimit"]],
  ["configSettingContractLedgerCostV0", "ledgerAccess", "contractLedgerCost", [
    "ledgerMaxReadLedgerEntries", "ledgerMaxReadBytes", "ledgerMaxWriteLedgerEntries", "ledgerMaxWriteBytes",
    "txMaxReadLedgerEntries", "txMaxReadBytes", "txMaxWriteLedgerEntries", "txMaxWriteBytes",
  ]],
  ["configSettingContractBandwidthV0", "bandwidth", "contractBandwidth", ["ledgerMaxTxsSizeBytes", "txMaxSizeBytes"]],
  ["configSettingContractEventsV0", "events", "contractEvents", ["txMaxContractEventsSizeBytes"]],
  ["configSettingContractMaxSizeBytes", "contractSizes", "contractMaxSizeBytes", "maxContractCodeSizeBytes"],
  ["configSettingContractDataKeySizeBytes", "contractSizes", "contractDataKeySizeBytes", "maxContractDataKeySizeBytes"],
  ["configSettingContractDataEntrySizeBytes", "contractSizes", "contractDataEntrySizeBytes", "maxContractDataEntrySizeBytes"],
];

function jsonInteger(value) {
  // XDR int64 objects must never be coerced through an unsafe JS number.
  const integer = BigInt(value.toString());
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(integer) : integer.toString();
}

async function loadResourceLimits(server) {
  const data = {
    compute: null, ledgerAccess: null, bandwidth: null, events: null,
    contractSizes: { maxContractCodeSizeBytes: null, maxContractDataKeySizeBytes: null, maxContractDataEntrySizeBytes: null },
  };
  const supported = SETTINGS.filter(([name]) => typeof xdr.ConfigSettingId[name] === "function");
  const keys = supported.map(([name]) => xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({ configSettingId: xdr.ConfigSettingId[name]() }),
  ));
  const response = await server.getLedgerEntries(...keys);
  for (const entry of response.entries || []) {
    const val = typeof entry.val === "string" ? xdr.LedgerEntryData.fromXDR(entry.val, "base64") : entry.val;
    const setting = val.configSetting();
    const spec = supported.find(([name]) => setting.switch().value === xdr.ConfigSettingId[name]().value);
    if (!spec) continue;
    const [, section, arm, fields] = spec;
    const value = setting[arm]();
    if (Array.isArray(fields)) {
      data[section] = Object.fromEntries(fields.map((field) => [field, jsonInteger(value[field]())]));
    } else {
      data[section][fields] = jsonInteger(value);
    }
  }
  return data;
}

module.exports = { loadResourceLimits };
