const request = require("supertest");

jest.mock("../src/config/stellar", () => {
    const originalModule = jest.requireActual("../src/config/stellar");
    return {
        ...originalModule,
        server: {
            ledgers: jest.fn(),
            feeStats: jest.fn(),
        },
    };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cache = require("../src/services/cache");

describe("Fee Surge Status API", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear the actual route cache
        cache.flush();
    });

    it("returns isSurging: false when average capacity usage is low", async () => {
        // Mock 10 ledgers with low transaction counts
        server.ledgers.mockReturnValue({
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: Array.from({ length: 10 }, (_, i) => ({
                    sequence: 100 - i,
                    successful_transaction_count: 50 + i * 5, // 50-95 txs, avg ~72.5 / 1000 = 0.0725
                    operation_count: 150,
                })),
            }),
        });

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "100",
            ledger_capacity_usage: "0.0725",
            fee_charged: {
                min: "100",
                p10: "100",
                p50: "100",
                p95: "100",
                p99: "100",
                max: "100",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isSurging).toBe(false);
        expect(res.body.data.avgCapacityUsage).toBeLessThan(0.5);
        expect(res.body.data.surgeThreshold).toBe(0.5);
        expect(res.body.data.recommendation).toContain("economy");
    });

    it("returns isSurging: true when average capacity usage exceeds 0.5", async () => {
        // Mock 10 ledgers with high transaction counts (average > 0.5)
        const ledgersMock = {
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: [
                    { sequence: 110, successful_transaction_count: 800, operation_count: 2000 },
                    { sequence: 109, successful_transaction_count: 750, operation_count: 2000 },
                    { sequence: 108, successful_transaction_count: 700, operation_count: 2000 },
                    { sequence: 107, successful_transaction_count: 750, operation_count: 2000 },
                    { sequence: 106, successful_transaction_count: 800, operation_count: 2000 },
                    { sequence: 105, successful_transaction_count: 600, operation_count: 2000 },
                    { sequence: 104, successful_transaction_count: 700, operation_count: 2000 },
                    { sequence: 103, successful_transaction_count: 650, operation_count: 2000 },
                    { sequence: 102, successful_transaction_count: 750, operation_count: 2000 },
                    { sequence: 101, successful_transaction_count: 700, operation_count: 2000 },
                ],
            }),
        };
        server.ledgers.mockReturnValue(ledgersMock);

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "200",
            ledger_capacity_usage: "0.71",
            fee_charged: {
                min: "100",
                p10: "150",
                p50: "200",
                p95: "400",
                p99: "500",
                max: "600",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.data.isSurging).toBe(true);
        expect(res.body.data.avgCapacityUsage).toBeGreaterThan(0.5);
        expect(res.body.data.suggestedFee).toBe(400); // p95 fee
        expect(res.body.data.recommendation).toContain("priority");
    });

    it("returns isSurging: false with moderate congestion recommendation", async () => {
        // Mock 10 ledgers with moderate transaction counts
        const ledgersMock = {
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: [
                    { sequence: 110, successful_transaction_count: 350, operation_count: 1000 },
                    { sequence: 109, successful_transaction_count: 340, operation_count: 1000 },
                    { sequence: 108, successful_transaction_count: 360, operation_count: 1000 },
                    { sequence: 107, successful_transaction_count: 330, operation_count: 1000 },
                    { sequence: 106, successful_transaction_count: 350, operation_count: 1000 },
                    { sequence: 105, successful_transaction_count: 340, operation_count: 1000 },
                    { sequence: 104, successful_transaction_count: 360, operation_count: 1000 },
                    { sequence: 103, successful_transaction_count: 350, operation_count: 1000 },
                    { sequence: 102, successful_transaction_count: 340, operation_count: 1000 },
                    { sequence: 101, successful_transaction_count: 350, operation_count: 1000 },
                ],
            }),
        };
        server.ledgers.mockReturnValue(ledgersMock);

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "150",
            ledger_capacity_usage: "0.345",
            fee_charged: {
                min: "100",
                p10: "120",
                p50: "200",
                p95: "300",
                p99: "400",
                max: "500",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.data.isSurging).toBe(false);
        expect(res.body.data.avgCapacityUsage).toBeGreaterThan(0.25);
        expect(res.body.data.avgCapacityUsage).toBeLessThan(0.5);
        expect(res.body.data.suggestedFee).toBe(200); // p50 fee
        expect(res.body.data.recommendation).toContain("moderate");
    });

    it("includes correct response structure", async () => {
        server.ledgers.mockReturnValue({
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: Array.from({ length: 10 }, (_, i) => ({
                    sequence: 100 - i,
                    successful_transaction_count: 100 + i * 5,
                    operation_count: 300,
                })),
            }),
        });

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "100",
            ledger_capacity_usage: "0.125",
            fee_charged: {
                min: "100",
                p10: "100",
                p50: "150",
                p95: "200",
                p99: "250",
                max: "300",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toHaveProperty("isSurging");
        expect(res.body.data).toHaveProperty("avgCapacityUsage");
        expect(res.body.data).toHaveProperty("surgeThreshold", 0.5);
        expect(res.body.data).toHaveProperty("ledgersAnalyzed", 10);
        expect(res.body.data).toHaveProperty("capacityUsageDetails");
        expect(res.body.data).toHaveProperty("suggestedFee");
        expect(res.body.data).toHaveProperty("suggestedFeeInXLM");
        expect(res.body.data).toHaveProperty("recommendation");
        expect(res.body.data).toHaveProperty("currentNetworkStats");
    });

    it("includes capacity usage details for each analyzed ledger", async () => {
        const ledgersMock = {
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: [
                    { sequence: 110, successful_transaction_count: 100, operation_count: 300 },
                    { sequence: 109, successful_transaction_count: 200, operation_count: 300 },
                    { sequence: 108, successful_transaction_count: 300, operation_count: 300 },
                    { sequence: 107, successful_transaction_count: 400, operation_count: 300 },
                    { sequence: 106, successful_transaction_count: 500, operation_count: 300 },
                    { sequence: 105, successful_transaction_count: 600, operation_count: 300 },
                    { sequence: 104, successful_transaction_count: 700, operation_count: 300 },
                    { sequence: 103, successful_transaction_count: 800, operation_count: 300 },
                    { sequence: 102, successful_transaction_count: 900, operation_count: 300 },
                    { sequence: 101, successful_transaction_count: 1000, operation_count: 300 },
                ],
            }),
        };
        server.ledgers.mockReturnValue(ledgersMock);

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "100",
            ledger_capacity_usage: "0.55",
            fee_charged: {
                min: "100",
                p10: "100",
                p50: "200",
                p95: "400",
                p99: "500",
                max: "600",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.data.capacityUsageDetails).toHaveLength(10);
        expect(res.body.data.capacityUsageDetails[0]).toBe(0.1); // 100/1000
        expect(res.body.data.capacityUsageDetails[9]).toBe(1.0); // 1000/1000 capped at 1.0
    });

    it("returns correct fee suggestions based on congestion level", async () => {
        const ledgersMock = {
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: Array.from({ length: 10 }, () => ({
                    sequence: 100,
                    successful_transaction_count: 750,
                    operation_count: 2250,
                })),
            }),
        };
        server.ledgers.mockReturnValue(ledgersMock);

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "300",
            ledger_capacity_usage: "0.75",
            fee_charged: {
                min: "100",
                p10: "150",
                p50: "250",
                p95: "500",
                p99: "700",
                max: "1000",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.data.suggestedFee).toBe(500);
        expect(res.body.data.suggestedFeeInXLM).toBe("0.0000500");
    });

    it("converts suggested fee to XLM correctly", async () => {
        server.ledgers.mockReturnValue({
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: Array.from({ length: 10 }, () => ({
                    sequence: 100,
                    successful_transaction_count: 50,
                    operation_count: 150,
                })),
            }),
        });

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "100",
            ledger_capacity_usage: "0.05",
            fee_charged: {
                min: "100",
                p10: "100",
                p50: "100",
                p95: "100",
                p99: "100",
                max: "100",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.data.suggestedFee).toBe(100);
        expect(res.body.data.suggestedFeeInXLM).toBe("0.0000100");
    });

    it("handles fresh parameter to bypass cache", async () => {
        const ledgersMock = {
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: Array.from({ length: 10 }, () => ({
                    sequence: 100,
                    successful_transaction_count: 100,
                    operation_count: 300,
                })),
            }),
        };

        server.ledgers.mockReturnValue(ledgersMock);
        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "100",
            ledger_capacity_usage: "0.1",
            fee_charged: {
                min: "100",
                p10: "100",
                p50: "100",
                p95: "100",
                p99: "100",
                max: "100",
            },
        });

        // First request (cache miss)
        const res1 = await request(app).get("/fee-estimate/surge-status");
        expect(res1.get("X-Cache")).toBe("MISS");

        // Second request without fresh (cache hit)
        const res2 = await request(app).get("/fee-estimate/surge-status");
        expect(res2.get("X-Cache")).toBe("HIT");

        // Third request with fresh=true (cache bypass)
        const res3 = await request(app).get("/fee-estimate/surge-status?fresh=true");
        expect(res3.get("X-Cache")).toBe("MISS");
    });

    it("includes current network stats in response", async () => {
        const ledgersMock = {
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: Array.from({ length: 10 }, () => ({
                    sequence: 100,
                    successful_transaction_count: 200,
                    operation_count: 600,
                })),
            }),
        };
        server.ledgers.mockReturnValue(ledgersMock);

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "250",
            ledger_capacity_usage: "0.2",
            fee_charged: {
                min: "100",
                p10: "150",
                p50: "250",
                p95: "400",
                p99: "500",
                max: "600",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.data.currentNetworkStats).toEqual({
            lastLedgerBaseFee: "250",
            ledgerCapacityUsage: "0.2",
            minFee: "100",
            p50Fee: "250",
            p95Fee: "400",
        });
    });

    it("returns 503 when ledger data is unavailable", async () => {
        const ledgersMock = {
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: [],
            }),
        };
        server.ledgers.mockReturnValue(ledgersMock);

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(503);
        expect(res.body.success).toBe(false);
    });

    it("includes exactly 10 ledgers in analysis", async () => {
        const ledgersMock = {
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: Array.from({ length: 10 }, (_, i) => ({
                    sequence: 1000 - i,
                    successful_transaction_count: 100,
                    operation_count: 300,
                })),
            }),
        };
        server.ledgers.mockReturnValue(ledgersMock);

        server.feeStats.mockResolvedValue({
            last_ledger_base_fee: "100",
            ledger_capacity_usage: "0.1",
            fee_charged: {
                min: "100",
                p10: "100",
                p50: "100",
                p95: "100",
                p99: "100",
                max: "100",
            },
        });

        const res = await request(app).get("/fee-estimate/surge-status");

        expect(res.statusCode).toBe(200);
        expect(res.body.data.ledgersAnalyzed).toBe(10);
    });
});
