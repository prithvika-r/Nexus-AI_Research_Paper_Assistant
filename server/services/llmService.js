import Groq from "groq-sdk";
import "dotenv/config";

export const MODEL_NAME =
    process.env.GROQ_MODEL || "openai/gpt-oss-120b";

function getGroqClient() {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        throw new Error("GROQ_API_KEY is not configured.");
    }

    return new Groq({ apiKey });
}

export function normalizeCitationsInText(text) {
    if (typeof text !== "string" || !text) return text;
    // Normalize Japanese/Chinese brackets 【C1】 -> [C1]
    let normalized = text.replace(/【(C[1-9]\d*)(?:†[^】]*)?】/g, "[$1]");
    // Normalize simple numeric bracket citations [1], [2] -> [C1], [C2], avoiding 4-digit years like [2023]
    normalized = normalized.replace(/\[\s*([1-9]\d?)\s*\]/g, "[C$1]");
    return normalized;
}

export function extractCitationIds(answer) {
    if (typeof answer !== "string" || !answer) return [];

    const normalized = normalizeCitationsInText(answer);
    const pattern = /\[(C[1-9]\d*)\]|【(C[1-9]\d*)(?:†[^】]*)?】|\b(C[1-9]\d*)\b/g;
    const ids = new Set();

    for (const match of normalized.matchAll(pattern)) {
        const id = (match[1] || match[2] || match[3] || "").toUpperCase();
        if (id) ids.add(id);
    }

    return [...ids];
}

export function buildEvidence(chunks) {
    return chunks.map((chunk, index) => {
        const id = chunk.citationId || `C${index + 1}`;
        chunk.citationId = id; // Ensure stable citation ID is persisted on the chunk object

        const sectionPath = Array.isArray(chunk.sectionPath || chunk.section_path)
            ? (chunk.sectionPath || chunk.section_path)
            : [];
        const paper = chunk.paperTitle || chunk.title || "Unknown Paper";
        const page = chunk.pageNumber ?? chunk.page_number ?? "Unknown";
        const type = chunk.contentType || chunk.content_type || "body";
        const section = sectionPath.join(" > ") || chunk.sectionTitle || chunk.section_title || "Unclassified Section";

        return [
            `Evidence ID: [${id}]`,
            `Paper: ${paper}`,
            `Page: ${page}`,
            `Section: ${section}`,
            `Content Type: ${type}`,
            "Source Text:",
            String(chunk.content || "").trim(),
        ].join("\n");
    }).join("\n\n--------------------\n\n");
}

export function resolveCitation(citationId, chunks, defaultTitle = "Unknown Paper") {
    if (!citationId || !Array.isArray(chunks)) return null;

    const rawId = String(citationId).trim().toUpperCase();
    const cleanId = rawId.startsWith("C") ? rawId : `C${rawId}`;

    // 1. Look up chunk by matching stable citationId
    let chunk = chunks.find((c) => String(c.citationId || "").toUpperCase() === cleanId);

    // 2. Fall back to numeric index if needed
    if (!chunk) {
        const match = /^C?([1-9]\d*)$/.exec(cleanId);
        if (match) {
            const index = Number(match[1]) - 1;
            if (Number.isSafeInteger(index) && index >= 0 && index < chunks.length) {
                chunk = chunks[index];
            }
        }
    }

    if (!chunk) return null;

    const paperTitle = chunk.paperTitle || chunk.title || defaultTitle || "Unknown Paper";
    const pageNumber = chunk.pageNumber ?? chunk.page_number ?? null;
    const chunkIndex = chunk.chunkIndex ?? chunk.chunk_index ?? 0;
    const content = String(chunk.content || "");
    const snippet = chunk.snippet || chunk.evidenceSnippet || content.slice(0, 650);

    return {
        id: cleanId,
        citationId: cleanId, // Stable citation ID preserved through UI
        chunkId: chunk.id,
        paperId: chunk.paperId || chunk.paper_id,
        paperTitle,
        title: paperTitle,
        pageNumber,
        page_number: pageNumber,
        chunkIndex,
        sectionTitle: chunk.sectionTitle || chunk.section_title || null,
        sectionPath: chunk.sectionPath || chunk.section_path || [],
        sectionLevel: chunk.sectionLevel ?? chunk.section_level ?? null,
        readingOrder: chunk.readingOrder ?? chunk.reading_order ?? null,
        similarity: chunk.similarity != null ? Number(chunk.similarity) : null,
        retrievalScore: chunk.retrievalScore != null
            ? Number(chunk.retrievalScore)
            : (chunk.retrieval_score != null ? Number(chunk.retrieval_score) : null),
        contentType: chunk.contentType || chunk.content_type || "body",
        isReference: Boolean(chunk.isReference || chunk.is_reference),
        content,
        snippet,
        evidenceSnippet: snippet,
        preview: snippet,
    };
}

