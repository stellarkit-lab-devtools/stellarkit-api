/**
 * tests/routes/account.largestTransactions.test.js
 *
 * Unit tests for GET /account/:id/largest-transactions direction filtering:
 *
 *   1. ?direction=sent     → only transactions where the account is the source.
 *   2. ?direction=received → only transactions where the account received value.
 *   3. ?direction=both     → all transactions.
 *   4. ?limit=5            → results capped to 5.
 *   5. Results are sorted by totalValueXLM descending.
 *
 * server.loadAccount() and server.payments() are mocked with controlled
 * transaction hashes, amounts and directions.
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

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const OTHER_ID = Keypair.random().publicKey();

let tokenSeq = 0;

function payment({ hash, direction, amount }) {
  tokenSeq += 1;
  return {
    type: "payment",
    transaction_hash: hash,
    transaction_successful: true,
    created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, tokenSeq)).toISOString(),
    paging_token: `token_${tokenSeq}`,
    asset_type: "native",
    amount,
    source_account: direction === "sent" ? ACCOUNT_ID : OTHER_ID,
    from: direction === "sent" ? ACCOUNT_ID : OTHER_ID,
    to: direction === "sent" ? OTHER_ID : ACCOUNT_ID,
  };
}

function mockPayments(records) {
  server.payments.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

const MIXED_HISTORY = [
  payment({ hash: "tx-sent-small", direction: "sent", amount: "10.0000000" }),
  payment({ hash: "tx-received-large", direction: "received", amount: "500.0000000" }),
  payment({ hash: "tx-sent-large", direction: "sent", amount: "250.0000000" }),
  payment({ hash: "tx-received-small", direction: "received", amount: "5.5000000" }),
];

beforeEach(() => {
  jest.clearAllMocks();
  server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
});

describe("GET /account/:id/largest-transactions", () => {
  it("?direction=sent returns only transactions where the account is the source", async () => {
    mockPayments(MIXED_HISTORY);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=sent`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.direction).toBe("sent");
    const hashes = res.body.data.transactions.map((t) => t.transactionHash);
    expect(hashes).toEqual(["tx-sent-large", "tx-sent-small"]);
    for (const tx of res.body.data.transactions) {
      expect(tx.direction).toBe("sent");
    }
  });

  it("?direction=received returns only transactions where the account received value", async () => {
    mockPayments(MIXED_HISTORY);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=received`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.direction).toBe("received");
    const hashes = res.body.data.transactions.map((t) => t.transactionHash);
    expect(hashes).toEqual(["tx-received-large", "tx-received-small"]);
    for (const tx of res.body.data.transactions) {
      expect(tx.direction).toBe("received");
    }
  });

  it("?direction=both returns all transactions", async () => {
    mockPayments(MIXED_HISTORY);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=both`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.direction).toBe("both");
    const hashes = res.body.data.transactions.map((t) => t.transactionHash);
    expect(hashes).toHaveLength(4);
    expect(hashes).toEqual(
      expect.arrayContaining([
        "tx-sent-small",
        "tx-received-large",
        "tx-sent-large",
        "tx-received-small",
      ]),
    );
  });

  it("?limit=5 caps results to 5", async () => {
    const records = [];
    for (let i = 1; i <= 8; i++) {
      records.push(
        payment({
          hash: `tx-${i}`,
          direction: i % 2 === 0 ? "sent" : "received",
          amount: `${i * 10}.0000000`,
        }),
      );
    }
    mockPayments(records);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?limit=5`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(5);
    expect(res.body.data.transactions.map((t) => t.transactionHash)).toEqual([
      "tx-8",
      "tx-7",
      "tx-6",
      "tx-5",
      "tx-4",
    ]);
  });

  it("sorts transactions by totalValueXLM descending", async () => {
    mockPayments([
      ...MIXED_HISTORY,
      // A second operation in the same transaction adds to its total.
      payment({ hash: "tx-sent-small", direction: "sent", amount: "400.0000000" }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions`,
    );

    expect(res.status).toBe(200);
    const values = res.body.data.transactions.map((t) => t.totalValueXLM);
    expect(values).toEqual([
      "500.0000000",
      "410.0000000",
      "250.0000000",
      "5.5000000",
    ]);

    const numeric = values.map(Number);
    const sorted = [...numeric].sort((a, b) => b - a);
    expect(numeric).toEqual(sorted);

    const merged = res.body.data.transactions.find(
      (t) => t.transactionHash === "tx-sent-small",
    );
    expect(merged.operationCount).toBe(2);
  });
});
