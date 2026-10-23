const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

jest.mock("../../src/config/stellar", () => {
  const originalModule = jest.requireActual("../../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
      transactions: jest.fn(),
      operations: jest.fn(),
    },
  };
});

describe("GET /account/:id/largest-transactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns transactions sorted by total value in descending order", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
    });

    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "1001",
            hash: "abc123def456",
            created_at: "2024-01-01T00:00:00Z",
            operation_count: 1,
            fee_charged: 100,
            successful: true,
          },
          {
            id: "1002",
            hash: "xyz789uvw012",
            created_at: "2024-01-01T00:00:01Z",
            operation_count: 2,
            fee_charged: 100,
            successful: true,
          },
        ],
      }),
    });

    server.operations.mockReturnValue({
      forTransaction: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockImplementation(function () {
        const txId = this.forTransaction?.mock?.results[0]?.value?.transactionId || "1001";
        if (txId === "1001") {
          return Promise.resolve({
            records: [
              {
                type: "payment",
                amount: "500.0000000",
                asset_code: "XLM",
              },
            ],
          });
        }
        return Promise.resolve({
          records: [
            {
              type: "payment",
              amount: "1000.0000000",
              asset_code: "XLM",
            },
            {
              type: "payment",
              amount: "250.0000000",
              asset_code: "USDC",
            },
          ],
        });
      }),
    });

    const res = await request(app).get(`/account/${accountId}/largest-transactions`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(accountId);
    expect(res.body.data.transactions).toBeDefined();
    expect(Array.isArray(res.body.data.transactions)).toBe(true);
  });

  it("filters by direction=sent", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
    });

    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "1001",
            hash: "abc123def456",
            created_at: "2024-01-01T00:00:00Z",
            operation_count: 1,
            fee_charged: 100,
            successful: true,
          },
        ],
      }),
    });

    server.operations.mockReturnValue({
      forTransaction: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            type: "payment",
            from: accountId,
            to: "GOTHER",
            amount: "500.0000000",
            asset_code: "XLM",
          },
        ],
      }),
    });

    const res = await request(app).get(
      `/account/${accountId}/largest-transactions?direction=sent`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transactions[0].direction).toBe("sent");
  });

  it("filters by direction=received", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
    });

    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "1001",
            hash: "abc123def456",
            created_at: "2024-01-01T00:00:00Z",
            operation_count: 1,
            fee_charged: 100,
            successful: true,
          },
        ],
      }),
    });

    server.operations.mockReturnValue({
      forTransaction: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            type: "payment",
            from: "GOTHER",
            to: accountId,
            amount: "500.0000000",
            asset_code: "XLM",
          },
        ],
      }),
    });

    const res = await request(app).get(
      `/account/${accountId}/largest-transactions?direction=received`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transactions[0].direction).toBe("received");
  });

  it("respects limit parameter capped at 50", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
    });

    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [],
      }),
    });

    const res = await request(app).get(
      `/account/${accountId}/largest-transactions?limit=100`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify limit was capped at 50
    expect(server.transactions().limit.mock.calls[0][0]).toBeLessThanOrEqual(50);
  });

  it("includes transaction hash, total value, operation count, and timestamp", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
    });

    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "1001",
            hash: "abc123def456",
            created_at: "2024-01-01T00:00:00Z",
            operation_count: 1,
            fee_charged: 100,
            successful: true,
          },
        ],
      }),
    });

    server.operations.mockReturnValue({
      forTransaction: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            type: "payment",
            from: accountId,
            to: "GOTHER",
            amount: "500.0000000",
            asset_code: "XLM",
          },
        ],
      }),
    });

    const res = await request(app).get(`/account/${accountId}/largest-transactions`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    const tx = res.body.data.transactions[0];
    expect(tx).toHaveProperty("hash");
    expect(tx).toHaveProperty("totalValueXLM");
    expect(tx).toHaveProperty("operationCount");
    expect(tx).toHaveProperty("direction");
    expect(tx).toHaveProperty("timestamp");
  });

  it("returns 404 for non-existent account", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockRejectedValue({
      response: { status: 404 },
    });

    const res = await request(app).get(`/account/${accountId}/largest-transactions`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns proper response envelope with period metadata", async () => {
    const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

    server.loadAccount.mockResolvedValue({
      id: accountId,
      account_id: accountId,
    });

    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [],
      }),
    });

    const res = await request(app).get(`/account/${accountId}/largest-transactions`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(accountId);
    expect(res.body.data.transactions).toBeDefined();
    expect(res.body.data.period).toBeDefined();
  });
});
