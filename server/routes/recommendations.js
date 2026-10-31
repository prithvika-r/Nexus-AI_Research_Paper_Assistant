
import express from "express";
import Groq from "groq-sdk";
import axios from "axios";
import { db } from "../index.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = "openai/gpt-oss-120b";
const CACHE_TTL = 30 * 60 * 1000;
const SEARCH_DELAY_MS = 1200;
const MAX_READ_PAPERS = 20;
const MAX_TOPICS = 3;
const MAX_CANDIDATES_PER_TOPIC = 8;
const MAX_RANKING_CANDIDATES = 24;

// Shared across recommendation requests in this Node.js process.
// This coordinates calls from concurrent requests instead of merely delaying
// requests within one route invocation.
let semanticScholarQueue = Promise.resolve();
let nextSemanticScholarRequestAt = 0;

const recommendationCache = new Map();

function getCachedRecommendations(key) {
    const entry = recommendationCache.get(key);

    if (!entry || Date.now() - entry.timestamp > CACHE_TTL) {
        recommendationCache.delete(key);
        return null;
    }

    return entry.data;
}

function saveCachedRecommendations(key, data) {
    recommendationCache.set(key, {
        timestamp: Date.now(),
        data,
    });

    // Prevent an unbounded in-memory cache.
    if (recommendationCache.size > 100) {
        const oldestKey = recommendationCache.keys().next().value;
        if (oldestKey !== undefined) {
            recommendationCache.delete(oldestKey);
        }
    }
}

function normalizeText(value = "") {
    return String(value)
        .normalize("NFKC")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function parseModelJson(content, expectedType) {
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("The AI returned an empty response.");
    }

    const cleaned = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    let parsed;

    try {
        parsed = JSON.parse(cleaned);
    } catch {
        const opening = expectedType === "array" ? "[" : "{";
        const closing = expectedType === "array" ? "]" : "}";
        const start = cleaned.indexOf(opening);
        const end = cleaned.lastIndexOf(closing);

        if (start < 0 || end <= start) {
            throw new Error("The AI returned incomplete JSON.");
        }

        parsed = JSON.parse(cleaned.slice(start, end + 1));
    }

    if (expectedType === "array" && !Array.isArray(parsed)) {
        throw new Error("The AI returned an invalid ranking format.");
    }

    if (
        expectedType === "object" &&
        (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    ) {
        throw new Error("The AI returned an invalid topics format.");
    }

    return parsed;
}

function getPaperContent(paper) {
    const abstract = normalizeText(paper.abstract || "");
    const fullText = normalizeText(paper.full_text || "");

    return (abstract || fullText).slice(0, 1200);
}

function buildReadingHistory(papers) {
    return papers.map((paper, index) => [
        `Paper ${index + 1}`,
        `ID: ${paper.id}`,
        `Title: ${normalizeText(paper.title) || "Title unavailable"}`,
        `Year: ${paper.year ?? "Unknown"}`,
        `Abstract or extracted-text excerpt: ${getPaperContent(paper) || "Unavailable"}`,
    ].join("\n")).join("\n\n---\n\n");
}

function extractTopics(topicData) {
    const values = [
        ...(Array.isArray(topicData.topics) ? topicData.topics : []),
        ...(Array.isArray(topicData.keywords) ? topicData.keywords : []),
    ];

    const seen = new Set();
    const topics = [];

    for (const value of values) {
        if (typeof value !== "string") continue;

        const topic = normalizeText(value).slice(0, 100);
        const key = topic.toLowerCase();

        if (!topic || seen.has(key)) continue;

        seen.add(key);
        topics.push(topic);

        if (topics.length >= MAX_TOPICS) break;
    }

    return topics;
}

/**
 * Queue Semantic Scholar calls across concurrent requests in this process.
 * This is not a distributed/global queue across multiple server instances.
 */
function scheduleSemanticScholarRequest(task) {
    const request = semanticScholarQueue.then(async () => {
        const wait = Math.max(0, nextSemanticScholarRequestAt - Date.now());

        if (wait > 0) {
            await new Promise(resolve => setTimeout(resolve, wait));
        }

        // Reserve the next slot before performing the request.
        nextSemanticScholarRequestAt = Date.now() + SEARCH_DELAY_MS;

        return task();
    });

    semanticScholarQueue = request.catch(() => undefined);

    return request;
}

async function searchSemanticScholar(topic) {
    return scheduleSemanticScholarRequest(() =>
        axios.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            {
                params: {
                    query: topic,
                    fields: "title,authors,abstract,year,citationCount,openAccessPdf",
                    limit: MAX_CANDIDATES_PER_TOPIC,
                    sort: "relevance",
                },
                headers: {
                    "User-Agent": "Nexus-Research-App/1.0",
                    ...(process.env.SEMANTIC_SCHOLAR_API_KEY && {
                        "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY,
                    }),
                },
                timeout: 15000,
            }
        )
    );
}

