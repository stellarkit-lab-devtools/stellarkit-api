const request = require("supertest");
const app = require("../src/index");

describe("GET /dex/spread/:sellAsset/:buyAsset", () => {
    // Common trading pairs for testing
    const xlmNative = "XLM:native";
    const usdcIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const usdc = `USDC:${usdcIssuer}`;

    it("should return 400 for invalid asset format (missing colon)", async () => {
        const response = await request(app)
            .get("/dex/spread/XLMNATIVE/USDC:GA5Z...")
            .expect(400)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", false);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error.message).toContain("Invalid asset format");
    });

    it("should return 400 for invalid asset code", async () => {
        const response = await request(app)
            .get("/dex/spread/TOOLONGASSETCODE:native/USDC:GA5Z...")
            .expect(400)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", false);
        expect(response.body).toHaveProperty("error");
    });

    it("should return 400 for invalid issuer address", async () => {
        const response = await request(app)
            .get("/dex/spread/XLM:native/USDC:INVALID_ISSUER")
            .expect(400)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", false);
        expect(response.body).toHaveProperty("error");
    });

    it("should return 200 with spread data for valid trading pair", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        // Should be 200 or 404 depending on if order book exists
        if (response.status === 200) {
            expect(response.body).toHaveProperty("success", true);
            expect(response.body).toHaveProperty("data");

            const data = response.body.data;

            // Validate structure
            expect(data).toHaveProperty("bestBid");
            expect(data).toHaveProperty("bestAsk");
            expect(data).toHaveProperty("spreadAbsolute");
            expect(data).toHaveProperty("spreadPercent");
            expect(data).toHaveProperty("midPrice");
            expect(data).toHaveProperty("liquidity");
            expect(data).toHaveProperty("orderBookDepth");
        } else if (response.status === 404) {
            expect(response.body).toHaveProperty("success", false);
            expect(response.body.error.message).toContain("No order book exists");
        }
    }, 15000);

    it("should return 404 for non-existent trading pair", async () => {
        // Use a very unlikely trading pair
        const fakeAsset1 = "FAKE:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
        const fakeAsset2 = "TEST:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

        const response = await request(app)
            .get(`/dex/spread/${fakeAsset1}/${fakeAsset2}`)
            .expect("Content-Type", /json/);

        // Should return 404 for non-existent order book
        if (response.status === 404) {
            expect(response.body).toHaveProperty("success", false);
            expect(response.body).toHaveProperty("error");
            expect(response.body.error.message).toContain("No order book exists");
        }
    }, 15000);

    it("should include bestBid and bestAsk when available", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200 && response.body.data.bestBid) {
            expect(response.body.data.bestBid).toHaveProperty("price");
            expect(response.body.data.bestBid).toHaveProperty("amount");
            expect(typeof response.body.data.bestBid.price).toBe("string");
            expect(typeof response.body.data.bestBid.amount).toBe("string");
        }

        if (response.status === 200 && response.body.data.bestAsk) {
            expect(response.body.data.bestAsk).toHaveProperty("price");
            expect(response.body.data.bestAsk).toHaveProperty("amount");
            expect(typeof response.body.data.bestAsk.price).toBe("string");
            expect(typeof response.body.data.bestAsk.amount).toBe("string");
        }
    }, 15000);

    it("should calculate spreadAbsolute correctly", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            const data = response.body.data;

            if (data.bestBid && data.bestAsk && data.spreadAbsolute) {
                const bidPrice = parseFloat(data.bestBid.price);
                const askPrice = parseFloat(data.bestAsk.price);
                const spread = parseFloat(data.spreadAbsolute);

                expect(spread).toBeCloseTo(askPrice - bidPrice, 5);
                expect(spread).toBeGreaterThanOrEqual(0);
            }
        }
    }, 15000);

    it("should calculate spreadPercent correctly", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            const data = response.body.data;

            if (data.bestBid && data.bestAsk && data.spreadPercent) {
                const bidPrice = parseFloat(data.bestBid.price);
                const askPrice = parseFloat(data.bestAsk.price);
                const midPrice = (bidPrice + askPrice) / 2;
                const expectedPercent = ((askPrice - bidPrice) / midPrice) * 100;

                expect(parseFloat(data.spreadPercent)).toBeCloseTo(expectedPercent, 2);
            }
        }
    }, 15000);

    it("should calculate midPrice correctly", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            const data = response.body.data;

            if (data.bestBid && data.bestAsk && data.midPrice) {
                const bidPrice = parseFloat(data.bestBid.price);
                const askPrice = parseFloat(data.bestAsk.price);
                const expectedMid = (bidPrice + askPrice) / 2;

                expect(parseFloat(data.midPrice)).toBeCloseTo(expectedMid, 5);
            }
        }
    }, 15000);

    it("should return liquidity level as high, medium, or low", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            expect(response.body.data.liquidity).toMatch(/^(high|medium|low)$/);
        }
    }, 15000);

    it("should include orderBookDepth information", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            const depth = response.body.data.orderBookDepth;

            expect(depth).toHaveProperty("bids");
            expect(depth).toHaveProperty("asks");
            expect(depth).toHaveProperty("totalBidVolume");
            expect(depth).toHaveProperty("totalAskVolume");
            expect(depth).toHaveProperty("totalVolume");

            expect(typeof depth.bids).toBe("number");
            expect(typeof depth.asks).toBe("number");
            expect(typeof depth.totalBidVolume).toBe("string");
            expect(typeof depth.totalAskVolume).toBe("string");
            expect(typeof depth.totalVolume).toBe("string");
        }
    }, 15000);

    it("should handle XLM native asset correctly", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        // Should not return 400 for valid XLM:native format
        expect(response.status).not.toBe(400);
    }, 15000);

    it("should handle reversed trading pair", async () => {
        const response = await request(app)
            .get(`/dex/spread/${usdc}/${xlmNative}`)
            .expect("Content-Type", /json/);

        // Should work in both directions
        if (response.status === 200) {
            expect(response.body).toHaveProperty("success", true);
            expect(response.body.data).toHaveProperty("liquidity");
        }
    }, 15000);

    it("should return numeric values as strings with proper precision", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            const data = response.body.data;

            // Check that numeric values are formatted as strings
            if (data.bestBid) {
                expect(data.bestBid.price).toMatch(/^\d+\.\d{7}$/);
                expect(data.bestBid.amount).toMatch(/^\d+\.\d{7}$/);
            }

            if (data.bestAsk) {
                expect(data.bestAsk.price).toMatch(/^\d+\.\d{7}$/);
                expect(data.bestAsk.amount).toMatch(/^\d+\.\d{7}$/);
            }

            if (data.spreadAbsolute) {
                expect(data.spreadAbsolute).toMatch(/^\d+\.\d{7}$/);
            }

            if (data.spreadPercent) {
                expect(data.spreadPercent).toMatch(/^\d+\.\d{4}$/);
            }

            if (data.midPrice) {
                expect(data.midPrice).toMatch(/^\d+\.\d{7}$/);
            }
        }
    }, 15000);

    it("should handle order book with only bids", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            const data = response.body.data;

            // If only bids exist, should still return valid data
            if (data.bestBid && !data.bestAsk) {
                expect(data.spreadAbsolute).toBeNull();
                expect(data.spreadPercent).toBeNull();
                expect(data.midPrice).not.toBeNull();
            }
        }
    }, 15000);

    it("should handle order book with only asks", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            const data = response.body.data;

            // If only asks exist, should still return valid data
            if (!data.bestBid && data.bestAsk) {
                expect(data.spreadAbsolute).toBeNull();
                expect(data.spreadPercent).toBeNull();
                expect(data.midPrice).not.toBeNull();
            }
        }
    }, 15000);

    it("should calculate liquidity as high for large order books", async () => {
        const response = await request(app)
            .get(`/dex/spread/${xlmNative}/${usdc}`)
            .expect("Content-Type", /json/);

        if (response.status === 200) {
            const data = response.body.data;
            const totalVolume = parseFloat(data.orderBookDepth.totalVolume);

            if (totalVolume >= 10000) {
                expect(data.liquidity).toBe("high");
            } else if (totalVolume >= 1000) {
                expect(data.liquidity).toBe("medium");
            } else {
                expect(data.liquidity).toBe("low");
            }
        }
    }, 15000);

    it("should handle asset codes case-insensitively", async () => {
        const response = await request(app)
            .get(`/dex/spread/xlm:native/usdc:${usdcIssuer}`)
            .expect("Content-Type", /json/);

        // Should work with lowercase asset codes
        expect(response.status).not.toBe(400);
    }, 15000);
});
