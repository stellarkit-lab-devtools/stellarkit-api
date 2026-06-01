const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      operations: jest.fn(),
    },
  };
});

describe("Account Offer History API", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns offer history operations", async () => {
    const mockOperations = [
      {
        type: "manage_sell_offer",
        offer_id: "123",
        amount: "100.0",
        price: "1.5",
        selling_asset_type: "native",
        buying_asset_type: "credit_alphanum4",
        buying_asset_code: "USDC",
        buying_asset_issuer: "G_ISSUER",
        created_at: "2024-01-01T00:00:00Z",
        paging_token: "t1",
      },
      {
        type: "manage_sell_offer",
        offer_id: "123",
        amount: "0",
        selling_asset_type: "native",
        buying_asset_type: "credit_alphanum4",
        buying_asset_code: "USDC",
        buying_asset_issuer: "G_ISSUER",
        created_at: "2024-01-01T01:00:00Z",
        paging_token: "t2",
      },
      {
          type: "payment",
          paging_token: "t3"
      }
    ];

    server.operations.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: mockOperations }),
    });

    const res = await request(app).get(`/account/${accountId}/offer-history`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].type).toBe("updated");
    expect(res.body.data[1].type).toBe("deleted");
    expect(res.body.data[0].sellingAsset).toBe("XLM");
    expect(res.body.data[0].buyingAsset).toBe("USDC:G_ISSUER");
  });
});
