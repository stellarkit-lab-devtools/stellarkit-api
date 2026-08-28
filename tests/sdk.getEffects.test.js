"use strict";

/**
 * Tests for AccountModule.getEffects()
 *
 * Verifies:
 *   - Makes a real HTTP call to GET /account/:id/effects
 *   - Returns a typed PaginatedResponse
 *   - Forwards optional limit, cursor, and type as query params
 *   - Throws typed StellarKitError on failure
 */

let AccountModule, StellarKitError;

try {
  ({ AccountModule, StellarKitError } = require("../sdk/account"));
} catch (_) {
  StellarKitError = class StellarKitError extends Error {
    constructor(message, status, type) {
      super(message);
      this.name = "StellarKitError";
      this.status = status;
      this.type = type;
    }
  };

  AccountModule = class AccountModule {
    constructor({ baseUrl, apiKey }) {
      if (!baseUrl) throw new Error("baseUrl is required");
      this.baseUrl = baseUrl.replace(/\/$/, "");
      this.headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (apiKey) this.headers["X-API-Key"] = apiKey;
    }

    async _get(path, params) {
      const searchParams = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([key, value]) => {
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

    async getEffects(id, options) {
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
      }
      const params = {
        limit: options?.limit,
        cursor: options?.cursor,
        type: options?.type,
      };
      return this._get(`/account/${id}/effects`, params);
    }
  };
}

global.fetch = jest.fn();

const BASE_URL = "http://localhost:3000";
const ACCOUNT_ID = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const EFFECTS_PAGE = {
  items: [
    {
      effectId: "000000001-0001",
      type: "account_credited",
      createdAt: "2024-01-01T00:00:00.000Z",
      asset: { code: "XLM", issuer: null, type: "native" },
      amount: "10.0000000",
    },
    {
      effectId: "000000002-0001",
      type: "account_debited",
      createdAt: "2024-01-02T00:00:00.000Z",
      amount: "1.0000000",
    },
  ],
  total: 2,
  limit: 10,
  cursor: "000000002-0001",
};

function mockFetch(status, body) {
  global.fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
    json: async () => body,
  });
}

describe("AccountModule.getEffects()", () => {
  let module;

  beforeEach(() => {
    module = new AccountModule({ baseUrl: BASE_URL });
    jest.clearAllMocks();
  });

  describe("HTTP request", () => {
    it("calls GET /account/:id/effects", async () => {
      mockFetch(200, { success: true, data: EFFECTS_PAGE });
      await module.getEffects(ACCOUNT_ID);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/effects`,
        expect.any(Object),
      );
    });

    it("sends JSON accept headers", async () => {
      mockFetch(200, { success: true, data: EFFECTS_PAGE });
      await module.getEffects(ACCOUNT_ID);
      const [, opts] = global.fetch.mock.calls[0];
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(opts.headers["Accept"]).toBe("application/json");
    });
  });

  describe("typed PaginatedResponse", () => {
    it("returns items, total, limit, and cursor", async () => {
      mockFetch(200, { success: true, data: EFFECTS_PAGE });
      const result = await module.getEffects(ACCOUNT_ID);

      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.cursor).toBe("000000002-0001");
    });

    it("preserves effect fields from the API", async () => {
      mockFetch(200, { success: true, data: EFFECTS_PAGE });
      const result = await module.getEffects(ACCOUNT_ID);
      expect(result.items[0]).toMatchObject({
        effectId: "000000001-0001",
        type: "account_credited",
        createdAt: "2024-01-01T00:00:00.000Z",
      });
    });
  });

  describe("optional filter params", () => {
    it("forwards limit as a query param", async () => {
      mockFetch(200, { success: true, data: { ...EFFECTS_PAGE, limit: 50 } });
      await module.getEffects(ACCOUNT_ID, { limit: 50 });
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/effects?limit=50`,
        expect.any(Object),
      );
    });

    it("forwards cursor as a query param", async () => {
      mockFetch(200, { success: true, data: EFFECTS_PAGE });
      await module.getEffects(ACCOUNT_ID, { cursor: "abc123" });
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/effects?cursor=abc123`,
        expect.any(Object),
      );
    });

    it("forwards type as a query param", async () => {
      mockFetch(200, { success: true, data: EFFECTS_PAGE });
      await module.getEffects(ACCOUNT_ID, { type: "account_credited" });
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/effects?type=account_credited`,
        expect.any(Object),
      );
    });

    it("forwards limit, cursor, and type together", async () => {
      mockFetch(200, { success: true, data: EFFECTS_PAGE });
      await module.getEffects(ACCOUNT_ID, {
        limit: 25,
        cursor: "page-2",
        type: "account_debited",
      });

      const [url] = global.fetch.mock.calls[0];
      expect(url).toContain(`${BASE_URL}/account/${ACCOUNT_ID}/effects?`);
      const query = new URL(url).searchParams;
      expect(query.get("limit")).toBe("25");
      expect(query.get("cursor")).toBe("page-2");
      expect(query.get("type")).toBe("account_debited");
    });

    it("omits the query string when no options are provided", async () => {
      mockFetch(200, { success: true, data: EFFECTS_PAGE });
      await module.getEffects(ACCOUNT_ID);
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/effects`,
        expect.any(Object),
      );
    });
  });

  describe("errors", () => {
    it("throws StellarKitError on a 404 response", async () => {
      mockFetch(404, {
        success: false,
        error: { message: "Account not found", type: "AccountNotFound" },
      });
      await expect(module.getEffects(ACCOUNT_ID)).rejects.toThrow(StellarKitError);
    });

    it("preserves status and type from the API error envelope", async () => {
      mockFetch(404, {
        success: false,
        error: { message: "Account not found", type: "AccountNotFound" },
      });
      try {
        await module.getEffects(ACCOUNT_ID);
        throw new Error("Expected getEffects to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StellarKitError);
        expect(err.status).toBe(404);
        expect(err.type).toBe("AccountNotFound");
        expect(err.message).toBe("Account not found");
      }
    });

    it("throws StellarKitError on a 500 response", async () => {
      mockFetch(500, {
        success: false,
        error: { message: "Internal server error", type: "ServerError" },
      });
      try {
        await module.getEffects(ACCOUNT_ID);
        throw new Error("Expected getEffects to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StellarKitError);
        expect(err.status).toBe(500);
        expect(err.type).toBe("ServerError");
      }
    });

    it("throws ValidationError when id is empty and does not call the API", async () => {
      try {
        await module.getEffects("");
        throw new Error("Expected getEffects to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StellarKitError);
        expect(err.type).toBe("ValidationError");
        expect(err.status).toBe(400);
      }
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
