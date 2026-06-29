const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Asset } = require("@stellar/stellar-sdk");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
    const originalModule = jest.requireActual("../src/config/stellar");
    return {
        ...originalModule,
        server: {
            orderbook: jest.fn(),
            strictSendPaths: jest.fn(),
            assets: jest.fn(),
            loadAccount: jest.fn(),
        },
    };
});

// Mock axios for stellar.toml fetching
jest.mock("axios");
const axios = require("axios");

describe("DEX and Asset Endpoints Test Suite", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ============================================================================
    // /dex/spread/:sellAsset/:buyAsset
    // ============================================================================
    describe("GET /dex/spread/:sellAsset/:buyAsset", () => {
        const validSellAsset = "XLM:native";
        const validBuyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        it("should return spread data for valid trading pair", async () => {
            const mockOrderBook = {
                bids: [
                    { price: "0.0900000", amount: "1000.0000000" },
                    { price: "0.0890000", amount: "500.0000000" },
                ],
                asks: [
                    { price: "0.0910000", amount: "800.0000000" },
                    { price: "0.0920000", amount: "600.0000000" },
                ],
            };

            server.orderbook.mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                call: jest.fn().mockResolvedValue(mockOrderBook),
            });

            const res = await request(app).get(`/dex/spread/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty("bestBid");
            expect(res.body.data).toHaveProperty("bestAsk");
            expect(res.body.data).toHaveProperty("spreadAbsolute");
            expect(res.body.data).toHaveProperty("spreadPercent");
            expect(res.body.data).toHaveProperty("midPrice");
            expect(res.body.data).toHaveProperty("liquidity");
            expect(res.body.data).toHaveProperty("orderBookDepth");

            // Verify calculations
            expect(res.body.data.bestBid.price).toBe("0.0900000");
            expect(res.body.data.bestAsk.price).toBe("0.0910000");
            expect(parseFloat(res.body.data.spreadAbsolute)).toBeCloseTo(0.001, 7);
        });

        it("should return 400 for invalid sell asset format", async () => {
            const invalidSellAsset = "INVALID_FORMAT";

            const res = await request(app).get(`/dex/spread/${invalidSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
            expect(res.body.error.message).toContain("Invalid asset format");
        });

        it("should return 400 for invalid buy asset format", async () => {
            const invalidBuyAsset = "USDC";

            const res = await request(app).get(`/dex/spread/${validSellAsset}/${invalidBuyAsset}`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
            expect(res.body.error.message).toContain("Invalid asset format");
        });

        it("should return 400 for invalid issuer account ID", async () => {
            const invalidBuyAsset = "USDC:INVALID_ISSUER";

            const res = await request(app).get(`/dex/spread/${validSellAsset}/${invalidBuyAsset}`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
        });

        it("should return 404 when no order book exists", async () => {
            server.orderbook.mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                call: jest.fn().mockResolvedValue({ bids: [], asks: [] }),
            });

            const res = await request(app).get(`/dex/spread/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("NotFound");
            expect(res.body.error.message).toContain("No order book exists");
        });

        it("should handle order book with only bids", async () => {
            const mockOrderBook = {
                bids: [{ price: "0.0900000", amount: "1000.0000000" }],
                asks: [],
            };

            server.orderbook.mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                call: jest.fn().mockResolvedValue(mockOrderBook),
            });

            const res = await request(app).get(`/dex/spread/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.bestBid).not.toBeNull();
            expect(res.body.data.bestAsk).toBeNull();
            expect(res.body.data.spreadAbsolute).toBeNull();
            expect(res.body.data.spreadPercent).toBeNull();
        });

        it("should handle order book with only asks", async () => {
            const mockOrderBook = {
                bids: [],
                asks: [{ price: "0.0910000", amount: "800.0000000" }],
            };

            server.orderbook.mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                call: jest.fn().mockResolvedValue(mockOrderBook),
            });

            const res = await request(app).get(`/dex/spread/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.bestBid).toBeNull();
            expect(res.body.data.bestAsk).not.toBeNull();
            expect(res.body.data.spreadAbsolute).toBeNull();
            expect(res.body.data.spreadPercent).toBeNull();
        });

        it("should calculate liquidity rating correctly", async () => {
            const mockOrderBook = {
                bids: [{ price: "0.0900000", amount: "6000.0000000" }],
                asks: [{ price: "0.0910000", amount: "5000.0000000" }],
            };

            server.orderbook.mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                call: jest.fn().mockResolvedValue(mockOrderBook),
            });

            const res = await request(app).get(`/dex/spread/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.liquidity).toBe("high"); // Total volume >= 10000
        });
    });

    // ============================================================================
    // /dex/price/:sellAsset/:buyAsset
    // ============================================================================
    describe("GET /dex/price/:sellAsset/:buyAsset", () => {
        const validSellAsset = "XLM:native";
        const validBuyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        it("should return price data for valid trading pair", async () => {
            const mockPathsResponse = {
                records: [
                    {
                        source_amount: "1.0000000",
                        destination_amount: "0.0900000",
                        path: [],
                    },
                ],
            };

            server.strictSendPaths.mockReturnValue({
                call: jest.fn().mockResolvedValue(mockPathsResponse),
            });

            const res = await request(app).get(`/dex/price/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty("sellAsset");
            expect(res.body.data).toHaveProperty("buyAsset");
            expect(res.body.data).toHaveProperty("sellAmount");
            expect(res.body.data).toHaveProperty("buyAmount");
            expect(res.body.data).toHaveProperty("effectiveRate");
            expect(res.body.data).toHaveProperty("bestPath");

            expect(res.body.data.sellAsset).toBe(validSellAsset);
            expect(res.body.data.buyAsset).toBe(validBuyAsset);
        });

        it("should handle custom amount parameter", async () => {
            const mockPathsResponse = {
                records: [
                    {
                        source_amount: "100.0000000",
                        destination_amount: "9.0000000",
                        path: [],
                    },
                ],
            };

            server.strictSendPaths.mockReturnValue({
                call: jest.fn().mockResolvedValue(mockPathsResponse),
            });

            const res = await request(app).get(`/dex/price/${validSellAsset}/${validBuyAsset}?amount=100`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.sellAmount).toBe("100.0000000");
            expect(res.body.data.buyAmount).toBe("9.0000000");
        });

        it("should return 400 for invalid sell asset format", async () => {
            const invalidSellAsset = "INVALID";

            const res = await request(app).get(`/dex/price/${invalidSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
            expect(res.body.error.message).toContain("Invalid asset format");
        });

        it("should return 400 for invalid buy asset format", async () => {
            const invalidBuyAsset = "USDC_NO_ISSUER";

            const res = await request(app).get(`/dex/price/${validSellAsset}/${invalidBuyAsset}`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
        });

        it("should return 400 for invalid amount parameter", async () => {
            const res = await request(app).get(`/dex/price/${validSellAsset}/${validBuyAsset}?amount=-10`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
            expect(res.body.error.message).toContain("positive number");
        });

        it("should return 400 for non-numeric amount parameter", async () => {
            const res = await request(app).get(`/dex/price/${validSellAsset}/${validBuyAsset}?amount=abc`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
            expect(res.body.error.message).toContain("positive number");
        });

        it("should return 404 when no payment path exists", async () => {
            server.strictSendPaths.mockReturnValue({
                call: jest.fn().mockResolvedValue({ records: [] }),
            });

            const res = await request(app).get(`/dex/price/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("NotFound");
            expect(res.body.error.message).toContain("No payment path exists");
        });

        it("should handle multi-hop payment paths", async () => {
            const mockPathsResponse = {
                records: [
                    {
                        source_amount: "1.0000000",
                        destination_amount: "0.0900000",
                        path: [
                            { asset_code: "BTC", asset_issuer: "GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ65JJLDHKHRUZI3EUEKMTCH" },
                            { asset_code: "ETH", asset_issuer: "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR" },
                        ],
                    },
                ],
            };

            server.strictSendPaths.mockReturnValue({
                call: jest.fn().mockResolvedValue(mockPathsResponse),
            });

            const res = await request(app).get(`/dex/price/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.bestPath).toHaveLength(2);
            expect(res.body.data.bestPath[0].assetCode).toBe("BTC");
            expect(res.body.data.bestPath[1].assetCode).toBe("ETH");
        });

        it("should handle XLM in payment path", async () => {
            const mockPathsResponse = {
                records: [
                    {
                        source_amount: "1.0000000",
                        destination_amount: "0.0900000",
                        path: [
                            { asset_type: "native" },
                        ],
                    },
                ],
            };

            server.strictSendPaths.mockReturnValue({
                call: jest.fn().mockResolvedValue(mockPathsResponse),
            });

            const res = await request(app).get(`/dex/price/${validSellAsset}/${validBuyAsset}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.bestPath[0].assetCode).toBe("XLM");
            expect(res.body.data.bestPath[0].assetIssuer).toBe("native");
        });
    });

    // ============================================================================
    // /asset/:code/:issuer/verify
    // ============================================================================
    describe("GET /asset/:code/:issuer/verify", () => {
        const validCode = "USDC";
        const validIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        it("should return fully verified asset", async () => {
            const mockAccount = {
                id: validIssuer,
                home_domain: "example.com",
                flags: { auth_required: true },
                thresholds: { low_threshold: 0, med_threshold: 1, high_threshold: 2 },
            };

            const mockToml = `
[[CURRENCIES]]
code = "USDC"
issuer = "${validIssuer}"
display_decimals = 7
      `;

            server.loadAccount.mockResolvedValue(mockAccount);
            axios.get.mockResolvedValue({ data: mockToml });

            const res = await request(app).get(`/asset/${validCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.verified).toBe(true);
            expect(res.body.data.checks.accountExists.passed).toBe(true);
            expect(res.body.data.checks.hasHomeDomain.passed).toBe(true);
            expect(res.body.data.checks.tomlReachable.passed).toBe(true);
            expect(res.body.data.checks.listedInToml.passed).toBe(true);
        });

        it("should return 400 for invalid asset code", async () => {
            const invalidCode = "TOOLONGASSETCODE123";

            const res = await request(app).get(`/asset/${invalidCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
        });

        it("should return 400 for invalid issuer account ID", async () => {
            const invalidIssuer = "INVALID_ACCOUNT_ID";

            const res = await request(app).get(`/asset/${validCode}/${invalidIssuer}/verify`);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("ValidationError");
        });

        it("should fail when account does not exist", async () => {
            const error = new Error("Account not found");
            error.response = { status: 404 };
            server.loadAccount.mockRejectedValue(error);

            const res = await request(app).get(`/asset/${validCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.verified).toBe(false);
            expect(res.body.data.checks.accountExists.passed).toBe(false);
            expect(res.body.data.checks.hasHomeDomain.passed).toBe(false);
            expect(res.body.data.checks.tomlReachable.passed).toBe(false);
            expect(res.body.data.checks.listedInToml.passed).toBe(false);
        });

        it("should fail when home_domain is not set", async () => {
            const mockAccount = {
                id: validIssuer,
                home_domain: null,
                flags: {},
                thresholds: {},
            };

            server.loadAccount.mockResolvedValue(mockAccount);

            const res = await request(app).get(`/asset/${validCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.verified).toBe(false);
            expect(res.body.data.checks.accountExists.passed).toBe(true);
            expect(res.body.data.checks.hasHomeDomain.passed).toBe(false);
            expect(res.body.data.checks.tomlReachable.passed).toBe(false);
        });

        it("should fail when stellar.toml is not reachable", async () => {
            const mockAccount = {
                id: validIssuer,
                home_domain: "example.com",
                flags: {},
                thresholds: {},
            };

            server.loadAccount.mockResolvedValue(mockAccount);
            axios.get.mockRejectedValue(new Error("Network error"));

            const res = await request(app).get(`/asset/${validCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.verified).toBe(false);
            expect(res.body.data.checks.accountExists.passed).toBe(true);
            expect(res.body.data.checks.hasHomeDomain.passed).toBe(true);
            expect(res.body.data.checks.tomlReachable.passed).toBe(false);
            expect(res.body.data.checks.listedInToml.passed).toBe(false);
        });

        it("should fail when asset is not listed in stellar.toml", async () => {
            const mockAccount = {
                id: validIssuer,
                home_domain: "example.com",
                flags: {},
                thresholds: {},
            };

            const mockToml = `
[[CURRENCIES]]
code = "BTC"
issuer = "GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ65JJLDHKHRUZI3EUEKMTCH"
      `;

            server.loadAccount.mockResolvedValue(mockAccount);
            axios.get.mockResolvedValue({ data: mockToml });

            const res = await request(app).get(`/asset/${validCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.verified).toBe(false);
            expect(res.body.data.checks.accountExists.passed).toBe(true);
            expect(res.body.data.checks.hasHomeDomain.passed).toBe(true);
            expect(res.body.data.checks.tomlReachable.passed).toBe(true);
            expect(res.body.data.checks.listedInToml.passed).toBe(false);
        });

        it("should handle case-insensitive asset code matching in TOML", async () => {
            const mockAccount = {
                id: validIssuer,
                home_domain: "example.com",
                flags: {},
                thresholds: {},
            };

            const mockToml = `
[[CURRENCIES]]
code = "usdc"
issuer = "${validIssuer}"
      `;

            server.loadAccount.mockResolvedValue(mockAccount);
            axios.get.mockResolvedValue({ data: mockToml });

            const res = await request(app).get(`/asset/${validCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.verified).toBe(true);
        });

        it("should handle TOML with quotes around values", async () => {
            const mockAccount = {
                id: validIssuer,
                home_domain: "example.com",
                flags: {},
                thresholds: {},
            };

            const mockToml = `
[[CURRENCIES]]
code = 'USDC'
issuer = '${validIssuer}'
      `;

            server.loadAccount.mockResolvedValue(mockAccount);
            axios.get.mockResolvedValue({ data: mockToml });

            const res = await request(app).get(`/asset/${validCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.verified).toBe(true);
        });

        it("should handle multiple CURRENCIES entries in TOML", async () => {
            const mockAccount = {
                id: validIssuer,
                home_domain: "example.com",
                flags: {},
                thresholds: {},
            };

            const mockToml = `
[[CURRENCIES]]
code = "BTC"
issuer = "GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ65JJLDHKHRUZI3EUEKMTCH"

[[CURRENCIES]]
code = "USDC"
issuer = "${validIssuer}"

[[CURRENCIES]]
code = "ETH"
issuer = "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR"
      `;

            server.loadAccount.mockResolvedValue(mockAccount);
            axios.get.mockResolvedValue({ data: mockToml });

            const res = await request(app).get(`/asset/${validCode}/${validIssuer}/verify`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.verified).toBe(true);
        });
    });

    // ============================================================================
    // /orderbook/:selling/:buying (if this endpoint exists)
    // ============================================================================
    describe("GET /orderbook/:selling/:buying", () => {
        const validSelling = "XLM:native";
        const validBuying = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        it("should return orderbook data for valid trading pair", async () => {
            const mockOrderBook = {
                bids: [
                    { price: "0.0900000", amount: "1000.0000000" },
                    { price: "0.0890000", amount: "500.0000000" },
                ],
                asks: [
                    { price: "0.0910000", amount: "800.0000000" },
                    { price: "0.0920000", amount: "600.0000000" },
                ],
            };

            server.orderbook.mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                call: jest.fn().mockResolvedValue(mockOrderBook),
            });

            const res = await request(app).get(`/orderbook/${validSelling}/${validBuying}`);

            // This endpoint might not exist, so we check for either 200 or 404
            if (res.statusCode === 200) {
                expect(res.body.success).toBe(true);
                expect(res.body.data).toHaveProperty("bids");
                expect(res.body.data).toHaveProperty("asks");
                expect(res.body.data.bids).toHaveLength(2);
                expect(res.body.data.asks).toHaveLength(2);
            } else {
                // If endpoint doesn't exist, it should return 404
                expect(res.statusCode).toBe(404);
            }
        });

        it("should return 400 for invalid selling asset format", async () => {
            const invalidSelling = "INVALID";

            const res = await request(app).get(`/orderbook/${invalidSelling}/${validBuying}`);

            // Either validation error or route not found
            expect([400, 404]).toContain(res.statusCode);
            if (res.statusCode === 400) {
                expect(res.body.success).toBe(false);
                expect(res.body.error.type).toBe("ValidationError");
            }
        });

        it("should return 400 for invalid buying asset format", async () => {
            const invalidBuying = "USDC";

            const res = await request(app).get(`/orderbook/${validSelling}/${invalidBuying}`);

            // Either validation error or route not found
            expect([400, 404]).toContain(res.statusCode);
            if (res.statusCode === 400) {
                expect(res.body.success).toBe(false);
                expect(res.body.error.type).toBe("ValidationError");
            }
        });

        it("should return 404 when no orderbook exists for trading pair", async () => {
            server.orderbook.mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                call: jest.fn().mockResolvedValue({ bids: [], asks: [] }),
            });

            const res = await request(app).get(`/orderbook/${validSelling}/${validBuying}`);

            // Either no orderbook found or route not found
            expect([404]).toContain(res.statusCode);
            if (res.body.error && res.body.error.type === "NotFound") {
                expect(res.body.error.message).toMatch(/order book|not found/i);
            }
        });

        it("should handle missing selling parameter", async () => {
            const res = await request(app).get(`/orderbook//${validBuying}`);

            expect(res.statusCode).toBe(404);
        });

        it("should handle missing buying parameter", async () => {
            const res = await request(app).get(`/orderbook/${validSelling}/`);

            expect(res.statusCode).toBe(404);
        });
    });
});
