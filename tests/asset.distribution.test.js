const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

jest.mock("../src/config/stellar", () => {
    const originalModule = jest.requireActual("../src/config/stellar");
    return {
        ...originalModule,
        server: {
            assets: jest.fn(),
            accounts: jest.fn(),
        },
    };
});

describe("Asset Distribution API", () => {
    const ASSET_CODE = "USDC";
    const ASSET_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns distribution metrics for an asset", async () => {
        server.assets.mockReturnValue({
            forCode: jest.fn().mockReturnThis(),
            forIssuer: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({
                records: [{ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER, amount: "1000", num_accounts: 5 }]
            }),
        });

        const mockAccounts = [
            { id: "A1", balances: [{ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER, balance: "500" }] },
            { id: "A2", balances: [{ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER, balance: "300" }] },
            { id: "A3", balances: [{ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER, balance: "100" }] },
            { id: "A4", balances: [{ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER, balance: "60" }] },
            { id: "A5", balances: [{ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER, balance: "40" }] },
        ];

        server.accounts.mockReturnValue({
            forAsset: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({ records: mockAccounts }),
        });

        const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/distribution`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.totalHolders).toBe(5);
        expect(res.body.data.top10HoldersPercent).toBe(100); // All 5 holders are in top 10
        expect(res.body.data.largestHolder).toBe("A1");
        expect(res.body.data.smallestHolder).toBe("A5");
        expect(res.body.data.giniCoefficient).toBeGreaterThan(0);
    });

    it("returns 404 if asset not found", async () => {
        server.assets.mockReturnValue({
            forCode: jest.fn().mockReturnThis(),
            forIssuer: jest.fn().mockReturnThis(),
            call: jest.fn().mockResolvedValue({ records: [] }),
        });

        const res = await request(app).get(`/asset/FAKE/GA.../distribution`);
        expect(res.statusCode).toBe(404);
    });
});
