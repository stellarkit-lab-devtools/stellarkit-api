# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Account age and longevity metrics endpoint: `GET /account/:id/age`
- Asset freeze status check endpoint: `GET /account/:id/freeze-status/:assetCode/:assetIssuer`
- Liquidity pool positions endpoint: `GET /account/:id/pool-positions`
- Fee surge detection and recommendations endpoint: `GET /fee-estimate/surge-status`
- Fee trends analysis endpoint: `GET /fee-estimate/trends`
- DEX spread calculation endpoint: `GET /dex/spread/:sellAsset/:buyAsset`
- DEX order book imbalance detection endpoint: `GET /dex/imbalance/:sellAsset/:buyAsset`
- DEX arbitrage path discovery endpoint: `GET /dex/arbitrage/:assetCode/:assetIssuer`
- Claimable balance evaluation endpoint: `GET /claimable-balances/:id/evaluate/:accountId`
- Network ledger timing analysis endpoint: `GET /network/ledger-timing`
- Liquidity pool profitability endpoint: `GET /liquidity-pools/:id/profitability`
- Liquidity pool reserve ratio endpoint: `GET /liquidity-pools/:id/reserve-ratio`
- Account counterparties analysis endpoint: `GET /account/:id/counterparties`
- Transaction memo search endpoint: `GET /account/:id/transactions/search`
- Account inactivity status endpoint: `GET /account/:id/inactivity`
- Account subentry health endpoint: `GET /account/:id/subentry-health`
- Account sponsorship relationships endpoint: `GET /account/:id/sponsorship`
- Account can-receive asset check endpoint: `GET /account/:id/can-receive/:assetCode/:assetIssuer`
- Account offer history endpoint: `GET /account/:id/offer-history`
- Asset distribution and Gini coefficient endpoint: `GET /asset/:code/:issuer/distribution`
- Network validators endpoint: `GET /network/validators`

## [1.0.0] - 2026-05-27

### Added
- Network Status endpoint providing latest ledger info, base fee, and protocol version
- Fee Estimation endpoint with Economy/Standard/Priority fee tiers for any operation count
- Account Info endpoint returning balances (XLM + all assets), signers, thresholds, and spendable balance
- Transaction History endpoint with paginated transactions and operations per account
- Asset Metadata endpoint with stats for any Stellar asset, plus multi-issuer search
- Asset Search endpoint to find all assets with a given code across all issuers
- WebSocket streaming endpoint for real-time ledger updates (`/stream/ledgers`)
- Health check endpoint for service monitoring
- Rate limiting for production use
- Helmet security headers for enhanced security
- Centralised error handling
- Jest test suite with coverage

### API Endpoints
- `GET /` - Returns the full list of available endpoints
- `GET /health` - Service health check
- `GET /network-status` - Returns latest ledger info, fees, and protocol version
- `GET /fee-estimate` - Returns fee tiers based on live network stats
- `GET /account/:id` - Returns full account details for a Stellar public key
- `GET /transactions/:id` - Returns paginated transaction history for an account
- `GET /transactions/:id/operations` - Returns paginated operation history for an account
- `GET /asset/:code/:issuer` - Returns metadata and statistics for a specific Stellar asset
- `GET /asset/search?code=:code` - Searches for all assets with a given code across all issuers
- `WS /stream/ledgers` - Live WebSocket connection to stream Stellar ledger updates
