/**
 * Declarative JSON request-body validation for POST routes.
 *
 * Schemas are compiled once with Ajv (https://ajv.js.org). Ajv was chosen over
 * Zod because this server is plain CommonJS JavaScript: Ajv works natively in
 * CJS, is JSON-Schema based (portable, reusable schemas), and already ships
 * with the Express ecosystem's dependencies without a TS build step.
 *
 * Validation failures are reported as 400 ValidationError with a `details`
 * array of { path, message } objects. Values from the request are never echoed.
 */
const Ajv = require("ajv");

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });

const KEYWORD_MESSAGES = {
  required: "is required",
  type: "has an invalid type",
  minItems: "must not be empty",
  maxItems: "contains too many items",
  minLength: "must not be empty",
  minProperties: "must not be empty",
  additionalProperties: "is not allowed",
  minimum: "is below the allowed minimum",
  maximum: "is above the allowed maximum",
  format: "has an invalid format",
  pattern: "has an invalid format",
};

function toPath(instancePath) {
  if (!instancePath) return "body";
  return instancePath
    .replace(/\//g, ".")
    .replace(/^\./, "")
    .replace(/(\.\d+)/g, (match) => `[${match.slice(1)}]`);
}

/**
 * Build an Express middleware that validates req.body against a JSON schema.
 * Unknown properties are always rejected.
 *
 * @param {object} schema - JSON schema (object properties only)
 * @returns {import('express').RequestHandler}
 */
function validateBody(schema) {
  const validate = ajv.compile({
    type: "object",
    additionalProperties: false,
    ...schema,
  });

  return function validateBodyMiddleware(req, res, next) {
    if (validate(req.body === undefined || req.body === null ? {} : req.body)) {
      return next();
    }

    const err = new Error("Request body failed validation.");
    err.isValidation = true;
    err.status = 400;
    err.statusCode = 400;
    err.field = "body";
    err.details = validate.errors.map((error) => {
      const path = toPath(error.instancePath) +
        (error.keyword === "required" ? `.${error.params.missingProperty}` :
          error.keyword === "additionalProperties" ? `.${error.params.additionalProperty}` : "");
      return {
        path: path.replace(/^\./, ""),
        message: KEYWORD_MESSAGES[error.keyword] || "is invalid",
      };
    });
    return next(err);
  };
}

module.exports = { validateBody };
