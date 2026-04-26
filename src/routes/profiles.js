const express = require("express");
const router = express.Router();
const { getDb } = require("../db");
const { buildProfile } = require("../utils/external");
const { uuidv7 } = require("../utils/uuid");
const { parseQuery } = require("../utils/parser");
const { requireAuth, requireRole, requireApiVersion } = require("../middleware/auth");
const { apiLimiter } = require("../middleware/rateLimit");

router.use(requireAuth, requireApiVersion, apiLimiter);

const ALLOWED_SORT  = ["age", "created_at", "gender_probability"];
const ALLOWED_ORDER = ["asc", "desc"];

function buildWhere(filters) {
  const conditions = [], params = [];
  if (filters.gender) { conditions.push("LOWER(gender) = ?"); params.push(filters.gender.toLowerCase()); }
  if (filters.age_group) { conditions.push("LOWER(age_group) = ?"); params.push(filters.age_group.toLowerCase()); }
  if (filters.country_id) { conditions.push("LOWER(country_id) = ?"); params.push(filters.country_id.toLowerCase()); }
  if (filters.min_age !== undefined) { conditions.push("age >= ?"); params.push(Number(filters.min_age)); }
  if (filters.max_age !== undefined) { conditions.push("age <= ?"); params.push(Number(filters.max_age)); }
  if (filters.min_gender_probability !== undefined) { conditions.push("gender_probability >= ?"); params.push(Number(filters.min_gender_probability)); }
  if (filters.min_country_probability !== undefined) { conditions.push("country_probability >= ?"); params.push(Number(filters.min_country_probability)); }
  return { whereClause: conditions.length ? "WHERE " + conditions.join(" AND ") : "", params };
}

function buildPaginationLinks(req, page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  const base = req.path;
  const query = { ...req.query, limit };
  const makeLink = (p) => `${base}?${new URLSearchParams({ ...query, page: p })}`;
  return {
    self: makeLink(page),
    next: page < totalPages ? makeLink(page + 1) : null,
    prev: page > 1 ? makeLink(page - 1) : null,
  };
}

router.get("/export", (req, res) => {
  const { gender, age_group, country_id, min_age, max_age, min_gender_probability, min_country_probability, sort_by, order } = req.query;
  const sortBy    = sort_by && ALLOWED_SORT.includes(sort_by) ? sort_by : "created_at";
  const sortOrder = order && ALLOWED_ORDER.includes(order.toLowerCase()) ? order.toUpperCase() : "ASC";
  const { whereClause, params } = buildWhere({ gender, age_group, country_id, min_age, max_age, min_gender_probability, min_country_probability });
  const db   = getDb();
  const rows = db.prepare(`SELECT id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at FROM profiles ${whereClause} ORDER BY ${sortBy} ${sortOrder}`).all(...params);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const header = "id,name,gender,gender_probability,age,age_group,country_id,country_name,country_probability,created_at";
  const csvRows = rows.map((r) => [r.id, `"${r.name}"`, r.gender, r.gender_probability, r.age, r.age_group, r.country_id, `"${r.country_name || ""}"`, r.country_probability, r.created_at].join(","));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="profiles_${timestamp}.csv"`);
  return res.status(200).send([header, ...csvRows].join("\n"));
});

router.get("/search", (req, res) => {
  const q = req.query.q;
  if (!q || q.trim() === "") return res.status(400).json({ status: "error", message: "Missing or empty query parameter: q" });
  const filters = parseQuery(q);
  if (!filters) return res.status(400).json({ status: "error", message: "Unable to interpret query" });
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const { whereClause, params } = buildWhere(filters);
  const db    = getDb();
  const total = db.prepare(`SELECT COUNT(*) as count FROM profiles ${whereClause}`).get(...params).count;
  const data  = db.prepare(`SELECT * FROM profiles ${whereClause} ORDER BY created_at ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return res.status(200).json({ status: "success", page, limit, total, total_pages: Math.ceil(total / limit), links: buildPaginationLinks(req, page, limit, total), data });
});

router.get("/", (req, res) => {
  const { gender, age_group, country_id, min_age, max_age, min_gender_probability, min_country_probability, sort_by, order, page: rawPage, limit: rawLimit } = req.query;
  const sortBy    = sort_by && ALLOWED_SORT.includes(sort_by) ? sort_by : "created_at";
  const sortOrder = order && ALLOWED_ORDER.includes(order.toLowerCase()) ? order.toLowerCase() : "asc";
  if ((min_age !== undefined && isNaN(Number(min_age))) || (max_age !== undefined && isNaN(Number(max_age)))) {
    return res.status(422).json({ status: "error", message: "Invalid query parameters" });
  }
  const page   = Math.max(1, parseInt(rawPage) || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(rawLimit) || 10));
  const offset = (page - 1) * limit;
  const { whereClause, params } = buildWhere({ gender, age_group, country_id, min_age, max_age, min_gender_probability, min_country_probability });
  const db    = getDb();
  const total = db.prepare(`SELECT COUNT(*) as count FROM profiles ${whereClause}`).get(...params).count;
  const data  = db.prepare(`SELECT * FROM profiles ${whereClause} ORDER BY ${sortBy} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return res.status(200).json({ status: "success", page, limit, total, total_pages: Math.ceil(total / limit), links: buildPaginationLinks(req, page, limit, total), data });
});

router.post("/", requireRole("admin"), async (req, res) => {
  const name = req.body && req.body.name;
  if (!name || typeof name !== "string" || name.trim() === "") return res.status(400).json({ status: "error", message: "name is required" });
  const cleanName = name.trim().toLowerCase();
  const db = getDb();
  const existing = db.prepare("SELECT * FROM profiles WHERE name = ?").get(cleanName);
  if (existing) return res.status(200).json({ status: "success", message: "Profile already exists", data: existing });
  let profileData;
  try { profileData = await buildProfile(cleanName); }
  catch (err) { return res.status(err.status || 500).json({ status: "error", message: err.message }); }
  const id = uuidv7();
  const created_at = new Date().toISOString();
  db.prepare(`INSERT INTO profiles (id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_name, country_probability, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, cleanName, profileData.gender, profileData.gender_probability, profileData.sample_size, profileData.age, profileData.age_group, profileData.country_id, profileData.country_name || null, profileData.country_probability, created_at);
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
  return res.status(201).json({ status: "success", data: profile });
});

router.get("/:id", (req, res) => {
  const db = getDb();
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(req.params.id);
  if (!profile) return res.status(404).json({ status: "error", message: "Profile not found" });
  return res.status(200).json({ status: "success", data: profile });
});

router.delete("/:id", requireRole("admin"), (req, res) => {
  const db = getDb();
  const profile = db.prepare("SELECT id FROM profiles WHERE id = ?").get(req.params.id);
  if (!profile) return res.status(404).json({ status: "error", message: "Profile not found" });
  db.prepare("DELETE FROM profiles WHERE id = ?").run(req.params.id);
  return res.sendStatus(204);
});

module.exports = router;