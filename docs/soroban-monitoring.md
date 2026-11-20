# Soroban Contract Monitoring Guide

After you deploy a Soroban contract, someone has to keep watching it. Its TTL runs down, its state changes, it can be upgraded, its callers' transactions can start failing, and the network around it can get busy. This guide shows how to watch each of these signals with StellarKit and how to combine them into a small monitoring dashboard that sends alerts to a webhook.

If you haven't inspected or invoked your contract through StellarKit yet, start with the [Soroban Integration Guide](soroban-integration.md). This guide assumes the contract is already deployed and in use.

---

## Table of Contents

1. [What to monitor](#what-to-monitor)
2. [Prerequisites](#prerequisites)
3. [Signal 1: Expiry (is the contract still alive?)](#signal-1-expiry-is-the-contract-still-alive)
4. [Signal 2: Storage (has its state changed?)](#signal-2-storage-has-its-state-changed)
5. [Signal 3: Functions (has the contract been upgraded?)](#signal-3-functions-has-the-contract-been-upgraded)
6. [Signal 4: Interactions (who is calling it, and is it working?)](#signal-4-interactions-who-is-calling-it-and-is-it-working)
7. [Signal 5: Network context (is it us or the network?)](#signal-5-network-context-is-it-us-or-the-network)
8. [Getting notified with webhooks](#getting-notified-with-webhooks)
9. [Worked example: a monitoring dashboard](#worked-example-a-monitoring-dashboard)
10. [Polling cadence and caching](#polling-cadence-and-caching)
11. [Troubleshooting](#troubleshooting)

---

## What to monitor

| Signal | Endpoint | Question it answers | Alert when |
|---|---|---|---|
| Expiry | `GET /soroban/contract/:id/expiry` | Will the contract instance be archived soon? | Fewer ledgers remain than your warning threshold |
| Storage | `GET /soroban/contract/:id/storage` | What is in instance storage now, and what changed? | An admin, config or paused flag changes unexpectedly |
| Functions | `GET /soroban/contract/:id/functions` | Which functions does the deployed WASM export? | The function list changes, which means the contract was upgraded |
| Interactions | `GET /account/:id/smart-contract-interactions` | Which of your accounts call the contract, what they call, and whether the calls succeed | The failure rate rises |
| Network | `GET /network/soroban-stats` | How busy is Soroban across the whole network? | Use it as context only, not as an alert |

---

## Prerequisites

- A running StellarKit API instance. See [Getting Started](getting-started.md).
- Soroban RPC configured. On testnet this works out of the box. On mainnet you must set `SOROBAN_RPC_URL`. See [Configuration](soroban-integration.md#configuration).
- Node.js 18 or later for the dashboard example, which uses the built-in `fetch`.

```bash
export API="http://localhost:3000"
export CONTRACT="CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2"
# Accounts whose contract activity you want to track: your users, operators, admin keys
export WATCHED_ACCOUNTS="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN,GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
```

---

## Signal 1: Expiry (is the contract still alive?)

Each contract instance has a TTL. When the ledger passes `expiryLedger`, the instance is archived. Every call to it fails until someone submits a `RestoreFootprint` operation. Expiry is the most important signal to monitor because missing it causes an outage.

```bash
curl -sS "$API/soroban/contract/$CONTRACT/expiry" | jq .
```

```json
{
  "success": true,
  "data": {
    "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2",
    "expiryLedger": 51400000,
    "currentLedger": 51320000,
    "ledgersRemaining": 80000,
    "estimatedTimeRemainingSeconds": 400000,
    "isExpiringSoon": false
  }
}
```

**How to alert:**

- `isExpiringSoon` turns `true` when fewer than **10,000 ledgers** remain, which is about 14 hours. That's late if a person has to approve and sign the TTL extension. Set your own, earlier warning threshold. The dashboard below warns at about 7 days (120,960 ledgers).
- Raise a critical alert when `ledgersRemaining` is `0`: the contract has expired.
- `expiryLedger: null` means the entry has no TTL, which is the case for Stellar Asset Contracts. You have nothing to monitor for these.
- When the alert fires, extend the TTL with an `ExtendFootprintTTL` operation. Then call the endpoint again with `?fresh=true` to confirm that `expiryLedger` moved.

This endpoint is cached for 30 seconds (`CACHE_TTL_CONTRACT_EXPIRY_MS`).

---

## Signal 2: Storage (has its state changed?)

Instance storage holds a contract's configuration: admin addresses, fee settings, paused flags and metadata. An unexpected change here is often the first sign of a misconfiguration or a compromised admin key.

```bash
curl -sS "$API/soroban/contract/$CONTRACT/storage?limit=50" | jq .
```

```json
{
  "success": true,
  "data": {
    "entries": [
      { "key": "Admin",  "value": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", "lastModifiedLedger": 51310442, "expiryLedger": 51400000 },
      { "key": "Paused", "value": false, "lastModifiedLedger": 51310442, "expiryLedger": 51400000 }
    ],
    "total": 2
  }
}
```

**How to monitor:**

- Keep the previous snapshot and compare each entry's `value` by `key`. The dashboard below does this. Alert on changes to keys that should rarely change, such as `Admin` or `Paused`.
- A change in `total` means instance storage gained or lost keys.
- `limit` accepts 1–50 (default 50). If `total` is greater than `limit`, you are seeing only part of storage.
- This endpoint returns **instance** storage only. Persistent and temporary entries, such as per-user balances, aren't included.
- Cached for 15 seconds (`CACHE_TTL_CONTRACT_STORAGE_MS`). Add `?fresh=true` straight after your own state-changing transaction.

---

## Signal 3: Functions (has the contract been upgraded?)

The function list is parsed from the WASM that the contract currently runs. It only changes when the contract is upgraded to new WASM, so comparing it against a saved baseline is a cheap way to detect upgrades.

```bash
curl -sS "$API/soroban/contract/$CONTRACT/functions" | jq '[.data.functions[].name]'
```

```json
["transfer", "balance", "approve", "allowance", "mint", "burn"]
```

**How to monitor:**

- Save the function names and signatures, either when you deploy or on the first poll. If a function is added, removed or changes signature, the WASM has changed. Treat that as a warning unless you upgraded the contract yourself.
- Stellar Asset Contracts and WASM without a spec section return an empty `functions` array. That's normal for them, not an error.
- Cached for 60 seconds (`CACHE_TTL_CONTRACT_FUNCTIONS_MS`).

---

## Signal 4: Interactions (who is calling it, and is it working?)

`smart-contract-interactions` lists an **account's** Soroban calls, newest first: which contract it called, which function, when, and whether the call succeeded.

```bash
curl -sS "$API/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/smart-contract-interactions?limit=20" | jq .
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "interactions": [
      {
        "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2",
        "function": "transfer",
        "timestamp": "2026-10-19T09:41:12.000Z",
        "success": true,
        "transactionHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
        "hostFunctionType": "InvokeContract"
      }
    ],
    "total": 1,
    "limit": 20,
    "cursor": "220257022857756673"
  }
}
```

**How to monitor:**

- **This endpoint is per account.** StellarKit has no index of every caller of a contract. To see who interacts with your contract, query the accounts you care about, such as your users, operator keys and admin keys, and keep only the rows whose `contractId` matches your contract.
- Failed transactions are included (`success: false`). A rising failure rate among your callers is an early warning. Common causes are an expired footprint, an underfunded fee, or a bad upgrade.
- An account with no Soroban activity returns an empty `interactions` array. An account that doesn't exist returns `404 AccountNotFound`.
- To page through older calls, pass the returned `cursor` back as `?cursor=`. `cursor` is `null` when the account has no older history.
- `limit` accepts 1–200 (default 20). Each request scans at most 2,000 operations. When it stops before reaching `limit`, it still returns a `cursor` so that you can continue.

---

## Signal 5: Network context (is it us or the network?)

When failures rise or calls slow down, first find out whether only your contract is affected or the whole network. `soroban-stats` summarises Soroban activity across the network over the last 24 hours.

```bash
curl -sS "$API/network/soroban-stats" | jq .
```

```json
{
  "success": true,
  "data": {
    "period": "24h",
    "totalOperations": 2000,
    "sorobanOperations": 412,
    "invocations24h": 388,
    "sorobanOperationPercent": 20.6,
    "sorobanFeeRevenueXLM": "41.2873310",
    "windowCovered": false
  }
}
```

| Field | Meaning |
|---|---|
| `period` | Always `"24h"` |
| `totalOperations` | Operations scanned in the window, failed transactions included |
| `sorobanOperations` | `invoke_host_function`, `extend_footprint_ttl` and `restore_footprint` operations |
| `invocations24h` | `invoke_host_function` operations only, meaning actual contract calls |
| `sorobanOperationPercent` | `sorobanOperations / totalOperations × 100`, to two decimal places. `0` when there is no activity |
| `sorobanFeeRevenueXLM` | Total fees charged on Soroban transactions, as a seven-decimal XLM string |
| `windowCovered` | `false` when the scan budget (2,000 operations) ran out before reaching 24 hours ago |

**About `windowCovered`.** On a busy network, such as mainnet, 2,000 operations cover far less than 24 hours. In that case the counts describe the most recent part of the window, so `windowCovered` is `false`. Read `sorobanOperationPercent` as the current share of activity, not as a 24-hour total. On quiet networks, such as testnet, the scan usually covers the full window.

**How to use it:** don't alert on these numbers. Show them next to your contract's metrics. If your callers' failure rate rises while `sorobanOperationPercent` is also well above its usual level, the cause is probably network congestion and fees, not your contract. Cached for 60 seconds (`CACHE_TTL_SOROBAN_STATS_MS`).

---

## Getting notified with webhooks

StellarKit defines a `contract.event` webhook for events that contracts emit. Its payload is documented in [Webhook Events](webhook-events.md#contractevent):

```json
{
  "event": "contract.event",
  "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2",
  "eventType": "transfer",
  "topic": ["transfer", "GAAZ...", "GBBD..."],
  "value": "1000000000",
  "ledger": 51320011
}
```

> **Current status:** the contract event poller already fetches and normalises events, but **delivery to subscribers is not wired up yet**. `webhookDelivery.deliverContractEvent` is still a stub, so registering for `contract.event` won't send you any requests yet. Build your receiver against the payload above. Until delivery ships, use the polling dashboard below, which sends its own alerts to your webhook URL.

You can register for `contract.event` now. Registration is signed with your admin secret (see [Webhooks: Registration](webhooks.md#registration)):

```bash
BODY='{"url":"https://your-app.example.com/hooks/soroban","events":["contract.event"]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_ADMIN_SECRET" | awk '{print $2}')

curl -sS -X POST "$API/webhooks" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

Registration has no `contractId` filter. When delivery is live, filter on `payload.contractId` in your receiver. Verify every delivery's signature as described in the [Webhook Security Guide](webhook-security.md).

---

## Worked example: a monitoring dashboard

The script below polls all five endpoints, compares each result with the previous poll, and prints a status board. When a check changes level, for example from `ok` to `warn` or back to `ok`, it POSTs an alert to `ALERT_WEBHOOK_URL`. That can be a Slack or Discord incoming webhook, or your own endpoint. It needs Node 18 or later and has no dependencies.

```js
// soroban-monitor.js — run with: node soroban-monitor.js
const API = process.env.API ?? "http://localhost:3000";
const CONTRACT = process.env.CONTRACT;
const WATCHED_ACCOUNTS = (process.env.WATCHED_ACCOUNTS ?? "").split(",").filter(Boolean);
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL; // optional
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 60_000);

const EXPIRY_WARN_LEDGERS = 120_960; // ~7 days at ~5 s per ledger
const FAILURE_RATE_WARN = 0.2;       // warn when >20% of recent calls fail…
const FAILURE_MIN_CALLS = 5;         // …and there are enough calls to judge
const WATCHED_STORAGE_KEYS = new Set(["Admin", "Paused"]);

if (!CONTRACT) {
  console.error("Set CONTRACT to the C... contract ID to monitor.");
  process.exit(1);
}

/** GET a StellarKit endpoint and unwrap the { success, data } envelope. */
async function get(path) {
  const res = await fetch(`${API}${path}`);
  const body = await res.json();
  if (!body.success) {
    throw new Error(`${res.status} ${body.error?.type}: ${body.error?.message}`);
  }
  return body.data;
}

/** Resolve to { data } or { error } so one failing endpoint can't blank the board. */
const settle = (promise) =>
  promise.then((data) => ({ data }), (error) => ({ error: error.message }));

async function collect() {
  const [expiry, storage, functions, network, ...accounts] = await Promise.all([
    settle(get(`/soroban/contract/${CONTRACT}/expiry`)),
    settle(get(`/soroban/contract/${CONTRACT}/storage?limit=50`)),
    settle(get(`/soroban/contract/${CONTRACT}/functions`)),
    settle(get("/network/soroban-stats")),
    ...WATCHED_ACCOUNTS.map((id) =>
      settle(get(`/account/${id}/smart-contract-interactions?limit=50`)),
    ),
  ]);
  return { expiry, storage, functions, network, accounts };
}

const signatureOf = (fn) =>
  `${fn.name}(${fn.params.map((p) => p.type).join(",")})->${fn.returnType}`;

/** Turn one snapshot (plus the previous one) into a list of checks. */
function evaluate(current, previous) {
  const checks = [];
  const check = (id, level, message) => checks.push({ id, level, message });

  // 1. Expiry
  const { data: expiry, error: expiryError } = current.expiry;
  if (expiryError) check("expiry", "critical", expiryError);
  else if (expiry.expiryLedger === null) check("expiry", "ok", "no TTL (e.g. Stellar Asset Contract)");
  else if (expiry.ledgersRemaining === 0) check("expiry", "critical", `EXPIRED at ledger ${expiry.expiryLedger}`);
  else {
    const days = (expiry.estimatedTimeRemainingSeconds / 86_400).toFixed(1);
    const level = expiry.ledgersRemaining < EXPIRY_WARN_LEDGERS ? "warn" : "ok";
    check("expiry", level, `${expiry.ledgersRemaining} ledgers left (~${days} days)`);
  }

  // 2. Storage: compare values key by key with the previous poll
  const { data: storage, error: storageError } = current.storage;
  if (storageError) check("storage", "warn", storageError);
  else {
    const valuesOf = (s) => new Map(s.entries.map((e) => [JSON.stringify(e.key), JSON.stringify(e.value)]));
    const before = previous?.storage.data ? valuesOf(previous.storage.data) : null;
    const now = valuesOf(storage);
    const changed = before
      ? [...new Set([...before.keys(), ...now.keys()])].filter((k) => before.get(k) !== now.get(k))
      : [];
    const sensitive = changed.map((k) => JSON.parse(k)).filter((k) => WATCHED_STORAGE_KEYS.has(k));
    if (sensitive.length) check("storage", "warn", `watched keys changed: ${sensitive.join(", ")}`);
    else check("storage", "ok", `${storage.total} keys${changed.length ? `, ${changed.length} changed` : ""}`);
  }

  // 3. Functions: any signature change means the WASM was upgraded
  const { data: functions, error: functionsError } = current.functions;
  if (functionsError) check("functions", "warn", functionsError);
  else {
    const now = new Set(functions.functions.map(signatureOf));
    const before = previous?.functions.data ? new Set(previous.functions.data.functions.map(signatureOf)) : null;
    const added = before ? [...now].filter((s) => !before.has(s)) : [];
    const removed = before ? [...before].filter((s) => !now.has(s)) : [];
    if (added.length || removed.length) {
      check("functions", "warn", `ABI changed (+${added.length} / -${removed.length}): contract upgraded?`);
    } else {
      check("functions", "ok", `${now.size} functions, unchanged`);
    }
  }

  // 4. Interactions: keep only calls to this contract, then measure failures
  const calls = current.accounts
    .flatMap((a) => a.data?.interactions ?? [])
    .filter((i) => i.contractId === CONTRACT);
  const callers = new Set(
    current.accounts
      .filter((a) => a.data?.interactions.some((i) => i.contractId === CONTRACT))
      .map((a) => a.data.accountId),
  );
  const failed = calls.filter((i) => !i.success).length;
  const failureRate = calls.length ? failed / calls.length : 0;
  const unreachable = current.accounts.filter((a) => a.error).length;
  check(
    "interactions",
    calls.length >= FAILURE_MIN_CALLS && failureRate > FAILURE_RATE_WARN ? "warn" : "ok",
    `${calls.length} recent calls from ${callers.size}/${WATCHED_ACCOUNTS.length} watched accounts, ` +
      `${(failureRate * 100).toFixed(0)}% failed${unreachable ? ` (${unreachable} accounts unreachable)` : ""}`,
  );

  // 5. Network context: informational only
  const { data: network, error: networkError } = current.network;
  check(
    "network",
    "info",
    networkError ??
      `${network.sorobanOperationPercent}% Soroban ops, ${network.invocations24h} invocations, ` +
        `${network.sorobanFeeRevenueXLM} XLM fees${network.windowCovered ? "" : " (partial window)"}`,
  );

  return checks;
}

const ICONS = { ok: "✅", info: "ℹ️ ", warn: "⚠️ ", critical: "🛑" };
const lastLevels = new Map();

/** Alert only when a check changes level, so a stuck warning doesn't spam. */
async function notify(checks) {
  for (const { id, level, message } of checks) {
    const last = lastLevels.get(id);
    lastLevels.set(id, level);
    if (level === "info" || last === level || (last === undefined && level === "ok")) continue;
    if (!ALERT_WEBHOOK_URL) continue;

    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${ICONS[level]} [${CONTRACT.slice(0, 8)}…] ${id}: ${message}`,
        contractId: CONTRACT,
        check: id,
        level,
        previousLevel: last ?? null,
        message,
        at: new Date().toISOString(),
      }),
    }).catch((err) => console.error(`alert delivery failed: ${err.message}`));
  }
}

function render(checks) {
  console.clear();
  console.log(`Soroban monitor — ${CONTRACT}`);
  console.log(`${new Date().toISOString()} · polling every ${INTERVAL_MS / 1000}s\n`);
  for (const { id, level, message } of checks) {
    console.log(`${ICONS[level]} ${id.padEnd(13)} ${message}`);
  }
}

let previous = null;
async function tick() {
  const current = await collect();
  const checks = evaluate(current, previous);
  render(checks);
  await notify(checks);
  previous = current;
}

const runTick = () => tick().catch((err) => console.error(`poll failed: ${err.message}`));
runTick();
setInterval(runTick, INTERVAL_MS);
```

Run it:

```bash
ALERT_WEBHOOK_URL="https://hooks.slack.com/services/T000/B000/XXXX" node soroban-monitor.js
```

Example output:

```text
Soroban monitor — CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2
2026-10-19T09:45:00.000Z · polling every 60s

⚠️  expiry        80000 ledgers left (~4.6 days)
✅ storage       2 keys
✅ functions     6 functions, unchanged
✅ interactions  14 recent calls from 2/2 watched accounts, 7% failed
ℹ️  network       20.6% Soroban ops, 388 invocations, 41.2873310 XLM fees (partial window)
```

Both of the following send exactly one alert, and the recovery to `ok` sends one more:

- The expiry check drops below 7 days.
- Someone changes the `Admin` key.

### Extending the example

- **Store snapshots durably**, for example in a file or a database, so that a restart doesn't reset the storage and ABI baselines. As written, the first poll after a restart never reports a change.
- **Run the TTL extension automatically**: when `expiry` reaches `warn`, build and submit an `ExtendFootprintTTL` transaction with the Stellar SDK, then poll `/expiry?fresh=true` to confirm it worked.
- **Watch more accounts** by loading `WATCHED_ACCOUNTS` from your user database. Keep the [rate limits](rate-limiting.md) in mind: each watched account costs one request per poll.

---

## Polling cadence and caching

Every monitoring endpoint is cached on the server. Polling faster than the TTL returns the same cached data, marked with `X-Cache: HIT`, and counts against your rate limit.

| Endpoint | Server cache TTL | Suggested poll interval |
|---|---|---|
| `/soroban/contract/:id/expiry` | 30 s (`CACHE_TTL_CONTRACT_EXPIRY_MS`) | 5–10 min. TTLs change slowly |
| `/soroban/contract/:id/storage` | 15 s (`CACHE_TTL_CONTRACT_STORAGE_MS`) | 1 min |
| `/soroban/contract/:id/functions` | 60 s (`CACHE_TTL_CONTRACT_FUNCTIONS_MS`) | 10 min. Changes only on upgrade |
| `/account/:id/smart-contract-interactions` | not cached | 1–5 min per watched account |
| `/network/soroban-stats` | 60 s (`CACHE_TTL_SOROBAN_STATS_MS`) | 5 min |

The dashboard uses one interval for every endpoint to keep it simple. In production, run each signal on its own interval. Use `?fresh=true` only straight after your own transactions, when you need to confirm their effect.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `500 ConfigError` on `/soroban/*` | `SOROBAN_RPC_URL` isn't set, which is required on mainnet | Set it in `.env`. See [Configuration](soroban-integration.md#configuration) |
| `404 ContractNotFound` | Wrong contract ID or network, or the instance has been archived | Check `STELLAR_NETWORK`. If the contract was archived, restore it with `RestoreFootprint` |
| `400 ValidationError` on the contract ID | The ID isn't a 56-character `C...` StrKey | Use the contract address, not the WASM hash |
| `404 AccountNotFound` on interactions | A watched account was never funded, or is on another network | Remove it from `WATCHED_ACCOUNTS` |
| Interactions are empty although the contract is busy | None of your watched accounts called it recently | Add the accounts that actually call the contract. This endpoint is per account |
| `windowCovered: false` | The network is busy and the scan budget ran out before 24 hours | Expected on mainnet. Treat the percentage as a current rate |
| `X-Cache: HIT` every time | Polling faster than the TTL | Poll less often, or add `?fresh=true` only when you need live data |

---

**See also:** [Soroban Integration Guide](soroban-integration.md) · [Soroban Endpoints](soroban.md) · [Webhook Events](webhook-events.md) · [Webhook Security](webhook-security.md) · [Monitoring Guide](monitoring.md) · [Rate Limiting](rate-limiting.md)
