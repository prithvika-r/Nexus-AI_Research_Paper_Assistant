import { db } from "../config/database.js";

try {
    const result = await db.query(`
        SELECT
            p.id,
            p.title,
            p.processing_status,
            p.chunk_count,
            COUNT(pc.id)::int AS actual_chunks,
            COUNT(pc.page_number)::int AS chunks_with_page_numbers,
            (COUNT(pc.id) - COUNT(pc.page_number))::int
                AS chunks_missing_page_numbers
        FROM papers p
        LEFT JOIN paper_chunks pc ON pc.paper_id = p.id
        GROUP BY p.id, p.title, p.processing_status, p.chunk_count
        ORDER BY p.created_at DESC
    `);

    console.table(result.rows);
} catch (error) {
    console.error("Diagnostic failed:", error.message);
    process.exitCode = 1;
} finally {
    await db.end();
}
