const { verifyAccessToken } = require("../utils/tokens");
const { getDb } = require("../db");

function requireAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  }

  if (!token) return res.status(401).json({ status: "error", message: "Authentication required" });

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ status: "error", message: "Invalid or expired token" });
  }

  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
  if (!user) return res.status(401).json({ status: "error", message: "User not found" });
  if (!user.is_active) return res.status(403).json({ status: "error", message: "Account is disabled" });

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ status: "error", message: "Authentication required" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ status: "error", message: "Insufficient permissions" });
    next();
  };
}

function requireApiVersion(req, res, next) {
  const version = req.headers["x-api-version"];
  if (!version) return res.status(400).json({ status: "error", message: "API version header required" });
  next();
}

module.exports = { requireAuth, requireRole, requireApiVersion };