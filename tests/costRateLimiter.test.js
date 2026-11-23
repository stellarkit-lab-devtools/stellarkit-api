const request = require("supertest");

function loadFreshApp() {
  jest.resetModules();
  const app = require("../src/index");
  const { server } = require("../src/config/stellar");
  return { app, server };
}

const VALID_HASH = "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889";

describe("Cost-based rate limiter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.RATE_LIMIT_BUDGET;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.ACCOUNT_RATE_LIMIT_MAX;
  });

  it("charges cost 1 for unknown routes by default", async () => {
    process.env.RATE_LIMIT_MAX = "10";
    const { app } = loadFreshApp();

    // Each request to "/" costs 1
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).get("/");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-ratelimit-cost"]).toBe("1");
    }

    // 11th request should be 429
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(429);
  }, 30000);

  it("charges cost 5 for aggregate endpoints", async () => {
    process.env.RATE_LIMIT_MAX = "10";
    const { app, server } = loadFreshApp();

    // Mock Horizon to avoid real network calls
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      id: "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5",
      balances: [{ asset_type: "native", balance: "100.0000000" }],
      subentry_count: 0,
      data_attr: {},
      signers: [],
      thresholds: {},
    });
    jest.spyOn(server, "offers").mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    // reserve-breakdown costs 5; with budget 10, only 2 requests fit
    const account = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    const res1 = await request(app).get(`/account/${account}/reserve-breakdown`);
    expect(res1.statusCode).toBe(200);
    expect(res1.headers["x-ratelimit-cost"]).toBe("5");

    const res2 = await request(app).get(`/account/${account}/reserve-breakdown`);
    expect(res2.statusCode).toBe(200);
    expect(res2.headers["x-ratelimit-cost"]).toBe("5");

    // Budget exhausted (10 - 5 - 5 = 0)
    const res3 = await request(app).get(`/account/${account}/reserve-breakdown`);
    expect(res3.statusCode).toBe(429);
  }, 30000);

  it("exhausts budget and returns 429 with Retry-After", async () => {
    process.env.RATE_LIMIT_MAX = "3";
    const { app } = loadFreshApp();

    for (let i = 0; i < 3; i += 1) {
      await request(app).get("/");
    }

    const res = await request(app).get("/");
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("RateLimitExceeded");
  }, 30000);

  it("refunds cache hits down to cost 1", async () => {
    process.env.RATE_LIMIT_MAX = "10";
    const { app, server } = loadFreshApp();

    const account = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    jest.spyOn(server, "loadAccount").mockResolvedValue({
      id: account,
      balances: [{ asset_type: "native", balance: "100.0000000" }],
      subentry_count: 0,
      data_attr: {},
      signers: [],
      thresholds: {},
    });

    // First request: cache MISS, cost 5 (summary is an aggregate route)
    const res1 = await request(app).get(`/account/${account}/summary`);
    expect(res1.statusCode).toBe(200);
    expect(res1.headers["x-ratelimit-cost"]).toBe("5");

    // Second request: cache HIT, cost 5 charged but refunded to 1
    const res2 = await request(app).get(`/account/${account}/summary`);
    expect(res2.statusCode).toBe(200);
    expect(res2.headers["x-cache"]).toBe("HIT");

    // Total consumed: 5 (first, MISS) + 1 (second, HIT refunded) = 6.
    // Budget is 10, remaining is 4. One more cost-5 request should fail (4 < 5).
    const res3 = await request(app).get(`/account/${account}/summary`);
    expect(res3.statusCode).toBe(429);
  }, 30000);

  it("resets after the window expires", async () => {
    process.env.RATE_LIMIT_MAX = "2";
    process.env.RATE_LIMIT_WINDOW_MS = "200";
    const { app } = loadFreshApp();

    for (let i = 0; i < 2; i += 1) {
      await request(app).get("/");
    }

    // Budget exhausted
    const res1 = await request(app).get("/");
    expect(res1.statusCode).toBe(429);

    // Wait for window to reset
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Should be back to normal
    const res2 = await request(app).get("/");
    expect(res2.statusCode).toBe(200);
    expect(res2.headers["x-ratelimit-cost"]).toBe("1");
  }, 30000);

  it("identifies clients by X-Account-ID", async () => {
    process.env.RATE_LIMIT_MAX = "3";
    process.env.ACCOUNT_RATE_LIMIT_MAX = "1000";
    const { app } = loadFreshApp();
    const accountId = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

    // Exhaust the global bucket
    for (let i = 0; i < 3; i += 1) {
      await request(app).get("/");
    }

    // Global is exhausted but account-based should still work
    const res = await request(app).get("/").set("X-Account-ID", accountId);
    expect(res.statusCode).toBe(200);
  }, 30000);
});
