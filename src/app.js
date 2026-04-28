const express      = require("express");
const cookieParser = require("cookie-parser");
const { requestLogger } = require("./middleware/rateLimit");
const { csrfProtection } = require("./middleware/csrf");
const authRoutes    = require("./routes/auth");
const profileRoutes = require("./routes/profiles");
const { requireAuth } = require("./middleware/auth");

const app = express();

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

app.use("/auth", authRoutes);

app.get("/api/users/me", requireAuth, (req, res) => {
  const { id, username, email, avatar_url, role, created_at, last_login_at } = req.user;
  return res.status(200).json({ status: "success", data: { id, username, email, avatar_url, role, created_at, last_login_at } });
});

app.use(csrfProtection);
app.use("/api/profiles", profileRoutes);

app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Route not found" });
});

module.exports = app;