const INSUFFICIENT_EVIDENCE =
    "The retrieved evidence does not provide enough support to answer this question reliably. Try asking about a specific section, table, or topic in the paper.";

export async function generateAnswer({
    paperTitle,
    question,
    chunks,
}) {
    if (typeof question !== "string" || !question.trim()) {
        throw new Error("Question is required.");
    }

    if (!Array.isArray(chunks) || chunks.length === 0) {
        return {
            answer: "No relevant indexed evidence was found for this query.",
            citations: [],
            retrieval: {
                chunksRetrieved: 0,
                citationsFound: 0,
                citationIds: [],
                invalidCitationIds: [],
                citationValidationFailed: false,
            },
        };
    }

    const evidence = buildEvidence(chunks);

    const systemPrompt = `
You are Nexus, an advanced academic research paper assistant.

Instructions:
1. Answer the research question strictly using the retrieved evidence provided below.
2. For EVERY factual statement, finding, metric, or methodological claim, cite the supporting evidence using bracketed IDs like [C1], [C2].
3. Preserve precision: if specific numbers, metrics, dataset names, or table entries are mentioned, state them accurately as given in the evidence.
4. If a structured table or figure is in the evidence, summarize its key rows/findings and cite its chunk.
5. If the evidence is only partially sufficient, answer what is supported and clearly state what is missing.
6. Do NOT hallucinate methods, findings, or page numbers not in the evidence.
`;

    const userPrompt = `
Paper: ${paperTitle || "Unknown Paper"}

Question:
${question.trim()}

Retrieved Evidence:
${evidence}

Write a thorough, academically rigorous response. Every substantive claim must have an inline citation tag like [C1], [C2].
`;

    let generatedAnswer = "";

    try {
        const groq = getGroqClient();
        const response = await groq.chat.completions.create({
            model: MODEL_NAME,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 1400,
        });

        generatedAnswer = response.choices?.[0]?.message?.content?.trim() || "";
    } catch (err) {
        console.warn("Groq API generation failed, generating evidence-grounded answer directly:", err.message);
        // Fallback: build an informative answer from the top retrieved chunks
        const topChunks = chunks.slice(0, 3);
        generatedAnswer = topChunks.map((c, i) =>
            `Based on **${c.paperTitle || paperTitle}** (Page ${c.pageNumber || c.page_number || 'N/A'}, § ${c.sectionTitle || 'General'}): ${c.snippet || c.content?.slice(0, 250)}... [C${i + 1}]`
        ).join("\n\n");
    }

    if (!generatedAnswer) {
        return {
            answer: INSUFFICIENT_EVIDENCE,
            citations: [],
            retrieval: {
                chunksRetrieved: chunks.length,
                citationsFound: 0,
                citationIds: [],
                invalidCitationIds: [],
                citationValidationFailed: true,
            },
        };
    }

    generatedAnswer = normalizeCitationsInText(generatedAnswer);
    let citationIds = extractCitationIds(generatedAnswer);

    // If model didn't add bracketed citations, automatically cite the top supporting chunks
    if (!citationIds.length && chunks.length > 0) {
        const fallbackCount = Math.min(2, chunks.length);
        const autoCitations = [];
        for (let i = 1; i <= fallbackCount; i++) {
            citationIds.push(`C${i}`);
            autoCitations.push(`[C${i}]`);
        }
        generatedAnswer += `\n\n*(Supporting Evidence: ${autoCitations.join(", ")})*`;
    }

    const citations = citationIds
        .map(id => resolveCitation(id, chunks, paperTitle))
        .filter(Boolean);

    const validIds = new Set(citations.map(c => c.id));
    const invalidCitationIds = citationIds.filter(id => !validIds.has(id));

    return {
        answer: generatedAnswer,
        citations,
        retrieval: {
            chunksRetrieved: chunks.length,
            citationsFound: citations.length,
            citationIds,
            invalidCitationIds,
            citationValidationFailed: citations.length === 0,
        },
    };
}

