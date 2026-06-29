const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { offers: jest.fn() },
}));

const accountId = Keypair.random().publicKey();
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const mockOffers = [
  {
    id: "1",
    seller: accountId,
    selling_asset_type: "native",
    selling_asset_code: undefined,
    selling_asset_issuer: undefined,
    buying_asset_type: "credit_alphanum4",
    buying_asset_code: "USDC",
    buying_asset_issuer: ISSUER,
    amount: "100.5",
    price: "1.5",
    price_r: { n: 3, d: 2 },       // 3/2 = 1.5
    last_modified_ledger: 12345,
    paging_token: "t1",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  server.offers.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: mockOffers }),
  });
});

describe("GET /account/:id/offers — normalised response", () => {
  it("returns 200 with correct shape", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  it("price is a seven-decimal string derived from price_r", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    const offer = res.body.data.items[0];
    expect(offer.price).toBe("1.5000000");
  });

  it("selling.amount is formatted to seven decimal places", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    expect(res.body.data.items[0].selling.amount).toBe("100.5000000");
  });

  it("lastModifiedLedger is present (snake_case removed)", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    const offer = res.body.data.items[0];
    expect(offer).toHaveProperty("lastModifiedLedger", 12345);
    expect(offer).not.toHaveProperty("last_modified_ledger");
  });

  it("all asset fields are camelCase", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    const offer = res.body.data.items[0];
    expect(offer.selling).toHaveProperty("assetType");
    expect(offer.selling).toHaveProperty("assetCode");
    expect(offer.selling).toHaveProperty("assetIssuer");
    expect(offer.buying).toHaveProperty("assetType");
    expect(offer.buying).toHaveProperty("assetCode");
    expect(offer.buying).toHaveProperty("assetIssuer");
    // no raw snake_case fields
    expect(offer).not.toHaveProperty("selling_asset_type");
    expect(offer).not.toHaveProperty("last_modified_ledger");
  });

  it("native selling asset normalises to XLM with null issuer", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    const selling = res.body.data.items[0].selling;
    expect(selling.assetType).toBe("native");
    expect(selling.assetCode).toBe("XLM");
    expect(selling.assetIssuer).toBeNull();
  });
});
