const express = require("express");

const DEFAULT_MAX_BODY_SIZE = "10kb";
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || DEFAULT_MAX_BODY_SIZE;

function normalizeMaxBodySize(value) {
    if (!value) return DEFAULT_MAX_BODY_SIZE;
    const normalized = String(value).trim().toLowerCase();

    // Accept plain byte values or unit-suffixed values like 10kb, 1mb.
    if (/^[0-9]+$/.test(normalized)) {
        return `${normalized}b`;
    }

    if (/^[0-9]+(b|kb|mb|gb)$/.test(normalized)) {
        return normalized;
    }

    return DEFAULT_MAX_BODY_SIZE;
}

const requestBodySizeLimit = normalizeMaxBodySize(MAX_BODY_SIZE);
const bodySizeLimit = express.json({ limit: requestBodySizeLimit });

module.exports = bodySizeLimit;
module.exports.MAX_BODY_SIZE = requestBodySizeLimit;
