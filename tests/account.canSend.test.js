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

describe("Account Can Send API", () => {
    const accountId = Keypair.random().publicKey();
    const issuerPublicKey = Keypair.random().publicKey();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("Native XLM", () => {
        it("returns canSend: true for native XLM with sufficient balance", async () => {
            server.loadAccount.mockResolvedValue({
                id: accountId,
                balances: [
                    {
                        asset_type: "native",
                        balance: "100.0000000",
                        selling_liabilities: "0.0000000",
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-send/XLM/native`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.canSend).toBe(true);
            expect(res.body.data.reason).toBeNull();
        });

        it("returns canSend: false for native XLM with insufficient balance after liabilities", async () => {
            server.loadAccount.mockResolvedValue({
                id: accountId,
                balances: [
                    {
                        asset_type: "native",
                        balance: "10.0000000",
                        selling_liabilities: "10.0000000",
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-send/XLM/native`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.canSend).toBe(false);
            expect(res.body.data.reason).toBe("insufficient_balance");
        });

        it("returns 400 for XLM with invalid issuer", async () => {
            const res = await request(app).get(
                `/account/${accountId}/can-send/XLM/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe("Non-native assets", () => {
        it("returns canSend: true for authorized trustline with sufficient balance", async () => {
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
                        selling_liabilities: "10.0000000",
                        is_authorized: true,
                        is_authorized_to_maintain_liabilities: true,
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-send/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.canSend).toBe(true);
            expect(res.body.data.reason).toBeNull();
        });

        it("returns canSend: false when trustline is not authorized", async () => {
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
                        is_authorized: false,
                        is_authorized_to_maintain_liabilities: false,
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-send/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.canSend).toBe(false);
            expect(res.body.data.reason).toBe("not_authorized");
        });

        it("returns canSend: false when balance is insufficient after selling liabilities", async () => {
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
                        limit: "1000.0000000",
                        buying_liabilities: "0",
                        selling_liabilities: "10.0000000",
                        is_authorized: true,
                        is_authorized_to_maintain_liabilities: true,
                    },
                ],
            });

            const res = await request(app).get(
                `/account/${accountId}/can-send/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.canSend).toBe(false);
            expect(res.body.data.reason).toBe("insufficient_balance");
        });

        it("returns canSend: false when trustline does not exist", async () => {
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
                `/account/${accountId}/can-send/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.canSend).toBe(false);
            expect(res.body.data.reason).toBe("no_trustline");
        });
    });

    describe("Validation", () => {
        it("returns 400 for invalid account ID", async () => {
            const res = await request(app).get(
                "/account/INVALID_ID/can-send/USD/GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA"
            );

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it("returns 400 for invalid asset code", async () => {
            const res = await request(app).get(
                `/account/${accountId}/can-send/INVALID!/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it("returns 400 for invalid issuer account ID", async () => {
            const res = await request(app).get(
                `/account/${accountId}/can-send/USD/INVALID_ISSUER`
            );

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
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
                `/account/${accountId}/can-send/USD/${issuerPublicKey}`
            );

            expect(res.statusCode).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });
});
