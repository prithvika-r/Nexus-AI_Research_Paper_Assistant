import path from "node:path";
import { extractPdfPages } from "../services/pdfService.js";

const filePath = process.argv[2] || path.join(import.meta.dirname, "../uploads/1772040896030-fvets-12-1404564.pdf");

try {
    const result = await extractPdfPages(filePath);

    console.log("Total pages:", result.pageCount);
    console.log("Metadata:", result.metadata);

    for (const page of result.pages) {
        console.log(`\n--- Page ${page.pageNumber} | ${page.layout} ---`);
        console.log("Diagnostics:", page.diagnostics);

        console.log(
            "Headings:",
            page.blocks
                ?.filter(block => block.isHeading)
                ?.map(block => block.headingTitle) || []
        );

        console.log("Text preview:\n", page.text.slice(0, 600));
    }
} catch (error) {
    console.error("Extraction failed:", error.message);
    process.exitCode = 1;
}
