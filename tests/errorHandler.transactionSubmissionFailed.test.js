const errorHandler = require("../src/middleware/errorHandler");

function makeHorizonSubmissionError(status, resultCodes, detail = "Transaction submission failed.") {
  return {
    response: {
      status,
      data: {
        type: "transaction_failed",
        title: "Transaction Failed",
        detail,
        extras: { result_codes: resultCodes },
      },
    },
  };
}

describe("TransactionSubmissionFailed error handling", () => {
  let req, res, next;

  beforeEach(() => {
    req = { method: "POST", path: "/transactions" };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it("handles a bad sequence number failure", () => {
    const err = makeHorizonSubmissionError(400, { transaction: "tx_bad_seq" });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        type: "TransactionSubmissionFailed",
        title: "Transaction Failed",
        detail: "Transaction submission failed.",
        message: "Transaction sequence number does not match the account's current sequence. Reload the account and rebuild the transaction.",
        resultCodes: { transaction: "tx_bad_seq" },
        code: "tx_bad_seq",
      },
      requestId: null,
    });
  });

  it("handles an insufficient fee failure", () => {
    const err = makeHorizonSubmissionError(400, { transaction: "tx_insufficient_fee" });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].error).toMatchObject({
      type: "TransactionSubmissionFailed",
      resultCodes: { transaction: "tx_insufficient_fee" },
      message: "Transaction fee is too low. Increase the fee or use the current base fee from Horizon multiplied by the number of operations.",
    });
  });

  it("handles an underfunded source account failure at the operation level", () => {
    const err = makeHorizonSubmissionError(400, {
      transaction: "tx_failed",
      operations: ["op_underfunded"],
    });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatchObject({
      type: "TransactionSubmissionFailed",
      resultCodes: { transaction: "tx_failed", operations: ["op_underfunded"] },
      message: "Transaction submission failed.",
    });
  });

  it("handles a missing trustline failure across multiple operations", () => {
    const err = makeHorizonSubmissionError(400, {
      transaction: "tx_failed",
      operations: ["op_success", "op_no_trust"],
    });

    errorHandler(err, req, res, next);

    expect(res.json.mock.calls[0][0].error).toMatchObject({
      type: "TransactionSubmissionFailed",
      resultCodes: { transaction: "tx_failed", operations: ["op_success", "op_no_trust"] },
      message: "Transaction submission failed.",
    });
  });

  it("handles a bad auth / missing signature failure", () => {
    const err = makeHorizonSubmissionError(400, { transaction: "tx_bad_auth" });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].error).toMatchObject({
      type: "TransactionSubmissionFailed",
      resultCodes: { transaction: "tx_bad_auth" },
      message: "Transaction is missing a required signature or has an invalid signature. Sign with all required signers and verify the network passphrase.",
    });
  });

  it("falls back to a generic suggestion for an unrecognized result code", () => {
    const err = makeHorizonSubmissionError(400, { transaction: "tx_some_future_code" });

    errorHandler(err, req, res, next);

    expect(res.json.mock.calls[0][0].error).toMatchObject({
      type: "TransactionSubmissionFailed",
      resultCodes: { transaction: "tx_some_future_code" },
      message: "Transaction submission failed.",
    });
  });

  it("does not reclassify non-submission Horizon errors (no 'Transaction Failed' title)", () => {
    const err = {
      response: {
        status: 404,
        data: {
          title: "Not Found",
          detail: "Asset not found.",
          extras: { result_codes: { transaction: "tx_bad_seq" } },
        },
      },
    };

    errorHandler(err, req, res, next);

    expect(res.json.mock.calls[0][0].error.type).toBe("HorizonError");
  });
});
