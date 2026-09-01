const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  server: {
    loadAccount: jest.fn(),
  },
  horizonUrl: "https://horizon-testnet.stellar.org",
  NETWORK: "testnet",
  NETWORKS: {
    testnet: "https://horizon-testnet.stellar.org",
    mainnet: "https://horizon.stellar.org",
  },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("POST /accounts/native-balances", () => {
  const ACCOUNT_1 = Keypair.random().publicKey();
  const ACCOUNT_2 = Keypair.random().publicKey();
  const NONEXISTENT = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns native XLM balances for multiple accounts", async () => {
    server.loadAccount.mockImplementation((address) => {
      if (address === ACCOUNT_1) {
        return Promise.resolve({
          id: ACCOUNT_1,
          balances: [
            {
              asset_type: "native",
              balance: "150.5000000",
              buying_liabilities: "3.0000000",
              selling_liabilities: "1.2500000",
            },
          ],
        });
      }
      return Promise.resolve({
        id: ACCOUNT_2,
        balances: [
          {
            asset_type: "native",
            balance: "50.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
          },
        ],
      });
    });

    const res = await request(app)
      .post("/accounts/native-balances")
      .send({ addresses: [ACCOUNT_1, ACCOUNT_2] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results[ACCOUNT_1]).toEqual({
      balance: "150.5000000",
      buyingLiabilities: "3.0000000",
      sellingLiabilities: "1.2500000",
    });
    expect(res.body.data.results[ACCOUNT_2]).toEqual({
      balance: "50.0000000",
      buyingLiabilities: "0.0000000",
      sellingLiabilities: "0.0000000",
    });
  });

  it("returns zero balance for non-existent accounts", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app)
      .post("/accounts/native-balances")
      .send({ addresses: [NONEXISTENT] });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.results[NONEXISTENT]).toEqual({
      balance: "0.0000000",
      buyingLiabilities: "0.0000000",
      sellingLiabilities: "0.0000000",
    });
  });

  it("returns zero balance when account has no native balance entry", async () => {
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_1, balances: [] });

    const res = await request(app)
      .post("/accounts/native-balances")
      .send({ addresses: [ACCOUNT_1] });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.results[ACCOUNT_1]).toEqual({
      balance: "0.0000000",
      buyingLiabilities: "0.0000000",
      sellingLiabilities: "0.0000000",
    });
  });

  it("returns 400 when more than 30 addresses are provided", async () => {
    const addresses = Array(31)
      .fill(null)
      .map((_, i) => `G${String(i).padStart(55, "A")}`);

    const res = await request(app)
      .post("/accounts/native-balances")
      .send({ addresses });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain("Maximum of 30 addresses");
    expect(server.loadAccount).not.toHaveBeenCalled();
  });

  it("returns 400 when addresses is missing", async () => {
    const res = await request(app).post("/accounts/native-balances").send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when addresses array is empty", async () => {
    const res = await request(app)
      .post("/accounts/native-balances")
      .send({ addresses: [] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain("At least one address");
  });

  it("returns 400 for invalid address format", async () => {
    const res = await request(app)
      .post("/accounts/native-balances")
      .send({ addresses: [ACCOUNT_1, "invalid-account"] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });
});
