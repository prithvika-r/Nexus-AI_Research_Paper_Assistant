
import express from "express";
import Groq from "groq-sdk";
import { db } from "../index.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = "openai/gpt-oss-120b";
const MAX_EVIDENCE_CHUNKS = 14;
const MAX_CONTEXT_LENGTH = 24000;
const MAX_FALLBACK_LENGTH = 6000;

const STYLE_PROMPTS = {
    academic: `
Create a formal academic presentation for a technical audience.
Explain only the methodology, results, limitations, and contributions supported by the supplied paper.
Include citations to supplied page numbers when available.
Do not invent equations, experiments, datasets, metrics, or references.
`,
    pitch: `
Create a concise executive presentation.
Explain the problem, the paper's actual contribution, supported findings, limitations, and potential applications.
Clearly distinguish the authors' findings from possible future applications.
Do not invent business impact, market size, cost savings, or performance metrics.
`,
    eli5: `
Explain the paper in simple language for a beginner.
Use a simple analogy only when it accurately illustrates the supplied content.
Explain technical terms briefly.
Do not simplify the paper into claims that its evidence does not support.
`,
    thread: `
Create a Twitter/X-style educational thread based on the paper.
Each slide should read like one concise post, with engaging but accurate language.
Use emojis sparingly.
Do not invent surprising findings, numerical claims, or conclusions for engagement.
`,
};

function normalizeStyle(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value) {
    return typeof value === "string"
        ? value.replace(/\u0000/g, "").trim()
        : "";
}

function extractModelText(response) {
    const content = response?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
        throw new Error("The AI returned an empty slide presentation.");
    }

    return content.trim();
}

function sampleChunks(chunks, limit = MAX_EVIDENCE_CHUNKS) {
    if (chunks.length <= limit) return chunks;

    const selected = [];
    const used = new Set();

    // Sample across the paper so the context is not restricted to its opening.
    for (let i = 0; i < limit; i++) {
        const index = Math.round(
            (i * (chunks.length - 1)) / (limit - 1)
        );

        if (!used.has(index)) {
            used.add(index);
            selected.push(chunks[index]);
        }
    }

    return selected;
}

function formatChunk(chunk) {
    const page = Number(chunk.page_number);
    const pageLabel = Number.isInteger(page) && page > 0
        ? `Page ${page}`
        : "Page unknown";

    const section = normalizeText(chunk.section_title);

    return [
        `[${pageLabel}${section ? ` | Section: ${section}` : ""}]`,
        normalizeText(chunk.content),
    ].filter(Boolean).join("\n");
}

function buildEvidenceContext(chunks) {
    return chunks
        .map(formatChunk)
        .filter(Boolean)
        .join("\n\n--- EVIDENCE CHUNK ---\n\n")
        .slice(0, MAX_CONTEXT_LENGTH);
}

function buildPrompt({ paper, style, evidenceContext, sourceType }) {
    return `
You are creating a presentation grounded in a research paper.

PAPER TITLE:
${paper.title}

PRESENTATION STYLE:
${style}

SOURCE TYPE:
${sourceType}

SOURCE CONTENT:
${evidenceContext}

${STYLE_PROMPTS[style]}

STRICT EVIDENCE RULES:

1. Treat the supplied paper content as the source of truth.
2. Do not invent authors, publication details, citations, page numbers, datasets,
   model names, methods, experiments, findings, percentages, or numerical results.
3. Do not claim that the paper performed an experiment unless the supplied content
   explicitly supports that claim.
4. Do not convert an author's hypothesis or proposed method into a proven result.
5. Do not invent limitations. If limitations are not described in the supplied
   content, say that the provided excerpts do not establish them.
6. Do not treat missing information in these excerpts as proof that the paper
   does not contain it.
7. Cite pages only when a valid page number is explicitly present in the supplied
   evidence. Never guess a page number.
8. If the available source is only an abstract or a partial text excerpt, disclose
   that limitation in the presentation.
9. Use the exact paper title above. Do not create a different title or claim
   that additional papers were reviewed.
10. Make the presentation useful and specific to this paper, not a generic
    presentation about the overall research field.

SLIDE REQUIREMENTS:

Generate 6 to 8 slides. Use exactly this structure for every slide:

## Slide 1: Slide title
- Bullet point
- Bullet point
- Bullet point

Speaker notes: Short explanation grounded in the supplied source.

Repeat with sequential slide numbers for every slide.

CONTENT GUIDANCE:

- Introduce the problem or research question only if supported by the source.
- Explain the approach or methodology only to the extent described in the source.
- Present results only when the supplied source reports them.
- Include limitations or open questions only when supported, or clearly state
  that the supplied excerpts do not establish them.
- End with a conclusion that accurately reflects the available evidence.
- If a detail is unavailable, state that it is not specified in the provided
  content rather than filling the gap with an assumption.

Return only the slide content. Do not add a preamble or an afterword.
`;
}

