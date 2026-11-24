const { isMainnet, buildPlan } = require("../scripts/seed-testnet");

describe("seed-testnet pure helpers", () => {
  describe("isMainnet", () => {
    const original = process.env.STELLAR_NETWORK;

    afterEach(() => {
      if (original === undefined) {
        delete process.env.STELLAR_NETWORK;
      } else {
        process.env.STELLAR_NETWORK = original;
      }
    });

    it("returns true when STELLAR_NETWORK=mainnet", () => {
      process.env.STELLAR_NETWORK = "mainnet";
      expect(isMainnet()).toBe(true);
    });

    it("returns true when STELLAR_NETWORK=MAINNET (case-insensitive)", () => {
      process.env.STELLAR_NETWORK = "MAINNET";
      expect(isMainnet()).toBe(true);
    });

    it("returns false when STELLAR_NETWORK=testnet", () => {
      process.env.STELLAR_NETWORK = "testnet";
      expect(isMainnet()).toBe(false);
    });

    it("returns false when STELLAR_NETWORK is unset", () => {
      delete process.env.STELLAR_NETWORK;
      expect(isMainnet()).toBe(false);
    });
  });

  describe("buildPlan", () => {
    const keys = {
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      holderA: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      holderB: "GBBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5",
      multisig: "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5",
    };

    it("includes all four accounts in the plan", () => {
      const plan = buildPlan(keys);
      expect(plan.accounts).toHaveLength(4);
      expect(plan.accounts).toContain(keys.issuer);
      expect(plan.accounts).toContain(keys.holderA);
      expect(plan.accounts).toContain(keys.holderB);
      expect(plan.accounts).toContain(keys.multisig);
    });

    it("sets assetCode to DEMO", () => {
      const plan = buildPlan(keys);
      expect(plan.assetCode).toBe("DEMO");
    });

    it("sets assetIssuer to the issuer key", () => {
      const plan = buildPlan(keys);
      expect(plan.assetIssuer).toBe(keys.issuer);
    });
  });
});
