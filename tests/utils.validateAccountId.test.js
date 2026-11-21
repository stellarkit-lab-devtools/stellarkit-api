"use strict";

const express = require("express");
const request = require("supertest");
const { Keypair, StrKey } = require("@stellar/stellar-sdk");
const { validateAccountId } = require("../src/utils/validators");
const errorHandler = require("../src/middleware/errorHandler");

// A real, well-formed Stellar public key
const VALID_KEY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Synthesize test cases for each reason code
// 1. bad_checksum: Valid address with exactly one character changed (still valid base32, but invalid CRC checksum)
const lastChar = VALID_KEY.slice(-1);
const replacementChar = lastChar === "A" ? "B" : "A";
const BAD_CHECKSUM_KEY = VALID_KEY.slice(0, -1) + replacementChar;

// 2. wrong_prefix: Valid length and base32 but starts with invalid prefix letter (neither G, S, M, nor C)
const WRONG_PREFIX_KEY = "BA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// 3. wrong_length: Starts with G but incorrect length
const WRONG_LENGTH_KEY = "GABC123";

// 4. invalid_characters: Starts with G and length 56, but contains non-base32 character (e.g. '0', '1', '8', '9')
const INVALID_CHARS_KEY = "G0AZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

// 5. muxed_address: Stellar M-address (69 characters)
const MUXED_KEY = "MA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN7777777777777";

// 6. contract_address: Soroban C-address (56 characters)
const CONTRACT_KEY = "CA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// 7. secret_seed: Stellar S-seed (56 characters)
const SECRET_SEED_KEY = "SB5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function createTestApp() {
  const app = express();
  app.get("/account/:id/balances", (req, res, next) => {
    try {
      validateAccountId(req.params.id);
      res.json({ success: true, balances: [] });
    } catch (err) {
      next(err);
    }
  });
  app.use(errorHandler);
  return app;
}

describe("validateAccountId() - Reason codes and suggestions (#1256)", () => {
  it("does not throw for a valid Ed25519 public key", () => {
    expect(() => validateAccountId(VALID_KEY)).not.toThrow();
  });

  const testCases = [
    {
      name: "bad_checksum",
      input: BAD_CHECKSUM_KEY,
      expectedReason: "bad_checksum",
      suggestionSnippet: "typo",
    },
    {
      name: "wrong_prefix",
      input: WRONG_PREFIX_KEY,
      expectedReason: "wrong_prefix",
      suggestionSnippet: "start with the letter G",
    },
    {
      name: "wrong_length",
      input: WRONG_LENGTH_KEY,
      expectedReason: "wrong_length",
      suggestionSnippet: "56 characters",
    },
    {
      name: "invalid_characters",
      input: INVALID_CHARS_KEY,
      expectedReason: "invalid_characters",
      suggestionSnippet: "base32",
    },
    {
      name: "muxed_address",
      input: MUXED_KEY,
      expectedReason: "muxed_address",
      suggestionSnippet: "base G",
    },
    {
      name: "contract_address",
      input: CONTRACT_KEY,
      expectedReason: "contract_address",
      suggestionSnippet: "G...",
    },
    {
      name: "secret_seed",
      input: SECRET_SEED_KEY,
      expectedReason: "secret_seed",
      suggestionSnippet: "Do not share secret seeds",
    },
  ];

  testCases.forEach(({ name, input, expectedReason, suggestionSnippet }) => {
    it(`identifies reason code '${expectedReason}' for ${name}`, () => {
      let thrown;
      try {
        validateAccountId(input);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeDefined();
      expect(thrown.isInvalidAccountId).toBe(true);
      expect(thrown.type).toBe("InvalidAccountId");
      expect(thrown.status).toBe(400);
      expect(thrown.details).toBeDefined();
      expect(thrown.details.reason).toBe(expectedReason);
      expect(thrown.suggestion).toMatch(new RegExp(suggestionSnippet, "i"));

      if (expectedReason === "secret_seed") {
        // Assert secret-shaped input appears nowhere in the message or error property
        expect(thrown.message).not.toContain(input);
        expect(thrown.accountId).toBeUndefined();
      } else {
        expect(thrown.message).toContain(String(input).slice(0, 50));
      }
    });
  });
});

describe("Account ID validation HTTP route responses (#1256)", () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
  });

  it("returns 200 for a valid account ID", async () => {
    const res = await request(app).get(`/account/${VALID_KEY}/balances`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.balances).toEqual([]);
  });

  it("returns 400 InvalidAccountId with bad_checksum reason and typo suggestion for 1-char typo", async () => {
    const res = await request(app).get(`/account/${BAD_CHECKSUM_KEY}/balances`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
    expect(res.body.error.details).toEqual({ reason: "bad_checksum" });
    expect(res.body.error.suggestion).toMatch(/typo/i);
    expect(res.body.error.message).toContain(BAD_CHECKSUM_KEY.slice(0, 50));
  });

  it("returns 400 InvalidAccountId with muxed_address reason and base G... suggestion", async () => {
    const res = await request(app).get(`/account/${MUXED_KEY}/balances`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
    expect(res.body.error.details).toEqual({ reason: "muxed_address" });
    expect(res.body.error.suggestion).toMatch(/base G/i);
  });

  it("never echoes back or leaks a secret-seed input anywhere in response body", async () => {
    const res = await request(app).get(`/account/${SECRET_SEED_KEY}/balances`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
    expect(res.body.error.details).toEqual({ reason: "secret_seed" });
    expect(res.body.error.suggestion).toMatch(/Do not share secret seeds/i);

    // Assert that the secret-shaped input appears NOWHERE in the entire JSON response
    const jsonString = JSON.stringify(res.body);
    expect(jsonString).not.toContain(SECRET_SEED_KEY);
    expect(res.body.error.message).not.toContain(SECRET_SEED_KEY);
  });
});
