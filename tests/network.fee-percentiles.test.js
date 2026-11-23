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
  fee_accepted: {
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

const MOCK_LEDGER = {
  sequence: "12345678",
  closed_at: "2024-01-01T00:00:00Z",
  base_fee_in_stroops: "100",
};

const MOCK_TRANSACTIONS = {
  records: [
    { max_fee: "100" },
    { max_fee: "100" },
    { max_fee: "150" },
    { max_fee: "200" },
    { max_fee: "200" },
    { max_fee: "250" },
    { max_fee: "300" },
    { max_fee: "350" },
    { max_fee: "400" },
    { max_fee: "500" },
    { max_fee: "600" },
    { max_fee: "700" },
    { max_fee: "800" },
    { max_fee: "900" },
    { max_fee: "1000" },
  ],
};

function mockServer() {
  server.feeStats.mockResolvedValue(MOCK_FEE_STATS);
  server.ledgers.mockReturnValue({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: [MOCK_LEDGER] }),
  });
  server.transactions.mockReturnValue({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue(MOCK_TRANSACTIONS),
  });
}

beforeEach(() => {
  jest.resetModules();
  jest.doMock("../src/config/stellar", () => {
    const original = jest.requireActual("../src/config/stellar");
    return {
      ...original,
      server: {
        feeStats: jest.fn(),
        ledgers: jest.fn(),
        transactions: jest.fn(),
      },
    };
  });
  ({ server } = require("../src/config/stellar"));
  app = require("../src/index");
  cacheService.flush();
});

describe("GET /network/fee-percentiles", () => {
  function collectKeys(value, keys = new Set()) {
    if (Array.isArray(value)) {
      value.forEach((item) => collectKeys(item, keys));
      return keys;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        keys.add(k);
        collectKeys(v, keys);
      }
    }
    return keys;
  }

  it("returns success with correct shape", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data).toHaveProperty("percentiles");
    expect(data).toHaveProperty("baseFee");
    expect(data).toHaveProperty("minFee");
    expect(data).toHaveProperty("maxFee");
    expect(data).toHaveProperty("ledgerSequence");
    expect(data).toHaveProperty("timestamp");
  });

  it("baseFee has stroops and seven-decimal xlm", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const { baseFee } = res.body.data;
    expect(baseFee).toEqual({ stroops: 100, xlm: "0.0000100" });
    expect(baseFee.xlm).toMatch(/^\d+\.\d{7}$/);
  });

  it("timestamp is an ISO 8601 string", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const { timestamp } = res.body.data;
    expect(typeof timestamp).toBe("string");
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  it("contains no snake_case field names", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const keys = [...collectKeys(res.body.data)];
    for (const key of keys) {
      expect(key).not.toMatch(/_/);
    }
    expect(keys).not.toContain("fee_charged");
    expect(keys).not.toContain("fee_accepted");
    expect(keys).not.toContain("last_ledger_base_fee");
    expect(keys).not.toContain("ledger_capacity_usage");
  });

  it("all fee fields are present in both stroops and XLM", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const { percentiles, baseFee, minFee, maxFee } = res.body.data;
    const feeObjects = [...Object.values(percentiles), baseFee, minFee, maxFee];
    for (const fee of feeObjects) {
      expect(typeof fee.stroops).toBe("number");
      expect(Number.isInteger(fee.stroops)).toBe(true);
      expect(fee.xlm).toMatch(/^\d+\.\d{7}$/);
    }
  });

  it("returns all required percentile levels", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const { percentiles } = res.body.data;
    expect(percentiles).toHaveProperty("p10");
    expect(percentiles).toHaveProperty("p20");
    expect(percentiles).toHaveProperty("p30");
    expect(percentiles).toHaveProperty("p50");
    expect(percentiles).toHaveProperty("p70");
    expect(percentiles).toHaveProperty("p90");
    expect(percentiles).toHaveProperty("p95");
    expect(percentiles).toHaveProperty("p99");
  });

  it("each percentile has stroops and xlm fields", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const { percentiles } = res.body.data;
    for (const key of Object.keys(percentiles)) {
      expect(percentiles[key]).toHaveProperty("stroops");
      expect(percentiles[key]).toHaveProperty("xlm");
      expect(typeof percentiles[key].stroops).toBe("number");
      expect(typeof percentiles[key].xlm).toBe("string");
    }
  });

  it("xlm values have seven decimal places", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const { percentiles } = res.body.data;
    for (const key of Object.keys(percentiles)) {
      const decimals = percentiles[key].xlm.split(".")[1];
      expect(decimals).toHaveLength(7);
    }
  });

  it("minFee and maxFee have stroops and xlm fields", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const { minFee, maxFee } = res.body.data;
    expect(minFee).toHaveProperty("stroops");
    expect(minFee).toHaveProperty("xlm");
    expect(maxFee).toHaveProperty("stroops");
    expect(maxFee).toHaveProperty("xlm");
  });

  it("ledgerSequence is a number", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.body.data.ledgerSequence).toBe(12345678);
  });

  it("uses fee_accepted for minFee and maxFee when available", async () => {
    mockServer();
    server.feeStats.mockResolvedValue({
      ...MOCK_FEE_STATS,
      fee_accepted: {
        min: "150",
        max: "4500",
      },
    });
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.body.data.minFee.stroops).toBe(150);
    expect(res.body.data.maxFee.stroops).toBe(4500);
  });

  it("falls back to fee_charged when fee_accepted is absent", async () => {
    server.feeStats.mockResolvedValue({
      fee_charged: { min: "100", max: "5000" },
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.12",
    });
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.body.data.minFee.stroops).toBe(100);
    expect(res.body.data.maxFee.stroops).toBe(5000);
  });

  it("returns X-Cache: MISS on first request", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("returns X-Cache: HIT on second request", async () => {
    mockServer();
    await request(app).get("/network/fee-percentiles");
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.headers["x-cache"]).toBe("HIT");
  });

  it("bypasses cache when fresh=true", async () => {
    mockServer();
    await request(app).get("/network/fee-percentiles");
    const res = await request(app).get("/network/fee-percentiles?fresh=true");
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("p10 uses fee_charged.p10 when available", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.body.data.percentiles.p10.stroops).toBe(100);
  });

  it("p50 uses fee_charged.p50 when available", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.body.data.percentiles.p50.stroops).toBe(200);
  });

  it("p95 uses fee_charged.p95 when available", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.body.data.percentiles.p95.stroops).toBe(500);
  });

  it("p99 uses fee_charged.p99 when available", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.body.data.percentiles.p99.stroops).toBe(1000);
  });

  it("computes p20, p30, p70, p90 from transaction data", async () => {
    mockServer();
    const res = await request(app).get("/network/fee-percentiles");
    const { percentiles } = res.body.data;
    expect(percentiles.p20.stroops).toBeGreaterThan(0);
    expect(percentiles.p30.stroops).toBeGreaterThan(0);
    expect(percentiles.p70.stroops).toBeGreaterThan(0);
    expect(percentiles.p90.stroops).toBeGreaterThan(0);
  });

  it("ledgerSequence is null when ledger has no sequence", async () => {
    mockServer();
    server.ledgers.mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [{}] }),
    });
    const res = await request(app).get("/network/fee-percentiles");
    expect(res.body.data.ledgerSequence).toBeNull();
  });
});