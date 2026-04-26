const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { getDb } = require("../db");
const { uuidv7 } = require("./uuid");

const ACCESS_SECRET = process.env.JWT_SECRET || "insighta-access-secret-change-in-prod";
const ACCESS_EXPIRY = 3 * 60;

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRY }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function issueRefreshToken(userId) {
  const db = getDb();
  const token = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv7(), userId, token, expiresAt, new Date().toISOString());
  return token;
}

function rotateRefreshToken(oldToken) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM refresh_tokens WHERE token = ?").get(oldToken);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(oldToken);
    return null;
  }
  db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(oldToken);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  if (!user || !user.is_active) return null;
  const accessToken  = issueAccessToken(user);
  const refreshToken = issueRefreshToken(user.id);
  return { accessToken, refreshToken, user };
}

function revokeRefreshToken(token) {
  const db = getDb();
  db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(token);
}

module.exports = { issueAccessToken, verifyAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken };