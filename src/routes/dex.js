const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { Asset } = require("@stellar/stellar-sdk");
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAssetCode, validateAccountId, validateAsset, validateLimit } = require("../utils/validators");
const { parseStellarAsset, normalizeAsset } = require("../utils/asset");
const { isNativeAsset } = require("../utils/assetHelpers");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");

/**
 * @route GET /dex/arbitrage/:assetCode/:assetIssuer
 * @desc Finds circular strict-receive paths that start and end in the same asset and flags potentially profitable loops.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.assetCode - Asset code to evaluate (for example `FUSD`, `XLM`).
 * @param {string} req.params.assetIssuer - Issuer public key for credit assets, or `native` when `assetCode` is `XLM`.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload containing `pathsFound` and a normalized list of arbitrage path candidates.
 * @example
 * curl -s "http://localhost:3000/dex/arbitrage/FUSD/GBFUSDFICTIONALISSUERKEY000000000000000000000000000000" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "pathsFound": true,
 * //     "paths": [
 * //       {
 * //         "sourceAmount": "9.9200000",
 * //         "destinationAmount": "10.0000000",
 * //         "path": [
 * //           { "assetCode": "NOVA", "assetIssuer": "GBNOVAISSUERFICTIONALKEY0000000000000000000000000000", "assetType": "credit_alphanum4" },
 * //           { "assetCode": "XLM", "assetIssuer": "native", "assetType": "native" }
 * //         ],
 * //         "isProfitable": true
 * //       }
 * //     ]
 * //   }
 * // }
 */
