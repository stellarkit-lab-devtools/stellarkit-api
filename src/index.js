require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const hpp = require("hpp");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");

const { setupWebSocket } = require("./websocket");

const rateLimiter = require("./middleware/rateLimiter");
const contentTypeValidator = require("./middleware/contentTypeValidator");
const bodySizeLimit = require("./middleware/bodySizeLimit");
const errorHandler = require("./middleware/errorHandler");
const apiKeyMiddleware = require("./middleware/apiKey");
const sanitize = require("./middleware/sanitize");

const networkStatusRouter = require("./routes/networkStatus");
const feeEstimateRouter = require("./routes/feeEstimate");
const accountRouter = require("./routes/account");
const transactionsRouter = require("./routes/transactions");
const assetRouter = require("./routes/asset");
const dexRouter = require("./routes/dex");
const liquidityPoolRouter = require("./routes/liquidityPool");
const streamRouter = require("./routes/stream");
const utilsRouter = require("./routes/utils");
const stellarTomlRouter = require("./routes/stellarToml");
const claimableBalancesRouter = require("./routes/claimableBalances");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security & Parsing ──────────────────────────────────────────────────────
app.use(helmet());
app.use(compression({ threshold: 0 }));
app.use(cors());
app.use(contentTypeValidator);
app.use(bodySizeLimit);
app.use(hpp({ whitelist: ["limit", "order", "cursor", "operations"] }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ── Rate Limiting ───────────────────────────────────────────────────────────
app.use(rateLimiter);

// ── Input Sanitization ──────────────────────────────────────────────────────
app.use(sanitize);

// ── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      service: "StellarKit API",
      version: require("../package.json").version,
      timestamp: new Date().toISOString(),
      network: process.env.STELLAR_NETWORK || "testnet",
    },
  });
});

// ── API Key Authentication ─────────────────────────────────────────────────────
app.use(apiKeyMiddleware);

// ── API Routes ───────────────────────────────────────────────────────────────
app.use("/network-status", networkStatusRouter);
app.use("/fee-estimate", feeEstimateRouter);
const accountCounterpartiesRouter = require("./routes/account.counterparties");
app.use("/account", accountRouter);
app.use("/account", accountCounterpartiesRouter);
app.use("/transactions", transactionsRouter);
app.use("/asset", assetRouter);
app.use("/dex", dexRouter);
app.use("/liquidity-pools", liquidityPoolRouter);
app.use("/stream", streamRouter);
app.use("/utils", utilsRouter);
app.use("/stellar-toml", stellarTomlRouter);
app.use("/claimable-balances", claimableBalancesRouter);

// ── Root ─────────────────────────────────────────────────────────────────────
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
        { method: "GET", path: "/health",                           description: "Service health check" },
        { method: "GET", path: "/network-status",                   description: "Latest ledger, fees, and protocol info" },
        { method: "GET", path: "/fee-estimate",                     description: "Fee tiers for transaction submission" },
        { method: "GET", path: "/fee-estimate?operations=N",        description: "Fee estimate for N operations" },
        { method: "GET", path: "/account/:id",                      description: "Account details, balances, signers" },
        { method: "GET", path: "/account/:id/trustlines",           description: "Trustlines with TOML asset metadata resolved" },
        { method: "GET", path: "/transactions/:id",                 description: "Transaction history for an account" },
        { method: "GET", path: "/transactions/:id/operations",      description: "Operation history for an account" },
        { method: "GET", path: "/asset/:code/:issuer",              description: "Asset metadata and statistics" },
        { method: "GET", path: "/asset/search?code=:code",          description: "Search assets by code across all issuers" },
        { method: "WS",  path: "/stream/ledgers",                  description: "Real-time stream of live Stellar ledger updates" },
        { method: "GET", path: "/health", description: "Service health check" },
        { method: "GET", path: "/network-status", description: "Latest ledger, fees, and protocol info" },
        { method: "GET", path: "/fee-estimate", description: "Fee tiers for transaction submission" },
        { method: "GET", path: "/fee-estimate?operations=N", description: "Fee estimate for N operations" },
        { method: "GET", path: "/fee-estimate/surge-status", description: "Identify fee surge periods and get actionable recommendations" },
        { method: "GET", path: "/fee-estimate/trends", description: "Analyze fee trends across last 50 ledgers with statistical summary" },
        { method: "GET", path: "/account/:id", description: "Account details, balances, signers" },
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
        { method: "GET", path: "/utils/friendbot/:accountId", description: "Fund a testnet account via Friendbot (testnet only)" },
        { method: "GET", path: "/utils/convert?xlm=:xlm", description: "Convert between XLM and stroops" },
        { method: "GET", path: "/utils/validate-account?id=:id", description: "Validate a Stellar public key format (no Horizon call)" },
        { method: "WS", path: "/stream/ledgers", description: "Real-time stream of live Stellar ledger updates" },
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
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`\n🚀 StellarKit API running on port ${PORT}`);
    console.log(`🌐 Network : ${process.env.STELLAR_NETWORK || "testnet"}`);
    console.log(`📖 Docs    : http://localhost:${PORT}/\n`);
  });
  setupWebSocket(server);
}

module.exports = app;
