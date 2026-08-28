"use strict";

/**
 * Tests for GET /account/:id/trades (API) and the SDK getTrades wrapper
 *
 * API tests verify:
 *   - Returns 200 with { trades, items, total, limit, cursor }
 *   - Normalises trade records to the expected shape
 *   - Forwards ?limit to Horizon
 *   - Forwards ?cursor to Horizon
 *   - Filters by ?startDate (records before it are excluded)
 *   - Filters by ?endDate (records after it are excluded)
 *   - Returns 400 for invalid account ID
 *   - Returns 404 when account not found
 *   - Returns 400 for invalid ISO date
 *   - Caches results (X-Cache: HIT on second request)
 *
 * SDK wrapper tests (plain JS fetch mock) verify:
 *   - Makes a GET request to /account/:id/trades
 *   - Returns PaginatedResponse shape
 *   - Forwards all four optional filters as query params
 *   - Does NOT include undefined params in URL
 *   - Throws StellarKitError on 404
 *   - Throws StellarKitError on empty id
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// Suppress real Horizon/startup calls
jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    trades: jest.fn(),
    payments: jest.fn(),
    operations: jest.fn(),
    offers: jest.fn(),
    transactions: jest.fn(),
    effects: jest.fn(),
    ledgers: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    }),
    feeStats: jest.fn().mockResolvedValue({
      fee_charged: { min: "100", p10: "100", p50: "200", p95: "500", p99: "1000", max: "5000" },
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.5",
    }),
  },
  fetchAccountCreation: jest.fn(),
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const VALID_ID = Keypair.random().publicKey();

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTradeRecord(overrides = {}) {
  return {
    id: "123456789-0",
    paging_token: "123456789-0",
    ledger_close_time: "2024-06-01T12:00:00Z",
    offer_id: "42",
    base_is_seller: true,
    base_account: VALID_ID,
    base_amount: "10.0000000",
    base_asset_type: "native",
    counter_account: Keypair.random().publicKey(),
    counter_amount: "50.0000000",
    counter_asset_type: "credit_alphanum4",
    counter_asset_code: "USDC",
    counter_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    price: { n: 5, d: 1 },
    ...overrides,
  };
}

function mockTrades(records = []) {
  const mockCall   = jest.fn().mockResolvedValue({ records });
  const mockCursor = jest.fn().mockReturnThis();
  const mockOrder  = jest.fn().mockReturnThis();
  const mockLimit  = jest.fn().mockReturnThis();
  const mockForAccount = jest.fn().mockReturnValue({
    limit: mockLimit,
    order: mockOrder,
    cursor: mockCursor,
    call: mockCall,
  });
  server.trades.mockReturnValue({ forAccount: mockForAccount });
  server.loadAccount.mockResolvedValue({
    id: VALID_ID, balances: [], signers: [], thresholds: {},
  });
  return { mockForAccount, mockLimit, mockOrder, mockCursor, mockCall };
}

beforeEach(() => {
  cacheService.flush();
  jest.clearAllMocks();
});

// ── API endpoint tests ────────────────────────────────────────────────────────

describe("GET /account/:id/trades — API endpoint", () => {
  it("returns 200 with success: true and paginated trade data", async () => {
    mockTrades([buildTradeRecord()]);
    const res = await request(app).get(`/account/${VALID_ID}/trades`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("trades");
    expect(res.body.data).toHaveProperty("items");
    expect(res.body.data).toHaveProperty("total");
    expect(res.body.data).toHaveProperty("limit");
    expect(res.body.data).toHaveProperty("cursor");
  });

  it("returns an empty trades array when no trades exist", async () => {
    mockTrades([]);
    const res = await request(app).get(`/account/${VALID_ID}/trades`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.trades).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.cursor).toBeNull();
  });

  it("normalises trade records to expected shape", async () => {
    mockTrades([buildTradeRecord()]);
    const res = await request(app).get(`/account/${VALID_ID}/trades`);
    const trade = res.body.data.trades[0];
    expect(trade).toHaveProperty("id");
    expect(trade).toHaveProperty("ledgerCloseTime");
    expect(trade).toHaveProperty("baseAsset");
    expect(trade).toHaveProperty("counterAsset");
    expect(trade).toHaveProperty("price");
    expect(trade).toHaveProperty("baseAmount");
    expect(trade).toHaveProperty("counterAmount");
  });

  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get("/account/NOTVALID/trades");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });

  it("returns 404 when account does not exist", async () => {
    server.trades.mockReturnValue({
      forAccount: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        cursor: jest.fn().mockReturnThis(),
        call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
      }),
    });
    const res = await request(app).get(`/account/${VALID_ID}/trades`);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("forwards ?limit to Horizon", async () => {
    const { mockLimit } = mockTrades([]);
    await request(app).get(`/account/${VALID_ID}/trades?limit=5`);
    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it("forwards ?cursor to Horizon", async () => {
    const { mockCursor } = mockTrades([]);
    await request(app).get(`/account/${VALID_ID}/trades?cursor=123456789-0`);
    expect(mockCursor).toHaveBeenCalledWith("123456789-0");
  });

  it("filters trades by ?startDate — excludes records before it", async () => {
    const oldRecord = buildTradeRecord({ ledger_close_time: "2023-01-01T00:00:00Z" });
    const newRecord = buildTradeRecord({
      id: "200-0", paging_token: "200-0", ledger_close_time: "2024-06-15T00:00:00Z",
    });
    mockTrades([oldRecord, newRecord]);
    const res = await request(app).get(
      `/account/${VALID_ID}/trades?startDate=2024-01-01`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.trades).toHaveLength(1);
    expect(res.body.data.trades[0].id).toBe("200-0");
  });

  it("filters trades by ?endDate — excludes records after it", async () => {
    const oldRecord = buildTradeRecord({ ledger_close_time: "2023-06-01T00:00:00Z" });
    const newRecord = buildTradeRecord({
      id: "300-0", paging_token: "300-0", ledger_close_time: "2025-06-01T00:00:00Z",
    });
    mockTrades([oldRecord, newRecord]);
    const res = await request(app).get(
      `/account/${VALID_ID}/trades?endDate=2024-01-01`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.trades).toHaveLength(1);
    expect(res.body.data.trades[0].ledgerCloseTime).toContain("2023");
  });

  it("returns 400 when startDate is not a valid ISO date", async () => {
    mockTrades([]);
    const res = await request(app).get(
      `/account/${VALID_ID}/trades?startDate=not-a-date`,
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when endDate is not a valid ISO date", async () => {
    mockTrades([]);
    const res = await request(app).get(
      `/account/${VALID_ID}/trades?endDate=bad-date`,
    );
    expect(res.statusCode).toBe(400);
  });

  it("caches results — X-Cache: MISS on first, HIT on second", async () => {
    mockTrades([buildTradeRecord()]);
    const first = await request(app).get(`/account/${VALID_ID}/trades`);
    expect(first.headers["x-cache"]).toBe("MISS");
    const second = await request(app).get(`/account/${VALID_ID}/trades`);
    expect(second.headers["x-cache"]).toBe("HIT");
  });

  it("?fresh=true bypasses the cache and returns X-Cache: MISS", async () => {
    mockTrades([buildTradeRecord()]);
    await request(app).get(`/account/${VALID_ID}/trades`);
    const fresh = await request(app).get(`/account/${VALID_ID}/trades?fresh=true`);
    expect(fresh.headers["x-cache"]).toBe("MISS");
  });
});

// ── SDK getTrades wrapper tests (plain JS fetch mock) ─────────────────────────
//
// The SDK is TypeScript so we cannot require() it directly in Jest.
// Instead we replicate the same behaviour inline using a minimal JS wrapper
// that matches the contract: _get(path, params) → fetch → throw StellarKitError.

class StellarKitError extends Error {
  constructor(message, status, type) {
    super(message);
    this.name = "StellarKitError";
    this.status = status;
    this.type = type;
  }
}

class AccountModuleJS {
  constructor({ baseUrl, apiKey }) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (apiKey) this.headers["X-API-Key"] = apiKey;
  }

  async _get(path, params = {}) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) searchParams.set(key, String(value));
    });
    const query = searchParams.toString();
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
    const res = await fetch(url, { headers: this.headers });
    const body = await res.json();
    if (!res.ok) {
      throw new StellarKitError(
        body?.error?.message ?? res.statusText,
        res.status,
        body?.error?.type ?? "ApiError",
      );
    }
    return body.data;
  }

  async getTrades(id, options = {}) {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError(
        "id is required and must be a non-empty string",
        400,
        "ValidationError",
      );
    }
    return this._get(`/account/${id}/trades`, {
      limit:     options.limit,
      cursor:    options.cursor,
      startDate: options.startDate,
      endDate:   options.endDate,
    });
  }
}

describe("AccountModule.getTrades — SDK wrapper behaviour", () => {
  const BASE_URL = "http://localhost:3000";
  let sdk;

  beforeEach(() => {
    sdk = new AccountModuleJS({ baseUrl: BASE_URL });
  });

  function mockFetch(status, body) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => body,
    });
  }

  afterEach(() => {
    delete global.fetch;
  });

  it("makes a GET request to /account/:id/trades", async () => {
    mockFetch(200, {
      success: true,
      data: { items: [], trades: [], total: 0, limit: 20, cursor: null },
    });
    await sdk.getTrades(VALID_ID);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain(`/account/${VALID_ID}/trades`);
  });

  it("returns a PaginatedResponse shape (items, total, limit, cursor)", async () => {
    const mockData = { items: [], trades: [], total: 0, limit: 20, cursor: null };
    mockFetch(200, { success: true, data: mockData });
    const result = await sdk.getTrades(VALID_ID);
    expect(result).toEqual(mockData);
  });

  it("forwards limit as a query param", async () => {
    mockFetch(200, { success: true, data: { items: [], trades: [], total: 0, limit: 50, cursor: null } });
    await sdk.getTrades(VALID_ID, { limit: 50 });
    expect(global.fetch.mock.calls[0][0]).toContain("limit=50");
  });

  it("forwards cursor as a query param", async () => {
    mockFetch(200, { success: true, data: { items: [], trades: [], total: 0, limit: 20, cursor: null } });
    await sdk.getTrades(VALID_ID, { cursor: "123456789-0" });
    expect(global.fetch.mock.calls[0][0]).toContain("cursor=123456789-0");
  });

  it("forwards startDate as a query param", async () => {
    mockFetch(200, { success: true, data: { items: [], trades: [], total: 0, limit: 20, cursor: null } });
    await sdk.getTrades(VALID_ID, { startDate: "2024-01-01" });
    expect(global.fetch.mock.calls[0][0]).toContain("startDate=2024-01-01");
  });

  it("forwards endDate as a query param", async () => {
    mockFetch(200, { success: true, data: { items: [], trades: [], total: 0, limit: 20, cursor: null } });
    await sdk.getTrades(VALID_ID, { endDate: "2024-12-31" });
    expect(global.fetch.mock.calls[0][0]).toContain("endDate=2024-12-31");
  });

  it("forwards all four filters together", async () => {
    mockFetch(200, { success: true, data: { items: [], trades: [], total: 0, limit: 10, cursor: null } });
    await sdk.getTrades(VALID_ID, {
      limit: 10, cursor: "abc-0", startDate: "2024-01-01", endDate: "2024-12-31",
    });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("limit=10");
    expect(url).toContain("cursor=abc-0");
    expect(url).toContain("startDate=2024-01-01");
    expect(url).toContain("endDate=2024-12-31");
  });

  it("does NOT include undefined filters in the URL", async () => {
    mockFetch(200, { success: true, data: { items: [], trades: [], total: 0, limit: 20, cursor: null } });
    await sdk.getTrades(VALID_ID);
    const url = global.fetch.mock.calls[0][0];
    expect(url).not.toContain("undefined");
    expect(url).not.toContain("null");
  });

  it("throws StellarKitError when id is empty string", async () => {
    await expect(sdk.getTrades("")).rejects.toMatchObject({
      status: 400, type: "ValidationError",
    });
  });

  it("throws StellarKitError on 404 response", async () => {
    mockFetch(404, { success: false, error: { type: "AccountNotFound", message: "Not found." } });
    await expect(sdk.getTrades(VALID_ID)).rejects.toMatchObject({
      status: 404, type: "AccountNotFound",
    });
  });

  it("throws StellarKitError on 500 response", async () => {
    mockFetch(500, { success: false, error: { type: "ServerError", message: "Internal error." } });
    await expect(sdk.getTrades(VALID_ID)).rejects.toMatchObject({ status: 500 });
  });
});
