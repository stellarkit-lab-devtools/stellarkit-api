"use strict";

const request = require("supertest");
const cacheService = require("../src/services/cache");

let app;
let server;

const MOCK_FEE_STATS = {
  fee_charged: {
    min: "100",
    p10: "100",
    p50: "200",
    p95: "500",
    p99: "1000",
    max: "5000",
  },
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.12",
};

describe("GET /network/base-fee", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../src/config/stellar", () => {
      const originalModule = jest.requireActual("../src/config/stellar");
      return {
        ...originalModule,
        server: {
          feeStats: jest.fn(),
          ledgers: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({ records: [] }),
          }),
        },
        horizonUrl: "https://horizon-testnet.stellar.org",
      };
    });

    ({ server } = require("../src/config/stellar"));
    app = require("../src/index");
    cacheService.flush();
  });

  it("returns base fee in stroops and XLM", async () => {
    server.feeStats.mockResolvedValue(MOCK_FEE_STATS);

    const res = await request(app).get("/network/base-fee");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.baseFeeStroops).toBe(100);
    expect(data.baseFeeXLM).toBe("0.0000100");
    expect(typeof data.isSurge).toBe("boolean");
  });

  it("isSurge is false when network is not congested", async () => {
    server.feeStats.mockResolvedValue(MOCK_FEE_STATS);

    const res = await request(app).get("/network/base-fee");
    expect(res.body.data.isSurge).toBe(false);
  });

  it("isSurge is true when capacity usage exceeds 0.5", async () => {
    server.feeStats.mockResolvedValue({
      ...MOCK_FEE_STATS,
      ledger_capacity_usage: "0.75",
    });

    const res = await request(app).get("/network/base-fee");
    expect(res.body.data.isSurge).toBe(true);
  });

  it("isSurge is true when base fee exceeds minimum charged fee", async () => {
    server.feeStats.mockResolvedValue({
      ...MOCK_FEE_STATS,
      last_ledger_base_fee: "200",
      ledger_capacity_usage: "0.1",
    });

    const res = await request(app).get("/network/base-fee");
    expect(res.body.data.isSurge).toBe(true);
  });

  it("returns cached response on second call", async () => {
    server.feeStats.mockResolvedValue(MOCK_FEE_STATS);

    const first = await request(app).get("/network/base-fee");
    expect(first.headers["x-cache"]).toBe("MISS");

    const second = await request(app).get("/network/base-fee");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body.data).toEqual(first.body.data);
    expect(server.feeStats).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when fresh=true", async () => {
    server.feeStats.mockResolvedValue(MOCK_FEE_STATS);

    await request(app).get("/network/base-fee");
    const res = await request(app).get("/network/base-fee?fresh=true");
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(server.feeStats).toHaveBeenCalledTimes(2);
  });

  it("baseFeeXLM has seven decimal places", async () => {
    server.feeStats.mockResolvedValue(MOCK_FEE_STATS);

    const res = await request(app).get("/network/base-fee");
    const decimals = res.body.data.baseFeeXLM.split(".")[1];
    expect(decimals).toHaveLength(7);
  });
});
