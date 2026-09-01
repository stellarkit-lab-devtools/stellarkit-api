const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const mockTradesCall = jest.fn();
const ISSUER = Keypair.random().publicKey();

jest.mock("../src/config/stellar", () => ({
  server: {
    trades: jest.fn(() => ({
      forAssetPair: jest.fn(() => ({
        order: jest.fn(() => ({
          limit: jest.fn(() => ({
            call: mockTradesCall,
          })),
        })),
      })),
    })),
  },
  horizonUrl: "https://horizon-testnet.stellar.org",
  NETWORK: "testnet",
  NETWORKS: {
    testnet: "https://horizon-testnet.stellar.org",
    mainnet: "https://horizon.stellar.org",
  },
}));

const app = require("../src/index");
const cacheService = require("../src/services/cache");

const SELL_ASSET = "XLM:native";
const BUY_ASSET = `USDC:${ISSUER}`;

function makeTrade({ time, baseAmount, counterAmount, priceN, priceD }) {
  return {
    ledger_close_time: time,
    base_amount: baseAmount,
    counter_amount: counterAmount,
    price: { n: priceN, d: priceD },
  };
}

describe("GET /dex/price-history/:sellAsset/:buyAsset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns price time series with default 24h resolution", async () => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

    mockTradesCall.mockResolvedValue({
      records: [
        makeTrade({
          time: oneHourAgo,
          baseAmount: "10.0000000",
          counterAmount: "2.5000000",
          priceN: 1,
          priceD: 4,
        }),
        makeTrade({
          time: oneHourAgo,
          baseAmount: "5.0000000",
          counterAmount: "1.2500000",
          priceN: 1,
          priceD: 4,
        }),
      ],
    });

    const res = await request(app).get(
      `/dex/price-history/${SELL_ASSET}/${BUY_ASSET}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.resolution).toBe("24h");
    expect(res.body.data.pair).toBe(`${SELL_ASSET}/${BUY_ASSET}`);
    expect(res.body.data.prices).toHaveLength(1);
    expect(res.body.data.prices[0]).toMatchObject({
      price: "0.2500000",
      baseVolume: "15.0000000",
      counterVolume: "3.7500000",
    });
    expect(res.body.data.prices[0].timestamp).toBeDefined();
  });

  it("accepts 1h and 7d resolution values", async () => {
    mockTradesCall.mockResolvedValue({ records: [] });

    const res1h = await request(app).get(
      `/dex/price-history/${SELL_ASSET}/${BUY_ASSET}?resolution=1h`,
    );
    const res7d = await request(app).get(
      `/dex/price-history/${SELL_ASSET}/${BUY_ASSET}?resolution=7d`,
    );

    expect(res1h.statusCode).toBe(200);
    expect(res1h.body.data.resolution).toBe("1h");
    expect(res7d.statusCode).toBe(200);
    expect(res7d.body.data.resolution).toBe("7d");
  });

  it("returns 400 for invalid resolution", async () => {
    const res = await request(app).get(
      `/dex/price-history/${SELL_ASSET}/${BUY_ASSET}?resolution=30d`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toContain("Invalid resolution");
    expect(mockTradesCall).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid asset format", async () => {
    const res = await request(app).get(
      `/dex/price-history/INVALID/${BUY_ASSET}`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("excludes trades outside the resolution window", async () => {
    const oldTradeTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recentTradeTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    mockTradesCall.mockResolvedValue({
      records: [
        makeTrade({
          time: oldTradeTime,
          baseAmount: "100.0000000",
          counterAmount: "25.0000000",
          priceN: 1,
          priceD: 4,
        }),
        makeTrade({
          time: recentTradeTime,
          baseAmount: "2.0000000",
          counterAmount: "0.5000000",
          priceN: 1,
          priceD: 4,
        }),
      ],
    });

    const res = await request(app).get(
      `/dex/price-history/${SELL_ASSET}/${BUY_ASSET}?resolution=24h`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.prices).toHaveLength(1);
    expect(res.body.data.prices[0].baseVolume).toBe("2.0000000");
  });
});
