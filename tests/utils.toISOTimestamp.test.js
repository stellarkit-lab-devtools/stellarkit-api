"use strict";

const { toISOTimestamp } = require("../src/utils/response");

describe("toISOTimestamp", () => {
  // Falsy / null handling
  it("returns null for null", () => {
    expect(toISOTimestamp(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toISOTimestamp(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toISOTimestamp("")).toBeNull();
  });

  // Stellar / ISO date strings
  it("handles a Stellar ISO date string", () => {
    expect(toISOTimestamp("2024-07-01T12:00:00Z")).toBe("2024-07-01T12:00:00.000Z");
  });

  it("handles a date string with milliseconds", () => {
    expect(toISOTimestamp("2024-07-01T12:00:00.500Z")).toBe("2024-07-01T12:00:00.500Z");
  });

  // JavaScript Date objects
  it("handles a Date object", () => {
    const d = new Date("2024-07-01T12:00:00.000Z");
    expect(toISOTimestamp(d)).toBe("2024-07-01T12:00:00.000Z");
  });

  // Unix timestamps in seconds (< 1e12)
  it("handles a Unix timestamp in seconds", () => {
    // 1719835200 = 2024-07-01T12:00:00.000Z
    expect(toISOTimestamp(1719835200)).toBe("2024-07-01T12:00:00.000Z");
  });

  // Unix timestamps in milliseconds (>= 1e12)
  it("handles a Unix timestamp in milliseconds", () => {
    expect(toISOTimestamp(1719835200000)).toBe("2024-07-01T12:00:00.000Z");
  });

  // Output format
  it("always returns a string ending in Z (UTC)", () => {
    const result = toISOTimestamp("2024-07-01T12:00:00Z");
    expect(result).toMatch(/Z$/);
  });

  it("output matches ISO 8601 pattern", () => {
    const iso8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(toISOTimestamp("2024-07-01T12:00:00Z")).toMatch(iso8601);
    expect(toISOTimestamp(1719835200)).toMatch(iso8601);
    expect(toISOTimestamp(new Date("2024-07-01T12:00:00Z"))).toMatch(iso8601);
  });
});
