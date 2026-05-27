require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const { setupWebSocket } = require("./websocket");

const rateLimiter = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");

const networkStatusRouter = require("./routes/networkStatus");
const feeEstimateRouter = require("./routes/feeEstimate");
const accountRouter = require("./routes/account");
const transactionsRouter = require("./routes/transactions");
const assetRouter = require("./routes/asset");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security & Parsing ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ── Rate Limiting ───────────────────────────────────────────────────────────
app.use(rateLimiter);

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

// ── API Routes ───────────────────────────────────────────────────────────────
app.use("/network-status", networkStatusRouter);
app.use("/fee-estimate", feeEstimateRouter);
app.use("/account", accountRouter);
app.use("/transactions", transactionsRouter);
app.use("/asset", assetRouter);

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
        { method: "GET", path: "/account/:id/offers",                description: "Open DEX offers for an account" },
        { method: "GET", path: "/transactions/:id",                 description: "Transaction history for an account" },
        { method: "GET", path: "/transactions/:id/operations",      description: "Operation history for an account" },
        { method: "GET", path: "/asset/:code/:issuer",              description: "Asset metadata and statistics" },
        { method: "GET", path: "/asset/search?code=:code",          description: "Search assets by code across all issuers" },
        { method: "WS",  path: "/stream/ledgers",                  description: "Real-time stream of live Stellar ledger updates" },
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
