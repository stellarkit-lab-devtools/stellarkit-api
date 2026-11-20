/**
 * Tests for GET /account/:id/claimable-balance-summary
 *
 * Verifies:
 *   1. An account with 2 eligible and 1 pending balance returns
 *      { eligibleNow: 2, pending: 1, expired: 0 }
 *   2. totalValueXLM only includes eligible native balances, not pending ones
 *   3. An account with no claimable balances returns all zeroes
 *   4. A non-existent account returns a 404
 *
 * All Horizon calls are mocked; no real network requests are made.
 */
"use strict";

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
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

// ── Fixtures ────────────────────────────────────────────────────────────────

const ACCOUNT_ID = Keypair.random().publicKey();

/** Minimal Horizon account record that satisfies loadAccount */
function buildHorizonAccount(id = ACCOUNT_ID) {
  return {
    id,
    sequence: "123456789",
    subentry_count: 0,
    last_modified_ledger: 1000,
    home_domain: null,
    balances: [{ asset_type: "native", balance: "10.0000000" }],
    signers: [{ key: id, weight: 1, type: "ed25519_public_key" }],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: {},
    data: {},
    data_attr: {},
  };
}

/**
 * Build a claimable balance record for ACCOUNT_ID with the given predicate
 * and asset/amount.
 */
function buildBalance({
  id = "000000001",
  asset = "native",
  amount = "10.0000000",
  predicate = { unconditional: true },
  destination = ACCOUNT_ID,
} = {}) {
  return {
    id,
    asset,
    amount,
    sponsor: null,
    created_at: "2024-01-01T00:00:00Z",
    paging_token: id,
    claimants: [{ destination, predicate }],
  };
}

/** Configures the server mock to return the given claimable balance records */
function mockClaimableBalances(records) {
  server.claimableBalances.mockReturnValue({
    claimant: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
  // Default: account exists
  server.loadAccount.mockResolvedValue(buildHorizonAccount());
});

// ── Test cases ────────────────────────────────────────────────────────────────

describe("GET /account/:id/claimable-balance-summary", () => {
  // ── Test case 1 ────────────────────────────────────────────────────────────
  it("returns eligibleNow: 2, pending: 1, expired: 0 for matching balance mix", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 h from now

    mockClaimableBalances([
      // Eligible #1 — unconditional
      buildBalance({ id: "bal-1", predicate: { unconditional: true } }),
      // Eligible #2 — abs_before in the future
      buildBalance({
        id: "bal-2",
        predicate: { abs_before: future },
      }),
      // Pending — relative time-lock (rel_before; cannot evaluate without creation time)
      buildBalance({
        id: "bal-3",
        predicate: { rel_before: "3600" },
      }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/claimable-balance-summary`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      accountId: ACCOUNT_ID,
      totalBalances: 3,
      eligibleNow: 2,
      pending: 1,
      expired: 0,
    });
  });

  // ── Test case 2 ────────────────────────────────────────────────────────────
  it("totalValueXLM includes only eligible native balances, not pending ones", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    mockClaimableBalances([
      // Eligible native: 10 XLM
      buildBalance({
        id: "bal-1",
        asset: "native",
        amount: "10.0000000",
        predicate: { unconditional: true },
      }),
      // Eligible native: 5 XLM
      buildBalance({
        id: "bal-2",
        asset: "native",
        amount: "5.0000000",
        predicate: { abs_before: future },
      }),
      // Pending native: 100 XLM — must NOT be counted
      buildBalance({
        id: "bal-3",
        asset: "native",
        amount: "100.0000000",
        predicate: { rel_before: "3600" },
      }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/claimable-balance-summary`
    );

    expect(res.statusCode).toBe(200);
    // Only the two eligible balances (10 + 5 = 15 XLM) should be counted
    expect(res.body.data.totalValueXLM).toBe("15.0000000");
    expect(res.body.data.eligibleNow).toBe(2);
    expect(res.body.data.pending).toBe(1);
  });

  // ── Test case 3 ────────────────────────────────────────────────────────────
  it("returns all zeroes when the account has no claimable balances", async () => {
    mockClaimableBalances([]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/claimable-balance-summary`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      accountId: ACCOUNT_ID,
      totalBalances: 0,
      eligibleNow: 0,
      pending: 0,
      expired: 0,
      totalValueXLM: "0.0000000",
    });
  });

  // ── Test case 4 ────────────────────────────────────────────────────────────
  it("returns 404 when the account does not exist", async () => {
    const notFoundErr = new Error("Not Found");
    notFoundErr.response = { status: 404 };
    server.loadAccount.mockRejectedValue(notFoundErr);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/claimable-balance-summary`
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  // ── Bonus: expired balance ─────────────────────────────────────────────────
  it("classifies abs_before in the past as expired", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 h ago

    mockClaimableBalances([
      buildBalance({ id: "bal-1", predicate: { abs_before: past } }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/claimable-balance-summary`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      totalBalances: 1,
      eligibleNow: 0,
      pending: 0,
      expired: 1,
      totalValueXLM: "0.0000000",
    });
  });

  // ── Bonus: caching ──────────────────────────────────────────────────────────
  it("caches the response and returns X-Cache: HIT on repeat requests", async () => {
    mockClaimableBalances([
      buildBalance({ id: "bal-1", predicate: { unconditional: true } }),
    ]);

    const first = await request(app).get(
      `/account/${ACCOUNT_ID}/claimable-balance-summary`
    );
    expect(first.headers["x-cache"]).toBe("MISS");

    const second = await request(app).get(
      `/account/${ACCOUNT_ID}/claimable-balance-summary`
    );
    expect(second.headers["x-cache"]).toBe("HIT");
    // loadAccount called once per unique account (first request only)
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  // ── Bonus: invalid account ID ───────────────────────────────────────────────
  it("returns 400 for a malformed account ID", async () => {
    const res = await request(app).get(
      "/account/NOT_A_VALID_KEY/claimable-balance-summary"
    );
    expect(res.statusCode).toBe(400);
  });
});
