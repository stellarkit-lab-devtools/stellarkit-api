const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      claimableBalances: jest.fn(),
    },
  };
});

describe("Claimable Balance Evaluation API", () => {
  const balanceId = "00000000abcdef...";
  const accountId = "GA...DESTINATION";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns canClaimNow: true for unconditional predicate", async () => {
    server.claimableBalances.mockReturnValue({
      claimableBalance: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        id: balanceId,
        claimants: [
          {
            destination: accountId,
            predicate: { unconditional: true },
          },
        ],
      }),
    });

    const res = await request(app).get(`/claimable-balances/${balanceId}/evaluate/${accountId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.canClaimNow).toBe(true);
    expect(res.body.data.reason).toContain("unconditionally");
  });

  it("returns canClaimNow: false if deadline passed (abs_before)", async () => {
    const pastDate = new Date(Date.now() - 100000).toISOString();
    server.claimableBalances.mockReturnValue({
      claimableBalance: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        id: balanceId,
        claimants: [
          {
            destination: accountId,
            predicate: { abs_before: pastDate },
          },
        ],
      }),
    });

    const res = await request(app).get(`/claimable-balances/${balanceId}/evaluate/${accountId}`);

    expect(res.body.data.canClaimNow).toBe(false);
    expect(res.body.data.reason).toContain("passed");
  });

  it("returns 400 if account is not a claimant", async () => {
    server.claimableBalances.mockReturnValue({
      claimableBalance: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        id: balanceId,
        claimants: [
          {
            destination: "OTHER_ACCOUNT",
            predicate: { unconditional: true },
          },
        ],
      }),
    });

    const res = await request(app).get(`/claimable-balances/${balanceId}/evaluate/${accountId}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain("not a listed claimant");
  });
});
