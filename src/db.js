const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "insighta.db");

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
  }
  return db;
}

function initDb() {
  return new Promise((resolve) => {
    const database = getDb();

    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        github_id TEXT UNIQUE NOT NULL,
        username TEXT,
        email TEXT,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'analyst',
        is_active INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        gender TEXT,
        gender_probability REAL,
        sample_size INTEGER,
        age INTEGER,
        age_group TEXT,
        country_id TEXT,
        country_name TEXT,
        country_probability REAL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender);
      CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age);
      CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles(age_group);
      CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles(country_id);
      CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    `);

    const cols = database.pragma("table_info(profiles)").map((c) => c.name);
    if (!cols.includes("country_name")) {
      database.exec("ALTER TABLE profiles ADD COLUMN country_name TEXT");
    }

    resolve();
  });
}

module.exports = { getDb, initDb };