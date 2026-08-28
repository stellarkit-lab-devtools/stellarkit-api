const request = require("supertest");

const { server } = require("../src/config/stellar");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      accounts: jest.fn(),
      loadAccount: jest.fn(),
      liquidityPools: jest.fn(),
      claimableBalances: jest.fn(),
    },
  };
});

const app = require("../src/index");

describe("response normalization endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockAccounts(records) {
    server.accounts.mockReturnValue({
      forAsset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records }),
    });
  }

  const ASSET_PATH = "/asset/USDC/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7/holders";

  it("returns normalized asset holder responses with the requested envelope", async () => {
    mockAccounts([
      {
        id: "GABC",
        balances: [{ asset_code: "USDC", asset_issuer: "GISSUER", balance: "10.5000000", asset_type: "credit_alphanum4" }],
        paging_token: "tok1",
      },
    ]);

    const res = await request(app).get(ASSET_PATH).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.meta.count).toBe(1);
    expect(res.body.meta.limit).toBe(10);
    expect(res.body.meta.hasMore).toBe(false);
    expect(res.body.data).toEqual([{ address: "GABC", balance: "10.5000000" }]);
    expect(res.body.data[0]).not.toHaveProperty("paging_token");
    expect(res.get("X-Cache")).toBe("MISS");
  });

  it("filters to only accounts above base reserve when ?verified=true", async () => {
    mockAccounts([
      {
        id: "GAHIGH",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "100.0000000", asset_type: "credit_alphanum4" },
          { balance: "10.0000000", asset_type: "native" },
        ],
        paging_token: "tok1",
      },
      {
        id: "GALOW",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "50.0000000", asset_type: "credit_alphanum4" },
          { balance: "0.1000000", asset_type: "native" },
        ],
        paging_token: "tok2",
      },
      {
        id: "GAZERO",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "25.0000000", asset_type: "credit_alphanum4" },
        ],
        paging_token: "tok3",
      },
    ]);

    const res = await request(app)
      .get(`${ASSET_PATH}?verified=true`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].address).toBe("GAHIGH");
    expect(res.body.meta.count).toBe(1);
    expect(res.get("X-Cache")).toBe("MISS");
  });

  it("returns all holders when ?verified=false", async () => {
    mockAccounts([
      {
        id: "GAHIGH",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "100.0000000", asset_type: "credit_alphanum4" },
          { balance: "10.0000000", asset_type: "native" },
        ],
        paging_token: "tok1",
      },
      {
        id: "GALOW",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "50.0000000", asset_type: "credit_alphanum4" },
          { balance: "0.1000000", asset_type: "native" },
        ],
        paging_token: "tok2",
      },
    ]);

    const res = await request(app)
      .get(`${ASSET_PATH}?verified=false`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.count).toBe(2);
  });

  it("returns all holders when verified param omitted", async () => {
    mockAccounts([
      {
        id: "GAHIGH",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "100.0000000", asset_type: "credit_alphanum4" },
          { balance: "10.0000000", asset_type: "native" },
        ],
        paging_token: "tok1",
      },
      {
        id: "GALOW",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "50.0000000", asset_type: "credit_alphanum4" },
          { balance: "0.1000000", asset_type: "native" },
        ],
        paging_token: "tok2",
      },
    ]);

    const res = await request(app).get(ASSET_PATH).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.count).toBe(2);
  });

  it("returns 400 for invalid ?verified value", async () => {
    mockAccounts([]);

    const res = await request(app)
      .get(`${ASSET_PATH}?verified=banana`)
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it("combines ?verified=true with minBalance filter", async () => {
    mockAccounts([
      {
        id: "GAHIGH",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "200.0000000", asset_type: "credit_alphanum4" },
          { balance: "10.0000000", asset_type: "native" },
        ],
        paging_token: "tok1",
      },
      {
        id: "GALOW",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "50.0000000", asset_type: "credit_alphanum4" },
          { balance: "10.0000000", asset_type: "native" },
        ],
        paging_token: "tok2",
      },
      {
        id: "GARICH_NO_XLM",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "150.0000000", asset_type: "credit_alphanum4" },
          { balance: "0.1000000", asset_type: "native" },
        ],
        paging_token: "tok3",
      },
    ]);

    const res = await request(app)
      .get(`${ASSET_PATH}?verified=true&minBalance=100`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].address).toBe("GAHIGH");
    expect(res.body.meta.count).toBe(1);
    expect(res.get("X-Cache")).toBe("MISS");
  });

  it("returns empty when ?verified=true and no holder qualifies", async () => {
    mockAccounts([
      {
        id: "GALOW",
        balances: [
          { asset_code: "USDC", asset_issuer: "GISSUER", balance: "50.0000000", asset_type: "credit_alphanum4" },
          { balance: "0.1000000", asset_type: "native" },
        ],
        paging_token: "tok1",
      },
    ]);

    const res = await request(app)
      .get(`${ASSET_PATH}?verified=true`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.count).toBe(0);
  });

  it("normalizes pool positions asset fields and decimal strings", async () => {
    server.loadAccount.mockResolvedValue({
      balances: [
        {
          asset_type: "liquidity_pool_shares",
          liquidity_pool_id: "pool-id",
          balance: "2.0000000",
        },
      ],
    });

    server.liquidityPools.mockReturnValue({
      liquidityPoolId: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        id: "pool-id",
        total_shares: "4.0000000",
        fee_bp: 30,
        total_trustlines: 2,
        last_modified_ledger: 123,
        reserves: [
          { amount: "3.0000000", asset: "native" },
          { amount: "5.0000000", asset: "USDC:GISSUER" },
        ],
      }),
    });

    const res = await request(app)
      .get("/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7/pool-positions")
      .expect(200);

    expect(res.body.data[0]).toMatchObject({
      poolId: "pool-id",
      shares: "2.0000000",
      totalPoolShares: "4.0000000",
      reserveA: {
        asset: { code: "XLM", issuer: null, type: "native" },
        totalAmount: "3.0000000",
        equivalentAmount: "1.5000000",
      },
      reserveB: {
        asset: { code: "USDC", issuer: "GISSUER", type: "credit_alphanum4" },
        totalAmount: "5.0000000",
        equivalentAmount: "2.5000000",
      },
    });
    expect(res.body.data[0]).not.toHaveProperty("liquidity_pool_id");
  });

  it("returns paginated claimable balances for an account", async () => {
    server.claimableBalances.mockReturnValue({
      forClaimant: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "cb-1",
            asset: "credit_alphanum4",
            amount: "12.3400000",
            sponsor: "GSPONSOR",
            created_at: "2024-01-01T00:00:00Z",
            claimants: [{ destination: "GDEST", predicate: { unconditional: true } }],
          },
        ],
      }),
    });

    const res = await request(app)
      .get("/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7/claimable-balances")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      balanceId: "cb-1",
      amount: "12.3400000",
      sponsor: "GSPONSOR",
      createdAt: "2024-01-01T00:00:00Z",
      claimants: [{ destination: "GDEST", predicate: { unconditional: true } }],
    });
    expect(res.body.meta).toMatchObject({ count: 1, limit: 10, hasMore: false });
  });
});
