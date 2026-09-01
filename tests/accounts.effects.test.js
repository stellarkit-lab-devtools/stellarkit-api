const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      effects: jest.fn(),
      loadAccount: jest.fn(),
    },
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");

function makeEffectsQueryForAccount(recordsByAccount) {
  return jest.fn().mockImplementation((accountId) => ({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: recordsByAccount[accountId] || [] }),
  }));
}

describe("POST /accounts/effects", () => {
  const ACCOUNT_1 = Keypair.random().publicKey();
  const ACCOUNT_2 = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the most recent normalized effects for each account", async () => {
    server.effects.mockImplementation(() =>
      makeEffectsQueryForAccount({
        [ACCOUNT_1]: [
          {
            id: "1",
            paging_token: "1",
            account: ACCOUNT_1,
            type: "account_credited",
            created_at: "2024-01-01T00:00:00Z",
            transaction_hash: "abc123",
            asset_type: "native",
            amount: "100.0000000",
          },
        ],
        [ACCOUNT_2]: [
          {
            id: "2",
            paging_token: "2",
            account: ACCOUNT_2,
            type: "trustline_created",
            created_at: "2024-01-02T00:00:00Z",
            transaction_hash: "def456",
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: "GBTESTISSUER1234567890ABCDEFGHJKMNPQRSTUVWXYZ",
            limit: "100.0000000",
          },
        ],
      })
    );

    const res = await request(app)
      .post("/accounts/effects")
      .send({ addresses: [ACCOUNT_1, ACCOUNT_2] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results[ACCOUNT_1]).toEqual({
      effects: [
        expect.objectContaining({
          id: "1",
          type: "account_credited",
          account: ACCOUNT_1,
          amount: "100.0000000",
        }),
      ],
    });
    expect(res.body.data.results[ACCOUNT_2]).toEqual({
      effects: [
        expect.objectContaining({
          id: "2",
          type: "trustline_created",
          account: ACCOUNT_2,
          asset: expect.objectContaining({ code: "USDC", type: "credit_alphanum4" }),
        }),
      ],
    });
  });

  it("caps the per-account limit at 10", async () => {
    server.effects.mockImplementation(() => {
      const builder = {
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockImplementation((value) => {
          expect(value).toBe(10);
          return { call: jest.fn().mockResolvedValue({ records: [] }) };
        }),
      };
      return builder;
    });

    const res = await request(app)
      .post("/accounts/effects")
      .send({ addresses: [ACCOUNT_1], limit: 99 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 when more than 10 addresses are provided", async () => {
    const addresses = Array.from({ length: 11 }, () => Keypair.random().publicKey());

    const res = await request(app)
      .post("/accounts/effects")
      .send({ addresses });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toContain("Maximum of 10 addresses");
  });

  it("returns 400 for invalid addresses", async () => {
    const res = await request(app)
      .post("/accounts/effects")
      .send({ addresses: [ACCOUNT_1, "invalid-account"] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(server.effects).not.toHaveBeenCalled();
  });

  it("returns an empty effects array for a missing account", async () => {
    const missing = Keypair.random().publicKey();
    server.effects.mockImplementation(() => ({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
    }));

    const res = await request(app)
      .post("/accounts/effects")
      .send({ addresses: [missing] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results[missing]).toEqual({ effects: [] });
  });

  it("returns 400 when limit is invalid", async () => {
    const res = await request(app)
      .post("/accounts/effects")
      .send({ addresses: [ACCOUNT_1], limit: 0 });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });
});