router.get("/arbitrage/:assetCode/:assetIssuer", async (req, res, next) => {
  try {
    const { assetCode, assetIssuer } = req.params;

    // Validate asset code and issuer (if not native)
    if (assetCode.toUpperCase() !== "XLM" || assetIssuer.toLowerCase() !== "native") {
      // Validate inputs using shared validators
      validateAsset(assetCode, assetIssuer);
    }

    // Cache: arbitrage data changes rapidly with market conditions.
    // A fixed key covers all pairs per asset; TTL defaults to 5 s and is
    // configurable via CACHE_TTL_ARBITRAGE_MS.
    const ARBITRAGE_CACHE_KEY = `dex:arbitrage:${assetCode.toUpperCase()}:${assetIssuer}`;
    const fresh = req.query.fresh === "true";

    if (!fresh) {
      const cached = cacheService.get(ARBITRAGE_CACHE_KEY);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const assetIdentifier = { code: assetCode.toUpperCase(), issuer: assetIssuer.toLowerCase() };
    const asset = (isNativeAsset(assetIdentifier) || (assetCode.toUpperCase() === "XLM" && assetIssuer.toLowerCase() === "native"))
      ? Asset.native()
      : new Asset(assetCode.toUpperCase(), assetIssuer);

    const destinationAmount = "10.0000000";

    const pathsResponse = await server
      .strictReceivePaths([asset], asset, destinationAmount)
      .call();

    const paths = (pathsResponse.records || [])
      .map((path) => ({
        sourceAmount: path.source_amount,
        destinationAmount: path.destination_amount,
        path: path.path.map((hop) =>
          normalizeAsset(hop.asset_code, hop.asset_issuer, hop.asset_type),
        ),
        isProfitable: parseFloat(path.source_amount) < parseFloat(path.destination_amount),
      }))
      .filter((p) => p.path.length > 0);

    const data = {
      pathsFound: paths.length > 0,
      paths: paths,
    };

    cacheService.set(ARBITRAGE_CACHE_KEY, data, cacheTTL.arbitrage);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * @route GET /dex/spread/:sellAsset/:buyAsset
 * @desc Computes best bid/ask, spread metrics, liquidity band, and depth totals for a Stellar DEX trading pair.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.sellAsset - Asset being sold in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} req.params.buyAsset - Asset being bought in `CODE:ISSUER` format or `XLM:native`.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload with `bestBid`, `bestAsk`, `spreadAbsolute`, `spreadPercent`, `midPrice`, and `orderBookDepth`.
 * @example
 * curl -s "http://localhost:3000/dex/spread/XLM:native/NOVA:GBNOVAISSUERFICTIONALKEY0000000000000000000000000000" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "bestBid": { "price": "0.1284000", "amount": "4200.0000000" },
 * //     "bestAsk": { "price": "0.1291000", "amount": "3800.0000000" },
 * //     "spreadAbsolute": "0.0007000",
 * //     "spreadPercent": "0.5438",
 * //     "midPrice": "0.1287500",
 * //     "liquidity": "medium",
 * //     "orderBookDepth": { "bids": 37, "asks": 41, "totalVolume": "12540.0000000" }
 * //   }
 * // }
 */
router.get("/spread/:sellAsset/:buyAsset", async (req, res, next) => {
  try {
    const { sellAsset, buyAsset } = req.params;

    let selling, buying;
    try {
      selling = parseStellarAsset(sellAsset);
      buying = parseStellarAsset(buyAsset);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: err.message,
        },
      });
    }

    const orderBookResponse = await server
      .orderbook(selling, buying)
      .limit(200)
      .call();

    const bids = orderBookResponse.bids || [];
    const asks = orderBookResponse.asks || [];

    if (bids.length === 0 && asks.length === 0) {
      return res.status(404).json({
        success: false,
        error: makeOrderBookEmptyError(selling.getCode(), buying.getCode()),
      });
    }

    const bestBid = bids.length > 0 ? {
      price: parseFloat(bids[0].price),
      amount: parseFloat(bids[0].amount),
    } : null;

    const bestAsk = asks.length > 0 ? {
      price: parseFloat(asks[0].price),
      amount: parseFloat(asks[0].amount),
    } : null;

    let spreadAbsolute = null;
    let spreadPercent = null;
    let midPrice = null;

    if (bestBid && bestAsk) {
      spreadAbsolute = bestAsk.price - bestBid.price;
      midPrice = (bestBid.price + bestAsk.price) / 2;
      spreadPercent = (spreadAbsolute / midPrice) * 100;
    } else if (bestBid) {
      midPrice = bestBid.price;
    } else if (bestAsk) {
      midPrice = bestAsk.price;
    }

    const totalBidVolume = bids.reduce((sum, bid) => sum + parseFloat(bid.amount), 0);
    const totalAskVolume = asks.reduce((sum, ask) => sum + parseFloat(ask.amount), 0);
    const totalVolume = totalBidVolume + totalAskVolume;

    let liquidity;
    if (totalVolume >= 10000) {
      liquidity = "high";
    } else if (totalVolume >= 1000) {
      liquidity = "medium";
    } else {
      liquidity = "low";
    }

    return success(res, {
      bestBid: bestBid ? {
        price: bestBid.price.toFixed(7),
        amount: bestBid.amount.toFixed(7),
      } : null,
      bestAsk: bestAsk ? {
        price: bestAsk.price.toFixed(7),
        amount: bestAsk.amount.toFixed(7),
      } : null,
      spreadAbsolute: spreadAbsolute !== null ? spreadAbsolute.toFixed(7) : null,
      spreadPercent: spreadPercent !== null ? spreadPercent.toFixed(4) : null,
      midPrice: midPrice !== null ? midPrice.toFixed(7) : null,
      liquidity,
      orderBookDepth: {
        bids: bids.length,
        asks: asks.length,
        totalBidVolume: totalBidVolume.toFixed(7),
        totalAskVolume: totalAskVolume.toFixed(7),
        totalVolume: totalVolume.toFixed(7),
      },
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: makeOrderBookEmptyError(req.params.sellAsset, req.params.buyAsset),
      });
    }
    next(err);
  }
});

