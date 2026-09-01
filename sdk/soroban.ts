/** Typed error thrown by SorobanModule on non-2xx API responses. */
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

/** Contract data returned by GET /contract/:id */
export interface ContractData {
  /** Soroban contract ID (C... address). */
  contractId: string;
  /** Hex-encoded hash of the deployed WASM code (64 chars), or null for stellar_asset. */
  wasmHash: string | null;
  /** Stellar account that deployed the contract, when known. */
  deployer: string | null;
  /** ISO 8601 deployment timestamp, when known. */
  deployedAt: string | null;
  /** Ledger sequence the contract was deployed in, when known. */
  deployedLedger: number | null;
  /** Whether the contract instance has expired based on the current ledger. */
  isExpired: boolean;
  /** Ledger sequence the contract was last modified in. */
  lastModifiedLedger: number;
  /** Ledger sequence until which the instance entry stays live, or null. */
  expiryLedger: number | null;
  executable: {
    type: string;
    wasmHash: string | null;
  };
}

/** A single key/value entry from contract instance or persistent storage. */
export interface ContractStorageEntry {
  /** Storage key, base64 XDR-encoded. */
  key: string;
  /** Storage value, base64 XDR-encoded. */
  value: string;
  /** Storage durability ("temporary" | "persistent" | "instance"). */
  durability: string;
  /** Ledger sequence after which a temporary entry expires, if applicable. */
  liveUntilLedger: number | null;
}

/** Contract storage data returned by GET /contract/:id/storage */
export interface ContractStorageData {
  /** Soroban contract ID the storage entries belong to. */
  contractId: string;
  /** Storage entries for the contract. */
  entries: ContractStorageEntry[];
  /** Pagination cursor for the next page, or null when there are no more entries. */
  cursor: string | null;
}

/**
 * SorobanModule wraps all `/contract/*` (Soroban) routes of the StellarKit API
 * into fully-typed async methods.
 *
 * @example
 * ```ts
 * const soroban = new SorobanModule({ baseUrl: "http://localhost:3000" });
 * const contract = await soroban.getContract("CABC123...");
 * const storage = await soroban.getContractStorage("CABC123...", { limit: 50 });
 * ```
 */
export class SorobanModule {
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
   * Get metadata for a deployed Soroban contract.
   *
   * @param id - Soroban contract ID (C... address).
   * @returns Resolves to the contract data payload.
   * @throws {StellarKitError} If `id` is missing/empty, or on a non-2xx API response (e.g. 404).
   *
   * @example
   * const soroban = new SorobanModule({ baseUrl: "http://localhost:3000" });
   * const contract = await soroban.getContract("CABC123...");
   * console.log(contract.wasmHash);
   */
  async getContract(id: string): Promise<ContractData> {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
    }
    return this._get<ContractData>(`/soroban/contract/${id}`);
  }

  /**
   * Get the storage entries (instance and persistent) for a deployed Soroban contract.
   *
   * @param id - Soroban contract ID (C... address).
   * @param options - Optional query options.
   * @param options.limit - Maximum number of storage entries to return.
   * @returns Resolves to the contract storage payload.
   * @throws {StellarKitError} If `id` is missing/empty, or on a non-2xx API response (e.g. 404).
   *
   * @example
   * const soroban = new SorobanModule({ baseUrl: "http://localhost:3000" });
   * const storage = await soroban.getContractStorage("CABC123...");
   * const firstPage = await soroban.getContractStorage("CABC123...", { limit: 20 });
   */
  async getContractStorage(
    id: string,
    options?: { limit?: number },
  ): Promise<ContractStorageData> {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new StellarKitError("id is required and must be a non-empty string", 400, "ValidationError");
    }
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    const path = `/contract/${id}/storage${query ? `?${query}` : ""}`;
    return this._get<ContractStorageData>(path);
  }
}
