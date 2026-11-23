/**
 * tests/utils/validateCursor.test.js
 *
 * Unit tests for the validateCursor validator and its integration with
 * the centralised error handler (400 response shape).
 *
 * Covers:
 *   - empty string cursor  → throws with isInvalidCursor = true
 *   - null cursor          → throws with isInvalidCursor = true
 *   - non-string cursor    → throws with isInvalidCursor = true
 *   - undefined cursor     → parsePaginationParams ignores it (no throw)
 *   - valid cursor string  → returns the value unchanged
 *   - paginated endpoint   → returns 400 with InvalidCursor shape on bad cursor
 */

const { validateCursor } = require("../../src/utils/validators");
const { parsePaginationParams } = require("../../src/utils/pagination");

// ── Unit tests for validateCursor ────────────────────────────────────────────

describe("validateCursor – unit", () => {
  it("throws for an empty string", () => {
    expect(() => validateCursor("")).toThrow();
  });

  it("throws for a whitespace-only string", () => {
    expect(() => validateCursor("   ")).toThrow();
  });

  it("throws for null", () => {
    expect(() => validateCursor(null)).toThrow();
  });

  it("throws for undefined", () => {
    expect(() => validateCursor(undefined)).toThrow();
  });

  it("throws for a number", () => {
    expect(() => validateCursor(12345)).toThrow();
  });

  it("throws for an object", () => {
    expect(() => validateCursor({})).toThrow();
  });

  it("throws for an array", () => {
    expect(() => validateCursor([])).toThrow();
  });

  it("sets isInvalidCursor = true on the thrown error", () => {
    let caught;
    try {
      validateCursor("");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.isInvalidCursor).toBe(true);
  });

  it("sets the error type to InvalidCursor", () => {
    let caught;
    try {
      validateCursor(null);
    } catch (err) {
      caught = err;
    }
    expect(caught.type).toBe("InvalidCursor");
  });

  it("includes a suggestion on the thrown error", () => {
    let caught;
    try {
      validateCursor(null);
    } catch (err) {
      caught = err;
    }
    expect(typeof caught.suggestion).toBe("string");
    expect(caught.suggestion.length).toBeGreaterThan(0);
  });

  it("sets status = 400 on the thrown error", () => {
    let caught;
    try {
      validateCursor("");
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(400);
  });

  it("returns the cursor unchanged for a valid non-empty string", () => {
    const cursor = "112631640938561537";
    expect(validateCursor(cursor)).toBe(cursor);
  });

  it("accepts cursor strings that look like paging tokens", () => {
    const pagingToken = "112631640938561537-1";
    expect(validateCursor(pagingToken)).toBe(pagingToken);
  });

  it("accepts cursor strings containing only digits", () => {
    expect(validateCursor("999999")).toBe("999999");
  });

  it("throws for cursor strings containing invalid characters", () => {
    let caught;
    try {
      validateCursor("invalid cursor!");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.isInvalidCursor).toBe(true);
    expect(caught.type).toBe("InvalidCursor");
  });
});

// ── parsePaginationParams integration ────────────────────────────────────────

describe("parsePaginationParams – cursor validation", () => {
  it("does NOT throw when cursor is absent (no key in query)", () => {
    expect(() => parsePaginationParams({})).not.toThrow();
  });

  it("does NOT throw when cursor is undefined", () => {
    expect(() => parsePaginationParams({ cursor: undefined })).not.toThrow();
  });

  it("throws isInvalidCursor for an empty string cursor", () => {
    let caught;
    try {
      parsePaginationParams({ cursor: "" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.isInvalidCursor).toBe(true);
  });

  it("throws isInvalidCursor for a null cursor", () => {
    let caught;
    try {
      parsePaginationParams({ cursor: null });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.isInvalidCursor).toBe(true);
  });

  it("throws isInvalidCursor for a numeric cursor", () => {
    let caught;
    try {
      parsePaginationParams({ cursor: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.isInvalidCursor).toBe(true);
  });

  it("returns the cursor when valid", () => {
    const { cursor } = parsePaginationParams({ cursor: "112631640938561537" });
    expect(cursor).toBe("112631640938561537");
  });

  it("returns cursor as undefined when not provided", () => {
    const { cursor } = parsePaginationParams({});
    expect(cursor).toBeUndefined();
  });
});

// ── HTTP integration: paginated endpoint returns 400 for bad cursor ──────────

const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      transactions: jest.fn(),
      operations: jest.fn(),
      ledgers: jest.fn(),
      feeStats: jest.fn(),
    },
  };
});

const request = require("supertest");
const app = require("../../src/index");

const VALID_ACCOUNT = Keypair.random().publicKey();

describe("Paginated endpoints – invalid cursor returns 400", () => {
  beforeEach(() => {
    require("../../src/services/cache").flush();
    jest.clearAllMocks();
  });

  it("GET /transactions/:id returns 400 with InvalidCursor for empty cursor", async () => {
    const res = await request(app)
      .get(`/transactions/${VALID_ACCOUNT}?cursor=`)
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidCursor");
    expect(typeof res.body.error.message).toBe("string");
    expect(typeof res.body.error.suggestion).toBe("string");
  });

  it("GET /transactions/:id/operations returns 400 with InvalidCursor for empty cursor", async () => {
    const res = await request(app)
      .get(`/transactions/${VALID_ACCOUNT}/operations?cursor=`)
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidCursor");
  });

  it("invalid cursor message matches the standard shape", async () => {
    const res = await request(app)
      .get(`/transactions/${VALID_ACCOUNT}?cursor=`)
      .expect(400);

    expect(res.body.error).toMatchObject({
      type: "InvalidCursor",
      message: expect.any(String),
      suggestion: expect.any(String),
    });
  });

  it("valid cursor does not return 400", async () => {
    const { server } = require("../../src/config/stellar");
    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      includeFailed: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    const res = await request(app)
      .get(`/transactions/${VALID_ACCOUNT}?cursor=112631640938561537`);

    expect(res.status).not.toBe(400);
  });

  it("GET /transactions/:id with invalid cursor characters returns 400", async () => {
    const res = await request(app)
      .get(`/transactions/${VALID_ACCOUNT}?cursor=bad cursor!`)
      .expect(400);

    expect(res.body.error.type).toBe("InvalidCursor");
    expect(res.body.error.suggestion).toBe("Use the cursor returned in the previous response.");
  });
});
