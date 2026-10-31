
import pgvector from "pgvector/pg";
import { db } from "../config/database.js";

import {
    embedTexts,
    EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
} from "./embeddingService.js";

import { createPageAwareChunks } from "./chunkService.js";

const EMBEDDING_BATCH_SIZE = 16;
const ADVISORY_LOCK_NAMESPACE = 724193;

function advisoryLockKey(value) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash | 0;
}

function validateEmbedding(vector, index) {
    if (
        (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) ||
        vector.length !== EMBEDDING_DIMENSIONS
    ) {
        throw new Error(
            `Embedding ${index} must contain exactly ${EMBEDDING_DIMENSIONS} dimensions.`
        );
    }

    const normalized = Array.from(vector);

    if (!normalized.every(Number.isFinite)) {
        throw new Error(`Embedding ${index} contains a non-finite value.`);
    }

    return normalized;
}

function validateChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        throw new Error("No usable chunks were created.");
    }

    const seenIndices = new Set();

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        if (!chunk || typeof chunk.content !== "string" || !chunk.content.trim()) {
            throw new Error(`Chunk ${i} has empty or invalid content.`);
        }

        if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) {
            throw new Error(`Chunk ${i} has an invalid chunkIndex.`);
        }

        if (seenIndices.has(chunk.chunkIndex)) {
            throw new Error(`Duplicate chunkIndex: ${chunk.chunkIndex}.`);
        }

        seenIndices.add(chunk.chunkIndex);

        if (
            chunk.pageNumber != null &&
            (!Number.isInteger(chunk.pageNumber) || chunk.pageNumber < 1)
        ) {
            throw new Error(`Chunk ${i} has an invalid page number.`);
        }
    }

    return chunks;
}

async function markInitialIndexFailure(paperId, error) {
    // Only mark a paper failed when it has no existing index.
    // A failed reindex must not invalidate a previously completed index.
    try {
        await db.query(
            `UPDATE papers
             SET processing_status = 'failed'
             WHERE id = $1
               AND COALESCE(chunk_count, 0) = 0
               AND processing_status <> 'completed'`,
            [paperId]
        );
    } catch (statusError) {
        console.error(
            `Could not mark initial indexing failure for paper ${paperId}:`,
            statusError
        );
    }

    console.error(`Indexing failed for paper ${paperId}:`, error);
}

export async function indexPaper(paperId, pages) {
    if (typeof paperId !== "string" || !paperId.trim()) {
        throw new Error("paperId is required.");
    }

    if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error("Page-aware PDF content is required.");
    }

    const normalizedPaperId = paperId.trim();

    const chunks = validateChunks(
        createPageAwareChunks(pages).filter(
            chunk =>
                chunk &&
                typeof chunk.content === "string" &&
                chunk.content.trim().length > 0
        )
    );

    const lockKey = advisoryLockKey(normalizedPaperId);
    let client;
    let lockAcquired = false;

    try {
        // Acquire a session-level lock to serialize indexing of this paper.
        client = await db.connect();

        await client.query(
            "SELECT pg_advisory_lock($1, $2)",
            [ADVISORY_LOCK_NAMESPACE, lockKey]
        );
        lockAcquired = true;

        const paperResult = await client.query(
            `SELECT id, processing_status, chunk_count
             FROM papers
             WHERE id = $1`,
            [normalizedPaperId]
        );

        if (paperResult.rowCount === 0) {
            throw new Error(`Paper not found: ${normalizedPaperId}`);
        }

        const previousPaper = paperResult.rows[0];
        const hadExistingIndex =
            previousPaper.processing_status === "completed" &&
            Number(previousPaper.chunk_count) > 0;

        // Generate embeddings before touching the existing index.
        // The same batch position must always correspond to the same chunk.
        const embeddings = [];

        for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
            const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
            const vectors = await embedTexts(batch.map(chunk => chunk.content));

            if (!Array.isArray(vectors) || vectors.length !== batch.length) {
                throw new Error(
                    `Embedding count mismatch: expected ${batch.length}, received ${vectors?.length ?? 0}.`
                );
            }

            vectors.forEach((vector, offset) => {
                embeddings.push(validateEmbedding(vector, start + offset));
            });

            console.log(
                `Embedded ${Math.min(start + batch.length, chunks.length)}/${chunks.length} chunks for paper ${normalizedPaperId}`
            );
        }

        if (embeddings.length !== chunks.length) {
            throw new Error("Final embedding count does not match chunk count.");
        }

        await client.query("BEGIN");

        try {
            const lockedPaper = await client.query(
                `SELECT id
                 FROM papers
                 WHERE id = $1
                 FOR UPDATE`,
                [normalizedPaperId]
            );

            if (lockedPaper.rowCount === 0) {
                throw new Error(`Paper not found: ${normalizedPaperId}`);
            }

            await client.query(
                "DELETE FROM paper_chunks WHERE paper_id = $1",
                [normalizedPaperId]
            );

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];

                await client.query(
                    `INSERT INTO paper_chunks (
                        paper_id,
                        chunk_index,
                        page_number,
                        content,
                        embedding,
                        content_type,
                        is_reference,
                        section_title,
                        section_path,
                        section_level,
                        reading_order
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
                    )`,
                    [
                        normalizedPaperId,
                        chunk.chunkIndex,
                        chunk.pageNumber ?? null,
                        chunk.content.replace(/\u0000/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim(),
                        pgvector.toSql(embeddings[i]),
                        chunk.contentType || "body",
                        Boolean(chunk.isReference),
                        chunk.sectionTitle ? chunk.sectionTitle.replace(/\u0000/g, "") : null,
                        Array.isArray(chunk.sectionPath) ? chunk.sectionPath.map(s => String(s).replace(/\u0000/g, "")) : [],
                        chunk.sectionLevel ?? null,
                        chunk.readingOrder ?? null,
                    ]
                );
            }

            const update = await client.query(
                `UPDATE papers
                 SET processing_status = 'completed',
                     chunk_count = $1,
                     embedding_model = $2,
                     processed_at = NOW()
                 WHERE id = $3`,
                [chunks.length, EMBEDDING_MODEL, normalizedPaperId]
            );

            if (update.rowCount !== 1) {
                throw new Error("Could not update indexing metadata.");
            }

            await client.query("COMMIT");
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Indexing rollback failed:", rollbackError);
            }

            throw error;
        }

        return {
            paperId: normalizedPaperId,
            chunksIndexed: chunks.length,
            embeddingModel: EMBEDDING_MODEL,
            status: "completed",
        };
    } catch (error) {
        // A failed initial indexing attempt should not remain indefinitely
        // in "processing". Keep a previously completed index intact.
        if (!client) {
            await markInitialIndexFailure(normalizedPaperId, error);
        } else {
            try {
                const current = await client.query(
                    `SELECT processing_status, chunk_count
                     FROM papers
                     WHERE id = $1`,
                    [normalizedPaperId]
                );

                if (
                    current.rowCount > 0 &&
                    Number(current.rows[0].chunk_count) === 0 &&
                    current.rows[0].processing_status !== "completed"
                ) {
                    await markInitialIndexFailure(normalizedPaperId, error);
                }
            } catch (statusError) {
                console.error("Could not inspect indexing state:", statusError);
            }
        }

        throw error;
    } finally {
        if (client) {
            if (lockAcquired) {
                try {
                    await client.query(
                        "SELECT pg_advisory_unlock($1, $2)",
                        [ADVISORY_LOCK_NAMESPACE, lockKey]
                    );
                } catch (unlockError) {
                    console.error("Could not release indexing lock:", unlockError);
                }
            }

            client.release();
        }
    }
}
