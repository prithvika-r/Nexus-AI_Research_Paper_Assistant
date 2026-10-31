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
        console.log("Starting Nexus RAG database migration...");

        await client.query("BEGIN");

        // pgvector
        await client.query(`
            CREATE EXTENSION IF NOT EXISTS vector;
        `);

        // Store individual semantic chunks from uploaded papers.
        await client.query(`
            CREATE TABLE IF NOT EXISTS paper_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                paper_id UUID NOT NULL
                    REFERENCES papers(id)
                    ON DELETE CASCADE,

                chunk_index INTEGER NOT NULL,

                page_number INTEGER,

                content TEXT NOT NULL,

                embedding VECTOR(384),

                created_at TIMESTAMP DEFAULT NOW(),

                UNIQUE (paper_id, chunk_index)
            );
        `);

        // Useful for retrieving all chunks belonging to one paper.
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_paper_chunks_paper_id
            ON paper_chunks(paper_id);
        `);

        // Vector similarity index.
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_paper_chunks_embedding_hnsw
            ON paper_chunks
            USING hnsw (embedding vector_cosine_ops);
        `);

        // Metadata that tells us how the paper was processed.
        await client.query(`
            ALTER TABLE papers
            ADD COLUMN IF NOT EXISTS processing_status TEXT
            DEFAULT 'legacy';
        `);

        await client.query(`
            ALTER TABLE papers
            ADD COLUMN IF NOT EXISTS chunk_count INTEGER
            DEFAULT 0;
        `);

        await client.query(`
            ALTER TABLE papers
            ADD COLUMN IF NOT EXISTS embedding_model TEXT;
        `);

        await client.query(`
            ALTER TABLE papers
            ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;
        `);

        await client.query("COMMIT");

        console.log("");
        console.log("RAG database migration completed successfully.");
        console.log("Created: paper_chunks");
        console.log("Created: pgvector HNSW index");
        console.log("Updated: papers processing metadata");
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