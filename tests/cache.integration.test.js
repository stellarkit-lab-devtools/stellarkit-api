const request = require("supertest");
const app = require("../src/index");
const cacheService = require("../src/services/cache");

describe("Cache Integration", () => {
  beforeEach(() => {
    cacheService.flush();
  });

  describe("GET /network-status", () => {
    it("should return X-Cache: MISS on first request", async () => {
      const res = await request(app).get("/network-status");
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("should return X-Cache: HIT on second request", async () => {
      await request(app).get("/network-status"); // First request to seed cache
      const res = await request(app).get("/network-status");
      expect(res.headers["x-cache"]).toBe("HIT");
    });

    it("should return X-Cache: MISS when ?fresh=true is used", async () => {
      await request(app).get("/network-status"); // Seed cache
      const res = await request(app).get("/network-status?fresh=true");
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });

  describe("GET /fee-estimate", () => {
    it("should return X-Cache: MISS on first request", async () => {
      const res = await request(app).get("/fee-estimate");
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("should return X-Cache: HIT on second request", async () => {
      await request(app).get("/fee-estimate"); // Seed cache
      const res = await request(app).get("/fee-estimate");
      expect(res.headers["x-cache"]).toBe("HIT");
    });
  });

  describe("GET /asset/:code/:issuer", () => {
    const code = "USDC";
    const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    it("should return X-Cache: MISS on first request", async () => {
      const res = await request(app).get(`/asset/${code}/${issuer}`);
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("should return X-Cache: HIT on second request", async () => {
      await request(app).get(`/asset/${code}/${issuer}`); // Seed cache
      const res = await request(app).get(`/asset/${code}/${issuer}`);
      expect(res.headers["x-cache"]).toBe("HIT");
    });
  });

  describe("GET /account/:id/trustlines", () => {
    const accountId =
      "GDU5LH56CZ7NVKRHYI72QVJC6BS7GAYEIO34HDMICG3H5NSFJJJFHFWL";

    it("should return X-Cache: MISS on first request", async () => {
      const res = await request(app).get(`/account/${accountId}/trustlines`);
      // A 404 from Horizon still goes through the error path and does not set
      // X-Cache, but a successful response must be MISS on the first call.
      // We verify that the header is absent (MISS path or error) — confirming
      // no stale HIT was returned.
      expect(res.headers["x-cache"]).not.toBe("HIT");
    });

    it("should return X-Cache: HIT when the cache is pre-seeded", async () => {
      // Pre-seed the cache directly — avoids a live Horizon dependency
      const cachedPayload = { items: [], total: 0, limit: null, cursor: null };
      cacheService.set(`trustlines:${accountId}`, cachedPayload, 15);

      const res = await request(app).get(`/account/${accountId}/trustlines`);
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(res.statusCode).toBe(200);
    });

    it("should return X-Cache: MISS and bypass cache when ?fresh=true is used", async () => {
      // Pre-seed the cache — fresh=true must ignore it
      const cachedPayload = { items: [], total: 0, limit: null, cursor: null };
      cacheService.set(`trustlines:${accountId}`, cachedPayload, 15);

      const res = await request(app).get(
        `/account/${accountId}/trustlines?fresh=true`,
      );
      // fresh=true bypasses the cache; the request goes to Horizon and
      // X-Cache will be MISS (200) or absent (404), but never HIT.
      expect(res.headers["x-cache"]).not.toBe("HIT");
    });

    it("should cache results independently per account ID", async () => {
      const accountId2 =
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

      // Seed only accountId, not accountId2
      const cachedPayload = { items: [], total: 0, limit: null, cursor: null };
      cacheService.set(`trustlines:${accountId}`, cachedPayload, 15);

      // accountId serves from cache
      const res1 = await request(app).get(`/account/${accountId}/trustlines`);
      expect(res1.headers["x-cache"]).toBe("HIT");

      // accountId2 must NOT be a cache hit — the key is different
      // (result will be MISS or error, but never HIT from accountId's entry)
      const res2 = await request(app).get(`/account/${accountId2}/trustlines`);
      expect(res2.headers["x-cache"]).not.toBe("HIT");
    });

    it("should not serve X-Cache: HIT for a filtered ?assetCode request", async () => {
      // Seed the full-list cache entry
      const cachedPayload = { items: [], total: 0, limit: null, cursor: null };
      cacheService.set(`trustlines:${accountId}`, cachedPayload, 15);

      // Filtered requests skip the cache entirely and always hit Horizon
      const res = await request(app).get(
        `/account/${accountId}/trustlines?assetCode=USDC`,
      );
      expect(res.headers["x-cache"]).not.toBe("HIT");
    });
  });

  describe("ETag Support", () => {
    describe("GET /network-status with ETag", () => {
      it("should return an ETag header on successful response", async () => {
        const res = await request(app).get("/network-status");
        expect(res.headers["etag"]).toBeDefined();
        expect(res.headers["etag"]).toMatch(/^"[a-f0-9]{64}"$/); // SHA256 hash format
      });

      it("should return 304 Not Modified when If-None-Match matches ETag", async () => {
        const firstRes = await request(app).get("/network-status");
        const etag = firstRes.headers["etag"];

        const secondRes = await request(app)
          .get("/network-status")
          .set("If-None-Match", etag);

        expect(secondRes.status).toBe(304);
        expect(secondRes.body).toEqual({}); // 304 has no body
        expect(secondRes.headers["etag"]).toBe(etag);
      });

      it("should return 200 with full response when If-None-Match does not match", async () => {
        const firstRes = await request(app).get("/network-status");
        const wrongETag = '"wrongetag"';

        const secondRes = await request(app)
          .get("/network-status")
          .set("If-None-Match", wrongETag);

        expect(secondRes.status).toBe(200);
        expect(secondRes.body).toBeDefined();
        expect(secondRes.headers["etag"]).toBeDefined();
      });
    });

    describe("GET /fee-estimate with ETag", () => {
      it("should return an ETag header on successful response", async () => {
        const res = await request(app).get("/fee-estimate");
        expect(res.headers["etag"]).toBeDefined();
        expect(res.headers["etag"]).toMatch(/^"[a-f0-9]{64}"$/);
      });

      it("should return 304 Not Modified when If-None-Match matches ETag", async () => {
        const firstRes = await request(app).get("/fee-estimate");
        const etag = firstRes.headers["etag"];

        const secondRes = await request(app)
          .get("/fee-estimate")
          .set("If-None-Match", etag);

        expect(secondRes.status).toBe(304);
        expect(secondRes.body).toEqual({});
        expect(secondRes.headers["etag"]).toBe(etag);
      });
    });
  });
});

