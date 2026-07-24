"use strict";

/**
 * Tests for GET /account/:id/trades ?order query parameter.
 *
 * Acceptance criteria:
 *   - ?order=asc works and passes "asc" to Horizon
 *   - ?order=desc works and passes "desc" to Horizon
 *   - Invalid values return a 400 with ValidationError type
 *   - Default (omitted) is "desc"
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

describe("GET /account/:id/trades — ?order parameter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("passes order=asc to Horizon when ?order=asc is provided", async () => {
    const chain = mockTrades([]);
    const res = await request(app).get(`/account/${accountId}/trades?order=asc`);

    expect(res.statusCode).toBe(200);
    expect(chain.order).toHaveBeenCalledWith("asc");
  });

  it("passes order=desc to Horizon when ?order=desc is provided", async () => {
    const chain = mockTrades([]);
    const res = await request(app).get(`/account/${accountId}/trades?order=desc`);

    expect(res.statusCode).toBe(200);
    expect(chain.order).toHaveBeenCalledWith("desc");
  });

  it("defaults to order=desc when ?order is omitted", async () => {
    const chain = mockTrades([]);
    const res = await request(app).get(`/account/${accountId}/trades`);

    expect(res.statusCode).toBe(200);
    expect(chain.order).toHaveBeenCalledWith("desc");
  });

  it("returns 400 ValidationError for invalid ?order value", async () => {
    // No mockTrades needed — validation fires before Horizon call
    const res = await request(app).get(`/account/${accountId}/trades?order=invalid`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("order");
  });

  it("returns 400 ValidationError for order=random", async () => {
    const res = await request(app).get(`/account/${accountId}/trades?order=random`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("is case-insensitive (ASC normalises to asc)", async () => {
    const chain = mockTrades([]);
    const res = await request(app).get(`/account/${accountId}/trades?order=ASC`);

    expect(res.statusCode).toBe(200);
    expect(chain.order).toHaveBeenCalledWith("asc");
  });
});
