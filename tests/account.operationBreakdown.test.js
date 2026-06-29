const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      operations: jest.fn(),
    },
  };
});

describe("Account Operation Breakdown API", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns breakdown for an account with operations", async () => {
    const mockOperations = [
      { type: "payment" },
      { type: "payment" },
      { type: "payment" },
      { type: "change_trust" },
      { type: "manage_sell_offer" },
    ];

    server.operations.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: mockOperations }),
    });

    const res = await request(app).get(`/account/${accountId}/operation-breakdown`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.breakdown).toHaveLength(3);
    expect(res.body.data.breakdown[0].type).toBe("payment");
    expect(res.body.data.breakdown[0].count).toBe(3);
    expect(res.body.data.breakdown[0].percentage).toBe(60);
    expect(res.body.data.mostUsedOperation).toBe("payment");
    expect(res.body.data.leastUsedOperation).toBeOneOf(["change_trust", "manage_sell_offer"]);
  });

  it("returns zeros for account with no operations", async () => {
    server.operations.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    const res = await request(app).get(`/account/${accountId}/operation-breakdown`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.breakdown).toEqual([]);
  });
});

// Helper for expect
expect.extend({
  toBeOneOf(received, argument) {
    const pass = argument.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${argument}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${argument}`,
        pass: false,
      };
    }
  },
});
