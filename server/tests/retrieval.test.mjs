import { db } from "../config/database.js";
import { retrievePaperChunks } from "../services/retrievalService.js";

const PAPER_ID = process.argv[2] || "e938672d-59bf-4551-b315-6fc44afe09bb";
const QUESTION = process.argv[3] || "What technology was used for sheep facial recognition?";

async function testRetrieval() {
    console.log("=================================");
    console.log("Nexus Semantic Retrieval Test");
    console.log("=================================");
    console.log(`Paper ID: ${PAPER_ID}`);
    console.log(`Question: ${QUESTION}`);
    console.log("");

    const results = await retrievePaperChunks(
        PAPER_ID,
        QUESTION,
        5
    );

    if (!results.length) {
        console.log("No relevant chunks were found.");
        return;
    }

    console.log(`Retrieved ${results.length} chunks.\n`);

    results.forEach((chunk, index) => {
        console.log(`========== RESULT ${index + 1} ==========`);
        console.log(`Chunk ID: ${chunk.id}`);
        console.log(`Chunk Index: ${chunk.chunk_index}`);
        console.log(`Page: ${chunk.page_number || "N/A"}`);
        console.log(`Section: ${chunk.section_title || chunk.sectionTitle || "N/A"}`);
        console.log(`Similarity Score: ${chunk.similarity ?? chunk.score ?? "N/A"}`);
        console.log(`Content:\n${chunk.content?.slice(0, 300)}...\n`);
    });
}

testRetrieval()
    .catch((err) => {
        console.error("Retrieval test error:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.end();
    });
