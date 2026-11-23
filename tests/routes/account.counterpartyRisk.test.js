/**
 * tests/routes/account.counterpartyRisk.test.js
 *
 * Tests for GET /account/:id/payment-counterparty-risk.
 *
 * Test scenarios:
 *   - A counterparty with a high risk score returns riskLevel: "high"
 *   - A counterparty with no risk factors returns riskLevel: "low"
 *   - ?limit=5 caps results to 5 counterparties
 *   - Counterparties are sorted by txCount descending
 *   - A non-existent account returns a 404
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => ({
  ...jest.requireActual("../../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    payments: jest.fn(),
    operations: jest.fn(),
    offers: jest.fn(),
  },
}));

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const MAIN_ACCOUNT = Keypair.random().publicKey();
const COUNTERPARTY_HIGH_RISK = Keypair.random().publicKey();
const COUNTERPARTY_LOW_RISK = Keypair.random().publicKey();
const COUNTERPARTY_MEDIUM_RISK = Keypair.random().publicKey();
const COUNTERPARTY_MERGED = Keypair.random().publicKey();
const NONEXISTENT_ACCOUNT = Keypair.random().publicKey();
const HORIZON_404 = { response: { status: 404 } };

function makePaymentRecord(from, to, type = "payment") {
  return {
    id: `1234567890-${Math.random()}`,
    type,
    from,
    to,
    amount: "100.0000000",
    asset_type: "native",
    created_at: new Date().toISOString(),
  };
}

function makeAccount(id, options = {}) {
  return {
    id,
    account_id: id,
    sequence: "1",
    balances: options.balances || [],
    home_domain: options.homeDomain || null,
    signers: [],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  };
}

function makeOperationRecord(address, daysOld) {
  return {
    id: "1234567890",
    type: "payment",
    created_at: new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Mocks the payments response for an account.
 */
function mockPayments(accountId, payments) {
  const forAccount = jest.fn(() => ({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: payments }),
  }));
  server.payments.mockReturnValue({ forAccount });
  return forAccount;
}

/**
 * Mocks loadAccount to return different accounts based on the address.
 * For risk assessment, we need to handle counterparty accounts too.
 */
function createLoadAccountMock(accountsById) {
  return jest.fn((id) => {
    const account = accountsById[id];
    if (!account) {
      const error = new Error("Not Found");
      error.response = { status: 404 };
      throw error;
    }
    return Promise.resolve(account);
  });
}

/**
 * Mocks operations().forAccount() to return first operation for age calculation.
 */
function mockOperationsForAccount(address, daysOld) {
  const forAccount = jest.fn(() => ({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({
      records: [makeOperationRecord(address, daysOld)],
    }),
  }));
  server.operations.mockReturnValue({ forAccount });
}

