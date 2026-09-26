# DEX Endpoints Guide

The Stellar DEX (Decentralized Exchange) is built directly into the Stellar ledger. Every asset pair can be traded without a central operator — participants post offers on-chain and the protocol matches them. StellarKit exposes six endpoints that cover the full lifecycle of DEX analysis: pricing, order-book structure, market pressure, arbitrage detection, top markets by volume, and historical price data.

---

## Asset Format

All DEX path-parameter assets use `CODE:ISSUER` notation. For native XLM use `XLM:native`.

```
XLM:native
USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
yXLM:GARDNV3Q7YGH5JEKUJE2QG7MEMBZA47GYUYFQ6EVJYY3YKGU6EBQABE
```

Asset codes are case-insensitive (`xlm:native` and `XLM:native` both work).

---

## Endpoint Reference

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/dex/price/:sellAsset/:buyAsset` | Effective exchange rate via best DEX path |
| GET | `/dex/spread/:sellAsset/:buyAsset` | Bid-ask spread and order-book depth summary |
| GET | `/dex/depth/:sellAsset/:buyAsset` | Full order-book depth analysis |
| GET | `/dex/imbalance/:sellAsset/:buyAsset` | Buy/sell pressure imbalance detection |
| GET | `/dex/arbitrage/:assetCode/:assetIssuer` | Circular arbitrage path discovery |
| GET | `/dex/top-markets` | Top markets ranked by recent trade activity |

---

## 1. `GET /dex/price/:sellAsset/:buyAsset`

Returns the effective exchange rate between two assets using Stellar's strict-send path-finding. Unlike a simple order-book quote, this walks every available conversion route (including multi-hop paths through intermediate assets) and returns the one that maximises the destination amount for the requested sell amount.

**When to use:** You want to know "how much USDC do I receive if I sell 100 XLM right now?" This is the right starting point before submitting a path-payment operation.

**Query params:**

| Param | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `amount` | number | `1` | Amount of `sellAsset` to convert |

**curl example:**

```bash
curl "http://localhost:3000/dex/price/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN?amount=100"
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "sellAsset": "XLM:native",
    "buyAsset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "sellAmount": "100.0000000",
    "buyAmount": "12.8750000",
    "effectiveRate": "0.1287500",
    "bestPath": []
  }
}
```

`bestPath` lists the intermediate assets used in the conversion. An empty array means the trade settled directly on the XLM/USDC order book.

---

## 2. `GET /dex/spread/:sellAsset/:buyAsset`

Returns the bid-ask spread for a trading pair. **Spread** is the gap between the highest buy offer (bid) and the lowest sell offer (ask). A narrow spread signals a liquid, competitive market; a wide spread means fewer participants and potentially worse execution.

**When to use:** Display live market data on a trading dashboard, or check whether market conditions are tight enough before placing a limit order.

**Difference from `/dex/depth`:** `spread` focuses on the *best* price on each side and derives a single spread metric. `depth` gives you the full count of orders and cumulative volume at every price level — useful for understanding how large a trade the book can absorb.

**curl example:**

```bash
curl "http://localhost:3000/dex/spread/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "bestBid": {
      "price": "0.1284000",
      "amount": "4200.0000000"
    },
    "bestAsk": {
      "price": "0.1291000",
      "amount": "3800.0000000"
    },
    "spreadAbsolute": "0.0007000",
    "spreadPercent": "0.5438",
    "midPrice": "0.1287500",
    "liquidity": "high",
    "orderBookDepth": {
      "bids": 37,
      "asks": 41,
      "totalBidVolume": "182400.0000000",
      "totalAskVolume": "154000.0000000",
      "totalVolume": "336400.0000000"
    }
  }
}
```

**Liquidity labels:**

| Label | Condition |
| ----- | --------- |
| `high` | Total order-book volume ≥ 10 000 |
| `medium` | Total volume ≥ 1 000 |
| `low` | Total volume < 1 000 |

---

## 3. `GET /dex/depth/:sellAsset/:buyAsset`

Returns a structural analysis of the order book: total bid and ask counts, cumulative volumes on each side, and the top 5 price levels for each side. Also computes a `depthRating` that summarises how much liquidity the book can absorb.

**When to use:** You are placing a large trade and need to know whether the order book is deep enough to fill your order without significant price impact. Also useful for building order-book visualisation components (depth charts).

**Difference from `/dex/spread`:** `depth` shows how *thick* the book is across all levels. `spread` tells you only the best price on each side and whether the gap between them is tight.

**curl example:**

```bash
curl "http://localhost:3000/dex/depth/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "bidsCount": 64,
    "asksCount": 59,
    "totalBidVolume": "72450.1200000",
    "totalAskVolume": "69110.0000000",
    "top5Bids": [
      { "price": "0.1284000", "amount": "4200.0000000" },
      { "price": "0.1280000", "amount": "3100.0000000" },
      { "price": "0.1275000", "amount": "2800.0000000" },
      { "price": "0.1270000", "amount": "5000.0000000" },
      { "price": "0.1265000", "amount": "1900.0000000" }
    ],
    "top5Asks": [
      { "price": "0.1291000", "amount": "3800.0000000" },
      { "price": "0.1295000", "amount": "2200.0000000" },
      { "price": "0.1300000", "amount": "4100.0000000" },
      { "price": "0.1310000", "amount": "1500.0000000" },
      { "price": "0.1320000", "amount": "3300.0000000" }
    ],
    "depthRating": "moderate"
  }
}
```

**Depth rating thresholds:**

| Rating | Total volume |
| ------ | ------------ |
| `deep` | ≥ 50 000 |
| `moderate` | ≥ 5 000 |
| `shallow` | < 5 000 |

---

## 4. `GET /dex/imbalance/:sellAsset/:buyAsset`

Measures buy-versus-sell pressure by comparing the total aggregate volume on the bid side against the ask side. Returns an `imbalanceRatio` (bids ÷ asks) and a human-readable `pressure` signal.

**When to use:** You want to understand current market sentiment for a pair — whether buyers or sellers are dominant — before timing an entry or exit. Useful for building market-pressure indicators in trading dashboards.

**Difference from `/dex/spread`:** `imbalance` tells you *who is winning* the supply/demand battle across the entire book. `spread` tells you the *price gap* between the best offers. A market can have a tight spread but still show heavy sell pressure — these signals complement each other.

**curl example:**

```bash
curl "http://localhost:3000/dex/imbalance/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "bidVolume": "182400.0000000",
    "askVolume": "118000.0000000",
    "imbalanceRatio": "1.5458",
    "pressure": "buy",
    "signal": "Strong buy pressure detected. Demand significantly outweighs supply."
  }
}
```

**Pressure thresholds:**

| Pressure | Condition |
| -------- | --------- |
| `buy` | `imbalanceRatio` > 1.25 (more bid volume than ask) |
| `sell` | `imbalanceRatio` < 0.75 (more ask volume than bid) |
| `neutral` | Between 0.75 and 1.25 |

---

## 5. `GET /dex/arbitrage/:assetCode/:assetIssuer`

Uses Horizon's strict-receive path-finding to discover circular conversion routes that start and end with the same asset. A path is flagged as `isProfitable` when the source amount required is less than the destination amount received — meaning a round-trip swap would yield more of the asset than it started with.

**When to use:** Identify price inefficiencies across the DEX. Each returned path shows which intermediate assets are involved and whether the loop is currently profitable at the 10-unit destination amount used as the probe.

**Difference from `/dex/imbalance` and `/dex/spread`:** `arbitrage` is about *circular* multi-hop opportunities — "can I swap asset A → B → A and end up with more A?" `imbalance` and `spread` describe one-directional market conditions within a single pair.

**Path parameter:** `:assetCode` and `:assetIssuer` identify the asset to probe. Use `XLM` / `native` for native XLM.

**curl example:**

```bash
curl "http://localhost:3000/dex/arbitrage/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "pathsFound": true,
    "paths": [
      {
        "sourceAmount": "9.9200000",
        "destinationAmount": "10.0000000",
        "path": [
          {
            "code": "XLM",
            "issuer": null,
            "type": "native"
          },
          {
            "code": "yXLM",
            "issuer": "GARDNV3Q7YGH5JEKUJE2QG7MEMBZA47GYUYFQ6EVJYY3YKGU6EBQABE",
            "type": "credit_alphanum4"
          }
        ],
        "isProfitable": true
      }
    ]
  }
}
```

When `pathsFound` is `false`, the paths array is empty and no circular routes currently exist for the asset.

---

## 6. `GET /dex/top-markets`

Returns the most active Stellar DEX trading pairs, ranked by base-asset volume derived from the most recent 200 trades. Each entry is enriched with a live bid-ask spread from the current order book.

**When to use:** Build a market overview page showing where DEX liquidity is concentrated, or identify which pairs to monitor for trading signals.

**Query params:**

| Param | Type | Default | Max |
| ----- | ---- | ------- | --- |
| `limit` | integer | `10` | `50` |

**curl example:**

```bash
curl "http://localhost:3000/dex/top-markets?limit=5"
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "markets": [
      {
        "baseAsset": { "code": "XLM", "issuer": null, "type": "native" },
        "counterAsset": {
          "code": "USDC",
          "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          "type": "credit_alphanum4"
        },
        "baseVolume": "540210.0000000",
        "counterVolume": "69527.0000000",
        "tradeCount": 84,
        "spread": "0.0007000"
      },
      {
        "baseAsset": { "code": "XLM", "issuer": null, "type": "native" },
        "counterAsset": {
          "code": "yXLM",
          "issuer": "GARDNV3Q7YGH5JEKUJE2QG7MEMBZA47GYUYFQ6EVJYY3YKGU6EBQABE",
          "type": "credit_alphanum4"
        },
        "baseVolume": "210000.0000000",
        "counterVolume": "210150.0000000",
        "tradeCount": 31,
        "spread": "0.0001200"
      }
    ],
    "total": 2
  }
}
```

`spread` is `null` when the order book for a pair has no active orders at query time.

---

## How the Endpoints Relate

```
                      ┌─────────────────────┐
                      │  /dex/top-markets   │  ← Start here: discover active pairs
                      └──────────┬──────────┘
                                 │ pick a pair
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
   /dex/spread              /dex/depth        /dex/imbalance
  (best bid/ask,           (full book        (buy vs sell
   gap & liquidity)         structure)        pressure)
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 │ decide to trade
              ┌──────────────────┴──────────────────┐
              ▼                                     ▼
         /dex/price                        /dex/arbitrage
    (actual rate for                   (circular paths for
     a specific amount)                 the same asset)
```

### Choosing the right endpoint

| Goal | Endpoint |
| ---- | -------- |
| Know the current exchange rate for a trade | `/dex/price` |
| Check how tight the market is right now | `/dex/spread` |
| Assess whether the book can absorb a large order | `/dex/depth` |
| Gauge market sentiment (buyers vs sellers) | `/dex/imbalance` |
| Spot circular profit opportunities | `/dex/arbitrage` |
| Find the most active pairs to monitor | `/dex/top-markets` |

---

## Error Responses

All DEX endpoints return a consistent error envelope.

**400 — Invalid asset format:**

```json
{
  "success": false,
  "error": {
    "type": "ValidationError",
    "message": "Invalid asset format: \"XLMNATIVE\". Expected format: CODE:ISSUER"
  }
}
```

**404 — No active order book:**

```json
{
  "success": false,
  "error": {
    "type": "OrderBookEmpty",
    "message": "No active order book found for XLM/FAKETOKEN."
  }
}
```
