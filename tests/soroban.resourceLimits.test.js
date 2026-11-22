const express = require("express");
const request = require("supertest");
const { xdr } = require("@stellar/stellar-sdk");
jest.mock("../src/config/stellar", () => ({ NETWORK: "testnet", sorobanServer: { getLedgerEntries: jest.fn() } }));
const { sorobanServer } = require("../src/config/stellar");
const cache = require("../src/services/cache");
const app = express();
app.use("/soroban", require("../src/routes/soroban"));
app.use(require("../src/middleware/errorHandler"));

function entry(setting) {
  // Serialize and parse actual SDK XDR rather than mocking XDR accessors.
  const encoded = xdr.LedgerEntryData.configSetting(setting).toXDR("base64");
  return { val: xdr.LedgerEntryData.fromXDR(encoded, "base64") };
}
function fixtures() {
  const i64 = (value) => xdr.Int64.fromString(String(value));
  return [
    entry(xdr.ConfigSettingEntry.configSettingContractComputeV0(new xdr.ConfigSettingContractComputeV0({
      ledgerMaxInstructions: i64(100000000), txMaxInstructions: i64(10000000),
      feeRatePerInstructionsIncrement: i64(1), txMemoryLimit: 40000000,
    }))),
    entry(xdr.ConfigSettingEntry.configSettingContractLedgerCostV0(new xdr.ConfigSettingContractLedgerCostV0({
      ledgerMaxReadLedgerEntries: 1000, ledgerMaxReadBytes: 2000,
      ledgerMaxWriteLedgerEntries: 3000, ledgerMaxWriteBytes: 4000,
      txMaxReadLedgerEntries: 100, txMaxReadBytes: 200,
      txMaxWriteLedgerEntries: 300, txMaxWriteBytes: 400,
      feeReadLedgerEntry: i64(1), feeWriteLedgerEntry: i64(1), feeRead1Kb: i64(1),
      bucketListTargetSizeBytes: i64(1000), writeFee1KbBucketListLow: i64(1),
      writeFee1KbBucketListHigh: i64(2), bucketListWriteFeeGrowthFactor: 1,
    }))),
    entry(xdr.ConfigSettingEntry.configSettingContractBandwidthV0(new xdr.ConfigSettingContractBandwidthV0({
      ledgerMaxTxsSizeBytes: 5000, txMaxSizeBytes: 500, feeTxSize1Kb: i64(1),
    }))),
    entry(xdr.ConfigSettingEntry.configSettingContractEventsV0(new xdr.ConfigSettingContractEventsV0({
      txMaxContractEventsSizeBytes: 600, feeContractEvents1Kb: i64(1),
    }))),
    entry(xdr.ConfigSettingEntry.configSettingContractMaxSizeBytes(700)),
    entry(xdr.ConfigSettingEntry.configSettingContractDataKeySizeBytes(800)),
    entry(xdr.ConfigSettingEntry.configSettingContractDataEntrySizeBytes(900)),
  ];
}

describe("GET /soroban/resource-limits", () => {
  beforeEach(() => {
    cache.delete("soroban:resource-limits:testnet");
    jest.clearAllMocks();
  });
  it("decodes all sections from SDK XDR fixtures", async () => {
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: fixtures() });
    const res = await request(app).get("/soroban/resource-limits");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      compute: { ledgerMaxInstructions: 100000000, txMaxInstructions: 10000000, txMemoryLimit: 40000000 },
      ledgerAccess: { ledgerMaxReadLedgerEntries: 1000, ledgerMaxReadBytes: 2000, ledgerMaxWriteLedgerEntries: 3000, ledgerMaxWriteBytes: 4000, txMaxReadLedgerEntries: 100, txMaxReadBytes: 200, txMaxWriteLedgerEntries: 300, txMaxWriteBytes: 400 },
      bandwidth: { ledgerMaxTxsSizeBytes: 5000, txMaxSizeBytes: 500 },
      events: { txMaxContractEventsSizeBytes: 600 },
      contractSizes: { maxContractCodeSizeBytes: 700, maxContractDataKeySizeBytes: 800, maxContractDataEntrySizeBytes: 900 },
    });
    expect(sorobanServer.getLedgerEntries.mock.calls[0]).toHaveLength(7);
  });
  it("returns null for missing protocol settings", async () => {
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [] });
    const res = await request(app).get("/soroban/resource-limits");
    expect(res.status).toBe(200);
    expect(res.body.data.events).toBeNull();
    expect(res.body.data.contractSizes.maxContractCodeSizeBytes).toBeNull();
  });
  it("caches for five minutes, then reloads", async () => {
    const clock = jest.spyOn(Date, "now");
    const now = Date.now();
    clock.mockReturnValue(now);
    try {
      sorobanServer.getLedgerEntries.mockResolvedValue({ entries: fixtures() });
      await request(app).get("/soroban/resource-limits");
      clock.mockReturnValue(now + 299999);
      await request(app).get("/soroban/resource-limits");
      expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(now + 300001);
      await request(app).get("/soroban/resource-limits");
      expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
  it("returns 503 for an unreachable RPC without caching the error", async () => {
    sorobanServer.getLedgerEntries.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await request(app).get("/soroban/resource-limits");
    expect(res.status).toBe(503);
    expect(res.body.error.type).toBe("ServiceUnavailable");
    expect(cache.get("soroban:resource-limits:testnet")).toBeUndefined();
  });
});
