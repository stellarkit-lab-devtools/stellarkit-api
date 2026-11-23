const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

// Mock Horizon so the spread maths is verified against a fixed order book
// rather than whatever the live network happens to be quoting.
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      orderbook: jest.fn(),
    },
  };
});

/**
 * Build a chainable order book stub matching the Horizon call shape used by
 * the route: server.orderbook(selling, buying).limit(200).call()
 */
function mockOrderBook({ bids = [], asks = [] }) {
  const call = jest.fn().mockResolvedValue({ bids, asks });
  const limit = jest.fn().mockReturnThis();
  server.orderbook.mockReturnValue({ limit, call });
  return { limit, call };
}

describe("GET /dex/spread/:sellAsset/:buyAsset (mocked Horizon)", () => {
  const xlmNative = "XLM:native";
  const usdcIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const usdc = `USDC:${usdcIssuer}`;
  const BASE = `/dex/spread/${xlmNative}/${usdc}`;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Order book wiring ──────────────────────────────────────────────────────

  it("calls server.orderbook with the parsed selling and buying assets", async () => {
    mockOrderBook({
      bids: [{ price: "0.1284000", amount: "4200.0000000" }],
      asks: [{ price: "0.1291000", amount: "3800.0000000" }],
    });

    await request(app).get(BASE).expect(200);

    expect(server.orderbook).toHaveBeenCalledTimes(1);
    const [selling, buying] = server.orderbook.mock.calls[0];
    expect(selling.getCode()).toBe("XLM");
    expect(selling.isNative()).toBe(true);
    expect(buying.getCode()).toBe("USDC");
    expect(buying.getIssuer()).toBe(usdcIssuer);
  });

  // ── Spread calculation ─────────────────────────────────────────────────────

  it("computes bestBid, bestAsk, spread, and midPrice from the best orders", async () => {
    mockOrderBook({
      bids: [
        { price: "0.1284000", amount: "4200.0000000" },
        { price: "0.1280000", amount: "800.0000000" },
      ],
      asks: [
        { price: "0.1291000", amount: "3800.0000000" },
        { price: "0.1295000", amount: "1200.0000000" },
      ],
    });

    const res = await request(app).get(BASE).expect(200);
    const { data } = res.body;

    // Best orders are the first entries, not the deeper ones
    expect(data.bestBid).toEqual({ price: "0.1284000", amount: "4200.0000000" });
    expect(data.bestAsk).toEqual({ price: "0.1291000", amount: "3800.0000000" });

    // 0.1291 − 0.1284 = 0.0007
    expect(data.spreadAbsolute).toBe("0.0007000");
    // (0.1284 + 0.1291) / 2 = 0.12875
    expect(data.midPrice).toBe("0.1287500");
    // 0.0007 / 0.12875 × 100 = 0.5437…
    expect(data.spreadPercent).toBe("0.5437");
  });

  it("returns all prices as seven-decimal strings", async () => {
    mockOrderBook({
      bids: [{ price: "0.25", amount: "100" }],
      asks: [{ price: "0.75", amount: "100" }],
    });

    const res = await request(app).get(BASE).expect(200);
    const { data } = res.body;

    for (const value of [
      data.bestBid.price,
      data.bestBid.amount,
      data.bestAsk.price,
      data.bestAsk.amount,
      data.spreadAbsolute,
      data.midPrice,
    ]) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^\d+\.\d{7}$/);
    }

    expect(data.spreadAbsolute).toBe("0.5000000");
    expect(data.midPrice).toBe("0.5000000");
    expect(data.spreadPercent).toBe("100.0000");
  });

  it("falls back to the bid price for midPrice when there are no asks", async () => {
    mockOrderBook({
      bids: [{ price: "0.1284000", amount: "4200.0000000" }],
      asks: [],
    });

    const res = await request(app).get(BASE).expect(200);
    const { data } = res.body;

    expect(data.bestAsk).toBeNull();
    expect(data.spreadAbsolute).toBeNull();
    expect(data.spreadPercent).toBeNull();
    expect(data.midPrice).toBe("0.1284000");
  });

  it("falls back to the ask price for midPrice when there are no bids", async () => {
    mockOrderBook({
      bids: [],
      asks: [{ price: "0.1291000", amount: "3800.0000000" }],
    });

    const res = await request(app).get(BASE).expect(200);
    const { data } = res.body;

    expect(data.bestBid).toBeNull();
    expect(data.spreadAbsolute).toBeNull();
    expect(data.midPrice).toBe("0.1291000");
  });

  // ── Depth and liquidity ────────────────────────────────────────────────────

  it("totals order book depth across every level, not just the best order", async () => {
    mockOrderBook({
      bids: [
        { price: "0.1284000", amount: "4200.0000000" },
        { price: "0.1280000", amount: "800.0000000" },
      ],
      asks: [
        { price: "0.1291000", amount: "3800.0000000" },
        { price: "0.1295000", amount: "1200.0000000" },
      ],
    });

    const res = await request(app).get(BASE).expect(200);
    const { orderBookDepth } = res.body.data;

    expect(orderBookDepth.bids).toBe(2);
    expect(orderBookDepth.asks).toBe(2);
    expect(orderBookDepth.totalBidVolume).toBe("5000.0000000");
    expect(orderBookDepth.totalAskVolume).toBe("5000.0000000");
    expect(orderBookDepth.totalVolume).toBe("10000.0000000");
  });

  it("labels liquidity from total volume", async () => {
    mockOrderBook({
      bids: [{ price: "0.1284000", amount: "10.0000000" }],
      asks: [{ price: "0.1291000", amount: "10.0000000" }],
    });

    const res = await request(app).get(BASE).expect(200);
    expect(res.body.data.liquidity).toBe("low");
  });

  // ── OrderBookEmpty ─────────────────────────────────────────────────────────

  it("returns OrderBookEmpty when both sides of the book are empty", async () => {
    mockOrderBook({ bids: [], asks: [] });

    const res = await request(app).get(BASE).expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
    expect(res.body.error.message).toContain("No active order book found");
  });

  it("returns OrderBookEmpty when Horizon answers 404 for the pair", async () => {
    const err = new Error("Not Found");
    err.response = { status: 404 };
    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue(err),
    });

    const res = await request(app).get(BASE).expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it("returns 400 without touching Horizon when an asset is malformed", async () => {
    const res = await request(app).get("/dex/spread/XLMNATIVE/USDC:GA5Z").expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(server.orderbook).not.toHaveBeenCalled();
  });
});
