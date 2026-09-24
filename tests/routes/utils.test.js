/**
 * tests/routes/utils.test.js
 *
 * Coverage for the unit-conversion endpoint:
 *   GET /utils/convert?xlm={amount}
 *   GET /utils/convert?stroops={amount}
 *
 * Test cases
 * ----------
 * 1. ?xlm=1 returns { stroops: 10000000 }
 * 2. ?stroops=10000000 returns { xlm: "1.0000000" }
 * 3. ?xlm=0 returns { stroops: 0 }
 * 4. A non-numeric value returns a 400
 * 5. Providing both xlm and stroops returns a 400 with a clear message
 */

const request = require("supertest");

// Module-level mock so the Horizon server is stubbed out — /utils/convert is
// a pure computation and never touches Horizon.
jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      ledgers: jest.fn(),
      feeStats: jest.fn(),
    },
  };
});

const app = require("../../src/index");

describe("GET /utils/convert", () => {
  it("converts ?xlm=1 to 10000000 stroops", async () => {
    const res = await request(app).get("/utils/convert").query({ xlm: "1" });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stroops).toBe(10000000);
    expect(res.body.data.xlm).toBe("1.0000000");
  });

  it("converts ?stroops=10000000 to 1.0000000 XLM", async () => {
    const res = await request(app).get("/utils/convert").query({ stroops: "10000000" });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.xlm).toBe("1.0000000");
    expect(res.body.data.stroops).toBe(10000000);
  });

  it("converts ?xlm=0 to 0 stroops", async () => {
    const res = await request(app).get("/utils/convert").query({ xlm: "0" });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stroops).toBe(0);
    expect(res.body.data.xlm).toBe("0.0000000");
  });

  it("returns 400 for a non-numeric xlm value", async () => {
    const res = await request(app).get("/utils/convert").query({ xlm: "abc" });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/decimal/i);
  });

  it("returns 400 with a clear message when both xlm and stroops are provided", async () => {
    const res = await request(app)
      .get("/utils/convert")
      .query({ xlm: "1", stroops: "10000000" });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/not both/i);
  });
});
