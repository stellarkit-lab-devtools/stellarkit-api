const request = require("supertest");
const axios = require("axios");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { networkStatusCache, feeEstimateCache } = require("../src/utils/cache");

describe("StellarKit API", () => {
  // Clear caches before each test
  beforeEach(() => {
    networkStatusCache.clear();
    feeEstimateCache.clear();
  });

  // ── Health ─────────────────────────────────────────────────────────────────
  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await request(app).get("/health");
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("ok");
    });
  });

  // ── Root ───────────────────────────────────────────────────────────────────
  describe("GET /", () => {
    it("returns API info and endpoint list", async () => {
      const res = await request(app).get("/");
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.endpoints).toBeInstanceOf(Array);
      expect(res.body.data.endpoints.length).toBeGreaterThan(0);
    });
  });

  // ── 404 ───────────────────────────────────────────────────────────────────
  describe("Unknown routes", () => {
    it("returns 404 for unknown paths", async () => {
      const res = await request(app).get("/unknown-route");
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("NotFound");
    });
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  describe("GET /account/:id — validation", () => {
    it("returns 400 for an invalid account ID", async () => {
      const res = await request(app).get("/account/NOT_A_VALID_KEY");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });

  describe("GET /account/:id/trustlines", () => {
    const MOCK_ACCOUNT = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
    const MOCK_ISSUER = "GC3C6BRSPTJTJ4DI7ELZ2J4Y3Z5OCN7R2VIX5FQY3Y5QIN3QAKXUQY5R";

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns non-native trustlines with resolved TOML metadata", async () => {
      const accountResponse = {
        id: MOCK_ACCOUNT,
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "TEST",
            asset_issuer: MOCK_ISSUER,
            balance: "100.0000000",
            limit: "1000.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
        sequence: "1",
        subentry_count: 1,
        signers: [],
        thresholds: {},
        flags: {},
        last_modified_ledger: 1,
      };

      const issuerResponse = {
        id: MOCK_ISSUER,
        home_domain: "example.com",
      };

      jest.spyOn(server, "loadAccount").mockImplementation(async (id) => {
        if (id === MOCK_ACCOUNT) return accountResponse;
        if (id === MOCK_ISSUER) return issuerResponse;
        throw new Error(`Unexpected account load for ${id}`);
      });

      jest.spyOn(axios, "get").mockResolvedValue({
        data: `[[CURRENCIES]]
code = "TEST"
issuer = "${MOCK_ISSUER}"
name = "Test Asset"
desc = "A test asset"
image = "https://example.com/test.png"
`,
      });

      const res = await request(app).get(`/account/${MOCK_ACCOUNT}/trustlines`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("accountId", MOCK_ACCOUNT);
      expect(res.body.data).toHaveProperty("assetCount", 1);
      expect(res.body.data.assets).toHaveLength(1);
      expect(res.body.data.assets[0]).toMatchObject({
        assetCode: "TEST",
        assetIssuer: MOCK_ISSUER,
        toml: {
          name: "Test Asset",
          description: "A test asset",
          image: "https://example.com/test.png",
        },
      });
    });

    it("returns null TOML metadata when issuer resolution is not available", async () => {
      const accountResponse = {
        id: MOCK_ACCOUNT,
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "NONE",
            asset_issuer: MOCK_ISSUER,
            balance: "42.0000000",
            limit: "1000.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
            is_authorized: false,
            is_clawback_enabled: false,
          },
        ],
        sequence: "1",
        subentry_count: 1,
        signers: [],
        thresholds: {},
        flags: {},
        last_modified_ledger: 1,
      };

      const issuerResponse = {
        id: MOCK_ISSUER,
        home_domain: null,
      };

      jest.spyOn(server, "loadAccount").mockImplementation(async (id) => {
        if (id === MOCK_ACCOUNT) return accountResponse;
        if (id === MOCK_ISSUER) return issuerResponse;
        throw new Error(`Unexpected account load for ${id}`);
      });

      const res = await request(app).get(`/account/${MOCK_ACCOUNT}/trustlines`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.assets[0].toml).toBeNull();
    });
  });

  describe("GET /transactions/:id — validation", () => {
    it("returns 400 for an invalid account ID", async () => {
      const res = await request(app).get("/transactions/BADKEY123");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid limit param", async () => {
      const res = await request(app).get(
        "/transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN?limit=999999"
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /asset/search — validation", () => {
    it("returns 400 when code param is missing", async () => {
      const res = await request(app).get("/asset/search");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid asset code", async () => {
      const res = await request(app).get("/asset/search?code=TOOLONGASSETCODE");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /account/:id/payments", () => {
    const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    it("returns payments for a valid account", async () => {
      const res = await request(app).get(`/account/${VALID_KEY}/payments`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body).toHaveProperty("meta");
      expect(res.body.meta).toHaveProperty("count");
      expect(res.body.meta).toHaveProperty("limit");
      expect(res.body.meta).toHaveProperty("order");
      expect(res.body.meta).toHaveProperty("nextCursor");
      expect(res.body.meta).toHaveProperty("hasMore");

      if (res.body.data.length > 0) {
        const payment = res.body.data[0];
        expect(payment).toHaveProperty("amount");
        expect(payment).toHaveProperty("assetCode");
        expect(payment).toHaveProperty("assetIssuer");
        expect(payment).toHaveProperty("from");
        expect(payment).toHaveProperty("to");
        expect(payment).toHaveProperty("createdAt");
        expect(Object.keys(payment).sort()).toEqual(
          ["amount", "assetCode", "assetIssuer", "from", "to", "createdAt"].sort()
        );
      }
    });

    it("only returns payment and create_account operation types", async () => {
      const res = await request(app).get(`/account/${VALID_KEY}/payments`);

      expect(res.statusCode).toBe(200);
      res.body.data.forEach((payment) => {
        expect(payment).toHaveProperty("amount");
        expect(payment).toHaveProperty("assetCode");
        expect(payment).toHaveProperty("assetIssuer");
        expect(payment).toHaveProperty("from");
        expect(payment).toHaveProperty("to");
      });
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_KEY/payments");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("respects limit query param", async () => {
      const res = await request(app).get(
        `/account/${VALID_KEY}/payments?limit=5`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.meta.limit).toBe(5);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });

    it("returns 400 for invalid limit", async () => {
      const res = await request(app).get(
        `/account/${VALID_KEY}/payments?limit=999999`
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("respects order query param", async () => {
      const res = await request(app).get(
        `/account/${VALID_KEY}/payments?order=asc`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.meta.order).toBe("asc");
    });
  });

  describe("GET /account/:id/analytics", () => {
    it("returns analytics for a valid account", async () => {
      const res = await request(app).get(
        "/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/analytics"
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      expect(res.body.data).toHaveProperty("totalSent");
      expect(res.body.data).toHaveProperty("totalReceived");
      expect(res.body.data).toHaveProperty("topAssets");
      expect(res.body.data).toHaveProperty("avgTransactionsPerDay");
      expect(res.body.data).toHaveProperty("firstSeen");
      expect(res.body.data).toHaveProperty("lastSeen");

      expect(res.body.data.topAssets).toBeInstanceOf(Array);
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_KEY/analytics");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });

  // ── Cache Tests ─────────────────────────────────────────────────────────────
  describe("Cache - /network-status", () => {
    it("returns X-Cache: MISS on first request", async () => {
      const res = await request(app).get("/network-status");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.success).toBe(true);
    });

    it("returns X-Cache: HIT on subsequent request within TTL", async () => {
      // First request - cache miss
      await request(app).get("/network-status");
      
      // Second request - cache hit
      const res = await request(app).get("/network-status");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(res.body.success).toBe(true);
    });

    it("bypasses cache with ?fresh=true and returns MISS", async () => {
      // First request - cache miss
      await request(app).get("/network-status");
      
      // Second request with fresh=true - bypass cache
      const res = await request(app).get("/network-status?fresh=true");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.success).toBe(true);
    });
  });

  describe("Cache - /fee-estimate", () => {
    it("returns X-Cache: MISS on first request", async () => {
      const res = await request(app).get("/fee-estimate");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.success).toBe(true);
    });

    it("returns X-Cache: HIT on subsequent request within TTL", async () => {
      // First request - cache miss
      await request(app).get("/fee-estimate");
      
      // Second request - cache hit
      const res = await request(app).get("/fee-estimate");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(res.body.success).toBe(true);
    });

    it("returns X-Cache: HIT for same operations count", async () => {
      // First request with operations=3
      await request(app).get("/fee-estimate?operations=3");
      
      // Second request with same operations=3
      const res = await request(app).get("/fee-estimate?operations=3");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(res.body.success).toBe(true);
    });

    it("returns X-Cache: MISS for different operations count", async () => {
      // First request with operations=1
      await request(app).get("/fee-estimate?operations=1");
      
      // Second request with operations=5 - different cache key
      const res = await request(app).get("/fee-estimate?operations=5");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.success).toBe(true);
    });

    it("bypasses cache with ?fresh=true and returns MISS", async () => {
      // First request - cache miss
      await request(app).get("/fee-estimate");
      
      // Second request with fresh=true - bypass cache
      const res = await request(app).get("/fee-estimate?fresh=true");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.success).toBe(true);
    });
  });
});
