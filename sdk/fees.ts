import type { FeeEstimateResponse } from "../types/index.d";

/** Typed error thrown by FeesModule on non-2xx API responses. */
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

/** Surge status response data. */
export interface SurgeStatusData {
  isSurging: boolean;
  avgCapacityUsage: number;
  surgeThreshold: number;
  ledgersAnalyzed: number;
  capacityUsageDetails: number[];
  suggestedFee: number;
  suggestedFeeInXLM: string;
  recommendation: string;
  currentNetworkStats: {
    lastLedgerBaseFee: number;
    ledgerCapacityUsage: string;
    minFee: string;
    p50Fee: string;
    p95Fee: string;
  };
}

/** Fee trends response data. */
export interface FeeTrendsData {
  ledgersAnalyzed: number;
  trends: Array<{
    ledger: number;
    baseFee: number;
    capacityUsage: number;
  }>;
  summary: {
    avgBaseFee: number;
    minBaseFee: number;
    maxBaseFee: number;
    avgCapacityUsage: number;
  };
}

/** A fee value expressed in both stroops and XLM. */
export interface FeeAmount {
  /** Fee in stroops (integer). */
  stroops: number;
  /** Fee in XLM as a seven-decimal string (e.g. "0.0000100"). */
  xlm: string;
}

/** Fee percentiles response data from GET /network/fee-percentiles. */
export interface FeePercentiles {
  percentiles: {
    p10: FeeAmount;
    p20: FeeAmount;
    p30: FeeAmount;
    p50: FeeAmount;
    p70: FeeAmount;
    p90: FeeAmount;
    p95: FeeAmount;
    p99: FeeAmount;
  };
  baseFee: FeeAmount;
  minFee: FeeAmount;
  maxFee: FeeAmount;
  ledgerSequence: number | null;
  timestamp: string;
}

/** A single entry in a batch fee estimate request. */
export interface BatchFeeEstimateInput {
  /** Arbitrary label for the transaction type (e.g. "payment", "swap"). */
  type: string;
  /** Number of operations in this transaction (minimum 1). */
  operationCount: number;
}

/** A single fee estimate returned by the batch endpoint. */
export interface BatchFeeEstimateResult {
  /** The transaction type label echoed from the request. */
  type: string;
  /** Number of operations used to compute this estimate. */
  operationCount: number;
  /** Total fee in stroops (baseFee * operationCount). */
  feeStroops: number;
  /** Total fee in XLM as a seven-decimal string (e.g. "0.0000200"). */
  feeXLM: string;
}

/** Response data returned by POST /fee-estimate/batch. */
export interface BatchFeeEstimateResponse {
  estimates: BatchFeeEstimateResult[];
}
 *
 * @example
 * ```ts
 * const fees = new FeesModule({ baseUrl: "http://localhost:3000" });
 * const estimate = await fees.getFeeEstimate(3);
 * const surge = await fees.getSurgeStatus();
 * const trends = await fees.getFeeTrends();
 * ```
 */
