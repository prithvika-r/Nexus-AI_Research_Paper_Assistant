import path from "node:path";
import { extractPdfPages } from "../services/pdfService.js";

const pdfPath = process.argv[2] || path.join(import.meta.dirname, "../uploads/1772040896030-fvets-12-1404564.pdf");

try {
    console.log("Testing page-aware PDF extraction...");
    console.log(`Target: ${pdfPath}\n`);

    const result = await extractPdfPages(pdfPath);

    console.log(`Total PDF pages: ${result.pageCount}`);
    console.log(`Pages with extracted text: ${result.pages.length}\n`);

    for (const page of result.pages.slice(0, 5)) {
        console.log(`--- Page ${page.pageNumber} ---`);
        console.log(page.text.slice(0, 300));
        console.log("");
    }

    console.log("PDF page extraction test PASSED.");
} catch (error) {
    console.error("PDF page extraction test FAILED:", error.message);
    process.exitCode = 1;
}
