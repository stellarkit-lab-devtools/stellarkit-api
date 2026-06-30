# TODO - Issue #397: New Endpoint GET /transaction/:hash/effects

- [ ] Inspect existing transaction routes and response/normalization utilities
- [ ] Implement GET /transaction/:hash/effects route
  - [ ] Validate :hash is 64-char hex before Horizon call
  - [ ] Fetch all effects for transaction hash via Horizon
  - [ ] Normalize each effect with: effectId, type, account, createdAt, plus type-specific fields (best-effort)
  - [ ] Return { success: true, data: { effects: [...], total } }
  - [ ] Return 404 with clear message when transaction hash does not exist
- [x] Add/Update tests for the new endpoint (shape + validation + 404 behavior)

- [x] Ensure routing is registered in src/index.js (and docs list if applicable)
- [ ] Run targeted unit tests for the endpoint only (no build)


