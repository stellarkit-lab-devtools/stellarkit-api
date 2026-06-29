/** Typed error thrown by DexModule on non-2xx API responses. */
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

/** Asset parameter — accepts either a "CODE:ISSUER" string or a typed object. */
export type AssetParam = string | { code: string; issuer: string };

/** Spread response data from GET /dex/spread/:sellAsset/:buyAsset */
export interface SpreadData {
  bestBid: { price: string; amount: string } | null;
  bestAsk: { price: string; amount: string } | null;
  spreadAbsolute: string | null;
  spreadPercent: string | null;
  midPrice: string | null;
  liquidity: "high" | "medium" | "low";
  orderBookDepth: {
    bids: number;
    asks: number;
    totalBidVolume: string;
    totalAskVolume: string;
    totalVolume: string;
  };
}

/** Imbalance response data from GET /dex/imbalance/:sellAsset/:buyAsset */
export interface ImbalanceData {
  bidVolume: string;
  askVolume: string;
  imbalanceRatio: string;
  pressure: "buy" | "sell" | "neutral";
  signal: string;
}

/** Arbitrage response data from GET /dex/arbitrage/:assetCode/:assetIssuer */
export interface ArbitrageData {
  pathsFound: boolean;
  paths: Array<{
    sourceAmount: string;
    destinationAmount: string;
    path: Array<{
      assetCode: string;
      assetIssuer: string;
      assetType: string;
    }>;
    isProfitable: boolean;
  }>;
}

/** Order book depth response data from GET /dex/depth/:sellAsset/:buyAsset */
export interface OrderBookData {
  bidsCount: number;
  asksCount: number;
  totalBidVolume: string;
  totalAskVolume: string;
  top5Bids: Array<{ price: string; amount: string }>;
  top5Asks: Array<{ price: string; amount: string }>;
  depthRating: "deep" | "moderate" | "shallow";
}

/** Price response data from GET /dex/price/:sellAsset/:buyAsset */
export interface PriceData {
  sellAsset: string;
  buyAsset: string;
  sellAmount: string;
  buyAmount: string;
  effectiveRate: string;
  bestPath: Array<{ assetCode: string; assetIssuer: string }>;
}

/**
 * Serialise an asset parameter to the "CODE:ISSUER" URL format.
 *
 * @param asset - Either a "CODE:ISSUER" string or `{ code, issuer }` object.
 * @returns The serialised string, e.g. "XLM:native" or "USDC:GA5Z...".
 */
function serializeAsset(asset: AssetParam): string {
  if (typeof asset === "string") return asset;
  return `${asset.code}:${asset.issuer}`;
}

/**
 * DexModule wraps all `/dex/*` routes of the StellarKit API
 * into fully-typed async methods.
 *
 * Asset parameters accept both a plain `"CODE:ISSUER"` string and a typed
 * `{ code, issuer }` object — the module handles serialisation internally.
 *
 * @example
 * ```ts
 * const dex = new DexModule({ baseUrl: "http://localhost:3000" });
 *
 * // String format
 * const spread = await dex.getSpread("XLM:native", "USDC:GA5Z...");
 *
 * // Object format
 * const depth = await dex.getOrderBook(
 *   { code: "XLM", issuer: "native" },
 *   { code: "USDC", issuer: "GA5Z..." },
 * );
 * ```
 */
export class DexModule {
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
   * Calculate the bid-ask spread for a trading pair on the Stellar DEX.
   *
   * Returns best bid/ask prices, spread metrics, and order book depth summary.
   *
   * @param sellAsset - The asset to sell (e.g. `"XLM:native"` or `{ code: "XLM", issuer: "native" }`).
   * @param buyAsset  - The asset to buy.
   * @returns Resolves to the spread data payload.
   * @throws {StellarKitError} On non-2xx response (e.g. 404 if no order book exists).
   */
  async getSpread(sellAsset: AssetParam, buyAsset: AssetParam): Promise<SpreadData> {
    const sell = serializeAsset(sellAsset);
    const buy = serializeAsset(buyAsset);
    return this._get<SpreadData>(`/dex/spread/${sell}/${buy}`);
  }

  /**
   * Detect buy/sell pressure imbalance on a Stellar DEX trading pair.
   *
   * Compares bid and ask volumes to determine market pressure direction.
   *
   * @param sellAsset - The asset to sell.
   * @param buyAsset  - The asset to buy.
   * @returns Resolves to the imbalance data payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getImbalance(sellAsset: AssetParam, buyAsset: AssetParam): Promise<ImbalanceData> {
    const sell = serializeAsset(sellAsset);
    const buy = serializeAsset(buyAsset);
    return this._get<ImbalanceData>(`/dex/imbalance/${sell}/${buy}`);
  }

  /**
   * Find circular arbitrage paths for an asset on the Stellar DEX.
   *
   * Checks for profitable circular payment paths that start and end
   * with the same asset.
   *
   * @param code   - Asset code (e.g. `"USDC"` or `"XLM"`).
   * @param issuer - Asset issuer public key, or `"native"` for XLM.
   * @returns Resolves to the arbitrage data payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getArbitrage(code: string, issuer: string): Promise<ArbitrageData> {
    return this._get<ArbitrageData>(`/dex/arbitrage/${code}/${issuer}`);
  }

  /**
   * Analyze the full depth of a Stellar DEX order book for a trading pair.
   *
   * Returns bid/ask counts, volumes, top 5 orders on each side,
   * and a depth rating (deep / moderate / shallow).
   *
   * @param sellAsset - The asset to sell.
   * @param buyAsset  - The asset to buy.
   * @returns Resolves to the order book depth data payload.
   * @throws {StellarKitError} On non-2xx response.
   */
  async getOrderBook(sellAsset: AssetParam, buyAsset: AssetParam): Promise<OrderBookData> {
    const sell = serializeAsset(sellAsset);
    const buy = serializeAsset(buyAsset);
    return this._get<OrderBookData>(`/dex/depth/${sell}/${buy}`);
  }

  /**
   * Calculate the effective exchange rate between two assets via the best
   * available payment path on the Stellar DEX.
   *
   * @param sellAsset - The asset to sell.
   * @param buyAsset  - The asset to buy.
   * @param amount    - Amount of sellAsset to convert (default: 1).
   * @returns Resolves to the price data payload.
   * @throws {StellarKitError} On non-2xx response (e.g. 404 if no path exists).
   */
  async getPrice(sellAsset: AssetParam, buyAsset: AssetParam, amount: number = 1): Promise<PriceData> {
    const sell = serializeAsset(sellAsset);
    const buy = serializeAsset(buyAsset);
    return this._get<PriceData>(`/dex/price/${sell}/${buy}?amount=${amount}`);
  }
}
