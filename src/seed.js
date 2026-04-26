const path = require("path");
const { getDb } = require("./db");
const { uuidv7 } = require("./utils/uuid");

const FILE_PATH = process.env.SEED_FILE || path.join(__dirname, "..", "profiles.json");

async function runSeed() {
  let raw;
  try {
    raw = require(FILE_PATH);
  } catch {
    console.log("No profiles.json found — skipping seed.");
    return;
  }

  const profiles = raw.profiles || raw;
  if (!Array.isArray(profiles)) {
    console.log("Seed file format invalid — skipping seed.");
    return;
  }

  const db = getDb();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO profiles
      (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    let inserted = 0;
    for (const p of items) {
      const result = insert.run(
        uuidv7(), p.name, p.gender, p.gender_probability,
        p.age, p.age_group, p.country_id, p.country_name || null,
        p.country_probability, new Date().toISOString()
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const inserted = insertMany(profiles);
  console.log(`Seed: ${inserted} new profiles inserted, ${profiles.length - inserted} already existed.`);
}

if (require.main === module) {
  const { initDb } = require("./db");
  initDb().then(runSeed).then(() => process.exit(0));
}

module.exports = { runSeed };