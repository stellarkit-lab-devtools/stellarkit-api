/**
 * Tests for GET /dex/market-summary/:baseAsset/:counterAsset
 *
 * Verifies:
 *   1. open is the price of the first (oldest) trade in the 24h window.
 *   2. close is the most recent trade price.
 *   3. high and low are correctly identified across all trades.
 *   4. priceChangePercent24h is computed correctly.
 *   5. A pair with no trades returns an OrderBookEmpty error.
 *
 * All Stellar SDK calls are mocked; no real network requests are made.
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../../src/services/cache");

const ISSUER = Keypair.random().publicKey();
const mockTradesCall = jest.fn();

jest.mock("../../src/config/stellar", () => ({
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

const app = require("../../src/index");

const BASE_ASSET    = "XLM:native";
const COUNTER_ASSET = `USDC:${ISSUER}`;

/**
 * Builds a minimal trade record with a timestamp relative to now.
 * priceN / priceD give the exact price fraction (price = priceN / priceD).
 */
function makeTrade({ hoursAgo, priceN, priceD, baseAmount = "10.0000000" }) {
  const ledger_close_time = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  const counterAmount = ((priceN / priceD) * parseFloat(baseAmount)).toFixed(7);
  return {
    ledger_close_time,
    base_amount: baseAmount,
    counter_amount: counterAmount,
    price: { n: priceN, d: priceD },
  };
}

describe("GET /dex/market-summary/:baseAsset/:counterAsset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("open equals the price of the oldest trade in the 24h window", async () => {
    // desc order: [newest (1 h ago, price 2), oldest (5 h ago, price 1)]
    // open = oldest trade price = 1
    mockTradesCall.mockResolvedValue({
      records: [
        makeTrade({ hoursAgo: 1, priceN: 2, priceD: 1 }),
        makeTrade({ hoursAgo: 5, priceN: 1, priceD: 1 }),
      ],
    });

    const res = await request(app).get(
      `/dex/market-summary/${BASE_ASSET}/${COUNTER_ASSET}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.open).toBe("1.0000000");
  });

  it("close equals the most recent (newest) trade price", async () => {
    // desc order: newest first → close = price of records[0]
    mockTradesCall.mockResolvedValue({
      records: [
        makeTrade({ hoursAgo: 1, priceN: 3, priceD: 1 }),
        makeTrade({ hoursAgo: 5, priceN: 1, priceD: 1 }),
      ],
    });

    const res = await request(app).get(
      `/dex/market-summary/${BASE_ASSET}/${COUNTER_ASSET}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.close).toBe("3.0000000");
  });

  it("high and low are correctly identified across all trades in the window", async () => {
    mockTradesCall.mockResolvedValue({
      records: [
        makeTrade({ hoursAgo: 1, priceN: 3, priceD: 1 }),
        makeTrade({ hoursAgo: 3, priceN: 5, priceD: 1 }),  // high
        makeTrade({ hoursAgo: 5, priceN: 2, priceD: 1 }),  // low / open
      ],
    });

    const res = await request(app).get(
      `/dex/market-summary/${BASE_ASSET}/${COUNTER_ASSET}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.high).toBe("5.0000000");
    expect(res.body.data.low).toBe("2.0000000");
  });

  it("priceChangePercent24h is computed as (close - open) / open * 100", async () => {
    // open = 2, close = 3 → (3 - 2) / 2 * 100 = 50 %
    mockTradesCall.mockResolvedValue({
      records: [
        makeTrade({ hoursAgo: 1, priceN: 3, priceD: 1 }),
        makeTrade({ hoursAgo: 5, priceN: 2, priceD: 1 }),
      ],
    });

    const res = await request(app).get(
      `/dex/market-summary/${BASE_ASSET}/${COUNTER_ASSET}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.priceChangePercent24h).toBe("50.0000");
  });

  it("returns 404 with OrderBookEmpty error when no trades exist for the pair", async () => {
    mockTradesCall.mockResolvedValue({ records: [] });

    const res = await request(app).get(
      `/dex/market-summary/${BASE_ASSET}/${COUNTER_ASSET}`,
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
  });
});