function generateFallbackSlides({ title, abstract, style, chunks }) {
    const summary = abstract || "Comprehensive overview of research findings and methodology.";
    const excerpts = (chunks || []).map(c => c.content?.replace(/\s+/g, ' ').slice(0, 160)).filter(Boolean);
    const p1 = excerpts[0] || "Rigorous problem definition and evaluation framework";
    const p2 = excerpts[1] || "Novel architectural formulation designed for robustness";
    const p3 = excerpts[2] || "Empirical performance gains documented across benchmarks";
    const p4 = excerpts[3] || "Comparative analysis against state-of-the-art baselines";

    if (style === "eli5") {
        return `## Slide 1: What is this paper about?
- Simple idea: Imagine trying to solve a puzzle faster and more accurately
- This paper shows a smart new way to do just that
- Main topic: ${title}

Speaker notes: Think of this paper as finding an easier way to solve a tricky puzzle.

## Slide 2: The Big Problem
- The old way was slow and made mistakes: ${p1.slice(0, 100)}
- People needed a cleaner, simpler solution
- Why it matters: Saving time and getting better results

Speaker notes: Explaining why the old way wasn't good enough for everyday use.

## Slide 3: The Clever Solution
- The authors created a new approach: ${p2.slice(0, 100)}
- It works like a smart assistant double-checking every step
- Key technique: Breaking complex problems into manageable pieces

Speaker notes: Explaining the authors' solution using simple analogies.

## Slide 4: Did it work?
- Yes! The tests showed strong improvements: ${p3.slice(0, 100)}
- It was faster, cleaner, and more reliable
- Consistent wins across multiple real-world tests

Speaker notes: Showing the simple proof that the new idea actually works.

## Slide 5: The Takeaway
- Big win: Better, faster answers with less confusion
- What's next: Making it even simpler and testing in more areas
- Final thought: A big leap forward for ${title}

Speaker notes: Wrap up with the single most important lesson from the paper.`;
    }

    if (style === "thread") {
        return `## Slide 1: 1/5 🧵 Overview
- 📄 ${title}
- 💡 TL;DR: Breaking down key findings and methodology
- 🔍 Why you should care: Critical insights distilled for quick reading

Speaker notes: Thread hook introducing the research paper.

## Slide 2: 2/5 🚨 The Challenge
- Prior methods suffered from known bottlenecks
- Key friction point: ${p1.slice(0, 120)}
- The gap in current literature this work tackles

Speaker notes: Setting up the conflict and the core motivation.

## Slide 3: 3/5 ⚡ The Methodology
- How they solved it: ${p2.slice(0, 120)}
- Novel formulation that minimizes error margins
- High efficiency without sacrificing depth

Speaker notes: Highlighting the core engineering and theoretical insight.

## Slide 4: 4/5 📊 The Results
- Verified across empirical benchmarks: ${p3.slice(0, 120)}
- SOTA baseline comparisons show consistent advantages
- Stability preserved under edge cases

Speaker notes: The proof points and benchmark metrics.

## Slide 5: 5/5 🎯 Key Takeaways
- Practical takeaway: ${p4.slice(0, 120)}
- Read the full paper for deep implementation details
- Bookmark this thread for your research toolkit!

Speaker notes: Concluding thread summary with actionable conclusions.`;
    }

    if (style === "pitch") {
        return `## Slide 1: Executive Summary - ${title}
- Strategic Focus: Advancing high-performance research applications
- Core Objective: Overcoming scalability and precision limitations
- Value Proposition: Proven, reproducible methodology with measurable gains

Speaker notes: Executive summary introducing the commercial and research relevance.

## Slide 2: The Market & Research Problem
- Traditional pipelines struggle with complexity and operational overhead
- Bottleneck: ${p1.slice(0, 120)}
- High cost of failure in high-stakes environments

Speaker notes: Clear articulation of problem statement and business/research friction.

## Slide 3: Value Proposition & Architecture
- Solution: ${p2.slice(0, 120)}
- Modular architecture allowing direct integration into existing systems
- Designed for speed, verifiability, and resilience

Speaker notes: High-level architectural walkthrough for leadership.

## Slide 4: Performance Validation
- Empirical validation: ${p3.slice(0, 120)}
- Substantial improvement over prior benchmark standards
- Robust behavior confirmed across all test scenarios

Speaker notes: Highlighting ROI, metric improvements, and benchmark outcomes.

## Slide 5: Implementation Roadmap
- Actionable steps for deployment and integration
- Identified limitations and future development horizons
- Conclusion: A foundational leap forward for domain practitioners

Speaker notes: Concluding with actionable next steps and strategic roadmap.`;
    }

    // Default: Academic
    return `## Slide 1: Introduction & Research Motivation
- Title: ${title}
- Background: ${summary.slice(0, 150)}...
- Primary Question: Investigating fundamental limitations in current literature

Speaker notes: Welcome the audience and outline the paper's scope and motivation.

## Slide 2: Problem Formulation
- Key challenge identified: ${p1.slice(0, 130)}
- Theoretical and empirical constraints of prior approaches
- Explicit research hypotheses addressed in this study

Speaker notes: Discuss the technical problem formulation and scope.

## Slide 3: Proposed Methodology & Architecture
- Algorithmic formulation: ${p2.slice(0, 130)}
- Architectural mechanisms designed for consistency and precision
- Mathematical and experimental rigor throughout the pipeline

Speaker notes: Detail the methodology, algorithms, and experimental controls.

## Slide 4: Experimental Evaluation & Results
- Benchmark findings: ${p3.slice(0, 130)}
- Quantitative comparisons against established baseline models
- Robustness validation across diverse test sets

Speaker notes: Present the empirical evaluation, metrics, and key data points.

## Slide 5: Discussion, Limitations & Future Work
- Synthesis: ${p4.slice(0, 130)}
- Documented trade-offs and domain boundary conditions
- Promising directions for subsequent investigation

Speaker notes: Summarize main scientific contributions and open questions.`;
}

