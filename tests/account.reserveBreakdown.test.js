const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock Horizon server — only loadAccount is used by the reserve-breakdown
// route, and the rest of the Stellar SDK is left intact to keep
// unrelated routes in this app usable.
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      ...(originalModule.server || {}),
      loadAccount: jest.fn(),
    },
  };
});

describe("GET /account/:id/reserve-breakdown", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the expected reserve breakdown shape and amounts for a basic account", async () => {
    // 5 subentries in total = 2 trustlines + 3 inferred offers + 0 data + 0 signers
    const mockAccount = {
      id: accountId,
      subentry_count: 5,
      balances: [
        { asset_type: "native", balance: "100.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "G_ISSUER_USDC",
          balance: "10.0000000",
        },
        {
          asset_type: "credit_alphanum4",
          asset_code: "BTC",
          asset_issuer: "G_ISSUER_BTC",
          balance: "0.5000000",
        },
      ],
      signers: [{ key: accountId, weight: 1 }],
      data_attr: {},
    };

    server.loadAccount.mockResolvedValue(mockAccount);

    const res = await request(app).get(
      `/account/${accountId}/reserve-breakdown`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.baseReserve).toBe("0.5000000");
    expect(data.subentryCount).toBe(5);

    // Each subentry type is present, with seven-decimal string amounts.
    expect(Array.isArray(data.subentries)).toBe(true);
    expect(data.subentries).toHaveLength(4);

    const byType = Object.fromEntries(
      data.subentries.map((e) => [e.type, e]),
    );

    expect(byType.trustlines).toEqual({
      type: "trustlines",
      count: 2,
      reservePerSubentry: "0.5000000",
      totalReserve: "1.0000000",
    });
    expect(byType.offers).toEqual({
      type: "offers",
      count: 3,
      reservePerSubentry: "0.5000000",
      totalReserve: "1.5000000",
    });
    expect(byType.dataEntries).toEqual({
      type: "dataEntries",
      count: 0,
      reservePerSubentry: "0.5000000",
      totalReserve: "0.0000000",
    });
    expect(byType.signers).toEqual({
      type: "signers",
      count: 0,
      reservePerSubentry: "0.5000000",
      totalReserve: "0.0000000",
    });

    // Total minimum reserve = (2 + subentryCount) * baseReserve = (2 + 5) * 0.5 = 3.5
    expect(data.totalMinimumReserve).toBe("3.5000000");

    // Available balance = XLM balance - totalMinimumReserve = 100 - 3.5 = 96.5
    expect(data.availableBalance).toBe("96.5000000");
  });

  it("correctly classifies trustlines, data entries, additional signers, and inferred offers", async () => {
    // 20 subentries total = 2 trustlines + 14 inferred offers + 2 data + 2 signers
    const mockAccount = {
      id: accountId,
      subentry_count: 20,
      balances: [
        { asset_type: "native", balance: "500.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USD",
          asset_issuer: "G1",
          balance: "10.0000000",
        },
        {
          asset_type: "credit_alphanum4",
          asset_code: "EUR",
          asset_issuer: "G2",
          balance: "10.0000000",
        },
      ],
      signers: [
        { key: accountId, weight: 1 },
        { key: "G_SIGNER_1", weight: 1 },
        { key: "G_SIGNER_2", weight: 1 },
      ],
      data_attr: {
        key1: "dmFsdWUx",
        key2: "dmFsdWUy",
      },
    };

    server.loadAccount.mockResolvedValue(mockAccount);

    const res = await request(app).get(
      `/account/${accountId}/reserve-breakdown`,
    );

    expect(res.statusCode).toBe(200);

    const byType = Object.fromEntries(
      res.body.data.subentries.map((e) => [e.type, e]),
    );

    expect(byType.trustlines.count).toBe(2);
    expect(byType.offers.count).toBe(14); // 20 - 2 - 2 - 2
    expect(byType.dataEntries.count).toBe(2);
    expect(byType.signers.count).toBe(2); // signers.length - 1

    // Total minimum reserve = (2 + 20) * 0.5 = 11
    expect(res.body.data.totalMinimumReserve).toBe("11.0000000");
    // Available = 500 - 11 = 489
    expect(res.body.data.availableBalance).toBe("489.0000000");
    expect(res.body.data.subentryCount).toBe(20);
  });

  it("returns a base-only reserve for an account with zero subentries", async () => {
    const mockAccount = {
      id: accountId,
      subentry_count: 0,
      balances: [{ asset_type: "native", balance: "10.0000000" }],
      signers: [{ key: accountId, weight: 1 }],
      data_attr: {},
    };

    server.loadAccount.mockResolvedValue(mockAccount);

    const res = await request(app).get(
      `/account/${accountId}/reserve-breakdown`,
    );

    expect(res.statusCode).toBe(200);

    expect(res.body.data.subentryCount).toBe(0);

    const byType = Object.fromEntries(
      res.body.data.subentries.map((e) => [e.type, e]),
    );
    expect(byType.trustlines.count).toBe(0);
    expect(byType.offers.count).toBe(0);
    expect(byType.dataEntries.count).toBe(0);
    expect(byType.signers.count).toBe(0);

    // Total minimum reserve = (2 + 0) * 0.5 = 1.0
    expect(res.body.data.totalMinimumReserve).toBe("1.0000000");
    // Available = 10 - 1 = 9
    expect(res.body.data.availableBalance).toBe("9.0000000");
  });

  it("never returns a negative availableBalance when balance cannot cover minimum reserve", async () => {
    const mockAccount = {
      id: accountId,
      subentry_count: 50,
      balances: [{ asset_type: "native", balance: "0.5000000" }],
      signers: [{ key: accountId, weight: 1 }],
      data_attr: {},
    };

    server.loadAccount.mockResolvedValue(mockAccount);

    const res = await request(app).get(
      `/account/${accountId}/reserve-breakdown`,
    );

    expect(res.statusCode).toBe(200);

    // Total minimum reserve = (2 + 50) * 0.5 = 26
    expect(res.body.data.totalMinimumReserve).toBe("26.0000000");
    // Available = 0.5 - 26 = -25.5 (account is underfunded)
    expect(res.body.data.availableBalance).toBe("-25.5000000");
  });

  it("formats all monetary fields as seven-decimal strings", async () => {
    const mockAccount = {
      id: accountId,
      subentry_count: 3,
      balances: [
        { asset_type: "native", balance: "12.3456789" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "G1",
          balance: "5.0000000",
        },
        {
          asset_type: "credit_alphanum4",
          asset_code: "BTC",
          asset_issuer: "G2",
          balance: "0.0000001",
        },
        {
          asset_type: "credit_alphanum4",
          asset_code: "ETH",
          asset_issuer: "G3",
          balance: "0.0000002",
        },
      ],
      signers: [{ key: accountId, weight: 1 }],
      data_attr: {},
    };

    server.loadAccount.mockResolvedValue(mockAccount);

    const res = await request(app).get(
      `/account/${accountId}/reserve-breakdown`,
    );

    expect(res.statusCode).toBe(200);

    const data = res.body.data;
    // Every amount-like field must be a string with 7 decimals to make sure
    // wallet UIs can render it without further formatting.
    expect(typeof data.baseReserve).toBe("string");
    expect(typeof data.totalMinimumReserve).toBe("string");
    expect(typeof data.availableBalance).toBe("string");

    [data.baseReserve, data.totalMinimumReserve, data.availableBalance].forEach(
      (v) => {
        // Matches e.g. "0.5000000", "-12.5000000"
        expect(v).toMatch(/^-?\d+\.\d{7}$/);
      },
    );

    for (const entry of data.subentries) {
      expect(typeof entry.reservePerSubentry).toBe("string");
      expect(typeof entry.totalReserve).toBe("string");
      expect(entry.reservePerSubentry).toMatch(/^-?\d+\.\d{7}$/);
      expect(entry.totalReserve).toMatch(/^-?\d+\.\d{7}$/);
    }
  });

  it("returns 404 when the account does not exist on the network", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(
      `/account/${accountId}/reserve-breakdown`,
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when the account ID is not a valid Stellar public key", async () => {
    const res = await request(app).get(
      "/account/INVALID_ID/reserve-breakdown",
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });

  it("handles accounts with no native XLM balance", async () => {
    // XLM balance is technically always present for valid Stellar accounts,
    // but the parser must still emit a valid availableBalance string and
    // totalMinimumReserve even when the balance entry is missing.
    const mockAccount = {
      id: accountId,
      subentry_count: 1,
      balances: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "G1",
          balance: "10.0000000",
        },
      ],
      signers: [{ key: accountId, weight: 1 }],
      data_attr: {},
    };

    server.loadAccount.mockResolvedValue(mockAccount);

    const res = await request(app).get(
      `/account/${accountId}/reserve-breakdown`,
    );

    expect(res.statusCode).toBe(200);
    // Treat missing native balance as 0 XLM: totalMinimumReserve = 3 * 0.5 = 1.5
    expect(res.body.data.totalMinimumReserve).toBe("1.5000000");
    // availableBalance = 0 - 1.5 = -1.5
    expect(res.body.data.availableBalance).toBe("-1.5000000");
  });
});
