# Getting Started for Contributors

Welcome to StellarKit! This guide is for first-time contributors arriving from [Drips Wave](https://www.drips.network/wave/stellar) — especially if you are new to the Stellar ecosystem, new to this codebase, or both.

By the end of this guide you will be able to set up your environment, navigate the codebase, follow StellarKit response conventions, write your first test, and submit a Wave-compliant pull request.

If you are new to Stellar terminology (stroops, trustlines, claimable balances, anchors, liquidity pools), keep the [Glossary](./glossary.md) open in another tab.

---

## 1. Stellar in five minutes

Stellar is a payments blockchain. The concepts you will see most in this repo:

| Concept | What it means for contributors |
|---|---|
| Account (`G...`) | 56-character public key starting with `G`. Every account endpoint takes it as `:id`. |
| Horizon | Stellar's REST API. StellarKit wraps Horizon with Express and `@stellar/stellar-sdk` (`src/config/stellar.js`). |
| Transaction / Operation | A transaction contains 1+ operations (payment, change_trust, manage_sell_offer, …). |
| Asset | Native XLM or `CODE:ISSUER` (for example `USDC:GA5Z...`). See [Response Format](./response-format.md#asset-shape). |
| Stroops | Smallest XLM unit. 1 XLM = 10,000,000 stroops. Fees are often shown in both. |
| Trustline | Opt-in to hold an issued asset. Missing trustlines cause `TrustlineNotFound`. |
| SEP | Stellar Ecosystem Proposal (SEP-10 auth, SEP-24 deposits, SEP-31 payments). See [SEP Integration](./sep-integration.md). |

You do not need to understand Soroban, liquidity pools, or multisig to make your first contribution — pick an issue that touches one area at a time.

---

## 2. Codebase structure orientation

```
src/index.js          — Express app entry point, route mounting
src/config/           — Stellar network + cache TTL configuration
src/routes/           — Express route handlers (21 files)
src/services/         — cache, metrics, webhook delivery, contract events
src/utils/            — shared helpers (response, validators, formatting)
src/middleware/       — auth, validation, rate limiting, logging (17 files)
tests/                — 170+ Jest + Supertest files (root, integration/, routes/, …)
types/index.d.ts      — bundled TypeScript definitions
sdk/                  — TypeScript SDK client
docs/                 — guides like this one
examples/             — runnable demo scripts
scripts/              — developer utilities (e.g. testnet seeding)
```

### Where to look first

| I want to… | Start here |
|---|---|
| Add or fix an account endpoint | `src/routes/account.js` (largest), `src/routes/accounts.js` (batch) |
| Add a DEX / asset / Soroban endpoint | `src/routes/dex.js`, `src/routes/asset.js`, `src/routes/soroban.js` |
| Change response shape | `src/utils/response.js` (`success()` helper) + [Response Format](./response-format.md) |
| Add validation | `src/utils/validators.js` |
| Add error handling | `src/utils/StellarKitError.js`, `src/middleware/errorHandler.js` |
| Understand middleware order | [Project Structure](./project-structure.md) |
| Understand API conventions | [API Design](./api-design.md), [Response Format](./response-format.md) |

All routes import the shared Horizon `server` from `src/config/stellar.js` — never create a second SDK instance.

Key conventions:

- `async/await` only — no raw promise chains.
- All routes use `next(err)` for errors.
- Wrap data with `success(res, data, meta)` from `src/utils/response.js`.
- Validate inputs with helpers from `src/utils/validators.js`.
- Amounts are seven-decimal strings (`"100.0000000"`). Timestamps are ISO 8601 UTC.

---

## 3. Environment setup

### Prerequisites

- Node.js >= 18, npm >= 9 (`node --version`, `npm --version`)
- Git with LF line endings: `git config core.autocrlf false`
- An editor that respects `.editorconfig` (2-space indent, LF, final newline, UTF-8)

### Setup

```bash
git clone https://github.com/stellarkit-lab-devtools/stellarkit-api.git
cd stellarkit-api
npm install
cp .env.example .env
npm run dev
```

Open `.env` and review:

```env
STELLAR_NETWORK=testnet
PORT=3000
```

- Use `testnet` for development (free, Friendbot-funded). Set `STELLAR_NETWORK=mainnet` explicitly before any production deploy.
- No `.env` is needed to run tests — the suite mocks Horizon in-process.

Verify with:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/summary
```

For full setup and first API calls, see [Getting Started](./getting-started.md).

---

## 4. Finding a good first issue

1. Open the [Issues tab](../../issues) and look for the **`Stellar Wave`** label. That label means the issue is in the active Wave, carries point rewards, and must follow Wave rules.
2. **Apply via Drips Wave before starting** — see [drips.network/wave/stellar](https://www.drips.network/wave/stellar).
3. Your PR must be **merged before the current Wave ends** for points to count.
4. Leave a comment on the issue or apply via Drips so maintainers know you are working on it.

Good first issues are usually docs, error-message, validation, or single-endpoint fixes. Ask in [Discussions](../../discussions) or the [Stellar Discord](https://discord.gg/stellardev) if an issue description is unclear.

---

## 5. Response conventions you must follow

Every endpoint uses the standard envelope:

```json
{
  "success": true,
  "data": { "accountId": "GAAZI4..." }
}
```

```json
{
  "success": false,
  "error": {
    "type": "AccountNotFound",
    "message": "Account GAAZI4... was not found on the Stellar testnet network.",
    "suggestion": "Verify the account address is correct and that the account has been funded."
  }
}
```

Rules:

- Success: `{ "success": true, "data": ... }` plus optional `meta` for pagination.
- Errors: `{ "success": false, "error": { "type", "message" } }`. Use existing types (`InvalidAccountId`, `AccountNotFound`, `TrustlineNotFound`, `ValidationError`, `HorizonTimeout`). See [Error Reference](./error-reference.md).
- Pagination: `limit` (default 20, max 200), `order` (`asc`/`desc`), `cursor`. Return `meta: { count, limit, order, nextCursor, hasMore }`.
- Assets: `{ "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" }`; native XLM uses `{ "code": "XLM", "issuer": null, "type": "native" }`.
- Amounts: strings with seven decimals. Timestamps: ISO 8601 UTC.

Full reference: [Response Format](./response-format.md) and [API Design](./api-design.md).

---

## 6. Writing your first test

Tests use Jest + Supertest with mocked Horizon — no live network needed.

### Run tests

```bash
npm test                                              # full suite with coverage
npx jest account.balances --verbose --runInBand       # one file
npx jest feeEstimate -t "includes new fields"         # one named test
```

### Naming and location

`tests/subject.qualifier.test.js` — for example `tests/account.balances.test.js`, `tests/feeEstimate.surgeStatus.test.js`. One file covers one route, utility, or behaviour slice.

### Pattern to copy

Most route tests use module-scope mocking (see [Testing Guide](./testing.md)):

```javascript
const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

const VALID_ID = Keypair.random().publicKey();
const HORIZON_404 = { response: { status: 404 } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /account/:id/balances", () => {
  it("returns balances for a funded account", async () => {
    server.loadAccount.mockResolvedValue({
      account_id: VALID_ID,
      balances: [{ asset_type: "native", balance: "100.0000000" }],
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      signers: [{ key: VALID_ID, weight: 1, type: "ed25519_public_key" }],
    });

    const res = await request(app).get(`/account/${VALID_ID}/balances`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("data");
  });

  it("returns 404 AccountNotFound for unknown accounts", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);

    const res = await request(app).get(`/account/${VALID_ID}/balances`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns 400 for malformed account IDs", async () => {
    const res = await request(app).get("/account/not-a-valid-key/balances");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
```

Checklist for a new test:

- Happy path + at least one error path (404 and/or 400).
- Assert the envelope (`success`, `data` or `error.type`).
- Mock chained Horizon builders (`.forAccount().limit().order().call()`) when testing paginated endpoints — see [Testing Guide](./testing.md#mocking-chained-horizon-builder-calls).
- Aim for the PR coverage expectation: statements/functions/lines >= 80%, branches >= 75%.

---

## 7. Submitting a PR

1. **Branch:** `git checkout -b feat/short-description` or `fix/short-description`.
2. **Code:** follow existing patterns (`async/await`, `next(err)`, `success()` helper, validators). If adding middleware, routes, or utilities, follow [Project Structure](./project-structure.md).
3. **Lint:** `npm run lint` (fix with `npm run lint:fix`). Expect zero errors.
4. **Test:** `npm test` passes; add tests for new functionality.
5. **Push and open a PR** with a clear title and description referencing the issue: `Closes #123`.

### PR checklist (from CONTRIBUTING.md)

- [ ] `npm test` passes
- [ ] New functionality has tests
- [ ] Code follows existing patterns (async/await, centralised error handling)
- [ ] New middleware/routes/utilities follow [Project Structure](./project-structure.md)
- [ ] PR description explains what changed and why
- [ ] Issue number is referenced (`Closes #...`)

### Wave rules

- You must have applied via Drips Wave before starting.
- PR must be merged before the Wave ends.
- Reference the Wave issue so points are attributed.

### What not to commit

Never include test output files (`*-output.txt`), implementation summaries (`IMPLEMENTATION_SUMMARY.md`), ad-hoc scripts (`verify-*.js`), PR notes (`PR_*.md`), or local logs (`*.log`). Release notes go in `CHANGELOG.md`; reusable helpers go in `scripts/`.

---

## Contributor checklist (copy into your notes)

- [ ] Read the Wave issue and apply via Drips Wave
- [ ] Clone, `npm install`, copy `.env.example` to `.env`, `npm run dev`
- [ ] Read [Project Structure](./project-structure.md), [Response Format](./response-format.md), [Testing](./testing.md)
- [ ] Reproduce or understand the issue locally
- [ ] Create a branch (`feat/...` or `fix/...`)
- [ ] Implement following existing patterns
- [ ] Add or update tests (happy path + error path)
- [ ] Run `npm test` and `npm run lint`
- [ ] Open a PR with `Closes #...` and a clear description
- [ ] Respond to review feedback until merged

---

## Related documentation

- [Contributing](../CONTRIBUTING.md) — Wave rules, PR checklist, code style
- [Getting Started](./getting-started.md) — setup and first API calls
- [Project Structure](./project-structure.md) — where new code goes
- [Testing](./testing.md) — suite structure, mocking, coverage
- [Response Format](./response-format.md) — envelopes, pagination, assets
- [Glossary](./glossary.md) — Stellar terminology
