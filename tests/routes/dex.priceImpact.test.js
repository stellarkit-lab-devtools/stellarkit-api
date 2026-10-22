/**
 * tests/routes/dex.priceImpact.test.js
 *
 * Unit tests for GET /dex/price-impact/:sellAsset/:buyAsset
 *
 *   1. Small trade on a deep order book returns low priceImpactPercent.
 *   2. Large trade on a thin order book returns high priceImpactPercent with a warning.
 *   3. Missing ?amount= param returns HTTP 400.
 *   4. Non-numeric amount returns HTTP 400.
 *   5. Empty order book returns OrderBookEmpty (HTTP 404).
 *
 * server.orderbook() is mocked with controlled depth data.
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../../src/services/cache");

const mockOrderBookCall = jest.fn();

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      orderbook: jest.fn(() => ({
        limit: jest.fn(() => ({
          call: mockOrderBookCall,
        })),
      })),
    },
  };
});

const app = require("../../src/index");

const ISSUER = Keypair.random().publicKey();
const SELL_ASSET = "XLM:native";
const BUY_ASSET = `USDC:${ISSUER}`;

function makeBid(price, amount) {
  return { price: String(price), amount: String(amount) };
}

/** 10 bid levels each offering 10,000 units — absorbs any reasonable trade at near-best price. */
function deepOrderBook() {
  const bids = [];
  for (let i = 0; i < 10; i++) {
    bids.push(makeBid((0.1000 - i * 0.0001).toFixed(7), "10000.0000000"));
  }
  return { bids, asks: [] };
}

/** 3 bid levels each offering only 1 unit at sharply decreasing prices. */
function thinOrderBook() {
  return {
    bids: [
      makeBid("0.1000000", "1.0000000"),
      makeBid("0.0500000", "1.0000000"),
      makeBid("0.0100000", "1.0000000"),
    ],
    asks: [],
  };
}

describe("GET /dex/price-impact/:sellAsset/:buyAsset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("small trade on a deep order book returns low priceImpactPercent", async () => {
    mockOrderBookCall.mockResolvedValue(deepOrderBook());

    const res = await request(app)
      .get(`/dex/price-impact/${SELL_ASSET}/${BUY_ASSET}?amount=1`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(parseFloat(res.body.data.priceImpactPercent)).toBeLessThan(1);
    expect(res.body.data.warning).toBeUndefined();
  });

  it("large trade on a thin order book returns high priceImpactPercent with a warning", async () => {
    mockOrderBookCall.mockResolvedValue(thinOrderBook());

    const res = await request(app)
      .get(`/dex/price-impact/${SELL_ASSET}/${BUY_ASSET}?amount=10`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(parseFloat(res.body.data.priceImpactPercent)).toBeGreaterThan(5);
    expect(res.body.data.warning).toBeDefined();
  });

  it("missing amount param returns 400", async () => {
    const res = await request(app)
      .get(`/dex/price-impact/${SELL_ASSET}/${BUY_ASSET}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockOrderBookCall).not.toHaveBeenCalled();
  });

  it("non-numeric amount returns 400", async () => {
    const res = await request(app)
      .get(`/dex/price-impact/${SELL_ASSET}/${BUY_ASSET}?amount=abc`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockOrderBookCall).not.toHaveBeenCalled();
  });

  it("empty order book returns OrderBookEmpty", async () => {
    mockOrderBookCall.mockResolvedValue({ bids: [], asks: [] });

    const res = await request(app)
      .get(`/dex/price-impact/${SELL_ASSET}/${BUY_ASSET}?amount=100`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
  });
});
