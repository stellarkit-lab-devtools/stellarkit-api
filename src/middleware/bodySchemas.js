/**
 * Declarative schemas for every POST request body in the API.
 * Applied with validateBody(schema) in each route (see PR description for the list).
 */
const string = { type: "string", minLength: 1 };
const addressList = (maxItems = 20) => ({
  type: "array",
  items: { type: "string" },
  minItems: 1,
  maxItems,
});

module.exports = {
  multisigPlan: {
    properties: { availableSigners: addressList(20) },
    required: ["availableSigners"],
  },
  multisigInfo: {
    properties: { accountIds: addressList(20) },
    required: ["accountIds"],
  },
  accountFreezeStatus: {
    properties: {
      addresses: addressList(20),
      asset: { type: ["object", "string"] },
    },
    required: ["addresses", "asset"],
  },
  nativeBalances: {
    properties: { addresses: addressList(20) },
    required: ["addresses"],
  },
  accountEffects: {
    properties: {
      addresses: addressList(10),
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
    required: ["addresses"],
  },
  trustStatus: {
    properties: {
      addresses: addressList(20),
      asset: { type: ["object", "string"] },
    },
    required: ["addresses", "asset"],
  },
  accountSigners: {
    properties: { addresses: addressList(20) },
    required: ["addresses"],
  },
  transactionCounts: {
    properties: { addresses: addressList(20) },
    required: ["addresses"],
  },
  transactionBatchStatus: {
    properties: { hashes: addressList(20) },
    required: ["hashes"],
  },
  feeBatch: {
    properties: {
      transactions: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: string,
            operationCount: { type: "integer", minimum: 1 },
          },
          required: ["type", "operationCount"],
        },
      },
    },
    required: ["transactions"],
  },
  webhook: {
    properties: {
      url: { type: "string", minLength: 1 },
      events: addressList(50),
      accountId: { type: "string" },
      minAmount: { type: ["string", "number"] },
      assetCode: { type: "string" },
      assetIssuer: { type: "string" },
    },
    required: ["url", "events"],
  },
  webhookAction: { properties: {} },
  validateMemo: {
    properties: { type: string, value: { type: "string" } },
    required: ["type", "value"],
  },
  decodeXdr: {
    properties: { xdr: string },
    required: ["xdr"],
  },
  decodeTransaction: {
    properties: { xdr: string },
    required: ["xdr"],
  },
  simulatePayment: {
    properties: {
      source: string,
      destination: string,
      amount: { type: ["number", "string"] },
      assetCode: { type: "string" },
      assetIssuer: { type: "string" },
    },
    required: ["source", "destination", "amount"],
  },
};
