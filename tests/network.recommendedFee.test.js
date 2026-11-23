const request = require("supertest");

jest.mock("../src/config/stellar", () => ({
  server: {
    feeStats: jest.fn(),
  },
  horizonUrl: "https://horizon-testnet.stellar.org",
  NETWORK: "testnet",
  NETWORKS: {
    testnet: "https://horizon-testnet.stellar.org",
    mainnet: "https://horizon.stellar.org",
  },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

describe("GET /network/recommended-fee", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    server.feeStats.mockResolvedValue({
      fee_charged: {
        min: "100",
        p50: "500",
        p95: "2000",
      },
      ledger_capacity_usage: 0.3,
    });
  });

  it("returns low, medium, and high fee tiers with confirmation estimates", async () => {
    const res = await request(app).get("/network/recommended-fee");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      low: {
        feeStroops: "100",
        feeXLM: "0.0000100",
        estimatedConfirmationLedgers: 1,
      },
      medium: {
        feeStroops: "500",
        feeXLM: "0.0000500",
        estimatedConfirmationLedgers: 1,
      },
      high: {
        feeStroops: "2000",
        feeXLM: "0.0002000",
        estimatedConfirmationLedgers: 1,
      },
    });
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("increases low-tier confirmation estimate during high congestion", async () => {
    server.feeStats.mockResolvedValue({
      fee_charged: { min: "100", p50: "500", p95: "2000" },
      ledger_capacity_usage: 0.9,
    });

    const res = await request(app).get("/network/recommended-fee?fresh=true");

    expect(res.body.data.low.estimatedConfirmationLedgers).toBe(3);
    expect(res.body.data.medium.estimatedConfirmationLedgers).toBe(2);
    expect(res.body.data.high.estimatedConfirmationLedgers).toBe(1);
  });

  it("serves cached response on subsequent requests", async () => {
    await request(app).get("/network/recommended-fee");
    const res = await request(app).get("/network/recommended-fee");

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    expect(server.feeStats).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when fresh=true", async () => {
    await request(app).get("/network/recommended-fee");
    await request(app).get("/network/recommended-fee?fresh=true");

    expect(server.feeStats).toHaveBeenCalledTimes(2);
  });
});
