/**
 * tests/routes/account.smartContractInteractions.test.js
 *
 * Unit tests for GET /account/:id/smart-contract-interactions filtering and
 * pagination:
 *
 *   1. An account with 3 contract interactions returns all three.
 *   2. ?limit=2 returns only 2 results with a cursor.
 *   3. An account with no Soroban interactions returns an empty array.
 *   4. Each interaction has all five required fields.
 *   5. A non-existent account returns 404.
 *
 * server.loadAccount() and server.operations() are mocked; the operations
 * response mixes invoke_host_function records with other operation types so
 * the route's filtering is exercised.
 */

"use strict";

const request = require("supertest");
const { Address, Keypair, StrKey, xdr } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

const REQUIRED_FIELDS = [
  "contractId",
  "function",
  "timestamp",
  "success",
  "transactionHash",
];

let tokenSeq = 0;

function contractAddressParam(contractId) {
  return {
    type: "Address",
    value: new Address(contractId).toScVal().toXDR("base64"),
  };
}

function symbolParam(name) {
  return { type: "Sym", value: xdr.ScVal.scvSymbol(name).toXDR("base64") };
}

function invokeOp({ fn = "transfer", hash, successful = true } = {}) {
  tokenSeq += 1;
  return {
    id: `op-${tokenSeq}`,
    paging_token: `token_${tokenSeq}`,
    type: "invoke_host_function",
    function: "HostFunctionTypeHostFunctionTypeInvokeContract",
    parameters: [contractAddressParam(CONTRACT_ID), symbolParam(fn)],
    transaction_hash: hash || `tx-${tokenSeq}`,
    transaction_successful: successful,
    created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, tokenSeq)).toISOString(),
  };
}

function otherOp(type) {
  tokenSeq += 1;
  return {
    id: `op-${tokenSeq}`,
    paging_token: `token_${tokenSeq}`,
    type,
    transaction_hash: `tx-${tokenSeq}`,
    transaction_successful: true,
    created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, tokenSeq)).toISOString(),
  };
}

function mockAccountExists() {
  jest.spyOn(server, "loadAccount").mockResolvedValue({ id: ACCOUNT_ID });
}

function mockOperations(records) {
  const builder = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  jest.spyOn(server, "operations").mockReturnValue(builder);
  return builder;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/smart-contract-interactions", () => {
  it("returns all three contract interactions for an account with 3 interactions", async () => {
    mockAccountExists();
    mockOperations([
      invokeOp({ fn: "transfer", hash: "tx-a" }),
      otherOp("payment"),
      invokeOp({ fn: "mint", hash: "tx-b" }),
      otherOp("change_trust"),
      invokeOp({ fn: "burn", hash: "tx-c" }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.interactions).toHaveLength(3);
    expect(res.body.data.interactions.map((i) => i.transactionHash)).toEqual([
      "tx-a",
      "tx-b",
      "tx-c",
    ]);
    expect(res.body.data.interactions.map((i) => i.function)).toEqual([
      "transfer",
      "mint",
      "burn",
    ]);
    expect(res.body.data.cursor).toBeNull();
  });

  it("?limit=2 returns only 2 results with a cursor", async () => {
    mockAccountExists();
    const first = invokeOp({ hash: "tx-1" });
    const second = invokeOp({ hash: "tx-2" });
    const third = invokeOp({ hash: "tx-3" });
    mockOperations([first, second, third]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions?limit=2`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBe(2);
    expect(res.body.data.interactions).toHaveLength(2);
    expect(res.body.data.interactions.map((i) => i.transactionHash)).toEqual([
      "tx-1",
      "tx-2",
    ]);
    expect(res.body.data.cursor).toBe(second.paging_token);
  });

  it("returns an empty interactions array when the account has no Soroban interactions", async () => {
    mockAccountExists();
    mockOperations([
      otherOp("payment"),
      otherOp("create_account"),
      otherOp("manage_sell_offer"),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.interactions).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("includes all five required fields on each interaction", async () => {
    mockAccountExists();
    mockOperations([
      invokeOp({ fn: "transfer", hash: "tx-ok", successful: true }),
      invokeOp({ fn: "swap", hash: "tx-failed", successful: false }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.interactions).toHaveLength(2);
    for (const interaction of res.body.data.interactions) {
      for (const field of REQUIRED_FIELDS) {
        expect(interaction).toHaveProperty(field);
      }
      expect(interaction.contractId).toBe(CONTRACT_ID);
      expect(typeof interaction.function).toBe("string");
      expect(new Date(interaction.timestamp).toISOString()).toBe(interaction.timestamp);
      expect(typeof interaction.success).toBe("boolean");
      expect(interaction.transactionHash).toEqual(expect.any(String));
    }
    expect(res.body.data.interactions[0].success).toBe(true);
    expect(res.body.data.interactions[1].success).toBe(false);
  });

  it("returns 404 for a non-existent account", async () => {
    const notFound = new Error("Not Found");
    notFound.response = { status: 404 };
    jest.spyOn(server, "loadAccount").mockRejectedValue(notFound);
    const builder = mockOperations([]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/smart-contract-interactions`,
    );

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(builder.call).not.toHaveBeenCalled();
  });
});