describe("GET /account/:id/payment-counterparty-risk", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // --- Test: high risk counterparty returns riskLevel: "high" ---
  it("a counterparty with a high risk score returns riskLevel: high", async () => {
    // Main account exists
    server.loadAccount.mockResolvedValue(makeAccount(MAIN_ACCOUNT));

    // Payments to high-risk counterparty
    const payments = [
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_HIGH_RISK),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_HIGH_RISK),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_HIGH_RISK),
    ];
    mockPayments(MAIN_ACCOUNT, payments);

    // Counterparty is a new account with no home domain and frozen trustlines
    const highRiskAccount = makeAccount(COUNTERPARTY_HIGH_RISK, {
      homeDomain: null,
      balances: [
        { asset_type: "native", balance: "100" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GA5ZSEYJB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", balance: "50", is_authorized: false },
      ],
    });

    const accountsById = {
      [MAIN_ACCOUNT]: makeAccount(MAIN_ACCOUNT),
      [COUNTERPARTY_HIGH_RISK]: highRiskAccount,
    };
    server.loadAccount.mockImplementation(createLoadAccountMock(accountsById));

    // Counterparty is very new (5 days old) with no home domain and frozen trustlines
    mockOperationsForAccount(COUNTERPARTY_HIGH_RISK, 5);

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/payment-counterparty-risk`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(MAIN_ACCOUNT);
    expect(res.body.data.counterparties).toHaveLength(1);
    
    const counterparty = res.body.data.counterparties[0];
    expect(counterparty.address).toBe(COUNTERPARTY_HIGH_RISK);
    expect(counterparty.txCount).toBe(3);
    expect(counterparty.riskLevel).toBe("high");
    expect(counterparty.riskFactors.length).toBeGreaterThan(0);
  });

  // --- Test: low risk counterparty returns riskLevel: "low" ---
  it("a counterparty with no risk factors returns riskLevel: low", async () => {
    server.loadAccount.mockResolvedValue(makeAccount(MAIN_ACCOUNT));

    const payments = [
      makePaymentRecord(COUNTERPARTY_LOW_RISK, MAIN_ACCOUNT),
    ];
    mockPayments(MAIN_ACCOUNT, payments);

    // Counterparty is an old account with home domain and few trustlines, none frozen
    const lowRiskAccount = makeAccount(COUNTERPARTY_LOW_RISK, {
      homeDomain: "example.com",
      balances: [
        { asset_type: "native", balance: "10000" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GA5ZSEYJB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", balance: "5000", is_authorized: true },
      ],
    });

    const accountsById = {
      [MAIN_ACCOUNT]: makeAccount(MAIN_ACCOUNT),
      [COUNTERPARTY_LOW_RISK]: lowRiskAccount,
    };
    server.loadAccount.mockImplementation(createLoadAccountMock(accountsById));

    // Counterparty is 400 days old (well established)
    mockOperationsForAccount(COUNTERPARTY_LOW_RISK, 400);

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/payment-counterparty-risk`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counterparties).toHaveLength(1);
    
    const counterparty = res.body.data.counterparties[0];
    expect(counterparty.riskLevel).toBe("low");
    expect(counterparty.riskFactors).toEqual([]);
  });

  // --- Test: limit=5 caps results to 5 ---
  it("?limit=5 caps results to 5 counterparties", async () => {
    server.loadAccount.mockResolvedValue(makeAccount(MAIN_ACCOUNT));

    // Create 10 different counterparties
    const payments = [];
    const counterparties = Array.from({ length: 10 }, () => Keypair.random().publicKey);
    
    for (let i = 0; i < 10; i++) {
      // Each counterparty gets i+1 payments (so highest txCount = 10)
      for (let j = 0; j <= i; j++) {
        payments.push(makePaymentRecord(MAIN_ACCOUNT, counterparties[i]));
      }
    }

    // Use a subset of accounts for mocking (just need them to exist)
    const accountsById = { [MAIN_ACCOUNT]: makeAccount(MAIN_ACCOUNT) };
    counterparties.forEach(cp => {
      accountsById[cp] = makeAccount(cp, { homeDomain: "example.com", balances: [{ asset_type: "native", balance: "100" }] });
    });
    server.loadAccount.mockImplementation(createLoadAccountMock(accountsById));

    mockPayments(MAIN_ACCOUNT, payments);

    // Mock operations for each counterparty (old account)
    let opCallCount = 0;
    server.operations.mockImplementation(() => ({
      forAccount: jest.fn(() => ({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [makeOperationRecord("address", 400)],
        }),
      })),
    }));

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/payment-counterparty-risk?limit=5`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.counterparties).toHaveLength(5);
    
    // Verify they are sorted by txCount descending
    const txCounts = res.body.data.counterparties.map(c => c.txCount);
    expect(txCounts).toEqual([11, 10, 9, 8, 7]); // Descending order
  });

  // --- Test: counterparties sorted by txCount descending ---
  it("counterparties are sorted by txCount descending", async () => {
    server.loadAccount.mockResolvedValue(makeAccount(MAIN_ACCOUNT));

    // Create payments with different frequencies
    const payments = [
      // 3 payments to cp1
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_HIGH_RISK),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_HIGH_RISK),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_HIGH_RISK),
      // 10 payments to cp2 (highest)
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      makePaymentRecord(COUNTERPARTY_MEDIUM_RISK, MAIN_ACCOUNT),
      // 5 payments to cp3
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_LOW_RISK),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_LOW_RISK),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_LOW_RISK),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_LOW_RISK),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_LOW_RISK),
    ];

    mockPayments(MAIN_ACCOUNT, payments);

    const accountsById = {
      [MAIN_ACCOUNT]: makeAccount(MAIN_ACCOUNT),
      [COUNTERPARTY_HIGH_RISK]: makeAccount(COUNTERPARTY_HIGH_RISK, { homeDomain: "example.com" }),
      [COUNTERPARTY_MEDIUM_RISK]: makeAccount(COUNTERPARTY_MEDIUM_RISK, { homeDomain: "example.com" }),
      [COUNTERPARTY_LOW_RISK]: makeAccount(COUNTERPARTY_LOW_RISK, { homeDomain: "example.com" }),
    };
    server.loadAccount.mockImplementation(createLoadAccountMock(accountsById));

    server.operations.mockImplementation(() => ({
      forAccount: jest.fn(() => ({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [makeOperationRecord("address", 400)],
        }),
      })),
    }));

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/payment-counterparty-risk`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.counterparties).toHaveLength(3);
    
    // Verify descending order by txCount
    expect(res.body.data.counterparties[0].txCount).toBe(10);
    expect(res.body.data.counterparties[1].txCount).toBe(5);
    expect(res.body.data.counterparties[2].txCount).toBe(3);
  });

  // --- Test: non-existent account returns 404 ---
  it("non-existent account returns a 404", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);

    const res = await request(app).get(`/account/${NONEXISTENT_ACCOUNT}/payment-counterparty-risk`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  // --- Test: counterparty account not found (merged/does not exist) ---
  it("counterparty that does not exist returns high risk", async () => {
    server.loadAccount.mockResolvedValue(makeAccount(MAIN_ACCOUNT));

    const payments = [
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_MERGED),
      makePaymentRecord(MAIN_ACCOUNT, COUNTERPARTY_MERGED),
    ];
    mockPayments(MAIN_ACCOUNT, payments);

    // Main account exists, but counterparty doesn't
    const accountsById = {
      [MAIN_ACCOUNT]: makeAccount(MAIN_ACCOUNT),
    };
    const loadAccountMock = jest.fn((id) => {
      if (id === COUNTERPARTY_MERGED) {
        const error = new Error("Not Found");
        error.response = { status: 404 };
        throw error;
      }
      return Promise.resolve(accountsById[id]);
    });
    server.loadAccount.mockImplementation(loadAccountMock);

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/payment-counterparty-risk`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.counterparties).toHaveLength(1);
    expect(res.body.data.counterparties[0].riskLevel).toBe("high");
    expect(res.body.data.counterparties[0].riskFactors).toContain("Counterparty account does not exist or has been merged");
  });
});