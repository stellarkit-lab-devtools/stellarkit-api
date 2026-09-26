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
      offers: jest.fn(),
    },
  };
});

describe("Account Sponsorship API", () => {
  const accountId = Keypair.random().publicKey();
  const sponsorId = "G_SPONSOR";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /account/:id/sponsorship (DEPRECATED)", () => {
    it("returns 410 Gone with deprecation message", async () => {
      const res = await request(app).get(`/account/${accountId}/sponsorship`);

      expect(res.statusCode).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("Gone");
      expect(res.body.error.deprecated).toBe(true);
      expect(res.body.error.replacementEndpoint).toBe("/account/:id/sponsorships");
    });
  });
});
