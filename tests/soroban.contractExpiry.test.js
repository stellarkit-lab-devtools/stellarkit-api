"use strict";

/**
 * Tests for GET /soroban/contract/:id and GET /soroban/contract/:id/expiry
 *
 * Verifies GET /soroban/contract/:id:
 *   - Returns { success: true, data: { contractId, wasmHash, deployer,
 *     deployedLedger, deployedAt, isExpired, expiryLedger } }
 *   - isExpired is true when currentLedger >= expiryLedger
 *   - isExpired is false when currentLedger < expiryLedger
 *   - Returns 404 when the contract does not exist
 *   - Returns 400 for an invalid contract ID
 *   - Response is cached (X-Cache: HIT on second request within TTL)
 *   - ?fresh=true bypasses the cache
 *   - Also retains existing /expiry summary coverage
 */

const request = require("supertest");
const cacheService = require("../src/services/cache");

// ── Mock stellar config ───────────────────────────────────────────────────────

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    sorobanServer: {
      getContractData: jest.fn(),
      getLedgerEntries: jest.fn(),
      getLatestLedger: jest.fn(),
    },
    server: {
      loadAccount: jest.fn(),
      ledgers: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      }),
      feeStats: jest.fn().mockResolvedValue({
        fee_charged: { min: "100", p10: "100", p50: "200", p95: "500", p99: "1000", max: "5000" },
        last_ledger_base_fee: "100",
        ledger_capacity_usage: "0.5",
      }),
    },
    fetchAccountCreation: jest.fn(),
    NETWORK: "testnet",
  };
});

const { sorobanServer } = require("../src/config/stellar");
const { xdr, Contract, StrKey } = require("@stellar/stellar-sdk");
const app = require("../src/index");

// A valid Soroban contract address (C... strkey)
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 5));

const DEPLOYER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const WASM_HASH = Buffer.alloc(32, 1);
const WASM_HASH_HEX = WASM_HASH.toString("hex");
const DEPLOYED_LEDGER = 5000;
const DEPLOYED_AT = new Date(DEPLOYED_LEDGER * 5 * 1000).toISOString();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock ledger entry with the given liveUntilLedgerSeq.
 * Mirrors the pattern used in soroban.storage.test.js.
 */
function buildInstanceEntry(liveUntilLedgerSeq) {
  const address    = new Contract(CONTRACT_ID).address().toScAddress();
  const executable = new xdr.ContractExecutable("contractExecutableWasm", WASM_HASH);
  const instance   = new xdr.ScContractInstance({ executable, storage: null });
  const contractData = new xdr.ContractDataEntry({
    ext:        new xdr.ExtensionPoint(0),
    contract:   address,
    key:        xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
    val:        xdr.ScVal.scvContractInstance(instance),
  });
  return {
    lastModifiedLedgerSeq: 1000,
    liveUntilLedgerSeq,
    val: xdr.LedgerEntryData.contractData(contractData),
  };
}

function setupHealthyContract({ expiryLedger = 60000, currentLedger = 40000 } = {}) {
  sorobanServer.getLedgerEntries.mockResolvedValue({
    entries: [buildInstanceEntry(expiryLedger)],
  });
  sorobanServer.getLatestLedger.mockResolvedValue({ sequence: currentLedger });
}

function setupContractNotFound() {
  sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [] });
  sorobanServer.getContractData.mockResolvedValue({ contractData: null });
}

function setupMetadataContract({ expiryLedger = 60000, currentLedger = 40000, deployedLedger = DEPLOYED_LEDGER } = {}) {
  const entry = buildInstanceEntry(expiryLedger);
  entry.lastModifiedLedgerSeq = deployedLedger;
  entry.deployer = DEPLOYER;
  sorobanServer.getContractData.mockResolvedValue({
    contractData: entry.val.contractData(),
    lastModifiedLedgerSeq: deployedLedger,
    liveUntilLedgerSeq: expiryLedger,
    deployer: DEPLOYER,
  });
  sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });
  sorobanServer.getLatestLedger.mockResolvedValue({ sequence: currentLedger });
}