function toCandidate(paper) {
    if (!paper.paperId || !paper.title) return null;

    return {
        id: `ss_${paper.paperId}`,
        title: normalizeText(paper.title),
        abstract: normalizeText(paper.abstract || ""),
        year: paper.year ?? null,
        authors: Array.isArray(paper.authors)
            ? paper.authors.map(author => normalizeText(author.name)).filter(Boolean)
            : [],
        citationCount: Math.max(0, Number(paper.citationCount) || 0),
        openAccessPdf: paper.openAccessPdf || null,
        source: "semantic_scholar",
    };
}

function mergeCandidate(candidateMap, candidate) {
    if (!candidate) return;

    const existing = candidateMap.get(candidate.id);

    if (!existing) {
        candidateMap.set(candidate.id, candidate);
        return;
    }

    // Prefer richer metadata when a paper appears in multiple topic searches.
    candidateMap.set(candidate.id, {
        ...existing,
        abstract: existing.abstract || candidate.abstract,
        year: existing.year ?? candidate.year,
        authors: existing.authors.length ? existing.authors : candidate.authors,
        citationCount: Math.max(existing.citationCount, candidate.citationCount),
        openAccessPdf: existing.openAccessPdf || candidate.openAccessPdf,
    });
}

function heuristicRelevanceScore({ paper, matchedTopics, readingText }) {
    // A transparent ranking heuristic, not an embedding similarity or
    // probability of relevance. It combines topic matches with metadata.
    const title = normalizeText(paper.title).toLowerCase();
    const abstract = normalizeText(paper.abstract).toLowerCase();
    const history = readingText.toLowerCase();

    const topicScores = matchedTopics.map(topic => {
        const normalizedTopic = topic.toLowerCase();
        let score = 0;

        if (title.includes(normalizedTopic)) score += 3;
        if (abstract.includes(normalizedTopic)) score += 2;
        if (history.includes(normalizedTopic)) score += 1;

        return score;
    });

    const topicCoverage = matchedTopics.length
        ? topicScores.filter(score => score > 0).length / matchedTopics.length
        : 0;

    const directTitleMatch = topicScores.some(score => score >= 3);
    const abstractAvailable = Boolean(abstract);

    // The score is deliberately modest: keyword matching is not semantic
    // retrieval and cannot establish scientific relevance.
    let score = 20 + topicCoverage * 45;

    if (directTitleMatch) score += 15;
    if (abstractAvailable) score += 5;

    return Math.max(0, Math.min(85, Math.round(score)));
}

function buildFallbackReason(matchedTopics, paper) {
    if (matchedTopics.length) {
        return `Retrieved from a topic search related to your reading history: ${matchedTopics.join(", ")}. Check the abstract to confirm scientific relevance.`;
    }

    return "Retrieved from a topic search related to your reading history. Check the abstract to confirm scientific relevance.";
}

function parseRetryAfter(value) {
    if (!value) return null;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds;
    }

    const date = Date.parse(value);
    if (Number.isFinite(date)) {
        return Math.max(0, Math.ceil((date - Date.now()) / 1000));
    }

    return null;
}

