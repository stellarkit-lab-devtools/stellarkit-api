const request = require("supertest");

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

const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";

describe("GET /account/:id/native-balance", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("returns XLM balance, buyingLiabilities, and sellingLiabilities", async () => {
    server.loadAccount.mockResolvedValue({
      id: VALID_KEY,
      balances: [
        {
          asset_type: "native",
          balance: "150.5000000",
          buying_liabilities: "3.0000000",
          selling_liabilities: "1.2500000",
        },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          balance: "50.0000000",
        },
      ],
    });

    const res = await request(app).get(`/account/${VALID_KEY}/native-balance`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      balance: "150.5000000",
      buyingLiabilities: "3.0000000",
      sellingLiabilities: "1.2500000",
    });
  });

  it("returns zero values when account has no native balance entry", async () => {
    server.loadAccount.mockResolvedValue({
      id: VALID_KEY,
      balances: [],
    });

    const res = await request(app).get(`/account/${VALID_KEY}/native-balance`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      balance: "0.0000000",
      buyingLiabilities: "0.0000000",
      sellingLiabilities: "0.0000000",
    });
  });

  it("returns 404 when account does not exist", async () => {
    server.loadAccount.mockRejectedValue({
      response: { status: 404 },
    });

    const res = await request(app).get(`/account/${VALID_KEY}/native-balance`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns 400 for invalid account ID", async () => {
    const res = await request(app).get("/account/INVALID_KEY/native-balance");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(server.loadAccount).not.toHaveBeenCalled();
  });
});
