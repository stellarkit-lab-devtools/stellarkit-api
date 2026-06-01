const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock Horizon server
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

describe("Account Sponsorship API", () => {
  const accountId = Keypair.random().publicKey();
  const sponsorId = "G_SPONSOR";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /account/:id/sponsorship", () => {
    it("returns full sponsorship details", async () => {
      const mockAccount = {
        id: accountId,
        sponsor: sponsorId,
        num_sponsored: 2,
        num_sponsoring: 1,
        balances: [
          {
            asset_type: "native",
            balance: "10.0000000",
            sponsor: sponsorId,
          },
          {
            asset_code: "USDC",
            asset_issuer: "G_ISSUER",
            asset_type: "credit_alphanum4",
            balance: "5.0000000",
            sponsor: sponsorId,
          },
        ],
        signers: [
          {
            key: accountId,
            weight: 1,
            sponsor: null,
          },
          {
            key: "G_OTHER_SIGNER",
            weight: 1,
            sponsor: sponsorId,
          },
        ],
        data_attr: {
          "test_key": "dGVzdF92YWx1ZQ==",
        },
        data_sponsors: {
          "test_key": sponsorId,
        },
      };

      const mockSponsoringAccounts = {
        records: [
          { id: "G_SPONSORED_ACCOUNT_1" },
        ],
      };

      server.loadAccount.mockResolvedValue(mockAccount);
      server.accounts.mockReturnValue({
        sponsor: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockSponsoringAccounts),
      });

      const res = await request(app).get(`/account/${accountId}/sponsorship`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accountId).toBe(accountId);
      expect(res.body.data.accountSponsor).toBe(sponsorId);
      expect(res.body.data.sponsoredEntries).toHaveLength(4); // 2 trustlines + 1 signer + 1 data entry
      
      const trustlines = res.body.data.sponsoredEntries.filter(e => e.type === "trustline");
      expect(trustlines).toHaveLength(2);
      expect(trustlines[0].sponsor).toBe(sponsorId);

      const signers = res.body.data.sponsoredEntries.filter(e => e.type === "signer");
      expect(signers).toHaveLength(1);
      expect(signers[0].sponsor).toBe(sponsorId);

      const dataEntries = res.body.data.sponsoredEntries.filter(e => e.type === "data_entry");
      expect(dataEntries).toHaveLength(1);
      expect(dataEntries[0].sponsor).toBe(sponsorId);

      expect(res.body.data.accountsSponsoring).toEqual(["G_SPONSORED_ACCOUNT_1"]);
    });

    it("returns null/empty lists for accounts without sponsorship", async () => {
      const mockAccount = {
        id: accountId,
        balances: [{ asset_type: "native", balance: "10.0000000" }],
        signers: [{ key: accountId, weight: 1 }],
        num_sponsored: 0,
        num_sponsoring: 0,
      };

      server.loadAccount.mockResolvedValue(mockAccount);
      server.accounts.mockReturnValue({
        sponsor: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get(`/account/${accountId}/sponsorship`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.accountSponsor).toBeNull();
      expect(res.body.data.sponsoredEntries).toHaveLength(0);
      expect(res.body.data.accountsSponsoring).toHaveLength(0);
    });

    it("validates the account ID", async () => {
      const res = await request(app).get("/account/INVALID_ID/sponsorship");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });
});
