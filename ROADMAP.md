# StellarKit Roadmap

This document outlines the planned direction for StellarKit.

## Current State
StellarKit is a lightweight REST API wrapper for the Stellar network, providing
curated endpoints for accounts, transactions, DEX, fees, and network status.

## Short Term (Q3 2026)
- [ ] Complete TypeScript SDK migration (#274)
- [ ] Full SDK module coverage: accounts, DEX, fees, transactions (#275, #291, #290)
- [ ] Standardised list endpoint responses (#278)
- [ ] Unified asset representation across all endpoints (#279)
- [ ] Per-endpoint cache TTL configuration (#282)
- [ ] Cache hit rate logging (#283)

## Medium Term (Q4 2026)
- [ ] GET /network/validators endpoint (#289)
- [ ] WebSocket support for real-time price feeds
- [ ] Rate limiting with per-API-key quotas
- [ ] OpenAPI 3.0 specification file
- [ ] Official client libraries for Python and Go

## Long Term (2027)
- [ ] GraphQL query interface
- [ ] Multi-network support (Testnet/Futurenet toggle)
- [ ] Hosted managed service with SLA
- [ ] Webhook notifications for account events

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.
All roadmap items have corresponding GitHub issues — pick one and start!
