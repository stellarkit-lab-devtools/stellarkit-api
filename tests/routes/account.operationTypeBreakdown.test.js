/**
 * tests/routes/account.operationTypeBreakdown.test.js
 *
 * Tests for GET /account/:id/operation-type-breakdown
 *
 * Covers (issue #1136):
 *  1. 8 payments + 2 change_trust → payment at 80%, changeTrust at 20%
 *  2. percent values across all types sum to exactly 100
 *  3. ?days=7 correctly filters to the last 7 days of operations
 *  4. An account with no operations returns an empty breakdown array
 *
 * All Stellar SDK calls are mocked — no real network requests are made.
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      loadAccount: jest.fn(),
      operations: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Builds a mock operation record */
function op(type, daysAgo = 1) {
  return {
    type,
    paging_token: `${type}-${daysAgo}-${Math.random()}`,
    created_at: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
  };
}

/** Mocks server.operations() to return the given records in one page */
function mockOperations(records) {
  server.operations.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  server.loadAccount.mockResolvedValue({
    id: ACCOUNT_ID,
    balances: [{ asset_type: "native", balance: "100.0000000" }],
    signers: [{ key: ACCOUNT_ID, weight: 1 }],
  });
});

describe("GET /account/:id/operation-type-breakdown", () => {
  it("returns payment at 80% and change_trust at 20% for 8 payments and 2 trust changes", async () => {
    const records = [
      ...Array.from({ length: 8 }, () => op("payment")),
      ...Array.from({ length: 2 }, () => op("change_trust")),
    ];
    mockOperations(records);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/operation-type-breakdown`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.totalOperations).toBe(10);

    const { breakdown } = res.body.data;
    expect(breakdown).toHaveLength(2);

    // Sorted descending by count
    const payment     = breakdown.find((b) => b.type === "payment");
    const changeTrust = breakdown.find((b) => b.type === "change_trust");

    expect(payment).toBeDefined();
    expect(payment.count).toBe(8);
    expect(payment.percent).toBe(80);

    expect(changeTrust).toBeDefined();
    expect(changeTrust.count).toBe(2);
    expect(changeTrust.percent).toBe(20);

    // First entry (highest count) should be payment
    expect(breakdown[0].type).toBe("payment");
  });

  it("percent values across all types sum to exactly 100", async () => {
    // 3 distinct types with controlled counts: 5 + 3 + 2 = 10
    const records = [
      ...Array.from({ length: 5 }, () => op("payment")),
      ...Array.from({ length: 3 }, () => op("change_trust")),
      ...Array.from({ length: 2 }, () => op("manage_sell_offer")),
    ];
    mockOperations(records);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/operation-type-breakdown`);

    expect(res.status).toBe(200);
    const { breakdown } = res.body.data;

    const sum = breakdown.reduce((acc, b) => acc + b.percent, 0);
    // Allow a tiny floating-point tolerance
    expect(sum).toBeCloseTo(100, 1);
  });

  it("?days=7 filters to only operations from the last 7 days", async () => {
    // Mix of recent (within 7 days) and old (>7 days) operations
    const recentRecords = Array.from({ length: 3 }, () => op("payment", 3));  // 3 days ago
    const oldRecords    = Array.from({ length: 5 }, () => op("payment", 10)); // 10 days ago

    // Simulate Horizon returning newest-first; old records fall outside the window
    // The route fetches desc and stops when created_at < since, so we put old records last
    server.operations.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [...recentRecords, ...oldRecords] }),
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/operation-type-breakdown?days=7`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Only the 3 recent records should be counted
    expect(res.body.data.totalOperations).toBe(3);
    expect(res.body.data.breakdown).toHaveLength(1);
    expect(res.body.data.breakdown[0].type).toBe("payment");
    expect(res.body.data.breakdown[0].count).toBe(3);
  });

  it("returns an empty breakdown array for an account with no operations", async () => {
    mockOperations([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/operation-type-breakdown`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalOperations).toBe(0);
    expect(res.body.data.breakdown).toEqual([]);
  });

  it("returns 404 for a non-existent account", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/operation-type-breakdown`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
