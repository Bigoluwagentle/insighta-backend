const express      = require("express");
const cookieParser = require("cookie-parser");
const rateLimit    = require("express-rate-limit");
const { requestLogger } = require("./middleware/rateLimit");
const { csrfProtection } = require("./middleware/csrf");
const authRoutes    = require("./routes/auth");
const profileRoutes = require("./routes/profiles");
const { requireAuth } = require("./middleware/auth");

const app = express();

app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Version, X-CSRF-Token");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

// Strict rate limiter for auth routes
const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  keyGenerator: (req) => {
    return req.headers["x-forwarded-for"] || req.ip || "unknown";
  },
  handler: (req, res) => {
    return res.status(429).json({ status: "error", message: "Too many requests, please try again later" });
  },
});

app.use("/auth", authRateLimiter);
app.use("/auth", authRoutes);

app.get("/api/users/me", requireAuth, (req, res) => {
  const { id, github_id, username, email, avatar_url, role, is_active, created_at, last_login_at } = req.user;
  return res.status(200).json({ status: "success", data: { id, github_id, username, email, avatar_url, role, is_active, created_at, last_login_at } });
});

app.use(csrfProtection);
app.use("/api/profiles", profileRoutes);

app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Route not found" });
});

module.exports = app;