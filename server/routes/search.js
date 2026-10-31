
import express from "express";
import axios from "axios";
import { resolvePaperPdfUrl } from "../services/pdfResolverService.js";
import { db } from "../config/database.js";

const router = express.Router();

const searchCache = new Map();
const pendingRequests = new Map();

const CACHE_TTL = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MIN_REQUEST_INTERVAL = 1100;

let lastRequestStartedAt = 0;
let requestQueue = Promise.resolve();

function getCachedSearch(query) {
    const cached = searchCache.get(query);

    if (!cached) return null;

    if (Date.now() - cached.timestamp >= CACHE_TTL) {
        searchCache.delete(query);
        return null;
    }

    return cached.data;
}

function setCachedSearch(query, data) {
    searchCache.delete(query);

    if (searchCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = searchCache.keys().next().value;

        if (oldestKey !== undefined) {
            searchCache.delete(oldestKey);
        }
    }

    searchCache.set(query, {
        data,
        timestamp: Date.now(),
    });
}

function fetchPapers(query) {
    const request = requestQueue.then(async () => {
        const elapsed = Date.now() - lastRequestStartedAt;
        const waitMs = Math.max(0, MIN_REQUEST_INTERVAL - elapsed);

        if (waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        lastRequestStartedAt = Date.now();

        const response = await axios.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            {
                params: {
                    query,
                    fields:
                        "title,authors,abstract,year,citationCount,openAccessPdf,externalIds,isOpenAccess,url,venue,tldr",
                    limit: 10,
                },
                headers: {
                    "User-Agent": "Nexus-Research-App/1.0",
                    ...(process.env.SEMANTIC_SCHOLAR_API_KEY &&
                      !process.env.SEMANTIC_SCHOLAR_API_KEY.includes("your_semantic_scholar_api_key_here") &&
                      process.env.SEMANTIC_SCHOLAR_API_KEY.trim() !== ""
                        ? {
                              "x-api-key":
                                  process.env.SEMANTIC_SCHOLAR_API_KEY.trim(),
                          }
                        : {}),
                },
                timeout: 15000,
            }
        );

        const data = response.data || {};
        if (Array.isArray(data.data)) {
            data.data = data.data.map((paper) => {
                const pdfUrl = resolvePaperPdfUrl(paper);
                return {
                    ...paper,
                    pdf_url: pdfUrl,
                    file_path: pdfUrl || paper.file_path || null,
                    isOpenAccess: Boolean(paper.isOpenAccess || pdfUrl),
                    has_full_pdf: Boolean(pdfUrl),
                };
            });
        }

        return data;
    });

    // Keep the queue usable even if one request fails.
    requestQueue = request.then(
        () => undefined,
        () => undefined
    );

    return request;
}

router.get("/", async (req, res) => {
    const q = String(req.query.q || "").trim();

    if (!q) {
        return res.status(400).json({ error: "Query required" });
    }

    const cacheKey = q.toLowerCase().replace(/\s+/g, " ");

    const cached = getCachedSearch(cacheKey);

    if (cached) {
        res.set("X-Search-Cache", "HIT");
        return res.json(cached);
    }

    // Reuse an in-flight request for the same normalized query.
    let request = pendingRequests.get(cacheKey);

    if (!request) {
        request = fetchPapers(q);
        pendingRequests.set(cacheKey, request);
    }

    try {
        const data = await request;

        setCachedSearch(cacheKey, data);

        res.set("X-Search-Cache", "MISS");
        return res.json(data);
    } catch (err) {
        console.warn("[Search] External search failed or rate-limited; attempting local database search:", err.message);
        try {
            const localResult = await db.query(
                `SELECT id, title, abstract, year, authors
                 FROM papers
                 WHERE title ILIKE $1 OR abstract ILIKE $1
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [`%${q}%`]
            );

            if (localResult.rows.length > 0) {
                const localData = {
                    total: localResult.rows.length,
                    offset: 0,
                    data: localResult.rows.map(p => ({
                        paperId: p.id,
                        title: p.title,
                        abstract: p.abstract,
                        year: p.year,
                        authors: Array.isArray(p.authors) ? p.authors.map(a => typeof a === 'string' ? { name: a } : a) : [],
                        source: "library",
                        isOpenAccess: true,
                        has_full_pdf: true,
                    })),
                    source: "local_library",
                };
                return res.json(localData);
            }
        } catch (dbErr) {
            console.error("[Search] Local search also failed:", dbErr.message);
        }

        if (err.response?.status === 429) {
            const retryAfter = err.response.headers?.["retry-after"];
            if (retryAfter) res.set("Retry-After", String(retryAfter));
            return res.status(429).json({
                error: "Semantic Scholar is temporarily rate-limiting searches. Please wait a moment or search your saved library.",
                retryAfter: retryAfter || null,
            });
        }

        return res.status(502).json({
            error: "Search service is temporarily unavailable. You can search your existing library papers.",
        });
    } finally {
        // Remove only this completed request, not a newer replacement.
        if (pendingRequests.get(cacheKey) === request) {
            pendingRequests.delete(cacheKey);
        }
    }
});

export default router;
