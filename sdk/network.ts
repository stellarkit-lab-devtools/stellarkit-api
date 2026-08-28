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
}
