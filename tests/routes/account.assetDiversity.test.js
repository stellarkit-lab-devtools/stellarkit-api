/**
 * Tests for GET /account/:id/asset-diversity
 *
 * Verifies:
 *   1. An account holding 100% of value in one asset returns
 *      hhi: 10000 and diversityLevel: "concentrated"
 *   2. An account with equal value spread across 10 assets returns
 *      hhi: 1000 and diversityLevel: "moderate"
 *   3. portfolioPercent values in the breakdown sum to approximately 100
 *   4. A non-existent account returns a 404
 *
 * HHI is verified to within 1 unit of the expected value (rounding tolerance).
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
      orderbook: jest.fn(),
    },
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ACCOUNT_ID = Keypair.random().publicKey();
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

/**
 * Build a minimal Horizon account with the given balances array.
 */
function buildAccount(balances) {
  return {
    id: ACCOUNT_ID,
    sequence: "123456789",
    subentry_count: balances.length,
    last_modified_ledger: 1000,
    home_domain: null,
    balances,
    signers: [{ key: ACCOUNT_ID, weight: 1, type: "ed25519_public_key" }],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: {},
    data: {},
    data_attr: {},
  };
}

/** Native XLM balance entry */
function nativeBalance(amount) {
  return {
    asset_type: "native",
    balance: amount,
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
  };
}

/** Non-native asset balance entry */
function assetBalance(code, amount, issuer = ISSUER) {
  return {
    asset_type: "credit_alphanum4",
    asset_code: code,
    asset_issuer: issuer,
    balance: amount,
    limit: "1000000.0000000",
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
    is_authorized: true,
  };
}

/**
 * Configure server.orderbook to return a mid-price of `priceInXLM` for any
 * asset pair. Called for every non-native asset balance.
 */
function mockOrderBook(priceInXLM) {
  server.orderbook.mockReturnValue({
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({
      bids: [{ price: String(priceInXLM), amount: "1000" }],
      asks: [{ price: String(priceInXLM), amount: "1000" }],
    }),
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
});

// ── Test cases ────────────────────────────────────────────────────────────────

describe("GET /account/:id/asset-diversity", () => {
  // ── Test case 1 ────────────────────────────────────────────────────────────
  it("returns hhi: 10000 and diversityLevel: 'concentrated' when 100% in one asset", async () => {
    // Account holds only native XLM — 100% concentration
    server.loadAccount.mockResolvedValue(
      buildAccount([nativeBalance("100.0000000")])
    );
    // No non-native assets → orderbook never called

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-diversity`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { hhi, diversityLevel, breakdown } = res.body.data;

    // HHI for 100% in one asset = 100² = 10000
    expect(Math.abs(hhi - 10000)).toBeLessThanOrEqual(1);
    expect(diversityLevel).toBe("concentrated");

    // Single asset in breakdown, 100% portfolio share
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].portfolioPercent).toBeCloseTo(100, 1);
  });

  // ── Test case 2 ────────────────────────────────────────────────────────────
  it("returns hhi: 1000 and diversityLevel: 'diversified' for equal value across 10 assets", async () => {
    // 10 assets each worth exactly 10 XLM:
    //   - native XLM balance of 10
    //   - 9 non-native assets, each with balance 1, price 10 XLM each
    const balances = [
      nativeBalance("10.0000000"),
      ...Array.from({ length: 9 }, (_, i) =>
        assetBalance(`AS${i}`, "1.0000000")
      ),
    ];
    server.loadAccount.mockResolvedValue(buildAccount(balances));

    // Each non-native asset's order book returns price = 10 XLM
    mockOrderBook(10);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-diversity`);

    expect(res.statusCode).toBe(200);

    const { hhi, diversityLevel } = res.body.data;

    // HHI for 10 equal shares = 10 × (10²) = 1000
    expect(Math.abs(hhi - 1000)).toBeLessThanOrEqual(1);
    // HHI of 1000 is below the 1500 threshold → diversified
    expect(diversityLevel).toBe("diversified");
  });

  // ── Test case 3 ────────────────────────────────────────────────────────────
  it("portfolioPercent values in the breakdown sum to approximately 100", async () => {
    // 3 assets: native 50 XLM, USDC worth 30 XLM, AQUA worth 20 XLM
    server.loadAccount.mockResolvedValue(
      buildAccount([
        nativeBalance("50.0000000"),
        assetBalance("USDC", "30.0000000"),
        assetBalance("AQUA", "20.0000000"),
      ])
    );

    // USDC: price 1 XLM → value 30 XLM
    // AQUA: price 1 XLM → value 20 XLM
    mockOrderBook(1);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-diversity`);

    expect(res.statusCode).toBe(200);

    const { breakdown } = res.body.data;

    // Filter entries with a known portfolio percent (priced assets only)
    const pricedEntries = breakdown.filter(
      (e) => e.portfolioPercent !== null
    );
    expect(pricedEntries.length).toBeGreaterThan(0);

    const sum = pricedEntries.reduce((acc, e) => acc + e.portfolioPercent, 0);
    // Allow ±1 for floating-point rounding across multiple assets
    expect(sum).toBeGreaterThanOrEqual(99);
    expect(sum).toBeLessThanOrEqual(101);
  });

  // ── Test case 4 ────────────────────────────────────────────────────────────
  it("returns 404 when the account does not exist", async () => {
    const notFoundErr = new Error("Not Found");
    notFoundErr.response = { status: 404 };
    server.loadAccount.mockRejectedValue(notFoundErr);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-diversity`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  // ── Bonus: response shape ──────────────────────────────────────────────────
  it("includes accountId, hhi, diversityLevel, and breakdown in the response", async () => {
    server.loadAccount.mockResolvedValue(
      buildAccount([nativeBalance("50.0000000")])
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-diversity`);

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    expect(data).toHaveProperty("accountId", ACCOUNT_ID);
    expect(data).toHaveProperty("hhi");
    expect(data).toHaveProperty("diversityLevel");
    expect(Array.isArray(data.breakdown)).toBe(true);
    expect(data.breakdown[0]).toHaveProperty("asset");
    expect(data.breakdown[0]).toHaveProperty("balance");
    expect(data.breakdown[0]).toHaveProperty("valueInXLM");
    expect(data.breakdown[0]).toHaveProperty("portfolioPercent");
  });

  // ── Bonus: invalid account ID ──────────────────────────────────────────────
  it("returns 400 for a malformed account ID", async () => {
    const res = await request(app).get(
      "/account/INVALID_KEY/asset-diversity"
    );
    expect(res.statusCode).toBe(400);
  });

  // ── Bonus: diversified classification ─────────────────────────────────────
  it("returns diversityLevel: 'diversified' for a well-spread portfolio (HHI ≤ 1500)", async () => {
    // 20 assets with equal 5% each → HHI = 20 × 25 = 500
    const balances = Array.from({ length: 20 }, (_, i) =>
      i === 0
        ? nativeBalance("5.0000000")
        : assetBalance(`TK${i}`, "1.0000000")
    );
    server.loadAccount.mockResolvedValue(buildAccount(balances));
    // All non-native assets price at 5 XLM each → equal value to native
    mockOrderBook(5);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-diversity`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.diversityLevel).toBe("diversified");
    expect(res.body.data.hhi).toBeLessThanOrEqual(1500);
  });
});
