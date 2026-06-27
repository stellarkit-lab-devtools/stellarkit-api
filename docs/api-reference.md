# API Reference

Complete reference for all StellarKit endpoints.

## Accounts

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| GET | `/account/:id` | `id`: Stellar address | Full account details |
| GET | `/account/:id/balance` | `id` | Asset balances |
| GET | `/account/:id/transactions` | `id`, `cursor`, `limit`, `order` | Transaction history |
| GET | `/account/:id/trustlines` | `id` | Active trustlines |
| GET | `/account/:id/risk` | `id` | Risk score |
| GET | `/account/:id/age` | `id` | Account age in days |

## Transactions

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| GET | `/transaction/:hash` | `hash` | Transaction details |
| GET | `/transaction/:hash/operations` | `hash` | Operations in tx |

## DEX

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| GET | `/dex/spread` | `sell`, `buy` | Bid/ask spread |
| GET | `/dex/imbalance` | `sell`, `buy` | Market imbalance |
| GET | `/dex/arbitrage` | `code`, `issuer` | Arbitrage paths |
| GET | `/dex/orderbook` | `sell`, `buy` | Full order book |

## Fee Estimation

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| GET | `/fee-estimate` | `fresh` (bool) | Current fee estimate |
| GET | `/fee-estimate/surge` | - | Surge pricing status |
| GET | `/fee-estimate/trends` | - | Fee trends over time |

## Network

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| GET | `/network-status` | - | Network health |
| GET | `/network/validators` | - | Active validators |

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | - | Pagination cursor |
| `limit` | integer | 20 | Results per page (max 200) |
| `order` | `asc`\|`desc` | `desc` | Sort order |
| `fresh` | boolean | false | Bypass cache |
