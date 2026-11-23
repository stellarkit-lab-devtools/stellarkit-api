const express = require("express");
const request = require("supertest");
jest.mock("../src/config/stellar", () => ({ server: { offers: jest.fn(), trades: jest.fn() } }));
const { server } = require("../src/config/stellar");
const app = express();
app.use("/dex", require("../src/routes/dex"));
app.use(require("../src/middleware/errorHandler"));

describe("GET /dex/offers/:offerId", () => {
  const id = "9007199254740993";
  const offer = { seller: "seller", selling: { asset_type: "native" }, buying: { asset_type: "credit_alphanum4", asset_code: "USD", asset_issuer: "issuer" }, amount: "10", price_r: { n: 2, d: 1 }, last_modified_ledger: 42 };
  const trade = { id: "trade", base_offer_id: id, base_account: "seller", counter_account: "buyer", base_asset_type: "native", counter_asset_type: "credit_alphanum4", counter_asset_code: "USD", counter_asset_issuer: "issuer", base_amount: "2", counter_amount: "4", price: { n: 2, d: 1 }, ledger_close_time: "2026-11-22T00:00:00Z" };
  let offerCall, tradeCall, trades;
  beforeEach(() => {
    jest.clearAllMocks();
    offerCall = jest.fn().mockResolvedValue(offer);
    tradeCall = jest.fn().mockResolvedValue({ records: [trade] });
    server.offers.mockReturnValue({ offer: jest.fn().mockReturnValue({ call: offerCall }) });
    trades = { forOffer: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), call: tradeCall };
    server.trades.mockReturnValue(trades);
  });
  it("returns open offer detail with exact large ID and fills", async () => {
    const res = await request(app).get(`/dex/offers/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ offerId: id, status: "open", amount: "10.0000000", price: "2.0000000", totalFilledAmount: "2.0000000", fills: [{ tradeId: "trade", amount: "2.0000000", price: "2.0000000", counterAccount: "buyer" }] });
    expect(server.offers().offer).toHaveBeenCalledWith(id);
    expect(trades.forOffer).toHaveBeenCalledWith(id);
    expect(trades.limit).toHaveBeenCalledWith(20);
  });
  it("recovers a closed offer from fills", async () => {
    offerCall.mockRejectedValue({ response: { status: 404 } });
    const res = await request(app).get(`/dex/offers/${id}?fillLimit=100`);
    expect(res.body.data).toMatchObject({ status: "closed", seller: "seller", amount: null, selling: { code: "XLM" } });
    expect(trades.limit).toHaveBeenCalledWith(100);
  });
  it("returns OfferNotFound when neither offer nor fills exist", async () => {
    offerCall.mockRejectedValue({ response: { status: 404 } });
    tradeCall.mockResolvedValue({ records: [] });
    const res = await request(app).get("/dex/offers/123");
    expect(res.status).toBe(404);
    expect(res.body.error.type).toBe("OfferNotFound");
  });
  it.each(["0", "-1", "1.2", "1e3", "9223372036854775808"])("rejects invalid ID %s", async (value) => {
    expect((await request(app).get(`/dex/offers/${value}`)).status).toBe(400);
    expect(server.offers).not.toHaveBeenCalled();
  });
  it("orients counter-side fills to the offer's selling asset", async () => {
    tradeCall.mockResolvedValue({ records: [{ ...trade, base_offer_id: "1", counter_offer_id: id }] });
    const res = await request(app).get(`/dex/offers/${id}`);
    expect(res.body.data.fills[0]).toMatchObject({ amount: "4.0000000", price: "0.5000000", counterAccount: "seller" });
  });
  it.each(["0", "101", "abc", "1.5"])("rejects invalid fillLimit %s", async (limit) => {
    expect((await request(app).get(`/dex/offers/${id}?fillLimit=${limit}`)).status).toBe(400);
  });
});
