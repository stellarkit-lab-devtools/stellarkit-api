/**
 * TypeScript type definitions for stellarkit-api
 * Generated from API source — do not edit manually.
 * See: https://github.com/stellarkit-lab-devtools/stellarkit-api
 */

// ============================================================
// SHARED / PRIMITIVE TYPES
// ============================================================

/** A Stellar public key (G... address, 56 characters) */
export type StellarPublicKey = string

/** A Stellar transaction hash (64-char hex string) */
export type TransactionHash = string

/** ISO 8601 timestamp string */
export type ISOTimestamp = string

/** Stellar amount as a string (Horizon returns amounts as strings) */
export type StellarAmount = string

/** Stellar asset representation */
export interface StellarAsset {
  asset_type: 'native' | 'credit_alphanum4' | 'credit_alphanum12'
  asset_code?: string   // absent for native XLM
  asset_issuer?: StellarPublicKey  // absent for native XLM
}

// ============================================================
// ERROR RESPONSE
// ============================================================

/** Standard error response returned by all endpoints on failure */
export interface ApiError {
  success: false
  error: {
    type: string    // e.g. "ValidationError", "HorizonError", "NotFound", "ServerError"
    message?: string
    title?: string
    detail?: string
    status?: number
    extras?: unknown
  }
}

// ============================================================
// PAGINATION & METADATA
// ============================================================

/** Pagination metadata included in list responses */
export interface PaginationMeta {
  count: number
  limit: number
  order: 'asc' | 'desc'
  nextCursor: string | null
  hasMore: boolean
}

/** Generic paginated response wrapper */
export interface PaginatedResponse<T> {
  success: true
  data: T[]
  meta: PaginationMeta
}

// ============================================================
// SHARED SUB-TYPES
// ============================================================

/** XLM balance information */
export interface XLMBalance {
  balance: StellarAmount
  buyingLiabilities: StellarAmount
  sellingLiabilities: StellarAmount
  minimumBalance?: StellarAmount
  spendableBalance?: StellarAmount
}

/** Non-native asset balance */
export interface AssetBalance {
  assetCode: string
  assetIssuer: StellarPublicKey
  assetType: 'credit_alphanum4' | 'credit_alphanum12'
  balance: StellarAmount
  limit: StellarAmount
  buyingLiabilities: StellarAmount
  sellingLiabilities: StellarAmount
  isAuthorized: boolean
  isClawbackEnabled: boolean
}

/** Account balances wrapper */
export interface AccountBalances {
  xlm: {
    balance: StellarAmount
    buyingLiabilities: StellarAmount
    sellingLiabilities: StellarAmount
  }
  assets: AssetBalance[]
}

/** Signer information */
export interface Signer {
  key: StellarPublicKey
  type: string
  weight: number
}

/** Account thresholds */
export interface Thresholds {
  low_threshold: number
  med_threshold: number
  high_threshold: number
}

/** Account flags */
export interface AccountFlags {
  auth_required: boolean
  auth_revocable: boolean
  auth_immutable: boolean
  clawback_enabled: boolean
}

/** Fee tier information */
export interface FeeTier {
  stroops: number
  xlm: StellarAmount
  description?: string
}

/** Ledger information */
export interface LedgerInfo {
  sequence: number
  closedAt: ISOTimestamp
  transactionCount: number
  operationCount: number
  totalCoins?: StellarAmount
  feePool?: StellarAmount
}

/** Transaction record */
export interface TransactionRecord {
  id: string
  hash: TransactionHash
  ledger: number
  createdAt: ISOTimestamp
  sourceAccount: StellarPublicKey
  fee: {
    charged: StellarAmount
    account: StellarPublicKey
  }
  operationCount: number
  memoType: string
  memo: string | null
  successful: boolean
  envelopeXdr: string
}

/** Payment operation record */
export interface PaymentOperation {
  amount: StellarAmount
  assetCode: string
  assetIssuer: StellarPublicKey | null
  from: StellarPublicKey
  to: StellarPublicKey
  createdAt: ISOTimestamp
}

/** Operation record (base) */
export interface OperationRecord {
  id: string
  type: string
  createdAt: ISOTimestamp
  transactionHash: TransactionHash
  transactionSuccessful: boolean
  sourceAccount: StellarPublicKey
}

/** Payment operation */
export interface PaymentOperationRecord extends OperationRecord {
  type: 'payment'
  amount: StellarAmount
  assetType: string
  assetCode: string
  assetIssuer: StellarPublicKey | null
  from: StellarPublicKey
  to: StellarPublicKey
}

