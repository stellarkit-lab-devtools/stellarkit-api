"use strict";

/**
 * GET /fee-estimate — live Horizon feeStats mapping (Issue #706).
 *
 * Mocks Horizon.Server#feeStats and verifies stroops + XLM amounts,
 * isSurge, lastLedgerSequence, and the 5-second cache TTL.
 */

const request = require("supertest");

const FEE_STATS = {
  last_ledger: "888001",
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.12",
  fee_charged: {
    min: "100",
    p10: "110",
    p50: "120",
    p95: "140",
    p99: "150",
    max: "160",
  },
};

const SURGE_FEE_STATS = {
  last_ledger: "888050",
  last_ledger_base_fee: "500",
  ledger_capacity_usage: "0.81",
  fee_charged: {
    min: "200",
    p10: "250",
    p50: "400",
    p95: "800",
    p99: "1000",
    max: "1200",
  },
};

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      feeStats: jest.fn(),
      ledgers: jest.fn(),
      serverInfo: jest.fn().mockResolvedValue({}),
    },
  };
});

process.env.CACHE_TTL_FEE_ESTIMATE_MS = "5000";
delete process.env.CACHE_TTL_MS;

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");
const cacheTTL = require("../src/config/cacheConfig");

function mockFeeHorizon(feeStats = FEE_STATS) {
  server.feeStats.mockResolvedValue(feeStats);
  server.ledgers.mockReturnValue({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({
      records: [
        { sequence: "888001", base_fee_in_stroops: "100", successful_transaction_count: 50 },
      ],
    }),
  });
}

describe("GET /fee-estimate — live Horizon feeStats mapping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    mockFeeHorizon();
  });

  it("calls server.feeStats() and maps the full StellarKit shape", async () => {
    const res = await request(app).get("/fee-estimate");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(server.feeStats).toHaveBeenCalledTimes(1);

    const { data } = res.body;
    expect(data.baseFeeStroops).toBe(100);
    expect(data.baseFeeXLM).toBe("0.0000100");
    expect(data.p50).toEqual({ stroops: 120, xlm: "0.0000120" });
    expect(data.p95).toEqual({ stroops: 140, xlm: "0.0000140" });
    expect(data.isSurge).toBe(false);
    expect(data.lastLedgerSequence).toBe(888001);
  });

  it("returns amounts in both stroops and XLM", async () => {
    const res = await request(app).get("/fee-estimate");
    const { data } = res.body;

    expect(typeof data.baseFeeStroops).toBe("number");
    expect(data.baseFeeXLM).toMatch(/^\d+\.\d{7}$/);
    expect(typeof data.p50.stroops).toBe("number");
    expect(data.p50.xlm).toMatch(/^\d+\.\d{7}$/);
    expect(typeof data.p95.stroops).toBe("number");
    expect(data.p95.xlm).toMatch(/^\d+\.\d{7}$/);
  });

  it("sets isSurge true when capacity usage is elevated", async () => {
    mockFeeHorizon(SURGE_FEE_STATS);
    const res = await request(app).get("/fee-estimate");

    expect(res.body.data.isSurge).toBe(true);
    expect(res.body.data.baseFeeStroops).toBe(500);
    expect(res.body.data.baseFeeXLM).toBe("0.0000500");
    expect(res.body.data.p50).toEqual({ stroops: 400, xlm: "0.0000400" });
    expect(res.body.data.p95).toEqual({ stroops: 800, xlm: "0.0000800" });
    expect(res.body.data.lastLedgerSequence).toBe(888050);
  });

  it("sets isSurge true when the base fee has lifted above the minimum", async () => {
    mockFeeHorizon({
      ...FEE_STATS,
      last_ledger_base_fee: "200",
      ledger_capacity_usage: "0.10",
    });

    const res = await request(app).get("/fee-estimate");
    expect(res.body.data.isSurge).toBe(true);
  });

  it("does not leak snake_case Horizon keys", async () => {
    const res = await request(app).get("/fee-estimate");
    const { data } = res.body;

    expect(data).not.toHaveProperty("last_ledger");
    expect(data).not.toHaveProperty("last_ledger_base_fee");
    expect(data).not.toHaveProperty("ledger_capacity_usage");
    expect(data).not.toHaveProperty("fee_charged");
  });

  it("caches the mapped payload for 5 seconds", async () => {
    expect(cacheTTL.feeEstimate).toBe(5);

    const first = await request(app).get("/fee-estimate");
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(server.feeStats).toHaveBeenCalledTimes(1);

    const second = await request(app).get("/fee-estimate");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(server.feeStats).toHaveBeenCalledTimes(1);
    expect(second.body.data.baseFeeStroops).toBe(100);
  });

  it("re-fetches from Horizon after the 5-second TTL expires", async () => {
    let now = Date.parse("2026-08-26T12:00:00Z");
    jest.spyOn(Date, "now").mockImplementation(() => now);

    await request(app).get("/fee-estimate");
    expect(server.feeStats).toHaveBeenCalledTimes(1);

    now += 5_001;
    mockFeeHorizon(SURGE_FEE_STATS);

    const res = await request(app).get("/fee-estimate");
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(res.body.data.isSurge).toBe(true);
    expect(server.feeStats).toHaveBeenCalledTimes(2);

    Date.now.mockRestore();
  });
});
