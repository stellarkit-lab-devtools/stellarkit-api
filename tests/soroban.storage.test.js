const request = require("supertest");
const cacheService = require("../src/services/cache");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    sorobanServer: {
      getLedgerEntries: jest.fn(),
    },
  };
});

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    scValToNative: jest.fn((scv) => {
      if (scv.switch && scv.switch().name === "scvSymbol" && scv.sym().toString() === "UNDECODABLE") {
        throw new Error("simulated decode failure");
      }
      return actual.scValToNative(scv);
    }),
  };
});

const { sorobanServer } = require("../src/config/stellar");
const { xdr, Contract, StrKey } = require("@stellar/stellar-sdk");
const app = require("../src/index");

// ── Helpers ─────────────────────────────────────────────────────────────────

function scEntry(keySymbol, val) {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(Buffer.from(keySymbol)), val });
}

function buildInstanceEntry({ contractId, storageEntries = [], lastModified = 42, liveUntil = 999 }) {
  const address = new Contract(contractId).address().toScAddress();
  const executable = new xdr.ContractExecutable("contractExecutableWasm", Buffer.alloc(32, 1));
  const instance = new xdr.ScContractInstance({
    executable,
    storage: storageEntries.length ? storageEntries : null,
  });

  const contractData = new xdr.ContractDataEntry({
    ext: new xdr.ExtensionPoint(0),
    contract: address,
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
    val: xdr.ScVal.scvContractInstance(instance),
  });

  return {
    lastModifiedLedgerSeq: lastModified,
    liveUntilLedgerSeq: liveUntil,
    val: xdr.LedgerEntryData.contractData(contractData),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/storage", () => {
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 3));

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── Response shape ────────────────────────────────────────────────────────

  it("returns { success: true, data: { entries, total } }", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [scEntry("counter", xdr.ScVal.scvU32(7))],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("entries");
    expect(res.body.data).toHaveProperty("total");
    expect(Array.isArray(res.body.data.entries)).toBe(true);
    expect(typeof res.body.data.total).toBe("number");
  });

  it("normalises each entry with key, value, lastModifiedLedger, expiryLedger", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [scEntry("counter", xdr.ScVal.scvU32(7))],
      lastModified: 42,
      liveUntil: 999,
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(200);
    const [item] = res.body.data.entries;
    expect(item).toHaveProperty("key", "counter");
    expect(item).toHaveProperty("value", 7);
    expect(item).toHaveProperty("lastModifiedLedger", 42);
    expect(item).toHaveProperty("expiryLedger", 999);
  });

  it("total reflects the full count of instance-storage entries", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [
        scEntry("a", xdr.ScVal.scvU32(1)),
        scEntry("b", xdr.ScVal.scvU32(2)),
        scEntry("c", xdr.ScVal.scvU32(3)),
      ],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage?limit=1`);

    expect(res.statusCode).toBe(200);
    // Only 1 entry returned (limit=1) but total should be 3
    expect(res.body.data.entries).toHaveLength(1);
    expect(res.body.data.total).toBe(3);
  });

  it("returns an empty entries array and total: 0 when storage is empty", async () => {
    const entry = buildInstanceEntry({ contractId, storageEntries: [] });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.entries).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  // ── Value decoding ────────────────────────────────────────────────────────

  it("converts bigint (u64) values to strings", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [scEntry("total", xdr.ScVal.scvU64(new xdr.Uint64(123456789n)))],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.body.data.entries[0].value).toBe("123456789");
  });

  it("falls back to raw base64 XDR when a value cannot be decoded", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [scEntry("bad", xdr.ScVal.scvSymbol(Buffer.from("UNDECODABLE")))],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.data.entries[0].value).toBe("string");
  });

  // ── ?limit= validation ────────────────────────────────────────────────────

  it("truncates entries to the ?limit= param", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [
        scEntry("a", xdr.ScVal.scvU32(1)),
        scEntry("b", xdr.ScVal.scvU32(2)),
        scEntry("c", xdr.ScVal.scvU32(3)),
      ],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage?limit=2`);

    expect(res.body.data.entries).toHaveLength(2);
  });

  it("defaults to limit=50 when no ?limit= is provided", async () => {
    const storageEntries = Array.from({ length: 60 }, (_, i) =>
      scEntry(`key${i}`, xdr.ScVal.scvU32(i))
    );
    const entry = buildInstanceEntry({ contractId, storageEntries });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.entries).toHaveLength(50);
    expect(res.body.data.total).toBe(60);
  });

  it("returns 400 when ?limit= exceeds 50", async () => {
    const res = await request(app).get(`/soroban/contract/${contractId}/storage?limit=51`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when ?limit= is zero", async () => {
    const res = await request(app).get(`/soroban/contract/${contractId}/storage?limit=0`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when ?limit= is not a number", async () => {
    const res = await request(app).get(`/soroban/contract/${contractId}/storage?limit=abc`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("accepts limit=50 (the maximum)", async () => {
    const entry = buildInstanceEntry({ contractId, storageEntries: [] });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage?limit=50`);

    expect(res.statusCode).toBe(200);
  });

  // ── Error cases ───────────────────────────────────────────────────────────

  it("returns 404 when the contract is not found", async () => {
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ContractNotFound");
  });

  it("returns 400 for an invalid contract ID", async () => {
    const res = await request(app).get("/soroban/contract/NOT_A_CONTRACT/storage");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 for an empty contract ID segment", async () => {
    // Express treats an empty :id as a non-matching route; sending a clearly
    // invalid short string exercises the validator directly.
    const res = await request(app).get("/soroban/contract/INVALID/storage");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── Caching ───────────────────────────────────────────────────────────────

  describe("caching", () => {
    beforeEach(() => {
      const entry = buildInstanceEntry({
        contractId,
        storageEntries: [scEntry("counter", xdr.ScVal.scvU32(7))],
      });
      sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });
    });

    it("sets X-Cache: MISS on the first request", async () => {
      const res = await request(app).get(`/soroban/contract/${contractId}/storage`);
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("sets X-Cache: HIT on a repeated request", async () => {
      await request(app).get(`/soroban/contract/${contractId}/storage`);
      const res = await request(app).get(`/soroban/contract/${contractId}/storage`);
      expect(res.headers["x-cache"]).toBe("HIT");
      // RPC should only have been called once
      expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(1);
    });

    it("bypasses the cache and sets X-Cache: MISS when ?fresh=true", async () => {
      await request(app).get(`/soroban/contract/${contractId}/storage`);
      const res = await request(app).get(
        `/soroban/contract/${contractId}/storage?fresh=true`
      );
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(2);
    });

    it("cache keys are scoped per limit (different limit = MISS)", async () => {
      await request(app).get(`/soroban/contract/${contractId}/storage?limit=5`);
      const res = await request(app).get(
        `/soroban/contract/${contractId}/storage?limit=10`
      );
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });
});