/**
 * @route GET /dex/imbalance/:sellAsset/:buyAsset
 * @desc Measures buy-vs-sell pressure by comparing aggregate bid and ask volume for a market pair.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.sellAsset - Base/sell asset in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} req.params.buyAsset - Quote/buy asset in `CODE:ISSUER` format or `XLM:native`.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload with `bidVolume`, `askVolume`, `imbalanceRatio`, `pressure`, and a human-readable `signal`.
 * @example
 * curl -s "http://localhost:3000/dex/imbalance/FUSD:GBFUSDFICTIONALISSUERKEY000000000000000000000000000000/XLM:native" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "bidVolume": "18500.0000000",
 * //     "askVolume": "11980.5000000",
 * //     "imbalanceRatio": "1.5442",
 * //     "pressure": "buy",
 * //     "signal": "Strong buy pressure detected. Demand significantly outweighs supply."
 * //   }
 * // }
 */
router.get("/imbalance/:sellAsset/:buyAsset", async (req, res, next) => {
  try {
    const { sellAsset, buyAsset } = req.params;

    let selling, buying;
    try {
      selling = parseStellarAsset(sellAsset);
      buying = parseStellarAsset(buyAsset);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: err.message,
        },
      });
    }

    const orderBook = await server.orderbook(selling, buying).limit(200).call();

    const bidVolume = (orderBook.bids || []).reduce((sum, b) => sum + parseFloat(b.amount), 0);
    const askVolume = (orderBook.asks || []).reduce((sum, a) => sum + parseFloat(a.amount), 0);

    if (bidVolume === 0 && askVolume === 0) {
      return res.status(404).json({
        success: false,
        error: makeOrderBookEmptyError(selling.getCode(), buying.getCode()),
      });
    }

    const imbalanceRatio = askVolume > 0 ? bidVolume / askVolume : (bidVolume > 0 ? 100 : 1);
    
    let pressure = "neutral";
    let signal = "The market is currently balanced between buyers and sellers.";

    if (imbalanceRatio > 1.25) {
      pressure = "buy";
      signal = "Strong buy pressure detected. Demand significantly outweighs supply.";
    } else if (imbalanceRatio < 0.75) {
      pressure = "sell";
      signal = "Strong sell pressure detected. Supply significantly outweighs demand.";
    }

    return success(res, {
      bidVolume: bidVolume.toFixed(7),
      askVolume: askVolume.toFixed(7),
      imbalanceRatio: imbalanceRatio.toFixed(4),
      pressure,
      signal,
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: makeOrderBookEmptyError(req.params.sellAsset, req.params.buyAsset),
      });
    }
    next(err);
  }
});

/**
 * @route GET /dex/depth/:sellAsset/:buyAsset
 * @desc Summarizes order book depth with side counts, cumulative volumes, top 5 bid/ask levels, and a depth rating.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.sellAsset - Asset to sell in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} req.params.buyAsset - Asset to buy in `CODE:ISSUER` format or `XLM:native`.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload containing `bidsCount`, `asksCount`, volume totals, top levels, and `depthRating` (`deep`, `moderate`, `shallow`).
 * @example
 * curl -s "http://localhost:3000/dex/depth/NOVA:GBNOVAISSUERFICTIONALKEY0000000000000000000000000000/FUSD:GBFUSDFICTIONALISSUERKEY000000000000000000000000000000" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "bidsCount": 64,
 * //     "asksCount": 59,
 * //     "totalBidVolume": "72450.1200000",
 * //     "totalAskVolume": "69110.0000000",
 * //     "top5Bids": [{ "price": "0.9912000", "amount": "1200.0000000" }],
 * //     "top5Asks": [{ "price": "0.9948000", "amount": "980.0000000" }],
 * //     "depthRating": "deep"
 * //   }
 * // }
 */
