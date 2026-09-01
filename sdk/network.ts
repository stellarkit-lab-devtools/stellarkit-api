/**
 * NetworkModule — typed SDK wrapper for all `/network/*` routes of the
 * StellarKit API.
 *
 * @example
 * ```ts
 * import { NetworkModule } from "./network";
 *
 * const network = new NetworkModule({ baseUrl: "http://localhost:3000" });
 * const result = await network.getValidators();
 * console.log(result.validators[0].publicKey);
 * ```
 */

/** Typed error thrown by NetworkModule on non-2xx API responses. */
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

// ── NetworkStatus types ──────────────────────────────────────────────────────

/**
 * The latest ledger details nested inside a NetworkStatus response.
 */
export interface LatestLedger {
  sequence: number | null;
  closedAt: string | null;
  transactionCount: number | null;
  operationCount: number | null;
  totalCoins: string | null;
  feePool: string | null;
}

/**
 * Fee info nested inside a NetworkStatus response.
 */
export interface NetworkFees {
  baseFeeInStroops: number | null;
  baseFeeInXLM: string | null;
  basereserveInStroops: number | null;
  baseReserveInXLM: string | null;
}

/**
 * Protocol info nested inside a NetworkStatus response.
 */
export interface NetworkProtocol {
  version: number | null;
}

/**
 * Typed response shape for GET /network-status.
 *
 * Maps directly onto the StellarKit API response documented in
 * docs/api-design.md and produced by src/utils/mapNetworkStatus.js.
 */
export interface NetworkStatus {
  /** "testnet" | "mainnet" — whichever the server is configured for. */
  network: string;
  /** The Horizon URL the server is connected to. */
  horizonUrl: string;
  /** Horizon service version string, or null if unavailable. */
  horizonVersion: string | null;
  /** Stellar Core version string, or null if unavailable. */
  coreVersion: string | null;
  /** The full network passphrase, or null if unavailable. */
  networkPassphrase: string | null;
  /** Sequence number of the most recently ingested ledger. */
  currentLedger: number | null;
  /** Sequence number at the tip of the historical ledger archive. */
  historyLatestLedger: number | null;
  /**
   * True when currentLedger === historyLatestLedger (both non-null).
   * False indicates the node is catching up or lagging behind the network.
   */
  isSynced: boolean;
  /** Details from the most recently closed ledger. */
  latestLedger: LatestLedger;
  /** Base fee and reserve figures from the latest ledger. */
  fees: NetworkFees;
  /** Protocol version in use. */
  protocol: NetworkProtocol;
}

// ── Validator types ──────────────────────────────────────────────────────────

/**
 * A single validator entry returned by GET /network/validators.
 *
 * Fields mirror the server-side normalisation:
 *   - publicKey      — Ed25519 public key of the validator account (G…)
 *   - homeDomain     — home_domain from the Horizon account record, or null
 *   - isOrganization — true when homeDomain is present
 *   - currentStatus  — "active" | "restricted" (auth_required flag)
 */
export interface Validator {
  publicKey: string;
  homeDomain: string | null;
  isOrganization: boolean;
  history: {
    lastModifiedLedger: number;
    subentryCount: number;
  };
  currentStatus: "active" | "restricted";
}

/**
 * Paginated response shape returned by getValidators().
 *
 * byOrganisation groups validators by their homeDomain so callers can
 * quickly look up all validators belonging to a single organisation.
 */
export interface ValidatorsResponse {
  validators: Validator[];
  total: number;
  byOrganisation: Record<string, Validator[]>;
  ungrouped: Validator[];
}

// ── Base fee types ───────────────────────────────────────────────────────────

/**
 * Current network base fee, as returned by GET /network/base-fee.
 *
 * Fields mirror the server-side normalisation:
 *   - baseFeeStroops — base fee of the last closed ledger, in stroops
 *   - baseFeeXLM     — the same fee as a seven-decimal XLM string
 *   - isSurge        — true when the network is charging above the minimum
 *                      fee, or ledger capacity usage is above 50%
 *   - ledgerSequence — sequence of the ledger the fee was read from, or null
 *   - ledgerClosedAt — ISO timestamp of that ledger's close, or null
 *   - note           — human-readable note describing the units
 */
