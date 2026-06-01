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
        "/transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN?limit=999999",
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid order param", async () => {
      const res = await request(app).get(
        "/transactions/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN?order=invalid",
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("asc");
      expect(res.body.error.message).toContain("desc");
    });
  });

  describe("GET /transactions/:id/operations — validation", () => {
    it("returns 400 for an invalid order param", async () => {
      const res = await request(app).get(
        "/transactions/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/operations?order=invalid",
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("asc");
      expect(res.body.error.message).toContain("desc");
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
          message:
            "Content-Type must be application/json for requests with a body.",
        },
      });
    });
  });

  describe("GET /account/:id/balances", () => {
    const VALID_KEY =
      "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

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
            asset_issuer:
              "GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA",
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
            assetIssuer:
              "GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA",
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

  describe("GET /account/:id/sequence", () => {
    const VALID_KEY =
      "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns accountId, sequence and lastModifiedLedger", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue({
        id: VALID_KEY,
        sequence: "123456789",
        last_modified_ledger: 42,
      });

      const res = await request(app).get(`/account/${VALID_KEY}/sequence`);

      expect(res.statusCode).toBe(200);
      expect(server.loadAccount).toHaveBeenCalledWith(VALID_KEY);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        accountId: VALID_KEY,
        sequence: "123456789",
        lastModifiedLedger: 42,
      });
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_KEY/sequence");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });

  describe("GET /account/:id/payments", () => {
    const VALID_KEY =
      "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

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
              asset_issuer:
                "GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA",
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
              funder:
                "GAFUNDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              account:
                "GANEWACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
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
        `/account/${VALID_KEY}/payments?limit=3&order=asc&cursor=start-token`,
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
          receiver:
            "GARECEIVERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
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
          sender:
            "GAFUNDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          receiver:
            "GANEWACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
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
          ["type", "amount", "asset", "sender", "receiver", "createdAt"].sort(),
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
        `/account/${VALID_KEY}/payments?limit=5`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.meta.limit).toBe(5);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });

    it("returns 400 for invalid limit", async () => {
      const res = await request(app).get(
        `/account/${VALID_KEY}/payments?limit=999999`,
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("respects order query param", async () => {
      const res = await request(app).get(
        `/account/${VALID_KEY}/payments?order=asc`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.meta.order).toBe("asc");
    });
  });

  describe("GET /account/:id/analytics", () => {
    it.skip("returns analytics for a valid account", async () => {
      const res = await request(app).get(
        "/account/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/analytics",
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

    it.skip("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_KEY/analytics");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });

  // ── Issue #78: reserveBreakdown ────────────────────────────────────────────
  describe("GET /account/:id — reserveBreakdown", () => {
    const VALID_KEY =
      "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("includes reserveBreakdown with correct XLM and stroops values", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue({
        id: VALID_KEY,
        sequence: "1",
        subentry_count: 2,
        last_modified_ledger: 1,
        balances: [
          {
            asset_type: "native",
            balance: "10.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
          },
        ],
        signers: [],
        thresholds: {},
        flags: {},
        home_domain: null,
      });

      const res = await request(app).get(`/account/${VALID_KEY}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.reserveBreakdown).toEqual({
        baseReserve: { xlm: "0.5000000", stroops: 5000000 },
        accountReserve: { xlm: "1.0000000", stroops: 10000000 },
        subentryReserve: { xlm: "1.0000000", stroops: 10000000 },
        totalLocked: { xlm: "2.0000000", stroops: 20000000 },
        spendable: { xlm: "8.0000000", stroops: 80000000 },
      });
    });
  });

  // ── Issue #75: feeSummary ──────────────────────────────────────────────────
  describe("GET /transactions/:id — feeSummary", () => {
    const VALID_KEY =
      "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("includes feeSummary with correct stroops and XLM values", async () => {
      const query = {
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        includeFailed: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              id: "tx1",
              hash: "abc",
              ledger: 1,
              created_at: "2026-01-01T00:00:00Z",
              source_account: VALID_KEY,
              fee_charged: "300",
              fee_account: VALID_KEY,
              operation_count: 3,
              memo_type: "none",
              memo: null,
              successful: true,
              envelope_xdr: "xdr",
              paging_token: "tok1",
            },
          ],
        }),
      };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue(query),
      });

      const res = await request(app).get(`/transactions/${VALID_KEY}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].feeSummary).toEqual({
        chargedInStroops: 300,
        chargedInXLM: "0.0000300",
        perOperationInStroops: 100,
        perOperationInXLM: "0.0000100",
      });
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
        "/fee-estimate?operations=1&operations=2",
      );
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Compression ────────────────────────────────────────────────────────────
  describe("Response Compression", () => {
    it("compresses responses when Accept-Encoding is gzip", async () => {
      // We use the root endpoint because it's large enough to trigger default compression
      const res = await request(app).get("/").set("Accept-Encoding", "gzip");

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-encoding"]).toBe("gzip");
    });
  });
  // ── Friendbot Tests ─────────────────────────────────────────────────────────
  describe("GET /utils/friendbot/:accountId", () => {
    const VALID_KEY =
      "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

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
  });

  describe("GET /utils/base64", () => {
    it("returns 200 and encodes input when encode is provided", async () => {
      const res = await request(app).get("/utils/base64?encode=Hello");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        input: "Hello",
        encoded: "SGVsbG8=",
        mode: "encode",
      });
    });

    it("returns 200 and decodes input when decode is provided", async () => {
      const res = await request(app).get("/utils/base64?decode=SGVsbG8=");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        input: "SGVsbG8=",
        decoded: "Hello",
        mode: "decode",
      });
    });

    it("returns 400 when no params are provided", async () => {
      const res = await request(app).get("/utils/base64");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when both encode and decode are provided", async () => {
      const res = await request(app).get(
        "/utils/base64?encode=Hello&decode=SGVsbG8=",
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 and ValidationError for invalid base64 input", async () => {
      const res = await request(app).get("/utils/base64?decode=invalid-base64");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });

  // ── DEX Price ──────────────────────────────────────────────────────────────
  describe("GET /dex/price/:sellAsset/:buyAsset", () => {
    const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const validSell = "XLM:native";
    const validBuy = `USDC:${USDC_ISSUER}`;

    it("returns 400 for invalid sellAsset format", async () => {
      const res = await request(app).get(`/dex/price/BADFORMAT/${validBuy}`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for invalid buyAsset format", async () => {
      const res = await request(app).get(`/dex/price/${validSell}/BADFORMAT`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for invalid amount param", async () => {
      const res = await request(app).get(`/dex/price/${validSell}/${validBuy}?amount=-5`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for non-numeric amount param", async () => {
      const res = await request(app).get(`/dex/price/${validSell}/${validBuy}?amount=abc`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 200 with correct shape when a path exists", async () => {
      jest.spyOn(server, "strictSendPaths").mockReturnValue({
        call: async () => ({
          records: [
            {
              source_amount: "100.0000000",
              destination_amount: "12.5000000",
              path: [],
            },
          ],
        }),
      });

      const res = await request(app).get(`/dex/price/${validSell}/${validBuy}?amount=100`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        sellAsset: validSell,
        buyAsset: validBuy,
        sellAmount: "100.0000000",
        buyAmount: "12.5000000",
        effectiveRate: expect.any(String),
        bestPath: expect.any(Array),
      });

      server.strictSendPaths.mockRestore();
    });

    it("returns 404 when no path exists", async () => {
      jest.spyOn(server, "strictSendPaths").mockReturnValue({
        call: async () => ({ records: [] }),
      });

      const res = await request(app).get(`/dex/price/${validSell}/${validBuy}`);
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("NotFound");

      server.strictSendPaths.mockRestore();
    });

    it("selects the path with the highest destination amount", async () => {
      jest.spyOn(server, "strictSendPaths").mockReturnValue({
        call: async () => ({
          records: [
            { source_amount: "100.0000000", destination_amount: "10.0000000", path: [] },
            { source_amount: "100.0000000", destination_amount: "15.0000000", path: [] },
            { source_amount: "100.0000000", destination_amount: "12.0000000", path: [] },
          ],
        }),
      });

      const res = await request(app).get(`/dex/price/${validSell}/${validBuy}?amount=100`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.buyAmount).toBe("15.0000000");

      server.strictSendPaths.mockRestore();
    });
  });

  // ── Account Volume ─────────────────────────────────────────────────────────
  describe("GET /account/:id/volume", () => {
    const VALID_ID = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/BADKEY/volume");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 when days exceeds 90", async () => {
      const res = await request(app).get(`/account/${VALID_ID}/volume?days=91`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for non-numeric days param", async () => {
      const res = await request(app).get(`/account/${VALID_ID}/volume?days=abc`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 200 with correct shape and defaults to 30 days", async () => {
      const query = {
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        cursor: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      };
      jest.spyOn(server, "payments").mockReturnValue({
        forAccount: jest.fn().mockReturnValue(query),
      });

      const res = await request(app).get(`/account/${VALID_ID}/volume`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        period: { days: 30 },
        totalTransactions: 0,
        volumeByAsset: [],
      });

      jest.restoreAllMocks();
    });

    it("aggregates sent and received volumes by asset", async () => {
      const recentDate = new Date(Date.now() - 1000).toISOString();
      const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
      const mockRecords = [
        {
          type: "payment",
          from: VALID_ID,
          to: OTHER,
          asset_code: "USDC",
          asset_issuer: OTHER,
          amount: "50.0000000",
          transaction_successful: true,
          created_at: recentDate,
          paging_token: "1",
        },
        {
          type: "payment",
          from: OTHER,
          to: VALID_ID,
          asset_code: "USDC",
          asset_issuer: OTHER,
          amount: "25.0000000",
          transaction_successful: true,
          created_at: recentDate,
          paging_token: "2",
        },
      ];

      const query = {
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        cursor: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockRecords }),
      };
      jest.spyOn(server, "payments").mockReturnValue({
        forAccount: jest.fn().mockReturnValue(query),
      });

      const res = await request(app).get(`/account/${VALID_ID}/volume?days=30`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalTransactions).toBe(2);

      const usdcEntry = res.body.data.volumeByAsset.find((v) => v.assetCode === "USDC");
      expect(usdcEntry).toBeDefined();
      expect(usdcEntry.totalSent).toBe("50.0000000");
      expect(usdcEntry.totalReceived).toBe("25.0000000");

      jest.restoreAllMocks();
    });

    it("excludes operations outside the time window", async () => {
      const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      const mockRecords = [
        {
          type: "payment",
          from: VALID_ID,
          to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          asset_code: "XLM",
          asset_issuer: null,
          amount: "100.0000000",
          transaction_successful: true,
          created_at: oldDate,
          paging_token: "1",
        },
      ];

      const query = {
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        cursor: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockRecords }),
      };
      jest.spyOn(server, "payments").mockReturnValue({
        forAccount: jest.fn().mockReturnValue(query),
      });

      const res = await request(app).get(`/account/${VALID_ID}/volume?days=30`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalTransactions).toBe(0);
      expect(res.body.data.volumeByAsset).toHaveLength(0);

      jest.restoreAllMocks();
    });
  });

  // ── Asset Verify ───────────────────────────────────────────────────────────
  describe("GET /asset/:code/:issuer/verify", () => {
    const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const CODE = "USDC";
    const BASE = `/asset/${CODE}/${ISSUER}/verify`;

    const TOML_WITH_ASSET = `
[[CURRENCIES]]
code = "USDC"
issuer = "${ISSUER}"
`;
    const TOML_WITHOUT_ASSET = `
[[CURRENCIES]]
code = "OTHER"
issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
`;

    it("returns 400 for invalid asset code", async () => {
      const res = await request(app).get(`/asset/!!!/${ISSUER}/verify`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for invalid issuer", async () => {
      const res = await request(app).get(`/asset/${CODE}/BADKEY/verify`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns verified:false when account does not exist", async () => {
      jest.spyOn(server, "loadAccount").mockRejectedValue({ response: { status: 404 } });

      const res = await request(app).get(BASE);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.verified).toBe(false);
      expect(res.body.data.checks.accountExists.passed).toBe(false);

      jest.restoreAllMocks();
    });

    it("returns verified:false when account has no home_domain", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue({ home_domain: null });

      const res = await request(app).get(BASE);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.verified).toBe(false);
      expect(res.body.data.checks.accountExists.passed).toBe(true);
      expect(res.body.data.checks.hasHomeDomain.passed).toBe(false);

      jest.restoreAllMocks();
    });

    it("returns verified:false when stellar.toml is unreachable", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue({ home_domain: "example.com" });
      const axios = require("axios");
      jest.spyOn(axios, "get").mockRejectedValue(new Error("Network error"));

      const res = await request(app).get(BASE);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.verified).toBe(false);
      expect(res.body.data.checks.tomlReachable.passed).toBe(false);

      jest.restoreAllMocks();
    });

    it("returns verified:false when asset not listed in CURRENCIES", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue({ home_domain: "example.com" });
      const axios = require("axios");
      jest.spyOn(axios, "get").mockResolvedValue({ data: TOML_WITHOUT_ASSET });

      const res = await request(app).get(BASE);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.verified).toBe(false);
      expect(res.body.data.checks.tomlReachable.passed).toBe(true);
      expect(res.body.data.checks.listedInToml.passed).toBe(false);

      jest.restoreAllMocks();
    });

    it("returns verified:true when all checks pass", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue({ home_domain: "example.com" });
      const axios = require("axios");
      jest.spyOn(axios, "get").mockResolvedValue({ data: TOML_WITH_ASSET });

      const res = await request(app).get(BASE);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.verified).toBe(true);
      expect(res.body.data.checks.accountExists.passed).toBe(true);
      expect(res.body.data.checks.hasHomeDomain.passed).toBe(true);
      expect(res.body.data.checks.tomlReachable.passed).toBe(true);
      expect(res.body.data.checks.listedInToml.passed).toBe(true);

      jest.restoreAllMocks();
    });
  });

  // ── Fee Trends ─────────────────────────────────────────────────────────────
  describe("GET /fee-estimate/trends", () => {
    function makeLedger(baseFee, txCount = 0) {
      return { base_fee_in_stroops: baseFee, successful_transaction_count: txCount };
    }

    function mockLedgers(records) {
      const query = {
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records }),
      };
      jest.spyOn(server, "ledgers").mockReturnValue(query);
    }

    afterEach(() => jest.restoreAllMocks());

    it("returns 200 with required fields", async () => {
      const records = Array.from({ length: 50 }, () => makeLedger(100));
      mockLedgers(records);

      const res = await request(app).get("/fee-estimate/trends");
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        ledgersAnalyzed: 50,
        avgBaseFee: expect.any(Number),
        minBaseFee: expect.any(Number),
        maxBaseFee: expect.any(Number),
        avgCapacityUsage: expect.any(Number),
        trend: expect.stringMatching(/^(rising|falling|stable)$/),
        recommendation: expect.any(String),
      });
    });

    it("returns trend:stable when fees are constant", async () => {
      const records = Array.from({ length: 50 }, () => makeLedger(100));
      mockLedgers(records);

      const res = await request(app).get("/fee-estimate/trends");
      expect(res.body.data.trend).toBe("stable");
    });

    it("returns trend:rising when recent fees are higher than older fees", async () => {
      // records are desc (newest first): first 25 = recent (high), last 25 = older (low)
      const recent = Array.from({ length: 25 }, () => makeLedger(200));
      const older  = Array.from({ length: 25 }, () => makeLedger(100));
      mockLedgers([...recent, ...older]);

      const res = await request(app).get("/fee-estimate/trends");
      expect(res.body.data.trend).toBe("rising");
    });

    it("returns trend:falling when recent fees are lower than older fees", async () => {
      const recent = Array.from({ length: 25 }, () => makeLedger(100));
      const older  = Array.from({ length: 25 }, () => makeLedger(200));
      mockLedgers([...recent, ...older]);

      const res = await request(app).get("/fee-estimate/trends");
      expect(res.body.data.trend).toBe("falling");
    });

    it("computes correct min, max, and avg", async () => {
      const records = [
        makeLedger(50), makeLedger(100), makeLedger(150),
        ...Array.from({ length: 47 }, () => makeLedger(100)),
      ];
      mockLedgers(records);

      const res = await request(app).get("/fee-estimate/trends");
      expect(res.body.data.minBaseFee).toBe(50);
      expect(res.body.data.maxBaseFee).toBe(150);
    });
  });
});

describe("GET /account/:id/trustlines", () => {
  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get("/account/INVALID_KEY/trustlines");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("validates that route exists and handles errors gracefully", async () => {
    // This endpoint should be properly defined even if the account doesn't exist
    // A real account could be tested with a valid Stellar account ID
    const res = await request(app).get("/account/NOT_A_VALID_KEY/trustlines");
    
    // Should get a validation error, not a 404
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
});
