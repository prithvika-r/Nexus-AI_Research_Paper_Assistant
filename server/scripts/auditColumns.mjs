import { db } from "../config/database.js";

try {
  const result = await db.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('papers', 'paper_chunks')
    ORDER BY table_name, ordinal_position;
  `);

  console.table(result.rows);
} catch (error) {
  console.error("Columns audit failed:", error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