router.get("/depth/:sellAsset/:buyAsset", async (req, res, next) => {
  try {
    const { sellAsset, buyAsset } = req.params;

    const parseStellarAsset = (assetString) => {
      const parts = assetString.split(":");
      if (parts.length !== 2) {
        throw new Error(`Invalid asset format: "${assetString}". Expected format: CODE:ISSUER`);
      }

      const [code, issuer] = parts;

      if (code.toUpperCase() === "XLM" && issuer.toLowerCase() === "native") {
        return Asset.native();
      }

      validateAssetCode(code);
      validateAccountId(issuer);

      return new Asset(code.toUpperCase(), issuer);
    };

    let selling, buying;
    try {
      selling = parseStellarAsset(sellAsset);
      buying = parseStellarAsset(buyAsset);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: err.message,
        },
      });
    }

    const orderBookResponse = await server
      .orderbook(selling, buying)
      .limit(200)
      .call();

    const bids = orderBookResponse.bids || [];
    const asks = orderBookResponse.asks || [];

    if (bids.length === 0 && asks.length === 0) {
      return res.status(404).json({
        success: false,
        error: makeOrderBookEmptyError(selling.getCode(), buying.getCode()),
      });
    }

    const totalBidVolume = bids.reduce((sum, bid) => sum + parseFloat(bid.amount), 0);
    const totalAskVolume = asks.reduce((sum, ask) => sum + parseFloat(ask.amount), 0);
    const totalVolume = totalBidVolume + totalAskVolume;

    let depthRating;
    if (totalVolume >= 50000) {
      depthRating = "deep";
    } else if (totalVolume >= 5000) {
      depthRating = "moderate";
    } else {
      depthRating = "shallow";
    }

    const formatOrder = (order) => ({
      price: order.price,
      amount: order.amount,
    });

    return success(res, {
      bidsCount: bids.length,
      asksCount: asks.length,
      totalBidVolume: totalBidVolume.toFixed(7),
      totalAskVolume: totalAskVolume.toFixed(7),
      top5Bids: bids.slice(0, 5).map(formatOrder),
      top5Asks: asks.slice(0, 5).map(formatOrder),
      depthRating,
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: makeOrderBookEmptyError(req.params.sellAsset, req.params.buyAsset),
      });
    }
    next(err);
  }
});

/**
 * @route GET /dex/price/:sellAsset/:buyAsset
 * @desc Estimates effective conversion rate using strict-send pathfinding for a given sell amount.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.sellAsset - Source asset in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} req.params.buyAsset - Destination asset in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} [req.query.amount=1] - Amount of `sellAsset` to convert.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload with normalized sell/buy amounts, computed `effectiveRate`, and the best hop path.
 * @example
 * curl -s "http://localhost:3000/dex/price/XLM:native/FUSD:GBFUSDFICTIONALISSUERKEY000000000000000000000000000000?amount=250" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "sellAsset": "XLM:native",
 * //     "buyAsset": "FUSD:GBFUSDFICTIONALISSUERKEY000000000000000000000000000000",
 * //     "sellAmount": "250.0000000",
 * //     "buyAmount": "31.8750000",
 * //     "effectiveRate": "0.1275000",
 * //     "bestPath": [{ "assetCode": "NOVA", "assetIssuer": "GBNOVAISSUERFICTIONALKEY0000000000000000000000000000" }]
 * //   }
 * // }
 */
