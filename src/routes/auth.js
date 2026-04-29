const express = require("express");
const router  = express.Router();
const https   = require("https");
const crypto  = require("crypto");
const { getDb }    = require("../db");
const { uuidv7 }   = require("../utils/uuid");
const { issueAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } = require("../utils/tokens");
const { generateCsrfToken } = require("../middleware/csrf");
const { requireAuth }       = require("../middleware/auth");

const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL         = process.env.FRONTEND_URL || "http://localhost:3001";

const pendingStates = new Map();

// GET /auth/github
// Stores state + code_challenge + redirect_uri, then redirects to GitHub
// GitHub will always redirect back to THIS backend callback (registered URL)
router.get("/github", (req, res) => {
  const { code_challenge, code_challenge_method, redirect_uri } = req.query;
  const state = crypto.randomBytes(16).toString("hex");

  pendingStates.set(state, {
    code_challenge:        code_challenge        || null,
    code_challenge_method: code_challenge_method || "S256",
    redirect_uri:          redirect_uri          || null,
    created_at:            Date.now(),
  });

  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

  // Only send client_id, scope, state to GitHub
  // GitHub redirects to the registered callback URL on this backend
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope:     "read:user user:email",
    state,
  });

  res.redirect("https://github.com/login/oauth/authorize?" + params);
});

// GET /auth/github/callback
// GitHub always redirects here
// If redirect_uri was stored (CLI flow), redirect there with code+state
// If no redirect_uri (web flow), process tokens and redirect to portal
router.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!code) return res.status(400).json({ status: "error", message: "Missing authorization code" });
  if (!state) return res.status(400).json({ status: "error", message: "Missing state parameter" });

  const stateData = pendingStates.get(state);
  if (!stateData) return res.status(400).json({ status: "error", message: "Invalid or expired state" });

  const redirectUri = stateData.redirect_uri;

  // CLI flow — redirect to localhost with code+state so CLI can POST them back
  if (redirectUri && redirectUri.includes("localhost")) {
    // Don't delete state yet — CLI will use it when POSTing /auth/github/token
    const params = new URLSearchParams({ code, state });
    return res.redirect(redirectUri + "?" + params);
  }

  // Web portal flow — delete state and process tokens
  pendingStates.delete(state);

  try {
    const githubToken = await exchangeCodeForToken(code);
    if (!githubToken) {
      if (redirectUri) return res.redirect(redirectUri + "?error=github_exchange_failed");
      return res.status(502).json({ status: "error", message: "Failed to exchange code with GitHub" });
    }

    const githubUser = await getGithubUser(githubToken);
    if (!githubUser || !githubUser.id) {
      if (redirectUri) return res.redirect(redirectUri + "?error=github_user_failed");
      return res.status(502).json({ status: "error", message: "Failed to fetch GitHub user" });
    }

    const user = await upsertUser(githubUser);
    if (!user.is_active) {
      if (redirectUri) return res.redirect(redirectUri + "?error=account_disabled");
      return res.status(403).json({ status: "error", message: "Account is disabled" });
    }

    const accessToken  = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user.id);

    // Web portal with redirect_uri
    if (redirectUri) {
      const params = new URLSearchParams({ access_token: accessToken, refresh_token: refreshToken });
      return res.redirect(redirectUri + "?" + params);
    }

    // Direct browser — set HTTP-only cookies
    const csrfToken = generateCsrfToken();
    const isProd    = process.env.NODE_ENV === "production";
    res.cookie("access_token",  accessToken,  { httpOnly: true,  secure: isProd, sameSite: "lax", maxAge: 3 * 60 * 1000 });
    res.cookie("refresh_token", refreshToken, { httpOnly: true,  secure: isProd, sameSite: "lax", maxAge: 5 * 60 * 1000 });
    res.cookie("csrf_token",    csrfToken,    { httpOnly: false, secure: isProd, sameSite: "lax", maxAge: 5 * 60 * 1000 });
    return res.redirect(FRONTEND_URL + "/dashboard");

  } catch (err) {
    console.error("OAuth callback error:", err);
    if (redirectUri) return res.redirect(redirectUri + "?error=auth_failed");
    return res.status(500).json({ status: "error", message: "Authentication failed" });
  }
});

