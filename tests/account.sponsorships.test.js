"use strict";

/**
 * Tests for GET /account/:id/sponsorships
 *
 * Verifies the typed sponsorship summary endpoint that returns:
 *   - sponsoredBy: array of { type, address, sponsor, reserveAmount }
 *   - sponsoring:  array of account IDs this account sponsors
 *   - count:       number of sponsoredBy entries
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

  it("returns full typed sponsorship summary", async () => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
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

    const res = await request(app).get(`/account/${accountId}/sponsorships`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.accountId).toBe(accountId);
    expect(data.count).toBe(4); // 2 trustlines + 1 signer + 1 data entry

    // Check sponsoredBy shape
    expect(Array.isArray(data.sponsoredBy)).toBe(true);
    expect(data.sponsoredBy).toHaveLength(4);

    const trustlines = data.sponsoredBy.filter((e) => e.type === "trustline");
    expect(trustlines).toHaveLength(2);
    expect(trustlines[0].address).toBe("XLM");
    expect(trustlines[0].sponsor).toBe(sponsorId);
    expect(trustlines[0].reserveAmount).toBe("0.5000000");
    expect(trustlines[1].address).toBe(
      "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    );

    const signers = data.sponsoredBy.filter((e) => e.type === "signer");
    expect(signers).toHaveLength(1);
    expect(signers[0].address).toBe(sponsorId);
    expect(signers[0].reserveAmount).toBe("0.5000000");

    const dataEntries = data.sponsoredBy.filter((e) => e.type === "data_entry");
    expect(dataEntries).toHaveLength(1);
    expect(dataEntries[0].address).toBe("myKey");
    expect(dataEntries[0].reserveAmount).toBe("0.5000000");

    // Check sponsoring array
    expect(Array.isArray(data.sponsoring)).toBe(true);
    expect(data.sponsoring).toEqual([sponsoredAccountId]);
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

    const res = await request(app).get(`/account/${accountId}/sponsorships`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.sponsoredBy).toHaveLength(0);
    expect(res.body.data.sponsoring).toHaveLength(0);
    expect(res.body.data.count).toBe(0);
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

  it("each sponsoredBy entry always contains type, address, sponsor, and reserveAmount", async () => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      balances: [
        {
          asset_code: "USDC",
          asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          asset_type: "credit_alphanum4",
          balance: "5.0000000",
          sponsor: sponsorId,
        },
      ],
      signers: [],
      data_attr: {},
    });

    server.accounts.mockReturnValue({
      sponsor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    const res = await request(app).get(`/account/${accountId}/sponsorships`);

    expect(res.statusCode).toBe(200);
    const entry = res.body.data.sponsoredBy[0];
    expect(entry).toHaveProperty("type");
    expect(entry).toHaveProperty("address");
    expect(entry).toHaveProperty("sponsor");
    expect(entry).toHaveProperty("reserveAmount");
    expect(entry.reserveAmount).toBe("0.5000000");
  });
});
