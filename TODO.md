# TODO

## Cache bypass documentation (?fresh=true)
- [ ] Confirm all endpoints that respect `?fresh=true` (likely `/network-status` and `/fee-estimate` and their subroutes).
- [ ] Update `README.md` with a “fresh cache bypass” section and request examples.

## Sanitize middleware: extend to req.body
- [ ] Update `src/middleware/sanitize.js` to sanitize `req.body` (strings, arrays, nested objects).
- [ ] Enforce the same max-length rule (500 chars) for body string values.
- [ ] Add/extend tests in `tests/sanitize.test.js` for body trimming, null-byte stripping, and 400 on >500 length.

## Standardize query parameter validation error messages (Option A)
- [ ] Update `src/utils/validators.js` error messages to use a single template (e.g., `Query parameter '<field>' ...`).
- [ ] Update inline query validation in `src/routes/account.js` for `GET /account/:id/volume` to throw `err.isValidation=true` with consistent message/field metadata.

## New endpoint: GET /account/:id/transaction-stats
- [ ] Implement the endpoint in `src/routes/account.js`.
- [ ] Add minimal query handling (if any).
- [ ] Add tests (or extend existing test coverage) to validate response shape and error handling.

## Repo integrity
- [ ] Resolve merge conflict markers in `src/index.js` (currently present as `<<<<<<< HEAD` / `=======` / `>>>>>>>`).
- [ ] Ensure `npm test` passes.

