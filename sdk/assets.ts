/**
 * Assets module for the StellarKit SDK.
 * 
 * Provides methods for interacting with Stellar asset endpoints.
 */

/** Asset TOML metadata returned by getToml. */
export interface AssetToml {
  /** Asset code (e.g., "USDC"). */
  code: string;
  /** Issuer account public key. */
  issuer: string;
  /** Asset display name (e.g., "USD Coin"). */
  name: string | null;
  /** Human-readable asset description. */
  description: string | null;
  /** URL to asset image/logo. */
  image: string | null;
  /** Anchor asset type (e.g., "fiat", "crypto", "stock"). */
  anchorAssetType: string | null;
  /** Asset conditions or terms of use. */
  conditions: string | null;
}

/** Typed error thrown by AssetsModule on non-2xx API responses. */
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
 * AssetsModule wraps `/asset/:code/:issuer/*` routes of the StellarKit API
 * into fully-typed async methods.
 *
 * @example
 * const assets = new AssetsModule({ baseUrl: "http://localhost:3000" });
 * const toml = await assets.getToml("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
 */
export class AssetsModule {
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
      const errorType = body?.error?.type ?? "ApiError";
      throw new StellarKitError(
        body?.error?.message ?? res.statusText,
        res.status,
        errorType === "TomlFetchFailed" ? "TomlFetchFailed" : errorType,
      );
    }
    return (body as { data: T }).data;
  }

  /**
   * Get TOML metadata for a Stellar asset.
   *
   * Fetches the issuer's stellar.toml file, parses it, and returns the
   * relevant asset metadata in clean JSON format including name, description,
   * image, anchorAssetType, and conditions.
   *
   * @param code - Asset code (e.g., "USDC").
   * @param issuer - Issuer account public key (G...).
   * @returns Resolves to AssetToml with metadata fields (null for missing optional fields).
   * @throws {StellarKitError} With type "TomlFetchFailed" when the TOML cannot be fetched,
   *                           or "AccountNotFound" when the issuer account doesn't exist.
   *
   * @example
   * const assets = new AssetsModule({ baseUrl: "http://localhost:3000" });
   * 
   * try {
   *   const toml = await assets.getToml(
   *     "USDC",
   *     "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
   *   );
   *   console.log(toml.name);        // "USD Coin"
   *   console.log(toml.description); // "Stablecoin pegged to US Dollar"
   *   console.log(toml.image);       // "https://example.com/usdc.png"
   * } catch (err) {
   *   if (err instanceof StellarKitError && err.type === "TomlFetchFailed") {
   *     console.error("Could not fetch stellar.toml for this issuer");
   *   }
   * }
   *
   * @example
   * // With API key authentication
   * const assets = new AssetsModule({
   *   baseUrl: "https://api.stellarkit.io",
   *   apiKey: "your-api-key"
   * });
   * const toml = await assets.getToml("EURT", "GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S");
   */
  async getToml(code: string, issuer: string): Promise<AssetToml> {
    if (!code || typeof code !== "string" || code.trim() === "") {
      throw new StellarKitError("code is required and must be a non-empty string", 400, "ValidationError");
    }
    if (!issuer || typeof issuer !== "string" || issuer.trim() === "") {
      throw new StellarKitError("issuer is required and must be a non-empty string", 400, "ValidationError");
    }
    return this._get<AssetToml>(`/asset/${encodeURIComponent(code)}/${encodeURIComponent(issuer)}/toml`);
  }
}
