const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const axios = require("axios");
const cacheService = require("../src/services/cache");

describe("GET /asset/:code/:issuer/toml", () => {
  const ASSET_CODE = "USDC";
  const ASSET_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  afterEach(() => {
    jest.restoreAllMocks();
    cacheService.flush();
  });

  it("returns the normalised toml when the fetch succeeds", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      home_domain: "example.com",
    });

    const sampleToml = `
VERSION="1.0.0"

[[CURRENCIES]]
code="USDC"
issuer="${ASSET_ISSUER}"
name="Test USD Coin"
`;
    jest.spyOn(axios, "get").mockResolvedValue({ data: sampleToml });

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/toml`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.currencies[0].asset.code).toBe("USDC");
  });

  it("returns TomlFetchFailed when the issuer's home domain is unreachable (network error)", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      home_domain: "unreachable.example.com",
    });

    jest.spyOn(axios, "get").mockRejectedValue({
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED",
    });

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/toml`
    );

    expect(res.statusCode).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual({
      type: "TomlFetchFailed",
      message: `Could not fetch stellar.toml for issuer '${ASSET_ISSUER}'.`,
      suggestion:
        "Verify the issuer has a valid stellar.toml at their home domain. See https://developers.stellar.org/docs/issuing-assets/publishing-asset-info for requirements.",
    });
  });

  it("returns TomlFetchFailed when stellar.toml is missing (404)", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      home_domain: "no-toml.example.com",
    });

    jest.spyOn(axios, "get").mockRejectedValue({
      response: { status: 404 },
      message: "Request failed with status code 404",
    });

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/toml`
    );

    expect(res.statusCode).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("TomlFetchFailed");
    expect(res.body.error.message).toBe(
      `Could not fetch stellar.toml for issuer '${ASSET_ISSUER}'.`
    );
  });

  it("returns TomlFetchFailed when the issuer has no home_domain set", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      home_domain: undefined,
    });

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/toml`
    );

    expect(res.statusCode).toBe(502);
    expect(res.body.error.type).toBe("TomlFetchFailed");
  });

  it("returns AccountNotFound when the issuer account does not exist", async () => {
    jest.spyOn(server, "loadAccount").mockRejectedValue({
      response: { status: 404 },
    });

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/toml`
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns 400 for an invalid asset/issuer pair", async () => {
    const res = await request(app).get(`/asset/USDC/not-a-valid-issuer/toml`);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("InvalidAsset");
  });
});
