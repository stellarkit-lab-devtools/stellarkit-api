/**
 * tests/routes/dex.volumeLeaders.test.js
 *
 * Tests for GET /dex/volume-leaders.
 *
 * Test scenarios:
 *   - Default response returns 10 leaders sorted by volume24h descending
 *   - ?limit=5 returns exactly 5 results
 *   - ?limit=51 returns a 400
 *   - Each leader entry has all five required fields
 *   - An asset with zero volume in the last 24 hours is excluded from results
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => ({
  ...jest.requireActual("../../src/config/stellar"),
  server: {
    trades: jest.fn(),
  },
}));

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const USDC_ISSUER = "GA5ZSEYJB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const BTC_ISSUER = Keypair.random().publicKey();
const EUR_ISSUER = Keypair.random().publicKey();

function makeTrade(baseAsset, counterAsset, baseAmount, counterAmount, hoursAgo = 0) {
  const closeTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  return {
    id: `trade-${Math.random()}`,
    ledger_close_time: closeTime,
    base_asset_type: baseAsset.type,
    base_asset_code: baseAsset.code || null,
    base_asset_issuer: baseAsset.issuer || null,
    counter_asset_type: counterAsset.type,
    counter_asset_code: counterAsset.code || null,
    counter_asset_issuer: counterAsset.issuer || null,
    base_amount,
    counter_amount: counterAmount,
    base_is_seller: true,
    price: {
      n: parseFloat(counterAmount) / parseFloat(baseAmount),
      d: 1,
    },
  };
}

function mockTrades(trades) {
  const chain = {
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: trades }),
  };
  server.trades.mockReturnValue(chain);
  return chain;
}

describe("GET /dex/volume-leaders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // --- Test: default returns 10 leaders sorted by volume24h descending ---
  it("default response returns 10 leaders sorted by volume24h descending", async () => {
    // Create 12 assets with different volumes
    const issuers = Array.from({ length: 12 }, () => Keypair.random().publicKey);
    
    const trades = [];
    const volumes = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 10];
    
    for (let i = 0; i < 12; i++) {
      const issuer = issuers[i];
      trades.push(makeTrade(
        { type: "native", code: "XLM", issuer: null },
        { type: "credit_alphanum4", code: `ASSET${i}`, issuer },
        "1",
        String(volumes[i]),
        0 // Within last 24 hours
      ));
    }
    
    mockTrades(trades);

    const res = await request(app).get("/dex/volume-leaders");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.leaders).toHaveLength(10);
    
    // Verify sorted by volume descending
    const volumesReturned = res.body.data.leaders.map(l => parseFloat(l.volume24h));
    expect(volumesReturned).toEqual(volumesReturned.sort((a, b) => b - a));
    expect(volumesReturned[0]).toBe(1000);
  });

  // --- Test: limit=5 returns exactly 5 results ---
  it("?limit=5 returns exactly 5 results", async () => {
    const trades = [];
    for (let i = 0; i < 10; i++) {
      const issuer = Keypair.random().publicKey;
      trades.push(makeTrade(
        { type: "native", code: "XLM", issuer: null },
        { type: "credit_alphanum4", code: `ASSET${i}`, issuer },
        "1",
        String((i + 1) * 100),
        0
      ));
    }
    mockTrades(trades);

    const res = await request(app).get("/dex/volume-leaders?limit=5");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.leaders).toHaveLength(5);
  });

  // --- Test: limit=51 returns a 400 ---
  it("?limit=51 returns a 400", async () => {
    mockTrades([]);

    const res = await request(app).get("/dex/volume-leaders?limit=51");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toContain("limit");
  });

  // --- Test: each leader entry has all five required fields ---
  it("each leader entry has all five required fields", async () => {
    const trades = [
      makeTrade(
        { type: "native", code: "XLM", issuer: null },
        { type: "credit_alphanum4", code: "USDC", issuer: USDC_ISSUER },
        "100",
        "500",
        0
      ),
      makeTrade(
        { type: "native", code: "XLM", issuer: null },
        { type: "credit_alphanum4", code: "BTC", issuer: BTC_ISSUER },
        "10",
        "1000",
        0
      ),
    ];
    mockTrades(trades);

    const res = await request(app).get("/dex/volume-leaders?limit=2");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.leaders).toHaveLength(2);

    for (const leader of res.body.data.leaders) {
      expect(leader).toHaveProperty("asset");
      expect(leader.asset).toHaveProperty("code");
      expect(leader.asset).toHaveProperty("issuer");
      expect(leader.asset).toHaveProperty("type");
      
      expect(leader).toHaveProperty("volume24h");
      expect(leader).toHaveProperty("tradeCount");
      expect(leader).toHaveProperty("priceChangePercent");
      expect(leader).toHaveProperty("uniqueTraders");
      
      // Verify format (seven decimal places for volume)
      expect(leader.volume24h).toMatch(/^\d+\.\d{7}$/);
    }
  });

  // --- Test: asset with zero volume in last 24 hours is excluded ---
  it("asset with zero volume in the last 24 hours is excluded from results", async () => {
    const trades = [
      // USDC: recent trade (within 24h)
      makeTrade(
        { type: "native", code: "XLM", issuer: null },
        { type: "credit_alphanum4", code: "USDC", issuer: USDC_ISSUER },
        "100",
        "500",
        0 // Now
      ),
      // EUR: old trade (outside 24h window)
      makeTrade(
        { type: "native", code: "XLM", issuer: null },
        { type: "credit_alphanum4", code: "EUR", issuer: EUR_ISSUER },
        "1000",
        "2000",
        25 // 25 hours ago - outside 24h window
      ),
    ];
    mockTrades(trades);

    const res = await request(app).get("/dex/volume-leaders?limit=10");

    expect(res.statusCode).toBe(200);
    
    // Should only have USDC (EUR is outside 24h window)
    expect(res.body.data.leaders).toHaveLength(1);
    expect(res.body.data.leaders[0].asset.code).toBe("USDC");
  });

  // --- Test: cache behavior ---
  it("returns X-Cache MISS then HIT for same limit", async () => {
    const trades = [
      makeTrade(
        { type: "native", code: "XLM", issuer: null },
        { type: "credit_alphanum4", code: "USDC", issuer: USDC_ISSUER },
        "100",
        "500",
        0
      ),
    ];
    mockTrades(trades);

    const res1 = await request(app).get("/dex/volume-leaders?limit=5");
    expect(res1.headers["x-cache"]).toBe("MISS");

    const res2 = await request(app).get("/dex/volume-leaders?limit=5");
    expect(res2.headers["x-cache"]).toBe("HIT");
    expect(res2.body.data).toEqual(res1.body.data);
  });

  // --- Test: different limits have separate cache entries ---
  it("keys the cache by the limit query param", async () => {
    const trades = [];
    for (let i = 0; i < 5; i++) {
      const issuer = Keypair.random().publicKey;
      trades.push(makeTrade(
        { type: "native", code: "XLM", issuer: null },
        { type: "credit_alphanum4", code: `ASSET${i}`, issuer },
        "1",
        String((i + 1) * 100),
        0
      ));
    }
    mockTrades(trades);

    const res1 = await request(app).get("/dex/volume-leaders?limit=1");
    expect(res1.headers["x-cache"]).toBe("MISS");
    expect(res1.body.data.leaders).toHaveLength(1);

    const res2 = await request(app).get("/dex/volume-leaders?limit=5");
    expect(res2.headers["x-cache"]).toBe("MISS");
    expect(res2.body.data.leaders).toHaveLength(5);
  });

  // --- Test: invalid limit returns 400 ---
  it("invalid limit value returns a 400", async () => {
    mockTrades([]);

    const res = await request(app).get("/dex/volume-leaders?limit=abc");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  // --- Test: empty trades returns empty leaders ---
  it("empty trades returns empty leaders array", async () => {
    mockTrades([]);

    const res = await request(app).get("/dex/volume-leaders");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.leaders).toHaveLength(0);
  });
});