router.post("/", async (req, res) => {
    const requestedLimit = Number(req.body?.limit ?? 5);
    const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(10, Math.floor(requestedLimit)))
        : 5;

    if (!process.env.GROQ_API_KEY) {
        return res.status(503).json({
            error: "The AI service is not configured. Check GROQ_API_KEY.",
        });
    }

    try {
        const readResult = await db.query(
            `SELECT id, title, abstract, full_text, year
             FROM papers
             WHERE is_read = true
             ORDER BY created_at DESC
             LIMIT $1`,
            [MAX_READ_PAPERS]
        );

        const readPapers = readResult.rows.filter(
            paper => normalizeText(paper.title || "")
        );

        if (!readPapers.length) {
            return res.json({
                recommendations: [],
                totalRecommended: 0,
                readPapersAnalyzed: 0,
                topicsExtracted: [],
                cached: false,
                message: "Read some papers first to get recommendations!",
            });
        }

        // Include text changes in the cache key so updated abstracts invalidate
        // stale recommendations even if the paper IDs have not changed.
        const cacheKey = [
            limit,
            ...readPapers.map(paper =>
                `${paper.id}:${normalizeText(paper.abstract || paper.full_text || "").length}`
            ).sort(),
        ].join("|");

        const cached = getCachedRecommendations(cacheKey);

        if (cached) {
            return res.json({
                ...cached,
                cached: true,
                message: "Showing saved recommendations.",
            });
        }

        const readPapersText = buildReadingHistory(readPapers);

        let uniqueTopics = [];
        const apiKey = process.env.GROQ_API_KEY;
        const hasValidKey = apiKey && !apiKey.includes("your_groq_api_key_here") && apiKey.trim() !== "";

        if (hasValidKey) {
            try {
                const topicResponse = await groq.chat.completions.create({
                    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
                    messages: [
                        {
                            role: "system",
                            content: "Extract research topics grounded in the supplied paper titles and text. Return valid JSON only. Do not invent paper metadata.",
                        },
                        {
                            role: "user",
                            content: `Extract 3-5 concise research topics and keywords from these papers.

${readPapersText}

Return:
{"topics":["topic1","topic2"],"keywords":["keyword1","keyword2"]}`,
                        },
                    ],
                    temperature: 0.1,
                    max_tokens: 700,
                });

                const topicData = parseModelJson(
                    topicResponse.choices?.[0]?.message?.content,
                    "object"
                );

                uniqueTopics = extractTopics(topicData);
            } catch (err) {
                console.warn("[Recommendations] Groq topic extraction failed, using keyword fallback:", err.message);
            }
        }

        if (!uniqueTopics.length) {
            const words = readPapers
                .map(p => p.title || "")
                .join(" ")
                .toLowerCase()
                .match(/\b[a-z]{4,}\b/g) || [];
            const stopWords = new Set(["with", "from", "that", "this", "using", "paper", "based", "approach", "model", "neural", "learning"]);
            const counts = new Map();
            for (const w of words) {
                if (!stopWords.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
            }
            const topKeywords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
            uniqueTopics = topKeywords.length ? topKeywords : ["neural networks", "feature representation", "optimization"];
        }

        if (!uniqueTopics.length) {
            return res.json({
                recommendations: [],
                totalRecommended: 0,
                readPapersAnalyzed: readPapers.length,
                topicsExtracted: [],
                cached: false,
                message: "Could not extract research topics from your papers.",
            });
        }

        const candidateMap = new Map();
        const matchedTopicsById = new Map();
        let rateLimited = false;
        let retryAfterSeconds = null;

        for (const topic of uniqueTopics) {
            try {
                const response = await searchSemanticScholar(topic);
                const results = Array.isArray(response.data?.data)
                    ? response.data.data
                    : [];

                for (const item of results) {
                    const candidate = toCandidate(item);
                    if (!candidate) continue;

                    mergeCandidate(candidateMap, candidate);

                    const matched = matchedTopicsById.get(candidate.id) || [];
                    if (!matched.includes(topic)) matched.push(topic);
                    matchedTopicsById.set(candidate.id, matched);
                }
            } catch (error) {
                const status = error.response?.status;

                console.error(
                    `Semantic Scholar search failed for "${topic}":`,
                    status || error.message
                );

                if (status === 429) {
                    rateLimited = true;
                    retryAfterSeconds = parseRetryAfter(
                        error.response?.headers?.["retry-after"]
                    );
                    break;
                }

                // Continue to use candidates gathered from successful searches.
            }
        }

        let candidates = [...candidateMap.values()];

        if (!candidates.length) {
            try {
                const readIds = readPapers.map(p => String(p.id));
                const otherPapersResult = await db.query(
                    `SELECT id, title, abstract, year, authors
                     FROM papers
                     WHERE NOT (id::text = ANY($1))
                     LIMIT $2`,
                    [readIds.length ? readIds : ['00000000-0000-0000-0000-000000000000'], limit]
                );
                for (const p of otherPapersResult.rows) {
                    const cand = {
                        id: String(p.id),
                        title: p.title,
                        abstract: p.abstract || "",
                        year: p.year,
                        authors: Array.isArray(p.authors) ? p.authors : [],
                        citationCount: 0,
                        openAccessPdf: null,
                        url: null,
                        venue: "Library",
                        source: "library",
                    };
                    candidateMap.set(cand.id, cand);
                    matchedTopicsById.set(cand.id, uniqueTopics.slice(0, 1));
                }
                candidates = [...candidateMap.values()];
            } catch (libErr) {
                console.warn("Could not load library fallback candidates:", libErr.message);
            }
        }

        if (!candidates.length) {
            return res.json({
                recommendations: [],
                totalRecommended: 0,
                readPapersAnalyzed: readPapers.length,
                topicsExtracted: uniqueTopics,
                cached: false,
                retry: true,
                message: "No papers could be retrieved right now. Please try again later.",
            });
        }

        // Limit the ranking input and retain a map of exact allowed IDs.
        const rankingCandidates = candidates.slice(0, MAX_RANKING_CANDIDATES);
        const candidatesById = new Map(
            rankingCandidates.map(paper => [paper.id, paper])
        );

        const candidatesText = rankingCandidates.map(paper => [
            `ID: ${paper.id}`,
            `Title: ${paper.title}`,
            `Year: ${paper.year ?? "Unknown"}`,
            `Authors: ${paper.authors.join(", ") || "Unknown"}`,
            `Abstract: ${paper.abstract.slice(0, 700) || "Unavailable"}`,
            `Search topics: ${(matchedTopicsById.get(paper.id) || []).join(", ") || "Unknown"}`,
        ].join("\n")).join("\n\n---\n\n");

        let modelRankings = [];

        try {
            const rankingResponse = await groq.chat.completions.create({
                model: MODEL,
                messages: [
                    {
                        role: "system",
                        content: `Rank candidate papers for a researcher's reading history.
Use only the candidate IDs supplied.
Do not invent metadata or claim that keyword matches prove methodological similarity.
Return JSON only in this format:
[{"paperId":"exact_candidate_id","reason":"brief explanation of the visible topical connection"}]`,
                    },
                    {
                        role: "user",
                        content: `READING HISTORY:
${readPapersText}

TOPICS EXTRACTED:
${uniqueTopics.join(", ")}

CANDIDATES:
${candidatesText}

Return up to ${Math.min(limit, rankingCandidates.length)} distinct candidate IDs.
Reasons must describe only connections reasonably supported by the supplied titles, abstracts, and search topics.
Do not return scores.`,
                    },
                ],
                temperature: 0.1,
                max_tokens: 1800,
            });

            modelRankings = parseModelJson(
                rankingResponse.choices?.[0]?.message?.content,
                "array"
            );
        } catch (error) {
            console.error("AI ranking failed; using heuristic fallback:", error.message);
        }

        const usedIds = new Set();
        const ranked = [];

        for (const item of modelRankings) {
            if (!item || typeof item.paperId !== "string") continue;

            const paper = candidatesById.get(item.paperId);
            if (!paper || usedIds.has(paper.id)) continue;

            usedIds.add(paper.id);

            const matchedTopics = matchedTopicsById.get(paper.id) || [];

            ranked.push({
                ...paper,
                relevanceScore: heuristicRelevanceScore({
                    paper,
                    matchedTopics,
                    readingText: readPapersText,
                }),
                reason: typeof item.reason === "string" && item.reason.trim()
                    ? normalizeText(item.reason).slice(0, 500)
                    : buildFallbackReason(matchedTopics, paper),
            });
        }

        // If the model fails or omits candidates, keep the endpoint useful
        // without pretending the heuristic is a measured semantic score.
        for (const paper of rankingCandidates) {
            if (ranked.length >= limit) break;
            if (usedIds.has(paper.id)) continue;

            usedIds.add(paper.id);

            const matchedTopics = matchedTopicsById.get(paper.id) || [];

            ranked.push({
                ...paper,
                relevanceScore: heuristicRelevanceScore({
                    paper,
                    matchedTopics,
                    readingText: readPapersText,
                }),
                reason: buildFallbackReason(matchedTopics, paper),
            });
        }

        ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

        const result = {
            recommendations: ranked.slice(0, limit),
            totalRecommended: Math.min(ranked.length, limit),
            readPapersAnalyzed: readPapers.length,
            topicsExtracted: uniqueTopics,
            cached: false,
            scoreDescription: "Heuristic ranking score based on topic matches and available metadata. It is not a probability, embedding-similarity score, or scientific relevance measurement.",
        };

        saveCachedRecommendations(cacheKey, result);

        if (rateLimited) {
            result.message = "Some topic searches were rate-limited; recommendations use results from successful searches.";
            result.retry = true;

            if (retryAfterSeconds !== null) {
                res.set("Retry-After", String(retryAfterSeconds));
            }
        }

        return res.json(result);
    } catch (error) {
        console.error("Recommendations route error:", error);

        if (error.status === 429 || error.status === 503) {
            return res.status(error.status).json({
                error: "The AI service is temporarily busy. Please try again later.",
                retry: true,
            });
        }

        return res.status(500).json({
            error: "Failed to generate recommendations. Check the backend logs for details.",
        });
    }
});

export default router;
