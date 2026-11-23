"use strict";

/**
 * Tests for GET /account/:id/payments ?startDate and ?endDate query parameters.
 *
 * Acceptance criteria (Issue #410):
 *   - ?startDate and ?endDate filter payments by createdAt
 *   - Invalid date strings return 400 ValidationError
 *   - startDate after endDate returns 400 with a clear message
 *   - Tests cover valid range, invalid dates, and reversed range
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    payments: jest.fn(),
    operations: jest.fn(),
    loadAccount: jest.fn(),
  },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const accountId = Keypair.random().publicKey();

function makePayment(id, created_at) {
  return {
    id,
    type: "payment",
    paging_token: `pt-${id}`,
    asset_code: "USDC",
    asset_issuer: Keypair.random().publicKey(),
    asset_type: "credit_alphanum4",
    amount: "10.0000000",
    from: accountId,
    to: Keypair.random().publicKey(),
    created_at,
    transaction_hash: `tx-${id}`,
  };
}

function mockOps(records = []) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.payments.mockReturnValue(chain);
  server.operations.mockReturnValue(chain);
  return chain;
}

describe("GET /account/:id/payments — ?startDate and ?endDate filters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── Valid range ────────────────────────────────────────────────────────────

  it("returns only payments within the given date range", async () => {
    mockOps([
      makePayment("p1", "2024-01-10T00:00:00Z"),
      makePayment("p2", "2024-02-15T00:00:00Z"),
      makePayment("p3", "2024-03-20T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/payments?startDate=2024-02-01T00:00:00Z&endDate=2024-03-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].createdAt).toBe("2024-02-15T00:00:00.000Z");
    expect(res.body.data.total).toBe(1);
  });

  it("returns payments on the startDate boundary (inclusive)", async () => {
    mockOps([
      makePayment("p1", "2024-02-01T00:00:00Z"),
      makePayment("p2", "2024-02-15T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/payments?startDate=2024-02-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
  });

  it("returns payments on the endDate boundary (inclusive)", async () => {
    mockOps([
      makePayment("p1", "2024-01-15T00:00:00Z"),
      makePayment("p2", "2024-02-01T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/payments?endDate=2024-02-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
  });

  it("accepts date-only strings (no time component)", async () => {
    mockOps([
      makePayment("p1", "2024-01-05T00:00:00Z"),
      makePayment("p2", "2024-01-15T00:00:00Z"),
      makePayment("p3", "2024-01-25T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/payments?startDate=2024-01-10&endDate=2024-01-20`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].createdAt).toBe("2024-01-15T00:00:00.000Z");
  });

  it("returns an empty list when no payments fall within the range", async () => {
    mockOps([
      makePayment("p1", "2023-06-01T00:00:00Z"),
      makePayment("p2", "2023-07-01T00:00:00Z"),
    ]);

    const res = await request(app).get(
      `/account/${accountId}/payments?startDate=2024-01-01T00:00:00Z&endDate=2024-12-31T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  it("does not filter when neither startDate nor endDate is provided", async () => {
    mockOps([
      makePayment("p1", "2022-01-01T00:00:00Z"),
      makePayment("p2", "2024-06-01T00:00:00Z"),
    ]);

    const res = await request(app).get(`/account/${accountId}/payments`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
  });

  // ── Invalid date strings ───────────────────────────────────────────────────

  it("returns 400 ValidationError for an invalid ?startDate string", async () => {
    const res = await request(app).get(
      `/account/${accountId}/payments?startDate=not-a-date`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("startDate");
    expect(res.body.error.message).toContain("startDate");
  });

  it("returns 400 ValidationError for an invalid ?endDate string", async () => {
    const res = await request(app).get(
      `/account/${accountId}/payments?endDate=not-a-date`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("endDate");
    expect(res.body.error.message).toContain("endDate");
  });

  it("returns 400 ValidationError for an empty ?startDate value", async () => {
    const res = await request(app).get(
      `/account/${accountId}/payments?startDate=`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("startDate");
  });

  it("returns 400 ValidationError for an empty ?endDate value", async () => {
    const res = await request(app).get(
      `/account/${accountId}/payments?endDate=`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("endDate");
  });

  // ── Reversed range ─────────────────────────────────────────────────────────

  it("returns 400 when startDate is after endDate", async () => {
    const res = await request(app).get(
      `/account/${accountId}/payments?startDate=2024-12-01T00:00:00Z&endDate=2024-01-01T00:00:00Z`,
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
      `/account/${accountId}/payments?startDate=2024-06-01T00:00:00Z&endDate=2024-06-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("startDate");
  });

  // ── No Horizon call on validation failure ──────────────────────────────────

  it("does not call Horizon when date validation fails", async () => {
    const chain = mockOps([]);
    await request(app).get(
      `/account/${accountId}/payments?startDate=bad`,
    );

    expect(chain.call).not.toHaveBeenCalled();
  });
});
