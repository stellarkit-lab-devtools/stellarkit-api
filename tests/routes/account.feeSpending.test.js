/**
 * tests/routes/account.feeSpending.test.js
 *
 * Unit tests for GET /account/:id/fee-spending
 *
 *   1. Five payment transactions → breakdown has a payment entry with count: 5.
 *   2. totalFeesXLM is the sum of all transaction fees.
 *   3. averageFeeXLM is totalFeesXLM divided by the transaction count.
 *   4. ?days=7 only counts transactions from the last 7 days.
 *   5. A non-existent account returns HTTP 404.
 *
 * server.operations() is mocked with joined transaction records carrying
 * controlled fee_charged values.
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
const OTHER_ID = Keypair.random().publicKey();

const DAY_MS = 24 * 60 * 60 * 1000;
let seq = 0;

/**
 * Builds a Horizon operation record with an embedded (joined) transaction
 * containing a single operation paid for by ACCOUNT_ID.
 */
function paymentOp({ feeCharged, daysAgo = 1 }) {
  seq += 1;
  const createdAt = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const hash = `tx_hash_${seq}`;
  return {
    id: `op_${seq}`,
    paging_token: `token_${seq}`,
    type: "payment",
    created_at: createdAt,
    transaction_hash: hash,
    transaction_successful: true,
    source_account: ACCOUNT_ID,
    from: ACCOUNT_ID,
    to: OTHER_ID,
    amount: "10.0000000",
    asset_type: "native",
    transaction: {
      hash,
      created_at: createdAt,
      source_account: ACCOUNT_ID,
      fee_account: ACCOUNT_ID,
      fee_charged: String(feeCharged),
      operation_count: 1,
      successful: true,
    },
  };
}

function mockOperations(records) {
  server.operations.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    join: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

describe("GET /account/:id/fee-spending", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID, account_id: ACCOUNT_ID });
  });

  it("returns a payment breakdown entry with count 5 for five payment transactions", async () => {
    mockOperations([100, 100, 100, 100, 100].map((fee) => paymentOp({ feeCharged: fee })));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/fee-spending`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.transactionCount).toBe(5);

    const payment = res.body.data.breakdown.find((b) => b.type === "payment");
    expect(payment).toBeDefined();
    expect(payment.count).toBe(5);
    expect(res.body.data.breakdown).toHaveLength(1);
  });

  it("reports totalFeesXLM as the sum of all transaction fees", async () => {
    // 100 + 200 + 300 + 400 + 500 = 1500 stroops = 0.0001500 XLM
    mockOperations([100, 200, 300, 400, 500].map((fee) => paymentOp({ feeCharged: fee })));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/fee-spending`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalFeesXLM).toBe("0.0001500");

    const payment = res.body.data.breakdown.find((b) => b.type === "payment");
    expect(payment.totalFeesXLM).toBe("0.0001500");
  });

  it("computes averageFeeXLM as totalFeesXLM divided by the transaction count", async () => {
    // 1500 stroops across 5 transactions = 300 stroops = 0.0000300 XLM
    mockOperations([100, 200, 300, 400, 500].map((fee) => paymentOp({ feeCharged: fee })));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/fee-spending`);

    expect(res.status).toBe(200);
    const { totalFeesXLM, averageFeeXLM, transactionCount } = res.body.data;
    expect(averageFeeXLM).toBe("0.0000300");
    expect(parseFloat(averageFeeXLM)).toBeCloseTo(
      parseFloat(totalFeesXLM) / transactionCount,
      7,
    );

    const payment = res.body.data.breakdown.find((b) => b.type === "payment");
    expect(payment.averageFeeXLM).toBe("0.0000300");
  });

  it("only counts transactions from the last 7 days when ?days=7", async () => {
    // Records are returned newest first, as Horizon does with order=desc.
    mockOperations([
      paymentOp({ feeCharged: 100, daysAgo: 1 }),
      paymentOp({ feeCharged: 200, daysAgo: 3 }),
      paymentOp({ feeCharged: 300, daysAgo: 6 }),
      paymentOp({ feeCharged: 1000, daysAgo: 10 }),
      paymentOp({ feeCharged: 2000, daysAgo: 20 }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/fee-spending?days=7`);

    expect(res.status).toBe(200);
    expect(res.body.data.period.days).toBe(7);
    expect(res.body.data.transactionCount).toBe(3);
    expect(res.body.data.totalFeesXLM).toBe("0.0000600");

    const payment = res.body.data.breakdown.find((b) => b.type === "payment");
    expect(payment.count).toBe(3);
  });

  it("returns 404 for a non-existent account", async () => {
    const notFound = new Error("Not Found");
    notFound.response = { status: 404 };
    server.loadAccount.mockRejectedValue(notFound);
    mockOperations([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/fee-spending`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(server.operations).not.toHaveBeenCalled();
  });
});
