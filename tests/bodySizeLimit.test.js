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
        expect(res.body.error).toMatchObject({
            type: "PayloadTooLargeError",
            message: expect.stringContaining("Payload too large"),
        });
    });

    it("uses MAX_BODY_SIZE env var when configured", () => {
        const originalMaxBodySize = process.env.MAX_BODY_SIZE;
        process.env.MAX_BODY_SIZE = "1kb";
        jest.resetModules();

        const { MAX_BODY_SIZE } = require("../src/middleware/bodySizeLimit");

        expect(MAX_BODY_SIZE).toBe("1kb");

        process.env.MAX_BODY_SIZE = originalMaxBodySize;
    });
});
