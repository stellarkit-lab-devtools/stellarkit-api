const express = require("express");
const { success } = require("../utils/response");

const router = express.Router();

// Map of route descriptions - built from actual mounted routes
const routeDescriptions = new Map();

// Common endpoint descriptions
const commonDescriptions = {
  '/health': 'Service health check',
  '/network-status': 'Latest ledger, fees, and protocol info',
  '/network-status/*': 'Network status endpoints',
  '/fee-estimate': 'Fee tiers for transaction submission',
  '/fee-estimate/*': 'Fee estimate endpoints',
  '/account/:id': 'Account details, balances, signers',
  '/account/:id/*': 'Account endpoints',
  '/accounts': 'Batch account operations',
  '/accounts/*': 'Account endpoints',
  '/transactions': 'Transaction history and submission',
  '/transactions/*': 'Transaction endpoints',
  '/asset/:code/:issuer': 'Asset metadata and statistics',
  '/asset/:code/:issuer/*': 'Asset endpoints',
  '/asset/*': 'Asset search and info',
  '/dex/*': 'DEX trading and arbitrage',
  '/liquidity-pools/*': 'Liquidity pool information',
  '/soroban/*': 'Soroban smart contract interactions',
  '/stream/*': 'Real-time event streams',
  '/webhooks/*': 'Webhook management',
  '/utils/*': 'Utility endpoints',
  '/stellar-toml/*': 'Stellar.toml lookup',
  '/claimable-balances/*': 'Claimable balance operations',
  '/cache/*': 'Cache statistics',
  '/metrics': 'Service metrics',
  '/network/*': 'Network information',
};

/**
 * Register a route description
 * @param {string} path - Route path pattern
 * @param {string} description - Description of the route
 * @param {string} kind - 'http' (default), 'sse', 'websocket'
 */
function registerRoute(path, description, kind = 'http') {
  routeDescriptions.set(path, { description, kind });
}

/**
 * Get all registered descriptions
 */
function getRouteDescriptions() {
  return new Map(routeDescriptions);
}

/**
 * Clear descriptions (for testing)
 */
function clearRouteDescriptions() {
  routeDescriptions.clear();
}

// GET / - List all available endpoints
router.get("/", (req, res) => {
  const endpoints = [];
  const seen = new Set();

  // This function walks the app's router stack to build the endpoint list
  // We'll get this from the main app in the actual implementation
  
  // For now, return a basic list - this will be enhanced when integrated with the app
  return success(res, {
    message: "Endpoint discovery. Use /endpoints for full list.",
    endpoints: [],
  });
});

module.exports = router;
module.exports.registerRoute = registerRoute;
module.exports.getRouteDescriptions = getRouteDescriptions;
module.exports.clearRouteDescriptions = clearRouteDescriptions;