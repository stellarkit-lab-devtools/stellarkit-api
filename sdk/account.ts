import type {
  AccountResponse,
  AccountBalancesResponse,
  AccountTrustlinesResponse,
  AccountSignersResponse,
  AccountAgeResponse,
  AccountRiskScoreResponse,
  AccountTransactionCountResponse,
  AccountSequenceResponse,
  TrustlineEntry,
  PaymentOperation,
  Signer,
} from "../types/index.d";

/** Transaction count summary returned by `AccountModule.getTransactionCount`. */
export type TransactionCount = AccountTransactionCountResponse["data"];

/** Sequence details returned by `AccountModule.getSequence`. */
export type SequenceData = AccountSequenceResponse["data"];

/** Paginated response returned by list endpoints. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  cursor: string | null;
}

/** Effect from the Stellar ledger. */
export interface Effect {
  /** Unique identifier for this effect. */
  effectId: string;
  /** Effect type (e.g., "account_credited", "account_debited"). */
  type: string;
  /** ISO 8601 timestamp when the effect was created. */
  createdAt: string;
  /** Asset involved in the effect (if applicable). */
  asset?: {
    code: string;
    issuer: string | null;
    type: string;
  };
  /** Amount involved in the effect (if applicable). */
  amount?: string;
}

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
 * Native XLM balance details returned by GET /account/:id/native-balance.
 */
export interface NativeBalance {
  /** Current XLM balance as a seven-decimal string (e.g. "9.9999800"). */
  balance: string;
  /** XLM reserved for buying liabilities. */
  buyingLiabilities: string;
  /** XLM reserved for selling liabilities. */
  sellingLiabilities: string;
}

/**
 * A single sponsored entry for an account.
 */
export interface SponsoredEntry {
  /** Type of the sponsored entry (e.g. "trustline", "signer", "data_entry"). */
  type: string;
  /** Asset identifier for trustlines (e.g. "USDC:GA5Z...") or key for signers/data. */
  address?: string;
  /** Key for signers or data entries. */
  key?: string;
  /** Asset code and issuer for trustlines. */
  asset?: string;
  /** Stellar account address sponsoring this entry. */
  sponsor: string;
  /** XLM amount reserved for this sponsored entry. */
  reserveAmount?: string;
}

/**
 * Sponsorship details for an account.
 * Contains both entries sponsored by others and accounts this account is sponsoring.
 */
