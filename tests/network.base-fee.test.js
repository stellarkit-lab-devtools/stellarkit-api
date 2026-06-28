const request = require("supertest");
const cacheService = require("../src/services/cache");

let app;
let server;

beforeEach(() => {
  jest.resetModules();
  jest.doMock("../src/config/stellar", () => ({
    ...jest.requireActual("../src/config/stellar"),
    server: {
      ledgers: jest.fn(),
      feeStats: jest.fn(),
    },
  }));
  ({ server } = require("../src/config/stellar"));
  app = require("../src/index");
  cacheService.flush();
});

function mockLedgers() {
  server.ledgers.mockReturnValue({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({
      records: [
        {
          sequence: "1000",
          base_fee_in_stroops: "100",
          closed_at: "2024-01-01T00:00:00Z",
        },
      ],
    }),
  });
  // feeStats may be called by warmup — provide a minimal stub
  server.feeStats.mockResolvedValue({
    fee_charged: { min: "100", p10: "100", p50: "120", p95: "140", p99: "150", max: "160" },
    last_ledger_base_fee: "100",
    ledger_capacity_usage: "0.1",
  });
}

describe("GET /network/base-fee", () => {
  it("returns base fee data with correct shape", async () => {
    mockLedgers();
    const res = await request(app).get("/network/base-fee");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data).toHaveProperty("baseFeeStroops", 100);
    expect(data).toHaveProperty("baseFeeXLM", "0.0000100");
    expect(data).toHaveProperty("ledgerSequence");
    expect(data).toHaveProperty("ledgerClosedAt");
    expect(data).toHaveProperty("note");
  });

  it("returns X-Cache: MISS on first request", async () => {
    mockLedgers();
    const res = await request(app).get("/network/base-fee");
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("returns X-Cache: HIT on second request", async () => {
    mockLedgers();
    await request(app).get("/network/base-fee"); // seed cache
    const res = await request(app).get("/network/base-fee");
    expect(res.headers["x-cache"]).toBe("HIT");
  });

  it("bypasses cache when ?fresh=true is passed", async () => {
    mockLedgers();
    await request(app).get("/network/base-fee"); // seed cache
    const res = await request(app).get("/network/base-fee?fresh=true");
    expect(res.headers["x-cache"]).toBe("MISS");
  });
});
