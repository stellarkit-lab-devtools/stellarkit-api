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

