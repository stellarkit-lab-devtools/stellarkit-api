"use strict";

/**
 * Tests for GET /account/:id/trades — normalised response shape.
 *
 * Acceptance criteria (Issue #417):
 *   - No snake_case fields in the response
 *   - No raw fraction objects (price_r must not appear)
 *   - price is a 7-decimal string derived from price_r (n / d)
 *   - baseAmount and counterAmount are 7-decimal strings
 *   - baseAsset and counterAsset follow { code, issuer, type } shape
 *   - tradeType is "sell" or "buy" (derived from base_is_seller)
 *   - baseIsSeller is NOT present in the response
 *   - priceNumerator and priceDenominator are NOT present in the response
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { trades: jest.fn() },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const accountId = Keypair.random().publicKey();
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

/** A fully-populated Horizon trade record with all raw fields present */
const rawTrade = {
  id: "trade-1",
  paging_token: "pt-1",
  ledger_close_time: "2024-06-01T12:00:00Z",
  offer_id: "offer-42",
  base_is_seller: true,
  base_account: accountId,
  base_amount: "10.5",
  base_asset_type: "native",
  base_asset_code: undefined,
  base_asset_issuer: undefined,
  counter_account: ISSUER,
  counter_amount: "21.0",
  counter_asset_type: "credit_alphanum4",
  counter_asset_code: "USDC",
  counter_asset_issuer: ISSUER,
  price: { n: 2, d: 1 }, // price = 2.0
};

function mockTrades(records = []) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.trades.mockReturnValue(chain);
  return chain;
}

