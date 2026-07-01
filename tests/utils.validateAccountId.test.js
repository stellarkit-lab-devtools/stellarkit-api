const request = require("supertest");

// Mock Horizon so a *valid* account ID can resolve without a network call.
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { validateAccountId } = require("../src/utils/validators");

// A real, well-formed Stellar public key.
const VALID_KEY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("validateAccountId()", () => {
  it("does not throw for a valid Ed25519 public key", () => {
    expect(() => validateAccountId(VALID_KEY)).not.toThrow();
  });

  it.each([
    ["a non-G prefix", "SA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"],
    ["a too-short value", "GABC"],
    ["invalid base32 characters", "G0AZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"],
    ["a non-string value", undefined],
  ])("throws a standardised InvalidAccountId error for %s", (_label, badId) => {
    let thrown;
    try {
      validateAccountId(badId);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(thrown.isInvalidAccountId).toBe(true);
    expect(thrown.message).toBe(
      `'${badId}' is not a valid Stellar account address.`
    );
    expect(thrown.suggestion).toBe(
      "Account addresses start with G and are 56 characters long."
    );
  });
});

describe("Account ID validation on route handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the standardised 400 InvalidAccountId shape for an invalid account ID", async () => {
    const res = await request(app).get("/account/INVALID_KEY/balances");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual({
      type: "InvalidAccountId",
      message: "'INVALID_KEY' is not a valid Stellar account address.",
      suggestion: "Account addresses start with G and are 56 characters long.",
    });
    // Validation must happen before any Horizon call.
    expect(server.loadAccount).not.toHaveBeenCalled();
  });

  it("passes validation and reaches Horizon for a valid account ID", async () => {
    server.loadAccount.mockResolvedValue({ balances: [] });

    const res = await request(app).get(`/account/${VALID_KEY}/balances`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(server.loadAccount).toHaveBeenCalledWith(VALID_KEY);
  });
});
