const request = require("supertest");
const express = require("express");

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

const { server } = require("../src/config/stellar");
const liquidityPoolRouter = require("../src/routes/liquidityPool");
const errorHandler = require("../src/middleware/errorHandler");
const { normalizeAmountFields } = require("../src/utils/response");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(normalizeAmountFields(payload));
    next();
  });
  app.use("/liquidity-pools", liquidityPoolRouter);
  app.use(errorHandler);
  return app;
}

describe("GET /liquidity-pools/:id", () => {
  const app = buildApp();
  const poolId = "67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026";
  const usdcIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  const mockPool = {
    id: poolId,
    fee_bp: 30,
    total_shares: "1000.5",
    total_trustlines: "42",
    last_modified_ledger: 12345678,
    reserves: [
      { asset: "native", amount: "50000" },
      { asset: `USDC:${usdcIssuer}`, amount: "25000.1" },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns live Horizon data mapped to the StellarKit shape", async () => {
    const liquidityPoolId = jest.fn().mockReturnThis();
    const call = jest.fn().mockResolvedValue(mockPool);
    server.liquidityPools.mockReturnValue({ liquidityPoolId, call });

    const res = await request(app).get(`/liquidity-pools/${poolId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(server.liquidityPools).toHaveBeenCalled();
    expect(liquidityPoolId).toHaveBeenCalledWith(poolId);
    expect(res.body.data).toEqual({
      poolId,
      fee: "30.0000000",
      totalShares: "1000.5000000",
      reserveA: {
        asset: { code: "XLM", issuer: null, type: "native" },
        amount: "50000.0000000",
      },
      reserveB: {
        asset: { code: "USDC", issuer: usdcIssuer, type: "credit_alphanum4" },
        amount: "25000.1000000",
      },
      totalTrustlines: 42,
      lastModifiedLedger: 12345678,
    });
  });

  it("returns 404 when the pool does not exist", async () => {
    const error = new Error("Not Found");
    error.response = { status: 404 };
    server.liquidityPools.mockReturnValue({
      liquidityPoolId: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue(error),
    });

    const res = await request(app).get(`/liquidity-pools/${poolId}`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("LiquidityPoolNotFound");
    expect(res.body.error.message).toContain("not found");
  });
});
