require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const hpp = require("hpp");
const cors = require("cors");
const compression = require("compression");

const logger = require("./utils/logger");
const { parseStellarAmount } = require("./utils/parseStellarAmount");
const { setupWebSocket } = require("./websocket");
const { server, horizonUrl, NETWORK } = require("./config/stellar");
const cacheService = require("./services/cache");
const networkStatusCache = cacheService;
const feeEstimateCache = cacheService;
const { fetchNetworkStatus } = require("./utils/mapNetworkStatus");
const { mapFeeStats } = require("./utils/mapFeeEstimate");
const { getHorizonHealth } = require("./utils/horizonHealth");
const cacheTTL = require("./config/cacheConfig");

const rateLimiter = require("./middleware/rateLimiter");
const restrictHttpMethods = require("./middleware/restrictHttpMethods");
const contentTypeValidator = require("./middleware/contentTypeValidator");
const bodySizeLimit = require("./middleware/bodySizeLimit");
const errorHandler = require("./middleware/errorHandler");
const requestIdMiddleware = require("./middleware/requestId");
const requestLogger = require("./middleware/requestLogger");
const apiKeyMiddleware = require("./middleware/apiKeyAuth");
const sanitize = require("./middleware/sanitize");
const rejectDuplicateQueryParams = require("./middleware/rejectDuplicateQueryParams");
const coerceQueryParams = require("./middleware/coerceQueryParams");
const etagMiddleware = require("./middleware/etag");
const metricsService = require("./services/metrics");

const networkStatusRouter = require("./routes/networkStatus");
const webhooksRouter = require("./routes/webhooks");
const contractEventPoller = require("./services/contractEventPoller");
const feeEstimateRouter = require("./routes/feeEstimate");
const accountRouter = require("./routes/account");
const accountsRouter = require("./routes/accounts");
const transactionsRouter = require("./routes/transactions");
const assetRouter = require("./routes/asset");
const dexRouter = require("./routes/dex");
const liquidityPoolRouter = require("./routes/liquidityPool");
const streamRouter = require("./routes/stream");
const utilsRouter = require("./routes/utils");
const stellarTomlRouter = require("./routes/stellarToml");
const claimableBalancesRouter = require("./routes/claimableBalances");
const cacheStatsRouter = require("./routes/cacheStats");
const metricsRouter = require("./routes/metrics");
const sorobanRouter = require("./routes/soroban");
const networkRouter = require("./routes/network");
const assetsOverviewRouter = require("./routes/assetsOverview");

const app = express();
// Disable server identification header for security
app.disable("x-powered-by");
const { normalizeAmountFields } = require("./utils/response");

const PORT = process.env.PORT || 3000;

// Captured once at process start so /health can report accurate uptime.
const SERVER_STARTED_AT = new Date().toISOString();

async function warmNetworkStatusCache({
  logger: customLogger = logger,
  horizonServer = server,
} = {}) {
  const data = await fetchNetworkStatus(horizonServer, {
    network: process.env.STELLAR_NETWORK || NETWORK || "testnet",
    horizonUrl,
  });

  cacheService.set("network-status", data, cacheTTL.networkStatus);
  const writeWarmLog =
    typeof customLogger.info === "function"
      ? customLogger.info.bind(customLogger)
      : customLogger.log.bind(customLogger);
  writeWarmLog("[CACHE WARM] /network-status");
}

