const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ESLint } = require("eslint");
const { generate } = require("../scripts/new-route");

describe("route scaffold generator", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stellarkit-route-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/index.js"), "const app = {};\n// ── 404\napp.use(errorHandler);\n");
    fs.writeFileSync(path.join(root, "README.md"), "# API\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it.each([[], ["--cached"], ["--paginated"], ["--cached", "--paginated"]])("generates conventions and lintable output (%j)", async (...flags) => {
    // Jest expands array rows into individual arguments.
    const args = ["--path", "/account/:id/foo", "--name", "foo", ...flags];
    generate(args, { root, print: () => {} });
    const route = fs.readFileSync(path.join(root, "src/routes/foo.js"), "utf8");
    const test = fs.readFileSync(path.join(root, "tests/routes/foo.test.js"), "utf8");
    expect(route).toContain('require("../config/stellar")');
    expect(route).toContain("validateAccountId(req.params.id)");
    expect(route).toContain("success(res, data, meta)");
    expect(test).toContain('jest.mock("../../src/config/stellar"');
    expect(test).toContain('require("../../src/routes/foo")');
    expect(route.includes('res.set("X-Cache", "HIT")')).toBe(flags.includes("--cached"));
    expect(route.includes("parsePaginationParams(req.query)")).toBe(flags.includes("--paginated"));
    expect(fs.readFileSync(path.join(root, "src/index.js"), "utf8")).toContain('app.use("/", require("./routes/foo"));\n\n// ── 404');
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toContain("| GET | `/account/:id/foo` |");
    const repo = path.resolve(__dirname, "..");
    const eslint = new ESLint({ cwd: repo, overrideConfigFile: path.join(repo, "eslint.config.js") });
    for (const [contents, file] of [[route, "src/routes/foo.js"], [test, "tests/routes/foo.test.js"]]) {
      const results = await eslint.lintText(contents, { filePath: path.join(repo, file) });
      expect(results.flatMap((result) => result.messages)).toEqual([]);
    }
  });

  it("prints all proposed changes without writing", () => {
    const print = jest.fn();
    const before = fs.readFileSync(path.join(root, "src/index.js"), "utf8");
    generate(["--path", "/account/:id/foo", "--name", "foo", "--dry-run"], { root, print });
    expect(print.mock.calls.flat().join("\n")).toContain("tests/routes/foo.test.js");
    expect(fs.existsSync(path.join(root, "src/routes"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "src/index.js"), "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toBe("# API\n");
  });

  it.each(["src/routes/foo.js", "tests/routes/foo.test.js"])("never overwrites %s or modifies registration on collision", (file) => {
    const existing = path.join(root, file);
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, "keep me");
    expect(() => generate(["--path", "/account/:id/foo", "--name", "foo"], { root })).toThrow("Refusing to overwrite");
    expect(fs.readFileSync(existing, "utf8")).toBe("keep me");
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toBe("# API\n");
    expect(fs.readFileSync(path.join(root, "src/index.js"), "utf8")).not.toContain("./routes/foo");
  });

  it.each([
    ["--name", "../escape", "--path", "/foo"],
    ["--name", "foo", "--path", "/../escape"],
    ["--name", "foo", "--path", "/:id/:id"],
    ["--name", "foo", "--path", "/foo", "--unknown"],
  ])("rejects unsafe or malformed arguments", (...args) => {
    expect(() => generate(args, { root })).toThrow();
    expect(fs.existsSync(path.join(root, "src/routes"))).toBe(false);
  });
});
