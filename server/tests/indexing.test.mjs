import { db } from "../config/database.js";
import { indexPaper } from "../services/indexingService.js";

const PAPER_ID = process.argv[2] || "e938672d-59bf-4551-b315-6fc44afe09bb";

async function testIndexing() {
    console.log("=================================");
    console.log("Nexus RAG Indexing Test");
    console.log("=================================");
    console.log(`Paper ID: ${PAPER_ID}\n`);

    const result = await db.query(
        `SELECT id, title, full_text FROM papers WHERE id = $1`,
        [PAPER_ID]
    );

    if (!result.rows.length) {
        throw new Error("Paper not found.");
    }

    const paper = result.rows[0];
    console.log(`Title: ${paper.title}`);
    console.log(`Text length: ${paper.full_text?.length || 0} characters\n`);

    if (!paper.full_text || !paper.full_text.trim()) {
        throw new Error("This paper has no full_text.");
    }

    console.log("Starting chunking + embedding + pgvector indexing...\n");

    const indexingResult = await indexPaper(paper.id, paper.full_text);

    console.log("=================================");
    console.log("Indexing completed successfully.");
    console.log("=================================");
    console.table(indexingResult);

    const chunks = await db.query(
        `SELECT
            id,
            chunk_index,
            page_number,
            LEFT(content, 180) AS preview,
            embedding IS NOT NULL AS has_embedding
        FROM paper_chunks
        WHERE paper_id = $1
        ORDER BY chunk_index
        LIMIT 5`,
        [PAPER_ID]
    );

    console.log("\nFirst indexed chunks:");
    console.table(chunks.rows);

    const count = await db.query(
        `SELECT COUNT(*) AS total FROM paper_chunks WHERE paper_id = $1`,
        [PAPER_ID]
    );

    console.log(`\nTotal chunks in database: ${count.rows[0].total}`);

    const paperStatus = await db.query(
        `SELECT processing_status, chunk_count, embedding_model, processed_at
         FROM papers
         WHERE id = $1`,
        [PAPER_ID]
    );

    console.log("\nPaper processing status:");
    console.table(paperStatus.rows);
}

testIndexing()
    .catch((error) => {
        console.error("\nINDEXING TEST FAILED:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.end();
    });