router.get("/price/:sellAsset/:buyAsset", async (req, res, next) => {
  try {
    const { sellAsset, buyAsset } = req.params;
    const amount = req.query.amount || "1";

    const parseStellarAsset = (assetString) => {
      const parts = assetString.split(":");
      if (parts.length !== 2) {
        throw new Error(`Invalid asset format: "${assetString}". Expected format: CODE:ISSUER`);
      }
      const [code, issuer] = parts;
      if (code.toUpperCase() === "XLM" && issuer.toLowerCase() === "native") {
        return Asset.native();
      }
      validateAssetCode(code);
      validateAccountId(issuer);
      return new Asset(code.toUpperCase(), issuer);
    };

    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: { type: "ValidationError", message: "amount must be a positive number." },
      });
    }

    let selling, buying;
    try {
      selling = parseStellarAsset(sellAsset);
      buying = parseStellarAsset(buyAsset);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: { type: "ValidationError", message: err.message },
      });
    }

    // Use strictSendPaths: given a fixed source amount, find the best destination amount
    const formattedAmount = parsedAmount.toFixed(7);
    const pathsResponse = await server
      .strictSendPaths(selling, formattedAmount, [buying])
      .call();

    const records = pathsResponse.records || [];

    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        error: { type: "NotFound", message: "No payment path exists between these two assets." },
      });
    }

    // Best path = highest destination amount
    const best = records.reduce((a, b) =>
      parseFloat(a.destination_amount) >= parseFloat(b.destination_amount) ? a : b
    );

    const sellAmount = parseFloat(best.source_amount);
    const buyAmount = parseFloat(best.destination_amount);
    const effectiveRate = buyAmount / sellAmount;

    const bestPath = best.path.map((hop) =>
      normalizeAsset(hop.asset_code, hop.asset_issuer, hop.asset_type),
    );

    return success(res, {
      sellAsset,
      buyAsset,
      sellAmount: sellAmount.toFixed(7),
      buyAmount: buyAmount.toFixed(7),
      effectiveRate: effectiveRate.toFixed(7),
      bestPath,
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: { type: "NotFound", message: "No payment path exists between these two assets." },
      });
    }
    next(err);
  }
});

/**
 * Converts a Horizon asset record (from a trade) into the standard
 * { code, issuer, type } shape used across this API.
 *
 * @param {string} type   - asset_type field from Horizon (e.g. "native", "credit_alphanum4")
 * @param {string} code   - asset_code field (undefined for native XLM)
 * @param {string} issuer - asset_issuer field (undefined for native XLM)
 * @returns {{ code: string, issuer: string|null, type: string }}
 */
function formatAsset(type, code, issuer) {
  if (isNativeAsset({ type })) {
    return { code: "XLM", issuer: null, type: "native" };
  }
  return {
    code: code || "",
    issuer: issuer || null,
    type: type || "credit_alphanum4",
  };
}

/**
 * Builds a stable string key for a trading pair regardless of direction.
 * Alphabetical ordering ensures XLM/USDC and USDC/XLM map to the same key.
 */