export interface Sponsorships {
  /** Stellar account public key. */
  accountId: string;
  /** Entries on this account that are sponsored by other accounts. */
  sponsoredBy: SponsoredEntry[];
  /** Accounts that this account is currently sponsoring. */
  sponsoring: string[];
  /** Total number of sponsored entries. */
  count: number;
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
  private async _get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const searchParams = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) searchParams.set(key, String(value));
    });

    const query = searchParams.toString();
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
    const res = await fetch(url, { headers: this.headers });
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
   * @param id - Stellar account public key (non-empty string).
   * @returns Resolves to the account data payload.
   * @throws {StellarKitError} If `id` is missing/empty, or on a non-2xx API response (e.g. 404).
   *
   * @example
   * const account = new AccountModule({ baseUrl: "http://localhost:3000" });
   * const details = await account.getAccount("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
   * console.log(details.xlm.balance); // "9.9999800"
   */
  async getAccount(id: string): Promise<AccountResponse["data"]> {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
    }
    return this._get<AccountResponse["data"]>(`/account/${id}`);
  }

  /**
   * Get the native XLM balance for an account.
   *
   * @param id - Stellar account public key (non-empty string).
   * @returns Resolves to XLM balance with liabilities.
   * @throws {StellarKitError} If `id` is missing/empty, or on a non-2xx API response (e.g. 404).
   *
   * @example
   * const account = new AccountModule({ baseUrl: "http://localhost:3000" });
   * const native = await account.getNativeBalance("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
   * console.log(native.balance); // "9.9999800"
   */
  async getNativeBalance(id: string): Promise<NativeBalance> {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
    }
    return this._get<NativeBalance>(`/account/${id}/native-balance`);
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
   * @param options - Optional filtering options.
   * @param options.assetCode - Filter trustlines by asset code (e.g. "USDC").
   * @returns Resolves to an array of trustline entries.
   * @throws {StellarKitError} On non-2xx response.
   *
   * @example
   * const trustlines = await account.getTrustlines("GAAZI4...");
   * const usdcOnly = await account.getTrustlines("GAAZI4...", { assetCode: "USDC" });
   */
  async getTrustlines(
    id: string,
    options?: { assetCode?: string },
  ): Promise<TrustlineEntry[]> {
    const params = new URLSearchParams();
    if (options?.assetCode) params.set("asset_code", options.assetCode);
    const query = params.toString();
    const path = `/account/${id}/trustlines${query ? `?${query}` : ""}`;
    return this._get<TrustlineEntry[]>(path);
  }

  /**
   * Get payment and create_account operations for an account.
   *
   * @param id - Stellar account public key.
   * @param options - Optional pagination options.
   * @param options.limit - Maximum number of records to return.
   * @param options.cursor - Pagination cursor from a previous response.
   * @returns Resolves to a paginated response containing payment operations.
   * @throws {StellarKitError} On non-2xx response.
   *
   * @example
   * const payments = await account.getPayments("GAAZI4...");
   * const page2 = await account.getPayments("GAAZI4...", { limit: 10, cursor: "12345" });
   */
  async getPayments(
    id: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<PaginatedResponse<PaymentOperation>> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);
    const query = params.toString();
    const path = `/account/${id}/payments${query ? `?${query}` : ""}`;
    return this._get<PaginatedResponse<PaymentOperation>>(path);
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
   * Get account signing key configuration.
   *
   * Calls `GET /account/:id/signing-keys` and returns account signers,
   * master key weight, and operation thresholds.
   *
   * @param id - Stellar account public key (non-empty string).
   * @returns Resolves to account signing key configuration.
   * @throws {StellarKitError} If `id` is missing/empty, or on a non-2xx API response.
   *
   * @example
   * const account = new AccountModule({ baseUrl: "http://localhost:3000" });
   * const signingKeys = await account.getSigningKeys("GAAZI4...");
   * console.log(signingKeys.masterWeight);
   */
  async getSigningKeys(id: string): Promise<SigningKeys> {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
    }
    return this._get<SigningKeys>(`/account/${id}/signing-keys`);
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

  /**
   * Get the total transaction count for an account, plus the timestamps of
   * its first and last transactions — a lightweight summary that avoids
   * paginating through the full transaction history.
   *
   * @param id - Stellar account public key.
   * @returns Resolves to `{ count, firstTransactionAt, lastTransactionAt }`.
   * @throws {StellarKitError} On non-2xx response (e.g. 404 account not found).
   *
   * @example
   * const { count, firstTransactionAt } = await account.getTransactionCount("GAAZI4...");
   * console.log(`${count} transactions since ${firstTransactionAt}`);
   */
  async getTransactionCount(id: string): Promise<TransactionCount> {
    return this._get<TransactionCount>(`/account/${id}/transaction-count`);
  }

  /**
   * Get the current sequence number and last modified ledger for an account.
   *
   * @param id - Stellar account public key (non-empty string).
   * @returns Resolves to the sequence payload including `accountId`, `sequence`, and `lastModifiedLedger`.
   * @throws {StellarKitError} If `id` is missing/empty, or on a non-2xx API response.
   *
   * @example
   * const account = new AccountModule({ baseUrl: "http://localhost:3000" });
   * const sequence = await account.getSequence("GAAZI4...");
   * console.log(sequence.sequence); // "123"
   */
  async getSequence(id: string): Promise<SequenceData> {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
    }
    return this._get<SequenceData>(`/account/${id}/sequence`);
  }

  /**
   * Get full account data including balances, signers, and all metadata.
   *
   * Alias for getAccount — returns complete account information.
   *
   * @param id - Stellar account public key.
   * @returns Resolves to the full account data payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getAccountData(id: string): Promise<AccountResponse["data"]> {
    return this.getAccount(id);
  }

  /**
   * Get the sponsorship relationships for an account.
   *
   * Resolves both the entries on this account that are sponsored by other accounts
   * (sponsoredBy) and the accounts that this account is currently sponsoring (sponsoring).
   *
   * Calls `GET /account/:id/sponsorships`.
   *
   * @param id - Stellar account public key (non-empty string starting with G).
   * @returns Resolves to a Sponsorships object with `sponsoring` and `sponsoredBy` arrays.
   * @throws {StellarKitError} If `id` is missing/empty, or on a non-2xx API response (e.g. 404 when the account does not exist).
   *
   * @example
   * const account = new AccountModule({ baseUrl: "http://localhost:3000" });
   * const sponsorships = await account.getSponsorships(
   *   "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
   * );
   * console.log(sponsorships.count);               // number of sponsored entries
   * console.log(sponsorships.sponsoredBy);          // entries sponsored by others
   * console.log(sponsorships.sponsoring);           // accounts this account sponsors
   */
  async getSponsorships(id: string): Promise<Sponsorships> {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
    }
    return this._get<Sponsorships>(`/account/${id}/sponsorships`);
  }

  /**
   * Get all open offers for an account.
   *
   * @param id - Stellar account public key.
   * @param options - Optional pagination and filtering options.
   * @param options.limit - Maximum number of records to return (default: 10, max: 200).
   * @param options.cursor - Pagination cursor from a previous response.
   * @returns Resolves to a paginated response containing offer records.
   * @throws {StellarKitError} On non-2xx response.
   *
   * @example
   * const offers = await account.getOffers("GAAZI4...");
   * const page2 = await account.getOffers("GAAZI4...", { limit: 50, cursor: "12345" });
   */
  async getOffers(
    id: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<PaginatedResponse<{
    id: string;
    selling: { assetType: string; assetCode: string; assetIssuer: string | null; amount: string };
    buying: { assetType: string; assetCode: string; assetIssuer: string | null };
    price: string;
    lastModifiedLedger: number;
  }>> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);
    const query = params.toString();
    const path = `/account/${id}/offers${query ? `?${query}` : ""}`;
    return this._get<PaginatedResponse<{
      id: string;
      selling: { assetType: string; assetCode: string; assetIssuer: string | null; amount: string };
      buying: { assetType: string; assetCode: string; assetIssuer: string | null };
      price: string;
      lastModifiedLedger: number;
    }>>(path);
  }

  /**
   * Get effects for an account.
   *
   * Effects are historical ledger events that impacted this account. This method calls
   * `GET /account/:id/effects` and returns a paginated list of effects with full type information.
   *
   * @param id - Stellar account public key (non-empty string).
   * @param options - Optional pagination and filtering options.
   * @param options.limit - Maximum number of effects to return (default: 10, max: 200).
   * @param options.cursor - Pagination cursor from a previous response.
   * @param options.type - Optional effect type filter (e.g., "account_credited", "account_debited").
   * @returns Resolves to a paginated response containing effect records.
   * @throws {StellarKitError} If `id` is missing/empty, or on a non-2xx API response (e.g. 404 when account not found).
   *
   * @example
   * const account = new AccountModule({ baseUrl: "http://localhost:3000" });
   * const effects = await account.getEffects("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
   * console.log(effects.items[0].type); // "account_credited"
   *
   * @example
   * // Filter by effect type
   * const creditEffects = await account.getEffects("GAAZI4...", { type: "account_credited" });
   *
   * @example
   * // Paginate through effects
   * const page1 = await account.getEffects("GAAZI4...", { limit: 50 });
   * const page2 = await account.getEffects("GAAZI4...", { limit: 50, cursor: page1.cursor });
   */
  async getEffects(
    id: string,
    options?: { limit?: number; cursor?: string; type?: string },
  ): Promise<PaginatedResponse<Effect>> {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
    }
    const params: Record<string, string | number | undefined> = {
      limit: options?.limit,
      cursor: options?.cursor,
      type: options?.type,
    };
    return this._get<PaginatedResponse<Effect>>(`/account/${id}/effects`, params);
  }
}
