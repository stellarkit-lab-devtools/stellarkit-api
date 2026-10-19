/**
 * tests/routes/account.claimableBalanceSummary.test.js
 *
 * Coverage for GET /account/:id/claimable-balance-summary:
 *   1. 2 eligible + 1 pending balance → { eligibleNow: 2, pending: 1, expired: 0 }
 *   2. totalValueXLM only includes eligible XLM balances, not pending ones
 *   3. Account with no claimable balances → all zeroes
 *   4. Non-existent account → 404
 *
 * Tests mock the claimable balance fetch and predicate evaluation via the
 * Stellar SDK server mock. No real Horizon calls are made.
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../../src/services/cache");

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      loadAccount: jest.fn(),
      claimableBalances: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT_ID = Keypair.random().publicKey();

/** Builds a mock account stub (just enough for loadAccount). */
function mockAccount(id = ACCOUNT_ID) {
  return { id, balances: [], signers: [], thresholds: {}, flags: {}, subentry_count: 0 };
}

/** Makes server.loadAccount resolve with a valid account. */
function mockAccountExists(id = ACCOUNT_ID) {
  server.loadAccount.mockResolvedValue(mockAccount(id));
}

/** Makes server.loadAccount reject with a Horizon 404. */
function mockAccountNotFound() {
  const err = new Error("Not found");
  err.response = { status: 404 };
  server.loadAccount.mockRejectedValue(err);
}

/**
 * Builds a claimable balance record with the given predicate for ACCOUNT_ID.
 *
 * @param {object} opts
 * @param {string} opts.id        - balance ID
 * @param {string} opts.asset     - "native" or "CODE:ISSUER"
 * @param {string} opts.amount    - decimal string
 * @param {object} opts.predicate - claimant predicate object
 */
function makeBalance({ id, asset = "native", amount = "10.0000000", predicate }) {
  return {
    id,
    asset,
    amount,
    sponsor: null,
    created_at: "2024-01-01T00:00:00Z",
    paging_token: id,
    claimants: [{ destination: ACCOUNT_ID, predicate }],
  };
}

/** Makes server.claimableBalances() return the given records. */
function mockClaimableBalances(records) {
  server.claimableBalances.mockReturnValue({
    claimant: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /account/:id/claimable-balance-summary", () => {
  // ── Test 1 ────────────────────────────────────────────────────────────────
  it("returns eligibleNow: 2, pending: 1, expired: 0 for 2 eligible and 1 pending balance", async () => {
    mockAccountExists();

    const farFuture = new Date(Date.now() + 86400 * 1000 * 365).toISOString(); // 1 year from now
    const recentPast = new Date(Date.now() - 86400 * 1000).toISOString();       // yesterday

    mockClaimableBalances([
      // eligible — unconditional
      makeBalance({ id: "bal-1", predicate: { unconditional: true } }),
      // eligible — abs_after in the past (window already opened)
      makeBalance({ id: "bal-2", predicate: { abs_after: recentPast } }),
      // pending — abs_after far in the future (window not yet open)
      makeBalance({ id: "bal-3", predicate: { abs_after: farFuture } }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/claimable-balance-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.eligibleNow).toBe(2);
    expect(res.body.data.pending).toBe(1);
    expect(res.body.data.expired).toBe(0);
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  it("totalValueXLM only includes eligible balances, not pending ones", async () => {
    mockAccountExists();

    const farFuture = new Date(Date.now() + 86400 * 1000 * 365).toISOString();

    mockClaimableBalances([
      // eligible XLM — 50 XLM
      makeBalance({ id: "bal-e1", asset: "native", amount: "50.0000000", predicate: { unconditional: true } }),
      // eligible XLM — 30 XLM
      makeBalance({ id: "bal-e2", asset: "native", amount: "30.0000000", predicate: { unconditional: true } }),
      // pending XLM — 999 XLM (must NOT be counted)
      makeBalance({ id: "bal-p1", asset: "native", amount: "999.0000000", predicate: { abs_after: farFuture } }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/claimable-balance-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Only the two eligible balances (50 + 30 = 80) should be in totalValueXLM
    expect(res.body.data.totalValueXLM).toBe("80.0000000");
    // The pending balance must not be included
    expect(res.body.data.totalValueXLM).not.toBe("1079.0000000");
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  it("returns all zeroes for an account with no claimable balances", async () => {
    mockAccountExists();
    mockClaimableBalances([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/claimable-balance-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.eligibleNow).toBe(0);
    expect(res.body.data.pending).toBe(0);
    expect(res.body.data.expired).toBe(0);
    expect(res.body.data.totalValueXLM).toBe("0.0000000");
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  it("returns 404 for a non-existent account", async () => {
    mockAccountNotFound();
    // claimableBalances should never be called — but mock it defensively
    mockClaimableBalances([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/claimable-balance-summary`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    // loadAccount was called, claimableBalances was not
    expect(server.loadAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(server.claimableBalances).not.toHaveBeenCalled();
  });

  // ── Additional coverage: expired predicate ────────────────────────────────
  it("correctly classifies an expired abs_before predicate", async () => {
    mockAccountExists();

    const pastDeadline = new Date(Date.now() - 86400 * 1000).toISOString(); // yesterday

    mockClaimableBalances([
      makeBalance({ id: "bal-exp", predicate: { abs_before: pastDeadline } }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/claimable-balance-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.eligibleNow).toBe(0);
    expect(res.body.data.pending).toBe(0);
    expect(res.body.data.expired).toBe(1);
  });

  // ── Response shape ─────────────────────────────────────────────────────────
  it("always returns accountId in the response", async () => {
    mockAccountExists();
    mockClaimableBalances([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/claimable-balance-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
  });

  // ── Invalid account ID → 400 ──────────────────────────────────────────────
  it("returns 400 for an invalid account ID format", async () => {
    const res = await request(app).get("/account/NOT_A_VALID_KEY/claimable-balance-summary");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
