import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../config/database.js";
import {
    retrievePaperChunks,
    retrieveMultiPaperChunks,
} from "../services/retrievalService.js";
import {
    generateAnswer,
    generateCrossPaperComparison,
} from "../services/llmService.js";

const EVAL_DATASET = [
    {
        id: "Q1_FACTUAL_METRIC",
        category: "Factual / Numerical Metric",
        paperTitlePart: "fvets",
        question: "What was the average detection accuracy and mAP improvement of the enhanced multi-part identification network compared to YOLOv5s?",
        expectedKeywords: ["95.84%", "2.55%", "mAP", "YOLOv5s"],
        expectedPages: [1, 9, 11],
    },
    {
        id: "Q2_METHODOLOGY",
        category: "Methodology & Architecture",
        paperTitlePart: "fvets",
        question: "What three networks or models comprise the sheep face recognition and health monitoring system?",
        expectedKeywords: ["YOLOv5", "GhostNet", "EfficientNet", "multi-part"],
        expectedPages: [1, 3, 5],
    },
    {
        id: "Q3_TABLE_DATA",
        category: "Structured Tabular Data",
        paperTitlePart: "fvets",
        question: "According to Table 1, what were the FPS and mAP for SSD and CenterNet?",
        expectedKeywords: ["SSD", "CenterNet", "81.01%", "92.60%"],
        expectedPages: [9],
    },
    {
        id: "Q4_CROSS_PAPER",
        category: "Multi-Paper Comparison",
        isMultiPaper: true,
        paperTitles: [
            "Software Testing Techniques: A Literature Review",
            "Software Testing Process Models Benefits & Drawbacks:",
        ],
        question: "Compare the software testing techniques and process models discussed across these papers.",
        expectedKeywords: ["TMM", "TPI", "automation", "testing", "metrics"],
    },
    {
        id: "Q5_UNANSWERABLE",
        category: "Negative / Faithfulness (Anti-Hallucination)",
        paperTitlePart: "fvets",
        question: "What quantum computing algorithm was implemented on IBM superconducting qubits to optimize the sheep flock?",
        isNegative: true,
        expectedBehavior: "Must not hallucinate or cite quantum computing evidence.",
    },
];

