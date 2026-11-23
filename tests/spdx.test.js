const { evaluateSpdxExpression, ALLOWED_LICENSES } = require("../src/utils/spdx");

describe("SPDX expression evaluator", () => {
  const allowed = new Set(["MIT", "ISC", "Apache-2.0", "BSD-3-Clause"]);

  it("passes when a simple license is on the allowlist", () => {
    expect(evaluateSpdxExpression("MIT", allowed)).toBe(true);
    expect(evaluateSpdxExpression("ISC", allowed)).toBe(true);
    expect(evaluateSpdxExpression("Apache-2.0", allowed)).toBe(true);
  });

  it("fails when a simple license is not on the allowlist", () => {
    expect(evaluateSpdxExpression("GPL-3.0", allowed)).toBe(false);
    expect(evaluateSpdxExpression("UNLICENSED", allowed)).toBe(false);
  });

  it("OR: passes if either side is allowed", () => {
    expect(evaluateSpdxExpression("MIT OR GPL-3.0", allowed)).toBe(true);
    expect(evaluateSpdxExpression("GPL-3.0 OR MIT", allowed)).toBe(true);
    expect(evaluateSpdxExpression("MIT OR ISC", allowed)).toBe(true);
    expect(evaluateSpdxExpression("GPL-3.0 OR AGPL-3.0", allowed)).toBe(false);
  });

  it("AND: needs both sides to be allowed", () => {
    expect(evaluateSpdxExpression("MIT AND ISC", allowed)).toBe(true);
    expect(evaluateSpdxExpression("MIT AND GPL-3.0", allowed)).toBe(false);
    expect(evaluateSpdxExpression("GPL-3.0 AND MIT", allowed)).toBe(false);
  });

  it("handles parenthesised expressions", () => {
    expect(evaluateSpdxExpression("(MIT OR GPL-3.0) AND ISC", allowed)).toBe(true);
    expect(evaluateSpdxExpression("(MIT OR ISC) AND Apache-2.0", allowed)).toBe(true);
    expect(evaluateSpdxExpression("(GPL-3.0 OR AGPL-3.0) AND MIT", allowed)).toBe(false);
  });

  it("handles the default allowlist", () => {
    expect(evaluateSpdxExpression("MIT")).toBe(true);
    expect(evaluateSpdxExpression("BlueOak-1.0.0")).toBe(true);
    expect(evaluateSpdxExpression("GPL-3.0")).toBe(false);
  });

  it("handles empty or invalid input", () => {
    expect(evaluateSpdxExpression("", allowed)).toBe(false);
    expect(evaluateSpdxExpression(null, allowed)).toBe(false);
    expect(evaluateSpdxExpression(undefined, allowed)).toBe(false);
    expect(evaluateSpdxExpression("  ", allowed)).toBe(false);
  });

  it("handles complex nested expressions", () => {
    // (MIT OR GPL-3.0) AND (ISC OR Apache-2.0)
    expect(evaluateSpdxExpression("(MIT OR GPL-3.0) AND (ISC OR Apache-2.0)", allowed)).toBe(true);
    // (MIT OR GPL-3.0) AND (GPL-3.0 OR AGPL-3.0) — MIT passes left, but right is all denied
    expect(evaluateSpdxExpression("(MIT OR GPL-3.0) AND (GPL-3.0 OR AGPL-3.0)", allowed)).toBe(false);
  });

  it("exports the ALLOWED_LICENSES set with all 8 licenses", () => {
    expect(ALLOWED_LICENSES instanceof Set).toBe(true);
    expect(ALLOWED_LICENSES.size).toBe(8);
    expect(ALLOWED_LICENSES.has("MIT")).toBe(true);
    expect(ALLOWED_LICENSES.has("ISC")).toBe(true);
    expect(ALLOWED_LICENSES.has("BSD-2-Clause")).toBe(true);
    expect(ALLOWED_LICENSES.has("BSD-3-Clause")).toBe(true);
    expect(ALLOWED_LICENSES.has("Apache-2.0")).toBe(true);
    expect(ALLOWED_LICENSES.has("0BSD")).toBe(true);
    expect(ALLOWED_LICENSES.has("CC0-1.0")).toBe(true);
    expect(ALLOWED_LICENSES.has("BlueOak-1.0.0")).toBe(true);
  });
});
