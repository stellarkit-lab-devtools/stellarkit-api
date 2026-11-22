# ADR 0002: Amounts are seven-decimal strings

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Stellar stores amounts as 64-bit integers of stroops (1 unit = 10,000,000
stroops), i.e. exactly seven decimal places. Horizon reports most amounts as
decimal strings (`"100.0000000"`) but fees and reserves as integer stroops.
JavaScript numbers are IEEE-754 doubles: large balances and sums lose
precision, and values like `0.1 + 0.2` do not round-trip. Mixing numbers,
stroops and strings across endpoints forced clients to guess the unit and
precision of every field.

## Decision

Every amount-like field in a response (balances, amounts, prices, limits on
offers, fees expressed in XLM, liabilities) is a string with exactly seven
decimal places, e.g. `"12.5000000"`. Integer stroop values are only exposed in
fields whose name says so (e.g. `stroops`, `chargedInStroops`).

Implemented in:

- `src/utils/formatAmount.js` — `formatAmount()` normalises strings, numbers and
  bigints to a fixed seven-decimal string using string arithmetic for decimal
  input, so no precision is lost on large values.
- `src/utils/parseStellarAmount.js` — `parseStellarAmount()` converts integer
  stroops to a seven-decimal XLM string (`STROOPS_PER_XLM = 10_000_000`).
- `src/utils/response.js` — `normalizeAmountFields()` walks a payload and applies
  `formatAmount()` to keys in `AMOUNT_KEYS` or ending in `amount`, `balance`,
  `price`, `fee` or `liabilities`, while skipping keys containing `stroop`.
- `src/index.js` — a middleware wraps `res.json` so every JSON response passes
  through `normalizeAmountFields()` as a safety net.
- `src/utils/formatBalance.js` and the `toSevenDecimalString()` helpers in
  `src/routes/account.js` and `src/routes/asset.js` — route-level formatting.

## Consequences

- Clients get lossless values and should parse them with a decimal library
  (or BigInt on stroops) rather than `parseFloat` when doing arithmetic.
- Fields such as `limit` that are not caught by the key heuristic must be
  formatted explicitly in the route (`formatAmount()`), and counts/ledger
  numbers must avoid names ending in `amount`/`balance`/`price`/`fee` or they
  will be coerced.
- There is some duplication (`toSevenDecimalString()` exists in two routes and
  converts through `Number`, and the copy in `src/routes/asset.js` truncates
  rather than rounds); new code should use `formatAmount()`.
