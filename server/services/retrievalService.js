import pgvector from "pgvector/pg";
import { db } from "../config/database.js";
import { embedText } from "./embeddingService.js";

const DEFAULT_TOP_K = positiveInteger(process.env.RAG_TOP_K, 6);
const CANDIDATE_K = positiveInteger(process.env.RAG_CANDIDATE_K, 40);
const MAX_PER_PAGE = positiveInteger(process.env.RAG_MAX_CHUNKS_PER_PAGE, 3);
const MAX_QUERY_TERMS = 12;

const DEFAULT_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than",
  "to", "of", "in", "on", "at", "by", "for", "from", "with",
  "is", "are", "was", "were", "be", "been", "being", "it",
  "its", "this", "that", "these", "those", "as", "into", "about",
  "can", "could", "would", "should", "may", "might", "do", "does",
  "did", "how", "what", "which", "who", "when", "where", "why",
  "explain", "describe", "discuss", "paper", "study", "research",
]);

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

function getQueryTerms(question) {
  const terms = tokenize(question)
    .filter((term) => term.length >= 3 && !DEFAULT_STOPWORDS.has(term));

  return [...new Set(terms)].slice(0, MAX_QUERY_TERMS);
}

function isReferenceQuery(question) {
  return /\b(references?|bibliography|cited|citations?|sources?|works?\s*cited)\b/i.test(question);
}

function isReferenceChunk(chunk) {
  if (chunk.isReference === true || chunk.is_reference === true) {
    return true;
  }

  const type = normalizeText(chunk.contentType ?? chunk.content_type).toLowerCase();
  if (type === "reference" || type === "bibliography") {
    return true;
  }

  const path = Array.isArray(chunk.sectionPath ?? chunk.section_path)
    ? (chunk.sectionPath ?? chunk.section_path).join(" ")
    : String(chunk.sectionPath ?? chunk.section_path ?? "");

  const section = `${path} ${chunk.sectionTitle ?? chunk.section_title ?? ""}`;
  return /\b(references|bibliography|works cited|reference list)\b/i.test(section);
}

function getChunkText(chunk) {
  return normalizeText(chunk.content);
}

function getChunkSection(chunk) {
  const path = chunk.sectionPath ?? chunk.section_path;
  if (Array.isArray(path)) {
    return path.map(normalizeText).filter(Boolean).join(" > ");
  }
  return normalizeText(path);
}

