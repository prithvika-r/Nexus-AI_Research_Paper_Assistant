import { db } from "../config/database.js";

try {
    const result = await db.query(`
        SELECT
            id,
            title,
            source,
            file_path,
            LENGTH(full_text) AS full_text_chars,
            LENGTH(abstract) AS abstract_chars,
            processing_status,
            created_at
        FROM papers
        ORDER BY created_at DESC;
    `);

    console.table(result.rows);
} catch (error) {
    console.error("Schema audit failed:", error.message);
    process.exitCode = 1;
} finally {
    await db.end();
}
