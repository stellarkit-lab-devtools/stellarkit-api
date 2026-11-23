const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../../src/services/cache");

const accountId = Keypair.random().publicKey();
const issuer = Keypair.random().publicKey();

jest.mock("../../src/config/stellar", () => {
  const actual = jest.requireActual("../../src/config/stellar");
  return {
    ...actual,
    server: {
      ...actual.server,
      loadAccount: jest.fn(),
      payments: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

function mockPayments(records = []) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.payments.mockReturnValue(chain);
  return chain;
}

describe("GET /account/:id/cross-asset-trades", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    server.loadAccount.mockResolvedValue({});
  });

  it("returns multi-hop conversions with full path, amounts, rate, and pagination", async () => {
    const chain = mockPayments([
      {
        id: "op-123",
        paging_token: "cursor-123",
        type: "path_payment_strict_send",
        source_asset_type: "native",
        source_amount: "2.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: issuer,
        amount: "5.0000000",
        path: [{
          asset_type: "credit_alphanum4",
          asset_code: "EURC",
          asset_issuer: issuer,
        }],
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "direct-payment",
        type: "path_payment_strict_receive",
        source_asset_type: "native",
        source_amount: "1.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: issuer,
        amount: "2.0000000",
        path: [],
        created_at: "2025-01-02T00:00:00Z",
      },
    ]);

    const res = await request(app).get(
      `/account/${accountId}/cross-asset-trades?limit=8&cursor=cursor-before`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ total: 1, limit: 8, cursor: "cursor-123" });
    expect(res.body.data.trades[0]).toMatchObject({
      tradeId: "op-123",
      entryAsset: { code: "XLM", issuer: null, type: "native" },
      exitAsset: { code: "USDC", issuer, type: "credit_alphanum4" },
      entryAmount: "2.0000000",
      exitAmount: "5.0000000",
      effectiveRate: "2.5000000",
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    expect(res.body.data.trades[0].path).toEqual([
      { code: "XLM", issuer: null, type: "native" },
      { code: "EURC", issuer, type: "credit_alphanum4" },
      { code: "USDC", issuer, type: "credit_alphanum4" },
    ]);
    expect(server.loadAccount).toHaveBeenCalledWith(accountId);
    expect(chain.forAccount).toHaveBeenCalledWith(accountId);
    expect(chain.cursor).toHaveBeenCalledWith("cursor-before");
  });

  it("returns AccountNotFound when the account does not exist", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(`/account/${accountId}/cross-asset-trades`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});