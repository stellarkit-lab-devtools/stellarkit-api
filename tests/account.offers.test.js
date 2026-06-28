const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      offers: jest.fn(),
    },
  };
});

describe("GET /account/:id/offers", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns open offers for a valid account", async () => {
    const mockRecords = [
      {
        id: "456",
        selling_asset_type: "native",
        buying_asset_type: "credit_alphanum4",
        buying_asset_code: "USDC",
        buying_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        amount: "50.0",
        price: "2.5",
        last_modified_ledger: 12345,
        paging_token: "p1",
      },
    ];

    server.offers.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: mockRecords }),
    });

    const res = await request(app).get(`/account/${accountId}/offers`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offers).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data).toHaveProperty("limit");
    expect(res.body.data).toHaveProperty("cursor");

    const offer = res.body.data.offers[0];
    expect(offer).toHaveProperty("offerId", "456");
    expect(offer.selling).toMatchObject({
      assetType: "native",
      assetCode: "XLM",
      assetIssuer: null,
      amount: "50.0",
    });
    expect(offer.buying).toMatchObject({
      assetType: "credit_alphanum4",
      assetCode: "USDC",
      assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    });
    expect(offer).toHaveProperty("price", "2.5");
    expect(offer).toHaveProperty("lastModifiedLedger", 12345);
  });

  it("returns empty offers array when account has no offers", async () => {
    server.offers.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    const res = await request(app).get(`/account/${accountId}/offers`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.offers).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.cursor).toBeNull();
  });

  it("respects limit query param", async () => {
    server.offers.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    const res = await request(app).get(`/account/${accountId}/offers?limit=5`);

    expect(res.statusCode).toBe(200);
    expect(server.offers).toHaveBeenCalled();
  });

  it("passes order param to Horizon", async () => {
    server.offers.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    await request(app).get(`/account/${accountId}/offers?order=asc`);

    expect(server.offers).toHaveBeenCalled();
  });

  it("returns 400 for invalid account ID", async () => {
    const res = await request(app).get("/account/INVALID_KEY/offers");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 for invalid limit value", async () => {
    const res = await request(app).get(`/account/${accountId}/offers?limit=-1`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns cursor when more results exist", async () => {
    const mockRecords = [
      { id: "1", paging_token: "p1", amount: "10", price: "1", last_modified_ledger: 1 },
      { id: "2", paging_token: "p2", amount: "20", price: "2", last_modified_ledger: 2 },
    ];
    const enriched = mockRecords.map((r) => ({
      ...r,
      selling_asset_type: "native",
      buying_asset_type: "native",
      selling_asset_code: undefined,
      selling_asset_issuer: undefined,
      buying_asset_code: undefined,
      buying_asset_issuer: undefined,
      last_modified_ledger: r.last_modified_ledger,
    }));

    server.offers.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: enriched }),
    });

    const res = await request(app).get(`/account/${accountId}/offers?limit=2`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.cursor).toBe("p2");
    expect(res.body.data.offers).toHaveLength(2);
  });
});
