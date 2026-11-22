const express = require("express");
const router = express.Router();

router.get("/.well-known/security.txt", (req, res) => {
  const contact = process.env.SECURITY_CONTACT;
  if (!contact) return res.sendStatus(404);
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const lines = [
    "Contact: " + contact,
    "Expires: " + (process.env.SECURITY_TXT_EXPIRES || expires.toISOString()),
    "Preferred-Languages: en",
  ];
  if (process.env.SECURITY_POLICY_URL) lines.push("Policy: " + process.env.SECURITY_POLICY_URL);
  lines.push("Canonical: " + req.protocol + "://" + req.get("host") + "/.well-known/security.txt");
  return res.type("text/plain").send(lines.join("\n") + "\n");
});

module.exports = router;
