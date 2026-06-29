const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { operations: jest.fn() },
}));

const accountId = Keypair.random().publicKey();

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER_ISSUER = "GBBD67V63DU762S2CFFSBCS74K33Z6S5Y6R4E62Y7Z66I264S4UBC5U6";

const mockPayments = [
  {
    type: "payment",
    asset_code: "USDC",
    asset_issuer: USDC_ISSUER,
    asset_type: "credit_alphanum4",
    amount: "10.0000000",
    from: accountId,
    to: "GOTHER",
    created_at: "2024-01-01T00:00:00Z",
    paging_token: "t1",
  },
  {
    type: "payment",
    asset_code: "USDC",
    asset_issuer: OTHER_ISSUER,
    asset_type: "credit_alphanum4",
    amount: "5.0000000",
    from: accountId,
    to: "GOTHER2",
    created_at: "2024-01-02T00:00:00Z",
    paging_token: "t2",
  },
  {
    type: "payment",
    asset_code: "XLM",
    asset_issuer: null,
    asset_type: "native",
    amount: "100.0000000",
    from: accountId,
    to: "GOTHER3",
    created_at: "2024-01-03T00:00:00Z",
    paging_token: "t3",
  },
];

function mockOps(records) {
  server.operations.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /account/:id/payments — asset filters", () => {
  it("returns all payments when no filter is provided", async () => {
    mockOps(mockPayments);
    const res = await request(app).get(`/account/${accountId}/payments`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(3);
  });

  it("filters by assetCode alone — returns all issuers of that code", async () => {
    mockOps(mockPayments);
    const res = await request(app).get(
      `/account/${accountId}/payments?assetCode=USDC`,
    );
    expect(res.statusCode).toBe(200);
    const items = res.body.data.items;
    expect(items).toHaveLength(2);
    items.forEach((p) => expect(p.asset.code).toBe("USDC"));
  });

  it("assetCode filter is case-insensitive", async () => {
    mockOps(mockPayments);
    const res = await request(app).get(
      `/account/${accountId}/payments?assetCode=usdc`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
  });

  it("filters by assetCode + assetIssuer — exact match only", async () => {
    mockOps(mockPayments);
    const res = await request(app).get(
      `/account/${accountId}/payments?assetCode=USDC&assetIssuer=${USDC_ISSUER}`,
    );
    expect(res.statusCode).toBe(200);
    const items = res.body.data.items;
    expect(items).toHaveLength(1);
    expect(items[0].asset.issuer).toBe(USDC_ISSUER);
  });

  it("returns empty array (not 404) when no payments match the filter", async () => {
    mockOps(mockPayments);
    const res = await request(app).get(
      `/account/${accountId}/payments?assetCode=BTC`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  it("assetIssuer alone without assetCode has no effect", async () => {
    mockOps(mockPayments);
    const res = await request(app).get(
      `/account/${accountId}/payments?assetIssuer=${USDC_ISSUER}`,
    );
    expect(res.statusCode).toBe(200);
    // issuer-only filter is ignored per spec — all 3 payments returned
    expect(res.body.data.items).toHaveLength(3);
  });
});
