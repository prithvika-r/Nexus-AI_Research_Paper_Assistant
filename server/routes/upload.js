
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { db } from "../config/database.js";
import { extractPdfPages } from "../services/pdfService.js";
import { indexPaper } from "../services/indexingService.js";

const router = express.Router();

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const uploadsDir = path.resolve(process.cwd(), "uploads");

fs.mkdirSync(uploadsDir, { recursive: true });

const CURRENT_YEAR = new Date().getFullYear();
const MIN_PUBLICATION_YEAR = 1800;
const MAX_PUBLICATION_YEAR = CURRENT_YEAR + 1;

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),

    filename: (_req, file, cb) => {
        const originalName = path.basename(
            file.originalname || "upload.pdf"
        );

        const safeName = originalName.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        );

        cb(null, `${Date.now()}-${safeName}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },

    fileFilter: (_req, file, cb) => {
        if (
            path.extname(file.originalname || "").toLowerCase() !== ".pdf"
        ) {
            return cb(new Error("Only PDF files are supported."));
        }

        cb(null, true);
    },
});

/* -------------------------------------------------------
   GENERAL TEXT UTILITIES
------------------------------------------------------- */

function normalizeLine(value) {
    return String(value ?? "")
        .replace(/\u0000/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\u00A0/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function cleanText(value) {
    if (typeof value !== "string") return null;

    const cleaned = value
        .replace(/\u0000/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return cleaned || null;
}

function getPageLines(pages = []) {
    if (!Array.isArray(pages)) return [];

    return pages
        .map(page => {
            if (typeof page === "string") return page;

            return typeof page?.text === "string"
                ? page.text
                : "";
        })
        .join("\n")
        .split(/\r?\n/)
        .map(normalizeLine)
        .filter(Boolean);
}

function fingerprint(text) {
    const normalized = String(text ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    return createHash("sha256")
        .update(normalized, "utf8")
        .digest("hex");
}

function removeUploadedFile(filePath) {
    if (!filePath) return;

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error("Uploaded-file cleanup error:", error);
    }
}

function isValidYear(year) {
    return (
        Number.isInteger(year) &&
        year >= MIN_PUBLICATION_YEAR &&
        year <= MAX_PUBLICATION_YEAR
    );
}

/* -------------------------------------------------------
   SHARED NOISE DETECTION
------------------------------------------------------- */

function isPublicationNoise(value) {
    const line = normalizeLine(value);

    if (!line) return true;

    return (
        /^https?:\/\//i.test(line) ||
        /^www\./i.test(line) ||
        /\bdoi\.org\//i.test(line) ||
        /^(?:doi|issn|isbn)\s*[:#]/i.test(line) ||
        /^(?:abstract|keywords?|index terms|references|bibliography|contents)\s*:?\s*$/i.test(line) ||
        /^(?:volume|vol\.?|issue|number|no\.?|pp?\.?|pages?)\s*[:#]?\s*[\dIVX-]/i.test(line) ||
        /^\d{1,5}\s*[-–]\s*\d{1,5}$/.test(line) ||
        /^\d{1,5}$/.test(line) ||
        /©\s*(?:18|19|20|21)\d{2}/i.test(line) ||
        /\b(?:all rights reserved|corresponding author)\b/i.test(line) ||
        /^[\W\d_]+$/.test(line)
    );
}

function isLikelyAffiliation(value) {
    return /\b(?:university|faculty|department|school of|college|institute|laboratory|laboratories|research center|research centre|hospital|corporation|company|institution)\b/i.test(
        normalizeLine(value)
    );
}

/* -------------------------------------------------------
   TITLE EXTRACTION
------------------------------------------------------- */

function isBadTitle(value) {
    const title = normalizeLine(value);

    if (title.length < 5 || title.length > 300) {
        return true;
    }

    return (
        /^(?:unknown|untitled|document|scan|paper|upload)(?:\s+\d+)?$/i.test(title) ||
        /^\d{10,}(?:[-_ ].*)?$/.test(title) ||
        /^https?:\/\//i.test(title) ||
        /^www\./i.test(title) ||
        /\bdoi\.org\//i.test(title) ||
        /^(?:abstract|keywords?|references|contents|bibliography)\s*:?$/i.test(title) ||
        /^(?:issn|isbn|doi)\s*[:#]/i.test(title) ||
        /^(?:volume|vol\.?|issue|issn|isbn)\s+\d/i.test(title) ||
        /^(?:received|revised|accepted|published)\s*[:：]/i.test(title) ||
        /^(?:arxiv|preprint)\s*[:#]/i.test(title)
    );
}

function usableTitle(value) {
    const title = normalizeLine(value);

    return isBadTitle(title) ? null : title;
}

function isTitleCandidate(value) {
    const title = usableTitle(value);

    if (!title || title.length < 10 || title.length > 240) {
        return false;
    }

    const words = title.split(/\s+/);

    if (words.length < 3) return false;

    if (
        isPublicationNoise(title) ||
        isLikelyAffiliation(title) ||
        /^(?:dr|prof|professor|mr|mrs|ms)\.?\s/i.test(title) ||
        /\b(?:email|e-mail|orcid|received|accepted|published online)\b/i.test(title) ||
        /\b(?:journal|conference|proceedings)\s+(?:of|on)\b/i.test(title) ||
        /^[\d\s.,:;()[\]{}\-–—/]+$/.test(title)
    ) {
        return false;
    }

    return true;
}

function filenameTitle(originalFilename) {
    const filename = path
        .basename(
            originalFilename || "",
            path.extname(originalFilename || "")
        )
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return usableTitle(filename) || "Untitled research paper";
}

function getTitle(metadata, originalFilename, pages = []) {
    const metadataTitle = usableTitle(metadata?.title);

    if (metadataTitle) {
        return metadataTitle;
    }

    // Paper titles usually occur before the abstract.
    const lines = getPageLines(pages.slice(0, 1));

    const abstractIndex = lines.findIndex(line =>
        /^(?:abstract|summary)\b/i.test(line)
    );

    const frontMatter = abstractIndex >= 0
        ? lines.slice(0, abstractIndex)
        : lines.slice(0, 35);

    const candidates = [];

    for (let i = 0; i < frontMatter.length; i++) {
        const line = frontMatter[i];

        if (!isTitleCandidate(line)) continue;

        const words = line.split(/\s+/);

        let score = 10 - i * 0.45;

        // Reasonable title length.
        if (words.length >= 4 && words.length <= 18) {
            score += 3;
        }

        // Titles often use more than one line.
        if (line.length >= 20 && line.length <= 160) {
            score += 2;
        }

        // Down-rank sentences, dates and reference-like strings.
        if (/[.!?]$/.test(line)) score -= 1;
        if (/\b(?:19|20|21)\d{2}\b/.test(line)) score -= 3;
        if (/\d/.test(line)) score -= 1;
        if (/^[A-Z\s&-]+$/.test(line) && words.length > 5) {
            score -= 2;
        }

        // Avoid lines that look like an author's name.
        if (words.length <= 5 && words.every(word =>
            /^[A-ZÀ-ÖØ-Þ][\p{L}\p{M}'’.-]*$/u.test(word)
        )) {
            score -= 1;
        }

        candidates.push({
            title: line,
            score,
            index: i,
        });
    }

    candidates.sort(
        (a, b) => b.score - a.score || a.index - b.index
    );

    if (candidates.length > 0) {
        return usableTitle(candidates[0].title)
            || filenameTitle(originalFilename);
    }

    return filenameTitle(originalFilename);
}

/* -------------------------------------------------------
   YEAR EXTRACTION
------------------------------------------------------- */

function parseYearCandidate(value) {
    const text = removeIdentifierNoise(String(value ?? ""));

    const patterns = [
        // ISO-style dates: 2019-01-05 or 2019/01/05
        /\b((?:18|19|20|21)\d{2})[-/]\d{1,2}[-/]\d{1,2}\b/,

        // January 5, 2019
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+((?:18|19|20|21)\d{2})\b/i,

        // 5 January 2019 or 5 Jan 2019
        /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+((?:18|19|20|21)\d{2})\b/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);

        if (match) {
            const year = Number(match[1]);

            if (isValidYear(year)) return year;
        }
    }

    return null;
}

function removeIdentifierNoise(text) {
    return String(text ?? "")
        // arXiv identifiers: arXiv:1901.01450v1
        .replace(
            /\barxiv\s*:\s*\d{4}\.\d{4,5}(?:v\d+)?\b/gi,
            " "
        )
        // Bare arXiv-style identifiers.
        .replace(
            /\b\d{4}\.\d{4,5}(?:v\d+)?\b/gi,
            " "
        )
        // DOI values, including DOI URLs.
        .replace(
            /\b(?:https?:\/\/)?(?:dx\.)?doi\.org\/\S+/gi,
            " "
        )
        .replace(
            /\bdoi\s*:\s*\S+/gi,
            " "
        )
        // URLs.
        .replace(
            /\bhttps?:\/\/\S+/gi,
            " "
        )
        .replace(
            /\bwww\.\S+/gi,
            " "
        );
}
const DATE_PATTERNS = [
    /\b((?:18|19|20|21)\d{2})[-/]\d{1,2}[-/]\d{1,2}\b/i,

    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+((?:18|19|20|21)\d{2})\b/i,

    /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+((?:18|19|20|21)\d{2})\b/i,

    /\b(?:published|publication date|received|accepted|revised|online)\b[^.\n]{0,60}\b((?:18|19|20|21)\d{2})\b/i,
];
function getYearFromText(pages = []) {
    const lines = getPageLines(pages.slice(0, 3));

    if (!lines.length) return null;

    // Search the first page first; references are deliberately excluded.
    const firstPageLines = getPageLines(pages.slice(0, 1));

    const cleanedLines = firstPageLines.map(line => ({
        original: line,
        cleaned: removeIdentifierNoise(line),
    }));

    // Highest priority: explicit publication date.
    const publicationPatterns = [
        /\bpublication date\b/i,
        /\bpublished(?: online)?\b/i,
        /\bdate of publication\b/i,
        /\bpublication year\b/i,
    ];

    for (const pattern of publicationPatterns) {
        for (const line of cleanedLines) {
            if (!pattern.test(line.original)) continue;

            const year = parseYearCandidate(line.cleaned);

            if (year !== null) return year;

            const match = line.cleaned.match(
                /\b(?:18|19|20|21)\d{2}\b/
            );

            if (match) {
                const candidate = Number(match[0]);

                if (isValidYear(candidate)) return candidate;
            }
        }
    }

    // Next: a clear date in the first-page header.
    // This handles lines like "5 Jan 2019" after removing an arXiv ID.
    for (const { cleaned } of cleanedLines) {
        const year = parseYearCandidate(cleaned);

        if (year !== null) return year;
    }

    // Then look for accepted/revised dates, but only if no publication
    // date or unlabelled explicit date was found.
    const secondaryDatePatterns = [
        /\baccepted\b/i,
        /\brevised\b/i,
        /\breceived\b/i,
    ];

    for (const pattern of secondaryDatePatterns) {
        for (const line of cleanedLines) {
            if (!pattern.test(line.original)) continue;

            const year = parseYearCandidate(line.cleaned);

            if (year !== null) return year;
        }
    }

    // Last resort: use standalone year candidates from front matter.
    // Never search the entire paper body, where reference years dominate.
    const abstractIndex = cleanedLines.findIndex(({ original }) =>
        /^(?:abstract|summary)\b/i.test(original)
    );

    const frontMatter = abstractIndex >= 0
        ? cleanedLines.slice(0, abstractIndex)
        : cleanedLines.slice(0, 20);

    const yearCounts = new Map();

    for (const { original, cleaned } of frontMatter) {
        // Exclude obvious reference, citation, and identifier lines.
        if (
            /\b(?:references|bibliography|cited by)\b/i.test(original) ||
            /\b(?:volume|issue|pp?\.|pages?)\s*\d/i.test(original)
        ) {
            continue;
        }

        const matches = cleaned.match(
            /\b(?:18|19|20|21)\d{2}\b/g
        ) || [];

        for (const match of matches) {
            const year = Number(match);

            if (!isValidYear(year)) continue;

            yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
        }
    }

    if (yearCounts.size === 0) return null;

    // Prefer the most frequent front-matter year. On ties, prefer the
    // later year to reduce the chance of choosing a received date.
    return [...yearCounts.entries()]
        .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

function getYear(value, pages = []) {
    const metadataYear = parseYearCandidate(value);

    if (metadataYear !== null) {
        return metadataYear;
    }

    return getYearFromText(pages);
}

/* -------------------------------------------------------
   AUTHOR EXTRACTION
------------------------------------------------------- */

function cleanAuthorName(value) {
    let name = normalizeLine(value)
        .replace(/^[\s*•·,;|]+|[\s*•·,;|]+$/g, "")
        .replace(/^\d+\s*[.)]?\s*/, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!name || name.length < 3 || name.length > 100) {
        return null;
    }

    if (
        /@/.test(name) ||
        /https?:\/\/|www\./i.test(name) ||
        /\b(?:abstract|keywords?|university|department|faculty|institute|college|laboratory|email|corresponding author|received|accepted|published|doi|issn|orcid)\b/i.test(name) ||
        /\d{4}/.test(name) ||
        isLikelyAffiliation(name)
    ) {
        return null;
    }

    const words = name.split(/\s+/);

    if (words.length < 2 || words.length > 10) {
        return null;
    }

    if (!/\p{L}/u.test(name)) return null;

    // Permit initials, Unicode names, hyphens, apostrophes and periods.
    if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(name)) {
        return null;
    }

    return name;
}

function getMetadataAuthors(value) {
    let entries = [];

    if (Array.isArray(value)) {
        entries = value;
    } else if (typeof value === "string") {
        // Metadata sometimes stores names as a single string.
        entries = value.split(/\s*;\s*|\s*\|\s*/);
    } else if (value && typeof value === "object") {
        entries = [value];
    }

    const names = entries
        .map(author => {
            if (typeof author === "string") return author;

            if (author && typeof author.name === "string") {
                return author.name;
            }

            return null;
        })
        .map(cleanAuthorName)
        .filter(Boolean);

    return [...new Set(names)];
}

function splitAuthorLine(line) {
    const normalized = normalizeLine(line);

    // Common separator between multiple authors.
    if (/[;|]/.test(normalized)) {
        return normalized.split(/\s*[;|]\s*/);
    }

    // Ampersands and "and" commonly separate multiple authors.
    if (/\s&\s|\s+\band\b\s+/i.test(normalized)) {
        return normalized
            .replace(/\s+\band\b\s+/gi, ";")
            .replace(/\s*&\s*/g, ";")
            .split(/\s*;\s*/);
    }

    // Commas are ambiguous: "Smith, John" may be one author.
    // Only split comma-separated pieces when each piece looks like
    // a full name rather than a surname-first name.
    if (/,/.test(normalized)) {
        const pieces = normalized.split(/\s*,\s*/);

        if (
            pieces.length > 1 &&
            pieces.every(piece => {
                const cleaned = cleanAuthorName(piece);
                return cleaned !== null;
            })
        ) {
            return pieces;
        }
    }

    return [normalized];
}

function getAuthors(value, pages = [], title = null) {
    const lines = getPageLines(pages.slice(0, 2));

    let titleIndex = -1;

    if (title) {
        const normalizedTitle = normalizeLine(title).toLowerCase();

        titleIndex = lines.findIndex(line =>
            line.toLowerCase().includes(normalizedTitle)
        );
    }

    const startIndex = titleIndex >= 0
        ? titleIndex + 1
        : 0;

    const authorCandidates = [];

    for (
        let i = startIndex;
        i < Math.min(lines.length, startIndex + 18);
        i++
    ) {
        const line = lines[i];

        if (
            /^(?:abstract|summary|keywords?|index terms)\s*:?\s*$/i.test(line)
        ) {
            break;
        }

        if (
            isPublicationNoise(line) ||
            isLikelyAffiliation(line) ||
            /\b(?:email|e-mail|corresponding author|http|www\.|orcid)\b/i.test(line) ||
            /^(?:international journal|journal of|volume|vol\.?|issue|issn|isbn|doi|arxiv)\b/i.test(line) ||
            /\b(?:received|revised|accepted|published online)\b/i.test(line)
        ) {
            continue;
        }

        authorCandidates.push(line);
    }

    const authors = [];

    for (const line of authorCandidates) {
        for (const piece of splitAuthorLine(line)) {
            const name = cleanAuthorName(piece);

            if (name) authors.push(name);
        }
    }

    const uniqueAuthors = [...new Set(authors)];

    // Prefer plausible names found near the title.
    if (uniqueAuthors.length > 0) {
        return uniqueAuthors;
    }

    // Fall back to embedded PDF metadata.
    return getMetadataAuthors(value);
}

/* -------------------------------------------------------
   METADATA ASSEMBLY
------------------------------------------------------- */

function getMetadata(pdf) {
    const metadata = pdf?.metadata ?? {};
    const pages = pdf?.pages ?? [];

    return {
        title: getTitle(metadata, "", pages),
        authors: getAuthors(metadata.authors, pages),
        year: getYear(metadata.year, pages),
        abstract: cleanText(metadata.abstract),
    };
}

/* -------------------------------------------------------
   PDF VALIDATION
------------------------------------------------------- */

function isLikelyInvalidPdfError(error) {
    const message = String(error?.message || "").toLowerCase();

    return (
        /invalid pdf|password|encrypted|missing pdf|format error|corrupt pdf|unexpected end|no pdf header|invalid header/.test(
            message
        )
    );
}

/* -------------------------------------------------------
   DATABASE HELPERS
------------------------------------------------------- */

async function findPaperByHash(contentHash) {
    const hashed = await db.query(
        `SELECT id, title, full_text, content_hash,
                processing_status, chunk_count, file_path
         FROM papers
         WHERE content_hash = $1
         LIMIT 1`,
        [contentHash]
    );

    if (hashed.rows.length) return hashed.rows[0];

    const legacy = await db.query(
        `SELECT id, title, full_text, content_hash,
                processing_status, chunk_count, file_path
         FROM papers
         WHERE content_hash IS NULL
           AND full_text IS NOT NULL`
    );

    for (const paper of legacy.rows) {
        if (fingerprint(paper.full_text) === contentHash) {
            try {
                await db.query(
                    `UPDATE papers
                     SET content_hash = $1
                     WHERE id = $2
                       AND content_hash IS NULL`,
                    [contentHash, paper.id]
                );
            } catch (error) {
                if (error.code !== "23505") throw error;
            }

            return paper;
        }
    }

    return null;
}

async function loadPaper(paperId) {
    const result = await db.query(
        "SELECT * FROM papers WHERE id = $1",
        [paperId]
    );

    return result.rows[0] ?? null;
}

async function respondWithExistingPaper(
    res,
    existing,
    pages,
    uploadedPath
) {
    let indexingError = null;

    const needsIndexing =
        existing.processing_status !== "completed" ||
        Number(existing.chunk_count ?? 0) <= 0;

    if (needsIndexing) {
        try {
            await indexPaper(existing.id, pages);
        } catch (error) {
            indexingError = error;

            console.error(
                `Duplicate paper re-indexing failed (${existing.id}):`,
                error
            );
        }
    }

    removeUploadedFile(uploadedPath);

    const savedPaper = await loadPaper(existing.id);

    return res.status(200).json({
        success: true,
        duplicate: true,

        message: needsIndexing
            ? indexingError
                ? "This paper already exists, but index recovery failed."
                : "This paper already exists; index recovery was attempted."
            : "This paper is already in your library.",

        paper: savedPaper ?? existing,

        processing: {
            status:
                savedPaper?.processing_status ??
                existing.processing_status,

            chunksIndexed:
                savedPaper?.chunk_count ??
                existing.chunk_count,

            ...(indexingError
                ? { error: indexingError.message }
                : {}),
        },
    });
}

/* -------------------------------------------------------
   UPLOAD ROUTE
------------------------------------------------------- */

router.post("/", upload.single("pdf"), async (req, res) => {
    let uploadedPath = req.file?.path ?? null;
    let savedPaperId = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                error: "No PDF file was uploaded.",
            });
        }

        const pdf = await extractPdfPages(uploadedPath);

        if (!Array.isArray(pdf?.pages) || pdf.pages.length === 0) {
            removeUploadedFile(uploadedPath);
            uploadedPath = null;

            return res.status(422).json({
                error: "The PDF contains no extractable pages.",
            });
        }

        const fullText = pdf.pages
            .map(page =>
                typeof page.text === "string"
                    ? page.text
                    : ""
            )
            .join("\n\n")
            .trim();

        if (!fullText) {
            removeUploadedFile(uploadedPath);
            uploadedPath = null;

            return res.status(422).json({
                error: "The uploaded PDF does not contain extractable text.",
                hint: "If this is a scanned PDF, OCR support is needed.",
            });
        }

        const contentHash = fingerprint(fullText);
        const existing = await findPaperByHash(contentHash);

        if (existing) {
            const response = await respondWithExistingPaper(
                res,
                existing,
                pdf.pages,
                uploadedPath
            );

            uploadedPath = null;
            return response;
        }

        const metadata = getMetadata(pdf);

        const title = getTitle(
            metadata,
            req.file.originalname,
            pdf.pages
        );

        const authors = getAuthors(
            metadata.authors,
            pdf.pages,
            title
        );

        const year = getYear(
            pdf?.metadata?.year,
            pdf.pages
        );

        let insertResult;

        try {
            insertResult = await db.query(
                `INSERT INTO papers (
                    title,
                    authors,
                    year,
                    abstract,
                    full_text,
                    file_path,
                    source,
                    processing_status,
                    chunk_count,
                    content_hash
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *`,
                [
                    title,
                    authors,
                    year,
                    metadata.abstract,
                    fullText,
                    uploadedPath,
                    "upload",
                    "pending",
                    0,
                    contentHash,
                ]
            );
        } catch (error) {
            if (error.code !== "23505") throw error;

            const duplicate = await findPaperByHash(contentHash);

            if (!duplicate) throw error;

            const response = await respondWithExistingPaper(
                res,
                duplicate,
                pdf.pages,
                uploadedPath
            );

            uploadedPath = null;
            return response;
        }

        const paper = insertResult.rows[0];
        savedPaperId = paper.id;

        let indexingResult = null;
        let indexingError = null;

        try {
            indexingResult = await indexPaper(
                paper.id,
                pdf.pages
            );
        } catch (error) {
            indexingError = error;

            console.error(
                `Paper indexing error (${paper.id}):`,
                error
            );
        }

        const updatedPaper = await loadPaper(paper.id);

        if (!updatedPaper) {
            throw new Error("Could not retrieve the saved paper.");
        }

        if (indexingError) {
            return res.status(202).json({
                success: true,
                duplicate: false,
                paper: updatedPaper,

                processing: {
                    status: updatedPaper.processing_status,
                    chunksIndexed: updatedPaper.chunk_count,
                    error:
                        "The PDF was saved, but indexing failed. You can retry indexing.",
                },

                preview: fullText.slice(0, 500),
            });
        }

        return res.status(201).json({
            success: true,
            duplicate: false,
            paper: updatedPaper,

            processing: {
                status: indexingResult.status,
                chunksIndexed: indexingResult.chunksIndexed,
                embeddingModel: indexingResult.embeddingModel,
                pagesExtracted: pdf.pages.length,
                totalPages: pdf.pageCount ?? pdf.pages.length,
            },

            preview: fullText.slice(0, 500),
        });
    } catch (error) {
        console.error("Upload error:", error);

        if (!savedPaperId) {
            removeUploadedFile(uploadedPath);
        }

        if (isLikelyInvalidPdfError(error)) {
            return res.status(422).json({
                error:
                    "The PDF could not be read. It may be corrupt, encrypted, or password-protected.",
            });
        }

        return res.status(500).json({
            error: "Failed to process the PDF upload.",
        });
    }
});

/* -------------------------------------------------------
   UPLOAD ERROR HANDLER
------------------------------------------------------- */

router.use((error, _req, res, next) => {
    if (!error) return next();

    if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
            error: "PDF file size cannot exceed 25 MB.",
        });
    }

    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            error: error.message,
        });
    }

    if (error.message === "Only PDF files are supported.") {
        return res.status(400).json({
            error: error.message,
        });
    }

    console.error("Upload middleware error:", error);

    return res.status(400).json({
        error: "The upload request could not be processed.",
    });
});

export default router;
