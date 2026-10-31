
import { db } from "../config/database.js";
import { extractPdfPages } from "../services/pdfService.js";
import { indexPaper } from "../services/indexingService.js";

const paperId = "eff21ab6-a7ac-4a55-a0a4-5eb2e730a056";

async function main() {
    try {
        // Verify the exact paper before making any changes.
        const result = await db.query(
            `SELECT id, title, file_path, chunk_count
             FROM papers
             WHERE id = $1`,
            [paperId]
        );

        if (result.rowCount !== 1) {
            throw new Error("Target paper not found.");
        }

        const paper = result.rows[0];

        console.log("Target paper:", paper.title);
        console.log("Current chunks:", paper.chunk_count);
        console.log("PDF:", paper.file_path);

        if (
            !paper.file_path ||
            !paper.file_path.endsWith("1792926074651-1901.01450v1.pdf")
        ) {
            throw new Error(
                "PDF path does not match the expected file. Aborting."
            );
        }

        // Extract the PDF using the updated extraction service.
        const pdf = await extractPdfPages(paper.file_path);

        if (!pdf.pages?.length) {
            throw new Error("PDF extraction returned no pages.");
        }

        const fullText = pdf.pages
            .map(page => page.text)
            .join("\n\n");

        if (!fullText.trim()) {
            throw new Error("Extracted PDF text is empty.");
        }

        console.log("Extracted pages:", pdf.pages.length);
        console.log("Extracted characters:", fullText.length);

        // Rebuild chunks and embeddings for this paper only.
        // indexPaper manages its own transaction.
        await indexPaper(paperId, pdf.pages);

        // Update the paper's stored full text after indexing succeeds.
        await db.query(
            `UPDATE papers
             SET full_text = $1
             WHERE id = $2`,
            [fullText, paperId]
        );

        const verification = await db.query(
            `SELECT chunk_count, processing_status
             FROM papers
             WHERE id = $1`,
            [paperId]
        );

        console.log("Re-indexing completed.");
        console.table(verification.rows);
    } catch (error) {
        console.error("Re-indexing failed:", error.message);
        process.exitCode = 1;
    } finally {
        await db.end?.();
    }
}

main();
