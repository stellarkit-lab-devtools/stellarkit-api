/**
 * tests/routes/account.selfPaymentDetection.test.js
 *
 * Tests for GET /account/:id/self-payment-detection
 *
 * Covers:
 *  1. Returns { selfPaymentsDetected: false, patterns: [] } when no patterns found
 *  2. Detects a "direct_self" pattern when sender and recipient share signing keys
 *  3. Detects a "circular_chain" pattern when payments return value to the origin
 *  4. Returns 404 for a non-existent account
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
      payments: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const OTHER_ID   = Keypair.random().publicKey();
const THIRD_ID   = Keypair.random().publicKey();

/** Builds a minimal payment operation record */
function paymentOp({ from, to, txHash = "abc123", amount = "10.0000000" } = {}) {
  return {
    type: "payment",
    transaction_successful: true,
    from,
    to,
    transaction_hash: txHash,
    amount,
    asset_type: "native",
    created_at: new Date().toISOString(),
    paging_token: txHash,
  };
}

/** Mocks server.payments() to return the given records */
function mockPayments(records) {
  server.payments.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

/** Builds a minimal Horizon account object */
function buildAccount(id, extraSigners = []) {
  return {
    id,
    balances: [{ asset_type: "native", balance: "100.0000000" }],
    signers: [{ key: id, weight: 1 }, ...extraSigners],
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /account/:id/self-payment-detection", () => {
  it("returns selfPaymentsDetected: false with empty patterns when no patterns are found", async () => {
    server.loadAccount.mockImplementation((id) => Promise.resolve(buildAccount(id)));
    mockPayments([
      paymentOp({ from: ACCOUNT_ID, to: OTHER_ID, txHash: "tx1" }),
      paymentOp({ from: OTHER_ID,   to: ACCOUNT_ID, txHash: "tx2" }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/self-payment-detection`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.selfPaymentsDetected).toBe(false);
    expect(res.body.data.patterns).toEqual([]);
  });

  it("detects direct_self when sender and recipient share a signing key", async () => {
    // ACCOUNT_ID and OTHER_ID both list THIRD_ID as a signer
    server.loadAccount.mockImplementation((id) => {
      if (id === ACCOUNT_ID) {
        return Promise.resolve(buildAccount(ACCOUNT_ID, [{ key: THIRD_ID, weight: 1 }]));
      }
      if (id === OTHER_ID) {
        return Promise.resolve(buildAccount(OTHER_ID, [{ key: THIRD_ID, weight: 1 }]));
      }
      return Promise.reject({ response: { status: 404 } });
    });

    mockPayments([
      paymentOp({ from: ACCOUNT_ID, to: OTHER_ID, txHash: "shared_key_tx", amount: "5.0000000" }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/self-payment-detection`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.selfPaymentsDetected).toBe(true);

    const directPatterns = res.body.data.patterns.filter((p) => p.type === "direct_self");
    expect(directPatterns.length).toBeGreaterThanOrEqual(1);
    expect(directPatterns[0].txHash).toBe("shared_key_tx");
    expect(directPatterns[0].amount).toBe("5.0000000");
  });

  it("detects circular_chain when a payment chain returns value to the originating account", async () => {
    // Chain: ACCOUNT_ID → OTHER_ID → ACCOUNT_ID (2-hop circular)
    server.loadAccount.mockImplementation((id) => Promise.resolve(buildAccount(id)));

    mockPayments([
      // Outbound leg: ACCOUNT_ID pays OTHER_ID
      paymentOp({ from: ACCOUNT_ID, to: OTHER_ID, txHash: "tx_leg1", amount: "10.0000000" }),
      // Return leg: OTHER_ID pays ACCOUNT_ID back (same payments feed)
      paymentOp({ from: OTHER_ID, to: ACCOUNT_ID, txHash: "tx_leg2", amount: "10.0000000" }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/self-payment-detection`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.selfPaymentsDetected).toBe(true);

    const circularPatterns = res.body.data.patterns.filter((p) => p.type === "circular_chain");
    expect(circularPatterns.length).toBeGreaterThanOrEqual(1);
    expect(circularPatterns[0].txHash).toBe("tx_leg1");
  });

  it("returns 404 for a non-existent account", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/self-payment-detection`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
