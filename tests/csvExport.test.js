"use strict";

/**
 * Issue #1176 — ?format=csv for account payments and trades.
 */

const express = require("express");
const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const ACCOUNT = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      payments: jest.fn(),
      trades: jest.fn(),
      operations: jest.fn(),
      ledgers: jest.fn(),
      feeStats: jest.fn(),
    },
  };
});

const { server } = require("../src/config/stellar");
const accountRouter = require("../src/routes/account");
const cacheService = require("../src/services/cache");
const errorHandler = require("../src/middleware/errorHandler");

const app = express();
app.use("/account", accountRouter);
app.use(errorHandler);

function chain(records) {
  const link = (method, arg) => {
    if (method === "call") return Promise.resolve({ records });
    return chain;
  };
  return {
    forAccount: () => chain(records),
    limit: (n) => { chain.lastLimit = n; return chain(records); },
    order: () => chain(records),
    cursor: (c) => { chain.lastCursor = c; return chain(records); },
    call: () => Promise.resolve({ records }),
  };
}

const PAYMENT = {
  id: "p-1",
  type: "payment",
  from: ACCOUNT,
  to: ISSUER,
  asset_code: "USDC",
  asset_issuer: ISSUER,
  asset_type: "credit_alphanum4",
  amount: "12.5",
  created_at: "2024-01-15T12:00:00Z",
  transaction_hash: "hash1",
  paging_token: "pt-1",
};

const TRADE = {
  id: "t-1",
  base_account: ACCOUNT,
  counter_account: ISSUER,
  base_asset_type: "native",
  base_asset_code: "XLM",
  counter_asset_type: "credit_alphanum4",
  counter_asset_code: "USDC",
  counter_asset_issuer: ISSUER,
  base_amount: "10.0",
  counter_amount: "2.0",
  base_is_seller: true,
  ledger_close_time: "2024-01-15T12:00:00Z",
  price: { n: 5, d: 1 },
  paging_token: "tp-1",
  offer_id: "77",
};

describe("?format=csv on /account/:id/payments", () => {
  beforeEach(() => {
    cacheService.flush();
    jest.clearAllMocks();
  });
  afterEach(() => cacheService.flush());

  it("returns text/csv with a header row, flattened assets and 7-decimal amounts", async () => {
    server.payments.mockReturnValue(chain([PAYMENT]));

    const res = await request(app)
      .get(`/account/${ACCOUNT}/payments?format=csv&limit=5`);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="payments-.csv"');
    expect(res.headers["x-next-cursor"]).toBe("pt-1");

    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toContain("paymentId");
    expect(lines[0]).toContain("assetCode");
    expect(lines[0]).toContain("assetIssuer");
    expect(lines[1]).toContain("USDC");
    expect(lines[1]).toContain(ISSUER);
    expect(lines[1]).toContain("12.5000000");
    expect(lines[1]).toContain("2024-01-15T12:00:00.000Z");
  });

  it("quotes commas, quotes and newlines per RFC 4180", async () => {
    server.payments.mockReturnValue(chain([{
      ...PAYMENT,
      from: 'G,with,commas',
      to: 'Q"uoted',
      transaction_hash: "line1\nline2",
    }]));

    const res = await request(app).get(`/account/${ACCOUNT}/payments?format=csv`);
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('"G,with,commas"');
    expect(res.text).toContain('"Q""uoted"');
    expect(res.text).toContain('"line1\nline2"');
  });

  it("escapes spreadsheet formula prefixes", async () => {
    server.payments.mockReturnValue(chain([{
      ...PAYMENT,
      from: "=SUM(1,2)",
      to: "+cmd",
      asset_code: "-1",
      transaction_hash: "@import",
    }]));

    const res = await request(app).get(`/account/${ACCOUNT}/payments?format=csv`);
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("'=SUM(1,2)");
    expect(res.text).toContain("'+cmd");
    expect(res.text).toContain("'-1");
    expect(res.text).toContain("'@import");
  });

  it("honours cursor and limit for a single page", async () => {
    server.payments.mockReturnValue(chain([PAYMENT]));
    const res = await request(app)
      .get(`/account/${ACCOUNT}/payments?format=csv&limit=3&cursor=abc`);
    expect(res.statusCode).toBe(200);
    expect(chain.lastCursor).toBe("abc");
    expect(chain.lastLimit).toBe(3);
  });

  it("returns JSON errors for an unknown format and for Horizon failures", async () => {
    const bad = await request(app)
      .get(`/account/${ACCOUNT}/payments?format=xlsx`);
    expect(bad.statusCode).toBe(400);
    expect(bad.headers["content-type"]).toMatch(/application\/json/);
    expect(bad.body.success).toBe(false);

    server.payments.mockReturnValue({
      forAccount: () => ({ limit: () => ({ order: () => ({ call: () => Promise.reject(new Error("boom")) }) }) }),
    });
    const failed = await request(app).get(`/account/${ACCOUNT}/payments?format=csv`);
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(failed.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("?format=csv on /account/:id/trades", () => {
  beforeEach(() => {
    cacheService.flush();
    jest.clearAllMocks();
  });
  afterEach(() => cacheService.flush());

  it("returns a CSV page with flattened assets and the next cursor header", async () => {
    server.trades.mockReturnValue(chain([TRADE]));

    const res = await request(app).get(`/account/${ACCOUNT}/trades?format=csv&limit=2`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="trades-.csv"');
    expect(res.headers["x-next-cursor"]).toBe("tp-1");

    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toContain("sellingAssetCode");
    expect(lines[0]).toContain("buyingAssetIssuer");
    expect(lines[1]).toContain("10.0000000");
    expect(lines[1]).toContain("2.0000000");
    expect(lines[1]).toContain("5.0000000");
    expect(lines[1]).toContain("2024-01-15T12:00:00.000Z");
  });

  it("rejects unknown formats with a JSON 400", async () => {
    const res = await request(app).get(`/account/${ACCOUNT}/trades?format=pdf`);
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
