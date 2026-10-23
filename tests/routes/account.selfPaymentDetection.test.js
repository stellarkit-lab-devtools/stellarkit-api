const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

jest.mock("../../src/config/stellar", () => {
  const originalModule = jest.requireActual("../../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
      payments: jest.fn(),
      operations: jest.fn(),
    },
  };
});

describe("GET /account/:id/self-payment-detection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("detects a direct self-payment", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
      balances: [],
    });

    // Mock payments: account sends to itself
    server.payments.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "1001",
            type: "payment",
            from: accountId,
            to: accountId,
            amount: "100.0000000",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      }),
    });

    const res = await request(app).get(`/account/${accountId}/self-payment-detection`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.selfPaymentsDetected).toBe(true);
    expect(res.body.data.chains).toHaveLength(1);
    expect(res.body.data.chains[0].type).toBe("direct_self");
    expect(res.body.data.chains[0].length).toBe(1);
  });

  it("detects a 3-hop circular payment chain", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";
    const accountB = "GB2QJWLRBLLF7HQMQXWQMXS3JCTNHXZPNYLB6CLLPKFUWK3MVTMFHC6P";
    const accountC = "GBNY4SSPQQLQAJHLLBWIGFYQVDQ4DVVZHHQ7QTQ7A7AGJVFVFVKKMLC5K";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
      balances: [],
    });

    // Mock payment chain: A -> B -> C -> A
    server.payments.mockReturnValue({
      forAccount: jest.fn().mockImplementation((acc) => ({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            // Account A sends to B
            ...(acc === accountId
              ? [
                  {
                    id: "2001",
                    type: "payment",
                    from: accountId,
                    to: accountB,
                    amount: "50.0000000",
                    created_at: "2024-01-01T00:00:00Z",
                  },
                ]
              : []),
            // Account B sends to C
            ...(acc === accountB
              ? [
                  {
                    id: "2002",
                    type: "payment",
                    from: accountB,
                    to: accountC,
                    amount: "50.0000000",
                    created_at: "2024-01-01T00:00:01Z",
                  },
                ]
              : []),
            // Account C sends back to A
            ...(acc === accountC
              ? [
                  {
                    id: "2003",
                    type: "payment",
                    from: accountC,
                    to: accountId,
                    amount: "50.0000000",
                    created_at: "2024-01-01T00:00:02Z",
                  },
                ]
              : []),
          ],
        }),
      })),
    });

    const res = await request(app).get(`/account/${accountId}/self-payment-detection`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.selfPaymentsDetected).toBe(true);
    expect(res.body.data.chains).toHaveLength(1);
    expect(res.body.data.chains[0].type).toBe("circular_chain");
    expect(res.body.data.chains[0].length).toBe(3);
    expect(res.body.data.chains[0].chain).toEqual([accountId, accountB, accountC]);
  });

  it("returns false for an account with normal payment history", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";
    const otherAccount = "GB2QJWLRBLLF7HQMQXWQMXS3JCTNHXZPNYLB6CLLPKFUWK3MVTMFHC6P";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
      balances: [],
    });

    // Mock normal payments: account receives and sends
    server.payments.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "3001",
            type: "payment",
            from: otherAccount,
            to: accountId,
            amount: "100.0000000",
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            id: "3002",
            type: "payment",
            from: accountId,
            to: otherAccount,
            amount: "50.0000000",
            created_at: "2024-01-01T00:00:01Z",
          },
        ],
      }),
    });

    const res = await request(app).get(`/account/${accountId}/self-payment-detection`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.selfPaymentsDetected).toBe(false);
    expect(res.body.data.chains).toHaveLength(0);
  });

  it("does not flag chains longer than 10 hops", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    // Create a 12-hop chain
    const accounts = [accountId];
    for (let i = 0; i < 11; i++) {
      accounts.push(`GB${"A".repeat(54)}${String(i).padStart(2, "0")}`);
    }

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
      balances: [],
    });

    // Mock an extremely long chain that should not be flagged
    server.payments.mockReturnValue({
      forAccount: jest.fn().mockImplementation((acc) => ({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records:
            acc === accounts[5]
              ? [
                  // Middle of a 12-hop chain
                  {
                    id: "4001",
                    type: "payment",
                    from: accounts[5],
                    to: accounts[6],
                    amount: "10.0000000",
                    created_at: "2024-01-01T00:00:00Z",
                  },
                ]
              : [],
        }),
      })),
    });

    const res = await request(app).get(`/account/${accountId}/self-payment-detection`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Chains > 10 hops should not be flagged
    const longChains = res.body.data.chains.filter((c) => c.length > 10);
    expect(longChains).toHaveLength(0);
  });

  it("returns 404 for non-existent account", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockRejectedValue({
      response: { status: 404 },
    });

    const res = await request(app).get(`/account/${accountId}/self-payment-detection`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
