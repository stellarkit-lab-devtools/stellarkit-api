/**
 * tests/integration/dex.test.js
 *
 * Integration tests for DEX endpoints against the real Stellar Testnet.
 *
 * These tests require live network access to horizon-testnet.stellar.org and
 * are skipped automatically unless STELLAR_NETWORK=testnet is set in the
 * environment, making them safe to include in CI pipelines — just set the
 * variable to opt in.
 *
 * Baseline pair: XLM (native) / USDC on Testnet
 *   USDC issuer: GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 *
 * Usage:
 *   STELLAR_NETWORK=testnet npx jest tests/integration/dex.test.js
 *
 * All four DEX endpoints are covered:
 *   GET /dex/spread/:sellAsset/:buyAsset
 *   GET /dex/imbalance/:sellAsset/:buyAsset
 *   GET /dex/arbitrage/:assetCode/:assetIssuer
 *   GET /dex/top-markets
 */

"use strict";

const request = require("supertest");
const app = require("../../src/index");
const cacheService = require("../../src/services/cache");

// ── Skip guard ───────────────────────────────────────────────────────────────

/**
 * Wraps a describe block so that it is skipped unless STELLAR_NETWORK=testnet.
 * This prevents the tests from running in CI environments that have not opted
 * in, while still listing them as "skipped" rather than absent.
 */
function describeIfTestnet(name, fn) {
  if (process.env.STELLAR_NETWORK === "testnet") {
    describe(name, fn);
  } else {
    describe.skip(`${name} [skipped: STELLAR_NETWORK != testnet]`, fn);
  }
}

// ── Shared fixtures ──────────────────────────────────────────────────────────

// Testnet USDC issuer — the SDF-operated Circle USDC anchor on Testnet.
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// XLM/USDC is the highest-liquidity pair on Testnet and the canonical baseline
// for all four endpoint tests.
const XLM = "XLM:native";
const USDC = `USDC:${USDC_ISSUER}`;

// Testnet Horizon calls can be slow; 30 s gives ample headroom.
jest.setTimeout(30_000);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Asserts that a string looks like a 7-decimal-place Stellar amount.
 * e.g. "1234.5678900"
 */
function expectAmountString(value) {
  expect(typeof value).toBe("string");
  expect(value).toMatch(/^\d+\.\d{7}$/);
}

/**
 * Asserts that an asset object has the normalised shape used across this API.
 */
