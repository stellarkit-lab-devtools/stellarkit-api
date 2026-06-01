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

describe("Account Can Receive API", () => {
    const accountId = Keypair.random().publicKey();
    const issuerPublicKey = Keypair.random().publicKey();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("Native XLM", () => {
        it("returns canReceive: true for native XLM", async () => {
            server.loadAccount.mockResolvedValue({
                id: accountId,
                balances: [
                    {
                        asset_type: "native",
                        balance: "100.0000000",
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-receive/XLM/native`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual({
                accountId,
                asset: {
                    assetCode: "XLM",
                    assetIssuer: "native",
                },
                canReceive: true,
                reasons: [],
                trustlineExists: true,
                isAuthorized: true,
                availableCapacity: null,
                currentBalance: 100.0,
                limit: null,
            });
        });

        it("returns 400 for XLM with invalid issuer", async () => {
            const res = await request(app).get(
                `/account/${accountId}/can-receive/XLM/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
        });
    });

    describe("Non-native assets", () => {
        it("returns canReceive: true for authorized trustline with capacity", async () => {
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
                        balance: "50.0000000",
                        limit: "1000.0000000",
                        buying_liabilities: "0",
                        selling_liabilities: "0",
                        is_authorized: true,
                        is_authorized_to_maintain_liabilities: true,
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-receive/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.data.canReceive).toBe(true);
            expect(res.body.data.reasons).toEqual([]);
            expect(res.body.data.trustlineExists).toBe(true);
            expect(res.body.data.isAuthorized).toBe(true);
            expect(res.body.data.availableCapacity).toBe(950.0);
            expect(res.body.data.currentBalance).toBe(50.0);
            expect(res.body.data.limit).toBe(1000.0);
        });

        it("returns canReceive: false when trustline is unauthorized", async () => {
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
                        balance: "0.0000000",
                        limit: "1000.0000000",
                        buying_liabilities: "0",
                        selling_liabilities: "0",
                        is_authorized: false,
                        is_authorized_to_maintain_liabilities: false,
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-receive/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.data.canReceive).toBe(false);
            expect(res.body.data.reasons).toContain(
                "Trustline is not authorized by the issuer."
            );
            expect(res.body.data.isAuthorized).toBe(false);
        });

        it("returns canReceive: false when trustline capacity is exhausted", async () => {
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
                        balance: "1000.0000000",
                        limit: "1000.0000000",
                        buying_liabilities: "0",
                        selling_liabilities: "0",
                        is_authorized: true,
                        is_authorized_to_maintain_liabilities: true,
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-receive/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.data.canReceive).toBe(false);
            expect(res.body.data.reasons).toContain(
                "No available capacity on trustline (limit reached or fully utilized)."
            );
            expect(res.body.data.availableCapacity).toBe(0);
        });

        it("returns canReceive: false when buying liabilities reduce capacity", async () => {
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
                        balance: "300.0000000",
                        limit: "1000.0000000",
                        buying_liabilities: "700.0000000",
                        selling_liabilities: "0",
                        is_authorized: true,
                        is_authorized_to_maintain_liabilities: true,
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-receive/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.data.canReceive).toBe(false);
            expect(res.body.data.availableCapacity).toBe(0);
            expect(res.body.data.reasons).toContain(
                "No available capacity on trustline (limit reached or fully utilized)."
            );
        });

        it("returns canReceive: false when trustline does not exist", async () => {
            server.loadAccount.mockResolvedValue({
                id: accountId,
                balances: [
                    {
                        asset_type: "native",
                        balance: "100.0000000",
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-receive/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.data.canReceive).toBe(false);
            expect(res.body.data.trustlineExists).toBe(false);
            expect(res.body.data.isAuthorized).toBe(false);
            expect(res.body.data.reasons).toContain(
                "No trustline exists for this asset."
            );
            expect(res.body.data.availableCapacity).toBe(0);
            expect(res.body.data.currentBalance).toBe(0);
            expect(res.body.data.limit).toBe(0);
        });
    });

    describe("Validation", () => {
        it("returns 400 for invalid account ID", async () => {
            const res = await request(app).get(
                "/account/INVALID_ID/can-receive/USD/GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA"
            );

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
        });

        it("returns 400 for invalid asset code", async () => {
            const res = await request(app).get(
                `/account/${accountId}/can-receive/INVALID_CODE!/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
        });

        it("returns 400 for invalid issuer account ID", async () => {
            const res = await request(app).get(
                `/account/${accountId}/can-receive/USD/INVALID_ISSUER`
            );

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
        });
    });

    describe("Account not found", () => {
        it("returns 404 when account does not exist", async () => {
            const horizonError = new Error("Not found");
            horizonError.response = {
                status: 404,
                data: {
                    title: "Resource Not Found",
                    detail: "The resource at the url requested was not found.",
                },
            };

            server.loadAccount.mockRejectedValue(horizonError);

            const res = await request(app).get(
                `/account/${accountId}/can-receive/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });
});
