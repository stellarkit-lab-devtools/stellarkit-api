"use strict";

/**
 * GET /network-status — live Horizon mapping (Issue #713).
 *
 * Mocks Horizon.Server#serverInfo (GET /) and verifies the camelCase
 * StellarKit shape, isSynced computation, and 10-second cache TTL.
 */

const request = require("supertest");

const HORIZON_INFO = {
  horizon_version: "22.0.1",
  core_version: "stellar-core 22.1.0 (abc123)",
  network_passphrase: "Test SDF Network ; September 2015",
  core_latest_ledger: "512000",
  history_latest_ledger: "512000",
  ingest_latest_ledger: "512000",
};

const LATEST_LEDGER = {
  sequence: 512000,
  closed_at: "2026-08-26T12:00:00Z",
  successful_transaction_count: 40,
  operation_count: 120,
  total_coins: "105443902087.5472865",
  fee_pool: "123.0000000",
  base_fee_in_stroops: 100,
  base_reserve_in_stroops: 5000000,
  protocol_version: 22,
};

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      serverInfo: jest.fn(),
      root: jest.fn(),
      ledgers: jest.fn(),
      feeStats: jest.fn(),
    },
  };
});

process.env.CACHE_TTL_NETWORK_STATUS_MS = "10000";
delete process.env.CACHE_TTL_MS;

const app = require("../src/index");
const { server, horizonUrl, NETWORK } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");
const cacheTTL = require("../src/config/cacheConfig");

function mockHorizon({ info = HORIZON_INFO, ledger = LATEST_LEDGER } = {}) {
  server.serverInfo.mockResolvedValue(info);
  server.ledgers.mockReturnValue({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: [ledger] }),
  });
}

describe("GET /network-status — live Horizon serverInfo mapping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    mockHorizon();
  });

  it("calls server.serverInfo() and maps every StellarKit field", async () => {
    const res = await request(app).get("/network-status");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(server.serverInfo).toHaveBeenCalledTimes(1);

    const { data } = res.body;
    expect(data.horizonVersion).toBe("22.0.1");
    expect(data.coreVersion).toBe("stellar-core 22.1.0 (abc123)");
    expect(data.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(data.currentLedger).toBe(512000);
    expect(data.historyLatestLedger).toBe(512000);
    expect(data.isSynced).toBe(true);
    expect(data.network).toBe(NETWORK);
    expect(data.horizonUrl).toBe(horizonUrl);
  });

  it("exposes only camelCase keys on the mapped Horizon fields", async () => {
    const res = await request(app).get("/network-status");
    const { data } = res.body;

    const mappedKeys = [
      "horizonVersion",
      "coreVersion",
      "networkPassphrase",
      "currentLedger",
      "historyLatestLedger",
      "isSynced",
    ];
    for (const key of mappedKeys) {
      expect(data).toHaveProperty(key);
    }

    const snake = Object.keys(data).filter((k) => k.includes("_"));
    expect(snake).toHaveLength(0);
    expect(data).not.toHaveProperty("horizon_version");
    expect(data).not.toHaveProperty("core_version");
    expect(data).not.toHaveProperty("network_passphrase");
    expect(data).not.toHaveProperty("core_latest_ledger");
    expect(data).not.toHaveProperty("history_latest_ledger");
  });

  it("sets isSynced false when currentLedger lags historyLatestLedger", async () => {
    mockHorizon({
      info: {
        ...HORIZON_INFO,
        core_latest_ledger: "511990",
        history_latest_ledger: "512000",
      },
    });

    const res = await request(app).get("/network-status");
    expect(res.body.data.currentLedger).toBe(511990);
    expect(res.body.data.historyLatestLedger).toBe(512000);
    expect(res.body.data.isSynced).toBe(false);
  });

  it("sets isSynced false when history lags the core ledger", async () => {
    mockHorizon({
      info: {
        ...HORIZON_INFO,
        core_latest_ledger: 520010,
        history_latest_ledger: 520000,
      },
    });

    const res = await request(app).get("/network-status");
    expect(res.body.data.isSynced).toBe(false);
  });

  it("caches the mapped payload for 10 seconds", async () => {
    expect(cacheTTL.networkStatus).toBe(10);

    const first = await request(app).get("/network-status");
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(server.serverInfo).toHaveBeenCalledTimes(1);

    const second = await request(app).get("/network-status");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body.data).toEqual(first.body.data);
    expect(server.serverInfo).toHaveBeenCalledTimes(1);
  });

  it("re-fetches from Horizon after the 10-second TTL expires", async () => {
    let now = Date.parse("2026-08-26T12:00:00Z");
    jest.spyOn(Date, "now").mockImplementation(() => now);

    await request(app).get("/network-status");
    expect(server.serverInfo).toHaveBeenCalledTimes(1);

    now += 10_001;
    mockHorizon({
      info: { ...HORIZON_INFO, core_latest_ledger: "512100", history_latest_ledger: "512100" },
    });

    const res = await request(app).get("/network-status");
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(res.body.data.currentLedger).toBe(512100);
    expect(server.serverInfo).toHaveBeenCalledTimes(2);

    Date.now.mockRestore();
  });
});
