const request = require("supertest");
const app = require("../src/index");
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

  describe("GET /account/:id/offers", () => {
    const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    it("returns open offers for a valid account", async () => {
      const res = await request(app).get(`/account/${VALID_KEY}/offers`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body).toHaveProperty("meta");
      expect(res.body.meta).toHaveProperty("count");
      expect(res.body.meta).toHaveProperty("limit");
      expect(res.body.meta).toHaveProperty("nextCursor");
      expect(res.body.meta).toHaveProperty("hasMore");
      expect(typeof res.body.meta.hasMore).toBe("boolean");

      if (res.body.data.length > 0) {
        const offer = res.body.data[0];
        expect(offer).toHaveProperty("id");
        expect(offer).toHaveProperty("selling");
        expect(offer).toHaveProperty("buying");
        expect(offer).toHaveProperty("price");
        expect(offer).toHaveProperty("lastModifiedLedger");
        expect(offer.selling).toHaveProperty("assetType");
        expect(offer.selling).toHaveProperty("assetCode");
        expect(offer.selling).toHaveProperty("assetIssuer");
        expect(offer.selling).toHaveProperty("amount");
        expect(offer.buying).toHaveProperty("assetType");
        expect(offer.buying).toHaveProperty("assetCode");
        expect(offer.buying).toHaveProperty("assetIssuer");
      }
    });

    it("respects limit query param", async () => {
      const res = await request(app).get(
        `/account/${VALID_KEY}/offers?limit=1`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta.limit).toBe(1);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_KEY/offers");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
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
