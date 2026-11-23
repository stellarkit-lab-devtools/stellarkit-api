"use strict";

/**
 * GET /account/:id/trades — live Horizon mapping (Issue #699).
 *
 * Mocks server.trades().forAccount(id) and verifies pagination, date
 * filters, and the full StellarKit trade shape.
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { trades: jest.fn(), serverInfo: jest.fn().mockResolvedValue({}) },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const accountId = Keypair.random().publicKey();
const counterparty = Keypair.random().publicKey();
const usdcIssuer = Keypair.random().publicKey();

const rawTrade = {
  id: "trade-99",
  paging_token: "pt-99",
  ledger_close_time: "2024-06-15T08:30:00Z",
  offer_id: "offer-7",
  base_is_seller: true,
  base_account: accountId,
  base_amount: "10.5",
  base_asset_type: "native",
  counter_account: counterparty,
  counter_amount: "21",
  counter_asset_type: "credit_alphanum4",
  counter_asset_code: "USDC",
  counter_asset_issuer: usdcIssuer,
  price: { n: 2, d: 1 },
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

describe("GET /account/:id/trades — live Horizon mapping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("calls server.trades().forAccount(id) with pagination params", async () => {
    const chain = mockTrades([rawTrade]);

    const res = await request(app).get(
      `/account/${accountId}/trades?limit=8&cursor=pt-1&order=asc`,
    );

    expect(res.statusCode).toBe(200);
    expect(server.trades).toHaveBeenCalledTimes(1);
    expect(chain.forAccount).toHaveBeenCalledWith(accountId);
    expect(chain.limit).toHaveBeenCalledWith(8);
    expect(chain.order).toHaveBeenCalledWith("asc");
    expect(chain.cursor).toHaveBeenCalledWith("pt-1");
  });

  it("maps the full StellarKit trade shape from the Horizon record", async () => {
    mockTrades([rawTrade]);

    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.trades[0];

    expect(trade.tradeId).toBe("trade-99");
    expect(trade.ledgerCloseTime).toBe("2024-06-15T08:30:00.000Z");
    expect(trade.offerId).toBe("offer-7");
    expect(trade.selling).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(trade.buying).toEqual({
      code: "USDC",
      issuer: usdcIssuer,
      type: "credit_alphanum4",
    });
    expect(trade.soldAmount).toBe("10.5000000");
    expect(trade.boughtAmount).toBe("21.0000000");
    expect(trade.price).toBe("2.0000000");
  });

  it("keeps soldAmount, boughtAmount, and price as seven-decimal strings", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.trades[0];

    for (const field of ["soldAmount", "boughtAmount", "price"]) {
      expect(trade[field]).toMatch(/^\d+\.\d{7}$/);
    }
  });

  it("uses the standard { code, issuer, type } asset shape", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const { selling, buying } = res.body.data.trades[0];

    expect(Object.keys(selling).sort()).toEqual(["code", "issuer", "type"]);
    expect(Object.keys(buying).sort()).toEqual(["code", "issuer", "type"]);
  });

  it("flips selling/buying to the queried account's side of the trade", async () => {
    mockTrades([
      {
        ...rawTrade,
        base_account: counterparty,
        counter_account: accountId,
        base_is_seller: true,
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.trades[0];

    expect(trade.selling).toEqual({
      code: "USDC",
      issuer: usdcIssuer,
      type: "credit_alphanum4",
    });
    expect(trade.buying).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(trade.soldAmount).toBe("21.0000000");
    expect(trade.boughtAmount).toBe("10.5000000");
  });

  it("filters by startDate and endDate on ledgerCloseTime", async () => {
    mockTrades([
      { ...rawTrade, id: "early", ledger_close_time: "2024-01-01T00:00:00Z" },
      { ...rawTrade, id: "mid", ledger_close_time: "2024-06-15T08:30:00Z" },
      { ...rawTrade, id: "late", ledger_close_time: "2024-12-01T00:00:00Z" },
    ]);

    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=2024-06-01T00:00:00Z&endDate=2024-07-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.trades).toHaveLength(1);
    expect(res.body.data.trades[0].tradeId).toBe("mid");
  });

  it("does not leak snake_case Horizon keys", async () => {
    mockTrades([rawTrade]);
    const res = await request(app).get(`/account/${accountId}/trades`);
    const trade = res.body.data.trades[0];

    const snake = Object.keys(trade).filter((k) => k.includes("_"));
    expect(snake).toHaveLength(0);
  });
});
