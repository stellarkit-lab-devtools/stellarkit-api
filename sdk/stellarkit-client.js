/**
 * Custom error class for StellarKit API errors.
 */
class StellarKitError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} status - HTTP status code
   * @param {string} type - Error type from API
   */
  constructor(message, status, type) {
    super(message);
    this.name = "StellarKitError";
    this.status = status;
    this.type = type;
  }
}

/**
 * StellarKit API Client for JavaScript
 * 
 * A lightweight wrapper for the StellarKit API endpoints.
 */
class StellarKitClient {
  /**
   * Create a new StellarKit API client.
   * 
   * @param {Object} options - Configuration options
   * @param {string} options.baseUrl - The base URL of the StellarKit API (e.g. 'https://api.stellarkit.io')
   * @param {string} [options.apiKey] - Optional API key for authentication
   */
  constructor({ baseUrl, apiKey }) {
    if (!baseUrl) {
      throw new Error("baseUrl is required");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  /**
   * Helper to make authorized requests to the API.
   * 
   * @private
   * @param {string} path - API endpoint path
   * @param {Object} [options] - Request options
   * @param {string} [options.method='GET'] - HTTP method
   * @param {Object} [options.params] - Query parameters
   * @param {Object} [options.body] - Request body
   * @returns {Promise<any>} The 'data' field of the API response
   * @throws {StellarKitError} If the request fails or returns a non-200 response
   */
  async _request(path, { method = "GET", params = null, body = null } = {}) {
    let urlString = `${this.baseUrl}${path}`;
    
    if (params) {
      const url = new URL(urlString, "http://dummy.com"); // Need a base for URL constructor
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
          url.searchParams.append(key, params[key]);
        }
      });
      urlString = urlString.includes("?") 
        ? `${urlString}&${url.searchParams.toString()}`
        : `${this.baseUrl}${path}?${url.searchParams.toString()}`;
    }

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const response = await fetch(urlString, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new StellarKitError(
        result.error?.message || response.statusText,
        response.status,
        result.error?.type || "ApiError"
      );
    }

