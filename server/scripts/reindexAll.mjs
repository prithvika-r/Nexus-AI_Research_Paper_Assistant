import "dotenv/config";
import fs from "node:fs";
import { db } from "../config/database.js";
import { extractPdfPages } from "../services/pdfService.js";
import { indexPaper } from "../services/indexingService.js";

async function main() {
    console.log("=== Reindexing All Available Papers in Library ===");
    const res = await db.query(
        "SELECT id, title, file_path FROM papers WHERE file_path IS NOT NULL ORDER BY created_at"
    );

    for (const paper of res.rows) {
        if (!fs.existsSync(paper.file_path)) {
            console.log(`Skipping paper ${paper.id} (${paper.title}): file not found on disk.`);
            continue;
        }

        console.log(`\nProcessing: [${paper.title}] (${paper.id})`);
        try {
            const pdf = await extractPdfPages(paper.file_path);
            console.log(`  Extracted ${pdf.pages.length} pages, ${pdf.references?.length || 0} references, ${pdf.pages.flatMap(p => p.tables).length} tables`);
            const indexing = await indexPaper(paper.id, pdf.pages);
            console.log(`  Indexed ${indexing.chunksIndexed} chunks successfully.`);
        } catch (err) {
            console.error(`  Failed to index paper ${paper.id}:`, err.message);
        }
    }

    console.log("\n=== Reindexing Completed ===");
    await db.end();
}

main().catch(async (e) => {
    console.error("Fatal reindex error:", e);
    await db.end();
});
