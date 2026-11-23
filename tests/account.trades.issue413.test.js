"use strict";

/**
 * Tests for GET /account/:id/trades response shape per Issue #413.
 *
 * Acceptance criteria:
 *   - Returns { success: true, data: { trades: [...], total, limit, cursor } }
 *   - Each trade includes tradeId, ledgerCloseTime, selling, buying,
 *     soldAmount, boughtAmount, price, and offerId
 *   - Asset fields follow the { code, issuer, type } shape
 *   - soldAmount/boughtAmount/price are seven-decimal strings
 *   - Supports limit and cursor query params
 *   - Returns 404 if the account does not exist
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { trades: jest.fn(), loadAccount: jest.fn() },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const accountId = Keypair.random().publicKey();
const counterparty = Keypair.random().publicKey();
const usdcIssuer = Keypair.random().publicKey();

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

describe("GET /account/:id/trades — Issue #413 response shape", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns { trades, total, limit, cursor } with normalised fields", async () => {
    mockTrades([
      {
        id: "123456789",
        paging_token: "pt-1",
        offer_id: "999",
        ledger_close_time: "2024-05-01T00:00:00Z",
        base_account: accountId,
        base_amount: "10",
        base_asset_type: "native",
        base_is_seller: true,
        counter_account: counterparty,
        counter_amount: "25.5",
        counter_asset_type: "credit_alphanum4",
        counter_asset_code: "USDC",
        counter_asset_issuer: usdcIssuer,
        price: { n: 51, d: 20 },
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/trades?limit=5`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(Array.isArray(data.trades)).toBe(true);
    expect(data.trades).toHaveLength(1);
    expect(data).toHaveProperty("total", 1);
    expect(data).toHaveProperty("limit", 5);
    expect(data).toHaveProperty("cursor");

    const trade = data.trades[0];
    expect(trade.tradeId).toBe("123456789");
    expect(trade.offerId).toBe("999");
    expect(trade.ledgerCloseTime).toBe("2024-05-01T00:00:00.000Z");

    // accountId is base_account and base_is_seller=true, so it sold the base asset (XLM)
    expect(trade.selling).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(trade.buying).toEqual({ code: "USDC", issuer: usdcIssuer, type: "credit_alphanum4" });
    expect(trade.soldAmount).toBe("10.0000000");
    expect(trade.boughtAmount).toBe("25.5000000");
    expect(trade.price).toBe("2.5500000");
  });

  it("flips selling/buying when the queried account is the counterparty", async () => {
    mockTrades([
      {
        id: "1",
        paging_token: "pt-1",
        offer_id: "1",
        ledger_close_time: "2024-05-01T00:00:00Z",
        base_account: counterparty,
        base_amount: "10",
        base_asset_type: "native",
        base_is_seller: true,
        counter_account: accountId,
        counter_amount: "25.5",
        counter_asset_type: "credit_alphanum4",
        counter_asset_code: "USDC",
        counter_asset_issuer: usdcIssuer,
        price: { n: 51, d: 20 },
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.trades[0];

    // accountId is counter_account and base_is_seller=true (counterparty sold XLM),
    // so accountId bought XLM by selling USDC.
    expect(trade.selling).toEqual({ code: "USDC", issuer: usdcIssuer, type: "credit_alphanum4" });
    expect(trade.buying).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(trade.soldAmount).toBe("25.5000000");
    expect(trade.boughtAmount).toBe("10.0000000");
  });

  it("supports ?limit and ?cursor query params", async () => {
    const chain = mockTrades([]);
    const res = await request(app).get(
      `/account/${accountId}/trades?limit=7&cursor=pt-42`,
    );

    expect(res.statusCode).toBe(200);
    expect(chain.limit).toHaveBeenCalledWith(7);
    expect(chain.cursor).toHaveBeenCalledWith("pt-42");
    expect(res.body.data.limit).toBe(7);
  });

  it("returns 404 when the account does not exist", async () => {
    const notFound = new Error("Not Found");
    notFound.response = { status: 404 };
    server.trades.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue(notFound),
    });

    const res = await request(app).get(`/account/${accountId}/trades`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
