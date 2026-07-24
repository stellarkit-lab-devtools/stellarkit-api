const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      orderbook: jest.fn(),
    },
  };
});

describe("GET /dex/imbalance/:sellAsset/:buyAsset", () => {
  const xlmNative = "XLM:native";
  const usdc = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 400 for invalid asset format", async () => {
    const response = await request(app)
      .get("/dex/imbalance/INVALID/XLM:native")
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toContain("Invalid asset format");
  });

  it("should return imbalance data for a valid pair", async () => {
    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        bids: [{ price: "0.1", amount: "100.0000000" }],
        asks: [{ price: "0.11", amount: "50.0000000" }],
      }),
    });

    const response = await request(app).get(`/dex/imbalance/${xlmNative}/${usdc}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("bidVolume");
    expect(response.body.data).toHaveProperty("askVolume");
    expect(response.body.data).toHaveProperty("imbalanceRatio");
    expect(response.body.data).toHaveProperty("pressure");
    expect(response.body.data).toHaveProperty("signal");
    expect(["buy", "sell", "neutral"]).toContain(response.body.data.pressure);
    expect(response.body.data.pressure).toBe("buy");
  });

  it("should return OrderBookEmpty for a non-existent order book", async () => {
    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: [], asks: [] }),
    });

    const response = await request(app).get(`/dex/imbalance/${xlmNative}/${usdc}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.type).toBe("OrderBookEmpty");
    expect(response.body.error.message).toBe("No active order book found for XLM/USDC.");
    expect(response.body.error.suggestion).toContain("active offers");
  });
});
