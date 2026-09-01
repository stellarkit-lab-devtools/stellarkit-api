const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

describe("POST /accounts/multisig-info", () => {
  const accountIdA = Keypair.random().publicKey();
  const accountIdB = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns multisig metadata for multiple accounts", async () => {
    server.loadAccount.mockImplementation(async (id) => ({
      id,
      thresholds: {
        low_threshold: 2,
        med_threshold: 3,
        high_threshold: 4,
      },
      signers: [
        { key: id, type: "ed25519_public_key", weight: 1 },
        { key: Keypair.random().publicKey(), type: "ed25519_public_key", weight: 2 },
      ],
    }));

    const res = await request(app)
      .post("/accounts/multisig-info")
      .send({ accountIds: [accountIdA, accountIdB] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0]).toMatchObject({
      accountId: accountIdA,
      signers: expect.any(Array),
      thresholds: expect.objectContaining({
        low: 2,
        med: 3,
        high: 4,
      }),
    });
  });

  it("rejects invalid accountIds payloads", async () => {
    const res = await request(app)
      .post("/accounts/multisig-info")
      .send({ accountIds: ["INVALID_ID"] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
