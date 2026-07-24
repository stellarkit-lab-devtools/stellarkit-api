# TODO - Issue #397: New Endpoint GET /transaction/:hash/effects

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


