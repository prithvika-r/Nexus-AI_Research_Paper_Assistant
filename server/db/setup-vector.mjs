import { db } from "../config/database.js";

try {
  console.log("Setting up pgvector extension...");
  await db.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  const result = await db.query(`
    SELECT extname, extversion
    FROM pg_extension
    WHERE extname = 'vector';
  `);

  console.log("pgvector extension verified:");
  console.table(result.rows);
} catch (error) {
  console.error("Vector setup error:", error.message);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
