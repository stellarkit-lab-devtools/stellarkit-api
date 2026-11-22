const fs = require("node:fs");
const path = require("node:path");

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (["--cached", "--paginated", "--dry-run"].includes(flag)) options[flag.slice(2)] = true;
    else if (["--path", "--name"].includes(flag) && args[i + 1] && !args[i + 1].startsWith("--")) options[flag.slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${flag}`);
  }
  if (!/^[a-z][A-Za-z0-9]*$/.test(options.name || "")) throw new Error("--name must be a JavaScript identifier starting with a lowercase letter.");
  if (!/^\/(?:[a-zA-Z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*)(?:\/(?:[a-zA-Z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*))*$/.test(options.path || "")) {
    throw new Error("--path must be an absolute Express path, e.g. /account/:id/foo.");
  }
  const params = [...options.path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]);
  if (new Set(params).size !== params.length) throw new Error("Path parameter names must be unique.");
  return { ...options, params };
}

function generate(args, { root = path.resolve(__dirname, ".."), print = console.log } = {}) {
  const options = parseArgs(args);
  const readmePath = path.join(root, "README.md");
  const indexPath = path.join(root, "src/index.js");
  const readme = fs.readFileSync(readmePath, "utf8");
  const index = fs.readFileSync(indexPath, "utf8");
  const routePath = path.join(root, "src/routes", `${options.name}.js`);
  const testPath = path.join(root, "tests/routes", `${options.name}.test.js`);
  for (const file of [routePath, testPath]) {
    if (fs.existsSync(file)) throw new Error(`Refusing to overwrite ${file}`);
  }
  const registration = `app.use("/", require("./routes/${options.name}"));`;
  const anchor = "app.use(errorHandler);";
  const notFoundAnchor = "// ── 404";
  const insertion = index.includes(notFoundAnchor) ? notFoundAnchor : anchor;
  if (!index.includes(insertion)) throw new Error("Cannot locate route registration anchor in src/index.js.");
  if (index.includes(`./routes/${options.name}`) || readme.includes(`\`${options.path}\``)) throw new Error("Route is already documented or registered.");
  const hasAccount = options.path.startsWith("/account/:id/") || options.path === "/account/:id";
  const validation = hasAccount ? "    validateAccountId(req.params.id);\n" : "";
  const queryImports = options.paginated ? 'const { parsePaginationParams } = require("../utils/pagination");\n' : "";
  const cacheImports = options.cached ? 'const cacheService = require("../services/cache");\nconst cacheTTL = require("../config/cacheConfig");\n' : "";
  const paramsKey = 'JSON.stringify({ params: req.params, query: req.query })';
  const cacheRead = options.cached ? `    const cacheKey = ${JSON.stringify(options.name + ":")} + ${paramsKey};\n    const fresh = req.query.fresh === true || req.query.fresh === "true";\n    if (!fresh) {\n      const cached = cacheService.get(cacheKey);\n      if (cached !== undefined) {\n        res.set("X-Cache", "HIT");\n        return success(res, cached.data, cached.meta);\n      }\n    }\n` : "";
  const fetchCode = options.paginated
    ? `    const { limit, order, cursor } = parsePaginationParams(req.query);\n    let query = server.operations()${hasAccount ? ".forAccount(req.params.id)" : ""}.limit(limit).order(order);\n    if (cursor) query = query.cursor(cursor);\n    const response = await query.call();\n    // TODO: replace the operation mapping with this endpoint's domain data.\n    const records = response.records || [];\n    const data = records.map(stripLinks);\n    const nextCursor = records.length ? records[records.length - 1].paging_token : null;\n    const meta = { meta: { count: records.length, limit, order, nextCursor, hasMore: records.length === limit } };\n`
    : `    // TODO: replace this lookup and mapping with this endpoint's domain data.\n    const result = await ${hasAccount ? "server.loadAccount(req.params.id)" : "server.serverInfo()"};\n    const data = ${hasAccount ? "{ accountId: result.id }" : "{ horizonVersion: result.horizon_version }"};\n    const meta = {};\n`;
  const cacheWrite = options.cached ? '    cacheService.set(cacheKey, { data, meta }, cacheTTL.networkStatus);\n    res.set("X-Cache", "MISS");\n' : "";
  const values = {
    PATH: JSON.stringify(options.path),
    IMPORTS: (hasAccount ? 'const { validateAccountId } = require("../utils/validators");\n' : "") + queryImports + cacheImports,
    RESPONSE_IMPORT: options.paginated ? "success, stripLinks" : "success",
    BODY: validation + cacheRead + fetchCode + cacheWrite,
    TEST_URL: JSON.stringify(options.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, param) => param === "id" && hasAccount ? '${accountId}' : "example")),
    NAME: options.name,
    MOCK: options.paginated ? 'operations: jest.fn(),' : (hasAccount ? 'loadAccount: jest.fn(),' : 'serverInfo: jest.fn(),'),
    SETUP: options.paginated ? '    const chain = { forAccount: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), cursor: jest.fn().mockReturnThis(), call: jest.fn().mockResolvedValue({ records: [] }) };\n    server.operations.mockReturnValue(chain);' : (hasAccount ? '    server.loadAccount.mockResolvedValue({ id: accountId });' : '    server.serverInfo.mockResolvedValue({ horizon_version: "test" });'),
    EXPECT_DATA: options.paginated ? "[]" : (hasAccount ? "{ accountId }" : '{ horizonVersion: "test" }'),
    EXPECT_EXTRA: options.paginated ? '    expect(res.body.meta).toMatchObject({ count: 0, nextCursor: null, hasMore: false });\n' : "",
    CACHE_TEST: options.cached ? '    expect(res.headers["x-cache"]).toBe("MISS");\n    const cached = await request(app).get(url);\n    expect(cached.headers["x-cache"]).toBe("HIT");\n' : "",
  };
  const render = (name) => fs.readFileSync(path.join(__dirname, "templates", name), "utf8")
    .replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key]);
  const queryParams = [options.cached && "fresh", options.paginated && "limit, cursor, order"].filter(Boolean).join(", ") || "—";
  const row = `| GET | \`${options.path}\` | TODO: describe ${options.name} | ${queryParams} |`;
  const files = [[routePath, render("route.js.tpl")], [testPath, render("route.test.js.tpl")]];
  if (options["dry-run"]) {
    for (const [file, contents] of files) print(`--- ${path.relative(root, file)}\n${contents}`);
    print(`--- README.md (append)\n\n### Scaffolded routes\n\n| Method | Path | Description | Query Params |\n| --- | --- | --- | --- |\n${row}\n`);
    print(`--- src/index.js (insert before 404 handler)\n${registration}`);
    return;
  }
  // Preflight everything before touching the tree; exclusive creation protects
  // existing route/test files even when another generator runs concurrently.
  const created = [];
  try {
    for (const [file, contents] of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents, { flag: "wx" });
      created.push(file);
    }
    fs.writeFileSync(indexPath, index.replace(insertion, `${registration}\n\n${insertion}`));
    fs.writeFileSync(readmePath, `${readme.trimEnd()}\n\n### Scaffolded routes\n\n| Method | Path | Description | Query Params |\n| --- | --- | --- | --- |\n${row}\n`);
  } catch (error) {
    for (const file of created) fs.unlinkSync(file);
    fs.writeFileSync(indexPath, index);
    fs.writeFileSync(readmePath, readme);
    throw error;
  }
  print(`Created ${options.name} route and test; updated README.md and src/index.js.`);
}

if (require.main === module) {
  try { generate(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { generate, parseArgs };
