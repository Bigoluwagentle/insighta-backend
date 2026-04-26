const express = require("express");
const router  = express.Router();
const https   = require("https");
const { getDb }    = require("../db");
const { uuidv7 }   = require("../utils/uuid");
const { issueAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } = require("../utils/tokens");
const { generateCsrfToken } = require("../middleware/csrf");
const { authLimiter }       = require("../middleware/rateLimit");
const { requireAuth }       = require("../middleware/auth");

const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL         = process.env.FRONTEND_URL || "http://localhost:3001";

const pendingStates = new Map();

router.get("/github", authLimiter, (req, res) => {
  const { state, code_challenge, code_challenge_method, redirect_uri } = req.query;

  const stateKey = state || require("crypto").randomBytes(16).toString("hex");

  pendingStates.set(stateKey, {
    code_challenge,
    code_challenge_method,
    redirect_uri: redirect_uri || null,
  });

  setTimeout(() => pendingStates.delete(stateKey), 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope: "read:user user:email",
    state: stateKey,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get("/github/callback", authLimiter, async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ status: "error", message: "Missing authorization code" });
  }

  const stateData = state ? pendingStates.get(state) : null;
  if (state) pendingStates.delete(state);

  const redirectUri = stateData && stateData.redirect_uri;

  try {
    const githubToken = await exchangeCodeForToken(code);
    if (!githubToken) {
      if (redirectUri) return res.redirect(`${redirectUri}?error=github_exchange_failed`);
      return res.status(502).json({ status: "error", message: "Failed to exchange code with GitHub" });
    }

    const githubUser = await getGithubUser(githubToken);
    if (!githubUser) {
      if (redirectUri) return res.redirect(`${redirectUri}?error=github_user_failed`);
      return res.status(502).json({ status: "error", message: "Failed to fetch GitHub user" });
    }

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

    if (!user.is_active) {
      if (redirectUri) return res.redirect(`${redirectUri}?error=account_disabled`);
      return res.status(403).json({ status: "error", message: "Account is disabled" });
    }

    const accessToken  = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user.id);

    if (redirectUri && redirectUri.includes("localhost")) {
      const params = new URLSearchParams({
        access_token: accessToken, refresh_token: refreshToken, username: user.username,
      });
      return res.redirect(`${redirectUri}?${params}`);
    }

    if (redirectUri) {
      const params = new URLSearchParams({
        access_token: accessToken, refresh_token: refreshToken,
      });
      return res.redirect(`${redirectUri}?${params}`);
    }

    const csrfToken = generateCsrfToken();
    const isProd    = process.env.NODE_ENV === "production";
    res.cookie("access_token",  accessToken,  { httpOnly: true,  secure: isProd, sameSite: "lax", maxAge: 3 * 60 * 1000 });
    res.cookie("refresh_token", refreshToken, { httpOnly: true,  secure: isProd, sameSite: "lax", maxAge: 5 * 60 * 1000 });
    res.cookie("csrf_token",    csrfToken,    { httpOnly: false, secure: isProd, sameSite: "lax", maxAge: 5 * 60 * 1000 });
    return res.redirect(`${FRONTEND_URL}/dashboard`);

  } catch (err) {
    console.error("OAuth callback error:", err);
    if (redirectUri) return res.redirect(`${redirectUri}?error=auth_failed`);
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
    const isProd    = process.env.NODE_ENV === "production";
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
      res.on("data", (c) => (data += c));
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
      res.on("data", (c) => (data += c));
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

router.post("/setup-admin", async (req, res) => {
  const { secret, username } = req.body;
  if (secret !== process.env.JWT_SECRET) {
    return res.status(403).json({ status: "error", message: "Forbidden" });
  }
  const db = getDb();
  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (adminExists) {
    return res.status(400).json({ status: "error", message: "Admin already exists" });
  }
  db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(username);
  return res.status(200).json({ status: "success", message: `${username} is now admin` });
});

module.exports = router;