export class FeesModule {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  /**
   * @param options.baseUrl - Base URL of the StellarKit API (trailing slash stripped).
   * @param options.apiKey  - Optional API key sent as the `X-API-Key` header.
   */
  constructor({ baseUrl, apiKey }: { baseUrl: string; apiKey?: string }) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (apiKey) this.headers["X-API-Key"] = apiKey;
  }

  /** @private Fetch a path and return the `data` field, or throw StellarKitError. */
  private async _get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers });
    const body = await res.json();
    if (!res.ok) {
      throw new StellarKitError(
        body?.error?.message ?? res.statusText,
        res.status,
        body?.error?.type ?? "ApiError",
      );
    }
    return (body as { data: T }).data;
  }

  /** @private POST a path with a JSON body and return the `data` field, or throw StellarKitError. */
  private async _post<T>(path: string, payload: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new StellarKitError(
        body?.error?.message ?? res.statusText,
        res.status,
        body?.error?.type ?? "ApiError",
      );
    }
    return (body as { data: T }).data;
  }

  /**
   * Get fee tiers (economy / standard / priority) for transaction submission.
   *
   * Returns per-operation and total fee estimates based on recent ledger statistics.
   *
   * @param operations - Number of operations in the transaction (default: 1).
   * @param fresh - When `true`, bypasses the server-side cache and fetches live data.
   * @returns Resolves to the fee estimate data payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getFeeEstimate(
    operations: number = 1,
    fresh: boolean = false,
  ): Promise<FeeEstimateResponse["data"]> {
    const params = new URLSearchParams();
    params.set("operations", String(operations));
    if (fresh) params.set("fresh", "true");
    return this._get<FeeEstimateResponse["data"]>(`/fee-estimate?${params}`);
  }

  /**
   * Identify whether the network is in a fee surge period.
   *
   * Analyzes recent ledger capacity usage and returns actionable advice
   * on when to submit transactions and which fee tier to use.
   *
   * @param options.fresh - When `true`, bypasses the server-side cache and fetches live data.
   * @returns Resolves to the surge status data payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getSurgeStatus(options?: { fresh?: boolean }): Promise<SurgeStatusData> {
    const fresh = options?.fresh ?? false;
    const params = new URLSearchParams();
    if (fresh) params.set("fresh", "true");
    const query = params.toString();
    return this._get<SurgeStatusData>(`/fee-estimate/surge-status${query ? `?${query}` : ""}`);
  }

  /**
   * Analyze fee trends across the last 50 ledgers with a statistical summary.
   *
   * Returns per-ledger base fees, capacity usage, and aggregated statistics
   * for identifying fee patterns over time.
   *
   * @returns Resolves to the fee trends data payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getFeeTrends(): Promise<FeeTrendsData> {
    return this._get<FeeTrendsData>("/fee-estimate/trends");
  }

  /**
   * Get fee percentiles from recent network activity.
   *
   * Returns fee distribution percentiles (p10, p50, p90, p95, p99) for the last ledger,
   * along with base fee and capacity usage metrics. Use the `fresh` parameter to bypass cache.
   *
   * @param options.fresh - When `true`, bypasses the server-side cache and fetches live data.
   * @returns Resolves to the fee percentiles data payload.
   * @throws {StellarKitError} On non-2xx response.
   * @example
   * ```ts
   * const fees = new FeesModule({ baseUrl: "http://localhost:3000" });
   * const percentiles = await fees.getFeePercentiles();
   * console.log(`Median fee: ${percentiles.p50} stroops`);
   *
   * // Bypass cache for real-time data
   * const fresh = await fees.getFeePercentiles({ fresh: true });
   * ```
   */
  async getFeePercentiles(options?: { fresh?: boolean }): Promise<FeePercentiles> {
    const fresh = options?.fresh ?? false;
    const params = new URLSearchParams();
    if (fresh) params.set("fresh", "true");
    const query = params.toString();
    return this._get<FeePercentiles>(`/network/fee-percentiles${query ? `?${query}` : ""}`);
  }

  /**
   * Get fee estimates for multiple transaction types in a single API call.
   *
   * Sends up to 10 transaction descriptors to POST /fee-estimate/batch and returns
   * a fee estimate for each one. Each estimate includes the fee in both stroops and XLM.
   *
   * @param transactions - Array of up to 10 entries, each with a `type` label and
   *   an `operationCount` (the number of operations in that transaction).
   * @returns Resolves to a BatchFeeEstimateResponse containing an `estimates` array.
   * @throws {StellarKitError} On non-2xx response (e.g. 400 when > 10 entries are sent).
   *
   * @example
   * ```ts
   * const fees = new FeesModule({ baseUrl: "http://localhost:3000" });
   * const { estimates } = await fees.getBatchFeeEstimate([
   *   { type: "payment",      operationCount: 1 },
   *   { type: "swap",         operationCount: 3 },
   *   { type: "multisig_pay", operationCount: 2 },
   * ]);
   * estimates.forEach(e => console.log(`${e.type}: ${e.feeXLM} XLM`));
   * ```
   */
  async getBatchFeeEstimate(
    transactions: BatchFeeEstimateInput[],
  ): Promise<BatchFeeEstimateResponse> {
    return this._post<BatchFeeEstimateResponse>("/fee-estimate/batch", { transactions });
  }
}