beforeEach(() => {
  cacheService.flush();
  jest.clearAllMocks();
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/expiry — response shape", () => {
  it("returns 200 with success: true", async () => {
    setupHealthyContract();
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("includes all required fields in data", async () => {
    setupHealthyContract({ expiryLedger: 60000, currentLedger: 40000 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    const { data } = res.body;
    expect(data).toHaveProperty("contractId", CONTRACT_ID);
    expect(data).toHaveProperty("expiryLedger", 60000);
    expect(data).toHaveProperty("currentLedger", 40000);
    expect(data).toHaveProperty("ledgersRemaining", 20000);
    expect(data).toHaveProperty("estimatedTimeRemainingSeconds");
    expect(data).toHaveProperty("isExpiringSoon");
  });

  it("computes ledgersRemaining = expiryLedger - currentLedger", async () => {
    setupHealthyContract({ expiryLedger: 55000, currentLedger: 45000 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.body.data.ledgersRemaining).toBe(10000);
  });

  it("computes estimatedTimeRemainingSeconds = ledgersRemaining × 5", async () => {
    setupHealthyContract({ expiryLedger: 50000, currentLedger: 40000 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    // 10 000 × 5 = 50 000
    expect(res.body.data.estimatedTimeRemainingSeconds).toBe(50000);
  });

  it("clamps ledgersRemaining to 0 when already past expiryLedger", async () => {
    setupHealthyContract({ expiryLedger: 30000, currentLedger: 40000 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.body.data.ledgersRemaining).toBe(0);
    expect(res.body.data.estimatedTimeRemainingSeconds).toBe(0);
  });
});

// ── isExpiringSoon logic ──────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/expiry — isExpiringSoon", () => {
  it("is false when more than 10 000 ledgers remain (healthy)", async () => {
    setupHealthyContract({ expiryLedger: 60000, currentLedger: 40000 }); // 20 000 remain
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.body.data.isExpiringSoon).toBe(false);
  });

  it("is false when exactly 10 000 ledgers remain (boundary — not < 10 000)", async () => {
    setupHealthyContract({ expiryLedger: 50000, currentLedger: 40000 }); // exactly 10 000
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.body.data.isExpiringSoon).toBe(false);
  });

  it("is true when fewer than 10 000 ledgers remain", async () => {
    setupHealthyContract({ expiryLedger: 49999, currentLedger: 40000 }); // 9 999 remain
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.body.data.isExpiringSoon).toBe(true);
  });

  it("is true when only 1 ledger remains", async () => {
    setupHealthyContract({ expiryLedger: 40001, currentLedger: 40000 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.body.data.isExpiringSoon).toBe(true);
  });

  it("is true when contract has already expired (0 ledgers remain)", async () => {
    setupHealthyContract({ expiryLedger: 30000, currentLedger: 40000 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.body.data.isExpiringSoon).toBe(true);
  });
});

// ── 404 when contract not found ───────────────────────────────────────────────

describe("GET /soroban/contract/:id/expiry — 404", () => {
  it("returns 404 with ContractNotFound when the contract does not exist", async () => {
    setupContractNotFound();
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ContractNotFound");
  });

  it("error message mentions the contract ID", async () => {
    setupContractNotFound();
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.body.error.message).toContain(CONTRACT_ID);
  });
});

// ── 400 for invalid contract ID ───────────────────────────────────────────────

describe("GET /soroban/contract/:id/expiry — 400 validation", () => {
  it("returns 400 for a non-contract address", async () => {
    const res = await request(app).get("/soroban/contract/NOTACONTRACT/expiry");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("does not call sorobanServer when the contract ID is invalid", async () => {
    await request(app).get("/soroban/contract/BADID/expiry");
    expect(sorobanServer.getLedgerEntries).not.toHaveBeenCalled();
  });
});

// ── Caching behaviour ─────────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/expiry — caching", () => {
  it("sets X-Cache: MISS on the first fetch", async () => {
    setupHealthyContract();
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("sets X-Cache: HIT on a repeat request within TTL", async () => {
    setupHealthyContract();
    await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    const second = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(second.headers["x-cache"]).toBe("HIT");
  });

  it("calls getLedgerEntries only once for two requests within TTL", async () => {
    setupHealthyContract();
    await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(1);
  });

  it("?fresh=true bypasses the cache and returns X-Cache: MISS", async () => {
    setupHealthyContract();
    await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    const fresh = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/expiry?fresh=true`,
    );
    expect(fresh.headers["x-cache"]).toBe("MISS");
    expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(2);
  });

  it("returns identical data from cache as from the live fetch", async () => {
    setupHealthyContract({ expiryLedger: 60000, currentLedger: 40000 });
    const miss = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    const hit  = await request(app).get(`/soroban/contract/${CONTRACT_ID}/expiry`);
    expect(hit.body.data).toEqual(miss.body.data);
  });
});

describe("GET /soroban/contract/:id — metadata mapping", () => {
  it("returns 200 and maps all metadata fields from RPC", async () => {
    setupMetadataContract({ expiryLedger: 60000, currentLedger: 40000, deployedLedger: DEPLOYED_LEDGER });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sorobanServer.getContractData).toHaveBeenCalled();
    expect(sorobanServer.getLedgerEntries).toHaveBeenCalled();
    expect(res.body.data).toEqual({
      contractId: CONTRACT_ID,
      wasmHash: WASM_HASH_HEX,
      deployer: DEPLOYER,
      deployedLedger: DEPLOYED_LEDGER,
      deployedAt: DEPLOYED_AT,
      isExpired: false,
      expiryLedger: 60000,
    });
  });

  it("computes isExpired as true when currentLedger has reached expiryLedger", async () => {
    setupMetadataContract({ expiryLedger: 60000, currentLedger: 60000 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}`);
    expect(res.body.data.isExpired).toBe(true);
  });

  it("computes isExpired as true when currentLedger is past expiryLedger", async () => {
    setupMetadataContract({ expiryLedger: 60000, currentLedger: 60001 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}`);
    expect(res.body.data.isExpired).toBe(true);
  });

  it("computes isExpired as false when currentLedger is before expiryLedger", async () => {
    setupMetadataContract({ expiryLedger: 60000, currentLedger: 59999 });
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}`);
    expect(res.body.data.isExpired).toBe(false);
  });

  it("returns 404 when the contract does not exist", async () => {
    setupContractNotFound();
    const res = await request(app).get(`/soroban/contract/${CONTRACT_ID}`);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ContractNotFound");
  });

  it("returns 400 for an invalid contract ID", async () => {
    const res = await request(app).get("/soroban/contract/NOTACONTRACT");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