async function runEvaluation() {
    console.log("=================================================================");
    console.log("   NEXUS RAG RETRIEVAL QUALITY & CITATION EVALUATION SUITE       ");
    console.log("=================================================================\n");

    const papersRes = await db.query(
        "SELECT id, title FROM papers WHERE processing_status = 'completed'"
    );

    const papers = papersRes.rows;
    if (!papers.length) {
        throw new Error("No indexed papers found in database to evaluate against.");
    }

    console.log(`Available indexed papers in library: ${papers.length}`);
    papers.forEach(p => console.log(`  - [${p.id.slice(0, 8)}] ${p.title}`));
    console.log("");

    const results = [];

    for (const test of EVAL_DATASET) {
        console.log(`Running [${test.id}] (${test.category})...`);
        console.log(`  Question: "${test.question}"`);

        const t0 = Date.now();
        let chunks = [];
        let targetPaper = null;
        let multiPapers = [];

        try {
            if (test.isMultiPaper) {
                multiPapers = papers.filter(p =>
                    test.paperTitles.some(t => p.title.toLowerCase().includes(t.toLowerCase().slice(0, 25)))
                );
                if (multiPapers.length < 2) {
                    console.log(`  [SKIP] Multi-paper targets not both found in library.`);
                    continue;
                }
                chunks = await retrieveMultiPaperChunks({
                    paperIds: multiPapers.map(p => p.id),
                    question: test.question,
                    topK: 6,
                });
            } else {
                targetPaper = papers.find(p =>
                    p.title.toLowerCase().includes(test.paperTitlePart.toLowerCase())
                );
                if (!targetPaper) {
                    console.log(`  [SKIP] Paper matching "${test.paperTitlePart}" not found.`);
                    continue;
                }
                chunks = await retrievePaperChunks(targetPaper.id, test.question, 6);
            }

            const retrievalTimeMs = Date.now() - t0;

            // Evaluate Retrieval Quality
            let recallHits = 0;
            let firstRelevantRank = -1;

            if (!test.isNegative && test.expectedKeywords) {
                chunks.forEach((chunk, idx) => {
                    const text = `${chunk.content} ${chunk.sectionTitle || ""}`;
                    const hasKeyword = test.expectedKeywords.some(kw =>
                        text.toLowerCase().includes(kw.toLowerCase())
                    );
                    if (hasKeyword) {
                        recallHits++;
                        if (firstRelevantRank === -1) firstRelevantRank = idx + 1;
                    }
                });
            }

            const mrr = firstRelevantRank > 0 ? (1 / firstRelevantRank) : (test.isNegative ? 1.0 : 0.0);
            const recallAtK = test.expectedKeywords
                ? Math.min(1.0, recallHits / Math.min(test.expectedKeywords.length, chunks.length || 1))
                : 1.0;

            // Generate Answer & Evaluate Citations
            let answerResult;
            if (test.isMultiPaper) {
                answerResult = await generateCrossPaperComparison({
                    papers: multiPapers,
                    question: test.question,
                    chunks,
                });
            } else {
                answerResult = await generateAnswer({
                    paperTitle: targetPaper?.title,
                    question: test.question,
                    chunks,
                });
            }

            const totalTimeMs = Date.now() - t0;
            const citations = answerResult.citations || [];

            // Citation correctness metrics
            let validPageCount = 0;
            let validSnippetCount = 0;
            let validChunkIdCount = 0;

            const chunkIdSet = new Set(chunks.map(c => c.id));

            for (const citation of citations) {
                if (citation.pageNumber != null && Number.isInteger(citation.pageNumber)) {
                    validPageCount++;
                }
                if (citation.snippet && citation.snippet.length >= 20) {
                    validSnippetCount++;
                }
                if (chunkIdSet.has(citation.chunkId)) {
                    validChunkIdCount++;
                }
            }

            const pageGroundingRate = citations.length ? (validPageCount / citations.length) : (test.isNegative ? 1.0 : 0.0);
            const citationValidityRate = citations.length ? (validChunkIdCount / citations.length) : (test.isNegative ? 1.0 : 0.0);
            const snippetCoverageRate = citations.length ? (validSnippetCount / citations.length) : (test.isNegative ? 1.0 : 0.0);

            // Faithfulness check for negative question (must explicitly acknowledge absence or refuse)
            let faithfulnessPass = true;
            if (test.isNegative) {
                const isRefusalOrAbsence = /\b(no reference|not mentioned|cannot be identified|absent|not found|no evidence|does not mention|does not discuss|not provide enough support|no relevant|unsupported)\b/i.test(answerResult.answer);
                faithfulnessPass = isRefusalOrAbsence;
            }

            results.push({
                testId: test.id,
                category: test.category,
                chunksRetrieved: chunks.length,
                retrievalTimeMs,
                totalTimeMs,
                recallAtK,
                mrr,
                citationsCount: citations.length,
                citationValidityRate,
                pageGroundingRate,
                snippetCoverageRate,
                faithfulnessPass,
                answerPreview: answerResult.answer.slice(0, 160).replace(/\n/g, " "),
                citationsSample: citations.slice(0, 2).map(c => `[${c.id}] p.${c.pageNumber || 'N/A'}`).join(", "),
            });

            console.log(`  ✓ Recall@K: ${(recallAtK * 100).toFixed(1)}% | MRR: ${mrr.toFixed(2)} | Citations: ${citations.length} | Page Grounding: ${(pageGroundingRate * 100).toFixed(0)}%`);
        } catch (err) {
            console.error(`  ✗ Error in test ${test.id}:`, err.message);
        }
    }

    // Print Benchmark Summary Table
    console.log("\n=================================================================");
    console.log("                    BENCHMARK EVALUATION RESULTS                 ");
    console.log("=================================================================");
    console.table(results.map(r => ({
        Test: r.testId,
        "Chunks": r.chunksRetrieved,
        "Recall@6": `${(r.recallAtK * 100).toFixed(0)}%`,
        "MRR": r.mrr.toFixed(2),
        "Citations": r.citationsCount,
        "Citation Valid%": `${(r.citationValidityRate * 100).toFixed(0)}%`,
        "Page Grounded%": `${(r.pageGroundingRate * 100).toFixed(0)}%`,
        "Faithful": r.faithfulnessPass ? "YES" : "NO",
        "Total Time": `${(r.totalTimeMs / 1000).toFixed(1)}s`,
    })));

    const avgRecall = results.reduce((acc, r) => acc + r.recallAtK, 0) / results.length;
    const avgMRR = results.reduce((acc, r) => acc + r.mrr, 0) / results.length;
    const avgPageGrounding = results.reduce((acc, r) => acc + r.pageGroundingRate, 0) / results.length;
    const allFaithful = results.every(r => r.faithfulnessPass);

    console.log(`\nOverall Metrics Summary:`);
    console.log(`  • Average Retrieval Recall@6: ${(avgRecall * 100).toFixed(1)}%`);
    console.log(`  • Mean Reciprocal Rank (MRR): ${avgMRR.toFixed(3)}`);
    console.log(`  • Page Citation Grounding Rate: ${(avgPageGrounding * 100).toFixed(1)}%`);
    console.log(`  • Hallucination Resistance & Faithfulness: ${allFaithful ? "100% PASSED" : "FAILED"}`);

    await db.end();
}

runEvaluation().catch(async err => {
    console.error("Evaluation run crashed:", err);
    await db.end();
    process.exitCode = 1;
});