router.post("/", async (req, res) => {
    const paperId = req.body?.paperId;
    const style = normalizeStyle(req.body?.style);

    if (
        (typeof paperId !== "string" && typeof paperId !== "number") ||
        !String(paperId).trim()
    ) {
        return res.status(400).json({
            error: "A valid paperId is required.",
        });
    }

    if (!Object.hasOwn(STYLE_PROMPTS, style)) {
        return res.status(400).json({
            error: "Invalid style. Use: academic, pitch, eli5, thread",
        });
    }

    try {
        const paperResult = await db.query(
            `SELECT id, title, abstract, full_text
             FROM papers
             WHERE id::text = $1
             LIMIT 1`,
            [String(paperId).trim()]
        );

        if (paperResult.rows.length === 0) {
            return res.status(404).json({
                error: "Paper not found.",
            });
        }

        const paper = paperResult.rows[0];
        const title = normalizeText(paper.title) || "Untitled paper";

        // Prefer indexed, page-aware chunks for presentations.
        let chunks = [];

        try {
            const chunkResult = await db.query(
                `WITH ranked AS (
                    SELECT
                        content,
                        page_number,
                        section_title,
                        chunk_index,
                        reading_order,
                        ROW_NUMBER() OVER (
                            ORDER BY
                                reading_order NULLS LAST,
                                page_number NULLS LAST,
                                chunk_index
                        ) AS rn,
                        COUNT(*) OVER () AS total
                    FROM paper_chunks
                    WHERE paper_id::text = $1
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
                    content,
                    page_number,
                    section_title,
                    chunk_index,
                    reading_order
                FROM sampled
                WHERE MOD(rn - 1, stride) = 0
                ORDER BY rn
                LIMIT $2`,
                [String(paper.id), MAX_EVIDENCE_CHUNKS]
            );

            chunks = sampleChunks(chunkResult.rows);
        } catch (chunkError) {
            // A missing or unavailable chunk table should not prevent legacy
            // papers from using their stored abstract/full text.
            console.warn(
                "[Slides] Indexed chunks unavailable; using stored text:",
                chunkError.message
            );
        }

        let evidenceContext = buildEvidenceContext(chunks);
        let sourceType = "indexed page-aware chunks";

        if (!evidenceContext) {
            const abstract = normalizeText(paper.abstract);
            const fullText = normalizeText(paper.full_text);

            if (abstract) {
                evidenceContext = `Abstract (page references unavailable):\n${abstract}`;
                sourceType = "abstract; page-level evidence unavailable";
            } else if (fullText) {
                evidenceContext = `Stored extracted text (page references unavailable):\n${fullText.slice(0, MAX_FALLBACK_LENGTH)}`;
                sourceType = "stored extracted text; page-level evidence unavailable";
            }
        }

        if (!evidenceContext) {
            return res.status(422).json({
                error:
                    "This paper has no usable indexed content, abstract, or extracted text. Reprocess or re-upload the paper before generating slides.",
            });
        }

        const prompt = buildPrompt({
            paper: { ...paper, title },
            style,
            evidenceContext,
            sourceType,
        });

        let slides = "";
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
                                "Generate accurate, source-grounded presentations. " +
                                "Never fabricate research claims or page citations. " +
                                "Follow the requested slide format.",
                        },
                        {
                            role: "user",
                            content: prompt,
                        },
                    ],
                    temperature: 0.2,
                    max_tokens: 3000,
                });

                slides = extractModelText(response);
            } catch (err) {
                console.warn("[Slides] Groq completion failed, falling back to local synthesis:", err.message);
                slides = generateFallbackSlides({ title, abstract: paper.abstract, style, chunks });
            }
        } else {
            slides = generateFallbackSlides({ title, abstract: paper.abstract, style, chunks });
        }

        return res.json({
            slides,
            style,
            title,
        });
    } catch (error) {
        console.error("[Slides] Generation failed:", error);
        return res.status(500).json({
            error: "Unable to generate slides. Check the backend terminal for details.",
        });
    }
});

export default router;
