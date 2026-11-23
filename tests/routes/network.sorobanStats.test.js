/**
 * tests/routes/network.sorobanStats.test.js
 *
 * Coverage for GET /network/soroban-stats.
 *
 * Test scenarios:
 *   1. 100 operations with 20 Soroban invocations → sorobanOperationPercent: 20
 *   2. No Soroban activity → sorobanOperationPercent: 0 and invocations24h: 0
 *   3. sorobanFeeRevenueXLM is a seven-decimal string
 *   4. The response includes period: "24h"
 *   5. Operations older than 24h are excluded from every count
 *   6. Second request is served from cache (X-Cache: HIT)
 */

"use strict";

const request = require("supertest");

jest.mock("../../src/config/stellar", () => ({
  ...jest.requireActual("../../src/config/stellar"),
  server: {
    operations: jest.fn(),
  },
}));

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const HOUR_MS = 60 * 60 * 1000;
const SEVEN_DECIMALS = /^\d+\.\d{7}$/;

/**
 * Builds a Horizon operation record as returned by the SDK with
 * `.join("transactions")`: the embedded transaction is exposed on
 * `transaction_attr`, and `transaction` becomes a link-follower function.
 */
function makeOperation(index, type, { hoursAgo = 0, feeCharged = "100" } = {}) {
  const hash = `tx-${index}`;
  const tx = { hash, fee_charged: feeCharged, operation_count: 1 };
  return {
    id: String(index),
    paging_token: String(index),
    type,
    created_at: new Date(Date.now() - hoursAgo * HOUR_MS - index * 1000).toISOString(),
    transaction_hash: hash,
    transaction_successful: true,
    transaction_attr: tx,
    transaction: async () => tx,
  };
}

/** Builds `total` operations, the first `sorobanCount` of which invoke a contract. */
function makeNetworkActivity(total, sorobanCount, options) {
  return Array.from({ length: total }, (_, i) =>
    makeOperation(i + 1, i < sorobanCount ? "invoke_host_function" : "payment", options),
  );
}

/** Mocks server.operations() so every page resolves with `records`. */
function mockOperations(records) {
  const chain = {
    join: jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.operations.mockReturnValue(chain);
  return chain;
}

describe("GET /network/soroban-stats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns sorobanOperationPercent: 20 for 100 operations with 20 Soroban invocations", async () => {
    mockOperations(makeNetworkActivity(100, 20));

    const res = await request(app).get("/network/soroban-stats");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalOperations).toBe(100);
    expect(res.body.data.invocations24h).toBe(20);
    expect(res.body.data.sorobanOperationPercent).toBe(20);
  });

  it("returns sorobanOperationPercent: 0 and invocations24h: 0 when there is no Soroban activity", async () => {
    mockOperations(makeNetworkActivity(50, 0));

    const res = await request(app).get("/network/soroban-stats");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.totalOperations).toBe(50);
    expect(res.body.data.sorobanOperationPercent).toBe(0);
    expect(res.body.data.invocations24h).toBe(0);
    expect(res.body.data.sorobanFeeRevenueXLM).toBe("0.0000000");
  });

  it("returns sorobanFeeRevenueXLM as a seven-decimal string", async () => {
    // 20 Soroban transactions × 150,000 stroops = 3,000,000 stroops = 0.3 XLM.
    // Fees on the 80 classic payments must not be counted.
    mockOperations(makeNetworkActivity(100, 20, { feeCharged: "150000" }));

    const res = await request(app).get("/network/soroban-stats");

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.data.sorobanFeeRevenueXLM).toBe("string");
    expect(res.body.data.sorobanFeeRevenueXLM).toMatch(SEVEN_DECIMALS);
    expect(res.body.data.sorobanFeeRevenueXLM).toBe("0.3000000");
  });

  it('includes period: "24h" in the response', async () => {
    mockOperations(makeNetworkActivity(10, 2));

    const res = await request(app).get("/network/soroban-stats");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.period).toBe("24h");
  });

  it("excludes operations older than 24 hours and marks the window as covered", async () => {
    const recent = makeNetworkActivity(10, 5);
    const stale = [
      makeOperation(11, "invoke_host_function", { hoursAgo: 25 }),
      makeOperation(12, "invoke_host_function", { hoursAgo: 26 }),
    ];
    mockOperations([...recent, ...stale]);

    const res = await request(app).get("/network/soroban-stats");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.totalOperations).toBe(10);
    expect(res.body.data.invocations24h).toBe(5);
    expect(res.body.data.sorobanOperationPercent).toBe(50);
    expect(res.body.data.windowCovered).toBe(true);
  });

  it("serves the second request from cache", async () => {
    const chain = mockOperations(makeNetworkActivity(100, 20));

    const first = await request(app).get("/network/soroban-stats");
    const second = await request(app).get("/network/soroban-stats");

    expect(first.get("X-Cache")).toBe("MISS");
    expect(second.get("X-Cache")).toBe("HIT");
    expect(second.body.data).toEqual(first.body.data);
    expect(chain.call).toHaveBeenCalledTimes(1);
  });
});
