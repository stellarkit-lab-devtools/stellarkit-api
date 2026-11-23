"use strict";

/**
 * Tests for GET /account/:id/sponsorships
 *
 * Verifies the consolidated sponsorship endpoint that returns:
 *   - accountId, accountSponsor, sponsoredEntries, accountsSponsoring, total
 *   - sponsoredEntries: array of { type, asset|key|offerId, sponsor, reserveAmount }
 *   - accountsSponsoring: array of account IDs this account sponsors
 *   - total: count of sponsoredEntries
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
      accounts: jest.fn(),
      offers: jest.fn(),
    },
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");

const accountId = Keypair.random().publicKey();
const sponsorId = Keypair.random().publicKey();
const sponsoredAccountId = Keypair.random().publicKey();

describe("GET /account/:id/sponsorships", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns full consolidated sponsorship summary", async () => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      sponsor: sponsorId,
      balances: [
        { asset_type: "native", balance: "10.0000000", sponsor: sponsorId },
        {
          asset_code: "USDC",
          asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          asset_type: "credit_alphanum4",
          balance: "5.0000000",
          sponsor: sponsorId,
        },
      ],
      signers: [
        { key: accountId, weight: 1, sponsor: null },
        { key: sponsorId, weight: 1, sponsor: sponsorId },
      ],
      data_attr: { myKey: "dmFsdWU=" },
      data_sponsors: { myKey: sponsorId },
    });

    server.accounts.mockReturnValue({
      sponsor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [{ id: sponsoredAccountId }] }),
    });

    server.offers.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ 
        records: [
          { id: "OFFER_1", sponsor: sponsorId },
          { id: "OFFER_2", sponsor: null },
        ]
      }),
    });

    const res = await request(app).get(`/account/${accountId}/sponsorships`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.accountId).toBe(accountId);
    expect(data.accountSponsor).toBe(sponsorId);
    expect(data.total).toBe(5); // 2 trustlines + 1 signer + 1 data entry + 1 offer
    expect(data.sponsoredEntries).toHaveLength(5);

    // Check sponsoredEntries shape
    const trustlines = data.sponsoredEntries.filter((e) => e.type === "trustline");
    expect(trustlines).toHaveLength(2);
    expect(trustlines[0].sponsor).toBe(sponsorId);
    expect(trustlines[0].reserveAmount).toBe("0.5000000");

    const signers = data.sponsoredEntries.filter((e) => e.type === "signer");
    expect(signers).toHaveLength(1);
    expect(signers[0].sponsor).toBe(sponsorId);
    expect(signers[0].reserveAmount).toBe("0.5000000");

    const dataEntries = data.sponsoredEntries.filter((e) => e.type === "data_entry");
    expect(dataEntries).toHaveLength(1);
    expect(dataEntries[0].sponsor).toBe(sponsorId);
    expect(dataEntries[0].reserveAmount).toBe("0.5000000");

    const offers = data.sponsoredEntries.filter((e) => e.type === "offer");
    expect(offers).toHaveLength(1);
    expect(offers[0].sponsor).toBe(sponsorId);
    expect(offers[0].offerId).toBe("OFFER_1");
    expect(offers[0].reserveAmount).toBe("0.5000000");

    // Check sponsoring array
    expect(Array.isArray(data.accountsSponsoring)).toBe(true);
    expect(data.accountsSponsoring).toEqual([sponsoredAccountId]);
  });

  it("returns empty arrays when account has no sponsorships", async () => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      balances: [{ asset_type: "native", balance: "10.0000000" }],
      signers: [{ key: accountId, weight: 1 }],
      data_attr: {},
    });

    server.accounts.mockReturnValue({
      sponsor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    server.offers.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    const res = await request(app).get(`/account/${accountId}/sponsorships`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.sponsoredEntries).toHaveLength(0);
    expect(res.body.data.accountsSponsoring).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get("/account/NOT_A_VALID_KEY/sponsorships");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });

  it("returns 404 when the account does not exist on Horizon", async () => {
    server.loadAccount.mockRejectedValue({
      response: { status: 404 },
    });

    const res = await request(app).get(`/account/${accountId}/sponsorships`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
