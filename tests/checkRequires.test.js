"use strict";

const path = require("path");
const { checkRequires } = require("../scripts/check-requires");

const FIXTURES = path.join(__dirname, "fixtures", "check-requires");

describe("scripts/check-requires.js", () => {
  it("reports no problems for a clean fixture", () => {
    expect(checkRequires([path.join(FIXTURES, "clean")])).toEqual([]);
  });

  it("catches unresolved requires in a deliberately broken fixture", () => {
    const problems = checkRequires([path.join(FIXTURES, "broken")]);
    const requests = problems.map((p) => p.request).sort();

    expect(requests).toEqual(["../nowhere/config", "./missing-module"]);
    for (const problem of problems) {
      expect(path.basename(problem.file)).toBe("index.js");
      expect(problem.line).toBeGreaterThan(0);
    }
  });

  it("finds no unresolved relative requires in src/ and tests/", () => {
    const problems = checkRequires(["src", "tests"]).map(
      ({ file, line, request }) => `${path.relative(process.cwd(), file)}:${line} ${request}`
    );
    expect(problems).toEqual([]);
  });
});
