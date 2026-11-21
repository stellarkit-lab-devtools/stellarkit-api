import { expectType, expectError, expectAssignable } from 'tsd';
import type {
  HealthResponse,
  NetworkStatusResponse,
  FeeEstimateResponse,
  AccountResponse,
  AccountAgeResponse,
  AccountBalancesResponse,
  AccountRiskScoreResponse,
  AccountSignersResponse,
  AccountTrustlinesResponse,
  AccountPaymentsResponse,
  TransactionHistoryResponse,
  OperationHistoryResponse,
  AssetResponse,
  AssetSearchResponse,
  PoolPositionsResponse,
  TransactionSearchResponse,
} from '../../../types/index.d';

// Health Response
declare const healthResponse: HealthResponse;
expectType<boolean>(healthResponse.success);
expectType<{ status: string; timestamp: string }>(healthResponse.data);

// Network Status Response
declare const networkStatus: NetworkStatusResponse;
expectType<boolean>(networkStatus.success);
expectType<number>(networkStatus.data.latestLedger);
expectType<string>(networkStatus.data.latestLedgerCloseTime);
expectType<number>(networkStatus.data.currentProtocolVersion);

// Fee Estimate Response
declare const feeEstimate: FeeEstimateResponse;
expectType<boolean>(feeEstimate.success);
expectType<number>(feeEstimate.data.recommended);
expectType<number>(feeEstimate.data.min);
expectType<number>(feeEstimate.data.mode);
expectType<number>(feeEstimate.data.p10);
expectType<number>(feeEstimate.data.p50);
expectType<number>(feeEstimate.data.p90);

// Account Response
declare const accountResponse: AccountResponse;
expectType<boolean>(accountResponse.success);
expectType<string>(accountResponse.data.id);
expectType<string>(accountResponse.data.accountId);
expectType<number>(accountResponse.data.sequence);

// Account Age Response
declare const accountAge: AccountAgeResponse;
expectType<boolean>(accountAge.success);
expectType<string>(accountAge.data.accountId);
expectType<string>(accountAge.data.createdAt);
expectType<number>(accountAge.data.ageInDays);

// Account Balances Response
declare const balances: AccountBalancesResponse;
expectType<boolean>(balances.success);
expectType<string>(balances.data.accountId);
expectType<Array<any>>(balances.data.balances);

// Account Risk Score Response
declare const riskScore: AccountRiskScoreResponse;
expectType<boolean>(riskScore.success);
expectType<string>(riskScore.data.accountId);
expectType<'low' | 'medium' | 'high' | 'unknown'>(riskScore.data.riskLevel);
expectType<number>(riskScore.data.score);

// Risk level union type should reject invalid values
// @ts-expect-error
const invalidRisk: AccountRiskScoreResponse['data']['riskLevel'] = 'invalid';

// Account Signers Response
declare const signers: AccountSignersResponse;
expectType<boolean>(signers.success);
expectType<string>(signers.data.accountId);
expectType<Array<any>>(signers.data.signers);

// Account Trustlines Response
declare const trustlines: AccountTrustlinesResponse;
expectType<boolean>(trustlines.success);
expectType<string>(trustlines.data.accountId);
expectType<Array<any>>(trustlines.data.trustlines);

// Account Payments Response
declare const payments: AccountPaymentsResponse;
expectType<boolean>(payments.success);
expectType<string>(payments.data.accountId);
expectType<Array<any>>(payments.data.payments);

// Transaction History Response
declare const txHistory: TransactionHistoryResponse;
expectType<boolean>(txHistory.success);
expectType<string>(txHistory.data.accountId);
expectType<Array<any>>(txHistory.data.transactions);

// Operation History Response
declare const opHistory: OperationHistoryResponse;
expectType<boolean>(opHistory.success);
expectType<string>(opHistory.data.accountId);
expectType<Array<any>>(opHistory.data.operations);

// Asset Response
declare const assetResponse: AssetResponse;
expectType<boolean>(assetResponse.success);
expectType<string>(assetResponse.data.assetCode);
expectType<string>(assetResponse.data.assetIssuer);

// Asset Search Response
declare const assetSearch: AssetSearchResponse;
expectType<boolean>(assetSearch.success);
expectType<Array<any>>(assetSearch.data.assets);

// Pool Positions Response
declare const poolPositions: PoolPositionsResponse;
expectType<boolean>(poolPositions.success);
expectType<string>(poolPositions.data.accountId);
expectType<Array<any>>(poolPositions.data.positions);

// Transaction Search Response
declare const txSearch: TransactionSearchResponse;
expectType<boolean>(txSearch.success);
expectType<string>(txSearch.data.accountId);
expectType<string>(txSearch.data.memo);
expectType<Array<any>>(txSearch.data.transactions);

// All responses should have success property
expectType<boolean>(healthResponse.success);
expectType<boolean>(networkStatus.success);
expectType<boolean>(feeEstimate.success);
expectType<boolean>(accountResponse.success);
