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
      claimableBalances: jest.fn(),
    },
  };
});

describe("Account Claimable Balances Eligibility API", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /account/:id/claimable-balances/eligible", () => {
    it("categorizes claimable balances correctly", async () => {
      const now = Math.floor(Date.now() / 1000);
      
      const mockRecords = [
        {
          id: "000000001",
          asset: "XLM",
          amount: "100.0000000",
          claimants: [
            { destination: accountId, predicate: { unconditional: true } }
          ]
        },
        {
          id: "000000002",
          asset: "XLM",
          amount: "200.0000000",
          claimants: [
            { destination: accountId, predicate: { abs_after: (now + 3600).toString() } }
          ]
        },
        {
          id: "000000003",
          asset: "XLM",
          amount: "300.0000000",
          claimants: [
            { destination: accountId, predicate: { abs_before: (now - 3600).toString() } }
          ]
        }
      ];

      server.claimableBalances.mockReturnValue({
        forClaimant: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockRecords })
      });

      const res = await request(app).get(`/account/${accountId}/claimable-balances/eligible`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eligible).toHaveLength(1);
      expect(res.body.data.eligible[0].id).toBe("000000001");
      expect(res.body.data.notYetClaimable).toHaveLength(1);
      expect(res.body.data.notYetClaimable[0].id).toBe("000000002");
      expect(res.body.data.expired).toHaveLength(1);
      expect(res.body.data.expired[0].id).toBe("000000003");
    });

    it("handles complex predicates (AND)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockRecords = [
        {
          id: "000000004",
          asset: "USDC",
          amount: "50.0000000",
          claimants: [
            { 
              destination: accountId, 
              predicate: { 
                and: [
                  { abs_after: (now - 1000).toString() },
                  { abs_before: (now + 1000).toString() }
                ] 
              } 
            }
          ]
        }
      ];

      server.claimableBalances.mockReturnValue({
        forClaimant: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockRecords })
      });

      const res = await request(app).get(`/account/${accountId}/claimable-balances/eligible`);
      expect(res.body.data.eligible).toHaveLength(1);
    });

    it("validates account ID", async () => {
      const res = await request(app).get("/account/INVALID/claimable-balances/eligible");
      expect(res.statusCode).toBe(400);
    });
  });
});
