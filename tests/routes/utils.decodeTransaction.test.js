/**
 * tests/routes/utils.decodeTransaction.test.js
 *
 * Unit tests for POST /utils/decode-transaction
 *
 *   1. Payment operation XDR decodes with type "payment", destination, asset, and amount.
 *   2. Create account operation XDR decodes with type "create_account" and startingBalance.
 *   3. Invalid base64 string returns HTTP 400.
 *   4. Empty body (no xdr field) returns HTTP 400.
 *
 * Tests use real XDR fixtures generated from the Stellar SDK — no mocking required.
 */

"use strict";

const request = require("supertest");
const {
  Keypair,
  TransactionBuilder,
  Networks,
  Asset,
  Operation,
  Account,
} = require("@stellar/stellar-sdk");

const app = require("../../src/index");

// Build real XDR fixtures once at module load time.
const SOURCE_KP = Keypair.random();
const DEST_KP = Keypair.random();

function buildXdr(operations) {
  const account = new Account(SOURCE_KP.publicKey(), "1");
  const builder = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  });
  for (const op of operations) {
    builder.addOperation(op);
  }
  return builder.setTimeout(0).build().toEnvelope().toXDR("base64");
}

const PAYMENT_XDR = buildXdr([
  Operation.payment({
    destination: DEST_KP.publicKey(),
    asset: Asset.native(),
    amount: "10",
  }),
]);

const CREATE_ACCOUNT_XDR = buildXdr([
  Operation.createAccount({
    destination: DEST_KP.publicKey(),
    startingBalance: "100",
  }),
]);

describe("POST /utils/decode-transaction", () => {
  it("payment operation XDR decodes with type 'payment', destination, asset, and amount", async () => {
    const res = await request(app)
      .post("/utils/decode-transaction")
      .send({ xdr: PAYMENT_XDR });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.operationCount).toBe(1);

    const op = res.body.data.operations[0];
    expect(op.type).toBe("payment");
    expect(op.destination).toBe(DEST_KP.publicKey());
    expect(op.asset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(op.amount).toBeDefined();
  });

  it("create account operation XDR decodes with type 'create_account' and startingBalance", async () => {
    const res = await request(app)
      .post("/utils/decode-transaction")
      .send({ xdr: CREATE_ACCOUNT_XDR });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.operationCount).toBe(1);

    const op = res.body.data.operations[0];
    expect(op.type).toBe("create_account");
    expect(op.destination).toBe(DEST_KP.publicKey());
    expect(op.startingBalance).toBeDefined();
  });

  it("invalid base64 string returns 400", async () => {
    const res = await request(app)
      .post("/utils/decode-transaction")
      .send({ xdr: "not-valid-base64!!!" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("empty body returns 400", async () => {
    const res = await request(app)
      .post("/utils/decode-transaction")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
