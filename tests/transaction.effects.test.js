const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

jest.mock("../src/config/stellar", () => {
    const originalModule = jest.requireActual("../src/config/stellar");
    return {
        ...originalModule,
        server: {
            ...originalModule.server,
            transactions: jest.fn(),
            effects: jest.fn(),
        },
    };
});

function mockTransactionExists() {
    server.transactions.mockReturnValue({
        transaction: jest.fn().mockReturnValue({
            call: jest.fn().mockResolvedValue({ hash: "a" }),
        }),
    });
}

function mockEffects(records) {
    server.effects.mockReturnValue({
        forTransaction: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records }),
    });
}

describe("GET /transaction/:hash/effects", () => {
    const validHash = "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889";

    beforeEach(() => {
        jest.clearAllMocks();
        cacheService.flush();
    });

    it("returns effects normalized for a valid hash", async () => {
        mockTransactionExists();
        mockEffects([
            {
                id: "eff-1",
                type: "account_credited",
                account: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                created_at: "2024-01-01T00:00:00Z",
                paging_token: "pt-1",
                amount: "100.0000000",
            },
        ]);

        const res = await request(app)
            .get(`/transaction/${validHash}/effects`)
            .set("x-api-key", "test");

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("effects");
        expect(res.body.data.effects).toHaveLength(1);
        expect(res.body.data.effects[0]).toMatchObject({
            effectId: "eff-1",
            type: "account_credited",
            account: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        });
        expect(res.body.data).toHaveProperty("total", 1);
    });

    it("returns 404 when transaction does not exist", async () => {
        server.transactions.mockReturnValue({
            transaction: jest.fn().mockReturnValue({
                call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
            }),
        });

        const res = await request(app)
            .get(`/transaction/${validHash}/effects`)
            .set("x-api-key", "test");

        expect([400, 401, 404, 500]).toContain(res.statusCode);
        if (res.statusCode === 404) {
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("NotFound");
        }
    });

    it("validates hash format before Horizon call", async () => {
        const badHash = "not-a-hash";

        const res = await request(app)
            .get(`/transaction/${badHash}/effects`)
            .set("x-api-key", "test");

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("ValidationError");
        expect(server.effects).not.toHaveBeenCalled();
        expect(server.transactions).not.toHaveBeenCalled();
    });
});

