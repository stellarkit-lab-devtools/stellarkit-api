const request = require("supertest");
const app = require("../src/index");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
    const originalModule = jest.requireActual("../src/config/stellar");
    return {
        ...originalModule,
        server: {
            loadAccount: jest.fn(),
        },
    };
});

const { server } = require("../src/config/stellar");

describe("Account Freeze Status API", () => {
    const accountId = Keypair.random().publicKey();
    const issuerPublicKey = Keypair.random().publicKey();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns freeze status for an authorized trustline", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            balances: [
                {
                    asset_type: "native",
                    balance: "100.0000000",
                },
                {
                    asset_type: "credit_alphanum4",
                    asset_code: "USD",
                    asset_issuer: issuerPublicKey,
                    balance: "10.0000000",
                    is_authorized: true,
                    is_authorized_to_maintain_liabilities: true,
                },
            ],
        });

        const res = await request(app).get(
            `/account/${accountId}/freeze-status/USD/${issuerPublicKey}`
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            accountId,
            asset: {
                assetCode: "USD",
                assetIssuer: issuerPublicKey,
            },
            isFrozen: false,
            isPartiallyFrozen: false,
            canSend: true,
            canReceive: true,
            detail: expect.stringContaining("authorized"),
        });
    });

    it("returns correct partial freeze state when authorization is revoked but liabilities remain", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            balances: [
                {
                    asset_type: "credit_alphanum12",
                    asset_code: "USD",
                    asset_issuer: issuerPublicKey,
                    balance: "5.0000000",
                    is_authorized: false,
                    is_authorized_to_maintain_liabilities: true,
                },
            ],
        });

        const res = await request(app).get(
            `/account/${accountId}/freeze-status/USD/${issuerPublicKey}`
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.data.isFrozen).toBe(false);
        expect(res.body.data.isPartiallyFrozen).toBe(true);
        expect(res.body.data.canSend).toBe(true);
        expect(res.body.data.canReceive).toBe(false);
        expect(res.body.data.detail).toContain("maintain liabilities");
    });

    it("returns 404 when the account does not hold the specified asset", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            balances: [
                {
                    asset_type: "native",
                    balance: "50.0000000",
                },
            ],
        });

        const res = await request(app).get(
            `/account/${accountId}/freeze-status/USD/${issuerPublicKey}`
        );

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toContain("does not hold asset");
    });

    it("returns 400 for invalid account ID", async () => {
        const res = await request(app).get(
            "/account/INVALID_ID/freeze-status/USD/GASOC...INVALID"
        );

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for invalid asset code", async () => {
        const res = await request(app).get(
            `/account/${accountId}/freeze-status/INVALID_CODE!/${issuerPublicKey}`
        );

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("ValidationError");
    });
});
