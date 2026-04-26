const app = require("./app");
const { initDb } = require("./db");
const { runSeed } = require("./seed");

const PORT = process.env.PORT || 3000;

async function start() {
  await initDb();
  await runSeed();
  app.listen(PORT, () => {
    console.log(`Insighta Labs+ backend running on port ${PORT}`);
  });
}

start();