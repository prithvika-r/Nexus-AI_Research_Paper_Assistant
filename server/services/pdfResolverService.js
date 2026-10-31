import axios from "axios";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "../config/database.js";
import { extractPdfPages } from "./pdfService.js";
import { indexPaper } from "./indexingService.js";

const uploadsDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const HTTP_HEADERS = {
    "User-Agent": "Nexus-Research-App/1.0 (Academic Paper Assistant; mailto:research@nexus.ai)",
    Accept: "application/pdf,application/octet-stream,*/*",
};

/**
 * Extracts or constructs a direct PDF URL from paper metadata.
 */
export function resolvePaperPdfUrl(paper = {}) {
    if (!paper) return null;

    // 1. Check existing openAccessPdf
    if (paper.openAccessPdf?.url) {
        let u = String(paper.openAccessPdf.url).trim();
        if (/arxiv\.org/i.test(u)) {
            u = u.replace(/^http:/i, "https:").replace(/\/abs\//i, "/pdf/");
            if (!u.endsWith(".pdf")) u += ".pdf";
        }
        return u;
    }

    if (typeof paper.openAccessPdf === "string" && /^https?:\/\//i.test(paper.openAccessPdf)) {
        let u = paper.openAccessPdf.trim();
        if (/arxiv\.org/i.test(u)) {
            u = u.replace(/^http:/i, "https:").replace(/\/abs\//i, "/pdf/");
            if (!u.endsWith(".pdf")) u += ".pdf";
        }
        return u;
    }

    // 2. Check externalIds (Semantic Scholar)
    const externalIds = paper.externalIds || {};

    if (externalIds.ArXiv) {
        const arxivId = String(externalIds.ArXiv).replace(/^arxiv:/i, "").trim();
        return `https://arxiv.org/pdf/${arxivId}.pdf`;
    }

    if (externalIds.PubMedCentral) {
        const pmcId = String(externalIds.PubMedCentral).replace(/^pmc/i, "").trim();
        return `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/pdf/`;
    }

    // 3. Check paper.url or paper.file_path for arXiv or direct PDF URLs
    const possibleUrl = paper.file_path || paper.url;
    if (possibleUrl && /^https?:\/\//i.test(possibleUrl)) {
        if (/arxiv\.org\/abs\/([0-9.]+)/i.test(possibleUrl)) {
            const match = possibleUrl.match(/arxiv\.org\/abs\/([0-9.]+)/i);
            return `https://arxiv.org/pdf/${match[1]}.pdf`;
        }
        if (/arxiv\.org\/pdf\/([0-9.]+)/i.test(possibleUrl)) {
            let u = possibleUrl.replace(/^http:/i, "https:");
            if (!u.endsWith(".pdf")) u += ".pdf";
            return u;
        }
        if (/\.pdf(?:$|\?)/i.test(possibleUrl)) {
            return possibleUrl;
        }
    }

    return null;
}

/**
 * Searches arXiv and Unpaywall to find a free PDF for a paper by title and metadata.
 */
export async function searchFreePdfUrl(title, authors = [], doi = null) {
    if (!title || typeof title !== "string") return null;

    const cleanTitle = title
        .replace(/[:\-–—()[\]{}"']/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // 1. If DOI is available, check Unpaywall
    if (doi) {
        try {
            const cleanDoi = encodeURIComponent(doi.trim());
            const unpaywallRes = await axios.get(
                `https://api.unpaywall.org/v2/${cleanDoi}?email=nexus_paper_assistant@gmail.com`,
                { timeout: 6000 }
            );
            const oaUrl =
                unpaywallRes.data?.best_oa_location?.url_for_pdf ||
                unpaywallRes.data?.best_oa_location?.url;
            if (oaUrl && /\.pdf/i.test(oaUrl)) {
                return oaUrl;
            }
        } catch {
            // Ignore unpaywall errors
        }
    }

    // 2. Search arXiv API by title
    try {
        const titleTokens = cleanTitle
            .split(" ")
            .map((w) => w.trim())
            .filter(Boolean);

        const queryCandidates = [];
        if (titleTokens.length >= 2) {
            queryCandidates.push(`ti:%22${encodeURIComponent(titleTokens.slice(0, Math.min(titleTokens.length, 4)).join(" "))}%22`);
        }
        if (titleTokens.length >= 3) {
            queryCandidates.push(`all:%22${encodeURIComponent(titleTokens[0])}%22+AND+all:%22${encodeURIComponent(titleTokens[1])}%22`);
        }
        if (titleTokens.length >= 2) {
            queryCandidates.push(`ti:${encodeURIComponent(titleTokens.slice(0, 3).join(" "))}`);
        }

        for (const q of queryCandidates) {
            const arxivRes = await axios.get(
                `https://export.arxiv.org/api/query?search_query=${q}&max_results=3`,
                { timeout: 7000 }
            );

            const entries = arxivRes.data.split("<entry>");
            for (let i = 1; i < entries.length; i++) {
                const entry = entries[i];
                const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
                const idMatch = entry.match(/<id>http:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/);

                if (titleMatch && idMatch) {
                    const arxivTitleClean = titleMatch[1]
                        .replace(/[^a-zA-Z0-9\s]/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()
                        .toLowerCase();
                    const inputTitleClean = cleanTitle
                        .replace(/[^a-zA-Z0-9\s]/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()
                        .toLowerCase();

                    const firstWords = inputTitleClean.split(" ").slice(0, 2).join(" ");
                    if (
                        arxivTitleClean.includes(firstWords) ||
                        inputTitleClean.includes(arxivTitleClean.slice(0, 25)) ||
                        arxivTitleClean.includes(inputTitleClean.slice(0, 25))
                    ) {
                        const arxivId = idMatch[1].replace(/v\d+$/, "");
                        return `https://arxiv.org/pdf/${arxivId}.pdf`;
                    }
                }
            }
        }
    } catch {
        // Ignore arXiv search errors
    }

    // 3. Fallback: Search Semantic Scholar for openAccessPdf
    try {
        const s2Res = await axios.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            {
                params: {
                    query: cleanTitle.slice(0, 100),
                    fields: "title,openAccessPdf,externalIds,url",
                    limit: 2,
                },
                headers: {
                    ...(process.env.SEMANTIC_SCHOLAR_API_KEY
                        ? { "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY }
                        : {}),
                },
                timeout: 7000,
            }
        );

        const candidates = s2Res.data?.data || [];
        for (const candidate of candidates) {
            const resolved = resolvePaperPdfUrl(candidate);
            if (resolved) return resolved;
        }
    } catch {
        // Ignore S2 errors
    }

    return null;
}

/**
 * Downloads a PDF from an external URL into a Buffer.
 */
export async function downloadPdfBuffer(url) {
    if (!url || !/^https?:\/\//i.test(url)) {
        throw new Error("Invalid URL for PDF download.");
    }

    const response = await axios.get(url, {
        headers: HTTP_HEADERS,
        responseType: "arraybuffer",
        maxContentLength: 35 * 1024 * 1024, // 35 MB max
        timeout: 25000,
        maxRedirects: 5,
    });

    const buffer = Buffer.from(response.data);

    if (buffer.length < 500) {
        throw new Error("Downloaded file is too small to be a valid PDF.");
    }

    const header = buffer.subarray(0, 5).toString("ascii");
    if (header !== "%PDF-") {
        throw new Error("Downloaded content is not a valid PDF file.");
    }

    return buffer;
}

/**
 * Saves a PDF buffer to uploads/, extracts full text and pages, indexes it, and updates DB.
 */
export async function saveAndIndexDownloadedPdf(paperId, buffer, originalTitle = "paper") {
    const safeTitle = (originalTitle || "paper")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 60);
    const fileName = `${Date.now()}-${safeTitle}.pdf`;
    const targetFilePath = path.join(uploadsDir, fileName);

    await fsp.writeFile(targetFilePath, buffer);

    const contentHash = createHash("sha256").update(buffer).digest("hex");

    let extractedPages = [];
    let fullText = "";

    try {
        const extraction = await extractPdfPages(targetFilePath);
        extractedPages = (extraction.pages || []).map((p) => {
            if (typeof p === "string") {
                return p.replace(/\u0000/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
            }
            if (p && typeof p.text === "string") {
                return {
                    ...p,
                    text: p.text.replace(/\u0000/g, "").replace(/[\u200B-\u200D\uFEFF]/g, ""),
                };
            }
            return p;
        });

        fullText = extractedPages
            .map((p) => (typeof p === "string" ? p : p.text || ""))
            .join("\n\n")
            .replace(/\u0000/g, "")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
    } catch (extractErr) {
        console.warn(`Extraction warning for ${paperId}:`, extractErr.message);
    }

    // Update database record
    await db.query(
        `UPDATE papers
         SET file_path = $1,
             full_text = COALESCE(NULLIF($2, ''), full_text),
             content_hash = COALESCE(content_hash, $3)
         WHERE id = $4`,
        [targetFilePath, fullText || null, contentHash, paperId]
    );

    // Index paper chunks for AI chat and semantic search if pages were extracted
    if (extractedPages.length > 0) {
        try {
            await indexPaper(paperId, extractedPages);
        } catch (indexErr) {
            console.warn(`Indexing warning for ${paperId}:`, indexErr.message);
        }
    }

    const updated = await db.query("SELECT * FROM papers WHERE id = $1", [paperId]);
    return updated.rows[0];
}

/**
 * Ensures a paper in the library has its full PDF and text.
 * If file_path is missing or external, downloads, extracts, and indexes.
 */
export async function ensurePaperFullContent(paperId) {
    const res = await db.query("SELECT * FROM papers WHERE id = $1", [paperId]);
    if (!res.rows.length) throw new Error("Paper not found.");

    const paper = res.rows[0];

    // Already has local file and full text
    if (paper.file_path && !/^https?:\/\//i.test(paper.file_path)) {
        if (fs.existsSync(paper.file_path) && paper.full_text && paper.processing_status === "completed") {
            return paper;
        }
        if (fs.existsSync(paper.file_path) && !paper.full_text) {
            // Extract from existing file
            try {
                const extraction = await extractPdfPages(paper.file_path);
                const fullText = (extraction.pages || [])
                    .map((p) => (typeof p === "string" ? p : p.text || ""))
                    .join("\n\n")
                    .trim();
                await db.query("UPDATE papers SET full_text = $1 WHERE id = $2", [fullText, paperId]);
                await indexPaper(paperId, extraction.pages);
                const refreshed = await db.query("SELECT * FROM papers WHERE id = $1", [paperId]);
                return refreshed.rows[0];
            } catch (e) {
                console.warn("Re-extraction failed:", e.message);
            }
        }
    }

    // Determine PDF URL
    let pdfUrl = resolvePaperPdfUrl(paper);

    if (!pdfUrl) {
        // Attempt search via arXiv / S2
        pdfUrl = await searchFreePdfUrl(paper.title, paper.authors);
    }

    if (!pdfUrl) {
        throw new Error("Could not find a free open-access PDF for this paper.");
    }

    const buffer = await downloadPdfBuffer(pdfUrl);
    return await saveAndIndexDownloadedPdf(paperId, buffer, paper.title);
}