function pairKey(baseType, baseCode, baseIssuer, counterType, counterCode, counterIssuer) {
  const a = isNativeAsset({ type: baseType }) ? "XLM:native" : `${baseCode}:${baseIssuer}`;
  const b = isNativeAsset({ type: counterType }) ? "XLM:native" : `${counterCode}:${counterIssuer}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * GET /dex/top-markets?limit=10
 * Returns the top Stellar DEX trading pairs ranked by 24-hour base-asset volume.
 *
 * Query params:
 *   - limit  (number, 1–50, default: 10)
 *
 * Response shape:
 *   { success: true, data: { markets: [...], total } }
 *
 * Each market entry:
 *   {
 *     baseAsset:     { code, issuer, type },
 *     counterAsset:  { code, issuer, type },
 *     baseVolume:    "1234567.0000000",
 *     counterVolume: "1234567.0000000",
 *     tradeCount:    42,
 *     spread:        "0.0012345" | null   // null when no live order book
 *   }
 *
 * Strategy:
 *   Horizon has no single "top markets by volume" endpoint. We fetch the most
 *   recent 200 trades (the practical maximum for a single page), aggregate
 *   volume client-side per pair, rank by baseVolume descending, then enrich
 *   the top-N results with a live order book call to compute the bid-ask spread.
 *
 * @example
 * GET /dex/top-markets?limit=5
 */
router.get("/top-markets", async (req, res, next) => {
  try {
    // ── 1. Validate limit ────────────────────────────────────────────────────
    const MAX_LIMIT = 50;
    const DEFAULT_LIMIT = 10;
    const rawLimit = req.query.limit;

    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
      const parsed = parseInt(rawLimit, 10);
      if (isNaN(parsed) || parsed < 1) {
        return res.status(400).json({
          success: false,
          error: {
            type: "ValidationError",
            message: "limit must be a positive integer between 1 and 50.",
          },
        });
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }

    // ── 2. Cache check ───────────────────────────────────────────────────────
    const cacheKey = `dex:top-markets:${limit}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return success(res, cached);
    }
    res.set("X-Cache", "MISS");

    // ── 3. Fetch recent trades from Horizon ──────────────────────────────────
    // Horizon's /trades endpoint returns the most recent trades across all
    // pairs. We request 200 records (the Horizon max per page) to give the
    // aggregation enough data to surface the busiest pairs.
    const tradesResponse = await server
      .trades()
      .order("desc")
      .limit(200)
      .call();

    const trades = tradesResponse.records || [];

    // ── 4. Aggregate volume per pair ─────────────────────────────────────────
    const pairMap = new Map();

    for (const trade of trades) {
      const key = pairKey(
        trade.base_asset_type,
        trade.base_asset_code,
        trade.base_asset_issuer,
        trade.counter_asset_type,
        trade.counter_asset_code,
        trade.counter_asset_issuer,
      );

      if (!pairMap.has(key)) {
        pairMap.set(key, {
          baseAsset: formatAsset(
            trade.base_asset_type,
            trade.base_asset_code,
            trade.base_asset_issuer,
          ),
          counterAsset: formatAsset(
            trade.counter_asset_type,
            trade.counter_asset_code,
            trade.counter_asset_issuer,
          ),
          baseVolume: 0,
          counterVolume: 0,
          tradeCount: 0,
        });
      }

      const entry = pairMap.get(key);
      entry.baseVolume += parseFloat(trade.base_amount || "0");
      entry.counterVolume += parseFloat(trade.counter_amount || "0");
      entry.tradeCount += 1;
    }

    // ── 5. Rank by baseVolume descending, take top `limit` ──────────────────
    const ranked = Array.from(pairMap.values())
      .sort((a, b) => b.baseVolume - a.baseVolume)
      .slice(0, limit);

    // ── 6. Enrich with live spread (parallel order book calls) ───────────────
    const withSpread = await Promise.all(
      ranked.map(async (market) => {
        let spread = null;
        try {
          const selling =
            isNativeAsset(market.baseAsset)
              ? Asset.native()
              : new Asset(market.baseAsset.code, market.baseAsset.issuer);

          const buying =
            isNativeAsset(market.counterAsset)
              ? Asset.native()
              : new Asset(market.counterAsset.code, market.counterAsset.issuer);

          const ob = await server.orderbook(selling, buying).limit(1).call();
          const bestBid = ob.bids && ob.bids.length > 0 ? parseFloat(ob.bids[0].price) : null;
          const bestAsk = ob.asks && ob.asks.length > 0 ? parseFloat(ob.asks[0].price) : null;

          if (bestBid !== null && bestAsk !== null) {
            spread = (bestAsk - bestBid).toFixed(7);
          }
        } catch (_) {
          // Order book unavailable for this pair — spread stays null
        }

        return {
          baseAsset: market.baseAsset,
          counterAsset: market.counterAsset,
          baseVolume: market.baseVolume.toFixed(7),
          counterVolume: market.counterVolume.toFixed(7),
          tradeCount: market.tradeCount,
          spread,
        };
      }),
    );

    // ── 7. Build response and cache ──────────────────────────────────────────
    const data = {
      markets: withSpread,
      total: withSpread.length,
    };

    cacheService.set(cacheKey, data, cacheTTL.topMarkets);

    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /dex/arbitrage-opportunities
 *
 * Scans the live Stellar DEX order books for common XLM trading pairs and
 * returns pairs where the bid-ask spread implies a potentially profitable
 * round-trip trade.
 *
 * Strategy:
 *   For each candidate pair we fetch the top order-book level from Horizon.
 *   When both a best-bid and best-ask exist we compute:
 *     spread        = bestAsk − bestBid   (in the counter asset)
 *     profitPercent = spread / midPrice × 100
 *   A spread > 0 qualifies as an opportunity; the confidence label is derived
 *   from the magnitude of profitPercent.
 *
 * Confidence thresholds:
 *   profitPercent ≥ 2.0  → "high"
 *   profitPercent ≥ 0.5  → "medium"
 *   profitPercent > 0    → "low"
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       opportunities: [
 *         {
 *           buyAsset:      { code: "XLM", issuer: null, type: "native" },
 *           sellAsset:     { code: "USDC", issuer: "GA5Z...", type: "credit_alphanum4" },
 *           spread:        "0.0012340",
 *           profitPercent: "0.9800000",
 *           confidence:    "medium"
 *         },
 *         ...
 *       ],
 *       total:     2,
 *       timestamp: "2024-07-01T12:00:00.000Z"
 *     }
 *   }
 *
 * Caching: 5 s TTL (configurable via CACHE_TTL_ARBITRAGE_MS).
 *
 * @example
 * curl -s "http://localhost:3000/dex/arbitrage-opportunities" | jq
 */
