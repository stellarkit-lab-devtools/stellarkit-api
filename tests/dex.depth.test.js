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

describe("DEX Order Book Depth API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /dex/depth/:sellAsset/:buyAsset", () => {
    const sellAsset = "XLM:native";
    const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    it("returns deep rating for high volume order books", async () => {
      const mockBids = Array(10).fill({ price: "0.1", amount: "3000.0000000" });
      const mockAsks = Array(10).fill({ price: "0.11", amount: "3000.0000000" });
      
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
      });

      const res = await request(app).get(`/dex/depth/${sellAsset}/${buyAsset}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.depthRating).toBe("deep");
      expect(res.body.data.bidsCount).toBe(10);
      expect(res.body.data.top5Bids).toHaveLength(5);
    });

    it("returns moderate rating for medium volume order books", async () => {
      const mockBids = [{ price: "0.1", amount: "3000.0000000" }];
      const mockAsks = [{ price: "0.11", amount: "3000.0000000" }];
      
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
      });

      const res = await request(app).get(`/dex/depth/${sellAsset}/${buyAsset}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.depthRating).toBe("moderate");
    });

    it("returns shallow rating for low volume order books", async () => {
      const mockBids = [{ price: "0.1", amount: "100.0000000" }];
      const mockAsks = [{ price: "0.11", amount: "100.0000000" }];
      
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
      });

      const res = await request(app).get(`/dex/depth/${sellAsset}/${buyAsset}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.depthRating).toBe("shallow");
    });

    it("returns 404 when no order book exists", async () => {
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ bids: [], asks: [] }),
      });

      const res = await request(app).get(`/dex/depth/${sellAsset}/${buyAsset}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("NotFound");
    });

    it("returns 400 for invalid asset formats", async () => {
      const res = await request(app).get("/dex/depth/INVALID/USDC:GA5Z...");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });
});
