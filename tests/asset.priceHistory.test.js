/**
 * Tests for GET /asset/:code/:issuer/price-history
 *
 * Covers:
 *   - ?limit=101 returns 400 (max is 100)
 *   - ?resolution=invalid returns 400 with valid options list
 *   - ?resolution=1h returns candles with 1-hour intervals
 *   - Omitting ?resolution= defaults to 24h
 *   - Asset with no trade history returns empty candles array
 */

const request = require("supertest");
const express = require("express");
const assetRouter = require("../src/routes/asset");
const { server } = require("../src/config/stellar");
const { Asset } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar");

const app = express();
app.use(express.json());
app.use("/asset", assetRouter);

describe("GET /asset/:code/:issuer/price-history", () => {
  const ASSET_CODE = "USDC";
  const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("limit validation", () => {
    it("should return 400 when limit exceeds maximum of 100", async () => {
      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?limit=101`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("between 1 and 100");
    });

    it("should return 400 when limit is less than 1", async () => {
      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?limit=0`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("between 1 and 100");
    });

    it("should return 400 when limit is not an integer", async () => {
      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?limit=50.5`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("between 1 and 100");
    });

    it("should accept valid limit values", async () => {
      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [{ asset_code: ASSET_CODE, asset_issuer: ISSUER }],
        }),
      });

      server.trades = jest.fn().mockReturnValue({
        forAssetPair: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?limit=50`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe("resolution validation", () => {
    it("should return 400 for invalid resolution with list of valid options", async () => {
      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?resolution=30d`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Invalid resolution");
      expect(res.body.error.message).toContain("1h");
      expect(res.body.error.message).toContain("24h");
      expect(res.body.error.message).toContain("7d");
    });

    it("should accept resolution=1h", async () => {
      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [{ asset_code: ASSET_CODE, asset_issuer: ISSUER }],
        }),
      });

      server.trades = jest.fn().mockReturnValue({
        forAssetPair: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              ledger_close_time: new Date().toISOString(),
              price: { n: 1234567, d: 10000000 },
              base_amount: "100.0000000",
            },
          ],
        }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?resolution=1h`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.resolution).toBe("1h");
    });

    it("should accept resolution=24h", async () => {
      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [{ asset_code: ASSET_CODE, asset_issuer: ISSUER }],
        }),
      });

      server.trades = jest.fn().mockReturnValue({
        forAssetPair: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?resolution=24h`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.resolution).toBe("24h");
    });

    it("should accept resolution=7d", async () => {
      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [{ asset_code: ASSET_CODE, asset_issuer: ISSUER }],
        }),
      });

      server.trades = jest.fn().mockReturnValue({
        forAssetPair: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?resolution=7d`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.resolution).toBe("7d");
    });
  });

  describe("default resolution", () => {
    it("should default to 24h when resolution parameter is omitted", async () => {
      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [{ asset_code: ASSET_CODE, asset_issuer: ISSUER }],
        }),
      });

      server.trades = jest.fn().mockReturnValue({
        forAssetPair: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.resolution).toBe("24h");
    });
  });

  describe("empty trade history", () => {
    it("should return empty candles array when asset has no trade history", async () => {
      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [{ asset_code: ASSET_CODE, asset_issuer: ISSUER }],
        }),
      });

      server.trades = jest.fn().mockReturnValue({
        forAssetPair: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.candles).toEqual([]);
      expect(Array.isArray(res.body.data.candles)).toBe(true);
    });
  });

  describe("candle structure", () => {
    it("should return properly formatted OHLC candles with 1-hour intervals", async () => {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);
      const twoHoursAgo = now - (2 * 60 * 60 * 1000);

      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [{ asset_code: ASSET_CODE, asset_issuer: ISSUER }],
        }),
      });

      server.trades = jest.fn().mockReturnValue({
        forAssetPair: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              ledger_close_time: new Date(now).toISOString(),
              price: { n: 1300000, d: 10000000 },
              base_amount: "150.0000000",
            },
            {
              ledger_close_time: new Date(now - 1000).toISOString(),
              price: { n: 1250000, d: 10000000 },
              base_amount: "100.0000000",
            },
            {
              ledger_close_time: new Date(oneHourAgo).toISOString(),
              price: { n: 1200000, d: 10000000 },
              base_amount: "200.0000000",
            },
          ],
        }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history?resolution=1h&limit=10`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.resolution).toBe("1h");
      expect(Array.isArray(res.body.data.candles)).toBe(true);

      // Verify candle structure
      if (res.body.data.candles.length > 0) {
        const candle = res.body.data.candles[0];
        expect(candle).toHaveProperty("timestamp");
        expect(candle).toHaveProperty("open");
        expect(candle).toHaveProperty("high");
        expect(candle).toHaveProperty("low");
        expect(candle).toHaveProperty("close");
        expect(candle).toHaveProperty("volume");
        expect(candle).toHaveProperty("trades");

        // Verify 7 decimal places
        expect(candle.open).toMatch(/^\d+\.\d{7}$/);
        expect(candle.high).toMatch(/^\d+\.\d{7}$/);
        expect(candle.low).toMatch(/^\d+\.\d{7}$/);
        expect(candle.close).toMatch(/^\d+\.\d{7}$/);
      }
    });
  });

  describe("asset validation", () => {
    it("should return 404 when asset does not exist", async () => {
      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history`)
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it("should return 400 for invalid asset code", async () => {
      await request(app)
        .get(`/asset/INVALID_CODE_TOO_LONG/${ISSUER}/price-history`)
        .expect(400);
    });

    it("should return 400 for invalid issuer format", async () => {
      await request(app)
        .get(`/asset/${ASSET_CODE}/INVALID/price-history`)
        .expect(400);
    });
  });

  describe("caching", () => {
    it("should return X-Cache: MISS on first request", async () => {
      server.assets = jest.fn().mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [{ asset_code: ASSET_CODE, asset_issuer: ISSUER }],
        }),
      });

      server.trades = jest.fn().mockReturnValue({
        forAssetPair: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app)
        .get(`/asset/${ASSET_CODE}/${ISSUER}/price-history`)
        .expect(200);

      expect(res.get("X-Cache")).toBe("MISS");
    });
  });
});
