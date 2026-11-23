"use strict";

const request = require("supertest");
const cacheService = require("../src/services/cache");

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

let app;
let server;

function mockOrderbook(bidPrice, askPrice) {
  return {
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({
      bids: bidPrice != null ? [{ price: String(bidPrice), amount: "1000" }] : [],
      asks: askPrice != null ? [{ price: String(askPrice), amount: "1000" }] : [],
    }),
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.doMock("../src/config/stellar", () => {
    const original = jest.requireActual("../src/config/stellar");
    return {
      ...original,
      server: {
        orderbook: jest.fn(),
      },
    };
  });
  ({ server } = require("../src/config/stellar"));
  app = require("../src/index");
  cacheService.flush();
});

function expectAssetShape(asset) {
  expect(asset).toEqual(
    expect.objectContaining({
      code: expect.any(String),
      type: expect.any(String),
    }),
  );
  expect(asset).toHaveProperty("issuer");
  expect(Object.keys(asset).sort()).toEqual(["code", "issuer", "type"].sort());
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      collectKeys(v, keys);
    }
  }
  return keys;
}

describe("GET /dex/arbitrage-opportunities — normalised shape", () => {
  it("returns opportunities with standard asset shape and seven-decimal amounts", async () => {
    server.orderbook.mockImplementation(() => mockOrderbook("0.1000000", "0.1010000"));

    const res = await request(app).get("/dex/arbitrage-opportunities");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("opportunities");
    expect(res.body.data).toHaveProperty("total");
    expect(res.body.data).toHaveProperty("timestamp");
    expect(res.body.data.total).toBe(res.body.data.opportunities.length);
    expect(res.body.data.opportunities.length).toBeGreaterThan(0);

    const opp = res.body.data.opportunities[0];
    expectAssetShape(opp.buyAsset);
    expectAssetShape(opp.sellAsset);
    expect(opp.buyAsset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(opp.sellAsset.code).toBeTruthy();
    expect(opp.sellAsset.issuer).toMatch(/^G/);
    expect(opp.sellAsset.type).toMatch(/^credit_alphanum/);

    expect(opp.spread).toMatch(/^\d+\.\d{7}$/);
    expect(opp.profitPercent).toMatch(/^\d+\.\d{7}$/);
    expect(["high", "medium", "low"]).toContain(opp.confidence);
    expect(opp.confidence).toBe(opp.confidence.toLowerCase());
  });

  it("uses lowercase confidence values only", async () => {
    // ~0.995% profit → medium
    server.orderbook.mockImplementation(() => mockOrderbook("1.0000000", "1.0100000"));

    const res = await request(app).get("/dex/arbitrage-opportunities");
    for (const opp of res.body.data.opportunities) {
      expect(opp.confidence).toBe(opp.confidence.toLowerCase());
      expect(["high", "medium", "low"]).toContain(opp.confidence);
    }
  });

  it("assigns high confidence when profitPercent >= 2", async () => {
    // spread / mid * 100 ≈ 4.76%
    server.orderbook.mockImplementation(() => mockOrderbook("1.0000000", "1.0500000"));

    const res = await request(app).get("/dex/arbitrage-opportunities");
    expect(res.body.data.opportunities.every((o) => o.confidence === "high")).toBe(true);
  });

  it("timestamp is an ISO 8601 string", async () => {
    server.orderbook.mockImplementation(() => mockOrderbook("0.1000000", "0.1010000"));

    const res = await request(app).get("/dex/arbitrage-opportunities");
    const { timestamp } = res.body.data;
    expect(typeof timestamp).toBe("string");
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  it("contains no snake_case field names", async () => {
    server.orderbook.mockImplementation(() => mockOrderbook("0.1000000", "0.1010000"));

    const res = await request(app).get("/dex/arbitrage-opportunities");
    const keys = [...collectKeys(res.body.data)];
    for (const key of keys) {
      expect(key).not.toMatch(/_/);
    }
  });

  it("skips pairs with empty order books", async () => {
    server.orderbook.mockImplementation(() => mockOrderbook(null, null));

    const res = await request(app).get("/dex/arbitrage-opportunities");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.opportunities).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("includes USDC as a sell asset when order book exists", async () => {
    server.orderbook.mockImplementation((selling) => {
      if (selling.getCode && selling.getCode() === "USDC") {
        return mockOrderbook("0.1000000", "0.1010000");
      }
      return mockOrderbook(null, null);
    });

    const res = await request(app).get("/dex/arbitrage-opportunities");
    expect(res.body.data.opportunities).toHaveLength(1);
    expect(res.body.data.opportunities[0].sellAsset).toEqual({
      code: "USDC",
      issuer: USDC_ISSUER,
      type: "credit_alphanum4",
    });
  });
});