// POST /auth/github/token
// CLI calls this after capturing code from its local callback
// Validates PKCE, exchanges code, issues tokens
router.post("/github/token", async (req, res) => {
  const { code, code_verifier, state } = req.body;

  if (!code)  return res.status(400).json({ status: "error", message: "Missing authorization code" });
  if (!state) return res.status(400).json({ status: "error", message: "Missing state parameter" });

  const stateData = pendingStates.get(state);
  if (!stateData) return res.status(400).json({ status: "error", message: "Invalid or expired state" });
  pendingStates.delete(state);

  // Validate PKCE
  if (stateData.code_challenge) {
    if (!code_verifier) return res.status(400).json({ status: "error", message: "Missing code_verifier" });
    const method   = stateData.code_challenge_method || "S256";
    const computed = method === "S256"
      ? crypto.createHash("sha256").update(code_verifier).digest("base64url")
      : code_verifier;
    if (computed !== stateData.code_challenge) {
      return res.status(400).json({ status: "error", message: "Invalid code_verifier" });
    }
  }

  try {
    const githubToken = await exchangeCodeForToken(code);
    if (!githubToken) return res.status(502).json({ status: "error", message: "Failed to exchange code with GitHub" });

    const githubUser = await getGithubUser(githubToken);
    if (!githubUser || !githubUser.id) return res.status(502).json({ status: "error", message: "Failed to fetch GitHub user" });

    const user = await upsertUser(githubUser);
    if (!user.is_active) return res.status(403).json({ status: "error", message: "Account is disabled" });

    const accessToken  = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user.id);

    return res.status(200).json({
      status:        "success",
      access_token:  accessToken,
      refresh_token: refreshToken,
      username:      user.username,
      role:          user.role,
    });
  } catch (err) {
    console.error("Token exchange error:", err);
    return res.status(500).json({ status: "error", message: "Authentication failed" });
  }
});

// POST /auth/refresh
router.post("/refresh", (req, res) => {
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

// POST /auth/logout
router.post("/logout", requireAuth, (req, res) => {
  const token = req.body.refresh_token || (req.cookies && req.cookies.refresh_token);
  if (token) revokeRefreshToken(token);
  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
  res.clearCookie("csrf_token");
  return res.status(200).json({ status: "success", message: "Logged out successfully" });
});

// GET /auth/me
router.get("/me", requireAuth, (req, res) => {
  const { id, username, email, avatar_url, role, created_at, last_login_at } = req.user;
  return res.status(200).json({ status: "success", data: { id, username, email, avatar_url, role, created_at, last_login_at } });
});

// POST /auth/setup-admin
router.post("/setup-admin", (req, res) => {
  const { secret, username } = req.body;
  if (secret !== process.env.JWT_SECRET) return res.status(403).json({ status: "error", message: "Forbidden" });
  const db = getDb();
  db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(username);
  return res.status(200).json({ status: "success", message: username + " is now admin" });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function upsertUser(githubUser) {
  const db  = getDb();
  const now = new Date().toISOString();
  let user  = db.prepare("SELECT * FROM users WHERE github_id = ?").get(String(githubUser.id));
  if (user) {
    db.prepare("UPDATE users SET username = ?, email = ?, avatar_url = ?, last_login_at = ? WHERE id = ?")
      .run(githubUser.login, githubUser.email || null, githubUser.avatar_url, now, user.id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  }
  const id       = uuidv7();
  const anyAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  const role     = anyAdmin ? "analyst" : "admin";
  db.prepare("INSERT INTO users (id, github_id, username, email, avatar_url, role, is_active, last_login_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
    .run(id, String(githubUser.id), githubUser.login, githubUser.email || null, githubUser.avatar_url, role, now, now);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

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
    https.get(url, { headers: { Authorization: "Bearer " + token, "User-Agent": "insighta-labs" } }, (res) => {
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

module.exports = router;