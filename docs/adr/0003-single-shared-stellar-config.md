# ADR 0003: A single shared Stellar config module

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Nearly every route talks to Horizon, and the Soroban routes talk to Soroban
RPC. If each file built its own `Horizon.Server`, the network selection
(`STELLAR_NETWORK`, `HORIZON_URL`) could drift between routes, connections and
SDK state would be duplicated, and tests would have to mock many separate
clients.

## Decision

`src/config/stellar.js` is the only place that resolves the network and creates
SDK clients. It:

- reads `STELLAR_NETWORK` (default `testnet`) and `HORIZON_URL`, falling back to
  the public Horizon URL for the network (`HORIZON_URLS`);
- creates one `Horizon.Server` exported as `server`, plus `horizonUrl`,
  `NETWORK` and `NETWORKS`;
- creates one optional `rpc.Server` exported as `sorobanServer` (from
  `SOROBAN_RPC_URL`, with a testnet default and a startup warning on mainnet
  when unset);
- exports shared helpers built on those clients (`fetchAccountCreation`,
  `fetchContract`).

Routes, services and middleware import from it — for example
`src/routes/account.js`, `src/routes/asset.js`, `src/routes/dex.js`,
`src/routes/soroban.js`, `src/routes/transactions.js`,
`src/services/contractEventPoller.js`, `src/middleware/errorHandler.js`
(for `NETWORK` in messages), `src/websocket.js` and `src/index.js`. No other
file under `src/` constructs a `Horizon.Server` or `rpc.Server`.

## Consequences

- Switching networks or pointing at a private Horizon is a single environment
  change, and every endpoint follows it.
- Tests mock one module: `jest.mock("../src/config/stellar", ...)` replaces
  `server` for the whole app (see `docs/testing.md`).
- Because the module reads the environment at require time, tests that change
  `STELLAR_NETWORK`/`HORIZON_URL` must call `jest.resetModules()` before
  requiring the app.
- A few places still read `process.env.STELLAR_NETWORK` directly (in
  `src/index.js` and `src/routes/utils.js`); they should import `NETWORK` from
  the config module when next changed.
