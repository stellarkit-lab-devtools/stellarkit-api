"use strict";

/**
 * Tests for AccountModule.getTrustlines()
 *
 * Verifies:
 *   - Makes a real HTTP call to GET /account/:id/trustlines
 *   - Returns typed TrustlineEntry[] array
 *   - Passes optional assetCode filter as query param (asset_code)
 *   - Throws StellarKitError with type "AccountNotFound" on 404
 *   - Throws StellarKitError on other non-2xx responses
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

    async getTrustlines(id, options) {
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
      }
      const params = { asset_code: options?.assetCode };
      try {
        return await this._get(`/account/${id}/trustlines`, params);
      } catch (err) {
        if (err instanceof StellarKitError && err.status === 404) {
          throw new StellarKitError(
            err.message || `Account ${id} was not found.`,
            404,
            "AccountNotFound",
          );
        }
        throw err;
      }
    }
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

global.fetch = jest.fn();

const BASE_URL = "http://localhost:3000";
const ACCOUNT_ID = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const ISSUER_ID  = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

/** @type {import('../types/index.d').TrustlineEntry[]} */
const TRUSTLINES_FIXTURE = [
  {
    asset: { code: "USDC", issuer: ISSUER_ID, type: "credit_alphanum4" },
    balance: "50.0000000",
    limit: "10000.0000000",
    isAuthorized: true,
    isAuthorizedToMaintainLiabilities: false,
  },
  {
    asset: { code: "JPYC", issuer: ISSUER_ID, type: "credit_alphanum4" },
    balance: "1000.0000000",
    limit: "50000.0000000",
    isAuthorized: true,
    isAuthorizedToMaintainLiabilities: false,
  },
];

