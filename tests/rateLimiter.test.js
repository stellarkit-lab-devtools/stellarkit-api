const request = require("supertest");

const VALID_ACCOUNT = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
const VALID_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function loadFreshApp() {
  jest.resetModules();
  const app = require("../src/index");
  const { server } = require("../src/config/stellar");

  return { app, server };
}

function createChainableQuery(response) {
  return {
    forAccount: jest.fn().mockReturnThis(),
    forAsset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue(response),
  };
}

function mockAccountSummaryDependencies(server) {
  jest.spyOn(server, "loadAccount").mockResolvedValue({
    id: VALID_ACCOUNT,
  });
  jest
    .spyOn(server, "transactions")
    .mockReturnValue(createChainableQuery({ records: [] }));
  jest.spyOn(server, "offers").mockReturnValue(createChainableQuery({ records: [] }));
  jest
    .spyOn(server, "claimableBalances")
    .mockReturnValue(createChainableQuery({ records: [] }));
}

function mockAssetHoldersDependencies(server) {
  const query = createChainableQuery({
    records: [
      {
        id: VALID_ACCOUNT,
        paging_token: "holder-token",
        last_modified_ledger: 12345,
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: VALID_ISSUER,
            balance: "25.5000000",
            limit: "1000.0000000",
            buying_liabilities: "1.0000000",
            selling_liabilities: "2.0000000",
            is_authorized: true,
            is_authorized_to_maintain_liabilities: true,
            is_clawback_enabled: false,
          },
        ],
      },
    ],
  });

  jest.spyOn(server, "accounts").mockReturnValue(query);

  return query;
}

describe("Endpoint rate limiting", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("limits /asset/:code/:issuer/holders to 10 requests per 15 minutes per IP", async () => {
    const { app, server } = loadFreshApp();
    const query = mockAssetHoldersDependencies(server);
    const path = `/asset/USDC/${VALID_ISSUER}/holders`;

    const firstResponse = await request(app).get(
      `${path}?limit=1&order=asc&cursor=start-token`,
    );

    expect(firstResponse.statusCode).toBe(200);
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(query.order).toHaveBeenCalledWith("asc");
    expect(query.cursor).toHaveBeenCalledWith("start-token");
    expect(firstResponse.body.data).toEqual([
      {
        address: VALID_ACCOUNT,
        balance: "25.5000000",
      },
    ]);
    expect(firstResponse.body.meta).toEqual({
      count: 1,
      limit: 1,
      order: "asc",
      nextCursor: "holder-token",
      hasMore: true,
    });

    for (let i = 1; i < 10; i += 1) {
      const res = await request(app).get(path);
      expect(res.statusCode).toBe(200);
    }

    const limitedResponse = await request(app).get(path);

    expect(limitedResponse.statusCode).toBe(429);
    expect(limitedResponse.body).toEqual({
      success: false,
      error: {
        type: "RateLimitExceeded",
        message: "Too many requests, please try again later.",
        retryAfter: 900,
        resetAt: expect.any(String),
      },
    });
    expect(limitedResponse.headers["retry-after"]).toBe("900");
    expect(limitedResponse.headers["x-ratelimit-limit"]).toBe("10");
    expect(limitedResponse.headers["x-ratelimit-remaining"]).toBe("0");
    expect(limitedResponse.headers["x-ratelimit-reset"]).toBeDefined();
  }, 30000);

  it("keeps non-expensive endpoints on the existing global limit", async () => {
    const { app, server } = loadFreshApp();
    jest.spyOn(server, "serverInfo").mockResolvedValue({ horizon_version: "2.33.0" });

    for (let i = 0; i < 21; i += 1) {
      const res = await request(app).get("/health");
      expect(res.statusCode).toBe(200);
    }
  }, 30000);

  it("limits requests without X-Account-ID to the global rate limit", async () => {
    const originalAccountMax = process.env.ACCOUNT_RATE_LIMIT_MAX;
    const originalGlobalMax = process.env.RATE_LIMIT_MAX;
    process.env.ACCOUNT_RATE_LIMIT_MAX = "1000";
    process.env.RATE_LIMIT_MAX = "3";

    const { app } = loadFreshApp();

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get("/");
      expect(res.statusCode).toBe(200);
    }

    const res = await request(app).get("/");
    expect(res.statusCode).toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe("3");
    expect(res.headers["retry-after"]).toBe("900");

    process.env.ACCOUNT_RATE_LIMIT_MAX = originalAccountMax;
    process.env.RATE_LIMIT_MAX = originalGlobalMax;
  }, 30000);

  it("applies the per-account rate limit when X-Account-ID is provided", async () => {
    const originalAccountMax = process.env.ACCOUNT_RATE_LIMIT_MAX;
    const originalGlobalMax = process.env.RATE_LIMIT_MAX;
    process.env.ACCOUNT_RATE_LIMIT_MAX = "5";
    process.env.RATE_LIMIT_MAX = "1000";

    const { app } = loadFreshApp();
    const accountId = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .get("/")
        .set("X-Account-ID", accountId);
      expect(res.statusCode).toBe(200);
    }

    const res = await request(app)
      .get("/")
      .set("X-Account-ID", accountId);
    expect(res.statusCode).toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe("5");
    expect(res.headers["retry-after"]).toBe("900");

    process.env.ACCOUNT_RATE_LIMIT_MAX = originalAccountMax;
    process.env.RATE_LIMIT_MAX = originalGlobalMax;
  }, 30000);

  it("resets the per-account rate limit when X-Account-ID changes", async () => {
    const originalAccountMax = process.env.ACCOUNT_RATE_LIMIT_MAX;
    const originalGlobalMax = process.env.RATE_LIMIT_MAX;
    process.env.ACCOUNT_RATE_LIMIT_MAX = "3";
    process.env.RATE_LIMIT_MAX = "1000";

    const { app } = loadFreshApp();
    const accountA = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
    const accountB = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get("/").set("X-Account-ID", accountA);
      expect(res.statusCode).toBe(200);
    }

    const resA = await request(app).get("/").set("X-Account-ID", accountA);
    expect(resA.statusCode).toBe(429);

    const resB = await request(app).get("/").set("X-Account-ID", accountB);
    expect(resB.statusCode).toBe(200);

    process.env.ACCOUNT_RATE_LIMIT_MAX = originalAccountMax;
    process.env.RATE_LIMIT_MAX = originalGlobalMax;
  }, 30000);
});
