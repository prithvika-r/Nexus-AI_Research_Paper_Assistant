import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    extractPdfPages,
    dehyphenateText,
    extractTablesFromPage,
    extractFiguresFromPage,
    parseReferences,
} from "../services/pdfService.js";

const UPLOADS_DIR = path.resolve(import.meta.dirname, "../uploads");

const TEST_FILES = {
    singleColumn: path.join(UPLOADS_DIR, "1792926074651-1901.01450v1.pdf"),
    doubleColumnIEEE: path.join(UPLOADS_DIR, "1792849177031-10.1109ICT4M.2016.045.pdf"),
    complexFrontiers: path.join(UPLOADS_DIR, "1772040896030-fvets-12-1404564.pdf"),
};

let passed = 0;
let failed = 0;

function report(testName, ok, details = "") {
    if (ok) {
        console.log(`  ✓ [PASS] ${testName} ${details ? `(${details})` : ""}`);
        passed++;
    } else {
        console.error(`  ✗ [FAIL] ${testName} - ${details}`);
        failed++;
    }
}

async function runLayoutTestSuite() {
    console.log("==========================================================");
    console.log("   NEXUS AUTOMATED PDF EXTRACTION TEST SUITE             ");
    console.log("==========================================================\n");

    // ------------------------------------------------------------------
    // TEST SUITE 1: Synthetic Layout & Text Assembly Logic
    // ------------------------------------------------------------------
    console.log("--- Test Suite 1: Synthetic Layout & De-hyphenation ---");
    {
        const joined1 = dehyphenateText("multi-", "dimensional");
        report("De-hyphenation of compound word", joined1 === "multi-dimensional", `got: ${joined1}`);

        const joined2 = dehyphenateText("identifi-", "cation");
        report("De-hyphenation of split word", joined2 === "identification", `got: ${joined2}`);

        const joined3 = dehyphenateText("complete sentence.", "Next sentence.");
        report("Sentence boundary preservation", joined3 === "complete sentence. Next sentence.", `got: ${joined3}`);
    }

    // ------------------------------------------------------------------
    // TEST SUITE 2: Single-Column Academic Layout (arXiv)
    // ------------------------------------------------------------------
    console.log("\n--- Test Suite 2: Single-Column Layout (arXiv 1901.01450v1) ---");
    if (fs.existsSync(TEST_FILES.singleColumn)) {
        try {
            const result = await extractPdfPages(TEST_FILES.singleColumn);
            report("Page count verification", result.pageCount >= 20, `${result.pageCount} pages`);
            report("Title extraction", /Software Testing Process Models/i.test(result.metadata.title || ""), result.metadata.title);
            report("Abstract extraction", (result.metadata.abstract?.length || 0) > 100, `${result.metadata.abstract?.length} chars`);
            report("References parsing", result.references.length > 50, `${result.references.length} parsed`);

            // Verify layout: Page 1 has single-column front matter, Page 2 has two-column body
            const p1 = result.pages[0];
            const p2 = result.pages[1];
            report("Page 1 front matter single-column", p1 && p1.layout === "single-column", `detected: ${p1?.layout}`);
            report("Page 2 body two-column", p2 && p2.layout === "two-column", `detected: ${p2?.layout}`);
        } catch (err) {
            report("Single-column PDF processing", false, err.message);
        }
    } else {
        console.log("  [SKIP] arXiv test PDF not found on disk.");
    }

    // ------------------------------------------------------------------
    // TEST SUITE 3: Double-Column Academic Layout (IEEE Conference)
    // ------------------------------------------------------------------
    console.log("\n--- Test Suite 3: Double-Column IEEE Layout (10.1109ICT4M.2016.045) ---");
    if (fs.existsSync(TEST_FILES.doubleColumnIEEE)) {
        try {
            const result = await extractPdfPages(TEST_FILES.doubleColumnIEEE);
            report("Page count verification", result.pageCount === 6, `${result.pageCount} pages`);
            report("Title extraction", /Software Testing Techniques/i.test(result.metadata.title || ""), result.metadata.title);
            report("Authors extraction", /Muhammad Abid Jamil/i.test(result.metadata.authors || ""), result.metadata.authors);
            report("References parsing", result.references.length >= 15, `${result.references.length} parsed`);

            // Verify column gutter detection on body pages
            const bodyPagesWithGutter = result.pages.filter(p => p.diagnostics.gutterDetected);
            report("Two-column gutter detection on body", bodyPagesWithGutter.length >= 3, `${bodyPagesWithGutter.length} pages with gutter`);
        } catch (err) {
            report("IEEE PDF processing", false, err.message);
        }
    } else {
        console.log("  [SKIP] IEEE test PDF not found on disk.");
    }

    // ------------------------------------------------------------------
    // TEST SUITE 4: Complex Layout with Sidebar, Tables, Figures (Frontiers)
    // ------------------------------------------------------------------
    console.log("\n--- Test Suite 4: Complex Frontiers Layout (fvets-12-1404564) ---");
    if (fs.existsSync(TEST_FILES.complexFrontiers)) {
        try {
            const result = await extractPdfPages(TEST_FILES.complexFrontiers);
            report("Page count verification", result.pageCount === 15, `${result.pageCount} pages`);
            report("Title extraction without sidebar noise", /Research on herd sheep facial recognition/i.test(result.metadata.title || ""), result.metadata.title);
            report("Abstract extraction without sidebar contamination", (result.metadata.abstract?.length || 0) > 400 && !/OPEN ACCESS/i.test(result.metadata.abstract || ""), `${result.metadata.abstract?.length} chars`);
            report("Publication year extraction", result.metadata.year === 2025, `year: ${result.metadata.year}`);

            // Tables extraction
            const allTables = result.pages.flatMap(p => p.tables);
            report("Table extraction count", allTables.length >= 4, `${allTables.length} tables found`);
            const tableWithHeaders = allTables.find(t => t.headers && t.headers.length >= 3);
            report("Structured table markdown columns", Boolean(tableWithHeaders), tableWithHeaders ? `Table ${tableWithHeaders.tableNumber}: [${tableWithHeaders.headers.join(", ")}]` : "No headers");

            // Figures extraction
            const allFigs = result.pages.flatMap(p => p.figures);
            report("Figure extraction count", allFigs.length >= 5, `${allFigs.length} figures found`);

            // References extraction & ordering
            report("References count", result.references.length >= 25, `${result.references.length} references`);
            const ref1 = result.references.find(r => r.number === "1" || r.key === "[1]");
            report("Reference [1] parsed correctly", Boolean(ref1 && /Wang L/i.test(ref1.authors || "") && ref1.year === 2023), ref1?.raw?.slice(0, 70));

            // Verify header and footer exclusion
            const totalHeaders = result.pages.reduce((acc, p) => acc + (p.headers?.length || 0), 0);
            const totalFooters = result.pages.reduce((acc, p) => acc + (p.footers?.length || 0), 0);
            report("Running headers filtered", totalHeaders >= 10, `${totalHeaders} headers isolated`);
            report("Running footers filtered", totalFooters >= 10, `${totalFooters} footers isolated`);
        } catch (err) {
            report("Frontiers complex PDF processing", false, err.message);
        }
    } else {
        console.log("  [SKIP] Frontiers test PDF not found on disk.");
    }

    // ------------------------------------------------------------------
    // SUMMARY REPORT
    // ------------------------------------------------------------------
    console.log("\n==========================================================");
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log("==========================================================");

    if (failed > 0) {
        process.exitCode = 1;
    }
}

runLayoutTestSuite().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exitCode = 1;
});
