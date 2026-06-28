const request = require("supertest");
const app = require("../src/index");

describe("MissingParameter validation (empty / whitespace route params)", () => {
  it("returns 400 MissingParameter for an empty account id", async () => {
    const res = await request(app).get("/account/%20/trustlines");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("MissingParameter");
    expect(res.body.error.message).toContain("required and cannot be empty");
    expect(res.body.error.suggestion).toBeDefined();
  });

  it("returns 400 MissingParameter for whitespace-only asset code", async () => {
    const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const res = await request(app).get(`/asset/%20/${ISSUER}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("MissingParameter");
  });

  it("returns 400 MissingParameter for whitespace-only transaction id", async () => {
    const res = await request(app).get("/transactions/%20");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("MissingParameter");
  });

  it("allows non-empty route parameters through", async () => {
    const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
    const res = await request(app).get(`/account/${VALID_KEY}/sequence`);

    expect(res.statusCode).not.toBe(400);
    if (res.body.error) {
      expect(res.body.error.type).not.toBe("MissingParameter");
    }
  });
});
