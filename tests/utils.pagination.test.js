const { parsePaginationParams } = require("../src/utils/pagination");

describe("parsePaginationParams", () => {
  it("returns defaults when query is empty", () => {
    const result = parsePaginationParams({});
    expect(result).toEqual({ limit: 10, order: "desc", cursor: undefined });
  });

  it("parses valid limit parameter", () => {
    const result = parsePaginationParams({ limit: 50 });
    expect(result.limit).toBe(50);
  });

  it("converts string limit to number", () => {
    const result = parsePaginationParams({ limit: "25" });
    expect(result.limit).toBe(25);
  });

  it("validates limit is within max range", () => {
    expect(() => parsePaginationParams({ limit: 300 }, 200)).toThrow(
      "Limit must be a number between 1 and 200."
    );
  });

  it("treats limit 0 as falsy and defaults to 10", () => {
    const result = parsePaginationParams({ limit: 0 });
    expect(result.limit).toBe(10);
  });

  it("rejects non-numeric limit", () => {
    expect(() => parsePaginationParams({ limit: "invalid" })).toThrow(
      "Limit must be a number between 1 and 200."
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
    expect(() => parsePaginationParams({ order: "invalid" })).toThrow(
      'Invalid order parameter: "invalid". Valid values are "asc" or "desc".'
    );
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
      "Limit must be a number between 1 and 100."
    );
  });

  it("parses all parameters together", () => {
    const result = parsePaginationParams(
      { limit: "30", order: "asc", cursor: "cursor-abc" },
      200
    );
    expect(result).toEqual({
      limit: 30,
      order: "asc",
      cursor: "cursor-abc",
    });
  });

  it("throws error with isValidation flag for invalid params", () => {
    try {
      parsePaginationParams({ limit: -5 });
      fail("Should have thrown");
    } catch (err) {
      expect(err.isValidation).toBe(true);
    }
  });
});
