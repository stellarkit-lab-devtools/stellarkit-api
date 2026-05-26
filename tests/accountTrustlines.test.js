const request = require("supertest");
const axios = require("axios");

jest.mock("axios", () => ({
  create: jest.fn(() => ({
    interceptors: {
      response: {
        use: jest.fn(),
      },
    },
  })),
  get: jest.fn(),
}));
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

const ACCOUNT_ID =
  "GDU5LH56CZ7NVKRHYI72QVJC6BS7GAYEIO34HDMICG3H5NSFJJJFHFWL";
const RESOLVED_ISSUER =
  "GD62SRSGF4XVUHZYLZNAMTUTOH7CKJ2WZWX6HNUTZ4G5SFKNAM6G2OXD";
const UNRESOLVED_ISSUER =
  "GBDUK225U2UZ2YBZMIIGPI2XK35PKWUW25YYS2NNQ3HWYAMWSGWME4IA";

function accountWithBalances() {
  return {
    id: ACCOUNT_ID,
    balances: [
      {
        asset_type: "native",
        balance: "10.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: RESOLVED_ISSUER,
        balance: "25.0000000",
        limit: "1000.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_clawback_enabled: false,
      },
      {
        asset_type: "credit_alphanum12",
        asset_code: "NOHOME",
        asset_issuer: UNRESOLVED_ISSUER,
        balance: "2.5000000",
        limit: "100.0000000",
        buying_liabilities: "1.0000000",
        selling_liabilities: "0.5000000",
        is_authorized: true,
        is_clawback_enabled: true,
      },
    ],
  };
}

describe("GET /account/:id/trustlines", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns non-native balances with resolved stellar.toml metadata", async () => {
    server.loadAccount.mockImplementation(async (accountId) => {
      if (accountId === ACCOUNT_ID) return accountWithBalances();
      if (accountId === RESOLVED_ISSUER) {
        return { id: RESOLVED_ISSUER, home_domain: "assets.example.com" };
      }
      if (accountId === UNRESOLVED_ISSUER) {
        return { id: UNRESOLVED_ISSUER };
      }

      throw new Error("unexpected account");
    });
    axios.get.mockResolvedValue({
      data: `
        [[CURRENCIES]]
        code = "USDC"
        issuer = "${RESOLVED_ISSUER}"
        name = "USD Coin"
        desc = "Fully reserved digital dollar."
        image = "https://assets.example.com/usdc.png"
      `,
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustlines`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.trustlines).toEqual([
      expect.objectContaining({
        assetCode: "USDC",
        assetIssuer: RESOLVED_ISSUER,
        assetType: "credit_alphanum4",
        balance: "25.0000000",
        toml: {
          name: "USD Coin",
          description: "Fully reserved digital dollar.",
          image: "https://assets.example.com/usdc.png",
        },
      }),
      expect.objectContaining({
        assetCode: "NOHOME",
        assetIssuer: UNRESOLVED_ISSUER,
        assetType: "credit_alphanum12",
        balance: "2.5000000",
        toml: null,
      }),
    ]);
    expect(axios.get).toHaveBeenCalledWith(
      "https://assets.example.com/.well-known/stellar.toml",
      expect.objectContaining({ responseType: "text", timeout: 5000 }),
    );
  });

  it("sets toml to null when issuer TOML is unreachable", async () => {
    server.loadAccount.mockImplementation(async (accountId) => {
      if (accountId === ACCOUNT_ID) {
        return {
          id: ACCOUNT_ID,
          balances: accountWithBalances().balances.slice(0, 2),
        };
      }
      return { id: RESOLVED_ISSUER, home_domain: "assets.example.com" };
    });
    axios.get.mockRejectedValue(new Error("network failed"));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustlines`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.trustlines).toEqual([
      expect.objectContaining({
        assetCode: "USDC",
        toml: null,
      }),
    ]);
  });

  it("validates the account ID", async () => {
    const res = await request(app).get("/account/NOT_A_VALID_KEY/trustlines");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(server.loadAccount).not.toHaveBeenCalled();
  });
});