async function warmFeeEstimateCache({
  logger: customLogger = logger,
  horizonServer = server,
} = {}) {
  const feeStats = await horizonServer.feeStats();
  const operations = 1;

  const recommended = parseInt(feeStats.fee_charged.p50);
  const priority = parseInt(feeStats.fee_charged.p95);
  const liveFees = mapFeeStats(feeStats);

  const data = {
    ...liveFees,
    note: `Fee estimates for a transaction with ${operations} operation(s). Fees are in stroops (1 XLM = 10,000,000 stroops).`,
    operationCount: operations,
    perOperation: {
      economy: {
        stroops: parseInt(feeStats.fee_charged.min),
        xlm: parseStellarAmount(parseInt(feeStats.fee_charged.min)),
        description: "Minimum — may be slow during congestion",
      },
      standard: {
        stroops: recommended,
        xlm: parseStellarAmount(recommended),
        description: "Recommended for most transactions",
      },
      priority: {
        stroops: priority,
        xlm: parseStellarAmount(priority),
        description: "Fast inclusion even during high network load",
      },
    },
    totalFee: {
      economy: {
        stroops: parseInt(feeStats.fee_charged.min) * operations,
        xlm: parseStellarAmount(parseInt(feeStats.fee_charged.min) * operations),
      },
      standard: {
        stroops: recommended * operations,
        xlm: parseStellarAmount(recommended * operations),
      },
      priority: {
        stroops: priority * operations,
        xlm: parseStellarAmount(priority * operations),
      },
    },
    networkStats: {
      lastLedgerBaseFee: feeStats.last_ledger_base_fee,
      ledgerCapacityUsage: feeStats.ledger_capacity_usage,
      maxFeeCharged: feeStats.fee_charged.max,
      p10: feeStats.fee_charged.p10,
      p50: feeStats.fee_charged.p50,
      p95: feeStats.fee_charged.p95,
      p99: feeStats.fee_charged.p99,
    },
  };

  cacheService.set("fee-estimate:1", data, cacheTTL.feeEstimate);
  const writeWarmLog =
    typeof customLogger.info === "function"
      ? customLogger.info.bind(customLogger)
      : customLogger.log.bind(customLogger);
  writeWarmLog("[CACHE WARM] /fee-estimate");
}

async function warmStartupCaches({
  logger: customLogger = logger,
  horizonServer = server,
} = {}) {
  const warmers = [
    warmNetworkStatusCache({ logger: customLogger, horizonServer }),
    warmFeeEstimateCache({ logger: customLogger, horizonServer }),
  ];

  const results = await Promise.allSettled(warmers);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const endpoint = index === 0 ? "/network-status" : "/fee-estimate";
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      customLogger.error(`[CACHE WARM] failed ${endpoint}: ${reason}`);
    }
  });
}

// ── Security & Parsing ──────────────────────────────────────────────────────
app.use(helmet());
// Reject TRACE/CONNECT/OPTIONS/PUT/HEAD/etc. before CORS or route handlers
app.use(restrictHttpMethods);
// Skip compression for responses smaller than 1 KB — gzip headers alone can exceed tiny payloads
app.use(compression({ threshold: 1024 }));
app.use(cors());
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(contentTypeValidator);
app.use(bodySizeLimit);
app.use(rejectDuplicateQueryParams);
app.use(hpp({ whitelist: ["limit", "order", "cursor", "operations"] }));

// ── Rate Limiting ───────────────────────────────────────────────────────────
app.use(rateLimiter);

// ── Metrics request counter ─────────────────────────────────────────────────
app.use((req, res, next) => {
  metricsService.incrementRequests();
  next();
});

// ── Input Sanitization ──────────────────────────────────────────────────────
app.use(sanitize);
app.use(coerceQueryParams);
// ── Per-route request counter ──────────────────────────────────────────────
// Runs after body parsing and sanitisation so req.body is available; routes
// are matched before this middleware fires (res.on("finish")), meaning
// req.route is populated and we track the pattern, not the raw URL.
app.use(routeCounter);
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(normalizeAmountFields(payload));
  next();
});

// ── Health Check ────────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  const network = process.env.STELLAR_NETWORK || NETWORK || "testnet";
  const horizon = await getHorizonHealth({ server, network });
  const status = horizon.status === "ok" ? "ok" : horizon.status;

  res.json({
    success: true,
    data: {
      status,
      service: "StellarKit API",
      version: require("../package.json").version,
      timestamp: new Date().toISOString(),
      network,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      startedAt: SERVER_STARTED_AT,
      horizon,
    },
  });
});

