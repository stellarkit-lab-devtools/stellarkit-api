# Response migrations since 1.0.0

Use this guide when upgrading from 1.0.0 or an intermediate checkout. Examples
are JSON excerpts: unrelated record fields are omitted. Follow each entry's
consumer fix rather than assuming that every list endpoint has the same shape.

## Release attribution and review basis

The baseline is the initial release commit `49e7d6f`. The repository records
only `[1.0.0] - 2026-05-27` and `[Unreleased]` in CHANGELOG.md, and has no version
tags in this checkout. All changes below therefore belong to **Unreleased**;
commit dates are not release dates. The review compared route/helper diffs with
the handlers currently registered in `src/index.js`, including the first matching
handler when a route is registered twice. Links identify the introducing PR and
the relevant commit so consumers can audit the transition.

## List envelopes and transaction operations

Introduced by [PR #368](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/368)
(`d706fea`); operations were subsequently renamed by
[PR #822](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/822)
(`d82a111`). Both are Unreleased.

In 1.0.0, `GET /transactions/:id` returned an array in `data`. It now returns an
object with an `items` array. `GET /transactions/:id/operations` now uses an
`operations` array inside `data` (an intermediate revision used `items`).

Before (1.0.0 transactions):

```json
{ "success": true, "data": [{ "id": "123" }], "meta": { "count": 1, "limit": 10, "order": "desc", "nextCursor": "123", "hasMore": false } }
```

After (current transactions):

```json
{ "success": true, "data": { "items": [{ "id": "123" }] }, "meta": { "count": 1, "limit": 10, "order": "desc", "nextCursor": "123", "hasMore": true } }
```

Before (intermediate operations):

```json
{ "success": true, "data": { "items": [{ "id": "123", "type": "payment" }] } }
```

After (current operations):

```json
{ "success": true, "data": { "operations": [{ "id": "123", "type": "payment" }] } }
```

**Consumer fix:** read transaction records from `body.data.items` and operation
records from `body.data.operations`. Update array schema validation and mocks.
Asset search also changed from a bare `data` array to `data.items` in PR #368.
Some `hasMore` implementations now signal a non-null cursor rather than a full
page; stop when the next page is empty and never treat this flag as a total count.

## Pagination metadata moved, then the asset holder count was renamed

Introduced by [PR #869](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/869)
(`baa25ce`) and [PR #870](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/870)
(`1165b27`), Unreleased.

PR #869 moved `data.total`, `data.limit` and `data.cursor` into top-level `meta`
as `count`, `limit` and `nextCursor`, with `order` and `hasMore`. This affects
account operations, payments, trades and offers, transaction history and its
operations, liquidity pool trades, and claimable balances by sponsor.

Before (intermediate `GET /transactions/:id`):

```json
{ "success": true, "data": { "items": [], "total": 0, "limit": 20, "cursor": null } }
```

After:

```json
{ "success": true, "data": { "items": [] }, "meta": { "count": 0, "limit": 20, "order": "desc", "nextCursor": null, "hasMore": false } }
```

PR #870 then renamed **only the confirmed asset-holder metadata field** from
`meta.count` to `meta.total` in `GET /asset/:code/:issuer/holders`.

Before (asset holders):

```json
{ "success": true, "data": [], "meta": { "count": 0, "limit": 20, "order": "desc", "nextCursor": null, "hasMore": false } }
```

After (asset holders):

```json
{ "success": true, "data": [], "meta": { "total": 0, "limit": 20, "order": "desc", "nextCursor": null, "hasMore": false } }
```

**Consumer fix:** move pagination reads out of `data`, send `meta.nextCursor`
back as the `cursor` query parameter, and read `meta.total` for asset holders.
Other listed routes still use `meta.count`; the historical commit message's
claim of a global count rename does not match current handlers. Both count
fields describe the returned page, not the size of the full Horizon collection.

## Sponsorship endpoint consolidation

Introduced by [PR #870](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/870)
(`1165b27`), Unreleased. These endpoints were added after 1.0.0, so this affects
consumers of intermediate revisions.

`GET /account/:id/sponsorship` previously returned HTTP 200 with sponsorship
data. It now returns **HTTP 410 Gone**:

Before:

```json
{ "success": true, "data": { "accountId": "G...", "accountSponsor": null, "sponsoredEntries": [], "accountsSponsoring": [], "count": 0 } }
```

After (old singular URL):

```json
{ "success": false, "error": { "type": "Gone", "message": "GET /account/:id/sponsorship has been deprecated and consolidated into GET /account/:id/sponsorships. Please use that endpoint instead.", "deprecated": true, "replacementEndpoint": "/account/:id/sponsorships" } }
```

The plural endpoint's payload also changed:

Before (`GET /account/:id/sponsorships`):

```json
{ "success": true, "data": { "sponsoring": [], "sponsoredBy": [] } }
```

After (`GET /account/:id/sponsorships`, HTTP 200):

```json
{ "success": true, "data": { "accountId": "G...", "accountSponsor": null, "sponsoredEntries": [], "accountsSponsoring": [], "total": 0 } }
```

**Consumer fix:** switch to the plural URL, read `sponsoredEntries` and
`accountsSponsoring`, and replace `count` with `total`. Sponsored entries include
trustlines, signers, data entries and offers, with type/address/sponsor/reserve
information. `accountsSponsoring` contains account IDs, not typed entry objects.
The later duplicate plural handler in `account.js` is unreachable for a matching
GET; its `sponsoredBy`/`sponsoring`/`count` shape is not the live contract.

## Decimal amount types and trade fields

Introduced by [PR #600](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/600)
(`1b5fd40`) and [PR #743](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/743)
(`434a795`), Unreleased.

Numeric amount-like JSON fields are now formatted as seven-decimal strings by
the global response normalizer (`src/utils/response.js`). Stroop fields remain
excluded. Account trades no longer expose the raw fraction fields
`priceNumerator`, `priceDenominator`, or `baseIsSeller`.

Before (amount excerpt):

```json
{ "success": true, "data": { "balance": 10, "price": 0.5 } }
```

After:

```json
{ "success": true, "data": { "balance": "10.0000000", "price": "0.5000000" } }
```

Before (account trade excerpt):

```json
{ "baseAmount": "10", "counterAmount": "5", "priceNumerator": 1, "priceDenominator": 2, "baseIsSeller": true, "tradeType": "sell" }
```

After:

```json
{ "baseAmount": "10.0000000", "counterAmount": "5.0000000", "price": "0.5000000", "tradeType": "sell" }
```

**Consumer fix:** accept decimal strings in schemas and use decimal arithmetic
for money. Read `price` instead of calculating a fraction from removed fields.
Current account trades also provide `selling`, `buying`, `soldAmount` and
`boughtAmount` from the queried account's perspective; use those for account
cash flows instead of inferring direction from the Horizon base side.

## Generic error identifier

Introduced by [PR #759](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/759)
(`d3704ab`), Unreleased.

Before (generic untyped exception):

```json
{ "success": false, "error": { "type": "ServerError", "message": "Example failure" } }
```

After:

```json
{ "success": false, "error": { "type": "InternalError", "message": "Example failure" }, "requestId": null }
```

**Consumer fix:** match `InternalError` for untyped exceptions; keep handling
specific error types separately. Do not branch on human-readable messages.

## Candidate checked and excluded: error type casing

There is no confirmed runtime-wide uppercase-to-PascalCase transition. The 1.0.0
error handler already emitted `HorizonError`, `ValidationError`, and `ServerError`.
[PR #915](https://github.com/stellarkit-lab-devtools/stellarkit-api/pull/915)
(`82d92c6`) corrected README examples such as `VALIDATION_ERROR` to
`ValidationError`; it did not change runtime casing. Consequently this is not
listed as a breaking change in the changelog. The generic error *name* change
above is separately confirmed in runtime code.

See [API versioning](api-versioning.md) for future compatibility and deprecation
rules, and [the changelog](../CHANGELOG.md) for release placement.
