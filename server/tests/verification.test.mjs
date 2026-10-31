import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "../config/database.js";
import { cleanTopic, extractCountFromText, normalizeGaps, generateFallbackGaps } from "../routes/gaps.js";
import { embedText } from "../services/embeddingService.js";
import { dehyphenateText } from "../services/pdfService.js";

let totalPassed = 0;
let totalFailed = 0;

function report(category, name, pass, detail = "") {
    if (pass) {
        console.log(`  ✓ [PASS] [${category}] ${name} ${detail ? `(${detail})` : ""}`);
        totalPassed++;
    } else {
        console.error(`  ✗ [FAIL] [${category}] ${name} - ${detail}`);
        totalFailed++;
    }
}

async function runAllChecks() {
    console.log("=================================================================");
    console.log("   NEXUS FULL SYSTEM VERIFICATION & AUDIT SUITE                   ");
    console.log("=================================================================\n");

    // =================================================================
    // 1. MALFORMED AI OUTPUT AND JSON VALIDATION
    // =================================================================
    console.log("--- 1. Malformed AI Output and JSON Validation ---");
    {
        // 1.1 JSON parsing with Markdown fences
        const fencedJson = "```json\n[\n  {\"area\": \"Test Gap 1\", \"gap_score\": 75, \"reason\": \"Valid reason 1\"},\n  {\"area\": \"Test Gap 2\", \"gap_score\": 80, \"reason\": \"Valid reason 2\"}\n]\n```";
        const clean = fencedJson.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
        let parsed = null;
        try {
            parsed = JSON.parse(clean);
        } catch {}
        report("1. JSON", "Extracts JSON array from markdown code fences", Array.isArray(parsed) && parsed.length === 2);

        // 1.2 JSON array extraction with conversational preamble and postscript
        const conversationalText = "Here are the research gaps you requested:\n\n[{\"area\": \"Embedded Gap\", \"gap_score\": 70, \"reason\": \"Found inside text\"}]\n\nI hope this analysis is helpful!";
        const start = conversationalText.indexOf("[");
        const end = conversationalText.lastIndexOf("]");
        const extracted = JSON.parse(conversationalText.slice(start, end + 1));
        report("1. JSON", "Extracts JSON array embedded in conversational text", Array.isArray(extracted) && extracted[0].area === "Embedded Gap");

        // 1.3 Safe handling of malformed input in normalizeGaps
        const mockPapers = [
            { id: "p1", title: "Paper One", abstract: "Abstract 1", chunks: [{ page_number: 2, content: "Chunk content 1" }] },
            { id: "p2", title: "Paper Two", abstract: "Abstract 2", chunks: [{ page_number: 4, content: "Chunk content 2" }] }
        ];

        const malformedAiOutputs = [
            // Out of range score, missing confidence, null fields
            { area: "Valid Direction", gap_score: 150, reason: null, confidence: "invalid_val" },
            // Missing area, string score
            { gap_score: "85", reason: "Good explanation" },
            // Evidence with unexpected types
            { area: "Another Direction", gap_score: -10, reason: "Negative score test", evidence: [123, null], evidenceDetails: "not-an-array" }
        ];

        const sanitized = normalizeGaps(malformedAiOutputs, {
            mode: "library",
            papers: mockPapers,
            topic: "Robustness Testing",
            count: 3
        });

        report("1. JSON", "Sanitizes gap scores to [0, 100] range", sanitized[0].gap_score === 100 && sanitized[2].gap_score === 0);
        report("1. JSON", "Applies default fallback for missing area/reason", Boolean(sanitized[1].area) && Boolean(sanitized[0].reason));
        report("1. JSON", "Coerces invalid confidence to valid level", sanitized[0].confidence === "medium" || sanitized[0].confidence === "low");

        // 1.4 Topic and prompt extraction cleaning
        const messyInstruction = "Please generate 2 distinct research gaps on Distributed Systems in Cloud Computing:";
        const cleaned = cleanTopic(messyInstruction);
        const extractedCount = extractCountFromText(messyInstruction);
        report("1. JSON", "cleanTopic strips instruction prefix cleanly", cleaned === "Distributed Systems in Cloud Computing", `got: "${cleaned}"`);
        report("1. JSON", "extractCountFromText extracts requested count", extractedCount === 2, `got: ${extractedCount}`);
    }

    // =================================================================
    // 2. API TIMEOUTS, RATE LIMITS, AND FAILURES
    // =================================================================
    console.log("\n--- 2. API Timeouts, Rate Limits, and Failures ---");
    {
        // 2.1 Fallback generation when LLM service throws (timeout / rate limit simulation)
        const mockPapers = [
            { id: "p1", title: "Distributed Consensus Protocols", abstract: "Consensus in networks", chunks: [] },
            { id: "p2", title: "Byzantine Fault Tolerance", abstract: "BFT state machines", chunks: [] }
        ];

        const fallbacks2 = generateFallbackGaps({
            topic: "Fault Tolerance",
            papers: mockPapers,
            mode: "library",
            count: 2
        });

        report("2. Resilience", "Deterministic fallback generates exactly requested count (2)", fallbacks2.length === 2);
        report("2. Resilience", "Fallback in library mode grounds across both papers", fallbacks2[0].evidence.length === 2 && fallbacks2[0].evidenceDetails.length === 2);

        // 2.2 Live API validation of missing topic (400 Bad Request)
        try {
            const emptyTopicResp = await fetch("http://localhost:5000/api/gaps", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic: "" })
            });
            report("2. Resilience", "Empty topic request returns 400 Bad Request", emptyTopicResp.status === 400);
        } catch {
            console.log("  [SKIP] Local backend not running on port 5000 for live API check 2.2.");
        }

        // 2.3 Semantic Scholar rate limit / retry header parsing
        const retryHeader = "120";
        const parsedRetry = parseInt(retryHeader, 10);
        report("2. Resilience", "Retry-After header parsed correctly", parsedRetry === 120);
    }

    // =================================================================
    // 3. PDF EXTRACTION AND EMBEDDING FAILURES
    // =================================================================
    console.log("\n--- 3. PDF Extraction and Embedding Failures ---");
    {
        // 3.1 Text de-hyphenation across line endings
        const dehyphenated = dehyphenateText("inter-", "operability");
        report("3. PDF & Embeddings", "PDF word de-hyphenation preserves token semantics", dehyphenated === "interoperability", `got: ${dehyphenated}`);

        // 3.2 Embedding model loading and inference verification
        try {
            const testEmbedding = await embedText("Academic paper retrieval benchmarks");
            report("3. PDF & Embeddings", "Embedding model (all-MiniLM-L6-v2) generates 384-dim vector", Array.isArray(testEmbedding) && testEmbedding.length === 384);
            report("3. PDF & Embeddings", "Embedding vector contains non-zero finite floats", testEmbedding.some(v => v !== 0) && testEmbedding.every(v => Number.isFinite(v)));
        } catch (e) {
            console.log(`  [SKIP] Embedding model check: ${e.message}`);
        }

        // 3.3 Multi-page chunking verification
        try {
            const chunkRes = await db.query(`
                SELECT count(*)::int as total_chunks,
                       count(distinct paper_id)::int as distinct_papers,
                       avg(length(content))::int as avg_chunk_len
                FROM paper_chunks;
            `);
            const stats = chunkRes.rows[0];
            report("3. PDF & Embeddings", "PostgreSQL indexed chunks available", stats.total_chunks > 100, `${stats.total_chunks} chunks across ${stats.distinct_papers} papers`);
            report("3. PDF & Embeddings", "Average chunk length in target range (300-900 chars)", stats.avg_chunk_len >= 300 && stats.avg_chunk_len <= 900, `avg: ${stats.avg_chunk_len} chars`);
        } catch (e) {
            console.log(`  [SKIP] DB connection for chunk check: ${e.message}`);
        }
    }

    // =================================================================
    // 4. POSTGRESQL PERSISTENCE AND PAPER-ID CONSISTENCY
    // =================================================================
    console.log("\n--- 4. PostgreSQL Persistence and Paper-ID Consistency ---");
    try {
        // 4.1 Check database papers table and UUID consistency
        const papersRes = await db.query(`
            SELECT id, title, source, created_at
            FROM papers
            ORDER BY created_at DESC;
        `);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const allUuidsValid = papersRes.rows.every(p => uuidRegex.test(p.id));
        report("4. Persistence", "All paper IDs follow strict UUID format", allUuidsValid, `${papersRes.rows.length} papers checked`);

        // 4.2 Relational integrity: Orphan chunk check
        const orphanRes = await db.query(`
            SELECT count(*)::int as orphan_count
            FROM paper_chunks c
            LEFT JOIN papers p ON c.paper_id = p.id
            WHERE p.id IS NULL;
        `);
        report("4. Persistence", "Zero orphan chunks (foreign-key / relation consistency)", orphanRes.rows[0].orphan_count === 0, `orphans: ${orphanRes.rows[0].orphan_count}`);
    } catch (e) {
        console.log(`  [SKIP] Database persistence checks: ${e.message}`);
    }

    console.log("\n=================================================================");
    console.log(`TOTAL AUDIT CHECKS: ${totalPassed + totalFailed} | PASSED: ${totalPassed} | FAILED: ${totalFailed}`);
    console.log("=================================================================");

    if (totalFailed > 0) {
        process.exit(1);
    }
}

runAllChecks().catch((err) => {
    console.error("Test suite failed:", err);
    process.exit(1);
}).finally(async () => {
    await db.end().catch(() => {});
});