function expectNormalisedAsset(asset) {
  expect(asset).toHaveProperty("code");
  expect(asset).toHaveProperty("issuer");
  expect(asset).toHaveProperty("type");
  expect(typeof asset.code).toBe("string");
  expect(["native", "credit_alphanum4", "credit_alphanum12"]).toContain(asset.type);
  if (asset.type === "native") {
    expect(asset.code).toBe("XLM");
    expect(asset.issuer).toBeNull();
  } else {
    expect(typeof asset.issuer).toBe("string");
    expect(asset.issuer).toHaveLength(56);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describeIfTestnet("Integration — DEX endpoints (real Testnet)", () => {
  // Flush cache before each test so every assertion starts from a live
  // Horizon response rather than a cached result from a sibling test.
  beforeEach(() => {
    cacheService.flush();
  });

  // ── 1. /dex/spread ──────────────────────────────────────────────────────

  describe("GET /dex/spread/:sellAsset/:buyAsset", () => {
    it("returns 200 with normalised spread shape for XLM/USDC", async () => {
      const res = await request(app).get(`/dex/spread/${XLM}/${USDC}`);

      // The XLM/USDC order book may occasionally be empty on Testnet; both
      // outcomes are valid, but we assert the shape in each case.
      if (res.statusCode === 404) {
        expect(res.body.success).toBe(false);
        expect(res.body.error).toHaveProperty("type");
        return;
      }

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;

      // Top-level fields are always present
      expect(data).toHaveProperty("bestBid");
      expect(data).toHaveProperty("bestAsk");
      expect(data).toHaveProperty("spreadAbsolute");
      expect(data).toHaveProperty("spreadPercent");
      expect(data).toHaveProperty("midPrice");
      expect(data).toHaveProperty("liquidity");
      expect(data).toHaveProperty("orderBookDepth");
    });

    it("returns bid/ask prices as 7-decimal strings", async () => {
      const res = await request(app).get(`/dex/spread/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return; // skip if no order book on Testnet

      const { data } = res.body;

      if (data.bestBid) {
        expectAmountString(data.bestBid.price);
        expectAmountString(data.bestBid.amount);
      }
      if (data.bestAsk) {
        expectAmountString(data.bestAsk.price);
        expectAmountString(data.bestAsk.amount);
      }
      if (data.spreadAbsolute) {
        expectAmountString(data.spreadAbsolute);
      }
      if (data.midPrice) {
        expectAmountString(data.midPrice);
      }
    });

    it("returns spreadPercent as a 4-decimal string when both sides exist", async () => {
      const res = await request(app).get(`/dex/spread/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      const { data } = res.body;
      if (data.spreadPercent !== null) {
        expect(data.spreadPercent).toMatch(/^\d+\.\d{4}$/);
      }
    });

    it("returns a valid liquidity rating", async () => {
      const res = await request(app).get(`/dex/spread/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      expect(["high", "medium", "low"]).toContain(res.body.data.liquidity);
    });

    it("returns normalised orderBookDepth with numeric counts and amount strings", async () => {
      const res = await request(app).get(`/dex/spread/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      const depth = res.body.data.orderBookDepth;
      expect(depth).toHaveProperty("bids");
      expect(depth).toHaveProperty("asks");
      expect(depth).toHaveProperty("totalBidVolume");
      expect(depth).toHaveProperty("totalAskVolume");
      expect(depth).toHaveProperty("totalVolume");

      expect(typeof depth.bids).toBe("number");
      expect(typeof depth.asks).toBe("number");
      expectAmountString(depth.totalBidVolume);
      expectAmountString(depth.totalAskVolume);
      expectAmountString(depth.totalVolume);
    });

    it("liquidity rating is consistent with totalVolume thresholds", async () => {
      const res = await request(app).get(`/dex/spread/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      const { data } = res.body;
      const totalVolume = parseFloat(data.orderBookDepth.totalVolume);

      if (totalVolume >= 10_000) {
        expect(data.liquidity).toBe("high");
      } else if (totalVolume >= 1_000) {
        expect(data.liquidity).toBe("medium");
      } else {
        expect(data.liquidity).toBe("low");
      }
    });

    it("midPrice is the average of bestBid and bestAsk when both are present", async () => {
      const res = await request(app).get(`/dex/spread/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      const { data } = res.body;
      if (data.bestBid && data.bestAsk && data.midPrice) {
        const bid = parseFloat(data.bestBid.price);
        const ask = parseFloat(data.bestAsk.price);
        const mid = parseFloat(data.midPrice);
        expect(mid).toBeCloseTo((bid + ask) / 2, 5);
      }
    });

    it("spreadAbsolute equals ask minus bid price", async () => {
      const res = await request(app).get(`/dex/spread/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      const { data } = res.body;
      if (data.bestBid && data.bestAsk && data.spreadAbsolute) {
        const bid = parseFloat(data.bestBid.price);
        const ask = parseFloat(data.bestAsk.price);
        const spread = parseFloat(data.spreadAbsolute);
        expect(spread).toBeCloseTo(ask - bid, 5);
        expect(spread).toBeGreaterThanOrEqual(0);
      }
    });

    it("also works with the pair reversed (USDC/XLM)", async () => {
      const res = await request(app).get(`/dex/spread/${USDC}/${XLM}`);
      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("liquidity");
      }
    });
  });

  // ── 2. /dex/imbalance ───────────────────────────────────────────────────

  describe("GET /dex/imbalance/:sellAsset/:buyAsset", () => {
    it("returns 200 with normalised imbalance shape for XLM/USDC", async () => {
      const res = await request(app).get(`/dex/imbalance/${XLM}/${USDC}`);

      if (res.statusCode === 404) {
        expect(res.body.success).toBe(false);
        expect(res.body.error).toHaveProperty("type", "OrderBookEmpty");
        return;
      }

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toHaveProperty("bidVolume");
      expect(data).toHaveProperty("askVolume");
      expect(data).toHaveProperty("imbalanceRatio");
      expect(data).toHaveProperty("pressure");
      expect(data).toHaveProperty("signal");
    });

    it("returns bidVolume and askVolume as 7-decimal strings", async () => {
      const res = await request(app).get(`/dex/imbalance/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      const { data } = res.body;
      expectAmountString(data.bidVolume);
      expectAmountString(data.askVolume);
    });

    it("returns imbalanceRatio as a 4-decimal string", async () => {
      const res = await request(app).get(`/dex/imbalance/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      expect(res.body.data.imbalanceRatio).toMatch(/^\d+\.\d{4}$/);
    });

    it("pressure is one of: buy, sell, neutral", async () => {
      const res = await request(app).get(`/dex/imbalance/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      expect(["buy", "sell", "neutral"]).toContain(res.body.data.pressure);
    });

    it("signal is a non-empty string", async () => {
      const res = await request(app).get(`/dex/imbalance/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      expect(typeof res.body.data.signal).toBe("string");
      expect(res.body.data.signal.length).toBeGreaterThan(0);
    });

    it("pressure is consistent with imbalanceRatio thresholds", async () => {
      const res = await request(app).get(`/dex/imbalance/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      const { imbalanceRatio, pressure } = res.body.data;
      const ratio = parseFloat(imbalanceRatio);

      if (ratio > 1.25) {
        expect(pressure).toBe("buy");
      } else if (ratio < 0.75) {
        expect(pressure).toBe("sell");
      } else {
        expect(pressure).toBe("neutral");
      }
    });

    it("bidVolume and askVolume are non-negative", async () => {
      const res = await request(app).get(`/dex/imbalance/${XLM}/${USDC}`);
      if (res.statusCode !== 200) return;

      expect(parseFloat(res.body.data.bidVolume)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(res.body.data.askVolume)).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 3. /dex/arbitrage ───────────────────────────────────────────────────

  describe("GET /dex/arbitrage/:assetCode/:assetIssuer", () => {
    it("returns 200 with normalised arbitrage shape for XLM/native", async () => {
      const res = await request(app).get("/dex/arbitrage/XLM/native");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toHaveProperty("pathsFound");
      expect(data).toHaveProperty("paths");
      expect(typeof data.pathsFound).toBe("boolean");
      expect(Array.isArray(data.paths)).toBe(true);
    });

    it("pathsFound is true when paths array is non-empty", async () => {
      const res = await request(app).get("/dex/arbitrage/XLM/native");
      expect(res.statusCode).toBe(200);

      const { data } = res.body;
      expect(data.pathsFound).toBe(data.paths.length > 0);
    });

    it("each path entry has the normalised shape", async () => {
      const res = await request(app).get("/dex/arbitrage/XLM/native");
      expect(res.statusCode).toBe(200);

      res.body.data.paths.forEach((path) => {
        expect(path).toHaveProperty("sourceAmount");
        expect(path).toHaveProperty("destinationAmount");
        expect(path).toHaveProperty("path");
        expect(path).toHaveProperty("isProfitable");

        expect(typeof path.sourceAmount).toBe("string");
        expect(typeof path.destinationAmount).toBe("string");
        expect(Array.isArray(path.path)).toBe(true);
        expect(typeof path.isProfitable).toBe("boolean");
      });
    });

    it("isProfitable is true when sourceAmount < destinationAmount", async () => {
      const res = await request(app).get("/dex/arbitrage/XLM/native");
      expect(res.statusCode).toBe(200);

      res.body.data.paths.forEach((path) => {
        const src = parseFloat(path.sourceAmount);
        const dst = parseFloat(path.destinationAmount);
        expect(path.isProfitable).toBe(src < dst);
      });
    });

    it("each hop in a path has a normalised asset shape", async () => {
      const res = await request(app).get("/dex/arbitrage/XLM/native");
      expect(res.statusCode).toBe(200);

      res.body.data.paths.forEach((path) => {
        path.path.forEach((hop) => expectNormalisedAsset(hop));
      });
    });

    it("also works with USDC as the base asset", async () => {
      const res = await request(app).get(`/dex/arbitrage/USDC/${USDC_ISSUER}`);

      // Testnet may not always have circular paths for USDC; both outcomes valid
      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("pathsFound");
        expect(res.body.data).toHaveProperty("paths");
      }
    });

    it("sets X-Cache: MISS on first request after cache flush", async () => {
      const res = await request(app).get("/dex/arbitrage/XLM/native");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("sets X-Cache: HIT on a repeated request", async () => {
      await request(app).get("/dex/arbitrage/XLM/native");
      const res = await request(app).get("/dex/arbitrage/XLM/native");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("HIT");
    });

    it("?fresh=true bypasses the cache", async () => {
      // Warm the cache
      await request(app).get("/dex/arbitrage/XLM/native");
      // Force a live fetch
      const res = await request(app).get("/dex/arbitrage/XLM/native?fresh=true");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });

  // ── 4. /dex/top-markets ─────────────────────────────────────────────────

  describe("GET /dex/top-markets", () => {
    it("returns 200 with normalised top-markets shape", async () => {
      const res = await request(app).get("/dex/top-markets");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toHaveProperty("markets");
      expect(data).toHaveProperty("total");
      expect(Array.isArray(data.markets)).toBe(true);
      expect(typeof data.total).toBe("number");
      expect(data.total).toBe(data.markets.length);
    });

    it("each market entry has the normalised shape", async () => {
      const res = await request(app).get("/dex/top-markets");
      expect(res.statusCode).toBe(200);

      res.body.data.markets.forEach((market) => {
        // Asset objects
        expect(market).toHaveProperty("baseAsset");
        expect(market).toHaveProperty("counterAsset");
        expectNormalisedAsset(market.baseAsset);
        expectNormalisedAsset(market.counterAsset);

        // Volume fields
        expect(market).toHaveProperty("baseVolume");
        expect(market).toHaveProperty("counterVolume");
        expectAmountString(market.baseVolume);
        expectAmountString(market.counterVolume);

        // Trade count
        expect(market).toHaveProperty("tradeCount");
        expect(typeof market.tradeCount).toBe("number");
        expect(market.tradeCount).toBeGreaterThan(0);

        // Spread is null or a 7-decimal string
        expect(market).toHaveProperty("spread");
        if (market.spread !== null) {
          expectAmountString(market.spread);
        }
      });
    });

    it("returns at most 10 markets by default", async () => {
      const res = await request(app).get("/dex/top-markets");
      expect(res.statusCode).toBe(200);
      expect(res.body.data.markets.length).toBeLessThanOrEqual(10);
    });

    it("respects the limit query parameter", async () => {
      const res = await request(app).get("/dex/top-markets?limit=3");
      expect(res.statusCode).toBe(200);
      expect(res.body.data.markets.length).toBeLessThanOrEqual(3);
    });

    it("returns 400 for an invalid limit", async () => {
      const res = await request(app).get("/dex/top-markets?limit=0");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("markets are ordered by baseVolume descending", async () => {
      const res = await request(app).get("/dex/top-markets?limit=10");
      expect(res.statusCode).toBe(200);

      const volumes = res.body.data.markets.map((m) => parseFloat(m.baseVolume));
      for (let i = 1; i < volumes.length; i++) {
        expect(volumes[i]).toBeLessThanOrEqual(volumes[i - 1]);
      }
    });

    it("sets X-Cache: MISS on first request after cache flush", async () => {
      const res = await request(app).get("/dex/top-markets");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("sets X-Cache: HIT on a repeated request with same limit", async () => {
      await request(app).get("/dex/top-markets?limit=5");
      const res = await request(app).get("/dex/top-markets?limit=5");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("HIT");
    });

    it("cache keys are scoped per limit (different limit = MISS)", async () => {
      await request(app).get("/dex/top-markets?limit=5");
      // A different limit should miss the cache entry for limit=5
      const res = await request(app).get("/dex/top-markets?limit=7");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });
});
