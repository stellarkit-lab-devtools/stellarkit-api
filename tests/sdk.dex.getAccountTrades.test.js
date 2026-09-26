"use strict";

/**
 * Tests for the SDK DexModule.getAccountTrades wrapper.
 *
 * The SDK is TypeScript so we cannot require() it directly in Jest.
 * Following the convention in tests/account.getTrades.test.js, we replicate the
 * same contract inline using a minimal JS wrapper:
 *   DexModule._get(path, params) -> fetch -> throw StellarKitError
 *   DexModule.getAccountTrades(id, options) -> GET /account/:id/trades
 *
 * Verifies:
 *   - Makes a GET request to /account/:id/trades
 *   - Forwards limit/cursor as query params only when provided
 *   - Omits undefined params from the URL
 *   - Returns the PaginatedResponse<Trade> shape (items, total, limit, cursor)
 *   - Throws StellarKitError on empty id (ValidationError, 400)
 *   - Throws StellarKitError on non-2xx responses
 */

class StellarKitError extends Error {
  constructor(message, status, type) {
    super(message);
    this.name = "StellarKitError";
    this.status = status;
    this.type = type;
  }
}

class DexModuleJS {
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

  async getAccountTrades(id, options = {}) {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError(
        "id is required and must be a non-empty string",
        400,
        "ValidationError",
      );
    }
    return this._get(`/account/${id}/trades`, {
      limit: options.limit,
      cursor: options.cursor,
    });
  }
}

const VALID_ID = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function buildTrade(overrides = {}) {
  return {
    tradeId: "123456789-0",
    ledgerCloseTime: "2024-06-01T12:00:00Z",
    selling: { code: "XLM", issuer: null, type: "native" },
    buying: {
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      type: "credit_alphanum4",
    },
    soldAmount: "10.0000000",
    boughtAmount: "50.0000000",
    price: "5.0000000",
    offerId: "42",
    ...overrides,
  };
}

describe("DexModule.getAccountTrades — SDK wrapper behaviour", () => {
  const BASE_URL = "http://localhost:3000";
  let sdk;

  beforeEach(() => {
    sdk = new DexModuleJS({ baseUrl: BASE_URL });
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
      data: { items: [], total: 0, limit: 20, cursor: null },
    });
    await sdk.getAccountTrades(VALID_ID);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(`${BASE_URL}/account/${VALID_ID}/trades`);
  });

  it("forwards limit as a query param when provided", async () => {
    mockFetch(200, { success: true, data: { items: [], total: 0, limit: 50, cursor: null } });
    await sdk.getAccountTrades(VALID_ID, { limit: 50 });
    expect(global.fetch.mock.calls[0][0]).toContain("limit=50");
  });

  it("forwards cursor as a query param when provided", async () => {
    mockFetch(200, { success: true, data: { items: [], total: 0, limit: 20, cursor: null } });
    await sdk.getAccountTrades(VALID_ID, { cursor: "123456789-0" });
    expect(global.fetch.mock.calls[0][0]).toContain("cursor=123456789-0");
  });

  it("forwards limit and cursor together", async () => {
    mockFetch(200, { success: true, data: { items: [], total: 0, limit: 10, cursor: null } });
    await sdk.getAccountTrades(VALID_ID, { limit: 10, cursor: "abc-0" });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("limit=10");
    expect(url).toContain("cursor=abc-0");
  });

  it("does NOT include undefined params in the URL", async () => {
    mockFetch(200, { success: true, data: { items: [], total: 0, limit: 20, cursor: null } });
    await sdk.getAccountTrades(VALID_ID);
    const url = global.fetch.mock.calls[0][0];
    expect(url).not.toContain("?");
    expect(url).not.toContain("undefined");
    expect(url).not.toContain("null");
  });

  it("does NOT include a provided-only limit when only cursor is set", async () => {
    mockFetch(200, { success: true, data: { items: [], total: 0, limit: 20, cursor: null } });
    await sdk.getAccountTrades(VALID_ID, { cursor: "c-1" });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("cursor=c-1");
    expect(url).not.toContain("limit=");
  });

  it("returns the PaginatedResponse<Trade> shape", async () => {
    const trade = buildTrade();
    const mockData = { items: [trade], total: 1, limit: 20, cursor: "next-cursor" };
    mockFetch(200, { success: true, data: mockData });
    const result = await sdk.getAccountTrades(VALID_ID);
    expect(result).toEqual(mockData);
    expect(result.items[0]).toMatchObject({
      tradeId: "123456789-0",
      ledgerCloseTime: "2024-06-01T12:00:00Z",
      selling: { code: "XLM", issuer: null, type: "native" },
      buying: { code: "USDC", type: "credit_alphanum4" },
      soldAmount: "10.0000000",
      boughtAmount: "50.0000000",
      price: "5.0000000",
      offerId: "42",
    });
    expect(typeof result.total).toBe("number");
    expect(typeof result.limit).toBe("number");
    expect(result.cursor).toBe("next-cursor");
  });

  it("throws StellarKitError when id is missing", async () => {
    await expect(sdk.getAccountTrades()).rejects.toMatchObject({
      name: "StellarKitError",
      status: 400,
      type: "ValidationError",
    });
  });

  it("throws StellarKitError when id is empty string", async () => {
    await expect(sdk.getAccountTrades("")).rejects.toMatchObject({
      name: "StellarKitError",
      status: 400,
      type: "ValidationError",
    });
  });

  it("throws StellarKitError when id is whitespace only", async () => {
    await expect(sdk.getAccountTrades("   ")).rejects.toMatchObject({
      status: 400,
      type: "ValidationError",
    });
  });

  it("throws StellarKitError on a 404 response", async () => {
    mockFetch(404, {
      success: false,
      error: { type: "AccountNotFound", message: "Account not found." },
    });
    await expect(sdk.getAccountTrades(VALID_ID)).rejects.toMatchObject({
      name: "StellarKitError",
      status: 404,
      type: "AccountNotFound",
    });
  });

  it("throws StellarKitError on a 500 response", async () => {
    mockFetch(500, {
      success: false,
      error: { type: "ServerError", message: "Internal error." },
    });
    await expect(sdk.getAccountTrades(VALID_ID)).rejects.toMatchObject({
      name: "StellarKitError",
      status: 500,
      type: "ServerError",
    });
  });
});
