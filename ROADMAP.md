# StellarKit API Roadmap

This document outlines the planned direction for StellarKit API across three horizons. It is intended to help contributors understand where the project is headed and where their efforts will have the most impact.

---

## Near Term — Next Wave Sprint

Features and improvements targeted for the next active development sprint:

1. **Offer / Order Book Endpoints** — Add `/offers` and `/order-book` routes to expose Stellar's DEX order data via the Horizon offers API.
2. **Claimable Balances Support** — Add `/claimable-balances` endpoints to list, inspect, and filter claimable balance records for an account.
3. **Structured Error Codes** — Standardize all error responses with machine-readable `code` fields (e.g., `ACCOUNT_NOT_FOUND`, `RATE_LIMIT_EXCEEDED`) alongside human-readable messages.
4. **Pagination Helpers** — Expose Horizon's cursor-based pagination (`cursor`, `order`, `limit`) consistently across all list endpoints.
5. **Health Check Enhancements** — Extend `/network-status` to include average ledger close time, current base fee, and validator quorum size.

---

## Medium Term — Next 3 Months

Larger features and integrations planned for the months ahead:

1. **TypeScript SDK Release** — Publish a typed client SDK to npm (`@stellarkit/sdk`) that wraps all StellarKit API endpoints with full TypeScript definitions, auto-completion support, and Zod-validated responses.
2. **Webhook / Event Streaming** — Introduce a subscription endpoint that streams ledger events (new payments, trustline changes, account merges) to registered webhook URLs in near-real-time using Horizon SSE.
3. **Multi-Network Support** — Allow callers to target Testnet, Futurenet, or custom Horizon URLs via a `network` query parameter or `X-Stellar-Network` header, making the API useful for development and QA environments.
4. **Transaction Builder Endpoint** — Add a `/build-tx` helper that takes high-level operation descriptors (payment, create account, change trust) and returns an XDR envelope ready for signing — lowering the barrier for developers who do not want to depend on the full Stellar SDK client-side.
5. **Performance Benchmarks** — Publish automated p50/p95 latency benchmarks for each endpoint run against Horizon mainnet on every release, tracked over time in `docs/benchmarks/`.

---

## Long Term — 6+ Months

Ecosystem integrations and architectural goals on the horizon:

1. **Soroban / Smart Contract Endpoints** — Add support for querying Soroban contract state, reading ledger entries, and simulating transactions against deployed contracts, keeping pace with Stellar's smart contract platform evolution.
2. **Anchor / SEP Integration Layer** — Provide optional middleware that proxies SEP-6, SEP-10, and SEP-24 anchor flows, giving developers a single API surface for both on-chain and fiat-on/off-ramp operations.
3. **OpenAPI 3.1 Spec + Auto-Generated Docs** — Maintain a machine-readable OpenAPI specification for every endpoint, with auto-generated interactive documentation deployed alongside each release.
4. **Rate Limit Tiers via API Keys** — Introduce optional API key authentication that unlocks higher rate-limit tiers for production applications, with usage dashboards and key management endpoints.
5. **Plugin / Middleware Extension Points** — Define a stable plugin interface so teams can register custom route modules or response transformers without forking the core project.
6. **Grafana / Prometheus Metrics Export** — Ship a `/metrics` endpoint in Prometheus exposition format so StellarKit API deployments can be scraped directly into existing observability stacks.

---

## Contributing to the Roadmap

This roadmap is a living document. If you want to influence priorities, open an issue with the `roadmap` label and describe the use case you are trying to solve. Concrete use cases move items forward faster than feature requests alone.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started contributing code.
