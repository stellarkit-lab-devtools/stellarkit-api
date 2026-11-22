const express = require("express");
const request = require("supertest");
const { Account, Keypair, MuxedAccount, StrKey } = require("@stellar/stellar-sdk");
const { validateAccountId } = require("../src/utils/validators");
const errorHandler = require("../src/middleware/errorHandler");
const requestLogger = require("../src/middleware/requestLogger");
const logger = require("../src/utils/logger");
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const base = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const secret = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).secret();
const app = express();
app.use(requestLogger);
app.get("/account/:id", (req, res, next) => {
  try { validateAccountId(req.params.id); res.json({ success: true }); } catch (err) { next(err); }
});
app.use(errorHandler);
const cases = [
  ["wrong_prefix", "X" + base.slice(1)],
  ["wrong_length", base.slice(0, -1)],
  ["invalid_characters", base.slice(0, -1) + "0"],
  ["bad_checksum", base.slice(0, -1) + (base.endsWith("A") ? "B" : "A")],
  ["muxed_address", new MuxedAccount(new Account(base, "0"), "1").accountId()],
  ["contract_address", StrKey.encodeContract(Buffer.alloc(32))],
  ["secret_seed", secret],
];
test("accepts a valid public key", () => expect(() => validateAccountId(base)).not.toThrow());
test.each(cases)("returns reason %s", async (reason, input) => {
  const res = await request(app).get("/account/" + input);
  expect(res.status).toBe(400);
  expect(res.body.error.type).toBe("InvalidAccountId");
  expect(res.body.error.details.reason).toBe(reason);
  expect(res.body.error.suggestion).toBeTruthy();
  if (reason === "bad_checksum") expect(res.body.error.suggestion).toMatch(/typo/);
  if (reason === "muxed_address") expect(res.body.error.suggestion).toMatch(/base G/);
});
test("never includes a seed in a response, validation error or request log", async () => {
  jest.clearAllMocks();
  const res = await request(app).get("/account/" + secret);
  expect(JSON.stringify({ body: res.body, headers: res.headers, text: res.text })).not.toContain(secret);
  try { validateAccountId(secret); } catch (err) {
    expect(err.message + err.stack + JSON.stringify(err)).not.toContain(secret);
  }
  expect(JSON.stringify(logger.info.mock.calls)).not.toContain(secret);
});
