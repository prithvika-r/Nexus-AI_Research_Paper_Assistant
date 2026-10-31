import express from "express";
import "dotenv/config";

import { db } from "../config/database.js";
import {
    retrievePaperChunks,
    retrieveMultiPaperChunks,
    retrieveLibraryChunks,
} from "../services/retrievalService.js";
import {
    generateAnswer,
    generateCrossPaperComparison,
    MODEL_NAME,
} from "../services/llmService.js";

const router = express.Router();

const MAX_QUESTION_LENGTH = Number(
    process.env.RAG_MAX_QUESTION_LENGTH || 4000
);

const DEFAULT_TOP_K = Number(process.env.RAG_TOP_K || 6);

// Main chat handler (handles single-paper, multi-paper, and library queries)
async function handleChat(req, res) {
    const { paperId, paperIds, question, compare, library, topK } = req.body ?? {};

    if (typeof question !== "string" || !question.trim()) {
        return res.status(400).json({
            error: "Question is required.",
        });
    }

    const normalizedQuestion = question.trim();
    if (normalizedQuestion.length > MAX_QUESTION_LENGTH) {
        return res.status(400).json({
            error: `Question must not exceed ${MAX_QUESTION_LENGTH} characters.`,
        });
    }

    const targetTopK = Math.max(1, Number(topK) || DEFAULT_TOP_K);

    try {
        // Multi-paper comparison mode
        const targetPaperIds = Array.isArray(paperIds)
            ? paperIds.map(id => String(id).trim()).filter(Boolean)
            : (paperId ? [String(paperId).trim()] : []);

        const isMultiPaper = targetPaperIds.length > 1;
        const isCompareMode = Boolean(compare) || isMultiPaper;

        if (targetPaperIds.length > 0) {
            // Verify papers exist and are indexed
            const papersResult = await db.query(
                `SELECT id, title, processing_status, chunk_count, embedding_model, authors, year
                 FROM papers
                 WHERE id = ANY($1::uuid[])`,
                [targetPaperIds]
            );

            if (papersResult.rowCount === 0) {
                return res.status(404).json({
                    error: "None of the specified papers were found.",
                });
            }

            const readyPapers = papersResult.rows.filter(
                p => p.processing_status === "completed" && Number(p.chunk_count) > 0
            );

            if (readyPapers.length === 0) {
                return res.status(409).json({
                    error: "Selected paper(s) have not finished indexing for RAG yet.",
                    papers: papersResult.rows.map(p => ({
                        id: p.id,
                        title: p.title,
                        status: p.processing_status,
                    })),
                });
            }

            let chunks = [];

            if (readyPapers.length === 1) {
                chunks = await retrievePaperChunks(readyPapers[0].id, normalizedQuestion, targetTopK);
            } else {
                chunks = await retrieveMultiPaperChunks({
                    paperIds: readyPapers.map(p => p.id),
                    question: normalizedQuestion,
                    topK: Math.max(targetTopK, readyPapers.length * 3),
                });
            }

            if (!chunks.length) {
                return res.json({
                    answer: "No relevant indexed evidence was found for this question across the selected paper(s).",
                    citations: [],
                    retrieval: { chunksRetrieved: 0 },
                    papers: readyPapers,
                    model: MODEL_NAME,
                });
            }

            let result;

            if (isCompareMode && readyPapers.length > 1) {
                result = await generateCrossPaperComparison({
                    papers: readyPapers,
                    question: normalizedQuestion,
                    chunks,
                });
            } else {
                result = await generateAnswer({
                    paperTitle: readyPapers[0].title,
                    question: normalizedQuestion,
                    chunks,
                });
            }

            return res.json({
                answer: result.answer,
                citations: result.citations || [],
                retrieval: {
                    ...(result.retrieval || {}),
                    chunksRetrieved: chunks.length,
                    chunks: chunks.map(formatChunkResponse),
                },
                paper: readyPapers[0],
                papers: readyPapers,
                isMultiPaper,
                isCrossPaper: isCompareMode,
                model: MODEL_NAME,
            });
        }

        // Entire Library search mode
        if (library || !paperId) {
            const chunks = await retrieveLibraryChunks(normalizedQuestion, targetTopK * 2);
            if (!chunks.length) {
                return res.json({
                    answer: "No relevant evidence was found across your paper library.",
                    citations: [],
                    retrieval: { chunksRetrieved: 0 },
                    model: MODEL_NAME,
                });
            }

            const distinctPaperIds = [...new Set(chunks.map(c => c.paperId))];
            const papersResult = await db.query(
                `SELECT id, title, authors, year FROM papers WHERE id = ANY($1::uuid[])`,
                [distinctPaperIds]
            );

            const result = await generateCrossPaperComparison({
                papers: papersResult.rows,
                question: normalizedQuestion,
                chunks,
            });

            return res.json({
                answer: result.answer,
                citations: result.citations || [],
                retrieval: {
                    ...(result.retrieval || {}),
                    chunksRetrieved: chunks.length,
                    chunks: chunks.map(formatChunkResponse),
                },
                papers: papersResult.rows,
                isMultiPaper: true,
                model: MODEL_NAME,
            });
        }
    } catch (error) {
        console.error("RAG chat route error:", error);
        return res.status(500).json({
            error: error.message || "The research query could not be completed.",
        });
    }
}

router.post("/", handleChat);

// Dedicated cross-paper comparison endpoint
router.post("/compare", async (req, res) => {
    const { paperIds, question } = req.body ?? {};

    if (!Array.isArray(paperIds) || paperIds.length < 2) {
        return res.status(400).json({
            error: "At least two paperIds are required for cross-paper comparison.",
        });
    }

    req.body.compare = true;
    return handleChat(req, res);
});

function formatChunkResponse(chunk, index) {
    const citationId = chunk.citationId || (Number.isInteger(index) ? `C${index + 1}` : null);
    const content = String(chunk.content || "");
    const snippet = chunk.snippet || chunk.evidenceSnippet || content.slice(0, 650);

    return {
        id: chunk.id,
        citationId,
        paperId: chunk.paperId || chunk.paper_id,
        paperTitle: chunk.paperTitle || chunk.title || "Unknown Paper",
        chunkIndex: chunk.chunkIndex ?? chunk.chunk_index,
        pageNumber: chunk.pageNumber ?? chunk.page_number,
        contentType: chunk.contentType || chunk.content_type || "body",
        sectionTitle: chunk.sectionTitle || chunk.section_title || null,
        sectionPath: chunk.sectionPath || chunk.section_path || [],
        similarity: chunk.similarity != null ? Number(chunk.similarity) : null,
        retrievalScore: chunk.retrievalScore != null ? Number(chunk.retrievalScore) : null,
        content,
        snippet,
        preview: snippet,
    };
}

export default router;
