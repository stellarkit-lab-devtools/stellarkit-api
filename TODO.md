# TODO - #396 New Endpoints | Add GET /account/:id/effects endpoint

- [x] Inspect existing account routes and pagination/response/error helpers.
- [x] Add GET /:id/effects route handler to `src/routes/account.js`:

  - [x] Validate account id
  - [x] Load account to return proper 404 if missing
  - [x] Fetch effects history via Horizon effects endpoint
  - [x] Apply cursor + limit query params
  - [x] Normalize response to: { success:true, data:{ effects, total, limit, cursor } }
  - [x] Map each effect to: { effectId, type, createdAt, ...typeSpecific }
  - [x] Ensure all timestamps are ISO 8601 strings

- [x] Ensure `src/index.js` root endpoint list is updated with the new route entry (optional but recommended).

- [x] Add/adjust tests for the endpoint under `tests/`.

- [ ] Run tests (do not build/run dev server per instructions).
