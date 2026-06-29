import type {
  HealthResponse,
  NetworkStatusResponse,
  FeeEstimateResponse,
  AccountResponse,
  AccountAgeResponse,
  AccountBalancesResponse,
  AccountRiskScoreResponse,
  AccountSignersResponse,
  AccountTrustlinesResponse,
  AccountPaymentsResponse,
  TransactionHistoryResponse,
  OperationHistoryResponse,
  AssetResponse,
  AssetSearchResponse,
  PoolPositionsResponse,
  TransactionSearchResponse,
} from "../types/index.d";

/**
 * Typed error thrown by StellarKitClient on non-2xx API responses.
 */
export class StellarKitError extends Error {
  /** HTTP status code returned by the API. */
  readonly status: number;
  /** Machine-readable error type from the API error envelope. */
  readonly type: string;

  constructor(message: string, status: number, type: string) {
    super(message);
    this.name = "StellarKitError";
    this.status = status;
    this.type = type;
  }
}

interface RequestOptions {
  method?: string;
  params?: Record<string, string | number | boolean | null | undefined> | null;
  body?: unknown;
}

/**
 * StellarKit API Client for TypeScript
 *
 * A lightweight wrapper for the StellarKit API endpoints with full type safety.
 */
export class StellarKitClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  /**
   * Create a new StellarKit API client.
   *
   * @param options.baseUrl - The base URL of the StellarKit API (e.g. 'https://api.stellarkit.io')
   * @param options.apiKey - Optional API key for authentication
   */
  constructor({ baseUrl, apiKey }: { baseUrl: string; apiKey?: string }) {
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
   * @param path - API endpoint path
   * @param options - Request options
   * @returns The 'data' field of the API response
   * @throws {StellarKitError} If the request fails or returns a non-200 response
   */
  private async _request<T>(
    path: string,
    { method = "GET", params = null, body = null }: RequestOptions = {},
  ): Promise<T> {
    let urlString = `${this.baseUrl}${path}`;

    if (params) {
      const url = new URL(urlString, "http://dummy.com"); // Need a base for URL constructor
      Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
      urlString = urlString.includes("?")
        ? `${urlString}&${url.searchParams.toString()}`
        : `${this.baseUrl}${path}?${url.searchParams.toString()}`;
    }

    const headers: Record<string, string> = {
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
        result.error?.type || "ApiError",
      );
    }

    return result.data;
  }

  /**
   * Service health check.
   *
   * @returns Health status
   */
  async getHealth(): Promise<HealthResponse["data"]> {
    return this._request("/health");
  }

  // ── Network ────────────────────────────────────────────────────────────────

  /**
   * Get current Stellar network info (latest ledger, fees, and protocol info).
   *
   * @returns Network status data
   */
  async getNetworkStatus(): Promise<NetworkStatusResponse["data"]> {
    return this._request("/network-status");
  }

  /**
   * Analyze network ledger close time consistency across the last 50 ledgers.
   *
   * @returns Ledger timing statistics
   */
  async getNetworkLedgerTiming(): Promise<unknown> {
    return this._request("/network-status/ledger-timing");
  }

  // ── Fee Estimates ─────────────────────────────────────────────────────────

  /**
   * Get fee tiers for transaction submission.
   *
   * @param operations - Number of operations in the transaction (default: 1)
   * @param fresh - When true, bypasses the server-side cache and fetches live data
   * @returns Fee estimate data
   */
  async getFeeEstimate(
    operations: number = 1,
    fresh: boolean = false,
  ): Promise<FeeEstimateResponse["data"]> {
    const params: Record<string, string | number | boolean> = { operations };
    if (fresh) params.fresh = fresh;
    return this._request("/fee-estimate", { params });
  }

  /**
   * Identify current fee surge periods and get actionable recommendations.
   *
   * @returns Surge status data
   */
  async getFeeSurgeStatus(): Promise<unknown> {
    return this._request("/fee-estimate/surge-status");
  }

  /**
   * Analyze fee trends across the last 50 ledgers with a statistical summary.
   *
   * @returns Fee trends data
   */
  async getFeeTrends(): Promise<unknown> {
    return this._request("/fee-estimate/trends");
  }

  // ── Account ────────────────────────────────────────────────────────────────

  /**
   * Get full account details including XLM balance, all asset balances, signers, and thresholds.
   *
   * @param accountId - Stellar account public key
   * @returns Account details
   */
  async getAccount(accountId: string): Promise<AccountResponse["data"]> {
    return this._request(`/account/${accountId}`);
  }

  /**
   * Get account age and longevity metrics for trust and reputation systems.
   *
   * @param accountId - Stellar account public key
   * @returns Account age details
   */
  async getAccountAge(accountId: string): Promise<AccountAgeResponse["data"]> {
    return this._request(`/account/${accountId}/age`);
  }

  /**
   * Get only native XLM and asset balances for an account.
   *
   * @param accountId - Stellar account public key
   * @returns Account balances
   */
  async getAccountBalances(
    accountId: string,
  ): Promise<AccountBalancesResponse["data"]> {
    return this._request(`/account/${accountId}/balances`);
  }

  /**
   * Fetches all balances and converts each to an equivalent XLM value using current DEX prices.
   *
   * @param accountId - Stellar account public key
   * @returns Balances with XLM equivalents
   */
  async getAccountXlmEquivalentBalances(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/balances/xlm-equivalent`);
  }

  /**
   * Computes a simple risk score for a Stellar account based on on-chain signals.
   *
   * @param accountId - Stellar account public key
   * @returns Risk score and factors
   */
  async getAccountRiskScore(
    accountId: string,
  ): Promise<AccountRiskScoreResponse["data"]> {
    return this._request(`/account/${accountId}/risk-score`);
  }

  /**
   * Returns a complete health overview of all trustlines on an account.
   *
   * @param accountId - Stellar account public key
   * @returns Trustline health overview
   */
  async getAccountTrustlineHealth(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/trustline-health`);
  }

  /**
   * Get the current sequence number for an account.
   *
   * @param accountId - Stellar account public key
   * @returns Account sequence data
   */
  async getAccountSequence(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/sequence`);
  }

  /**
   * Check if an asset trustline is frozen or partially frozen on an account.
   *
   * @param accountId - Stellar account public key
   * @param assetCode - Asset code (e.g. 'USDC')
   * @param assetIssuer - Asset issuer public key (or 'native' for XLM)
   * @returns Freeze status data
   */
  async getAccountFreezeStatus(
    accountId: string,
    assetCode: string,
    assetIssuer: string,
  ): Promise<unknown> {
    return this._request(
      `/account/${accountId}/freeze-status/${assetCode}/${assetIssuer}`,
    );
  }

  /**
   * Check whether an account can receive a specific asset (trustline, authorization, capacity).
   *
   * @param accountId - Stellar account public key
   * @param assetCode - Asset code
   * @param assetIssuer - Asset issuer (or 'native')
   * @returns Receive eligibility data
   */
  async getAccountCanReceive(
    accountId: string,
    assetCode: string,
    assetIssuer: string,
  ): Promise<unknown> {
    return this._request(
      `/account/${accountId}/can-receive/${assetCode}/${assetIssuer}`,
    );
  }

  /**
   * Detect how long an account has been inactive by analyzing its most recent transaction.
   *
   * @param accountId - Stellar account public key
   * @returns Inactivity metrics
   */
  async getAccountInactivity(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/inactivity`);
  }

  /**
   * Resolves the full sponsorship structure of an account (sponsors and sponsored entries).
   *
   * @param accountId - Stellar account public key
   * @returns Sponsorship details
   */
  async getAccountSponsorship(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/sponsorship`);
  }

  /**
   * Analyzes an account's subentry usage and warns when approaching the protocol limit.
   *
   * @param accountId - Stellar account public key
   * @returns Subentry health report
   */
  async getAccountSubentryHealth(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/subentry-health`);
  }

  /**
   * Get a consolidated summary of account info, recent transactions, and open offers.
   *
   * @param accountId - Stellar account public key
   * @returns Account summary
   */
  async getAccountSummary(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/summary`);
  }

  /**
   * Get all trustlines for an account with asset metadata resolved from issuer TOML files.
   *
   * @param accountId - Stellar account public key
   * @returns Trustlines with metadata
   */
  async getAccountTrustlines(
    accountId: string,
  ): Promise<AccountTrustlinesResponse["data"]> {
    return this._request(`/account/${accountId}/trustlines`);
  }

  /**
   * Checks whether an account is eligible to be merged (no assets, offers, or trustlines).
   *
   * @param accountId - Stellar account public key
   * @returns Merge eligibility status
   */
  async getAccountMergeEligibility(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/merge-eligibility`);
  }

  /**
   * Returns only payment and create_account operations for an account.
   *
   * @param accountId - Stellar account public key
   * @param options - Pagination options
   * @returns Payment operations list
   */
  async getAccountPayments(
    accountId: string,
    options: {
      limit?: number;
      order?: string;
      cursor?: string;
    } = {},
  ): Promise<AccountPaymentsResponse["data"]> {
    return this._request(`/account/${accountId}/payments`, {
      params: options,
    });
  }

  /**
   * Returns a unified chronological timeline of meaningful events for an account.
   *
   * @param accountId - Stellar account public key
   * @param options - Pagination options
   * @returns Timeline events list
   */
  async getAccountTimeline(
    accountId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<unknown> {
    return this._request(`/account/${accountId}/timeline`, {
      params: options,
    });
  }

  /**
   * Analyzes recent operations and returns a breakdown by operation type.
   *
   * @param accountId - Stellar account public key
   * @returns Operation breakdown statistics
   */
  async getAccountOperationBreakdown(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/operation-breakdown`);
  }

  /**
   * Returns the full history of offers created, updated, and deleted by an account.
   *
   * @param accountId - Stellar account public key
   * @param options - Pagination options
   * @returns Offer history list
   */
  async getAccountOfferHistory(
    accountId: string,
    options: {
      limit?: number;
      order?: string;
      cursor?: string;
    } = {},
  ): Promise<unknown> {
    return this._request(`/account/${accountId}/offer-history`, {
      params: options,
    });
  }

  /**
   * Computes total transaction volume for a Stellar account over the last N days.
   *
   * @param accountId - Stellar account public key
   * @param days - Number of days to analyze (1-90, default: 30)
   * @returns Volume analysis by asset
   */
  async getAccountVolume(
    accountId: string,
    days: number = 30,
  ): Promise<unknown> {
    return this._request(`/account/${accountId}/volume`, {
      params: { days },
    });
  }

  /**
   * Checks whether a given set of signers has enough combined weight to meet account thresholds.
   *
   * @param accountId - Stellar account public key
   * @param signers - Array of public keys to validate
   * @returns Signer validation result
   */
  async validateAccountSigners(
    accountId: string,
    signers: string[],
  ): Promise<unknown> {
    return this._request(`/account/${accountId}/validate-signers`, {
      method: "POST",
      body: { signers },
    });
  }

  /**
   * Plans multisig transactions by calculating signer combinations for each threshold.
   *
   * @param accountId - Stellar account public key
   * @param availableSigners - Array of available public keys
   * @returns Multisig plan
   */
  async createMultisigPlan(
    accountId: string,
    availableSigners: string[],
  ): Promise<unknown> {
    return this._request(`/account/${accountId}/multisig-plan`, {
      method: "POST",
      body: { availableSigners },
    });
  }

  /**
   * Returns claimable balances that the account is eligible to claim right now.
   *
   * @param accountId - Stellar account public key
   * @returns Eligible claimable balances
   */
  async getEligibleClaimableBalances(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/claimable-balances/eligible`);
  }

  /**
   * Returns all data entries for an account with both raw and decoded values.
   *
   * @param accountId - Stellar account public key
   * @returns List of data entries
   */
  async getAccountData(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/data`);
  }

  /**
   * Returns a single account data entry by key.
   *
   * @param accountId - Stellar account public key
   * @param key - The data entry key
   * @returns Single data entry
   */
  async getAccountDataEntry(accountId: string, key: string): Promise<unknown> {
    return this._request(`/account/${accountId}/data/${key}`);
  }

  /**
   * Searches transaction history for an account and filters results by memo content.
   *
   * @param accountId - Stellar account public key
   * @param memo - Memo value to search for
   * @param options - Search options
   * @returns Matching transactions list
   */
  async searchAccountTransactions(
    accountId: string,
    memo: string,
    options: {
      memo_type?: string;
      limit?: number;
      order?: string;
      cursor?: string;
    } = {},
  ): Promise<TransactionSearchResponse["data"]> {
    return this._request(`/account/${accountId}/transactions/search`, {
      params: { memo, ...options },
    });
  }

  /**
   * Calculates the current value of a provider's positions in all liquidity pools.
   *
   * @param accountId - Stellar account public key
   * @returns Liquidity pool positions
   */
  async getAccountPoolPositions(
    accountId: string,
  ): Promise<PoolPositionsResponse["data"]> {
    return this._request(`/account/${accountId}/pool-positions`);
  }

  /**
   * Analyze frequent payment counterparties for an account.
   *
   * @param accountId - Stellar account public key
   * @returns Counterparty analysis
   */
  async getAccountCounterparties(accountId: string): Promise<unknown> {
    return this._request(`/account/${accountId}/counterparties`);
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  /**
   * Get paginated transaction history for an account.
   *
   * @param accountId - Stellar account public key
   * @param options - Pagination options
   * @returns Transactions history
   */
  async getTransactionHistory(
    accountId: string,
    options: {
      limit?: number;
      order?: string;
      cursor?: string;
    } = {},
  ): Promise<TransactionHistoryResponse["data"]> {
    return this._request(`/transactions/${accountId}`, { params: options });
  }

  /**
   * Returns the list of operations within each transaction for an account.
   *
   * @param accountId - Stellar account public key
   * @param options - Pagination options
   * @returns Operations history
   */
  async getTransactionOperations(
    accountId: string,
    options: {
      limit?: number;
      order?: string;
      cursor?: string;
    } = {},
  ): Promise<OperationHistoryResponse["data"]> {
    return this._request(`/transactions/${accountId}/operations`, {
      params: options,
    });
  }

  /**
   * Checks the confirmation status of multiple transaction hashes.
   *
   * @param hashes - Array of transaction hashes (max 20)
   * @returns Status of each hash
   */
  async getBatchTransactionStatus(hashes: string[]): Promise<unknown> {
    return this._request("/transactions/batch-status", {
      method: "POST",
      body: { hashes },
    });
  }

  // ── Assets ─────────────────────────────────────────────────────────────────

  /**
   * Returns metadata and statistics for a Stellar asset.
   *
   * @param code - Asset code
   * @param issuer - Asset issuer public key
   * @returns Asset metadata
   */
  async getAsset(code: string, issuer: string): Promise<AssetResponse["data"]> {
    return this._request(`/asset/${code}/${issuer}`);
  }

  /**
   * Returns paginated accounts that hold a trustline for a specific asset.
   *
   * @param code - Asset code
   * @param issuer - Asset issuer public key
   * @param options - Pagination options
   * @returns Asset holders list
   */
  async getAssetHolders(
    code: string,
    issuer: string,
    options: {
      limit?: number;
      order?: string;
      cursor?: string;
    } = {},
  ): Promise<unknown> {
    return this._request(`/asset/${code}/${issuer}/holders`, {
      params: options,
    });
  }

  /**
   * Analyzes the distribution of holders for a Stellar asset.
   *
   * @param code - Asset code
   * @param issuer - Asset issuer public key
   * @returns Distribution metrics
   */
  async getAssetDistribution(code: string, issuer: string): Promise<unknown> {
    return this._request(`/asset/${code}/${issuer}/distribution`);
  }

  /**
   * Returns full supply breakdown for a Stellar asset.
   *
   * @param code - Asset code
   * @param issuer - Asset issuer public key
   * @returns Supply breakdown
   */
  async getAssetSupply(code: string, issuer: string): Promise<unknown> {
    return this._request(`/asset/${code}/${issuer}/supply`);
  }

  /**
   * Verifies an asset issuer via account flags, home_domain, and stellar.toml.
   *
   * @param code - Asset code
   * @param issuer - Asset issuer public key
   * @returns Verification report
   */
  async verifyAsset(code: string, issuer: string): Promise<unknown> {
    return this._request(`/asset/${code}/${issuer}/verify`);
  }

  /**
   * Search for all assets matching a given code across all issuers.
   *
   * @param code - Asset code to search for
   * @param limit - Number of records (default: 10)
   * @returns Matching assets list
   */
  async searchAssets(
    code: string,
    limit: number = 10,
  ): Promise<AssetSearchResponse["data"]> {
    return this._request("/asset/search", { params: { code, limit } });
  }

  // ── DEX ───────────────────────────────────────────────────────────────────

  /**
   * Checks for circular paths back to the same asset to find arbitrage opportunities.
   *
   * @param assetCode - Asset code
   * @param assetIssuer - Asset issuer (or 'native')
   * @returns Arbitrage paths
   */
  async getArbitragePaths(
    assetCode: string,
    assetIssuer: string,
  ): Promise<unknown> {
    return this._request(`/dex/arbitrage/${assetCode}/${assetIssuer}`);
  }

  /**
   * Calculates the bid-ask spread for a trading pair on the Stellar DEX.
   *
   * @param sellAsset - Asset to sell (e.g. 'XLM:native')
   * @param buyAsset - Asset to buy
   * @returns Spread and order book data
   */
  async getDexSpread(sellAsset: string, buyAsset: string): Promise<unknown> {
    return this._request(`/dex/spread/${sellAsset}/${buyAsset}`);
  }

  /**
   * Detects buy/sell pressure imbalance on a Stellar DEX trading pair.
   *
   * @param sellAsset - Asset to sell
   * @param buyAsset - Asset to buy
   * @returns Imbalance metrics
   */
  async getDexImbalance(sellAsset: string, buyAsset: string): Promise<unknown> {
    return this._request(`/dex/imbalance/${sellAsset}/${buyAsset}`);
  }

  /**
   * Analyzes the full depth of a Stellar DEX order book for a trading pair.
   *
   * @param sellAsset - Asset to sell
   * @param buyAsset - Asset to buy
   * @returns Order book depth analysis
   */
  async getDexDepth(sellAsset: string, buyAsset: string): Promise<unknown> {
    return this._request(`/dex/depth/${sellAsset}/${buyAsset}`);
  }

  /**
   * Calculates the effective exchange rate via the best available payment path.
   *
   * @param sellAsset - Asset to sell
   * @param buyAsset - Asset to buy
   * @param amount - Amount to convert (default: 1)
   * @returns Exchange rate and best path
   */
  async getDexPrice(
    sellAsset: string,
    buyAsset: string,
    amount: number = 1,
  ): Promise<unknown> {
    return this._request(`/dex/price/${sellAsset}/${buyAsset}`, {
      params: { amount },
    });
  }

  // ── Liquidity Pools ────────────────────────────────────────────────────────

  /**
   * Estimates annualized fee income for a liquidity pool.
   *
   * @param poolId - Liquidity Pool ID
   * @returns Profitability estimate
   */
  async getPoolProfitability(poolId: string): Promise<unknown> {
    return this._request(`/liquidity-pools/${poolId}/profitability`);
  }

  /**
   * Returns the current reserve ratio and drift for a liquidity pool.
   *
   * @param poolId - Liquidity Pool ID
   * @returns Reserve ratio details
   */
  async getPoolReserveRatio(poolId: string): Promise<unknown> {
    return this._request(`/liquidity-pools/${poolId}/reserve-ratio`);
  }

  // ── Claimable Balances ─────────────────────────────────────────────────────

  /**
   * Evaluate whether a specific claimable balance is claimable by an account right now.
   *
   * @param balanceId - Claimable Balance ID
   * @param accountId - Stellar account public key
   * @returns Claimability evaluation
   */
  async evaluateClaimableBalance(
    balanceId: string,
    accountId: string,
  ): Promise<unknown> {
    return this._request(
      `/claimable-balances/${balanceId}/evaluate/${accountId}`,
    );
  }

  // ── Utils ──────────────────────────────────────────────────────────────────

  /**
   * Fund a testnet account via Friendbot (testnet only).
   *
   * @param accountId - Stellar account public key
   * @returns Friendbot response
   */
  async fundAccount(accountId: string): Promise<unknown> {
    return this._request(`/utils/friendbot/${accountId}`);
  }

  /**
   * Decode a raw Horizon memo into a human-friendly representation.
   *
   * @param type - Memo type ('text', 'id', 'hash', 'return')
   * @param value - Raw memo value
   * @returns Decoded memo
   */
  async decodeMemo(type: string, value: string): Promise<unknown> {
    return this._request("/utils/memo", { params: { type, value } });
  }

  /**
   * Encode or decode a string using Base64.
   *
   * @param options - Options with either encode or decode property
   * @returns Base64 operation result
   */
  async base64(options: {
    encode?: string;
    decode?: string;
  }): Promise<unknown> {
    return this._request("/utils/base64", { params: options });
  }

  /**
   * Validate whether a given string is a valid Stellar asset code.
   *
   * @param code - Asset code to validate
   * @returns Validation result
   */
  async validateAsset(code: string): Promise<unknown> {
    return this._request("/utils/validate-asset", { params: { code } });
  }

  /**
   * Validate a Stellar public key format (no Horizon call).
   *
   * @param accountId - The account ID to validate
   * @returns Validation result
   */
  async validateAccount(accountId: string): Promise<unknown> {
    return this._request("/utils/validate-account", {
      params: { id: accountId },
    });
  }

  /**
   * Decode a base64-encoded Stellar transaction XDR envelope into JSON.
   *
   * @param xdr - The base64-encoded transaction XDR envelope
   * @returns Decoded transaction data
   */
  async decodeXdr(xdr: string): Promise<unknown> {
    return this._request("/utils/decode-xdr", {
      method: "POST",
      body: { xdr },
    });
  }

  /**
   * Generates a new random Stellar keypair for testnet use.
   *
   * @returns New keypair (publicKey, secretKey)
   */
  async generateKeypair(): Promise<unknown> {
    return this._request("/utils/keypair");
  }

  // ── Stellar TOML ───────────────────────────────────────────────────────────

  /**
   * Fetch and parse a stellar.toml file from a domain.
   *
   * @param domain - The domain to fetch stellar.toml from (e.g. 'stellar.org')
   * @returns Parsed TOML data
   */
  async getStellarToml(domain: string): Promise<unknown> {
    return this._request(`/stellar-toml/${domain}`);
  }
}

// CommonJS/UMD compatibility
(StellarKitClient as any).default = StellarKitClient;
if (typeof module !== "undefined" && module.exports) {
  module.exports = StellarKitClient;
} else if (typeof window !== "undefined") {
  (window as any).StellarKitClient = StellarKitClient;
}
