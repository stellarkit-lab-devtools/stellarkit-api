const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

jest.mock("../../src/config/stellar", () => {
  const originalModule = jest.requireActual("../../src/config/stellar");
  return {
    ...originalModule,
    server: {
      orderbook: jest.fn(),
    },
  };
});

describe("GET /dex/order-book-depth/:sellAsset/:buyAsset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("computes cumulative bid volumes correctly from outermost to innermost", async () => {
    const sellAsset = "XLM:native";
    const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    const mockBids = [
      { price: "0.08", amount: "1000.0000000" },
      { price: "0.09", amount: "2000.0000000" },
      { price: "0.10", amount: "3000.0000000" },
    ];

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: [] }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bids).toHaveLength(3);

    // Verify cumulative volumes are correct (outermost to innermost)
    expect(res.body.data.bids[0].cumulativeVolume).toBe("1000.0000000"); // Outermost
    expect(res.body.data.bids[1].cumulativeVolume).toBe("3000.0000000"); // 1000 + 2000
    expect(res.body.data.bids[2].cumulativeVolume).toBe("6000.0000000"); // 1000 + 2000 + 3000
  });

  it("computes spread as bestAsk - bestBid", async () => {
    const sellAsset = "XLM:native";
    const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    const mockBids = [{ price: "0.10", amount: "1000.0000000" }];
    const mockAsks = [{ price: "0.12", amount: "1000.0000000" }];

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bestBid).toBe("0.10");
    expect(res.body.data.bestAsk).toBe("0.12");
    expect(parseFloat(res.body.data.spread)).toBeCloseTo(0.02, 5);
  });

  it("returns exactly 5 bid and 5 ask levels when depth=5", async () => {
    const sellAsset = "XLM:native";
    const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    const mockBids = Array(20)
      .fill(null)
      .map((_, i) => ({
        price: (0.10 - i * 0.01).toFixed(2),
        amount: "1000.0000000",
      }));

    const mockAsks = Array(20)
      .fill(null)
      .map((_, i) => ({
        price: (0.11 + i * 0.01).toFixed(2),
        amount: "1000.0000000",
      }));

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}?depth=5`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bids).toHaveLength(5);
    expect(res.body.data.asks).toHaveLength(5);
  });

  it("returns OrderBookEmpty error when no orders exist", async () => {
    const sellAsset = "XLM:native";
    const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: [], asks: [] }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
    expect(res.body.error.message).toContain("No active order book found");
  });

  it("returns proper structure with all required fields", async () => {
    const sellAsset = "XLM:native";
    const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    const mockBids = [{ price: "0.10", amount: "1000.0000000" }];
    const mockAsks = [{ price: "0.11", amount: "1000.0000000" }];

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("bestBid");
    expect(res.body.data).toHaveProperty("bestAsk");
    expect(res.body.data).toHaveProperty("spread");
    expect(res.body.data).toHaveProperty("bids");
    expect(res.body.data).toHaveProperty("asks");
    expect(Array.isArray(res.body.data.bids)).toBe(true);
    expect(Array.isArray(res.body.data.asks)).toBe(true);
  });

  it("includes price and cumulativeVolume in bid/ask levels", async () => {
    const sellAsset = "XLM:native";
    const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    const mockBids = [{ price: "0.10", amount: "1000.0000000" }];
    const mockAsks = [{ price: "0.11", amount: "2000.0000000" }];

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.bids[0]).toHaveProperty("price");
    expect(res.body.data.bids[0]).toHaveProperty("cumulativeVolume");
    expect(res.body.data.asks[0]).toHaveProperty("price");
    expect(res.body.data.asks[0]).toHaveProperty("cumulativeVolume");
  });

  it("returns 400 for invalid asset formats", async () => {
    const res = await request(app).get("/dex/order-book-depth/INVALID/USDC:GA5Z...");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("handles native XLM correctly", async () => {
    const sellAsset = "XLM:native";
    const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    const mockBids = [{ price: "0.10", amount: "1000.0000000" }];
    const mockAsks = [{ price: "0.11", amount: "1000.0000000" }];

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