/** Create account operation */
export interface CreateAccountOperationRecord extends OperationRecord {
  type: 'create_account'
  account: StellarPublicKey
  funder: StellarPublicKey
  startingBalance: StellarAmount
}

/** Change trust operation */
export interface ChangeTrustOperationRecord extends OperationRecord {
  type: 'change_trust'
  assetCode: string
  assetIssuer: StellarPublicKey
  limit: StellarAmount
  trustee: StellarPublicKey
  trustor: StellarPublicKey
}

/** Union type for all operation types */
export type OperationRecordUnion =
  | PaymentOperationRecord
  | CreateAccountOperationRecord
  | ChangeTrustOperationRecord
  | OperationRecord

/** Asset metadata */
export interface AssetMetadata {
  assetCode: string
  assetIssuer: StellarPublicKey
  assetType: 'credit_alphanum4' | 'credit_alphanum12'
  amount: StellarAmount
  numAccounts: number
  numClaimableBalances?: number
  numLiquidityPools?: number
  claimableBalancesAmount?: StellarAmount
  liquidityPoolsAmount?: StellarAmount
  flags?: unknown
}

/** Issuer account information */
export interface IssuerInfo {
  homeDomain: string | null
  flags?: unknown
  thresholds?: Thresholds
}

// ============================================================
// ENDPOINT RESPONSE TYPES
// ============================================================

/**
 * Response from GET /account/:id
 * Returns full account details including XLM balance, all asset balances,
 * signers, thresholds, flags, and sequence number.
 */
export interface AccountResponse {
  success: true
  data: {
    accountId: StellarPublicKey
    sequence: string
    subentryCount: number
    xlm: XLMBalance
    assets: AssetBalance[]
    assetCount: number
    signers: Signer[]
    thresholds: Thresholds
    flags: AccountFlags
    homeDomain: string | null
    lastModifiedLedger: number
  }
}

/**
 * Response from GET /account/:id/age
 * Returns account age and longevity metrics for trust and reputation systems.
 */
export interface AccountAgeResponse {
  success: true
  data: {
    publicKey: StellarPublicKey
    createdAtLedger: number
    createdAt: ISOTimestamp
    ageInDays: number
    ageInMonths: number
    ageInYears: number
    maturity: 'new' | 'established' | 'veteran'
  }
}

/**
 * Response from GET /account/:id/balances
 * Returns only native XLM and asset balances for a Stellar account.
 */
export interface AccountBalancesResponse {
  success: true
  data: AccountBalances
}

/**
 * Response from GET /account/:id/summary
 * Returns account info, recent transactions, open offers, and claimable balances.
 */
export interface AccountSummaryResponse {
  success: true
  data: {
    account: unknown | null
    recentTransactions: unknown[]
    openOffers: unknown[]
    claimableBalances: unknown[]
  }
}

/**
 * Response from GET /account/:id/payments
 * Returns payment and create_account operations for an account.
 */
export interface AccountPaymentsResponse {
  success: true
  data: PaymentOperation[]
  meta: {
    count: number
    limit: number
    order: 'asc' | 'desc'
    nextCursor: string | null
    hasMore: boolean
  }
}

/**
 * Response from GET /transactions/:id
 * Returns paginated transaction history for a Stellar account.
 */
export interface TransactionHistoryResponse {
  success: true
  data: TransactionRecord[]
  meta: PaginationMeta
}

/**
 * Response from GET /transactions/:id/operations
 * Returns paginated operation history for a Stellar account.
 */
export interface OperationHistoryResponse {
  success: true
  data: OperationRecordUnion[]
  meta: PaginationMeta
}

/**
 * Response from GET /fee-estimate
 * Returns fee statistics for recent ledgers to help developers pick a competitive fee.
 */
export interface FeeEstimateResponse {
  success: true
  data: {
    note: string
    operationCount: number
    perOperation: {
      economy: FeeTier
      standard: FeeTier
      priority: FeeTier
    }
    totalFee: {
      economy: FeeTier
      standard: FeeTier
      priority: FeeTier
    }
    networkStats: {
      lastLedgerBaseFee: number
      ledgerCapacityUsage: string
      maxFeeCharged: string
      p10: string
      p50: string
      p95: string
      p99: string
    }
    history: Array<{
      ledger: number
      baseFee: number
      capacityUsage: number
    }>
    // Human-friendly additions
    context: string
    networkCongestion: 'low' | 'medium' | 'high'
    recommendation: string
  }
}

/**
 * Response from GET /network-status
 * Returns current Stellar network info: latest ledger, base fee, network passphrase.
 */