// ── API Key Authentication ─────────────────────────────────────────────────────
app.use(apiKeyMiddleware);

// ── API Routes ───────────────────────────────────────────────────────────────
app.use("/network-status", networkStatusRouter);
app.use("/network", networkStatusRouter);
app.use("/fee-estimate", feeEstimateRouter);
// Apply ETag middleware to cached endpoints
app.use("/network-status", etagMiddleware, networkStatusRouter);
app.use("/fee-estimate", etagMiddleware, feeEstimateRouter);
const accountCounterpartiesRouter = require("./routes/account.counterparties");
app.use("/account", etagMiddleware, accountRouter);
app.use("/account", etagMiddleware, accountCounterpartiesRouter);
app.use("/accounts", accountsRouter);
app.use("/transactions", transactionsRouter);
app.use("/asset", etagMiddleware, assetRouter);
app.use("/dex", etagMiddleware, dexRouter);
app.use("/liquidity-pools", etagMiddleware, liquidityPoolRouter);
app.use("/assets-overview", etagMiddleware, assetsOverviewRouter);
app.use("/stream", streamRouter);
app.use("/utils", utilsRouter);
app.use("/stellar-toml", stellarTomlRouter);
app.use("/claimable-balances", etagMiddleware, claimableBalancesRouter);
app.use("/cache", cacheStatsRouter);
app.use("/metrics", metricsRouter);
app.use("/webhooks", webhooksRouter);
app.use("/soroban", sorobanRouter);
app.use("/network", etagMiddleware, networkRouter);
const transactionEffectsRouter = require("./routes/transaction.effects");
app.use("/transaction", etagMiddleware, transactionEffectsRouter);