export interface BaseFee {
  baseFeeStroops: number;
  baseFeeXLM: string;
  isSurge: boolean;
  ledgerSequence: number | null;
  ledgerClosedAt: string | null;
  note: string;
}

// ── Generic paginated response wrapper ──────────────────────────────────────

/**
 * Generic paginated response container for list endpoints.
 *
 * @template T - The item type in the list.
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit?: number;
  cursor?: string | null;
}

// ── NetworkModule ────────────────────────────────────────────────────────────

/**
 * NetworkModule wraps all `/network/*` routes of the StellarKit API into
 * fully-typed async methods.
 *
 * @example
 * ```ts
 * const network = new NetworkModule({ baseUrl: "http://localhost:3000" });
 *
 * // Fetch typed validator list
 * const { validators, total } = await network.getValidators();
 * validators.forEach(v => console.log(v.publicKey, v.currentStatus));
 *
 * // Force a cache bypass
 * const fresh = await network.getValidators({ fresh: true });
 * ```
 */
export class NetworkModule {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  /**
   * @param options.baseUrl - Base URL of the StellarKit API (trailing slash stripped).
   * @param options.apiKey  - Optional API key sent as the `X-API-Key` header.
   */
  constructor({ baseUrl, apiKey }: { baseUrl: string; apiKey?: string }) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (apiKey) this.headers["X-API-Key"] = apiKey;
  }

  /**
   * Fetch a path and return the typed `data` field from the success envelope.
   * Throws a typed StellarKitError on any non-2xx response.
   *
   * @private
   */
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
   * Retrieve the current validator list from the StellarKit API.
   *
   * Calls GET /network/validators and returns a typed ValidatorsResponse.
   * Each validator is typed with publicKey, homeDomain, isOrganization,
   * history, and currentStatus fields.
   *
   * @param options.fresh - When true, instructs the server to bypass its
   *   cache and fetch live data from Horizon.
   *
   * @returns A typed ValidatorsResponse with the full validator list,
   *   a total count, an org-grouped map, and ungrouped validators.
   *
   * @throws {StellarKitError} On any non-2xx API response (e.g. 502 when
   *   Horizon is unreachable).
   *
   * @example
   * ```ts
   * const { validators, total, byOrganisation } = await network.getValidators();
   * console.log(`${total} validators`);
   * console.log(byOrganisation["stellar.org"]);
   * ```
   */
  async getValidators(options: { fresh?: boolean } = {}): Promise<ValidatorsResponse> {
    const query = options.fresh ? "?fresh=true" : "";
    return this._get<ValidatorsResponse>(`/network/validators${query}`);
  }

  /**
   * Retrieve the current Stellar network status from the StellarKit API.
   *
   * Calls GET /network-status and returns a typed NetworkStatus containing
   * ledger info, sync state, fees, and protocol version.
   *
   * When `options.fresh` is true the query string `?fresh=true` is appended,
   * which instructs the server to bypass its in-memory cache and fetch live
   * data directly from Horizon.
   *
   * @param options.fresh - When true, appends `?fresh=true` to bypass cache.
   *
   * @returns A typed NetworkStatus payload.
   *
   * @throws {StellarKitError} On any non-2xx API response (e.g. 503 when
   *   Horizon is unreachable, or 502 when the upstream times out).
   *
   * @example
   * ```ts
   * const network = new NetworkModule({ baseUrl: "http://localhost:3000" });
   *
   * // Cached result (default)
   * const status = await network.getNetworkStatus();
   * console.log(`Synced: ${status.isSynced}, ledger: ${status.currentLedger}`);
   *
   * // Bypass cache for fresh live data
   * const fresh = await network.getNetworkStatus({ fresh: true });
   * console.log(`Network: ${fresh.network}, horizon: ${fresh.horizonVersion}`);
   * ```
   */
  async getNetworkStatus(options: { fresh?: boolean } = {}): Promise<NetworkStatus> {
    const query = options.fresh ? "?fresh=true" : "";
    return this._get<NetworkStatus>(`/network-status${query}`);
  }
}