router.get("/arbitrage-opportunities", async (req, res, next) => {
  try {
    const CACHE_KEY = "dex:arbitrage-opportunities";
    const fresh = req.query.fresh === "true";

    if (!fresh) {
      const cached = cacheService.get(CACHE_KEY);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // ── Candidate XLM trading pairs ─────────────────────────────────────────
    // Each entry is { buyAsset, sellAsset } expressed as SDK Asset objects plus
    // human-readable label strings for the response.
    const WELL_KNOWN_ISSUERS = {
      USDC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      AQUA: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA",
      YXLM: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55",
      EURC: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
      BTC:  "GDXTJEK4JZNSTNQV4IUSX3AQ4EACSSAXGMZQFLKQ6BKLR57ELBQINPB",
    };

    const pairs = Object.entries(WELL_KNOWN_ISSUERS).map(([code, issuer]) => ({
      buyAsset: normalizeAsset("XLM", null, "native"),
      sellAsset: normalizeAsset(code, issuer),
      buying: Asset.native(),
      selling: new Asset(code, issuer),
    }));

    // ── Fetch order books in parallel ──────────────────────────────────────
    const results = await Promise.allSettled(
      pairs.map(async (pair) => {
        const ob = await server
          .orderbook(pair.selling, pair.buying)
          .limit(1)
          .call();

        const bids = ob.bids || [];
        const asks = ob.asks || [];

        if (bids.length === 0 || asks.length === 0) return null;

        const bestBid = parseFloat(bids[0].price);
        const bestAsk = parseFloat(asks[0].price);

        if (bestBid <= 0 || bestAsk <= 0 || bestAsk <= bestBid) return null;

        const spread       = bestAsk - bestBid;
        const midPrice     = (bestBid + bestAsk) / 2;
        const profitPct    = (spread / midPrice) * 100;

        let confidence;
        if (profitPct >= 2.0) {
          confidence = "high";
        } else if (profitPct >= 0.5) {
          confidence = "medium";
        } else {
          confidence = "low";
        }

        return {
          buyAsset: pair.buyAsset,
          sellAsset: pair.sellAsset,
          spread: spread.toFixed(7),
          profitPercent: profitPct.toFixed(7),
          confidence: confidence.toLowerCase(),
        };
      }),
    );

    // ── Filter to profitable opportunities only ──────────────────────────────
    const opportunities = results
      .filter((r) => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value);

    const data = {
      opportunities,
      total:     opportunities.length,
      timestamp: new Date().toISOString(),
    };

    cacheService.set(CACHE_KEY, data, cacheTTL.arbitrage);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
