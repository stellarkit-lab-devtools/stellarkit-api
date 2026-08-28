const { fetchContractDeployment } = require("../src/utils/contractDeployment");

describe("fetchContractDeployment", () => {
  const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns deployment metadata from the earliest create-contract operation", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: {
            records: [
              {
                type: "invoke_host_function",
                function: "HostFunctionTypeHostFunctionTypeCreateContract",
                source_account: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
                created_at: "2024-06-01T12:00:00Z",
                transaction_hash: "abc123",
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ledger: 689, created_at: "2024-06-01T12:00:00Z" }),
      });

    const result = await fetchContractDeployment(contractId);

    expect(result).toEqual({
      deployer: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      deployedAt: "2024-06-01T12:00:00.000Z",
      deployedLedger: 689,
    });
  });

  it("returns null metadata when no operations are found", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ _embedded: { records: [] } }),
    });

    const result = await fetchContractDeployment(contractId);

    expect(result).toEqual({
      deployer: null,
      deployedAt: null,
      deployedLedger: null,
    });
  });
});
