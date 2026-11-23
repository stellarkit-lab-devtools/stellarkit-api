/**
 * tests/routes/utils.validateMemo.test.js
 *
 * Test coverage for POST /utils/validate-memo.
 *
 * Cases:
 *   1. A valid text memo returns `valid: true`.
 *   2. A text memo over 28 bytes returns `valid: false` with an error.
 *   3. A valid ID memo returns `valid: true`.
 *   4. An ID memo with a non-numeric value returns `valid: false`.
 *   5. A hash memo with the wrong byte length returns `valid: false`.
 *
 * Plus a few guards around the same contract: a correctly sized hash memo,
 * a `none` memo, and a request that omits the required `type` field.
 */

"use strict";

const request = require("supertest");

const app = require("../../src/index");

const VALID_TEXT_MEMO = "invoice-123";
const OVERSIZED_TEXT_MEMO = "a".repeat(29); // 29 UTF-8 bytes > 28-byte limit
const VALID_ID_MEMO = "1234567890";
const NON_NUMERIC_ID_MEMO = "12ab34";
const VALID_HASH_MEMO = "ab".repeat(32); // 64 hex chars === 32 bytes
const SHORT_HASH_MEMO = Buffer.from("short-hash").toString("base64");

const postMemo = (body) => request(app).post("/utils/validate-memo").send(body);

describe("POST /utils/validate-memo", () => {
  it("returns { valid: true } for a valid text memo", async () => {
    const res = await postMemo({ type: "text", value: VALID_TEXT_MEMO });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.type).toBe("text");
    expect(res.body.data.error).toBeNull();
    expect(res.body.data.byteLength).toBe(Buffer.byteLength(VALID_TEXT_MEMO, "utf8"));
  });

  it("returns { valid: false } with an error for a text memo over 28 bytes", async () => {
    const res = await postMemo({ type: "text", value: OVERSIZED_TEXT_MEMO });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.error).toMatch(/28 bytes/);
    expect(res.body.data.byteLength).toBe(29);
  });

  it("returns { valid: true } for a valid ID memo", async () => {
    const res = await postMemo({ type: "id", value: VALID_ID_MEMO });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.type).toBe("id");
    expect(res.body.data.error).toBeNull();
  });

  it("returns { valid: false } for an ID memo with a non-numeric value", async () => {
    const res = await postMemo({ type: "id", value: NON_NUMERIC_ID_MEMO });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.error).toMatch(/unsigned integer/);
  });

  it("returns { valid: false } for a hash memo with the wrong byte length", async () => {
    const res = await postMemo({ type: "hash", value: SHORT_HASH_MEMO });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.error).toMatch(/32 bytes/);
    expect(res.body.data.byteLength).toBe(10);
  });

  it("returns { valid: true } for a correctly sized hash memo", async () => {
    const res = await postMemo({ type: "hash", value: VALID_HASH_MEMO });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.byteLength).toBe(32);
    expect(res.body.data.error).toBeNull();
  });

  it("returns { valid: true } for a none memo with no value", async () => {
    const res = await postMemo({ type: "none" });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.type).toBe("none");
    expect(res.body.data.error).toBeNull();
  });

  it("returns 400 when the memo type is missing", async () => {
    const res = await postMemo({ value: VALID_TEXT_MEMO });

    expect(res.status).toBe(400);
  });
});
