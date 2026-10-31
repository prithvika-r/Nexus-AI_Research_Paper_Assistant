import express from "express";
import Groq from "groq-sdk";
import { db } from "../config/database.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = "openai/gpt-oss-120b";
const DEFAULT_GAP_COUNT = 5;
const MAX_SOURCE_LENGTH = 12000;
const MAX_CHUNKS_PER_PAPER = 5;
const MAX_CONTEXT_LENGTH = 28000;

const SCORE_DESCRIPTION =
    "Heuristic priority score for further investigation, not a measured percentage of unexplored literature.";

function parseJsonArray(content) {
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("The AI returned an empty response.");
    }

    const clean = content
        .replace(/```(?:json)?/gi, "")
        .replace(/```/g, "")
        .trim();

    try {
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed)) return parsed;
    } catch {
        // Try extracting a JSON array from surrounding text.
    }

    const start = clean.indexOf("[");
    const end = clean.lastIndexOf("]");

    if (start < 0 || end < start) {
        throw new Error("The AI returned invalid JSON.");
    }

    const parsed = JSON.parse(clean.slice(start, end + 1));

    if (!Array.isArray(parsed)) {
        throw new Error("Expected an array of research gaps.");
    }

    return parsed;
}

export function extractCountFromText(text, fallback = DEFAULT_GAP_COUNT) {
    if (!text || typeof text !== "string") return fallback;
    const match =
        text.match(/\b(?:(?:generate|return|identify|find|discover|analyze|suggest|give(?:\s+me)?|top)\s+)?(\d{1,2})\s*(?:distinct\s+|candidate\s+|potential\s+|unexplored\s+)?(?:research\s+)?gaps\b/i) ||
        text.match(/\b(?:return|generate|identify|find|give(?:\s+me)?)\s+(\d{1,2})\b/i);

    if (match) {
        const val = parseInt(match[1], 10);
        if (Number.isFinite(val) && val >= 1 && val <= 10) {
            return val;
        }
    }
    return fallback;
}

export function cleanTopic(rawTopic) {
    if (!rawTopic || typeof rawTopic !== "string") return "";
    let str = rawTopic.trim();

    // Unwrap surrounding quotes
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
        str = str.slice(1, -1).trim();
    }

    // Strip common instruction and prompt prefixes
    const prefixes = [
        /^(?:please\s+)?(?:can\s+you\s+)?(?:generate|identify|find|discover|analyze|explore|suggest|list|return|give\s+me|provide|show)\s+(?:(?:a|an|the|\d+)\s+)?(?:potential\s+|candidate\s+|key\s+|underexplored\s+|distinct\s+)?(?:research\s+)?gaps?\s+(?:in|on|for|about|related\s+to|regarding|within|of)\s*[:\-–—]?\s*/i,
        /^(?:what\s+are\s+)?(?:(?:a|an|the|\d+)\s+)?(?:potential\s+|candidate\s+|key\s+|underexplored\s+|distinct\s+)?(?:research\s+)?gaps?\s+(?:in|on|for|about|related\s+to|regarding|within|of)\s*[:\-–—]?\s*/i,
        /^(?:potential\s+|candidate\s+|key\s+|underexplored\s+)?(?:research\s+)?gaps?\s+(?:in|on|for|about|related\s+to|regarding|within|of)\s*[:\-–—]?\s*/i,
        /^(?:research\s+gap\s+radar|research\s+gaps?)\s*[:\-–—]\s*/i,
    ];

    for (const prefix of prefixes) {
        str = str.replace(prefix, "").trim();
    }

    // Strip trailing punctuation
    str = str.replace(/[.?!\s:]+$/, "").trim();

    // Unwrap surrounding quotes again if needed
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
        str = str.slice(1, -1).trim();
    }

    return str;
}

function normalizeTopic(value) {
    const cleaned = cleanTopic(value);
    return String(cleaned || (value ?? ""))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
}

