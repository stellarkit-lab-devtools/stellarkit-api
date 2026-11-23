import { expectType, expectError, expectAssignable } from 'tsd';
import { StellarKitClient, StellarKitError } from '../../stellarkit-client';
import type {
  HealthResponse,
  NetworkStatusResponse,
  FeeEstimateResponse,
  AccountResponse,
  AccountAgeResponse,
  AccountBalancesResponse,
  AccountRiskScoreResponse,
  AccountPaymentsResponse,
  TransactionHistoryResponse,
  OperationHistoryResponse,
  AssetResponse,
  AssetSearchResponse,
  PoolPositionsResponse,
  TransactionSearchResponse,
} from '../../../types/index.d';

// Client construction
const client = new StellarKitClient({ baseUrl: 'https://api.stellarkit.io' });
expectType<StellarKitClient>(client);

const clientWithKey = new StellarKitClient({
  baseUrl: 'https://api.stellarkit.io',
  apiKey: 'sk_test_123',
});
expectType<StellarKitClient>(clientWithKey);

// Constructor should require baseUrl
// @ts-expect-error
new StellarKitClient({});

// @ts-expect-error
new StellarKitClient({ apiKey: 'key' });

// Health endpoint
expectType<Promise<HealthResponse['data']>>(client.getHealth());

// Network endpoints
expectType<Promise<NetworkStatusResponse['data']>>(
  client.getNetworkStatus()
);
expectType<Promise<NetworkStatusResponse['data']>>(
  client.getNetworkStatus({ fresh: true })
);

// @ts-expect-error
client.getNetworkStatus({ invalid: true });

// Fee estimate
expectType<Promise<FeeEstimateResponse['data']>>(client.getFeeEstimate());
expectType<Promise<FeeEstimateResponse['data']>>(
  client.getFeeEstimate(5, true)
);

// Account endpoints
const accountId = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

expectType<Promise<AccountResponse['data']>>(client.getAccount(accountId));

expectType<Promise<AccountAgeResponse['data']>>(
  client.getAccountAge(accountId)
);

expectType<Promise<AccountBalancesResponse['data']>>(
  client.getAccountBalances(accountId)
);

expectType<Promise<AccountRiskScoreResponse['data']>>(
  client.getAccountRiskScore(accountId)
);

// Account payments with options
expectType<Promise<AccountPaymentsResponse['data']>>(
  client.getAccountPayments(accountId)
);

expectType<Promise<AccountPaymentsResponse['data']>>(
  client.getAccountPayments(accountId, {
    limit: 10,
    order: 'asc',
    cursor: 'abc123',
  })
);

// Options object should reject unknown keys
// @ts-expect-error
client.getAccountPayments(accountId, { invalid: true });

// Transaction history
expectType<Promise<TransactionHistoryResponse['data']>>(
  client.getTransactionHistory(accountId)
);

expectType<Promise<TransactionHistoryResponse['data']>>(
  client.getTransactionHistory(accountId, {
    limit: 20,
    order: 'desc',
  })
);

// Operations
expectType<Promise<OperationHistoryResponse['data']>>(
  client.getTransactionOperations(accountId)
);

// Asset endpoints
const assetCode = 'USDC';
const assetIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

expectType<Promise<AssetResponse['data']>>(
  client.getAsset(assetCode, assetIssuer)
);

expectType<Promise<AssetSearchResponse['data']>>(
  client.searchAssets(assetCode)
);

expectType<Promise<AssetSearchResponse['data']>>(
  client.searchAssets(assetCode, 20)
);

// Pool positions
expectType<Promise<PoolPositionsResponse['data']>>(
  client.getAccountPoolPositions(accountId)
);

// Transaction search
expectType<Promise<TransactionSearchResponse['data']>>(
  client.searchAccountTransactions(accountId, 'memo123')
);

expectType<Promise<TransactionSearchResponse['data']>>(
  client.searchAccountTransactions(accountId, 'memo123', {
    memo_type: 'text',
    limit: 10,
  })
);

// Validate signers
expectType<Promise<unknown>>(
  client.validateAccountSigners(accountId, [
    'GABC123...',
    'GDEF456...',
  ])
);

// @ts-expect-error
client.validateAccountSigners(accountId, 'invalid');

// Multisig plan
expectType<Promise<unknown>>(
  client.createMultisigPlan(accountId, ['GABC123...'])
);

// Batch transaction status
expectType<Promise<unknown>>(
  client.getBatchTransactionStatus(['hash1', 'hash2'])
);

// @ts-expect-error
client.getBatchTransactionStatus('invalid');

// Decode XDR
expectType<Promise<unknown>>(client.decodeXdr('base64string'));

// @ts-expect-error
client.decodeXdr(123);

// Soroban contract
expectType<Promise<unknown>>(
  client.getSorobanContract('CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2')
);

// StellarKitError type
const error = new StellarKitError('error message', 400, 'ValidationError');
expectType<StellarKitError>(error);
expectType<string>(error.message);
expectType<number>(error.status);
expectType<string>(error.type);
expectType<string>(error.name);

// Error should extend Error
expectAssignable<Error>(error);

// Ensure error properties are readonly
// @ts-expect-error
error.status = 500;

// @ts-expect-error
error.type = 'NewType';
