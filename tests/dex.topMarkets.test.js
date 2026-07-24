const { Keypair } = require("@stellar/stellar-sdk");

// Test-only issuer keypairs (random, not real mainnet assets) configured via
// DEX_TOP_MARKETS so the ranking/limit tests have more than one market to work with.
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const AQUA_ISSUER = Keypair.random().publicKey();
const YXLM_ISSUER = Keypair.random().publicKey();
const SHX_ISSUER = Keypair.random().publicKey();
process.env.DEX_TOP_MARKETS = `USDC:${USDC_ISSUER},AQUA:${AQUA_ISSUER},yXLM:${YXLM_ISSUER},SHX:${SHX_ISSUER}`;

const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      tradeAggregation: jest.fn(),
    },
  };
});

function mockAggregationFor(volumesByCode) {
  server.tradeAggregation.mockImplementation((base, counter) => {
    const record = volumesByCode[counter.getCode()];
    return {
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: record ? [record] : [] }),
    };
  });
}

describe("GET /dex/top-markets", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns markets in the normalised StellarKit shape", async () => {
    mockAggregationFor({
      USDC: {
        trade_count: 42,
        base_volume: "1234.5",
        counter_volume: "567.891",
        open: "0.09",
        high: "0.095",
        low: "0.085",
        close: "0.091",
      },
    });

    const res = await request(app).get("/dex/top-markets?limit=1");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("items");
    expect(res.body.data).toHaveProperty("total");

    const market = res.body.data.items[0];

    expect(market.baseAsset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(market.counterAsset).toEqual({
      code: "USDC",
      issuer: USDC_ISSUER,
      type: "credit_alphanum4",
    });

    expect(market.baseVolume).toBe("1234.5000000");
    expect(market.counterVolume).toBe("567.8910000");
    expect(market.baseVolume).toMatch(/^\d+\.\d{7}$/);
    expect(market.counterVolume).toMatch(/^\d+\.\d{7}$/);
    expect(market.tradeCount).toBe(42);
  });

  it("contains no snake_case field names", async () => {
    mockAggregationFor({
      USDC: {
        trade_count: 5,
        base_volume: "10",
        counter_volume: "1",
        open: "0.1",
        high: "0.1",
        low: "0.1",
        close: "0.1",
      },
    });

    const res = await request(app).get("/dex/top-markets?limit=1");
    const market = res.body.data.items[0];

    const checkNoSnakeCase = (obj) => {
      Object.keys(obj).forEach((key) => {
        expect(key).not.toMatch(/_/);
        if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
          checkNoSnakeCase(obj[key]);
        }
      });
    };

    checkNoSnakeCase(market);
    expect(market).not.toHaveProperty("base_volume");
    expect(market).not.toHaveProperty("counter_volume");
    expect(market).not.toHaveProperty("trade_count");
  });

  it("ranks markets by base volume descending and respects limit", async () => {
    mockAggregationFor({
      USDC: { trade_count: 1, base_volume: "500", counter_volume: "50", open: "0.1", high: "0.1", low: "0.1", close: "0.1" },
      AQUA: { trade_count: 1, base_volume: "2000", counter_volume: "20", open: "0.01", high: "0.01", low: "0.01", close: "0.01" },
      yXLM: { trade_count: 1, base_volume: "10", counter_volume: "10", open: "1", high: "1", low: "1", close: "1" },
      SHX: { trade_count: 1, base_volume: "1000", counter_volume: "100", open: "0.1", high: "0.1", low: "0.1", close: "0.1" },
    });

    const res = await request(app).get("/dex/top-markets?limit=2");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items[0].counterAsset.code).toBe("AQUA");
    expect(res.body.data.items[1].counterAsset.code).toBe("SHX");
  });

  it("treats markets with no recent trades as zero volume rather than failing", async () => {
    mockAggregationFor({});

    const res = await request(app).get("/dex/top-markets?limit=1");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items[0].baseVolume).toBe("0.0000000");
    expect(res.body.data.items[0].tradeCount).toBe(0);
  });

  it("returns X-Cache MISS then HIT, and bypasses with fresh=true", async () => {
    mockAggregationFor({
      USDC: { trade_count: 1, base_volume: "100", counter_volume: "10", open: "0.1", high: "0.1", low: "0.1", close: "0.1" },
    });

    const res1 = await request(app).get("/dex/top-markets?limit=1");
    expect(res1.headers["x-cache"]).toBe("MISS");

    const res2 = await request(app).get("/dex/top-markets?limit=1");
    expect(res2.headers["x-cache"]).toBe("HIT");
    expect(res2.body.data).toEqual(res1.body.data);

    const res3 = await request(app).get("/dex/top-markets?limit=1&fresh=true");
    expect(res3.headers["x-cache"]).toBe("MISS");
  });

  it("keys the cache by the limit query param", async () => {
    mockAggregationFor({
      USDC: { trade_count: 1, base_volume: "100", counter_volume: "10", open: "0.1", high: "0.1", low: "0.1", close: "0.1" },
      AQUA: { trade_count: 1, base_volume: "50", counter_volume: "5", open: "0.1", high: "0.1", low: "0.1", close: "0.1" },
    });

    const res1 = await request(app).get("/dex/top-markets?limit=1");
    expect(res1.headers["x-cache"]).toBe("MISS");
    expect(res1.body.data.items).toHaveLength(1);

    const res2 = await request(app).get("/dex/top-markets?limit=2");
    expect(res2.headers["x-cache"]).toBe("MISS");
    expect(res2.body.data.items).toHaveLength(2);
  });
});
