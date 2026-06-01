const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      liquidityPools: jest.fn(),
      trades: jest.fn(),
    },
  };
});

describe("Liquidity Pool Profitability API", () => {
  const poolId = "67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /liquidity-pools/:id/profitability", () => {
    it("returns profitability estimates for a valid pool", async () => {
      const mockPool = {
        id: poolId,
        fee_bp: 30,
        reserves: [
          { asset: "XLM", amount: "10000.0000000" },
          { asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", amount: "5000.0000000" },
        ],
        total_shares: "1000.0000000",
        total_trustlines: "50",
      };

      const now = new Date();
      const mockTrades = [
        {
          ledger_close_time: now.toISOString(),
          base_amount: "100.0000000",
        },
        {
          ledger_close_time: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          base_amount: "200.0000000",
        },
        {
          // Older than 7 days
          ledger_close_time: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          base_amount: "500.0000000",
        },
      ];

      server.liquidityPools.mockReturnValue({
        liquidityPoolId: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPool),
      });

      server.trades.mockReturnValue({
        forLiquidityPool: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockTrades }),
      });

      const res = await request(app).get(`/liquidity-pools/${poolId}/profitability`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.poolId).toBe(poolId);
      expect(res.body.data.feeRate).toBe("0.30%");
      // 100 + 200 = 300 volume in 7 days
      expect(res.body.data.tradeVolume7d).toBe("300.0000000");
      expect(res.body.data.tradeCount7d).toBe(2);
      
      // daily = (300 / 7) * 0.003 = 0.1285714
      expect(parseFloat(res.body.data.estimatedDailyFeeIncome)).toBeCloseTo(0.1285714);
      // annual = daily * 365 = 46.928561
      expect(parseFloat(res.body.data.estimatedAnnualFeeIncome)).toBeCloseTo(46.928561, 2);
    });

    it("returns 404 for unknown pool ID", async () => {
      const error = new Error("Not Found");
      error.response = { status: 404 };
      server.liquidityPools.mockReturnValue({
        liquidityPoolId: jest.fn().mockReturnThis(),
        call: jest.fn().mockRejectedValue(error),
      });

      const res = await request(app).get(`/liquidity-pools/UNKNOWN_ID/profitability`);

      expect(res.statusCode).toBe(404);
      expect(res.body.error.message).toContain("not found");
    });
  });

  describe("GET /liquidity-pools/:id/reserve-ratio", () => {
    it("returns reserve analysis for a balanced pool", async () => {
      const mockPool = {
        id: poolId,
        reserves: [
          { asset: "XLM", amount: "5000.0000000" },
          { asset: "USDC", amount: "5000.0000000" },
        ],
      };

      server.liquidityPools.mockReturnValue({
        liquidityPoolId: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPool),
      });

      const res = await request(app).get(`/liquidity-pools/${poolId}/reserve-ratio`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reserveA.amount).toBe("5000.0000000");
      expect(res.body.data.ratioA).toBe("50.00%");
      expect(res.body.data.ratioB).toBe("50.00%");
      expect(res.body.data.driftFromEqual).toBe("0.00%");
      expect(res.body.data.driftRating).toBe("balanced");
    });

    it("returns reserve analysis for a moderately imbalanced pool", async () => {
      const mockPool = {
        id: poolId,
        reserves: [
          { asset: "XLM", amount: "6000.0000000" },
          { asset: "USDC", amount: "4000.0000000" },
        ],
      };

      server.liquidityPools.mockReturnValue({
        liquidityPoolId: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPool),
      });

      const res = await request(app).get(`/liquidity-pools/${poolId}/reserve-ratio`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ratioA).toBe("60.00%");
      expect(res.body.data.ratioB).toBe("40.00%");
      expect(res.body.data.driftFromEqual).toBe("10.00%");
      expect(res.body.data.driftRating).toBe("moderate");
    });

    it("returns reserve analysis for a highly imbalanced pool", async () => {
      const mockPool = {
        id: poolId,
        reserves: [
          { asset: "XLM", amount: "8000.0000000" },
          { asset: "USDC", amount: "2000.0000000" },
        ],
      };

      server.liquidityPools.mockReturnValue({
        liquidityPoolId: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPool),
      });

      const res = await request(app).get(`/liquidity-pools/${poolId}/reserve-ratio`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ratioA).toBe("80.00%");
      expect(res.body.data.ratioB).toBe("20.00%");
      expect(res.body.data.driftFromEqual).toBe("30.00%");
      expect(res.body.data.driftRating).toBe("imbalanced");
    });

    it("returns 404 for unknown pool ID", async () => {
      const error = new Error("Not Found");
      error.response = { status: 404 };
      server.liquidityPools.mockReturnValue({
        liquidityPoolId: jest.fn().mockReturnThis(),
        call: jest.fn().mockRejectedValue(error),
      });

      const res = await request(app).get(`/liquidity-pools/UNKNOWN_ID/reserve-ratio`);

      expect(res.statusCode).toBe(404);
      expect(res.body.error.message).toContain("not found");
    });
  });
});
