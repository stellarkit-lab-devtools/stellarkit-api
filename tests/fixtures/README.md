# Test fixtures

`horizon/` contains realistic, static Horizon JSON responses used by the test
suite instead of hand-rolled inline fakes.

## Conventions

* One resource per file, named after the Horizon response it represents:
  `account-funded`, `account-trustlines`, `account-multisig`, `account-pool`,
  `transactions-page`, `payments-page`, `offers-page`, `trades-page`, `ledger`,
  `fee-stats`, `order-book` and `liquidity-pool`.
* Page fixtures use Horizon's `{ _embedded: { records: [...] }, _links }` shape.
* Every Stellar address is a generated, checksum-valid StrKey (`G...`), so
  validators accept the fixtures without special-casing. IDs that are not
  addresses (hashes, pool IDs) are fixed hex strings.
* Fixtures are data only — no functions, no jest mocks. Tests provide their own
  mocks and pass only the values they care about as overrides.

## Usage

```js
const { loadFixture } = require("./fixtures");

const account = loadFixture("account-funded", { id: accountId });
const pool = loadFixture("liquidity-pool", { fee_bp: 30 });
```

`loadFixture(name, overrides)` reads the JSON, returns a **deep copy** (so a
test can mutate it safely) and recursively applies `overrides`. Plain objects
are merged; arrays and scalar values are replaced. A missing fixture throws.