// ── Root
app.get("/", (req, res) => {
  res.json({
    success: true,
    data: {
      name: "StellarKit API",
      description:
        "A developer utility API for the Stellar blockchain. Fee estimation, account info, transactions, network status, and asset metadata.",
      version: require("../package.json").version,
      network: process.env.STELLAR_NETWORK || "testnet",
      endpoints: [
        { method: "GET", path: "/health", description: "Service health check" },
        { method: "GET", path: "/network-status", description: "Latest ledger, fees, and protocol info" },
        { method: "GET", path: "/fee-estimate", description: "Fee tiers for transaction submission" },
        { method: "GET", path: "/fee-estimate?operations=N", description: "Fee estimate for N operations" },
        { method: "GET", path: "/fee-estimate/surge-status", description: "Identify fee surge periods and get actionable recommendations" },
        { method: "GET", path: "/fee-estimate/trends", description: "Analyze fee trends across last 50 ledgers with statistical summary" },
        { method: "GET", path: "/account/:id", description: "Account details, balances, signers" },
        { method: "GET", path: "/account/:id/reserve-breakdown", description: "Per-type breakdown of the minimum XLM reserve requirement" },
        { method: "GET", path: "/account/:id/age", description: "Account age and longevity metrics" },
        { method: "GET", path: "/account/:id/balances", description: "XLM and asset balances for an account" },
        { method: "GET", path: "/account/:id/sequence", description: "Current sequence number for an account" },
        { method: "GET", path: "/account/:id/freeze-status/:assetCode/:assetIssuer", description: "Check if an asset is frozen on an account" },
        { method: "GET", path: "/account/:id/can-receive/:assetCode/:assetIssuer", description: "Check if an account can receive a specific asset" },
        { method: "POST", path: "/account/:id/multisig-plan", description: "Plan multisig transactions by calculating signer combinations for each threshold" },
        { method: "GET", path: "/account/:id/pool-positions", description: "Calculate liquidity pool positions and share values" },
        { method: "GET", path: "/account/:id/transactions/search", description: "Search account transactions by memo content" },
        { method: "GET", path: "/account/:id/volume", description: "Total transaction volume by asset over a time period" },
        { method: "GET", path: "/transactions/:id", description: "Transaction history for an account" },
        { method: "GET", path: "/transactions/:id/operations", description: "Operation history for an account" },
        { method: "GET", path: "/claimable-balances/:id/evaluate/:accountId", description: "Evaluate claimability of a balance for a specific account" },
        { method: "GET", path: "/asset/:code/:issuer", description: "Asset metadata and statistics" },
        { method: "GET", path: "/asset/:code/:issuer/holders", description: "Paginated accounts holding an asset" },
        { method: "GET", path: "/asset/:code/:issuer/verify", description: "Verify asset issuer via account flags, home_domain, and stellar.toml" },
        { method: "GET", path: "/asset/search?code=:code", description: "Search assets by code across all issuers" },
        { method: "GET", path: "/dex/arbitrage/:code/:issuer", description: "Find profitable circular arbitrage paths for an asset" },
        { method: "GET", path: "/dex/spread/:sellAsset/:buyAsset", description: "Calculate bid-ask spread for a DEX trading pair" },
        { method: "GET", path: "/dex/imbalance/:sellAsset/:buyAsset", description: "Detect buy/sell pressure imbalance on a trading pair" },
        { method: "GET", path: "/account/:id/counterparties", description: "Analyze frequent payment counterparties for an account" },
        { method: "GET", path: "/network/ledger-timing", description: "Analyze network ledger close time consistency" },
        { method: "GET", path: "/liquidity-pools/:id/profitability", description: "Estimate annualized fee income for a liquidity pool" },

        { method: "GET", path: "/dex/price/:sellAsset/:buyAsset", description: "Calculate effective exchange rate via best DEX payment path" },
        { method: "GET", path: "/liquidity-pools/:id/profitability", description: "Estimate annualized fee income for a liquidity pool" },
        { method: "GET", path: "/liquidity-pools/:id/reserve-ratio", description: "Get reserve ratio and drift from equal for a liquidity pool" },
        { method: "GET", path: "/assets-overview", description: "Summary of total assets, trustlines, liquidity pools, and top 5 assets by trustline count"},
        { method: "GET", path: "/utils/friendbot/:accountId", description: "Fund a testnet account via Friendbot (testnet only)" },
        { method: "GET", path: "/utils/convert?xlm=:xlm", description: "Convert between XLM and stroops" },
        { method: "GET", path: "/utils/validate-account?id=:id", description: "Validate a Stellar public key format (no Horizon call)" },
        { method: "WS", path: "/stream/ledgers", description: "Real-time stream of live Stellar ledger updates" },
        { method: "GET", path: "/cache/stats", description: "Cache hit rate and performance statistics" },
        { method: "GET", path: "/soroban/contract/:id", description: "Soroban contract instance details (executable type, wasm hash)" },
        { method: "GET", path: "/soroban/contract/:id/storage", description: "Soroban contract instance-storage entries" },
        { method: "GET", path: "/soroban/contract/:id/functions", description: "Exported Soroban contract function signatures parsed from the contract ABI" },
        { method: "GET", path: "/liquidity-pools/:id", description: "Live Horizon liquidity pool details" },
        {
          method: "GET",
          path: "/network-status",
          description: "Latest ledger, fees, and protocol info",
        },
        {
          method: "GET",
          path: "/fee-estimate",
          description: "Fee tiers for transaction submission",
        },
        {
          method: "GET",
          path: "/fee-estimate?operations=N",
          description: "Fee estimate for N operations",
        },
        {
          method: "GET",
          path: "/account/:id",
          description: "Account details, balances, signers",
        },
        {
          method: "GET",
          path: "/account/:id/balances",
          description: "XLM and asset balances for an account",
        },
        {
          method: "GET",
          path: "/account/:id/offers",
          description:
            "Open offers for an account (use ?offerId=N for a specific offer)",
        },
        {
          method: "GET",
          path: "/transactions/:id",
          description: "Transaction history for an account",
        },
        {
          method: "GET",
          path: "/transactions/:id/operations",
          description: "Operation history for an account",
        },
        {
          method: "GET",
          path: "/asset/:code/:issuer",
          description: "Asset metadata and statistics",
        },
        {
          method: "GET",
          path: "/asset/:code/:issuer/holders",
          description: "Paginated accounts holding an asset",
        },
        {
          method: "GET",
          path: "/asset/search?code=:code",
          description: "Search assets by code across all issuers",
        },
        {
          method: "GET",
          path: "/utils/friendbot/:accountId",
          description: "Fund a testnet account via Friendbot (testnet only)",
        },
        {
          method: "WS",
          path: "/stream/ledgers",
          description: "Real-time stream of live Stellar ledger updates",
        },
        { method: "GET", path: "/health", description: "Service health check" },
        {
          method: "GET",
          path: "/network-status",
          description: "Latest ledger, fees, and protocol info",
        },
        {
          method: "GET",
          path: "/fee-estimate",
          description: "Fee tiers for transaction submission",
        },
        {
          method: "GET",
          path: "/fee-estimate?operations=N",
          description: "Fee estimate for N operations",
        },
        {
          method: "GET",
          path: "/account/:id",
          description: "Account details, balances, signers",
        },
        {
          method: "GET",
          path: "/account/:id/trustlines",
          description: "Trustlines with TOML asset metadata resolved",
        },
        {
          method: "GET",
          path: "/account/:id/effects",
          description: "Effects history for an account (normalized, paginated)",
        },

        {
          method: "GET",
          path: "/transaction/:hash/effects",
          description:
            "Ledger effects produced by a transaction hash (normalized)",
        },

        {
          method: "GET",
          path: "/transactions/:id",
          description: "Transaction history for an account",
        },
        {
          method: "GET",
          path: "/transactions/:id/operations",
          description: "Operation history for an account",
        },
        {
          method: "GET",
          path: "/fee-estimate/surge-status",
          description:
            "Identify fee surge periods and get actionable recommendations",
        },

        {
          method: "GET",
          path: "/fee-estimate/trends",
          description:
            "Analyze fee trends across last 50 ledgers with statistical summary",
        },

        {
          method: "GET",
          path: "/account/:id/age",
          description: "Account age and longevity metrics",
        },
        {
          method: "GET",
          path: "/account/:id/balances",
          description: "XLM and asset balances for an account",
        },
        {
          method: "GET",
          path: "/account/:id/sequence",
          description: "Current sequence number for an account",
        },
        {
          method: "GET",
          path: "/account/:id/trades",
          description: "Trade history for an account with pagination",
        },
        {
          method: "GET",
          path: "/account/:id/freeze-status/:assetCode/:assetIssuer",
          description: "Check if an asset is frozen on an account",
        },
        {
          method: "GET",
          path: "/account/:id/can-receive/:assetCode/:assetIssuer",
          description: "Check if an account can receive a specific asset",
        },
        {
          method: "POST",
          path: "/account/:id/multisig-plan",
          description:
            "Plan multisig transactions by calculating signer combinations for each threshold",
        },
        {
          method: "GET",
          path: "/account/:id/pool-positions",
          description: "Calculate liquidity pool positions and share values",
        },
        {
          method: "GET",
          path: "/account/:id/transactions/search",
          description: "Search account transactions by memo content",
        },
        {
          method: "GET",
          path: "/account/:id/volume",
          description: "Total transaction volume by asset over a time period",
        },
        {
          method: "GET",
          path: "/claimable-balances/:id/evaluate/:accountId",
          description:
            "Evaluate claimability of a balance for a specific account",
        },

        {
          method: "GET",
          path: "/asset/:code/:issuer",
          description: "Asset metadata and statistics",
        },
        {
          method: "GET",
          path: "/asset/:code/:issuer/holders",
          description: "Paginated accounts holding an asset",
        },
        {
          method: "GET",
          path: "/asset/:code/:issuer/verify",
          description:
            "Verify asset issuer via account flags, home_domain, and stellar.toml",
        },
        {
          method: "GET",
          path: "/asset/search?code=:code",
          description: "Search assets by code across all issuers",
        },

        {
          method: "GET",
          path: "/dex/arbitrage/:code/:issuer",
          description: "Find profitable circular arbitrage paths for an asset",
        },
        {
          method: "GET",
          path: "/dex/spread/:sellAsset/:buyAsset",
          description: "Calculate bid-ask spread for a DEX trading pair",
        },
        {
          method: "GET",
          path: "/dex/imbalance/:sellAsset/:buyAsset",
          description: "Detect buy/sell pressure imbalance on a trading pair",
        },
        {
          method: "GET",
          path: "/account/:id/counterparties",
          description: "Analyze frequent payment counterparties for an account",
        },
        {
          method: "GET",
          path: "/network/validators",
          description: "Normalised network validator / ledger info",
        },
        {
          method: "GET",
          path: "/network/fee-percentiles",
          description: "Fee percentile distribution (p10–p99) with accepted fee range and ledger sequence",
        },
        {
          method: "GET",
          path: "/network/ledger-timing",
          description: "Analyze network ledger close time consistency",
        },
        {
          method: "GET",
          path: "/network/validators",
          description: "Current validator list grouped by organisation",
        },
        {
          method: "GET",
          path: "/liquidity-pools/:id/trades",
          description: "Trade history for a liquidity pool",
        },
        {
          method: "GET",
          path: "/liquidity-pools/:id/profitability",
          description: "Estimate annualized fee income for a liquidity pool",
        },

        {
          method: "GET",
          path: "/dex/price/:sellAsset/:buyAsset",
          description:
            "Calculate effective exchange rate via best DEX payment path",
        },
        {
          method: "GET",
          path: "/dex/top-markets",
          description:
            "Top DEX trading pairs by volume with spread (optional ?limit=, default 10, max 50)",
        },
        {
          method: "GET",
          path: "/liquidity-pools/:id/reserve-ratio",
          description:
            "Get reserve ratio and drift from equal for a liquidity pool",
        },

        {
          method: "GET",
          path: "/utils/friendbot/:accountId",
          description: "Fund a testnet account via Friendbot (testnet only)",
        },
        {
          method: "GET",
          path: "/utils/convert?xlm=:xlm",
          description: "Convert between XLM and stroops",
        },
        {
          method: "GET",
          path: "/utils/validate-account?id=:id",
          description: "Validate a Stellar public key format (no Horizon call)",
        },
        {
          method: "GET",
          path: "/utils/validate-hash?hash=:hash",
          description:
            "Validate a Stellar transaction hash format (no Horizon call)",
        },
        {
          method: "GET",
          path: "/utils/network-passphrase",
          description:
            "Get the Stellar network passphrase for the configured network",
        },
        {
          method: "WS",
          path: "/stream/ledgers",
          description: "Real-time stream of live Stellar ledger updates",
        },
        {
          method: "GET",
          path: "/cache/stats",
          description: "Cache hit rate and performance statistics",
        },
      ],
      docs: "https://github.com/stellarkit-lab-devtools/stellarkit-api#readme",
    },
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      type: "NotFound",
      message: `Route ${req.method} ${req.path} not found. Visit / for available endpoints.`,
    },
  });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
function startServer({
  appInstance = app,
  port = PORT,
  logger = console,
  setupWebSocketHook = setupWebSocket,
} = {}) {
  const httpServer = appInstance.listen(port, () => {
    logger.log(`\n🚀 StellarKit API running on port ${port}`);
    logger.log(`🌐 Network : ${process.env.STELLAR_NETWORK || "testnet"}`);
    logger.log(`📖 Docs    : http://localhost:${port}/\n`);

    warmStartupCaches({ logger }).catch((err) => {
      logger.error(`[CACHE WARM] startup warmup failed: ${err.message}`);
    });
  });

  setupWebSocketHook(httpServer);
  contractEventPoller.start();
  return httpServer;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
