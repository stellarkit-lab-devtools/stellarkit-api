const request = require("supertest");
const app = require("../src/index");

describe("Request body size limits", () => {
    it("returns 413 Payload Too Large for oversized JSON bodies", async () => {
        const largePayload = { data: "x".repeat(11000) };

        const res = await request(app)
            .post("/health")
            .set("Content-Type", "application/json")
            .send(largePayload);

        expect(res.statusCode).toBe(413);
        expect(res.body.success).toBe(false);
        // Acceptance-criteria shape: type "PayloadTooLarge", message mentions the KB limit
        expect(res.body.error).toMatchObject({
            type: "PayloadTooLarge",
            message: expect.stringContaining("Request body exceeds the maximum allowed size"),
        });
    });

    it("uses MAX_BODY_SIZE_KB env var when configured", () => {
        const originalKb  = process.env.MAX_BODY_SIZE_KB;
        const originalLeg = process.env.MAX_BODY_SIZE;
        process.env.MAX_BODY_SIZE_KB = "5";
        delete process.env.MAX_BODY_SIZE;
        jest.resetModules();

        const { MAX_BODY_SIZE, MAX_BODY_SIZE_KB } = require("../src/middleware/bodySizeLimit");

        expect(MAX_BODY_SIZE).toBe("5kb");
        expect(MAX_BODY_SIZE_KB).toBe(5);

        // Restore
        if (originalKb  !== undefined) process.env.MAX_BODY_SIZE_KB = originalKb;
        else delete process.env.MAX_BODY_SIZE_KB;
        if (originalLeg !== undefined) process.env.MAX_BODY_SIZE = originalLeg;
        jest.resetModules();
    });

    it("falls back to MAX_BODY_SIZE legacy string when MAX_BODY_SIZE_KB is absent", () => {
        const originalKb  = process.env.MAX_BODY_SIZE_KB;
        const originalLeg = process.env.MAX_BODY_SIZE;
        delete process.env.MAX_BODY_SIZE_KB;
        process.env.MAX_BODY_SIZE = "1kb";
        jest.resetModules();

        const { MAX_BODY_SIZE } = require("../src/middleware/bodySizeLimit");

        expect(MAX_BODY_SIZE).toBe("1kb");

        // Restore
        if (originalKb  !== undefined) process.env.MAX_BODY_SIZE_KB = originalKb;
        if (originalLeg !== undefined) process.env.MAX_BODY_SIZE = originalLeg;
        else delete process.env.MAX_BODY_SIZE;
        jest.resetModules();
    });
});
