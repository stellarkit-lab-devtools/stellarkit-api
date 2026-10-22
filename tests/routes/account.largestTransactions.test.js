/**
 * tests/routes/account.largestTransactions.test.js
 *
 * Coverage for GET /account/:id/largest-transactions (issue #1148):
 *   1. ?direction=sent returns only transactions the account sent.
 *   2. ?direction=received returns only transactions the account received.
 *   3. ?direction=both returns every transaction.
 *   4. ?limit=5 caps the result set at five entries.
 *   5. Transactions are sorted by totalValueXLM descending.
 *
 * Horizon is mocked: no network requests are made. Every fixture has a distinct
 * transaction hash so grouping and filtering can be asserted directly.
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
      payments: jest.fn(),
    },
  };
});

const express = require("express");

const accountRouter = require("../../src/routes/account");
const { server } = require("../../src/config/stellar");

// Mount the account router directly instead of loading src/index.js: the repo's
// other route modules are unrelated to this endpoint and some are currently
// unparseable on main, which would make this suite fail for the wrong reason.
const app = express();
app.use(express.json());
app.use("/account", accountRouter);
app.use((err, _req, res, _next) => {
  const status =
    err.status || err.statusCode || (err.isValidation ? 400 : 500);
  res.status(status).json({ success: false, error: err.message });
});

const ACCOUNT_ID = Keypair.random().publicKey();
const OTHER_ID = Keypair.random().publicKey();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

/**
 * Builds a Horizon payment operation record.
 *
 * @param {object} overrides
 * @returns {object}
 */
function payment(overrides = {}) {
  return {
    type: "payment",
    transaction_successful: true,
    transaction_hash: "tx-default",
    created_at: NOW,
    from: OTHER_ID,
    to: ACCOUNT_ID,
    asset_type: "native",
    amount: "1.0000000",
    ...overrides,
  };
}

function records() {
  return [
    // The account sent 100 XLM.
    payment({
      transaction_hash: "sent-100",
      from: ACCOUNT_ID,
      to: OTHER_ID,
      amount: "100.0000000",
    }),
    // The account received 200 XLM.
    payment({
      transaction_hash: "received-200",
      from: OTHER_ID,
      to: ACCOUNT_ID,
      amount: "200.0000000",
    }),
    // One transaction where the account both sent 50 and received 25.
    payment({
      transaction_hash: "both-75",
      from: ACCOUNT_ID,
      to: OTHER_ID,
      amount: "50.0000000",
    }),
    payment({
      transaction_hash: "both-75",
      from: OTHER_ID,
      to: ACCOUNT_ID,
      amount: "25.0000000",
    }),
    // A small outgoing payment used to check ordering and limits.
    payment({
      transaction_hash: "sent-10",
      from: ACCOUNT_ID,
      to: OTHER_ID,
      amount: "10.0000000",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAccountFound() {
  server.loadAccount.mockResolvedValue({
    id: ACCOUNT_ID,
    balances: [],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  });
}

function mockPayments(ops) {
  const builder = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: ops }),
  };
  server.payments.mockReturnValue(builder);
  return builder;
}

function hashes(res) {
  return res.body.data.transactions.map((tx) => tx.hash);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountFound();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /account/:id/largest-transactions", () => {
  it("?direction=sent returns only transactions where the account is the source", async () => {
    mockPayments(records());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=sent`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(hashes(res)).toEqual(["sent-100", "both-75", "sent-10"]);
    expect(res.body.data.transactions.every((tx) => tx.direction !== "received")).toBe(
      true,
    );
  });

  it("?direction=received returns only transactions where the account received value", async () => {
    mockPayments(records());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=received`,
    );

    expect(res.statusCode).toBe(200);
    expect(hashes(res)).toEqual(["received-200", "both-75"]);
    expect(res.body.data.transactions.every((tx) => tx.direction !== "sent")).toBe(
      true,
    );
  });

  it("?direction=both (the default) returns every transaction", async () => {
    mockPayments(records());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=both`,
    );

    expect(res.statusCode).toBe(200);
    expect(hashes(res)).toEqual([
      "received-200",
      "sent-100",
      "both-75",
      "sent-10",
    ]);
    expect(res.body.data.transactions).toHaveLength(4);
  });

  it("?limit=5 caps the result set at five transactions", async () => {
    const ops = [];
    for (let i = 1; i <= 8; i += 1) {
      ops.push(
        payment({
          transaction_hash: `tx-${i}`,
          from: ACCOUNT_ID,
          to: OTHER_ID,
          amount: `${i}.0000000`,
        }),
      );
    }
    mockPayments(ops);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?limit=5`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions).toHaveLength(5);
    // The five largest amounts, in descending order.
    expect(res.body.data.transactions.map((tx) => tx.totalValueXLM)).toEqual([
      "8.0000000",
      "7.0000000",
      "6.0000000",
      "5.0000000",
      "4.0000000",
    ]);
  });

  it("sorts transactions by totalValueXLM descending", async () => {
    mockPayments(records());

    const res = await request(app).get(`/account/${ACCOUNT_ID}/largest-transactions`);
    const values = res.body.data.transactions.map((tx) =>
      Number.parseFloat(tx.totalValueXLM),
    );

    expect(res.statusCode).toBe(200);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(values[0]).toBeGreaterThan(values[values.length - 1]);
  });

  it("sums every matched operation of a transaction into totalValueXLM", async () => {
    mockPayments(records());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=both`,
    );
    const both = res.body.data.transactions.find((tx) => tx.hash === "both-75");

    expect(both.totalValueXLM).toBe("75.0000000");
    expect(both.operationCount).toBe(2);
    expect(both.direction).toBe("both");
    expect(both.timestamp).toBe(NOW);
  });

  it("returns 404 when the account does not exist", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });
    mockPayments([]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions`,
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("rejects an unsupported direction with 400", async () => {
    mockPayments(records());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=sideways`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