describe("GET /account/:id/trades — normalised response shape", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── Top-level shape ────────────────────────────────────────────────────────

  it("returns 200 with success:true and data.items array", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
  });

  // ── No snake_case fields ───────────────────────────────────────────────────

  it("does not include any snake_case fields in a trade item", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];

    const snakeCaseFields = Object.keys(trade).filter((k) => k.includes("_"));
    expect(snakeCaseFields).toHaveLength(0);
  });

  it("does not expose paging_token (use pagingToken instead)", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).not.toHaveProperty("paging_token");
    expect(trade).toHaveProperty("pagingToken", "pt-1");
  });

  it("does not expose ledger_close_time (use ledgerCloseTime instead)", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).not.toHaveProperty("ledger_close_time");
    expect(trade).toHaveProperty("ledgerCloseTime");
  });

  it("does not expose base_account / base_amount / base_asset_type etc.", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    const forbidden = [
      "base_account",
      "base_amount",
      "base_asset_type",
      "base_asset_code",
      "base_asset_issuer",
      "counter_account",
      "counter_amount",
      "counter_asset_type",
      "counter_asset_code",
      "counter_asset_issuer",
      "offer_id",
    ];
    for (const field of forbidden) {
      expect(trade).not.toHaveProperty(field);
    }
  });

  // ── Removed fraction fields ────────────────────────────────────────────────

  it("does not expose priceNumerator or priceDenominator", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).not.toHaveProperty("priceNumerator");
    expect(trade).not.toHaveProperty("priceDenominator");
  });

  it("does not expose raw price_r fraction object", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).not.toHaveProperty("price_r");
  });

  it("does not expose baseIsSeller field", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).not.toHaveProperty("baseIsSeller");
    expect(trade).not.toHaveProperty("base_is_seller");
  });

  // ── price derived from price_r ─────────────────────────────────────────────

  it("price is a 7-decimal string derived from price_r (n / d)", async () => {
    mockTrades([rawTrade]); // price_r = { n: 2, d: 1 } → 2.0
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).toHaveProperty("price");
    expect(trade.price).toBe("2.0000000");
  });

  it("price rounds correctly for non-integer fractions", async () => {
    mockTrades([
      {
        ...rawTrade,
        id: "trade-2",
        price: { n: 1, d: 3 }, // 0.3333333...
      },
    ]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade.price).toBe("0.3333333");
  });

  it("price is '0.0000000' when price_r is missing", async () => {
    mockTrades([{ ...rawTrade, id: "trade-3", price: undefined }]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade.price).toBe("0.0000000");
  });

  it("price is '0.0000000' when price_r denominator is zero", async () => {
    mockTrades([{ ...rawTrade, id: "trade-4", price: { n: 5, d: 0 } }]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade.price).toBe("0.0000000");
  });

  // ── 7-decimal amounts ──────────────────────────────────────────────────────

  it("baseAmount is a 7-decimal string", async () => {
    mockTrades([rawTrade]); // base_amount: "10.5"
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).toHaveProperty("baseAmount");
    expect(trade.baseAmount).toBe("10.5000000");
  });

  it("counterAmount is a 7-decimal string", async () => {
    mockTrades([rawTrade]); // counter_amount: "21.0"
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).toHaveProperty("counterAmount");
    expect(trade.counterAmount).toBe("21.0000000");
  });

  it("integer amounts are padded to 7 decimals", async () => {
    mockTrades([
      { ...rawTrade, base_amount: "100", counter_amount: "200" },
    ]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade.baseAmount).toBe("100.0000000");
    expect(trade.counterAmount).toBe("200.0000000");
  });

  it("amounts that are already 7 decimals are unchanged", async () => {
    mockTrades([
      { ...rawTrade, base_amount: "1.2345678", counter_amount: "9.8765432" },
    ]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade.baseAmount).toBe("1.2345678");
    expect(trade.counterAmount).toBe("9.8765432");
  });

  // ── Asset shape ────────────────────────────────────────────────────────────

  it("baseAsset and counterAsset have { code, issuer, type } shape", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];

    expect(trade.baseAsset).toHaveProperty("code");
    expect(trade.baseAsset).toHaveProperty("issuer");
    expect(trade.baseAsset).toHaveProperty("type");

    expect(trade.counterAsset).toHaveProperty("code");
    expect(trade.counterAsset).toHaveProperty("issuer");
    expect(trade.counterAsset).toHaveProperty("type");
  });

  it("native base asset normalises to { code: 'XLM', issuer: null, type: 'native' }", async () => {
    mockTrades([rawTrade]); // base_asset_type: "native"
    const res = await request(app).get(`/account/${accountId}/trades`);
    const { baseAsset } = res.body.data.items[0];
    expect(baseAsset.code).toBe("XLM");
    expect(baseAsset.issuer).toBeNull();
    expect(baseAsset.type).toBe("native");
  });

  it("credit_alphanum4 counter asset carries correct code, issuer, and type", async () => {
    mockTrades([rawTrade]); // counter: USDC credit_alphanum4
    const res = await request(app).get(`/account/${accountId}/trades`);
    const { counterAsset } = res.body.data.items[0];
    expect(counterAsset.code).toBe("USDC");
    expect(counterAsset.issuer).toBe(ISSUER);
    expect(counterAsset.type).toBe("credit_alphanum4");
  });

  it("credit_alphanum12 asset type is set correctly", async () => {
    mockTrades([
      {
        ...rawTrade,
        counter_asset_type: "credit_alphanum12",
        counter_asset_code: "yXLMLONGCODE",
        counter_asset_issuer: ISSUER,
      },
    ]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const { counterAsset } = res.body.data.items[0];
    expect(counterAsset.type).toBe("credit_alphanum12");
    expect(counterAsset.code).toBe("yXLMLONGCODE");
  });

  // ── tradeType direction ────────────────────────────────────────────────────

  it("tradeType is 'sell' when base_is_seller is true", async () => {
    mockTrades([{ ...rawTrade, base_is_seller: true }]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    expect(res.body.data.items[0].tradeType).toBe("sell");
  });

  it("tradeType is 'buy' when base_is_seller is false", async () => {
    mockTrades([{ ...rawTrade, base_is_seller: false }]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    expect(res.body.data.items[0].tradeType).toBe("buy");
  });

  // ── Other camelCase fields ─────────────────────────────────────────────────

  it("offerId maps from offer_id", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).toHaveProperty("offerId", "offer-42");
  });

  it("baseAccount maps from base_account", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).toHaveProperty("baseAccount", accountId);
  });

  it("counterAccount maps from counter_account", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.items[0];
    expect(trade).toHaveProperty("counterAccount", ISSUER);
  });

  // ── Empty list ─────────────────────────────────────────────────────────────

  it("returns empty items array and total 0 when no trades exist", async () => {
    mockTrades([]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });
});