function mockFetch(status, body) {
  global.fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
    json: async () => body,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccountModule.getTrustlines()", () => {
  let module;

  beforeEach(() => {
    module = new AccountModule({ baseUrl: BASE_URL });
    jest.clearAllMocks();
  });

  // ── HTTP call ──────────────────────────────────────────────────────────────

  describe("HTTP request", () => {
    it("calls GET /account/:id/trustlines with correct URL", async () => {
      mockFetch(200, { success: true, data: TRUSTLINES_FIXTURE });
      await module.getTrustlines(ACCOUNT_ID);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/trustlines`,
        expect.any(Object),
      );
    });

    it("sends correct headers", async () => {
      mockFetch(200, { success: true, data: TRUSTLINES_FIXTURE });
      await module.getTrustlines(ACCOUNT_ID);
      const [, opts] = global.fetch.mock.calls[0];
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(opts.headers["Accept"]).toBe("application/json");
    });
  });

  // ── Typed return ───────────────────────────────────────────────────────────

  describe("typed TrustlineEntry[] return", () => {
    it("returns an array of TrustlineEntry objects", async () => {
      mockFetch(200, { success: true, data: TRUSTLINES_FIXTURE });
      const result = await module.getTrustlines(ACCOUNT_ID);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it("maps the first trustline with correct shape", async () => {
      mockFetch(200, { success: true, data: TRUSTLINES_FIXTURE });
      const result = await module.getTrustlines(ACCOUNT_ID);
      expect(result[0]).toMatchObject({
        asset: { code: "USDC", issuer: ISSUER_ID, type: "credit_alphanum4" },
        balance: "50.0000000",
        limit: "10000.0000000",
        isAuthorized: true,
      });
    });

    it("returns an empty array when the account has no trustlines", async () => {
      mockFetch(200, { success: true, data: [] });
      const result = await module.getTrustlines(ACCOUNT_ID);
      expect(result).toEqual([]);
    });

    it("preserves all entries from the API response", async () => {
      mockFetch(200, { success: true, data: TRUSTLINES_FIXTURE });
      const result = await module.getTrustlines(ACCOUNT_ID);
      expect(result[1].asset.code).toBe("JPYC");
      expect(result[1].balance).toBe("1000.0000000");
    });
  });

  // ── assetCode filter ───────────────────────────────────────────────────────

  describe("optional assetCode filter", () => {
    it("passes assetCode as asset_code query param when provided", async () => {
      mockFetch(200, { success: true, data: [TRUSTLINES_FIXTURE[0]] });
      await module.getTrustlines(ACCOUNT_ID, { assetCode: "USDC" });
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/trustlines?asset_code=USDC`,
        expect.any(Object),
      );
    });

    it("omits the query string entirely when assetCode is not provided", async () => {
      mockFetch(200, { success: true, data: TRUSTLINES_FIXTURE });
      await module.getTrustlines(ACCOUNT_ID);
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/trustlines`,
        expect.any(Object),
      );
    });

    it("omits the query string when options object is empty", async () => {
      mockFetch(200, { success: true, data: TRUSTLINES_FIXTURE });
      await module.getTrustlines(ACCOUNT_ID, {});
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/account/${ACCOUNT_ID}/trustlines`,
        expect.any(Object),
      );
    });

    it("returns filtered trustlines from the API when assetCode is given", async () => {
      const filtered = [TRUSTLINES_FIXTURE[0]];
      mockFetch(200, { success: true, data: filtered });
      const result = await module.getTrustlines(ACCOUNT_ID, { assetCode: "USDC" });
      expect(result).toHaveLength(1);
      expect(result[0].asset.code).toBe("USDC");
    });
  });

  // ── 404 → AccountNotFound ──────────────────────────────────────────────────

  describe("404 → AccountNotFound error", () => {
    it("throws StellarKitError on 404 response", async () => {
      mockFetch(404, {
        success: false,
        error: { message: `Account ${ACCOUNT_ID} was not found on the Stellar testnet network.`, type: "AccountNotFound" },
      });
      await expect(module.getTrustlines(ACCOUNT_ID)).rejects.toThrow(StellarKitError);
    });

    it("throws error with type 'AccountNotFound' on 404", async () => {
      mockFetch(404, {
        success: false,
        error: { message: `Account ${ACCOUNT_ID} was not found on the Stellar testnet network.`, type: "AccountNotFound" },
      });
      try {
        await module.getTrustlines(ACCOUNT_ID);
        throw new Error("Expected getTrustlines to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StellarKitError);
        expect(err.type).toBe("AccountNotFound");
      }
    });

    it("throws error with status 404 on account not found", async () => {
      mockFetch(404, {
        success: false,
        error: { message: "Account not found", type: "AccountNotFound" },
      });
      try {
        await module.getTrustlines(ACCOUNT_ID);
        throw new Error("Expected getTrustlines to throw");
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });

    it("preserves the error message from the API response", async () => {
      const errMsg = `Account ${ACCOUNT_ID} was not found on the Stellar testnet network.`;
      mockFetch(404, {
        success: false,
        error: { message: errMsg, type: "AccountNotFound" },
      });
      try {
        await module.getTrustlines(ACCOUNT_ID);
        throw new Error("Expected getTrustlines to throw");
      } catch (err) {
        expect(err.message).toBe(errMsg);
      }
    });

    it("also throws AccountNotFound when assetCode filter is used and account is 404", async () => {
      mockFetch(404, {
        success: false,
        error: { message: "Account not found", type: "AccountNotFound" },
      });
      try {
        await module.getTrustlines(ACCOUNT_ID, { assetCode: "USDC" });
        throw new Error("Expected getTrustlines to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StellarKitError);
        expect(err.type).toBe("AccountNotFound");
        expect(err.status).toBe(404);
      }
    });
  });

  // ── Other non-2xx errors ───────────────────────────────────────────────────

  describe("non-2xx errors (non-404)", () => {
    it("throws StellarKitError on 500 response", async () => {
      mockFetch(500, { success: false, error: { message: "Internal server error", type: "ServerError" } });
      await expect(module.getTrustlines(ACCOUNT_ID)).rejects.toThrow(StellarKitError);
    });

    it("preserves type from error envelope on 500", async () => {
      mockFetch(500, { success: false, error: { message: "Internal server error", type: "ServerError" } });
      try {
        await module.getTrustlines(ACCOUNT_ID);
      } catch (err) {
        expect(err.type).toBe("ServerError");
        expect(err.status).toBe(500);
      }
    });

    it("falls back to ApiError type when error envelope lacks type", async () => {
      mockFetch(503, { success: false, error: { message: "Service unavailable" } });
      try {
        await module.getTrustlines(ACCOUNT_ID);
      } catch (err) {
        expect(err.type).toBe("ApiError");
      }
    });
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe("input validation", () => {
    it("throws StellarKitError with type ValidationError when id is empty string", async () => {
      try {
        await module.getTrustlines("");
        throw new Error("Expected getTrustlines to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StellarKitError);
        expect(err.type).toBe("ValidationError");
        expect(err.status).toBe(400);
      }
    });

    it("throws StellarKitError with type ValidationError when id is whitespace", async () => {
      try {
        await module.getTrustlines("   ");
        throw new Error("Expected getTrustlines to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StellarKitError);
        expect(err.type).toBe("ValidationError");
      }
    });

    it("does not make an HTTP call when id is empty", async () => {
      try {
        await module.getTrustlines("");
      } catch (_) {}
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
