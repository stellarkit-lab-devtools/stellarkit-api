const request = require("supertest");

jest.mock("../../src/utils/tomlResolver", () => ({
  ...jest.requireActual("../../src/utils/tomlResolver"),
  fetchStellarToml: jest.fn(),
}));

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const { fetchStellarToml } = require("../../src/utils/tomlResolver");

const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER_ID = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function buildAccount(balances) {
  return { id: ACCOUNT_ID, balances };
}

function mockOrderBook(price) {
  jest.spyOn(server, "orderbook").mockReturnValue({
    limit: jest.fn().mockReturnValue({
      call: jest.fn().mockResolvedValue({
        bids: [{ price: String(price) }],
        asks: [{ price: String(price) }],
      }),
    }),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  fetchStellarToml.mockReset();
});

describe("GET /account/:id/asset-exposure", () => {
  it("returns XLM-denominated category percentages and TOML classification", async () => {
    jest.spyOn(server, "loadAccount").mockImplementation(async (accountId) =>
      accountId === ACCOUNT_ID
        ? buildAccount([
            { asset_type: "native", balance: "100.0000000" },
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: ISSUER_ID,
              balance: "20.0000000",
            },
          ])
        : { home_domain: "issuer.example" },
    );
    fetchStellarToml.mockResolvedValue({
      CURRENCIES: [{ code: "USDC", issuer: ISSUER_ID, anchor_asset_type: "fiat" }],
    });
    mockOrderBook(2);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-exposure`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.totalValueXLM).toBe("140.0000000");
    expect(res.body.data.exposure).toEqual({
      native: 71.43,
      stablecoins: 28.57,
      wrapped: 0,
      community: 0,
    });
    expect(res.body.data.breakdown[1]).toMatchObject({
      category: "stablecoins",
      valueInXLM: "40.0000000",
      percentage: 28.57,
    });
  });

  it("classifies wrapped assets from TOML descriptions", async () => {
    jest.spyOn(server, "loadAccount").mockImplementation(async (accountId) =>
      accountId === ACCOUNT_ID
        ? buildAccount([
            { asset_type: "native", balance: "10.0000000" },
            {
              asset_type: "credit_alphanum4",
              asset_code: "WBTC",
              asset_issuer: ISSUER_ID,
              balance: "1.0000000",
            },
          ])
        : { home_domain: "issuer.example" },
    );
    fetchStellarToml.mockResolvedValue({
      CURRENCIES: [{ code: "WBTC", issuer: ISSUER_ID, desc: "Wrapped Bitcoin" }],
    });
    mockOrderBook(5);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-exposure`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.exposure.wrapped).toBe(33.33);
    expect(res.body.data.breakdown[1].category).toBe("wrapped");
  });

  it("returns 404 when the account does not exist", async () => {
    const notFoundError = new Error("Not Found");
    notFoundError.response = { status: 404 };
    jest.spyOn(server, "loadAccount").mockRejectedValue(notFoundError);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/asset-exposure`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});