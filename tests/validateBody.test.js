const express = require("express");
const request = require("supertest");
const fs = require("fs");
const path = require("path");
const errorHandler = require("../src/middleware/errorHandler");
const { validateBody } = require("../src/middleware/validateBody");
const schemas = require("../src/middleware/bodySchemas");

function appFor(schema) {
  const app = express();
  app.use(express.json());
  app.post("/test", validateBody(schema), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

// Each case: schema name, valid body, a required field, a wrong-type field,
// an unknown property, and (where an array limit applies) an oversized array.
const cases = [
  { name: "multisigPlan", valid: { availableSigners: ["GABC"] }, required: "availableSigners", wrong: { availableSigners: "GABC" }, extra: { availableSigners: ["GABC"], nope: 1 }, oversized: { availableSigners: Array(21).fill("GABC") } },
  { name: "multisigInfo", valid: { accountIds: ["GABC"] }, required: "accountIds", wrong: { accountIds: {} }, extra: { accountIds: ["GABC"], nope: 1 }, oversized: { accountIds: Array(21).fill("GABC") } },
  { name: "accountFreezeStatus", valid: { addresses: ["GABC"], asset: { code: "USDC" } }, required: "asset", wrong: { addresses: "GABC", asset: {} }, extra: { addresses: ["GABC"], asset: {}, nope: 1 } },
  { name: "nativeBalances", valid: { addresses: ["GABC"] }, required: "addresses", wrong: { addresses: 1 }, extra: { addresses: ["GABC"], nope: 1 }, oversized: { addresses: Array(21).fill("GABC") } },
  { name: "accountEffects", valid: { addresses: ["GABC"] }, required: "addresses", wrong: { addresses: [1] }, extra: { addresses: ["GABC"], nope: 1 }, oversized: { addresses: Array(11).fill("GABC") } },
  { name: "trustStatus", valid: { addresses: ["GABC"], asset: "USDC" }, required: "asset", wrong: { addresses: 42, asset: "USDC" }, extra: { addresses: ["GABC"], asset: "USDC", nope: true } },
  { name: "accountSigners", valid: { addresses: ["GABC"] }, required: "addresses", wrong: { addresses: null }, extra: { addresses: ["GABC"], nope: 1 } },
  { name: "transactionCounts", valid: { addresses: ["GABC"] }, required: "addresses", wrong: { addresses: ["GABC"], limit: "10" }, extra: { addresses: ["GABC"], nope: 1 } },
  { name: "transactionBatchStatus", valid: { hashes: ["abc"] }, required: "hashes", wrong: { hashes: 1 }, extra: { hashes: ["abc"], nope: 1 }, oversized: { hashes: Array(21).fill("abc") } },
  { name: "feeBatch", valid: { transactions: [{ type: "payment", operationCount: 1 }] }, required: "transactions", wrong: { transactions: "payment" }, extra: { transactions: [{ type: "payment", operationCount: 1 }], nope: 1 }, oversized: { transactions: Array(11).fill({ type: "payment", operationCount: 1 }) } },
  { name: "webhook", valid: { url: "https://example.com", events: ["payment"] }, required: "events", wrong: { url: 123, events: ["payment"] }, extra: { url: "https://example.com", events: ["payment"], nope: 1 } },
  { name: "webhookAction", valid: {}, wrong: { foo: 1 }, extra: { nope: 1 } },
  { name: "validateMemo", valid: { type: "text", value: "hi" }, required: "value", wrong: { type: 1, value: "hi" }, extra: { type: "text", value: "hi", nope: 1 } },
  { name: "decodeXdr", valid: { xdr: "AAAA" }, required: "xdr", wrong: { xdr: 123 }, extra: { xdr: "AAAA", nope: 1 } },
  { name: "decodeTransaction", valid: { xdr: "AAAA" }, required: "xdr", wrong: { xdr: [] }, extra: { xdr: "AAAA", nope: 1 } },
  { name: "simulatePayment", valid: { source: "GABC", destination: "GDEF", amount: "1.5" }, required: "amount", wrong: { source: 1, destination: "GDEF", amount: 1 }, extra: { source: "GABC", destination: "GDEF", amount: 1, nope: 1 } },
];

describe.each(cases)("POST body schema: $name", (testCase) => {
  const app = appFor(schemas[testCase.name]);

  it("accepts valid input", async () => {
    const res = await request(app).post("/test").send(testCase.valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  if (testCase.required) {
    it("rejects a missing required field", async () => {
      const body = { ...testCase.valid };
      delete body[testCase.required];
      const res = await request(app).post("/test").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe("ValidationError");
      expect(res.body.error.details).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining(testCase.required) }),
      ]));
    });
  }

  it("rejects a wrong type without echoing values", async () => {
    const res = await request(app).post("/test").send(testCase.wrong);
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain(JSON.stringify(testCase.wrong));
  });

  it("rejects an extra property", async () => {
    const res = await request(app).post("/test").send(testCase.extra);
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.path.includes("nope"))).toBe(true);
  });

  if (testCase.oversized) {
    it("rejects an oversized array", async () => {
      const res = await request(app).post("/test").send(testCase.oversized);
      expect(res.status).toBe(400);
      expect(res.body.error.details.some((d) => d.message.includes("too many"))).toBe(true);
    });
  }
});

it("wires validateBody into every POST route", () => {
  const dirs = [path.join(__dirname, "../src/routes")];
  const files = fs.readdirSync(dirs[0]).filter((f) => f.endsWith(".js"))
    .map((f) => path.join(dirs[0], f))
    .concat([path.join(__dirname, "../src/index.js")]);
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const posts = source.split("\n").filter((line) => /\.post\(/.test(line));
    for (const line of posts) {
      expect(line).toContain("validateBody(");
    }
  }
});
