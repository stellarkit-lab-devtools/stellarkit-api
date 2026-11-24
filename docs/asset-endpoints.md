# Asset Endpoints Guide

StellarKit API exposes six endpoints for querying Stellar assets. This guide explains what each one returns, when to use it, and how they relate to each other.

---

## Endpoints at a Glance

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/asset/:code/:issuer` | Metadata and on-chain statistics |
| GET | `/asset/:code/:issuer/holders` | Paginated list of accounts holding the asset |
| GET | `/asset/:code/:issuer/distribution` | Holder concentration and Gini coefficient |
| GET | `/asset/:code/:issuer/supply` | Total, circulating, and locked supply breakdown |
| GET | `/asset/:code/:issuer/verify` | Verify the issuer via flags, home_domain, and stellar.toml |
| GET | `/asset/search` | Search assets by code across all issuers |

---

## GET /asset/:code/:issuer

Returns metadata and statistics for a specific asset identified by its code and issuer public key.

**When to use:** This is your starting point for any asset. Use it to confirm the asset exists on-chain and to retrieve its home domain, supply figures, and trustline count.

**Query params:**
- `fresh` — bypass the cache and fetch directly from Horizon

```bash
curl http://localhost:3000/asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

**Sample response:**
```json
{
  "success": true,
  "data": {
    "code": "USDC",
    "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "type": "credit_alphanum4",
    "homeDomain": "centre.io",
    "amount": "1234567890.0000000",
    "numAccounts": 42000,
    "flags": {
      "authRequired": true,
      "authRevocable": false,
      "authImmutable": false
    }
  }
}
```

---

## GET /asset/:code/:issuer/holders

Returns a paginated list of accounts that hold a trustline for this asset.

**When to use:** Use this when you need to enumerate all holders — for example, to build an airdrop list, audit trustline adoption, or paginate through holders for analytics.

**Query params:**
- `limit` — number of results per page (default: 10)
- `order` — `asc` or `desc`
- `cursor` — paging token from the previous response

```bash
curl "http://localhost:3000/asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/holders?limit=5&order=desc"
```

**Sample response:**
```json
{
  "success": true,
  "data": {
    "holders": [
      {
        "account": "GABC...XYZ",
        "balance": "1500.0000000",
        "limit": "922337203685.4775807"
      }
    ],
    "pagination": {
      "cursor": "abc123",
      "limit": 5,
      "order": "desc"
    }
  }
}
```

---

## GET /asset/:code/:issuer/distribution

Returns holder concentration metrics, including a Gini coefficient and a breakdown of how holdings are distributed across balance tiers.

**When to use:** Use this to assess how concentrated an asset is. A Gini coefficient near 1 means a small number of wallets hold most of the supply — a useful signal for risk assessment or token analysis.

```bash
curl http://localhost:3000/asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/distribution
```

**Sample response:**
```json
{
  "success": true,
  "data": {
    "giniCoefficient": 0.72,
    "totalHolders": 42000,
    "tiers": [
      { "range": "0–100", "count": 30000, "percentage": 71.4 },
      { "range": "100–1000", "count": 8000, "percentage": 19.0 },
      { "range": "1000+", "count": 4000, "percentage": 9.5 }
    ]
  }
}
```

---

## GET /asset/:code/:issuer/supply

Returns a breakdown of total, circulating, and locked supply for the asset.

**When to use:** Use this when you need to understand what portion of the total minted supply is actually in circulation. Locked supply typically refers to balances held by the issuer account itself, which have not yet been distributed.

**How it relates to `/asset/:code/:issuer`:** The metadata endpoint includes a raw `amount` field (total supply). This endpoint goes further by separating out the issuer-held (locked) portion so you can derive circulating supply without extra math.

```bash
curl http://localhost:3000/asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/supply
```

**Sample response:**
```json
{
  "success": true,
  "data": {
    "total": "1234567890.0000000",
    "circulating": "987654321.0000000",
    "locked": "246913569.0000000"
  }
}
```

---

## GET /asset/:code/:issuer/verify

Verifies the legitimacy of an asset issuer by checking account flags, the `home_domain` field, and the asset entry in the issuer's `stellar.toml` file.

**When to use:** Use this before trusting or listing an asset. It confirms that the issuer has published a `stellar.toml`, that the asset appears in the `[[CURRENCIES]]` list, and that account flags match expected issuer configuration (e.g. `auth_required`, `auth_revocable`).

**How it relates to `/asset/:code/:issuer`:** The metadata endpoint tells you what is on-chain. This endpoint cross-references that with off-chain TOML data to verify the issuer's identity claims.

```bash
curl http://localhost:3000/asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/verify
```

**Sample response:**
```json
{
  "success": true,
  "data": {
    "verified": true,
    "homeDomain": "centre.io",
    "tomlFound": true,
    "listedInToml": true,
    "flags": {
      "authRequired": true,
      "authRevocable": false,
      "authImmutable": false
    },
    "tomlEntry": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "name": "USD Coin",
      "desc": "USDC is a fully collateralised US Dollar stablecoin"
    }
  }
}
```

---

## GET /asset/search

Searches for assets by code across all issuers on the network.

**When to use:** Use this when you know the asset code but not the issuer — for example, looking up all issuers of `USDC` or finding assets with the code `BTC`. Returns multiple results when several issuers have minted an asset with the same code.

**Query params:**
- `code` (required) — the asset code to search for (e.g. `USDC`, `BTC`)
- `limit` — maximum number of results to return (default: 10)

```bash
curl "http://localhost:3000/asset/search?code=USDC&limit=5"
```

**Sample response:**
```json
{
  "success": true,
  "data": {
    "assets": [
      {
        "code": "USDC",
        "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "homeDomain": "centre.io",
        "amount": "1234567890.0000000",
        "numAccounts": 42000
      },
      {
        "code": "USDC",
        "issuer": "GDIFF...OTHER",
        "homeDomain": null,
        "amount": "500.0000000",
        "numAccounts": 3
      }
    ]
  }
}
```

---

## Choosing the Right Endpoint

| Goal | Endpoint |
|------|----------|
| Look up an asset by code without knowing the issuer | `/asset/search?code=...` |
| Get on-chain stats and home domain for a known asset | `/asset/:code/:issuer` |
| Confirm an issuer is legitimate before listing | `/asset/:code/:issuer/verify` |
| See total vs. circulating vs. locked supply | `/asset/:code/:issuer/supply` |
| Enumerate all holders for airdrop or analysis | `/asset/:code/:issuer/holders` |
| Measure holder concentration or token distribution fairness | `/asset/:code/:issuer/distribution` |