    return result.data;
  }

  /**
   * Service health check.
   * 
   * @returns {Promise<Object>} Health status
   */
  async getHealth() {
    return this._request("/health");
  }

  // ── Network ────────────────────────────────────────────────────────────────

  /**
   * Get current Stellar network info (latest ledger, fees, and protocol info).
   * 
   * @returns {Promise<Object>} Network status data
   */
  async getNetworkStatus() {
    return this._request("/network-status");
  }

  /**
   * Analyze network ledger close time consistency across the last 50 ledgers.
   * 
   * @returns {Promise<Object>} Ledger timing statistics
   */
  async getNetworkLedgerTiming() {
    return this._request("/network-status/ledger-timing");
  }

  // ── Fee Estimates ─────────────────────────────────────────────────────────

  /**
   * Get fee tiers for transaction submission.
   * 
   * @param {number} [operations=1] - Number of operations in the transaction
   * @returns {Promise<Object>} Fee estimate data
   */
  async getFeeEstimate(operations = 1) {
    return this._request("/fee-estimate", { params: { operations } });
  }

  /**
   * Identify current fee surge periods and get actionable recommendations.
   * 
   * @returns {Promise<Object>} Surge status data
   */
  async getFeeSurgeStatus() {
    return this._request("/fee-estimate/surge-status");
  }

  /**
   * Analyze fee trends across the last 50 ledgers with a statistical summary.
   * 
   * @returns {Promise<Object>} Fee trends data
   */
  async getFeeTrends() {
    return this._request("/fee-estimate/trends");
  }

  // ── Account ────────────────────────────────────────────────────────────────

  /**
   * Get full account details including XLM balance, all asset balances, signers, and thresholds.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Account details
   */
  async getAccount(accountId) {
    return this._request(`/account/${accountId}`);
  }

  /**
   * Get account age and longevity metrics for trust and reputation systems.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Account age details
   */
  async getAccountAge(accountId) {
    return this._request(`/account/${accountId}/age`);
  }

  /**
   * Get only native XLM and asset balances for an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Account balances
   */
  async getAccountBalances(accountId) {
    return this._request(`/account/${accountId}/balances`);
  }

  /**
   * Fetches all balances and converts each to an equivalent XLM value using current DEX prices.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Balances with XLM equivalents
   */
  async getAccountXlmEquivalentBalances(accountId) {
    return this._request(`/account/${accountId}/balances/xlm-equivalent`);
  }

  /**
   * Computes a simple risk score for a Stellar account based on on-chain signals.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Risk score and factors
   */
  async getAccountRiskScore(accountId) {
    return this._request(`/account/${accountId}/risk-score`);
  }

  /**
   * Returns a complete health overview of all trustlines on an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Trustline health overview
   */
  async getAccountTrustlineHealth(accountId) {
    return this._request(`/account/${accountId}/trustline-health`);
  }

  /**
   * Get the current sequence number for an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Account sequence data
   */
  async getAccountSequence(accountId) {
    return this._request(`/account/${accountId}/sequence`);
  }

  /**
   * Check if an asset trustline is frozen or partially frozen on an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {string} assetCode - Asset code (e.g. 'USDC')
   * @param {string} assetIssuer - Asset issuer public key (or 'native' for XLM)
   * @returns {Promise<Object>} Freeze status data
   */
  async getAccountFreezeStatus(accountId, assetCode, assetIssuer) {
    return this._request(`/account/${accountId}/freeze-status/${assetCode}/${assetIssuer}`);
  }

  /**
   * Check whether an account can receive a specific asset (trustline, authorization, capacity).
   * 
   * @param {string} accountId - Stellar account public key
   * @param {string} assetCode - Asset code
   * @param {string} assetIssuer - Asset issuer (or 'native')
   * @returns {Promise<Object>} Receive eligibility data
   */
  async getAccountCanReceive(accountId, assetCode, assetIssuer) {
    return this._request(`/account/${accountId}/can-receive/${assetCode}/${assetIssuer}`);
  }

  /**
   * Detect how long an account has been inactive by analyzing its most recent transaction.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Inactivity metrics
   */
  async getAccountInactivity(accountId) {
    return this._request(`/account/${accountId}/inactivity`);
  }

  /**
   * Resolves the full sponsorship structure of an account (sponsors and sponsored entries).
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Sponsorship details
   */
  async getAccountSponsorship(accountId) {
    return this._request(`/account/${accountId}/sponsorship`);
  }

  /**
   * Analyzes an account's subentry usage and warns when approaching the protocol limit.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Subentry health report
   */
  async getAccountSubentryHealth(accountId) {
    return this._request(`/account/${accountId}/subentry-health`);
  }

  /**
   * Get a consolidated summary of account info, recent transactions, and open offers.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Account summary
   */
  async getAccountSummary(accountId) {
    return this._request(`/account/${accountId}/summary`);
  }

  /**
   * Get all trustlines for an account with asset metadata resolved from issuer TOML files.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Trustlines with metadata
   */
  async getAccountTrustlines(accountId) {
    return this._request(`/account/${accountId}/trustlines`);
  }

  /**
   * Checks whether an account is eligible to be merged (no assets, offers, or trustlines).
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Merge eligibility status
   */
  async getAccountMergeEligibility(accountId) {
    return this._request(`/account/${accountId}/merge-eligibility`);
  }

  /**
   * Returns only payment and create_account operations for an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {Object} [options] - Pagination options
   * @param {number} [options.limit=10] - Number of records (max 200)
   * @param {string} [options.order='desc'] - Sort order ('asc' or 'desc')
   * @param {string} [options.cursor] - Pagination cursor
   * @returns {Promise<Object>} Payment operations list
   */
  async getAccountPayments(accountId, { limit, order, cursor } = {}) {
    return this._request(`/account/${accountId}/payments`, { params: { limit, order, cursor } });
  }

  /**
   * Returns a unified chronological timeline of meaningful events for an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {Object} [options] - Pagination options
   * @param {number} [options.limit=10] - Number of records (max 50)
   * @param {string} [options.cursor] - Pagination cursor
   * @returns {Promise<Object>} Timeline events list
   */
  async getAccountTimeline(accountId, { limit, cursor } = {}) {
    return this._request(`/account/${accountId}/timeline`, { params: { limit, cursor } });
  }

  /**
   * Analyzes recent operations and returns a breakdown by operation type.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Operation breakdown statistics
   */
  async getAccountOperationBreakdown(accountId) {
    return this._request(`/account/${accountId}/operation-breakdown`);
  }

  /**
   * Returns the full history of offers created, updated, and deleted by an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {Object} [options] - Pagination options
   * @param {number} [options.limit=10] - Number of records
   * @param {string} [options.order='desc'] - Sort order
   * @param {string} [options.cursor] - Pagination cursor
   * @returns {Promise<Object>} Offer history list
   */
  async getAccountOfferHistory(accountId, { limit, order, cursor } = {}) {
    return this._request(`/account/${accountId}/offer-history`, { params: { limit, order, cursor } });
  }

  /**
   * Computes total transaction volume for a Stellar account over the last N days.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {number} [days=30] - Number of days to analyze (1-90)
   * @returns {Promise<Object>} Volume analysis by asset
   */
  async getAccountVolume(accountId, days = 30) {
    return this._request(`/account/${accountId}/volume`, { params: { days } });
  }

  /**
   * Checks whether a given set of signers has enough combined weight to meet account thresholds.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {string[]} signers - Array of public keys to validate
   * @returns {Promise<Object>} Signer validation result
   */
  async validateAccountSigners(accountId, signers) {
    return this._request(`/account/${accountId}/validate-signers`, {
      method: "POST",
      body: { signers },
    });
  }

  /**
   * Plans multisig transactions by calculating signer combinations for each threshold.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {string[]} availableSigners - Array of available public keys
   * @returns {Promise<Object>} Multisig plan
   */
  async createMultisigPlan(accountId, availableSigners) {
    return this._request(`/account/${accountId}/multisig-plan`, {
      method: "POST",
      body: { availableSigners },
    });
  }

  /**
   * Returns claimable balances that the account is eligible to claim right now.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Eligible claimable balances
   */
  async getEligibleClaimableBalances(accountId) {
    return this._request(`/account/${accountId}/claimable-balances/eligible`);
  }

  /**
   * Returns all data entries for an account with both raw and decoded values.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} List of data entries
   */
  async getAccountData(accountId) {
    return this._request(`/account/${accountId}/data`);
  }

  /**
   * Returns a single account data entry by key.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {string} key - The data entry key
   * @returns {Promise<Object>} Single data entry
   */
  async getAccountDataEntry(accountId, key) {
    return this._request(`/account/${accountId}/data/${key}`);
  }

  /**
   * Searches transaction history for an account and filters results by memo content.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {string} memo - Memo value to search for
   * @param {Object} [options] - Search options
   * @param {string} [options.memo_type] - Filter by memo type ('text', 'id', 'hash', 'return')
   * @param {number} [options.limit=10] - Number of records
   * @param {string} [options.order='desc'] - Sort order
   * @param {string} [options.cursor] - Pagination cursor
   * @returns {Promise<Object>} Matching transactions list
   */
  async searchAccountTransactions(accountId, memo, { memo_type, limit, order, cursor } = {}) {
    return this._request(`/account/${accountId}/transactions/search`, {
      params: { memo, memo_type, limit, order, cursor },
    });
  }

  /**
   * Calculates the current value of a provider's positions in all liquidity pools.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Liquidity pool positions
   */
  async getAccountPoolPositions(accountId) {
    return this._request(`/account/${accountId}/pool-positions`);
  }

  /**
   * Analyze frequent payment counterparties for an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Counterparty analysis
   */
  async getAccountCounterparties(accountId) {
    return this._request(`/account/${accountId}/counterparties`);
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  /**
   * Get paginated transaction history for an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {Object} [options] - Pagination options
   * @param {number} [options.limit=10] - Number of records
   * @param {string} [options.order='desc'] - Sort order
   * @param {string} [options.cursor] - Pagination cursor
   * @returns {Promise<Object>} Transactions history
   */
  async getTransactionHistory(accountId, { limit, order, cursor } = {}) {
    return this._request(`/transactions/${accountId}`, { params: { limit, order, cursor } });
  }

  /**
   * Returns the list of operations within each transaction for an account.
   * 
   * @param {string} accountId - Stellar account public key
   * @param {Object} [options] - Pagination options
   * @param {number} [options.limit=10] - Number of records
   * @param {string} [options.order='desc'] - Sort order
   * @param {string} [options.cursor] - Pagination cursor
   * @returns {Promise<Object>} Operations history
   */
  async getTransactionOperations(accountId, { limit, order, cursor } = {}) {
    return this._request(`/transactions/${accountId}/operations`, { params: { limit, order, cursor } });
  }

  /**
   * Checks the confirmation status of multiple transaction hashes.
   * 
   * @param {string[]} hashes - Array of transaction hashes (max 20)
   * @returns {Promise<Object>} Status of each hash
   */
  async getBatchTransactionStatus(hashes) {
    return this._request("/transactions/batch-status", {
      method: "POST",
      body: { hashes },
    });
  }

  // ── Assets ─────────────────────────────────────────────────────────────────

  /**
   * Returns metadata and statistics for a Stellar asset.
   * 
   * @param {string} code - Asset code
   * @param {string} issuer - Asset issuer public key
   * @returns {Promise<Object>} Asset metadata
   */
  async getAsset(code, issuer) {
    return this._request(`/asset/${code}/${issuer}`);
  }

  /**
   * Returns paginated accounts that hold a trustline for a specific asset.
   * 
   * @param {string} code - Asset code
   * @param {string} issuer - Asset issuer public key
   * @param {Object} [options] - Pagination options
   * @param {number} [options.limit=10] - Number of records
   * @param {string} [options.order='desc'] - Sort order
   * @param {string} [options.cursor] - Pagination cursor
   * @returns {Promise<Object>} Asset holders list
   */
  async getAssetHolders(code, issuer, { limit, order, cursor } = {}) {
    return this._request(`/asset/${code}/${issuer}/holders`, { params: { limit, order, cursor } });
  }

  /**
   * Analyzes the distribution of holders for a Stellar asset.
   * 
   * @param {string} code - Asset code
   * @param {string} issuer - Asset issuer public key
   * @returns {Promise<Object>} Distribution metrics
   */
  async getAssetDistribution(code, issuer) {
    return this._request(`/asset/${code}/${issuer}/distribution`);
  }

  /**
   * Returns full supply breakdown for a Stellar asset.
   * 
   * @param {string} code - Asset code
   * @param {string} issuer - Asset issuer public key
   * @returns {Promise<Object>} Supply breakdown
   */
  async getAssetSupply(code, issuer) {
    return this._request(`/asset/${code}/${issuer}/supply`);
  }

  /**
   * Verifies an asset issuer via account flags, home_domain, and stellar.toml.
   * 
   * @param {string} code - Asset code
   * @param {string} issuer - Asset issuer public key
   * @returns {Promise<Object>} Verification report
   */
  async verifyAsset(code, issuer) {
    return this._request(`/asset/${code}/${issuer}/verify`);
  }

  /**
   * Search for all assets matching a given code across all issuers.
   * 
   * @param {string} code - Asset code to search for
   * @param {number} [limit=10] - Number of records
   * @returns {Promise<Object>} Matching assets list
   */
  async searchAssets(code, limit = 10) {
    return this._request("/asset/search", { params: { code, limit } });
  }

  // ── DEX ───────────────────────────────────────────────────────────────────

  /**
   * Checks for circular paths back to the same asset to find arbitrage opportunities.
   * 
   * @param {string} assetCode - Asset code
   * @param {string} assetIssuer - Asset issuer (or 'native')
   * @returns {Promise<Object>} Arbitrage paths
   */
  async getArbitragePaths(assetCode, assetIssuer) {
    return this._request(`/dex/arbitrage/${assetCode}/${assetIssuer}`);
  }

  /**
   * Calculates the bid-ask spread for a trading pair on the Stellar DEX.
   * 
   * @param {string} sellAsset - Asset to sell (e.g. 'XLM:native')
   * @param {string} buyAsset - Asset to buy (e.g. 'USDC:GA5Z...')
   * @returns {Promise<Object>} Spread and order book data
   */
  async getDexSpread(sellAsset, buyAsset) {
    return this._request(`/dex/spread/${sellAsset}/${buyAsset}`);
  }

  /**
   * Detects buy/sell pressure imbalance on a Stellar DEX trading pair.
   * 
   * @param {string} sellAsset - Asset to sell
   * @param {string} buyAsset - Asset to buy
   * @returns {Promise<Object>} Imbalance metrics
   */
  async getDexImbalance(sellAsset, buyAsset) {
    return this._request(`/dex/imbalance/${sellAsset}/${buyAsset}`);
  }

  /**
   * Analyzes the full depth of a Stellar DEX order book.
   * 
   * @param {string} sellAsset - Asset to sell
   * @param {string} buyAsset - Asset to buy
   * @returns {Promise<Object>} Order book depth analysis
   */
  async getDexDepth(sellAsset, buyAsset) {
    return this._request(`/dex/depth/${sellAsset}/${buyAsset}`);
  }

  /**
   * Calculates the effective exchange rate via the best available payment path.
   * 
   * @param {string} sellAsset - Asset to sell
   * @param {string} buyAsset - Asset to buy
   * @param {number} [amount=1] - Amount to convert
   * @returns {Promise<Object>} Exchange rate and best path
   */
  async getDexPrice(sellAsset, buyAsset, amount = 1) {
    return this._request(`/dex/price/${sellAsset}/${buyAsset}`, { params: { amount } });
  }

  // ── Liquidity Pools ────────────────────────────────────────────────────────

  /**
   * Estimates annualized fee income for a liquidity pool.
   * 
   * @param {string} poolId - Liquidity Pool ID
   * @returns {Promise<Object>} Profitability estimate
   */
  async getPoolProfitability(poolId) {
    return this._request(`/liquidity-pools/${poolId}/profitability`);
  }

  /**
   * Returns the current reserve ratio and drift for a liquidity pool.
   * 
   * @param {string} poolId - Liquidity Pool ID
   * @returns {Promise<Object>} Reserve ratio details
   */
  async getPoolReserveRatio(poolId) {
    return this._request(`/liquidity-pools/${poolId}/reserve-ratio`);
  }

  // ── Claimable Balances ─────────────────────────────────────────────────────

  /**
   * Evaluate whether a specific claimable balance is claimable by an account right now.
   * 
   * @param {string} balanceId - Claimable Balance ID
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Claimability evaluation
   */
  async evaluateClaimableBalance(balanceId, accountId) {
    return this._request(`/claimable-balances/${balanceId}/evaluate/${accountId}`);
  }

  // ── Utils ──────────────────────────────────────────────────────────────────

  /**
   * Fund a testnet account via Friendbot (testnet only).
   * 
   * @param {string} accountId - Stellar account public key
   * @returns {Promise<Object>} Friendbot response
   */
  async fundAccount(accountId) {
    return this._request(`/utils/friendbot/${accountId}`);
  }

  /**
   * Decode a raw Horizon memo into a human-friendly representation.
   * 
   * @param {string} type - Memo type ('text', 'id', 'hash', 'return')
   * @param {string} value - Raw memo value
   * @returns {Promise<Object>} Decoded memo
   */
  async decodeMemo(type, value) {
    return this._request("/utils/memo", { params: { type, value } });
  }

  /**
   * Encode or decode a string using Base64.
   * 
   * @param {Object} options - Options
   * @param {string} [options.encode] - String to encode
   * @param {string} [options.decode] - Base64 string to decode
   * @returns {Promise<Object>} Base64 operation result
   */
  async base64(options) {
    return this._request("/utils/base64", { params: options });
  }

  /**
   * Validate whether a given string is a valid Stellar asset code.
   * 
   * @param {string} code - Asset code to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateAsset(code) {
    return this._request("/utils/validate-asset", { params: { code } });
  }

  /**
   * Validate a Stellar public key format (no Horizon call).
   * 
   * @param {string} accountId - The account ID to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateAccount(accountId) {
    return this._request("/utils/validate-account", { params: { id: accountId } });
  }

  /**
   * Decode a base64-encoded Stellar transaction XDR envelope into JSON.
   * 
   * @param {string} xdr - The base64-encoded transaction XDR envelope
   * @returns {Promise<Object>} Decoded transaction data
   */
  async decodeXdr(xdr) {
    return this._request("/utils/decode-xdr", {
      method: "POST",
      body: { xdr },
    });
  }

  /**
   * Generates a new random Stellar keypair for testnet use.
   * 
   * @returns {Promise<Object>} New keypair (publicKey, secretKey)
   */
  async generateKeypair() {
    return this._request("/utils/keypair");
  }

  // ── Stellar TOML ───────────────────────────────────────────────────────────

  /**
   * Fetch and parse a stellar.toml file from a domain.
   * 
   * @param {string} domain - The domain to fetch stellar.toml from (e.g. 'stellar.org')
   * @returns {Promise<Object>} Parsed TOML data
   */
  async getStellarToml(domain) {
    return this._request(`/stellar-toml/${domain}`);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = StellarKitClient;
} else if (typeof window !== "undefined") {
  window.StellarKitClient = StellarKitClient;
}
