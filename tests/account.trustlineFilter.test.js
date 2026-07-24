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

const ACCOUNT_ID = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
const ISSUER_A = "GD62SRSGF4XVUHZYLZNAMTUTOH7CKJ2WZWX6HNUTZ4G5SFKNAM6G2OXD";
const ISSUER_B = "GBDUK225U2UZ2YBZMIIGPI2XK35PKWUW25YYS2NNQ3HWYAMWSGWME4IA";

function makeAccount() {
  return {
    id: ACCOUNT_ID,
    balances: [
      { asset_type: "native", balance: "10.0000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER_A,
        balance: "100.0000000",
        limit: "1000.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_authorized_to_maintain_liabilities: false,
        is_clawback_enabled: false,
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "BTC",
        asset_issuer: ISSUER_B,
        balance: "0.5000000",
        limit: "10.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_authorized_to_maintain_liabilities: true,
        is_clawback_enabled: false,
      },
    ],
  };
}

describe("GET /account/:id/trustlines?assetCode=", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    server.loadAccount.mockImplementation(async (id) => {
      if (id === ACCOUNT_ID) return makeAccount();
      return { id, home_domain: null };
    });
  });

  it("filters trustlines by matching asset code", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines?assetCode=USDC`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].asset.code).toBe("USDC");
  });

  it("filters case-insensitively", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines?assetCode=usdc`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].asset.code).toBe("USDC");
  });

  it("returns empty array when no trustlines match", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines?assetCode=ETH`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("returns all trustlines when assetCode is not specified", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });

  it("returns trustline entries with normalised asset shape", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/trustlines?assetCode=BTC`,
    );

    expect(res.statusCode).toBe(200);
    const trustline = res.body.data.items[0];
    expect(trustline).toMatchObject({
      asset: { code: "BTC", issuer: ISSUER_B, type: "credit_alphanum4" },
      balance: "0.5000000",
      limit: "10.0000000",
      isAuthorized: true,
      isAuthorizedToMaintainLiabilities: true,
    });
  });
});
