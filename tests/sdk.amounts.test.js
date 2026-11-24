const fs = require("fs");
const path = require("path");
const ts = require("typescript");
// Load the source without requiring a build step or generated SDK files.
const source = fs.readFileSync(path.join(__dirname, "../sdk/amounts.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const loaded = { exports: {} };
new Function("exports", "module", compiled.outputText)(loaded.exports, loaded);
const { toStroops, fromStroops, add, sub, cmp, min, max, sum, InvalidAmount } = loaded.exports;

describe("SDK exact amounts", () => {
  it("round trips and formats seven decimals", () => {
    expect(fromStroops(toStroops("123.4567890"))).toBe("123.4567890");
    expect(fromStroops("1")).toBe("0.0000001");
  });
  it("supports both signed int64 boundaries", () => {
    expect(toStroops("922337203685.4775807")).toBe(9223372036854775807n);
    expect(fromStroops(-9223372036854775808n)).toBe("-922337203685.4775808");
  });
  it.each(["", " ", " 1", "1 ", "1e2", "1E-7", "1.12345678", ".1", "1.", "+1"])("rejects %p", (value) => {
    expect(() => toStroops(value)).toThrow(InvalidAmount);
  });
  it("rejects overflow in conversions and arithmetic", () => {
    expect(() => toStroops("922337203685.4775808")).toThrow(InvalidAmount);
    expect(() => fromStroops("-9223372036854775809")).toThrow(InvalidAmount);
    expect(() => add("922337203685.4775807", "0.0000001")).toThrow(InvalidAmount);
    expect(() => sub("-922337203685.4775808", "0.0000001")).toThrow(InvalidAmount);
  });
  it("orders and computes negative amounts", () => {
    expect(add("0.1", "0.2")).toBe("0.3000000");
    expect(sub("1", "2")).toBe("-1.0000000");
    expect(cmp("2", "10")).toBe(-1);
    expect(cmp("-2", "-10")).toBe(1);
    expect(cmp("1", "1.0000000")).toBe(0);
    expect(min("-2", "10")).toBe("-2.0000000");
    expect(max("-2", "10")).toBe("10.0000000");
    expect(toStroops("-0.0000001")).toBe(-1n);
  });
  it("sums long sequences exactly", () => {
    expect(sum(Array(10000).fill("0.0000001"))).toBe("0.0010000");
    expect(sum([])).toBe("0.0000000");
  });
});
