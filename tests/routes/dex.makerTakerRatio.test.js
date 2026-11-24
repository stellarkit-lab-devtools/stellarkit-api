const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../../src/services/cache");

const ISSUER = Keypair.random().publicKey();
const mockTradesCall = jest.fn();
const mockForAssetPair = jest.fn(() => ({
  order: jest.fn(() => ({
    limit: jest.fn(() => ({ call: mockTradesCall })),
  })),
}));

jest.mock("../../src/config/stellar", () => ({
  server: {
    trades: jest.fn(() => ({ forAssetPair: mockForAssetPair })),
  },
  horizonUrl: "https://horizon-testnet.stellar.org",
  NETWORK: "testnet",
  NETWORKS: {
    testnet: "https://horizon-testnet.stellar.org",
    mainnet: "https://horizon.stellar.org",
  },
}));

const app = require("../../src/index");
const BASE_ASSET = "XLM:native";
const COUNTER_ASSET = `USDC:${ISSUER}`;
const endpoint = `/dex/maker-taker-ratio/${BASE_ASSET}/${COUNTER_ASSET}`;

function makeTrade({ daysAgo = 1, baseAmount = "10.0000000", baseIsSeller }) {
  return {
    ledger_close_time: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    base_amount: baseAmount,
    base_is_seller: baseIsSeller,
  };
}

describe("GET /dex/maker-taker-ratio/:baseAsset/:counterAsset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("aggregates recent trades and returns percentages summing to 100", async () => {
    mockTradesCall.mockResolvedValue({
      records: [
        makeTrade({ baseAmount: "10.0000000", baseIsSeller: true }),
        makeTrade({ baseAmount: "5.2500000", baseIsSeller: false }),
      ],
    });

    const res = await request(app).get(endpoint);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      pair: `${BASE_ASSET}/${COUNTER_ASSET}`,
      makerPercent: 50,
      takerPercent: 50,
      totalTrades: 2,
      totalVolume: "15.2500000",
    });
    expect(res.body.data.makerPercent + res.body.data.takerPercent).toBe(100);
    expect(res.body.data.period.days).toBe(7);
    expect(mockForAssetPair).toHaveBeenCalledWith(
      expect.objectContaining({ code: "XLM" }),
      expect.objectContaining({ code: "USDC" }),
    );
  });

  it("caps the requested period at 30 days and excludes older trades", async () => {
    mockTradesCall.mockResolvedValue({
      records: [
        makeTrade({ daysAgo: 10, baseIsSeller: true }),
        makeTrade({ daysAgo: 31, baseIsSeller: false }),
      ],
    });

    const res = await request(app).get(`${endpoint}?days=90`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.period.days).toBe(30);
    expect(res.body.data.totalTrades).toBe(1);
    expect(res.body.data.totalVolume).toBe("10.0000000");
  });

  it("returns OrderBookEmpty when no trade history exists", async () => {
    mockTradesCall.mockResolvedValue({ records: [] });

    const res = await request(app).get(endpoint);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
  });
});