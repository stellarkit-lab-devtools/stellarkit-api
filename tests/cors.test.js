const request = require("supertest");

describe("CORS Origin Whitelist", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    describe("When ALLOWED_ORIGINS is not set", () => {
        beforeEach(() => {
            delete process.env.ALLOWED_ORIGINS;
        });

        it("should allow request from any origin and return default CORS headers", async () => {
            const app = require("../src/index");
            const res = await request(app)
                .get("/health")
                .set("Origin", "https://any-origin.com");

            expect(res.headers["access-control-allow-origin"]).toBe("*");
        });
    });

    describe("When ALLOWED_ORIGINS is set", () => {
        beforeEach(() => {
            process.env.ALLOWED_ORIGINS = "https://example.com, https://api.example.com";
        });

        it("should allow whitelisted origin and return corresponding CORS header", async () => {
            const app = require("../src/index");
            const res = await request(app)
                .get("/health")
                .set("Origin", "https://example.com");

            expect(res.headers["access-control-allow-origin"]).toBe("https://example.com");
            expect(res.statusCode).not.toBe(403);
        });

        it("should return 403 Forbidden for non-whitelisted origin", async () => {
            const app = require("../src/index");
            const res = await request(app)
                .get("/health")
                .set("Origin", "https://malicious.com");

            expect(res.statusCode).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("Forbidden");
        });

        it("should allow requests with no Origin header (standard non-CORS requests)", async () => {
            const app = require("../src/index");
            const res = await request(app).get("/health");

            expect(res.statusCode).toBe(200);
            expect(res.headers["access-control-allow-origin"]).toBeUndefined();
        });
    });
});
