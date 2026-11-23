const { parsePaginationParams } = require("../src/utils/pagination");

describe("parsePaginationParams", () => {
  it("returns defaults when query is empty", () => {
    const result = parsePaginationParams({});
    expect(result).toEqual({ limit: 20, order: "desc", cursor: undefined });
  });

  it("parses valid limit parameter", () => {
    const result = parsePaginationParams({ limit: 50 });
    expect(result.limit).toBe(50);
  });

  it("converts string limit to number", () => {
    const result = parsePaginationParams({ limit: "25" });
    expect(result.limit).toBe(25);
  });

  it("rejects limit above max — throws isInvalidLimit", () => {
    expect(() => parsePaginationParams({ limit: 300 }, 100)).toThrow(
      "limit must be a number between 1 and 100."
    );
  });

  it("rejects limit=0 — throws isInvalidLimit", () => {
    expect(() => parsePaginationParams({ limit: 0 })).toThrow(
      "limit must be a number between 1 and 100."
    );
  });

  it("rejects non-numeric limit — throws isInvalidLimit", () => {
    expect(() => parsePaginationParams({ limit: "invalid" })).toThrow(
      "limit must be a number between 1 and 100."
    );
  });

  it("parses valid order parameter (asc)", () => {
    const result = parsePaginationParams({ order: "asc" });
    expect(result.order).toBe("asc");
  });

  it("parses valid order parameter (desc)", () => {
    const result = parsePaginationParams({ order: "desc" });
    expect(result.order).toBe("desc");
  });

  it("defaults to desc when order is missing", () => {
    const result = parsePaginationParams({});
    expect(result.order).toBe("desc");
  });

  it("converts order to lowercase", () => {
    const result = parsePaginationParams({ order: "ASC" });
    expect(result.order).toBe("asc");
  });

  it("rejects invalid order parameter", () => {
    expect(() => parsePaginationParams({ order: "invalid" })).toThrow();
  });

  it("parses valid cursor parameter", () => {
    const cursor = "token-123";
    const result = parsePaginationParams({ cursor });
    expect(result.cursor).toBe(cursor);
  });

  it("sets cursor to undefined when not provided", () => {
    const result = parsePaginationParams({});
    expect(result.cursor).toBeUndefined();
  });

  it("respects custom maxLimit parameter", () => {
    const result = parsePaginationParams({ limit: 50 }, 100);
    expect(result.limit).toBe(50);

    expect(() => parsePaginationParams({ limit: 150 }, 100)).toThrow(
      "limit must be a number between 1 and 100."
    );
  });

  it("parses all parameters together", () => {
    const result = parsePaginationParams(
      { limit: "30", order: "asc", cursor: "cursor-abc" },
      100
    );
    expect(result).toEqual({
      limit: 30,
      order: "asc",
      cursor: "cursor-abc",
    });
  });

  it("throws error with isInvalidLimit flag for invalid limit", () => {
    try {
      parsePaginationParams({ limit: -5 });
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.isInvalidLimit).toBe(true);
      expect(err.message).toBe("limit must be a number between 1 and 100.");
    }
  });

  it("accepts boundary values 1 and 100", () => {
    expect(parsePaginationParams({ limit: 1 }).limit).toBe(1);
    expect(parsePaginationParams({ limit: 100 }).limit).toBe(100);
  });
});

// ── Page-based pagination ────────────────────────────────────────────────

describe("parsePaginationParams — ?page= support", () => {
  it("page=1 returns no cursor and no page field (same as no param)", () => {
    const result = parsePaginationParams({ page: "1" });
    expect(result.cursor).toBeUndefined();
    expect(result.page).toBeUndefined();
    expect(result.limit).toBe(20);
    expect(result.order).toBe("desc");
  });

  it("page=2 returns page:2 with cursor:undefined", () => {
    const result = parsePaginationParams({ page: "2" });
    expect(result.page).toBe(2);
    expect(result.cursor).toBeUndefined();
  });

  it("page=2 with limit=20 returns limit:20 and page:2", () => {
    const result = parsePaginationParams({ page: "2", limit: "20" });
    expect(result.limit).toBe(20);
    expect(result.page).toBe(2);
    expect(result.cursor).toBeUndefined();
  });

  it("page=5 with limit=10 returns limit:10 and page:5", () => {
    const result = parsePaginationParams({ page: "5", limit: "10" });
    expect(result.limit).toBe(10);
    expect(result.page).toBe(5);
  });

  it("cursor takes precedence over page when both are supplied", () => {
    const result = parsePaginationParams({ page: "3", cursor: "token-abc" });
    expect(result.cursor).toBe("token-abc");
    expect(result.page).toBeUndefined();
  });

  it("page=0 throws a 400 validation error", () => {
    expect(() => parsePaginationParams({ page: "0" })).toThrow();
    try {
      parsePaginationParams({ page: "0" });
    } catch (err) {
      expect(err.isValidation).toBe(true);
      expect(err.field).toBe("page");
      expect(err.status).toBe(400);
    }
  });

  it("page=-1 throws a 400 validation error", () => {
    try {
      parsePaginationParams({ page: "-1" });
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.isValidation).toBe(true);
      expect(err.field).toBe("page");
    }
  });

  it("page=abc throws a 400 validation error", () => {
    try {
      parsePaginationParams({ page: "abc" });
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.isValidation).toBe(true);
      expect(err.field).toBe("page");
    }
  });

  it("page=1.5 (non-integer) throws a 400 validation error", () => {
    try {
      parsePaginationParams({ page: "1.5" });
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.isValidation).toBe(true);
      expect(err.field).toBe("page");
    }
  });

  it("page=1.0 (parses as integer 1) is treated as page 1 — no pagination", () => {
    // Number("1.0") === 1 which is an integer, so this is valid
    const result = parsePaginationParams({ page: "1.0" });
    expect(result.cursor).toBeUndefined();
    expect(result.page).toBeUndefined();
  });
});
