const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { {{RESPONSE_IMPORT}} } = require("../utils/response");
{{IMPORTS}}
router.get({{PATH}}, async (req, res, next) => {
  try {
{{BODY}}    return success(res, data, meta);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
