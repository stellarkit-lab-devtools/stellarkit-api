# TODO

## Error Handling Enrichment | Add a specific error for insufficient XLM reserve
- [x] Step 1: Add `makeInsufficientXLMReserveError()` to `src/utils/errors.js`
- [x] Step 2: Update `src/middleware/errorHandler.js` to handle `isInsufficientXLMReserve`
- [x] Step 3: Add tests in `tests/errorHandler.test.js`
- [x] Step 4: Run tests to verify

## Response Normalisation | Normalise GET /account/:id/sequence response shape
- [ ] Analyse expected vs actual response shapes
- [ ] Implement normalization changes
- [ ] Run tests to verify

## Cache bypass documentation (?fresh=true)
- [ ] Confirm all endpoints that respect `?fresh=true` (likely `/network-status` and `/fee-estimate` and their subroutes).
- [ ] Update `README.md` with a "fresh cache bypass" section and request examples.

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

## Issue #585: New Endpoint GET /account/:id/payment-summary
- [x] Add GET /:id/payment-summary route handler to `src/routes/account.js`
- [x] Add "payment-summary" to reserved words list to prevent routing conflicts
- [x] Returns { success: true, data: { totalSent, totalReceived, volumeSent, volumeReceived, topCounterparty, topAsset } }
- [x] All volume values are seven-decimal strings
- [x] Returns zeroed values for accounts with no payment history rather than a 404

## Issue #579: Add ?assets= filter to GET /account/:id/balances
- [x] Add optional ?assets= query param parsing to /balances route
- [x] "XLM" returns only native balance, "CODE:ISSUER" filters asset balances
- [x] Invalid identifiers are ignored
- [x] Returns empty array when no assets match

## Repo integrity
- [ ] Resolve merge conflict markers in `src/index.js` (currently present as `<<<<<<< HEAD` / `=======` / `>>>>>>>`).
- [ ] Ensure `npm test` passes.

## Issue #397: New Endpoint GET /transaction/:hash/effects
- [ ] Inspect existing transaction routes and response/normalization utilities
- [ ] Implement GET /transaction/:hash/effects route
  - [ ] Validate :hash is 64-char hex before Horizon call
  - [ ] Fetch all effects for transaction hash via Horizon
  - [ ] Normalize each effect with: effectId, type, account, createdAt, plus type-specific fields (best-effort)
  - [ ] Return { success: true, data: { effects: [...], total } }
  - [ ] Return 404 with clear message when transaction hash does not exist
- [x] Inspect existing transaction routes and response/normalization utilities
- [x] Implement GET /transaction/:hash/effects route
  - [x] Validate :hash is 64-char hex before Horizon call
  - [x] Fetch all effects for transaction hash via Horizon
  - [x] Normalize each effect with: effectId, type, account, createdAt, plus type-specific fields (best-effort)
  - [x] Return { success: true, data: { effects: [...], total } }
  - [x] Return 404 with clear message when transaction hash does not exist
- [x] Add/Update tests for the new endpoint (shape + validation + 404 behavior)
- [x] Ensure routing is registered in src/index.js (and docs list if applicable)
- [x] Run targeted unit tests for the endpoint only (no build)