export interface NetworkStatusResponse {
  success: true
  data: {
    network: string
    horizonUrl: string
    latestLedger: LedgerInfo
    fees: {
      baseFeeInStroops: number
      baseFeeInXLM: StellarAmount
      basereserveInStroops: number
      baseReserveInXLM: StellarAmount
    }
    protocol: {
      version: number
    }
  }
}

/**
 * Response from GET /asset/:code/:issuer
 * Returns metadata and statistics for a Stellar asset.
 */
export interface AssetResponse {
  success: true
  data: {
    assetCode: string
    assetIssuer: StellarPublicKey
    assetType: 'credit_alphanum4' | 'credit_alphanum12'
    amount: StellarAmount
    numAccounts: number
    numClaimableBalances?: number
    numLiquidityPools?: number
    claimableBalancesAmount?: StellarAmount
    liquidityPoolsAmount?: StellarAmount
    flags?: unknown
    issuer: IssuerInfo | null
  }
}

/**
 * Response from GET /asset/search?code=:code
 * Searches for all assets matching a given code (across all issuers).
 */
export interface AssetSearchResponse {
  success: true
  data: AssetMetadata[]
  meta: {
    count: number
    query: string
  }
}

/**
 * Response from GET /health
 * Service health check.
 */
export interface HealthResponse {
  success: true
  data: {
    status: string
    service: string
    version: string
    timestamp: ISOTimestamp
    network: string
  }
}

/**
 * Liquidity pool position information
 */
export interface PoolPosition {
  poolId: string
  shares: StellarAmount
  sharePercent: string
  totalPoolShares: StellarAmount
  reserveA: {
    asset: string
    totalAmount: StellarAmount
    equivalentAmount: StellarAmount
  }
  reserveB: {
    asset: string
    totalAmount: StellarAmount
    equivalentAmount: StellarAmount
  }
  feeBp: number
  totalTrustlines: number
  lastModifiedLedger: number
}

/**
 * Response from GET /account/:id/pool-positions
 * Returns all liquidity pool positions for an account with calculated share values.
 */
export interface PoolPositionsResponse {
  success: true
  data: PoolPosition[]
  meta: {
    count: number
    accountId: StellarPublicKey
    message?: string
  }
}

/**
 * Response from GET /account/:id/transactions/search
 * Returns transactions filtered by memo content.
 */
export interface TransactionSearchResponse {
  success: true
  data: TransactionRecord[]
  meta: {
    count: number
    limit: number
    order: 'asc' | 'desc'
    searchQuery: {
      memo: string
      memoType: 'text' | 'id' | 'hash' | 'return' | 'any'
    }
    nextCursor: string | null
    hasMore: boolean
  }
}

/**
 * Query parameters for GET /account/:id/transactions/search
 */
export interface TransactionSearchParams {
  memo: string
  memo_type?: 'text' | 'id' | 'hash' | 'return'
  limit?: number
  cursor?: string
  order?: 'asc' | 'desc'
}

/**
 * Response from GET /dex/spread/:sellAsset/:buyAsset
 * Returns bid-ask spread data for a DEX trading pair.
 */
export interface SpreadResponse {
  success: true
  data: {
    bestBid: {
      price: StellarAmount
      amount: StellarAmount
    } | null
    bestAsk: {
      price: StellarAmount
      amount: StellarAmount
    } | null
    spreadAbsolute: StellarAmount | null
    spreadPercent: string | null
    midPrice: StellarAmount | null
    liquidity: 'high' | 'medium' | 'low'
    orderBookDepth: {
      bids: number
      asks: number
      totalBidVolume: StellarAmount
      totalAskVolume: StellarAmount
      totalVolume: StellarAmount
    }
  }
}

// ============================================================
// REQUEST PARAMETER TYPES
// ============================================================

/** Query parameters for GET /account/:id/payments */
export interface AccountPaymentsParams {
  limit?: number
  cursor?: string
  order?: 'asc' | 'desc'
}

/** Query parameters for GET /transactions/:id */
export interface TransactionHistoryParams {
  limit?: number
  cursor?: string
  order?: 'asc' | 'desc'
}

/** Query parameters for GET /transactions/:id/operations */
export interface OperationHistoryParams {
  limit?: number
  cursor?: string
  order?: 'asc' | 'desc'
}

/** Query parameters for GET /fee-estimate */
export interface FeeEstimateParams {
  operations?: number
  fresh?: boolean
}

/** Query parameters for GET /network-status */
export interface NetworkStatusParams {
  fresh?: boolean
}

/** Query parameters for GET /asset/search */
export interface AssetSearchParams {
  code: string
  limit?: number
}

// ============================================================
// MODULE DECLARATION
// ============================================================

declare module 'stellarkit-api' {
}