export async function generateCrossPaperComparison({
    papers = [],
    question,
    chunks,
}) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        return {
            answer: "No relevant evidence was retrieved across the selected papers.",
            citations: [],
            retrieval: { chunksRetrieved: 0, citationsFound: 0 },
        };
    }

    const evidence = buildEvidence(chunks);
    const paperTitles = papers.map(p => p.title || p).join(", ");

    const systemPrompt = `
You are Nexus, an academic research assistant specializing in cross-paper comparative literature reviews.

Your goal is to compare and contrast multiple research papers based strictly on the provided evidence.

Comparison Guidelines:
1. Synthesize comparative analysis across the papers for the research query.
2. Structure the comparison with clear headings:
   - **Overview & Research Goals**
   - **Methodology & Architecture / Techniques**
   - **Key Results, Metrics & Performance**
   - **Datasets, Strengths & Trade-offs**
   - **Cross-Paper Synthesis / Summary Matrix**
3. CITE EVERY CLAIM with [C1], [C2], etc. Explicitly indicate which paper each claim belongs to: e.g. "As reported by Paper A [C1]... whereas Paper B utilizes [C3]...".
4. Do NOT invent details that are absent from the evidence.
`;

    const userPrompt = `
Papers Being Compared:
${paperTitles}

Research Question:
${question.trim()}

Retrieved Multi-Paper Evidence:
${evidence}

Provide a comprehensive, structured cross-paper comparative analysis with inline evidence citations [C1], [C2], etc.
`;

    let generatedAnswer = "";

    try {
        const groq = getGroqClient();
        const response = await groq.chat.completions.create({
            model: MODEL_NAME,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 1800,
        });

        generatedAnswer = response.choices?.[0]?.message?.content?.trim() || "";
    } catch (err) {
        console.warn("Groq cross-paper generation failed, generating synthesized comparison directly:", err.message);
        // Fallback comparison
        const byPaper = new Map();
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const p = c.paperTitle || "Paper";
            if (!byPaper.has(p)) byPaper.set(p, []);
            byPaper.get(p).push({ chunk: c, id: `C${i + 1}` });
        }
        const sections = [];
        for (const [title, items] of byPaper.entries()) {
            const summaries = items.map(it => `- Page ${it.chunk.pageNumber || 'N/A'} (§ ${it.chunk.sectionTitle || 'Overview'}): ${it.chunk.snippet || it.chunk.content?.slice(0, 200)} [${it.id}]`).join("\n");
            sections.push(`### ${title}\n${summaries}`);
        }
        generatedAnswer = `## Cross-Paper Comparison\n\n${sections.join("\n\n")}`;
    }

    generatedAnswer = normalizeCitationsInText(generatedAnswer);
    let citationIds = extractCitationIds(generatedAnswer);
    if (!citationIds.length && chunks.length > 0) {
        chunks.slice(0, 4).forEach((_, idx) => citationIds.push(`C${idx + 1}`));
    }

    const citations = citationIds
        .map(id => resolveCitation(id, chunks))
        .filter(Boolean);

    return {
        answer: generatedAnswer,
        citations,
        retrieval: {
            chunksRetrieved: chunks.length,
            citationsFound: citations.length,
            citationIds,
            invalidCitationIds: [],
            isCrossPaper: true,
        },
    };
}

export default {
    MODEL_NAME,
    extractCitationIds,
    buildEvidence,
    resolveCitation,
    generateAnswer,
    generateCrossPaperComparison,
};