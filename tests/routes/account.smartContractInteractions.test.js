"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();

function operation(type, overrides = {}) {
  return {
    id: `operation-${type}`,
    type,
    transaction_hash: `transaction-${type}`,
    transaction_successful: true,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockOperations(records) {
  jest.spyOn(server, "operations").mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/smart-contract-interactions", () => {
  it("returns only the invoke host function from mixed operation types", async () => {
    mockOperations([
      operation("payment", {
        id: "payment-operation",
        transaction_hash: "mixed-transaction",
      }),
      operation("invoke_host_function", {
        id: "invoke-operation",
        transaction_hash: "mixed-transaction",
        function: "hello",
      }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.interactions).toHaveLength(1);
    expect(res.body.data.interactions[0]).toMatchObject({
      id: "invoke-operation",
      type: "invoke_host_function",
      transactionHash: "mixed-transaction",
    });
  });

  it("reports whether each contract call succeeded", async () => {
    mockOperations([
      operation("invoke_host_function", {
        id: "successful-invoke",
        transaction_successful: true,
      }),
      operation("invoke_host_function", {
        id: "failed-invoke",
        transaction_hash: "failed-transaction",
        transaction_successful: false,
      }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.interactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "successful-invoke", success: true }),
        expect.objectContaining({ id: "failed-invoke", success: false }),
      ]),
    );
  });

  it("includes a transactionHash on every interaction", async () => {
    mockOperations([
      operation("invoke_host_function", {
        id: "invoke-one",
        transaction_hash: "transaction-one",
      }),
      operation("invoke_host_function", {
        id: "invoke-two",
        transaction_hash: "transaction-two",
      }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.interactions).toHaveLength(2);
    for (const interaction of res.body.data.interactions) {
      expect(interaction.transactionHash).toEqual(expect.any(String));
      expect(interaction.transactionHash.length).toBeGreaterThan(0);
    }
  });

  it("returns an empty interactions array when no Soroban contract calls exist", async () => {
    mockOperations([
      operation("payment"),
      operation("create_account", { transaction_hash: "create-account-tx" }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.interactions).toEqual([]);
  });
});