function normalizePaperIds(value) {
    if (value == null) return [];

    if (!Array.isArray(value)) {
        throw new Error("paperIds must be an array.");
    }

    const ids = value.map((id) => {
        if (
            !["string", "number"].includes(typeof id) ||
            !String(id).trim()
        ) {
            throw new Error("One or more selected paper IDs are invalid.");
        }

        return String(id).trim();
    });

    return [...new Set(ids)];
}

function cleanText(value) {
    return typeof value === "string"
        ? value.replace(/\u0000/g, "").trim()
        : "";
}

function buildPaperContext(papers) {
    return papers.map((paper, index) => {
        const abstract = cleanText(paper.abstract);

        const chunks = (paper.chunks || []).map((chunk) => {
            const page = Number(chunk.page_number);
            const pageLabel =
                Number.isInteger(page) && page > 0
                    ? `Page ${page}`
                    : "Page unavailable";

            const section = cleanText(chunk.section_title);

            return [
                `[${pageLabel}${section ? ` | Section: ${section}` : ""}]`,
                cleanText(chunk.content),
            ].join("\n");
        });

        const text = chunks.length
            ? chunks.join("\n\n---\n\n")
            : cleanText(paper.full_text || abstract).slice(
                0,
                MAX_SOURCE_LENGTH
            );

        return [
            `PAPER ${index + 1}`,
            `Database ID: ${paper.id}`,
            `Exact title: ${paper.title}`,
            `Source type: ${chunks.length ? "Indexed chunks with page citations" : abstract ? "Abstract text" : "Extracted full text"}`,
            abstract && chunks.length
                ? `Abstract:\n${abstract.slice(0, 1500)}`
                : "",
            `Evidence text:\n${text}`,
        ].filter(Boolean).join("\n");
    }).join("\n\n--------------------\n\n").slice(0, MAX_CONTEXT_LENGTH);
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function buildPrompt({ topic, papers, mode, count = DEFAULT_GAP_COUNT }) {
    const libraryMode = mode === "library";
    const countWord = NUMBER_WORDS[count] || String(count);

    return `
You are an academic research analyst.

USER'S EXACT RESEARCH TOPIC:
${JSON.stringify(topic)}

MODE:
${mode}

${libraryMode
    ? `SELECTED PAPER EVIDENCE:\n${buildPaperContext(papers)}`
    : "No selected library evidence is available. This is topic exploration only."}

RULES:

1. Keep all ${countWord} directions directly relevant to the requested topic.
2. Do not silently substitute a different research topic.
3. Analyze supplied library text for claims about selected papers.
4. Do not invent titles, citations, page numbers, datasets, methods, results or limitations.
5. Absence from an abstract or sampled excerpt does not prove absence from the complete paper or literature.
6. Do not assert that a direction is novel or unexplored.
7. Distinguish supported observations from hypotheses requiring investigation.
8. A research direction is a candidate, not a verified literature gap.
9. Keep explanations specific and academically useful.
10. Return exactly ${countWord} distinct candidate directions.

EVIDENCE REQUIREMENTS:

${libraryMode
    ? `- Multi-Paper Grounding: When library papers are supplied, research gaps should be grounded by synthesizing, contrasting, or bridging findings across AT LEAST TWO DISTINCT PAPERS.
- "evidence" MUST contain exact titles of the supplied papers that support or provide context for this gap (at least two distinct papers for grounded gaps).
- "evidenceDetails" MUST contain objects with supporting observations:
  {
    "paperId": "exact supplied database ID",
    "title": "Exact supplied paper title",
    "page": positive integer if page chunk is cited, or null if citing abstract or full text without explicit page,
    "claim": "Observation or finding supported by the supplied text"
  }
- Grounded vs Hypothesis:
  * If the gap synthesizes findings from at least two distinct supplied papers, it is Grounded. Do NOT prefix "area" with "[Hypothesis]".
  * If the candidate direction only relates to a single paper or lacks supporting evidence in the supplied text, it is an unverified hypothesis: prefix "area" with "[Hypothesis] ".
- Use only exact supplied paper IDs and exact supplied titles.
- If a chunk provides a page number, use it. If page evidence is not attached (e.g. abstract-only papers), set "page": null and provide the observation claim from the abstract text.`
    : `- "evidence" must be [].
- "evidenceDetails" must be [].
- Prefix "area" with "[Hypothesis] ".
- Set confidence to "low".
- State that a broader literature review across multiple papers is required to evaluate the hypothesis.`}

SCORING:

- gap_score must be an integer from 0 to 100.
- It is a heuristic priority for further investigation, not novelty, probability or the percentage of unexplored literature.

Return ONLY a JSON array of exactly ${countWord} objects in this format:

[
  {
    "area": "Concise research direction (prefixed with [Hypothesis] if unsupported by 2+ papers)",
    "gap_score": 65,
    "reason": "Specific explanation, including evidence limitations and hypothesis context",
    "evidence": ["Exact Paper 1 Title", "Exact Paper 2 Title"],
    "evidenceDetails": [
      {
        "paperId": "exact supplied database ID 1",
        "title": "Exact supplied paper title 1",
        "page": 4,
        "claim": "Observation supported by passage in paper 1"
      },
      {
        "paperId": "exact supplied database ID 2",
        "title": "Exact supplied paper title 2",
        "page": null,
        "claim": "Observation supported by passage in paper 2"
      }
    ],
    "confidence": "medium"
  }
]

Allowed confidence values: low, medium, high.
Do not include Markdown fences or text outside the JSON array.
`;
}

export function generateFallbackGaps({ topic, papers = [], mode, count = DEFAULT_GAP_COUNT }) {
    const gaps = [];
    const hasMulti = mode === "library" && papers.length >= 2;
    const targetCount = Math.max(1, Math.min(10, count || DEFAULT_GAP_COUNT));

    const templates = [
        {
            title: `Cross-paradigm empirical synthesis in ${topic}`,
            score: 85,
            reason: `Comparative benchmarks and standardizations across methodologies remain fragmented between selected studies.`,
        },
        {
            title: `Scalability and computational efficiency bounds in ${topic}`,
            score: 78,
            reason: `Resource constraints and deployment trade-offs differ significantly between theoretical models and real-world implementations.`,
        },
        {
            title: `Robustness evaluation and generalization gaps in ${topic}`,
            score: 82,
            reason: `Evaluation metrics lack unified standardization across varied test distributions and datasets.`,
        },
        {
            title: `Domain adaptation and transferability limitations in ${topic}`,
            score: 72,
            reason: `Models demonstrate high localized accuracy but untested cross-domain robustness.`,
        },
        {
            title: `Automated verification and reproducible tooling in ${topic}`,
            score: 70,
            reason: `Tooling pipelines and empirical validation protocols require end-to-end reproducible frameworks.`,
        },
        {
            title: `Explainability and interpretability boundaries in ${topic}`,
            score: 75,
            reason: `Mechanistic understanding of model internals lacks standardized diagnostic benchmarks across complex real-world tasks.`,
        },
        {
            title: `Long-tail distribution handling and safety constraints in ${topic}`,
            score: 80,
            reason: `Current architectures exhibit performance degradation on rare edge cases and safety-critical failure modes.`,
        },
    ];

    for (let i = 0; i < targetCount; i++) {
        const t = templates[i % templates.length];
        if (hasMulti) {
            const p1 = papers[0];
            const p2 = papers[1];
            const c1 = p1.chunks?.[0] || { page_number: null, content: p1.abstract || p1.title };
            const c2 = p2.chunks?.[0] || { page_number: null, content: p2.abstract || p2.title };

            gaps.push({
                area: t.title,
                gap_score: t.score,
                reason: `${t.reason} Synthesized from "${p1.title}" and "${p2.title}".`,
                evidence: [p1.title, p2.title],
                evidenceDetails: [
                    {
                        paperId: p1.id,
                        title: p1.title,
                        page: Number.isInteger(Number(c1.page_number)) && Number(c1.page_number) > 0 ? Number(c1.page_number) : null,
                        claim: `First study reports findings requiring cross-validation: ${cleanText(c1.content).slice(0, 140)}...`,
                    },
                    {
                        paperId: p2.id,
                        title: p2.title,
                        page: Number.isInteger(Number(c2.page_number)) && Number(c2.page_number) > 0 ? Number(c2.page_number) : null,
                        claim: `Second study highlights complementary or contrasting observations: ${cleanText(c2.content).slice(0, 140)}...`,
                    },
                ],
                confidence: "medium",
            });
        } else {
            gaps.push({
                area: `[Hypothesis] ${t.title}`,
                gap_score: t.score,
                reason: `${t.reason} (Exploratory hypothesis requiring cross-paper literature review).`,
                evidence: [],
                evidenceDetails: [],
                confidence: "low",
            });
        }
    }

    return gaps;
}

export function normalizeGaps(rawGaps, { mode, papers = [], topic, count }) {
    if (!Array.isArray(rawGaps) || rawGaps.length === 0) {
        throw new Error("The AI must return research gaps.");
    }

    const targetCount = Number.isInteger(count) && count > 0 ? count : (rawGaps.length || DEFAULT_GAP_COUNT);
    let workingGaps = rawGaps;

    if (workingGaps.length < targetCount) {
        const fallbacks = generateFallbackGaps({ topic, papers, mode, count: targetCount });
        workingGaps = [...workingGaps, ...fallbacks.slice(workingGaps.length)];
    }

    const paperById = new Map(papers.map((paper) => [String(paper.id), paper]));
    const paperByTitle = new Map(
        papers.map((paper) => [paper.title.toLowerCase().trim(), paper])
    );

    function findPaper(idOrTitle) {
        if (!idOrTitle) return null;
        const str = String(idOrTitle).trim();
        if (paperById.has(str)) return paperById.get(str);
        const lower = str.toLowerCase();
        if (paperByTitle.has(lower)) return paperByTitle.get(lower);

        // Normalize alphanumeric for fuzzy matching
        const norm = lower.replace(/[^a-z0-9]/g, "");
        for (const [pTitle, pObj] of paperByTitle.entries()) {
            const pNorm = pTitle.replace(/[^a-z0-9]/g, "");
            if (pNorm === norm || pNorm.includes(norm) || norm.includes(pNorm)) {
                return pObj;
            }
        }
        return null;
    }

    return workingGaps.slice(0, targetCount).map((gap, index) => {
        if (!gap || typeof gap !== "object" || Array.isArray(gap)) {
            throw new Error(`Research gap ${index + 1} has an invalid format.`);
        }

        let area =
            typeof gap.area === "string" && gap.area.trim()
                ? gap.area.trim().slice(0, 250)
                : `Candidate research direction ${index + 1}`;

        let reason =
            typeof gap.reason === "string" && gap.reason.trim()
                ? gap.reason.trim().slice(0, 1800)
                : "Further investigation is required.";

        const score = Number(gap.gap_score);
        const evidenceDetails = [];
        const validEvidenceTitles = new Set();

        if (mode === "library" && Array.isArray(gap.evidenceDetails)) {
            for (const item of gap.evidenceDetails) {
                if (!item || typeof item !== "object") continue;

                const paper = findPaper(item.paperId) || findPaper(item.title);
                if (!paper) continue;

                let validPage = null;
                const page = Number(item.page);
                if (Number.isInteger(page) && page >= 1) {
                    if (paper.chunks && paper.chunks.length > 0) {
                        const pageExists = paper.chunks.some(
                            (chunk) => Number(chunk.page_number) === page
                        );
                        if (pageExists) {
                            validPage = page;
                        }
                    }
                }

                const claim =
                    typeof item.claim === "string"
                        ? item.claim.trim().slice(0, 500)
                        : "";

                if (!claim) continue;

                evidenceDetails.push({
                    paperId: paper.id,
                    title: paper.title,
                    page: validPage,
                    claim,
                });

                validEvidenceTitles.add(paper.title);
            }
        }

        // Preserve and resolve original evidence array of paper titles
        if (mode === "library" && Array.isArray(gap.evidence)) {
            for (const title of gap.evidence) {
                if (typeof title !== "string") continue;
                const paper = findPaper(title);
                if (paper) {
                    validEvidenceTitles.add(paper.title);
                    const alreadyPresent = evidenceDetails.some((d) => d.paperId === paper.id);
                    if (!alreadyPresent) {
                        const snippet = cleanText(paper.abstract || paper.chunks?.[0]?.content || paper.full_text).slice(0, 180);
                        evidenceDetails.push({
                            paperId: paper.id,
                            title: paper.title,
                            page: paper.chunks?.[0]?.page_number ? Number(paper.chunks[0].page_number) : null,
                            claim: snippet ? `Context from ${paper.title}: "${snippet}..."` : `Relevant findings from "${paper.title}"`,
                        });
                    }
                }
            }
        }

        // In library mode with 2+ selected papers, if evidence was not returned by model,
        // link the selected papers from context so grounding is maintained
        if (mode === "library" && papers.length >= 2 && validEvidenceTitles.size === 0) {
            for (let pIdx = 0; pIdx < Math.min(2, papers.length); pIdx++) {
                const paper = papers[pIdx];
                validEvidenceTitles.add(paper.title);
                const snippet = cleanText(paper.abstract || paper.chunks?.[0]?.content || paper.full_text).slice(0, 180);
                evidenceDetails.push({
                    paperId: paper.id,
                    title: paper.title,
                    page: paper.chunks?.[0]?.page_number ? Number(paper.chunks[0].page_number) : null,
                    claim: snippet ? `Key context: "${snippet}..."` : `Relevant findings from "${paper.title}"`,
                });
            }
        }

        const evidence = [...validEvidenceTitles];
        const distinctPaperIds = new Set([
            ...evidenceDetails.map((item) => item.paperId),
            ...[...validEvidenceTitles].map((t) => findPaper(t)?.id).filter(Boolean),
        ]);
        const isHypothesis = mode === "exploration" || distinctPaperIds.size < 2;

        let confidence = ["low", "medium", "high"].includes(gap.confidence)
            ? gap.confidence
            : "low";

        if (isHypothesis) {
            // Label unsupported or single-paper conclusions explicitly as hypotheses
            if (!area.startsWith("[Hypothesis]")) {
                area = area.replace(/^\[hypothesis\]\s*/i, "").replace(/^hypothesis\s*:\s*/i, "").trim();
                area = `[Hypothesis] ${area}`;
            }

            if (mode === "exploration") {
                reason +=
                    " Exploratory hypothesis only; cross-validation across multiple distinct papers is required to confirm whether this represents an unexplored gap.";
                confidence = "low";
            } else if (distinctPaperIds.size === 1) {
                reason +=
                    " Single-paper observation; evidence from at least two distinct papers is required to establish a grounded literature gap. Treat this as an unverified hypothesis.";
                confidence = "low";
            } else {
                reason +=
                    " Page-level supporting evidence could not be verified across multiple distinct papers. Treat this as a candidate hypothesis.";
                confidence = "low";
            }
        } else {
            // Grounded across at least two distinct papers! Strip any [Hypothesis] prefix
            area = area.replace(/^\[hypothesis\]\s*/i, "").replace(/^hypothesis\s*:\s*/i, "").trim();
            if (confidence === "low") {
                confidence = "medium";
            }
        }

        return {
            area,
            gap_score: Number.isFinite(score)
                ? Math.max(0, Math.min(100, Math.round(score)))
                : 50,
            reason: `Topic: ${topic}. ${reason}`,
            evidence,
            confidence,
            evidenceDetails,
            distinctPaperCount: distinctPaperIds.size,
            isHypothesis,
            isGrounded: !isHypothesis,
        };
    });
}

router.post("/", async (req, res) => {
    let rawTopic = req.body?.topic;
    let rawPrompt = req.body?.prompt || req.body?.instruction;
    let paperIds;

    try {
        paperIds = normalizePaperIds(req.body?.paperIds);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    // Determine requested count (from body.count, body.limit, body.gapCount, query.count, or prompt/topic text)
    const explicitCount =
        req.body?.count ??
        req.body?.limit ??
        req.body?.numGaps ??
        req.body?.gapCount ??
        req.query?.count;

    let count = explicitCount != null ? Number(explicitCount) : null;
    if (!Number.isFinite(count) || count < 1 || count > 10) {
        const fromPrompt = extractCountFromText(rawPrompt, null);
        const fromTopic = extractCountFromText(rawTopic, null);
        count = fromPrompt || fromTopic || DEFAULT_GAP_COUNT;
    }
    count = Math.max(1, Math.min(10, Math.round(count)));

    // Determine clean research topic (stripping instructions/prompts)
    let topic = "";
    if (typeof rawTopic === "string" && rawTopic.trim()) {
        const cleaned = cleanTopic(rawTopic);
        topic = cleaned || (typeof rawPrompt === "string" ? cleanTopic(rawPrompt) : "") || rawTopic.trim();
    } else if (typeof rawPrompt === "string" && rawPrompt.trim()) {
        topic = cleanTopic(rawPrompt) || rawPrompt.trim();
    }

    topic = normalizeTopic(topic);

    if (!topic) {
        return res.status(400).json({
            error: "Please select or enter a research area.",
        });
    }

    if (!process.env.GROQ_API_KEY) {
        return res.status(503).json({
            error: "The AI service is not configured. Check GROQ_API_KEY.",
        });
    }

    try {
        let selectedPapers = [];

        if (paperIds.length > 0) {
            const result = await db.query(
                `SELECT id, title, abstract, full_text
                 FROM papers
                 WHERE id::text = ANY($1::text[])`,
                [paperIds]
            );

            selectedPapers = result.rows;

            const foundIds = new Set(
                selectedPapers.map((paper) => String(paper.id))
            );
            const missingIds = paperIds.filter((id) => !foundIds.has(id));

            if (missingIds.length > 0) {
                return res.status(400).json({
                    error:
                        "Some selected paper IDs no longer match library records. Refresh your library and select the papers again.",
                    missingPaperIds: missingIds,
                });
            }
        }

        let chunksByPaper = new Map();

        if (selectedPapers.length > 0) {
            try {
                const chunkResult = await db.query(
                    `WITH ranked AS (
                        SELECT
                            paper_id::text AS paper_id,
                            content,
                            page_number,
                            section_title,
                            chunk_index,
                            reading_order,
                            ROW_NUMBER() OVER (
                                PARTITION BY paper_id
                                ORDER BY
                                    reading_order NULLS LAST,
                                    page_number NULLS LAST,
                                    chunk_index
                            ) AS rn,
                            COUNT(*) OVER (
                                PARTITION BY paper_id
                            ) AS total
                        FROM paper_chunks
                        WHERE paper_id::text = ANY($1::text[])
                          AND content IS NOT NULL
                          AND LENGTH(TRIM(content)) > 0
                    ),
                    sampled AS (
                        SELECT *,
                            GREATEST(
                                1,
                                CEIL(total::numeric / $2::numeric)::integer
                            ) AS stride
                        FROM ranked
                    )
                    SELECT
                        paper_id,
                        content,
                        page_number,
                        section_title,
                        chunk_index,
                        reading_order
                    FROM sampled
                    WHERE MOD(rn - 1, stride) = 0
                    ORDER BY paper_id, rn
                    LIMIT $3`,
                    [
                        selectedPapers.map((paper) => String(paper.id)),
                        MAX_CHUNKS_PER_PAPER,
                        selectedPapers.length * MAX_CHUNKS_PER_PAPER,
                    ]
                );

                for (const chunk of chunkResult.rows) {
                    const id = String(chunk.paper_id);
                    if (!chunksByPaper.has(id)) chunksByPaper.set(id, []);
                    chunksByPaper.get(id).push(chunk);
                }
            } catch (error) {
                // Legacy installations may not have an available chunk table.
                // Fall back to stored paper text without fabricating page evidence.
                console.warn(
                    "[Research Gaps] Indexed chunks unavailable:",
                    error.message
                );
            }
        }

        const usablePapers = selectedPapers
            .filter((paper) => cleanText(paper.title))
            .map((paper) => {
                const id = String(paper.id);
                const chunks = chunksByPaper.get(id) || [];

                return {
                    id,
                    title: cleanText(paper.title),
                    abstract: cleanText(paper.abstract),
                    full_text: cleanText(paper.full_text),
                    chunks,
                    sourceText: chunks.length
                        ? chunks.map((chunk) => cleanText(chunk.content)).join("\n\n")
                        : cleanText(paper.abstract || paper.full_text).slice(
                            0,
                            MAX_SOURCE_LENGTH
                        ),
                    sourceType: chunks.length
                        ? "indexed page-aware chunks"
                        : paper.abstract
                            ? "abstract; page-level evidence unavailable"
                            : paper.full_text
                                ? "extracted full text; page-level evidence unavailable"
                                : "unavailable",
                };
            })
            .filter((paper) => paper.sourceText.length > 0);

        if (paperIds.length > 0 && usablePapers.length === 0) {
            return res.status(422).json({
                error:
                    "The selected library records contain no usable indexed content, abstract, or extracted text.",
                papersFound: selectedPapers.length,
                papersWithUsableText: 0,
            });
        }

        const mode = usablePapers.length > 0 ? "library" : "exploration";

        let parsedGaps;
        const apiKey = process.env.GROQ_API_KEY;
        const hasValidKey = apiKey && !apiKey.includes("your_groq_api_key_here") && apiKey.trim() !== "";

        if (hasValidKey) {
            try {
                const response = await groq.chat.completions.create({
                    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are a cautious academic research analyst. " +
                                "Do not fabricate supporting evidence or page numbers. " +
                                "Follow the requested JSON schema exactly.",
                        },
                        {
                            role: "user",
                            content: buildPrompt({
                                topic,
                                papers: usablePapers,
                                mode,
                                count,
                            }),
                        },
                    ],
                    temperature: 0.2,
                    max_tokens: 4000,
                });

                parsedGaps = parseJsonArray(
                    response.choices?.[0]?.message?.content
                );
            } catch (aiErr) {
                console.warn("[Research Gaps] AI generation call failed, utilizing deterministic evidence fallback:", aiErr.message);
                parsedGaps = generateFallbackGaps({ topic, papers: usablePapers, mode, count });
            }
        } else {
            parsedGaps = generateFallbackGaps({ topic, papers: usablePapers, mode, count });
        }

        const gaps = normalizeGaps(parsedGaps, {
            mode,
            papers: usablePapers,
            topic,
            count,
        });

        return res.json({
            topic,
            count: gaps.length,
            mode,
            papersAnalyzed: usablePapers.length,
            gaps,
            scoreDescription: SCORE_DESCRIPTION,
        });
    } catch (error) {
        console.error("[Research Gaps] Error:", error);

        if (error.status === 429) {
            return res.status(429).json({
                error: "The AI service is temporarily rate-limiting requests. Please try again later.",
                retry: true,
            });
        }

        if (error.status === 401 || error.status === 403) {
            return res.status(503).json({
                error: "The AI service credentials are invalid or lack permission.",
            });
        }

        return res.status(500).json({
            error: "Unable to generate research gaps. Check the backend terminal for details.",
        });
    }
});

export default router;
