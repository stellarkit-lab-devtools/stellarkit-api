const crypto = require("crypto");

function generateRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function requestIdMiddleware(req, res, next) {
  const incomingId = req.get("x-request-id") || req.headers["x-request-id"];
  const requestId = incomingId && String(incomingId).trim() ? String(incomingId).trim() : generateRequestId();

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}

module.exports = requestIdMiddleware;
