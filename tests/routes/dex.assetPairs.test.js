/**
 * tests/routes/dex.assetPairs.test.js
 *
 * Unit tests for GET /dex/asset-pairs
 *
 *   1. Default response returns up to 20 pairs.
 *   2. ?limit=5 returns exactly 5 pairs.
 *   3. ?limit=101 returns HTTP 400.
 *   4. ?baseAsset=XLM returns only pairs where XLM is the base asset.
 *   5. Each pair has baseAsset, counterAsset, tradeCount24h and volume24h.
 *
 * server.trades() is mocked with controlled trade history.
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../../src/services/cache");

const mockTradesCall = jest.fn();

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      trades: jest.fn(() => ({
        order: jest.fn(() => ({
          limit: jest.fn(() => ({
            call: mockTradesCall,
          })),
        })),
      })),
    },
  };
});

const app = require("../../src/index");

const ISSUER = Keypair.random().publicKey();

function trade({ baseCode, counterCode, baseAmount = "10.0000000", hoursAgo = 1 }) {
  const side = (code) =>
    code === "XLM"
      ? { type: "native", code: undefined, issuer: undefined }
      : { type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12", code, issuer: ISSUER };
  const base = side(baseCode);
  const counter = side(counterCode);
  return {
    ledger_close_time: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
    base_asset_type: base.type,
    base_asset_code: base.code,
    base_asset_issuer: base.issuer,
    counter_asset_type: counter.type,
    counter_asset_code: counter.code,
    counter_asset_issuer: counter.issuer,
    base_amount: baseAmount,
    counter_amount: "1.0000000",
    price: { n: 1, d: 10 },
  };
}

/** 15 XLM-based pairs + 15 non-XLM-based pairs = 30 distinct pairs. */
function manyPairs() {
  const records = [];
  for (let i = 0; i < 15; i++) {
    records.push(trade({ baseCode: "XLM", counterCode: `XA${i}` }));
    records.push(trade({ baseCode: "USDC", counterCode: `UA${i}` }));
  }
  return records;
}

describe("GET /dex/asset-pairs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns up to 20 pairs by default", async () => {
    mockTradesCall.mockResolvedValue({ records: manyPairs() });

    const res = await request(app).get("/dex/asset-pairs");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pairs).toHaveLength(20);
    expect(res.body.data.limit).toBe(20);
  });

  it("?limit=5 returns exactly 5 pairs", async () => {
    mockTradesCall.mockResolvedValue({ records: manyPairs() });

    const res = await request(app).get("/dex/asset-pairs?limit=5");

    expect(res.status).toBe(200);
    expect(res.body.data.pairs).toHaveLength(5);
  });

  it("?limit=101 returns 400", async () => {
    mockTradesCall.mockResolvedValue({ records: manyPairs() });

    const res = await request(app).get("/dex/asset-pairs?limit=101");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockTradesCall).not.toHaveBeenCalled();
  });

  it("?baseAsset=XLM returns only pairs where XLM is the base asset", async () => {
    mockTradesCall.mockResolvedValue({ records: manyPairs() });

    const res = await request(app).get("/dex/asset-pairs?baseAsset=XLM");

    expect(res.status).toBe(200);
    const { pairs } = res.body.data;
    expect(pairs).toHaveLength(15);
    for (const p of pairs) {
      expect(p.baseAsset).toEqual({ code: "XLM", issuer: null, type: "native" });
    }
  });

  it("each pair has baseAsset, counterAsset, tradeCount24h and volume24h", async () => {
    mockTradesCall.mockResolvedValue({
      records: [
        trade({ baseCode: "XLM", counterCode: "USDC", baseAmount: "10.0000000" }),
        trade({ baseCode: "XLM", counterCode: "USDC", baseAmount: "5.5000000" }),
        trade({ baseCode: "USDC", counterCode: "EURT", baseAmount: "2.0000000" }),
        // Outside the 24h window — must be ignored
        trade({ baseCode: "XLM", counterCode: "USDC", baseAmount: "999.0000000", hoursAgo: 30 }),
      ],
    });

    const res = await request(app).get("/dex/asset-pairs");

    expect(res.status).toBe(200);
    const { pairs } = res.body.data;
    expect(pairs).toHaveLength(2);

    for (const p of pairs) {
      expect(p).toHaveProperty("baseAsset");
      expect(p).toHaveProperty("counterAsset");
      expect(p).toHaveProperty("tradeCount24h");
      expect(p).toHaveProperty("volume24h");
      expect(typeof p.tradeCount24h).toBe("number");
      expect(p.volume24h).toMatch(/^\d+\.\d{7}$/);
    }

    const xlmUsdc = pairs[0];
    expect(xlmUsdc.baseAsset.code).toBe("XLM");
    expect(xlmUsdc.counterAsset).toEqual({ code: "USDC", issuer: ISSUER, type: "credit_alphanum4" });
    expect(xlmUsdc.tradeCount24h).toBe(2);
    expect(xlmUsdc.volume24h).toBe("15.5000000");
  });
});
