"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const ACCOUNT_ID = Keypair.random().publicKey();
const CREATED_BY_ACCOUNT = Keypair.random().publicKey();
const CREATED_BY_OTHER = Keypair.random().publicKey();

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      operations: jest.fn(),
    },
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");

function operationQuery(records) {
  const query = {
    forAccount: jest.fn(() => query),
    limit: jest.fn(() => query),
    order: jest.fn(() => query),
    cursor: jest.fn(() => query),
    call: jest.fn().mockResolvedValue({ records }),
  };
  return query;
}

describe("GET /account/:id/funded-accounts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
  });

  it("includes create_account operations funded by this account only", async () => {
    const records = [
      {
        type: "create_account",
        funder: CREATED_BY_OTHER,
        account: ACCOUNT_ID,
        starting_balance: "8.0000000",
        paging_token: "created-this-account",
      },
      {
        type: "create_account",
        funder: ACCOUNT_ID,
        account: CREATED_BY_ACCOUNT,
        starting_balance: "12.3456789",
        created_at: "2024-01-15T12:00:00Z",
        transaction_hash: "funded-tx",
        paging_token: "funded",
      },
      {
        type: "create_account",
        funder: ACCOUNT_ID,
        account: CREATED_BY_OTHER,
        starting_balance: "2.0000000",
        created_at: "2024-01-16T12:00:00Z",
        transaction_hash: "funded-tx-2",
        paging_token: "funded-2",
      },
      {
        type: "payment",
        from: ACCOUNT_ID,
        to: CREATED_BY_OTHER,
        paging_token: "payment",
      },
    ];
    const query = operationQuery(records);
    server.operations.mockReturnValue(query);

    const response = await request(app).get(
      `/account/${ACCOUNT_ID}/funded-accounts?limit=5&cursor=start&order=asc`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items).toEqual([
      {
        address: CREATED_BY_ACCOUNT,
        startingBalanceXLM: "12.3456789",
        createdAt: "2024-01-15T12:00:00.000Z",
        transactionHash: "funded-tx",
      },
      {
        address: CREATED_BY_OTHER,
        startingBalanceXLM: "2.0000000",
        createdAt: "2024-01-16T12:00:00.000Z",
        transactionHash: "funded-tx-2",
      },
    ]);
    expect(response.body.data.totalStartingBalanceXLM).toBe("14.3456789");
    expect(response.body.meta.partial).toBe(false);
    expect(query.limit).toHaveBeenCalledWith(200);
    expect(query.order).toHaveBeenCalledWith("asc");
    expect(query.cursor).toHaveBeenCalledWith("start");
  });

  it("marks the response partial after scanning ten full pages", async () => {
    let pageNumber = 0;
    server.operations.mockImplementation(() => {
      pageNumber++;
      const records = Array.from({ length: 200 }, (_, index) => ({
        type: "payment",
        paging_token: `${pageNumber}-${index}`,
      }));
      return operationQuery(records);
    });

    const response = await request(app).get(
      `/account/${ACCOUNT_ID}/funded-accounts?limit=2`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items).toEqual([]);
    expect(response.body.meta.partial).toBe(true);
    expect(pageNumber).toBe(10);
  });

  it("returns an empty, complete result when the account created nothing", async () => {
    server.operations.mockReturnValue(operationQuery([]));

    const response = await request(app).get(
      `/account/${ACCOUNT_ID}/funded-accounts`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.totalStartingBalanceXLM).toBe("0.0000000");
    expect(response.body.meta.partial).toBe(false);
  });

  it("returns 404 when the account does not exist", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    const response = await request(app).get(
      `/account/${ACCOUNT_ID}/funded-accounts`,
    );

    expect(response.statusCode).toBe(404);
    expect(response.body.success).toBe(false);
    expect(server.operations).not.toHaveBeenCalled();
  });
});
