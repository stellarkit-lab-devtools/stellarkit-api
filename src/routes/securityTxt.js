const express = require("express");

const router = express.Router();

function getExpiresDate() {
  if (process.env.SECURITY_TXT_EXPIRES) {
    return process.env.SECURITY_TXT_EXPIRES;
  }
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
}

/**
 * GET /.well-known/security.txt (RFC 9116)
 *
 * Serves security contact and disclosure policy information for security researchers.
 * Excluded from authentication and rate limiting.
 */
router.get("/security.txt", (req, res) => {
  const contact = process.env.SECURITY_CONTACT;
  if (!contact || !contact.trim()) {
    return res.status(404).type("text/plain").send("Not Found");
  }

  const host = req.get("host") || "localhost";
  const protocol = req.protocol || (req.secure ? "https" : "http");
  const canonical = `${protocol}://${host}/.well-known/security.txt`;

  const lines = [
    `Contact: ${contact.trim()}`,
    `Expires: ${getExpiresDate()}`,
    `Preferred-Languages: en`,
  ];

  if (process.env.SECURITY_POLICY_URL && process.env.SECURITY_POLICY_URL.trim()) {
    lines.push(`Policy: ${process.env.SECURITY_POLICY_URL.trim()}`);
  }

  lines.push(`Canonical: ${canonical}`);
  lines.push("");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.status(200).send(lines.join("\n"));
});

module.exports = router;