function toNumber(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function lexicalScore(content, terms) {
  if (!terms.length) return 0;
  const tokens = tokenize(content);
  if (!tokens.length) return 0;

  const tokenSet = new Set(tokens);
  let matched = 0;

  for (const term of terms) {
    if (tokenSet.has(term)) {
      matched += 1;
      continue;
    }
    if (tokens.some((token) => token.includes(term))) {
      matched += 0.5;
    }
  }

  return Math.min(1, matched / terms.length);
}

function contentQuality(content) {
  const tokens = tokenize(content).length;
  if (tokens < 12) return 0.1;
  if (tokens < 30) return 0.4;
  if (tokens < 60) return 0.7;
  return 1;
}

function getPageNumber(chunk) {
  const page = chunk.pageNumber ?? chunk.page_number;
  return page == null ? null : Number(page);
}

function getChunkIndex(chunk) {
  return toNumber(chunk.chunkIndex ?? chunk.chunk_index, -1);
}

export function extractEvidenceSnippet(content, terms = [], maxLength = 650) {
  const text = normalizeText(content);
  if (!text || text.length <= maxLength) return text;

  // Split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+|\S+$/g) || [text];
  let bestSentenceIndex = 0;
  let bestScore = -1;

  const termSet = new Set(terms.map((t) => t.toLowerCase()));

  sentences.forEach((sentence, idx) => {
    const sTokens = tokenize(sentence);
    let matches = 0;
    for (const tok of sTokens) {
      if (termSet.has(tok)) matches++;
    }
    const score = matches * 10 + (sTokens.length >= 8 && sTokens.length <= 40 ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestSentenceIndex = idx;
    }
  });

  // Center snippet around the best sentence
  let snippet = sentences[bestSentenceIndex].trim();
  let prevIdx = bestSentenceIndex - 1;
  let nextIdx = bestSentenceIndex + 1;

  while (snippet.length < maxLength && (prevIdx >= 0 || nextIdx < sentences.length)) {
    if (nextIdx < sentences.length && (snippet.length + sentences[nextIdx].length + 1 <= maxLength)) {
      snippet = `${snippet} ${sentences[nextIdx].trim()}`;
      nextIdx++;
    } else if (prevIdx >= 0 && (snippet.length + sentences[prevIdx].length + 1 <= maxLength)) {
      snippet = `${sentences[prevIdx].trim()} ${snippet}`;
      prevIdx--;
    } else {
      break;
    }
  }

  if (snippet.length > maxLength) {
    const lastSpace = snippet.lastIndexOf(" ", maxLength - 3);
    const cutIndex = lastSpace > Math.floor(maxLength * 0.7) ? lastSpace : maxLength - 3;
    snippet = `${snippet.slice(0, cutIndex).trim()}...`;
  }
  if (prevIdx >= 0 && !snippet.startsWith("...")) {
    snippet = `...${snippet}`;
  }
  if (nextIdx < sentences.length && !snippet.endsWith("...")) {
    snippet = `${snippet}...`;
  }

  return snippet;
}

function fingerprint(content) {
  return tokenize(content).sort().join(" ");
}

function deduplicate(candidates) {
  const seenIds = new Set();
  const seenFingerprints = new Set();
  const result = [];

  for (const candidate of candidates) {
    const id = candidate.id == null ? null : String(candidate.id);
    const key = fingerprint(getChunkText(candidate));

    if (!key) continue;
    if (id && seenIds.has(id)) continue;
    if (seenFingerprints.has(key)) continue;

    if (id) seenIds.add(id);
    seenFingerprints.add(key);
    result.push(candidate);
  }

  return result;
}

function rankCandidates(candidates, question, queryTerms) {
  const queryTokens = new Set(tokenize(question));
  const allowReferences = isReferenceQuery(question);

  return candidates
    .filter((chunk) => allowReferences || !isReferenceChunk(chunk))
    .map((chunk) => {
      const content = getChunkText(chunk);
      const distance = toNumber(chunk.cosineDistance, 1);
      const similarity = Math.max(0, Math.min(1, 1 - distance));

      const lexical = lexicalScore(content, queryTerms);
      const quality = contentQuality(content);

      const sectionText = normalizeText(
        `${chunk.sectionTitle ?? chunk.section_title ?? ""} ${getChunkSection(chunk)}`
      );
      const sectionTerms = tokenize(sectionText);
      const sectionMatch = sectionTerms.some((term) => queryTokens.has(term)) ? 1 : 0;

      // Bonus for structured tables or figures when asking about results/models/data
      const type = chunk.contentType ?? chunk.content_type ?? "body";
      let typeBonus = 0;
      if (type === "table" && /\b(table|results?|accuracy|map|fps|precision|recall|parameters|flops|comparison|metric|percentage|%)\b/i.test(question)) {
        typeBonus = 0.15;
      } else if (type === "figure" && /\b(figure|diagram|workflow|architecture|model|scene)\b/i.test(question)) {
        typeBonus = 0.10;
      }

      const retrievalScore = Math.min(
        1,
        similarity * 0.50 +
        lexical * 0.25 +
        quality * 0.10 +
        sectionMatch * 0.05 +
        typeBonus
      );

      const pageNumber = getPageNumber(chunk);
      const chunkIndex = getChunkIndex(chunk);
      const paperId = chunk.paperId ?? chunk.paper_id;
      const paperTitle = chunk.paperTitle ?? chunk.title ?? "Unknown";
      const sectionTitle = chunk.sectionTitle ?? chunk.section_title ?? null;
      const sectionPath = chunk.sectionPath ?? chunk.section_path ?? [];
      const sectionLevel = chunk.sectionLevel ?? chunk.section_level ?? null;
      const readingOrder = chunk.readingOrder ?? chunk.reading_order ?? null;
      const snippet = extractEvidenceSnippet(content, queryTerms, 650);

      return {
        id: chunk.id,
        // Provide both camelCase and snake_case for complete compatibility
        paperId,
        paper_id: paperId,
        paperTitle,
        title: paperTitle,
        chunkIndex,
        chunk_index: chunkIndex,
        pageNumber,
        page_number: pageNumber,
        content,
        contentType: type,
        content_type: type,
        sectionTitle,
        section_title: sectionTitle,
        sectionPath,
        section_path: sectionPath,
        sectionLevel,
        section_level: sectionLevel,
        readingOrder,
        reading_order: readingOrder,
        isReference: Boolean(chunk.isReference || chunk.is_reference),
        is_reference: Boolean(chunk.isReference || chunk.is_reference),
        similarity: Number(similarity.toFixed(4)),
        lexicalScore: Number(lexical.toFixed(4)),
        retrievalScore: Number(retrievalScore.toFixed(4)),
        retrieval_score: Number(retrievalScore.toFixed(4)),
        snippet,
        evidenceSnippet: snippet,
      };
    })
    .sort((a, b) => b.retrievalScore - a.retrievalScore);
}

function diversify(candidates, topK, isMultiPaper = false, targetPaperIds = null) {
  const selected = [];
  const selectedIds = new Set();
  const pageCounts = new Map();
  const paperCounts = new Map();

  const normalizedTargetIds = Array.isArray(targetPaperIds) && targetPaperIds.length > 1
    ? targetPaperIds.map(id => String(id).toLowerCase().trim()).filter(Boolean)
    : [];

  // Multi-paper fair representation: ensure each specified paper with candidates gets representation
  if (isMultiPaper && normalizedTargetIds.length > 1) {
    const quotaPerPaper = Math.max(1, Math.min(3, Math.floor(topK / normalizedTargetIds.length)));

    for (const pidStr of normalizedTargetIds) {
      const paperCandidates = candidates.filter(c =>
        String(c.paperId || c.paper_id || "").toLowerCase().trim() === pidStr
      );

      for (const candidate of paperCandidates) {
        if ((paperCounts.get(pidStr) || 0) >= quotaPerPaper) break;
        if (selectedIds.has(String(candidate.id))) continue;

        selected.push(candidate);
        selectedIds.add(String(candidate.id));
        const pageKey = `${pidStr}:${candidate.pageNumber == null ? `u:${candidate.id}` : candidate.pageNumber}`;
        pageCounts.set(pageKey, (pageCounts.get(pageKey) || 0) + 1);
        paperCounts.set(pidStr, (paperCounts.get(pidStr) || 0) + 1);
      }
    }
  }

  // Now fill remaining slots with highest scoring candidates while respecting diversity
  for (const candidate of candidates) {
    if (selected.length >= topK) break;
    if (selectedIds.has(String(candidate.id))) continue;

    const paperKey = String(candidate.paperId || candidate.paper_id || "").toLowerCase().trim();
    const page = candidate.pageNumber;
    const pageKey = `${paperKey}:${page == null ? `u:${candidate.id}` : page}`;
    const countOnPage = pageCounts.get(pageKey) ?? 0;

    const countOnPaper = paperCounts.get(paperKey) ?? 0;
    const maxPerPaper = isMultiPaper ? Math.max(2, Math.ceil(topK / 2)) : topK;

    if (countOnPage < MAX_PER_PAGE && (!isMultiPaper || countOnPaper < maxPerPaper)) {
      selected.push(candidate);
      selectedIds.add(String(candidate.id));
      pageCounts.set(pageKey, countOnPage + 1);
      paperCounts.set(paperKey, countOnPaper + 1);
    }
  }

  // Fallback to fill up to topK if needed
  if (selected.length < topK) {
    for (const candidate of candidates) {
      if (selected.length >= topK) break;
      if (!selectedIds.has(String(candidate.id))) {
        selected.push(candidate);
        selectedIds.add(String(candidate.id));
      }
    }
  }

  return selected.slice(0, topK);
}

async function fetchSemanticCandidates({ paperId, paperIds, vector, limit }) {
  const values = [pgvector.toSql(vector)];

  // Partitioned multi-paper retrieval ensures every selected paper gets candidates into the pool
  if (Array.isArray(paperIds) && paperIds.length > 1) {
    values.push(paperIds);
    const perPaperLimit = Math.max(10, Math.ceil(limit / paperIds.length));
    values.push(perPaperLimit);
    values.push(limit);

    const result = await db.query(
      `
        WITH ranked_candidates AS (
          SELECT
            pc.id,
            pc.paper_id AS "paperId",
            pc.paper_id,
            pc.chunk_index AS "chunkIndex",
            pc.chunk_index,
            pc.page_number AS "pageNumber",
            pc.page_number,
            pc.content,
            pc.content_type AS "contentType",
            pc.content_type,
            pc.is_reference AS "isReference",
            pc.is_reference,
            pc.section_title AS "sectionTitle",
            pc.section_title,
            pc.section_path AS "sectionPath",
            pc.section_path,
            pc.section_level AS "sectionLevel",
            pc.section_level,
            pc.reading_order AS "readingOrder",
            pc.reading_order,
            p.title AS "paperTitle",
            p.title,
            (pc.embedding <=> $1::vector) AS "cosineDistance",
            ROW_NUMBER() OVER (
              PARTITION BY pc.paper_id
              ORDER BY pc.embedding <=> $1::vector
            ) AS paper_rank
          FROM paper_chunks pc
          JOIN papers p ON p.id = pc.paper_id
          WHERE pc.embedding IS NOT NULL
            AND p.processing_status = 'completed'
            AND pc.paper_id = ANY($2::uuid[])
        )
        SELECT *
        FROM ranked_candidates
        WHERE paper_rank <= $3
        ORDER BY "cosineDistance"
        LIMIT $4
      `,
      values
    );

    return result.rows;
  }

  let paperFilter = "";

  if (Array.isArray(paperIds) && paperIds.length > 0) {
    values.push(paperIds);
    paperFilter = `AND pc.paper_id = ANY($${values.length}::uuid[])`;
  } else if (paperId) {
    values.push(paperId);
    paperFilter = `AND pc.paper_id = $${values.length}`;
  }

  values.push(limit);
  const limitParameter = values.length;

  const result = await db.query(
    `
      SELECT
        pc.id,
        pc.paper_id AS "paperId",
        pc.paper_id,
        pc.chunk_index AS "chunkIndex",
        pc.chunk_index,
        pc.page_number AS "pageNumber",
        pc.page_number,
        pc.content,
        pc.content_type AS "contentType",
        pc.content_type,
        pc.is_reference AS "isReference",
        pc.is_reference,
        pc.section_title AS "sectionTitle",
        pc.section_title,
        pc.section_path AS "sectionPath",
        pc.section_path,
        pc.section_level AS "sectionLevel",
        pc.section_level,
        pc.reading_order AS "readingOrder",
        pc.reading_order,
        p.title AS "paperTitle",
        p.title,
        (pc.embedding <=> $1::vector) AS "cosineDistance"
      FROM paper_chunks pc
      JOIN papers p ON p.id = pc.paper_id
      WHERE pc.embedding IS NOT NULL
        AND p.processing_status = 'completed'
        ${paperFilter}
      ORDER BY pc.embedding <=> $1::vector
      LIMIT $${limitParameter}
    `,
    values
  );

  return result.rows;
}

async function fetchKeywordCandidates({ paperId, paperIds, terms, limit }) {
  if (!terms.length) return [];

  const values = [terms.map((term) => `%${term}%`)];

  if (Array.isArray(paperIds) && paperIds.length > 1) {
    values.push(paperIds);
    const perPaperLimit = Math.max(10, Math.ceil(limit / paperIds.length));
    values.push(perPaperLimit);
    values.push(limit);

    const result = await db.query(
      `
        WITH ranked_keywords AS (
          SELECT
            pc.id,
            pc.paper_id AS "paperId",
            pc.paper_id,
            pc.chunk_index AS "chunkIndex",
            pc.chunk_index,
            pc.page_number AS "pageNumber",
            pc.page_number,
            pc.content,
            pc.content_type AS "contentType",
            pc.content_type,
            pc.is_reference AS "isReference",
            pc.is_reference,
            pc.section_title AS "sectionTitle",
            pc.section_title,
            pc.section_path AS "sectionPath",
            pc.section_path,
            pc.section_level AS "sectionLevel",
            pc.section_level,
            pc.reading_order AS "readingOrder",
            pc.reading_order,
            p.title AS "paperTitle",
            p.title,
            NULL::double precision AS "cosineDistance",
            ROW_NUMBER() OVER (
              PARTITION BY pc.paper_id
              ORDER BY
                CASE
                  WHEN pc.section_title ILIKE ANY($1::text[]) THEN 0
                  ELSE 1
                END,
                pc.page_number NULLS LAST,
                pc.chunk_index
            ) AS paper_rank
          FROM paper_chunks pc
          JOIN papers p ON p.id = pc.paper_id
          WHERE p.processing_status = 'completed'
            AND pc.paper_id = ANY($2::uuid[])
            AND (
              pc.content ILIKE ANY($1::text[])
              OR pc.section_title ILIKE ANY($1::text[])
            )
        )
        SELECT *
        FROM ranked_keywords
        WHERE paper_rank <= $3
        LIMIT $4
      `,
      values
    );

    return result.rows;
  }

  let paperFilter = "";

  if (Array.isArray(paperIds) && paperIds.length > 0) {
    values.push(paperIds);
    paperFilter = `AND pc.paper_id = ANY($${values.length}::uuid[])`;
  } else if (paperId) {
    values.push(paperId);
    paperFilter = `AND pc.paper_id = $${values.length}`;
  }

  values.push(limit);
  const limitParameter = values.length;

  const result = await db.query(
    `
      SELECT
        pc.id,
        pc.paper_id AS "paperId",
        pc.paper_id,
        pc.chunk_index AS "chunkIndex",
        pc.chunk_index,
        pc.page_number AS "pageNumber",
        pc.page_number,
        pc.content,
        pc.content_type AS "contentType",
        pc.content_type,
        pc.is_reference AS "isReference",
        pc.is_reference,
        pc.section_title AS "sectionTitle",
        pc.section_title,
        pc.section_path AS "sectionPath",
        pc.section_path,
        pc.section_level AS "sectionLevel",
        pc.section_level,
        pc.reading_order AS "readingOrder",
        pc.reading_order,
        p.title AS "paperTitle",
        p.title,
        NULL::double precision AS "cosineDistance"
      FROM paper_chunks pc
      JOIN papers p ON p.id = pc.paper_id
      WHERE p.processing_status = 'completed'
        ${paperFilter}
        AND (
          pc.content ILIKE ANY($1::text[])
          OR pc.section_title ILIKE ANY($1::text[])
        )
      ORDER BY
        CASE
          WHEN pc.section_title ILIKE ANY($1::text[]) THEN 0
          ELSE 1
        END,
        pc.page_number NULLS LAST,
        pc.chunk_index
      LIMIT $${limitParameter}
    `,
    values
  );

  return result.rows;
}

function mergeCandidates(semanticRows, keywordRows) {
  const byId = new Map();

  for (const row of [...semanticRows, ...keywordRows]) {
    const key = String(row.id);
    const existing = byId.get(key);

    if (!existing) {
      byId.set(key, row);
      continue;
    }

    if (existing.cosineDistance == null && row.cosineDistance != null) {
      byId.set(key, row);
    }
  }

  return [...byId.values()];
}

async function retrieve({ paperId = null, paperIds = null, question, topK }) {
  const normalizedQuestion = normalizeText(question);
  if (!normalizedQuestion) {
    throw new Error("A retrieval question is required.");
  }

  const requestedTopK = positiveInteger(topK, DEFAULT_TOP_K);
  const terms = getQueryTerms(normalizedQuestion);
  const vector = await embedText(normalizedQuestion);

  const isMulti = (Array.isArray(paperIds) && paperIds.length > 1) || (!paperId && !paperIds);

  const [semanticRows, keywordRows] = await Promise.all([
    fetchSemanticCandidates({
      paperId,
      paperIds,
      vector,
      limit: Math.max(CANDIDATE_K, requestedTopK * 3),
    }),
    fetchKeywordCandidates({
      paperId,
      paperIds,
      terms,
      limit: Math.max(CANDIDATE_K, requestedTopK * 3),
    }),
  ]);

  const merged = mergeCandidates(semanticRows, keywordRows);
  const unique = deduplicate(merged);

  const ranked = rankCandidates(
    unique.map((chunk) => ({
      ...chunk,
      cosineDistance: chunk.cosineDistance == null ? 1 : chunk.cosineDistance,
    })),
    normalizedQuestion,
    terms
  );

  const selected = diversify(
    ranked,
    requestedTopK,
    isMulti,
    isMulti && Array.isArray(paperIds) ? paperIds : null
  );

  // Assign stable, sequential citation IDs per retrieved chunk (e.g., C1, C2...)
  selected.forEach((chunk, index) => {
    chunk.citationId = `C${index + 1}`;
  });

  return selected;
}

export async function retrievePaperChunks(paperId, question, topK = DEFAULT_TOP_K) {
  if (!paperId) {
    throw new Error("paperId is required for paper-specific retrieval.");
  }
  return retrieve({ paperId, question, topK });
}

export async function retrieveMultiPaperChunks({ paperIds, question, topK = DEFAULT_TOP_K }) {
  if (!Array.isArray(paperIds) || !paperIds.length) {
    throw new Error("An array of paperIds is required for multi-paper retrieval.");
  }
  return retrieve({ paperIds, question, topK });
}

export async function retrieveLibraryChunks(question, topK = DEFAULT_TOP_K) {
  return retrieve({ question, topK });
}

export default {
  retrieve,
  retrievePaperChunks,
  retrieveMultiPaperChunks,
  retrieveLibraryChunks,
};
