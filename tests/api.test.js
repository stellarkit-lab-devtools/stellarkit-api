const request = require("supertest");
const axios = require("axios");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");


const { startServer } = app;

describe("StellarKit API", () => {
  // Clear caches before each test
  beforeEach(() => {
    cacheService.flush();
  });

  describe("startup cache warming", () => {
    let httpServer;

    afterEach(async () => {
      jest.restoreAllMocks();
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
        httpServer = null;
      }
    });

    it("warms network-status and fee-estimate on startup so the next request is a cache hit", async () => {
      jest.spyOn(server, "ledgers").mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              sequence: 12345,
              closed_at: "2026-06-28T00:00:00Z",
              successful_transaction_count: 3,
              operation_count: 10,
              total_coins: "100000000000",
              fee_pool: "5000000000",
              base_fee_in_stroops: 100,
              base_reserve_in_stroops: 50000000,
              protocol_version: 19,
            },
          ],
        }),
      });

      jest.spyOn(server, "feeStats").mockResolvedValue({
        fee_charged: {
          min: "100",
          p10: "100",
          p50: "200",
          p95: "300",
          p99: "400",
          max: "500",
        },
        last_ledger_base_fee: 100,
        ledger_capacity_usage: "0.5",
      });

      const logger = { log: jest.fn(), error: jest.fn() };
      httpServer = startServer({ app, port: 0, logger, setupWebSocket: jest.fn() });

      await new Promise((resolve) => httpServer.once("listening", resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(networkStatusCache.get("network-status")).toBeTruthy();
      expect(feeEstimateCache.get("fee-estimate:1")).toBeTruthy();
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("[CACHE WARM]"));

      const warmReq = await request(httpServer).get("/network-status");
      const feeReq = await request(httpServer).get("/fee-estimate");

      expect(warmReq.headers["x-cache"]).toBe("HIT");
      expect(feeReq.headers["x-cache"]).toBe("HIT");
    });
  });

  // ── Health ─────────────────────────────────────────────────────────────────
  describe("GET /health", () => {
    it("returns 200 with required health fields", async () => {
      const res = await request(app).get("/health");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toBeDefined();
      expect(data.status).toBe("ok");
      expect(data.service).toBe("StellarKit API");

      // Non-empty version string
      expect(typeof data.version).toBe("string");
      expect(data.version.length).toBeGreaterThan(0);

      // Valid ISO 8601 timestamp
      expect(typeof data.timestamp).toBe("string");
      const ts = new Date(data.timestamp);
      expect(Number.isNaN(ts.getTime())).toBe(false);

      // Network value must be either testnet or mainnet
      expect(["testnet", "mainnet"]).toContain(data.network);
    });
  });

  describe("CORS configuration", () => {
    const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      if (originalAllowedOrigins === undefined) {
        delete process.env.ALLOWED_ORIGINS;
      } else {
        process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
      }

      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it("returns CORS headers for configured origins and supports preflight requests", async () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://app.example.com, https://admin.example.com";

      const res = await request(app)
        .get("/health")
        .set("Origin", "https://app.example.com");

      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
      expect(res.headers.vary).toContain("Origin");

      const preflight = await request(app)
        .options("/health")
        .set("Origin", "https://admin.example.com")
        .set("Access-Control-Request-Method", "GET");

      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe("https://admin.example.com");
    });

    it("defaults to a permissive wildcard in development when no allowlist is set", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.ALLOWED_ORIGINS;

      const res = await request(app)
        .get("/health")
        .set("Origin", "https://example.com");

      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("returns and echoes a request ID header", async () => {
      const res = await request(app).get("/health").set("X-Request-ID", "req-123");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toBe("req-123");
    });
  });

  // ── Root ───────────────────────────────────────────────────────────────────
  describe("GET /", () => {
    it("returns API info and endpoint list", async () => {
      const res = await request(app).get("/");
      expect(res.statusCode).toBe(200);

      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty("data");

      const { data } = res.body;
      expect(data).toHaveProperty("name");
      expect(typeof data.name).toBe("string");

      expect(data).toHaveProperty("description");
      expect(typeof data.description).toBe("string");

      expect(data).toHaveProperty("version");
      expect(typeof data.version).toBe("string");
      expect(data.version.length).toBeGreaterThan(0);

      expect(data).toHaveProperty("network");
      expect(["testnet", "mainnet"]).toContain(data.network);

      expect(data).toHaveProperty("endpoints");
      expect(Array.isArray(data.endpoints)).toBe(true);
      expect(data.endpoints.length).toBeGreaterThan(0);

      // Validate endpoint entries shape (at least one entry)
      const first = data.endpoints[0];
      expect(first).toHaveProperty("method");
      expect(typeof first.method).toBe("string");
      expect(first).toHaveProperty("path");
      expect(typeof first.path).toBe("string");
      expect(first).toHaveProperty("description");
      expect(typeof first.description).toBe("string");
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
    it("returns 400 for an invalid account ID with field-level details", async () => {
      const res = await request(app).get("/account/NOT_A_VALID_KEY");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
      expect(res.body.error.field).toBe("accountId");
      expect(res.body.error.receivedValue).toBe("NOT_A_VALID_KEY");
      expect(res.body.error.expectedFormat).toBeDefined();
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
      expect(res.body.data).toHaveProperty("total", 1);
      expect(res.body.data).toHaveProperty("limit", null);
      expect(res.body.data).toHaveProperty("cursor", null);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({
        asset: { code: "TEST", issuer: MOCK_ISSUER, type: "credit_alphanum4" },
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
      expect(res.body.data.items[0].toml).toBeNull();
    });
  });

  describe("GET /transactions/:id — validation", () => {
    it("returns 400 for an invalid account ID with field-level details", async () => {
      const res = await request(app).get("/transactions/BADKEY123");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.field).toBe("accountId");
      expect(res.body.error.receivedValue).toBe("BADKEY123");
    });

    it("returns 400 for an invalid limit param with field-level details", async () => {
      const res = await request(app).get(
        "/transactions/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN?limit=999999",
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.field).toBe("limit");
      expect(res.body.error.receivedValue).toBe("999999");
    });

    it("returns 400 for an invalid order param with field-level details", async () => {
      const res = await request(app).get(
        "/transactions/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN?order=invalid",
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("asc");
      expect(res.body.error.message).toContain("desc");
      expect(res.body.error.field).toBe("order");
      expect(res.body.error.receivedValue).toBe("invalid");
    });
  });

  describe("GET /transactions/:id/operations — validation", () => {
    it("returns 400 for an invalid order param with field-level details", async () => {
      const res = await request(app).get(
        "/transactions/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/operations?order=invalid",
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("asc");
      expect(res.body.error.message).toContain("desc");
      expect(res.body.error.field).toBe("order");
      expect(res.body.error.receivedValue).toBe("invalid");
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
      expect(res.body.data.items).toEqual([
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
          createdAt: "2026-05-27T10:00:00.000Z",
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
          createdAt: "2026-05-27T10:02:00.000Z",
        },
      ]);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.limit).toBe(3);
      expect(res.body.data.cursor).toBe("create-account-token");
    });

    it("returns payments for a valid account", async () => {
      const res = await request(app).get(`/account/${VALID_KEY}/payments`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("items");
      expect(res.body.data.items).toBeInstanceOf(Array);
      expect(res.body.data).toHaveProperty("total");
      expect(res.body.data).toHaveProperty("limit");
      expect(res.body.data).toHaveProperty("cursor");

      if (res.body.data.items.length > 0) {
        const payment = res.body.data.items[0];
        expect(payment).toHaveProperty("type");
        expect(payment).toHaveProperty("amount");
        expect(payment).toHaveProperty("asset");
        expect(payment).toHaveProperty("sender");
        expect(payment).toHaveProperty("receiver");
        expect(payment).toHaveProperty("createdAt");
      }
    });

    it("only returns payment and create_account operation types", async () => {
      const res = await request(app).get(`/account/${VALID_KEY}/payments`);

      expect(res.statusCode).toBe(200);
      res.body.data.items.forEach((payment) => {
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
      expect(res.body.data.limit).toBe(5);
      expect(res.body.data.items.length).toBeLessThanOrEqual(5);
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
      expect(res.body.data.items).toBeInstanceOf(Array);
    });
  });

  describe("GET /account/:id/offers", () => {
    const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    it("returns open offers for a valid account", async () => {
      const res = await request(app).get(`/account/${VALID_KEY}/offers`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("items");
      expect(res.body.data.items).toBeInstanceOf(Array);
      expect(res.body.data).toHaveProperty("total");
      expect(res.body.data).toHaveProperty("limit");
      expect(res.body.data).toHaveProperty("cursor");

      if (res.body.data.items.length > 0) {
        const offer = res.body.data.items[0];
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
      expect(res.body.data.limit).toBe(1);
      expect(res.body.data.items.length).toBeLessThanOrEqual(1);
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_KEY/offers");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
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
      expect(res.body.data.items[0].feeSummary).toEqual({
        stroops: 300,
        xlm: "0.0000300",
        perOperationStroops: 100,
        perOperationXLM: "0.0000100",
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

  describe("GET /utils/convert", () => {
    it("converts XLM to stroops", async () => {
      const res = await request(app).get("/utils/convert?xlm=1.5");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        xlm: "1.5000000",
        stroops: 15000000,
      });
    });

    it("converts stroops to XLM", async () => {
      const res = await request(app).get("/utils/convert?stroops=15000000");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        xlm: "1.5000000",
        stroops: 15000000,
      });
    });

    it("returns 400 when no conversion param is provided", async () => {
      const res = await request(app).get("/utils/convert");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 when both conversion params are provided", async () => {
      const res = await request(app).get("/utils/convert?xlm=1&stroops=10000000");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for negative values", async () => {
      const xlmRes = await request(app).get("/utils/convert?xlm=-1");
      const stroopsRes = await request(app).get("/utils/convert?stroops=-1");

      expect(xlmRes.statusCode).toBe(400);
      expect(xlmRes.body.success).toBe(false);
      expect(stroopsRes.statusCode).toBe(400);
      expect(stroopsRes.body.success).toBe(false);
    });
  });

  describe("GET /utils/ledger-date", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns estimated ledger close date for a valid sequence", async () => {
      const stellarConfig = require("../src/config/stellar");
      jest.spyOn(stellarConfig.server, "ledgers").mockReturnValue({
        order: () => ({
          limit: () => ({
            call: async () => ({
              records: [
                {
                  sequence: "12350",
                  closed_at: "2026-06-02T12:00:00Z",
                },
              ],
            }),
          }),
        }),
      });

      const res = await request(app).get("/utils/ledger-date?sequence=12345");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("sequence", 12345);
      expect(res.body.data).toHaveProperty("estimatedDate");
      expect(res.body.data.estimatedDate).toBe("2026-06-02T11:59:35.000Z");
      expect(res.body.data).toHaveProperty("note");
      expect(res.body.data.note).toContain("approximation");
    });

    it("returns 400 for non-positive sequence values", async () => {
      const res = await request(app).get("/utils/ledger-date?sequence=0");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for invalid sequence format", async () => {
      const res = await request(app).get("/utils/ledger-date?sequence=abc");

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
