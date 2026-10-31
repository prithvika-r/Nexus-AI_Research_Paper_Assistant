import "dotenv/config";
import pkg from "pg";

const { Pool } = pkg;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
});

async function migrate() {
    const client = await pool.connect();

    try {
        console.log("Starting retrieval metadata migration...");

        await client.query("BEGIN");

        await client.query(`
            ALTER TABLE paper_chunks
            ADD COLUMN IF NOT EXISTS content_type TEXT
            DEFAULT 'body';
        `);

        await client.query(`
            ALTER TABLE paper_chunks
            ADD COLUMN IF NOT EXISTS retrieval_score REAL;
        `);

        await client.query(`
            ALTER TABLE paper_chunks
            ADD COLUMN IF NOT EXISTS is_reference BOOLEAN
            DEFAULT FALSE;
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_paper_chunks_content_type
            ON paper_chunks(content_type);
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_paper_chunks_is_reference
            ON paper_chunks(is_reference);
        `);

        await client.query("COMMIT");

        console.log("");
        console.log("Retrieval metadata migration completed successfully.");
        console.log("Added: content_type");
        console.log("Added: retrieval_score");
        console.log("Added: is_reference");
        console.log("");
    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Migration failed:");
        console.error(error);

        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();