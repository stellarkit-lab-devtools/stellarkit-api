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
      effects: jest.fn(),
    },
  };
});

describe("GET /account/:id/history", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a unified feed merged from operations and effects", async () => {
    server.operations.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "2",
            type: "payment",
            created_at: "2024-05-02T00:00:00Z",
            account: accountId,
            transaction_hash: "hash-2",
            source_account: accountId,
            amount: "15.0000000",
            asset_code: "USDC",
          },
        ],
      }),
    });

    server.effects.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "1",
            type: "account_credited",
            created_at: "2024-05-03T00:00:00Z",
            account: accountId,
            transaction_hash: "hash-1",
            amount: "10.0000000",
            asset: "XLM",
          },
        ],
      }),
    });

    const res = await request(app).get(`/account/${accountId}/history?limit=10`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].type).toBe("account_credited");
    expect(res.body.data.items[0].category).toBe("effect");
    expect(res.body.data.items[1].type).toBe("payment");
    expect(res.body.data.items[1].category).toBe("operation");
    expect(res.body.data.total).toBe(2);
  });

  it("rejects invalid account IDs", async () => {
    const res = await request(app).get("/account/INVALID_ID/history");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });
});
