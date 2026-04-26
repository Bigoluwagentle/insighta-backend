const express = require("express");
const router = express.Router();
const https = require("https");
const { getDb } = require("../db");
const { uuidv7 } = require("../utils/uuid");
const { issueAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } = require("../utils/tokens");
const { generateCsrfToken } = require("../middleware/csrf");
const { authLimiter } = require("../middleware/rateLimit");
const { requireAuth } = require("../middleware/auth");

const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL         = process.env.FRONTEND_URL || "http://localhost:3001";

const pendingVerifiers = new Map();

router.get("/github", authLimiter, (req, res) => {
  const { state, code_challenge, code_challenge_method, redirect_uri } = req.query;
  if (state && code_challenge) {
    pendingVerifiers.set(state, { code_challenge, code_challenge_method, redirect_uri });
  }
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope: "read:user user:email",
    ...(state && { state }),
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get("/github/callback", authLimiter, async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).json({ status: "error", message: "Missing authorization code" });

  const pkceData = state ? pendingVerifiers.get(state) : null;
  if (pkceData) pendingVerifiers.delete(state);

  try {
    const githubToken = await exchangeCodeForToken(code);
    if (!githubToken) return res.status(502).json({ status: "error", message: "Failed to exchange code with GitHub" });

    const githubUser = await getGithubUser(githubToken);
    if (!githubUser) return res.status(502).json({ status: "error", message: "Failed to fetch GitHub user" });

    const db  = getDb();
    const now = new Date().toISOString();
    let user  = db.prepare("SELECT * FROM users WHERE github_id = ?").get(String(githubUser.id));

    if (user) {
      db.prepare("UPDATE users SET username = ?, email = ?, avatar_url = ?, last_login_at = ? WHERE id = ?")
        .run(githubUser.login, githubUser.email || null, githubUser.avatar_url, now, user.id);
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    } else {
      const id = uuidv7();
      db.prepare(`INSERT INTO users (id, github_id, username, email, avatar_url, role, is_active, last_login_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'analyst', 1, ?, ?)`)
        .run(id, String(githubUser.id), githubUser.login, githubUser.email || null, githubUser.avatar_url, now, now);
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    }

    if (!user.is_active) return res.status(403).json({ status: "error", message: "Account is disabled" });

    const accessToken  = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user.id);

    if (pkceData && pkceData.redirect_uri) {
      const callbackParams = new URLSearchParams({
        access_token: accessToken, refresh_token: refreshToken, username: user.username,
      });
      return res.redirect(`${pkceData.redirect_uri}?${callbackParams}`);
    }

    const csrfToken = generateCsrfToken();
    const isProd    = process.env.NODE_ENV === "production";
    res.cookie("access_token",  accessToken,  { httpOnly: true,  secure: isProd, sameSite: "lax", maxAge: 3 * 60 * 1000 });
    res.cookie("refresh_token", refreshToken, { httpOnly: true,  secure: isProd, sameSite: "lax", maxAge: 5 * 60 * 1000 });
    res.cookie("csrf_token",    csrfToken,    { httpOnly: false, secure: isProd, sameSite: "lax", maxAge: 5 * 60 * 1000 });
    return res.redirect(`${FRONTEND_URL}/dashboard`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    return res.status(500).json({ status: "error", message: "Authentication failed" });
  }
});

router.post("/refresh", authLimiter, (req, res) => {
  const token = req.body.refresh_token || (req.cookies && req.cookies.refresh_token);
  if (!token) return res.status(400).json({ status: "error", message: "Refresh token required" });

  const result = rotateRefreshToken(token);
  if (!result) return res.status(401).json({ status: "error", message: "Invalid or expired refresh token" });

  const { accessToken, refreshToken } = result;

  if (req.cookies && req.cookies.refresh_token) {
    const isProd = process.env.NODE_ENV === "production";
    const csrfToken = generateCsrfToken();
    res.cookie("access_token",  accessToken,  { httpOnly: true,  secure: isProd, sameSite: "lax", maxAge: 3 * 60 * 1000 });
    res.cookie("refresh_token", refreshToken, { httpOnly: true,  secure: isProd, sameSite: "lax", maxAge: 5 * 60 * 1000 });
    res.cookie("csrf_token",    csrfToken,    { httpOnly: false, secure: isProd, sameSite: "lax", maxAge: 5 * 60 * 1000 });
  }

  return res.status(200).json({ status: "success", access_token: accessToken, refresh_token: refreshToken });
});

router.post("/logout", requireAuth, (req, res) => {
  const token = req.body.refresh_token || (req.cookies && req.cookies.refresh_token);
  if (token) revokeRefreshToken(token);
  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
  res.clearCookie("csrf_token");
  return res.status(200).json({ status: "success", message: "Logged out successfully" });
});

router.get("/me", requireAuth, (req, res) => {
  const { id, username, email, avatar_url, role, created_at, last_login_at } = req.user;
  return res.status(200).json({ status: "success", data: { id, username, email, avatar_url, role, created_at, last_login_at } });
});

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "insighta-labs" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on("error", reject);
  });
}

async function exchangeCodeForToken(code) {
  const body = JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code });
  const data = await httpsPost({
    hostname: "github.com", path: "/login/oauth/access_token", method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(body) },
  }, body);
  return data.access_token || null;
}

async function getGithubUser(token) {
  return await httpsGet("https://api.github.com/user", token);
}

module.exports = router;