const { validateCollection, validateEnvironment } = require("../../scripts/validate-collections");

describe("Collection Validator", () => {
  describe("validateCollection", () => {
    it("should accept a valid collection", () => {
      const validCollection = {
        info: { name: "Test" },
        item: [
          {
            name: "Request 1",
            request: {
              method: "GET",
              url: { raw: "{{baseUrl}}/test" },
              header: [],
            },
          },
          {
            name: "Request 2",
            request: {
              method: "GET",
              url: "{{baseUrl}}/test2",
              header: [],
            },
          },
        ],
      };

      expect(() => validateCollection(validCollection)).not.toThrow();
    });

    it("should reject collection with requests not using {{baseUrl}}", () => {
      const invalidCollection = {
        info: { name: "Test" },
        item: [
          {
            name: "Bad Request",
            request: {
              method: "GET",
              url: { raw: "http://localhost:3000/test" },
              header: [],
            },
          },
        ],
      };

      expect(() => validateCollection(invalidCollection)).toThrow(/do not use \{\{baseUrl\}\}/);
    });

    it("should reject collection with duplicate request names", () => {
      const invalidCollection = {
        info: { name: "Test" },
        item: [
          {
            name: "Duplicate",
            request: {
              method: "GET",
              url: "{{baseUrl}}/test1",
              header: [],
            },
          },
          {
            name: "Duplicate",
            request: {
              method: "GET",
              url: "{{baseUrl}}/test2",
              header: [],
            },
          },
        ],
      };

      expect(() => validateCollection(invalidCollection)).toThrow(/Duplicate request names/);
    });

    it("should detect literal API keys in headers", () => {
      const invalidCollection = {
        info: { name: "Test" },
        item: [
          {
            name: "Request with API Key",
            request: {
              method: "GET",
              url: "{{baseUrl}}/test",
              header: [
                {
                  key: "X-API-Key",
                  value: "abcdef1234567890abcdef1234567890abcdef",
                },
              ],
            },
          },
        ],
      };

      expect(() => validateCollection(invalidCollection)).toThrow(/literal API keys/);
    });

    it("should allow API key variables", () => {
      const validCollection = {
        info: { name: "Test" },
        item: [
          {
            name: "Request with Variable",
            request: {
              method: "GET",
              url: "{{baseUrl}}/test",
              header: [
                {
                  key: "X-API-Key",
                  value: "{{apiKey}}",
                },
              ],
            },
          },
        ],
      };

      expect(() => validateCollection(validCollection)).not.toThrow();
    });

    it("should handle nested items", () => {
      const nestedCollection = {
        info: { name: "Test" },
        item: [
          {
            name: "Folder",
            item: [
              {
                name: "Nested Request",
                request: {
                  method: "GET",
                  url: "{{baseUrl}}/nested",
                  header: [],
                },
              },
            ],
          },
        ],
      };

      expect(() => validateCollection(nestedCollection)).not.toThrow();
    });
  });

  describe("validateEnvironment", () => {
    it("should accept a valid environment", () => {
      const validEnv = {
        name: "Test Env",
        values: [
          { key: "baseUrl", value: "http://localhost:3000" },
          { key: "account", value: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7" },
          { key: "assetCode", value: "USDC" },
          { key: "assetIssuer", value: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
        ],
      };

      expect(() => validateEnvironment(validEnv, "Test")).not.toThrow();
    });

    it("should reject environment missing required variables", () => {
      const invalidEnv = {
        name: "Test Env",
        values: [
          { key: "baseUrl", value: "http://localhost:3000" },
        ],
      };

      expect(() => validateEnvironment(invalidEnv, "Test")).toThrow(/Missing required variables/);
    });

    it("should reject environment with empty baseUrl", () => {
      const invalidEnv = {
        name: "Test Env",
        values: [
          { key: "baseUrl", value: "" },
          { key: "account", value: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7" },
          { key: "assetCode", value: "USDC" },
          { key: "assetIssuer", value: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
        ],
      };

      expect(() => validateEnvironment(invalidEnv, "Test")).toThrow(/baseUrl variable has no value/);
    });

    it("should reject environment without values array", () => {
      const invalidEnv = {
        name: "Test Env",
      };

      expect(() => validateEnvironment(invalidEnv, "Test")).toThrow(/Missing or invalid 'values' array/);
    });
  });
});
