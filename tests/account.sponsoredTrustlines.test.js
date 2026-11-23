const request = require("supertest");
const axios = require("axios");

jest.mock("axios", () => ({
  create: jest.fn(() => ({
    interceptors: { response: { use: jest.fn() } },
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
const cacheService = require("../src/services/cache");

const ACCOUNT_ID = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
const ISSUER_A = "GD62SRSGF4XVUHZYLZNAMTUTOH7CKJ2WZWX6HNUTZ4G5SFKNAM6G2OXD";
const ISSUER_B = "GBDUK225U2UZ2YBZMIIGPI2XK35PKWUW25YYS2NNQ3HWYAMWSGWME4IA";
const SPONSOR_ID = "GA4TZFI2SHGWNYKMPGB6KCUOA3AEEHW3S4L3ZQCTZ4SFR6HTNSC4NCPQ";

function makeAccount() {
  return {
    id: ACCOUNT_ID,
    balances: [
      { asset_type: "native", balance: "10.0000000" },
      {
        // Sponsored trustline
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER_A,
        balance: "100.0000000",
        limit: "1000.0000000",
        is_authorized: true,
        is_authorized_to_maintain_liabilities: false,
        sponsor: SPONSOR_ID,
      },
      {
        // Unsponsored trustline
        asset_type: "credit_alphanum4",
        asset_code: "BTC",
        asset_issuer: ISSUER_B,
        balance: "0.5000000",
        limit: "10.0000000",
        is_authorized: true,
        is_authorized_to_maintain_liabilities: true,
      },
    ],
  };
}

describe("GET /account/:id/trustlines?sponsored=", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    server.loadAccount.mockImplementation(async (id) => {
      if (id === ACCOUNT_ID) return makeAccount();
      return { id, home_domain: null };
    });
  });

  it("returns only sponsored trustlines when sponsored=true", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines?sponsored=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].asset.code).toBe("USDC");
    expect(res.body.data.items[0].sponsoredBy).toBe(SPONSOR_ID);
  });

  it("returns only unsponsored trustlines when sponsored=false", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines?sponsored=false`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].asset.code).toBe("BTC");
    expect(res.body.data.items[0].sponsoredBy).toBeNull();
  });

  it("returns all trustlines when sponsored is omitted", async () => {
    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustlines`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });

  it("every trustline includes a sponsoredBy field (string or null)", async () => {
    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustlines`);

    expect(res.statusCode).toBe(200);
    for (const trustline of res.body.data.items) {
      expect(trustline).toHaveProperty("sponsoredBy");
    }
  });

  it("combines assetCode and sponsored filters", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines?assetCode=USDC&sponsored=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].asset.code).toBe("USDC");
  });

  it("ignores an invalid sponsored value and returns all trustlines", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines?sponsored=maybe`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
  });
});
