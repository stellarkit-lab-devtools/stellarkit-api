/**
 * Property-based coverage for amount / stroop conversion.
 * Run with a fixed seed via FC_SEED=123 npx jest tests/utils/amounts.property.test.js
 */
const fc = require("fast-check");
const request = require("supertest");
const express = require("express");
const { parseStellarAmount, xlmToStroops } = require("../../src/utils/parseStellarAmount");
const { formatAmount } = require("../../src/utils/formatAmount");

const SEED = process.env.FC_SEED ? Number(process.env.FC_SEED) : Math.floor(Math.random() * 2 ** 31);
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const PARAMS = { numRuns: 1000, seed: SEED };

const app = express();
app.use(express.json());
app.use("/utils", require("../../src/routes/utils"));
app.use(require("../../src/middleware/errorHandler"));

function check(name, property, params = PARAMS, arbitrary) {
  try {
    fc.assert(arbitrary ? fc.property(arbitrary, property) : property, params);
  } catch (err) {
    console.error(`Property "${name}" failed with fast-check seed ${SEED}`);
    throw err;
  }
}

describe("amount conversion properties (1000 cases each)", () => {
  test("stroops -> XLM -> stroops round-trips exactly across int64", () => {
    check("int64 round-trip", (stroops) => {
      expect(xlmToStroops(parseStellarAmount(stroops))).toBe(stroops);
    }, PARAMS, fc.bigInt({ min: INT64_MIN, max: INT64_MAX }));
  });

  test("every formatted amount has exactly seven decimals", () => {
    check("seven-decimal shape", (value) => {
      expect(formatAmount(value)).toMatch(/^-?\d+\.\d{7}$/);
    }, { ...PARAMS, seed: SEED + 1 }, fc.oneof(
      fc.bigInt({ min: INT64_MIN, max: INT64_MAX }),
      fc.stringMatching(/^-?\d{1,10}(?:\.\d{0,12})?$/),
      fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }),
    ));
  });

  test("0.1 + 0.2 style floats produce no artefacts", () => {
    expect(formatAmount(0.1 + 0.2)).toBe("0.3000000");
    check("float artefacts", ([a, b]) => {
      const expected = parseStellarAmount(BigInt(a + b) * 1000000n);
      expect(formatAmount(a / 10 + b / 10)).toBe(expected);
    }, { numRuns: 1000, seed: SEED + 2 }, fc.tuple(
      fc.integer({ min: 0, max: 10000 }),
      fc.integer({ min: 0, max: 10000 }),
    ));
  });

  test("ordering is preserved across conversion", () => {
    check("ordering", ([a, b]) => {
      const left = xlmToStroops(parseStellarAmount(a));
      const right = xlmToStroops(parseStellarAmount(b));
      expect(left < right).toBe(a < b);
      expect(left === right).toBe(a === b);
    }, { numRuns: 1000, seed: SEED + 3 }, fc.tuple(
      fc.bigInt({ min: INT64_MIN, max: INT64_MAX }),
      fc.bigInt({ min: INT64_MIN, max: INT64_MAX }),
    ));
  });

  test("inputs with more than seven decimals are rounded by helpers", () => {
    check("more than seven decimals", ([whole, frac]) => {
      if (frac.length < 8) return;
      const rounded =
        BigInt(whole) * 10000000n +
        BigInt(frac.slice(0, 7)) +
        (Number(frac[7]) >= 5 ? 1n : 0n);
      expect(formatAmount(`${whole}.${frac}`)).toBe(parseStellarAmount(rounded));
    }, {
      numRuns: 1000,
      seed: SEED + 4,
    }, fc.tuple(
        fc.integer({ min: 0, max: 100000 }),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 12 })
          .map((digits) => digits.join("")),
      ));
  });

  test("GET /utils/convert round-trips int64 stroops exactly", async () => {
    for (const stroops of fc.sample(fc.bigInt({ min: 0n, max: INT64_MAX }), 1000)) {
      const res = await request(app).get(`/utils/convert?stroops=${stroops}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.xlm).toBe(parseStellarAmount(stroops));
      expect(BigInt(res.body.data.stroops)).toBe(stroops);

      const back = await request(app).get(`/utils/convert?xlm=${res.body.data.xlm}`);
      expect(back.statusCode).toBe(200);
      expect(BigInt(back.body.data.stroops)).toBe(stroops);
    }
  });

  test("GET /utils/convert rejects more than seven decimals", async () => {
    const res = await request(app).get("/utils/convert?xlm=1.12345678");
    expect(res.statusCode).toBe(400);
  });
});
