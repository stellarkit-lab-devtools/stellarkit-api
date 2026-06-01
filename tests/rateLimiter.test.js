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

  it("limits /account/:id/summary to 20 requests per 15 minutes per IP", async () => {
    const { app, server } = loadFreshApp();
    mockAccountSummaryDependencies(server);
    const path = `/account/${VALID_ACCOUNT}/summary`;

    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).get(path);
      expect(res.statusCode).toBe(200);
    }

    const res = await request(app).get(path);

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      error: {
        type: "RateLimitError",
        message:
          "Too many account summary requests, please try again after 15 minutes.",
      },
    });
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
        accountId: VALID_ACCOUNT,
        balance: "25.5000000",
        limit: "1000.0000000",
        buyingLiabilities: "1.0000000",
        sellingLiabilities: "2.0000000",
        isAuthorized: true,
        isAuthorizedToMaintainLiabilities: true,
        isClawbackEnabled: false,
        lastModifiedLedger: 12345,
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
        type: "RateLimitError",
        message:
          "Too many asset holder requests, please try again after 15 minutes.",
      },
    });
    expect(query.call).toHaveBeenCalledTimes(10);
  });

  it("keeps non-expensive endpoints on the existing global limit", async () => {
    const { app } = loadFreshApp();

    for (let i = 0; i < 21; i += 1) {
      const res = await request(app).get("/health");
      expect(res.statusCode).toBe(200);
    }
  });
});
