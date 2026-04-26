const crypto = require("crypto");

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function csrfProtection(req, res, next) {
  if (req.method === "GET" || req.headers["authorization"]) return next();
  const cookieToken = req.cookies && req.cookies.csrf_token;
  const headerToken = req.headers["x-csrf-token"];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ status: "error", message: "Invalid CSRF token" });
  }
  next();
}

module.exports = { generateCsrfToken, csrfProtection };