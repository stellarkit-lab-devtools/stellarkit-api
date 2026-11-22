# Route scaffold generator

From the repository root:

```sh
npm run new:route -- --path /account/:id/foo --name foo --cached --paginated
```

This creates `src/routes/foo.js` and `tests/routes/foo.test.js`, registers the
router in `src/index.js` before the 404 handler, and appends a README table row
stub. `--name` is a lowercase-leading JavaScript identifier; `--path` accepts
literal segments and named parameters. File collisions abort without modifying
the existing scaffold, index or README. Unknown flags and unsafe paths are errors.

Use `--dry-run` to print generated files, the registration line and README row
without writing anything. `--cached` adds the shared cache, a TTL, `X-Cache`
headers and `?fresh=true`. `--paginated` adds shared pagination validation and
cursor/limit/order handling. Account paths validate the account ID before work.
Templates live in `scripts/templates/`.

The generated route is a starting point: replace its TODO lookup and mapping
with domain behavior, choose an appropriate endpoint TTL (the stub uses the
existing network-status TTL), validate any additional path/query fields, and
move the README stub into the appropriate API reference section. Add domain
assertions to the generated mocked-route test before submitting the endpoint.

Generator tests use temporary directories, check all flag combinations,
collision protection and dry-run behavior, and lint the generated route and
test with the repository's ESLint configuration.
