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

/**
 * FeesModule wraps all `/fee-estimate/*` routes of the StellarKit API
 * into fully-typed async methods.
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
   * @returns Resolves to the surge status data payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getSurgeStatus(): Promise<SurgeStatusData> {
    return this._get<SurgeStatusData>("/fee-estimate/surge-status");
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
}
