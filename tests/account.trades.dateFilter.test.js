"use strict";

/**
 * Tests for GET /account/:id/trades ?startDate and ?endDate query parameters.
 *
 * Acceptance criteria (Issue #423):
 *   - ?startDate and ?endDate filter trades by ledgerCloseTime
 *   - Invalid date strings return 400 ValidationError
 *   - startDate after endDate returns 400 with a clear message
 *   - Tests cover valid range, invalid dates, and reversed range
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { trades: jest.fn() },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const accountId = Keypair.random().publicKey();

function makeTrade(id, ledger_close_time) {
  return {
    id,
    paging_token: `pt-${id}`,
    ledger_close_time,
    base_is_seller: true,
    base_amount: "10.0",
    base_asset_type: "native",
    counter_amount: "20.0",
    counter_asset_type: "credit_alphanum4",
    counter_asset_code: "USDC",
    counter_asset_issuer: Keypair.random().publicKey(),
  };
}

function mockTrades(records = []) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.trades.mockReturnValue(chain);
  return chain;
}

describe("GET /account/:id/trades — ?startDate and ?endDate filters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── Valid range ────────────────────────────────────────────────────────────

  it("returns only trades within the given date range", async () => {
    mockTrades([
      makeTrade("t1", "2024-01-10T00:00:00Z"),
      makeTrade("t2", "2024-02-15T00:00:00Z"),
      makeTrade("t3", "2024-03-20T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=2024-02-01T00:00:00Z&endDate=2024-03-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].id).toBe("t2");
    expect(res.body.data.total).toBe(1);
  });

  it("returns trades on the startDate boundary (inclusive)", async () => {
    mockTrades([
      makeTrade("t1", "2024-02-01T00:00:00Z"),
      makeTrade("t2", "2024-02-15T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=2024-02-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
  });

  it("returns trades on the endDate boundary (inclusive)", async () => {
    mockTrades([
      makeTrade("t1", "2024-01-15T00:00:00Z"),
      makeTrade("t2", "2024-02-01T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/trades?endDate=2024-02-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
  });

  it("accepts date-only strings (no time component)", async () => {
    mockTrades([
      makeTrade("t1", "2024-01-05T00:00:00Z"),
      makeTrade("t2", "2024-01-15T00:00:00Z"),
      makeTrade("t3", "2024-01-25T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=2024-01-10&endDate=2024-01-20`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].id).toBe("t2");
  });

  it("returns an empty list when no trades fall within the range", async () => {
    mockTrades([
      makeTrade("t1", "2023-06-01T00:00:00Z"),
      makeTrade("t2", "2023-07-01T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=2024-01-01T00:00:00Z&endDate=2024-12-31T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  it("does not filter when neither startDate nor endDate is provided", async () => {
    mockTrades([
      makeTrade("t1", "2022-01-01T00:00:00Z"),
      makeTrade("t2", "2024-06-01T00:00:00Z"),
    ]);

    const res = await request(app).get(`/account/${accountId}/trades`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
  });

  // ── Invalid date strings ───────────────────────────────────────────────────

  it("returns 400 ValidationError for an invalid ?startDate string", async () => {
    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=not-a-date`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("startDate");
    expect(res.body.error.message).toContain("startDate");
  });

  it("returns 400 ValidationError for an invalid ?endDate string", async () => {
    const res = await request(app).get(
      `/account/${accountId}/trades?endDate=not-a-date`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("endDate");
    expect(res.body.error.message).toContain("endDate");
  });

  it("returns 400 ValidationError for an empty ?startDate value", async () => {
    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("startDate");
  });

  it("returns 400 ValidationError for an empty ?endDate value", async () => {
    const res = await request(app).get(
      `/account/${accountId}/trades?endDate=`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("endDate");
  });

  // ── Reversed range ─────────────────────────────────────────────────────────

  it("returns 400 when startDate is after endDate", async () => {
    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=2024-12-01T00:00:00Z&endDate=2024-01-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("startDate");
    expect(res.body.error.message).toContain("startDate");
    expect(res.body.error.message).toContain("endDate");
  });

  it("returns 400 when startDate equals endDate", async () => {
    const res = await request(app).get(
      `/account/${accountId}/trades?startDate=2024-06-01T00:00:00Z&endDate=2024-06-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("startDate");
  });

  // ── No Horizon call on validation failure ──────────────────────────────────

  it("does not call Horizon when date validation fails", async () => {
    const chain = mockTrades([]);
    await request(app).get(
      `/account/${accountId}/trades?startDate=bad`,
    );

    expect(chain.call).not.toHaveBeenCalled();
  });
});
