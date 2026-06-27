import type {
  AccountResponse,
  AccountBalancesResponse,
  AccountTrustlinesResponse,
  AccountSignersResponse,
  AccountAgeResponse,
  AccountRiskScoreResponse,
} from "../types/index.d";

/** Typed error thrown by AccountModule on non-2xx API responses. */
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

/**
 * AccountModule wraps all `/account/:id/*` routes of the StellarKit API
 * into fully-typed async methods.
 *
 * @example
 * const account = new AccountModule({ baseUrl: "http://localhost:3000" });
 * const details = await account.getAccount("GAAZI4...");
 */
export class AccountModule {
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
   * Get full account details including XLM balance, assets, signers, thresholds, and flags.
   *
   * @param id - Stellar account public key.
   * @returns Resolves to the account data payload.
   * @throws {StellarKitError} On non-2xx response (e.g. 404 account not found).
   */
  async getAccount(id: string): Promise<AccountResponse["data"]> {
    return this._get<AccountResponse["data"]>(`/account/${id}`);
  }

  /**
   * Get only the XLM and asset balances for an account.
   *
   * @param id - Stellar account public key.
   * @returns Resolves to the balances payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getBalances(id: string): Promise<AccountBalancesResponse["data"]> {
    return this._get<AccountBalancesResponse["data"]>(`/account/${id}/balances`);
  }

  /**
   * Get all trustlines for an account with TOML metadata resolved from issuer home domains.
   *
   * @param id - Stellar account public key.
   * @returns Resolves to an array of trustline entries.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getTrustlines(id: string): Promise<AccountTrustlinesResponse["data"]> {
    return this._get<AccountTrustlinesResponse["data"]>(`/account/${id}/trustlines`);
  }

  /**
   * Get the signers and threshold configuration for an account.
   *
   * Extracts `signers` and `thresholds` from `GET /account/:id`.
   *
   * @param id - Stellar account public key.
   * @returns Resolves to an object with `signers` and `thresholds`.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getSigners(id: string): Promise<AccountSignersResponse["data"]> {
    const account = await this._get<AccountResponse["data"]>(`/account/${id}`);
    return { accountId: account.accountId, signers: account.signers, thresholds: account.thresholds };
  }

  /**
   * Get account age and maturity metrics.
   *
   * @param id - Stellar account public key.
   * @returns Resolves to the age payload including `ageInDays`, `ageInMonths`, and `maturity`.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getAge(id: string): Promise<AccountAgeResponse["data"]> {
    return this._get<AccountAgeResponse["data"]>(`/account/${id}/age`);
  }

  /**
   * Get a computed risk score for an account based on on-chain signals.
   *
   * @param id - Stellar account public key.
   * @returns Resolves to the risk score payload including `score`, `label`, and `factors`.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getRiskScore(id: string): Promise<AccountRiskScoreResponse["data"]> {
    return this._get<AccountRiskScoreResponse["data"]>(`/account/${id}/risk-score`);
  }
}
