# Handling Stellar Amounts Without Losing Precision

Stellar amounts are exact base-10 quantities, not measurements. This guide explains how StellarKit API represents them and how to handle them safely in JavaScript, Python and Go.

## Stroops and the int64 range

The stroop is the smallest unit of XLM:

- `1 XLM = 10,000,000 stroops` (`1 stroop = 0.0000001 XLM`)
- Amounts are stored on the Stellar ledger as signed **64-bit integers** (`int64`) of stroops.
- The signed int64 range is `-9,223,372,036,854,775,808` to `9,223,372,036,854,775,807` stroops, i.e. `-922,337,203,685.4775808` to `922,337,203,685.4775807` XLM.
- Asset balances, offers, fees and reserves are always exact multiples of one stroop; an amount never has more than 7 fractional digits.

## Why amounts are strings (and not JSON numbers)

JSON numbers are IEEE-754 doubles. A double has only 53 bits of integer precision, so the largest integer it can represent *exactly* is `2^53 - 1 = 9,007,199,254,740,991` stroops (`900,719,925.4740991` XLM). The boundary is `2^53 = 9,007,199,254,740,992` stroops (`900,719,925.4740992` XLM): every integer stroop value above that boundary is rounded to an even number when parsed into a JS `number` (and most other languages' doubles behave the same way). Stellar's int64 range is far larger, so a numeric amount can silently change value and break balance or fee calculations. Decimal fractions such as `0.1` also have no exact binary representation, which introduces drift during arithmetic.

StellarKit therefore serializes amounts as **strings** such as `"100.2500000"`, preserving all seven decimals and the exact stroop count. Parse them into an integer/decimal type, not a float.

**Never compare amount strings lexicographically.** `"9" > "10"` and `"10000000" < "900000"` are true as strings but false as numbers. Convert to a numeric exact type first (or compare equal-width formatted strings only when both are known to be canonical, non-negative seven-decimal strings).

## Safe handling by language

### JavaScript / TypeScript (BigInt or a decimal library)

Convert a seven-decimal string to stroops with string manipulation so no float is involved:

```js
function xlmToStroops(amount) {
  const match = /^(-?)(\d+)(?:\.(\d{1,7}))?$/.exec(amount.trim());
  if (!match) throw new Error("Invalid XLM amount");
  const [, sign, whole, fraction = ""] = match;
  const stroops = BigInt(whole) * 10000000n + BigInt(fraction.padEnd(7, "0"));
  return sign === "-" ? -stroops : stroops;
}

const a = xlmToStroops("900719925.4740992"); // 9007199254740992n (exact)
const b = xlmToStroops("0.1");                 // 1000000n
console.log(a > b);                            // true
```

For decimal arithmetic, use a decimal library such as `decimal.js` (`new Decimal("0.1").plus("0.2").toString() === "0.3"`). `Number`, `parseFloat` and `parseInt` are not safe for amounts.

### Python (Decimal)

```python
from decimal import Decimal

a = Decimal("900719925.4740992")
b = Decimal("0.1")
print(a > b)                       # True
print(b + Decimal("0.2"))           # 0.3 (exact)
stroops = int(b * 10_000_000)       # 1000000
```

Never call `float()` on an amount string; use `Decimal(str_value)` (the string constructor).

### Go (math/big)

```go
package main

import (
    "fmt"
    "math/big"
)

func main() {
    a, _, _ := big.ParseFloat("900719925.4740992", 10, 256, big.ToNearestEven)
    b, _, _ := big.ParseFloat("0.1", 10, 256, big.ToNearestEven)
    fmt.Println(a.Cmp(b) > 0) // true
    // For exact stroops prefer big.Int with strconv.ParseInt(s, 10, 64)
    // on an integer string, or big.Rat for exact decimals.
}
```

Use `big.Int` for integer stroops (or `strconv.ParseInt` when you know the value fits int64) and `big.Rat`/`big.Float` for decimal arithmetic. Never `strconv.ParseFloat` an amount.

## Rounding behaviour actually implemented by this API

The behaviour below was verified by running the helpers in `src/utils/formatAmount.js` and `src/utils/parseStellarAmount.js` against the current source.

- `formatAmount()` formats a decimal string to exactly seven fractional digits, padding with trailing zeros. It rounds **half-up based on the eighth fractional digit only**: `"1.00000005" -> "1.0000001"`, `"1.00000004" -> "1.0000000"`, `"1.23456789" -> "1.2345679"`, `"0.00000009" -> "0.0000001"`.
- Digits beyond the eighth are ignored rather than treated as a full decimal remainder (e.g. `"1.0000000499" -> "1.0000000"`).
- Negative zero is normalized: `"-0.00000001" -> "0.0000000"`. Existing leading zeros in the whole part are preserved (`"0001.2" -> "0001.2000000"`) — compare numerically, not lexicographically.
- `parseStellarAmount()` (used for stroop-to-XLM equivalents) divides by `10,000,000` and applies `toFixed(7)`: `100 -> "0.0000100"`, `"1000000" -> "0.1000000"`, `10000000 -> "1.0000000"`, `-100 -> "-0.0000100"`. Because it converts the input through a JS number first, callers should not pass stroop values beyond `Number.MAX_SAFE_INTEGER`.
- `GET /utils/convert` does its conversion with `BigInt` and rejects values above `Number.MAX_SAFE_INTEGER` with a `ValidationError`, so it never silently emits a rounded stroop count.

## Which fields are amount strings?

Amount strings are marked **string**; integers/counts/flags are **number** (or boolean). All examples are the `data` payload of a successful response.

| Response | Amount fields (seven-decimal strings) | Plain number / boolean fields |
| --- | --- | --- |
| `GET /account/:id/balances` | `xlm.balance`, `xlm.buyingLiabilities`, `xlm.sellingLiabilities`, each asset's `balance`, `limit`, `buyingLiabilities`, `sellingLiabilities` | `assets[].isAuthorized`, `assets[].isClawbackEnabled` |
| `GET /fee-estimate` | `perOperation.*.xlm`, `totalFee.*.xlm` | `perOperation.*.stroops`, `totalFee.*.stroops`, `operationCount`, `networkStats.lastLedgerBaseFee`, `lastLedger`, `ledgerCapacityUsage` |
| `GET /transactions/:id` | transaction `fee` (a stroop string), operation `amount` where present | `ledger`, `successful`, `operationCount`, pagination counts/limits |
| `GET /dex/offer-book/:sellAsset/:buyAsset` (order-book entries) | `amount`, `amountString`, `price`, `priceString`, `value` | `offers[].id` (string identifier), `lastModifiedLedgerSeq` (number), bid/ask counts |
| `GET /network/fee-percentiles` | `percentiles.p10..p99.*.xlm`, `baseFee.xlm`, `minFee.xlm`, `maxFee.xlm` | `percentiles.p10..p99.*.stroops`, `baseFee.stroops`, `minFee.stroops`, `maxFee.stroops`, `ledgerSequence` |

Identifiers such as account IDs, transaction hashes, sequences and cursors are strings too, but they are not amounts: never convert them to numbers.

## Converting with `GET /utils/convert`

The endpoint is purely local (no Horizon call) and works in one direction at a time:

```sh
curl 'http://localhost:3000/utils/convert?xlm=1.2345678'
# {"success":true,"data":{"xlm":"1.2345678","stroops":12345678}}

curl 'http://localhost:3000/utils/convert?stroops=12345678'
# {"success":true,"data":{"xlm":"1.2345678","stroops":12345678}}
```

Workflow:

1. Accept the amount as a **string** from your input/UI; validate it with `/^\d+(\.\d{1,7})?$/`.
2. Call `/utils/convert?xlm=<string>` and read `data.stroops` for fee/amount arithmetic (as `BigInt` in JS).
3. To display a stroop count, call `/utils/convert?stroops=<integer string>` and show `data.xlm` verbatim — do not reformat it with a float.
4. Passing both `xlm` and `stroops`, a negative value, more than 7 fractional digits, or a value above the safe integer range returns HTTP 400 `ValidationError`.

Because both directions reject values above `Number.MAX_SAFE_INTEGER` stroops, use the client-side `BigInt`/`Decimal`/`big.Int` recipes above for values near the full int64 range.
