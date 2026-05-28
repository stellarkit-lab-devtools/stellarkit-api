const request = require("supertest");
const app = require("../src/index");
const { networkStatusCache, feeEstimateCache } = require("../src/utils/cache");
const { server } = require("../src/config/stellar");

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

  describe("Content-Type validation", () => {
    it("returns 400 when a POST request sends a non-JSON body", async () => {
      const res = await request(app)
        .post("/future-route")
        .set("Content-Type", "text/plain")
        .send("not json");

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: {
          type: "ValidationError",
          message: "Content-Type must be application/json for requests with a body.",
        },
      });
    });
  });

  describe("GET /account/:id/balances", () => {
    const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns only XLM and asset balances", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue({
        balances: [
          {
            asset_type: "native",
            balance: "100.0000000",
            buying_liabilities: "1.0000000",
            selling_liabilities: "2.0000000",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: "GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA",
            balance: "25.5000000",
            limit: "1000.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      });

      const res = await request(app).get(`/account/${VALID_KEY}/balances`);

      expect(res.statusCode).toBe(200);
      expect(server.loadAccount).toHaveBeenCalledWith(VALID_KEY);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        xlm: {
          balance: "100.0000000",
          buyingLiabilities: "1.0000000",
          sellingLiabilities: "2.0000000",
        },
        assets: [
          {
            assetCode: "USDC",
            assetIssuer: "GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA",
            assetType: "credit_alphanum4",
            balance: "25.5000000",
            limit: "1000.0000000",
            buyingLiabilities: "0.0000000",
            sellingLiabilities: "0.0000000",
            isAuthorized: true,
            isClawbackEnabled: false,
          },
        ],
      });
    });
  });

  describe("GET /account/:id/payments", () => {
    const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns only payment and create_account operations with payment fields", async () => {
      const query = {
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        cursor: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              type: "payment",
              amount: "15.0000000",
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: "GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA",
              from: "GASENDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              to: "GARECEIVERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              created_at: "2026-05-27T10:00:00Z",
              paging_token: "payment-token",
            },
            {
              type: "change_trust",
              created_at: "2026-05-27T10:01:00Z",
              paging_token: "change-trust-token",
            },
            {
              type: "create_account",
              starting_balance: "2.5000000",
              funder: "GAFUNDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              account: "GANEWACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              created_at: "2026-05-27T10:02:00Z",
              paging_token: "create-account-token",
            },
          ],
        }),
      };

      const operations = {
        forAccount: jest.fn().mockReturnValue(query),
      };

      jest.spyOn(server, "operations").mockReturnValue(operations);

      const res = await request(app).get(
        `/account/${VALID_KEY}/payments?limit=3&order=asc&cursor=start-token`
      );

      expect(res.statusCode).toBe(200);
      expect(operations.forAccount).toHaveBeenCalledWith(VALID_KEY);
      expect(query.limit).toHaveBeenCalledWith(3);
      expect(query.order).toHaveBeenCalledWith("asc");
      expect(query.cursor).toHaveBeenCalledWith("start-token");
      expect(res.body.data).toEqual([
        {
          type: "payment",
          amount: "15.0000000",
          asset: {
            code: "USDC",
            issuer: "GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA",
            type: "credit_alphanum4",
          },
          sender: "GASENDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          receiver: "GARECEIVERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          createdAt: "2026-05-27T10:00:00Z",
        },
        {
          type: "create_account",
          amount: "2.5000000",
          asset: {
            code: "XLM",
            issuer: null,
            type: "native",
          },
          sender: "GAFUNDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          receiver: "GANEWACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          createdAt: "2026-05-27T10:02:00Z",
        },
      ]);
      expect(res.body.meta).toEqual({
        count: 2,
        limit: 3,
        order: "asc",
        nextCursor: "create-account-token",
        hasMore: true,
      });
    });

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
        expect(payment).toHaveProperty("type");
        expect(payment).toHaveProperty("amount");
        expect(payment).toHaveProperty("asset");
        expect(payment).toHaveProperty("sender");
        expect(payment).toHaveProperty("receiver");
        expect(payment).toHaveProperty("createdAt");
        expect(Object.keys(payment).sort()).toEqual(
          ["type", "amount", "asset", "sender", "receiver", "createdAt"].sort()
        );
      }
    });

    it("only returns payment and create_account operation types", async () => {
      const res = await request(app).get(`/account/${VALID_KEY}/payments`);

      expect(res.statusCode).toBe(200);
      res.body.data.forEach((payment) => {
        expect(["payment", "create_account"]).toContain(payment.type);
        expect(payment).toHaveProperty("amount");
        expect(payment).toHaveProperty("asset");
        expect(payment).toHaveProperty("sender");
        expect(payment).toHaveProperty("receiver");
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

  // ── HTTP Parameter Pollution ────────────────────────────────────────────────
  describe("HTTP Parameter Pollution (hpp) protection", () => {
    it("handles duplicate non-whitelisted params safely", async () => {
      const res = await request(app).get("/health?foo=1&foo=2");
      expect(res.statusCode).toBe(200);
    });

    it("handles duplicate whitelisted params safely", async () => {
      const res = await request(app).get(
        "/fee-estimate?operations=1&operations=2"
      );
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Compression ────────────────────────────────────────────────────────────
  describe("Response Compression", () => {
    it("compresses responses when Accept-Encoding is gzip", async () => {
      // We use the root endpoint because it's large enough to trigger default compression
      const res = await request(app)
        .get("/")
        .set("Accept-Encoding", "gzip");

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-encoding"]).toBe("gzip");
    });
  });
  // ── Friendbot Tests ─────────────────────────────────────────────────────────
  describe("GET /utils/friendbot/:accountId", () => {
    const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    beforeEach(() => {
      // Set to testnet for tests
      process.env.STELLAR_NETWORK = "testnet";
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns 400 for an invalid account ID", async () => {
      const res = await request(app).get("/utils/friendbot/INVALID_KEY");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 when account ID is missing", async () => {
      const res = await request(app).get("/utils/friendbot/");
      expect(res.statusCode).toBe(404);
    });

    it("returns 403 when not on testnet", async () => {
      process.env.STELLAR_NETWORK = "mainnet";
      const res = await request(app).get(`/utils/friendbot/${VALID_KEY}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("testnet");
    });

    it("returns 200 and funds account on testnet success", async () => {
      const axios = require("axios");
      const mockFriendbot = {
        hash: "abc123",
        result_xdr: "xdr...",
      };

      jest.spyOn(axios, "get").mockResolvedValue({
        data: mockFriendbot,
      });

      const res = await request(app).get(`/utils/friendbot/${VALID_KEY}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accountId).toBe(VALID_KEY);
      expect(res.body.data.message).toContain("10,000 XLM");
      expect(res.body.data.transaction).toEqual(mockFriendbot);
    });

    it("returns 400 and error message if account already funded", async () => {
      const axios = require("axios");
      jest.spyOn(axios, "get").mockRejectedValue({
        response: {
          status: 400,
          data: {
            detail: "Account already exists",
            message: "This account is already funded",
          },
        },
      });

      const res = await request(app).get(`/utils/friendbot/${VALID_KEY}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Account already");
    });

    it("handles network errors gracefully", async () => {
      const axios = require("axios");
      jest.spyOn(axios, "get").mockRejectedValue({
        response: {
          status: 500,
          data: {
            detail: "Internal Server Error",
          },
        },
      });

      const res = await request(app).get(`/utils/friendbot/${VALID_KEY}`);

      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it("passes the account ID correctly to Friendbot", async () => {
      const axios = require("axios");
      jest.spyOn(axios, "get").mockResolvedValue({
        data: { hash: "test" },
      });

      await request(app).get(`/utils/friendbot/${VALID_KEY}`);

      expect(axios.get).toHaveBeenCalledWith("https://friendbot.stellar.org", {
        params: { addr: VALID_KEY },
        timeout: 10000,
      });
    });
  });});
