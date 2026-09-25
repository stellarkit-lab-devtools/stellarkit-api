/**
 * tests/routes/utils.test.js
 *
 * Test coverage for POST /utils/decode-xdr
 *
 * Cases:
 *   1. A valid transaction XDR returns 200 with the decoded shape:
 *      fee, sourceAccount, operations (array), and memo fields present.
 *   2. An invalid base64 string returns 400 with a descriptive error.
 *   3. An empty request body (no `xdr` field) returns 400.
 *   4. A valid base64 string that is not valid XDR returns 400 with a
 *      descriptive error (not a generic 500).
 */

"use strict";

const request = require("supertest");
const app = require("../../src/index");
const {
  Asset,
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Account,
  Memo,
} = require("@stellar/stellar-sdk");

// ---------------------------------------------------------------------------
// Helper – build a real, SDK-signed transaction XDR so tests are not coupled
// to a hard-coded string that might become stale.
// ---------------------------------------------------------------------------

/**
 * Builds a simple one-operation payment transaction and returns its
 * base64-encoded envelope XDR.
 *
 * @param {{ memo?: import("@stellar/stellar-sdk").Memo }} [opts]
 * @returns {string} base64 XDR
 */
function buildValidXdr(opts = {}) {
  const source = Keypair.random();
  const dest = Keypair.random();
  const account = new Account(source.publicKey(), "100");

  let builder = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  }).addOperation(
    Operation.payment({
      destination: dest.publicKey(),
      asset: Asset.native(),
      amount: "10",
    })
  );

  if (opts.memo) {
    builder = builder.addMemo(opts.memo);
  }

  return builder.setTimeout(0).build().toEnvelope().toXDR("base64");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /utils/decode-xdr", () => {
  // ── Case 1: valid XDR returns the full decoded shape ─────────────────────
  describe("valid transaction XDR", () => {
    it("returns 200 with the decoded transaction shape", async () => {
      const xdr = buildValidXdr();

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("response contains sourceAccount as a valid Stellar public key", async () => {
      const xdr = buildValidXdr();

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      expect(res.body.data).toHaveProperty("sourceAccount");
      expect(typeof res.body.data.sourceAccount).toBe("string");
      // Stellar public keys start with G and are 56 chars
      expect(res.body.data.sourceAccount).toMatch(/^G[A-Z2-7]{55}$/);
    });

    it("response contains fee as a string or number", async () => {
      const xdr = buildValidXdr();

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      expect(res.body.data).toHaveProperty("fee");
      // fee can be returned as a string ("100") or number; either is acceptable
      const fee = res.body.data.fee;
      expect(["string", "number"]).toContain(typeof fee);
      // The transaction was built with fee "100"
      expect(Number(fee)).toBe(100);
    });

    it("response contains sequenceNumber", async () => {
      const xdr = buildValidXdr();

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      expect(res.body.data).toHaveProperty("sequenceNumber");
      // Sequence numbers are large integers represented as strings by the SDK
      const seq = res.body.data.sequenceNumber;
      expect(["string", "number"]).toContain(typeof seq);
    });

    it("response contains operations as a non-empty array", async () => {
      const xdr = buildValidXdr();

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      expect(res.body.data).toHaveProperty("operations");
      expect(Array.isArray(res.body.data.operations)).toBe(true);
      expect(res.body.data.operations.length).toBeGreaterThan(0);
    });

    it("each operation has a type field", async () => {
      const xdr = buildValidXdr();

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      const ops = res.body.data.operations;
      ops.forEach((op) => {
        expect(op).toHaveProperty("type");
        expect(typeof op.type).toBe("string");
      });
    });

    it("response contains memo field (null when no memo set)", async () => {
      const xdr = buildValidXdr(); // no memo

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      // memo is always present; null when the transaction carries no memo
      expect(res.body.data).toHaveProperty("memo");
      expect(res.body.data.memo).toBeNull();
    });

    it("response contains memo with type and value when a text memo is set", async () => {
      const xdr = buildValidXdr({ memo: Memo.text("invoice-123") });

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      expect(res.body.data.memo).not.toBeNull();
      expect(res.body.data.memo).toHaveProperty("type");
      expect(res.body.data.memo).toHaveProperty("value");
      expect(res.body.data.memo.value).toBe("invoice-123");
    });

    it("all four required top-level fields are present together", async () => {
      const xdr = buildValidXdr();

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      const data = res.body.data;
      expect(data).toHaveProperty("fee");
      expect(data).toHaveProperty("sourceAccount");
      expect(data).toHaveProperty("operations");
      expect(data).toHaveProperty("memo");
    });
  });

  // ── Case 2: invalid base64 string returns 400 ────────────────────────────
  describe("invalid base64 string", () => {
    it("returns 400 for a string that is not base64", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr: "this is not base64!!!" });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("error message is descriptive (mentions XDR or malformed)", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr: "!!!invalid!!!" });

      expect(res.body.error).toBeDefined();
      const msg = res.body.error.message || "";
      expect(msg.toLowerCase()).toMatch(/xdr|malformed|invalid/);
    });

    it("does not return 500 for invalid base64 input", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr: "not-base64-at-all" });

      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── Case 3: empty body / missing xdr field returns 400 ──────────────────
  describe("empty body or missing xdr field", () => {
    it("returns 400 when body is empty object", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("error message says xdr is required when field is absent", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({});

      const msg = (res.body.error && res.body.error.message) || "";
      expect(msg.toLowerCase()).toContain("xdr");
    });

    it("returns 400 when xdr field is null", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr: null });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when xdr field is an empty string", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr: "" });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns a 4xx client error when no Content-Type body is sent at all", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr");

      // express.json() middleware returns 415 when Content-Type is absent;
      // the route returns 400 when xdr is missing but JSON was parsed. Either
      // way it must be a client error (4xx), never a 500.
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });
  });

  // ── Case 4: valid base64 that is not valid XDR returns descriptive 400 ──
  describe("valid base64 but not valid XDR", () => {
    // These strings are correctly base64-encoded but decode to bytes that do
    // not represent a valid Stellar TransactionEnvelope.
    const nonXdrBase64Strings = [
      // "Hello, World!" in base64
      "SGVsbG8sIFdvcmxkIQ==",
      // A short random byte sequence
      "dGVzdA==",
      // JSON encoded as base64
      Buffer.from('{"type":"not_xdr","value":42}').toString("base64"),
    ];

    it.each(nonXdrBase64Strings)(
      "returns 400 for valid base64 that is not XDR: %s",
      async (xdr) => {
        const res = await request(app)
          .post("/utils/decode-xdr")
          .send({ xdr });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
      }
    );

    it("error message describes the XDR parsing failure", async () => {
      const xdr = Buffer.from("this decodes fine but is not xdr").toString("base64");

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      expect(res.statusCode).toBe(400);
      const msg = (res.body.error && res.body.error.message) || "";
      // The route wraps the SDK error: "Invalid or malformed XDR: <sdk message>"
      expect(msg.toLowerCase()).toMatch(/xdr|malformed|invalid/);
    });

    it("does not return a generic 500 for structurally invalid XDR bytes", async () => {
      // A long enough base64 string to look like a potential XDR but contain garbage
      const garbage = Buffer.alloc(64, 0xff).toString("base64");

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr: garbage });

      // Must be a 400, not a 500 internal error
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
